#!/usr/bin/env node
/* 레시피마다 진짜 HTML 페이지를 만든다.
 *
 * 왜 필요한가:
 *   앱은 한 페이지짜리라 125개 레시피가 전부 같은 주소다. 그래서
 *   - 카카오톡·페북 크롤러는 자바스크립트를 실행하지 않으므로 레시피별 미리보기가 안 뜨고
 *   - 검색엔진에 '김치찌개' 로 걸릴 페이지 자체가 없고
 *   - 블로그에서 특정 레시피를 링크할 수도 없다.
 *
 *   그래서 빌드할 때 레시피별 정적 페이지를 뽑는다. 본문이 HTML 로 들어 있어
 *   크롤러가 바로 읽고, Recipe 구조화 데이터로 구글 레시피 검색에도 올라간다.
 *   페이지에서 '내 재료로 찾기' 를 누르면 앱의 그 레시피로 들어간다.
 *
 * 실행: node tools/gen-pages.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'recipe');
const SITE = (fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim());
const BASE = 'https://' + SITE;

global.window = {};
require('../data/recipes.js');
const RECIPES = global.window.RECIPES;

/* 측정 태그. 레시피 페이지는 app.js 를 부르지 않으므로 여기서 직접 넣어야 한다.
 * 검색·공유로 들어오는 사람은 대부분 레시피 페이지에 먼저 닿는다. */
function analyticsTag() {
  global.window = global.window || {};
  try { require('../data/analytics.js'); } catch (e) { return ''; }
  const id = (global.window.ANALYTICS || {}).ga4Id;
  if (!id) return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(id)}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${esc(id)}');
</script>`;
}

/* 검색엔진 소유확인 태그. site-verify.json 에 값이 있을 때만 넣는다.
 * 크롤러는 자바스크립트를 실행하지 않으므로 HTML 에 직접 박아야 한다. */
function verifyTags() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site-verify.json'), 'utf8')); }
  catch (e) { return ''; }
  const tags = [];
  if (cfg.naver)  tags.push(`<meta name="naver-site-verification" content="${esc(cfg.naver)}">`);
  if (cfg.google) tags.push(`<meta name="google-site-verification" content="${esc(cfg.google)}">`);
  return tags.join('\n');
}

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const famOf = r => r.family || r.name;

/* 레시피별 공유 이미지. 아직 안 만든 레시피는 기본 이미지로 넘어간다.
 * (tools/gen-og-images.js 가 만들고, 중간에 멈춰도 페이지는 깨지지 않는다) */
function shareImage(r) {
  const own = path.join(ROOT, 'og', r.id + '.png');
  return fs.existsSync(own) ? `${BASE}/og/${r.id}.png` : `${BASE}/og.png`;
}

/* 조리시간을 ISO 8601 로 (구조화 데이터 요구 형식) */
const iso = min => 'PT' + min + 'M';

function jsonLd(r) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: r.name,
    description: `${r.name} 만드는 법. 필수 재료 ${r.essential.join(', ')}. 조리 ${r.time}분, ${r.servings}인분.`,
    image: [shareImage(r)],
    author: { '@type': 'Organization', name: '오늘 뭐 먹지?', url: BASE + '/' },
    recipeCategory: r.kind,
    recipeCuisine: r.category,
    totalTime: iso(r.time),
    recipeYield: r.servings + '인분',
    keywords: [r.name, famOf(r), r.category, r.kind].filter((v, i, a) => a.indexOf(v) === i).join(', '),
    recipeIngredient: r.essential.concat(r.optional),
    recipeInstructions: r.steps.map((s, i) => ({
      '@type': 'HowToStep', position: i + 1, text: s
    }))
  };
  if (r.veg) data.suitableForDiet = 'https://schema.org/VegetarianDiet';
  return JSON.stringify(data, null, 2);
}

function page(r) {
  const title = `${r.name} 레시피 — 재료와 만드는 법`;
  const desc = `${r.name} 만드는 법. 필수 재료는 ${r.essential.join(', ')}. ` +
               `조리 ${r.time}분 · 난이도 ${r.difficulty} · ${r.servings}인분. ` +
               `집에 있는 재료로 만들 수 있는지 바로 확인해 보세요.`;
  const url = `${BASE}/recipe/${r.id}.html`;
  const sameFamily = RECIPES.filter(x => famOf(x) === famOf(r) && x.id !== r.id);

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
${verifyTags()}
${analyticsTag()}

<meta property="og:type" content="article">
<meta property="og:site_name" content="오늘 뭐 먹지?">
<meta property="og:title" content="${esc(r.name)} 레시피">
<meta property="og:description" content="${esc(`필수 재료 ${r.essential.join(', ')} · 조리 ${r.time}분 · ${r.difficulty}`)}">
<meta property="og:image" content="${shareImage(r)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">

<link rel="stylesheet" href="../styles.css">
<link rel="icon" href="../icons/icon-192.png" sizes="192x192">
<meta name="theme-color" content="#f6f6f4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#17171a" media="(prefers-color-scheme: dark)">

<script type="application/ld+json">
${jsonLd(r)}
</script>
</head>
<body>
<header class="topbar">
  <a class="brand" href="../" style="text-decoration:none;color:inherit">
    <span class="logo" aria-hidden="true">🍳</span>
    <div><h1 style="font-size:17px">오늘 뭐 먹지?</h1></div>
  </a>
</header>

<main class="layout" style="grid-template-columns:1fr;max-width:720px">
  <article class="panel" style="position:static;max-height:none;overflow:visible">
    <h2 style="font-size:26px;margin:0 0 10px">${esc(r.name)}</h2>
    <div class="meta-row">
      <span>${esc(r.category)} · ${esc(r.kind)}</span><span>조리 ${r.time}분</span>
      <span>난이도 ${esc(r.difficulty)}</span><span>${r.servings}인분</span>
      ${r.veg ? '<span>고기·해산물 없이 가능</span>' : ''}
    </div>

    <p style="margin:18px 0">
      <a class="install-btn" style="display:inline-block;text-decoration:none"
         href="../?r=${encodeURIComponent(r.id)}">내 재료로 만들 수 있는지 보기</a>
    </p>

    <h3>필수 재료</h3>
    <ul class="ing-list">${r.essential.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    ${r.optional.length ? `<h3>있으면 더 좋은 재료</h3>
    <ul class="ing-list">${r.optional.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}

    <h3>만드는 순서</h3>
    <ol class="steps">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    ${r.tip ? `<p class="tip">💡 ${esc(r.tip)}</p>` : ''}

    ${sameFamily.length ? `<h3>${esc(famOf(r))} 다른 버전</h3>
    <div class="chips">${sameFamily.map(x =>
      `<a class="chip" style="text-decoration:none" href="${esc(x.id)}.html">${esc(x.name)}</a>`).join('')}</div>` : ''}

    <p style="margin-top:26px"><a href="../">← 재료로 요리 찾기</a></p>
  </article>
