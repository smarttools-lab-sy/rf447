const fs=require('node:fs');
const assert=require('node:assert/strict');
const {lookup,modelVerdict}=require('./worker-verdict.cjs');
const db=JSON.parse(fs.readFileSync('data.json','utf8'));
const cases=[
  ['EHW-1051','', 'RF447 연동 확인 필요'],
  ['CDP-1020PB','방배 롯데캐슬 아르떼','RF447 연동 불가'],
  ['DMHNT-4105Y-W','자이','RF447 연동 확인 필요'],
  ['DMHNT-4105Y-W','동탄역 경남아너스빌','RF447 연동 가능성 높음'],
  ['HDHN-4000','송도','RF447 연동 확인 필요']
];
for(const [model,apartment,expected] of cases){
 const actual=lookup(db,model,apartment);
 assert.equal(actual.found,true,model+' not found');
 assert.equal(actual.verdict,expected,model+' / '+apartment);
}
const r={model:'TEST-SUCCESS',status:'incompatible'};
assert.equal(modelVerdict(r,'',[{wallpadModel:r.model,assessment:'site_report'}]).verdict,'RF447 연동 확인 필요');
assert.equal(modelVerdict(r,'',[{wallpadModel:r.model,assessment:'compatible_reported'}]).verdict,'RF447 연동 불가');
console.log('Candidate Worker verdict smoke tests passed:',cases.length+2);
