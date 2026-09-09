import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, calculateFees, validateProject, parseBackup, defaultFees } from '../lib/model.js';
import { prepareAssessment, registrationGroups, FEE_VERSION } from '../lib/fee-schedule.js';
import { prepareAssessment as prepareV2 } from '../lib/fee-schedule-v2.js';
const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8'));
function sub(categories=['economic'],extra={}) {
 const scheme=['openMarket','mediumCost'].includes(categories[0])?'pd957':categories[0];
 return createProject({name:'Revised fees',type:'subdivision',scheme,categories,projectArea:25000,...extra},'revision-test');
}
const calc=p=>calculateFees(p,catalog);
const charge=(p,kind)=>calc(p).lines.filter(l=>l.kind===kind).reduce((sum,l)=>sum+l.amount,0);
for(const [key,rate,total] of [['economic',72,6672],['socialized',24,5892]]) test(`${key} LS includes saleable lots and PHP 3 per square metre of floor area`,()=>{
 const p=sub([key]);Object.assign(p.fees.licenses[key],{lots:10,hasHousing:true,housingArea:100});
 assert.equal(calc(p).total,total);assert.equal(charge(p,'license'),rate*10);assert.equal(charge(p,'housing'),300);
 assert.equal(charge(p,'crForm'),216);assert.equal(charge(p,'lsForm'),216);
});
test('Economic and Socialized have separate CR and LS charges, with forms for both',()=>{
 const p=sub(['economic','socialized']);
 Object.assign(p.fees.licenses.economic,{lots:10,hasHousing:true,housingArea:100});
 Object.assign(p.fees.licenses.socialized,{lots:20,hasHousing:true,housingArea:200});
 const result=calc(p);assert.equal(result.total,8604);assert.equal(result.crCount,2);assert.equal(result.licenseCount,2);
 assert.equal(charge(p,'registration'),1140);assert.equal(charge(p,'license'),1200);assert.equal(charge(p,'housing'),900);
 assert.equal(p.fees.crForms,2);assert.equal(p.fees.lsForms,2);
 assert.deepEqual(result.lines.filter(l=>l.kind==='registration').map(l=>l.rate),[720,420]);
});
test('PD957 plus both BP220 classifications charges each CR and keeps inspection once',()=>{
 const p=sub(['openMarket','economic','socialized']);
 Object.assign(p.fees.licenses.openMarket,{lots:5,hasHousing:true,housingArea:50});
 Object.assign(p.fees.licenses.economic,{lots:10,hasHousing:true,housingArea:100});
 Object.assign(p.fees.licenses.socialized,{lots:20,hasHousing:true,housingArea:200});
 assert.equal(calc(p).total,13716);assert.equal(calc(p).crCount,3);assert.equal(calc(p).licenseCount,3);
 assert.equal(calc(p).lines.filter(l=>l.kind==='inspection').length,1);assert.equal(charge(p,'inspection'),4500);
});
test('Open Market and Medium Cost retain one PD957 CR and two LS classifications',()=>{
 const p=sub(['openMarket','mediumCost']);assert.equal(registrationGroups(p).length,1);
 assert.equal(calc(p).crCount,1);assert.equal(calc(p).licenseCount,2);assert.equal(p.fees.crForms,1);assert.equal(p.fees.lsForms,2);
 assert.equal(calc(p).total,8028);
});
test('form quantities are editable and each CR or LS form costs PHP 216',()=>{
 const p=sub();p.fees.registrations.economic=false;p.fees.includeRegistration=false;p.fees.inspectionHectares=0;
 p.fees.crForms=3;p.fees.lsForms=5;p.fees.paid=2000;
 assert.equal(calc(p).total,1728);assert.equal(calc(p).overpayment,272);assert.equal(calc(p).balance,0);
 for(const key of ['crForms','lsForms']) for(const invalid of [-1,0.5,NaN,Infinity,'2',1e11]) {
  const invalidP=structuredClone(p);invalidP.fees[key]=invalid;assert.throws(()=>validateProject(invalidP,catalog),/form count/);
 }
});
test('lot-only BP220 classifications do not incur the housing component fee',()=>{
 const p=sub(['economic'],{lotCounts:{houseAndLot:0,lotOnly:10}});p.fees.licenses.economic.lots=10;
 assert.equal(charge(p,'housing'),0);assert.equal(calc(p).total,6372);
 p.fees.licenses.economic.hasHousing=true;p.fees.licenses.economic.housingArea=100;assert.throws(()=>calc(p),/no House and Lot/);
});
for(const [scheme,key,total] of [['pd957','pd957',11342],['economic','bp220',6904.5]]) test(`${scheme} condominium area rates remain unchanged and include form charges`,()=>{
 const p=createProject({name:'Condo',type:'condominium',scheme,projectArea:25000},'condo');
 Object.assign(p.fees.licenses[key],{residentialArea:100,commercialArea:50});
 assert.equal(calc(p).total,total);assert.equal(charge(p,'housing'),0);assert.equal(calc(p).crCount,1);
});
test('saved revised fees survive backup restoration',()=>{
 const p=sub(['economic','socialized']);p.fees.saved=true;p.fees.licenses.economic.lots=10;p.fees.licenses.socialized.lots=20;
 const restored=parseBackup(JSON.stringify({format:'crls-workspace',version:1,projects:[p]}),catalog)[0];
 assert.deepEqual(restored,p);assert.equal(calc(restored).total,calc(p).total);assert.equal(restored.fees.version,FEE_VERSION);
});
test('version 2 saved totals stay unchanged until the revised assessment is saved',()=>{
 const p=sub(['openMarket','socialized']);p.fees=prepareV2({...p,fees:defaultFees()});
 p.fees.crCategory='socialized';p.fees.licenses.openMarket.lots=10;p.fees.licenses.socialized.lots=20;p.fees.saved=true;
 const original=structuredClone(p);assert.equal(calc(p).total,7560);
 const draft=prepareAssessment(p);assert.deepEqual(p,original);assert.equal(draft.saved,false);assert.equal(draft.version,3);
 assert.equal(draft.licenses.openMarket.lots,10);assert.equal(draft.licenses.socialized.lots,20);
 assert.equal(calc({...p,fees:draft}).total,11304);
 assert.deepEqual(parseBackup(JSON.stringify({format:'crls-workspace',version:1,projects:[p]}),catalog)[0],p);
});
test('a previous BP220 housing project prompts for its new housing floor area',()=>{
 const p=sub(['economic'],{lotCounts:{houseAndLot:10,lotOnly:0}});p.fees=prepareV2({...p,fees:defaultFees()});
 const f=prepareAssessment(p);assert.equal(f.licenses.economic.hasHousing,true);assert.throws(()=>calc({...p,fees:f}),/floor area/);
});
test('reopening assessments preserves adjusted form counts',()=>{
 const p=sub(['economic','socialized']);p.fees.crForms=4;p.fees.lsForms=6;
 const f=prepareAssessment(p);assert.equal(f.crForms,4);assert.equal(f.lsForms,6);
});
test('classification changes update default form counts and preserve matching LS quantities',()=>{
 const p=sub(['economic']);p.fees.licenses.economic.lots=10;p.categories=['economic','socialized'];
 p.fees=prepareAssessment(p);assert.equal(p.fees.crForms,2);assert.equal(p.fees.lsForms,2);assert.equal(p.fees.licenses.economic.lots,10);
 assert.equal(p.fees.licenses.socialized.lots,0);assert.doesNotThrow(()=>validateProject(p,catalog));
});
test('invalid and missing CR classifications are rejected',()=>{
 for(const registrations of [{economic:true,pd957:true},{},{economic:1},{economic:true,socialized:true}]) {
  const p=sub();p.fees.registrations=registrations;assert.throws(()=>validateProject(p,catalog),/CR/);
 }
});
