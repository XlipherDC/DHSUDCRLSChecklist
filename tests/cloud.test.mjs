import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.js';
import { createProject } from '../lib/model.js';
import { createCloudStore, validateConnection, invitationLink, parseInvitation, sharedRecord } from '../lib/cloud.js';

const config = { url: 'https://crls-api.test-account.workers.dev', workspaceKey: 'a'.repeat(64) };
const origin = 'https://example.github.io';
function harness(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8'));
  t.after(() => sql.close());
  const DB = {
    prepare(query) {
      let params = [];
      return { bind(...values) { params = values; return this; }, async first() { return sql.prepare(query).get(...params) || null; }, execute() { return { results: sql.prepare(query).all(...params), success: true }; } };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const results = statements.map(stmt => stmt.execute()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
  const env = { DB, WORKSPACE_KEY: config.workspaceKey, WORKSPACE_NAME: 'Office team', ALLOWED_ORIGINS: origin };
  const fetcher = (url, options) => worker.fetch(new Request(url, { ...options, headers: { ...options.headers, Origin: origin } }), env);
  const client = () => createCloudStore(config, fetcher);
  const direct = (body, opts = {}) => worker.fetch(new Request(config.url + '/api/workspace', {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + config.workspaceKey, Origin: origin, 'Content-Type': 'application/json', ...opts.headers }, ...(body ? { body: JSON.stringify(body) } : {})
  }), env);
  return { sql, DB, env, fetcher, client, direct };
}
const project = (id = 'test-one') => createProject({ name: 'Office project', type: 'subdivision', scheme: 'pd957' }, id);
const revisionMap = projects => new Map(projects.map(p => [p.id, p._revision]));

test('a second computer loads saved records, review notes and fees', async t => {
  const h = harness(t), a = h.client(), b = h.client();
  assert.equal((await a.read()).projects.length, 0);
  const p = project();
  p.reviews['subdivision-B10'] = { status: 'verified', remarks: 'Original inspected.', receivedDate: '2026-09-08', reviewedBy: 'Processor A', updatedAt: p.updatedAt };
  p.fees.lots = 25; p.fees.saved = true;
  const saved = await a.write([p], [], new Map());
  const data = await b.read();
  assert.equal(data.name, 'Office team');
  assert.equal(data.projects[0].reviews['subdivision-B10'].remarks, 'Original inspected.');
  assert.equal(data.projects[0].fees.lots, 25);
  assert.equal(data.projects[0]._revision, saved[0]._revision);
  assert.equal(await b.version(), 1);
});

test('same-project edits conflict instead of overwriting another computer', async t => {
  const h = harness(t), a = h.client(), b = h.client();
  await a.write([project()], [], new Map());
  const aView = (await a.read()).projects, bView = (await b.read()).projects;
  await a.write([{ ...aView[0], notes: 'A saved first' }], [], revisionMap(aView));
  await assert.rejects(b.write([{ ...bView[0], notes: 'B stale edit' }], [], revisionMap(bView)), /Another processor/);
  assert.equal((await b.read()).projects[0].notes, 'A saved first');
});

test('concurrent edits to separate projects survive the transaction retry', async t => {
  const h = harness(t), a = h.client(), b = h.client();
  await a.write([project('one'), project('two')], [], new Map());
  const snapshot = (await a.read()).projects;
  const [p1, p2] = snapshot;
  await Promise.all([a.write([{ ...p1, notes: 'First' }], [], revisionMap(snapshot)), b.write([{ ...p2, notes: 'Second' }], [], revisionMap(snapshot))]);
  assert.deepEqual((await a.read()).projects.map(p => p.notes), ['First', 'Second']);
});

test('a conflict rolls back the whole multi-project operation', async t => {
  const h = harness(t), a = h.client(), b = h.client();
  const saved = await a.write([project()], [], new Map());
  await b.write([{ ...saved[0], notes: 'Latest' }], [], revisionMap(saved));
  await assert.rejects(a.write([project('new-record'), { ...saved[0], notes: 'Old' }], [], revisionMap(saved)), /Another processor/);
  assert.equal((await a.read()).projects.length, 1);
});

test('delete is shared and stale edits cannot recreate deleted records', async t => {
  const h = harness(t), a = h.client(), b = h.client();
  const saved = await a.write([project()], [], new Map());
  await b.write([], ['test-one'], revisionMap(saved));
  assert.equal((await a.read()).projects.length, 0);
  await assert.rejects(a.write(saved, [], revisionMap(saved)), /Another processor/);
});

test('retrying after a lost save response reuses the operation and does not duplicate it', async t => {
  const h = harness(t); let first = true;
  const client = createCloudStore(config, async (url, options) => {
    const result = await h.fetcher(url, options);
    if (first && options.method === 'POST') { first = false; throw new Error('Connection dropped after commit'); }
    return result;
  });
  const p = project();
  await assert.rejects(client.write([p], [], new Map()), /interrupted save/);
  p.updatedAt = new Date(Date.now() + 1000).toISOString();
  const saved = await client.write([p], [], new Map());
  assert.equal(saved.length, 1);
  assert.equal((await client.read()).projects.length, 1);
  assert.equal(await client.version(), 1);
});

test('missing/wrong key, unapproved origins, and absent server secrets cannot read records', async t => {
  const h = harness(t);
  for (const auth of ['', 'Bearer ' + 'b'.repeat(64)]) assert.equal((await h.direct(null, { headers: { Authorization: auth } })).status, 401);
  assert.equal((await h.direct(null, { headers: { Origin: 'https://other.example' } })).status, 403);
  const response = await worker.fetch(new Request(config.url + '/api/workspace', { headers: { Authorization: 'Bearer ' + config.workspaceKey } }), { ...h.env, WORKSPACE_KEY: undefined });
  assert.equal(response.status, 503);
});

test('CORS supports authorized GitHub Pages and sends no wildcard or cached records', async t => {
  const h = harness(t);
  const response = await worker.fetch(new Request(config.url + '/api/workspace', { method: 'OPTIONS', headers: { Origin: origin } }), h.env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('server rejects invalid records even when the client-side validator is bypassed', async t => {
  const h = harness(t);
  const p = project(); p.fees.licenses.pd957.lots = -4;
  const response = await h.direct({ changes: [p], deleted: [], expected: { [p.id]: null }, requestId: crypto.randomUUID() });
  assert.equal(response.status, 400);
  assert.equal((await h.client().read()).projects.length, 0);
});

test('legacy attachment data never leaves the local record and cannot enter via direct API', async t => {
  const h = harness(t), p = project();
  p.reviews['subdivision-B10'] = { status: 'verified', remarks: '', receivedDate: '', reviewedBy: '', updatedAt: p.updatedAt, files: [] };
  assert.equal(Object.hasOwn(sharedRecord(p).reviews['subdivision-B10'], 'files'), false);
  assert.equal(Object.hasOwn(p.reviews['subdivision-B10'], 'files'), true);
  const response = await h.direct({ changes: [p], deleted: [], expected: { [p.id]: null }, requestId: crypto.randomUUID() });
  assert.equal(response.status, 400);
  const [saved] = await h.client().write([p], [], new Map());
  assert.equal(Object.hasOwn(saved.reviews['subdivision-B10'], 'files'), false);
});

test('private links round-trip in URL fragments and reject unsafe endpoints and malformed keys', () => {
  const link = invitationLink(config, 'https://example.github.io/checklist/?query=unused#project/id');
  const url = new URL(link);
  assert.equal(url.search, '');
  assert.equal(url.pathname, '/checklist/');
  assert.deepEqual(parseInvitation(url.hash), config);
  assert.equal(parseInvitation('#projects'), null);
  for (const endpoint of ['https://evil.example', 'http://crls-api.test.workers.dev', 'https://crls-api.test.workers.dev@evil.example', 'https://crls-api.test.workers.dev/other']) assert.throws(() => validateConnection({ ...config, url: endpoint }));
  assert.throws(() => validateConnection({ ...config, workspaceKey: 'password' }));
});

test('unknown routes and oversized requests fail without changing stored data', async t => {
  const h = harness(t);
  const response = await worker.fetch(new Request(config.url + '/api/unknown', { headers: { Authorization: 'Bearer ' + config.workspaceKey } }), h.env);
  assert.equal(response.status, 404);
  const large = await h.direct({ padding: 'x'.repeat(1500001) });
  assert.equal(large.status, 413);
  assert.equal(await h.client().version(), 0);
});

test('shared workspace preserves mixed categories, TLS undertakings and lot breakdown', async t => {
 const h=harness(t), a=h.client(), b=h.client();
 const p=createProject({name:'Mixed TLS',type:'subdivision',scheme:'pd957',categories:['openMarket','economic'],application:'TLS',tlsUndertakings:['ecc','verifiedSurveyReturns'],lotCounts:{houseAndLot:35,lotOnly:15}},'mixed-tls');
 await a.write([p],[],new Map());
 const loaded=(await b.read()).projects[0];
 for(const key of ['categories','application','tlsUndertakings','lotCounts']) assert.deepEqual(loaded[key],p[key]);
 loaded.lotCounts.lotOnly=-1;
 await assert.rejects(b.write([loaded],[],revisionMap([loaded])),/whole numbers/);
});

test('shared saved assessments retain separate CRs and LS quantities for every classification', async t => {
  const h=harness(t), a=h.client(), b=h.client();
  const p=createProject({name:'Mixed assessment',type:'subdivision',scheme:'pd957',categories:['openMarket','socialized'],projectArea:25000},'shared-fees');
  p.fees.saved=true;
  p.fees.licenses.openMarket.lots=10;p.fees.licenses.socialized.lots=20;
  await a.write([p],[],new Map());
  const loaded=(await b.read()).projects[0];
  assert.deepEqual(loaded.fees,p.fees);
  loaded.fees.registrations.economic=true;
  await assert.rejects(b.write([loaded],[],revisionMap([loaded])),/CR selections must match/);
});
