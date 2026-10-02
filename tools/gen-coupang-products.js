#!/usr/bin/env node
/* 재료별로 쿠팡 상품을 찾아 data/coupang-products.js 를 만든다.
 *
 * 딥링크(검색 결과 페이지)와 달리 실제 상품으로 바로 보낸다.
 * 상품명·가격·이미지·로켓배송 여부를 함께 저장해 장보기 칸에 카드로 보여준다.
 *
 * 가격은 만든 시점의 값이다. 화면에 '언제 기준'인지 함께 표시하고,
 * 주기적으로 다시 돌려야 한다.
 *
 * 실행:
 *   COUPANG_ACCESS_KEY=... COUPANG_SECRET_KEY=... node tools/gen-coupang-products.js
 *   옵션: PER_INGREDIENT=1  (재료당 상품 수, 기본 1)
 *        GAP_MS=1200       (호출 간격)
 *        DRY_RUN=1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BASE, request, withRetry, sleep, loadIngredients } = require('./coupang-api.js');

const SEARCH_PATH = BASE + '/products/search';
const OUT = path.join(__dirname, '..', 'data', 'coupang-products.js');
const PER = Number(process.env.PER_INGREDIENT || 1);
const CANDIDATES = Number(process.env.CANDIDATES || 10);
const GAP_MS = Number(process.env.GAP_MS || 1200);

/* 검색 1위를 그냥 쓰면 대용량·도매 상품이 걸린다 (마늘 20kg 15만원).
 * 집에서 한 끼 하려는 사람에게 맞지 않는다.
 * 그렇다고 최저가를 고르면 반대로 지나치게 작은 소포장이 걸린다.
 * 그래서 후보를 넉넉히 받아 로켓배송을 우선하고, 그중 가격 중앙값을 고른다. */
function pickProducts(list, count) {
  const rocket = list.filter(p => p.rocket);
  const pool = (rocket.length >= 3 ? rocket : list).slice().sort((a, b) => a.price - b.price);
  if (!pool.length) return [];

  const mid = Math.floor((pool.length - 1) / 2);
  const picked = [pool[mid]];
  let lo = mid - 1, hi = mid + 1;
  while (picked.length < count && (lo >= 0 || hi < pool.length)) {
    if (lo >= 0) picked.push(pool[lo--]);
    if (picked.length < count && hi < pool.length) picked.push(pool[hi++]);
  }
  return picked;
}

async function search(term, keys) {
  // 서명 대상에 들어가는 query 와 실제로 보내는 query 가 같아야 한다
  const query = `keyword=${encodeURIComponent(term)}&limit=${CANDIDATES}`;
  const data = await request('GET', SEARCH_PATH, query, null, keys);
  const list = ((data && data.productData) || [])
    .map(p => ({
      name: p.productName,
      price: p.productPrice,
      image: p.productImage,
      url: p.productUrl,
      rocket: !!p.isRocket
    }))
    .filter(p => p.url && p.price > 0);
  return pickProducts(list, PER);
}

module.exports = { pickProducts };


if (require.main === module) (async () => {
  const keys = {
    accessKey: process.env.COUPANG_ACCESS_KEY,
    secretKey: process.env.COUPANG_SECRET_KEY
  };
  const targets = loadIngredients();
  console.log(`대상 재료 ${targets.length}개 · 재료당 상품 ${PER}개 · 간격 ${GAP_MS}ms`);

  if (process.env.DRY_RUN) {
    targets.slice(0, 5).forEach(t => console.log(`  ${t.ing} → "${t.term}" 로 검색`));
    console.log('  ...');
    console.log(`예상 소요: 약 ${Math.ceil(targets.length * GAP_MS / 60000)}분`);
    console.log('DRY_RUN 이므로 API 는 호출하지 않았습니다.');
    return;
  }
  if (!keys.accessKey || !keys.secretKey) {
    console.error('COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경변수가 필요합니다.');
    process.exit(1);
  }

  const products = {};
  let ok = 0, empty = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const { ing, term } = targets[i];
    try {
      const found = await withRetry(() => search(term, keys), { label: ing });
      if (found.length) { products[ing] = found; ok++; }
      else { empty++; console.warn(`  검색 결과 없음: ${ing} ("${term}")`); }
    } catch (e) {
      failed++;
      console.error(`  실패: ${ing} — ${e.message}`);
    }
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${targets.length} 진행`);
    if (i < targets.length - 1) await sleep(GAP_MS);
  }

  if (ok === 0) {
    console.error('상품을 하나도 받지 못했습니다. 파일을 쓰지 않고 종료합니다.');
    process.exit(1);
  }

  const sorted = {};
  Object.keys(products).sort((a, b) => a.localeCompare(b, 'ko')).forEach(k => sorted[k] = products[k]);

  const stamp = new Date().toISOString();
  fs.writeFileSync(OUT,
`/* 자동 생성 파일 — 직접 고치지 마세요.
 * tools/gen-coupang-products.js 가 쿠팡 파트너스 상품검색 API 로 만들어 냅니다.
 * 가격은 아래 시각 기준의 값이며 바뀔 수 있습니다. 화면에도 기준일을 함께 표시합니다.
 * 생성 시각: ${stamp}
 * 재료 ${ok}개
 */
window.COUPANG_PRODUCTS_ASOF = ${JSON.stringify(stamp.slice(0, 10))};
window.COUPANG_PRODUCTS = ${JSON.stringify(sorted, null, 2)};
`);
  console.log(`\n상품 ${ok}개 재료를 data/coupang-products.js 에 썼습니다.` +
              (empty ? ` (결과 없음 ${empty})` : '') + (failed ? ` (실패 ${failed})` : ''));
})().catch(e => { console.error('예기치 못한 오류:', e.message); process.exit(1); });
