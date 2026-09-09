import { SUBDIVISION_CATEGORIES, APPLICATION_TYPES, TLS_UNDERTAKINGS, categoryScheme } from './project-details.js';
export function projectFields(p, esc) {
  const checks = (items, name, selected) => Object.entries(items).map(([key, label]) => `<label class="checkbox-field"><input type="checkbox" name="${name}" value="${key}" ${selected.includes(key) ? 'checked' : ''}><span>${label}</span></label>`).join('');
  const application = p.application === 'Certificate of Registration and License to Sell' ? 'CRLS' : p.application || 'CRLS';
  const applications = Object.hasOwn(APPLICATION_TYPES, application) ? APPLICATION_TYPES : { ...APPLICATION_TYPES, [application]: application + ' (previous entry)' };
  return `<fieldset id="subdivision-fields" class="project-fieldset" ${p.type !== 'subdivision' ? 'hidden disabled' : ''}><legend>Project categories</legend><p class="small muted">Select all that apply.</p><div class="form-grid category-options">${checks(SUBDIVISION_CATEGORIES, 'categories', p.categories || (p.scheme !== 'pd957' ? [p.scheme] : []))}</div>${p.id && !p.categories && p.scheme === 'pd957' ? '<p class="small muted">Previously recorded as Open Market / Medium Cost. Select the applicable categories above.</p>' : ''}<h3>Number of lots</h3><div class="form-grid">${[['houseAndLot', 'House and Lot'], ['lotOnly', 'Lot Only']].map(([key, label]) => `<label class="field"><span>${label}</span><input type="number" name="${key}" min="0" max="10000000000" step="1" required value="${p.lotCounts?.[key] ?? 0}"></label>`).join('')}</div><p class="lot-total">Total lots: <output id="total-lots" aria-live="polite">0</output></p></fieldset><label class="field"><span>Application type</span><select name="application">${Object.entries(applications).map(([key, label]) => `<option value="${esc(key)}" ${key === application ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label><fieldset id="tls-fields" class="project-fieldset" ${application !== 'TLS' ? 'hidden disabled' : ''}><legend>TLS undertakings</legend><p class="small muted">Select all undertakings that apply.</p>${checks(TLS_UNDERTAKINGS, 'tlsUndertakings', p.tlsUndertakings || [])}</fieldset>`;
}
export function bindProjectFields(form, p, schemes) {
  const field = name => form.elements.namedItem(name);
  const update = () => {
    const subdivision = field('type').value === 'subdivision';
    const sub = form.querySelector('#subdivision-fields'); sub.hidden = sub.disabled = !subdivision;
    const tls = form.querySelector('#tls-fields'); tls.hidden = tls.disabled = field('application').value !== 'TLS';
    const total = Number(field('houseAndLot').value) + Number(field('lotOnly').value);
    form.querySelector('#total-lots').textContent = Number.isFinite(total) ? total.toLocaleString('en-PH') : '0';
    const selected = [...form.querySelectorAll('[name="categories"]:checked')].map(el => el.value);
    const allowed = subdivision ? [...new Set(selected.map(categoryScheme))] : Object.keys(schemes);
    const previous = field('scheme').value;
    field('scheme').replaceChildren(...allowed.map(key => new Option(schemes[key], key)));
    if (allowed.includes(previous)) field('scheme').value = previous;
    else if (allowed.includes(p.scheme)) field('scheme').value = p.scheme;
  };
  form.addEventListener('change', update);
  for (const name of ['houseAndLot', 'lotOnly']) field(name).addEventListener('input', update);
  update();
}
export function readProjectFields(form, type) {
  const data = new FormData(form);
  return {
    ...(type === 'subdivision' ? { categories: data.getAll('categories'), lotCounts: { houseAndLot: Number(data.get('houseAndLot')), lotOnly: Number(data.get('lotOnly')) } } : {}),
    tlsUndertakings: data.get('application') === 'TLS' ? data.getAll('tlsUndertakings') : []
  };
}
