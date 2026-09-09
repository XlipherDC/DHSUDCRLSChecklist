import { assessmentView, syncAssessmentFields, readAssessmentForm } from './lib/fee-ui.js';
import { prepareAssessment, FEE_VERSION } from './lib/fee-schedule.js';
import { categoryLabels, projectDetailRows } from './lib/project-details.js';
import { projectFields, bindProjectFields, readProjectFields } from './lib/project-form.js';
import { STATUSES, SCHEMES, MAX_BACKUP_BYTES, createProject, progress, projectStatus, calculateFees, validateProject, parseBackup } from './lib/model.js';
import { openDatabase, readProjects, writeProjects, storageInfo, activateShared, disconnectShared, readLocalProjects, sharedVersion, sharedSnapshot, acceptSharedSnapshot } from './lib/storage.js';
import { createCloudStore, invitationLink, parseInvitation } from './lib/cloud.js';
import { sharingView } from './lib/sharing-ui.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
const number = value => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 }).format(value);
const date = value => value ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date(value.length === 10 ? value + 'T12:00:00' : value)) : '—';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
  calc: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h2m4 0h2m-8 4h2m4 0h2m-8 4h2m4 0h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  building: '<path d="M3 21V7l9-4v18M12 9h9v12M7 8v2m0 3v2m0 3v3m9-8h1m-1 4h1M1 21h22"/>',
  print: '<path d="M6 8V2h12v6M6 17H3V9h18v8h-3M6 14h12v8H6Z"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`;
