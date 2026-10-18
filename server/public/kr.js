// Классный руководитель: выбор фото на обложку и в общий список, пожелание классу.
// Каждое нажатие и текст сохраняются сами, отдельной кнопки нет
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('kr-data').textContent);
  var url = '/kr/' + data.token + '/save';
  var state = data.state;
  var bar = document.querySelector('[data-bar]');
  var status = document.querySelector('[data-status]');
  var pending = 0;

  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(text) {
    var t = document.querySelector('.toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(t.tm);
    t.tm = setTimeout(function () { t.hidden = true; }, 6000);
  }

  function show(text, kind) {
    status.textContent = text;
    bar.classList.toggle('is-ok', kind === 'ok');
    bar.classList.toggle('is-bad', kind === 'bad');
  }

  // Что ещё осталось: подсказка внизу экрана
  function summary() {
    var left = [];
    if (document.querySelector('[data-role=cover]') && !state.cover) left.push('фото на обложку');
    if (document.querySelector('[data-role=list]') && !state.list) left.push('фото в общий список');
    if (!state.wish) left.push('пожелание');
    $$('.kr-step').forEach(function (s) {
      var id = s.id;
      s.classList.toggle('is-done', id === 'wish' ? !!state.wish : !!state[id]);
    });
    if (!left.length) show('Всё выбрано и сохранено ✓', 'ok');
    else show('Сохранено. Осталось: ' + left.join(', '), '');
  }

  function save(body) {
    pending++;
    show('Сохраняем…', '');
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (j.state) state = j.state;
        if (!r.ok || j.error) throw new Error(j.error || 'Не сохранилось. Попробуйте ещё раз');
        state = j;
      });
    }, function () {
      throw new Error('Нет интернета, не сохранилось. Попробуйте ещё раз');
    }).then(function () {
      pending--;
      if (!pending) summary();
    }, function (err) {
      pending--;
      show(err.message, 'bad');
      toast(err.message);
      paint();
      throw err;
    });
  }

  function paint() {
    $$('.kr-grid').forEach(function (g) {
      var role = g.getAttribute('data-role');
      $$('.kr-sel', g).forEach(function (b) {
        var on = state[role] === b.getAttribute('data-id');
        b.parentNode.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  }

  // Нажатие на фото — выбрать. Повторное нажатие на выбранное снимает выбор
  $$('.kr-grid').forEach(function (g) {
    var role = g.getAttribute('data-role');
    g.addEventListener('click', function (e) {
      var zoom = e.target.closest('.kr-zoom');
      if (zoom) return open(zoom.getAttribute('data-big'));
      var b = e.target.closest('.kr-sel');
      if (!b || b.disabled) return;
      var id = b.getAttribute('data-id');
      var body = {};
      body[role] = state[role] === id ? '' : id;
      state[role] = body[role];
      paint();
      save(body).catch(function () {});
    });
  });

  // Тексты сохраняются через секунду после того, как перестали печатать, и при выходе из поля
  $$('[data-field]').forEach(function (el) {
    var key = el.getAttribute('data-field');
    var tm = null, last = el.value;
    function flush() {
      clearTimeout(tm);
      if (el.value === last) return;
      last = el.value;
      var body = {};
      body[key] = el.value;
      save(body).catch(function () { last = null; });
    }
    el.addEventListener('input', function () { clearTimeout(tm); show('Печатаете…', ''); tm = setTimeout(flush, 1200); });
    el.addEventListener('blur', flush);
    window.addEventListener('pagehide', flush);
  });

  // Крупный просмотр
  var lb = document.querySelector('[data-lb]');
  function open(src) {
    lb.querySelector('img').src = src;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function close() {
    lb.hidden = true;
    lb.querySelector('img').removeAttribute('src');
    document.body.style.overflow = '';
  }
  lb.querySelector('[data-lb-close]').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lb.hidden) close(); });

  // Не уйти со страницы, пока что-то сохраняется
  window.addEventListener('beforeunload', function (e) { if (pending) { e.preventDefault(); e.returnValue = ''; } });

  if (!state.closed) summary();
})();
