(function () {
  'use strict';

  // На сервере страница получает window.RIGS_CLASS с настоящими голосами.
  // Без него это демо: вымышленные голоса, чтобы были видны проценты
  var LIVE = window.RIGS_CLASS || null;
  var STEPS = LIVE ? LIVE.steps : ['theme', 'wear', 'color'];
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
  var barGo = bar.querySelector('.bar__go');
  var picks = {};
  var barStep = null;
  var state = LIVE ? LIVE.state : null;
  var votes = LIVE ? state.mine : readVotes();
  var skew = LIVE ? state.now - Date.now() : 0;
  var closedByDemo = null;
  var sending = false;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // Запросы через XHR: fetch есть не на всех старых телефонах
  function request(method, url, data, done) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    x.setRequestHeader('Accept', 'application/json');
    if (data) x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var res = null;
      try { res = JSON.parse(x.responseText); } catch (e) {}
      done(x.status, res);
    };
    x.send(data ? JSON.stringify(data) : null);
  }

  function counts(step) {
    if (LIVE) return (state.counts && state.counts[step]) || {};
    var c = {}, k;
    for (k in SEED[step]) c[k] = SEED[step][k];
    if (votes[step]) c[votes[step]] = (c[votes[step]] || 0) + 1;
    return c;
  }
  function total(c) { var t = 0, k; for (k in c) t += c[k]; return t; }
  function voters() { return LIVE ? state.voters : total(counts('theme')); }
  function winner(step) {
    var c = counts(step), best = null, k;
    for (k in c) if (best === null || c[k] > c[best]) best = k;
    return best;
  }
  function section(step) { return document.querySelector('.step[data-step="' + step + '"]'); }
  function card(step, id) { var s = section(step); return s ? s.querySelector('.opt[data-id="' + id + '"]') : null; }

  function renderStep(step) {
    var sec = section(step);
    if (!sec) return;
    var mine = votes[step];
    sec.classList.toggle('is-voted', !!mine);
    $$('.opt', sec).forEach(function (o) {
      o.classList.remove('is-picked');
      o.classList.toggle('is-mine', o.getAttribute('data-id') === mine);
    });
    if (!mine) return;
    var c = counts(step), t = total(c) || 1;
    $$('.opt', sec).forEach(function (o) {
      var pct = Math.round((c[o.getAttribute('data-id')] || 0) * 100 / t);
      o.querySelector('.res__pct').textContent = pct + '%';
      var fill = o.querySelector('.res__bar i');
      requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = pct + '%'; }); });
    });
    renderTally(step);
  }

  // Табличка итогов: все варианты этапа одним взглядом, от лидера вниз
  function tallyRows(step) {
    var sec = section(step), c = counts(step), t = total(c), rows = [];
    $$('.opt', sec).forEach(function (o, i) {
      var id = o.getAttribute('data-id');
      rows.push({ id: id, name: o.getAttribute('data-name'), n: c[id] || 0, i: i });
    });
    rows.sort(function (a, b) { return b.n - a.n || a.i - b.i; });
    return rows.map(function (r) { r.pct = t ? Math.round(r.n * 100 / t) : 0; return r; });
  }
  function fillTally(box, step) {
    var rows = tallyRows(step), top = rows.length ? rows[0].n : 0;
    box.innerHTML = '';
    rows.forEach(function (r) {
      var li = document.createElement('li');
      if (r.id === votes[step]) li.className = 'is-mine';
      if (top && r.n === top) li.className += ' is-top';
      var name = document.createElement('span');
      name.className = 'tally__name';
      name.textContent = r.name;
      var bar = document.createElement('i');
      bar.className = 'tally__bar';
      var fill = document.createElement('i');
      bar.appendChild(fill);
      var pct = document.createElement('b');
      pct.textContent = r.pct + '%';
      li.appendChild(name); li.appendChild(bar); li.appendChild(pct);
      box.appendChild(li);
      requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = r.pct + '%'; }); });
    });
  }
  function renderTally(step) {
    var sec = section(step);
    var box = sec.querySelector('.tally');
    if (!box) {
      box = document.createElement('div');
      box.className = 'tally';
      box.innerHTML = '<p class="tally__head"><b>Сейчас в классе</b><small></small></p><ol></ol>';
      var head = sec.querySelector('.step__head');
      head.parentNode.insertBefore(box, head.nextSibling);
    }
    box.querySelector('small').textContent = 'голосов: ' + total(counts(step));
    fillTally(box.querySelector('ol'), step);
    renderSummary();
  }
  function renderSummary() {
    var done = document.getElementById('done');
    if (!done) return;
    var box = done.querySelector('.tally--all');
    if (!box) {
      box = document.createElement('div');
      box.className = 'tally tally--all';
      done.appendChild(box);
    }
    box.innerHTML = '';
    STEPS.forEach(function (st) {
      if (!votes[st] || !section(st)) return;
      var h = document.createElement('p');
      h.className = 'tally__head';
      var b = document.createElement('b');
      var a = document.querySelector('.steps a[data-step="' + st + '"]');
      b.textContent = a ? a.textContent.replace(/^\d+/, '') : st;
      var sm = document.createElement('small');
      sm.textContent = 'голосов: ' + total(counts(st));
      h.appendChild(b); h.appendChild(sm);
      var ol = document.createElement('ol');
      box.appendChild(h); box.appendChild(ol);
      fillTally(ol, st);
    });
  }

  function renderNav() {
    var all = true, now = null;
    STEPS.forEach(function (s) {
      var a = document.querySelector('.steps a[data-step="' + s + '"]');
      if (a) a.classList.toggle('is-done', !!votes[s]);
      if (!votes[s]) { all = false; if (!now) now = s; }
    });
    $$('.steps a').forEach(function (a) { a.classList.toggle('is-now', a.getAttribute('data-step') === now); });
    body.classList.toggle('all-voted', all);
    var v = document.getElementById('voters');
    if (v) v.textContent = voters();
  }

  function canVote() { return LIVE ? state.status === 'open' : !body.classList.contains('is-closed'); }

  function showBar(step) {
    barStep = step;
    var c = step && picks[step] ? card(step, picks[step]) : null;
    barName.textContent = c ? c.getAttribute('data-name') : '';
    bar.classList.toggle('is-on', !!c && canVote());
  }

  function scrollToEl(el) {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { el.scrollIntoView(true); }
  }

  function toast(text) {
    var t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('p');
      t.className = 'toast';
      t.setAttribute('role', 'status');
      body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(t.tm);
    t.tm = setTimeout(function () { t.classList.remove('is-on'); }, 4200);
  }

  // Праздник, когда все три голоса отданы
  function confetti() {
    if (reduce) return;
    var colors = ['#8C2B2B', '#E8C9A8', '#B08D57', '#2F6B4F', '#D2453C', '#3A2321'];
    var box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 42; i++) {
      var p = document.createElement('i');
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', Math.round(Math.random() * 180 - 90) + 'px');
      p.style.setProperty('--r', Math.round(Math.random() * 900 - 450) + 'deg');
      p.style.animationDelay = (Math.random() * 0.35).toFixed(2) + 's';
      p.style.animationDuration = (1.7 + Math.random() * 1.2).toFixed(2) + 's';
      if (i % 3 === 0) p.className = 'is-round';
      box.appendChild(p);
    }
    body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 3600);
  }

  function afterVote(step) {
    var next = null;
    STEPS.forEach(function (s) { if (!next && !votes[s]) next = s; });
    if (navigator.vibrate) { try { navigator.vibrate(next ? 18 : [20, 60, 30]); } catch (err) {} }
    renderStep(step);
    renderNav();
    bar.classList.remove('is-on');
    barStep = null;
    setTimeout(function () {
      scrollToEl(next ? section(next) : document.getElementById('done'));
      if (!next) setTimeout(confetti, 350);
    }, step === 'theme' ? 700 : 500);
  }

  function sendVote(step, option) {
    if (sending) return;
    sending = true;
    barGo.disabled = true;
    request('POST', LIVE.api + '/vote', { step: step, option: option }, function (code, res) {
      sending = false;
      barGo.disabled = false;
      if (res && res.state) applyState(res.state);
      if (code === 200 && res && res.ok) {
        votes[step] = option;
        afterVote(step);
        return;
      }
      if (res && res.error === 'already') { renderStep(step); renderNav(); bar.classList.remove('is-on'); toast('На этом этапе твой голос уже учтён'); return; }
      if (res && res.error === 'closed') { toast('Голосование уже закрыто'); setTimeout(function () { location.reload(); }, 1500); return; }
      if (res && res.error === 'cookies') { toast('Браузер не сохраняет куки, поэтому голос не засчитать. Открой ссылку в обычном браузере'); return; }
      if (res && res.error === 'busy') { toast('Слишком много голосов с этой сети, попробуй через пару минут'); return; }
      toast('Не получилось отправить, проверь интернет и нажми ещё раз');
    });
  }

  document.addEventListener('click', function (e) {
    var pick = closest(e.target, '.pick');
    if (pick) {
      var o = closest(pick, '.opt');
      var step = closest(o, '.step').getAttribute('data-step');
      if (votes[step] || !canVote()) return;
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
      if (LIVE) { sendVote(barStep, picks[barStep]); return; }
      votes[barStep] = picks[barStep];
      saveVotes();
      afterVote(barStep);
      return;
    }

    var ph = closest(e.target, '.ph');
    if (ph) { e.preventDefault(); openLb(ph); return; }

    var demo = !LIVE && closest(e.target, '[data-demo]');
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
    STEPS.forEach(function (s) { if (section(s)) io.observe(section(s)); });
  }

  // Таймер
  var timerEl = document.getElementById('timer');
  var timerLabel = document.querySelector('.timer__label');
  var end;
  if (LIVE) {
    end = state.endsAt;
  } else {
    try { end = +sessionStorage.getItem('rigs_demo_end'); } catch (e) {}
    if (!end || end < Date.now()) {
      end = Date.now() + DURATION;
      try { sessionStorage.setItem('rigs_demo_end', end); } catch (e) {}
    }
  }
  function now() { return Date.now() + skew; }
  function isClosed() {
    if (LIVE) return state.status === 'closed';
    return closedByDemo === null ? Date.now() >= end : closedByDemo;
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function fmtLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h ? h + ':' + two(m) + ':' + two(s % 60) : m + ':' + two(s % 60);
  }

  function tick() {
    if (LIVE && state.status === 'draft') {
      // Старт запланирован: считаем до него, потом узнаём у сервера, открылось ли
      if (!state.opensAt) { timerEl.textContent = 'скоро'; return; }
      var until = Math.max(0, state.opensAt - now());
      timerEl.textContent = fmtLeft(until);
      if (until === 0) poll();
      return;
    }
    if (isClosed()) { timerEl.textContent = 'закрыто'; return; }
    var left = Math.max(0, end - now());
    timerEl.textContent = fmtLeft(left);
    if (left === 0) {
      if (LIVE) poll(); else setMode();
    }
  }

  function setMode() {
    var closed = isClosed();
    body.classList.toggle('is-closed', closed);
    body.classList.toggle('is-open', !closed);
    timerLabel.style.display = closed ? 'none' : '';
    $$('.demo [data-demo="open"], .demo [data-demo="closed"]').forEach(function (b) {
      b.setAttribute('aria-pressed', String((b.getAttribute('data-demo') === 'closed') === closed));
    });
    if (closed) { buildResult(); bar.classList.remove('is-on'); }
    tick();
  }

  // Демо: итог собирается из карточек-победителей прямо на странице.
  // На сервере закрытая страница приходит уже готовой
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
      // Копия уже загруженных фото: пометка «грузится» от оригинала тут не нужна
      $$('img.ld', copy).forEach(function (im) {
        if (im.complete && im.naturalWidth) im.classList.remove('ld');
        else im.addEventListener('load', function () { im.classList.remove('ld'); });
      });
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

  // Сервер: следим за статусом. Открыли, закрыли или Артур выбрал победителя — перезагружаем страницу
  var pollTimer = null, polling = false;
  function applyState(s) {
    var reload = s.status !== state.status || (s.status === 'closed' && s.rev !== state.rev) ||
      (s.status === 'draft' && (s.opensAt || null) !== (state.opensAt || null));
    skew = s.now - Date.now();
    state.counts = s.counts;
    state.voters = s.voters;
    state.endsAt = s.endsAt;
    state.rev = s.rev;
    state.opensAt = s.opensAt || null;
    end = s.endsAt;
    // Голос мог уйти из другой вкладки: берём то, что знает сервер
    if (s.mine) { for (var k in s.mine) votes[k] = s.mine[k]; }
    if (reload) {
      // После перезагрузки класс должен сразу увидеть итог, а не середину страницы
      try { history.scrollRestoration = 'manual'; } catch (e) {}
      window.scrollTo(0, 0);
      location.reload();
      return;
    }
    STEPS.forEach(function (st) { if (votes[st]) renderStep(st); });
    renderNav();
  }
  function poll() {
    clearTimeout(pollTimer);
    if (document.hidden || polling) return;
    polling = true;
    request('GET', LIVE.api + '/state', null, function (code, res) {
      polling = false;
      if (code === 200 && res) applyState(res);
      schedule();
    });
  }
  function schedule() {
    clearTimeout(pollTimer);
    var st = state.status;
    if (st === 'closed' && !state.pending) return;
    var left = st === 'open' && end ? end - now() : Infinity;
    var wait = st === 'open' ? (left < 20000 ? 4000 : 15000) : 20000;
    if (st === 'draft' && state.opensAt) wait = Math.max(1000, Math.min(20000, state.opensAt - now() + 800));
    pollTimer = setTimeout(poll, wait);
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
  if (LIVE) {
    tick();
    schedule();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  } else {
    setMode();
  }
  setInterval(tick, 1000);
})();
