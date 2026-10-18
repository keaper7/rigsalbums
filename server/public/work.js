// Работа над альбомами: форма правки у Артура и действия дизайнера без перезагрузки формы
(function () {
  'use strict';

  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(text, bad) {
    var t = document.querySelector('.toast');
    if (!t) return;
    t.textContent = text;
    t.classList.toggle('is-bad', !!bad);
    t.hidden = false;
    clearTimeout(t.tm);
    t.tm = setTimeout(function () { t.hidden = true; }, bad ? 6000 : 2200);
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.error) throw new Error(j.error || 'Не получилось. Попробуйте ещё раз');
        return j;
      });
    }, function () { throw new Error('Нет связи. Проверьте интернет и попробуйте ещё раз'); });
  }

  function saved(f) { f.dispatchEvent(new Event('form:saved', { bubbles: true })); }

  // После действия страница обновляется на том же месте
  var KEY = 'wk-scroll:' + location.pathname;
  function reload() {
    try { sessionStorage.setItem(KEY, String(window.scrollY)); } catch (e) {}
    location.reload();
  }
  try {
    var y = sessionStorage.getItem(KEY);
    if (y !== null) { sessionStorage.removeItem(KEY); window.scrollTo(0, +y); }
  } catch (e) {}

  // ---------- дизайнер: формы отправляются как JSON ----------
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.hasAttribute || !f.hasAttribute('data-dw')) return;
    e.preventDefault();
    var body = {};
    $$('input, textarea, select', f).forEach(function (el) { if (el.name) body[el.name] = el.value; });
    var btns = $$('button', f);
    btns.forEach(function (b) { b.disabled = true; });
    post(f.getAttribute('action'), body).then(function () { saved(f); reload(); }, function (err) {
      btns.forEach(function (b) { b.disabled = false; });
      toast(err.message, true);
    });
  }, true);

  // Галочки «что сделано» сохраняются сразу
  $$('input[data-part]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      cb.disabled = true;
      post(cb.getAttribute('data-url'), { part: cb.getAttribute('data-part'), on: cb.checked })
        .then(function () { toast(cb.checked ? 'Отмечено' : 'Отметка снята'); }, function (err) { cb.checked = !cb.checked; toast(err.message, true); })
        .then(function () { cb.disabled = false; });
    });
  });

  // ---------- Артур: галочки этапов сохраняются сразу ----------
  var csrfMeta = document.querySelector('meta[name="csrf"]');
  $$('input[data-step]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var box = cb.closest('[data-stage]');
      var before = document.querySelector('.wk-stg.is-now');
      cb.disabled = true;
      fetch(cb.getAttribute('data-url'), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfMeta ? csrfMeta.getAttribute('content') : '' },
        body: JSON.stringify({ step: cb.getAttribute('data-step'), on: cb.checked })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || j.error) throw new Error(j.error || 'Не получилось сохранить');
          return j;
        });
      }, function () { throw new Error('Нет связи. Проверьте интернет'); }).then(function (j) {
        cb.closest('li').classList.toggle('is-on', cb.checked);
        var nowIndex = before ? +before.getAttribute('data-stage') : -1;
        // класс перешёл на другой этап — перерисуем страницу, чтобы открылся нужный
        if (j.stage !== nowIndex) { toast(j.finished ? 'Класс готов' : 'Следующий этап'); setTimeout(reload, 500); return; }
        var n = box.querySelectorAll('input[data-step]:checked').length;
        var all = box.querySelectorAll('input[data-step]').length;
        var c = box.querySelector('[data-stage-count]');
        if (c) c.textContent = n + ' из ' + all;
        toast(cb.checked ? 'Отмечено' : 'Отметка снята');
      }, function (err) {
        cb.checked = !cb.checked;
        toast(err.message, true);
      }).then(function () { cb.disabled = false; });
    });
  });

  // ---------- Артур: форма правки ----------
  // «Заменить цитату» сразу подставляет цитату ученика из отбора — остаётся поправить.
  // Для группового фото — что убрать и что поставить, к остальным можно приложить фото или скрин
  $$('.wk-fixform').forEach(function (f) {
    var ta = f.querySelector('textarea');
    var quote = f.getAttribute('data-quote') || '';
    var attach = f.querySelector('[data-attach]');
    if (attach) attach.hidden = false;
    function kind() { var r = f.querySelector('input[name=kind]:checked'); return r ? r.value : ''; }
    function picks() {
      var k = kind();
      $$('.wk-pick', f).forEach(function (l) {
        l.hidden = (' ' + l.getAttribute('data-for') + ' ').indexOf(' ' + k + ' ') === -1;
      });
    }
    $$('input[name=kind]', f).forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        ta.placeholder = r.getAttribute('data-hint') || '';
        var keep = ta.value && ta.value !== quote;
        if (r.value === 'quote' || r.value === 'typo') { if (!keep) ta.value = quote; }
        else if (!keep) ta.value = '';
        picks();
      });
    });
    picks();
    // выбранные файлы видно прямо на кнопке
    $$('.wk-pick input[type=file]', f).forEach(function (inp) {
      var small = inp.parentNode.querySelector('small');
      var was = small.textContent;
      inp.addEventListener('change', function () {
        var n = inp.files.length;
        small.textContent = n ? (n === 1 ? inp.files[0].name : 'выбрано: ' + n) : was;
        inp.parentNode.classList.toggle('is-on', !!n);
      });
    });
    f.addEventListener('submit', function (e) {
      var files = [];
      $$('.wk-pick', f).forEach(function (l) {
        if (l.hidden) return;
        var inp = l.querySelector('input[type=file]');
        Array.prototype.forEach.call(inp.files, function (file) { files.push({ file: file, label: inp.getAttribute('data-label') }); });
      });
      if (!files.length) return;
      e.preventDefault();
      if (files.length > 6) return toast('К одной правке можно прикрепить до 6 фото', true);
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Сохраняем…';
      var token = csrfMeta ? csrfMeta.getAttribute('content') : '';
      fetchJson(f.getAttribute('data-api'), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ student: f.querySelector('[name=student]').value, kind: kind(), text: ta.value, files: files.length })
      }).then(function (j) {
        var failed = 0, i = 0;
        return files.reduce(function (p, x) {
          return p.then(function () {
            btn.textContent = 'Загружаем фото ' + (++i) + ' из ' + files.length;
            return shrink(x.file).then(function (blob) {
              return fetchJson(f.getAttribute('data-upload') + j.id + '?label=' + encodeURIComponent(x.label), {
                method: 'POST', credentials: 'same-origin', body: blob,
                headers: { 'Content-Type': 'image/jpeg', 'x-csrf-token': token }
              });
            }).catch(function () { failed++; });
          });
        }, Promise.resolve()).then(function () {
          saved(f);
          location.href = location.pathname + '?m=' + (failed ? 'fixpart' : 'fix') + '#fixes';
        });
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Добавить правку';
        toast(err.message, true);
      });
    });
  });

  function fetchJson(u, opts) {
    return fetch(u, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.error) throw new Error(j.error || 'Не получилось сохранить');
        return j;
      });
    }, function () { throw new Error('Нет связи. Проверьте интернет'); });
  }

  // Скрин или фото с телефона ужимаем до 1800 px: дизайнеру хватит, загрузка быстрая
  function shrink(file) {
    var load = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : new Promise(function (ok, bad) {
        var img = new Image();
        img.onload = function () { ok(img); };
        img.onerror = function () { bad(new Error('Не получилось открыть фото')); };
        img.src = URL.createObjectURL(file);
      });
    return load.then(function (src) {
      var k = Math.min(1, 1800 / Math.max(src.width, src.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * k));
      c.height = Math.max(1, Math.round(src.height * k));
      var g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0, c.width, c.height);
      return new Promise(function (ok, bad) {
        c.toBlob(function (b) { b ? ok(b) : bad(new Error('Не получилось сжать фото')); }, 'image/jpeg', 0.86);
      });
    });
  }

  // ---------- Артур: поиск и фильтры на доске ----------
  // Поиск по тексту, «Без предоплаты» и школы. Школ можно выбрать несколько. Пустые этапы прячутся
  var box = document.querySelector('[data-wkfilter]');
  if (box) {
    var q = box.querySelector('[data-wk-q]');
    var none = box.querySelector('[data-wk-none]');
    var norm = function (t) { return String(t || '').toLowerCase().replace(/ё/g, 'е'); };
    var apply = function () {
      var text = norm(q.value).trim();
      var digits = text.replace(/\D/g, '').replace(/^[78](?=\d{6,})/, '');
      var noPre = box.querySelector('[data-f-noprepay][aria-pressed=true]');
      var schools = $$('[data-f-school][aria-pressed=true]', box).map(function (b) { return b.getAttribute('data-f-school'); });
      var shown = 0;
      $$('.wk-card[data-find]').forEach(function (c) {
        var hay = norm(c.getAttribute('data-find'));
        var ok = (!text || hay.indexOf(text) !== -1 || (digits.length >= 3 && hay.replace(/\D/g, '').indexOf(digits) !== -1)) &&
          (!noPre || c.getAttribute('data-noprepay') === '1') &&
          (!schools.length || schools.indexOf(c.getAttribute('data-school')) !== -1);
        c.hidden = !ok;
        if (ok) shown++;
      });
      $$('.wk-stage').forEach(function (g) {
        var any = g.querySelector('.wk-card:not([hidden])');
        g.hidden = !any;
        // при фильтре «Готово» раскрываем, иначе найденное не видно
        if (g.tagName === 'DETAILS' && (text || noPre || schools.length) && any) g.open = true;
      });
      if (none) none.hidden = shown > 0;
    };
    q.addEventListener('input', apply);
    $$('[data-f-noprepay], [data-f-school]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        apply();
      });
    });
  }

  // Открыть ученика по ссылке #st-12
  if (/^#st-/.test(location.hash)) {
    var d = document.querySelector(location.hash);
    if (d && d.tagName === 'DETAILS') d.open = true;
  }
})();
