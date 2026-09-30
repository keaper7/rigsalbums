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

  // Если на деле прокрутка всё равно проседает — переходим на облегчённый набор
  function downgrade() {
    if (!fx) return;
    fx = false;
    root.classList.remove('fx');
    root.classList.add('lite');
  }

  // ---------- Прокрутка: один обработчик на кадр ----------
  var hd = $('.hd');
  var maxY = 1, needMeasure = true, ticking = false, lastY = -1, lastP = -1, scrolled = null;
  var perFrame = [];
  var lastT = 0, slow = 0, fast = 0;
  function measure() { maxY = Math.max(1, root.scrollHeight - window.innerHeight); needMeasure = false; }
  function frame(t) {
    ticking = false;
    t = t || now();
    // Сторож плавности: считаем только кадры непрерывной прокрутки
    if (fx && lastT) {
      var dt = t - lastT;
      if (dt < 40) fast++;
      else if (dt < 260) slow++;
      if (fast + slow >= 90) {
        if (slow / (fast + slow) > .25) downgrade();
        fast = slow = 0;
      }
    }
    lastT = t;
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
  // Прокрутка остановилась — не считаем паузу медленным кадром
  window.addEventListener('scroll', function () { clearTimeout(frame.idle); frame.idle = setTimeout(function () { lastT = 0; }, 180); }, { passive: true });

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
    deck.addEventListener('touchmove', function (e) { dragMove(e.touches[0].clientX, e.touches[0].clientY, e); }, { passive: false });
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
  var ldBoxes = [];
  $$('img').forEach(function (img) {
    if (img.complete && img.naturalWidth) return;
    img.classList.add('ld');
    var box = img.parentNode;
    var done = function () {
      img.classList.remove('ld');
      if (box && box.classList) box.classList.remove('is-ld');
      if (ldIO && box) ldIO.unobserve(box);
    };
    img.addEventListener('load', done);
    img.addEventListener('error', done);
    if (box && LD_BOX.test(box.className)) ldBoxes.push(box);
  });
  var ldIO = !reduce && ldBoxes.length ? watch(ldBoxes, function (box, vis) {
    var img = $('img', box);
    box.classList.toggle('is-ld', vis && !!img && img.classList.contains('ld'));
  }, { rootMargin: '60px 0px' }) : null;

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
        } else if (c.nodeType === 1 && !/^(BR|SMALL|SVG)$/i.test(c.tagName)) walk(c);
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
  var LIVE = '.ticker, .me, .offer__card, .phone, .next';
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
  watch(vids, function (v, vis) {
    if (vis) {
      if (!v.src) v.src = v.getAttribute('data-src');
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    } else if (v.src) v.pause();
  }, { rootMargin: '200px 0px' });

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

  // ---------- Переходы между блоками ----------
  // «Плёнка»: две ленты с кадрами крест-накрест сами едут в разные стороны.
  // «Приближение»: перед контактами слово «ТВОЙ ВЫПУСК» стоит на месте, а прокрутка влетает в букву «О»,
  // пока экран не станет бордовым — и под ним уже бордовый блок контактов. Только transform
  (function () {
    // Плёнка едет сама (CSS-анимация), на паузе, пока её нет на экране
    var film = $('.film');
    if (film) {
      watch([film], function (el, vis) { film.classList.toggle('is-live', vis); }, { rootMargin: '100px 0px' });
      // В ленте набор кадров повторён дважды, сдвиг на половину зацикливает её. На широком экране половины
      // может не хватить на всю ленту — тогда повторяем набор чаще, а время круга растёт так же, чтобы скорость не менялась
      var tracks = $$('.film__track', film).map(function (tr) {
        var n = tr.children.length / 2, one = '';
        for (var i = 0; i < n; i++) one += tr.children[i].outerHTML;
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

    var zoom = $('.zoom');
    if (!zoom) return;
    if (!fx) { zoom.parentNode.removeChild(zoom); return; }
    zoom.classList.add('is-on');
    var word = $('.zoom__word', zoom), o = $('.zoom__o', zoom), sub = $('.zoom__sub', zoom), pin = $('.zoom__pin', zoom);
    var zoomOn = false, lastZ = '', origin = null;
    // Точка приближения — середина левой стенки буквы «О»: в неё и влетаем, пока бордовый не заполнит экран
    var setOrigin = function () {
      word.style.transform = '';
      var w = word.getBoundingClientRect(), b = o.getBoundingClientRect();
      origin = { x: b.left - w.left + b.width * .16, y: b.top - w.top + b.height * .52 };
      word.style.transformOrigin = origin.x.toFixed(1) + 'px ' + origin.y.toFixed(1) + 'px';
      lastZ = '';
    };
    var moveZoom = function () {
      if (!zoomOn) return;
      if (!origin) setOrigin();
      var V = window.innerHeight, r = zoom.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, -r.top / (r.height - V)));
      var k = p.toFixed(4);
      if (k === lastZ) return;
      lastZ = k;
      // Первая половина прокрутки — влёт в букву (к FULL бордовый закрывает экран),
      // во второй по этому бордовому снизу выезжает блок контактов
      // Контакты начинают выезжать ещё до того, как бордовый закрыл экран, — пустой бордовой паузы нет
      var FULL = .62, q = Math.min(1, p / FULL), e = q * q * q;
      word.style.transform = 'scale(' + (1 + e * 90).toFixed(3) + ')';
      sub.style.opacity = Math.max(0, 1 - q * 3).toFixed(3);
      pin.classList.toggle('is-full', q >= 1);
      // Свечение, как у блока контактов, разгорается постепенно, пока контакты выезжают
      pin.style.setProperty('--glow', Math.min(1, Math.max(0, (p - FULL) / (1 - FULL))).toFixed(3));
    };
    watch([zoom], function (el, vis) { zoomOn = vis; moveZoom(); }, { rootMargin: '100px 0px' });
    perFrame.push(moveZoom);
    window.addEventListener('resize', function () { origin = null; moveZoom(); });
  })();

  // ---------- Переходы, которые двигает сам браузер ----------
  // Если скрипт двигает переход после каждого сдвига прокрутки, он всегда отстаёт от страницы на кадр —
  // на телефоне и в Safari это видно как подёргивание. Поэтому там, где браузер умеет анимацию,
  // привязанную к прокрутке (view-timeline), мы один раз заранее считаем весь переход по шагам
  // в обычные @keyframes, а двигает их сам браузер в том же кадре, что и страницу.
  // Где не умеет — те же расчёты ставит скрипт каждый кадр.
  // at(p) для p от 0 до 1 возвращает для каждого элемента { transform, opacity };
  // p = 0 — верх перехода у верха экрана, p = 1 — низ перехода у низа экрана (диапазон contain)
  // Все длины в переходах — в единицах экрана (dvh — высота видимой части, vw — ширина), а не в пикселях:
  // на телефоне панель браузера при прокрутке прячется и появляется, и высота экрана меняется — браузер
  // сам пересчитает такие длины, а пересчитывать переходы заново не нужно. Поэтому и прилипающие экраны
  // переходов в CSS высотой 100dvh.
  var viewTl = fx && supports('animation-timeline', 'view()') && supports('view-timeline', '--a block');
  var DVH = supports('height', '1dvh') ? 'dvh' : 'vh';
  // px пикселей + h высот экрана + w ширин экрана
  function len(px, h, w) {
    var out = (px || 0).toFixed(1) + 'px';
    if (h) out += ' + ' + (h * 100).toFixed(3) + DVH;
    if (w) out += ' + ' + (w * 100).toFixed(3) + 'vw';
    return h || w ? 'calc(' + out + ')' : out;
  }
  // Считаем все переходы сразу после загрузки, по одному, в свободные паузы браузера — пока человек смотрит
  // первый экран. Посреди прокрутки считать нельзя: на слабом телефоне это проседание кадра (было после принтера).
  // Если человек долистал до перехода раньше (например, по ссылке) — считаем сразу, за полэкрана до него
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
  var keyIO = viewTl && hasIO ? new IntersectionObserver(function (ents) {
    ents.forEach(function (en) { var it = en.target.__keys; if (en.isIntersecting && it && it.dirty) it.build(); });
  }, { rootMargin: '50% 0px' }) : null;
  function scrollKeys(box, name, els, at, steps) {
    var sheet = null, bound = false;
    box.style.setProperty('view-timeline', '--' + name + ' block');
    // Иначе браузер отсчитывает прокрутку с учётом отступа под шапку (scroll-padding) и переход опережает расчёт
    box.style.setProperty('view-timeline-inset', '0px');
    var it = { dirty: true };
    it.build = function () {
      it.dirty = false;
      var frames = els.map(function () { return []; });
      for (var i = 0; i <= steps; i++) {
        var v = at(i / steps), pct = (i * 100 / steps).toFixed(3) + '%';
        for (var j = 0; j < els.length; j++) {
          var st = v[j], css = '';
          if (st.transform != null) css += 'transform:' + st.transform + ';';
          if (st.opacity != null) css += 'opacity:' + st.opacity + ';';
          if (st.radius != null) css += 'border-radius:' + st.radius + ';';
          frames[j].push(pct + '{' + css + '}');
        }
      }
      if (!sheet) { sheet = document.createElement('style'); document.head.appendChild(sheet); }
      sheet.textContent = frames.map(function (f, j) { return '@keyframes ' + name + '-' + j + '{' + f.join('') + '}'; }).join('\n');
      if (bound) return;
      bound = true;
      els.forEach(function (el, j) {
        el.style.animation = name + '-' + j + ' linear both';
        el.style.setProperty('animation-duration', 'auto');
        el.style.setProperty('animation-timeline', '--' + name);
        el.style.setProperty('animation-range', 'contain 0% contain 100%');
      });
    };
    box.__keys = it;
    if (keyIO) { keyIO.observe(box); keyQueue.push(it); } else it.build();
    // Пересчёт (сменилась ширина экрана или раскладка): сразу — если переход рядом, иначе — когда до него дойдут
    return function () {
      it.dirty = true;
      var r = box.getBoundingClientRect(), V = window.innerHeight;
      if (!keyIO || (r.bottom > -1.5 * V && r.top < 2.5 * V)) it.build();
      else if (keyQueue.indexOf(it) < 0) { keyQueue.push(it); keyStart(); }
    };
  }
  // Где анимацию ведёт скрипт: тот же расчёт, поставленный прямо сейчас
  function applyAt(els, v) {
    for (var j = 0; j < els.length; j++) {
      if (v[j].transform != null) els[j].style.transform = v[j].transform;
      if (v[j].opacity != null) els[j].style.opacity = v[j].opacity;
      if (v[j].radius != null) els[j].style.borderRadius = v[j].radius;
    }
  }
  function progressOf(box) {
    var V = window.innerHeight, r = box.getBoundingClientRect();
    return Math.min(1, Math.max(0, -r.top / (r.height - V)));
  }
  var ease2 = function (t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  // Пересчитать переходы, когда сменилась ширина экрана (поворот, окно компьютера) или высота — сильнее,
  // чем прячется панель браузера на телефоне. От панели ничего не пересчитываем: длины и так в единицах экрана
  var rebuilds = [], rebuildW = window.innerWidth, rebuildH = window.innerHeight;
  function onRebuild(fn) { rebuilds.push(fn); }
  function rebuildAll() {
    var w = window.innerWidth, h = window.innerHeight;
    if (w === rebuildW && Math.abs(h - rebuildH) < 160) return;
    rebuildW = w; rebuildH = h;
    rebuilds.forEach(function (fn) { fn(); });
  }
  window.addEventListener('resize', function () { raf(rebuildAll); });

  // ---------- «Затвор между блоками» ----------
  // Блок-переход наезжает на последний экран предыдущего блока и на первый экран следующего.
  // Пока он прилип к экрану, прокрутка закрывает лепестки поверх уходящего блока, на полпути — щелчок со вспышкой,
  // и лепестки раскрываются уже на следующем блоке
  (function () {
    var box = $('.tshut');
    if (!box) return;
    if (!fx) { box.parentNode.removeChild(box); return; }
    box.classList.add('is-on');
    var iris = $('.tshut__iris', box), blades = $$('.tshut__iris i', box), mark = $('.tshut__mark', box), flash = $('.tshut__flash', box);
    var els = blades.concat([iris, mark]);
    var at = function (p) {
      // open: 1 — лепестки ушли за край экрана, 0 — закрыты
      var open = p < .42 ? 1 - ease2(p / .42) : p > .58 ? ease2((p - .58) / .42) : 0;
      // Лепестки свёрстаны маленькими (40vmax) и растянуты в 4 раза: сплошной цвет от этого не мылится,
      // а браузеру рисовать в 16 раз меньше, чем лепесток в полный размер
      var d = 'calc(' + (open * 120).toFixed(3) + 'vmax - ' + (3 * (1 - open)).toFixed(2) + 'px)';
      var v = blades.map(function (b, i) { return { transform: 'rotate(' + (i * 60) + 'deg) translate3d(' + d + ',0,0) scale(4)' }; });
      v.push({ transform: 'rotate(' + (-40 * (1 - open)).toFixed(2) + 'deg)' });
      v.push({ opacity: Math.max(0, 1 - open * 6).toFixed(3) });
      return v;
    };
    if (viewTl) onRebuild(scrollKeys(box, 'tshut', els, at, 120));
    var on = false, last = -1, shot = false;
    var move = function () {
      if (!on) return;
      var p = progressOf(box);
      if (p === last) return;
      last = p;
      if (!viewTl) applyAt(els, at(p));
      // Щелчок со вспышкой — один раз за проход через закрытый затвор
      var closed = p > .46 && p < .54;
      if (closed && !shot) { shot = true; flash.classList.remove('is-go'); void flash.offsetWidth; flash.classList.add('is-go'); }
      if (!closed && (p < .3 || p > .7)) shot = false;
    };
    watch([box], function (el, vis) { on = vis; last = -1; move(); }, { rootMargin: '100px 0px' });
    perFrame.push(move);
    onRebuild(function () { last = -1; move(); });
  })();

  // ---------- «Фото из принтера» ----------
  // Перед галереей снизу поднимается фотопринтер и печатает первый снимок галереи: он выходит вверх,
  // проявляется из тёмного, выскакивает и перелетает точно на своё место в сетке
  (function () {
    var box = $('.print');
    if (!box) return;
    var gal = box.nextElementSibling, tile = gal && $('.pics > .pic', gal), src = tile && $('img', tile);
    if (!fx || !src) { box.parentNode.removeChild(box); return; }
    box.classList.add('is-on');
    var photo = $('.print__photo', box), img = $('img', photo), paper = $('.print__paper', photo), dev = $('.print__dev', photo);
    var pbox = $('.print__box', box), lcd = $('.print__lcd', box), fill = $('.print__fill', box), thumb = $('.print__thumb', box);
    img.src = thumb.src = src.currentSrc || src.src;
    var els = [pbox, photo, paper, dev, img, fill];
    var g = null;
    // Размер снимка (тех же пропорций, что плитка) и место плитки внутри галереи — по раскладке, в пикселях.
    // Всё, что зависит от высоты экрана, дальше считается в единицах экрана
    var measure = function () {
      var W = window.innerWidth, V = window.innerHeight, tr = tile.getBoundingClientRect(), gr = gal.getBoundingClientRect();
      var ratio = tr.width ? tr.height / tr.width : 1.5;
      var w = Math.min(Math.max(180, W * .6), 300, V * .46 / ratio), h = w * ratio;
      var old = g;
      g = { W: W, w: w, h: h, slot: 'max(58' + DVH + ', ' + (60 + h + 90).toFixed(1) + 'px)',
            tl: tr.left, tw: tr.width, th: tr.height, off: tr.top - gr.top, rad: parseFloat(getComputedStyle(tile).borderTopLeftRadius) || 14 };
      box.style.setProperty('--pw', w.toFixed(1) + 'px');
      box.style.setProperty('--ph', h.toFixed(1) + 'px');
      box.style.setProperty('--slot', g.slot);
      return !old || ['w', 'tl', 'tw', 'th', 'off'].some(function (k) { return Math.abs(old[k] - g[k]) > .5; });
    };
    var at = function (p) {
      // Принтер стоит на нижнем краю экрана; когда снимок готов — уезжает вниз за край
      var out = ease2(clamp01((p - .46) / .16));
      var fed = ease2(clamp01((p - .04) / .4));
      // Готовый снимок выскакивает с наклоном и летит в свою плитку
      // Полёт заканчивается к p = .9: дальше снимок стоит точно на плитке, и только тогда меняется на неё
      var pop = ease2(clamp01((p - .44) / .06)), q = ease2(clamp01((p - .5) / .4));
      var y = 12 - (g.h + 66) * fed - pop * 18;
      var tx = (g.tl + g.tw / 2 - g.W / 2) * q + Math.sin(Math.PI * q) * 24;
      // Верх галереи на экране = (1 − p) · (300vh − экран): переход высотой 300vh, галерея заходит на его последний экран.
      // Центр снимка без сдвига = щель + 11px + полснимка. Сдвиг к центру плитки — доля q пути
      var A = y * (1 - q) + q * (g.off + g.th / 2 - 11 - g.h / 2);
      var ty = 'calc(' + A.toFixed(1) + 'px + ' + (q * (1 - p) * 300).toFixed(3) + 'vh - ' + (q * (1 - p) * 100).toFixed(3) + DVH + ' - ' + g.slot + ' * ' + q.toFixed(4) + ')';
      var k = g.tw / g.w, sc = 1 + (k - 1) * q, rot = 3 * pop * (1 - q) - Math.sin(Math.PI * q) * 2;
      // Углы снимка к концу скругляются, как у плитки (снимок уменьшен в k раз, поэтому радиус делим на k)
      var rad = 1 + (g.rad / k - 1) * ease2(clamp01((q - .55) / .45));
      // Снимок уже сел и совпадает с плиткой — растворяется в ней. Пока он летел, плитка не показывалась,
      // иначе было видно два фото сразу (одно ещё не долетело)
      var swap = clamp01((p - .91) / .06);
      return [
        { transform: 'translate3d(0,calc((100' + DVH + ' - ' + g.slot + ' + 60px) * ' + out.toFixed(4) + '),0)' },
        { transform: 'translate3d(' + tx.toFixed(1) + 'px,' + ty + ',0) rotate(' + rot.toFixed(2) + 'deg) scale(' + sc.toFixed(4) + ')', opacity: (1 - swap).toFixed(3) },
        { opacity: (1 - clamp01((p - .66) / .2)).toFixed(3) },
        { opacity: (1 - clamp01((p - .12) / .42)).toFixed(3) },
        { radius: rad.toFixed(2) + 'px' },
        { transform: 'scaleX(' + fed.toFixed(4) + ')' }
      ];
    };
    measure();
    var rebuild = viewTl ? scrollKeys(box, 'print', els, at, 160) : null;
    var on = false, last = -1, lastLcd = '';
    var move = function () {
      if (!on) return;
      var p = progressOf(box);
      if (p === last) return;
      last = p;
      if (!viewTl) applyAt(els, at(p));
      var fed = ease2(clamp01((p - .04) / .4));
      box.classList.toggle('is-busy', p > .03 && p < .44);
      var text = fed >= 1 ? 'ГОТОВО ✓' : 'ПЕЧАТЬ ' + Math.round(fed * 100) + '%';
      if (text !== lastLcd) { lastLcd = text; lcd.textContent = text; }
      tile.style.opacity = p > 0 && p < 1 ? clamp01((p - .91) / .06).toFixed(3) : '';
    };
    // Раскладка страницы могла сдвинуться (шрифты, картинки) — пересчитываем, если плитка уехала
    var recheck = function () {
      if (measure() && rebuild) rebuild();
      last = -1; move();
    };
    watch([box], function (el, vis) {
      on = vis; last = -1;
      if (vis) recheck(); else tile.style.opacity = '';
    }, { rootMargin: '100px 0px' });
    perFrame.push(move);
    onRebuild(function () { measure(); if (rebuild) rebuild(); last = -1; move(); });
    window.addEventListener('load', recheck);
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

  // ---------- «Фото на стол» ----------
  // После галереи снимки из «Работ» один за другим падают сверху, кувыркаются и рассыпаются по экрану,
  // как фотографии на столе. Потом разлетаются в стороны, и за ними уже следующий блок
  (function () {
    var box = $('.desk');
    if (!box) return;
    // Снимки вставляет сервер: фото из «Работ», которых нет ни в галерее над переходом, ни на плёнке
    var cards = $$('.desk__ph', box), bg = $('.desk__bg', box);
    if (!fx || cards.length < 4) { box.parentNode.removeChild(box); return; }
    box.classList.add('is-on');
    // Где снимок ложится: сдвиг от центра в долях ширины и высоты экрана и наклон
    var SPOT = [[-.2, -.2, -9], [.2, -.24, 7], [-.03, -.02, 3], [-.24, .17, -6], [.23, .12, 10], [.02, .26, -7], [.1, -.08, -3]];
    var backOut = function (t) { var c = 1.3; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
    var els = [bg].concat(cards);
    var at = function (p) {
      var v = [{ opacity: (clamp01((p - .16) / .2) * (1 - clamp01((p - .66) / .18))).toFixed(3) }];
      cards.forEach(function (c, i) {
        var sp = SPOT[i % SPOT.length], dir = sp[0] < 0 ? -1 : 1;
        // Падение: каждый следующий чуть позже, с лёгким «шлепком» в конце
        var fall = clamp01((p - (.03 + i * .05)) / .2), f = backOut(fall);
        // Сверху из-за экрана (в долях высоты экрана и пикселях) — в своё место на столе
        var tyH = -.75 + (sp[1] + .75) * f, tyPx = -260 * (1 - f), txW = sp[0] * (.6 + .4 * f);
        var rot = sp[2] + (1 - fall) * (i % 2 ? 50 : -50), sc = 1.18 - .18 * fall;
        // Разлёт: в свою сторону, чуть вверх и с поворотом
        var go = clamp01((p - (.56 + i * .03)) / .22);
        go = go * go * go;
        txW += go * dir * .95;
        tyH -= go * .22;
        rot += go * dir * 40;
        return v.push({ transform: 'translate3d(' + len(0, 0, txW) + ',' + len(tyPx, tyH) + ',0) rotate(' + rot.toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')' });
      });
      return v;
    };
    if (viewTl) onRebuild(scrollKeys(box, 'desk', els, at, 160));
    var on = false, last = -1;
    var move = function () {
      if (!on || viewTl) return;
      var p = progressOf(box);
      if (p === last) return;
      last = p;
      applyAt(els, at(p));
    };
    watch([box], function (el, vis) { on = vis; last = -1; move(); }, { rootMargin: '100px 0px' });
    perFrame.push(move);
    onRebuild(function () { last = -1; move(); });
  })();

  // ---------- «Видоискатель» ----------
  // Перед студией экран становится видоискателем: слетаются уголки кадра, прорисовывается сетка,
  // квадрат фокуса ищет резкость и загорается зелёным, шкала экспозиции подбирает свет.
  // Потом кадр «снят»: сжимается в превью и уходит в угол, а за ним уже студия
  (function () {
    var box = $('.vf');
    if (!box) return;
    if (!fx) { box.parentNode.removeChild(box); return; }
    box.classList.add('is-on');
    var q = function (sel) { return $(sel, box); };
    var corners = $$('.vf__c', box), grid = $$('.vf__g', box), afs = $$('.vf__af', box);
    var els = [q('.vf__dim'), q('.vf__frame')].concat(corners, grid, afs, [q('.vf__top'), q('.vf__bot'), q('.vf__ev i')]);
    var cnt = q('.vf__cnt');
    // Ломаная по точкам [p, значение] — для «поиска» фокуса
    var path = function (pts, p) {
      if (p <= pts[0][0]) return pts[0][1];
      for (var i = 1; i < pts.length; i++) {
        if (p <= pts[i][0]) {
          var t = ease2((p - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
          return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
        }
      }
      return pts[pts.length - 1][1];
    };
    var at = function (p) {
      var inP = ease2(clamp01(p / .3)), k = 1 - inP;
      var shot = ease2(clamp01((p - .6) / .2)), gone = clamp01((p - .72) / .1);
      var v = [];
      v.push({ opacity: (.58 * inP * (1 - clamp01((p - .7) / .2))).toFixed(3) });
      // Кадр снят: сжимается к левому нижнему углу и гаснет
      v.push({ transform: 'scale(' + (1 - .8 * shot).toFixed(4) + ')', opacity: (inP * (1 - gone)).toFixed(3) });
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
        v.push({ transform: 'translate3d(' + len(0, 0, d[0] * .42 * k) + ',' + len(0, d[1] * .38 * k) + ',0)' });
      });
      var gv = ease2(clamp01((p - .1) / .2)), gh = ease2(clamp01((p - .15) / .2));
      v.push({ transform: 'scaleY(' + gv.toFixed(3) + ')' }, { transform: 'scaleY(' + gv.toFixed(3) + ')' });
      v.push({ transform: 'scaleX(' + gh.toFixed(3) + ')' }, { transform: 'scaleX(' + gh.toFixed(3) + ')' });
      // Фокус: большой квадрат сжимается, промахивается, возвращается и замирает
      var s = path([[.18, 2.6], [.32, .78], [.4, 1.22], [.47, .94], [.52, 1]], p);
      var x = path([[.18, 0], [.3, -.06], [.38, .05], [.46, -.015], [.52, 0]], p);
      var y = path([[.18, 0], [.3, .03], [.38, -.02], [.52, 0]], p);
      var af = 'translate3d(' + len(0, 0, x) + ',' + len(0, y) + ',0) scale(' + s.toFixed(3) + ')';
      var ok = clamp01((p - .5) / .03), pulse = 1 + .14 * Math.sin(Math.PI * clamp01((p - .5) / .08));
      v.push({ transform: af, opacity: (clamp01((p - .12) / .1) * (1 - ok)).toFixed(3) });
      v.push({ transform: 'scale(' + pulse.toFixed(3) + ')', opacity: ok.toFixed(3) });
      var hud = ease2(clamp01((p - .12) / .18));
      v.push({ transform: 'translate3d(0,' + (-(1 - hud) * 24).toFixed(1) + 'px,0)', opacity: hud.toFixed(3) });
      v.push({ transform: 'translate3d(0,' + ((1 - hud) * 24).toFixed(1) + 'px,0)', opacity: hud.toFixed(3) });
      // Шкала экспозиции качается влево-вправо и встаёт по центру, когда фокус пойман
      var ev = Math.sin(Math.PI * 1.5 * clamp01((p - .12) / .38)) * 48 * (1 - clamp01((p - .44) / .08));
      v.push({ transform: 'translate3d(' + ev.toFixed(1) + 'px,0,0)' });
      return v;
    };
    if (viewTl) onRebuild(scrollKeys(box, 'vf', els, at, 180));
    var on = false, last = -1, lastCnt = '';
    var move = function () {
      if (!on) return;
      var p = progressOf(box);
      if (p === last) return;
      last = p;
      if (!viewTl) applyAt(els, at(p));
      // Счётчик оставшихся кадров уменьшается, когда кадр снят
      var c = p >= .56 ? '247' : '248';
      if (c !== lastCnt) { lastCnt = c; cnt.textContent = c; }
    };
    watch([box], function (el, vis) { on = vis; last = -1; move(); }, { rootMargin: '100px 0px' });
    perFrame.push(move);
    onRebuild(function () { last = -1; move(); });
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

  // ---------- «Хлопушка» ----------
  // После первого экрана, перед видео «Вживую»: экран темнеет, снизу выезжает киношная хлопушка, планка поднимается,
  // резко хлопает, доска вздрагивает и улетает — «мотор». Тёмный фон уезжает вверх вместе с приходом ленты и «Вживую»
  (function () {
    var box = $('.clap');
    if (!box) return;
    if (!fx) { box.parentNode.removeChild(box); return; }
    box.classList.add('is-on');
    var bg = $('.clap__bg', box), board = $('.clap__board', box), stick = $('.clap__stick', box);
    var els = [bg, board, stick];
    var at = function (p) {
      // Низ тёмного фона — это верх следующего блока: фон уезжает вместе с ним, а не гаснет.
      // Верх следующего блока = низ перехода (250vh) минус экран, а низ перехода при p поднимается на p · (250vh − экран)
      var lift = 'min(0px, calc(' + ((1 - p) * 250).toFixed(3) + 'vh - ' + ((2 - p) * 100).toFixed(3) + DVH + '))';
      var inP = ease2(clamp01((p - .02) / .2)), open = ease2(clamp01((p - .12) / .14));
      // Хлопок: планка падает с разгоном, чуть отскакивает, доска вздрагивает
      var snap = clamp01((p - .4) / .035); snap = snap * snap;
      var bounce = Math.sin(Math.PI * clamp01((p - .435) / .05)) * 4;
      var angle = -32 * open * (1 - snap) - bounce;
      var shake = clamp01((p - .435) / .09), sh = shake > 0 ? Math.sin(shake * 60) * 10 * (1 - shake) : 0;
      var out = ease2(clamp01((p - .54) / .16));
      var yH = (1 - inP) * .9 - out * 1.1, rot = (1 - inP) * -8 - out * 10 + sh * .3;
      return [
        { transform: 'translate3d(0,' + lift + ',0)', opacity: (ease2(clamp01(p / .14)) * .96).toFixed(3) },
        { transform: 'translate3d(' + sh.toFixed(1) + 'px,' + len(0, yH) + ',0) rotate(' + rot.toFixed(2) + 'deg) scale(' + (1 - out * .1).toFixed(3) + ')' },
        { transform: 'rotate(' + angle.toFixed(2) + 'deg)' }
      ];
    };
    if (viewTl) onRebuild(scrollKeys(box, 'clap', els, at, 200));
    var on = false, last = -1;
    var move = function () {
      if (!on || viewTl) return;
      var p = progressOf(box);
      if (p === last) return;
      last = p;
      applyAt(els, at(p));
    };
    watch([box], function (el, vis) { on = vis; last = -1; move(); }, { rootMargin: '100px 0px' });
    perFrame.push(move);
    onRebuild(function () { last = -1; move(); });
  })();

  // ---------- Лазер на штрихкоде чека ----------
  // Проходит, как только штрихкод целиком показался на экране (выше плашки записи внизу), и заново при каждом возвращении к нему
  (function () {
    var bar = $('.receipt__bar');
    if (!bar || !fx) return;
    var full = false, timer = 0;
    // Штрихкод «печатается» после строк чека — лазер ждёт, пока он допечатается целиком
    var ready = function () {
      var t = getComputedStyle(bar).transform;
      return !!bar.closest('.receipt.in') && (t === 'none' || /^matrix\(1, 0, 0, 1,/.test(t));
    };
    var go = function () {
      clearTimeout(timer);
      if (!full) return;
      if (ready()) bar.classList.add('is-scan'); else timer = setTimeout(go, 150);
    };
    watch([bar], function (el, vis, io, en) {
      var was = full;
      full = vis && (!en || en.intersectionRatio >= .9);
      if (full && !was) go();
      if (!vis) { clearTimeout(timer); bar.classList.remove('is-scan'); }
      // Нижние 20% экрана не считаем: на телефоне там плашка «Запись на съёмку»
    }, { threshold: [0, .9, 1], rootMargin: '0px 0px -20% 0px' });
  })();
})();