let catalog, projects = [], activeId, activeTab = 'checklist', page = 'projects', search = '', typeFilter = 'all', requirementSearch = '', statusFilter = 'all', categoryFilter = 'all';
let saving = false, dirty = false, channel, previousHash = location.hash;
let pendingInvitation, syncMessage = '', lastVersion = -1, refreshing = false, activity = 0, sharedReady = false;
const shared = () => storageInfo().shared;
const current = () => projects.find(p => p.id === activeId);
const badge = (text, tone) => `<span class="badge ${tone}"><span></span>${esc(text)}</span>`;
const button = (action, label, ico, cls = 'btn', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${ico ? icon(ico) : ''}${label}</button>`;
const options = (values, selected) => Object.entries(values).map(([v, label]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
const field = (label, name, value = '', type = 'text', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function toast(message, isError = false) { const el = $('#toast'); el.textContent = message; el.className = `visible ${isError ? 'error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className = '', isError ? 8000 : 3500); }
function reportError(error) { console.error(error); toast(error.name === 'QuotaExceededError' ? 'Device storage is full. Export a backup and free space before saving again.' : error.message || 'The action could not be completed. Please try again.', true); }
async function persist(changed, deleted = []) {
  if (shared() && !sharedReady) throw new Error('Refresh the shared workspace successfully before saving.');
  activity++;
  for (const p of changed) validateProject(p, catalog);
  const changedIds = new Set(changed.map(p => p.id));
  const prospective = [...projects.filter(p => !deleted.includes(p.id) && !changedIds.has(p.id)), ...changed];
  if (new Blob([JSON.stringify({ format: 'crls-workspace', version: 1, projects: prospective })]).size > MAX_BACKUP_BYTES - 1024) throw new Error('This workspace would exceed the 150 MB portable backup limit. Export a backup, then remove unneeded projects before adding more.');
  changed = await writeProjects(changed, deleted, new Map(projects.map(p => [p.id, shared() ? p._revision : p.updatedAt])));
  projects = projects.filter(p => !deleted.includes(p.id));
  for (const p of changed) { const i = projects.findIndex(x => x.id === p.id); if (i < 0) projects.push(p); else projects[i] = p; }
  lastVersion = -1;
  syncMessage = shared() ? 'Saved to shared workspace.' : '';
  channel?.postMessage({ target: shared() ? storageInfo().config.url : 'local' });
}
function shell() {
  $('#app').innerHTML = `<aside class="sidebar"><a class="brand" href="#"><img src="./favicon.svg" alt="" width="40" height="40"><span>CRLS<span>PROCESSOR WORKSPACE</span></span></a><div class="side-label">WORKSPACE</div><nav aria-label="Main navigation"><button data-action="projects" class="nav-item ${page === 'projects' ? 'active' : ''}">${icon('folder')}Projects<span class="nav-count">${projects.length}</span></button><button data-action="sharing" class="nav-item ${page === 'sharing' ? 'active' : ''}">${icon('building')}Shared workspace</button><button data-action="backups" class="nav-item ${page === 'backups' ? 'active' : ''}">${icon('download')}Backup & restore</button></nav><div class="sidebar-bottom"><div class="local-status"><span></span>${shared() ? 'Shared workspace' : 'Local workspace'}</div><p>${shared() ? 'Saved to Cloudflare.<br>Shared across connected computers.' : 'Saved on this browser.<br>Connect a shared workspace to work together.'}</p><div class="department">DHSUD<span>CR / LS DOCUMENT REVIEW</span></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Workspace ${icon('arrow')} <span>${page === 'sharing' ? 'Shared workspace' : page === 'backups' ? 'Backup & restore' : 'Projects'}</span>${current() ? `${icon('arrow')}<span class="crumb-project">${esc(current().name)}</span>` : ''}</div><div class="topbar-right"><span class="device-label">${icon('shield')}No sign-in required</span><span class="avatar" title="Processor workspace">P</span></div></header><main id="main" tabindex="-1">${shared() && page !== 'sharing' ? `<div class="sync-strip"><span id="sync-status" role="status">${esc(syncMessage || 'Connected to shared workspace')}</span>${button('refresh-shared', 'Refresh', null, 'btn small-btn')}</div>` : ''}${page === 'sharing' ? sharingView(storageInfo(), syncMessage, pendingInvitation) : page === 'backups' ? backupsView() : current() ? projectView() : projectsView()}</main><footer class="footer"><span>CRLS Workspace <span class="footer-dot">·</span> Certificate of Registration & License to Sell</span></footer></div>`;
  bindView();
}
function projectsView() {
  const complete = projects.filter(p => progress(p, catalog).complete).length;
  const revision = projects.filter(p => progress(p, catalog).revision).length;
  const inReview = projects.filter(p => { const s = progress(p, catalog); return !s.complete && (s.verified || s.submitted); }).length;
  return `<div class="page-heading"><div><p class="eyebrow">PROJECT REGISTER</p><h1>Your projects</h1><p>Review requirements. Keep submissions moving.</p></div>${button('new', 'New project', 'plus', 'btn primary')}</div><section class="stats" aria-label="Project statistics">${stat('Total projects', projects.length, 'folder', 'All project records')}${stat('In review', inReview, 'clock', 'Document checking in progress')}${stat('Needs revision', revision, 'file', 'With documents to address', 'amber')}${stat('Review complete', complete, 'check', 'All applicable requirements verified', 'green')}</section><section class="panel project-panel"><div class="panel-heading"><div><h2>Project register <span class="count-label">${projects.length}</span></h2><p>Select a project to view its checklist and fees.</p></div><div class="toolbar"><label class="search"><span class="sr-only">Search projects</span>${icon('search')}<input id="project-search" placeholder="Search name, location, reference…" value="${esc(search)}"></label><label><span class="sr-only">Project type</span><select id="type-filter">${options({ all: 'All project types', subdivision: 'Subdivision', condominium: 'Condominium' }, typeFilter)}</select></label></div></div><div id="project-list">${projectList()}</div></section><div class="bottom-note">${icon('info')}${shared() ? 'Project records are shared with everyone connected to this workspace.' : 'Project records stay in this browser. Open Shared workspace to connect other computers.'} Use Backup & restore to keep a portable copy.</div>`;
}
function stat(label, value, ico, note, tone = '') { return `<article class="stat"><div class="stat-top"><span>${label}</span><span class="stat-icon ${tone}">${icon(ico)}</span></div><strong>${value}</strong><p>${note}</p></article>`; }
function projectList() {
  const list = projects.filter(p => (typeFilter === 'all' || p.type === typeFilter) && `${p.name} ${p.reference} ${p.location} ${p.developer}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!projects.length) return `<div class="empty-state"><span class="empty-icon">${icon('folder')}</span><h2>A clear starting point for every project.</h2><p>Create a project and its document checklist will be ready.<br>Choose a subdivision or condominium template from your source workbooks.</p><div class="template-choices"><button data-action="new-subdivision">${icon('building')}<span><strong>Subdivision</strong><small>${catalog.subdivision.requirements.length} checklist requirements</small></span>${icon('arrow')}</button><button data-action="new-condominium">${icon('building')}<span><strong>Condominium</strong><small>${catalog.condominium.requirements.length} checklist requirements</small></span>${icon('arrow')}</button></div><small class="muted">Existing source check marks are not treated as new submissions.</small></div>`;
  if (!list.length) return '<div class="empty-state compact"><h3>No matching projects</h3><p>Try a different search or project type.</p></div>';
  return `<div class="table-scroll"><table class="project-table"><thead><tr><th>PROJECT / LOCATION</th><th>TYPE</th><th>DOCUMENT REVIEW</th><th>STATUS</th><th>UPDATED</th><th><span class="sr-only">Open</span></th></tr></thead><tbody>${list.map(p => { const s = progress(p, catalog), status = projectStatus(p, catalog); return `<tr><td><button class="project-link" data-action="open-project" data-id="${p.id}"><span class="project-symbol">${icon('building')}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.location || 'Location not entered')}</small>${p.reference ? `<small class="reference">${esc(p.reference)}</small>` : ''}</span></button></td><td><span class="type-tag">${catalog[p.type].label}</span></td><td><div class="progress-label"><span>${s.verified} / ${s.applicable} verified</span><b>${s.percent}%</b></div><div class="progress-track"><i style="width:${s.percent}%"></i></div></td><td>${badge(status.label, status.tone)}</td><td class="date-cell">${date(p.updatedAt)}</td><td>${button('open-project', '<span class="sr-only">Open project</span>', 'arrow', 'icon-btn', `data-id="${p.id}"`)}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function projectView() {
  const p = current(), s = progress(p, catalog), status = projectStatus(p, catalog);
  return `${button('projects', 'All projects', 'back', 'back-link')}<div class="page-heading detail-heading"><div><div class="title-tags"><span class="type-tag">${catalog[p.type].label}</span>${badge(status.label, status.tone)}${p.reference ? `<span class="muted">${esc(p.reference)}</span>` : ''}</div><h1>${esc(p.name)}</h1><p class="location">${icon('pin')}${esc(p.location || 'Location not entered')}</p></div><div class="actions">${button('print', 'Print summary', 'print')}${button('edit', 'Edit project', 'edit')}</div></div><section class="project-summary"><div><span>DEVELOPER</span><strong>${esc(p.developer || 'Not entered')}</strong></div><div><span>PROJECT CATEGORIES</span><strong>${esc(categoryLabels(p, SCHEMES))}</strong></div><div><span>ASSIGNED PROCESSOR</span><strong>${esc(p.processor || 'Not assigned')}</strong></div><div><span>DOCUMENT REVIEW</span><div class="progress-label"><strong>${s.verified} of ${s.applicable} verified</strong><b>${s.percent}%</b></div><div class="progress-track"><i style="width:${s.percent}%"></i></div></div></section><nav class="tabs" aria-label="Project views">${[['checklist', 'Document checklist', 'list'], ['details', 'Project details', 'building'], ['fees', 'Fee assessment', 'calc']].map(([key, text, ico]) => `<button data-action="tab" data-tab="${key}" class="${activeTab === key ? 'active' : ''}" aria-current="${activeTab === key ? 'page' : 'false'}">${icon(ico)}${text}${key === 'checklist' ? `<span>${s.total}</span>` : ''}</button>`).join('')}</nav>${activeTab === 'details' ? detailsView(p) : activeTab === 'fees' ? feesView(p) : checklistView(p, s)}`;
}
function checklistView(p, s) {
  const categories = [...new Set(catalog[p.type].requirements.map(r => r.category))];
  return `<div class="checklist-layout"><aside class="section-nav panel"><h3>Checklist sections</h3><button data-action="category" data-category="all" class="${categoryFilter === 'all' ? 'active' : ''}">All requirements<span>${s.total}</span></button>${categories.map((c, i) => `<button data-action="category" data-category="${esc(c)}" class="${categoryFilter === c ? 'active' : ''}"><span class="section-number">${String(i + 1).padStart(2, '0')}</span>${esc(c)}</button>`).join('')}<div class="section-foot">${icon('info')}Use “Not applicable” with a reason for conditional requirements.</div></aside><section class="panel requirements-panel"><div class="panel-heading"><div><h2>${categoryFilter === 'all' ? 'Document checklist' : esc(categoryFilter)}</h2><p>Open a requirement to record its status and review details.</p></div><span class="saved-label">${icon('check')}${shared() ? 'Shared records' : 'Saved locally'}</span></div><div class="review-summary"><span><i class="dot verified"></i>${s.verified} verified</span><span><i class="dot submitted"></i>${s.submitted} for review</span><span><i class="dot revision"></i>${s.revision} need revision</span><span><i class="dot missing"></i>${s.missing} not submitted</span><span>${s.na} N/A</span></div><div class="requirement-tools"><label class="search">${icon('search')}<span class="sr-only">Search requirements</span><input id="requirement-search" placeholder="Find a requirement…" value="${esc(requirementSearch)}"></label><label><span class="sr-only">Review status</span><select id="status-filter">${options({ all: 'All statuses', ...STATUSES }, statusFilter)}</select></label></div><div id="requirement-list">${requirementList(p)}</div></section></div>`;
}
function requirementList(p) {
  const list = catalog[p.type].requirements.filter(r => (categoryFilter === 'all' || r.category === categoryFilter) && (statusFilter === 'all' || (p.reviews[r.id]?.status || 'missing') === statusFilter) && `${r.title} ${r.details.map(d => d.text).join(' ')}`.toLowerCase().includes(requirementSearch.toLowerCase()));
  let group = '';
  if (!list.length) return '<div class="empty-state compact"><h3>No matching requirements</h3><p>Try a different search, section, or status.</p></div>';
  return list.map(r => { const review = p.reviews[r.id], status = review?.status || 'missing'; let header = ''; if (group !== r.category) { group = r.category; header = `<div class="requirement-group">${esc(group)}</div>`; } return `${header}<button class="requirement-row" data-action="review" data-id="${r.id}"><span class="requirement-mark ${status}">${icon(status === 'verified' ? 'check' : status === 'submitted' ? 'clock' : 'file')}</span><span class="requirement-text"><strong>${esc(r.title)}</strong>${review?.remarks ? `<small>${esc(review.remarks.slice(0, 100))}</small>` : ''}</span>${badge(STATUSES[status], status)}${icon('arrow')}</button>`; }).join('');
}
function detailsView(p) {
  const details = [['Project name', p.name], ['Project reference', p.reference], ['Project type', catalog[p.type].label], ['Categories', categoryLabels(p, SCHEMES)], ['Location', p.location], ['Project area', p.projectArea ? `${number(p.projectArea)} m²` : ''], ['Owner', p.owner], ['Developer', p.developer], ['Developer address', p.address], ['Application type', p.application], ...projectDetailRows(p), ['Processor', p.processor], ['Date received', p.receivedDate ? date(p.receivedDate) : '']];
  return `<section class="panel"><div class="panel-heading"><div><h2>Project information</h2><p>Details used throughout this project’s review and fee assessment.</p></div>${button('edit', 'Edit details', 'edit')}</div><dl class="details-grid">${details.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value || 'Not entered')}</dd></div>`).join('')}</dl><div class="notes-block"><h3>Project notes</h3><p class="pre-line">${esc(p.notes || 'No project notes yet.')}</p></div></section><div class="danger-zone"><span>Created ${date(p.createdAt)} · Last updated ${date(p.updatedAt)}</span>${button('delete-project', 'Delete project', 'trash', 'btn danger-ghost')}</div>`;
}
function feesView(p) {
  return assessmentView(p, { esc, money, number, icon, field, breakdown: feeBreakdown });
}
function feeBreakdown(p) {
  let calc;
  try { calc = calculateFees(p, catalog); }
  catch (error) { return `<p class="form-error padded">${esc(error.message)}</p>`; }
  return `<div class="fee-lines">${calc.licenseCount ? `<p class="small muted">${calc.crCount} CR &middot; ${calc.licenseCount} LS classification${calc.licenseCount === 1 ? '' : 's'}</p>` : ''}${calc.lines.map(l => `<div class="fee-line"><div><strong>${esc(l.label)}</strong><small>${number(l.quantity)} ${l.unit} &times; ${money(l.rate)}</small></div><b>${money(l.amount)}</b></div>`).join('')}</div><div class="fee-total"><span>Total assessed fees</span><strong>${money(calc.total)}</strong><small>Philippine pesos</small></div><div class="fee-payment"><div><span>Amount paid</span><b>${money(p.fees.paid)}</b></div><div><span>Balance due</span><b>${money(calc.balance)}</b></div>${calc.overpayment ? `<div><span>Overpayment</span><b>${money(calc.overpayment)}</b></div>` : ''}</div>`;
}
function backupsView() {
  return `<div class="page-heading"><div><p class="eyebrow">WORKSPACE DATA</p><h1>Backup & restore</h1><p>Keep a portable copy of your project records and review notes.</p></div></div><div class="notice">${icon('info')}<div><strong>${shared() ? 'Back up your shared workspace' : 'Your workspace is stored on this device'}</strong><p>${shared() ? 'Exports contain the records currently loaded from Cloudflare. Refresh first to include the latest changes. Restoring a backup writes to the shared workspace for all connected processors.' : 'Local records are not shared between computers. Clearing site data removes local records. Use Shared workspace to connect a shared database.'} Export a backup regularly and keep it in a suitable location.</p></div></div><div class="source-cards"><section class="panel source-card"><span class="empty-icon">${icon('download')}</span><h2>Export workspace</h2><p>A JSON backup includes every project, review note, and fee assessment.</p><div class="backup-counts"><strong>${projects.length}<span>projects</span></strong></div>${button('export', 'Download full backup', 'download', 'btn primary', projects.length ? '' : 'disabled')}</section><section class="panel source-card"><span class="empty-icon">${icon('upload')}</span><h2>Restore a backup</h2><p>Import a CRLS Workspace JSON backup. You’ll review the project count and any matching records before importing.</p><p class="muted">New projects are added. For matching project IDs, choose to replace them or keep the current records.</p><label class="btn"><input id="import-file" type="file" accept=".json,application/json" class="sr-only">${icon('upload')}Choose backup file</label><p class="small muted">Maximum backup size: 150 MB.</p></section></div>`;
}
function openModal(html, cls = '') { const modal = $('#modal'); modal.className = cls; modal.innerHTML = html; modal.showModal(); modal.querySelector('input:not([type="hidden"]),select,button')?.focus(); }
function modalHeader(eyebrow, title) { return `<div class="modal-header"><div><p class="eyebrow">${eyebrow}</p><h2 id="modal-title">${title}</h2></div>${button('close-modal', '<span class="sr-only">Close dialog</span>', 'close', 'icon-btn')}</div>`; }
function closeModal() { $('#modal').close(); dirty = false; }
function projectForm(type = 'subdivision', edit = false) {
  const p = edit ? current() : { type, scheme: 'pd957', categories: ['openMarket'] };
  openModal(`${modalHeader(edit ? 'PROJECT SETTINGS' : 'NEW PROJECT', edit ? 'Edit project details' : 'Start a project review')}<form id="project-form"><div class="modal-body"><div class="form-grid"><label class="field"><span>Project type</span><select name="type" ${edit ? 'disabled' : ''}>${options({ subdivision: 'Subdivision', condominium: 'Condominium' }, p.type)}</select></label></div>${edit ? '<p class="small muted">Select all project categories that apply. Changes to categories, lot counts, or land area reset the fee assessment to a draft.</p>' : '<p class="small muted">The project checklist is added automatically. Assess fees separately after entering the project details.</p>'}${projectFields(p, esc)}${field('Project name <span class="required">*</span>', 'name', p.name, 'text', 'required maxlength="200" placeholder="e.g. Riverside Residences"')}<div class="form-grid">${field('Project reference', 'reference', p.reference, 'text', 'maxlength="200" placeholder="e.g. CRLS-2026-001"')}${field('Date received', 'receivedDate', p.receivedDate, 'date')}${field('Location', 'location', p.location, 'text', 'maxlength="1000"')}${field('Project land area (m²)', 'projectArea', p.projectArea, 'number', 'min="0" step="0.01"')}${field('Owner', 'owner', p.owner, 'text', 'maxlength="1000"')}${field('Developer', 'developer', p.developer, 'text', 'maxlength="1000"')}</div>${field('Developer address', 'address', p.address, 'text', 'maxlength="1000"')}<div class="form-grid">${field('Assigned processor', 'processor', p.processor, 'text', 'maxlength="200"')}</div><label class="field"><span>Project notes</span><textarea name="notes" rows="3" maxlength="10000">${esc(p.notes)}</textarea></label><p class="form-error" role="alert"></p></div><div class="modal-footer">${button('close-modal', 'Cancel', null)}<button class="btn primary" type="submit">${icon(edit ? 'check' : 'plus')}${edit ? 'Save project' : 'Create project'}</button></div></form>`);
  const form = $('#project-form');
  bindProjectFields(form);
  form.addEventListener('submit', async e => { e.preventDefault(); if (saving) return; const submit = $('button[type=submit]', form); submit.disabled = saving = true; try {
    const values = Object.fromEntries(new FormData(form));
    delete values.houseAndLot; delete values.lotOnly;
    Object.assign(values, readProjectFields(form, edit ? p.type : values.type));
    let record;
    if (edit) { record = structuredClone(p); Object.assign(record, values, { projectArea: Number(values.projectArea || 0), name: values.name.trim(), updatedAt: new Date().toISOString() }); if (record.scheme !== p.scheme || JSON.stringify(record.categories) !== JSON.stringify(p.categories) || JSON.stringify(record.lotCounts) !== JSON.stringify(p.lotCounts) || record.projectArea !== p.projectArea) {
      record.fees.saved = false;
      if (record.fees.version !== undefined) {
        record.fees = prepareAssessment(record);
        if (record.projectArea !== p.projectArea) record.fees.inspectionHectares = record.projectArea / 10000;
      }
    } }
    else record = createProject(values);
    await persist([record]); activeId = record.id; activeTab = 'checklist'; page = 'projects'; categoryFilter = statusFilter = 'all'; requirementSearch = ''; closeModal(); location.hash = `project/${record.id}`; shell(); toast(edit ? 'Project updated.' : 'Project created. Your checklist is ready.');
  } catch (err) { $('.form-error', form).textContent = err.message; } finally { submit.disabled = saving = false; } });
}
function reviewModal(id) {
  const p = current(), req = catalog[p.type].requirements.find(r => r.id === id);
  const review = structuredClone(p.reviews[id] || { status: 'missing', remarks: '', receivedDate: '', reviewedBy: p.processor, updatedAt: '' });
  openModal(`${modalHeader(esc(req.category), esc(req.title))}<form id="review-form"><div class="modal-body">${req.details.length ? `<details class="review-prompts"><summary>Review prompts <span>${req.details.length}</span></summary><ul>${req.details.map(d => `<li>${esc(d.text)}</li>`).join('')}</ul></details>` : ''}<div class="form-grid"><label class="field"><span>Review status</span><select name="status">${options(STATUSES, review.status)}</select></label>${field('Date received', 'receivedDate', review.receivedDate, 'date')}${field('Reviewed by', 'reviewedBy', review.reviewedBy, 'text', 'maxlength="200"')}</div><label class="field"><span>Review remarks / document details</span><textarea name="remarks" rows="4" maxlength="10000" placeholder="Record title numbers, dates, findings, missing details, or the reason this requirement does not apply.">${esc(review.remarks)}</textarea></label><p class="form-error" role="alert"></p></div><div class="modal-footer"><span class="small muted">${review.updatedAt ? `Last reviewed ${date(review.updatedAt)}` : 'Not yet reviewed'}</span><div class="actions">${button('close-modal', 'Cancel', null)}<button class="btn primary" type="submit">${icon('check')}Save review</button></div></div></form>`, 'review-modal');
  const form = $('#review-form');
  form.addEventListener('submit', async e => { e.preventDefault(); if (saving) return; const submit = $('button[type=submit]', form); submit.disabled = saving = true; try {
    const values = Object.fromEntries(new FormData(form));
    if (values.status === 'na' && !values.remarks.trim()) throw new Error('Add a reason before marking this requirement not applicable.');
    const updated = structuredClone(current());
    updated.reviews[id] = { ...review, ...values, updatedAt: new Date().toISOString() };
    updated.updatedAt = new Date().toISOString();
    await persist([updated]); closeModal(); shell(); toast('Review saved.');
  } catch (err) { $('.form-error', form).textContent = err.message; } finally { submit.disabled = saving = false; } });
}
function download(blob, name) { const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function exportBackup() { const data = { format: 'crls-workspace', version: 1, exportedAt: new Date().toISOString(), projects }; const blob = new Blob([JSON.stringify(data)], { type: 'application/json' }); if (blob.size > MAX_BACKUP_BYTES) { toast('This workspace exceeds the 150 MB import limit. Remove unneeded projects after keeping this export.', true); } download(blob, `crls-workspace-${today()}.json`); }
async function importBackup(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 150 MB limit.');
  const imported = parseBackup(await file.text(), catalog);
  const matches = imported.filter(p => projects.some(x => x.id === p.id)).length;
  openModal(`${modalHeader('RESTORE BACKUP', 'Review your import')}<div class="modal-body prose"><p><strong>${imported.length} projects</strong> found in this backup. ${imported.length - matches} are new and ${matches} match existing project IDs.</p>${matches ? '<label class="field"><span>Matching project IDs</span><select id="import-mode"><option value="keep">Keep current records; import new projects only</option><option value="replace">Replace matching records with this backup</option></select></label>' : ''}<p>Project details, remarks, and saved fee assessments are included. Other projects in this workspace are kept.${shared() ? ' This import will change the shared workspace for all connected processors.' : ''}</p><p class="form-error" role="alert"></p></div><div class="modal-footer">${button('close-modal', 'Cancel', null)}<button id="confirm-import" class="btn primary">${icon('upload')}Import projects</button></div>`);
  $('#confirm-import').addEventListener('click', async e => { if (saving) return; saving = e.target.disabled = true; try { const replace = $('#import-mode')?.value === 'replace'; const batch = imported.filter(p => replace || !projects.some(x => x.id === p.id)); await persist(batch); closeModal(); shell(); toast(`${batch.length} projects imported.`); } catch (err) { $('.form-error', $('#modal')).textContent = err.message; } finally { saving = false; e.target.disabled = false; } });
}
function feeDraft(form) {
  return readAssessmentForm(current(), form);
}
function bindView() {
  bindSharing();
  $('#project-search')?.addEventListener('input', e => { search = e.target.value; $('#project-list').innerHTML = projectList(); });
  $('#type-filter')?.addEventListener('change', e => { typeFilter = e.target.value; $('#project-list').innerHTML = projectList(); });
  $('#requirement-search')?.addEventListener('input', e => { requirementSearch = e.target.value; $('#requirement-list').innerHTML = requirementList(current()); });
  $('#status-filter')?.addEventListener('change', e => { statusFilter = e.target.value; $('#requirement-list').innerHTML = requirementList(current()); });
  $('#import-file')?.addEventListener('change', e => importBackup(e.target.files[0]).catch(reportError));
  const fees = $('#fees-form');
  fees?.addEventListener('input', e => { syncAssessmentFields(fees, { number, money }, e.target); dirty = true; $('#assessment-state').textContent = 'Unsaved'; try { if (!fees.checkValidity()) { $('#fee-breakdown').innerHTML = '<p class="form-error padded">Enter valid, non-negative quantities and whole-number form counts to calculate fees.</p>'; return; } $('#fee-breakdown').innerHTML = feeBreakdown(feeDraft(fees)); } catch (err) { $('#fee-breakdown').innerHTML = `<p class="form-error padded">${esc(err.message)}</p>`; } });
  fees?.addEventListener('submit', async e => { e.preventDefault(); if (saving) return; saving = true; const submit = $('button[type=submit]', fees); submit.disabled = true; try { await persist([feeDraft(fees)]); dirty = false; shell(); toast('Fee assessment saved.'); } catch (err) { reportError(err); } finally { saving = false; submit.disabled = false; } });
}
function canLeave() { if (saving) return false; return !dirty || confirm('Discard the changes that have not been saved?'); }
function applyShared(snapshot) {
  for (const p of snapshot.projects) validateProject(p, catalog);
  projects = snapshot.projects;
  acceptSharedSnapshot(snapshot);
  lastVersion = snapshot.version;
  sharedReady = true;
  syncMessage = 'Shared records up to date.';
  if (activeId && !current()) { activeId = undefined; toast('This project was removed from the shared workspace.'); }
}
function showSyncStatus(message) {
  syncMessage = message;
  for (const selector of ['#sync-status', '#sharing-status']) if ($(selector)) $(selector).textContent = message;
}
async function refreshShared(force = false) {
  if (!shared() || refreshing || saving) return;
  if (force) { if (!canLeave()) return; dirty = false; if ($('#modal').open) closeModal(); }
  else if (document.hidden || dirty || $('#modal').open || document.activeElement?.matches('input, textarea, select')) return;
  const started = activity;
  refreshing = true;
  try {
    const version = await sharedVersion();
    if (started !== activity || !shared()) return;
    if (force || version !== lastVersion || !sharedReady) {
      const snapshot = await sharedSnapshot();
      if (started !== activity || !shared() || dirty || saving || $('#modal').open || (!force && document.activeElement?.matches('input, textarea, select'))) return;
      applyShared(snapshot); shell();
    }
    showSyncStatus('Shared records up to date.');
    if (force) toast('Shared records refreshed.');
  } catch (error) { showSyncStatus(error.message); if (force) reportError(error); }
  finally { refreshing = false; }
}
function bindSharing() {
  const form = $('#shared-form');
  form?.addEventListener('input', () => dirty = true);
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    const submit = $('button[type=submit]', form); submit.disabled = saving = true; activity++;
    try {
      const candidate = createCloudStore(Object.fromEntries(new FormData(form)));
      const snapshot = await candidate.read();
      for (const p of snapshot.projects) validateProject(p, catalog);
      activateShared(candidate.config, snapshot.name);
      applyShared(snapshot); pendingInvitation = undefined; dirty = false; activeId = undefined;
      shell(); toast('Connected. Your local projects have been kept separately.');
    } catch (error) { $('.form-error', form).textContent = error.message; }
    finally { submit.disabled = saving = false; }
  });
}
async function sharingAction(action) {
  if (action === 'refresh-shared') { await refreshShared(true); return true; }
  if (action === 'share-link') {
    const link = invitationLink(storageInfo().config, location.href);
    openModal(`${modalHeader('INVITE PROCESSORS', 'Private workspace link')}<div class="modal-body"><p>Anyone with this link can view, change, and delete records in <strong>${esc(storageInfo().name)}</strong>. Share it only with the intended processors.</p><label class="field"><span>Workspace link</span><textarea id="workspace-link" rows="5" readonly spellcheck="false">${esc(link)}</textarea></label><p class="small muted">Open this link on another computer and choose “Connect shared workspace”. This link does not include local records or your Cloudflare account credentials.</p><button class="btn primary" id="copy-workspace-link">Copy link</button></div>`);
    $('#copy-workspace-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); toast('Private workspace link copied.'); } catch { $('#workspace-link').select(); toast('Select and copy the workspace link.'); } });
    return true;
  }
  if (action === 'disconnect-shared') {
    if (!canLeave()) return true;
    const local = await readLocalProjects();
    for (const p of local) validateProject(p, catalog);
    activity++; disconnectShared(); projects = local; activeId = undefined; sharedReady = false; lastVersion = -1; dirty = false; syncMessage = '';
    shell(); toast('Returned to local records. Shared records are unchanged.'); return true;
  }
  if (action === 'copy-local') {
    if (!sharedReady) throw new Error('Refresh the shared workspace successfully first.');
    const local = await readLocalProjects();
    const additions = local.filter(p => !projects.some(other => p.id === other.id));
    openModal(`${modalHeader('COPY LOCAL RECORDS', 'Add local projects to this workspace')}<div class="modal-body"><p><strong>${additions.length} new local projects</strong> will be copied to <strong>${esc(storageInfo().name)}</strong> at ${esc(storageInfo().config.url)}.</p><p>Project details, remarks, and fee assessments will be visible to everyone with the workspace link. ${local.length - additions.length} matching IDs will be skipped. The local originals are kept and any old document attachments are excluded.</p><p class="form-error" role="alert"></p></div><div class="modal-footer">${button('close-modal', 'Cancel', null)}<button class="btn primary" id="confirm-copy-local" ${additions.length ? '' : 'disabled'}>Copy ${additions.length} projects</button></div>`);
    $('#confirm-copy-local').addEventListener('click', async event => { if (saving) return; event.target.disabled = saving = true; try { await persist(additions); closeModal(); shell(); toast('Local project records copied to the shared workspace.'); } catch (error) { $('.form-error', $('#modal')).textContent = error.message; } finally { event.target.disabled = saving = false; } });
    return true;
  }
  return false;
}
function navigate(action) { if (!canLeave()) return; dirty = false; activeId = undefined; page = action; location.hash = action === 'projects' ? '' : action; shell(); }
async function handleAction(btn) {
  const action = btn.dataset.action;
  if (saving) return;
  if (await sharingAction(action)) return;
  if (['projects', 'backups', 'sharing'].includes(action)) return navigate(action);
  if (action === 'new' || action.startsWith('new-')) { if (canLeave()) { dirty = false; shell(); projectForm(action.slice(4) === 'condominium' ? 'condominium' : 'subdivision'); } }
  if (action === 'open-project') { activeId = btn.dataset.id; activeTab = 'checklist'; categoryFilter = statusFilter = 'all'; requirementSearch = ''; location.hash = `project/${activeId}`; shell(); }
  if (action === 'edit') { if (canLeave()) { dirty = false; shell(); projectForm(undefined, true); } }
  if (action === 'tab') { if (!canLeave()) return; dirty = false; activeTab = btn.dataset.tab; shell(); }
  if (action === 'category') { categoryFilter = btn.dataset.category; shell(); }
  if (action === 'review') reviewModal(btn.dataset.id);
  if (action === 'close-modal') { if (canLeave()) closeModal(); }
  if (action === 'export') exportBackup();
  if (action === 'print') { if (dirty) return toast('Save or discard your assessment changes before printing.', true); printProject(); }
  if (action === 'delete-project') {
    const p = current();
    openModal(`${modalHeader('DELETE PROJECT', 'Delete this project?')}<div class="modal-body"><p><strong>${esc(p.name)}</strong> and its reviews and assessment will be removed.${shared() ? ' This deletes the shared record for all connected processors.' : ''}</p><p>Export a backup first if you may need this record again.</p></div><div class="modal-footer">${button('close-modal', 'Keep project', null)}<button id="confirm-delete" class="btn danger">Delete project</button></div>`);
    $('#confirm-delete').addEventListener('click', async e => { if (saving) return; e.target.disabled = saving = true; try { await persist([], [p.id]); closeModal(); activeId = undefined; location.hash = ''; shell(); toast('Project deleted.'); } catch (err) { reportError(err); } finally { saving = false; e.target.disabled = false; } });
  }
}
function printProject() {
  const p = current(), summary = progress(p, catalog);
  const old = $('#print-report'); old?.remove();
  const report = document.createElement('article'); report.id = 'print-report';
  report.innerHTML = `<div class="print-header"><img src="./favicon.svg" width="42" alt=""><div><h1>CRLS Project Review Summary</h1><p>Certificate of Registration & License to Sell · Printed ${date(new Date().toISOString())}</p></div></div><h2>${esc(p.name)}</h2><p>${esc(p.location)}</p><dl class="print-details">${[['Reference', p.reference], ['Type', catalog[p.type].label], ['Categories', categoryLabels(p, SCHEMES)], ['Owner', p.owner], ['Developer', p.developer], ['Address', p.address], ['Application type', p.application], ...projectDetailRows(p), ['Land area', `${number(p.projectArea)} m²`], ['Processor', p.processor], ['Date received', date(p.receivedDate)]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}</dl>${p.notes ? `<p><b>Project notes:</b> ${esc(p.notes)}</p>` : ''}<h3>Document review · ${summary.verified} / ${summary.applicable} verified · ${summary.na} not applicable</h3><table class="print-table"><thead><tr><th>Requirement</th><th>Status</th><th>Review details</th></tr></thead><tbody>${catalog[p.type].requirements.map(r => { const review = p.reviews[r.id]; return `<tr><td><strong>${esc(r.title)}</strong></td><td>${STATUSES[review?.status || 'missing']}</td><td><span class="pre-line">${esc(review?.remarks || '—')}</span>${review ? `<small>Received: ${date(review.receivedDate)} · Reviewer: ${esc(review.reviewedBy || '—')}</small>` : ''}</td></tr>`; }).join('')}</tbody></table><section class="print-fees"><h2>Fee assessment</h2>${p.fees.saved ? feeBreakdown(p) + `<p>Prepared by: ${esc(p.fees.preparedBy || '—')} · O.R. / payment reference: ${esc(p.fees.receipt || '—')}</p><p class="pre-line">${esc(p.fees.notes)}</p>` : '<p>No fee assessment has been saved.</p>'}<p class="small">${p.fees.version === FEE_VERSION ? 'Inspection is charged once on the project area rounded up to whole hectares.' : 'Previous saved assessment using an earlier schedule. Open Fee assessment to review and save the updated schedule.'} Review completion is not regulatory approval.</p></section>`;
  document.body.append(report); window.print();
}
document.addEventListener('click', e => { const btn = e.target.closest('[data-action]'); if (btn) { e.preventDefault(); handleAction(btn).catch(reportError); } });
$('#modal').addEventListener('input', () => dirty = true);
$('#modal').addEventListener('cancel', e => { if (!canLeave()) e.preventDefault(); else dirty = false; });
window.addEventListener('beforeunload', e => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', () => {
  if (!catalog) return;
  if (dirty || saving) {
    if (!canLeave()) { history.replaceState(null, '', previousHash || location.pathname + location.search); return; }
    dirty = false;
  }
  previousHash = location.hash;
  if ($('#modal').open) closeModal();
  const route = location.hash.slice(1);
  if (route.startsWith('connect=')) { try { pendingInvitation = parseInvitation(location.hash); } catch (error) { syncMessage = error.message; } history.replaceState(null, '', location.pathname + location.search + '#sharing'); previousHash = '#sharing'; activeId = undefined; page = 'sharing'; shell(); return; }
  if (route.startsWith('project/')) { const id = route.slice(8); if (!projects.some(p => p.id === id)) { activeId = undefined; page = 'projects'; toast('This project is not in the current workspace.', true); } else { activeId = id; page = 'projects'; } }
  else { activeId = undefined; page = ['backups', 'sharing'].includes(route) ? route : 'projects'; }
  shell();
});
async function init() {
  const response = await fetch('./data/catalog.json');
  if (!response.ok) throw new Error('The source checklist could not be loaded. Reload the page to try again.');
  catalog = await response.json();
  await openDatabase();
  try {
    if (shared()) { const snapshot = await sharedSnapshot(); applyShared(snapshot); }
    else { projects = await readProjects(); for (const p of projects) validateProject(p, catalog); }
  } catch (error) { if (!shared()) throw error; sharedReady = false; syncMessage = error.message; page = 'sharing'; }
  try { pendingInvitation = parseInvitation(location.hash); } catch (error) { syncMessage = error.message; page = 'sharing'; }
  if (location.hash.startsWith('#connect=')) { history.replaceState(null, '', location.pathname + location.search + '#sharing'); previousHash = '#sharing'; page = 'sharing'; }
  if ('BroadcastChannel' in window) { channel = new BroadcastChannel('crls-workspace'); channel.onmessage = async event => {
    if (event.data?.target !== (shared() ? storageInfo().config.url : 'local')) return;
    if (shared()) { await refreshShared(); return; }
    if (dirty || saving || $('#modal').open) return toast('Records changed in another tab. Finish your edit, then reload.', true);
    try { projects = await readProjects(); shell(); } catch (error) { reportError(error); }
  }; }
  setInterval(() => refreshShared(), 15000);
  window.addEventListener('online', () => refreshShared());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshShared(); });
  const route = location.hash.slice(1);
  if (page !== 'sharing' && route.startsWith('project/') && projects.some(p => p.id === route.slice(8))) activeId = route.slice(8);
  else if (['backups', 'sharing'].includes(route)) page = route;
  shell();
}
init().catch(err => { console.error(err); $('#app').innerHTML = `<main class="loading"><img src="./favicon.svg" width="48" alt=""><h1>Workspace could not open</h1><p>${esc(err.message)}</p><p>Open the app through a local web server or GitHub Pages, with browser storage enabled.</p><button class="btn primary" onclick="location.reload()">Try again</button></main>`; });
