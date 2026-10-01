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

  var LS = { pantry: 'fridge.pantry', staples: 'fridge.staples', theme: 'fridge.theme' };

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

  // 없을 때 대신 쓸 수 있는 재료 목록
  function swapOptions(recipe, need) {
    var list = (recipe.swaps && recipe.swaps[need]) || SWAPS[need] || [];
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
   'modalBody', 'themeBtn', 'installBtn', 'disclosure'
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


  /* ── 장보기 (쿠팡 파트너스) ───────────────────── */

  // Open API 로 미리 만들어 둔 딥링크 (tools/gen-coupang-links.js 가 생성)
  var DEEPLINKS = window.COUPANG_LINKS || {};

  // 제휴 관계가 실제로 있는 상태인가. 셋 중 하나라도 있어야 참.
  function isAffiliate() {
    if (!AFF.enabled) return false;
    if (AFF.partnerId) return true;
    if (AFF.links && Object.keys(AFF.links).length) return true;
    return Object.keys(DEEPLINKS).length > 0;
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
    return '<a class="shop-chip link" href="' + esc(url) + '" data-ing="' + esc(name) + '"' +
           ' target="_blank" rel="nofollow sponsored noopener noreferrer">' +
           esc(name) + '<span class="go">쿠팡 ↗</span></a>';
  }

  function shopSection(m) {
    if (!AFF.enabled || (!m.missEss.length && !m.missOpt.length)) return '';
    var html = '<h3>장보기</h3><div class="shop">';
    if (m.missEss.length) {
      html += '<div class="shop-row"><span class="shop-label need">필수</span><span class="shop-chips">' +
              m.missEss.map(shopChip).join('') + '</span></div>';
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

    html += shopSection(cur);

    el.modalBody.innerHTML = html;
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

  function closeModal() {
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
    if (e.target.hasAttribute('data-close')) closeModal();
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

    renderQuickPick();
    renderStaples();
    renderChips();
    renderResults();
  })();
})();