</main>
</body>
</html>
`;
}

/* ── 실행 ── */
fs.mkdirSync(OUT_DIR, { recursive: true });
// 이전에 만든 파일 중 지금 레시피에 없는 건 지운다
const keep = new Set(RECIPES.map(r => r.id + '.html'));
fs.readdirSync(OUT_DIR).forEach(f => { if (!keep.has(f)) fs.unlinkSync(path.join(OUT_DIR, f)); });

RECIPES.forEach(r => fs.writeFileSync(path.join(OUT_DIR, r.id + '.html'), page(r)));

const today = new Date().toISOString().slice(0, 10);
const urls = [`${BASE}/`].concat(RECIPES.map(r => `${BASE}/recipe/${r.id}.html`));
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u, i) => `  <url>
    <loc>${u}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${i === 0 ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>
`);

fs.writeFileSync(path.join(ROOT, 'robots.txt'),
`User-agent: *
Allow: /

# 네이버 크롤러
User-agent: Yeti
Allow: /

# 구글
User-agent: Googlebot
Allow: /

# 다음
User-agent: daum
Allow: /

Sitemap: ${BASE}/sitemap.xml
`);

// index.html 의 표식 자리에 소유확인 태그를 넣는다
const INDEX = path.join(ROOT, 'index.html');
let indexHtml = fs.readFileSync(INDEX, 'utf8');
const MARK_A = '<!-- site-verification:start -->';
const MARK_B = '<!-- site-verification:end -->';
if (indexHtml.includes(MARK_A)) {
  const before = indexHtml.slice(0, indexHtml.indexOf(MARK_A) + MARK_A.length);
  const after = indexHtml.slice(indexHtml.indexOf(MARK_B));
  const tags = [verifyTags(), analyticsTag()].filter(Boolean).join('\n');
  fs.writeFileSync(INDEX, before + (tags ? '\n' + tags + '\n' : '\n') + after);
  console.log('소유확인:', verifyTags() ? '넣음' : '설정값 없음');
  console.log('측정 태그:', analyticsTag() ? '넣음 (index + 레시피 125개)' : '설정값 없음');
}

console.log(`레시피 페이지 ${RECIPES.length}개 생성 → recipe/`);
const own = RECIPES.filter(r => fs.existsSync(path.join(ROOT, 'og', r.id + '.png'))).length;
console.log(`공유 이미지: 레시피별 ${own}개 / 기본 이미지 ${RECIPES.length - own}개`);
console.log(`sitemap.xml (${urls.length}개 주소), robots.txt 생성`);
console.log(`사이트 주소: ${BASE}`);
