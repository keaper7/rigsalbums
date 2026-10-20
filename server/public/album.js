// Проверка альбома учеником: вход по коду из отбора, «Моя страница», правки дизайнеру и «всё верно»
(function () {
  'use strict';

  function post(url, data) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(data || {}), credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || 'Не получилось. Попробуйте ещё раз'); e.data = j; throw e; }
          return j;
        });
      });
  }
  function show(el, text) { if (!el) return; el.textContent = text || ''; el.hidden = !text; }

  // ---------- вход ----------
  var login = document.querySelector('[data-al-login]');
  if (login) {
    var sel = login.querySelector('[data-al-student]');
    var box = login.querySelector('[data-al-pinbox]');
    var label = login.querySelector('[data-al-pinlabel]');
    var pin = login.querySelector('[data-al-pin]');
    var go = login.querySelector('[data-al-go]');
    var err = login.querySelector('[data-al-err]');
    var fresh = false;
    function check() { go.disabled = !sel.value || !/^\d{4}$/.test(pin.value); }
    sel.addEventListener('change', function () {
      var o = sel.options[sel.selectedIndex];
      fresh = o && o.getAttribute('data-locked') === '0';
      label.textContent = fresh ? 'Придумай код из 4 цифр, чтобы потом заходить' : 'Код из отбора фото';
      box.hidden = !sel.value;
      show(err, '');
      check();
      if (sel.value) pin.focus();
    });
    pin.addEventListener('input', function () { pin.value = pin.value.replace(/\D/g, '').slice(0, 4); check(); });
    pin.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) go.click(); });
    go.addEventListener('click', function () {
      go.disabled = true;
      var data = { student: +sel.value };
      data[fresh ? 'newPin' : 'pin'] = pin.value;
      post(login.getAttribute('data-me'), data).then(function () { location.reload(); }, function (e) {
        show(err, e.message);
        if (e.data && e.data.pin === 'ask' && fresh) { fresh = false; label.textContent = 'Код из отбора фото'; }
        check();
      });
    });
    return;
  }

  // «Не я» — выйти и выбрать другого ученика
  var leave = document.querySelector('[data-al-leave]');
  if (leave) leave.addEventListener('click', function () {
    var m = /^(\/f\/[^/]+)\//.exec(location.pathname);
    if (m) post(m[1] + '/leave').then(function () { location.reload(); }, function () { location.reload(); });
  });

  var book = document.querySelector('[data-book]');
  if (!book) return;

  // «Моя страница» и «Моя обложка»: альбом сам пролистывается
  Array.prototype.forEach.call(document.querySelectorAll('[data-al-goto]'), function (b) {
    b.addEventListener('click', function () {
      if (!book.bkGo) return;
      book.scrollIntoView({ behavior: 'smooth', block: 'center' });
      book.bkGo(+b.getAttribute('data-al-goto'), b.getAttribute('data-al-side'));
    });
  });

  // Страница в полном качестве в новой вкладке: мелкий текст цитат так читается лучше,
  // на телефоне её можно растянуть пальцами
  var full = document.querySelector('[data-al-full]');
  function fullLinks() {
    if (!full || !book.bkState) return;
    var st = book.bkState(), base = book.getAttribute('data-base'), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var l = full.querySelector('[data-al-full-l]'), r = full.querySelector('[data-al-full-r]');
    if (st.cur === 0) { full.hidden = false; l.hidden = true; r.hidden = false; r.textContent = 'обложка'; r.href = base + book.getAttribute('data-front') + '.jpg'; return; }
    if (st.cur > st.n) { full.hidden = false; r.hidden = true; l.hidden = false; l.textContent = 'задник'; l.href = base + book.getAttribute('data-back') + '.jpg'; return; }
    full.hidden = false; l.hidden = false; r.hidden = false;
    l.textContent = 'левая страница'; r.textContent = 'правая страница';
    l.href = base + 's' + pad(st.cur) + '-l.jpg';
    r.href = base + 's' + pad(st.cur) + '-r.jpg';
  }
  book.addEventListener('bk:change', fullLinks);
  fullLinks();

  var checkBox = document.querySelector('[data-al-check]');
  if (!checkBox) return;
  var form = checkBox.querySelector('[data-al-fix]');
  var where = checkBox.querySelector('[data-al-where]');
  var text = checkBox.querySelector('[data-al-text]');
  var ferr = checkBox.querySelector('[data-al-fixerr]');
  var mine = book.getAttribute('data-mine') || '';

  // Где ошибка — по умолчанию страница, которая сейчас открыта: своя, если она на этом развороте
  function guess() {
    var s = book.bkState ? book.bkState() : { cur: 0, n: 0 };
    if (s.cur === 0 || s.cur > s.n) return 'cover';
    if (s.single) return s.cur + '-' + s.focus;
    var m = /^s(\d{2})-([lr])$/.exec(mine);
    if (m && +m[1] === s.cur) return s.cur + '-' + m[2];
    return s.cur + '-l';
  }
  book.addEventListener('bk:change', function () { if (form.hidden) where.value = guess(); });

  checkBox.querySelector('[data-al-fixopen]').addEventListener('click', function () {
    where.value = guess();
    form.hidden = false;
    show(ferr, '');
    text.focus();
  });
  checkBox.querySelector('[data-al-fixclose]').addEventListener('click', function () { form.hidden = true; });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    post(checkBox.getAttribute('data-fix'), { where: where.value, text: text.value }).then(function () { location.reload(); }, function (er) {
      show(ferr, er.message);
      btn.disabled = false;
    });
  });

  Array.prototype.forEach.call(checkBox.querySelectorAll('[data-al-ok]'), function (b) {
    b.addEventListener('click', function () {
      b.disabled = true;
      post(checkBox.getAttribute('data-ok'), { on: b.getAttribute('data-al-ok') === '1' }).then(function () { location.reload(); }, function () { b.disabled = false; });
    });
  });
})();
