const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(base, 'data.json'), 'utf8'));
const { lookup } = require('./worker-verdict.cjs');
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (p !== '/' && p !== '/index.html' && p !== '/published/data.json') { res.writeHead(404); return res.end(); }
  const file = p === '/published/data.json' ? path.join(base,'data.json') : path.join(base, p === '/' ? 'index.html' : p.slice(1));
  res.setHeader('Content-Type', p === '/published/data.json' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
  fs.createReadStream(file).pipe(res);
});
const listen = () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function apiLookup(model, apartment) {
  return lookup(data, model, apartment);
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
    for (const c of data.fieldCases || []) {
      if (!c.apartment || !c.wallpadModel) continue;
      const key = norm(c.apartment) + '|' + norm(c.wallpadModel);
      if (!unique.has(key)) {
        unique.add(key);
        cases.push({ kind: 'site', model: c.wallpadModel, apartment: c.apartment });
      }
    }
    // Compare model-only queries directly. Site queries are checked when the browser
    // and API both return a single unambiguous verdict for that exact site.
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
          verdict: el.querySelector('.verdict')?.textContent?.replace(/^[✓✕!\s]+/, '').trim() || ''
        })).filter(x => x.verdict);
      }, search);
      let actual = web[0]?.verdict || '';
      if (item.kind === 'site') {
        const exact = web.filter(x => norm(x.title) === norm(item.apartment));
        actual = exact.length === 1 ? exact[0].verdict : '';
      }
      if (!actual) { errors.push('WEB_NO_VERDICT ' + JSON.stringify(item)); continue; }
      let api;
      try { api = await apiLookup(item.model, item.apartment); }
      catch (err) { errors.push('API_ERROR ' + JSON.stringify(item) + ' ' + err.message); continue; }
      const expected = api.verdict;
      rows.push({ ...item, web: actual, api: expected });
      if (!api.found || !expected || actual !== expected) {
        errors.push('MISMATCH ' + JSON.stringify({ ...item, web: actual, api: expected, found: api.found }));
      }
    }
    fs.mkdirSync(path.join(base, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(base, 'test-results', 'candidate-parity.json'), JSON.stringify({ checked: rows.length, errors, rows }, null, 2));
    console.log('Candidate snapshot checked', rows.length, 'queries; mismatches/errors:', errors.length);
    for (const e of errors) console.error(e);
    if (errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; server.close(); });
