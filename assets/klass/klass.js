(function () {
  'use strict';

  var STEPS = ['theme', 'wear', 'color'];
  // В макете: вымышленные голоса, чтобы были видны проценты. На сайте придут с сервера.
  var SEED = {
    theme: { classic: 3, siren: 2, american: 4, canon: 1, white: 2, grey: 1, aesthetic: 2, money: 6, neon: 1 },
    wear: { oldmoney: 9, classicwear: 7, casual: 4, urban: 2 },
    color: { bw: 5, red: 10, blue: 4, beige: 3 }
  };
  var COOKIE = 'rigs_demo_votes';
  var DURATION = 45 * 60 * 1000;

  var body = document.body;
  var bar = document.querySelector('.bar');
  var barName = bar.querySelector('.bar__name');
  var picks = {};
  var barStep = null;
  var votes = readVotes();
  var closedByDemo = null;

  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if ((el.matches || el.msMatchesSelector || el.webkitMatchesSelector).call(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function readVotes() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    if (!m) return {};
    try { return JSON.parse(decodeURIComponent(m[1])) || {}; } catch (e) { return {}; }
  }
  function saveVotes() {
    document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(votes)) + '; max-age=' + (60 * 60 * 24 * 90) + '; path=/; SameSite=Lax';
  }

  function counts(step) {
    var c = {}, k;
    for (k in SEED[step]) c[k] = SEED[step][k];
    if (votes[step]) c[votes[step]] = (c[votes[step]] || 0) + 1;
    return c;
  }
  function total(c) { var t = 0, k; for (k in c) t += c[k]; return t; }
  function winner(step) {
    var c = counts(step), best = null, k;
    for (k in c) if (best === null || c[k] > c[best]) best = k;
    return best;
  }
  function section(step) { return document.querySelector('.step[data-step="' + step + '"]'); }
  function card(step, id) { return section(step).querySelector('.opt[data-id="' + id + '"]'); }

  function renderStep(step) {
    var sec = section(step);
    var mine = votes[step];
    sec.classList.toggle('is-voted', !!mine);
    $$('.opt', sec).forEach(function (o) {
      o.classList.remove('is-picked');
      o.classList.toggle('is-mine', o.getAttribute('data-id') === mine);
    });
    if (!mine) return;
    var c = counts(step), t = total(c);
    $$('.opt', sec).forEach(function (o) {
      var pct = Math.round((c[o.getAttribute('data-id')] || 0) * 100 / t);
      o.querySelector('.res__pct').textContent = pct + '%';
      var fill = o.querySelector('.res__bar i');
      requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = pct + '%'; }); });
    });
  }

  function renderNav() {
    var all = true, now = null;
    STEPS.forEach(function (s) {
      var a = document.querySelector('.steps a[data-step="' + s + '"]');
      a.classList.toggle('is-done', !!votes[s]);
      if (!votes[s]) { all = false; if (!now) now = s; }
    });
    $$('.steps a').forEach(function (a) { a.classList.toggle('is-now', a.getAttribute('data-step') === now); });
    body.classList.toggle('all-voted', all);
    document.getElementById('voters').textContent = total(counts('theme'));
  }

  function showBar(step) {
    barStep = step;
    barName.textContent = picks[step] ? card(step, picks[step]).getAttribute('data-name') : '';
    bar.classList.toggle('is-on', !!picks[step] && !body.classList.contains('is-closed'));
  }

  function scrollToEl(el) {
    try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { el.scrollIntoView(true); }
  }

  document.addEventListener('click', function (e) {
    var pick = closest(e.target, '.pick');
    if (pick) {
      var o = closest(pick, '.opt');
      var step = closest(o, '.step').getAttribute('data-step');
      if (votes[step]) return;
      picks[step] = o.getAttribute('data-id');
      $$('.opt', section(step)).forEach(function (x) {
        var on = x === o;
        x.classList.toggle('is-picked', on);
        x.querySelector('.pick').textContent = on ? 'Выбрано' : 'Выбрать';
      });
      showBar(step);
      return;
    }

    if (closest(e.target, '.bar__go')) {
      if (!barStep || !picks[barStep]) return;
      votes[barStep] = picks[barStep];
      saveVotes();
      if (navigator.vibrate) { try { navigator.vibrate(18); } catch (err) {} }
      renderStep(barStep);
      renderNav();
      bar.classList.remove('is-on');
      var next = null;
      STEPS.forEach(function (s) { if (!next && !votes[s]) next = s; });
      var voted = barStep;
      barStep = null;
      setTimeout(function () {
        scrollToEl(next ? section(next) : document.getElementById('done'));
      }, voted === 'theme' ? 700 : 500);
      return;
    }

    var ph = closest(e.target, '.ph');
    if (ph) { e.preventDefault(); openLb(ph); return; }

    var demo = closest(e.target, '[data-demo]');
    if (demo) {
      var mode = demo.getAttribute('data-demo');
      if (mode === 'reset') {
        votes = {}; picks = {}; saveVotes();
        STEPS.forEach(renderStep);
        $$('.pick').forEach(function (b) { b.textContent = 'Выбрать'; });
        renderNav(); showBar(null);
        closedByDemo = false; setMode();
        scrollToEl(document.getElementById('top'));
        return;
      }
      closedByDemo = mode === 'closed';
      setMode();
      window.scrollTo(0, 0);
      return;
    }

    var r = closest(e.target, '.react button');
    if (r) { $$('.react button').forEach(function (b) { b.classList.toggle('is-on', b === r); }); }
  });

  // Пока шаг в зоне видимости, нижняя плашка показывает выбор именно этого шага
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var s = en.target.getAttribute('data-step');
          if (picks[s] && !votes[s]) showBar(s); else if (barStep !== s) bar.classList.remove('is-on');
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    STEPS.forEach(function (s) { io.observe(section(s)); });
  }

  // Таймер
  var timerEl = document.getElementById('timer');
  var end;
  try { end = +sessionStorage.getItem('rigs_demo_end'); } catch (e) {}
  if (!end || end < Date.now()) {
    end = Date.now() + DURATION;
    try { sessionStorage.setItem('rigs_demo_end', end); } catch (e) {}
  }
  function isClosed() { return closedByDemo === null ? Date.now() >= end : closedByDemo; }

  function tick() {
    if (isClosed()) { timerEl.textContent = 'закрыто'; return; }
    var left = Math.max(0, end - Date.now());
    var m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    if (left === 0) setMode();
  }

  function setMode() {
    var closed = isClosed();
    body.classList.toggle('is-closed', closed);
    body.classList.toggle('is-open', !closed);
    document.querySelector('.timer__label').style.display = closed ? 'none' : '';
    $$('.demo [data-demo="open"], .demo [data-demo="closed"]').forEach(function (b) {
      b.setAttribute('aria-pressed', String((b.getAttribute('data-demo') === 'closed') === closed));
    });
    if (closed) { buildResult(); bar.classList.remove('is-on'); }
    tick();
  }

  function buildResult() {
    var res = document.getElementById('result');
    STEPS.forEach(function (s) {
      var slot = res.querySelector('[data-slot="' + s + '"]');
      slot.innerHTML = '';
      var src = card(s, winner(s));
      var copy = src.cloneNode(true);
      copy.removeAttribute('id');
      copy.classList.remove('is-picked', 'is-mine');
      var d = copy.querySelector('details');
      if (d) d.setAttribute('open', '');
      $$('.rail', copy).forEach(function (r) { r.parentNode.removeChild(r); });
      slot.appendChild(copy);
      var st = copy.querySelector('[data-carousel]');
      if (st && window.RigsCarousel) { st.scrollLeft = 0; window.RigsCarousel(st); }
    });
    var th = card('theme', winner('theme'));
    var wr = card('wear', winner('wear'));
    var cl = card('color', winner('color'));
    var loc = th.getAttribute('data-loc');
    res.querySelector('[data-fill="total"]').textContent = total(counts('theme'));
    res.querySelector('[data-fill="theme"]').textContent = th.getAttribute('data-name') + (th.getAttribute('data-covers') === '2' ? '. Какую из двух обложек, утверждаем в чате' : '');
    res.querySelector('[data-fill="wear"]').textContent = wr.getAttribute('data-name') + ', в цвете: ' + cl.getAttribute('data-name').toLowerCase() + (winner('color') === 'bw' ? '' : ' + чёрный и белый');
    res.querySelector('[data-fill="loc"]').textContent = (loc ? 'Рекомендуемая локация: ' + loc + '. ' : '') + 'Место выбираем в чате';
  }

  // Лайтбокс
  var lb = document.querySelector('.lb');
  var lbImg = lb.querySelector('img');
  var lbCap = lb.querySelector('figcaption');
  var lbList = [], lbI = 0;
  function showLb() {
    var a = lbList[lbI];
    lbImg.src = a.getAttribute('href');
    var cap = a.querySelector('span');
    lbCap.textContent = cap ? cap.textContent : '';
    lb.querySelector('.lb__prev').style.visibility = lbI > 0 ? '' : 'hidden';
    lb.querySelector('.lb__next').style.visibility = lbI < lbList.length - 1 ? '' : 'hidden';
  }
  function openLb(a) {
    lbList = $$('.ph', a.parentNode);
    lbI = lbList.indexOf(a);
    showLb();
    lb.hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }
  function closeLb() { lb.hidden = true; lbImg.src = ''; document.documentElement.style.overflow = ''; }
  lb.addEventListener('click', function (e) {
    e.stopPropagation();
    if (closest(e.target, '.lb__prev')) { if (lbI > 0) { lbI--; showLb(); } return; }
    if (closest(e.target, '.lb__next')) { if (lbI < lbList.length - 1) { lbI++; showLb(); } return; }
    if (e.target !== lbImg) closeLb();
  });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowRight' && lbI < lbList.length - 1) { lbI++; showLb(); }
    if (e.key === 'ArrowLeft' && lbI > 0) { lbI--; showLb(); }
  });
  var tx = null;
  lb.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    if (tx === null) return;
    var dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0 && lbI < lbList.length - 1) { lbI++; showLb(); }
    if (dx > 0 && lbI > 0) { lbI--; showLb(); }
  });

  $$('img').forEach(function (img) {
    if (img.complete && img.naturalWidth) return;
    img.classList.add('ld');
    var done = function () { img.classList.remove('ld'); };
    img.addEventListener('load', done);
    img.addEventListener('error', done);
  });

  STEPS.forEach(renderStep);
  renderNav();
  setMode();
  setInterval(tick, 1000);
})();
