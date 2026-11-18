// Negative safety tests use disposable copies; production files are never modified.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const validator = path.resolve(__dirname, 'validate-db.cjs');
const source = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data.json'), 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rf447-negative-'));
function check(name, change, shouldPass) {
  const fixture = structuredClone(source);
  change(fixture);
  fs.writeFileSync(path.join(temp, 'data.json'), JSON.stringify(fixture));
  const result = spawnSync(process.execPath, [validator], { cwd: temp, encoding: 'utf8' });
  assert.equal(result.status === 0, shouldPass, name + ': unexpected validator outcome\n' + result.stdout + result.stderr);
  console.log('PASS:', name);
}
try {
  check('valid current candidate', () => {}, true);
  check('missing model', d => { d.records[0].model = ''; }, false);
  check('duplicate model', d => { d.records[1].model = d.records[0].model; }, false);
  check('missing field-case assessment', d => { d.fieldCases[0].assessment = ''; }, false);
  check('confirmed successful model cannot be incompatible', d => {
    const r = d.records[0];
    r.status = 'incompatible';
    d.fieldCases.push({ wallpadModel: r.model, apartment: 'TEST ONLY', assessment: 'site_report', evidence: 'TEST ONLY' });
  }, false);
  console.log('All negative safety checks passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
