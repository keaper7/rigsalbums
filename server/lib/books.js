'use strict';

// Листающиеся альбомы на странице «Работы». Артур добавляет их сам из админки теми же файлами,
// что для типографии: развороты 000-NN и обложка 001-00. Браузер режет и ужимает их (public/layout.js),
// сюда приходят готовые страницы: sNN-l / sNN-r, front / back (лицо и задник обложки), каждая
// крупная и маленькая (-sm).
//
// Четыре альбома с главной (assets/book1…book4) лежат на сайте файлами и стоят в списке сразу,
// их можно убрать или переставить так же, как загруженные. Загруженные живут в <dir>/<id>/v<версия>:
// пока новая версия не дошла целиком, на сайте показывается прежняя

const fs = require('fs');
const path = require('path');
const { jpegSize } = require('./media');
const { esc } = require('./util');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS site_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  base TEXT NOT NULL DEFAULT '',
  spreads INTEGER NOT NULL DEFAULT 0,
  board TEXT NOT NULL DEFAULT '#3B2A22',
  spine TEXT NOT NULL DEFAULT '#2A1D17',
  pos INTEGER NOT NULL DEFAULT 0,
  ver INTEGER NOT NULL DEFAULT 0,
  pending_ver INTEGER NOT NULL DEFAULT 0,
  pending_spreads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
