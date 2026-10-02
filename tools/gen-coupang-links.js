#!/usr/bin/env node
/* 쿠팡 파트너스 Open API 로 재료별 딥링크를 미리 만들어 둔다.
 *
 * 왜 이렇게 하나:
 *   Open API 는 SECRET KEY 로 HMAC 서명을 요구한다. 이 앱은 서버가 없는 정적
 *   사이트라서, 브라우저에서 API 를 부르려면 비밀키를 소스에 넣어야 하고
 *   그 순간 전 세계에 공개된다. 그래서 '빌드할 때 한 번' 서버(Actions 러너)에서
 *   링크를 만들어 파일로 떨어뜨리고, 브라우저는 그 결과만 읽는다.
 *   비밀키는 GitHub Secrets 에만 있고 배포되는 파일에는 들어가지 않는다.
 *
 * 실행:
 *   COUPANG_ACCESS_KEY=... COUPANG_SECRET_KEY=... node tools/gen-coupang-links.js
 *   옵션: COUPANG_SUB_ID=app   (하위 채널 구분용)
 *        DRY_RUN=1            (API 호출 없이 대상 목록만 출력)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BASE, request, withRetry, sleep, loadData, loadIngredients } = require('./coupang-api.js');

const API_PATH = BASE + '/deeplink';
const OUT = path.join(__dirname, '..', 'data', 'coupang-links.js');
const BATCH = 20;          // 한 번에 보낼 URL 수
const GAP_MS = 1200;       // 호출 사이 간격 (레이트리밋 회피)

function callApi(urls, keys, subId) {
  const body = subId ? { coupangUrls: urls, subId } : { coupangUrls: urls };
  return request('POST', API_PATH, '', body, keys).then(d => d || []);
}

/* ── 대상 재료 모으기 ──────────────────────── */

function loadTargets() {
  const base = loadData().AFFILIATE.searchBase;
  return loadIngredients().map(({ ing, term }) => ({
    ing,
    url: `${base}?q=${encodeURIComponent(term)}&channel=user`
  }));
}

/* ── 실행 ─────────────────────────────────── */

(async () => {
  const keys = {
    accessKey: process.env.COUPANG_ACCESS_KEY,
    secretKey: process.env.COUPANG_SECRET_KEY
  };
  const subId = process.env.COUPANG_SUB_ID || '';

  const targets = loadTargets();
  console.log(`대상 재료 ${targets.length}개`);

  if (process.env.DRY_RUN) {
    targets.slice(0, 5).forEach(t => console.log('  ' + t.ing + ' → ' + decodeURIComponent(t.url)));
    console.log('  ...');
    console.log('DRY_RUN 이므로 API 는 호출하지 않았습니다.');
    return;
  }
  if (!keys.accessKey || !keys.secretKey) {
    console.error('COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경변수가 필요합니다.');
    process.exit(1);
  }

  const links = {};
  let failed = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    const label = `${i + 1}~${Math.min(i + BATCH, targets.length)}`;
    try {
      const data = await withRetry(() => callApi(chunk.map(t => t.url), keys, subId), { label: label });
      // 응답이 요청 순서를 지킨다는 보장이 없으므로 originalUrl 로 되짚는다
      const byUrl = {};
      data.forEach(d => { if (d.originalUrl) byUrl[d.originalUrl] = d.shortenUrl || d.landingUrl; });
      chunk.forEach((t, n) => {
        const link = byUrl[t.url] || (data[n] && (data[n].shortenUrl || data[n].landingUrl));
        if (link) links[t.ing] = link;
        else { failed++; console.warn(`  링크 없음: ${t.ing}`); }
      });
      console.log(`  ${label} 완료 (${data.length}개 응답)`);
    } catch (e) {
      failed += chunk.length;
      console.error(`  ${label} 실패 — ${e.message}`);
    }
    if (i + BATCH < targets.length) await sleep(GAP_MS);
  }

  const got = Object.keys(links).length;
  if (got === 0) {
    console.error('링크를 하나도 받지 못했습니다. 파일을 쓰지 않고 종료합니다.');
    process.exit(1);
  }

  const sorted = {};
  Object.keys(links).sort((a, b) => a.localeCompare(b, 'ko')).forEach(k => sorted[k] = links[k]);

  const out =
`/* 자동 생성 파일 — 직접 고치지 마세요.
 * tools/gen-coupang-links.js 가 쿠팡 파트너스 Open API 로 만들어 냅니다.
 * 다시 만들려면: Actions 탭 → '쿠팡 딥링크 생성' → Run workflow
 * 생성 시각: ${new Date().toISOString()}
 * 재료 ${got}개
 */
window.COUPANG_LINKS = ${JSON.stringify(sorted, null, 2)};
`;
  fs.writeFileSync(OUT, out);
  console.log(`\n${got}개 링크를 data/coupang-links.js 에 썼습니다.` + (failed ? ` (실패 ${failed}개)` : ''));
})().catch(e => { console.error('예기치 못한 오류:', e.message); process.exit(1); });
