(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var raf = window.requestAnimationFrame ? function (f) { return window.requestAnimationFrame(f); } : function (f) { return setTimeout(f, 16); };
  var now = window.performance && performance.now ? function () { return performance.now(); } : function () { return Date.now(); };

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if ((el.matches || el.msMatchesSelector || el.webkitMatchesSelector).call(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }
  function supports(p, v) { return !!(window.CSS && CSS.supports && CSS.supports(p, v)); }
  function watch(els, cb, opts) {
    if (!els.length) return null;
    if (!hasIO) { els.forEach(function (el) { cb(el, true); }); return null; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { cb(en.target, en.isIntersecting, io, en); });
    }, opts);
    els.forEach(function (el) { io.observe(el); });
    return io;
  }
  // Появление: срабатывает, когда блок показался или уже остался выше экрана
  function reveal(els, opts, onIn) {
    watch(els, function (el, vis, io, en) {
      var above = en && !vis && en.boundingClientRect.bottom < 0;
      if (!vis && !above) return;
      if (io) io.unobserve(el);
      el.classList.add('in');
      if (onIn) onIn(el, above);
    }, opts);
  }

  // ---------- Сколько движения тянет устройство ----------
  // fx — полный набор эффектов; lite — облегчённый для старых телефонов.
  // Проверяем память (Chrome её сообщает) и короткий замер скорости процессора
  function weakDevice() {
    var q = location.search || '';
    if (/[?&]lite=1/.test(q)) return true;
    if (/[?&]fx=1/.test(q)) return false;
    try {
      var n = navigator, c = n.connection, mem = n.deviceMemory;
      if (c && c.saveData) return true;
      if (mem && mem <= 2) return true;
      if (mem && mem >= 6) return false;
    } catch (e) {}
    var t = now(), x = 0;
    for (var i = 0; i < 60000; i++) x += Math.sqrt(i) * .5;
    window.__rigsB = x;
    return now() - t > 8;
  }
  var fx = !reduce && hasIO && !weakDevice();
  root.classList.add(fx ? 'fx' : 'lite');
  var sdaScroll = supports('animation-timeline', 'scroll()');

  // Набор эффектов выбираем один раз при загрузке и посреди страницы не меняем: раньше здесь был «сторож»,
  // который принимал очень медленную прокрутку пальцем за тормоза и переключал сайт на облегчённый набор —
  // блоки от этого перескакивали, а лазер на чеке пропадал

  // ---------- Прокрутка: один обработчик на кадр ----------
  var hd = $('.hd');
  var maxY = 1, needMeasure = true, ticking = false, lastY = -1, lastP = -1, scrolled = null;
  var perFrame = [];
  function measure() { maxY = Math.max(1, root.scrollHeight - window.innerHeight); needMeasure = false; }
  function frame() {
    ticking = false;
    if (needMeasure) measure();
    var y = window.pageYOffset;
    if (y === lastY) return;
    lastY = y;
    var s = y > 8;
    if (s !== scrolled) { scrolled = s; hd.classList.toggle('is-scrolled', s); }
    if (!sdaScroll) {
      var p = Math.min(1, y / maxY);
      if (Math.abs(p - lastP) > .002) { lastP = p; hd.style.setProperty('--p', p.toFixed(3)); }
    }
    for (var i = 0; i < perFrame.length; i++) perFrame[i](y);
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(frame); } }, { passive: true });
  window.addEventListener('resize', function () { needMeasure = true; if (!ticking) { ticking = true; raf(frame); } });
  if ('ResizeObserver' in window) new ResizeObserver(function () { needMeasure = true; }).observe(body);
  frame();

  // ---------- Плавающая кнопка записи: после первого экрана и до финального блока ----------
  var dock = $('.dock');
  var heroEl = $('.hero, .ph');
  var endEl = $('#end');
  var heroOn = true, endOn = false;
  function updateDock() {
    if (dock) dock.classList.toggle('is-on', !heroOn && !endOn && !body.classList.contains('menu-open'));
  }
  if (dock && hasIO) {
    if (heroEl) new IntersectionObserver(function (en) { heroOn = en[0].isIntersecting; updateDock(); }, { rootMargin: '-25% 0px 0px 0px' }).observe(heroEl);
    if (endEl) new IntersectionObserver(function (en) { endOn = en[0].isIntersecting || en[0].boundingClientRect.top < 0; updateDock(); }, { rootMargin: '0px 0px -15% 0px' }).observe(endEl);
  }

  // ---------- Меню ----------
  var menuBtn = $('.hd__menu');
  var menu = $('#menu');
  function setMenu(open) {
    if (open) menu.style.paddingTop = (hd.getBoundingClientRect().bottom + 20) + 'px';
    body.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    var lbl = $('span', menuBtn);
    if (lbl) lbl.textContent = open ? 'Закрыть' : 'Меню';
    root.style.overflow = open ? 'hidden' : '';
    updateDock();
  }
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', function () { setMenu(!body.classList.contains('menu-open')); });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }

  // ---------- Колода обложек на главной ----------
  var deck = $('.deck');
  if (deck) {
    var cards = $$('.deck__card', deck);
    var label = $('.deck__name');
    var POS = [
      { x: 0, y: 0, r: -3, s: 1 },
      { x: 34, y: -4, r: 5, s: .97 },
      { x: -38, y: 6, r: -10, s: .94 },
      { x: 60, y: 14, r: 11, s: .91 },
      { x: -58, y: 20, r: -15, s: .88 },
      { x: 0, y: 26, r: 2, s: .84, o: 0 }
    ];
    var order = cards.map(function (c, i) { return i; });
    var k = 1, busy = false, queued = false;
    var place = function (card, p, z) {
      var st = card.style;
      st.setProperty('--x', p.x * k + 'px');
      st.setProperty('--y', p.y * k + 'px');
      st.setProperty('--r', p.r + 'deg');
      st.setProperty('--s', p.s);
      st.opacity = p.o === 0 ? '0' : '1';
      st.zIndex = z;
    };
    var layout = function () {
      k = cards[0].offsetWidth > 280 ? 1.45 : 1;
      order.forEach(function (ci, pos) { place(cards[ci], POS[Math.min(pos, POS.length - 1)], cards.length - pos); });
    };
    var setLabel = function () {
      var c = cards[order[0]];
      label.classList.add('is-swap');
      setTimeout(function () {
        label.textContent = c.getAttribute('data-name');
        label.className = 'deck__name is-swap f-' + c.getAttribute('data-f');
        setTimeout(function () { label.classList.remove('is-swap'); }, 30);
      }, 220);
    };
    // Нажатие во время перелёта карточки не теряется, а срабатывает сразу после него
    var next = function (dir) {
      if (busy) { queued = true; return; }
      busy = true;
      var side = dir > 0 ? 1 : -1;
      var first = cards[order.shift()];
      order.push(cards.indexOf(first));
      order.forEach(function (ci, pos) { if (cards[ci] !== first) place(cards[ci], POS[Math.min(pos, POS.length - 1)], cards.length - pos); });
      first.classList.add('is-flying');
      place(first, { x: 300 * side, y: -30, r: 24 * side, s: 1 }, cards.length + 1);
      setLabel();
      setTimeout(function () {
        first.classList.remove('is-flying');
        place(first, POS[POS.length - 1], 0);
        busy = false;
        if (queued) { queued = false; next(-1); }
      }, 420);
    };
    cards.forEach(function (c) { place(c, { x: 0, y: 40, r: 0, s: .96, o: 0 }, 1); });
    setTimeout(function () {
      layout();
      cards.forEach(function (c, i) {
        c.style.transitionDelay = (0.25 + i * 0.07) + 's';
        setTimeout(function () { c.style.transitionDelay = ''; }, 1400);
      });
    }, 60);
    window.addEventListener('resize', function () { if (!busy) layout(); });

    var timer = null, deckVisible = true;
    var auto = function () {
      clearInterval(timer);
      if (reduce) return;
      timer = setInterval(function () { if (deckVisible && !document.hidden) next(); }, 2000);
    };
    var swiped = 0;
    deck.addEventListener('click', function () {
      // Клик сразу после свайпа уже учтён
      if (Date.now() - swiped < 500) return;
      next(); auto();
    });
    deck.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); auto(); }
    });
    // Верхнюю карточку можно тянуть пальцем или мышкой: дальше порога улетает, иначе возвращается
    var drag = null;
    var dragStart = function (x, y) { if (!busy) drag = { x: x, y: y, dx: 0, on: false }; };
    var dragMove = function (x, y, e) {
      if (!drag) return;
      var dx = x - drag.x, dy = y - drag.y;
      if (!drag.on) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // Вертикальный жест — это прокрутка страницы, не мешаем
        if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
        drag.on = true;
        clearInterval(timer);
        cards[order[0]].classList.add('is-drag');
      }
      drag.dx = dx;
      var st = cards[order[0]].style;
      st.setProperty('--x', dx + 'px');
      st.setProperty('--y', Math.abs(dx) * -0.05 + 'px');
      st.setProperty('--r', (-3 + dx / 16) + 'deg');
      if (e && e.cancelable) e.preventDefault();
    };
    var dragEnd = function () {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (!d.on) return;
      swiped = Date.now();
      var top = cards[order[0]];
      top.classList.remove('is-drag');
      if (Math.abs(d.dx) > 64) next(d.dx);
      else place(top, POS[0], cards.length);
      auto();
    };
    deck.addEventListener('touchstart', function (e) { dragStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    // Слушаем пассивно: иначе браузер перед каждой прокруткой, начатой на колоде (а она занимает почти весь
    // первый экран), ждёт ответа скрипта, и прокрутка «залипает», пока скрипт занят. Вбок страницу и так
    // никто не двигает — у колоды touch-action: pan-y, браузер сам берёт на себя только вертикаль
    deck.addEventListener('touchmove', function (e) { dragMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    deck.addEventListener('touchend', dragEnd);
    deck.addEventListener('touchcancel', dragEnd);
    deck.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      dragStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', function (e) { if (drag) dragMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', dragEnd);
    watch([deck], function (el, vis) { deckVisible = vis; });
    // Первая смена почти сразу, чтобы было видно, что обложки листаются
    setTimeout(function () { if (!reduce) next(); auto(); }, 1300);
  }

  // ---------- Счётчики ----------
  var group = function (n, sep) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep); };
  // Число «набегает» от нуля. Шаги по таймеру, а не каждый кадр: старым телефонам так легче
  function countUp(el, to, fmt, dur, delay) {
    var t0 = Date.now() + (delay || 0);
    el.textContent = fmt(0);
    setTimeout(function tick() {
      var p = Math.min(1, Math.max(0, (Date.now() - t0) / dur));
      el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) setTimeout(tick, 40);
    }, 40);
  }
  // ---------- «Обо мне»: цифры прокручиваются барабанами, как счётчик кадров на плёнке ----------
  // Каждая цифра — барабан 0–9, который делает полный оборот и встаёт на своё число;
  // «+» и слово «своя» выезжают снизу по буквам. Читалкам экрана — обычный текст
  var odo = fx ? $$('.facts b') : [];
  odo.forEach(function (b) {
    var txt = b.textContent;
    b.removeAttribute('data-count');
    b.classList.add('odo');
    b.textContent = '';
    var sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = txt;
    b.appendChild(sr);
    txt.split('').forEach(function (ch, n) {
      var s = document.createElement('span');
      s.setAttribute('aria-hidden', 'true');
      s.style.setProperty('--n', n);
      if (/\d/.test(ch)) {
        s.className = 'odo__reel';
        var col = document.createElement('span');
        col.className = 'odo__col';
        for (var i = 0; i <= 10 + +ch; i++) {
          var d = document.createElement('span');
          d.textContent = i % 10;
          col.appendChild(d);
        }
        col.style.setProperty('--to', 10 + +ch);
        s.appendChild(col);
      } else if (/\s/.test(ch)) {
        s.className = 'odo__sp';
        s.textContent = ' ';
      } else {
        s.className = 'odo__ch';
        s.textContent = ch;
      }
      b.appendChild(s);
    });
  });
  if (odo.length) reveal(odo, { threshold: .6 });

  // ---------- Цены: цитата проступает чернилами по мере прокрутки ----------
  var inkQ = fx ? $('.why__quote') : null;
  if (inkQ) {
    var inks = [];
    Array.prototype.slice.call(inkQ.childNodes).forEach(function (c) {
      if (c.nodeType !== 3 || !c.nodeValue) return;
      var frag = document.createDocumentFragment();
      c.nodeValue.split(/([ \t\n\r]+)/).forEach(function (p) {
        if (!p) return;
        if (/^[ \t\n\r]+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
        var w = document.createElement('span');
        w.className = 'ink';
        w.textContent = p;
        frag.appendChild(w);
        inks.push(w);
      });
      inkQ.replaceChild(frag, c);
    });
    inkQ.classList.add('is-ink');
    var inkNear = false, inkLit = -1;
    var inkUp = function () {
      if (!inkNear) return;
      var V = window.innerHeight, r = inkQ.getBoundingClientRect();
      // Первое слово темнеет, когда цитата поднялась до 85% экрана, последнее — к 45%
      var p = Math.min(1, Math.max(0, (V * .85 - r.top) / (V * .4 + r.height * .5)));
      var lit = fx ? Math.round(p * inks.length) : inks.length;
      if (lit === inkLit) return;
      inkLit = lit;
      inks.forEach(function (w, i) { w.classList.toggle('on', i < lit); });
    };
    watch([inkQ], function (el, vis) { inkNear = vis; inkUp(); }, { rootMargin: '10% 0px' });
    perFrame.push(inkUp);
  }

  var counters = $$('[data-count]');
  if (counters.length && !reduce) {
    var plus = function (n) { return group(n, ' ') + '+'; };
    counters.forEach(function (el) { el.textContent = plus(0); });
    watch(counters, function (el, vis, io) {
      if (!vis) return;
      if (io) io.unobserve(el);
      countUp(el, +el.getAttribute('data-count'), plus, 1400, 400);
    }, { threshold: .6 });
  }

  // ---------- Картинки проявляются по мере загрузки ----------
  // Блик бежит только по плиткам, которые видно на экране, и только пока фото грузится
  var LD_BOX = /(^|\s)(pic|book__cover|deck__card|clip__frame)(\s|$)/;
  var ldBoxes = [], ldIO = null;
  var ldDone = function (img) {
    img.classList.remove('ld');
    var box = img.parentNode;
    if (box && box.classList) box.classList.remove('is-ld');
    if (ldIO && box) ldIO.unobserve(box);
  };
  // Один общий слушатель на всю страницу, а не на каждое фото: так проявляются и копии фото, которые скрипт
  // добавляет позже (лента-плёнка). Раньше копия наследовала невидимость, но не слушатель, и лента оставалась пустой.
  // Проявляем, когда фото уже раскодировано: иначе телефон раскодирует его в момент показа и прокрутка замирает
  document.addEventListener('load', function (e) {
    var img = e.target;
    if (img.tagName !== 'IMG' || !img.classList.contains('ld')) return;
    if (img.decode) img.decode().then(function () { ldDone(img); }, function () { ldDone(img); }); else ldDone(img);
  }, true);
  document.addEventListener('error', function (e) { if (e.target.tagName === 'IMG') ldDone(e.target); }, true);
  $$('img').forEach(function (img) {
    if (img.complete && img.naturalWidth) return;
    img.classList.add('ld');
    var box = img.parentNode;
    if (box && LD_BOX.test(box.className)) ldBoxes.push(box);
  });
  // Страховка: фото, которое уже загрузилось, не должно остаться невидимым ни при каком раскладе
  window.addEventListener('load', function () {
    setTimeout(function () { $$('img.ld').forEach(function (img) { if (img.complete && img.naturalWidth) ldDone(img); }); }, 600);
  });
  ldIO = !reduce && ldBoxes.length ? watch(ldBoxes, function (box, vis) {
    var img = $('img', box);
    box.classList.toggle('is-ld', vis && !!img && img.classList.contains('ld'));
  }, { rootMargin: '60px 0px' }) : null;

  // ---------- Фото готовятся заранее ----------
  // За два экрана до появления фото загружается и раскодируется в фоне (img.decode). Раньше фото галереи
  // грузились и раскодировались в тот момент, когда до них долистывали, и прокрутка на мгновение замирала
  var warmIO = hasIO ? new IntersectionObserver(function (ens) {
    ens.forEach(function (en) {
      if (!en.isIntersecting) return;
      var im = en.target;
      if (!im.getAttribute('src')) return;
      warmIO.unobserve(im);
      if (im.loading === 'lazy') im.loading = 'eager';
      if (im.decode) im.decode().catch(function () {});
    });
  }, { rootMargin: '200% 0px' }) : null;
  function warm(imgs) { if (warmIO) imgs.forEach(function (im) { warmIO.unobserve(im); warmIO.observe(im); }); }
  warm($$('img'));

  // ---------- Липкая строка тематик подсвечивает ту, что сейчас на экране ----------
  var jb = $('.jumpbar__in');
  if (jb) {
    var chips = {};
    $$('a', jb).forEach(function (a) { chips[a.getAttribute('href').slice(1)] = a; });
    // На странице работ у каждого раздела кружок с первым фото и число снимков,
    // а под выбранным разделом едет бордовая плашка
    var pill = null;
    var sections = Object.keys(chips).map(function (id) { return document.getElementById(id); });
    if (sections.every(function (s) { return s && $('.pics', s); })) {
      Object.keys(chips).forEach(function (id) {
        var a = chips[id], sec = document.getElementById(id), im = $('.pics img', sec), cnt = $('.works-meta span', sec);
        var n = cnt ? parseInt(cnt.textContent, 10) : 0;
        if (im) {
          var th = document.createElement('span');
          th.className = 'jb__th';
          var ti = document.createElement('img');
          ti.src = im.getAttribute('src');
          ti.alt = '';
          ti.decoding = 'async';
          th.appendChild(ti);
          a.insertBefore(th, a.firstChild);
        }
        if (n > 0) {
          var c = document.createElement('small');
          c.className = 'jb__n';
          c.textContent = n;
          a.appendChild(c);
        }
      });
      jb.parentNode.classList.add('jumpbar--thumbs');
      pill = document.createElement('i');
      pill.className = 'jb__pill';
      pill.setAttribute('aria-hidden', 'true');
      jb.insertBefore(pill, jb.firstChild);
    }
    var movePill = function (a) {
      if (!pill || !a) return;
      pill.style.width = a.offsetWidth + 'px';
      pill.style.transform = 'translate3d(' + a.offsetLeft + 'px,0,0)';
      pill.classList.add('is-on');
    };
    window.addEventListener('resize', function () { movePill($('a.is-on', jb)); });
    watch($$('.tcard, .wsec'), function (el, vis) {
      if (!vis) return;
      var a = chips[el.id];
      if (!a || a.classList.contains('is-on')) return;
      $$('a', jb).forEach(function (x) { x.classList.toggle('is-on', x === a); });
      movePill(a);
      var left = a.offsetLeft - 18;
      if (jb.scrollTo) { try { jb.scrollTo({ left: left, behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { jb.scrollLeft = left; } }
      else jb.scrollLeft = left;
    }, { rootMargin: '-45% 0px -50% 0px' });
  }

  // ---------- Заголовки выезжают по словам ----------
  // Режем только обычные пробелы: неразрывные остаются внутри слова
  function splitWords(el) {
    var n = 0;
    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var parts = c.nodeValue.split(/([ \t\n\r]+)/);
          if (parts.length === 1 && !parts[0]) return;
          var frag = document.createDocumentFragment();
          parts.forEach(function (p) {
            if (!p) return;
            if (/^[ \t\n\r]+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span');
            w.className = 'w';
            var i = document.createElement('span');
            i.textContent = p;
            i.style.setProperty('--wi', n++);
            w.appendChild(i);
            frag.appendChild(w);
          });
          c.parentNode.replaceChild(frag, c);
        } else if (c.nodeType === 1 && !/^(BR|SMALL|SVG)$/i.test(c.tagName) && !c.classList.contains('fig')) walk(c);
      });
    };
    walk(el);
    el.classList.add('split');
  }
  if (fx) {
    var heads = $$('.h2, .end h2, .ph h1, .next b, .why__quote');
    heads.forEach(splitWords);
    reveal(heads, { threshold: .25, rootMargin: '0px 0px -6% 0px' });
  }

  // ---------- Рисованные человечки на заголовках ----------
  // Ставим человечка на последнее слово первой строки: над ним пусто, и он не задевает подпись раздела.
  // Переносы строк зависят от ширины экрана, поэтому место считаем по факту и пересчитываем при повороте
  (function () {
    var hs = $$('.has-fig');
    if (!hs.length || !document.createRange) return;
    // Слова заголовка с их местом на экране. После разбивки на слова берём обёртки .w: их не сдвигает
    // анимация появления. Без разбивки (лёгкий режим) меряем каждое слово через Range
    var words = function (h) {
      var ws = h.querySelectorAll('.w');
      if (ws.length) return Array.prototype.map.call(ws, function (w) { return w.getBoundingClientRect(); });
      var out = [], tw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT, null, false), n, m, re = /\S+/g;
      while ((n = tw.nextNode())) {
        if (n.parentNode.closest && n.parentNode.closest('.fig')) continue;
        re.lastIndex = 0;
        while ((m = re.exec(n.nodeValue))) {
          var r = document.createRange();
          r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          var b = r.getBoundingClientRect();
          if (b.width) out.push(b);
        }
      }
      return out;
    };
    // Человечку нужно свободное место над словом. Берём строку, у которой правый край торчит дальше
    // строк над ней (у первой строки мешает только подпись раздела), и ставим его на её последнее слово,
    // ближе к правому краю. Первая строка подходит, если места с запасом; иначе берём строку, где места больше всего
    var place = function () {
      hs.forEach(function (h) {
        var f = h.querySelector('.fig'), ws = words(h);
        if (!f || !ws.length) return;
        var hb = h.getBoundingClientRect(), fw = f.offsetWidth, lines = [];
        ws.forEach(function (b) {
          var l = lines[lines.length - 1];
          if (!l || Math.abs(b.top - l.top) > 4) lines.push(l = { top: b.top, right: 0, last: b });
          if (b.right >= l.right) { l.right = b.right; l.last = b; }
        });
        var eb = h.previousElementSibling, floor = 0;
        if (eb && eb.classList.contains('eyebrow')) floor = eb.getBoundingClientRect().right + 8;
        var best = null;
        lines.forEach(function (l, i) {
          // Над строкой: правые края двух строк выше (рисунок выше одной строки)
          var above = i ? Math.max(lines[i - 1].right, i > 1 ? lines[i - 2].right : 0) + 6 : floor;
          var room = l.right - above;
          if (!best || (best.room < fw * 2 && room > best.room)) best = { l: l, room: room, above: above };
        });
        var l = best.l, x = Math.min(l.last.left + l.last.width * .62 - fw / 2, l.right - fw * .8);
        x = Math.max(x, best.above, l.last.left);
        f.style.left = (x - hb.left) + 'px';
        f.style.setProperty('--line', (l.top - lines[0].top) + 'px');
      });
    };
    place();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    var rq = 0;
    window.addEventListener('resize', function () {
      if (rq) return;
      rq = requestAnimationFrame(function () { rq = 0; place(); });
    });
  })();

  // ---------- Человечки откликаются на касание: подпрыгивают ----------
  document.addEventListener('click', function (e) {
    var f = e.target.closest && e.target.closest('.fig, .gamer, .toss');
    if (!f) return;
    f.classList.remove('is-poke');
    void f.offsetWidth;
    f.classList.add('is-poke');
  });
  document.addEventListener('animationend', function (e) { if (e.animationName === 'poke') e.target.classList.remove('is-poke'); });

  // ---------- Самолётик: кривая полёта под ширину экрана ----------
  // Петля — фиксированного размера в пикселях по центру, подлёт и отлёт тянутся на всю ширину
  (function () {
    var pl = $('.plane'), p = pl && $('.plane__p', pl);
    if (!p || !window.CSS || !CSS.supports || !CSS.supports('offset-rotate', 'auto')) return;
    var tr = $('.plane__trail', pl), dots = $('.plane__dots', pl), rev = $('.plane__rev', pl), w0 = 0;
    var build = function () {
      var W = pl.offsetWidth, H = pl.offsetHeight;
      if (!W || W === w0) return;
      w0 = W;
      var c = Math.round(W * .5), f = function (v) { return Math.round(v); };
      var d = 'M -60 72 C ' + f(c * .3) + ' 74, ' + f(c * .62) + ' 40, ' + (c - 40) + ' 50 ' +
        'C ' + (c - 10) + ' 56, ' + (c + 34) + ' 40, ' + (c + 24) + ' 16 ' +
        'C ' + (c + 16) + ' 0, ' + (c - 22) + ' 4, ' + (c - 18) + ' 26 ' +
        'C ' + (c - 14) + ' 46, ' + (c + 10) + ' 58, ' + (c + 40) + ' 52 ' +
        'C ' + (c + 120) + ' 44, ' + f(W * .86) + ' 22, ' + (W + 60) + ' 34';
      tr.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      dots.setAttribute('d', d);
      rev.setAttribute('d', d);
      p.style.offsetPath = "path('" + d + "')";
    };
    build();
    window.addEventListener('resize', function () { raf(build); });
  })();

  // ---------- Появление блоков ----------
  // Внутри [data-stagger] элементы выезжают по очереди
  $$('.receipt li').forEach(function (li, i) { li.style.setProperty('--ri', i); });

  $$('[data-stagger]').forEach(function (box) {
    for (var i = 0; i < box.children.length; i++) box.children[i].style.setProperty('--i', Math.min(i, 9));
  });
  reveal($$('.rv'), { threshold: .12, rootMargin: '0px 0px -6% 0px' });
  // Галереи бывают выше экрана: для них хватает, чтобы показался край
  reveal($$('[data-stagger]'), { threshold: 0, rootMargin: '0px 0px -8% 0px' });

  // Карточки «Альбом собирают сами ребята»
  reveal($$('.perk'), { threshold: .3 });

  // ---------- Бесконечные анимации идут, только пока их видно ----------
  var LIVE = '.ticker, .me, .offer__card, .phone, .next, .has-fig, .has-gamer, .has-plane, .ft';
  var lives = $$(LIVE);
  if (!hasIO) lives.forEach(function (el) { el.classList.add('is-live'); });
  else watch(lives, function (el, vis) { el.classList.toggle('is-live', vis); });

  // ---------- Карточки-слои: нижняя уходит вглубь, когда на неё наезжает следующая ----------
  var perks = $$('.perk');
  if (perks.length > 1 && !reduce && supports('--k', '0')) {
    var stackOn = false;
    var depth = function () {
      if (!stackOn || !fx) return;
      // Сначала все замеры, потом все записи: так браузер не пересчитывает раскладку по кругу
      var r = perks.map(function (p) { return p.getBoundingClientRect(); });
      for (var i = 0; i < perks.length - 1; i++) {
        var cover = Math.min(1, Math.max(0, (r[i].bottom - r[i + 1].top) / r[i].height));
        var v = cover.toFixed(3);
        if (perks[i].__k !== v) { perks[i].__k = v; perks[i].style.setProperty('--k', v); }
      }
    };
    watch([$('.stack') || perks[0].parentNode], function (el, vis) { stackOn = vis; if (vis) depth(); });
    perFrame.push(depth);
  }

  // ---------- «Как всё проходит»: номер шага загорается, когда до него дошла линия ----------
  // Линию на телефоне рисует сама прокрутка (CSS, диапазон cover 12%–62%). Здесь той же формулой
  // считаем, где сейчас её кончик, и зажигаем номера, до которых она дотянулась
  var flow = $('.flow');
  if (flow && fx && supports('animation-timeline', 'view()') && window.matchMedia) {
    var flowMq = window.matchMedia('(max-width: 959px)');
    var steps = $$('li', flow), flowNear = false, flowSync = false;
    var lightSteps = function () {
      var on = flowNear && fx && flowMq.matches;
      if (on !== flowSync) { flowSync = on; flow.classList.toggle('is-sync', on); }
      if (!on) return;
      // Сначала все замеры, потом записи
      var V = window.innerHeight, r = flow.getBoundingClientRect();
      var f = Math.min(1, Math.max(0, ((V - r.top) / (V + r.height) - .12) / .5));
      var tip = r.top + 10 + f * (r.height - 40);
      var ys = steps.map(function (li) { return li.getBoundingClientRect().top + 22; });
      steps.forEach(function (li, i) {
        var v = ys[i] <= tip + 2;
        if (li.__lit !== v) { li.__lit = v; li.classList.toggle('is-lit', v); }
      });
    };
    watch([flow], function (el, vis) { flowNear = vis; lightSteps(); }, { rootMargin: '20% 0px' });
    perFrame.push(lightSteps);
  }

  // ---------- Экран голосования в телефоне: таймер идёт по-настоящему ----------
  var clock = $('.phone__bar span');
  if (fx && clock) {
    var m = /(\d+):(\d\d)/.exec(clock.textContent);
    var left = m ? +m[1] * 60 + +m[2] : 0, tickT = null;
    var draw = function () { clock.textContent = 'до конца ' + Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2); };
    watch([closest(clock, '.phone') || clock], function (el, vis) {
      clearInterval(tickT);
      if (vis && left) tickT = setInterval(function () { left = left > 1 ? left - 1 : 12 * 60 + 40; draw(); }, 1000);
    });
  }

  // ---------- Финал страницы: искры у кнопки записи ----------
  var endCta = $('.end__cta');
  if (fx && endCta) {
    watch([endCta], function (el, vis, io) {
      if (!vis || !fx) return;
      if (io) io.unobserve(el);
      var btn = $('.btn', el);
      if (!btn) return;
      var box = document.createElement('span');
      box.className = 'sparks';
      box.setAttribute('aria-hidden', 'true');
      box.style.left = (btn.offsetLeft + btn.offsetWidth / 2) + 'px';
      box.style.top = (btn.offsetTop + btn.offsetHeight / 2) + 'px';
      for (var i = 0; i < 14; i++) {
        var s = document.createElement('i');
        var a = (i / 14) * Math.PI * 2 + Math.random() * .4;
        var d = 60 + Math.random() * 40;
        s.style.setProperty('--tx', Math.round(Math.cos(a) * d * 1.2) + 'px');
        s.style.setProperty('--ty', Math.round(Math.sin(a) * d * .75) + 'px');
        s.style.setProperty('--sd', Math.round(Math.random() * 160) + 'ms');
        s.textContent = i % 3 ? '✦' : '•';
        box.appendChild(s);
      }
      el.appendChild(box);
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 2200);
    }, { threshold: .6 });
  }

  // ---------- Лента «Зоны студии»: едет сама, при наведении или касании плавно встаёт ----------
  // Позицию считает сам скрипт и каждый кадр ставит один сдвиг (transform): страница при этом
  // не перерисовывается, а лента не может «прыгнуть» — других часов, кроме этих, у неё нет.
  // Копии фото замыкают ленту в кольцо. Их не видят программы чтения с экрана,
  // а нажатие по копии открывает оригинал, поэтому в просмотре по-прежнему «1 / 8»
  $$('[data-marquee]').forEach(function (box) {
    var track = $('.pics', box);
    var originals = track ? $$('.pic', track) : [];
    if (!originals.length || reduce) return;
    // Скорость от размера фото: каждое проезжает примерно за 4,5 секунды на любом экране
    var speed = 60;
    var hasPointer = 'PointerEvent' in window;
    var pos = 0, dist = 0, rate = 1, target = 1, last = 0, looping = false, visible = !hasIO;
    var holdT = null, lastW = 0, lastTouch = 0, lastPress = 0;

    var copyOf = function (o, i) {
      var c = o.cloneNode(true);
      c.classList.add('is-copy');
      c.classList.remove('is-ld');
      c.removeAttribute('data-lb');
      c.setAttribute('aria-hidden', 'true');
      c.setAttribute('tabindex', '-1');
      c.setAttribute('data-copy', i);
      var im = $('img', c);
      if (im) {
        im.alt = '';
        if (im.classList.contains('ld')) {
          var done = function () { im.classList.remove('ld'); };
          if (im.complete && im.naturalWidth) done();
          else { im.addEventListener('load', done); im.addEventListener('error', done); }
        }
      }
      return c;
    };

    var paint = function () { track.style.transform = 'translate3d(' + (-pos).toFixed(2) + 'px,0,0)'; };
    var frame = function (t) {
      looping = false;
      if (!visible || !dist) { last = 0; return; }
      var dt = last ? Math.min(50, t - last) : 0; // после паузы вкладки не догоняем рывком
      last = t;
      // плавный разгон и торможение примерно за полсекунды
      rate += (target - rate) * Math.min(1, dt / 160);
      if (Math.abs(target - rate) < .01) rate = target;
      pos = (pos + speed * rate * dt / 1000) % dist;
      paint();
      if (rate === 0 && target === 0) { last = 0; return; } // стоим — кадры не тратим
      loop();
    };
    var loop = function () { if (!looping) { looping = true; raf(frame); } };
    var setRate = function (to) { target = to; loop(); };

    var build = function () {
      var w = box.clientWidth;
      if (!w || w === lastW) return;
      lastW = w;
      $$('.is-copy', track).forEach(function (c) { track.removeChild(c); });
      box.classList.add('is-run');
      // Один круг — все фото подряд. Если круг уже экрана, повторяем его, чтобы не было дыры
      var one = track.offsetWidth;
      if (!one) return;
      var first = originals[0].offsetWidth + 12;
      speed = Math.max(50, first / 3);
      var reps = Math.max(1, Math.ceil(w / one));
      for (var r = 0; r < reps * 2 - 1; r++) originals.forEach(function (o, i) { track.appendChild(copyOf(o, i)); });
      var prev = dist;
      dist = one * reps;
      // ширина поменялась — продолжаем с того же места круга, а не с начала
      pos = prev ? (pos / prev * dist) % dist : 0;
      paint();
      loop();
    };

    // После касания ждём пару секунд. Пока открыт просмотр фото или фокус с клавиатуры внутри, лента стоит
    var keyFocus = function () {
      var a = document.activeElement;
      if (!a || !box.contains(a) || Date.now() - lastPress < 800) return false;
      try { return a.matches(':focus-visible'); } catch (e) { return true; }
    };
    var resume = function () {
      clearTimeout(holdT);
      holdT = setTimeout(function () {
        if ($('.lb.is-open') || keyFocus()) return resume();
        setRate(1);
      }, 1800);
    };
    var stop = function () { clearTimeout(holdT); setRate(0); };
    var isMouse = function (e) { return (!e.pointerType || e.pointerType === 'mouse') && Date.now() - lastTouch > 800; };

    box.addEventListener(hasPointer ? 'pointerdown' : 'mousedown', function () { lastPress = Date.now(); });
    box.addEventListener(hasPointer ? 'pointerenter' : 'mouseenter', function (e) { if (isMouse(e)) stop(); });
    // Мышь ушла — сразу плавно трогаемся (если не открыт просмотр фото)
    box.addEventListener(hasPointer ? 'pointerleave' : 'mouseleave', function (e) {
      if (!isMouse(e)) return;
      clearTimeout(holdT);
      if ($('.lb.is-open') || keyFocus()) resume(); else setRate(1);
    });
    box.addEventListener('touchstart', function () { lastTouch = lastPress = Date.now(); stop(); }, { passive: true });
    box.addEventListener('touchend', function () { lastTouch = Date.now(); resume(); });
    box.addEventListener('touchcancel', function () { lastTouch = Date.now(); resume(); });
    box.addEventListener('focusin', function () { if (keyFocus()) stop(); });
    box.addEventListener('focusout', resume);
    // Нажатие по копии открывает то же фото из оригинального ряда
    box.addEventListener('click', function (e) {
      var c = closest(e.target, '.is-copy');
      if (!c) return;
      e.preventDefault();
      stop();
      originals[+c.getAttribute('data-copy')].click();
      resume();
    });

    // Лента едет, только пока её видно
    watch([box], function (el, vis) { visible = vis; if (vis) loop(); }, { rootMargin: '100px 0px' });
    build();
    window.addEventListener('resize', build);
  });

  // ---------- Видео: подгружаются рядом с экраном и играют без звука, пока видны ----------
  var vids = $$('.clip video').filter(function (v) { return v.getAttribute('data-src'); });
  vids.forEach(function (v) {
    var frame = v.parentNode;
    frame.classList.add('has-video');
    // Если телефон не смог открыть видео, возвращаем заставку вместо чёрного экрана
    v.addEventListener('error', function () { frame.classList.remove('has-video'); });
  });
  var vidLoad = function (v) {
    if (v.src) return;
    v.preload = 'auto';
    v.src = v.getAttribute('data-src');
  };
  // Видео стоит сразу после первого экрана: начинаем качать, как только загрузилась страница,
  // чтобы к моменту прокрутки оно уже успело подгрузиться
  var vidEarly = function () { vids.forEach(vidLoad); };
  if (document.readyState === 'complete') setTimeout(vidEarly, 300);
  else window.addEventListener('load', function () { setTimeout(vidEarly, 300); });
  // Видео без звука должно играть всегда, когда оно на экране. Браузер иногда отказывает в первом play():
  // видео ещё не успело загрузиться, вкладка была в фоне, на iPhone включён режим энергосбережения.
  // Поэтому пробуем снова, когда видео подгрузилось, когда вкладка вернулась и при первом касании экрана
  var tryPlay = function (v) {
    if (!v.__want || !v.src || !v.paused) return;
    v.muted = true;
    var p = v.play(); if (p && p.catch) p.catch(function () {});
  };
  vids.forEach(function (v) {
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    ['loadeddata', 'canplay', 'canplaythrough'].forEach(function (ev) { v.addEventListener(ev, function () { tryPlay(v); }); });
    // Если браузер сам поставил видео на паузу, пока его видно, запускаем снова
    v.addEventListener('pause', function () { if (v.__want && !document.hidden) setTimeout(function () { tryPlay(v); }, 400); });
  });
  var kick = function () { vids.forEach(tryPlay); };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
  ['touchend', 'click', 'keydown'].forEach(function (ev) { document.addEventListener(ev, kick, { passive: true, capture: true }); });
  watch(vids, function (v, vis) {
    v.__want = vis;
    if (vis) { vidLoad(v); tryPlay(v); }
    else if (v.src && !v.paused) v.pause();
  }, { rootMargin: '0px' });

  // ---------- Заставка «затвор камеры» (класс intro ставит скрипт в <head> главной) ----------
  // Убираем, как только лепестки раскрылись; нажатие или клавиша — сразу. Запасной таймер — на случай,
  // если анимация не запустилась, чтобы заставка никогда не закрыла сайт
  (function () {
    var sh = $('.shutter');
    if (!sh) return;
    if (!root.classList.contains('intro')) { sh.parentNode.removeChild(sh); return; }
    var done = false;
    var end = function () {
      if (done) return;
      done = true;
      // Класс intro оставляем: от него зависят задержки заголовка, и снимать его посреди анимации нельзя
      if (sh.parentNode) sh.parentNode.removeChild(sh);
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { window.removeEventListener(ev, end, true); });
    };
    var iris = $('.shutter__iris', sh);
    if (iris) iris.addEventListener('animationend', function (e) { if (e.target === iris) end(); });
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, end, true); });
    setTimeout(end, 2800);
  })();

  // ---------- Просмотр фото на весь экран ----------
  // Плавно открывается, листается пальцем, закрывается жестом вниз и кнопкой «Назад» на телефоне
  var lb = $('.lb');
  if (lb) {
    var lbImg = $('img', lb), lbCap = $('figcaption', lb), lbFig = $('figure', lb), lbList = [], lbI = 0, pushed = false;
    var spin = document.createElement('span');
    spin.className = 'lb__spin';
    lb.appendChild(spin);
    var preload = function (i) {
      if (i < 0 || i >= lbList.length) return;
      var im = new Image();
      im.src = lbList[i].getAttribute('href');
    };
    // thumb — уже загруженная плитка: пока грузится большое фото, показываем её, растянутую до
    // размера большого (пропорции те же), и незаметно подменяем, когда большое загрузится
    var show = function (thumb) {
      var a = lbList[lbI];
      var href = a.getAttribute('href');
      lbImg.style.width = '';
      if (thumb) {
        var ar = thumb.naturalWidth / thumb.naturalHeight;
        var maxW = lb.clientWidth - 24, maxH = lb.clientHeight - 170;
        lbImg.style.width = Math.round(Math.min(maxW, maxH * ar)) + 'px';
        lbImg.onload = lbImg.onerror = null;
        lbImg.src = thumb.currentSrc || thumb.src;
        // Подмена — только когда крупное фото уже раскодировано и полёт закончился,
        // иначе декодирование большой картинки совпадает с анимацией и даёт заметный фриз
        var big = new Image();
        var swap = function () {
          if (lbList[lbI] !== a || lb.hidden || !lb.classList.contains('is-open')) return;
          if (flying) { swapLater = swap; return; }
          lbImg.src = href;
        };
        big.onload = function () {
          if (big.decode) big.decode().then(swap, swap); else swap();
        };
        big.src = href;
      } else {
        lb.classList.add('is-loading');
        lbImg.onload = lbImg.onerror = function () { lb.classList.remove('is-loading'); };
        lbImg.src = href;
        if (lbImg.complete && lbImg.naturalWidth) lb.classList.remove('is-loading');
      }
      lbCap.textContent = a.getAttribute('data-cap') || '';
      $('.lb__count', lb).textContent = (lbI + 1) + ' / ' + lbList.length;
      $('.lb__prev', lb).style.visibility = lbI > 0 ? '' : 'hidden';
      $('.lb__next', lb).style.visibility = lbI < lbList.length - 1 ? '' : 'hidden';
      preload(lbI + 1);
      preload(lbI - 1);
    };
    var go = function (d) {
      var n = lbI + d;
      if (n < 0 || n >= lbList.length) return;
      lbI = n;
      lbFig.classList.remove('is-next', 'is-prev');
      void lbFig.offsetWidth;
      lbFig.classList.add(d > 0 ? 'is-next' : 'is-prev');
      show();
    };
    // Фото вырастает из своей плитки и при закрытии возвращается в неё (только полный набор эффектов).
    // Плитка обрезана (object-fit: cover), поэтому фото масштабируется целиком, а лишнее по краям
    // срезается рамкой clip-path, которая раскрывается вместе с полётом
    var ZOOM_MS = 480, zoomT = 0, flying = false, swapLater = null;
    // r — где лежит сама картинка плитки (с учётом её увеличения внутри рамки),
    // f — видимая часть: рамка ссылки, если она обрезает картинку (.pic), иначе сама картинка
    var tile = function (a) {
      var t = a && $('img', a);
      if (!t || !t.complete || !t.naturalWidth) return null;
      var r = t.getBoundingClientRect();
      var clips = getComputedStyle(a).overflow !== 'visible';
      var fr = clips ? a.getBoundingClientRect() : r;
      var f = { left: Math.max(fr.left, r.left), top: Math.max(fr.top, r.top), right: Math.min(fr.right, r.right), bottom: Math.min(fr.bottom, r.bottom) };
      if (f.right - f.left < 20 || f.bottom - f.top < 20 || f.bottom < 0 || f.top > window.innerHeight || f.right < 0 || f.left > window.innerWidth) return null;
      return { img: t, r: r, f: f, rad: parseFloat(getComputedStyle(clips ? a : t).borderTopLeftRadius) || 0 };
    };
    // Большое фото накрывает картинку плитки так же, как она заполняет свою рамку (object-fit: cover, по центру),
    // а лишнее срезается clip-path ровно по видимой рамке. В конце полёта картинка совпадает с плиткой пиксель в пиксель
    var flyStyle = function (t) {
      var R = lbImg.getBoundingClientRect();
      if (!R.width || !R.height) return null;
      var s = Math.max(t.r.width / R.width, t.r.height / R.height);
      var w = R.width * s, h = R.height * s;
      var x = t.r.left + t.r.width / 2 - w / 2, y = t.r.top + t.r.height / 2 - h / 2;
      var ins = [(t.f.top - y) / s, (x + w - t.f.right) / s, (y + h - t.f.bottom) / s, (t.f.left - x) / s].map(function (v) { return Math.max(0, v).toFixed(1) + 'px'; });
      return {
        transform: 'translate3d(' + (x - R.left).toFixed(1) + 'px,' + (y - R.top).toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')',
        clip: 'inset(' + ins.join(' ') + ' round ' + (t.rad / s).toFixed(1) + 'px)'
      };
    };
    var flyEase = 'cubic-bezier(.2, .8, .2, 1)';
    var setFly = function (tf, clip, anim) {
      var tr = anim ? 'transform ' + ZOOM_MS + 'ms ' + flyEase + ', clip-path ' + ZOOM_MS + 'ms ' + flyEase : 'none';
      lbImg.style.webkitTransition = tr.replace(/transform/, '-webkit-transform').replace('clip-path', '-webkit-clip-path');
      lbImg.style.transition = tr;
      lbImg.style.transformOrigin = '0 0';
      lbImg.style.transform = tf;
      lbImg.style.webkitClipPath = clip;
      lbImg.style.clipPath = clip;
    };
    var clearFly = function () {
      ['transition', 'webkitTransition', 'transform', 'transformOrigin', 'clipPath', 'webkitClipPath'].forEach(function (k) { lbImg.style[k] = ''; });
    };
    var canZoom = function () { return fx && !reduce && supports('clip-path', 'inset(1px round 1px)'); };
    var open = function (a) {
      lbList = $$('[data-lb="' + a.getAttribute('data-lb') + '"]');
      lbI = lbList.indexOf(a);
      clearTimeout(zoomT);
      clearFly();
      flying = false;
      swapLater = null;
      lbFig.classList.remove('is-next', 'is-prev');
      var t = canZoom() ? tile(a) : null;
      lb.classList.toggle('is-zoom', !!t);
      lb.hidden = false;
      show(t && t.img);
      root.style.overflow = 'hidden';
      void lb.offsetWidth;
      var f = t && flyStyle(t);
      if (f) {
        setFly(f.transform, f.clip, false);
        void lbImg.offsetWidth;
        setFly('', 'inset(0px 0px 0px 0px round 4px)', true);
        flying = true;
        zoomT = setTimeout(function () {
          clearFly();
          flying = false;
          var sw = swapLater;
          swapLater = null;
          if (sw) sw();
        }, ZOOM_MS + 40);
      }
      lb.classList.add('is-open');
      if (window.history && history.pushState) { history.pushState({ lb: 1 }, ''); pushed = true; }
    };
    var close = function (fromHistory) {
      // Уже закрывается: кнопка «Закрыть» сама делает history.back(), и popstate зовёт close ещё раз
      if (lb.hidden || !lb.classList.contains('is-open')) return;
      clearTimeout(zoomT);
      flying = false;
      swapLater = null;
      var t = lb.classList.contains('is-zoom') && canZoom() ? tile(lbList[lbI]) : null;
      var f = null;
      if (t) {
        lbFig.classList.remove('is-next', 'is-prev');
        clearFly();
        f = flyStyle(t);
      }
      if (f) setFly(f.transform, f.clip, true);
      else lb.classList.remove('is-zoom');
      lb.classList.remove('is-open');
      root.style.overflow = '';
      // Прячем слой только когда фото долетело до плитки (transitionend), с запасным таймером
      var hide = function () {
        clearTimeout(zoomT);
        lbImg.removeEventListener('transitionend', onEnd);
        if (lb.classList.contains('is-open')) return;
        lb.hidden = true;
        lb.classList.remove('is-zoom');
        lbImg.src = '';
        lbImg.style.width = '';
        clearFly();
      };
      var onEnd = function (e) { if (e.target === lbImg && /transform/.test(e.propertyName)) hide(); };
      if (f) lbImg.addEventListener('transitionend', onEnd);
      zoomT = setTimeout(hide, reduce ? 0 : f ? ZOOM_MS + 120 : 260);
      if (pushed && !fromHistory) { pushed = false; history.back(); }
      pushed = false;
    };
    window.addEventListener('popstate', function () { if (!lb.hidden) close(true); });
    document.addEventListener('click', function (e) {
      var a = closest(e.target, '[data-lb]');
      if (!a) return;
      e.preventDefault();
      open(a);
    });
    lb.addEventListener('click', function (e) {
      if (Date.now() - lbSwiped < 400) return;
      if (closest(e.target, '.lb__prev')) return go(-1);
      if (closest(e.target, '.lb__next')) return go(1);
      if (e.target !== lbImg) close();
    });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    });
    // Фото едет за пальцем: вбок — листаем, вниз — закрываем
    var t0 = null, lbSwiped = 0;
    lb.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) { t0 = null; return; }
      t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, dy: 0 };
      lbFig.classList.add('is-drag');
    }, { passive: true });
    lb.addEventListener('touchmove', function (e) {
      if (!t0 || e.touches.length > 1) return;
      t0.dx = e.touches[0].clientX - t0.x;
      t0.dy = e.touches[0].clientY - t0.y;
      var down = t0.dy > 0 && Math.abs(t0.dy) > Math.abs(t0.dx);
      lbFig.style.transform = down ? 'translateY(' + t0.dy + 'px) scale(' + Math.max(.85, 1 - t0.dy / 1200) + ')' : 'translateX(' + t0.dx + 'px)';
      if (down) lb.style.backgroundColor = 'rgba(40, 26, 24, ' + Math.max(.4, .97 - t0.dy / 500) + ')';
    }, { passive: true });
    var touchEnd = function () {
      if (!t0) return;
      var d = t0;
      t0 = null;
      lbFig.classList.remove('is-drag');
      lbFig.style.transform = '';
      lb.style.backgroundColor = '';
      if (Math.abs(d.dx) > 10 || Math.abs(d.dy) > 10) lbSwiped = Date.now();
      if (d.dy > 90 && Math.abs(d.dy) > Math.abs(d.dx)) return close();
      if (Math.abs(d.dx) > 50 && Math.abs(d.dx) > Math.abs(d.dy)) go(d.dx < 0 ? 1 : -1);
    };
    lb.addEventListener('touchend', touchEnd);
    lb.addEventListener('touchcancel', touchEnd);
  }

  // ---------- Сколько дней ещё действует скидка. Дату подставляет сервер из админки ----------
  (function () {
    var els = $$('[data-until]');
    if (!els.length) return;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(els[0].getAttribute('data-until'));
    if (!m) return;
    var days = Math.ceil((new Date(+m[1], +m[2] - 1, +m[3]) - new Date()) / 86400000);
    if (days < 1 || days > 200) return;
    var n = days % 10, nn = days % 100;
    var word = n === 1 && nn !== 11 ? 'день' : n >= 2 && n <= 4 && (nn < 10 || nn >= 20) ? 'дня' : 'дней';
    var text = days === 1 ? 'Сегодня последний день' : 'Осталось ' + days + ' ' + word;
    els.forEach(function (el) { el.textContent = text; el.hidden = false; });
  })();

  // ---------- Рисунки от руки ----------
  // Подчёркивание «не стыдно» и обводка цены — как ручкой в тетради.
  // Линии заданы в поле 100×100 и растягиваются под размер места, толщина при этом не искажается.
  // Прорисовываются, когда блок показался на экране, и заново при каждом возвращении к нему
  (function () {
    var SHAPES = {
      under: [['M2 50 C 30 26, 68 22, 98 34', 0], ['M10 88 C 40 66, 70 62, 93 72', .3]],
      circle: [['M78 10 C 56 -2, 16 2, 5 32 C -4 62, 22 97, 56 96 C 91 95, 104 62, 96 33 C 90 12, 68 5, 46 9', 0]]
    };
    var NS = 'http://www.w3.org/2000/svg';
    // Числа в пути идут парами x, y — растягиваем их под ширину и высоту места
    var scale = function (d, w, h) {
      var n = 0;
      return d.replace(/-?\d+(\.\d+)?/g, function (v) { return (n++ % 2 ? v * h / 100 : v * w / 100).toFixed(1); });
    };
    // Прямоугольник слова внутри host (по тексту, поэтому работает и с текстом из админки)
    var wordRect = function (el, word) {
      var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false), n;
      while ((n = tw.nextNode())) {
        var i = n.nodeValue.indexOf(word);
        if (i < 0) continue;
        // Слова заголовков выезжают по одному (span внутри .w): меряем неподвижную обёртку, а не само слово в полёте
        var w = n.parentNode && n.parentNode.parentNode;
        if (w && w.classList && w.classList.contains('w') && n.nodeValue.trim() === word) return w.getBoundingClientRect();
        var r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + word.length);
        return r.getBoundingClientRect();
      }
      return null;
    };
    var items = [];
    // host — от чего отсчитываем место; place(hostRect) → {x, y, w, h} или null, если рисовать некуда
    var add = function (host, shape, cls, place, delay) {
      if (!host) return;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'doodle' + (cls ? ' ' + cls : ''));
      svg.setAttribute('aria-hidden', 'true');
      var paths = SHAPES[shape].map(function (sp) {
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('pathLength', '1');
        p.style.transitionDelay = ((delay || 0) + sp[1]) + 's';
        svg.appendChild(p);
        return p;
      });
      host.appendChild(svg);
      var it = { host: host, svg: svg, paths: paths, shape: shape, place: place, timer: 0 };
      it.fit = function () {
        var h = host.getBoundingClientRect(), b = it.place.call(it, h);
        if (!b) { svg.style.display = 'none'; return; }
        svg.style.display = '';
        svg.style.left = b.x.toFixed(1) + 'px'; svg.style.top = b.y.toFixed(1) + 'px';
        svg.style.width = b.w.toFixed(1) + 'px'; svg.style.height = b.h.toFixed(1) + 'px';
        svg.setAttribute('viewBox', '0 0 ' + b.w.toFixed(1) + ' ' + b.h.toFixed(1));
        SHAPES[shape].forEach(function (sp, i) { paths[i].setAttribute('d', scale(sp[0], b.w, b.h)); });
      };
      items.push(it);
      return it;
    };
    var under = function (word, dy) {
      return function (h) {
        var r = wordRect(this.host, word);
        if (!r || !r.width) return null;
        // Линия у нижнего края букв, а не у нижнего края строки (у крупного шрифта он сильно ниже)
        return { x: r.left - h.left - 4, y: r.top - h.top + r.height * .87 + (dy || 0), w: r.width + 8, h: Math.max(12, r.height * .22) };
      };
    };
    var around = function (sel, px, py) {
      return function (h) {
        var el = $(sel, this.host), r = el && el.getBoundingClientRect();
        if (!r || !r.width) return null;
        return { x: r.left - h.left - px, y: r.top - h.top - py, w: r.width + px * 2, h: r.height + py * 2 };
      };
    };
    var title = $('.hero__title');
    add(title, 'under', '', under('не стыдно'), 0);
    add($('.offer__deal'), 'circle', 'doodle--thin', around('.offer__price', 16, 8), .1);

    if (!items.length) return;
    var fitAll = function () { items.forEach(function (it) { it.fit(); }); };
    fitAll();
    // Шрифты и картинки могут сдвинуть текст — подгоняем ещё раз, когда всё загрузилось
    window.addEventListener('load', fitAll);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
    window.addEventListener('resize', function () { raf(fitAll); });
    if (!fx) return; // без анимаций рисунки просто стоят дорисованными
    // Заголовок первого экрана выезжает (а при первом заходе ещё и после заставки) — ждём, пока он встанет
    var heroWait = root.classList.contains('intro') ? 2900 : 1200, t0 = now();
    watch(items.map(function (it) { return it.svg; }), function (svg, vis) {
      var it = items.filter(function (x) { return x.svg === svg; })[0];
      clearTimeout(it.timer);
      if (!vis) { svg.classList.remove('is-drawn'); return; }
      var wait = it.host === title ? Math.max(0, heroWait - (now() - t0)) : 250;
      it.timer = setTimeout(function () { it.fit(); svg.classList.add('is-drawn'); }, wait);
    }, { rootMargin: '0px 0px -12% 0px' });
  })();


  // ---------- «Обработка» ----------
  // Перед «Почему так дорого?» экран становится фоторедактором, и посетитель сам крутит «Свет», «Контраст», «Тепло» —
  // снимок меняется под пальцем. Когда окно встало, курсор один раз показывает, как тянуть
  (function () {
    var box = $('.edit');
    if (!box) return;
    var img = $('.edit__img', box);
    if (!img) { box.parentNode.removeChild(box); return; }
    // Редактор — не анимация, а игрушка: он есть у всех, а курсор-подсказка — только там, где анимации включены
    box.classList.add('is-on');
    var win = $('.edit__win', box), cur = $('.edit__cur', box);
    var inputs = $$('.edit__sl input', box), nums = $$('.edit__sl b', box);
    // Ползунок в середине (50) — снимок как есть; меньше — тусклее, больше — ярче
    var val = function (k) { for (var i = 0; i < inputs.length; i++) if (inputs[i].getAttribute('data-k') === k) return +inputs[i].value; return 50; };
    var paint = function () {
      var L = val('light'), C = val('contrast'), T = val('warm');
      var f = 'brightness(' + (.55 + L * .009).toFixed(3) + ') contrast(' + (.6 + C * .008).toFixed(3) + ') saturate(' + (.2 + T * .016).toFixed(3) + ') sepia(' + (Math.max(0, T - 50) * .006).toFixed(3) + ')';
      img.style.filter = f;
      img.style.webkitFilter = f;
      inputs.forEach(function (inp, i) {
        var v = +inp.value, d = Math.round((v - 50) * 2);
        inp.style.setProperty('--v', v + '%');
        nums[i].textContent = (d > 0 ? '+' : '') + d;
      });
    };
    paint();

    // Плавно довести ползунки до значений to за ms; курсор, если есть, едет за бегунком
    var anim = null;
    var tween = function (to, ms, withCursor, done) {
      if (anim) cancelAnimationFrame(anim.id);
      var from = inputs.map(function (inp) { return +inp.value; }), t0 = now();
      anim = { id: 0 };
      (function step() {
        var k = Math.min(1, (now() - t0) / ms), e = ease2(k);
        inputs.forEach(function (inp, i) {
          var target = to[inp.getAttribute('data-k')];
          if (target != null) inp.value = Math.round(from[i] + (target - from[i]) * e);
        });
        paint();
        if (withCursor) cursorTo(withCursor);
        if (k < 1) anim.id = raf(step); else { anim = null; if (done) done(); }
      })();
    };
    // Где бегунок ползунка внутри окна
    var thumbAt = function (inp) {
      var w = win.getBoundingClientRect(), r = inp.getBoundingClientRect();
      return { x: r.left - w.left + 10 + (r.width - 20) * (+inp.value / 100), y: r.top - w.top + r.height / 2 };
    };
    var cursorTo = function (inp) { var t = thumbAt(inp); cur.style.transform = 'translate3d(' + t.x.toFixed(1) + 'px,' + t.y.toFixed(1) + 'px,0)'; };

    // Подсказка курсором: один раз, когда окно встало на место. Если посетитель уже тронул ползунок — не нужна
    var touched = false, shown = false;
    var demo = function () {
      if (shown || touched || !fx) return;
      shown = true;
      var first = inputs[0];
      cur.style.transition = 'none';
      cur.style.transform = 'translate3d(' + (win.offsetWidth * .9).toFixed(1) + 'px,' + (win.offsetHeight + 30) + 'px,0)';
      void cur.offsetWidth;
      cur.style.transition = 'opacity .3s, transform .7s cubic-bezier(.5,0,.2,1)';
      cur.classList.add('is-on');
      cursorTo(first);
      setTimeout(function () {
        if (touched) return;
        cur.style.transition = 'opacity .3s';
        cur.classList.add('is-down');
        tween({ light: 58 }, 1100, first, function () {
          cur.classList.remove('is-down');
          box.classList.add('is-hint');
          setTimeout(function () { cur.classList.remove('is-on'); }, 500);
        });
      }, 800);
    };
    var stopDemo = function () {
      if (touched) return;
      touched = true;
      if (anim) { cancelAnimationFrame(anim.id); anim = null; }
      cur.classList.remove('is-on', 'is-down');
      box.classList.add('is-hint');
    };
    inputs.forEach(function (inp) {
      inp.addEventListener('pointerdown', stopDemo);
      inp.addEventListener('keydown', stopDemo);
      inp.addEventListener('input', function () { stopDemo(); paint(); });
    });

    // Показываем, как тянуть, когда окно редактора целиком на экране
    watch([win], function (el, vis, io, en) { if (vis && (!en || en.intersectionRatio >= .8)) demo(); }, { threshold: [.8, .95] });
  })();


  // ---------- Переходы между блоками ----------
  // Переход — высокий блок с прилипающим экраном (pin). Пока экран прилип, прокрутка ведёт сцену:
  // p = 0 — верх перехода у верха экрана, p = 1 — экран отлипает и уезжает вместе со страницей.
  //
  // Чтобы на iPhone ничего не дёргалось, у всех переходов три правила:
  // 1. Двигает сам браузер. Весь переход заранее считаем по шагам в обычные @keyframes, а ведёт их прокрутка
  //    (view-timeline): Safari 26.4+ и Chrome двигают такие анимации в том же потоке, что и прокрутку, —
  //    кадр в кадр со страницей, даже если скрипт в этот момент занят. Где браузер так не умеет,
  //    те же расчёты ставит скрипт.
  // 2. Ничто не зависит от видимой высоты экрана. Safari при прокрутке прячет и показывает свою панель,
  //    видимая высота меняется, и всё, что к ней привязано (dvh, прогресс «пока блок в экране»), прыгает.
  //    Поэтому экраны переходов высотой 100vh (высота без панели — она постоянна), а прогресс считаем
  //    от высоты самого перехода (диапазон exit-crossing: от «верх перехода у верха экрана»).
  // 3. Ничто не догоняет прокрутку расчётом. Снимок, который садится в плитку галереи, в конце полёта живёт
  //    в той же прокрутке, что и плитка, — поэтому садится пиксель в пиксель, как бы быстро ни листали.
  (function () {
    // Плёнка едет сама (CSS-анимация), на паузе, пока её нет на экране
    var film = $('.film');
    if (film) {
      watch([film], function (el, vis) { film.classList.toggle('is-live', vis); }, { rootMargin: '100px 0px' });
      // В ленте набор кадров повторён дважды, сдвиг на половину зацикливает её. На широком экране половины
      // может не хватить на всю ленту — тогда повторяем набор чаще, а время круга растёт так же, чтобы скорость не менялась
      // Кадры плёнки маленькие: грузим их сразу. Отложенная загрузка ждёт, пока кадр въедет в экран сбоку,
      // и тогда в ленте мелькают пустые кадры
      $$('img', film).forEach(function (im) { im.loading = 'eager'; });
      var tracks = $$('.film__track', film).map(function (tr) {
        var n = tr.children.length / 2, one = '';
        for (var i = 0; i < n; i++) {
          var c = tr.children[i].cloneNode(true);
          $$('img', c).forEach(function (im) { im.classList.remove('ld'); im.removeAttribute('loading'); });
          one += c.outerHTML;
        }
        return { el: tr, one: one, k: 1, dur: parseFloat(getComputedStyle(tr).animationDuration) || 22 };
      });
      var fillFilm = function () {
        tracks.forEach(function (t) {
          var base = t.el.scrollWidth / (2 * t.k), need = t.el.parentNode.offsetWidth * 1.1;
          if (!base) return;
          var k = Math.max(1, Math.ceil(need / base));
          if (k === t.k) return;
          t.k = k;
          var html = '';
          for (var i = 0; i < 2 * k; i++) html += t.one;
          t.el.innerHTML = html;
          t.el.style.animationDuration = (t.dur * k) + 's';
        });
      };
      fillFilm();
      window.addEventListener('load', fillFilm);
      window.addEventListener('resize', function () { raf(fillFilm); });
    }
  })();

  var viewTl = fx && supports('animation-timeline', 'view()') && supports('view-timeline', '--a block') &&
    supports('animation-range', 'exit-crossing 0% exit-crossing 50%');
  var ease2 = function (t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  // Размеры экрана в пикселях: vh — высота без панели браузера (lvh), svh — с панелью, vw — ширина.
  // На телефоне они не меняются, когда Safari прячет и показывает панель, поэтому переходы считаем сразу
  // в пикселях: формулы с vh/vw внутри шагов анимации Safari пересчитывает на каждом кадре прокрутки
  var SVH = supports('height', '1svh') ? 'svh' : 'vh';
  var U = {};
  function units() {
    var d = document.createElement('div');
    d.style.cssText = 'position:absolute;top:0;left:0;width:100vw;height:100vh;visibility:hidden;pointer-events:none';
    body.appendChild(d);
    var vw = d.offsetWidth, vh = d.offsetHeight;
    d.style.height = '100' + SVH;
    var svh = d.offsetHeight;
    body.removeChild(d);
    var old = U;
    U = { vw: (vw || window.innerWidth) / 100, vh: (vh || window.innerHeight) / 100, svh: (svh || vh || window.innerHeight) / 100 };
    return old.vw !== U.vw || old.vh !== U.vh || old.svh !== U.svh;
  }
  units();
  // px пикселей + h высот экрана (vh) + w ширин экрана — в пикселях
  function len(px, h, w) { return ((px || 0) + (h || 0) * 100 * U.vh + (w || 0) * 100 * U.vw).toFixed(1) + 'px'; }

  // Где переходы лежат на странице — в пикселях документа. Прогресс считаем из прокрутки без замеров
  // раскладки каждый кадр; перемеряем, только когда страница поменяла размер
  var stages = [];
  function stage(box) {
    var st = { box: box, pin: box.firstElementChild, top: 0, h: 1, span: 1, on: false, p: -1, fns: [] };
    st.measure = function () {
      var r = box.getBoundingClientRect();
      st.top = r.top + window.pageYOffset;
      st.h = box.offsetHeight || 1;
      st.span = Math.max(1, st.h - st.pin.offsetHeight);
    };
    st.measure();
    stages.push(st);
    watch([box], function (el, vis) { st.on = vis; st.p = -1; if (vis) stageTick(st, window.pageYOffset); }, { rootMargin: '100px 0px' });
    return st;
  }
  function stageTick(st, y) {
    var p = clamp01((y - st.top) / st.span);
    if (p === st.p) return;
    st.p = p;
    for (var i = 0; i < st.fns.length; i++) st.fns[i](p);
  }
  var stagesDirty = false;
  function stagesNow() {
    stagesDirty = false;
    var y = window.pageYOffset;
    stages.forEach(function (st) { st.measure(); st.p = -1; if (st.on) stageTick(st, y); });
  }
  perFrame.push(function (y) {
    if (stagesDirty) stagesNow();
    for (var i = 0; i < stages.length; i++) if (stages[i].on) stageTick(stages[i], y);
  });
  if ('ResizeObserver' in window) new ResizeObserver(function () { stagesDirty = true; raf(function () { if (stagesDirty) stagesNow(); }); }).observe(body);
  window.addEventListener('load', function () { stagesNow(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { stagesDirty = true; });

  // Все переходы считаем в свободные паузы после загрузки, по одному, пока человек смотрит первый экран:
  // посреди прокрутки считать нельзя — на слабом телефоне это проседание кадра. Если человек добрался
  // до перехода раньше (например, по ссылке) — считаем сразу, за полэкрана до него
  var keyQueue = [], keyTimer = 0;
  var idle = window.requestIdleCallback ? function (fn) { requestIdleCallback(fn); } : function (fn) { setTimeout(fn, 80); };
  var keyNext = function () {
    var it = keyQueue.shift();
    if (!it) return;
    if (it.dirty) it.build();
    idle(keyNext);
  };
  var keyStart = function () { clearTimeout(keyTimer); keyTimer = setTimeout(function () { idle(keyNext); }, 400); };
  if (document.readyState === 'complete') keyStart(); else window.addEventListener('load', keyStart);
  // Переход работает, только пока до него не больше экрана: Safari на каждом кадре прокрутки обрабатывает
  // все подключённые анимации, даже далёкие, — отключённые не стоят ничего
  var keyIO = viewTl && hasIO ? new IntersectionObserver(function (ents) {
    ents.forEach(function (en) { (en.target.__keys || []).forEach(function (it) { it.near(en.isIntersecting); }); });
  }, { rootMargin: '100% 0px' }) : null;
  // Шаги анимации: считаем часто, а оставляем только те, без которых движение заметно меняется —
  // между ними браузер ведёт прямую. Допуск: треть пикселя, десятая градуса, тысячные масштаба и прозрачности.
  // Safari на каждом кадре перебирает шаги всех анимаций, поэтому их должно быть как можно меньше
  var NUM = /-?\d*\.?\d+/g;
  function thin(list) {
    var n = list.length;
    var shape = list.map(function (c) { return c.replace(NUM, '#'); });
    var nums = list.map(function (c) { return (c.match(NUM) || []).map(Number); });
    var tols = list.map(function (c) {
      var t = [];
      c.replace(NUM, function (m, off) { var u = c.charAt(off + m.length); t.push(u === 'p' ? .3 : u === 'd' ? .1 : .002); return m; });
      return t;
    });
    var fits = function (a, b) {
      if (shape[a] !== shape[b]) return false;
      for (var i = a + 1; i < b; i++) {
        if (shape[i] !== shape[a]) return false;
        var t = (i - a) / (b - a), A = nums[a], B = nums[b], I = nums[i], T = tols[a];
        for (var k = 0; k < I.length; k++) if (Math.abs(A[k] + (B[k] - A[k]) * t - I[k]) > T[k]) return false;
      }
      return true;
    };
    var keep = [0], a = 0;
    while (a < n - 1) {
      var b = a + 1;
      while (b + 1 < n && fits(a, b + 1)) b++;
      keep.push(b);
      a = b;
    }
    return keep.map(function (i) { return (i * 100 / (n - 1)).toFixed(3) + '%{' + list[i] + '}'; }).join('');
  }
  // at(p) для p от 0 до 1 возвращает для каждого элемента { transform, opacity }; длины — только в пикселях
  function scrollKeys(st, name, els, at, steps) {
    var box = st.box, sheet = null, range = '', near = false, bound = false;
    // Шкала прокрутки у перехода одна, даже если наборов анимаций несколько
    var tl = st.tl || (st.tl = name);
    box.style.setProperty('view-timeline', '--' + tl + ' block');
    // Иначе браузер отсчитывает прокрутку с учётом отступа под шапку (scroll-padding)
    box.style.setProperty('view-timeline-inset', '0px');
    // Элементы вне перехода (плитка галереи) видят его шкалу через общего родителя
    if (els.some(function (el) { return !box.contains(el); })) box.parentNode.style.setProperty('timeline-scope', '--' + tl);
    var it = { dirty: true };
    var bind = function () {
      var on = near && !!range;
      els.forEach(function (el, j) {
        if (on) {
          if (!bound) {
            el.style.animation = name + '-' + j + ' linear both';
            el.style.setProperty('animation-duration', 'auto');
            el.style.setProperty('animation-timeline', '--' + tl);
          }
          el.style.setProperty('animation-range', range);
        } else if (bound) {
          el.style.animation = '';
          ['animation-duration', 'animation-timeline', 'animation-range'].forEach(function (k) { el.style.removeProperty(k); });
        }
      });
      bound = on;
    };
    it.build = function () {
      it.dirty = false;
      var samples = [];
      for (var i = 0; i <= steps; i++) samples.push(at(i / steps));
      if (!sheet) { sheet = document.createElement('style'); document.head.appendChild(sheet); }
      sheet.textContent = els.map(function (el, j) {
        var list = samples.map(function (v) {
          var x = v[j], c = '';
          if (x.transform != null) c += 'transform:' + x.transform + ';';
          if (x.opacity != null) c += 'opacity:' + x.opacity + ';';
          return c;
        });
        return '@keyframes ' + name + '-' + j + '{' + thin(list) + '}';
      }).join('\n');
      // Прилипание — первые (высота перехода − экран) пикселей его пересечения с верхом экрана
      range = 'exit-crossing 0% exit-crossing ' + (st.span / st.h * 100).toFixed(4) + '%';
      bind();
    };
    it.near = function (v) {
      near = v;
      if (v && it.dirty) it.build(); else bind();
    };
    (box.__keys = box.__keys || []).push(it);
    if (keyIO) { keyIO.unobserve(box); keyIO.observe(box); keyQueue.push(it); } else { near = true; it.build(); }
    // Пересчёт (сменилась ширина экрана или раскладка): сразу — если переход рядом, иначе — когда до него дойдут
    return function () {
      it.dirty = true;
      if (!keyIO || near) it.build();
      else if (keyQueue.indexOf(it) < 0) { keyQueue.push(it); keyStart(); }
    };
  }
  // Где анимацию ведёт скрипт: тот же расчёт, поставленный прямо сейчас
  function applyAt(els, v) {
    for (var j = 0; j < els.length; j++) {
      if (v[j].transform != null) els[j].style.transform = v[j].transform;
      if (v[j].opacity != null) els[j].style.opacity = v[j].opacity;
    }
  }
  // Пересчитать переходы, когда сменилась ширина экрана (поворот, окно компьютера) или высота — сильнее,
  // чем прячется панель браузера на телефоне
  // Шаги в пикселях: пересчитываем, когда поменялся сам экран (поворот, окно компьютера). На телефоне панель
  // Safari ни vh, ни svh не меняет — от неё ничего не пересчитывается
  var rebuilds = [];
  function onRebuild(fn) { rebuilds.push(fn); }
  window.addEventListener('resize', function () {
    raf(function () {
      stagesNow();
      if (units()) rebuilds.forEach(function (fn) { fn(); });
    });
  });
  // Переход без анимаций (облегчённый режим, «меньше движения») убираем целиком
  function drop(box) { if (box && box.parentNode) box.parentNode.removeChild(box); }

  // ---------- «Фото из принтера» ----------
  // Перед галереей камера Canon с моментальной печатью печатает первый снимок галереи: он выходит вверх
  // из щели, проявляется, подпрыгивает и, когда снизу показалась галерея, перелетает точно на своё место.
  // Потом камера поднимается в воздух, в объёме разворачивается к посетителю объективом, наводится
  // и снимает его со вспышкой — «следующий кадр за тобой». Так и остаётся висеть, чуть покачиваясь.
  // Камера — обычный блок страницы: едет вместе с ней, ничего не прилипает к экрану. Раньше камера держалась
  // на прилипшем экране, и в Safari на телефоне при медленной прокрутке и при смене направления (панель
  // браузера прячется и показывается) она дёргалась. Печать и полёт идут сами, по времени, на видеочипе
  // (Web Animations); прокрутка только говорит «пора»
  (function () {
    var box = $('.print');
    if (!box) return;
    var gal = box.nextElementSibling, tile = gal && $('.pics > .pic', gal), src = tile && $('img', tile);
    if (!fx || !src || !box.animate) return drop(box);
    box.classList.add('is-on', 'is-flow');
    var photo = $('.print__photo', box), dev = $('.print__dev', photo), shot = $('img', photo), thumb = $('.print__thumb', box);
    var cam = $('.print__cam', box), look = $('.print__aim', box), floor = $('.print__floor', box), shades = $$('.print__shade', box);
    var ring = $('.print__ring', box), barrel = $('.print__barrel', box), af = $('.print__af', box), flashWin = $('.print__flash i', box);
    var gloss = $('.print__gloss', box), hull = $('.print__hull', box), hullKey = '';
    // Корпус между задней и лицевой сторонами — замкнутая коробка со скруглёнными углами (радиусы как у сторон:
    // 30 сверху, 24 снизу). Прямые грани и углы из узких полос; свет сверху слева, как на сторонах.
    // Каждая грань смотрит наружу и видна только снаружи, поэтому с любого ракурса корпус цельный
    var buildHull = function (W, Hh, D) {
      var key = W + 'x' + Hh + 'x' + D;
      if (key === hullKey) return;
      hullKey = key;
      var RT = 30, RB = 24, out = [];
      var LX = -.5, LY = -.866;
      var tone = function (nx, ny) {
        var f = .25 + .75 * Math.max(0, nx * LX + ny * LY), a = [22, 12, 11], b = [92, 68, 62];
        return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
      };
      // полоса длиной L и шириной в толщину корпуса: середина в (x, y), смотрит наружу под углом phi (0 — вправо, 90 — вниз)
      var wall = function (x, y, L, phi, over) {
        var r = phi * Math.PI / 180, tf = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0) rotateZ(' + (phi + 90).toFixed(2) + 'deg) rotateX(90deg)';
        out.push('<i style="width:' + L.toFixed(2) + 'px;height:' + D + 'px;margin:' + (-D / 2) + 'px 0 0 ' + (-L / 2).toFixed(2) + 'px;-webkit-transform:' + tf + ';transform:' + tf +
          ';background:' + (over ? over + ',' : '') + tone(Math.cos(r), Math.sin(r)) + '"></i>');
      };
      // скруглённый угол: четверть окружности радиуса R с центром (cx, cy), от угла from, n полос
      var arc = function (cx, cy, R, from, n) {
        var step = 90 / n, half = step / 2 * Math.PI / 180;
        for (var k = 0; k < n; k++) {
          var m = from + step * (k + .5), mr = m * Math.PI / 180, rr = R * Math.cos(half);
          wall(cx + rr * Math.cos(mr), cy + rr * Math.sin(mr), 2 * R * Math.sin(half) + .8, m);
        }
      };
      var w2 = W / 2, h2 = Hh / 2, side = Hh - RT - RB + .8, mid = (RT - RB) / 2;
      // сверху — щель, из которой выходит снимок
      wall(0, -h2, W - 2 * RT + .8, -90, 'linear-gradient(rgba(0,0,0,0) 42%, #080504 42%, #080504 58%, rgba(0,0,0,0) 58%) 50% 0 / 82% 100% no-repeat');
      wall(0, h2, W - 2 * RB + .8, 90);
      wall(-w2, mid, side, 180);
      wall(w2, mid, side, 0);
      arc(-w2 + RT, -h2 + RT, RT, 180, 7);
      arc(w2 - RT, -h2 + RT, RT, 270, 7);
      arc(w2 - RB, h2 - RB, RB, 0, 6);
      arc(-w2 + RB, h2 - RB, RB, 90, 6);
      hull.innerHTML = out.join('');
    };
    var fly = $('.print__fly', box), flyPaper = $('.print__paper', fly);
    var pbox = $('.print__box', box), face = $('.print__face', box);
    var lcd = $$('.print__lcd span', box), fill = $('.print__fill', box), led = $('.print__led i', box);
    // Печатает первую плитку галереи
    var imgs = [shot, thumb, $('img', fly)];
    imgs.forEach(function (im) { im.src = src.currentSrc || src.src; });
    warm(imgs);
    var els = [pbox, photo, dev, fly, flyPaper, fill, tile, led, lcd[0], lcd[1]];
    // Разворот: корпус поднимается, камера поворачивается, тень на столе меньше, отвернувшаяся сторона темнеет,
    // по лицевой стороне пробегает блик
    var els3 = [pbox, cam, floor, shades[0], shades[1], gloss];
    // Вспышка на весь экран — один слой поверх страницы
    var bang = document.createElement('i');
    bang.className = 'print__bang';
    bang.setAttribute('aria-hidden', 'true');
    body.appendChild(bang);
    var g = null, top = 0;
    var H = function () { return 100 * U.vh; };
    // Размер снимка (тех же пропорций, что плитка), верх камеры (--slot), высота камеры и блока, где плитка.
    // Всё в пикселях один раз: от панели Safari ничего не пересчитывается
    var measure = function () {
      var W = box.clientWidth, tr = tile.getBoundingClientRect();
      var ratio = tr.width ? tr.height / tr.width : 1.5;
      // снимок, камера и плитка галереи должны помещаться на одном экране: тогда видно, куда снимок летит
      var w = Math.min(Math.max(170, W * .5), 240, U.svh * 32 / ratio), h = w * ratio;
      box.style.setProperty('--pw', w.toFixed(1) + 'px');
      box.style.setProperty('--ph', h.toFixed(1) + 'px');
      // над камерой ровно столько места, сколько занимает готовый снимок в белой рамке, и небольшой отступ
      var slot = Math.round(h + 66 + 18 + 10 + 22);
      // камера целиком: верхняя грань, экран с кнопками и низ корпуса, под ней тень на «столе»
      var camH = Math.round(56 + face.offsetHeight + 14);
      // корпус шире, чем высота, как у настоящего фотоаппарата, но не шире экрана
      var camW = Math.round(Math.max(w + 84, Math.min(camH * 1.45, W - 36)));
      box.style.setProperty('--cam-w', camW + 'px');
      var camD = Math.round(camW * .2);
      box.style.setProperty('--cam-d', camD + 'px');
      buildHull(camW, camH, camD);
      box.style.setProperty('--slot', slot + 'px');
      box.style.setProperty('--cam-h', camH + 'px');
      box.style.setProperty('--pin-h', (slot + camH + 48) + 'px');
      var br = box.getBoundingClientRect();
      tr = tile.getBoundingClientRect();
      top = br.top + window.pageYOffset;
      g = {
        w: w, h: h, slot: slot, camH: camH,
        // насколько камера поднимается: на середину блока, туда, где был снимок
        lift: Math.max(0, Math.round(slot / 2 - 34)),
        // куда встаёт центр снимка: сдвиг от середины блока по x и от его верха по y
        x: tr.left + tr.width / 2 - (br.left + W / 2), y: tr.top - br.top + tr.height / 2 - h / 2, k: tr.width / w
      };
    };
    // Печать: t от 0 до 1. Снимок выползает из щели и проявляется, полоса заполняется, в конце он подпрыгивает
    var atPrint = function (t) {
      var fed = ease2(clamp01((t - .05) / .8)), pop = ease2(clamp01((t - .88) / .12));
      var yA = 12 - (g.h + 66) * fed - pop * 18;
      return [
        { transform: 'translate3d(0,0,0)' },
        { transform: 'translate3d(0,' + yA.toFixed(2) + 'px,0) rotate(' + (3 * pop).toFixed(2) + 'deg)', opacity: 1 },
        { opacity: (1 - clamp01((t - .15) / .6)).toFixed(3) },
        { opacity: 0 },
        { opacity: 1 },
        { transform: 'scaleX(' + fed.toFixed(4) + ')' },
        { opacity: 0 },
        { opacity: t > 0 && fed < 1 ? 1 : 0 },
        { opacity: fed < 1 ? 1 : 0 },
        { opacity: fed < 1 ? 0 : 1 }
      ];
    };
    // Разворот: t от 0 до 1. Сначала камера отрывается от стола, по ходу подъёма поворачивается на 180°
    // и чуть кивает, к концу смотрит объективом на посетителя
    var lift = 0;
    // Пружина: от 0 к 1 с перелётом и затухающим качанием (k — затухание, w — частота)
    var spring = function (x, k, w) { return x >= 1 ? 1 : 1 - Math.exp(-k * x) * (Math.cos(w * x) + k / w * Math.sin(w * x)); };
    // Положение камеры: сдвиг вбок и к зрителю, наклон вперёд-назад, разворот, крен
    var camT = function (tx, z, px, ay, rz) {
      return 'translate3d(' + tx.toFixed(2) + 'px,0,' + z.toFixed(2) + 'px) rotateX(' + px.toFixed(2) + 'deg) rotateY(' + ay.toFixed(2) + 'deg) rotateZ(' + rz.toFixed(2) + 'deg)';
    };
    // В конце камера смотрит на посетителя, чуть наклонившись к нему
    var HOLD = camT(0, 0, -5, 180, 0);
    // Разворот: t от 0 до 1. Камера приседает, подлетает с наклоном назад и креном, уходит дугой вбок и к зрителю,
    // по пружине проскакивает разворот и встаёт объективом к посетителю
    var atTurn = function (t) {
      var a = clamp01(t / .16), dip = t < .16 ? Math.sin(Math.PI * a) : 0;
      var u = clamp01((t - .1) / .9), x = clamp01((t - .16) / .84);
      var up = lift ? spring(u, 6, 7) : 0, ang = 180 * spring(x, 5, 8);
      var px = 6 * dip - 16 * Math.sin(Math.PI * clamp01(x / .7)) - 5 * ease2(x);
      var rz = 9 * Math.sin(Math.PI * clamp01(x / .75)) * (1 - .5 * x);
      var tx = 34 * Math.sin(Math.PI * clamp01(x / .85)), z = 60 * Math.sin(Math.PI * clamp01(x / .9));
      var high = clamp01(up);
      return [
        { transform: 'translate3d(0,' + (7 * dip - lift * up).toFixed(2) + 'px,0)' },
        { transform: camT(tx, z, px, ang, rz) },
        { transform: 'translate3d(' + (tx * .5).toFixed(2) + 'px,0,0) scale(' + (1 - .4 * high).toFixed(4) + ')', opacity: (1 - .55 * high).toFixed(3) },
        { opacity: (.6 * clamp01(ang / 90)).toFixed(3) },
        { opacity: (.6 * clamp01((180 - ang) / 90)).toFixed(3) },
        { opacity: (.7 * clamp01(1 - Math.abs(ang - 196) / 18)).toFixed(3) }
      ];
    };
    // Полёт: u от 0 до 1. Готовый снимок над щелью подхватывает второй (тот же снимок в том же месте страницы)
    // и ведёт в плитку. Оба в координатах блока, поэтому садится ровно, даже если в полёте листают
    var atFly = function (u) {
      var q = ease2(clamp01(u / .75)), a = 1 - q;
      var ty = a * (g.slot + 11 + 12 - (g.h + 66) - 18) + q * g.y;
      var tx = g.x * q + Math.sin(Math.PI * q) * 24;
      var sc = 1 + (g.k - 1) * q, rot = 3 * a - Math.sin(Math.PI * q) * 2;
      return [
        { transform: 'translate3d(0,0,0)' },
        { opacity: 0 },
        { opacity: 0 },
        { transform: 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) rotate(' + rot.toFixed(2) + 'deg) scale(' + sc.toFixed(4) + ')', opacity: (1 - clamp01((u - .82) / .12)).toFixed(3) },
        // белая рамка тает в полёте: в плитку садится фото без рамки
        { opacity: (1 - clamp01((q - .35) / .45)).toFixed(3) },
        { transform: 'scaleX(1)' },
        // плитка появляется под снимком, когда он сел, потом снимок растворяется
        { opacity: u < .8 ? 0 : 1 },
        { opacity: 0 },
        { opacity: 0 },
        { opacity: 1 }
      ];
    };
    measure();

    // idle → printing → printed → flying → rest → turning → aim → flash → done
    var phase = 'idle', anims = [], pctLoop = 0, lastPct = -1, pct = lcd[0], wantFly = false, restT = 0;
    var setPct = function (v) { if (v !== lastPct) { lastPct = v; pct.textContent = 'ПЕЧАТЬ ' + v + '%'; } };
    var stop = function () {
      anims.forEach(function (a) { a.onfinish = null; a.cancel(); });
      anims = [];
      cancelAnimationFrame(pctLoop);
      clearTimeout(restT);
    };
    var hurry = function () { anims.forEach(function (a) { if (a.updatePlaybackRate) a.updatePlaybackRate(8); else a.playbackRate = 8; }); };
    // Шаги движения: считаем часто, видеочип ведёт между ними прямую
    var play = function (list, fn, ms, steps, done) {
      var frames = list.map(function () { return []; });
      for (var i = 0; i <= steps; i++) {
        var v = fn(i / steps);
        for (var j = 0; j < list.length; j++) {
          var k = { offset: i / steps };
          if (v[j].transform != null) k.transform = v[j].transform;
          if (v[j].opacity != null) k.opacity = v[j].opacity;
          frames[j].push(k);
        }
      }
      var mine = [];
      list.forEach(function (el, j) {
        var f = frames[j], first = JSON.stringify([f[0].transform, f[0].opacity]);
        // то, что за эту часть не меняется, сразу ставим как есть, без анимации
        if (f.every(function (k) { return JSON.stringify([k.transform, k.opacity]) === first; })) {
          if (f[0].transform != null) el.style.transform = f[0].transform;
          if (f[0].opacity != null) el.style.opacity = f[0].opacity;
          return;
        }
        mine.push(el.animate(f, { duration: ms, easing: 'linear', fill: 'both' }));
      });
      anims = mine;
      var end = fn(1);
      var fin = function () {
        // конечное положение остаётся в самих элементах, анимации больше не нужны
        applyAt(list, end);
        stop();
        if (done) done();
      };
      if (mine.length) mine[0].onfinish = fin; else fin();
      return mine;
    };
    var set = function (ph, v) { stop(); phase = ph; wantFly = false; applyAt(els, v); };
    // keep — оставить подъём, выбранный при развороте (иначе — полный)
    var turned = function (on, keep) {
      if (!keep) lift = g.lift;
      applyAt(els3, atTurn(on ? 1 : 0));
      ring.style.rotate = on ? '28deg' : '';
      barrel.style.transform = on ? 'translateZ(8px)' : '';
      box.classList.toggle('is-float', on);
      if (!on) aimAt(0, 0, true);
    };
    var idle = function () { set('idle', atPrint(0)); turned(false); setPct(0); };
    // Всё уже случилось: снимок в галерее, камера висит объективом к посетителю
    var landed = function () { set('done', atFly(1)); turned(true); setPct(95); };

    var PRINT_MS = 2300, FLY_MS = 1300;
    // проценты на экране камеры — шагами по 5%, вслед за полосой
    var count = function (a, ph) {
      var tick = function () {
        if (!a || phase !== ph) return;
        var t = (a.currentTime || 0) / PRINT_MS;
        setPct(Math.min(95, Math.floor(ease2(clamp01((t - .05) / .8)) * 20) * 5));
        pctLoop = requestAnimationFrame(tick);
      };
      tick();
    };
    var print = function () {
      phase = 'printing';
      var list = play(els, atPrint, PRINT_MS, 60, function () { phase = 'printed'; setPct(95); if (wantFly) flyNow(); });
      count(list[0], 'printing');
    };
    var flyNow = function () {
      wantFly = false;
      phase = 'flying';
      play(els, atFly, FLY_MS, 80, function () {
        // снимок сел в плитку — камера поворачивается к посетителю
        phase = 'rest';
        restT = setTimeout(turn, 250);
      });
    };
    var turn = function () {
      phase = 'turning';
      // поднимается на середину блока, но не выше шапки сайта: на телефоне к этому моменту страницу уже листают дальше
      var camTop = top + g.slot - window.pageYOffset, room = camTop - (hd ? hd.offsetHeight : 60) - .2 * H();
      lift = Math.max(0, Math.min(g.lift, room));
      play(els3, atTurn, 1500, 100, aim);
    };
    // Наводится: чуть поводит объективом, будто ищет посетителя в кадре, объектив выдвигается,
    // кольцо фокуса проворачивается, подсветка фокуса мигает дважды
    var aim = function (again) {
      phase = 'aim';
      anims.push(cam.animate([
        { transform: HOLD, easing: 'ease-in-out' },
        { transform: camT(0, 0, -7, 171, -1.5), offset: .3, easing: 'ease-in-out' },
        { transform: camT(0, 0, -4, 186, 1), offset: .62, easing: 'ease-in-out' },
        { transform: HOLD }
      ], { duration: 900 }));
      anims.push(barrel.animate([{ transform: again ? 'translateZ(8px)' : 'translateZ(0px)' }, { transform: again ? 'translateZ(2px)' : 'translateZ(4px)', offset: .4 }, { transform: 'translateZ(8px)' }], { duration: 800, delay: 100, easing: 'ease-out', fill: 'both' }));
      anims.push(ring.animate([{ rotate: again ? '28deg' : '0deg' }, { rotate: again ? '-6deg' : '40deg', offset: .55 }, { rotate: '28deg' }], { duration: 800, delay: 100, easing: 'ease-in-out', fill: 'both' }));
      anims.push(af.animate([{ opacity: .35 }, { opacity: 1 }, { opacity: .35 }, { opacity: 1 }, { opacity: .35 }], { duration: 600, delay: 350 }));
      restT = setTimeout(shoot, 980);
    };
    // Щелчок: вспышка у камеры и, если камера на экране, короткая белая вспышка на весь экран из её вспышки
    var shoot = function () {
      phase = 'flash';
      anims.push(flashWin.animate([{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 0 }], { duration: 420 }));
      var r = flashWin.getBoundingClientRect(), Hh = window.innerHeight;
      if (r.bottom > (hd ? hd.offsetHeight : 0) && r.top < Hh) {
        bang.style.setProperty('--fx', Math.round(r.left + r.width / 2) + 'px');
        bang.style.setProperty('--fy', Math.round(r.top + r.height / 2) + 'px');
        anims.push(bang.animate([{ opacity: 0 }, { opacity: .85, offset: .12 }, { opacity: 0 }], { duration: 560, easing: 'linear' }));
      }
      // отдача: камеру чуть толкает назад и она возвращается
      anims.push(cam.animate([{ transform: HOLD }, { transform: camT(0, -16, -9, 180, 0), offset: .22 }, { transform: HOLD }], { duration: 420, easing: 'ease-out' }));
      restT = setTimeout(function () {
        stop();
        phase = 'done';
        turned(true, true);
      }, 600);
    };

    // На компьютере камера, которая уже смотрит на посетителя, поводит объективом за курсором
    var aimNow = { x: 0, y: 0, tx: 0, ty: 0, raf: 0 };
    var aimStep = function () {
      aimNow.x += (aimNow.tx - aimNow.x) * .1;
      aimNow.y += (aimNow.ty - aimNow.y) * .1;
      look.style.transform = 'rotateX(' + aimNow.y.toFixed(2) + 'deg) rotateY(' + aimNow.x.toFixed(2) + 'deg)';
      aimNow.raf = Math.abs(aimNow.tx - aimNow.x) > .05 || Math.abs(aimNow.ty - aimNow.y) > .05 ? requestAnimationFrame(aimStep) : 0;
    };
    var aimAt = function (x, y, now) {
      aimNow.tx = x; aimNow.ty = y;
      if (now) { cancelAnimationFrame(aimNow.raf); aimNow.raf = 0; aimNow.x = x; aimNow.y = y; look.style.transform = ''; return; }
      if (!aimNow.raf) aimNow.raf = requestAnimationFrame(aimStep);
    };
    if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      window.addEventListener('pointermove', function (e) {
        if (phase !== 'done' || !near) return;
        var r = pbox.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth, dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
        aimAt(Math.max(-18, Math.min(18, dx * 40)), Math.max(-12, Math.min(12, -dy * 26)));
      }, { passive: true });
      document.addEventListener('mouseleave', function () { if (phase === 'done') aimAt(0, 0); });
    }
    // Нажали на камеру — снимает ещё раз
    pbox.addEventListener('click', function () { if (phase === 'done') aim(true); });

    // Где сейчас камера и плитка на экране — из прокрутки, без замеров раскладки каждый кадр
    var near = false;
    var check = function (y) {
      var Hh = H();
      var camera = top + g.slot - y;              // верх камеры от верха экрана
      var tileAt = top + g.y + g.h / 2 - y;       // центр плитки от верха экрана
      // верх плитки показался снизу: пока снимок летит, страница поднимает её навстречу
      var tileOn = tileAt - g.h * g.k / 2 < Hh - 30;
      // верх готового снимка подошёл к шапке сайта — не даём ему уехать под неё, сразу летит к галерее
      var photoTop = top + g.slot + 11 + 12 - (g.h + 66) - 18 - y;
      var leaving = photoTop < (hd ? hd.offsetHeight : 60) + 8;
      if (phase === 'idle') {
        // пришли сразу к галерее (снизу или по ссылке), а камера уже ушла выше — показываем готовое
        if (tileOn && camera < 0) return landed();
        // верх камеры показался снизу — печатает
        if (camera < Hh - 120) print();
      }
      if (tileOn || leaving) {
        if (phase === 'printed') flyNow();
        else if (phase === 'printing' && !wantFly) { wantFly = true; hurry(); }
      }
    };
    idle();
    perFrame.push(function (y) { if (near) check(y); });
    // Ушли выше камеры — в следующий раз печать начнётся заново, ушли ниже — всё уже на местах
    watch([box], function (el, vis, io, en) {
      near = vis;
      box.classList.toggle('is-live', vis);
      if (vis) { check(window.pageYOffset); return; }
      if (en && en.boundingClientRect.top > 0) { if (phase !== 'idle') idle(); }
      else if (phase !== 'done') landed();
    }, { rootMargin: '200px 0px' });
    // Раскладка могла сдвинуться (шрифты, картинки, поворот экрана) — пересчитываем размеры и места
    var recheck = function () {
      measure();
      if (phase === 'idle') { applyAt(els, atPrint(0)); applyAt(els3, atTurn(0)); }
      else if (phase === 'done') { applyAt(els, atFly(1)); turned(true, true); }
      if (near) check(window.pageYOffset);
    };
    window.addEventListener('load', recheck);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(recheck);
    if ('ResizeObserver' in window) {
      var rt = 0;
      new ResizeObserver(function () { clearTimeout(rt); rt = setTimeout(recheck, 150); }).observe(document.body);
    }
    onRebuild(recheck);
  })();

  // ---------- «Фото на стол» ----------
  // После галереи снимки из «Работ» один за другим ложатся поверх экрана, как фотографии на стол,
  // секунду лежат и сами разлетаются в стороны. Ничего не прилипает и не ждёт прокрутки: блок нулевой высоты
  // только отмечает место, а снимки летят в слое поверх страницы, по времени, на видеочипе. Раньше стол прилипал
  // к экрану и ждал, пока долистают, — на iPhone при медленной прокрутке снимки дребезжали
  (function () {
    var box = $('.desk');
    if (!box) return;
    // Снимки вставляет сервер: фото из «Работ», которых нет ни в галерее над переходом, ни на плёнке
    var cards = $$('.desk__ph', box);
    if (!fx || cards.length < 4) return drop(box);
    box.classList.add('is-on', 'is-fix');
    // Где снимок ложится: сдвиг от центра в долях ширины и высоты экрана и наклон
    var SPOT = [[-.2, -.2, -9], [.2, -.24, 7], [-.03, -.02, 3], [-.24, .17, -6], [.23, .12, 10], [.02, .26, -7], [.1, -.08, -3]];
    var setSpots = function () {
      var W = window.innerWidth, H = window.innerHeight;
      cards.forEach(function (c, i) {
        var sp = SPOT[i % SPOT.length], dir = sp[0] < 0 ? -1 : 1;
        var x = sp[0] * W, y = sp[1] * H;
        c.style.setProperty('--i', i);
        // в воздухе: крупнее, чуть в стороне и с бо́льшим наклоном
        c.style.setProperty('--from', 'translate3d(' + (x + dir * .06 * W).toFixed(1) + 'px,' + (y - .05 * H).toFixed(1) + 'px,0) rotate(' + (sp[2] + (i % 2 ? 16 : -16)) + 'deg) scale(1.5)');
        c.style.setProperty('--at', 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + sp[2] + 'deg)');
        // уезжает за край экрана в свою сторону
        c.style.setProperty('--away', 'translate3d(' + (x + dir * .9 * W).toFixed(1) + 'px,' + (y - .08 * H).toFixed(1) + 'px,0) rotate(' + (sp[2] + dir * 22) + 'deg)');
      });
    };
    box.classList.add('is-time');
    // Сколько всё длится: все легли (последний — через 0,11 с × номер + 0,75 с), полежали, разлетелись
    var LAND = cards.length * 110 + 750, HOLD = 1100, AWAY = 800 + cards.length * 40 + 300;
    var phase = 'idle', t1 = 0, t2 = 0, top = 0;
    var clear = function () { clearTimeout(t1); clearTimeout(t2); };
    var reset = function () {
      clear();
      phase = 'idle';
      box.classList.remove('is-show', 'is-land', 'is-gone');
    };
    var play = function () {
      phase = 'play';
      setSpots();
      box.classList.add('is-show');
      // кадр на то, чтобы снимки встали в начальное положение, потом летят
      raf(function () { raf(function () { if (phase === 'play') box.classList.add('is-land'); }); });
      t1 = setTimeout(function () { box.classList.add('is-gone'); box.classList.remove('is-land'); }, LAND + HOLD);
      t2 = setTimeout(function () { phase = 'done'; box.classList.remove('is-show', 'is-gone'); }, LAND + HOLD + AWAY);
    };
    var measure = function () { top = box.getBoundingClientRect().top + window.pageYOffset; };
    measure();
    // Место отметки (между галереей и следующим блоком) поднялось до 60% экрана — снимки летят.
    // Ушли выше отметки на экран — в следующий раз полетят снова
    var near = false;
    perFrame.push(function (y) {
      if (!near) return;
      var at = top - y, H = window.innerHeight;
      if (phase === 'idle' && at < H * .6 && at > -H * .5) play();
      else if (phase !== 'idle' && at > H) reset();
    });
    watch([box], function (el, vis) {
      near = vis;
      if (!vis && phase !== 'idle') {
        var at = top - window.pageYOffset;
        if (at > 0) reset();
      }
    }, { rootMargin: '100% 0px' });
    window.addEventListener('load', measure);
    if ('ResizeObserver' in window) {
      var rt = 0;
      new ResizeObserver(function () { clearTimeout(rt); rt = setTimeout(measure, 150); }).observe(document.body);
    }
    onRebuild(function () { measure(); if (phase === 'idle') setSpots(); });
  })();

  // ---------- «Приближение» ----------
  // Перед контактами слово «ТВОЙ ВЫПУСК» стоит на месте, а прокрутка влетает в букву «О», пока экран
  // не станет бордовым, — и по нему снизу уже выезжают контакты. Слово растягивает видеочип готовой картинкой,
  // а не браузер, перерисовывая огромные буквы каждый кадр (из-за этого на iPhone приближение шло рывками).
  // Чтобы растянутые буквы меньше мылились, приближаем копию слова, набранную вдвое крупнее и сначала
  // уменьшенную вдвое, — само слово остаётся невидимым и держит место. Под конец поверх растягивается
  // сплошной бордовый слой — ровный цвет без мыла
  (function () {
    var zoom = $('.zoom');
    if (!zoom) return;
    if (!fx) return drop(zoom);
    zoom.classList.add('is-on');
    var st = stage(zoom);
    var word = $('.zoom__word', zoom), o = $('.zoom__o', zoom), sub = $('.zoom__sub', zoom);
    var fillZ = $('.zoom__fill', zoom), glow = $('.zoom__glow', zoom);
    var big = word.cloneNode(true);
    big.className = 'zoom__big';
    word.parentNode.insertBefore(big, word.nextSibling);
    word.classList.add('is-ghost');
    var els = [big, sub, fillZ, glow];
    var g = null;
    // Где слово на экране перехода и точка приближения — середина левой стенки буквы «О» (по раскладке, offset*)
    var measure = function () {
      var L = word.offsetLeft, T = word.offsetTop, own = o.offsetParent === word;
      var ox = o.offsetLeft - (own ? 0 : L), oy = o.offsetTop - (own ? 0 : T);
      var old = g;
      g = { L: L, T: T, x: L + ox + o.offsetWidth * .16, y: T + oy + o.offsetHeight * .52 };
      big.style.left = L.toFixed(1) + 'px';
      big.style.top = T.toFixed(1) + 'px';
      return !old || ['L', 'T', 'x', 'y'].some(function (k) { return Math.abs(old[k] - g[k]) > .5; });
    };
    // Первые 62% прокрутки — влёт в букву; к концу бордовый закрывает экран, по нему выезжают контакты
    var FULL = .62;
    var at = function (p) {
      // Приближение с постоянной скоростью для глаза (во сколько раз за сантиметр прокрутки), до 91 раза
      var q = Math.min(1, p / FULL), z = Math.pow(91, q);
      // Копия с верхним левым углом в (L, T) и уменьшенная вдвое совпадает со словом; приближение в z раз
      // вокруг точки (x, y) экрана — это сдвиг (точка − угол) · (1 − z) и масштаб z / 2
      var dx = (g.x - g.L) * (1 - z), dy = (g.y - g.T) * (1 - z);
      return [
        { transform: 'translate3d(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0) scale(' + (z / 2).toFixed(4) + ')', opacity: q < .995 ? 1 : 0 },
        { opacity: Math.max(0, 1 - q * 3).toFixed(3) },
        { opacity: clamp01((q - .95) / .05).toFixed(3) },
        // Свечение, как у блока контактов, разгорается, пока контакты выезжают
        { opacity: clamp01((p - FULL) / (1 - FULL)).toFixed(3) }
      ];
    };
    measure();
    var rebuild = viewTl ? scrollKeys(st, 'zoom', els, at, 400) : null;
    if (!viewTl) st.fns.push(function (p) { applyAt(els, at(p)); });
    var recheck = function () { if (measure()) { if (rebuild) rebuild(); st.p = -1; if (st.on) stageTick(st, window.pageYOffset); } };
    onRebuild(recheck);
    window.addEventListener('load', recheck);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(recheck);
  })();

  // ---------- Лазер на штрихкоде чека ----------
  // Проходит, когда штрихкод целиком на экране (ниже шапки и выше плашки записи внизу), и заново
  // при каждом возвращении к нему. Штрихкод «печатается» после строк чека — лазер ждёт, пока он допечатается.
  // Работает от своего класса, а не от набора эффектов: даже если телефон по ходу перешёл на облегчённый режим
  (function () {
    var bar = $('.receipt__bar'), rc = bar && closest(bar, '.receipt');
    if (!bar || !rc || !fx || !hasIO) return;
    bar.classList.add('can-scan');
    var printed = false, full = false, last = -1e4, timer = 0;
    var isPrinted = function () {
      if (printed) return true;
      if (!rc.classList.contains('in')) return false;
      var t = getComputedStyle(bar).transform;
      printed = t === 'none' || /^matrix\(1, 0, 0, 1,/.test(t);
      return printed;
    };
    var go = function () {
      clearTimeout(timer);
      if (!full) return;
      if (!isPrinted()) { timer = setTimeout(go, 150); return; }
      if (now() - last < 1500) return;
      last = now();
      bar.classList.remove('is-scan');
      void bar.offsetWidth;
      bar.classList.add('is-scan');
    };
    bar.addEventListener('transitionend', function (e) { if (e.target === bar && /transform/.test(e.propertyName)) { printed = true; go(); } });
    watch([bar], function (el, vis, io, en) {
      var r = en ? en.intersectionRatio : 1;
      if (vis && r >= .97) { if (!full) { full = true; go(); } }
      // Ушёл с экрана хотя бы наполовину — при возвращении лазер пройдёт снова
      else if (full && (!vis || r < .5)) { full = false; clearTimeout(timer); }
    }, { threshold: [0, .5, .97, 1], rootMargin: '-64px 0px -18% 0px' });
  })();
})();
