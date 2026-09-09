import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, calculateFees, progress, projectStatus, parseBackup, validateProject, defaultFees } from '../lib/model.js';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
// Historical assessment fixtures retain the original workbook calculation.
const project = (type = 'subdivision', scheme = 'pd957') => ({ ...createProject({ name: 'Test project', type, scheme }, 'test-project'), fees: defaultFees() });
const review = (status = 'verified', remarks = '') => ({ status, remarks, receivedDate: '2026-09-08', reviewedBy: 'Test processor', updatedAt: new Date().toISOString() });
const backup = projects => JSON.stringify({ format: 'crls-workspace', version: 1, projects });

test('source templates contain distinct document checklists and traceable fee rates', () => {
  assert.equal(catalog.subdivision.requirements.length, 57);
  assert.equal(catalog.condominium.requirements.length, 62);
  for (const [type, c] of Object.entries(catalog)) {
    assert.equal(new Set(c.requirements.map(r => r.id)).size, c.requirements.length);
    assert.equal(c.requirements[0].id, `${type}-B10`);
    assert.ok(c.requirements.every(r => r.source.includes('!B') && r.category && r.title.length > 3));
    assert.ok(c.requirements.find(r => r.title.startsWith('LGU approved plans')).details.some(d => d.text === 'Site Development Plan'));
    assert.ok(Object.values(c.rates).every(r => r.source.startsWith('Fee!') && Number.isFinite(r.value)));
  }
  assert.equal(catalog.subdivision.rates.pd957Processing.value, 216);
  assert.equal(catalog.condominium.rates.pd957Processing.value, 17.3);
  assert.equal(catalog.condominium.rates.commercialProcessing.value, 36);
  assert.ok(catalog.condominium.requirements.some(r => r.title.startsWith('Master Deed')));
  assert.ok(!catalog.subdivision.requirements.some(r => r.title.startsWith('Master Deed')));
});

test('PD957 subdivision includes only its category and explicitly selected quantities', () => {
  const p = project();
  Object.assign(p.fees, { lots: 10, housingArea: 100, inspectionLots: 2, provisionalForms: 1 });
  const result = calculateFees(p, catalog);
  assert.equal(result.total, 10128); // 2880 + 2160 + 1440 + 432 + 3000 + 216
  assert.equal(result.lines[0].source, 'Fee!L3');
  assert.equal(result.balance, 10128);
  assert.equal(result.lines.filter(l => l.label === 'Certificate of Registration').length, 1);
});

test('condominium matches supplied residential example and includes commercial area omitted by workbook total', () => {
  const p = project('condominium');
  Object.assign(p.fees, { residentialArea: 8452, provisionalForms: 1 });
  assert.equal(calculateFees(p, catalog).total, 149747.6);
  p.fees.commercialArea = 100;
  assert.equal(calculateFees(p, catalog).total, 153347.6);
});

for (const type of ['subdivision', 'condominium']) {
  for (const [scheme, registration, perLot] of [['economic', 720, 72], ['socialized', 420, 24]]) {
    test(`${type} ${scheme} uses only the selected BP220 schedule`, () => {
      const p = project(type, scheme);
      Object.assign(p.fees, { lots: 10, housingArea: 100, commercialArea: 999, residentialArea: 999 });
      const result = calculateFees(p, catalog);
      assert.equal(result.total, registration + 10 * perLot + 300 + 432);
      assert.equal(result.lines[1].rate, perLot);
      assert.equal(result.lines[2].rate, 3);
    });
  }
}

test('zero quantities, omitted registration/forms, rounding, and recorded payments', () => {
  const p = project('condominium');
  Object.assign(p.fees, { includeRegistration: false, crForms: 0, lsForms: 0 });
  assert.equal(calculateFees(p, catalog).total, 0);
  p.fees.residentialArea = 0.01;
  p.fees.commercialArea = 0.01;
  assert.equal(calculateFees(p, catalog).total, 0.53);
  p.fees.paid = 1;
  const result = calculateFees(p, catalog);
  assert.equal(result.balance, 0);
  assert.equal(result.overpayment, 0.47);
});

test('invalid and fractional count inputs cannot produce an assessment', () => {
  for (const value of [-1, NaN, Infinity, '10', 1e11]) {
    const p = project(); p.fees.housingArea = value;
    assert.throws(() => calculateFees(p, catalog), /Invalid fee quantity/);
  }
  const p = project(); p.fees.inspectionLots = 0.5;
  assert.throws(() => calculateFees(p, catalog), /whole number/);
});

