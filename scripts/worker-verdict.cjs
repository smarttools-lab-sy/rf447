// Extracted from the deployed RF447 Worker. Keep verdict logic aligned with worker.js.
const norm = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
const SUCCESS = new Set(['site_report', 'compatible', 'special_installation']);
const FAILURE = new Set(['site_failure', 'incompatible']);
const REPORTED = new Set(['compatible_reported']);
const SPECIAL = new Set(['special_installation', 'site_special_review']);
const verdictLabel = style => style === 'danger' ? 'RF447 연동 불가' : style === 'caution' ? 'RF447 연동 확인 필요' : 'RF447 연동 가능성 높음';
function riskyApartment(apartment) {
  return !!apartment && /자이|XI|GS건설|포스코|POSCO|더샵|THESHARP/.test(norm(apartment));
}
function siteRecords(db) {
  const reported = (db.records || []).flatMap(r => {
    const sites = [
      ...(r.site ? [{site:r.site, reportedOn:r.reportedOn, sourceType:r.sourceType}] : []),
      ...(r.siteReports || []).filter(s => s.status === 'compatible')
    ];
    return sites.map(s => ({
      apartment:s.site || null, wallpadBrand:r.brand || null, wallpadModel:r.model,
      assessment:'compatible_reported',
      evidence:r.note || '해당 단지의 RF447 연동 가능 제보가 있습니다.',
      sourceType:s.sourceType || r.sourceType || '현장 제보',
      publishedOn:s.reportedOn || r.reportedOn || null, source:r.source || null
    }));
  });
  return [...(db.fieldCases || []), ...reported];
}
function caseMatches(c, q, a) {
  const apt = norm(c.apartment), addr = norm(c.address), model = norm(c.wallpadModel), brand = norm(c.wallpadBrand);
  const inMain = !q || [apt,addr,model,brand].some(v => v && v.includes(q)) || (q.length >= 4 && apt && q.includes(apt));
  const inApt = !a || (addr && addr.includes(a)) || (apt && apt.includes(a)) || (a.length >= 4 && apt && a.includes(apt));
  return !!(inMain && inApt);
}
function summarizeCases(cases) {
  const byAssessment = {};
  for (const c of cases) byAssessment[c.assessment || 'unknown'] = (byAssessment[c.assessment || 'unknown'] || 0) + 1;
  const uniqueSites = values => [...new Set(values.map(c => norm(c.apartment)).filter(Boolean))].length;
  const successes = cases.filter(c => SUCCESS.has(c.assessment));
  const failures = cases.filter(c => FAILURE.has(c.assessment));
  const reported = cases.filter(c => REPORTED.has(c.assessment));
  const special = cases.filter(c => SPECIAL.has(c.assessment));
  return {
    recordCount:cases.length, successRecordCount:successes.length, failureRecordCount:failures.length,
    reportedPossibleCount:reported.length, specialCaseCount:special.length,
    uniqueSuccessApartments:uniqueSites(successes), uniqueFailureApartments:uniqueSites(failures), byAssessment
  };
}
function modelVerdict(r, apartment, allCases) {
  const a = norm(apartment);
  let style = 'caution', underlying = 'RF447 호환 여부 확인 필요';
  if (r.model === 'HDHN-4000') {
    style = 'caution'; underlying = 'RF447 연동 가능성 높음 (기사 제보 기준)';
  } else if (r.model === 'DMHNT-4105Y-W') {
    const reports = (r.siteReports || []).filter(s => s.status === 'compatible');
    const site = reports.find(s => a && norm(s.site) === a);
    if (site) { style = ''; underlying = 'RF447 연동 가능'; }
    else if (riskyApartment(apartment)) { style = 'caution'; underlying = 'RF447 연동 어려움'; }
    else { style = ''; underlying = 'RF447 연동 가능성 높음'; }
  } else if (r.status === 'aged_site_inspection') {
    style = 'caution'; underlying = 'RF447 호환 여부 확인 필요';
  } else if (r.status === 'site_report') {
    style = ''; underlying = 'RF447 연동 가능성 높음';
  } else if (r.status === 'conditional' && r.model === 'CDP-1020PB') {
    const blocked = a && /방배/.test(a) && /롯데캐슬|아르떼/.test(a);
    style = blocked ? 'danger' : 'caution';
    underlying = blocked ? '해당 아파트 전용 사양 · RF447 연동 불가' : '일반 사양 RF447 연동 가능 · 아파트 전용 사양 주의';
  } else if (r.model === 'EHW-1051') {
    style = 'caution'; underlying = '일반 설치 불가 안내 · 개별 현장 성공 사례 있음';
  } else if (r.status === 'catalog_unverified') {
    style = 'caution'; underlying = 'RF447 호환 여부 확인 필요';
  } else if (r.status === 'installer_possible') {
    style = ''; underlying = '기사 1차 의견: 연동 가능 · 현장 확인 필요';
  } else if (r.status === 'listed_compatible') {
    style = ''; underlying = 'RF447 호환 목록에 등록된 모델';
  } else if (r.status === 'incompatible') {
    style = 'danger'; underlying = 'RF447 연동 불가 정보 있음';
  }
  if (r.assessmentReview?.category === 'technical_review' && r.status !== 'listed_compatible') {
    style = 'caution'; underlying = '기술자료상 연동 검토 가능';
  }
  const actualSuccess = allCases.some(c => norm(c.wallpadModel) === norm(r.model) && SUCCESS.has(c.assessment));
  const originallyNegative = style === 'danger' || r.status === 'incompatible';
  const negative = originallyNegative && !actualSuccess;
  const uncertain = !negative && (
    originallyNegative || style === 'caution' ||
    ['catalog_unverified', 'aged_site_inspection', 'conditional'].includes(r.status)
  );
  return { verdict:verdictLabel(negative ? 'danger' : uncertain ? 'caution' : ''), underlyingAssessment:underlying };
}
function apartmentVerdict(cases, isXi) {
  const failures = cases.filter(c => FAILURE.has(c.assessment));
  const successes = cases.filter(c => SUCCESS.has(c.assessment));
  const uncertainty = cases.some(c => ['site_special_review','special_installation','compatible_reported'].includes(c.assessment));
  if (failures.length && successes.length) return {verdict:'RF447 연동 확인 필요',reason:'성공 및 실패 기록이 함께 있어 현장 확인이 필요합니다.'};
  if (failures.length && !isXi) return {verdict:'RF447 연동 확인 필요',reason:'해당 아파트의 연동 실패·불가 이력이 확인됩니다.'};
  if (successes.length && !uncertainty) return {verdict:'RF447 연동 가능성 높음',reason:'해당 아파트의 연동 성공 기록이 있습니다.'};
  return {verdict:'RF447 연동 확인 필요',reason:'해당 아파트의 연동 조건 및 설치 가능 여부는 현장 확인이 필요합니다.'};
}
function isXiSearch(raw) {
  const s = String(raw || '').trim();
  return /자이(?!언트|로|언)/.test(s) || /(?:^|[^A-Za-z])Xi(?:아파트|단지|\d|\s)/i.test(s);
}
function lookup(db, model, apartment) {
  const q = norm(model), a = norm(apartment);
  const r = q ? (db.records || []).find(x => norm(x.model) === q || (x.aliases || []).some(alias => norm(alias) === q)) : null;
  const allCases = siteRecords(db);
  const cases = r ? allCases.filter(c => caseMatches(c, norm(r.model), a)) : allCases.filter(c => caseMatches(c, q || a, q ? a : ''));
  const base = {found:!!r || cases.length > 0, query:model || null, apartment:apartment || null, dataUpdated:db.updated || null};
  if (r) return {...base, ...modelVerdict(r, apartment, allCases)};
  if (cases.length) return {...base, ...apartmentVerdict(cases, isXiSearch(model || apartment))};
  return {...base, result:'정보 없음'};
}
module.exports = {norm,siteRecords,modelVerdict,apartmentVerdict,lookup};
