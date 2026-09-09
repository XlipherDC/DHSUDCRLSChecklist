import {
  feeClassifications as previousClassifications,
  calculateAssessment as calculateV2,
  validateAssessmentInputs as validateInputsV2,
  validateAssessment as validateV2,
  roundMoney
} from './fee-schedule-v2.js';

// Revised schedule: separate Economic and Socialized CRs, BP220 housing,
// and CR/LS forms. Version 2 remains available for historical saved records.
export const FEE_VERSION = 3;
export { roundMoney };
export function feeClassifications(project) {
  return previousClassifications(project).map(c => ({
    ...c,
    ...(project.type === 'subdivision' && ['economic', 'socialized'].includes(c.key) ? { housing: 3 } : {})
  }));
}
export function registrationGroups(project) {
  const groups = new Map();
  for (const c of feeClassifications(project)) {
    const key = ['openMarket', 'mediumCost', 'pd957'].includes(c.key) ? 'pd957' : c.key;
    if (groups.has(key)) groups.get(key).classifications.push(c.key);
    else groups.set(key, { key, label: key === 'pd957' ? 'PD957' : c.label, rate: c.registration, classifications: [c.key] });
  }
  return [...groups.values()];
}
export function prepareAssessment(project) {
  const old = project.fees || {}, classes = feeClassifications(project), groups = registrationGroups(project);
  const current = old.version === FEE_VERSION, structured = current || old.version === 2;
  const licenses = {};
  for (const c of classes) {
    const previous = structured ? old.licenses?.[c.key] : undefined;
    licenses[c.key] = previous ? { ...previous } : {
      lots: classes.length === 1 ? old.lots || 0 : 0,
      hasHousing: !!c.housing && classes.length === 1 && (!!old.housingArea || (project.lotCounts?.houseAndLot || 0) > 0),
      housingArea: classes.length === 1 && c.housing ? old.housingArea || 0 : 0,
      residentialArea: classes.length === 1 ? old.residentialArea || 0 : 0,
      commercialArea: classes.length === 1 ? old.commercialArea || 0 : 0
    };
    // Version 2 did not expose a BP220 housing input. A known single-class
    // housing project now needs its floor area entered before saving.
    if (!current && project.type === 'subdivision' && ['economic', 'socialized'].includes(c.key) && classes.length === 1 && project.lotCounts?.houseAndLot > 0) licenses[c.key].hasHousing = true;
    if (project.lotCounts?.houseAndLot === 0) { licenses[c.key].hasHousing = false; licenses[c.key].housingArea = 0; }
  }
  const registrations = Object.fromEntries(groups.map(g => [g.key, current && Object.hasOwn(old.registrations || {}, g.key) ? old.registrations[g.key] : old.includeRegistration ?? true]));
  const crCount = Object.values(registrations).filter(Boolean).length;
  const oldCRCount = Object.values(old.registrations || {}).filter(Boolean).length;
  const crForms = current && old.crForms !== oldCRCount ? old.crForms : crCount;
  const lsForms = current && old.lsForms !== Object.keys(old.licenses || {}).length ? old.lsForms : classes.length;
  return {
    lots: 0, housingArea: 0, residentialArea: 0, commercialArea: 0, inspectionLots: 0, provisionalForms: 0,
    ...old, version: FEE_VERSION, licenses, registrations, crForms, lsForms,
    includeRegistration: crCount > 0,
    inspectionHectares: structured ? old.inspectionHectares : Number(project.projectArea || 0) / 10000,
    paid: old.paid || 0, preparedBy: old.preparedBy || '', receipt: old.receipt || '', notes: old.notes || '',
    saved: current && old.saved === true
  };
}
function quantity(value, label, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e10 || (integer && !Number.isSafeInteger(value))) throw new Error(`${label} must be a non-negative ${integer ? 'whole number' : 'number'}.`);
}
export function validateAssessmentInputs(fees) {
  if (fees?.version === 2) return validateInputsV2(fees);
  if (!fees || fees.version !== FEE_VERSION) throw new Error('Unknown fee schedule version.');
  quantity(fees.inspectionHectares, 'Inspection area'); quantity(fees.paid, 'Amount paid');
  quantity(fees.crForms, 'CR form count', true); quantity(fees.lsForms, 'LS form count', true);
  if (!fees.registrations || typeof fees.registrations !== 'object' || Array.isArray(fees.registrations) || Object.keys(fees.registrations).length > 3 || Object.values(fees.registrations).some(value => typeof value !== 'boolean')) throw new Error('Invalid CR selections.');
  if (fees.includeRegistration !== Object.values(fees.registrations).some(Boolean)) throw new Error('Invalid CR inclusion flag.');
  if (!fees.licenses || typeof fees.licenses !== 'object' || Array.isArray(fees.licenses) || Object.keys(fees.licenses).length > 4) throw new Error('Invalid LS classifications.');
  for (const row of Object.values(fees.licenses)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid LS quantities.');
    quantity(row.lots, 'Saleable lots', true);
    for (const key of ['housingArea', 'residentialArea', 'commercialArea']) quantity(row[key], key);
    if (typeof row.hasHousing !== 'boolean') throw new Error('Invalid housing component selection.');
  }
}
export function validateAssessment(project, requireComplete = false) {
  if (project.fees?.version === 2) return validateV2(project, requireComplete);
  const f = project.fees; validateAssessmentInputs(f);
  const classes = feeClassifications(project), groups = registrationGroups(project);
  if (Object.keys(f.licenses).length !== classes.length || classes.some(c => !Object.hasOwn(f.licenses, c.key))) throw new Error('LS inputs must match the project classifications.');
  if (Object.keys(f.registrations).length !== groups.length || groups.some(g => !Object.hasOwn(f.registrations, g.key))) throw new Error('CR selections must match the project classifications.');
  for (const c of classes) {
    const row = f.licenses[c.key];
    if (row.hasHousing && (!c.housing || project.type !== 'subdivision')) throw new Error('The housing surcharge applies only to subdivision housing components.');
    if (!row.hasHousing && row.housingArea !== 0) throw new Error('Select the housing component for the entered housing floor area.');
    if (row.hasHousing && project.lotCounts?.houseAndLot === 0) throw new Error('The project has no House and Lot lots. Update project details before adding a housing component.');
    if (requireComplete && row.hasHousing && row.housingArea <= 0) throw new Error('Enter the floor area of the House and Lot housing component.');
  }
}
export function calculateAssessment(project) {
  if (project.fees?.version === 2) return calculateV2(project);
  validateAssessment(project, true);
  const f = project.fees, classes = feeClassifications(project), lines = [];
  const add = (label, quantity, unit, rate, kind, classification) => lines.push({ label, quantity, unit, rate, kind, classification, amount: roundMoney(quantity * rate) });
  const selected = registrationGroups(project).filter(g => f.registrations[g.key]);
  for (const group of selected) add(`Certificate of Registration - ${group.label}`, 1, 'CR', group.rate, 'registration', group.key);
  for (const c of classes) {
    const row = f.licenses[c.key];
    if (project.type === 'subdivision') {
      add(`LS - ${c.label} - Saleable lots`, row.lots, 'lot', c.lot, 'license', c.key);
      if (row.hasHousing) add(`LS - ${c.label} - Housing floor area`, row.housingArea, 'm²', c.housing, 'housing', c.key);
    } else {
      add(`LS - ${c.label} - Residential saleable area`, row.residentialArea, 'm²', c.residential, 'license', c.key);
      add(`LS - ${c.label} - Commercial saleable area`, row.commercialArea, 'm²', c.commercial, 'license', c.key);
    }
  }
  const inspectionHectares = Math.ceil(f.inspectionHectares);
  add('Inspection - rounded-up project area', inspectionHectares, 'ha', 1500, 'inspection');
  add('Certificate of Registration form', f.crForms, 'form', 216, 'crForm');
  add('License to Sell form', f.lsForms, 'form', 216, 'lsForm');
  const total = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  return { lines, total, balance: roundMoney(Math.max(total - f.paid, 0)), overpayment: roundMoney(Math.max(f.paid - total, 0)), licenseCount: classes.length, crCount: selected.length, inspectionHectares };
}
