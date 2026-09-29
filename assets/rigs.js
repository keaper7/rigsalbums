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
    var show = function () {
      var a = lbList[lbI];
      var href = a.getAttribute('href');
      lb.classList.add('is-loading');
      lbImg.onload = lbImg.onerror = function () { lb.classList.remove('is-loading'); };
      lbImg.src = href;
      if (lbImg.complete && lbImg.naturalWidth) lb.classList.remove('is-loading');
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
    var open = function (a) {
      lbList = $$('[data-lb="' + a.getAttribute('data-lb') + '"]');
      lbI = lbList.indexOf(a);
      show();
      lb.hidden = false;
      root.style.overflow = 'hidden';
      void lb.offsetWidth;
      lb.classList.add('is-open');
      if (window.history && history.pushState) { history.pushState({ lb: 1 }, ''); pushed = true; }
    };
    var close = function (fromHistory) {
      if (lb.hidden) return;
      lb.classList.remove('is-open');
      root.style.overflow = '';
      setTimeout(function () { if (!lb.classList.contains('is-open')) { lb.hidden = true; lbImg.src = ''; } }, reduce ? 0 : 260);
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
})();
