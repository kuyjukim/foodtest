(function () {
  'use strict';

  var RECIPES = window.RECIPES || [];
  var SYNONYMS = window.SYNONYMS || {};
  var GROUPS = window.INGREDIENT_GROUPS || {};
  var SUBSTITUTES = window.SUBSTITUTES || [];
  var STAPLES = window.PANTRY_STAPLES || [];
  var CATEGORIES = window.INGREDIENT_CATEGORIES || [];

  var LS = { pantry: 'fridge.pantry', staples: 'fridge.staples', theme: 'fridge.theme' };

  /* ── 재료 이름 다루기 ──────────────────────────── */

  function norm(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  // 별칭 사전을 공백 무시로 찾을 수 있게 다시 만든다
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

  // 서로 바꿔 쓸 수 있는 재료 색인
  var subIndex = {};
  SUBSTITUTES.forEach(function (set) {
    set.forEach(function (name) {
      subIndex[name] = (subIndex[name] || []).concat(set.filter(function (m) { return m !== name; }));
    });
  });

  // 앱이 아는 재료 전부 (오타·미등록 재료를 알려주기 위한 목록)
  var vocabulary = (function () {
    var map = {};   // 표시 이름 -> 대표 이름
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
    stapleOff: load(LS.staples, []),   // 집에 없다고 체크 해제한 기본 양념
    search: '',
    kind: '',
    maxTime: '',
    sort: 'match',
    readyOnly: false,
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

  // 담은 재료 + 켜둔 기본 양념 + 그 재료들이 속한 큰 범주
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

  function has(pantry, need) {
    if (pantry[need]) return true;
    var subs = subIndex[need];
    if (subs) for (var i = 0; i < subs.length; i++) if (pantry[subs[i]]) return true;
    var members = GROUPS[need];
    if (members) for (var j = 0; j < members.length; j++) if (pantry[members[j]]) return true;
    return false;
  }

  function evaluate(recipe, pantry) {
    var missEss = [], haveEss = [], missOpt = [], haveOpt = [];
    recipe.essential.forEach(function (i) { (has(pantry, i) ? haveEss : missEss).push(i); });
    recipe.optional.forEach(function (i) { (has(pantry, i) ? haveOpt : missOpt).push(i); });
    var total = recipe.essential.length + recipe.optional.length;
    return {
      recipe: recipe,
      missEss: missEss, haveEss: haveEss,
      missOpt: missOpt, haveOpt: haveOpt,
      ready: missEss.length === 0,
      coverage: total ? Math.round(((haveEss.length + haveOpt.length) / total) * 100) : 0
    };
  }

  /* ── 그리기 ───────────────────────────────────── */

  var el = {};
  ['ingInput', 'suggest', 'chips', 'pantryCount', 'pantryEmpty', 'clearBtn', 'quickPick',
   'staples', 'searchInput', 'kindSel', 'timeSel', 'sortSel', 'readyOnly', 'vegOnly',
   'summary', 'cards', 'noResult', 'modal', 'modalTitle', 'modalMeta', 'modalBody', 'themeBtn'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

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

  function renderResults() {
    var pantry = buildPantrySet();
    var results = RECIPES.map(function (r) { return evaluate(r, pantry); });

    var shown = results.filter(function (m) {
      var r = m.recipe;
      if (state.search && r.name.replace(/\s+/g, '').indexOf(state.search) === -1) return false;
      if (state.kind && r.kind !== state.kind) return false;
      if (state.maxTime && r.time > Number(state.maxTime)) return false;
      if (state.vegOnly && !r.veg) return false;
      if (state.readyOnly && !m.ready) return false;
      return true;
    });

    shown.sort(sorter(state.sort));

    el.cards.innerHTML = '';
    shown.forEach(function (m) { el.cards.appendChild(card(m)); });

    var readyCount = results.filter(function (m) { return m.ready; }).length;
    var nearCount = results.filter(function (m) { return m.missEss.length > 0 && m.missEss.length <= 2; }).length;

    if (state.pantry.length === 0) {
      el.summary.innerHTML = '재료를 담으면 <b>지금 만들 수 있는 요리</b>부터 보여드립니다. ' +
        '지금은 전체 <b>' + RECIPES.length + '개</b> 요리를 보여주고 있어요.';
    } else {
      el.summary.innerHTML = '바로 만들 수 있는 요리 <b>' + readyCount + '개</b>' +
        ' · 1~2가지만 더 있으면 <b>' + nearCount + '개</b>' +
        ' <span class="muted">(전체 ' + RECIPES.length + '개 중)</span>';
    }

    if (shown.length === 0) {
      el.noResult.hidden = false;
      el.noResult.textContent = state.readyOnly
        ? '조건에 맞게 바로 만들 수 있는 요리가 없습니다. 재료를 더 담거나 ‘바로 만들 수 있는 것만’을 끄고 보세요.'
        : '조건에 맞는 요리가 없습니다. 검색어나 필터를 바꿔 보세요.';
    } else {
      el.noResult.hidden = true;
    }
  }

  function sorter(mode) {
    if (mode === 'time') return function (a, b) { return a.recipe.time - b.recipe.time || a.recipe.name.localeCompare(b.recipe.name, 'ko'); };
    if (mode === 'few') return function (a, b) {
      var ca = a.recipe.essential.length + a.recipe.optional.length;
      var cb = b.recipe.essential.length + b.recipe.optional.length;
      return ca - cb || a.recipe.name.localeCompare(b.recipe.name, 'ko');
    };
    if (mode === 'name') return function (a, b) { return a.recipe.name.localeCompare(b.recipe.name, 'ko'); };
    return function (a, b) {
      if (a.missEss.length !== b.missEss.length) return a.missEss.length - b.missEss.length;
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      return a.recipe.time - b.recipe.time;
    };
  }

  function card(m) {
    var r = m.recipe;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'card' + (m.ready ? ' is-ready' : '');

    var top = document.createElement('div');
    top.className = 'card-top';
    var h = document.createElement('h3');
    h.textContent = r.name;
    top.appendChild(h);

    var badge = document.createElement('span');
    if (m.ready) {
      badge.className = 'badge ready';
      badge.textContent = '바로 가능';
    } else {
      badge.className = 'badge ' + (m.missEss.length <= 2 ? 'near' : 'far');
      badge.textContent = m.missEss.length + '가지 부족';
    }
    top.appendChild(badge);
    b.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'meta-row';
    meta.innerHTML = '<span>' + r.kind + '</span><span>' + r.time + '분</span><span>' + r.difficulty + '</span>';
    b.appendChild(meta);

    var bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<i style="width:' + m.coverage + '%"></i>';
    b.appendChild(bar);

    var need = document.createElement('p');
    if (m.ready) {
      need.className = 'need ok';
      need.innerHTML = '<b>✓ 필수 재료 다 있어요</b> · 선택 재료 ' + m.haveOpt.length + '/' + r.optional.length;
    } else {
      need.className = 'need';
      need.innerHTML = '부족: <b>' + m.missEss.join(', ') + '</b>';
    }
    b.appendChild(need);

    b.addEventListener('click', function () { openModal(m); });
    return b;
  }

  /* ── 상세 보기 ────────────────────────────────── */

  var lastFocused = null;

  function openModal(m) {
    var r = m.recipe;
    lastFocused = document.activeElement;
    el.modalTitle.textContent = r.name;
    el.modalMeta.innerHTML = ['<span>' + r.category + ' · ' + r.kind + '</span>',
      '<span>조리 ' + r.time + '분</span>', '<span>난이도 ' + r.difficulty + '</span>',
      '<span>' + r.servings + '인분</span>',
      r.veg ? '<span>고기·해산물 없이 가능</span>' : ''].join('');

    var html = '';
    html += '<h3>필수 재료</h3>' + ingList(r.essential, m);
    if (r.optional.length) {
      html += '<h3>있으면 더 좋은 재료</h3>' + ingList(r.optional, m);
    }
    if (m.missEss.length) {
      html += '<p class="sub">없는 필수 재료: <b>' + m.missEss.join(', ') + '</b></p>';
    }
    html += '<h3>만드는 순서</h3><ol class="steps">' +
      r.steps.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ol>';
    if (r.tip) html += '<p class="tip">💡 ' + escapeHtml(r.tip) + '</p>';
    el.modalBody.innerHTML = html;

    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    el.modal.querySelector('.modal-close').focus();
  }

  function ingList(items, m) {
    var haveSet = {};
    m.haveEss.concat(m.haveOpt).forEach(function (i) { haveSet[i] = true; });
    return '<ul class="ing-list">' + items.map(function (i) {
      var own = !!haveSet[i];
      return '<li class="' + (own ? 'have' : 'miss') + '">' + (own ? '✓ ' : '') + escapeHtml(i) + '</li>';
    }).join('') + '</ul>';
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function escapeHtml(s) {
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
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        pick(i);
      });
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
  el.readyOnly.addEventListener('change', function () { state.readyOnly = el.readyOnly.checked; renderResults(); });
  el.vegOnly.addEventListener('change', function () { state.vegOnly = el.vegOnly.checked; renderResults(); });

  el.modal.addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
  });

  el.themeBtn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = cur ? cur === 'dark'
                   : window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(dark ? 'light' : 'dark');
  });

  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    el.themeBtn.textContent = mode === 'dark' ? '☀️' : '🌙';
    try { localStorage.setItem(LS.theme, mode); } catch (e) { /* 저장 불가 환경 */ }
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

    renderQuickPick();
    renderStaples();
    renderChips();
    renderResults();
  })();
})();
