// Отбор фото в админке: загрузка папки с оригиналами (в браузере делаем лёгкие копии)
// и раскладка оригиналов по папкам учеников (File System Access, Chrome на компьютере)
(function () {
  'use strict';

  var csrf = (document.querySelector('meta[name=csrf]') || {}).content || '';
  // Копии только для выбора: на экране телефона и ноутбука 1400 px не отличить от оригинала,
  // а места на сервере уходит заметно меньше
  var LG = 1400, SM = 480;
  var busy = false;

  function $(s, root) { return (root || document).querySelector(s); }

  function state(el, text, part, bad) {
    el.hidden = false;
    el.classList.toggle('is-bad', !!bad);
    $('p', el).textContent = text;
    if (part !== null && part !== undefined) $('.upl__bar i', el).style.width = Math.round(part * 100) + '%';
  }

  window.addEventListener('beforeunload', function (e) {
    if (!busy) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // ---------- загрузка ----------

  // Путь внутри выбранной папки: «Фото 11А/Парни/IMG_1.jpg» → «Парни/IMG_1.jpg»
  function relPath(file) {
    var p = (file.webkitRelativePath || file.name).split('/');
    if (p.length > 1) p.shift();
    return p.join('/');
  }

  function isJpeg(file) {
    var rel = relPath(file);
    return /\.jpe?g$/i.test(file.name) && !rel.split('/').some(function (s) { return s.charAt(0) === '.'; });
  }

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не получилось открыть ' + file.name)); };
      img.src = url;
    });
  }

  // Уменьшенная копия на холсте. Оригинал с камеры (20–45 Мп) держим в памяти как можно меньше:
  // из него делаем только большую копию, маленькую — уже из большой
  function scaled(src, max) {
    var w = src.width, h = src.height;
    var k = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    var g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function jpeg(c, quality) {
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Не получилось сжать фото')); }, 'image/jpeg', quality);
    });
  }

  function post(url, blob) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin', body: blob,
      headers: { 'Content-Type': 'image/jpeg', 'X-CSRF-Token': csrf }
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw Object.assign(new Error(j.error || 'Сервер ответил ' + r.status), { status: r.status });
        return j;
      });
    }, function () {
      throw new Error('Нет связи с сервером');
    });
  }

  function uploadOne(classId, file) {
    var rel = relPath(file);
    return decode(file).then(function (img) {
      var lgC = scaled(img, LG);
      if (img.close) img.close();
      var smC = scaled(lgC, SM);
      return Promise.all([jpeg(lgC, 0.8), jpeg(smC, 0.75)]).then(function (b) {
        lgC.width = lgC.height = smC.width = smC.height = 0;
        return post('/admin/api/media/pk/' + classId + '?path=' + encodeURIComponent(rel), b[0]).then(function (res) {
          return post('/admin/api/media/pk/' + classId + '/' + res.id + '/sm', b[1]);
        });
      });
    });
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Что нашлось в папке: разделы и сколько в каждом
  function summary(files) {
    var by = {}, order = [];
    files.forEach(function (f) {
      var parts = relPath(f).split('/');
      var sec = parts.length > 1 ? parts[0] : 'Без папки';
      if (!by[sec]) { by[sec] = 0; order.push(sec); }
      by[sec]++;
    });
    return order.map(function (s) { return '• ' + s + ': ' + by[s] + ' фото'; }).join('\n');
  }

  document.addEventListener('change', function (e) {
    var input = e.target;
    if (!input.hasAttribute || !input.hasAttribute('data-pk-upload')) return;
    var classId = input.getAttribute('data-pk-upload');
    var box = $('[data-pk-state]');
    var all = Array.prototype.slice.call(input.files || []);
    var files = all.filter(isJpeg);
    input.value = '';
    if (busy) return;
    if (!files.length) return state(box, 'В папке не нашлось фото JPG', 0, true);
    var skipped = all.length - files.length;
    var nested = files.some(function (f) { return relPath(f).split('/').length > 2; });
    if (!confirm('Нашлось ' + files.length + ' фото JPG' + (skipped ? ' (другие файлы пропустим: ' + skipped + ')' : '') + ':\n\n' + summary(files) +
      (nested ? '\n\nВнимание: внутри есть вложенные папки. Разделами станут папки первого уровня' : '') + '\n\nЗагружаем?')) return;

    busy = true;
    input.parentNode.classList.add('is-busy');
    state(box, 'Смотрим, что уже загружено…', 0);
    fetch('/admin/api/c/' + classId + '/photos/have', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Сервер ответил ' + r.status);
          return j;
        });
      })
      .then(function (j) {
        var have = {};
        (j.paths || []).forEach(function (p) { have[p] = true; });
        var queue = files.filter(function (f) { return !have[relPath(f)]; });
        var total = queue.length, done = 0, failed = [], stop = '', stopCode = 0;
        if (!total) { busy = false; input.parentNode.classList.remove('is-busy'); return state(box, 'Все ' + files.length + ' фото уже загружены', 1); }
        state(box, 'Загружаем 0 из ' + total + '. Не закрывайте страницу', 0);
        function next() {
          var f = stop ? null : queue.shift();
          if (!f) return Promise.resolve();
          // повтор через пару секунд — на случай короткого обрыва связи;
          // если вышли из админки (403) или на сервере кончается место (507) — дальше не пытаемся
          return uploadOne(classId, f).catch(function (err) {
            if (err.status === 403 || err.status === 507) throw err;
            return wait(2000).then(function () { return uploadOne(classId, f); });
          })
            .catch(function (err) {
              if (err.status === 403 || err.status === 507) { stop = err.message; stopCode = err.status; }
              failed.push(relPath(f) + ': ' + err.message);
            })
            .then(function () {
              done++;
              state(box, 'Загружаем ' + done + ' из ' + total + '. Не закрывайте страницу', done / total);
              return next();
            });
        }
        return Promise.all([next(), next()]).then(function () {
          busy = false;
          input.parentNode.classList.remove('is-busy');
          if (stop) {
            state(box, stop + '. Загружено ' + (done - failed.length) + ' из ' + total + (stopCode === 403 ? '. Войдите и выберите папку ещё раз, догрузится остальное' : ''), 1, true);
          } else if (failed.length) {
            state(box, 'Загружено ' + (total - failed.length) + ' из ' + total + '. Не получилось: ' + failed.length + '. Выберите папку ещё раз, догрузятся только они', 1, true);
            var ul = document.createElement('ul');
            failed.slice(0, 10).forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
            box.appendChild(ul);
          } else {
            state(box, 'Готово: загружено ' + total + ' фото', 1);
            setTimeout(function () { location.reload(); }, 900);
          }
        });
      })
      .catch(function (err) {
        busy = false;
        input.parentNode.classList.remove('is-busy');
        state(box, err.message || 'Не получилось загрузить', 0, true);
      });
  });

  // Сразу говорим, если устройство не подходит: папку можно выбрать только на компьютере,
  // а раскладывать умеет только Chrome (и браузеры на его основе)
  (function () {
    var touch = window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;
    var up = $('[data-pk-upload]');
    if (up && (touch || !('webkitdirectory' in up))) {
      var lab = up.parentNode;
      var p = document.createElement('p');
      p.className = 'flash flash--err';
      p.textContent = 'Загрузить папку с фото можно только с компьютера. С телефона удобно следить, кто что выбрал';
      lab.parentNode.replaceChild(p, lab);
    }
    var ex = $('[data-pk-export]');
    if (ex && (touch || !window.showDirectoryPicker)) {
      var note = document.createElement('p');
      note.className = 'flash flash--err';
      note.style.marginTop = '12px';
      note.textContent = touch ? 'Раскладка работает на компьютере в Chrome' : 'Этот браузер не умеет раскладывать по папкам. Откройте админку в Chrome';
      ex.parentNode.insertBefore(note, ex);
      ex.disabled = true;
    }
  })();

  // ---------- раскладка по папкам ----------

  // Имя папки без символов, которые нельзя в именах файлов
  function safe(s) {
    return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Без имени';
  }

  function fileAt(root, rel) {
    var parts = rel.split('/');
    var name = parts.pop();
    var p = Promise.resolve(root);
    parts.forEach(function (d) { p = p.then(function (dir) { return dir.getDirectoryHandle(d); }); });
    return p.then(function (dir) { return dir.getFileHandle(name); }).then(function (h) { return h.getFile(); });
  }

  function writeFile(dir, name, data) {
    return dir.getFileHandle(name, { create: true }).then(function (h) {
      return h.createWritable().then(function (w) {
        return w.write(data).then(function () { return w.close(); });
      });
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-pk-export]');
    if (!btn) return;
    var box = $('[data-pk-export-state]');
    if (!window.showDirectoryPicker) return state(box, 'Раскладка работает в Chrome на компьютере. Откройте админку в Chrome', 0, true);
    var classId = btn.getAttribute('data-pk-export');
    var title = safe(btn.getAttribute('data-pk-title'));
    var src, dst, plan, missing = [];

    state(box, 'Шаг 1 из 2: выберите папку с оригиналами (ту же, что загружали)', 0);
    showDirectoryPicker({ id: 'pk-src', mode: 'read' })
      .then(function (h) {
        src = h;
        state(box, 'Шаг 2 из 2: выберите, куда сложить папки', 0);
        return showDirectoryPicker({ id: 'pk-dst', mode: 'readwrite' });
      })
      .then(function (h) {
        dst = h;
        // Складывать внутрь папки с оригиналами нельзя: при следующей загрузке копии станут «новыми фото»
        return Promise.all([dst.isSameEntry ? dst.isSameEntry(src) : false, src.resolve ? src.resolve(dst) : null]);
      })
      .then(function (r) {
        if (r[0] || r[1]) throw new Error('Для раскладки выберите другую папку: не ту, где оригиналы, и не папку внутри неё');
        return fetch('/admin/api/c/' + classId + '/photos/export', { credentials: 'same-origin' }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) throw new Error(j.error || 'Сервер ответил ' + r.status);
            return j;
          });
        });
      })
      .then(function (p) {
        plan = p;
        return dst.getDirectoryHandle(title, { create: true });
      })
      .then(function (out) {
        busy = true;
        btn.disabled = true;
        var jobs = [];
        var quotes = [];
        // номер, как в макете: обложка ученика 003 — файл 003-00, папка «003 Имя»
        var num = function (n) { return n ? String(n).padStart(3, '0') + ' ' : ''; };
        plan.students.sort(function (a, b) { return (a.num || 0) - (b.num || 0); });
        plan.students.forEach(function (s) {
          if (s.quote) quotes.push(num(s.num) + s.name + ':\n' + s.quote + '\n');
          if (!s.photos.length && !s.quote) return;
          // два ученика с похожими именами не должны попасть в одну папку
          var folder = num(s.num) + safe(s.name), base = folder, k = 2;
          while (jobs.some(function (j) { return j.folder.toLowerCase() === folder.toLowerCase(); }) || folder.toLowerCase() === 'групповые' || folder.toLowerCase() === 'классный руководитель') folder = base + ' (' + k++ + ')';
          // имя файла: место, потом ученик — «обложка_Биттуев Азамат.jpg», дизайнер сразу видит, куда и чьё
          jobs.push({ folder: folder, files: s.photos, names: (s.roles || []).map(function (r) { return r ? r.toLowerCase() + '_' + safe(s.name) : ''; }), quote: s.quote });
        });
        if (plan.group.length) jobs.push({ folder: 'Групповые', files: plan.group });
        // классный руководитель: два фото с местом и пожелание классу
        var t = plan.teacher;
        if (t) {
          var who = safe(t.name || 'Кл рук');
          var tf = [], tn = [];
          if (t.cover) { tf.push(t.cover); tn.push('обложка_' + who); }
          if (t.list) { tf.push(t.list); tn.push('список класса_' + who); }
          jobs.push({ folder: num(t.num) + 'Классный руководитель', files: tf, names: tn, text: t.wish ? ['Пожелание классу.txt', (t.name ? t.name + '\n\n' : '') + t.wish + '\n'] : null });
        }
        var total = jobs.reduce(function (n, j) { return n + j.files.length; }, 0) || 1;
        var done = 0;

        function copyAll(dir, files, names) {
          var used = {};
          return files.reduce(function (p, rel, i) {
            return p.then(function () {
              var name = rel.split('/').pop();
              // фото с местом в альбоме называем по ученику и месту
              if (names && names[i]) name = names[i] + (/\.jpeg$/i.test(name) ? '.jpeg' : '.jpg');
              // одинаковые имена из разных папок не затираем
              if (used[name.toLowerCase()]) name = rel.split('/').slice(0, -1).join('-') + '-' + rel.split('/').pop();
              used[name.toLowerCase()] = true;
              return fileAt(src, rel).then(function (f) { return writeFile(dir, safe(name), f); })
                .catch(function () { missing.push(rel); })
                .then(function () { done++; state(box, 'Копируем ' + done + ' из ' + total, done / total); });
            });
          }, Promise.resolve());
        }

        return jobs.reduce(function (p, j) {
          return p.then(function () {
            return out.getDirectoryHandle(j.folder, { create: true }).then(function (dir) {
              var q = j.quote ? writeFile(dir, 'Цитата.txt', j.quote + '\n') : j.text ? writeFile(dir, j.text[0], j.text[1]) : Promise.resolve();
              return q.then(function () { return copyAll(dir, j.files, j.names); });
            });
          });
        }, Promise.resolve()).then(function () {
          return quotes.length ? writeFile(out, 'Цитаты.txt', quotes.join('\n')) : null;
        }).then(function () {
          // та же таблица для Excel: «Ученик; Цитата», дизайнеру удобно копировать из ячеек
          var cell = function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; };
          var rows = plan.students.filter(function (s) { return s.quote; }).map(function (s) { return cell(num(s.num).trim()) + ';' + cell(s.name) + ';' + cell(s.quote); });
          return rows.length ? writeFile(out, 'Цитаты.csv', '\ufeff' + ['Номер;Ученик;Цитата'].concat(rows).join('\r\n') + '\r\n') : null;
        }).then(function () {
          var empty = plan.students.filter(function (s) { return !s.photos.length; }).map(function (s) { return s.name; });
          var msg = 'Готово: папка «' + title + '»';
          if (missing.length === total && total > 1) msg = 'Ни одного оригинала не нашлось. Похоже, на шаге 1 выбрана не та папка. Нужна та, внутри которой «Парни», «Девочки», «Групповые»';
          else if (missing.length) msg += '. Не нашлись оригиналы: ' + missing.length;
          state(box, msg, 1, missing.length > 0);
          if (missing.length || empty.length) {
            var ul = document.createElement('ul');
            missing.slice(0, 10).forEach(function (t) { var li = document.createElement('li'); li.textContent = 'нет файла: ' + t; ul.appendChild(li); });
            if (empty.length) { var li = document.createElement('li'); li.textContent = 'ещё не выбрали фото: ' + empty.join(', '); ul.appendChild(li); }
            box.appendChild(ul);
          }
        });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return state(box, 'Отменено', 0);
        state(box, (err && err.message) || 'Не получилось разложить', 0, true);
      })
      .then(function () { busy = false; btn.disabled = false; });
  });
})();
