import { validateProjectDetails } from './project-details.js';
export const STATUSES = { missing: 'Not submitted', submitted: 'For review', verified: 'Verified', revision: 'Needs revision', na: 'Not applicable' };
export const SCHEMES = { pd957: 'PD957 · Open market / medium cost', economic: 'BP220 · Economic housing', socialized: 'BP220 · Socialized housing' };
// Retained only to validate older records/backups without discarding their data.
const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 150 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export function defaultFees() {
  return { lots: 0, housingArea: 0, residentialArea: 0, commercialArea: 0, inspectionLots: 0, crForms: 1, lsForms: 1, provisionalForms: 0, includeRegistration: true, saved: false, preparedBy: '', notes: '', receipt: '', paid: 0 };
}
export function createProject(values, id = crypto.randomUUID()) {
  const time = new Date().toISOString();
  return { id, name: values.name.trim(), type: values.type, scheme: values.scheme, reference: values.reference?.trim() || '', location: values.location?.trim() || '', owner: values.owner?.trim() || '', developer: values.developer?.trim() || '', address: values.address?.trim() || '', application: values.application || 'CRLS', ...(values.categories !== undefined ? { categories: [...values.categories] } : {}), ...(values.lotCounts !== undefined ? { lotCounts: { ...values.lotCounts } } : {}), tlsUndertakings: [...(values.tlsUndertakings || [])], processor: values.processor?.trim() || '', receivedDate: values.receivedDate || '', projectArea: Number(values.projectArea || 0), notes: values.notes?.trim() || '', reviews: {}, fees: defaultFees(), createdAt: time, updatedAt: time };
}
export function progress(project, catalog) {
  const counts = { missing: 0, submitted: 0, verified: 0, revision: 0, na: 0 };
  for (const req of catalog[project.type].requirements) counts[project.reviews[req.id]?.status || 'missing']++;
  const total = catalog[project.type].requirements.length;
  const applicable = total - counts.na;
  return { ...counts, total, applicable, percent: applicable ? Math.round(counts.verified / applicable * 100) : 0, complete: applicable > 0 && counts.verified === applicable };
}
export function projectStatus(project, catalog) {
  const p = progress(project, catalog);
  return p.complete ? { label: 'Review complete', tone: 'verified' } : p.revision ? { label: 'Needs revision', tone: 'revision' } : p.submitted || p.verified ? { label: 'In review', tone: 'submitted' } : { label: 'Not started', tone: 'missing' };
}
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
export function validateFeeInputs(fees) {
  for (const key of ['lots', 'housingArea', 'residentialArea', 'commercialArea', 'inspectionLots', 'crForms', 'lsForms', 'provisionalForms', 'paid']) {
    if (typeof fees[key] !== 'number' || !Number.isFinite(fees[key]) || fees[key] < 0 || fees[key] > 1e10) throw new Error(`Invalid fee quantity: ${key}`);
  }
  for (const key of ['lots', 'inspectionLots', 'crForms', 'lsForms', 'provisionalForms']) if (!Number.isInteger(fees[key])) throw new Error(`${key} must be a whole number.`);
  if (typeof fees.includeRegistration !== 'boolean') throw new Error('Invalid registration selection.');
}
export function calculateFees(project, catalog) {
  if (!Object.hasOwn(SCHEMES, project.scheme) || !Object.hasOwn(catalog, project.type)) throw new Error('Select a valid project category.');
  const f = project.fees;
  validateFeeInputs(f);
  const rates = catalog[project.type].rates;
  const lines = [];
  function add(label, key, quantity, unit) {
    const rate = rates[key];
    lines.push({ label, quantity, unit, rate: rate.value, source: rate.source, amount: round(rate.value * quantity) });
  }
  if (f.includeRegistration) add('Certificate of Registration', project.scheme + 'Registration', 1, 'project');
  if (project.scheme === 'pd957' && project.type === 'condominium') {
    add('LS · Residential saleable area', 'pd957Processing', f.residentialArea, 'm²');
    add('LS · Commercial saleable area', 'commercialProcessing', f.commercialArea, 'm²');
  } else {
    add('LS · Lot processing', project.scheme + 'Processing', f.lots, 'lot');
    add('LS · Housing area', project.scheme === 'pd957' ? 'pd957Housing' : 'bp220Housing', f.housingArea, 'm²');
  }
  add('Certificate of Registration form', 'crForm', f.crForms, 'form');
  add('License to Sell form', 'lsForm', f.lsForms, 'form');
  add('Inspection', 'inspection', f.inspectionLots, 'lot');
  add('SH provisional compliance certificate', 'provisional', f.provisionalForms, 'form');
  const total = round(lines.reduce((sum, line) => sum + line.amount, 0));
  return { lines, total, balance: round(Math.max(total - f.paid, 0)), overpayment: round(Math.max(f.paid - total, 0)) };
}
function string(value, name, max = 10000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${name}.`);
}
function dateValue(value, name, optional = false) {
  if (optional && value === '') return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error(`Invalid ${name}.`);
}
export function validateProject(p, catalog) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid project record.');
  string(p.id, 'project ID', 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(p.id)) throw new Error('Invalid project ID.');
  string(p.name, 'project name', 200);
  if (!p.name.trim()) throw new Error('Project name is required.');
  if (!Object.hasOwn(catalog, p.type) || !Object.hasOwn(SCHEMES, p.scheme)) throw new Error('Invalid project type or category.');
  for (const key of ['reference', 'location', 'owner', 'developer', 'address', 'application', 'processor', 'receivedDate', 'notes', 'createdAt', 'updatedAt']) string(p[key], key);
  validateProjectDetails(p);
  dateValue(p.receivedDate, 'received date', true);
  dateValue(p.createdAt, 'creation date');
  dateValue(p.updatedAt, 'update date');
  if (!Number.isFinite(p.projectArea) || p.projectArea < 0) throw new Error('Invalid project area.');
  if (!p.reviews || typeof p.reviews !== 'object' || Array.isArray(p.reviews)) throw new Error('Invalid reviews.');
  const ids = new Set(catalog[p.type].requirements.map(r => r.id));
  for (const [id, review] of Object.entries(p.reviews)) {
    if (!ids.has(id) || !review || !Object.hasOwn(STATUSES, review.status)) throw new Error('Unknown requirement or review status.');
    for (const key of ['remarks', 'receivedDate', 'reviewedBy', 'updatedAt']) string(review[key], key);
    dateValue(review.receivedDate, 'document received date', true);
    dateValue(review.updatedAt, 'review date');
    if (review.status === 'na' && !review.remarks.trim()) throw new Error('Not applicable requirements need a reason.');
    if (review.files !== undefined && (!Array.isArray(review.files) || review.files.length > 100)) throw new Error('Invalid legacy attachments.');
    const fileIds = new Set();
    for (const file of review.files || []) {
      string(file.id, 'attachment ID', 100);
      if (!/^[a-zA-Z0-9_-]+$/.test(file.id) || fileIds.has(file.id)) throw new Error('Invalid or duplicate attachment ID.');
      fileIds.add(file.id);
      string(file.name, 'attachment name', 250);
      if (!FILE_TYPES.includes(file.type) || !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) throw new Error('Unsupported attachment or file too large.');
      if (typeof file.data !== 'string' || !file.data.startsWith(`data:${file.type};base64,`)) throw new Error('Invalid attachment encoding.');
      const payload = file.data.split(',')[1];
      if (payload.length % 4 || /[^A-Za-z0-9+/=]/.test(payload) || /=/.test(payload.slice(0, -2)) || (payload.endsWith('=') && !/^[A-Za-z0-9+/]{2}(?:[A-Za-z0-9+/]=|==)$/.test(payload.slice(-4)))) throw new Error('Invalid attachment contents.');
      const size = payload.length * 3 / 4 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
      if (size !== file.size) throw new Error('Attachment size mismatch.');
    }
  }
  if (!p.fees) throw new Error('Missing fee inputs.');
  validateFeeInputs(p.fees);
  for (const key of ['notes', 'preparedBy', 'receipt']) string(p.fees[key], key);
  if (typeof p.fees.saved !== 'boolean') throw new Error('Invalid assessment status.');
  return p;
}
export function parseBackup(text, catalog) {
  const data = JSON.parse(text);
  if (data?.format !== 'crls-workspace' || data.version !== 1 || !Array.isArray(data.projects) || data.projects.length > 1000) throw new Error('Use a version 1 CRLS Workspace backup.');
  const ids = new Set();
  for (const project of data.projects) {
    validateProject(project, catalog);
    if (ids.has(project.id)) throw new Error('Backup contains duplicate project IDs.');
    ids.add(project.id);
  }
  return data.projects;
}
