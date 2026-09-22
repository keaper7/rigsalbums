/* RIGSARTHUR SCHOOL ALBUMS — прототип.
   Ноль библиотек: всё на CSS-трансформациях и обычном JS.
   Каждый кусок включается, только если его разметка есть на странице. */
(function () {
  'use strict';

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  /* ---------- меню на телефоне ---------- */
  var burger = document.querySelector('.burger');
  var nav = document.querySelector('.nav');
  if (burger && nav) {
    var narrow = matchMedia('(max-width: 900px)');
    function syncNav() { nav.hidden = narrow.matches; burger.setAttribute('aria-expanded', 'false'); }
    syncNav();
    narrow.addEventListener('change', syncNav);
    burger.addEventListener('click', function () {
      nav.hidden = !nav.hidden;
      burger.setAttribute('aria-expanded', String(!nav.hidden));
    });
  }

  /* ---------- вспышка затвора на переходе между страницами ---------- */
  var flash = document.querySelector('.flash');
  function fire() {
    if (!flash || reduce) return;
    flash.classList.remove('fire');
    void flash.offsetWidth;
    flash.classList.add('fire');
  }
  if (flash && !reduce) {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href[0] === '#' || a.target === '_blank' || /^(https?:|mailto:|tel:)/.test(href)) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      fire();
      setTimeout(function () { location.href = href; }, 170);
    });
  }

  /* ---------- появление секций при прокрутке ---------- */
  var rises = [].slice.call(document.querySelectorAll('.rise'));
  if (rises.length) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    rises.forEach(function (el) { io.observe(el); });
    // страховка: ничего не должно остаться невидимым
    setTimeout(function () {
      rises.forEach(function (el) {
        if (!el.classList.contains('in') && el.getBoundingClientRect().top < innerHeight * 1.3) el.classList.add('in');
      });
    }, 2500);
  }

  /* ---------- фото «проявляются»: ч/б+блюр -> резкость+цвет ----------
     Работает на всех галереях сразу, так как все используют .shot —
     общий компонент. Отдельный наблюдатель от .rise, чтобы каждое фото
     проявлялось своим моментом, а не всей секцией разом. */
  var photos = [].slice.call(document.querySelectorAll('.shot img, .split img, .opt__thumb'));
  if (photos.length) {
    if (reduce) {
      photos.forEach(function (img) { img.classList.add('developed'); });
    } else {
      var pio = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('developed');
          pio.unobserve(e.target);
        });
      }, { threshold: 0.15, rootMargin: '0px 0px -4% 0px' });
      photos.forEach(function (img) {
        if (img.complete) pio.observe(img);
        else img.addEventListener('load', function () { pio.observe(img); }, { once: true });
      });
      // страховка: ничего не должно остаться размытым навсегда
      setTimeout(function () {
        photos.forEach(function (img) {
          if (!img.classList.contains('developed') && img.getBoundingClientRect().top < innerHeight * 1.3) {
            img.classList.add('developed');
          }
        });
      }, 3000);
    }
  }

  /* ---------- первый экран: альбом раскрывается по прокрутке ---------- */
  var stage = document.querySelector('.hero__stage');
  var holder = document.querySelector('.holder');
  var book = document.querySelector('.book');
  if (stage && holder && book) {
    var type = document.querySelector('.hero__type');
    var ticking = false;

    function fit() {
      var s = getComputedStyle(holder).scale;
      var cur = parseFloat(s) || 1;
      var w = book.getBoundingClientRect().width / cur;
      holder.style.setProperty('--s', Math.max(0.45, Math.min(1, (innerWidth * 0.88) / (2 * w))).toFixed(3));
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var r = stage.getBoundingClientRect();
        var travel = r.height - innerHeight;
        if (travel <= 0) return;
        var p = Math.min(1, Math.max(0, -r.top / travel));
        var o = Math.min(1, Math.max(0, (p - 0.14) / 0.56));
        o = o < .5 ? 4 * o * o * o : 1 - Math.pow(-2 * o + 2, 3) / 2;
        holder.style.setProperty('--p', o.toFixed(4));
        if (o > 0.6) book.setAttribute('data-open', ''); else book.removeAttribute('data-open');
        if (type) type.style.opacity = o > 0.12 ? 0 : 1;
      });
    }

    if (reduce) {
      fit();
      holder.style.setProperty('--p', 1);
      book.setAttribute('data-open', '');
    } else {
      addEventListener('scroll', onScroll, { passive: true });
      addEventListener('resize', function () { fit(); onScroll(); });
      fit();
      onScroll();
    }
  }

  /* ---------- лайтбокс галереи ---------- */
  var lb = document.querySelector('.lb');
  if (lb) {
    var lbImg = lb.querySelector('img');
    function openLb(src, alt) {
      lbImg.src = src; lbImg.alt = alt || '';
      lb.hidden = false;
      document.body.style.overflow = 'hidden';
      lb.querySelector('.lb__close').focus();
    }
    function closeLb() {
      lb.hidden = true; lbImg.removeAttribute('src');
      document.body.style.overflow = '';
    }
    document.addEventListener('click', function (e) {
      var s = e.target.closest && e.target.closest('.shot');
      if (s) { openLb(s.dataset.full, s.querySelector('img').alt); return; }
      if (e.target.closest('.lb__close') || e.target === lb) closeLb();
    });
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lb.hidden) closeLb(); });
  }

  /* ---------- голосование на странице класса ---------- */
  var opts = [].slice.call(document.querySelectorAll('.opt'));
  if (opts.length) {
    var after = document.getElementById('voteAfter');
    var reset = document.getElementById('voteReset');
    var base = opts.map(function (o) { return +o.dataset.votes; });
    var mine = null;

    function draw() {
      var total = opts.reduce(function (s, o) { return s + (+o.dataset.votes); }, 0);
      opts.forEach(function (o) {
        var pct = total ? Math.round((+o.dataset.votes) / total * 100) : 0;
        o.querySelector('.opt__bar').style.width = pct + '%';
        o.querySelector('.opt__pct').textContent = mine ? pct + '%' : o.dataset.votes;
        o.disabled = !!mine;
        if (mine === o.dataset.id) o.setAttribute('data-mine', ''); else o.removeAttribute('data-mine');
      });
      if (mine) {
        var m = opts.filter(function (o) { return o.dataset.id === mine; })[0];
        after.innerHTML = 'Твой голос за <b>' + m.querySelector('.opt__name').textContent +
          '</b> учтён. Проголосовать ещё раз нельзя, вот так это и работает.';
        reset.hidden = false;
      } else {
        after.textContent = 'Проголосовало 25 из 28.';
        reset.hidden = true;
      }
    }

    opts.forEach(function (o) {
      o.addEventListener('click', function () {
        if (mine) return;
        mine = o.dataset.id;
        o.dataset.votes = (+o.dataset.votes) + 1;
        fire();
        draw();
      });
    });

    if (reset) reset.addEventListener('click', function () {
      mine = null;
      opts.forEach(function (o, i) { o.dataset.votes = base[i]; });
      draw();
      opts[0].focus();
    });

    draw();
  }

  /* ---------- вкладки (страница класса) ---------- */
  var tabs = [].slice.call(document.querySelectorAll('.tab'));
  if (tabs.length) {
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
        document.querySelectorAll('[data-view]').forEach(function (v) {
          v.hidden = v.dataset.view !== t.dataset.panel;
        });
      });
    });
  }

  /* ---------- честный вес страницы ---------- */
  var meter = document.querySelector('[data-weight]');
  if (meter) {
    addEventListener('load', function () {
      setTimeout(function () {
        var bytes = 0;
        var nav0 = performance.getEntriesByType('navigation')[0];
        if (nav0) bytes += Math.max(nav0.transferSize || 0, nav0.encodedBodySize || 0);
        performance.getEntriesByType('resource').forEach(function (r) {
          bytes += Math.max(r.transferSize || 0, r.encodedBodySize || 0);
        });
        if (bytes > 1024) meter.textContent = Math.round(bytes / 1024) + ' КБ';
      }, 100);
    });
  }
})();
