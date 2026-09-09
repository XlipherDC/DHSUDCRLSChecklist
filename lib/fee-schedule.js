import { SUBDIVISION_CATEGORIES } from './project-details.js';

// Rates supplied by the workspace owner on 2026-09-09. Old saved assessments
// remain on their original calculation until the processor saves a new draft.
export const FEE_VERSION = 2;
const SUBDIVISION_RATES = {
  openMarket: { registration: 2880, lot: 216, housing: 14.4 },
  mediumCost: { registration: 2880, lot: 216, housing: 14.4 },
  pd957: { registration: 2880, lot: 216, housing: 14.4 },
  economic: { registration: 720, lot: 72, housing: 0 },
  socialized: { registration: 420, lot: 24, housing: 0 }
};
const CONDOMINIUM_RATES = {
  pd957: { registration: 2880, residential: 17.3, commercial: 36 },
  bp220: { registration: 720, residential: 7.2, commercial: 10.65 }
};
export const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
export function feeClassifications(project) {
  if (project.type === 'subdivision') {
    const keys = project.categories || [project.scheme];
    if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length) throw new Error('Select valid project classifications.');
    return keys.map(key => {
      if (!Object.hasOwn(SUBDIVISION_RATES, key)) throw new Error('Unknown subdivision classification.');
      return { key, label: SUBDIVISION_CATEGORIES[key] || 'PD957 - Open Market / Medium Cost', ...SUBDIVISION_RATES[key] };
    });
  }
  if (project.type !== 'condominium' || !['pd957', 'economic', 'socialized'].includes(project.scheme)) throw new Error('Select a valid condominium classification.');
  const key = project.scheme === 'pd957' ? 'pd957' : 'bp220';
  return [{ key, label: key === 'pd957' ? 'PD957' : 'BP220', ...CONDOMINIUM_RATES[key] }];
}
export function registrationOptions(project) {
  const unique = new Map();
  for (const c of feeClassifications(project)) {
    if (unique.has(c.registration)) unique.get(c.registration).labels.push(c.label);
    else unique.set(c.registration, { key: c.key, rate: c.registration, labels: [c.label] });
  }
  return [...unique.values()];
}
export function prepareAssessment(project) {
  const old = project.fees || {};
  const classes = feeClassifications(project);
  const options = registrationOptions(project);
  const single = classes.length === 1;
  const licenses = {};
  for (const c of classes) {
    const previous = old.version === FEE_VERSION ? old.licenses?.[c.key] : null;
    licenses[c.key] = previous ? { ...previous } : {
      lots: single ? old.lots || 0 : 0,
      hasHousing: !!c.housing && (single ? !!old.housingArea || (project.lotCounts?.houseAndLot || 0) > 0 : false),
      housingArea: single && c.housing ? old.housingArea || 0 : 0,
      residentialArea: single ? old.residentialArea || 0 : 0,
      commercialArea: single ? old.commercialArea || 0 : 0
    };
  }
  if (project.lotCounts?.houseAndLot === 0) for (const row of Object.values(licenses)) { row.hasHousing = false; row.housingArea = 0; }
  const crCategory = old.version === FEE_VERSION && classes.some(c => c.key === old.crCategory) ? old.crCategory : options.length === 1 ? options[0].key : '';
  return {
    // Compatibility fields allow older Worker deployments to store the record.
    // Version 2 calculations never read these obsolete quantities or charges.
    lots: 0, housingArea: 0, residentialArea: 0, commercialArea: 0,
    inspectionLots: 0, crForms: 0, lsForms: 0, provisionalForms: 0,
    ...old, version: FEE_VERSION, licenses, crCategory,
    inspectionHectares: old.version === FEE_VERSION ? old.inspectionHectares : Number(project.projectArea || 0) / 10000,
    includeRegistration: old.includeRegistration ?? true,
    paid: old.paid || 0, preparedBy: old.preparedBy || '', receipt: old.receipt || '', notes: old.notes || '',
    saved: old.version === FEE_VERSION && old.saved === true
  };
}
function quantity(value, label, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e10 || (integer && !Number.isSafeInteger(value))) throw new Error(`${label} must be a non-negative ${integer ? 'whole number' : 'number'}.`);
}
export function validateAssessmentInputs(fees) {
  if (!fees || fees.version !== FEE_VERSION) throw new Error('Unknown fee schedule version.');
  quantity(fees.inspectionHectares, 'Inspection area');
  quantity(fees.paid, 'Amount paid');
  if (typeof fees.includeRegistration !== 'boolean' || typeof fees.crCategory !== 'string') throw new Error('Invalid CR selection.');
  if (!fees.licenses || typeof fees.licenses !== 'object' || Array.isArray(fees.licenses) || Object.keys(fees.licenses).length > 4) throw new Error('Invalid LS classifications.');
  for (const row of Object.values(fees.licenses)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid LS quantities.');
    quantity(row.lots, 'Saleable lots', true);
    for (const key of ['housingArea', 'residentialArea', 'commercialArea']) quantity(row[key], key);
    if (typeof row.hasHousing !== 'boolean') throw new Error('Invalid housing component selection.');
  }
}
export function validateAssessment(project, requireComplete = false) {
  const f = project.fees;
  validateAssessmentInputs(f);
  const classes = feeClassifications(project);
  const keys = classes.map(c => c.key);
  if (Object.keys(f.licenses).length !== keys.length || keys.some(key => !Object.hasOwn(f.licenses, key))) throw new Error('LS inputs must match the project classifications.');
  if (f.crCategory && !keys.includes(f.crCategory)) throw new Error('Select an applicable CR fee.');
  if (requireComplete && f.includeRegistration && !f.crCategory) throw new Error('Select the single CR fee to apply to this project.');
  for (const c of classes) {
    const row = f.licenses[c.key];
    if (row.hasHousing && (!c.housing || project.type !== 'subdivision')) throw new Error('The housing surcharge applies only to PD957 subdivisions.');
    if (!row.hasHousing && row.housingArea !== 0) throw new Error('Select the housing component for the entered housing floor area.');
    if (row.hasHousing && project.lotCounts?.houseAndLot === 0) throw new Error('The project has no House and Lot lots. Update project details before adding a housing component.');
    if (requireComplete && row.hasHousing && row.housingArea <= 0) throw new Error('Enter the floor area of the House and Lot housing component.');
  }
}
export function calculateAssessment(project) {
  validateAssessment(project, true);
  const f = project.fees, classes = feeClassifications(project), lines = [];
  const add = (label, quantity, unit, rate, kind, classification) => lines.push({ label, quantity, unit, rate, kind, classification, amount: roundMoney(quantity * rate) });
  if (f.includeRegistration) {
    const c = classes.find(c => c.key === f.crCategory);
    add(`Certificate of Registration - ${c.label}`, 1, 'CR', c.registration, 'registration');
  }
  for (const c of classes) {
    const row = f.licenses[c.key];
    if (project.type === 'subdivision') {
      add(`LS - ${c.label} - Saleable lots`, row.lots, 'lot', c.lot, 'license', c.key);
      if (c.housing && row.hasHousing) add(`LS - ${c.label} - Housing floor area`, row.housingArea, 'm²', c.housing, 'housing', c.key);
    } else {
      add(`LS - ${c.label} - Residential saleable area`, row.residentialArea, 'm²', c.residential, 'license', c.key);
      add(`LS - ${c.label} - Commercial saleable area`, row.commercialArea, 'm²', c.commercial, 'license', c.key);
    }
  }
  const inspectionHectares = Math.ceil(f.inspectionHectares);
  add('Inspection - rounded-up project area', inspectionHectares, 'ha', 1500, 'inspection');
  const total = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  return { lines, total, balance: roundMoney(Math.max(total - f.paid, 0)), overpayment: roundMoney(Math.max(f.paid - total, 0)), licenseCount: classes.length, crCount: f.includeRegistration ? 1 : 0, inspectionHectares };
}
