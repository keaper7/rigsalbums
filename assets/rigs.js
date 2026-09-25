(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if ((el.matches || el.msMatchesSelector || el.webkitMatchesSelector).call(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }
  function watch(els, cb, opts) {
    if (!els.length) return null;
    if (!hasIO) { els.forEach(function (el) { cb(el, true); }); return null; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { cb(en.target, en.isIntersecting, io); });
    }, opts);
    els.forEach(function (el) { io.observe(el); });
    return io;
  }

  // Шапка
  var hd = $('.hd');
  function onScroll() {
    var y = window.pageYOffset, max = document.documentElement.scrollHeight - window.innerHeight;
    hd.classList.toggle('is-scrolled', y > 8);
    hd.style.setProperty('--p', max > 0 ? Math.min(1, y / max).toFixed(4) : 0);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Плавающая кнопка записи: после первого экрана и до финального блока
  var dock = $('.dock');
  var heroEl = $('.hero, .ph');
  var endEl = $('#end');
  function dockUpd() {
    if (!dock) return;
    var h = window.innerHeight;
    var show = heroEl && heroEl.getBoundingClientRect().bottom < h * 0.25 && (!endEl || endEl.getBoundingClientRect().top > h * 0.85);
    dock.classList.toggle('is-on', !!show && !body.classList.contains('menu-open'));
  }
  window.addEventListener('scroll', dockUpd, { passive: true });
  dockUpd();

  // Меню
  var menuBtn = $('.hd__menu');
  var menu = $('#menu');
  function setMenu(open) {
    if (open) menu.style.paddingTop = (hd.getBoundingClientRect().bottom + 20) + 'px';
    body.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    var lbl = $('span', menuBtn);
    if (lbl) lbl.textContent = open ? 'Закрыть' : 'Меню';
    root.style.overflow = open ? 'hidden' : '';
    dockUpd();
  }
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', function () { setMenu(!body.classList.contains('menu-open')); });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }

  // Колода обложек на главной
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

  // Счётчики
  var counters = $$('[data-count]');
  if (counters.length && !reduce) {
    var fmt = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '+'; };
    counters.forEach(function (el) { el.textContent = fmt(0); });
    watch(counters, function (el, vis, io) {
      if (!vis) return;
      if (io) io.unobserve(el);
      var to = +el.getAttribute('data-count'), t0 = Date.now();
      setTimeout(function tick() {
        var p = Math.min(1, (Date.now() - t0 - 400) / 1400);
        if (p < 0) p = 0;
        el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) setTimeout(tick, 30);
      }, 30);
    }, { threshold: .6 });
  }

  // Картинки проявляются по мере загрузки
  $$('img').forEach(function (img) {
    if (img.complete && img.naturalWidth) return;
    var box = img.parentNode;
    img.classList.add('ld');
    if (box && box.classList) box.classList.add('is-ld');
    var done = function () {
      img.classList.remove('ld');
      if (box && box.classList) box.classList.remove('is-ld');
    };
    img.addEventListener('load', done);
    img.addEventListener('error', done);
  });

  // Липкая строка тематик подсвечивает ту, что сейчас на экране
  var jb = $('.jumpbar__in');
  if (jb) {
    var chips = {};
    $$('a', jb).forEach(function (a) { chips[a.getAttribute('href').slice(1)] = a; });
    watch($$('.tcard'), function (el, vis) {
      if (!vis) return;
      var a = chips[el.id];
      if (!a || a.classList.contains('is-on')) return;
      $$('a', jb).forEach(function (x) { x.classList.toggle('is-on', x === a); });
      var left = a.offsetLeft - 18;
      if (jb.scrollTo) { try { jb.scrollTo({ left: left, behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { jb.scrollLeft = left; } }
      else jb.scrollLeft = left;
    }, { rootMargin: '-45% 0px -50% 0px' });
  }

  // Появление блоков. Внутри [data-stagger] элементы выезжают по очереди
  $$('[data-stagger]').forEach(function (box) {
    for (var i = 0; i < box.children.length; i++) box.children[i].style.setProperty('--i', Math.min(i, 9));
  });
  watch($$('.rv'), function (el, vis, io) {
    if (vis) { el.classList.add('in'); if (io) io.unobserve(el); }
  }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
  // Галереи бывают выше экрана: для них хватает, чтобы показался край
  watch($$('[data-stagger]'), function (el, vis, io) {
    if (vis) { el.classList.add('in'); if (io) io.unobserve(el); }
  }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });

  // Карточки «Альбом собирают сами ребята»: та, на которую наезжает следующая, уходит вглубь
  var perks = $$('.perk');
  if (perks.length > 1 && !reduce && 'CSS' in window && CSS.supports && CSS.supports('--k', '0')) {
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    var ticking = false;
    var depth = function () {
      ticking = false;
      for (var i = 0; i < perks.length - 1; i++) {
        var a = perks[i].getBoundingClientRect(), b = perks[i + 1].getBoundingClientRect();
        var cover = Math.min(1, Math.max(0, (a.bottom - b.top) / a.height));
        perks[i].style.setProperty('--k', cover.toFixed(3));
      }
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(depth); } }, { passive: true });
    depth();
  }

  // Видео: подгружаются рядом с экраном и играют без звука, пока видны
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

  // Просмотр фото на весь экран: плавно открывается, листается пальцем,
  // закрывается жестом вниз и кнопкой «Назад» на телефоне
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
})();
