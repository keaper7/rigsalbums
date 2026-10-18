// Листающийся альбом: обложка, развороты и задник, как настоящая книга.
// Листы поворачиваются вокруг корешка (только transform), картинки подгружаются по мере листания.
// Когда альбом впервые появляется на экране, он сам открывается и быстро пролистывается
(function () {
  'use strict';
  var boxes = document.querySelectorAll('[data-book]');
  if (!boxes.length || !document.querySelector) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Array.prototype.forEach.call(boxes, function (box) { book(box); });

  function book(box) {
    var base = box.getAttribute('data-base');
    var n = +box.getAttribute('data-spreads');
    var stage = box.querySelector('.bk__stage');
    var el = box.querySelector('.bk__book');
    var label = box.querySelector('[data-bk-label]');
    var prevBtn = box.querySelector('[data-bk-prev]');
    var nextBtn = box.querySelector('[data-bk-next]');
    var zoomBtn = box.querySelector('[data-bk-zoom]');
    var pad = function (i) { return (i < 10 ? '0' : '') + i; };

    // Лист k: лицо — правая страница, оборот — левая страница следующего разворота.
    // 0 — обложка, n — последний разворот и задник. Всего листов n + 1
    var leaves = [];
    for (var k = 0; k <= n; k++) {
      var front = k === 0 ? 'front' : 's' + pad(k) + '-r';
      var back = k === n ? 'back' : 's' + pad(k + 1) + '-l';
      var leaf = document.createElement('div');
      leaf.className = 'bk__leaf' + (k === 0 ? ' is-cover' : '') + (k === n ? ' is-last' : '');
      // страница чуть меньше листа: вокруг неё видна обложка, как у настоящего альбома
      leaf.innerHTML = '<div class="bk__face bk__face--front"><div class="bk__pg"><img alt="" draggable="false"></div></div><div class="bk__face bk__face--back"><div class="bk__pg"><img alt="" draggable="false"></div></div>';
      el.appendChild(leaf);
      leaves.push({ el: leaf, imgs: leaf.querySelectorAll('img'), names: [front, back], loaded: null });
    }

    var cur = 0;          // сколько листов перевёрнуто: 0 — закрыт обложкой, n + 1 — закрыт задником
    var busy = 0;         // сколько листов сейчас в движении
    var timers = [];
    var started = false;

    // Крупные картинки — когда страница на экране шире 300 точек с учётом плотности экрана
    function size() { return el.offsetWidth / 2 * (window.devicePixelRatio || 1) > 300 ? '' : '-sm'; }
    function load(from, to) {
      var s = size();
      for (var i = Math.max(0, from); i <= Math.min(n, to); i++) {
        var lf = leaves[i];
        // уже есть такая же или крупная — не трогаем; маленькую меняем на крупную, если экран стал больше
        if (lf.loaded === s || lf.loaded === '') continue;
        lf.imgs[0].src = base + lf.names[0] + s + '.jpg';
        lf.imgs[1].src = base + lf.names[1] + s + '.jpg';
        lf.loaded = s;
      }
    }

    function paint() {
      leaves.forEach(function (lf, i) {
        var flipped = i < cur;
        lf.el.classList.toggle('is-flipped', flipped);
        if (!lf.el.classList.contains('is-moving')) lf.el.style.zIndex = flipped ? i + 1 : n + 1 - i;
        // далёкие листы не рисуем: они всё равно закрыты соседними. Первый и последний оставляем — на них края обложки
        lf.el.classList.toggle('is-far', !lf.el.classList.contains('is-moving') && i > 0 && i < n && (i < cur - 2 || i > cur + 1));
      });
      el.classList.toggle('is-closed', cur === 0);
      el.classList.toggle('is-end', cur === n + 1);
      if (label) label.textContent = cur === 0 ? 'Обложка' : cur === n + 1 ? 'Задняя обложка' : 'Разворот ' + cur + ' из ' + n;
      if (prevBtn) prevBtn.disabled = cur === 0;
      if (nextBtn) nextBtn.disabled = cur === n + 1;
      load(cur - 2, cur + 2);
    }

    // Перевернуть один лист: вперёд (к концу) или назад. speed — длительность в мс
    function turn(dir, speed) {
      var i = dir > 0 ? cur : cur - 1;
      if (i < 0 || i > n) return false;
      var lf = leaves[i];
      lf.el.classList.remove('is-far');
      lf.el.classList.add('is-moving');
      lf.el.style.zIndex = 500 + busy;
      lf.el.style.transitionDuration = (speed || 900) + 'ms';
      lf.el.style.setProperty('--bk-t', (speed || 900) + 'ms');
      busy++;
      cur += dir;
      // следующий лист должен быть виден под переворачиваемым
      var under = leaves[dir > 0 ? i + 1 : i - 1];
      if (under) under.el.classList.remove('is-far');
      paint();
      var done = false;
      var end = function () {
        if (done) return;
        done = true;
        lf.el.classList.remove('is-moving');
        lf.el.style.transitionDuration = '';
        busy--;
        paint();
      };
      lf.el.addEventListener('transitionend', function te(e) { if (e.propertyName === 'transform') { lf.el.removeEventListener('transitionend', te); end(); } });
      setTimeout(end, (speed || 900) + 120);
      return true;
    }

    function stopIntro() { timers.forEach(clearTimeout); timers = []; }
    function go(dir) { stopIntro(); started = true; if (busy > 2) return; turn(dir); }

    if (prevBtn) prevBtn.addEventListener('click', function () { go(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { go(1); });

    // Нажатие на правую половину — вперёд, на левую — назад. Смахивание — так же
    var sx = null, sy = 0, moved = false;
    stage.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; moved = false; });
    stage.addEventListener('pointermove', function (e) { if (sx !== null && Math.abs(e.clientX - sx) > 8) moved = true; });
    stage.addEventListener('pointerup', function (e) {
      if (sx === null) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (moved) { if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1); return; }
      var r = el.getBoundingClientRect();
      // закрытая книга: обложка в центре, любое нажатие открывает
      if (cur === 0) return go(1);
      if (cur === n + 1) return go(-1);
      go(e.clientX > r.left + r.width / 2 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', function () { sx = null; });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'Escape' && box.classList.contains('is-zoom')) zoom(false);
    });

    // Крупно на весь экран: на телефоне развороты иначе мелкие
    function zoom(on) {
      box.classList.toggle('is-zoom', on);
      document.documentElement.classList.toggle('bk-lock', on);
      if (zoomBtn) zoomBtn.textContent = on ? 'Закрыть' : 'Крупно';
      setTimeout(function () { load(cur - 2, cur + 2); }, 50);
      if (on) box.focus({ preventScroll: true });
    }
    if (zoomBtn) zoomBtn.addEventListener('click', function () { zoom(!box.classList.contains('is-zoom')); });

    paint();

    // Первое появление: открыть обложку и быстро пролистать несколько разворотов туда и обратно
    function intro() {
      if (started) return;
      started = true;
      if (reduce) return;
      var riffle = document.documentElement.classList.contains('lite') ? 0 : Math.min(5, n - 1);
      var t = 250;
      timers.push(setTimeout(function () { turn(1, 1000); }, t));
      t += 1150;
      for (var i = 0; i < riffle; i++) { timers.push(setTimeout(function () { turn(1, 520); }, t)); t += 130; }
      t += 650;
      for (var j = 0; j < riffle; j++) { timers.push(setTimeout(function () { turn(-1, 480); }, t)); t += 115; }
    }
    if ('IntersectionObserver' in window) {
      // заранее, на подходе к блоку, грузим то, что покажем во вступлении
      var near = new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting) return;
        near.disconnect();
        load(0, 7);
      }, { rootMargin: '600px 0px' });
      near.observe(box);
      var seen = new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting) return;
        seen.disconnect();
        intro();
      }, { threshold: 0.55 });
      seen.observe(stage);
    } else {
      load(0, 3);
    }
  }
})();
