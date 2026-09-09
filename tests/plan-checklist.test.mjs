import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, validateProject, parseBackup, progress } from '../lib/model.js';
import { isPlanChecklist, planSubmissionSummary, renderPrintedPlans } from '../lib/plan-checklist.js';
const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8'));
const make=type=>createProject({name:'Plans review',type,scheme:'pd957'},'plans-test');
const review=()=>({status:'submitted',remarks:'Documents received.',receivedDate:'2026-09-09',reviewedBy:'Processor',updatedAt:new Date().toISOString()});
for(const type of ['subdivision','condominium']) {
 test(`${type} submitted LGU plans survive backup and can be unchecked`,()=>{
  const p=make(type),req=catalog[type].requirements.find(isPlanChecklist);
  assert.equal(req.details.length,16);
  p.reviews[req.id]={...review(),submittedPlans:[req.details[0].ref,req.details[4].ref,req.details[7].ref]};
  validateProject(p,catalog);
  const restored=parseBackup(JSON.stringify({format:'crls-workspace',version:1,projects:[p]}),catalog)[0];
  assert.deepEqual(restored,p);assert.equal(planSubmissionSummary(req,restored.reviews[req.id]),'3 of 16 items marked submitted');
  restored.reviews[req.id].submittedPlans=[];assert.doesNotThrow(()=>validateProject(restored,catalog));
 });
 test(`${type} plan selections reject duplicates, unknown references and malformed values`,()=>{
  const p=make(type),req=catalog[type].requirements.find(isPlanChecklist);
  for(const value of [null,{},true,req.details[0].ref,[req.details[0].ref,req.details[0].ref],['unknown'],[1],[{}]]) {
   p.reviews[req.id]={...review(),submittedPlans:value};assert.throws(()=>validateProject(p,catalog),/Invalid submitted plan/);
  }
 });
}
test('older LGU reviews remain valid without inventing submitted plans',()=>{
 const p=make('subdivision'),req=catalog.subdivision.requirements.find(isPlanChecklist);
 p.reviews[req.id]={...review(),status:'verified'};assert.doesNotThrow(()=>validateProject(p,catalog));
 assert.equal(planSubmissionSummary(req,p.reviews[req.id]),'0 of 16 items marked submitted');
 assert.match(renderPrintedPlans(req,p.reviews[req.id],String),/not yet recorded/);
});
test('checking every plan does not automatically verify the overall requirement',()=>{
 const p=make('subdivision'),req=catalog.subdivision.requirements.find(isPlanChecklist);
 p.reviews[req.id]={...review(),submittedPlans:req.details.map(item=>item.ref)};
 assert.equal(progress(p,catalog).verified,0);assert.equal(progress(p,catalog).submitted,1);
});
test('plan selections cannot be attached to unrelated requirements',()=>{
 const p=make('subdivision');p.reviews[catalog.subdivision.requirements[0].id]={...review(),submittedPlans:[]};
 assert.throws(()=>validateProject(p,catalog),/only to LGU approved plans/);
});
test('printed plan details distinguish submitted and unmarked items without source labels',()=>{
 const req=catalog.subdivision.requirements.find(isPlanChecklist);
 const html=renderPrintedPlans(req,{...review(),submittedPlans:[req.details[0].ref]},String);
 assert.match(html,/Submitted:<\/b> Site Development Plan/);assert.match(html,/Not marked:<\/b> Vicinity Map/);
 assert.equal(html.includes(req.details[0].ref),false);assert.match(html,/plan-depth-1/);assert.match(html,/plan-depth-2/);
});
