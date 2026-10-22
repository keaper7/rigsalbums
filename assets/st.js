// Своя статистика сайта: какие страницы смотрят, откуда пришли, до каких блоков долистали
// и сколько на них пробыли, какие кнопки нажимают, сколько человек сейчас на сайте.
// Без cookie и без имён: только случайный номер браузера в localStorage
(function () {
  'use strict';
  if (!window.fetch || !window.JSON || !document.querySelectorAll) return;

  var path = location.pathname;
  // на страницах классов и отбора кнопки — это голосование и выбор фото, их не считаем
  var app = /^\/(k|f)\//.test(path);

  var vid = '';
  try {
    vid = localStorage.getItem('rs_v') || '';
    if (!/^[a-f0-9]{24}$/.test(vid)) {
      var a = new Uint8Array(12);
      (window.crypto || window.msCrypto).getRandomValues(a);
      vid = '';
      for (var i = 0; i < a.length; i++) vid += ('0' + a[i].toString(16)).slice(-2);
      localStorage.setItem('rs_v', vid);
    }
  } catch (e) { vid = ''; }

  var id = 0, key = '', ended = false;
  var visible = !document.hidden, last = Date.now(), active = 0, depth = 0;
  var spent = {}, reached = {}, current = '';

  function post(url, body, beacon) {
    var json = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))) return Promise.resolve(null); } catch (e) {}
    }
    return fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: !!beacon, headers: { 'Content-Type': 'application/json' }, body: json })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  // Время на странице и на блоке, который сейчас посередине экрана — только пока вкладка открыта
  function tick() {
    var now = Date.now();
    if (visible) {
      active += now - last;
      if (current) spent[current] = (spent[current] || 0) + (now - last);
    }
    last = now;
  }

  // Блоки страниц по-человечески. В вёрстку ничего не добавляем: находим блоки по их классам
  var NAMES = {
    'index.html': [['.hero', 'Первый экран'], ['section.flip', 'Листающийся альбом'], ['#live', 'Видео «вживую»'], ['#price', 'Цены'], ['section.gallery', 'Галерея работ'], ['section.perks', 'Альбом собирают ребята'], ['.home-studio', 'Студия'], ['.has-plane', 'Как всё проходит'], ['section.designs', 'Дизайны'], ['section.classpg', 'Страница класса'], ['section.why', 'Почему так дорого'], ['#end', 'Запись']],
    'works.html': [['section.ph', 'Шапка'], ['#albums', 'Альбомы целиком'], ['#individual', 'Индивидуальная'], ['#spring', 'Природа: весна'], ['#autumn', 'Природа: осень'], ['#school', 'В школе'], ['#studio', 'В студии'], ['#end', 'Запись']],
    'albums.html': [['section.ph', 'Шапка'], ['#end', 'Запись'], ['section.why', 'Почему так дорого'], ['section.price', 'Что входит'], ['section.sec--tint', 'Цены'], ['section.sec', 'Альбом']],
    'designs.html': [['section.ph', 'Шапка'], ['.sec--coll', 'Тематики'], ['#end', 'Запись'], ['section.sec', 'Одежда']],
    'studio.html': [['section.ph', 'Шапка'], ['#zones', 'Зоны студии'], ['.has-gamer', 'Что есть в студии'], ['#end', 'Запись'], ['section.sec--tint', 'Как всё проходит']],
    'contacts.html': [['section.ph', 'Шапка'], ['#about', 'Обо мне'], ['#end', 'Запись'], ['section.sec', 'Контакты']],
    'prep.html': [['section.ph', 'Шапка'], ['section.prep', 'Что подготовить']]
  };
  var file = path === '/' ? 'index.html' : path.replace(/^\//, '');
  var blocks = [];
  (NAMES[file] || []).forEach(function (x) {
    var el = Array.prototype.filter.call(document.querySelectorAll(x[0]), function (e) { return !e.__st; })[0];
    if (el) { el.__st = x[1]; blocks.push(el); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-st], article.tcard'), function (e) { if (blocks.indexOf(e) === -1) blocks.push(e); });

  function nameOf(el) {
    if (el.__st) return el.__st;
    var n = el.getAttribute('data-st');
    if (n) return n;
    var t = el.querySelector('h3, h2');
    return t ? 'Тематика ' + t.textContent.replace(/\s+/g, ' ').trim().slice(0, 30) : '';
  }
  // блок, внутри которого нажали
  function blockOf(el) {
    for (var e = el; e && e !== document.body; e = e.parentNode) if (blocks.indexOf(e) !== -1) return nameOf(e);
    return '';
  }

  if (window.IntersectionObserver && blocks.length) {
    // какой блок пересекает середину экрана
    var mid = new IntersectionObserver(function (list) {
      list.forEach(function (en) {
        if (!en.isIntersecting) return;
        tick();
        current = nameOf(en.target);
      });
    }, { rootMargin: '-50% 0px -49% 0px' });
    // до какого блока долистали: виден хотя бы на треть
    var seen = new IntersectionObserver(function (list) {
      list.forEach(function (en) { if (en.isIntersecting) { reached[nameOf(en.target)] = 1; seen.unobserve(en.target); } });
    }, { threshold: 0.33 });
    blocks.forEach(function (b) { mid.observe(b); seen.observe(b); });
  }

  // Во время скролла только запоминаем, докуда долистали: число из scrollY ничего не пересчитывает.
  // Высоту страницы меряем редко — когда отправляем данные, а не на каждом движении
  var maxY = 0;
  window.addEventListener('scroll', function () { if (window.pageYOffset > maxY) maxY = window.pageYOffset; }, { passive: true });
  function measure() {
    var h = document.documentElement.scrollHeight;
    var d = h ? Math.min(100, Math.round((maxY + window.innerHeight) / h * 100)) : 0;
    if (d > depth) depth = d;
  }

  function update(end) {
    if (!id || ended) return;
    tick();
    measure();
    var s = {};
    Object.keys(spent).forEach(function (k) { if (spent[k] >= 500) s[k] = Math.round(spent[k]); });
    post('/s/u', { id: id, k: key, d: Math.round(active), dp: depth, s: s, r: Object.keys(reached), e: !!end }, end);
    if (end) ended = true;
  }

  // Что за кнопка: связь (WhatsApp, звонок, соцсети), фото тематики или просто ссылка с текстом
  function what(el) {
    var href = el.getAttribute('href') || '';
    if (/wa\.me|whatsapp/i.test(href)) return ['whatsapp', 'WhatsApp'];
    if (/^tel:/i.test(href)) return ['phone', 'Позвонить'];
    if (/instagram\.com/i.test(href)) return ['instagram', 'Instagram'];
    if (/(^|\/\/)t\.me|telegram/i.test(href)) return ['telegram', 'Telegram'];
    if (/vk\.(com|ru)/i.test(href)) return ['vk', 'ВКонтакте'];
    if (app) return null;
    var card = el.closest('article.tcard');
    if (card && el.hasAttribute('data-lb')) return ['design', nameOf(card).replace(/^Тематика /, '')];
    if (el.closest('.jumpbar')) return ['design', el.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)];
    if (el.closest('.lb, [data-carousel]')) return null;
    var text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').replace(/[→›‹←]/g, '').trim().slice(0, 40);
    return text ? [el.tagName === 'A' ? 'link' : 'button', text] : null;
  }

  document.addEventListener('click', function (e) {
    if (!id) return;
    var el = e.target.closest && e.target.closest('a, button');
    if (!el) return;
    var w = what(el);
    if (!w) return;
    post('/s/c', { id: id, k: key, kind: w[0], label: w[1], at: blockOf(el) }, true);
  }, true);

  document.addEventListener('visibilitychange', function () {
    tick();
    visible = !document.hidden;
    if (!visible) update(false);
  });
  window.addEventListener('pagehide', function () { update(true); });
  // заодно «я ещё здесь» — для счётчика онлайн
  setInterval(function () { if (visible) update(false); }, 15000);

  post('/s/v', { p: path, q: location.search, r: document.referrer, v: vid, w: window.innerWidth }).then(function (j) {
    if (!j || !j.id) return;
    id = j.id;
    key = j.k;
    measure();
    // метку ссылки из поста убираем из адреса, чтобы её не пересылали дальше
    if (/[?&]s=/.test(location.search) && history.replaceState) {
      var q = location.search.replace(/([?&])s=[^&]*&?/, '$1').replace(/[?&]$/, '');
      try { history.replaceState(history.state, '', path + q + location.hash); } catch (e) {}
    }
  });
})();
