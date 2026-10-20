// Загрузка макета альбома: у Артура в админке и у дизайнера по его ссылке.
// Файлы режутся и ужимаются здесь, в браузере: разворот 000-NN — на левую и правую страницу,
// обложка PPP-00 — без полей для загибов и корешка, на лицо и задник. На сервер уходят готовые
// страницы в двух размерах: крупная для «Крупно» и маленькая для телефона
(function () {
  'use strict';

  // Страница альбома 2456×3496: по ней находим половину разворота при любом разрешении файлов
  var PAGE_RATIO = 2456 / 3496;
  var BIG = 1600, SMALL = 800;

  function post(url, data, csrf) {
    var h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (csrf) h['X-CSRF-Token'] = csrf;
    return fetch(url, { method: 'POST', headers: h, body: JSON.stringify(data), credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Не получилось. Попробуйте ещё раз'); return j; }); });
  }

  // У дизайнера форма «личные страницы начинаются» уходит как JSON
  var first = document.querySelector('.lay-first');
  var box = document.querySelector('[data-lay]');
  if (first && box && !box.getAttribute('data-csrf')) {
    first.addEventListener('submit', function (e) {
      e.preventDefault();
      post(first.getAttribute('action'), { spread: first.spread.value, side: first.side.value })
        .then(function () { location.reload(); }, function (err) { alert(err.message); });
    });
  }
  if (!box) return;

  var csrf = box.getAttribute('data-csrf') || '';
  var students = +box.getAttribute('data-students') || 0;
  var sum = box.querySelector('[data-lay-sum]');
  var state = box.querySelector('[data-lay-state]');
  var busy = false;
  var pad = function (n, w) { return String(n).padStart(w, '0'); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  Array.prototype.forEach.call(box.querySelectorAll('[data-lay-files]'), function (inp) {
    inp.addEventListener('change', function () { if (!busy) analyze(Array.prototype.slice.call(inp.files)); inp.value = ''; });
  });
  box.addEventListener('dragover', function (e) { e.preventDefault(); box.classList.add('is-drop'); });
  box.addEventListener('dragleave', function () { box.classList.remove('is-drop'); });
  box.addEventListener('drop', function (e) {
    e.preventDefault();
    box.classList.remove('is-drop');
    if (!busy) analyze(Array.prototype.slice.call(e.dataTransfer.files));
  });

  // Разбираем имена файлов: что разворот, что обложка, что лишнее
  function analyze(files) {
    var spreads = {}, covers = {}, skipped = [];
    files.forEach(function (f) {
      if (/^\./.test(f.name)) return;
      var m = /^\s*(\d{3})-(\d{2})\s*\.(jpe?g)$/i.exec(f.name);
      if (!m) { skipped.push(f.name); return; }
      var a = +m[1], b = +m[2];
      if (a === 0 && b > 0) spreads[b] = f;
      else if (a > 0 && b === 0) covers[a] = f;
      else skipped.push(f.name);
    });
    var sNums = Object.keys(spreads).map(Number).sort(function (x, y) { return x - y; });
    var cNums = Object.keys(covers).map(Number).sort(function (x, y) { return x - y; });
    var plan = { spreads: sNums.map(function (k) { return { num: k, file: spreads[k] }; }), covers: cNums.map(function (k) { return { num: k, file: covers[k] }; }) };
    var gaps = [];
    for (var k = 1; sNums.length && k < sNums[sNums.length - 1]; k++) if (!spreads[k]) gaps.push('000-' + pad(k, 2));
    var noCover = [];
    for (var i = 1; i <= students; i++) if (!covers[i]) noCover.push(pad(i, 3) + '-00');
    var extra = cNums.filter(function (n) { return n > students + 1; });
    var rows = [];
    rows.push('<p><b>Развороты: ' + sNums.length + '</b>' + (sNums.length ? ' (000-' + pad(sNums[0], 2) + ' … 000-' + pad(sNums[sNums.length - 1], 2) + ')' : '') + '</p>');
    if (gaps.length) rows.push('<p class="muted small">Нет ' + esc(gaps.join(', ')) + '. Если их убрали специально, всё в порядке: развороты пойдут по порядку.</p>');
    rows.push('<p><b>Обложки: ' + cNums.length + '</b>' + (students ? ' из ' + students + ' учеников' + (covers[students + 1] ? ' и кл. руку' : '') : '') + '</p>');
    if (noCover.length && students) rows.push('<p class="wk-warn small">Нет обложек: ' + esc(noCover.slice(0, 30).join(', ')) + (noCover.length > 30 ? '…' : '') + '. Этим ученикам покажется чужая обложка.</p>');
    if (extra.length) rows.push('<p class="wk-warn small">Номера больше, чем учеников в отборе: ' + esc(extra.map(function (n) { return pad(n, 3) + '-00'; }).join(', ')) + '. Проверьте список учеников.</p>');
    if (skipped.length) rows.push('<p class="muted small">Пропущены (не похожи на 000-NN или PPP-00): ' + esc(skipped.slice(0, 10).join(', ')) + (skipped.length > 10 ? '…' : '') + '</p>');
    rows.push(sNums.length ? '<button class="b b--main" type="button" data-lay-go>Загрузить макет</button>' : '<p class="wk-warn">Нет разворотов 000-01, 000-02… Без них загружать нечего.</p>');
    sum.innerHTML = rows.join('');
    sum.hidden = false;
    var go = sum.querySelector('[data-lay-go]');
    if (go) go.addEventListener('click', function () { upload(plan); });
  }

  function setState(done, total, text) {
    state.hidden = false;
    state.querySelector('i').style.width = (total ? Math.round(done * 100 / total) : 0) + '%';
    state.querySelector('p').textContent = text;
  }

  // Картинку из файла: createImageBitmap, а где его нет — через <img>
  function decode(file) {
    if (window.createImageBitmap) return createImageBitmap(file);
    return new Promise(function (ok, fail) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); fail(new Error('Не открылся файл ' + file.name)); };
      img.src = url;
    });
  }

  var canvas = document.createElement('canvas');
  function cut(src, sx, sy, sw, sh, width, q) {
    var w = Math.min(width, Math.round(sw)), h = Math.round(sh * w / sw);
    canvas.width = w; canvas.height = h;
    var cx = canvas.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    return new Promise(function (ok, fail) {
      canvas.toBlob(function (b) { b ? ok(b) : fail(new Error('Не получилось ужать страницу')); }, 'image/jpeg', q);
    });
  }

  function send(url, blob, tries) {
    var h = { 'Content-Type': 'image/jpeg' };
    if (csrf) h['X-CSRF-Token'] = csrf;
    return fetch(url, { method: 'POST', headers: h, body: blob, credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Файл не загрузился');
        return j;
      });
    }).catch(function (err) {
      // сеть моргнула — ещё пару попыток
      if ((tries || 0) < 2) return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return send(url, blob, (tries || 0) + 1); });
      throw err;
    });
  }

  function upload(plan) {
    busy = true;
    sum.querySelector('[data-lay-go]').disabled = true;
    var total = (plan.spreads.length * 2 + plan.covers.length * 2) * 2, done = 0;
    var pageW = 0, pageH = 0, ver = 0;
    var queue = [], running = 0, failed = null, finishWait = null;
    window.onbeforeunload = function () { return 'Макет ещё загружается'; };
    // отправляем по три файла параллельно, пока режутся следующие
    function enqueue(name, blob) {
      return new Promise(function (ok) {
        queue.push({ name: name, blob: blob });
        pump();
        ok();
      });
    }
    function pump() {
      while (running < 3 && queue.length) {
        var t = queue.shift();
        running++;
        send(box.getAttribute('data-file') + '/' + ver + '?name=' + t.name, t.blob).then(function () {
          done++;
          setState(done, total, 'Загружено ' + done + ' из ' + total + '. Не закрывайте страницу');
        }, function (err) { failed = failed || err; }).then(function () {
          running--;
          pump();
          if (!running && !queue.length && finishWait) finishWait();
        });
      }
    }
    function drained() {
      return new Promise(function (ok) { if (!running && !queue.length) ok(); else finishWait = ok; });
    }
    // не держим в памяти больше десятка готовых страниц
    function room() {
      return new Promise(function (ok) {
        (function wait() { if (queue.length < 10 || failed) ok(); else setTimeout(wait, 120); })();
      });
    }
    function pages(name, src, sx, sy, sw, sh) {
      return cut(src, sx, sy, sw, sh, BIG, 0.86).then(function (b) { return enqueue(name, b); })
        .then(function () { return cut(src, sx, sy, sw, sh, SMALL, 0.8); }).then(function (b) { return enqueue(name + '-sm', b); });
    }

    setState(0, total, 'Готовимся…');
    post(box.getAttribute('data-start'), { spreads: plan.spreads.length, covers: plan.covers.map(function (c) { return c.num; }) }, csrf).then(function (r) {
      ver = r.ver;
      var chain = Promise.resolve();
      plan.spreads.forEach(function (sp, i) {
        chain = chain.then(room).then(function () {
          if (failed) throw failed;
          setState(done, total, 'Режем разворот ' + pad(sp.num, 2) + '…');
          return decode(sp.file);
        }).then(function (img) {
          var W = img.width, H = img.height;
          var pw = Math.min(Math.round(H * PAGE_RATIO), Math.floor(W / 2));
          if (!pageW) { pageW = pw; pageH = H; }
          var n = 's' + pad(i + 1, 2);
          return pages(n + '-l', img, 0, 0, pw, H).then(function () { return pages(n + '-r', img, W - pw, 0, pw, H); })
            .then(function () { if (img.close) img.close(); });
        });
      });
      plan.covers.forEach(function (c) {
        chain = chain.then(room).then(function () {
          if (failed) throw failed;
          setState(done, total, 'Режем обложку ' + pad(c.num, 3) + '…');
          return decode(c.file);
        }).then(function (img) {
          var W = img.width, H = img.height;
          // поля для загибов одинаковые со всех сторон, корешок посередине любой ширины
          // высота страницы — как у разворотов (файлы одного макета в одном разрешении)
          var ph = pageH && pageH <= H ? pageH : H;
          var pw = Math.min(Math.round(ph * PAGE_RATIO), Math.floor(W / 2));
          var b = Math.max(0, Math.round((H - ph) / 2));
          var n = pad(c.num, 3);
          return pages('b' + n, img, b, b, pw, ph).then(function () { return pages('c' + n, img, W - b - pw, b, pw, ph); })
            .then(function () { if (img.close) img.close(); });
        });
      });
      return chain;
    }).then(drained).then(function () {
      if (failed) throw failed;
      setState(total, total, 'Проверяем, что всё дошло…');
      return post(box.getAttribute('data-finish'), { ver: ver }, csrf);
    }).then(function () {
      window.onbeforeunload = null;
      setState(total, total, 'Готово, макет загружен');
      setTimeout(function () { location.reload(); }, 600);
    }).catch(function (err) {
      window.onbeforeunload = null;
      busy = false;
      setState(done, total, err.message + '. Попробуйте ещё раз: ученики пока видят прежний макет');
      var go = sum.querySelector('[data-lay-go]');
      if (go) go.disabled = false;
    });
  }
})();
