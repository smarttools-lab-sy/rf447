const fs=require('node:fs');
const assert=require('node:assert/strict');
const {lookup,modelVerdict}=require('./worker-verdict.cjs');
const db=JSON.parse(fs.readFileSync('data.json','utf8'));
const cases=[
  ['EHW-1051','', 'RF447 연동 확인 필요'],
  ['CDP-1020PB','방배 롯데캐슬 아르떼','RF447 연동 불가'],
  ['DMHNT-4105Y-W','자이','RF447 연동 확인 필요'],
  ['DMHNT-4105Y-W','동탄역 경남아너스빌','RF447 연동 확인 필요'],
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


const validVerdicts=new Set(['RF447 연동 가능성 높음','RF447 연동 확인 필요','RF447 연동 불가']);
const successTypes=new Set(['site_report','compatible','special_installation']);
let checked=0;
for(const record of db.records){
  const result=lookup(db,record.model,'');
  assert.equal(result.found,true,'model lookup missing: '+record.model);
  assert.ok(validVerdicts.has(result.verdict),'invalid model verdict: '+record.model);
  const confirmed=(db.fieldCases||[]).some(c=>
    String(c.wallpadModel||'').toUpperCase().replace(/[^A-Z0-9가-힣]/g,'')===
    String(record.model||'').toUpperCase().replace(/[^A-Z0-9가-힣]/g,'') &&
    successTypes.has(c.assessment)
  );
  if(confirmed) assert.notEqual(result.verdict,'RF447 연동 불가','confirmed success incorrectly blocked: '+record.model);
  checked++;
}
for(const fieldCase of db.fieldCases||[]){
  if(!fieldCase.wallpadModel && !fieldCase.apartment) continue;
  const result=lookup(db,fieldCase.wallpadModel||'',fieldCase.apartment||'');
  const label = [fieldCase.wallpadModel, fieldCase.apartment].filter(Boolean).join(' / ');
  assert.equal(result.found,true,'field-case lookup missing: '+label);
  assert.ok(validVerdicts.has(result.verdict),'invalid field-case verdict: '+label);
  if(fieldCase.apartment){
    const apartmentOnly=lookup(db,'',fieldCase.apartment);
    assert.equal(apartmentOnly.found,true,'apartment lookup missing: '+fieldCase.apartment);
    assert.ok(validVerdicts.has(apartmentOnly.verdict),'invalid apartment verdict: '+fieldCase.apartment);
    checked++;
  }
  checked++;
}
console.log('Full candidate Worker verdict sweep passed:',checked,'model and field-case queries');
