(function () {
  'use strict';

  var RECIPES = window.RECIPES || [];
  var SYNONYMS = window.SYNONYMS || {};
  var GROUPS = window.INGREDIENT_GROUPS || {};
  var SUBSTITUTES = window.SUBSTITUTES || [];
  var SWAPS = window.SWAPS || {};
  var STAPLES = window.PANTRY_STAPLES || [];
  var CATEGORIES = window.INGREDIENT_CATEGORIES || [];
  var AFF = window.AFFILIATE || {};
  var ANALYTICS = window.ANALYTICS || {};

  var LS = { pantry: 'fridge.pantry', staples: 'fridge.staples', theme: 'fridge.theme',
             seenHint: 'fridge.seenStaplesHint' };

  /* ── 재료 이름 다루기 ──────────────────────────── */

  function norm(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  var synIndex = {};
  Object.keys(SYNONYMS).forEach(function (k) { synIndex[norm(k)] = SYNONYMS[k]; });

  function canonical(raw) {
    var key = norm(raw);
    if (!key) return '';
    if (synIndex[key]) return synIndex[key];
    return String(raw).replace(/\s+/g, '');
  }

  // 구체적 재료 -> 그것이 속한 큰 범주들
  var parentOf = {};
  Object.keys(GROUPS).forEach(function (parent) {
    GROUPS[parent].forEach(function (member) {
      (parentOf[member] = parentOf[member] || []).push(parent);
    });
  });

  // 사실상 같은 재료 색인
  var subIndex = {};
  SUBSTITUTES.forEach(function (set) {
    set.forEach(function (name) {
      subIndex[name] = (subIndex[name] || []).concat(set.filter(function (m) { return m !== name; }));
    });
  });

  var vocabulary = (function () {
    var map = {};
    function put(label, canon) { if (label && !map[label]) map[label] = canon || label; }
    RECIPES.forEach(function (r) {
      r.essential.concat(r.optional).forEach(function (i) { put(i, i); });
    });
    CATEGORIES.forEach(function (c) { c.items.forEach(function (i) { put(i, i); }); });
    STAPLES.forEach(function (i) { put(i, i); });
    Object.keys(GROUPS).forEach(function (parent) {
      put(parent, parent);
      GROUPS[parent].forEach(function (m) { put(m, m); });
    });
    SUBSTITUTES.forEach(function (set) { set.forEach(function (m) { put(m, m); }); });
    Object.keys(SYNONYMS).forEach(function (alias) { put(alias, SYNONYMS[alias]); });
    return map;
  })();

  function isKnown(name) {
    return Object.prototype.hasOwnProperty.call(vocabulary, name) ||
           Object.prototype.hasOwnProperty.call(parentOf, name);
  }

  /* ── 상태 ─────────────────────────────────────── */

  var state = {
    pantry: load(LS.pantry, []),
    stapleOff: load(LS.staples, []),
    search: '',
    kind: '',
    maxTime: '',
    sort: 'match',
    makeableOnly: false,
    vegOnly: false
  };

  function load(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 */ }
  }

  /* ── 매칭 ─────────────────────────────────────── */

  function buildPantrySet() {
    var set = Object.create(null);
    function add(name) {
      if (!name) return;
      set[name] = true;
      (parentOf[name] || []).forEach(function (p) { set[p] = true; });
    }
    state.pantry.forEach(add);
    STAPLES.forEach(function (s) { if (state.stapleOff.indexOf(s) === -1) add(s); });
    return set;
  }

  // 그 재료를 사실상 가지고 있는가 (같은 이름 / 별칭 / 범주 / 같은 것 취급)
  function has(pantry, need) {
    if (pantry[need]) return true;
    var subs = subIndex[need];
    if (subs) for (var i = 0; i < subs.length; i++) if (pantry[subs[i]]) return true;
    var members = GROUPS[need];
    if (members) for (var j = 0; j < members.length; j++) if (pantry[members[j]]) return true;
    return false;
  }

  /* 요리 이름에 들어간 재료는 그 요리를 그 요리이게 하는 재료다.
   * '오징어볶음에 오징어 대신 새우' 는 대체가 아니라 다른 요리다.
   * 참치캔→참치, 냉면사리→냉면 처럼 꼬리말이 붙은 이름도 같이 본다. */
  var NAME_TAILS = ['통조림', '캔', '사리'];

  function definesDish(recipe, need) {
    // 이름만으로는 안 드러나는 경우 (삼계탕의 닭, 육개장의 소)
    if (recipe.defining && recipe.defining.indexOf(need) !== -1) return true;

    var title = (recipe.name + (recipe.family || '')).replace(/\s/g, '');
    if (title.indexOf(need) !== -1) return true;

    for (var i = 0; i < NAME_TAILS.length; i++) {
      var tail = NAME_TAILS[i];
      if (need.length > tail.length && need.slice(-tail.length) === tail) {
        var base = need.slice(0, -tail.length);
        if (base.length >= 2 && title.indexOf(base) !== -1) return true;
      }
    }
    // 칼국수면 → 칼국수 처럼 '면' 만 떼는 경우 (소면·중화면처럼 짧은 건 제외)
    if (need.slice(-1) === '면' && need.length >= 4 && title.indexOf(need.slice(0, -1)) !== -1) return true;
    return false;
  }

  // 없을 때 대신 쓸 수 있는 재료 목록
  function swapOptions(recipe, need) {
    if (definesDish(recipe, need)) return [];
    var own = recipe.swaps && Object.prototype.hasOwnProperty.call(recipe.swaps, need);
    var list = own ? recipe.swaps[need] : (SWAPS[need] || []);
    return list.map(function (o) {
      return { use: [].concat(o.use), note: o.note || '' };
    });
  }

  function findSwap(pantry, recipe, need) {
    var opts = swapOptions(recipe, need);
    for (var i = 0; i < opts.length; i++) {
      var all = true;
      for (var j = 0; j < opts[i].use.length; j++) {
        if (!has(pantry, opts[i].use[j])) { all = false; break; }
      }
      if (all) return { need: need, use: opts[i].use, note: opts[i].note };
    }
    return null;
  }

  function evaluate(recipe, pantry) {
    var haveEss = [], swaps = [], missEss = [];
    recipe.essential.forEach(function (i) {
      if (has(pantry, i)) { haveEss.push(i); return; }
      var sw = findSwap(pantry, recipe, i);
      if (sw) { swaps.push(sw); return; }
      missEss.push(i);
    });

    var haveOpt = [], missOpt = [];
    recipe.optional.forEach(function (i) { (has(pantry, i) ? haveOpt : missOpt).push(i); });

    var total = recipe.essential.length + recipe.optional.length;
    return {
      recipe: recipe,
      haveEss: haveEss, swaps: swaps, missEss: missEss,
      haveOpt: haveOpt, missOpt: missOpt,
      status: missEss.length ? 'short' : (swaps.length ? 'swap' : 'ready'),
      makeable: missEss.length === 0,
      coverage: total
        ? Math.round(((haveEss.length + swaps.length + haveOpt.length) / total) * 100)
        : 0
    };
  }

  var RANK = { ready: 0, swap: 1, short: 2 };

  function byBest(a, b) {
    if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
    if (a.missEss.length !== b.missEss.length) return a.missEss.length - b.missEss.length;
    if (a.swaps.length !== b.swaps.length) return a.swaps.length - b.swaps.length;
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    return a.recipe.time - b.recipe.time;
  }

  function familyOf(recipe) { return recipe.family || recipe.name; }

  // 같은 요리의 여러 버전을 한 덩어리로 묶는다
  function groupFamilies(list) {
    var map = {}, order = [];
    list.forEach(function (m) {
      var f = familyOf(m.recipe);
      if (!map[f]) { map[f] = []; order.push(f); }
      map[f].push(m);
    });
    return order.map(function (f) {
      var variants = map[f].slice().sort(byBest);
      return { family: f, best: variants[0], variants: variants, count: variants.length };
    });
  }

  /* ── 요소 ─────────────────────────────────────── */

  var el = {};
  ['ingInput', 'suggest', 'chips', 'pantryCount', 'pantryEmpty', 'clearBtn', 'quickPick',
   'staples', 'searchInput', 'kindSel', 'timeSel', 'sortSel', 'makeableOnly', 'vegOnly',
   'summary', 'cards', 'noResult', 'modal', 'modalTitle', 'modalTabs', 'modalMeta',
   'modalBody', 'themeBtn', 'installBtn', 'disclosure',
   'staplesGroup', 'staplesHint', 'staplesHintOk'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  /* ── 내 재료 ──────────────────────────────────── */

  function renderChips() {
    el.chips.innerHTML = '';
    state.pantry.forEach(function (name) {
      var chip = document.createElement('span');
      chip.className = 'chip' + (isKnown(name) ? '' : ' unknown');
      if (!isKnown(name)) chip.title = '등록된 레시피에 없는 재료입니다';
      chip.appendChild(document.createTextNode(name));
      var x = document.createElement('button');
      x.type = 'button';
      x.textContent = '✕';
      x.setAttribute('aria-label', name + ' 빼기');
      x.addEventListener('click', function () { removeIngredient(name); });
      chip.appendChild(x);
      el.chips.appendChild(chip);
    });
    el.pantryCount.textContent = state.pantry.length;
    el.clearBtn.hidden = state.pantry.length === 0;
    el.pantryEmpty.hidden = state.pantry.length > 0;
    syncPills();
  }

  function renderQuickPick() {
    el.quickPick.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      var h = document.createElement('h3');
      h.textContent = cat.name;
      el.quickPick.appendChild(h);
      var wrap = document.createElement('div');
      wrap.className = 'pills';
      cat.items.forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pill';
        b.textContent = item;
        b.dataset.ing = item;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { toggleIngredient(item); });
        wrap.appendChild(b);
      });
      el.quickPick.appendChild(wrap);
    });
  }

  function syncPills() {
    var picked = {};
    state.pantry.forEach(function (n) { picked[n] = true; });
    Array.prototype.forEach.call(el.quickPick.querySelectorAll('.pill'), function (b) {
      b.setAttribute('aria-pressed', picked[b.dataset.ing] ? 'true' : 'false');
    });
  }

  function renderStaples() {
    el.staples.innerHTML = '';
    STAPLES.forEach(function (name) {
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.stapleOff.indexOf(name) === -1;
      cb.addEventListener('change', function () {
        if (cb.checked) state.stapleOff = state.stapleOff.filter(function (s) { return s !== name; });
        else if (state.stapleOff.indexOf(name) === -1) state.stapleOff.push(name);
        save(LS.staples, state.stapleOff);
        markHintSeen();   // 직접 건드렸으면 안내는 할 일을 다 했다
        renderResults();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(name));
      el.staples.appendChild(label);
    });
  }

  /* ── 결과 ─────────────────────────────────────── */

  function renderResults() {
    var pantry = buildPantrySet();
    var all = RECIPES.map(function (r) { return evaluate(r, pantry); });

    var passed = all.filter(function (m) {
      var r = m.recipe;
      if (state.search) {
        var hay = norm(r.name) + norm(familyOf(r)) + norm(r.label || '');
        if (hay.indexOf(state.search) === -1) return false;
      }
      if (state.kind && r.kind !== state.kind) return false;
      if (state.maxTime && r.time > Number(state.maxTime)) return false;
      if (state.vegOnly && !r.veg) return false;
      if (state.makeableOnly && !m.makeable) return false;
      return true;
    });

    var groups = groupFamilies(passed);
    groups.sort(sorter(state.sort));

    el.cards.innerHTML = '';
    groups.forEach(function (g) { el.cards.appendChild(card(g)); });

    renderSummary(groupFamilies(all));

    if (groups.length === 0) {
      el.noResult.hidden = false;
      el.noResult.textContent = state.makeableOnly
        ? '조건에 맞게 지금 만들 수 있는 요리가 없습니다. 재료를 더 담거나 ‘지금 만들 수 있는 것만’을 꺼 보세요.'
        : '조건에 맞는 요리가 없습니다. 검색어나 필터를 바꿔 보세요.';
    } else {
      el.noResult.hidden = true;
    }
  }

  function renderSummary(allGroups) {
    var ready = 0, swap = 0, near = 0;
    allGroups.forEach(function (g) {
      if (g.best.status === 'ready') ready++;
      else if (g.best.status === 'swap') swap++;
      else if (g.best.missEss.length <= 2) near++;
    });
    if (state.pantry.length === 0) {
      el.summary.innerHTML = '재료를 담으면 <b>지금 만들 수 있는 요리</b>부터 보여드립니다. ' +
        '지금은 요리 <b>' + allGroups.length + '종</b>(레시피 ' + RECIPES.length + '개)을 보여주고 있어요.';
    } else {
      el.summary.innerHTML = '바로 가능 <b>' + ready + '종</b>' +
        ' · 대체 재료를 쓰면 <b>' + swap + '종</b>' +
        ' · 1~2가지만 더 있으면 <b>' + near + '종</b>' +
        ' <span class="muted">(전체 ' + allGroups.length + '종 중)</span>';
    }
  }

  function sorter(mode) {
    if (mode === 'time') return function (a, b) {
      return a.best.recipe.time - b.best.recipe.time || a.family.localeCompare(b.family, 'ko');
    };
    if (mode === 'few') return function (a, b) {
      var ca = a.best.recipe.essential.length + a.best.recipe.optional.length;
      var cb = b.best.recipe.essential.length + b.best.recipe.optional.length;
      return ca - cb || a.family.localeCompare(b.family, 'ko');
    };
    if (mode === 'name') return function (a, b) { return a.family.localeCompare(b.family, 'ko'); };
    return function (a, b) { return byBest(a.best, b.best) || a.family.localeCompare(b.family, 'ko'); };
  }

  function card(g) {
    var m = g.best, r = m.recipe;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'card is-' + m.status;

    var top = document.createElement('div');
    top.className = 'card-top';
    var h = document.createElement('h3');
    h.textContent = r.name;
    top.appendChild(h);
    top.appendChild(statusBadge(m));
    b.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'meta-row';
    meta.innerHTML = '<span>' + esc(r.kind) + '</span><span>' + r.time + '분</span><span>' + esc(r.difficulty) + '</span>' +
      (g.count > 1 ? '<span class="ver">' + g.count + '가지 버전</span>' : '');
    b.appendChild(meta);

    var bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<i style="width:' + m.coverage + '%"></i>';
    b.appendChild(bar);

    b.appendChild(needLine(m, r));
    b.addEventListener('click', function () { openModal(g.family, r.id); });
    return b;
  }

  function statusBadge(m) {
    var badge = document.createElement('span');
    if (m.status === 'ready') {
      badge.className = 'badge ready';
      badge.textContent = '바로 가능';
    } else if (m.status === 'swap') {
      badge.className = 'badge swap';
      badge.textContent = '대체하면 가능';
    } else {
      badge.className = 'badge ' + (m.missEss.length <= 2 ? 'near' : 'far');
      badge.textContent = m.missEss.length + '가지 부족';
    }
    return badge;
  }

  function needLine(m, r) {
    var p = document.createElement('p');
    if (m.status === 'ready') {
      p.className = 'need ok';
      p.innerHTML = '<b>✓ 필수 재료 다 있어요</b> · 선택 재료 ' + m.haveOpt.length + '/' + r.optional.length;
    } else if (m.status === 'swap') {
      p.className = 'need swapped';
      p.innerHTML = m.swaps.slice(0, 2).map(function (s) {
        return esc(s.need) + ' 대신 <b>' + esc(s.use.join(' + ')) + '</b>';
      }).join('<br>') + (m.swaps.length > 2 ? '<br>외 ' + (m.swaps.length - 2) + '가지 대체' : '');
    } else {
      p.className = 'need';
      p.innerHTML = '부족: <b>' + esc(m.missEss.join(', ')) + '</b>';
    }
    return p;
  }



  /* ── 첫 방문 안내 ─────────────────────────────
   * 기본 양념을 전부 켜 둔 채로 시작하는 게 결과가 풍성해서 낫지만,
   * 집에 없는 양념이 켜져 있으면 '바로 가능'이 거짓말이 된다.
   * 그래서 처음 온 사람에게만 한 번 확인을 요청한다. */

  function isFirstVisit() {
    try {
      return !localStorage.getItem(LS.seenHint) &&
             !localStorage.getItem(LS.pantry) &&
             !localStorage.getItem(LS.staples);
    } catch (e) { return false; }  // 저장을 못 쓰면 매번 띄우지 않는다
  }

  function markHintSeen() {
    try { localStorage.setItem(LS.seenHint, '1'); } catch (e) { /* 무시 */ }
  }

  function showStaplesHint() {
    if (!el.staplesHint || !el.staplesGroup) return;
    el.staplesGroup.open = true;
    el.staplesHint.hidden = false;
  }

  function dismissStaplesHint() {
    if (el.staplesHint) el.staplesHint.hidden = true;
    markHintSeen();
  }

  /* ── 측정 ─────────────────────────────────────
   * 설정이 비어 있으면 스크립트를 아예 불러오지 않는다.
   * 측정 도구가 없거나 차단당해도 앱 동작에는 영향이 없어야 한다. */

  function analyticsOn() {
    return !!(ANALYTICS.cloudflareToken || ANALYTICS.ga4Id);
  }

  function initAnalytics() {
    if (ANALYTICS.cloudflareToken) {
      var cf = document.createElement('script');
      cf.defer = true;
      cf.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      cf.setAttribute('data-cf-beacon', JSON.stringify({ token: ANALYTICS.cloudflareToken }));
      document.head.appendChild(cf);
    }

    // 정적 태그(HTML 에 박힌 것)가 이미 올렸으면 다시 넣지 않는다
    if (ANALYTICS.ga4Id && typeof window.gtag !== 'function') {
      var ga = document.createElement('script');
      ga.async = true;
      ga.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ANALYTICS.ga4Id);
      document.head.appendChild(ga);

      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', ANALYTICS.ga4Id);
    }
  }

  function track(name, params) {
    if (ANALYTICS.debug) console.log('[측정]', name, params || {});
    if (!ANALYTICS.ga4Id || typeof window.gtag !== 'function') return;
    try { window.gtag('event', name, params || {}); } catch (e) { /* 측정 실패가 앱을 막지 않는다 */ }
  }

  /* ── 장보기 (쿠팡 파트너스) ───────────────────── */

  // Open API 로 미리 만들어 둔 딥링크 (tools/gen-coupang-links.js 가 생성)
  var DEEPLINKS = window.COUPANG_LINKS || {};
  /* 재료별 실제 상품 (tools/gen-coupang-products.js 가 생성).
   * 65KB 로 가장 큰 파일인데 레시피 상세를 열어야 쓰인다.
   * 첫 화면을 막지 않도록 상세를 처음 열 때 받아 온다.
   * 받아오기 전에는 링크 칩만 보여주고, 도착하면 그 자리만 다시 그린다. */
  var PRODUCTS = window.COUPANG_PRODUCTS || {};
  var PRODUCTS_ASOF = window.COUPANG_PRODUCTS_ASOF || '';
  var productState = Object.keys(PRODUCTS).length ? 'ready' : 'idle';
  var productWaiting = [];

  function loadProducts(done) {
    if (productState === 'ready' || productState === 'failed') return done();
    productWaiting.push(done);
    if (productState === 'loading') return;

    productState = 'loading';
    var el = document.createElement('script');
    el.src = 'data/coupang-products.js';
    el.onload = function () {
      PRODUCTS = window.COUPANG_PRODUCTS || {};
      PRODUCTS_ASOF = window.COUPANG_PRODUCTS_ASOF || '';
      productState = 'ready';
      flushProductWaiters();
    };
    el.onerror = function () {
      // 못 받아도 링크 칩으로는 장을 볼 수 있다
      productState = 'failed';
      flushProductWaiters();
    };
    document.head.appendChild(el);
  }

  function flushProductWaiters() {
    var list = productWaiting;
    productWaiting = [];
    list.forEach(function (fn) { fn(); });
  }

  // 제휴 관계가 실제로 있는 상태인가. 셋 중 하나라도 있어야 참.
  function isAffiliate() {
    if (!AFF.enabled) return false;
    if (AFF.partnerId) return true;
    if (AFF.links && Object.keys(AFF.links).length) return true;
    if (Object.keys(DEEPLINKS).length) return true;
    return Object.keys(PRODUCTS).length > 0;
  }

  // 링크를 고르는 순서: 손으로 넣은 것 > 자동 생성 딥링크 > 검색
  // 딥링크가 수수료 추적이 가장 확실하므로 검색보다 먼저 쓴다.
  function shopUrl(name) {
    if (!AFF.enabled) return null;
    if (AFF.links && AFF.links[name]) return AFF.links[name];
    if (DEEPLINKS[name]) return DEEPLINKS[name];
    if (!AFF.searchBase) return null;
    var term = (AFF.searchTerms && AFF.searchTerms[name]) || name;
    var url = AFF.searchBase + '?q=' + encodeURIComponent(term) + '&channel=user';
    if (AFF.partnerId) url += '&lptag=' + encodeURIComponent(AFF.partnerId);
    return url;
  }

  function shopChip(name) {
    var url = shopUrl(name);
    if (!url) return '<span class="shop-chip">' + esc(name) + '</span>';
    // noreferrer 는 일부러 넣지 않는다. 쿠팡으로 넘어갈 때 리퍼러 헤더까지 지워져
    // 제휴 유입 출처 확인에 불리하다. noopener 만으로 탭내빙은 막힌다.
    return '<a class="shop-chip link" href="' + esc(url) + '" data-ing="' + esc(name) + '"' +
           ' target="_blank" rel="nofollow sponsored noopener">' +
           esc(name) + '<span class="go">쿠팡 ↗</span></a>';
  }

  function won(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';
  }

  // 없는 필수 재료는 실제 상품 카드로 보여준다. 선택 재료는 칩으로만.
  function productCards(names) {
    var cards = [];
    names.forEach(function (name) {
      (PRODUCTS[name] || []).forEach(function (p) {
        if (!p.url) return;
        cards.push(
          '<a class="prod" href="' + esc(p.url) + '" data-ing="' + esc(name) + '"' +
          ' target="_blank" rel="nofollow sponsored noopener">' +
            (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '<span class="prod-noimg"></span>') +
            '<span class="prod-body">' +
              '<span class="prod-for">' + esc(name) + '</span>' +
              '<span class="prod-name">' + esc(p.name || '') + '</span>' +
              '<span class="prod-meta">' +
                (p.price ? '<b>' + won(p.price) + '</b>' : '') +
                (p.rocket ? '<span class="rocket">로켓배송</span>' : '') +
              '</span>' +
            '</span>' +
          '</a>');
      });
    });
    return cards;
  }

  /* 상세를 열 때마다 호출된다. 상품 데이터가 아직 없으면 칩만 먼저 그리고,
   * 도착하면 같은 자리를 다시 그린다. 그 사이 다른 레시피로 옮겨갔다면 버린다. */
  function renderShop(m) {
    var slot = document.getElementById('shopSlot');
    if (!slot) return;
    slot.innerHTML = shopSection(m);

    if (productState === 'ready' || productState === 'failed') return;
    if (!AFF.enabled || !m.missEss.length) return;

    var token = m.recipe.id;
    loadProducts(function () {
      var again = document.getElementById('shopSlot');
      if (!again || el.modal.hidden) return;
      if (shownRecipeId !== token) return;
      again.innerHTML = shopSection(m);
    });
  }

  function shopSection(m) {
    if (!AFF.enabled || (!m.missEss.length && !m.missOpt.length)) return '';

    var html = '<h3>장보기</h3>';
    var cards = productCards(m.missEss);

    if (cards.length) {
      html += '<div class="prod-list">' + cards.join('') + '</div>';
      if (PRODUCTS_ASOF) {
        html += '<p class="asof">가격은 ' + esc(PRODUCTS_ASOF) + ' 기준이라 지금과 다를 수 있습니다.</p>';
      }
    }

    // 상품 카드로 못 채운 재료는 링크 칩으로
    var chipEss = m.missEss.filter(function (n) { return !(PRODUCTS[n] && PRODUCTS[n].length); });
    html += '<div class="shop">';
    if (chipEss.length) {
      html += '<div class="shop-row"><span class="shop-label need">필수</span><span class="shop-chips">' +
              chipEss.map(shopChip).join('') + '</span></div>';
    }
    if (m.missOpt.length) {
      html += '<div class="shop-row"><span class="shop-label">선택</span><span class="shop-chips">' +
              m.missOpt.map(shopChip).join('') + '</span></div>';
    }
    html += '</div>';

    if (isAffiliate() && AFF.disclosure) {
      html += '<p class="disclosure in-modal">' + esc(AFF.disclosure) + '</p>';
    }
    return html;
  }

  /* ── 상세 보기 (버전 탭) ──────────────────────── */

  var familyIndex = (function () {
    var map = {};
    RECIPES.forEach(function (r) { (map[familyOf(r)] = map[familyOf(r)] || []).push(r); });
    return map;
  })();

  var lastFocused = null;
  var openFamily = null;
  var shownRecipeId = null;

  /* 레시피마다 주소를 남긴다 (?r=id).
   * 이 주소를 공유하면 그 레시피가 열린 채로 뜨고, 뒤로가기로 닫힌다.
   * 정적 레시피 페이지(recipe/*.html)의 '내 재료로 보기' 도 이 주소로 들어온다. */
  function openModal(family, recipeId) {
    lastFocused = document.activeElement;
    openFamily = family;
    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    showVariant(recipeId);
    el.modal.querySelector('.modal-close').focus();
  }

  function showVariant(recipeId) {
    var pantry = buildPantrySet();
    var family = openFamily;
    var variants = (familyIndex[family] || []).map(function (r) { return evaluate(r, pantry); });
    var cur = variants.filter(function (m) { return m.recipe.id === recipeId; })[0] || variants[0];
    var r = cur.recipe;
    shownRecipeId = r.id;
    pushRecipeUrl(r.id);
    track('recipe_open', {
      recipe_id: r.id, recipe_name: r.name, family: familyOf(r),
      status: cur.status, missing: cur.missEss.length
    });

    el.modalTitle.textContent = variants.length > 1 ? family : r.name;

    el.modalTabs.innerHTML = '';
    if (variants.length > 1) {
      variants.slice().sort(byBest).forEach(function (m) {
        var t = document.createElement('button');
        t.type = 'button';
        t.className = 'tab' + (m.recipe.id === r.id ? ' on' : '') + ' tab-' + m.status;
        t.textContent = m.recipe.label || m.recipe.name;
        t.setAttribute('aria-pressed', m.recipe.id === r.id ? 'true' : 'false');
        t.title = m.recipe.name;
        t.addEventListener('click', function () { showVariant(m.recipe.id); });
        el.modalTabs.appendChild(t);
      });
      el.modalTabs.hidden = false;
    } else {
      el.modalTabs.hidden = true;
    }

    el.modalMeta.innerHTML = [
      '<span>' + esc(r.name) + '</span>',
      '<span>' + esc(r.category) + '</span>',
      '<span>조리 ' + r.time + '분</span>',
      '<span>난이도 ' + esc(r.difficulty) + '</span>',
      '<span>' + r.servings + '인분</span>',
      r.veg ? '<span>고기·해산물 없이 가능</span>' : ''
    ].join('');

    var html = '';
    html += '<h3>필수 재료</h3>' + ingList(r.essential, cur);
    if (r.optional.length) html += '<h3>있으면 더 좋은 재료</h3>' + ingList(r.optional, cur);

    var needSwap = r.essential.filter(function (i) {
      return cur.haveEss.indexOf(i) === -1 && swapOptions(r, i).length > 0;
    });
    if (needSwap.length) {
      html += '<h3>대체 재료</h3><ul class="swap-list">' + needSwap.map(function (need) {
        var opts = swapOptions(r, need);
        var used = cur.swaps.filter(function (s) { return s.need === need; })[0];
        return '<li><b>' + esc(need) + '</b> 대신 ' + opts.map(function (o) {
          var ownIt = o.use.every(function (u) { return has(pantry, u); });
          return '<span class="opt' + (ownIt ? ' have' : '') + '">' + esc(o.use.join(' + ')) +
                 (ownIt ? ' ✓' : '') + '</span>';
        }).join('') + (used && used.note ? '<span class="note">' + esc(used.note) + '</span>'
                      : (opts[0].note ? '<span class="note">' + esc(opts[0].note) + '</span>' : '')) + '</li>';
      }).join('') + '</ul>';
    }

    if (cur.missEss.length && !AFF.enabled) {
      html += '<p class="sub">아직 없는 재료: <b>' + esc(cur.missEss.join(', ')) + '</b></p>';
    }

    html += '<h3>만드는 순서</h3><ol class="steps">' +
      r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    if (r.tip) html += '<p class="tip">💡 ' + esc(r.tip) + '</p>';

    html += '<div id="shopSlot"></div>';

    el.modalBody.innerHTML = html;
    renderShop(cur);
    el.modalBody.scrollTop = 0;
  }

  function ingList(items, m) {
    var haveSet = {}, swapSet = {};
    m.haveEss.concat(m.haveOpt).forEach(function (i) { haveSet[i] = true; });
    m.swaps.forEach(function (s) { swapSet[s.need] = s.use.join(' + '); });
    return '<ul class="ing-list">' + items.map(function (i) {
      if (haveSet[i]) return '<li class="have">✓ ' + esc(i) + '</li>';
      if (swapSet[i]) return '<li class="swap">' + esc(i) + ' → ' + esc(swapSet[i]) + '</li>';
      return '<li class="miss">' + esc(i) + '</li>';
    }).join('') + '</ul>';
  }

  function pushRecipeUrl(id) {
    if (!window.history || !history.pushState) return;
    var url = '?r=' + encodeURIComponent(id);
    try {
      // 이미 그 레시피 주소면 새 기록을 쌓지 않는다 (주소로 들어온 경우)
      if (recipeIdFromUrl() === id) history.replaceState({ r: id }, '', url);
      else history.pushState({ r: id }, '', url);
    } catch (e) { /* 무시 */ }
  }

  function closeModal(fromHistory) {
    if (!fromHistory && window.history && history.pushState && /[?&]r=/.test(location.search)) {
      try { history.pushState({}, '', location.pathname); } catch (e) { /* 무시 */ }
    }
    el.modal.hidden = true;
    openFamily = null;
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function recipeIdFromUrl() {
    var m = /[?&]r=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function openRecipeById(id) {
    var hit = RECIPES.filter(function (r) { return r.id === id; })[0];
    if (!hit) return false;
    openModal(familyOf(hit), hit.id);
    return true;
  }

  /* ── 재료 담기 / 빼기 ─────────────────────────── */

  function addIngredient(raw) {
    String(raw).split(/[,،、]/).forEach(function (part) {
      var name = canonical(part.trim());
      if (!name) return;
      if (state.pantry.indexOf(name) === -1) state.pantry.push(name);
    });
    save(LS.pantry, state.pantry);
    renderChips();
    renderResults();
  }

  function removeIngredient(name) {
    state.pantry = state.pantry.filter(function (n) { return n !== name; });
    save(LS.pantry, state.pantry);
    renderChips();
    renderResults();
  }

  function toggleIngredient(name) {
    var canon = canonical(name);
    if (state.pantry.indexOf(canon) !== -1) removeIngredient(canon);
    else addIngredient(canon);
  }

  /* ── 자동완성 ─────────────────────────────────── */

  var suggestItems = [], suggestAt = -1;

  function showSuggest(q) {
    var key = norm(q);
    if (!key) return hideSuggest();

    var owned = {};
    state.pantry.forEach(function (n) { owned[n] = true; });

    var starts = [], includes = [];
    Object.keys(vocabulary).forEach(function (label) {
      var canon = vocabulary[label];
      if (owned[canon] && canon === label) return;
      var pos = norm(label).indexOf(key);
      if (pos === 0) starts.push(label);
      else if (pos > 0) includes.push(label);
    });

    suggestItems = starts.concat(includes).slice(0, 8);
    if (!suggestItems.length) return hideSuggest();

    el.suggest.innerHTML = '';
    suggestItems.forEach(function (label, i) {
      var canon = vocabulary[label];
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = label;
      if (canon !== label) {
        var as = document.createElement('span');
        as.className = 'as';
        as.textContent = canon + '(으)로 담김';
        li.appendChild(as);
      }
      li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(i); });
      el.suggest.appendChild(li);
    });
    suggestAt = -1;
    el.suggest.hidden = false;
    el.ingInput.setAttribute('aria-expanded', 'true');
  }

  function hideSuggest() {
    el.suggest.hidden = true;
    el.suggest.innerHTML = '';
    suggestItems = [];
    suggestAt = -1;
    el.ingInput.setAttribute('aria-expanded', 'false');
  }

  function highlight(next) {
    if (!suggestItems.length) return;
    var items = el.suggest.children;
    if (suggestAt >= 0 && items[suggestAt]) items[suggestAt].classList.remove('on');
    suggestAt = (next + suggestItems.length) % suggestItems.length;
    items[suggestAt].classList.add('on');
    items[suggestAt].scrollIntoView({ block: 'nearest' });
  }

  function pick(i) {
    addIngredient(suggestItems[i]);
    el.ingInput.value = '';
    hideSuggest();
    el.ingInput.focus();
  }

  /* ── 이벤트 ───────────────────────────────────── */

  el.ingInput.addEventListener('input', function () { showSuggest(el.ingInput.value); });
  el.ingInput.addEventListener('blur', function () { setTimeout(hideSuggest, 120); });
  el.ingInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(suggestAt + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(suggestAt - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestAt >= 0) pick(suggestAt);
      else if (suggestItems.length === 1) pick(0);
      else if (el.ingInput.value.trim()) { addIngredient(el.ingInput.value); el.ingInput.value = ''; hideSuggest(); }
    } else if (e.key === 'Escape') { hideSuggest(); }
  });

  if (el.staplesHintOk) el.staplesHintOk.addEventListener('click', dismissStaplesHint);

  el.clearBtn.addEventListener('click', function () {
    state.pantry = [];
    save(LS.pantry, state.pantry);
    renderChips();
    renderResults();
  });

  el.searchInput.addEventListener('input', function () {
    state.search = norm(el.searchInput.value);
    renderResults();
  });
  el.kindSel.addEventListener('change', function () { state.kind = el.kindSel.value; renderResults(); });
  el.timeSel.addEventListener('change', function () { state.maxTime = el.timeSel.value; renderResults(); });
  el.sortSel.addEventListener('change', function () { state.sort = el.sortSel.value; renderResults(); });
  el.makeableOnly.addEventListener('change', function () { state.makeableOnly = el.makeableOnly.checked; renderResults(); });
  el.vegOnly.addEventListener('change', function () { state.vegOnly = el.vegOnly.checked; renderResults(); });

  el.modal.addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) return closeModal();

    // 쿠팡으로 나가는 클릭. 수익과 직결되는 숫자라 따로 센다.
    var link = e.target.closest && e.target.closest('a.shop-chip.link, a.prod');
    if (link) {
      var href = link.getAttribute('href') || '';
      track('shop_click', {
        ingredient: link.dataset.ing || '',
        link_type: link.classList.contains('prod') ? 'product'
                 : href.indexOf('link.coupang.com') !== -1 ? 'deeplink' : 'search',
        recipe_id: shownRecipeId || ''
      });
    }
  });

  window.addEventListener('popstate', function (e) {
    var id = (e.state && e.state.r) || recipeIdFromUrl();
    if (id) openRecipeById(id);
    else if (!el.modal.hidden) closeModal(true);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
  });

  el.themeBtn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(dark ? 'light' : 'dark');
  });

  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    el.themeBtn.textContent = mode === 'dark' ? '☀️' : '🌙';
    try { localStorage.setItem(LS.theme, mode); } catch (e) { /* 저장 불가 환경 */ }
  }

  /* ── 앱 설치 (PWA) ────────────────────────────── */

  var installEvent = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e;
    el.installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', function () {
    installEvent = null;
    el.installBtn.hidden = true;
    track('app_install');
  });

  el.installBtn.addEventListener('click', function () {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.then(function () {
      installEvent = null;
      el.installBtn.hidden = true;
    });
  });

  // 서비스워커는 http(s) 에서만 동작한다. file:// 로 열었을 때는 조용히 넘어간다.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 기능만 빠진다 */ });
    });
  }

  /* ── 시작 ─────────────────────────────────────── */

  (function init() {
    var kinds = [];
    RECIPES.forEach(function (r) { if (kinds.indexOf(r.kind) === -1) kinds.push(r.kind); });
    kinds.forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = k;
      el.kindSel.appendChild(o);
    });

    var saved = null;
    try { saved = localStorage.getItem(LS.theme); } catch (e) { saved = null; }
    if (saved === 'dark' || saved === 'light') applyTheme(saved);
    else el.themeBtn.textContent = window.matchMedia('(prefers-color-scheme: dark)').matches ? '☀️' : '🌙';

    // 좁은 화면에서는 '빠르게 담기'가 결과를 너무 아래로 밀어내므로 접어 둔다
    if (window.innerWidth <= 860) {
      var quickGroup = el.quickPick.closest('details');
      if (quickGroup) quickGroup.open = false;
    }

    if (isAffiliate() && AFF.disclosure) {
      el.disclosure.textContent = AFF.disclosure;
      el.disclosure.hidden = false;
    }

    if (analyticsOn()) initAnalytics();

    renderQuickPick();
    renderStaples();
    renderChips();
    renderResults();

    if (isFirstVisit()) showStaplesHint();

    var fromUrl = recipeIdFromUrl();
    if (fromUrl) openRecipeById(fromUrl);
  })();
})();
