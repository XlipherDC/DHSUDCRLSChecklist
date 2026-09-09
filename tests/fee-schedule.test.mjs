import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, calculateFees, validateProject, parseBackup, defaultFees } from '../lib/model.js';
import { prepareAssessment, registrationOptions } from '../lib/fee-schedule-v2.js';
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
// Version 2 regression fixtures protect previously saved assessments.
function historicalProject(values, id) {
 const p=createProject(values,id);p.fees=prepareAssessment({...p,fees:defaultFees()});return p;
}
function subdivision(categories = ['openMarket'], extra = {}) {
  const scheme = ['openMarket', 'mediumCost'].includes(categories[0]) ? 'pd957' : categories[0];
  return historicalProject({name:'Fee test', type:'subdivision', scheme, categories, projectArea:25000, ...extra}, 'fee-test');
}
function condo(scheme = 'pd957') { return historicalProject({name:'Condo',type:'condominium',scheme,projectArea:25000},'condo-test'); }
const calc = p => calculateFees(p,catalog);
const amount = (p,kind) => calc(p).lines.filter(l=>l.kind===kind).reduce((sum,l)=>sum+l.amount,0);

test('PD957 subdivision applies one CR, saleable lot fee, housing floor area and rounded hectares',()=>{
 const p=subdivision();Object.assign(p.fees.licenses.openMarket,{lots:10,hasHousing:true,housingArea:100});
 assert.equal(calc(p).total,10980); // 2880 + 2160 + 1440 + 4500
 assert.equal(amount(p,'registration'),2880);
 assert.equal(amount(p,'inspection'),4500);
 assert.equal(calc(p).licenseCount,1);
 assert.equal(calc(p).lines.length,4);
});
test('PD957 lot-only projects incur no housing surcharge or obsolete form charges',()=>{
 const p=subdivision(['mediumCost'],{lotCounts:{houseAndLot:0,lotOnly:10}});p.fees.licenses.mediumCost.lots=10;
 assert.equal(calc(p).total,9540);
 assert.equal(calc(p).lines.some(l=>l.kind==='housing'),false);
 assert.equal(calc(p).lines.some(l=>/form|provisional/i.test(l.label)),false);
 p.fees.licenses.mediumCost.hasHousing=true;p.fees.licenses.mediumCost.housingArea=100;
 assert.throws(()=>calc(p),/no House and Lot/);
});
test('mixed Open Market and Socialized creates two LS and only the processor-selected CR',()=>{
 const p=subdivision(['openMarket','socialized']);
 assert.equal(p.fees.crCategory,'');assert.throws(()=>calc(p),/single CR fee/);
 p.fees.licenses.openMarket.lots=10;p.fees.licenses.socialized.lots=20;
 p.fees.crCategory='socialized';assert.equal(calc(p).total,7560); // 420 + 2160 + 480 + 4500
 assert.equal(calc(p).licenseCount,2);assert.equal(calc(p).crCount,1);
 assert.equal(calc(p).lines.filter(l=>l.kind==='registration').length,1);
 assert.equal(calc(p).lines.filter(l=>l.kind==='inspection').length,1);
 p.fees.crCategory='openMarket';assert.equal(calc(p).total,10020);
});
test('Open Market and Medium Cost remain two separate LS despite sharing rates',()=>{
 const p=subdivision(['openMarket','mediumCost']);p.fees.licenses.openMarket.lots=2;p.fees.licenses.mediumCost.lots=3;
 assert.equal(registrationOptions(p).length,1);assert.equal(calc(p).licenseCount,2);
 assert.equal(amount(p,'license'),1080);assert.equal(amount(p,'registration'),2880);
});
test('BP220 Economic and Socialized charge 72 and 24 per lot with one selectable CR',()=>{
 const p=subdivision(['economic','socialized']);p.fees.licenses.economic.lots=10;p.fees.licenses.socialized.lots=20;
 p.fees.crCategory='economic';assert.equal(calc(p).total,6420);
 p.fees.crCategory='socialized';assert.equal(calc(p).total,6120);
 assert.equal(amount(p,'housing'),0);assert.equal(amount(p,'inspection'),4500);
});
for(const [key,cr,rate] of [['economic',720,72],['socialized',420,24]]) test(`single ${key} subdivision uses its CR and LS rates`,()=>{
 const p=subdivision([key]);p.fees.licenses[key].lots=10;assert.equal(calc(p).total,cr+rate*10+4500);
});
for(const [scheme,key,cr,residential,commercial] of [['pd957','pd957',2880,17.3,36],['economic','bp220',720,7.2,10.65],['socialized','bp220',720,7.2,10.65]]) test(`${scheme} condominium uses saleable areas and one rounded hectare inspection`,()=>{
 const p=condo(scheme);Object.assign(p.fees.licenses[key],{residentialArea:100,commercialArea:50});
 assert.equal(calc(p).total,cr+100*residential+50*commercial+4500);assert.equal(calc(p).licenseCount,1);
 assert.equal(amount(p,'housing'),0);
});
for(const ha of [0,0.000001,1,2.5,3,3.000001]) test(`inspection rounds ${ha} hectares up once for every project type`,()=>{
 for(const p of [subdivision(),subdivision(['economic']),subdivision(['socialized']),condo(),condo('economic')]){
  p.fees.inspectionHectares=ha;assert.equal(amount(p,'inspection'),Math.ceil(ha)*1500);
 }
});
test('the single CR may be omitted from an assessment without multiplying inspection or LS',()=>{
 const p=subdivision(['openMarket','socialized']);p.fees.includeRegistration=false;
 assert.equal(calc(p).crCount,0);assert.equal(calc(p).licenseCount,2);assert.equal(calc(p).total,4500);
});
test('payments, overpayments and small saleable-area amounts round to centavos',()=>{
 const p=condo('economic');p.fees.includeRegistration=false;p.fees.inspectionHectares=0;
 Object.assign(p.fees.licenses.bp220,{residentialArea:0.01,commercialArea:0.01});
 assert.equal(calc(p).total,0.18);p.fees.paid=1;assert.equal(calc(p).overpayment,0.82);assert.equal(calc(p).balance,0);
});
test('validation rejects missing classifications, illegal CR and invalid quantities',()=>{
 let p=subdivision(['economic']);p.fees.crCategory='openMarket';assert.throws(()=>calc(p),/applicable CR/);
 p=subdivision();p.fees.licenses.socialized={...p.fees.licenses.openMarket};assert.throws(()=>validateProject(p,catalog),/must match/);
 for(const value of [-1,NaN,Infinity,'2',1e11]) {p=subdivision();p.fees.inspectionHectares=value;assert.throws(()=>calc(p),/Inspection area/);}
 p=subdivision();p.fees.licenses.openMarket.lots=0.5;assert.throws(()=>calc(p),/whole number/);
 p=subdivision();p.fees.version=99;assert.throws(()=>validateProject(p,catalog),/version/);
});
test('housing floor area is required only when the PD957 housing component is selected',()=>{
 const p=subdivision();p.fees.licenses.openMarket.hasHousing=true;assert.throws(()=>calc(p),/floor area/);
 p.fees.licenses.openMarket.hasHousing=false;p.fees.licenses.openMarket.housingArea=10;assert.throws(()=>calc(p),/housing component/);
 const bp=subdivision(['economic']);bp.fees.licenses.economic.hasHousing=true;assert.throws(()=>calc(bp),/only to PD957/);
});
test('new saved assessments round-trip through backups with classification allocations',()=>{
 const p=subdivision(['openMarket','socialized']);p.fees.crCategory='socialized';p.fees.saved=true;
 p.fees.licenses.openMarket.lots=10;p.fees.licenses.socialized.lots=20;
 const restored=parseBackup(JSON.stringify({format:'crls-workspace',version:1,projects:[p]}),catalog)[0];
 assert.deepEqual(restored,p);assert.equal(calc(restored).total,7560);
});
test('legacy saved fees are preserved until explicitly replaced by the new draft',()=>{
 const p=subdivision();p.fees=defaultFees();Object.assign(p.fees,{saved:true,lots:10,housingArea:100,inspectionLots:2});
 const original=structuredClone(p.fees);const before=calc(p).total;
 const draft=prepareAssessment(p);assert.deepEqual(p.fees,original);assert.equal(calc(p).total,before);
 assert.equal(draft.saved,false);assert.equal(draft.inspectionHectares,2.5);assert.equal(draft.licenses.openMarket.lots,10);
 assert.equal(calc({...p,fees:draft}).total,10980);
});
test('legacy mixed quantities are not duplicated across each new LS',()=>{
 const p=subdivision(['openMarket','socialized']);p.fees=defaultFees();p.fees.lots=30;
 const draft=prepareAssessment(p);assert.equal(draft.licenses.openMarket.lots,0);assert.equal(draft.licenses.socialized.lots,0);
});
test('category edits reconcile only matching LS allocations and invalidate a removed CR selection',()=>{
 const p=subdivision(['openMarket','socialized']);p.fees.crCategory='socialized';p.fees.licenses.openMarket.lots=10;p.fees.licenses.socialized.lots=20;
 p.categories=['openMarket','economic'];p.fees=prepareAssessment(p);
 assert.equal(p.fees.crCategory,'');assert.equal(p.fees.licenses.openMarket.lots,10);assert.equal(p.fees.licenses.economic.lots,0);assert.equal(p.fees.licenses.socialized,undefined);
});
