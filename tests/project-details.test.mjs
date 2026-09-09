import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, validateProject, parseBackup, calculateFees, SCHEMES, defaultFees } from '../lib/model.js';
import { categoryLabels, projectDetailRows } from '../lib/project-details.js';
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const make = (extra = {}) => createProject({ name: 'Mixed subdivision', type: 'subdivision', scheme: 'pd957', categories: ['openMarket', 'mediumCost', 'economic', 'socialized'], application: 'TLS', tlsUndertakings: ['ecc', 'buildingPermit', 'verifiedSurveyReturns'], lotCounts: { houseAndLot: 35, lotOnly: 15 }, ...extra }, 'mixed-project');
test('mixed categories, TLS undertakings and whole-project lot counts survive backup', () => {
 const p=make(); validateProject(p,catalog);
 assert.deepEqual(parseBackup(JSON.stringify({format:'crls-workspace',version:1,projects:[p]}),catalog),[p]);
 assert.equal(categoryLabels(p,SCHEMES),'PD957 - Open Market, PD957 - Medium Cost, BP220 - Economic, BP220 - Socialized');
 assert.equal(projectDetailRows(p).find(([key])=>key==='Total lots')[1],'50');
 assert.match(projectDetailRows(p)[0][1],/Environmental Compliance Certificate, Building Permit, Verified Survey Returns/);

 assert.equal(calculateFees(p,catalog).licenseCount,4);
 assert.equal(calculateFees(p,catalog).lines.filter(l=>l.kind==='registration').length,3);
});
test('invalid categories and incompatible project classifications are rejected',()=>{
 for(const categories of [[],['unknown'],['openMarket','openMarket'],['__proto__'], 'openMarket']) assert.throws(()=>validateProject(make({categories}),catalog),/categor|classification/);
 assert.throws(()=>validateProject(make({categories:['economic']}),catalog),/classification/);
});
test('TLS requires an undertaking and other application types cannot retain TLS undertakings',()=>{
 for(const tlsUndertakings of [[],['invalid'],['ecc','ecc']]) assert.throws(()=>validateProject(make({tlsUndertakings}),catalog),/undertaking/i);
 for(const application of ['CRLS','CLS']) {
  assert.throws(()=>validateProject(make({application}),catalog),/only to TLS/);
  assert.doesNotThrow(()=>validateProject(make({application,tlsUndertakings:[]}),catalog));
 }
});
test('lot breakdown rejects fractional, negative, missing and oversized counts',()=>{
 for(const houseAndLot of [-1,0.5,NaN,Infinity,'4',1e11,undefined]) assert.throws(()=>validateProject(make({lotCounts:{houseAndLot,lotOnly:0}}),catalog),/whole numbers/);
 assert.equal(projectDetailRows(make({lotCounts:{houseAndLot:0,lotOnly:0}})).find(([key])=>key==='Total lots')[1],'0');
});
test('older project records remain readable without inventing categories or lot quantities',()=>{
 const p=make(); p.fees=defaultFees(); delete p.categories; delete p.lotCounts; delete p.tlsUndertakings;
 p.application='Certificate of Registration and License to Sell';
 assert.doesNotThrow(()=>validateProject(p,catalog));
 assert.equal(categoryLabels(p,SCHEMES),SCHEMES.pd957);
 assert.equal(projectDetailRows(p)[0][1],'Not entered');
});
