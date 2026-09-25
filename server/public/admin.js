(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var csrfMeta = $('meta[name="csrf"]');
  var CSRF = csrfMeta ? csrfMeta.getAttribute('content') : '';

  function toast(text, bad) {
    var t = $('.toast');
    if (!t) return;
    t.textContent = text;
    t.classList.toggle('is-bad', !!bad);
    t.hidden = false;
    clearTimeout(t.tm);
    t.tm = setTimeout(function () { t.hidden = true; }, bad ? 6000 : 2600);
  }

  // Подтверждение для необратимых действий: на форме или на конкретной кнопке
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-confirm]');
    if (b && !window.confirm(b.getAttribute('data-confirm'))) e.preventDefault();
  }, true);

  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) { e.preventDefault(); return; }
    // Защита от двойного нажатия
    var btns = $$('button[type="submit"]', e.target);
    setTimeout(function () { btns.forEach(function (b) { b.disabled = true; b.setAttribute('data-busy', ''); }); }, 0);
  });
  window.addEventListener('pageshow', function () {
    $$('[data-busy]').forEach(function (b) { b.disabled = false; b.removeAttribute('data-busy'); });
  });

  function copy(text, btn) {
    function done() {
      if (btn.classList.contains('row__copy')) {
        btn.classList.add('is-done');
        setTimeout(function () { btn.classList.remove('is-done'); }, 1600);
        toast('Ссылка скопирована, можно вставлять в чат');
        return;
      }
      if (btn.classList.contains('ic')) {
        var old = btn.textContent;
        btn.textContent = '✓';
        btn.classList.add('is-done');
        setTimeout(function () { btn.textContent = old; btn.classList.remove('is-done'); }, 1600);
        toast('Ссылка скопирована');
        return;
      }
      var was = btn.textContent;
      btn.textContent = 'Скопировано';
      btn.classList.add('is-done');
      setTimeout(function () { btn.textContent = was; btn.classList.remove('is-done'); }, 1800);
    }
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); done(); } catch (err) { toast('Не получилось скопировать', true); }
      document.body.removeChild(t);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('[data-copy]');
    if (c) { e.preventDefault(); copy(c.getAttribute('data-copy'), c); return; }
    // На телефоне открываем системное меню «Поделиться», иначе ссылка WhatsApp
    var s = e.target.closest && e.target.closest('[data-share]');
    if (s && navigator.share) {
      e.preventDefault();
      navigator.share({ text: s.getAttribute('data-share-text') }).catch(function () {});
      return;
    }
    var eye = e.target.closest && e.target.closest('[data-eye]');
    if (eye) {
      var inp = eye.parentNode.querySelector('input');
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      eye.textContent = show ? 'Скрыть' : 'Показать';
    }
  });

  // Поиск по списку классов
  var search = $('[data-search]');
  if (search) {
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var any = false;
      $$('[data-group]').forEach(function (g) {
        var shown = 0;
        $$('[data-find]', g).forEach(function (row) {
          var hit = !q || row.getAttribute('data-find').indexOf(q) !== -1;
          row.hidden = !hit;
          if (hit) shown++;
        });
        g.hidden = !shown;
        if (shown) any = true;
        if (q && shown && g.tagName === 'DETAILS') g.open = true;
      });
      $('.search__none').hidden = any;
    });
  }

  // Обратный отсчёт: до конца голосования или до запланированного старта
  var skew = 0;
  var cnt = $('.count[data-now]');
  if (cnt) skew = +cnt.getAttribute('data-now') - Date.now();
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h ? h + ':' + two(m) + ':' + two(s % 60) : m + ':' + two(s % 60);
  }
  var ended = false;
  function tick() {
    var now = Date.now() + skew;
    $$('[data-ends]').forEach(function (el) {
      var left = +el.getAttribute('data-ends') - now;
      var t = el.querySelector('b') || el;
      t.textContent = fmt(left);
      if (left <= 0 && el.classList.contains('count') && !ended) {
        ended = true;
        setTimeout(function () { location.reload(); }, 1500);
      }
    });
  }
  if ($('[data-ends]')) { tick(); setInterval(tick, 1000); }

  // Голоса обновляются сами, пока идёт голосование
  var box = $('[data-refresh]');
  if (box && window.fetch) {
    var url = box.getAttribute('data-refresh');
    setInterval(function () {
      if (document.hidden) return;
      fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) return null;
        if (r.headers.get('X-Status') !== 'open') { location.reload(); return null; }
        return r.text();
      }).then(function (html) {
        if (!html) return;
        var cur = $('[data-refresh]');
        if (!cur) return;
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        if (tmp.firstElementChild) cur.parentNode.replaceChild(tmp.firstElementChild, cur);
      }).catch(function () {});
    }, 8000);
  }

  // =========================================================
  // Загрузка фото и видео
  // Фото уменьшаем прямо в телефоне: большое (до 1800 px) и маленькое (до 1000 px)
  // =========================================================

  function send(url, body, type, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', url, true);
      x.setRequestHeader('X-Csrf-Token', CSRF);
      if (type) x.setRequestHeader('Content-Type', type);
      if (onProgress && x.upload) {
        x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      }
      x.onload = function () {
        var res = null;
        try { res = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300 && res) resolve(res);
        else reject(new Error(res && res.error ? res.error : 'Не получилось загрузить. Проверьте интернет и попробуйте ещё раз'));
      };
      x.onerror = function () { reject(new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз')); };
      x.send(body);
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Не получилось открыть «' + file.name + '». Попробуйте фото в формате JPG'));
      };
      img.src = url;
    });
  }

  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Не получилось обработать фото')); }, 'image/jpeg', quality);
        return;
      }
      var data = canvas.toDataURL('image/jpeg', quality);
      var bin = atob(data.split(',')[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      resolve(new Blob([arr], { type: 'image/jpeg' }));
    });
  }

  // Уменьшаем в несколько шагов: так фото получается чётче, чем за один раз
  function shrink(img, max, quality) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var k = Math.min(1, max / Math.max(w, h));
    var tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
    var src = img, sw = w, sh = h;
    while (sw / 2 >= tw * 1.4) {
      var half = document.createElement('canvas');
      half.width = Math.round(sw / 2); half.height = Math.round(sh / 2);
      var hc = half.getContext('2d');
      hc.imageSmoothingQuality = 'high';
      hc.drawImage(src, 0, 0, half.width, half.height);
      src = half; sw = half.width; sh = half.height;
    }
    var c = document.createElement('canvas');
    c.width = tw; c.height = th;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, tw, th);
    return toBlob(c, quality);
  }

  function uploadImage(file, onProgress) {
    if (file.type && file.type.indexOf('image/') !== 0) return Promise.reject(new Error('«' + file.name + '» не похоже на фото'));
    return loadImage(file).then(function (r) {
      return shrink(r.img, 1800, 0.85).then(function (lg) {
        return shrink(r.img, 1000, 0.8).then(function (sm) {
          URL.revokeObjectURL(r.url);
          return send('/admin/api/media', lg, 'image/jpeg', function (p) { onProgress(p * 0.8); }).then(function (res) {
            return send('/admin/api/media/' + res.id + '/sm', sm, 'image/jpeg', function (p) { onProgress(0.8 + p * 0.2); })
              .then(function () { return res; });
          });
        });
      });
    });
  }

  // Кадр для обложки видео, пока оно не загрузилось на странице
  function posterFrom(file) {
    return new Promise(function (resolve) {
      var v = document.createElement('video');
      var url = URL.createObjectURL(file);
      var finished = false;
      function finish(blob) {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        resolve(blob || null);
      }
      setTimeout(function () { finish(null); }, 10000);
      v.muted = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.onloadeddata = function () {
        try { v.currentTime = Math.min(1, (v.duration || 2) / 3); } catch (e) { finish(null); }
      };
      v.onseeked = function () {
        var w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) return finish(null);
        var k = Math.min(1, 1400 / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        try {
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          toBlob(c, 0.82).then(finish, function () { finish(null); });
        } catch (e) { finish(null); }
      };
      v.onerror = function () { finish(null); };
      v.src = url;
      try { v.load(); } catch (e) {}
    });
  }

  function state(input) {
    var root = input.closest('.slotrow, .cover, .card, form') || document.body;
    var st = $('.upl__state', root);
    return {
      show: function (text, part) {
        if (!st) return;
        st.hidden = false;
        st.classList.remove('is-bad');
        $('p', st).textContent = text;
        $('.upl__bar i', st).style.width = Math.round((part || 0) * 100) + '%';
      },
      fail: function (text) {
        if (!st) { toast(text, true); return; }
        st.hidden = false;
        st.classList.add('is-bad');
        $('p', st).textContent = text;
      }
    };
  }

  function busy(input, on) {
    var label = input.closest('label');
    if (label) label.classList.toggle('is-busy', on);
    input.disabled = on;
  }

  function goBack(input) {
    var back = input.getAttribute('data-back');
    if (!back) { location.reload(); return; }
    var here = location.pathname + location.search;
    var next = back.split('#')[0];
    location.href = back;
    // Если адрес тот же и отличается только якорем, страница сама не перезагрузится
    if (next === here) setTimeout(function () { location.reload(); }, 50);
  }

  function assign(input, body) {
    return send(input.getAttribute('data-url'), JSON.stringify(body), 'application/json');
  }

  function uploadImages(input, files) {
    var st = state(input);
    var ids = [], errors = [];
    var total = files.length;
    var i = 0;
    function next() {
      if (i >= total) return Promise.resolve();
      var f = files[i];
      var label = total > 1 ? 'Загружаю ' + (i + 1) + ' из ' + total : 'Загружаю фото';
      st.show(label + '…', i / total);
      return uploadImage(f, function (p) { st.show(label + '…', (i + p) / total); })
        .then(function (res) { ids.push(res.id); }, function (err) { errors.push(err.message); })
        .then(function () { i++; return next(); });
    }
    return next().then(function () {
      if (!ids.length) throw new Error(errors[0] || 'Не получилось загрузить');
      st.show('Сохраняю…', 1);
      var mode = input.getAttribute('data-upload');
      return assign(input, mode === 'slot' ? { media: ids[0] } : { media: ids }).then(function () {
        if (errors.length) window.alert('Загружено ' + ids.length + ' из ' + total + '. Не получилось: ' + errors.join('; '));
      });
    });
  }

  function uploadVideo(input, file) {
    var st = state(input);
    if (file.size > 400 * 1024 * 1024) return Promise.reject(new Error('Видео больше 400 МБ. Его лучше укоротить или отправить себе в WhatsApp и загрузить оттуда'));
    st.show('Готовлю видео…', 0);
    return posterFrom(file).then(function (poster) {
      var type = file.type && file.type.indexOf('video/') === 0 ? file.type : 'video/mp4';
      return send('/admin/api/media', file, type, function (p) {
        st.show('Загружаю видео: ' + Math.round(p * 100) + '%', p * 0.95);
      }).then(function (vid) {
        if (!poster) return { media: vid.id };
        st.show('Сохраняю обложку…', 0.97);
        return send('/admin/api/media', poster, 'image/jpeg').then(function (img) {
          return { media: vid.id, poster: img.id };
        }, function () { return { media: vid.id }; });
      });
    }).then(function (body) {
      st.show('Сохраняю…', 1);
      return assign(input, body);
    });
  }

  document.addEventListener('change', function (e) {
    var input = e.target;
    if (!input.matches || !input.matches('input[data-upload]')) return;
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    var mode = input.getAttribute('data-upload');
    busy(input, true);
    var job = mode === 'video' ? uploadVideo(input, files[0]) : uploadImages(input, mode === 'slot' ? files.slice(0, 1) : files);
    job.then(function () {
      goBack(input);
    }, function (err) {
      busy(input, false);
      input.value = '';
      state(input).fail(err.message || 'Не получилось загрузить');
    });
  });

  // Новый класс: выбрали образец — подставляем его школу, год и длительность
  document.addEventListener('change', function (e) {
    var sel = e.target;
    if (!sel.hasAttribute || !sel.hasAttribute('data-from')) return;
    var opt = sel.options[sel.selectedIndex];
    var form = sel.form;
    if (!opt || opt.value === '0') return;
    var school = form.elements.school;
    if (!school.value || school.getAttribute('data-auto') === school.value) {
      school.value = opt.getAttribute('data-school');
      school.setAttribute('data-auto', school.value);
    }
    form.elements.year.value = opt.getAttribute('data-year');
    var dur = form.elements.duration_min, v = opt.getAttribute('data-duration');
    for (var i = 0; i < dur.options.length; i++) if (dur.options[i].value === v) dur.selectedIndex = i;
  });

  // Несохранённые правки: подсвечиваем кнопку и переспрашиваем перед уходом со страницы
  var dirty = [];
  function markDirty(e) {
    var form = e.target.form;
    if (!form || !form.classList.contains('form') || e.target.type === 'file' || e.target.type === 'password' || e.target.hasAttribute('data-from')) return;
    if (form.classList.contains('is-dirty')) return;
    form.classList.add('is-dirty');
    dirty.push(form);
    var btn = form.querySelector('[type=submit].b--main');
    if (btn && !form.querySelector('.dirty-note')) {
      var p = document.createElement('p');
      p.className = 'dirty-note';
      p.textContent = 'Есть несохранённые изменения';
      btn.parentNode.insertBefore(p, btn.nextSibling);
    }
  }
  document.addEventListener('input', markDirty);
  document.addEventListener('change', markDirty);
  document.addEventListener('submit', function (e) {
    if (!e.defaultPrevented) dirty = dirty.filter(function (f) { return f !== e.target; });
  });
  window.addEventListener('beforeunload', function (e) {
    if (!dirty.length) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // Ссылка с #блоком ведёт к свёрнутому блоку — раскрываем его
  function openHash() {
    var id = location.hash.slice(1);
    var el = id && document.getElementById(id);
    if (el && el.tagName === 'DETAILS') el.open = true;
  }
  openHash();
  window.addEventListener('hashchange', openHash);
})();