`;

const SPREADS_MAX = 60;
const FILE_MAX = 5 * 1024 * 1024;
const NAME_RE = /^(s\d{2}-[lr]|front|back)(-sm)?$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const pad = n => String(n).padStart(2, '0');

// Альбомы с главной: файлы на сайте, цвета края — как на главной
const BUILTIN = [
  { title: 'Альбом 1', base: 'assets/book1/', spreads: 12, board: '#3B2A22', spine: '#2A1D17' },
  { title: 'Альбом 2', base: 'assets/book2/', spreads: 13, board: '#8E6646', spine: '#6E4C33' },
  { title: 'Альбом 3', base: 'assets/book3/', spreads: 12, board: '#CDC8C4', spine: '#ABA5A0' },
  { title: 'Альбом 4', base: 'assets/book4/', spreads: 9, board: '#ECE9E6', spine: '#CFCAC5' }
];

class Books {
  constructor(store, dir, onChange) {
    this.db = store.db;
    this.store = store;
    this.dir = dir;
    this.onChange = onChange || (() => {});
    this.db.exec(SCHEMA);
    // первый запуск: четыре альбома с главной сразу в списке (один раз, потом Артур решает сам)
    if (!store.getSetting('books.seeded', false)) {
      if (!this.db.prepare('SELECT 1 FROM site_books LIMIT 1').get()) {
        const ins = this.db.prepare('INSERT INTO site_books (title, base, spreads, board, spine, pos, ver, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
        BUILTIN.forEach((b, i) => ins.run(b.title, b.base, b.spreads, b.board, b.spine, i + 1, Date.now()));
      }
      store.setSetting('books.seeded', true);
    }
  }

  // Готовые альбомы по порядку
  list() {
    return this.db.prepare('SELECT * FROM site_books WHERE ver > 0 AND spreads > 0 ORDER BY pos, id').all();
  }

  get(id) { return this.db.prepare('SELECT * FROM site_books WHERE id = ?').get(id) || null; }

  verDir(id, ver) { return path.join(this.dir, String(id), 'v' + ver); }

  expected(spreads) {
    const names = ['front', 'back'];
    for (let i = 1; i <= spreads; i++) names.push('s' + pad(i) + '-l', 's' + pad(i) + '-r');
    return names.reduce((a, n) => a.concat([n, n + '-sm']), []);
  }

  // Начать загрузку: новый альбом (id нет) или новая версия существующего загруженного
  start(f) {
    const spreads = parseInt(f.spreads, 10);
    if (!(spreads >= 1 && spreads <= SPREADS_MAX)) return { error: 'Нет разворотов 000-01, 000-02… Проверьте названия файлов' };
    const covers = Array.isArray(f.covers) ? f.covers : [];
    if (!covers.length) return { error: 'Нет обложки: нужен файл 001-00' };
    let id = parseInt(f.id, 10) || 0;
    const title = String(f.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (id) {
      const b = this.get(id);
      if (!b || b.base.indexOf('assets/') === 0) return { error: 'Этот альбом нельзя заменить, загрузите новый' };
    } else {
      const pos = (this.db.prepare('SELECT MAX(pos) AS p FROM site_books').get().p || 0) + 1;
      id = Number(this.db.prepare('INSERT INTO site_books (title, pos, created_at) VALUES (?, ?, ?)').run(title || 'Альбом', pos, Date.now()).lastInsertRowid);
    }
    const b = this.get(id);
    const ver = Math.max(b.ver, b.pending_ver) + 1;
    if (b.pending_ver && b.pending_ver !== b.ver) fs.rmSync(this.verDir(id, b.pending_ver), { recursive: true, force: true });
    fs.mkdirSync(this.verDir(id, ver), { recursive: true });
    this.db.prepare('UPDATE site_books SET pending_ver = ?, pending_spreads = ? WHERE id = ?').run(ver, spreads, id);
    return { ok: true, id: id, ver: ver };
  }

  // Загрузчик присылает обложку как c001 / b001: на сайте это лицо и задник альбома
  saveFile(id, ver, name, buf) {
    const b = this.get(id);
    if (!b || b.pending_ver !== ver) return { error: 'Загрузка устарела. Начните заново' };
    const n = String(name).replace(/^c\d{3}(?=-sm$|$)/, 'front').replace(/^b\d{3}(?=-sm$|$)/, 'back');
    if (!NAME_RE.test(n) || this.expected(b.pending_spreads).indexOf(n) === -1) return { error: 'Лишний файл' };
    if (!buf || buf.length > FILE_MAX) return { error: 'Файл слишком большой' };
    if (!jpegSize(buf)) return { error: 'Это не похоже на картинку JPEG' };
    const file = path.join(this.verDir(id, ver), n + '.jpg');
    const tmp = file + '.' + process.pid + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    return { ok: true };
  }

  finish(id, ver) {
    const b = this.get(id);
    if (!b || b.pending_ver !== ver) return { error: 'Загрузка устарела. Начните заново' };
    const dir = this.verDir(id, ver);
    const missing = this.expected(b.pending_spreads).filter(n => !fs.existsSync(path.join(dir, n + '.jpg')));
    if (missing.length) return { error: 'Дошли не все файлы (' + missing.length + '). Загрузите ещё раз', missing: missing };
    this.db.prepare('UPDATE site_books SET ver = ?, spreads = ?, base = ? WHERE id = ?').run(ver, b.pending_spreads, '/books/' + id + '/v' + ver + '/', id);
    const root = path.join(this.dir, String(id));
    fs.readdirSync(root).forEach(d => { if (d !== 'v' + ver) fs.rmSync(path.join(root, d), { recursive: true, force: true }); });
    this.onChange();
    return { ok: true };
  }

  update(id, f) {
    const b = this.get(id);
    if (!b) return false;
    const title = String(f.title || '').replace(/\s+/g, ' ').trim().slice(0, 60) || b.title;
    const board = COLOR_RE.test(f.board || '') ? f.board : b.board;
    const spine = COLOR_RE.test(f.spine || '') ? f.spine : b.spine;
    this.db.prepare('UPDATE site_books SET title = ?, board = ?, spine = ? WHERE id = ?').run(title, board, spine, id);
    this.onChange();
    return true;
  }

  // Сдвинуть в списке на одно место вверх (-1) или вниз (+1)
  move(id, dir) {
    const all = this.db.prepare('SELECT id FROM site_books ORDER BY pos, id').all().map(r => r.id);
    const i = all.indexOf(id), j = i + (dir < 0 ? -1 : 1);
    if (i === -1 || j < 0 || j >= all.length) return false;
    all.splice(j, 0, all.splice(i, 1)[0]);
    const upd = this.db.prepare('UPDATE site_books SET pos = ? WHERE id = ?');
    all.forEach((x, k) => upd.run(k + 1, x));
    this.onChange();
    return true;
  }

  remove(id) {
    if (!this.get(id)) return false;
    this.db.prepare('DELETE FROM site_books WHERE id = ?').run(id);
    fs.rmSync(path.join(this.dir, String(id)), { recursive: true, force: true });
    this.onChange();
    return true;
  }

  // Картинка загруженного альбома текущей версии
  file(id, ver, name) {
    const b = this.get(id);
    if (!b || b.ver !== ver || !NAME_RE.test(name)) return null;
    return { dir: this.verDir(id, ver), file: name + '.jpg' };
  }

  // Блок на странице «Работы»: листающийся альбом и обложки для выбора, как на главной
  html() {
    const list = this.list();
    if (!list.length) return '';
    const first = list[0];
    return '<section class="flip works-books" id="albums">\n  <div class="wrap">\n    <div class="flip__head rv">\n' +
      '      <p class="eyebrow">Альбомы целиком</p>\n      <h2 class="h2">Полистайте <em>готовые альбомы</em></h2>\n' +
      '      <p class="lede">Нажмите на страницу, смахните или листайте стрелками. Ниже можно выбрать другой альбом.</p>\n    </div>\n' +
      '    <div class="bk" data-book data-base="' + esc(first.base) + '" style="--bk-board: ' + esc(first.board) + '; --bk-spine: ' + esc(first.spine) + '" data-spreads="' + first.spreads + '" tabindex="0" aria-label="Альбом: листайте стрелками влево и вправо">\n' +
      '      <div class="bk__stage"><div class="bk__book"></div></div>\n' +
      '      <div class="bk__bar">\n        <button class="bk__btn" type="button" data-bk-prev aria-label="Назад">‹</button>\n' +
      '        <span class="bk__label" data-bk-label aria-live="polite">Обложка</span>\n' +
      '        <button class="bk__btn" type="button" data-bk-next aria-label="Вперёд">›</button>\n' +
      '        <button class="bk__zoom" type="button" data-bk-zoom>Крупно</button>\n      </div>\n' +
      (list.length > 1 ? '      <div class="bk__more">\n        <p class="bk__more-t">Выберите альбом</p>\n        <div class="bk__picks">' +
        list.map((b, i) => '<button class="bk__pick' + (i ? '' : ' is-on') + '" type="button" data-bk-album data-base="' + esc(b.base) + '" data-board="' + esc(b.board) + '" data-spine="' + esc(b.spine) + '" data-spreads="' + b.spreads + '" aria-pressed="' + (i ? 'false' : 'true') + '" aria-label="' + esc(b.title) + '"><img src="' + esc(b.base + 'front-sm.jpg') + '" alt="" loading="lazy" draggable="false"></button>').join('') +
        '</div>\n      </div>\n' : '') +
      '    </div>\n  </div>\n</section>\n';
  }
}

module.exports = { Books, SPREADS_MAX, FILE_MAX, BUILTIN };
