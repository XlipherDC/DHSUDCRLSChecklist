export const SUBDIVISION_CATEGORIES = {
  openMarket: 'PD957 - Open Market', mediumCost: 'PD957 - Medium Cost',
  economic: 'BP220 - Economic', socialized: 'BP220 - Socialized'
};
export const APPLICATION_TYPES = { CRLS: 'CRLS', TLS: 'TLS', CLS: 'CLS' };
export const TLS_UNDERTAKINGS = {
  ecc: 'Environmental Compliance Certificate', buildingPermit: 'Building Permit',
  verifiedSurveyReturns: 'Verified Survey Returns'
};
export const categoryScheme = category => ['openMarket', 'mediumCost', 'pd957'].includes(category) ? 'pd957' : category;
export function categoryLabels(p, schemes) {
  if (p.type === 'condominium') return p.scheme === 'pd957' ? 'PD957' : 'BP220';
  return p.type === 'subdivision' && p.categories ? p.categories.map(c => SUBDIVISION_CATEGORIES[c]).join(', ') : schemes[p.scheme];
}
export function projectDetailRows(p) {
  const rows = [];
  if (p.application === 'TLS') rows.push(['TLS undertakings', p.tlsUndertakings?.map(key => TLS_UNDERTAKINGS[key]).join(', ') || 'Not entered']);
  if (p.type === 'subdivision') {
    rows.push(['Total lots', p.lotCounts ? String(p.lotCounts.houseAndLot + p.lotCounts.lotOnly) : 'Not entered'],
      ['House and Lot', p.lotCounts ? String(p.lotCounts.houseAndLot) : 'Not entered'],
      ['Lot Only', p.lotCounts ? String(p.lotCounts.lotOnly) : 'Not entered']);
  }
  return rows;
}
export function validateProjectDetails(p) {
  if (p.categories !== undefined) {
    if (p.type !== 'subdivision' || !Array.isArray(p.categories) || !p.categories.length ||
        p.categories.some(c => typeof c !== 'string' || !Object.hasOwn(SUBDIVISION_CATEGORIES, c)) ||
        new Set(p.categories).size !== p.categories.length) throw new Error('Select at least one valid subdivision category.');
    if (!p.categories.some(c => categoryScheme(c) === p.scheme)) throw new Error('The project classification must match a selected category.');
  }
  if (p.tlsUndertakings !== undefined) {
    if (!Array.isArray(p.tlsUndertakings) || p.tlsUndertakings.some(k => typeof k !== 'string' || !Object.hasOwn(TLS_UNDERTAKINGS, k)) ||
        new Set(p.tlsUndertakings).size !== p.tlsUndertakings.length) throw new Error('Select valid TLS undertakings.');
    if (p.application === 'TLS' && !p.tlsUndertakings.length) throw new Error('Select at least one TLS undertaking.');
    if (p.application !== 'TLS' && p.tlsUndertakings.length) throw new Error('Undertakings apply only to TLS applications.');
  }
  if (p.lotCounts !== undefined) {
    if (p.type !== 'subdivision' || !p.lotCounts || Array.isArray(p.lotCounts) ||
        ['houseAndLot', 'lotOnly'].some(k => !Number.isSafeInteger(p.lotCounts[k]) || p.lotCounts[k] < 0 || p.lotCounts[k] > 1e10)) throw new Error('Lot counts must be non-negative whole numbers.');
  }
}
