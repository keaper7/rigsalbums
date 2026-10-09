// Страница отбора фото для учеников: найти себя, выбрать личные фото,
// вместе с классом собрать групповые и написать цитату
(function () {
  'use strict';

  var D = JSON.parse(document.getElementById('pk-data').textContent);
  var app = document.getElementById('app');
  var base = '/f/' + D.slug;
  var S = D;            // текущее состояние, обновляется ответами сервера
  var tab = null;
  var onlyChosen = false;
  var tiles = {};       // id фото → плитка на экране
  var pending = {};     // фото, по которому ждём ответа сервера
  var photos = D.photos.map(function (p) { return { id: p[0], section: p[1], w: p[2], h: p[3], group: !!p[4], v: p[5] || 0 }; });

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  var toastEl = document.querySelector('.toast');
  function toast(text, bad) {
    toastEl.textContent = text;
    toastEl.classList.toggle('is-bad', !!bad);
    toastEl.hidden = false;
    clearTimeout(toastEl.tm);
    toastEl.tm = setTimeout(function () { toastEl.hidden = true; }, bad ? 5000 : 2200);
  }

  function setState(j) {
    var who = S.me ? S.me.id : 0;
    S = Object.assign({}, S, j);
    return (S.me ? S.me.id : 0) !== who;
  }

  function api(path, body) {
    return fetch(base + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        var changed = false;
        if (j.state) changed = setState(j.state);
        else if (r.ok) changed = setState(j);
        if (!r.ok) throw new Error(j.error || 'Не получилось. Попробуйте ещё раз');
        return changed;
      });
    }, function () {
      throw new Error('Нет связи. Проверьте интернет и попробуйте ещё раз');
    });
  }

  function groupMap() {
    var m = {};
    (S.group || []).forEach(function (g) { m[g[0]] = g[1]; });
    return m;
  }

  function myName() { return S.me ? S.me.name : 'Артур'; }
  function canEdit() { return !S.closed || S.admin; }
  function src(p, big) { return base + '/p/' + p.id + (big ? '' : '-sm') + '.jpg?v=' + p.v; }

  function sections(isGroup) {
    var out = [], seen = {};
    photos.forEach(function (p) {
      if (p.group !== isGroup) return;
      if (!seen[p.section]) { seen[p.section] = { name: p.section, list: [] }; out.push(seen[p.section]); }
      seen[p.section].list.push(p);
    });
    return out;
  }

  // ---------- выбор ----------
  function isOn(p) {
    if (p.group) return groupMap()[p.id] !== undefined;
    return (S.mine || []).indexOf(p.id) !== -1;
  }

  function toggle(p) {
    if (pending[p.id]) return Promise.resolve();
    if (!canEdit()) { toast('Отбор уже закрыт', true); return Promise.resolve(); }
    var on = isOn(p);
    if (p.group && on) {
      var by = groupMap()[p.id];
      if (by !== myName() && !confirm('Это фото выбрал(а) ' + by + '. Убрать его из общего выбора класса?')) return Promise.resolve();
    }
    pending[p.id] = true;
    paint();
    var before = (S.mine || []).length;
    return api(p.group ? '/group' : '/pick', { photo: p.id, on: !on })
      .then(function (changed) {
        if (changed) return render();
        // подсказываем, что дальше, когда свои фото набраны
        if (!p.group && !on && before < S.personalMax && (S.mine || []).length >= S.personalMax) {
          toast(S.quote ? 'Готово: все ' + S.personalMax + ' фото выбраны' : 'Все ' + S.personalMax + ' фото выбраны. Осталось написать цитату');
        }
      })
      .catch(function (e) { toast(e.message, true); })
      .then(function () { delete pending[p.id]; paint(); });
  }

  // ---------- кто я ----------
  function renderWho() {
    var list = el('ul');
    var input = el('input', { type: 'search', placeholder: 'Начните вводить имя', autocomplete: 'off', 'aria-label': 'Поиск по имени' });
    function fill() {
      var q = input.value.trim().toLowerCase();
      list.textContent = '';
      D.students.filter(function (s) { return !q || s.name.toLowerCase().indexOf(q) !== -1; }).forEach(function (s) {
        list.appendChild(el('li', {}, [el('button', { type: 'button', text: s.name, onclick: function () {
          var q = s.started
            ? 'Под именем «' + s.name + '» уже выбирали фото. Это точно вы?\n\nЕсли это не вы — нажмите «Отмена» и найдите своё имя.'
            : 'Вы — ' + s.name + '?';
          if (!confirm(q)) return;
          api('/me', { student: s.id }).then(render).catch(function (e) { toast(e.message, true); });
        } })]));
      });
      if (!list.children.length) list.appendChild(el('li', { class: 'muted', text: D.students.length ? 'Никого не нашли. Проверьте, как написано имя' : 'Артур ещё не добавил список класса' }));
    }
    input.addEventListener('input', fill);
    fill();
    app.textContent = '';
    app.appendChild(el('section', { class: 'who' }, [
      el('h2', { text: 'Найдите себя в списке' }),
      el('p', { class: 'muted', text: 'Так мы поймём, чьи это фото и цитата. Выбирайте только себя.' }),
      input, list
    ]));
  }

  function renderHeader() {
    var who = document.querySelector('[data-who]');
    who.textContent = '';
    if (S.me) {
      who.appendChild(document.createTextNode(S.me.name + ' · '));
      who.appendChild(el('button', { type: 'button', text: 'не вы?', onclick: function () {
        api('/leave').then(render).catch(function (e) { toast(e.message, true); });
      } }));
    } else if (S.admin) who.textContent = 'Вы — Артур';
  }

  // ---------- плитки ----------
  function makeTile(p) {
    var mark = el('span', { class: 'tile__mark', 'aria-hidden': 'true' });
    var by = el('span', { class: 'tile__by', hidden: true });
    var b = el('button', { type: 'button', class: 'tile' }, [
      el('img', { src: src(p), alt: '', loading: 'lazy', decoding: 'async', width: '160', height: '160' }), mark, by
    ]);
    b.addEventListener('click', function (e) {
      // на кружок — сразу выбрать, на фото — открыть крупно
      if (e.target === mark) toggle(p);
      else openLb(p);
    });
    tiles[p.id] = { el: b, mark: mark, by: by, p: p };
    return b;
  }

  // Обновить отметки и счётчики, не перерисовывая страницу
  function paint() {
    var gm = groupMap();
    Object.keys(tiles).forEach(function (id) {
      var t = tiles[id];
      var on = t.p.group ? gm[id] !== undefined : (S.mine || []).indexOf(id) !== -1;
      t.el.classList.toggle('is-on', on);
      t.el.classList.toggle('is-wait', !!pending[id]);
      t.el.setAttribute('aria-pressed', on ? 'true' : 'false');
      t.el.setAttribute('aria-label', (on ? 'Выбрано. ' : '') + t.p.section);
      t.mark.textContent = pending[id] ? '…' : on ? '✓' : '+';
      if (t.p.group) {
        t.by.hidden = !on;
        t.by.textContent = on ? gm[id] : '';
        t.el.hidden = onlyChosen && !on;
      }
    });
    Array.prototype.forEach.call(app.querySelectorAll('.sec[data-group]'), function (sec) {
      sec.hidden = !sec.querySelector('.tile:not([hidden])');
    });
    var counts = { personal: (S.mine || []).length + '/' + S.personalMax, group: (S.group || []).length + '/' + S.groupMax, quote: S.quote ? '✓' : '' };
    Array.prototype.forEach.call(app.querySelectorAll('.tabs [data-tab]'), function (b) { b.querySelector('b').textContent = counts[b.getAttribute('data-tab')] ? ' ' + counts[b.getAttribute('data-tab')] : ''; });
    var f = app.querySelector('[data-filter-n]');
    if (f) f.textContent = (S.group || []).length;
    var closed = app.querySelector('[data-closed]');
    if (closed) closed.hidden = !S.closed;
    var dn = app.querySelector('[data-done]');
    if (dn) dn.hidden = !finished() || !!S.closed;
    renderBar();
    if (!lb.hidden) paintLb();
  }

  // ---------- просмотр крупно ----------
  var lb = document.querySelector('[data-lb]');
  var lbImg = lb.querySelector('img');
  var lbPick = lb.querySelector('[data-lb-pick]');
  var lbList = [], lbAt = 0;
  var lbBy = el('span', { class: 'lb__by' });
  var lbCount = el('span', { class: 'lb__n' });
  var lbPrev = el('button', { type: 'button', class: 'lb__nav lb__nav--prev', 'aria-label': 'Предыдущее фото', text: '‹' });
  var lbNext = el('button', { type: 'button', class: 'lb__nav lb__nav--next', 'aria-label': 'Следующее фото', text: '›' });
  lb.appendChild(lbBy);
  lb.appendChild(lbCount);
  lb.appendChild(lbPrev);
  lb.appendChild(lbNext);

  function openLb(p) {
    // листаем то, что видно сейчас на вкладке
    lbList = photos.filter(function (x) { var t = tiles[x.id]; return t && !t.el.hidden; });
    lbAt = Math.max(0, lbList.indexOf(p));
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    showLb();
  }
  function showLb() {
    var p = lbList[lbAt];
    if (!p) return closeLb();
    // сначала маленькая копия из кэша, потом подменяем большой
    lbImg.src = src(p);
    var big = new Image();
    big.onload = function () { if (lbList[lbAt] === p) lbImg.src = big.src; };
    big.src = src(p, true);
    // соседние заранее, чтобы листалось без ожидания
    [lbList[lbAt - 1], lbList[lbAt + 1]].forEach(function (q) { if (q) new Image().src = src(q, true); });
    paintLb();
  }
  function paintLb() {
    var p = lbList[lbAt];
    if (!p) return;
    var on = isOn(p);
    lbPick.textContent = pending[p.id] ? '…' : !canEdit() ? (on ? 'Выбрано' : 'Отбор закрыт') : on ? 'Убрать' : 'Выбрать';
    lbPick.classList.toggle('is-on', on);
    lbPick.disabled = !canEdit() || !!pending[p.id];
    var by = p.group ? groupMap()[p.id] : undefined;
    lbBy.textContent = by !== undefined ? 'Выбрал(а): ' + by : '';
    lbCount.textContent = (lbAt + 1) + ' / ' + lbList.length;
    lbPrev.hidden = lbAt === 0;
    lbNext.hidden = lbAt >= lbList.length - 1;
  }
  function step(d) {
    var n = lbAt + d;
    if (n < 0 || n >= lbList.length) return;
    lbAt = n;
    showLb();
  }
  function closeLb() { lb.hidden = true; lbImg.removeAttribute('src'); document.body.style.overflow = ''; }
  lb.querySelector('[data-lb-close]').addEventListener('click', closeLb);
  lbPick.addEventListener('click', function () { var p = lbList[lbAt]; if (p) toggle(p); });
  lbPrev.addEventListener('click', function () { step(-1); });
  lbNext.addEventListener('click', function () { step(1); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
  // свайп влево-вправо
  var touchX = null, touchY = null;
  lbImg.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  lbImg.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ---------- вкладки ----------
  function grid(list) {
    var g = el('div', { class: 'grid' });
    list.forEach(function (p) { g.appendChild(makeTile(p)); });
    return g;
  }

  // «Всё готово» — свои фото набраны и цитата есть
  function finished() { return !!S.me && (S.mine || []).length >= S.personalMax && !!S.quote; }
  function doneNote() {
    return el('div', { class: 'note note--done', 'data-done': '', hidden: !finished() || !!S.closed }, [
      el('b', { text: 'Готово, всё выбрано! 🎉' }),
      'Выбор сохранён — страницу можно закрыть. Пока Артур не закрыл отбор, его можно поменять.'
    ]);
  }

  function renderPersonal(box) {
    box.appendChild(el('div', { class: 'note note--closed', 'data-closed': '', hidden: !S.closed }, [el('b', { text: 'Отбор закрыт' }), 'Ваш выбор сохранён, менять его уже нельзя.']));
    box.appendChild(doneNote());
    box.appendChild(el('div', { class: 'note' }, [el('b', { text: 'Выберите ' + S.personalMax + ' своих фото' }), 'Нажмите на фото, чтобы посмотреть крупно, или на кружок, чтобы сразу выбрать. Передумали — нажмите ещё раз.']));
    var secs = sections(false);
    if (!secs.length) box.appendChild(el('p', { class: 'muted', text: 'Фото ещё не загружены.' }));
    secs.forEach(function (s) {
      box.appendChild(el('section', { class: 'sec' }, [el('h2', {}, [s.name, el('small', { text: s.list.length + ' фото' })]), grid(s.list)]));
    });
  }

  function renderGroup(box) {
    box.appendChild(el('div', { class: 'note note--closed', 'data-closed': '', hidden: !S.closed }, [el('b', { text: 'Отбор закрыт' }), S.admin ? 'Ученики уже не могут менять выбор, вы — можете.' : 'Групповые выбраны.']));
    box.appendChild(el('div', { class: 'note note--group' }, [
      el('b', { text: 'Это общий выбор всего класса' }),
      S.admin ? 'Отметьте групповые, которые предлагаете. Ребята увидят и смогут заменить.'
        : 'Все видят одни и те же отмеченные фото. Если уберёте фото — оно уберётся у всех. Всего можно ' + S.groupMax + ': чтобы добавить новое, когда набрано, сначала уберите другое.'
    ]));
    var f = el('input', { type: 'checkbox' });
    f.checked = onlyChosen;
    f.addEventListener('change', function () { onlyChosen = f.checked; paint(); });
    box.appendChild(el('label', { class: 'filter' }, [f, 'Показать только выбранные (', el('span', { 'data-filter-n': '' }), ')']));
    var secs = sections(true);
    if (!secs.length) box.appendChild(el('p', { class: 'muted', text: 'Групповые фото ещё не загружены.' }));
    secs.forEach(function (s) {
      box.appendChild(el('section', { class: 'sec', 'data-group': '' }, [el('h2', {}, [s.name, el('small', { text: s.list.length + ' фото' })]), grid(s.list)]));
    });
  }

  function renderQuote(box) {
    var ta = el('textarea', { maxlength: '400', placeholder: 'Например: «Не важно, где мы будем, важно — что мы были вместе»', 'aria-label': 'Цитата' });
    ta.value = S.quote || '';
    ta.disabled = !canEdit();
    var count = el('span', { class: 'muted' });
    var btn = el('button', { type: 'button', class: 'btn btn--main', text: 'Сохранить цитату' });
    function upd() { count.textContent = ' ' + ta.value.length + ' / 400'; }
    ta.addEventListener('input', upd);
    upd();
    btn.disabled = !canEdit();
    btn.addEventListener('click', function () {
      btn.disabled = true;
      api('/quote', { text: ta.value }).then(function () { ta.value = S.quote || ''; upd(); toast('Цитата сохранена'); paint(); })
        .catch(function (e) { toast(e.message, true); }).then(function () { btn.disabled = !canEdit(); });
    });
    box.appendChild(el('div', { class: 'note note--closed', 'data-closed': '', hidden: !S.closed }, [el('b', { text: 'Отбор закрыт' }), 'Цитата сохранена, менять её уже нельзя.']));
    box.appendChild(doneNote());
    box.appendChild(el('section', { class: 'quote' }, [
      el('h2', { text: 'Ваша цитата для альбома' }),
      el('p', { class: 'muted', text: 'Фраза, которая будет рядом с вашими фото. До 400 символов.' }),
      ta, el('div', {}, [btn, count])
    ]));
  }

  function renderBar() {
    var bar = document.querySelector('.bar');
    var n, max, label;
    if (tab === 'personal') { n = (S.mine || []).length; max = S.personalMax; label = 'Ваши фото'; }
    else if (tab === 'group') { n = (S.group || []).length; max = S.groupMax; label = 'Групповые класса'; }
    if (!label || (!S.me && !S.admin)) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = el('div', { class: 'bar' }, [el('div', { class: 'bar__in' }, [el('span', {}, [el('span', { 'data-l': '' }), el('small', { 'data-left': '' })]), el('span', { class: 'bar__n' })])]);
      document.body.appendChild(bar);
    }
    var left = max - n;
    bar.querySelector('[data-l]').textContent = label;
    bar.querySelector('[data-left]').textContent = left > 0 ? 'осталось выбрать ' + left : left === 0 ? 'всё выбрано' : 'выбрано больше нужного';
    bar.querySelector('.bar__n').textContent = n + ' / ' + max;
  }

  function render() {
    renderHeader();
    tiles = {};
    if (!S.me && !S.admin) { renderBar(); return renderWho(); }
    var tabs = S.admin ? [['group', 'Групповые']] : [['personal', 'Мои фото'], ['group', 'Групповые'], ['quote', 'Цитата']];
    if (!tab || !tabs.some(function (t) { return t[0] === tab; })) tab = tabs[0][0];
    app.textContent = '';
    var nav = el('div', { class: 'tabs', role: 'tablist' });
    tabs.forEach(function (t) {
      nav.appendChild(el('button', { type: 'button', role: 'tab', 'data-tab': t[0], 'aria-selected': tab === t[0] ? 'true' : 'false', onclick: function () {
        if (tab === t[0]) return;
        tab = t[0];
        render();
        window.scrollTo(0, 0);
      } }, [t[1], el('b')]));
    });
    app.appendChild(nav);
    var box = el('div');
    if (tab === 'personal') renderPersonal(box);
    else if (tab === 'group') renderGroup(box);
    else renderQuote(box);
    app.appendChild(box);
    paint();
  }

  // Подтягиваем выбор одноклассников, пока страница открыта
  function poll() {
    if (document.hidden || (!S.me && !S.admin)) return;
    fetch(base + '/state', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      var before = JSON.stringify([S.group, S.mine, S.closed, S.personalMax, S.groupMax]);
      if (setState(j)) return render();
      if (JSON.stringify([S.group, S.mine, S.closed, S.personalMax, S.groupMax]) !== before) paint();
    }).catch(function () {});
  }
  setInterval(poll, 6000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  render();
})();
