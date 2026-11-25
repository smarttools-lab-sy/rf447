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
  if (p === '/published/data.json') {
    const fixture = {model:'RF447-TEST-FIXTURE-98765',brand:'TEST',status:'installer_possible',note:'검증 전용 개별 참고사항',assessmentReview:{category:'experience_report'}};
    return res.end(JSON.stringify({...data,records:[...data.records,fixture]}));
  }
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
          body: el.textContent || '',
          technical: el.querySelector('.technical-evidence')?.textContent || '',
          links: [...el.querySelectorAll('.technical-evidence a')].map(a=>a.href),
          cautions: [...el.querySelectorAll('.installation-caution')].map(x=>x.textContent),
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
        // For ordinary model renderers compare the visible primary explanation
        // after removing the technical appendix and separately rendered caution.
        const specialRenderer = ['DMHNT-4105Y-W','CDP-1020PB','EHW-1051'].includes(record?.model) || record?.status === 'site_report';
        if (record && !specialRenderer) {
          const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
          let visibleExpected = String(expectedNote || '').split('\n기술자료:')[0];
          if (record.installationCaution?.note) visibleExpected = visibleExpected.replace(record.installationCaution.note, '');
          if (normalizeText(web[0]?.explanation) !== normalizeText(visibleExpected)) {
            errors.push('WEB_PRIMARY_NOTE_MISMATCH ' + JSON.stringify({model:item.model, expected:visibleExpected, actual:web[0]?.explanation}));
          }
        }
        const compact = v => String(v || '').replace(/\s+/g,'');
        const contains = (hay,needle) => compact(hay).includes(compact(needle));
        const card = web[0];
        const requireText = (hay,needle,label) => {
          if (needle && !contains(hay,needle)) errors.push(label+' '+JSON.stringify({model:item.model,missing:needle}));
        };
        const t = record?.technicalEvidence;
        if (t?.contactVerified === true) {
          for (const key of ['contactMethod','terminals','summary','limitations']) requireText(card.technical,t[key],'TECHNICAL_MISSING');
          for (const source of t.sources || []) if (/^https?:\/\//i.test(source.url || '') && !card.links.includes(new URL(source.url).href)) errors.push('TECHNICAL_LINK_MISSING '+item.model);
        }
        requireText(card.cautions.join(' '),record?.installationCaution?.note,'CAUTION_MISSING');
        if (item.model === 'CDP-1020PB') {
          for (const needle of ['방배 롯데캐슬 아르떼','연동 불가']) {
            requireText(card.body,needle,'SPECIAL_WEB_MISSING');
            requireText(api.model?.note,needle,'SPECIAL_API_MISSING');
          }
        }
        if (item.model === 'EHW-1051') {
          requireText(card.body,'일반 설치 불가','SPECIAL_WEB_MISSING');
          requireText(api.specialInstallationWarning,'일반 설치 불가','SPECIAL_API_MISSING');
          for (const c of data.fieldCases || []) if (norm(c.wallpadModel)==='EHW1051' && ['site_report','compatible','special_installation'].includes(c.assessment) && c.apartment) {
            requireText(card.body,c.apartment,'SPECIAL_SITE_MISSING');
            if (!api.fieldCases?.some(x=>norm(x.apartment)===norm(c.apartment))) errors.push('SPECIAL_API_SITE_MISSING '+c.apartment);
          }
        }
        if (item.model === 'DMHNT-4105Y-W') {
          for (const needle of ['자이','포스코']) {
            requireText(card.body,needle,'SPECIAL_WEB_MISSING');
            requireText(api.model?.note,needle,'SPECIAL_API_MISSING');
          }
          for (const report of record.siteReports || []) if(report.status==='compatible') requireText(card.body,report.site,'SPECIAL_SITE_MISSING');
        }
        if (record?.status === 'site_report') {
          requireText(card.body,'현장 확인','SITE_SCOPE_MISSING');
          requireText(card.body,record.site,'SITE_NAME_MISSING');
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
    const fixtureResult = await page.evaluate(() => {
      document.querySelector('#model').value='RF447-TEST-FIXTURE-98765';
      document.querySelector('#search').click();
      const card=document.querySelector('#results .result');
      return {note:card?.querySelector('.model-explanation')?.textContent?.trim(),body:card?.textContent||''};
    });
    if (fixtureResult.note !== '설치기사의 연동 가능 의견이 있습니다. 실제 설치 완료 사례와 접점 구성은 추가 확인이 필요합니다.' || !fixtureResult.body.includes('검증 전용 개별 참고사항')) errors.push('NEW_MODEL_STANDARDIZATION_FAILED');
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
