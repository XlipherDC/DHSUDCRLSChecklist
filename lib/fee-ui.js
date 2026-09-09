import { prepareAssessment, feeClassifications, registrationOptions, FEE_VERSION } from './fee-schedule.js';

const hectares = value => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 20 }).format(value);

export function assessmentView(project, { esc, money, number, icon, field, breakdown }) {
  const f = prepareAssessment(project), draft = { ...project, fees: f };
  const classes = feeClassifications(project), registrations = registrationOptions(project);
  const selectedRate = classes.find(c => c.key === f.crCategory)?.registration;
  const qty = (label, name, value, unit, integer = false, extra = '') => `<label class="field"><span>${label}</span><div class="input-unit"><input name="${name}" type="number" min="0" max="10000000000" step="${integer ? '1' : 'any'}" value="${value}" required ${extra}><span>${unit}</span></div></label>`;
  const prior = project.fees.version !== FEE_VERSION;
  const licenseFields = classes.map(c => {
    const row = f.licenses[c.key], prefix = `ls_${c.key}_`;
    return `<fieldset class="project-fieldset license-inputs"><legend>LS - ${esc(c.label)}</legend>${project.type === 'subdivision' ? `${qty('Saleable lots', prefix + 'lots', row.lots, 'lots', true)}<p class="small muted">${money(c.lot)} per saleable lot</p>${c.housing ? `<label class="checkbox-field"><input type="checkbox" name="${prefix}hasHousing" data-housing="${c.key}" ${row.hasHousing ? 'checked' : ''} ${project.lotCounts?.houseAndLot === 0 ? 'disabled' : ''}><span>This classification has a House and Lot component</span></label><div data-housing-area="${c.key}" ${row.hasHousing ? '' : 'hidden'}>${qty('Housing component floor area', prefix + 'housingArea', row.housingArea, 'm²', false, row.hasHousing ? '' : 'disabled')}<p class="small muted">Additional ${money(c.housing)} per m² of housing floor area.</p></div>` : ''}` : `<div class="form-grid">${qty('Residential saleable area', prefix + 'residentialArea', row.residentialArea, 'm²')}${qty('Commercial saleable area', prefix + 'commercialArea', row.commercialArea, 'm²')}</div><p class="small muted">Residential: ${money(c.residential)} / m² · Commercial: ${money(c.commercial)} / m²</p>`}</fieldset>`;
  }).join('');
  return `${prior ? `<div class="notice">${icon('info')}<div><strong>Review the updated assessment</strong><p>${project.fees.saved ? 'Your previously saved assessment remains unchanged until you save this assessment. ' : ''}Inspection now uses hectares rounded up. ${classes.length > 1 ? 'Enter the saleable quantities for each classification; previous combined quantities have not been split automatically.' : 'Check the quantities before saving.'}</p></div></div>` : ''}<form id="fees-form"><div class="fee-layout"><section class="panel fee-inputs"><div class="panel-heading"><div><h2>Assessment inputs</h2><p>One CR per project · ${classes.length} LS classification${classes.length === 1 ? '' : 's'}</p></div>${icon('calc')}</div><div class="form-body"><h3>Certificate of Registration</h3><label class="checkbox-field"><input type="checkbox" name="includeRegistration" ${f.includeRegistration ? 'checked' : ''}><span>Include one CR processing fee</span></label><label class="field"><span>CR fee to apply</span><select name="crCategory" ${f.includeRegistration ? 'required' : 'disabled'}><option value="">Select the applicable CR fee</option>${registrations.map(option => `<option value="${option.key}" ${option.rate === selectedRate ? 'selected' : ''}>${money(option.rate)} - ${esc(option.labels.join(' / '))}</option>`).join('')}</select></label><p class="small muted">Choose one applicable CR fee for the whole project. It is charged once.</p><h3>License to Sell</h3><p class="small muted">Enter separate saleable quantities for each classification.</p>${project.type === 'subdivision' && project.lotCounts ? `<p class="small muted">Project lot total: ${number(project.lotCounts.houseAndLot + project.lotCounts.lotOnly)} (${number(project.lotCounts.houseAndLot)} House and Lot · ${number(project.lotCounts.lotOnly)} Lot Only).</p>` : ''}${licenseFields}<h3>Inspection</h3>${qty('Project area for inspection', 'inspectionHectares', f.inspectionHectares, 'ha')}<p class="small muted" id="inspection-calculation">${hectares(f.inspectionHectares)} ha rounds up to ${number(Math.ceil(f.inspectionHectares))} ha × ${money(1500)}. Charged once for the project.</p><h3>Assessment record</h3><div class="form-grid">${field('Prepared by', 'preparedBy', f.preparedBy || project.processor)}${field('O.R. / payment reference', 'receipt', f.receipt)}${qty('Amount already paid', 'paid', f.paid, 'PHP')}</div><label class="field"><span>Assessment notes</span><textarea name="notes" rows="3" maxlength="10000">${esc(f.notes)}</textarea></label></div></section><aside class="fee-result"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">FEE BREAKDOWN</p><h2>Estimated assessment</h2></div><span id="assessment-state" class="type-tag">${f.saved ? 'Saved' : 'Draft'}</span></div><div id="fee-breakdown">${breakdown(draft)}</div><div class="fee-actions"><button class="btn primary full" type="submit">${icon('check')}Save assessment</button><p class="muted small">Save to include this assessment in the project summary.</p></div></section></aside></div></form>`;
}
export function syncAssessmentFields(form, { number, money }) {
  const registration = form.elements.namedItem('includeRegistration').checked;
  const cr = form.elements.namedItem('crCategory'); cr.disabled = !registration; cr.required = registration;
  for (const check of form.querySelectorAll('[data-housing]')) {
    const area = form.querySelector(`[data-housing-area="${check.dataset.housing}"]`);
    area.hidden = !check.checked;
    area.querySelector('input').disabled = !check.checked;
  }
  const area = Number(form.elements.namedItem('inspectionHectares').value);
  form.querySelector('#inspection-calculation').textContent = Number.isFinite(area) && area >= 0 ? `${hectares(area)} ha rounds up to ${number(Math.ceil(area))} ha × ${money(1500)}. Charged once for the project.` : 'Enter a valid inspection area.';
}
export function readAssessmentForm(project, form) {
  const f = prepareAssessment(project), values = new FormData(form);
  for (const c of feeClassifications(project)) {
    const prefix = `ls_${c.key}_`, housing = values.has(prefix + 'hasHousing');
    f.licenses[c.key] = {
      lots: Number(values.get(prefix + 'lots') || 0), hasHousing: housing,
      housingArea: housing ? Number(values.get(prefix + 'housingArea')) : 0,
      residentialArea: Number(values.get(prefix + 'residentialArea') || 0),
      commercialArea: Number(values.get(prefix + 'commercialArea') || 0)
    };
  }
  f.inspectionHectares = Number(values.get('inspectionHectares'));
  f.paid = Number(values.get('paid'));
  f.includeRegistration = values.has('includeRegistration');
  f.crCategory = values.get('crCategory') || '';
  for (const key of ['preparedBy', 'receipt', 'notes']) f[key] = values.get(key);
  f.saved = true;
  return { ...project, fees: f, updatedAt: new Date().toISOString() };
}
