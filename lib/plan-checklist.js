// Stable requirement IDs scope the submitted-plan checklist to LGU approved plans.
const PLAN_REQUIREMENTS = new Set(['subdivision-B190', 'condominium-B184']);
export const isPlanChecklist = requirement => !!requirement && PLAN_REQUIREMENTS.has(requirement.id);
const depth = item => ({ C: 0, D: 1, E: 2 }[item.ref.match(/!([A-Z]+)\d+$/)?.[1]] || 0);
export function planSubmissionSummary(requirement, review) {
  return `${review?.submittedPlans?.length || 0} of ${requirement.details.length} items marked submitted`;
}
export function validateSubmittedPlans(requirement, review) {
  if (review.submittedPlans === undefined) return;
  if (!isPlanChecklist(requirement)) throw new Error('Submitted plan selections apply only to LGU approved plans.');
  const selected = review.submittedPlans, allowed = new Set(requirement.details.map(item => item.ref));
  if (!Array.isArray(selected) || selected.length > allowed.size || new Set(selected).size !== selected.length || selected.some(key => typeof key !== 'string' || !allowed.has(key))) throw new Error('Invalid submitted plan selections.');
}
export function renderPlanChecklist(requirement, review, esc) {
  const selected = new Set(review.submittedPlans || []);
  return `<fieldset class="plan-checklist"><legend>Plans submitted</legend><p class="small muted">Check each submitted plan or applicable detail, then choose the overall review status. Describe any other plans in the remarks.</p><p class="plan-submission-count"><output id="plan-submitted-count" aria-live="polite">${planSubmissionSummary(requirement, review)}</output></p><div class="plan-checklist-items">${requirement.details.map(item => `<label class="checkbox-field plan-item plan-depth-${depth(item)}"><input type="checkbox" name="submittedPlans" value="${esc(item.ref)}" ${selected.has(item.ref) ? 'checked' : ''}><span>${esc(item.text)}</span></label>`).join('')}</div></fieldset>`;
}
export function renderPrintedPlans(requirement, review, esc) {
  if (!isPlanChecklist(requirement)) return '';
  if (!review?.submittedPlans) return '<small>Plan submissions not yet recorded.</small>';
  const selected = new Set(review.submittedPlans);
  return `<div class="print-plan-checklist"><small>${planSubmissionSummary(requirement, review)}</small><ul>${requirement.details.map(item => `<li class="plan-depth-${depth(item)}"><b>${selected.has(item.ref) ? 'Submitted' : 'Not marked'}:</b> ${esc(item.text)}</li>`).join('')}</ul></div>`;
}
