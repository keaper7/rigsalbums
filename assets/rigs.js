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
    var k = 1, busy = false;
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
    var next = function () {
      if (busy) return;
      busy = true;
      var first = cards[order.shift()];
      order.push(cards.indexOf(first));
      order.forEach(function (ci, pos) { if (cards[ci] !== first) place(cards[ci], POS[Math.min(pos, POS.length - 1)], cards.length - pos); });
      first.classList.add('is-flying');
      place(first, { x: -300, y: -30, r: -24, s: 1 }, cards.length + 1);
      setLabel();
      setTimeout(function () {
        first.classList.remove('is-flying');
        place(first, POS[POS.length - 1], 0);
        busy = false;
      }, 480);
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
      timer = setInterval(function () { if (deckVisible && !document.hidden) next(); }, 3200);
    };
    deck.addEventListener('click', function () { next(); auto(); });
    deck.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); auto(); }
    });
    var dx0 = null;
    deck.addEventListener('touchstart', function (e) { dx0 = e.touches[0].clientX; }, { passive: true });
    deck.addEventListener('touchend', function (e) {
      if (dx0 === null) return;
      var dx = e.changedTouches[0].clientX - dx0; dx0 = null;
      if (Math.abs(dx) > 40) { e.preventDefault(); next(); auto(); }
    });
    watch([deck], function (el, vis) { deckVisible = vis; });
    setTimeout(auto, 1600);
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
    img.classList.add('ld');
    var done = function () { img.classList.remove('ld'); };
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

  // Появление блоков
  watch($$('.rv'), function (el, vis, io) {
    if (vis) { el.classList.add('in'); if (io) io.unobserve(el); }
  }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });

  // Видео: подгружаются рядом с экраном и играют без звука, пока видны
  var vids = $$('.clip video').filter(function (v) { return v.getAttribute('data-src'); });
  vids.forEach(function (v) { v.parentNode.classList.add('has-video'); });
  watch(vids, function (v, vis) {
    if (vis) {
      if (!v.src) v.src = v.getAttribute('data-src');
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    } else if (v.src) v.pause();
  }, { rootMargin: '200px 0px' });

  // Просмотр фото на весь экран
  var lb = $('.lb');
  if (lb) {
    var lbImg = $('img', lb), lbCap = $('figcaption', lb), lbList = [], lbI = 0;
    var show = function () {
      var a = lbList[lbI];
      lbImg.src = a.getAttribute('href');
      lbCap.textContent = a.getAttribute('data-cap') || '';
      $('.lb__count', lb).textContent = (lbI + 1) + ' / ' + lbList.length;
      $('.lb__prev', lb).style.visibility = lbI > 0 ? '' : 'hidden';
      $('.lb__next', lb).style.visibility = lbI < lbList.length - 1 ? '' : 'hidden';
    };
    var go = function (d) { var n = lbI + d; if (n >= 0 && n < lbList.length) { lbI = n; show(); } };
    var close = function () { lb.hidden = true; lbImg.src = ''; root.style.overflow = ''; };
    document.addEventListener('click', function (e) {
      var a = closest(e.target, '[data-lb]');
      if (!a) return;
      e.preventDefault();
      lbList = $$('[data-lb="' + a.getAttribute('data-lb') + '"]');
      lbI = lbList.indexOf(a);
      show();
      lb.hidden = false;
      root.style.overflow = 'hidden';
    });
    lb.addEventListener('click', function (e) {
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
    var lx = null;
    lb.addEventListener('touchstart', function (e) { lx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      if (lx === null) return;
      var dx = e.changedTouches[0].clientX - lx; lx = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    });
  }
})();
