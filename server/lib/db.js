'use strict';

const fs = require('fs');
const path = require('path');

// node:sqlite пока помечен как экспериментальный и пишет предупреждение при старте
const emitWarning = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String(w && w.message || w).indexOf('SQLite') !== -1) return;
  return emitWarning.call(process, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

const STEPS = ['theme', 'wear', 'color'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY,
  step TEXT NOT NULL,
  key TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  UNIQUE (step, key)
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  school TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 45,
  opened_at INTEGER,
  ends_at INTEGER,
  closed_at INTEGER,
  picks TEXT NOT NULL DEFAULT '{}',
  hidden TEXT NOT NULL DEFAULT '[]',
  shoot TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  bring TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  step TEXT NOT NULL,
  option TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (class_id, voter, step)
);
CREATE TABLE IF NOT EXISTS reactions (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (class_id, voter)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ext TEXT NOT NULL,
  w INTEGER NOT NULL DEFAULT 0,
  h INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS site (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

// Поля класса, которые можно менять из админки
const CLASS_FIELDS = ['slug', 'school', 'title', 'year', 'duration_min', 'opened_at', 'ends_at', 'closed_at',
  'picks', 'hidden', 'shoot', 'address', 'bring', 'note', 'archived'];

function parseClass(row) {
  if (!row) return null;
  const c = Object.assign({}, row);
  try { c.picks = JSON.parse(row.picks) || {}; } catch (e) { c.picks = {}; }
  try { c.hidden = JSON.parse(row.hidden) || []; } catch (e) { c.hidden = []; }
  return c;
}

function parseOption(row) {
  const o = JSON.parse(row.data);
  o.id = row.id;
  o.step = row.step;
  o.key = row.key;
  o.sort = row.sort;
  o.hidden = !!row.hidden;
  return o;
}

class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.db.exec(SCHEMA);
    this.db.exec('PRAGMA user_version = 2');
    if (!this.db.prepare('SELECT COUNT(*) n FROM options').get().n) this.seedCatalog();
  }

  close() { this.db.close(); }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- настройки ----------
  getSetting(key, def) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return def;
    try { return JSON.parse(row.value); } catch (e) { return def; }
  }

  setSetting(key, value) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  // ---------- каталог вариантов ----------
  seedCatalog() {
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'catalog.json'), 'utf8'));
    const ins = this.db.prepare('INSERT INTO options (step, key, sort, data) VALUES (?, ?, ?, ?)');
    this.tx(() => {
      STEPS.forEach(step => {
        (cat[step] || []).forEach((o, i) => {
          const data = Object.assign({}, o);
          delete data.key;
          ins.run(step, o.key, (i + 1) * 10, JSON.stringify(data));
        });
      });
    });
  }

  listOptions() {
    const rows = this.db.prepare('SELECT * FROM options ORDER BY sort, id').all();
    const out = { theme: [], wear: [], color: [] };
    rows.forEach(r => { if (out[r.step]) out[r.step].push(parseOption(r)); });
    return out;
  }

  getOption(id) {
    const row = this.db.prepare('SELECT * FROM options WHERE id = ?').get(id);
    return row ? parseOption(row) : null;
  }

  updateOption(id, data, hidden) {
    const clean = Object.assign({}, data);
    ['id', 'step', 'key', 'sort', 'hidden'].forEach(k => delete clean[k]);
    this.db.prepare('UPDATE options SET data = ?, hidden = ? WHERE id = ?').run(JSON.stringify(clean), hidden ? 1 : 0, id);
  }

  setOptionHidden(id, hidden) {
    this.db.prepare('UPDATE options SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  }

  optionKeyTaken(step, key) {
    return !!this.db.prepare('SELECT id FROM options WHERE step = ? AND key = ?').get(step, key);
  }

  // Новый вариант встаёт в конец своего этапа
  addOption(step, key, data, hidden) {
    const clean = Object.assign({}, data);
    ['id', 'step', 'key', 'sort', 'hidden'].forEach(k => delete clean[k]);
    const max = this.db.prepare('SELECT MAX(sort) m FROM options WHERE step = ?').get(step).m || 0;
    const r = this.db.prepare('INSERT INTO options (step, key, sort, hidden, data) VALUES (?, ?, ?, ?, ?)')
      .run(step, key, max + 10, hidden ? 1 : 0, JSON.stringify(clean));
    return Number(r.lastInsertRowid);
  }

  // Сдвинуть вариант выше или ниже внутри своего этапа
  moveOption(id, dir) {
    const o = this.getOption(id);
    if (!o) return;
    const list = this.listOptions()[o.step];
    const i = list.findIndex(x => x.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    const upd = this.db.prepare('UPDATE options SET sort = ? WHERE id = ?');
    this.tx(() => list.forEach((x, k) => upd.run((k + 1) * 10, x.id)));
  }

  // ---------- классы ----------
  listClasses() {
    const rows = this.db.prepare(`
      SELECT c.*, (SELECT COUNT(DISTINCT voter) FROM votes v WHERE v.class_id = c.id) AS voters
      FROM classes c ORDER BY c.created_at DESC, c.id DESC`).all();
    return rows.map(parseClass);
  }

  getClass(id) {
    return parseClass(this.db.prepare('SELECT * FROM classes WHERE id = ?').get(id));
  }

  getClassBySlug(slug) {
    return parseClass(this.db.prepare('SELECT * FROM classes WHERE slug = ?').get(slug));
  }

  slugTaken(slug, exceptId) {
    const row = this.db.prepare('SELECT id FROM classes WHERE slug = ?').get(slug);
    return !!row && row.id !== exceptId;
  }

  createClass(f) {
    const now = Date.now();
    const r = this.db.prepare(`INSERT INTO classes
      (slug, school, title, year, duration_min, hidden, shoot, address, bring, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      f.slug, f.school, f.title, f.year, f.duration_min || 45, JSON.stringify(f.hidden || []),
      f.shoot || '', f.address || '', f.bring || '', f.note || '', now, now);
    return Number(r.lastInsertRowid);
  }

  updateClass(id, f) {
    const keys = Object.keys(f).filter(k => CLASS_FIELDS.indexOf(k) !== -1);
    if (!keys.length) return;
    const vals = keys.map(k => (k === 'picks' || k === 'hidden') ? JSON.stringify(f[k]) : f[k]);
    this.db.prepare('UPDATE classes SET ' + keys.map(k => k + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?')
      .run(...vals, Date.now(), id);
  }

  deleteClass(id) {
    this.db.prepare('DELETE FROM classes WHERE id = ?').run(id);
  }

  // ---------- голоса ----------
  addVote(classId, voter, step, option) {
    const r = this.db.prepare('INSERT OR IGNORE INTO votes (class_id, voter, step, option, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(classId, voter, step, option, Date.now());
    return r.changes > 0;
  }

  counts(classId) {
    const out = { theme: {}, wear: {}, color: {} };
    this.db.prepare('SELECT step, option, COUNT(*) n FROM votes WHERE class_id = ? GROUP BY step, option').all(classId)
      .forEach(r => { if (out[r.step]) out[r.step][r.option] = r.n; });
    return out;
  }

  voters(classId) {
    return this.db.prepare('SELECT COUNT(DISTINCT voter) n FROM votes WHERE class_id = ?').get(classId).n;
  }

  mine(classId, voter) {
    const out = {};
    if (!voter) return out;
    this.db.prepare('SELECT step, option FROM votes WHERE class_id = ? AND voter = ?').all(classId, voter)
      .forEach(r => { out[r.step] = r.option; });
    return out;
  }

  resetVotes(classId) {
    this.db.prepare('DELETE FROM votes WHERE class_id = ?').run(classId);
  }

  // ---------- реакции на страницу ----------
  setReaction(classId, voter, value) {
    this.db.prepare(`INSERT INTO reactions (class_id, voter, value, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(class_id, voter) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`)
      .run(classId, voter, value, Date.now());
  }

  myReaction(classId, voter) {
    if (!voter) return null;
    const row = this.db.prepare('SELECT value FROM reactions WHERE class_id = ? AND voter = ?').get(classId, voter);
    return row ? row.value : null;
  }

  reactionCounts(classId) {
    const out = {};
    this.db.prepare('SELECT value, COUNT(*) n FROM reactions WHERE class_id = ? GROUP BY value').all(classId)
      .forEach(r => { out[r.value] = r.n; });
    return out;
  }

  // ---------- сессии админки ----------
  createSession(id, ttl) {
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)').run(id, now, now + ttl);
  }

  getSession(id) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(id, Date.now()) || null;
  }

  deleteSession(id) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  deleteAllSessions() {
    this.db.prepare('DELETE FROM sessions').run();
  }

  purgeSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  }

  // ---------- загруженные файлы ----------
  addMedia(m) {
    this.db.prepare('INSERT INTO media (id, kind, ext, w, h, bytes, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.kind, m.ext, m.w || 0, m.h || 0, m.bytes || 0, m.note || '', Date.now());
  }

  getMedia(id) {
    return this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) || null;
  }

  listMedia() {
    return this.db.prepare('SELECT * FROM media ORDER BY created_at').all();
  }

  deleteMedia(id) {
    this.db.prepare('DELETE FROM media WHERE id = ?').run(id);
  }

  // ---------- содержимое сайта: фото, галереи, тексты ----------
  getSite(key) {
    const row = this.db.prepare('SELECT value FROM site WHERE key = ?').get(key);
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch (e) { return undefined; }
  }

  allSite() {
    const out = {};
    this.db.prepare('SELECT key, value FROM site').all().forEach(r => {
      try { out[r.key] = JSON.parse(r.value); } catch (e) {}
    });
    return out;
  }

  setSite(key, value) {
    this.db.prepare('INSERT INTO site (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, JSON.stringify(value), Date.now());
  }

  deleteSite(key) {
    this.db.prepare('DELETE FROM site WHERE key = ?').run(key);
  }

  // Все упоминания загруженных файлов: по ним чистим неиспользуемые
  mediaRefs() {
    const text = this.db.prepare('SELECT value FROM site').all().map(r => r.value)
      .concat(this.db.prepare('SELECT data FROM options').all().map(r => r.data)).join('\n');
    const ids = new Set();
    const re = /media\/([A-Za-z0-9_-]+?)(?:-sm|-lg)?\.(?:jpg|mp4)|media\/([A-Za-z0-9_-]+)"/g;
    let m;
    while ((m = re.exec(text))) ids.add(m[1] || m[2]);
    return ids;
  }

  // Копия базы для бэкапа, можно делать на ходу
  backup(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db.prepare('VACUUM INTO ?').run(file);
  }
}

module.exports = { Store, STEPS };
