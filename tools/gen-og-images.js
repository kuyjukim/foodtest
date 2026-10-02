#!/usr/bin/env node
/* 레시피별 공유 이미지를 만든다.
 *
 * 왜: 지금은 125개 레시피가 전부 같은 og.png 를 쓴다. 카카오톡에 감자탕을
 *     공유하든 김밥을 공유하든 똑같은 그림이 뜨니 눌러볼 이유가 없다.
 *
 * 실행: node tools/gen-og-images.js          (전부)
 *       node tools/gen-og-images.js japchae  (하나만, 모양 확인용)
 *
 * 결과물은 og/<id>.png 로 저장되고 커밋한다. 매 배포마다 돌리기엔 느려서
 * 레시피가 바뀌었을 때만 손으로 돌린다. 이미지가 없는 레시피는
 * 기본 og.png 로 자동으로 넘어가므로 중간에 멈춰도 깨지지 않는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'og');
const SITE = fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim();

global.window = {};
require('../data/recipes.js');
const RECIPES = global.window.RECIPES;

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* 평평한 색으로 그린다. 그라데이션을 쓰면 PNG 가 세 배로 커진다. */
function card(r) {
  const chips = r.essential.concat(r.optional).slice(0, 6);
  const more = r.essential.length + r.optional.length - chips.length;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
.c{width:1200px;height:630px;box-sizing:border-box;padding:72px 84px;background:#fdf7f4;
   font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;
   position:relative;display:flex;flex-direction:column;justify-content:center}
.bar{position:absolute;left:0;top:0;bottom:0;width:16px;background:#c4502a}
.kick{font-size:27px;color:#c4502a;font-weight:700;margin-bottom:16px;letter-spacing:-.02em}
h1{font-size:${r.name.length > 9 ? 78 : 94}px;margin:0 0 22px;letter-spacing:-.04em;color:#1d1d1b;line-height:1.08}
.meta{font-size:31px;color:#6b6b63;margin-bottom:34px;letter-spacing:-.02em}
.chips{display:flex;flex-wrap:wrap;gap:11px;max-width:950px}
.chip{font-size:25px;padding:9px 20px;border-radius:999px;background:#fff;color:#6b6b63;border:1px solid #ecdfd8}
.more{font-size:25px;padding:9px 6px;color:#a09890}
.foot{position:absolute;right:84px;bottom:52px;font-size:25px;color:#a8a29c}
</style></head><body><div class="c">
  <div class="bar"></div>
  <div class="kick">${esc(r.category)} · ${esc(r.kind)}</div>
  <h1>${esc(r.name)}</h1>
  <div class="meta">조리 ${r.time}분 · 난이도 ${esc(r.difficulty)} · ${r.servings}인분</div>
  <div class="chips">${chips.map(i => `<span class="chip">${esc(i)}</span>`).join('')}${
    more > 0 ? `<span class="more">외 ${more}개</span>` : ''}</div>
  <div class="foot">${esc(SITE)}</div>
</div></body></html>`;
}

(async () => {
  const only = process.argv[2];
  const list = only ? RECIPES.filter(r => r.id === only) : RECIPES;
  if (!list.length) { console.error('그런 레시피가 없습니다: ' + only); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

  let total = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    await page.setContent(card(r));
    const file = path.join(OUT, r.id + '.png');
    await page.locator('.c').screenshot({ path: file });
    total += fs.statSync(file).size;
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${list.length}`);
  }
  await browser.close();

  console.log(`${list.length}장 생성 → og/`);
  console.log(`평균 ${(total / list.length / 1024).toFixed(0)}KB · 합계 ${(total / 1024 / 1024).toFixed(1)}MB`);
})();
