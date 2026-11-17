const fs = require('node:fs');
const db = JSON.parse(fs.readFileSync('data.json','utf8'));
const issues = [];
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
const required = (condition, message) => { if (!condition) issues.push(message); };
required(Array.isArray(db.records) && db.records.length > 0, 'records must be a nonempty array');
required(Array.isArray(db.fieldCases), 'fieldCases must be an array');
const models = new Set();
for (const [i,r] of (db.records || []).entries()) {
  required(typeof r.model === 'string' && r.model.trim(), 'records['+i+'] missing model');
  const key = norm(r.model);
  required(!models.has(key), 'duplicate model: '+r.model);
  models.add(key);
  required(typeof r.status === 'string' && r.status.trim(), 'missing status for '+r.model);
}
const success = new Set(['site_report','compatible','special_installation']);
const failed = new Set(['site_failure','incompatible']);
for (const [i,c] of (db.fieldCases || []).entries()) {
  // A field case can be apartment-only, model-only, or an unlocated public report.
  // Do not invent unknown identifiers. Require evidence and source for unlocated reports.
  const hasApartment = typeof c.apartment === 'string' && !!c.apartment.trim();
  const hasModel = typeof c.wallpadModel === 'string' && !!c.wallpadModel.trim();
  required(typeof c.assessment === 'string' && !!c.assessment.trim(), 'fieldCases['+i+'] missing assessment');
  if (!hasApartment && !hasModel) {
    required(typeof c.evidence === 'string' && !!c.evidence.trim(), 'fieldCases['+i+'] unidentified report missing evidence');
    required(typeof c.source === 'string' && !!c.source.trim(), 'fieldCases['+i+'] unidentified report missing source');
  }
}
for (const r of db.records || []) {
  if (r.status !== 'incompatible') continue;
  const matching = (db.fieldCases || []).filter(c => norm(c.wallpadModel) === norm(r.model) && success.has(c.assessment));
  if (matching.length) issues.push('model '+r.model+' is incompatible despite confirmed successful field cases');
}
console.log('RF447 DB preflight:', (db.records || []).length, 'models,', (db.fieldCases || []).length, 'field cases;', issues.length, 'issues');
issues.forEach(x => console.error('ERROR:',x));
if (issues.length) process.exit(1);
