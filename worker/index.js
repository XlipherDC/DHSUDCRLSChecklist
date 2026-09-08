import { validateProject } from '../lib/model.js';
import catalog from '../data/catalog.json' with { type: 'json' };

const MAX_REQUEST = 1500000;
const MAX_PROJECT = 500000;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function digest(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join(''); }
async function authorized(request, secret) {
  if (!/^[a-f0-9]{64}$/.test(secret || '')) throw new ApiError(503, 'Workspace key is not configured.');
  const supplied = request.headers.get('Authorization') || '';
  if (!/^Bearer [a-f0-9]{64}$/.test(supplied)) return false;
  const a = await digest(supplied.slice(7)), b = await digest(secret);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function readBody(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(400, 'Send JSON project data.');
  if (Number(request.headers.get('Content-Length')) > MAX_REQUEST) throw new ApiError(413, 'Shared imports support up to 1.5 MB per operation. Import a smaller set of project records.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Missing project data.');
  const chunks = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > MAX_REQUEST) { await reader.cancel(); throw new ApiError(413, 'Shared imports support up to 1.5 MB per operation. Import a smaller set of project records.'); } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, 'Invalid JSON project data.'); }
}
function validateWrite(body) {
  if (!body || !Array.isArray(body.changes) || !Array.isArray(body.deleted) || !body.expected || typeof body.expected !== 'object' || Array.isArray(body.expected) || !uuid(body.requestId)) throw new ApiError(400, 'Invalid save request.');
  if (body.changes.length + body.deleted.length > 1000) throw new ApiError(400, 'Save up to 1,000 project changes at a time.');
  const ids = new Set();
  for (const p of body.changes) {
    try { validateProject(p, catalog); } catch (error) { throw new ApiError(400, error.message); }
    if (Object.hasOwn(p, '_revision') || Object.values(p.reviews).some(r => Object.hasOwn(r, 'files'))) throw new ApiError(400, 'Only checklist records can be shared. Document uploading is not supported.');
    if (new TextEncoder().encode(JSON.stringify(p)).length > MAX_PROJECT) throw new ApiError(413, 'A shared project must be smaller than 500 KB. Shorten its notes before saving.');
    if (ids.has(p.id)) throw new ApiError(400, 'Duplicate project in save request.');
    ids.add(p.id);
  }
  for (const id of body.deleted) { if (!validId(id) || ids.has(id)) throw new ApiError(400, 'Invalid or duplicate deleted project.'); ids.add(id); }
  for (const id of ids) if (!Object.hasOwn(body.expected, id) || (body.expected[id] !== null && !uuid(body.expected[id]))) throw new ApiError(400, 'Missing or invalid project revision.');
  return [...ids];
}
function unpack(rows) { return rows.map(row => ({ ...JSON.parse(row.data), _revision: row.revision })); }
async function save(db, body) {
  const ids = validateWrite(body);
  const hash = await digest(JSON.stringify(body));
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await db.batch([
      db.prepare('SELECT version FROM crls_meta WHERE id = 1'),
      db.prepare('SELECT id, revision FROM crls_projects WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)),
      db.prepare('SELECT digest, result FROM crls_requests WHERE id = ?').bind(body.requestId),
      db.prepare('SELECT COUNT(*) AS count FROM crls_projects')
    ]);
    const replay = snapshot[2].results[0];
    if (replay) { if (replay.digest !== hash) throw new ApiError(400, 'A save request ID cannot be reused for different data.'); return JSON.parse(replay.result); }
    const version = snapshot[0].results[0]?.version;
    if (!Number.isInteger(version)) throw new ApiError(503, 'Database schema is not initialized.');
    const revisions = new Map(snapshot[1].results.map(r => [r.id, r.revision]));
    for (const id of ids) if ((revisions.get(id) || null) !== body.expected[id]) throw new ApiError(409, 'Project changed. Refresh before saving.');
    const newCount = snapshot[3].results[0].count + body.changes.filter(p => !revisions.has(p.id)).length - body.deleted.filter(id => revisions.has(id)).length;
    if (newCount > 1000) throw new ApiError(400, 'This workspace supports up to 1,000 projects.');
    const rows = body.changes.map(project => ({ project, revision: crypto.randomUUID() }));
    const result = { projects: rows.map(row => ({ ...row.project, _revision: row.revision })) };
    try {
      await db.batch([
        // A failed compare-and-swap violates NOT NULL, rolling back the batch.
        db.prepare('UPDATE crls_meta SET version = CASE WHEN version = ? THEN version + 1 ELSE NULL END WHERE id = 1').bind(version),
        db.prepare(`INSERT INTO crls_projects(id, data, revision)
          SELECT json_extract(value, '$.project.id'), json_extract(value, '$.project'), json_extract(value, '$.revision')
          FROM json_each(?) WHERE true
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, revision = excluded.revision`).bind(JSON.stringify(rows)),
        db.prepare('DELETE FROM crls_projects WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(body.deleted)),
        db.prepare('INSERT INTO crls_requests(id, digest, result, created_at) VALUES (?, ?, ?, ?)').bind(body.requestId, hash, JSON.stringify(result), Date.now()),
        db.prepare('DELETE FROM crls_requests WHERE id NOT IN (SELECT id FROM crls_requests ORDER BY created_at DESC, rowid DESC LIMIT 20)')
      ]);
      return result;
    } catch (error) {
      if (String(error.message).includes('crls_meta.version') || String(error.message).includes('crls_requests.id')) continue;
      throw error;
    }
  }
  throw new ApiError(409, 'Workspace is being updated. Refresh and retry.');
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
    if (origin && !allowed.includes(origin)) return new Response(JSON.stringify({ error: 'Website address is not allowed.' }), { status: 403, headers });
    if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      if (!await authorized(request, env.WORKSPACE_KEY)) throw new ApiError(401, 'Workspace access denied.');
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === '/api/version') {
        const row = await env.DB.prepare('SELECT version FROM crls_meta WHERE id = 1').first();
        if (!row) throw new ApiError(503, 'Database schema is not initialized.');
        return reply(row);
      }
      if (request.method === 'GET' && path === '/api/workspace') {
        const data = await env.DB.batch([env.DB.prepare('SELECT version FROM crls_meta WHERE id = 1'), env.DB.prepare('SELECT data, revision FROM crls_projects ORDER BY id')]);
        if (!data[0].results[0]) throw new ApiError(503, 'Database schema is not initialized.');
        return reply({ name: env.WORKSPACE_NAME || 'CRLS shared workspace', version: data[0].results[0].version, projects: unpack(data[1].results) });
      }
      if (request.method === 'POST' && path === '/api/workspace') return reply(await save(env.DB, await readBody(request)));
      return reply({ error: 'Endpoint not found.' }, 404);
    } catch (error) { return reply({ error: error instanceof ApiError ? error.message : 'Shared storage is unavailable. Check deployment, database setup, or plan limits.' }, error.status || 503); }
  }
};
