'use strict';

// Макет альбома для проверки учениками. Дизайнер или Артур загружает файлы макета:
// развороты 000-NN и обложки PPP-00 (PPP — номер ученика по алфавиту, кл. рук последний).
// Браузер сам режет их на страницы и ужимает, сюда приходят готовые картинки:
//   sNN-l / sNN-r — левая и правая страница разворота NN (по порядку, без пропусков),
//   cPPP / bPPP — лицевая сторона и задник обложки ученика PPP,
// у каждой две копии: крупная (до 1600 px) и маленькая с «-sm».
//
// Загрузка идёт новой версией в свою папку <dir>/<класс>/v<версия>; пока не дошли все файлы,
// ученики видят старую. Личные страницы идут по алфавиту, по одной на ученика, начиная со страницы first_page
// (страница 1 — левая страница первого разворота)

const fs = require('fs');
const path = require('path');
const { jpegSize } = require('./media');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lay_albums (
  class_id INTEGER PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  ver INTEGER NOT NULL DEFAULT 0,
  spreads INTEGER NOT NULL DEFAULT 0,
  covers TEXT NOT NULL DEFAULT '[]',
  first_page INTEGER NOT NULL DEFAULT 3,
  uploaded_at INTEGER,
  uploaded_by TEXT NOT NULL DEFAULT '',
  pending_ver INTEGER NOT NULL DEFAULT 0,
  pending_spreads INTEGER NOT NULL DEFAULT 0,
  pending_covers TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS lay_checks (
  student_id INTEGER PRIMARY KEY REFERENCES pk_students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  ok_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lay_checks_class ON lay_checks (class_id);
`;

// Поля, добавленные позже: дописываем в существующую таблицу, ничего не пересоздавая
const COLUMNS = [
  ['lay_albums', 'teacher_ok_at', 'INTEGER']
];

const SPREADS_MAX = 80;
const COVER_MAX = 199;
const FILE_MAX = 5 * 1024 * 1024;
const NAME_RE = /^(s\d{2}-[lr]|[cb]\d{3})(-sm)?$/;
const pad = (n, w) => String(n).padStart(w, '0');

function parseList(s) {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.filter(n => Number.isInteger(n) && n > 0 && n <= COVER_MAX) : []; } catch (e) { return []; }
}

// Номера учеников, как у дизайнера: по алфавиту фамилии и имени, с 1. Кл. рук — следующий после всех
function numbered(students) {
  return students.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }) || a.id - b.id)
    .map((s, i) => ({ id: s.id, name: s.name, num: i + 1 }));
}

// Личная страница по номеру ученика: разворот и сторона
function pageOf(lay, num) {
  const p = lay.first_page + num - 1;
  const spread = Math.ceil(p / 2);
  if (num < 1 || spread < 1 || spread > lay.spreads) return null;
  return { page: p, spread: spread, side: p % 2 ? 'l' : 'r' };
}

// Подпись страницы для правки: «разворот 5, левая страница», обложка — отдельно
function pageLabel(spread, side) {
  if (spread === 0) return 'обложка';
  return 'разворот ' + spread + ', ' + (side === 'l' ? 'левая' : 'правая') + ' страница';
}

class Layout {
  constructor(store, dir) {
    this.db = store.db;
    this.dir = dir;
    this.db.exec(SCHEMA);
    COLUMNS.forEach(c => {
      const have = this.db.prepare('PRAGMA table_info(' + c[0] + ')').all().map(r => r.name);
      if (have.indexOf(c[1]) === -1) this.db.exec('ALTER TABLE ' + c[0] + ' ADD COLUMN ' + c[1] + ' ' + c[2]);
    });
  }

  get(classId) {
    const r = this.db.prepare('SELECT * FROM lay_albums WHERE class_id = ?').get(classId);
    if (!r) return null;
    const out = Object.assign({}, r);
    out.covers = parseList(r.covers);
    out.pending_covers = parseList(r.pending_covers);
    return out;
  }

  // Есть ли что показать ученикам
  ready(classId) {
    const l = this.get(classId);
    return l && l.ver && l.spreads ? l : null;
  }

  verDir(classId, ver) { return path.join(this.dir, String(classId), 'v' + ver); }

  // Начать загрузку новой версии: сколько разворотов и чьи обложки придут
  start(classId, f) {
    const spreads = parseInt(f.spreads, 10);
    if (!(spreads >= 1 && spreads <= SPREADS_MAX)) return { error: 'Нет разворотов 000-01, 000-02… Проверьте названия файлов' };
    const covers = Array.from(new Set((Array.isArray(f.covers) ? f.covers : []).map(n => parseInt(n, 10)))).filter(n => n >= 1 && n <= COVER_MAX).sort((a, b) => a - b);
    const cur = this.get(classId);
    const ver = Math.max(cur ? cur.ver : 0, cur ? cur.pending_ver : 0) + 1;
    // недогруженная прошлая попытка больше не нужна
    if (cur && cur.pending_ver && cur.pending_ver !== cur.ver) fs.rmSync(this.verDir(classId, cur.pending_ver), { recursive: true, force: true });
    fs.mkdirSync(this.verDir(classId, ver), { recursive: true });
    if (cur) {
      this.db.prepare('UPDATE lay_albums SET pending_ver = ?, pending_spreads = ?, pending_covers = ? WHERE class_id = ?').run(ver, spreads, JSON.stringify(covers), classId);
    } else {
      this.db.prepare('INSERT INTO lay_albums (class_id, pending_ver, pending_spreads, pending_covers) VALUES (?, ?, ?, ?)').run(classId, ver, spreads, JSON.stringify(covers));
    }
    return { ok: true, ver: ver, files: this.expected(spreads, covers).length };
  }

  expected(spreads, covers) {
    const names = [];
    for (let i = 1; i <= spreads; i++) ['l', 'r'].forEach(s => names.push('s' + pad(i, 2) + '-' + s));
    covers.forEach(n => { names.push('c' + pad(n, 3)); names.push('b' + pad(n, 3)); });
    return names.reduce((a, n) => a.concat([n, n + '-sm']), []);
  }

  saveFile(classId, ver, name, buf) {
    const cur = this.get(classId);
    if (!cur || cur.pending_ver !== ver) return { error: 'Загрузка устарела. Начните заново' };
    if (!NAME_RE.test(name) || this.expected(cur.pending_spreads, cur.pending_covers).indexOf(name) === -1) return { error: 'Лишний файл' };
    if (!buf || buf.length > FILE_MAX) return { error: 'Файл слишком большой' };
    if (!jpegSize(buf)) return { error: 'Это не похоже на картинку JPEG' };
    const file = path.join(this.verDir(classId, ver), name + '.jpg');
    const tmp = file + '.' + process.pid + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    return { ok: true };
  }

  // Все файлы дошли — ученики сразу видят новую версию, старая удаляется
  finish(classId, ver, who) {
    const cur = this.get(classId);
    if (!cur || cur.pending_ver !== ver) return { error: 'Загрузка устарела. Начните заново' };
    const dir = this.verDir(classId, ver);
    const missing = this.expected(cur.pending_spreads, cur.pending_covers).filter(n => !fs.existsSync(path.join(dir, n + '.jpg')));
    if (missing.length) return { error: 'Дошли не все файлы (' + missing.length + '). Загрузите ещё раз', missing: missing };
    this.db.prepare('UPDATE lay_albums SET ver = ?, spreads = ?, covers = ?, uploaded_at = ?, uploaded_by = ? WHERE class_id = ?')
      .run(ver, cur.pending_spreads, JSON.stringify(cur.pending_covers), Date.now(), String(who || '').slice(0, 60), classId);
    const root = path.join(this.dir, String(classId));
    fs.readdirSync(root).forEach(d => { if (d !== 'v' + ver) fs.rmSync(path.join(root, d), { recursive: true, force: true }); });
    return { ok: true };
  }

  setFirstPage(classId, n) {
    const p = parseInt(n, 10);
    if (!(p >= 1 && p <= SPREADS_MAX * 2)) return false;
    if (!this.get(classId)) this.db.prepare('INSERT INTO lay_albums (class_id) VALUES (?)').run(classId);
    this.db.prepare('UPDATE lay_albums SET first_page = ? WHERE class_id = ?').run(p, classId);
    return true;
  }

  // Путь к картинке текущей версии, если такая есть
  file(classId, ver, name) {
    const l = this.get(classId);
    if (!l || l.ver !== ver || !NAME_RE.test(name)) return null;
    return { dir: this.verDir(classId, ver), file: name + '.jpg' };
  }

  // ---------- «всё проверил» ----------
  setOk(classId, studentId, on) {
    if (on) this.db.prepare('INSERT OR REPLACE INTO lay_checks (student_id, class_id, ok_at) VALUES (?, ?, ?)').run(studentId, classId, Date.now());
    else this.db.prepare('DELETE FROM lay_checks WHERE student_id = ?').run(studentId);
  }

  // Классный руководитель отмечает отдельно: его нет в списке учеников
  setTeacherOk(classId, on) {
    this.db.prepare('UPDATE lay_albums SET teacher_ok_at = ? WHERE class_id = ?').run(on ? Date.now() : null, classId);
  }

  oks(classId) {
    const m = new Map();
    this.db.prepare('SELECT student_id, ok_at FROM lay_checks WHERE class_id = ?').all(classId).forEach(r => m.set(r.student_id, r.ok_at));
    return m;
  }

  removeFiles(classId) {
    fs.rmSync(path.join(this.dir, String(classId)), { recursive: true, force: true });
  }
}

module.exports = { Layout, numbered, pageOf, pageLabel, SPREADS_MAX, COVER_MAX, FILE_MAX };
