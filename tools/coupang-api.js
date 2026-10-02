/* 쿠팡 파트너스 Open API 호출 공용 모듈.
 * 서명 규칙이 딥링크와 상품검색에서 같으므로 한 곳에 둔다.
 *
 * Authorization: CEA algorithm=HmacSHA256, access-key=..., signed-date=..., signature=...
 *   서명 대상 = signed-date + METHOD + path + query   (query 는 '?' 를 뺀 문자열)
 *   signed-date 는 GMT 기준 yymmddTHHmmssZ
 */
'use strict';

const crypto = require('crypto');
const https = require('https');

const HOST = 'api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi/v1';

function authHeader(method, urlPath, query, accessKey, secretKey) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const signedDate =
    p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';

  const message = signedDate + method + urlPath + query;
  const sig = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${sig}`;
}

function request(method, urlPath, query, body, keys) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = {
    'Authorization': authHeader(method, urlPath, query, keys.accessKey, keys.secretKey),
    'Content-Type': 'application/json;charset=UTF-8'
  };
  if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST,
      path: urlPath + (query ? '?' + query : ''),
      method, headers, timeout: 30000
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { /* 아래에서 처리 */ }
        if (res.statusCode === 429) {
          const err = new Error('요청이 너무 잦습니다 (429)');
          err.rateLimited = true;
          return reject(err);
        }
        if (res.statusCode !== 200 || !json) {
          return reject(new Error(`HTTP ${res.statusCode} — ${raw.slice(0, 300)}`));
        }
        if (json.rCode && json.rCode !== '0') {
          return reject(new Error(`rCode ${json.rCode} — ${json.rMessage || ''}`));
        }
        resolve(json.data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('30초 안에 응답이 없음')));
    req.on('error', reject);
    req.end(payload);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 429 나 일시적 오류는 간격을 늘려가며 다시 시도한다 */
async function withRetry(fn, { tries = 3, wait = 2000, label = '' } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (i === tries) break;
      const pause = e.rateLimited ? wait * i * 2 : wait * i;
      console.warn(`    ${label} 재시도 ${i}/${tries - 1} (${Math.round(pause / 1000)}초 후) — ${e.message}`);
      await sleep(pause);
    }
  }
  throw last;
}

/* 데이터 파일을 window 에 올린다. require 가 캐시되므로 여러 번 불러도 안전하다.
 * window 를 매번 새로 만들면 앞서 올린 설정이 날아가므로 있으면 그대로 쓴다. */
function loadData() {
  if (!global.window) global.window = {};
  require('../data/affiliate.js');
  require('../data/ingredients.js');
  require('../data/recipes.js');
  return global.window;
}

/* 장보기 대상 재료 (기본 양념 제외) 와 검색어 */
function loadIngredients() {
  const w = loadData();

  const used = new Set();
  w.RECIPES.forEach(r => r.essential.concat(r.optional).forEach(i => used.add(i)));
  const staples = new Set(w.PANTRY_STAPLES);
  const terms = w.AFFILIATE.searchTerms || {};

  return [...used]
    .filter(i => !staples.has(i))
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .map(ing => ({ ing, term: terms[ing] || ing }));
}

module.exports = { BASE, request, withRetry, sleep, loadData, loadIngredients };
