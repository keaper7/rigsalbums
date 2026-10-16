// Работа над альбомами: форма правки у Артура и действия дизайнера без перезагрузки формы
(function () {
  'use strict';

  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(text, bad) {
    var t = document.querySelector('.toast');
    if (!t) return;
    t.textContent = text;
    t.classList.toggle('is-bad', !!bad);
    t.hidden = false;
    clearTimeout(t.tm);
    t.tm = setTimeout(function () { t.hidden = true; }, bad ? 6000 : 2200);
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.error) throw new Error(j.error || 'Не получилось. Попробуйте ещё раз');
        return j;
      });
    }, function () { throw new Error('Нет связи. Проверьте интернет и попробуйте ещё раз'); });
  }

  // После действия страница обновляется на том же месте
  var KEY = 'wk-scroll:' + location.pathname;
  function reload() {
    try { sessionStorage.setItem(KEY, String(window.scrollY)); } catch (e) {}
    location.reload();
  }
  try {
    var y = sessionStorage.getItem(KEY);
    if (y !== null) { sessionStorage.removeItem(KEY); window.scrollTo(0, +y); }
  } catch (e) {}

  // ---------- дизайнер: формы отправляются как JSON ----------
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.hasAttribute || !f.hasAttribute('data-dw')) return;
    e.preventDefault();
    var body = {};
    $$('input, textarea, select', f).forEach(function (el) { if (el.name) body[el.name] = el.value; });
    var btns = $$('button', f);
    btns.forEach(function (b) { b.disabled = true; });
    post(f.getAttribute('action'), body).then(reload, function (err) {
      btns.forEach(function (b) { b.disabled = false; });
      toast(err.message, true);
    });
  }, true);

  // Галочки «что сделано» сохраняются сразу
  $$('input[data-part]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      cb.disabled = true;
      post(cb.getAttribute('data-url'), { part: cb.getAttribute('data-part'), on: cb.checked })
        .then(function () { toast(cb.checked ? 'Отмечено' : 'Отметка снята'); }, function (err) { cb.checked = !cb.checked; toast(err.message, true); })
        .then(function () { cb.disabled = false; });
    });
  });

  // ---------- Артур: галочки этапов сохраняются сразу ----------
  var csrfMeta = document.querySelector('meta[name="csrf"]');
  $$('input[data-step]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var box = cb.closest('[data-stage]');
      var before = document.querySelector('.wk-stg.is-now');
      cb.disabled = true;
      fetch(cb.getAttribute('data-url'), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfMeta ? csrfMeta.getAttribute('content') : '' },
        body: JSON.stringify({ step: cb.getAttribute('data-step'), on: cb.checked })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || j.error) throw new Error(j.error || 'Не получилось сохранить');
          return j;
        });
      }, function () { throw new Error('Нет связи. Проверьте интернет'); }).then(function (j) {
        cb.closest('li').classList.toggle('is-on', cb.checked);
        var nowIndex = before ? +before.getAttribute('data-stage') : -1;
        // класс перешёл на другой этап — перерисуем страницу, чтобы открылся нужный
        if (j.stage !== nowIndex) { toast(j.finished ? 'Класс готов' : 'Следующий этап'); setTimeout(reload, 500); return; }
        var n = box.querySelectorAll('input[data-step]:checked').length;
        var all = box.querySelectorAll('input[data-step]').length;
        var c = box.querySelector('[data-stage-count]');
        if (c) c.textContent = n + ' из ' + all;
        toast(cb.checked ? 'Отмечено' : 'Отметка снята');
      }, function (err) {
        cb.checked = !cb.checked;
        toast(err.message, true);
      }).then(function () { cb.disabled = false; });
    });
  });

  // ---------- Артур: форма правки ----------
  // «Заменить цитату» сразу подставляет цитату ученика из отбора — остаётся поправить
  $$('.wk-fixform').forEach(function (f) {
    var ta = f.querySelector('textarea');
    var quote = f.getAttribute('data-quote') || '';
    $$('input[name=kind]', f).forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        ta.placeholder = r.getAttribute('data-hint') || '';
        var keep = ta.value && ta.value !== quote;
        if (r.value === 'quote' || r.value === 'typo') { if (!keep) ta.value = quote; }
        else if (!keep) ta.value = '';
      });
    });
  });

  // Открыть ученика по ссылке #st-12
  if (/^#st-/.test(location.hash)) {
    var d = document.querySelector(location.hash);
    if (d && d.tagName === 'DETAILS') d.open = true;
  }
})();