test('fresh projects have no inherited reviews, files or source quantities', () => {
  const p = project();
  assert.deepEqual(p.reviews, {});
  assert.equal(p.fees.lots, 0);
  assert.equal(p.fees.saved, false);
  assert.equal(progress(p, catalog).missing, 57);
  assert.equal(projectStatus(p, catalog).label, 'Not started');
  const other = project(); p.fees.lots = 10;
  assert.equal(other.fees.lots, 0);
});

test('review completion excludes N/A, requires verified items, and never labels all-N/A complete', () => {
  const p = project();
  const requirements = catalog.subdivision.requirements;
  for (const r of requirements) p.reviews[r.id] = review('na', 'Not applicable to this application.');
  assert.equal(progress(p, catalog).complete, false);
  p.reviews[requirements[0].id] = review('submitted');
  assert.equal(progress(p, catalog).percent, 0);
  assert.equal(projectStatus(p, catalog).label, 'In review');
  p.reviews[requirements[0].id] = review();
  assert.equal(progress(p, catalog).percent, 100);
  assert.equal(projectStatus(p, catalog).label, 'Review complete');
  p.reviews[requirements[1].id] = review('revision');
  assert.equal(progress(p, catalog).percent, 50);
  assert.equal(projectStatus(p, catalog).label, 'Needs revision');
});

test('backup round-trip preserves project, review, and fee data without attachments', () => {
  const p = project();
  p.reviews['subdivision-B10'] = review();
  p.fees.lots = 52; p.fees.saved = true;
  const restored = parseBackup(backup([p]), catalog);
  assert.deepEqual(restored, [p]);
  assert.equal(Object.hasOwn(restored[0].reviews['subdivision-B10'], 'files'), false);
  assert.equal(calculateFees(restored[0], catalog).total, calculateFees(p, catalog).total);
});

test('backup rejects incompatible schema, duplicates, unknown requirements and invalid dates', () => {
  assert.throws(() => parseBackup('{"projects":[]}', catalog), /version 1/);
  const p = project();
  assert.throws(() => parseBackup(backup([p, p]), catalog), /duplicate/);
  p.reviews['unknown'] = review();
  assert.throws(() => parseBackup(backup([p]), catalog), /Unknown requirement/);
  delete p.reviews.unknown;
  p.receivedDate = '2026-02-31';
  assert.throws(() => validateProject(p, catalog), /Invalid received date/);
});

test('not-applicable reviews require a reason; executable attachments cannot be imported', () => {
  const p = project();
  p.reviews['subdivision-B10'] = review('na');
  assert.throws(() => validateProject(p, catalog), /reason/);
  p.reviews['subdivision-B10'].remarks = 'Not required for this application.';
  p.reviews['subdivision-B10'].files = [{ id: 'file-1', name: 'attack.html', type: 'text/html', size: 0, data: 'data:text/html;base64,' }];
  assert.throws(() => validateProject(p, catalog), /Unsupported attachment/);
});

test('attachment validation accepts base64 padding and rejects corrupt contents and size mismatch', () => {
  for (const size of [1, 2, 3, 4, 5, 1000]) {
    const p = project(); const data = Buffer.alloc(size, 65);
    p.reviews['subdivision-B10'] = review();
    p.reviews['subdivision-B10'].files = [{ id: 'file-1', name: 'test.pdf', type: 'application/pdf', size, data: 'data:application/pdf;base64,' + data.toString('base64') }];
    assert.doesNotThrow(() => validateProject(p, catalog));
    p.reviews['subdivision-B10'].files[0].size++;
    assert.throws(() => validateProject(p, catalog), /size mismatch/);
    p.reviews['subdivision-B10'].files[0].data = 'data:application/pdf;base64,AAAA=AAA';
    assert.throws(() => validateProject(p, catalog), /Invalid attachment contents/);
  }
});

test('prototype keys cannot be used as project types or schemes', () => {
  const p = project(); p.type = '__proto__';
  assert.throws(() => validateProject(p, catalog), /Invalid project type/);
  p.type = 'subdivision'; p.scheme = 'constructor';
  assert.throws(() => validateProject(p, catalog), /Invalid project type/);
});
