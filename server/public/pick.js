// Страница отбора фото для учеников: найти себя (с кодом из 4 цифр), выбрать личные фото
// и отметить, какое куда в альбоме, написать про доп. ретушь, вместе с классом собрать
// групповые, написать цитату и пожелание себе в будущее
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
  var byId = {};
  photos.forEach(function (p) { byId[p.id] = p; });
  // Места в альбоме: [ключ, название]; на кнопках — коротко
  var PLACES = D.placeList || [];
  var SHORT = { cover: 'Обложка', page: 'Личная', list: 'Список' };
  var hint = false;     // все фото выбраны — подсвечиваем места и ретушь

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

  // Стрелка «откроется в новой вкладке» — та же, что на сайте и в админке
  function arrow() {
    var s = el('span', { class: 'arr-w', 'aria-hidden': 'true' });
    s.innerHTML = '<svg class="arr" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 11.5l7-7M6 4.5h5.5V10"/></svg>';
    return s;
  }

  var toastEl = document.querySelector('.toast');
  // action: [текст кнопки, что сделать] — например «Наверх ↑»
  function toast(text, bad, action) {
    toastEl.textContent = text;
    toastEl.classList.toggle('is-bad', !!bad);
    if (action) {
      toastEl.appendChild(el('button', { type: 'button', class: 'toast__go', text: action[0], onclick: function () { toastEl.hidden = true; action[1](); } }));
    }
    toastEl.hidden = false;
    clearTimeout(toastEl.tm);
    toastEl.tm = setTimeout(function () { toastEl.hidden = true; }, bad ? 5000 : action ? 7000 : 2200);
  }

  function setState(j) {
    var who = S.me ? S.me.id : 0;
    S = Object.assign({}, S, j);
    return (S.me ? S.me.id : 0) !== who;
  }

  function api(path, body, keep) {
    return fetch(base + path, {
      method: 'POST', credentials: 'same-origin', keepalive: !!keep,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        var changed = false;
        if (j.state) changed = setState(j.state);
        else if (r.ok && !j.error) changed = setState(j);
        if (!r.ok) throw Object.assign(new Error(j.error || 'Не получилось. Попробуйте ещё раз'), { pin: j.pin, status: r.status });
        return changed;
      });
    }, function () {
      throw new Error('Нет связи. Проверьте интернет и попробуйте ещё раз');
    });
  }

  // Текст сохраняется сам: через секунду после того, как перестали печатать, и при уходе со страницы
  function autosave(ta, send, status) {
    var timer = null, sent = ta.value, busy = null;
    function flush(keep) {
      clearTimeout(timer);
      timer = null;
      var v = ta.value;
      if (v === sent) return busy || Promise.resolve();
      status.textContent = 'Сохраняем…';
      status.className = 'save';
      var p = send(v, keep).then(function () {
        sent = v;
        if (ta.value === v) { status.textContent = 'Сохранено ✓'; status.className = 'save is-ok'; }
        paint();
      }, function (e) {
        status.textContent = e.message;
        status.className = 'save is-bad';
      });
      busy = p.then(function () { busy = null; });
      return p;
    }
    ta.addEventListener('input', function () {
      ta.dataset.dirty = '1';
      status.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(flush, 1200);
    });
    ta.addEventListener('blur', function () { flush(); });
    flushers.push(function () { flush(true); });
    return { flush: flush, reset: function (v) { sent = v; } };
  }
  var flushers = [];
  function flushAll() { flushers.forEach(function (f) { f(); }); }
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushAll(); });

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
    if (!p.group && on && (S.retouch || {})[p.id] && !confirm('Убрать это фото? Пожелание по ретуши к нему тоже удалится')) return Promise.resolve();
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
        if (p.group || on) return;
        var full = before < S.personalMax && (S.mine || []).length >= S.personalMax;
        // сразу спрашиваем, куда пойдёт фото; последнее свободное место заполняем сами
        return afterPick(p.id).then(function (auto) {
          if (!full) return auto && toast('Это фото пойдёт сюда: ' + auto);
          hint = true;
          if (!lb.hidden) closeLb();
          toast('Все ' + S.personalMax + ' фото выбраны!' + (auto ? ' Последнее пойдёт сюда: ' + auto + '.' : '') + ' Если нужна доп. ретушь, напишите под фото', false, ['Наверх ↑', toMine]);
        });
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
        list.appendChild(el('li', {}, [el('button', { type: 'button', onclick: function () { askPin(s); } }, [
          s.name, s.locked ? el('span', { class: 'who__lock', title: 'Уже вошли, нужен код', text: '🔒' }) : null
        ])]));
      });
      if (!list.children.length) list.appendChild(el('li', { class: 'muted', text: D.students.length ? 'Никого не нашли. Проверьте, как написано имя' : 'Артур ещё не добавил список класса' }));
    }
    input.addEventListener('input', fill);
    fill();
    app.textContent = '';
    app.appendChild(compressNote());
    app.appendChild(el('section', { class: 'who' }, [
      el('h2', { text: 'Найдите себя в списке' }),
      el('p', { class: 'muted', text: 'Выбирайте только себя. При первом входе придумаете код из 4 цифр, чтобы никто другой не зашёл в ваш выбор.' }),
      input, list
    ]));
  }

  // Окно с кодом: придумать при первом входе или ввести, если уже входили
  function askPin(s) {
    var fresh = !s.locked;
    var input = el('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off', class: 'pin', 'aria-label': 'Код из 4 цифр', placeholder: '••••' });
    var err = el('p', { class: 'dlg__err', hidden: true });
    var ok = el('button', { type: 'submit', class: 'btn btn--main', text: 'Войти' });
    var form = el('form', { class: 'dlg__box', novalidate: '' }, [
      el('h2', { text: s.name }),
      el('p', { class: 'muted', text: fresh
        ? 'Придумайте код из 4 цифр и запомните его, лучше сделайте скрин. С ним вы зайдёте снова, а без него в ваш выбор никто не попадёт.'
        : 'Под этим именем уже заходили, введите свой код. Если забыли код или вы здесь впервые, напишите Артуру.' }),
      input, err,
      el('div', { class: 'dlg__btns' }, [el('button', { type: 'button', class: 'btn', text: 'Это не я', onclick: close }), ok])
    ]);
    var dlg = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true' }, [form]);
    function close() { dlg.remove(); }
    input.addEventListener('input', function () { input.value = input.value.replace(/\D/g, '').slice(0, 4); err.hidden = true; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!/^\d{4}$/.test(input.value)) { err.textContent = 'Нужно 4 цифры'; err.hidden = false; return; }
      ok.disabled = true;
      api('/me', fresh ? { student: s.id, newPin: input.value } : { student: s.id, pin: input.value })
        .then(function () {
          close();
          if (fresh) toast('Ваш код: ' + input.value + '. Запомните его!', false, ['Понятно', function () {}]);
          render();
        })
        .catch(function (e2) {
          // код успели придумать раньше — дальше только ввод кода
          if (e2.pin === 'ask' && fresh) { s.locked = true; close(); askPin(s); return toast(e2.message, true); }
          err.textContent = e2.message;
          err.hidden = false;
          input.value = '';
          input.focus();
        })
        .then(function () { ok.disabled = false; });
    });
    document.body.appendChild(dlg);
    setTimeout(function () { input.focus(); }, 50);
  }

  // Заметно сверху: фото здесь сжатые, оригиналы — по ссылке
  function compressNote() {
    return el('div', { class: 'note note--orig' }, [
      el('span', {}, [el('b', { text: 'Здесь сжатые фото, только для выбора' }),
        S.wfolio ? 'Не скриньте их, оригиналы в хорошем качестве можно скачать по кнопке' : 'Не скриньте их, оригиналы в хорошем качестве Артур пришлёт отдельно']),
      S.wfolio ? el('a', { class: 'btn btn--orig', href: S.wfolio, target: '_blank', rel: 'noopener' }, ['Оригиналы', arrow()]) : null
    ]);
  }

  function renderHeader() {
    var who = document.querySelector('[data-who]');
    who.textContent = '';
    if (S.me) {
      who.appendChild(document.createTextNode(S.me.name + ' · '));
      who.appendChild(el('button', { type: 'button', text: 'не вы?', onclick: function () {
        api('/leave').then(render).catch(function (e) { toast(e.message, true); });
      } }));
    } else if (S.admin) who.textContent = 'Вы вошли как Артур';
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
      } else {
        // на выбранном личном фото — куда оно пойдёт
        var role = on ? (S.roles || {})[id] : '';
        t.by.hidden = !role;
        t.by.textContent = role ? SHORT[role] || role : '';
      }
    });
    paintMine();
    Array.prototype.forEach.call(app.querySelectorAll('.sec[data-group]'), function (sec) {
      sec.hidden = !sec.querySelector('.tile:not([hidden])');
    });
    var texts = (S.quote ? 1 : 0) + (S.wish ? 1 : 0);
    var info = {
      personal: [(S.mine || []).length + ' из ' + S.personalMax + (rolesLeft().length && (S.mine || []).length ? ' · места' : ''), personalDone()],
      group: [(S.group || []).length + ' из ' + S.groupMax, (S.group || []).length >= S.groupMax],
      quote: [texts + ' из 2', texts === 2]
    };
    Array.prototype.forEach.call(app.querySelectorAll('.tabs [data-tab]'), function (b) {
      var i = info[b.getAttribute('data-tab')];
      if (!i) return;
      b.querySelector('small').textContent = i[1] ? '✓ ' + i[0] : i[0];
      b.classList.toggle('is-done', !!i[1] && !S.admin);
    });
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
  var lbRoles = el('div', { class: 'lb__roles', hidden: true });
  var lbNote = el('p', { class: 'lb__note' });
  lb.appendChild(lbBy);
  lb.appendChild(lbCount);
  lb.appendChild(lbPrev);
  lb.appendChild(lbNext);
  lb.insertBefore(lbNote, lb.querySelector('.lb__bar'));
  lb.insertBefore(lbRoles, lb.querySelector('.lb__bar'));

  function openLb(p, mineOnly) {
    // листаем то, что видно сейчас на вкладке (из «Вашего выбора» — только выбранные)
    lbList = mineOnly ? (S.mine || []).map(function (id) { return byId[id]; }).filter(Boolean)
      : photos.filter(function (x) { var t = tiles[x.id]; return t && !t.el.hidden; });
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
    // куда пойдёт выбранное личное фото — можно отметить прямо здесь
    lbRoles.hidden = p.group || !on || !S.me || !PLACES.length;
    if (!lbRoles.hidden) fillRoles(lbRoles, p.id);
    lbNote.textContent = 'Сжатая копия для выбора, не скриньте';
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

  // ---------- места в альбоме и доп. ретушь ----------
  function rolesNeed() { return Math.min(PLACES.length, S.personalMax); }
  function rolesUsed() { var r = S.roles || {}; return (S.mine || []).filter(function (id) { return r[id]; }); }
  // Места, которые ещё не отмечены (пока отмечено меньше, чем нужно)
  function rolesLeft() {
    if (rolesUsed().length >= rolesNeed()) return [];
    var taken = {};
    rolesUsed().forEach(function (id) { taken[S.roles[id]] = true; });
    return PLACES.filter(function (pl) { return !taken[pl[0]]; });
  }
  function personalDone() { return (S.mine || []).length >= S.personalMax && !rolesLeft().length; }

  var rolePending = {};
  function setRole(id, role) {
    if (rolePending[id] || !canEdit()) return;
    var cur = (S.roles || {})[id] || '';
    var next = cur === role ? '' : role;
    // место было у другого фото — оно перейдёт сюда
    var from = next && (S.mine || []).filter(function (x) { return x !== id && S.roles[x] === next; })[0];
    rolePending[id] = true;
    paint();
    api('/role', { photo: id, role: next })
      .then(function () {
        if (from) toast(PLACES.filter(function (p) { return p[0] === next; })[0][1] + ' теперь на этом фото');
        // осталось одно фото без места и одно свободное место — ставим сами
        var u = unplaced(), left = rolesLeft();
        if ((S.mine || []).length >= S.personalMax && u.length === 1 && left.length === 1 && next) {
          return api('/role', { photo: u[0], role: left[0][0] }).then(function () { toast('Оставшееся фото пойдёт сюда: ' + left[0][1]); });
        }
      })
      .catch(function (e) { toast(e.message, true); })
      .then(function () { delete rolePending[id]; paint(); });
  }

  function fillRoles(box, id) {
    var cur = (S.roles || {})[id] || '';
    if (box.dataset.sig === id + ':' + cur + ':' + !!rolePending[id] + ':' + canEdit() + ':' + JSON.stringify(S.roles)) return;
    box.dataset.sig = id + ':' + cur + ':' + !!rolePending[id] + ':' + canEdit() + ':' + JSON.stringify(S.roles);
    box.textContent = '';
    var others = {};
    (S.mine || []).forEach(function (x) { if (x !== id && S.roles && S.roles[x]) others[S.roles[x]] = true; });
    PLACES.forEach(function (pl) {
      box.appendChild(el('button', {
        type: 'button', class: 'role' + (cur === pl[0] ? ' is-on' : '') + (others[pl[0]] ? ' is-taken' : ''),
        'aria-pressed': cur === pl[0] ? 'true' : 'false', disabled: !canEdit() || rolePending[id] ? '' : null,
        title: others[pl[0]] ? pl[1] + ' уже у другого фото. Нажмите, чтобы перенести сюда' : pl[1],
        onclick: function () { setRole(id, pl[0]); }
      }, [cur === pl[0] ? '✓ ' : '', SHORT[pl[0]] || pl[1]]));
    });
  }

  // Фото без места, когда места ещё нужны
  function unplaced() { var r = S.roles || {}; return (S.mine || []).filter(function (id) { return !r[id]; }); }

  // Только что выбранное фото: если свободное место одно и фото без места тоже одно —
  // ставим его туда сами (иначе кто-то обязательно забудет), иначе спрашиваем окном
  function afterPick(id) {
    if (!PLACES.length || (S.roles || {})[id] || !rolesLeft().length) return Promise.resolve();
    var left = rolesLeft();
    if ((S.mine || []).length >= S.personalMax && left.length === 1 && unplaced().length === 1) {
      return api('/role', { photo: id, role: left[0][0] }).then(function () {
        paint();
        return left[0][1];
      }, function (e) { toast(e.message, true); });
    }
    return askPlace(id);
  }

  function askPlace(id) {
    return new Promise(function (done) {
      var p = byId[id];
      var taken = {};
      (S.mine || []).forEach(function (x) { if (x !== id && S.roles && S.roles[x]) taken[S.roles[x]] = true; });
      var opts = el('div', { class: 'place-opts' });
      var dlg;
      function close() { dlg.remove(); paint(); done(); }
      PLACES.forEach(function (pl) {
        opts.appendChild(el('button', { type: 'button', class: 'place-opt' + (taken[pl[0]] ? ' is-taken' : ''), onclick: function () {
          api('/role', { photo: id, role: pl[0] }).then(close, function (e) { toast(e.message, true); close(); });
        } }, [
          // как это фото ляжет в макет
          MOCK[pl[0]] ? el('span', { class: 'place-opt__mock' }, [mockEl(pl[0], p, false)]) : null,
          el('span', { class: 'place-opt__txt' }, [el('b', { text: pl[1] }), el('small', { text: taken[pl[0]] ? 'Сейчас там другое фото, поставим это вместо него' : ABOUT[pl[0]] || '' })])
        ]));
      });
      dlg = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true' }, [el('div', { class: 'dlg__box dlg__box--place' }, [
        el('h2', { text: 'Куда пойдёт это фото?' }),
        el('p', { class: 'muted', text: 'Выберите место в альбоме. Картинки — примерный просмотр, не дизайн' }),
        opts,
        el('button', { type: 'button', class: 'place-later', text: 'Решу потом', onclick: close })
      ])]);
      document.body.appendChild(dlg);
    });
  }

  // ---------- конструктор: фото ученика в макетах альбома ----------
  // Макеты дизайнера (PNG с прозрачными окнами под фото). Координаты — в пикселях исходного макета.
  // Обложка: вшитые школа, класс, год и цитата убраны, их подставляем свои
  var MOCK = {
    cover: { w: 1420, h: 2000, tpl: '/admin/static/pk-cover.png', photo: [0, 0, 1420, 2000] },
    page: { w: 2000, h: 1423, tpl: '/admin/static/pk-page.webp', photo: [0, 0, 1000, 1423] },
    list: { w: 2000, h: 1423, tpl: '/admin/static/pk-list.webp', photo: [1346, 500, 265, 378], under: true }
  };
  var SERIF = "'Cormorant Garamond', 'Times New Roman', Georgia, serif";
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Короткие строки по словам, не больше n строк; лишнее — многоточием
  function wrap(text, max, n) {
    var words = String(text || '').replace(/\s+/g, ' ').trim().split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      if (lines.length >= n) return;
      if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    });
    if (cur && lines.length < n) lines.push(cur);
    var all = String(text || '').replace(/\s+/g, ' ').trim();
    if (lines.join(' ').length < all.length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:!?…]*$/, '') + '…';
    return lines;
  }
  function svgText(x, y, size, anchor, fill, text, extra) {
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" text-anchor="' + anchor + '" fill="' + fill + '" font-family="' + SERIF.replace(/"/g, '') + '"' + (extra || '') + '>' + esc(text) + '</text>';
  }
  function img(href, x, y, w, h, fit) {
    return '<image href="' + href + '" xlink:href="' + href + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" preserveAspectRatio="' + (fit || 'none') + '"/>';
  }
  // SVG-макет: role — место, p — фото (или null), big — крупная копия фото
  function mockSvg(role, p, big) {
    var m = MOCK[role];
    if (!m) return '';
    var name = S.me ? S.me.name.toUpperCase() : 'ФАМИЛИЯ ИМЯ';
    var k = D.klass || {};
    var ph = p ? img(src(p, big), m.photo[0], m.photo[1], m.photo[2], m.photo[3], 'xMidYMid slice') : '';
    var empty = p ? '' : '<rect x="' + m.photo[0] + '" y="' + m.photo[1] + '" width="' + m.photo[2] + '" height="' + m.photo[3] + '" fill="#E9E1D5"/>';
    var tpl = img(m.tpl, 0, 0, m.w, m.h);
    var out = m.under ? tpl + empty + ph : empty + ph + tpl;
    var beige = '#BAA28A';
    if (role === 'cover') {
      var cls = String(k.title || '').toUpperCase();
      if (cls && !/КЛАСС/.test(cls)) cls += ' КЛАСС';
      out += svgText(1362, 224, 43, 'end', beige, String(k.school || '').toUpperCase(), ' letter-spacing="1"');
      out += svgText(1362, 278, 43, 'end', beige, cls, ' letter-spacing="1"');
      out += svgText(87, 278, 43, 'start', beige, k.year || '');
      wrap(S.quote || 'Здесь будет ваша цитата', 44, 2).forEach(function (line, i) { out += svgText(710, 1905 + i * 60, 50, 'middle', beige, line); });
    } else if (role === 'page') {
      out += svgText(914, 1138, 44, 'end', '#fff', name, ' letter-spacing="1"');
      out += svgText(912, 1160, 15, 'end', '#fff', (wrap(S.quote || 'Здесь будет ваша цитата', 70, 1)[0] || '').toUpperCase());
    } else if (role === 'list') {
      // под окном подписи нет — пишем имя ученика тем же размером, длинное ужимаем
      var size = Math.min(30, Math.round(30 * 16 / Math.max(16, name.length)));
      out += svgText(1478, 911, size, 'middle', '#1E1A18', name, ' letter-spacing="1"');
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + m.w + ' ' + m.h + '" role="img" aria-label="Предпросмотр">' + out + '</svg>';
  }
  function mockEl(role, p, big, cls) {
    var box = el('span', { class: 'mock mock--' + role + (cls ? ' ' + cls : '') });
    box.innerHTML = mockSvg(role, p, big);
    return box;
  }
  function photoFor(role) {
    var r = S.roles || {};
    var id = (S.mine || []).filter(function (x) { return r[x] === role; })[0];
    return id ? byId[id] : null;
  }

  // Крупный просмотр макета
  function openMock(role) {
    var pl = PLACES.filter(function (x) { return x[0] === role; })[0];
    var dlg = el('div', { class: 'mockview', role: 'dialog', 'aria-modal': 'true' }, [
      el('p', { class: 'mockview__t', text: (pl ? pl[1] : '') + ' · предварительный просмотр, не дизайн' }),
      mockEl(role, photoFor(role), true, 'mock--big'),
      el('button', { type: 'button', class: 'btn', text: 'Закрыть', onclick: function () { dlg.remove(); document.body.style.overflow = ''; } })
    ]);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(dlg);
  }

  // «Как это будет в альбоме» — под «Ваш выбор»
  var prevBox = null, prevSig = '';
  function renderPreview(box) {
    prevSig = '';
    prevBox = el('section', { class: 'prev' }, [
      el('div', { class: 'mine__h' }, [el('h2', { text: 'Как это будет в альбоме' })]),
      el('p', { class: 'mine__status', text: 'Предварительный просмотр расположения, а не дизайн альбома. Нажмите, чтобы посмотреть крупнее.' }),
      el('div', { class: 'prev__row' })
    ]);
    box.appendChild(prevBox);
  }
  function paintPreview() {
    if (!prevBox || !prevBox.isConnected) return;
    var sig = JSON.stringify([S.mine, S.roles, S.quote, S.me && S.me.name]);
    if (sig === prevSig) return;
    prevSig = sig;
    var row = prevBox.querySelector('.prev__row');
    row.textContent = '';
    PLACES.forEach(function (pl) {
      if (!MOCK[pl[0]]) return;
      var p = photoFor(pl[0]);
      row.appendChild(el('button', { type: 'button', class: 'prev__card prev__card--' + pl[0], onclick: function () { openMock(pl[0]); } }, [
        mockEl(pl[0], p, false),
        el('b', { text: pl[1] }),
        el('small', { text: p ? 'ваше фото' : 'фото ещё не отмечено' })
      ]));
    });
  }

  var mineBox = null, mineRows = {};
  function renderMine(box) {
    mineRows = {};
    mineBox = el('section', { class: 'mine', id: 'mine' }, [
      el('div', { class: 'mine__h' }, [el('h2', { text: 'Ваш выбор' }), el('span', { class: 'mine__n' })]),
      el('p', { class: 'mine__status' }),
      el('div', { class: 'mine__list' })
    ]);
    box.appendChild(mineBox);
  }

  function mineRow(id) {
    var p = byId[id];
    var roles = el('div', { class: 'roles' });
    var ta = el('textarea', { maxlength: '500', rows: '2', placeholder: 'Например: убрать покраснение на щеке, чуть подправить нос', 'aria-label': 'Что подправить на ретуши' });
    ta.value = (S.retouch || {})[id] || '';
    var status = el('small', { class: 'save' });
    var ret = el('div', { class: 'ret', hidden: !ta.value }, [ta, status]);
    var retBtn = el('button', { type: 'button', class: 'ret__btn', onclick: function () {
      ret.hidden = !ret.hidden;
      hint = false;
      paint();
      if (!ret.hidden) ta.focus();
    } });
    autosave(ta, function (v, keep) { return api('/retouch', { photo: id, text: v }, keep); }, status);
    var row = el('div', { class: 'mine__row' }, [
      el('button', { type: 'button', class: 'mine__img', 'aria-label': 'Посмотреть крупно', onclick: function () { if (p) openLb(p, true); } }, [p ? el('img', { src: src(p), alt: '' }) : null]),
      el('div', { class: 'mine__body' }, [
        el('p', { class: 'mine__q', text: 'Куда в альбоме:' }), roles, retBtn, ret
      ]),
      el('button', { type: 'button', class: 'mine__x', 'aria-label': 'Убрать фото', title: 'Убрать фото', text: '×', onclick: function () { if (p) toggle(p); } })
    ]);
    return { el: row, roles: roles, ta: ta, ret: ret, retBtn: retBtn };
  }

  // Синхронизировать «Ваш выбор» с состоянием, не трогая поле, в котором сейчас пишут
  function paintMine() {
    if (!mineBox || !mineBox.isConnected) return;
    var list = mineBox.querySelector('.mine__list');
    var mine = (S.mine || []).filter(function (id) { return byId[id]; });
    Object.keys(mineRows).forEach(function (id) {
      if (mine.indexOf(id) === -1) { mineRows[id].el.remove(); delete mineRows[id]; }
    });
    mine.forEach(function (id) {
      if (!mineRows[id]) mineRows[id] = mineRow(id);
      list.appendChild(mineRows[id].el);   // порядок как в выборе
      var r = mineRows[id];
      fillRoles(r.roles, id);
      var text = (S.retouch || {})[id] || '';
      if (document.activeElement !== r.ta && !r.ta.dataset.dirty && r.ta.value !== text) r.ta.value = text;
      r.ta.disabled = !canEdit();
      r.el.querySelector('.mine__x').hidden = !canEdit();
      r.retBtn.textContent = text ? '✎ Доп. ретушь: ' + (text.length > 40 ? text.slice(0, 40) + '…' : text) : '✎ Нужна доп. ретушь? Напишите';
      r.retBtn.disabled = !canEdit() && !text;
      r.retBtn.classList.toggle('is-hint', hint && !text && r.ret.hidden);
      r.el.classList.toggle('needs-role', !(S.roles || {})[id] && rolesLeft().length > 0 && (hint || mine.length >= S.personalMax));
    });
    mineBox.querySelector('.mine__n').textContent = mine.length + ' из ' + S.personalMax;
    var st = mineBox.querySelector('.mine__status');
    var left = rolesLeft();
    if (!mine.length) st.textContent = 'Выберите свои фото ниже: нажмите на кружок на фото или откройте фото и нажмите «Выбрать».';
    else if (left.length) st.textContent = 'Отметьте, какое фото куда. Осталось: ' + left.slice(0, rolesNeed() - rolesUsed().length).map(function (p) { return p[1]; }).join(', ') + '.';
    else if (mine.length < S.personalMax) st.textContent = 'Выберите ещё ' + (S.personalMax - mine.length) + ' фото.';
    else st.textContent = 'Фото выбраны, места отмечены ✓';
    st.classList.toggle('is-ok', personalDone());
    mineBox.classList.toggle('is-hint', hint && left.length > 0);
    paintPreview();
  }

  function toMine() {
    var m = document.getElementById('mine');
    if (m) m.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Схема альбома: где обложка, личная страница и список класса. Это схема, а не дизайн
  var SVG = {
    cover: '<svg viewBox="0 0 60 80" aria-hidden="true"><rect x="2" y="2" width="56" height="76" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="10" width="40" height="46" rx="2" class="hl"/><rect x="14" y="62" width="32" height="4" rx="2" fill="currentColor" opacity=".5"/><rect x="20" y="69" width="20" height="3" rx="1.5" fill="currentColor" opacity=".3"/></svg>',
    page: '<svg viewBox="0 0 100 70" aria-hidden="true"><rect x="2" y="2" width="96" height="66" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><line x1="50" y1="2" x2="50" y2="68" stroke="currentColor" stroke-width="1.5" opacity=".4"/><rect x="8" y="8" width="36" height="54" rx="2" class="hl"/><rect x="57" y="14" width="34" height="4" rx="2" fill="currentColor" opacity=".5"/><rect x="57" y="24" width="30" height="3" rx="1.5" fill="currentColor" opacity=".3"/><rect x="57" y="31" width="33" height="3" rx="1.5" fill="currentColor" opacity=".3"/><rect x="57" y="38" width="26" height="3" rx="1.5" fill="currentColor" opacity=".3"/></svg>',
    list: '<svg viewBox="0 0 100 70" aria-hidden="true"><rect x="2" y="2" width="96" height="66" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>' +
      [0, 1, 2].map(function (r) { return [0, 1, 2, 3, 4].map(function (c) { return '<rect x="' + (9 + c * 17.5) + '" y="' + (8 + r * 20) + '" width="12" height="12" rx="1.5" ' + (r === 1 && c === 2 ? 'class="hl"' : 'fill="currentColor" opacity=".22"') + '/><rect x="' + (8 + c * 17.5) + '" y="' + (22 + r * 20) + '" width="14" height="2" rx="1" fill="currentColor" opacity=".3"/>'; }).join(''); }).join('') + '</svg>'
  };
  var ABOUT = { cover: 'крупно, на вашем альбоме', page: 'ваша страница внутри', list: 'маленькое, среди всего класса' };
  function scheme() {
    var d = el('details', { class: 'scheme', open: (S.mine || []).length ? null : '' }, [
      el('summary', { text: 'Как устроен альбом: куда какое фото' })
    ]);
    var row = el('div', { class: 'scheme__row' });
    PLACES.forEach(function (pl) {
      var pic = el('span', { class: 'scheme__pic' });
      pic.innerHTML = SVG[pl[0]] || '';
      row.appendChild(el('figure', {}, [pic, el('figcaption', {}, [el('b', { text: pl[1] }), ABOUT[pl[0]] || ''])]));
    });
    d.appendChild(row);
    d.appendChild(el('p', { class: 'muted scheme__note', text: 'Это схема расположения, а не дизайн альбома. Из своих ' + S.personalMax + ' фото отметьте, какое куда.' }));
    return d;
  }

  // «Всё готово» — фото выбраны, места отмечены, цитата и пожелание написаны
  function finished() { return !!S.me && personalDone() && !!S.quote && !!S.wish; }
  function doneNote() {
    return el('div', { class: 'note note--done', 'data-done': '', hidden: !finished() || !!S.closed }, [
      el('b', { text: 'Готово, всё выбрано! 🎉' }),
      'Выбор сохранён, страницу можно закрыть. Пока Артур не закрыл отбор, всё можно поменять.'
    ]);
  }

  function renderPersonal(box) {
    box.appendChild(el('div', { class: 'note note--closed', 'data-closed': '', hidden: !S.closed }, [el('b', { text: 'Отбор закрыт' }), 'Ваш выбор сохранён, менять его уже нельзя.']));
    box.appendChild(doneNote());
    if (PLACES.length) box.appendChild(scheme());
    renderMine(box);
    renderPreview(box);
    var secs = sections(false);
    box.appendChild(el('div', { class: 'note' }, [el('b', { text: 'Выберите ' + S.personalMax + ' своих фото' }), 'Нажмите на фото, чтобы посмотреть крупно, или на кружок, чтобы сразу выбрать. Передумали? Нажмите ещё раз.']));
    if (!secs.length) box.appendChild(el('p', { class: 'muted', text: 'Фото ещё не загружены.' }));
    secs.forEach(function (s) {
      box.appendChild(el('section', { class: 'sec' }, [el('h2', {}, [s.name, el('small', { text: s.list.length + ' фото' })]), grid(s.list)]));
    });
  }

  function renderGroup(box) {
    box.appendChild(el('div', { class: 'note note--closed', 'data-closed': '', hidden: !S.closed }, [el('b', { text: 'Отбор закрыт' }), S.admin ? 'Ученики уже не могут менять выбор, а вы можете.' : 'Групповые выбраны.']));
    box.appendChild(el('div', { class: 'note note--group' }, [
      el('b', { text: 'Это общий выбор всего класса' }),
      S.admin ? 'Отметьте групповые, которые предлагаете. Ребята увидят и смогут заменить.'
        : 'Все видят одни и те же отмеченные фото. Если уберёте фото, оно уберётся у всех. Всего можно ' + S.groupMax + '. Когда набрано, чтобы добавить новое, сначала уберите другое.'
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

  function textBlock(o) {
    var ta = el('textarea', { maxlength: String(o.max), placeholder: o.placeholder, 'aria-label': o.title, rows: '5' });
    ta.value = S[o.key] || '';
    ta.disabled = !canEdit();
    var count = el('span', { class: 'muted count' });
    var status = el('small', { class: 'save' });
    function upd() { count.textContent = ta.value.length + ' / ' + o.max; }
    ta.addEventListener('input', upd);
    upd();
    var saver = autosave(ta, function (v, keep) { return api(o.path, { text: v }, keep); }, status);
    var btn = el('button', { type: 'button', class: 'btn btn--main', text: 'Сохранить', disabled: canEdit() ? null : '' });
    btn.addEventListener('click', function () {
      btn.disabled = true;
      saver.flush().then(function () { if (!status.classList.contains('is-bad')) toast(o.saved); })
        .then(function () { btn.disabled = !canEdit(); });
    });
    return el('section', { class: 'quote' + (o.cls ? ' ' + o.cls : '') }, [
      el('h2', { text: o.title }),
      el('p', { class: 'muted', text: o.about }),
      ta, el('div', { class: 'quote__foot' }, [btn, status, count])
    ]);
  }

  function renderQuote(box) {
    box.appendChild(el('div', { class: 'note note--closed', 'data-closed': '', hidden: !S.closed }, [el('b', { text: 'Отбор закрыт' }), 'Тексты сохранены, менять их уже нельзя.']));
    box.appendChild(doneNote());
    box.appendChild(textBlock({
      key: 'quote', path: '/quote', max: 2000, title: 'Ваша цитата для альбома', saved: 'Цитата сохранена',
      about: 'Будет в альбоме рядом с вашими фото. Можно короткую фразу, а можно несколько абзацев. Сохраняется сама.',
      placeholder: 'Например: «Не важно, где мы будем, важно — что мы были вместе»'
    }));
    box.appendChild(textBlock({
      key: 'wish', path: '/wish', max: 2000, title: '🔒 Пожелание себе в будущее', saved: 'Пожелание сохранено', cls: 'quote--wish',
      about: 'Напиши себе пожелание, совет или послание в будущее. Его никто кроме тебя не увидит, место будет секретом, узнаешь когда получишь альбом 🫶',
      placeholder: 'Что вы хотите сказать себе через 5–10 лет?'
    }));
  }

  function renderBar() {
    var bar = document.querySelector('.bar');
    var n, max, label;
    if (tab === 'personal') { n = (S.mine || []).length; max = S.personalMax; label = 'Ваши фото'; }
    else if (tab === 'group') { n = (S.group || []).length; max = S.groupMax; label = 'Групповые класса'; }
    if ((!label && !S.wfolio) || (!S.me && !S.admin)) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = el('div', { class: 'bar' }, [el('div', { class: 'bar__in' }, [
        el('span', { class: 'bar__info' }, [el('span', { 'data-l': '' }), el('small', { 'data-left': '' })]),
        el('span', { class: 'bar__n' }),
        el('a', { class: 'bar__orig', target: '_blank', rel: 'noopener' }, ['Оригиналы', arrow()])
      ])]);
      document.body.appendChild(bar);
    }
    var info = bar.querySelector('.bar__info');
    info.hidden = !label;
    bar.querySelector('.bar__n').hidden = !label;
    if (label) {
      var left = max - n;
      bar.querySelector('[data-l]').textContent = label;
      bar.querySelector('[data-left]').textContent = left > 0 ? 'осталось выбрать ' + left : left === 0 ? (tab === 'personal' && rolesLeft().length ? 'отметьте места' : 'всё выбрано') : 'выбрано больше нужного';
      bar.querySelector('.bar__n').textContent = n + ' / ' + max;
    }
    var orig = bar.querySelector('.bar__orig');
    orig.hidden = !S.wfolio;
    if (S.wfolio) orig.href = S.wfolio;
  }

  function render() {
    flushAll();
    flushers = [];
    renderHeader();
    tiles = {};
    mineBox = null;
    prevBox = null;
    if (!S.me && !S.admin) { renderBar(); return renderWho(); }
    var tabs = S.admin ? [['group', 'Групповые']] : [['personal', 'Мои фото'], ['group', 'Групповые'], ['quote', 'Тексты']];
    if (!tab || !tabs.some(function (t) { return t[0] === tab; })) tab = tabs[0][0];
    app.textContent = '';
    if (!S.admin) app.appendChild(compressNote());
    var nav = el('div', { class: 'tabs tabs--' + tabs.length, role: 'tablist' });
    tabs.forEach(function (t) {
      nav.appendChild(el('button', { type: 'button', role: 'tab', 'data-tab': t[0], 'aria-selected': tab === t[0] ? 'true' : 'false', onclick: function () {
        if (tab === t[0]) return;
        tab = t[0];
        render();
        window.scrollTo(0, 0);
      } }, [el('b', { text: t[1] }), el('small')]));
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
      var key = function () { return JSON.stringify([S.group, S.mine, S.roles, S.retouch, S.closed, S.personalMax, S.groupMax, S.wfolio]); };
      var before = key();
      if (setState(j)) return render();
      if (key() !== before) paint();
    }).catch(function () {});
  }
  setInterval(poll, 6000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  render();
})();
