const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(base, 'published', 'data.json'), 'utf8'));
const secret = process.env.RF447_API_KEY;
if (!secret) { console.error('RF447_API_KEY GitHub Actions secret is missing.'); process.exit(2); }
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
const delay = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (p !== '/' && p !== '/index.html' && p !== '/published/data.json') { res.writeHead(404); return res.end(); }
  const file = path.join(base, p === '/' ? 'index.html' : p.slice(1));
  res.setHeader('Content-Type', p === '/published/data.json' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
  fs.createReadStream(file).pipe(res);
});
const listen = () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function apiLookup(model, apartment) {
  const url = new URL('https://aqara-rf447-api.siyeol.workers.dev/v1/lookup');
  if (model) url.searchParams.set('model', model);
  if (apartment) url.searchParams.set('apartment', apartment);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { Authorization: 'Bearer ' + secret }, signal: AbortSignal.timeout(20000) });
      if (response.ok) return await response.json();
      if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error('API HTTP ' + response.status);
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await delay(1000 * (attempt + 1));
  }
  throw new Error('API retry exhausted');
}
(async () => {
  await listen();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!document.querySelector('#model') && !!document.querySelector('#search'));
    const cases = [];
    for (const r of data.records) cases.push({ kind: 'model', model: r.model, apartment: '' });
    const unique = new Set();
    // Include apartment-only records and verify the same apartment-only query on both sides.
    for (const c of data.fieldCases || []) {
      if (!c.apartment) continue;
      const key = 'apartment|' + norm(c.apartment);
      if (!unique.has(key)) {
        unique.add(key);
        cases.push({ kind: 'apartment', model: '', apartment: c.apartment });
      }
    }
    // Compare identical single-input queries supported by the web UI.
    // Combined model/apartment API rules are covered separately by worker regression tests.
    const errors = [];
    const rows = [];
    for (const item of cases) {
      const search = item.kind === 'model' ? item.model : item.apartment;
      const web = await page.evaluate(value => {
        const input = document.querySelector('#model');
        input.value = value;
        document.querySelector('#search').click();
        return [...document.querySelectorAll('#results .result')].map(el => ({
          title: el.querySelector('h3')?.textContent?.trim() || '',
          explanation: el.querySelector('.model-explanation')?.textContent?.trim() || '',
          verdict: el.querySelector('.verdict')?.textContent?.replace(/^[✓✕!\s]+/, '').trim() || ''
        })).filter(x => x.verdict);
      }, search);
      let actual = web[0]?.verdict || '';
      if (item.kind === 'apartment') {
        const exact = web.filter(x => norm(x.title) === norm(item.apartment));
        actual = exact.length === 1 ? exact[0].verdict : '';
      }
      if (!actual) { errors.push('WEB_NO_VERDICT ' + JSON.stringify(item)); continue; }
      let api;
      try { api = await apiLookup(item.model, item.apartment); }
      catch (err) { errors.push('API_ERROR ' + JSON.stringify(item) + ' ' + err.message); continue; }
      const expected = api.verdict;
      if (item.kind === 'model') {
        const record = data.records.find(r => norm(r.model) === norm(item.model));
        const expectedNote = record?.status === 'installer_possible' && record?.assessmentReview?.category === 'experience_report'
          ? '설치기사의 연동 가능 의견이 있습니다. 실제 설치 완료 사례와 접점 구성은 추가 확인이 필요합니다.'
          : record?.note || null;
        // Compare directly where the web intentionally displays the standard note.
        // Special site-dependent renderers and technical/caution blocks are separate.
        if (record?.status === 'installer_possible' && record?.assessmentReview?.category === 'experience_report' && !record.installationCaution) {
          if (web[0]?.explanation !== api.model?.note) errors.push('WEB_API_NOTE_MISMATCH ' + JSON.stringify({model:item.model, web:web[0]?.explanation, api:api.model?.note}));
        }
        if (api.model?.note !== expectedNote) {
          errors.push('API_NOTE_MISMATCH ' + JSON.stringify({model:item.model, expected:expectedNote, actual:api.model?.note}));
        }
      }
      rows.push({ ...item, web: actual, api: expected });
      if (!api.found || !expected || actual !== expected) {
        errors.push('MISMATCH ' + JSON.stringify({ ...item, web: actual, api: expected, found: api.found }));
      }
    }
    fs.mkdirSync(path.join(base, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(base, 'test-results', 'parity.json'), JSON.stringify({ checked: rows.length, errors, rows }, null, 2));
    console.log('Checked', rows.length, 'queries; mismatches/errors:', errors.length);
    for (const e of errors) console.error(e);
    if (errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; server.close(); });
