// Листающийся альбом: обложка, развороты и задник, как настоящая книга.
// Листы поворачиваются вокруг корешка (только transform), картинки подгружаются по мере листания.
// Когда альбом впервые появляется на экране, он поднимается к зрителю, сам открывается и быстро пролистывается.
// Под альбомом обложки других альбомов: нажатие меняет альбом
(function () {
  'use strict';
  var boxes = document.querySelectorAll('[data-book]');
  if (!boxes.length) return;
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
    var picks = box.querySelectorAll('[data-bk-album]');
    // Для страницы проверки макета: своя обложка ученика, порог крупных картинок, своя страница
    var frontName = box.getAttribute('data-front') || 'front';
    var backName = box.getAttribute('data-back') || 'back';
    var big = +box.getAttribute('data-big') || 300;
    var mine = box.getAttribute('data-mine') || '';
    var noIntro = box.hasAttribute('data-no-intro');
    // На проверке макета задник не показываем: альбом заканчивается последним разворотом
    var noBack = box.hasAttribute('data-no-back');
    var pad = function (i) { return (i < 10 ? '0' : '') + i; };

    var leaves = [];
    var cur = 0;          // сколько листов перевёрнуто: 0 — закрыт обложкой, n + 1 — закрыт задником
    var busy = 0;         // сколько листов сейчас в движении
    var timers = [];
    var started = false;
    var gen = 0;          // номер сборки: после смены альбома старые листы ничего не трогают
    var edgeL, edgeR;
    var focus = 'l';      // крупно на телефоне видна одна страница: левая или правая

    // Лист k: лицо — правая страница, оборот — левая страница следующего разворота.
    // 0 — обложка, n — последний разворот и задник. Всего листов n + 1
    function build() {
      el.innerHTML = '';
      leaves = [];
      for (var k = 0; k <= n; k++) {
        var front = k === 0 ? frontName : 's' + pad(k) + '-r';
        var back = k === n ? (noBack ? '' : backName) : 's' + pad(k + 1) + '-l';
        var leaf = document.createElement('div');
        leaf.className = 'bk__leaf' + (k === 0 ? ' is-cover' : '') + (k === n ? ' is-last' : '');
        // страница чуть меньше листа: вокруг неё видна обложка, как у настоящего альбома.
        // bk__gl — блик на обложке
        leaf.innerHTML = '<div class="bk__in"><div class="bk__face bk__face--front"><div class="bk__pg"><img alt="" draggable="false">' + (k === 0 ? '<i class="bk__gl"></i>' : '') + '</div></div>' +
          '<div class="bk__face bk__face--back"><div class="bk__pg"><img alt="" draggable="false">' + (k === n ? '<i class="bk__gl"></i>' : '') + '</div></div></div>';
        el.appendChild(leaf);
        // своя страница ученика подсвечена
        if (mine && (front === mine || back === mine)) leaf.querySelector(front === mine ? '.bk__face--front' : '.bk__face--back').classList.add('is-mine');
        leaves.push({ el: leaf, imgs: leaf.querySelectorAll('img'), names: [front, back], loaded: [null, null] });
      }
      // тень под альбомом и торцы страниц по краям — для объёма
      el.insertAdjacentHTML('beforeend', '<i class="bk__sh bk__sh--l"></i><i class="bk__sh bk__sh--r"></i><i class="bk__edge bk__edge--l"></i><i class="bk__edge bk__edge--r"></i>');
      edgeL = el.querySelector('.bk__edge--l');
      edgeR = el.querySelector('.bk__edge--r');
      cur = 0;
      busy = 0;
      gen++;
    }

    // Крупные картинки — когда страница на экране шире 300 точек с учётом плотности экрана
    function size() { return el.offsetWidth / 2 * (window.devicePixelRatio || 1) > big ? '' : '-sm'; }
    // Крупные картинки макета тяжёлые (на проверке), поэтому крупно грузим только видимые страницы
    // и те, что покажутся следующим переворотом. На главной картинки лёгкие, там все одного размера
    function sizeFor(i, k) {
      var s = size();
      if (s === '-sm' || big <= 300) return s;
      var near = k === 0 ? i >= cur - 1 && i <= cur + 1 : i >= cur - 2 && i <= cur;
      return near ? '' : '-sm';
    }
    function load(from, to) {
      for (var i = Math.max(0, from); i <= Math.min(n, to); i++) {
        var lf = leaves[i];
        for (var k = 0; k < 2; k++) {
          if (!lf.names[k]) continue;
          var s = sizeFor(i, k), had = lf.loaded[k];
          // уже есть такая же или крупная — не трогаем; маленькую меняем на крупную, если экран стал больше
          if (had === s || had === '') continue;
          put(lf.imgs[k], base + lf.names[k] + s + '.jpg', had !== null);
          lf.loaded[k] = s;
        }
      }
    }
    // Крупные картинки на далёких листах меняем обратно на маленькие: телефону не держать в памяти весь альбом
    function shrink() {
      if (big <= 300) return;
      leaves.forEach(function (lf, i) {
        if (i >= cur - 3 && i <= cur + 3) return;
        for (var k = 0; k < 2; k++) if (lf.loaded[k] === '' && lf.names[k]) { put(lf.imgs[k], base + lf.names[k] + '-sm.jpg', false); lf.loaded[k] = '-sm'; }
      });
    }
    // Новая картинка. Если на месте уже была маленькая, крупную сначала загружаем и раскладываем отдельно
    // и только потом подставляем: иначе страница на миг пустеет, и это видно как мигание
    function put(img, url, swap) {
      img.setAttribute('data-want', url);
      if (!swap) {
        img.src = url;
        // раскладываем картинку заранее, а не в момент, когда лист покажется
        if (img.decode) img.decode().catch(function () {});
        return;
      }
      var pre = new Image();
      var done = function () { if (img.getAttribute('data-want') === url) img.src = url; };
      pre.onload = function () { if (pre.decode) pre.decode().then(done, done); else done(); };
      pre.src = url;
    }

    function paint() {
      // Видны две верхние страницы и всё, что может показаться из-под листов в движении:
      // при быстром пролистывании их несколько, и под каждым должна лежать своя страница, а не пустая обложка
      var lo = cur - 1, hi = cur;
      leaves.forEach(function (lf, i) {
        if (lf.el.classList.contains('is-moving')) { lo = Math.min(lo, i - 1); hi = Math.max(hi, i + 1); }
      });
      leaves.forEach(function (lf, i) {
        var flipped = i < cur;
        lf.el.classList.toggle('is-flipped', flipped);
        if (!lf.el.classList.contains('is-moving')) lf.el.style.zIndex = flipped ? i + 1 : n + 1 - i;
        // Остальные листы не рисуем: на телефоне их светлые края просвечивали тонкой полоской по стыку и низу.
        // У первого и последнего листа скрываем только страницу: на них края обложки
        var moving = lf.el.classList.contains('is-moving');
        var hidden = !moving && (i < lo || i > hi);
        var edge = i === 0 || i === n;
        // у закрытого альбома вторая обложка под ним не нужна: она просвечивала в скруглённом углу
        var gone = !moving && ((i === n && cur === 0 && !leaves[0].el.classList.contains('is-moving')) ||
          (i === 0 && cur === n + 1 && !leaves[n].el.classList.contains('is-moving')));
        // Соседние листы только прячем: картинки на них уже разложены, и при появлении лист
        // не мигает пустым. Дальние убираем совсем, чтобы не держать их в памяти
        var near = i >= lo - 2 && i <= hi + 2;
        lf.el.classList.toggle('is-far', ((hidden && !edge) || gone) && !near);
        lf.el.classList.toggle('is-hid', ((hidden && !edge) || gone) && near);
        lf.el.classList.toggle('is-buried', hidden && edge && !gone);
      });
      // Тень, торец и корешок половины появляются, только когда на неё легла обложка.
      // Иначе при открытии под альбомом сначала возникала «подкладка», а потом на неё ложилась обложка
      el.classList.toggle('is-lside', cur >= 1 && !leaves[0].el.classList.contains('is-moving'));
      el.classList.toggle('is-rside', cur <= n && !leaves[n].el.classList.contains('is-moving'));
      el.classList.toggle('is-closed', cur === 0);
      el.classList.toggle('is-end', cur === n + 1);
      // торец: чем больше листов с этой стороны, тем он толще (не больше 0,9% ширины книги)
      edgeL.style.width = (Math.min(cur, n + 1) / (n + 1) * 0.9).toFixed(3) + '%';
      edgeR.style.width = ((n + 1 - Math.min(cur, n + 1)) / (n + 1) * 0.9).toFixed(3) + '%';
      box.classList.toggle('is-f-l', single() && cur > 0 && cur <= n && focus === 'l');
      box.classList.toggle('is-f-r', single() && cur > 0 && cur <= n && focus === 'r');
      if (label) label.textContent = cur === 0 ? 'Обложка' : cur === n + 1 ? 'Задняя обложка' : 'Разворот ' + cur + ' из ' + n;
      if (prevBtn) prevBtn.disabled = cur === 0;
      if (nextBtn) nextBtn.disabled = cur === n + 1 || (cur >= last() && !(single() && cur > 0 && focus === 'l'));
      load(cur - 2, cur + 2);
      if (!busy) shrink();
      // какой разворот открыт и какая страница видна — для правок на странице проверки.
      // Сообщаем, когда листы легли: страница под альбомом не меняется посреди переворота
      if (!busy && (cur !== lastCur || focus !== lastFocus)) {
        lastCur = cur; lastFocus = focus;
        box.dispatchEvent(new CustomEvent('bk:change', { detail: { cur: cur, n: n, single: single(), focus: focus } }));
      }
    }
    var lastCur = -1, lastFocus = '';

    // тень и блик на странице идут столько же, сколько поворот
    function bend(lf, speed) {
      lf.el.style.setProperty('--bk-t', speed + 'ms');
    }

    // Перевернуть один лист: вперёд (к концу) или назад. speed — длительность в мс
    function turn(dir, speed) {
      var i = dir > 0 ? cur : cur - 1;
      if (i < 0 || i > n || (dir > 0 && cur >= last())) return false;
      speed = speed || 900;
      var lf = leaves[i];
      lf.el.classList.remove('is-far', 'is-hid', 'is-buried');
      // если лист был убран, даём браузеру сначала поставить его на место, иначе поворот не анимируется
      void lf.el.offsetWidth;
      bend(lf, speed);
      lf.el.classList.add('is-moving');
      lf.el.style.zIndex = 500 + busy;
      lf.el.style.transitionDuration = speed + 'ms';
      busy++;
      cur += dir;
      // следующий лист должен быть виден под переворачиваемым
      var under = leaves[dir > 0 ? i + 1 : i - 1];
      if (under) under.el.classList.remove('is-far', 'is-hid', 'is-buried');
      paint();
      var done = false;
      var g = gen;
      var end = function () {
        if (done || g !== gen) return;
        done = true;
        lf.el.classList.remove('is-moving');
        lf.el.style.transitionDuration = '';
        busy--;
        paint();
      };
      lf.el.addEventListener('transitionend', function te(e) {
        if (e.target === lf.el && e.propertyName === 'transform') { lf.el.removeEventListener('transitionend', te); end(); }
      });
      setTimeout(end, speed + 120);
      return true;
    }

    function stopIntro() { timers.forEach(clearTimeout); timers = []; }
    var touched = -1;     // в какой сборке листали руками
    function go(dir) {
      stopIntro(); started = true; touched = gen;
      if (busy > 2 || swapping) return;
      if (!single()) return turn(dir);
      // по одной странице: сначала соседняя страница этого же разворота, потом переворот листа
      if (dir > 0) {
        if (cur === n + 1) return;
        if (cur > 0 && focus === 'l') { focus = 'r'; return paint(); }
        if (cur >= last()) return;
        focus = 'l';
        turn(1);
      } else {
        if (cur === 0) return;
        if (cur <= n && focus === 'r') { focus = 'l'; return paint(); }
        focus = 'r';
        turn(-1);
      }
    }
    function single() { return box.classList.contains('is-single'); }
    // дальше какого положения листать нельзя: задник или последний разворот
    function last() { return noBack ? n : n + 1; }

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
      // по одной странице — правая половина экрана вперёд, левая назад
      var r = single() ? box.getBoundingClientRect() : el.getBoundingClientRect();
      // закрытая книга: обложка в центре, любое нажатие открывает
      if (cur === 0) return go(1);
      if (cur === n + 1) return go(-1);
      go(e.clientX > r.left + r.width / 2 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', function () { sx = null; });
    box.addEventListener('keydown', function (e) {
      if (e.target !== box) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'Escape' && box.classList.contains('is-zoom')) zoom(false);
    });

    // Крупно на весь экран: на телефоне развороты иначе мелкие.
    // Телефон стоит вертикально — по одной странице на всю ширину, лежит — разворот во весь экран
    function fit() {
      var on = box.classList.contains('is-zoom') && window.innerWidth < window.innerHeight && window.innerWidth < 700;
      if (on && !single()) focus = 'l';
      box.classList.toggle('is-single', on);
      paint();
    }
    function zoom(on) {
      stopIntro();
      started = true;
      box.classList.toggle('is-zoom', on);
      document.documentElement.classList.toggle('bk-lock', on);
      if (zoomBtn) zoomBtn.textContent = on ? 'Закрыть' : 'Крупно';
      fit();
      setTimeout(function () { load(cur - 2, cur + 2); }, 50);
      if (on) box.focus({ preventScroll: true });
    }
    if (zoomBtn) zoomBtn.addEventListener('click', function () { zoom(!box.classList.contains('is-zoom')); });
    window.addEventListener('resize', function () { if (box.classList.contains('is-zoom')) { fit(); load(cur - 2, cur + 2); } });

    // Другой альбом: старый гаснет, новый появляется закрытым и сам открывается
    // если нажали другую обложку, пока меняется альбом, переключаемся на неё следом
    var swapping = false, pending = null;
    Array.prototype.forEach.call(picks, function (p) {
      p.addEventListener('click', function () { pick(p); });
    });
    // выбранная обложка подсвечивается сразу, а сам альбом меняется, когда старый погаснет:
    // до этого старые листы ещё могут доворачиваться и должны видеть свой альбом
    var want = null;
    function choose(p) {
      Array.prototype.forEach.call(picks, function (q) { q.classList.toggle('is-on', q === p); q.setAttribute('aria-pressed', q === p ? 'true' : 'false'); });
      want = p;
    }
    function pick(p) {
      if (swapping) { pending = p; return; }
      if (p.classList.contains('is-on')) return;
      stopIntro();
      started = true;
      swapping = true;
      stage.classList.remove('is-pre');
      choose(p);
      stage.classList.add('is-swap');
      setTimeout(again, 260);
    }
    function again() {
      // за время угасания могли нажать ещё одну обложку — показываем последнюю
      if (pending) { choose(pending); pending = null; }
      base = want.getAttribute('data-base');
      n = +want.getAttribute('data-spreads');
      // край обложки вокруг страниц — в цвет материала этого альбома
      box.style.setProperty('--bk-board', want.getAttribute('data-board'));
      box.style.setProperty('--bk-spine', want.getAttribute('data-spine'));
      // обложку нового альбома ждём, чтобы он не проявился пустым
      var pre = new Image();
      pre.src = base + 'front' + size() + '.jpg';
      build();
      paint();
      load(0, 3);
      var g = gen, once = false;
      var show = function () {
        if (once) return;
        once = true;
        swapping = false;
        // нажали другую обложку, пока грузилась эта, — сразу меняем дальше
        if (pending) { var q = pending; pending = null; if (!q.classList.contains('is-on')) { swapping = true; choose(q); return again(); } }
        stage.classList.remove('is-swap');
        // сам открывается, если его не начали листать раньше
        setTimeout(function () { if (g === gen && touched !== gen && cur === 0 && !reduce) turn(1, 1000); }, 950);
      };
      if (pre.complete) show(); else { pre.onload = pre.onerror = show; setTimeout(show, 1500); }
    }

    build();
    paint();

    // Быстро пролистать к развороту k (0 — обложка), на телефоне по одной странице — к стороне side
    function goTo(k, side) {
      stopIntro();
      started = true;
      touched = gen;
      k = Math.max(0, Math.min(last(), k));
      if (side) focus = side;
      var dir = k > cur ? 1 : -1, steps = Math.abs(k - cur), t = 0;
      if (!steps) return paint();
      for (var i = 0; i < steps; i++) { timers.push(setTimeout(function () { turn(dir, steps > 2 ? 420 : 800); }, t)); t += steps > 2 ? 90 : 0; }
    }
    box.bkGo = goTo;
    box.bkState = function () { return { cur: cur, n: n, single: single(), focus: focus }; };

    // Первое появление: альбом лежит вдали, поднимается к зрителю, открывается и быстро пролистывает
    // несколько разворотов туда и обратно
    function intro() {
      if (started) return;
      started = true;
      if (reduce || noIntro) return;
      var riffle = document.documentElement.classList.contains('lite') ? 0 : Math.min(5, n - 1);
      var t = 1500;
      timers.push(setTimeout(function () { turn(1, 1000); }, t));
      t += 1150;
      for (var i = 0; i < riffle; i++) { timers.push(setTimeout(function () { turn(1, 520); }, t)); t += 130; }
      t += 650;
      for (var j = 0; j < riffle; j++) { timers.push(setTimeout(function () { turn(-1, 480); }, t)); t += 115; }
    }
    if ('IntersectionObserver' in window) {
      if (!reduce) stage.classList.add('is-pre');
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
        stage.classList.remove('is-pre');
        intro();
      }, { threshold: 0.3 });
      seen.observe(box);
    } else {
      load(0, 3);
    }
  }
})();
