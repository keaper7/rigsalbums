'use strict';

// Отбор фото для альбома: личные фото каждого ученика, общий выбор групповых и цитаты.
// Оригиналы остаются у Артура на компьютере. Сюда браузер присылает только ужатые копии,
// а раскладку оригиналов по папкам делает тоже браузер — по относительному пути файла.
//
// Всё лежит в своих таблицах pk_* и своей папке data/photos/<класс>: голосование и
// загрузки раздела «Сайт» это не задевает (уборка media.gc() сюда не заглядывает)

const fs = require('fs');
const path = require('path');
const { newId, jpegSize } = require('./media');
const { numbered } = require('./layout');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pk_albums (
  class_id INTEGER PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  personal_max INTEGER NOT NULL DEFAULT 3,
  group_max INTEGER NOT NULL DEFAULT 60,
  group_sections TEXT NOT NULL DEFAULT '[]',
  closed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pk_students (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  quote TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pk_photos (
  id TEXT PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  path TEXT NOT NULL,
  w INTEGER NOT NULL DEFAULT 0,
  h INTEGER NOT NULL DEFAULT 0,
  has_sm INTEGER NOT NULL DEFAULT 0,
  ver INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (class_id, path)
);
CREATE TABLE IF NOT EXISTS pk_personal (
  student_id INTEGER NOT NULL REFERENCES pk_students(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES pk_photos(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, photo_id)
);
CREATE TABLE IF NOT EXISTS pk_group (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES pk_photos(id) ON DELETE CASCADE,
  student_id INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (class_id, photo_id)
);
CREATE TABLE IF NOT EXISTS pk_log (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL,
  student_id INTEGER,
  who TEXT NOT NULL,
  action TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pk_photos_class ON pk_photos (class_id, section, path);
CREATE INDEX IF NOT EXISTS pk_students_class ON pk_students (class_id, sort);
CREATE INDEX IF NOT EXISTS pk_log_class ON pk_log (class_id, at);
`;

// [таблица, поле, описание] — новые поля сюда, только с значением по умолчанию
const COLUMNS = [
  ['pk_photos', 'ver', 'INTEGER NOT NULL DEFAULT 0'],
  // большая копия удалена кнопкой «Освободить место», осталась только маленькая
  ['pk_photos', 'slim', 'INTEGER NOT NULL DEFAULT 0'],
  // куда пойдёт личное фото (обложка, личная страница, список класса) и что подправить на ретуши
  ['pk_personal', 'role', "TEXT NOT NULL DEFAULT ''"],
  ['pk_personal', 'retouch', "TEXT NOT NULL DEFAULT ''"],
  // пожелание себе в будущее, код входа ученика, когда Артур отметил ретушь сделанной
  ['pk_students', 'wish', "TEXT NOT NULL DEFAULT ''"],
  ['pk_students', 'pin', "TEXT NOT NULL DEFAULT ''"],
  ['pk_students', 'retouch_done_at', 'INTEGER'],
  // ссылка на оригиналы в wfolio и когда освобождали место
  ['pk_albums', 'wfolio', "TEXT NOT NULL DEFAULT ''"],
  ['pk_albums', 'slim_at', 'INTEGER'],
  // отдельный выбор классного руководителя: своя ссылка, обложка, фото в общий список, пожелание классу
  ['pk_albums', 'teacher_token', "TEXT NOT NULL DEFAULT ''"],
  ['pk_albums', 'teacher_name', "TEXT NOT NULL DEFAULT ''"],
  ['pk_albums', 'teacher_cover', "TEXT NOT NULL DEFAULT ''"],
  ['pk_albums', 'teacher_list', "TEXT NOT NULL DEFAULT ''"],
  ['pk_albums', 'teacher_wish', "TEXT NOT NULL DEFAULT ''"],
  ['pk_albums', 'teacher_at', 'INTEGER']
];

const IMAGE_MAX = 6 * 1024 * 1024;
// Сколько места оставляем на диске всегда: если он заполнится до конца, перестанет сохраняться
// и база голосований. Ниже этого порога новые фото не принимаем
const DISK_RESERVE = 1024 * 1024 * 1024;
const PHOTO_ID = /^[a-z0-9]{16}$/;
const NAME_MAX = 60;
const QUOTE_MAX = 2000;
const WISH_MAX = 2000;
const RETOUCH_MAX = 500;
const PIN_RE = /^\d{4}$/;
// Места в альбоме для личных фото: у каждого ученика по одному фото на место.
// Ключ хранится в базе, название — в интерфейсе и в имени файла при раскладке
const ROLES = [['cover', 'Обложка'], ['page', 'Личная страница'], ['list', 'Список класса']];
const ROLE_NAMES = Object.fromEntries(ROLES);
// Раздел считается общими групповыми фото, если в названии есть «групп» (папка «Групповые»)
const GROUP_RE = /групп/i;
// Папка с фото классного руководителя: «кл рук», «Кл. рук», «Классный руководитель», «Учитель».
// Её фото ученикам не показываются, их выбирает сам классный руководитель по своей ссылке
const TEACHER_RE = /^(кл\.?\s*рук|классн|учител)/i;
const TEACHER_WISH_MAX = 4000;
const TEACHER_TOKEN = /^[a-z0-9]{20}$/;
// IMG_2 раньше IMG_10, как в Finder
const NATURAL = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

function cleanText(t, max) {
  return String(t || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
}

function cleanName(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function fail(status, message) {
  return Object.assign(new Error(message), { status: status, expose: true });
}

// Относительный путь файла внутри папки с оригиналами: «Парни/IMG_0001.jpg».
// Никаких «..», пустых частей и служебных файлов
function cleanPath(p) {
  const parts = String(p || '').replace(/\\/g, '/').split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 6) return null;
  if (parts.some(s => s === '.' || s === '..' || s.charAt(0) === '.' || s.length > 120)) return null;
  if (!/\.jpe?g$/i.test(parts[parts.length - 1])) return null;
  return parts.join('/');
}

function sectionOf(p) {
  const parts = p.split('/');
  return parts.length > 1 ? parts[0] : 'Без папки';
}

function readAll(req, limit) {
  return new Promise((resolve, reject) => {
    const len = +req.headers['content-length'];
    if (len && len > limit) return reject(fail(413, 'Фото слишком большое'));
    let size = 0, over = false;
    const chunks = [];
    req.on('data', ch => {
      if (over) return;
      size += ch.length;
      if (size > limit) { over = true; chunks.length = 0; reject(fail(413, 'Фото слишком большое')); return; }
      chunks.push(ch);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

class Photos {
  constructor(store, dir) {
    this.store = store;
    this.db = store.db;
    this.dir = dir;
    this.db.exec(SCHEMA);
    // Поля, добавленные после первой версии: дописываем в уже существующие таблицы,
    // ничего не удаляя и не пересоздавая
    COLUMNS.forEach(c => {
      const have = this.db.prepare('PRAGMA table_info(' + c[0] + ')').all().map(r => r.name);
      if (have.indexOf(c[1]) === -1) this.db.exec('ALTER TABLE ' + c[0] + ' ADD COLUMN ' + c[1] + ' ' + c[2]);
    });
    this.cleanParts();
  }

  // Недокачанные файлы (оборвалась связь посреди загрузки) старше суток
  cleanParts() {
    const now = Date.now();
    try {
      fs.readdirSync(this.dir).forEach(d => {
        const dir = path.join(this.dir, d);
        let list = [];
        try { list = fs.readdirSync(dir); } catch (e) { return; }
        list.filter(f => f.endsWith('.part')).forEach(f => {
          try { if (now - fs.statSync(path.join(dir, f)).mtimeMs > 24 * 60 * 60 * 1000) fs.unlinkSync(path.join(dir, f)); } catch (e) {}
        });
      });
    } catch (e) {}
  }

  classDir(classId) { return path.join(this.dir, String(+classId)); }

  // Свободно и всего на диске, где лежат фото
  disk() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const st = fs.statfsSync(this.dir);
      return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
    } catch (e) {
      return null;
    }
  }

  // Сколько занимают копии фото класса
  usage(classId) {
    let bytes = 0;
    try { fs.readdirSync(this.classDir(classId)).forEach(f => { bytes += fs.statSync(this.file(classId, f)).size; }); } catch (e) {}
    return bytes;
  }
  file(classId, name) { return path.join(this.classDir(classId), name); }

  // ---------- альбом класса ----------
  album(classId) {
    const a = this.db.prepare('SELECT * FROM pk_albums WHERE class_id = ?').get(classId);
    if (!a) return null;
    try { a.group_sections = JSON.parse(a.group_sections) || []; } catch (e) { a.group_sections = []; }
    return a;
  }

  albumBySlug(slug) {
    const row = this.db.prepare('SELECT class_id FROM pk_albums WHERE slug = ?').get(slug);
    return row ? this.album(row.class_id) : null;
  }

  ensureAlbum(classId, slug) {
    const a = this.album(classId);
    if (a) return a;
    this.db.prepare('INSERT INTO pk_albums (class_id, slug, created_at) VALUES (?, ?, ?)').run(classId, slug, Date.now());
    return this.album(classId);
  }

  updateAlbum(classId, f) {
    const keys = ['personal_max', 'group_max', 'closed_at', 'group_sections', 'wfolio', 'slim_at'].filter(k => k in f);
    if (!keys.length) return;
    const vals = keys.map(k => k === 'group_sections' ? JSON.stringify(f[k]) : f[k]);
    this.db.prepare('UPDATE pk_albums SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE class_id = ?').run(...vals, classId);
  }

  isTeacherSection(section) { return TEACHER_RE.test(String(section || '').trim()); }

  // Какие разделы — общие групповые: выбранные Артуром, иначе по названию папки
  isGroupSection(album, section) {
    if (this.isTeacherSection(section)) return false;
    if (album.group_sections && album.group_sections.length) return album.group_sections.indexOf(section) !== -1;
    return GROUP_RE.test(section);
  }

  // Удалить всё по классу: записи уходят каскадом вместе с классом, здесь — файлы
  removeFiles(classId) {
    fs.rmSync(this.classDir(classId), { recursive: true, force: true });
  }

  // ---------- ученики ----------
  students(classId) {
    return this.db.prepare('SELECT * FROM pk_students WHERE class_id = ? ORDER BY sort, id').all(classId);
  }

  student(classId, id) {
    return this.db.prepare('SELECT * FROM pk_students WHERE class_id = ? AND id = ?').get(classId, id) || null;
  }

  // Список имён из текстового поля. Уже записанные остаются со своими выборами,
  // новые добавляются. Убрать можно только ученика, который ещё ничего не выбрал
  // Два одинаковых имени — это, скорее всего, два разных человека: не склеиваем молча, а просим уточнить
  setStudents(classId, text) {
    const names = [];
    const dups = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const n = cleanName(line);
      if (!n) return;
      if (names.some(x => x.toLowerCase() === n.toLowerCase())) { if (dups.indexOf(n) === -1) dups.push(n); }
      else names.push(n);
    });
    if (dups.length) return { kept: [], dups: dups };
    const have = this.students(classId);
    const kept = [];
    const now = Date.now();
    this.store.tx(() => {
      have.forEach(s => {
        if (names.indexOf(s.name) !== -1) return;
        if (this.studentBusy(s.id)) kept.push(s.name);
        else this.db.prepare('DELETE FROM pk_students WHERE id = ?').run(s.id);
      });
      names.forEach((n, i) => {
        const old = have.find(s => s.name === n);
        if (old) this.db.prepare('UPDATE pk_students SET sort = ? WHERE id = ?').run(i, old.id);
        else this.db.prepare('INSERT INTO pk_students (class_id, name, sort, created_at) VALUES (?, ?, ?, ?)').run(classId, n, i, now);
      });
    });
    return { kept: kept, dups: [] };
  }

  // Переименовать, не теряя выбор ученика (опечатка в имени)
  renameStudent(classId, id, name) {
    const n = cleanName(name);
    if (!n) return { error: 'Напишите имя' };
    const s = this.student(classId, id);
    if (!s) return { error: 'Ученик не найден' };
    if (this.students(classId).some(x => x.id !== s.id && x.name.toLowerCase() === n.toLowerCase())) return { error: 'Такое имя уже есть в списке. Добавьте фамилию или первую букву' };
    this.db.prepare('UPDATE pk_students SET name = ? WHERE id = ?').run(n, s.id);
    return { ok: true };
  }

  // Кто уже что-то выбрал или написал — для подсказки «под этим именем уже выбирали»
  startedIds(classId) {
    const rows = this.db.prepare(`SELECT id FROM pk_students s WHERE s.class_id = ? AND (s.quote != '' OR s.wish != '' OR s.pin != ''
      OR EXISTS (SELECT 1 FROM pk_personal p WHERE p.student_id = s.id)
      OR EXISTS (SELECT 1 FROM pk_group g WHERE g.student_id = s.id))`).all(classId);
    return new Set(rows.map(r => r.id));
  }

  studentBusy(id) {
    const s = this.db.prepare('SELECT quote, wish, pin FROM pk_students WHERE id = ?').get(id);
    const n = this.db.prepare('SELECT COUNT(*) n FROM pk_personal WHERE student_id = ?').get(id).n;
    const g = this.db.prepare('SELECT COUNT(*) n FROM pk_group WHERE student_id = ?').get(id).n;
    return !!(n || g || (s && (s.quote || s.wish || s.pin)));
  }

  setQuote(classId, studentId, text) {
    const q = cleanText(text, QUOTE_MAX);
    this.db.prepare('UPDATE pk_students SET quote = ? WHERE class_id = ? AND id = ?').run(q, classId, studentId);
    return q;
  }

  setWish(classId, studentId, text) {
    const q = cleanText(text, WISH_MAX);
    this.db.prepare('UPDATE pk_students SET wish = ? WHERE class_id = ? AND id = ?').run(q, classId, studentId);
    return q;
  }

  // Код ученик придумывает сам при первом входе. Только если кода ещё нет: два человека,
  // одновременно выбравшие одно имя, не перезапишут код друг друга
  setPin(classId, studentId, pin) {
    if (!PIN_RE.test(String(pin))) return false;
    return this.db.prepare("UPDATE pk_students SET pin = ? WHERE class_id = ? AND id = ? AND pin = ''").run(String(pin), classId, studentId).changes === 1;
  }

  resetPin(classId, studentId) {
    this.db.prepare("UPDATE pk_students SET pin = '' WHERE class_id = ? AND id = ?").run(classId, studentId);
  }

  // Артур отметил, что ретушь ученика сделана. Ученик что-то поменял — отметка снимается
  setRetouchDone(classId, studentId, on) {
    this.db.prepare('UPDATE pk_students SET retouch_done_at = ? WHERE class_id = ? AND id = ?').run(on ? Date.now() : null, classId, studentId);
  }

  retouchChanged(studentId) {
    this.db.prepare('UPDATE pk_students SET retouch_done_at = NULL WHERE id = ?').run(studentId);
  }

  // ---------- фото ----------
  photos(classId) {
    return this.db.prepare('SELECT * FROM pk_photos WHERE class_id = ?').all(classId)
      .sort((a, b) => NATURAL.compare(a.section, b.section) || NATURAL.compare(a.path, b.path));
  }

  photo(classId, id) {
    if (!PHOTO_ID.test(String(id))) return null;
    return this.db.prepare('SELECT * FROM pk_photos WHERE class_id = ? AND id = ?').get(classId, id) || null;
  }

  // Готовые фото: запись есть, обе копии загружены и файлы на месте. Проверяем и сами файлы:
  // после восстановления базы из бэкапа копий на диске может не быть (в бэкап они не входят —
  // их всегда можно загрузить заново из папки с оригиналами), и тогда загрузка их догрузит
  ready(classId) {
    return this.photos(classId).filter(p => p.has_sm &&
      (p.slim || fs.existsSync(this.file(classId, p.id + '.jpg'))) && fs.existsSync(this.file(classId, p.id + '-sm.jpg')));
  }

  paths(classId) {
    return this.ready(classId).map(p => p.path);
  }

  // Большая копия. Если такой путь уже был — заменяем файл, запись и выборы сохраняются
  async savePhoto(classId, rel, req) {
    const p = cleanPath(rel);
    if (!p) { req.resume(); throw fail(400, 'Нужен файл JPG из папки с фото'); }
    const d = this.reserve === undefined ? this.disk() : { free: this.reserve };
    if (d && d.free < DISK_RESERVE) { req.resume(); throw fail(507, 'На сервере заканчивается место. Загрузка остановлена, чтобы не сломать сайт — напишите Азрету'); }
    const buf = await readAll(req, IMAGE_MAX);
    const size = jpegSize(buf);
    if (!size) throw fail(415, 'Это не похоже на JPEG');
    fs.mkdirSync(this.classDir(classId), { recursive: true });
    // Сначала запись (тот же путь — та же запись, даже если два запроса пришли разом), потом файл.
    // Маленькая копия до её загрузки считается неготовой: фото не покажется ученикам наполовину
    const now = Date.now();
    this.db.prepare(`INSERT INTO pk_photos (id, class_id, section, path, w, h, has_sm, ver, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT (class_id, path) DO UPDATE SET w = excluded.w, h = excluded.h, has_sm = 0, slim = 0, ver = excluded.ver`)
      .run(newId(), classId, sectionOf(p), p, size.w, size.h, now, now);
    const id = this.db.prepare('SELECT id FROM pk_photos WHERE class_id = ? AND path = ?').get(classId, p).id;
    const tmp = this.file(classId, id + '.jpg.' + process.pid + '.' + now + '.part');
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.file(classId, id + '.jpg'));
    return { id: id, path: p, section: sectionOf(p) };
  }

  // Маленькая копия для сетки
  async saveSmall(classId, id, req) {
    const ph = this.photo(classId, id);
    if (!ph) { req.resume(); throw fail(404, 'Фото не найдено'); }
    const buf = await readAll(req, IMAGE_MAX);
    if (!jpegSize(buf)) throw fail(415, 'Это не похоже на JPEG');
    const tmp = this.file(classId, id + '-sm.jpg.' + process.pid + '.' + Date.now() + '.part');
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.file(classId, id + '-sm.jpg'));
    this.db.prepare('UPDATE pk_photos SET has_sm = 1 WHERE id = ?').run(id);
    return { id: id };
  }

  deleteSection(classId, section) {
    const list = this.db.prepare('SELECT id FROM pk_photos WHERE class_id = ? AND section = ?').all(classId, section);
    this.db.prepare('DELETE FROM pk_photos WHERE class_id = ? AND section = ?').run(classId, section);
    list.forEach(r => ['.jpg', '-sm.jpg'].forEach(s => { try { fs.unlinkSync(this.file(classId, r.id + s)); } catch (e) {} }));
    return list.length;
  }

  // «Освободить место» после отбора: удаляем фото, которые никто не выбрал, а у выбранных —
  // большую копию. Выбор, места, ретушь и тексты остаются, выбранные фото видно в маленьком размере.
  // Оригиналы у Артура не трогаются, раскладка по папкам работает как раньше
  slim(classId) {
    // Оставляем только то, что засчитано сейчас. Старые отметки из разделов, у которых Артур потом
    // поменял тип (личные ↔ групповые), не видны и в раскладку не идут — их фото не держим
    const album = this.album(classId);
    const keep = new Set(this.group(classId, album).map(g => g.photo_id));
    this.students(classId).forEach(st => this.personal(st.id, album).forEach(id => keep.add(id)));
    [album.teacher_cover, album.teacher_list].forEach(id => { if (id) keep.add(id); });
    const all = this.db.prepare('SELECT id FROM pk_photos WHERE class_id = ?').all(classId);
    const drop = all.filter(r => !keep.has(r.id));
    const kept = all.filter(r => keep.has(r.id));
    this.store.tx(() => {
      drop.forEach(r => this.db.prepare('DELETE FROM pk_photos WHERE id = ?').run(r.id));
      kept.forEach(r => this.db.prepare('UPDATE pk_photos SET slim = 1 WHERE id = ?').run(r.id));
      this.updateAlbum(classId, { slim_at: Date.now() });
    });
    const rm = f => { try { fs.unlinkSync(this.file(classId, f)); } catch (e) {} };
    drop.forEach(r => { rm(r.id + '.jpg'); rm(r.id + '-sm.jpg'); });
    kept.forEach(r => rm(r.id + '.jpg'));
    return { removed: drop.length, kept: kept.length };
  }

  // Разделы, которые сейчас общие групповые. Если Артур переключил раздел уже после выбора,
  // старые отметки не удаляем, а просто не учитываем: вернёт галочку — вернутся и они
  groupSet(album) {
    const out = new Set();
    this.db.prepare('SELECT DISTINCT section FROM pk_photos WHERE class_id = ?').all(album.class_id)
      .forEach(r => { if (this.isGroupSection(album, r.section)) out.add(r.section); });
    return out;
  }

  // ---------- личный выбор ----------
  personal(studentId, album) {
    const rows = this.db.prepare(`SELECT p.photo_id, f.section FROM pk_personal p JOIN pk_photos f ON f.id = p.photo_id
      WHERE p.student_id = ? ORDER BY p.created_at, p.rowid`).all(studentId);
    const grp = album ? this.groupSet(album) : null;
    return rows.filter(r => (!grp || !grp.has(r.section)) && !this.isTeacherSection(r.section)).map(r => r.photo_id);
  }

  // Выбранные личные фото с местом в альбоме и пожеланием по ретуши
  personalInfo(studentId, album) {
    const rows = this.db.prepare(`SELECT p.photo_id, p.role, p.retouch, f.section FROM pk_personal p JOIN pk_photos f ON f.id = p.photo_id
      WHERE p.student_id = ? ORDER BY p.created_at, p.rowid`).all(studentId);
    const grp = album ? this.groupSet(album) : null;
    return rows.filter(r => (!grp || !grp.has(r.section)) && !this.isTeacherSection(r.section)).map(r => ({ id: r.photo_id, role: ROLE_NAMES[r.role] ? r.role : '', retouch: r.retouch }));
  }

  // Личный выбор всех учеников класса одним запросом: { ученик: [{ id, role, retouch }] }.
  // То же, что personalInfo для каждого, но без отдельного запроса на каждого ученика — для доски с десятками классов
  personalByStudent(album) {
    const grp = this.groupSet(album);
    // идём от учеников класса: выборы ищутся по ключу ученика, а не перебором всей таблицы
    const rows = this.db.prepare(`SELECT p.student_id, p.photo_id, p.role, p.retouch, f.section FROM pk_students s
      CROSS JOIN pk_personal p ON p.student_id = s.id JOIN pk_photos f ON f.id = p.photo_id
      WHERE s.class_id = ? ORDER BY p.created_at, p.rowid`).all(album.class_id);
    const out = new Map();
    rows.forEach(r => {
      if (grp.has(r.section) || this.isTeacherSection(r.section)) return;
      if (!out.has(r.student_id)) out.set(r.student_id, []);
      out.get(r.student_id).push({ id: r.photo_id, role: ROLE_NAMES[r.role] ? r.role : '', retouch: r.retouch });
    });
    return out;
  }

  // Сколько готовых фото в папке «кл рук» — одним коротким запросом по разделам
  teacherCount(classId) {
    return this.db.prepare('SELECT section, COUNT(*) n FROM pk_photos WHERE class_id = ? AND has_sm = 1 GROUP BY section').all(classId)
      .filter(r => this.isTeacherSection(r.section)).reduce((n, r) => n + r.n, 0);
  }

  setPersonal(album, studentId, photoId, on) {
    if (!on) {
      const gone = this.db.prepare('DELETE FROM pk_personal WHERE student_id = ? AND photo_id = ?').run(studentId, photoId).changes;
      if (gone) this.retouchChanged(studentId);
      return { ok: true };
    }
    return this.store.tx(() => {
      const mine = this.personal(studentId, album);
      if (mine.indexOf(photoId) !== -1) return { ok: true };
      if (mine.length >= album.personal_max) return { ok: false, error: 'full' };
      this.db.prepare('INSERT INTO pk_personal (student_id, photo_id, created_at) VALUES (?, ?, ?)').run(studentId, photoId, Date.now());
      this.retouchChanged(studentId);
      return { ok: true };
    });
  }

  // Место в альбоме для выбранного фото. Одно место — одно фото: если оно было у другого фото
  // этого ученика, переходит сюда. '' — без места
  setRole(album, studentId, photoId, role) {
    if (role && !ROLE_NAMES[role]) return { ok: false, error: 'role' };
    return this.store.tx(() => {
      if (this.personal(studentId, album).indexOf(photoId) === -1) return { ok: false, error: 'not_mine' };
      if (role) this.db.prepare("UPDATE pk_personal SET role = '' WHERE student_id = ? AND role = ? AND photo_id != ?").run(studentId, role, photoId);
      this.db.prepare('UPDATE pk_personal SET role = ? WHERE student_id = ? AND photo_id = ?').run(role || '', studentId, photoId);
      this.retouchChanged(studentId);
      return { ok: true };
    });
  }

  setRetouch(album, studentId, photoId, text) {
    const t = cleanText(text, RETOUCH_MAX);
    if (this.personal(studentId, album).indexOf(photoId) === -1) return { ok: false, error: 'not_mine' };
    const cur = this.db.prepare('SELECT retouch FROM pk_personal WHERE student_id = ? AND photo_id = ?').get(studentId, photoId);
    if (cur && cur.retouch === t) return { ok: true };
    this.db.prepare('UPDATE pk_personal SET retouch = ? WHERE student_id = ? AND photo_id = ?').run(t, studentId, photoId);
    this.retouchChanged(studentId);
    return { ok: true };
  }

  // ---------- общий выбор групповых ----------
  group(classId, album) {
    const rows = this.db.prepare(`SELECT g.photo_id, g.student_id, g.created_at, f.section FROM pk_group g JOIN pk_photos f ON f.id = g.photo_id
      WHERE g.class_id = ? ORDER BY g.created_at, g.rowid`).all(classId);
    const grp = this.groupSet(album || this.album(classId));
    return rows.filter(r => grp.has(r.section));
  }

  // who: имя для истории («Артур» или имя ученика), studentId: null — это Артур
  setGroup(album, photoId, on, studentId, who) {
    const classId = album.class_id;
    return this.store.tx(() => {
      const cur = this.db.prepare('SELECT student_id FROM pk_group WHERE class_id = ? AND photo_id = ?').get(classId, photoId);
      if (on) {
        if (cur) return { ok: true };
        if (this.group(classId, album).length >= album.group_max) return { ok: false, error: 'full' };
        this.db.prepare('INSERT INTO pk_group (class_id, photo_id, student_id, created_at) VALUES (?, ?, ?, ?)')
          .run(classId, photoId, studentId, Date.now());
      } else {
        if (!cur) return { ok: true };
        this.db.prepare('DELETE FROM pk_group WHERE class_id = ? AND photo_id = ?').run(classId, photoId);
      }
      this.db.prepare('INSERT INTO pk_log (class_id, photo_id, student_id, who, action, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(classId, photoId, studentId, who, on ? 'add' : 'remove', Date.now());
      return { ok: true };
    });
  }

  log(classId, limit) {
    return this.db.prepare('SELECT * FROM pk_log WHERE class_id = ? ORDER BY at DESC, id DESC LIMIT ?').all(classId, limit || 60);
  }

  // ---------- классный руководитель ----------
  // Фото из папки «кл рук»: только готовые (обе копии загружены)
  teacherPhotos(classId) {
    return this.ready(classId).filter(p => this.isTeacherSection(p.section));
  }

  // Ссылка классного руководителя создаётся один раз, при первом показе в админке
  teacherToken(classId) {
    const a = this.album(classId);
    if (!a) return '';
    if (a.teacher_token) return a.teacher_token;
    const t = newId() + newId().slice(0, 4);
    this.db.prepare("UPDATE pk_albums SET teacher_token = ? WHERE class_id = ? AND teacher_token = ''").run(t, classId);
    return this.album(classId).teacher_token;
  }

  albumByTeacher(t) {
    if (!TEACHER_TOKEN.test(String(t || ''))) return null;
    const row = this.db.prepare('SELECT class_id FROM pk_albums WHERE teacher_token = ?').get(t);
    return row ? this.album(row.class_id) : null;
  }

  // Что выбрал классный руководитель: фото, которых уже нет (папку удалили), не считаются
  teacherPicks(album, byId) {
    const get = id => {
      if (!id) return null;
      const ph = byId ? byId.get(id) : this.photo(album.class_id, id);
      return ph && this.isTeacherSection(ph.section) ? ph : null;
    };
    return { cover: get(album.teacher_cover), list: get(album.teacher_list) };
  }

  teacherDone(album) {
    const t = this.teacherPicks(album);
    return !!(t.cover && t.list && album.teacher_wish);
  }

  // f: { cover, list, wish, name } — меняется только то, что прислали. Фото только из папки «кл рук»
  setTeacher(classId, f) {
    const a = this.album(classId);
    if (!a) return { error: 'Отбор не найден' };
    const upd = {};
    for (const k of ['cover', 'list']) {
      if (!(k in f)) continue;
      const id = String(f[k] || '');
      if (id) {
        const ph = this.photo(classId, id);
        if (!ph || !this.isTeacherSection(ph.section)) return { error: 'Фото не найдено. Обновите страницу' };
      }
      upd['teacher_' + k] = id;
    }
    if ('wish' in f) upd.teacher_wish = cleanText(f.wish, TEACHER_WISH_MAX);
    if ('name' in f) upd.teacher_name = cleanName(f.name);
    const keys = Object.keys(upd);
    if (!keys.length) return { ok: true };
    this.db.prepare('UPDATE pk_albums SET ' + keys.map(k => k + ' = ?').join(', ') + ', teacher_at = ? WHERE class_id = ?')
      .run(...keys.map(k => upd[k]), Date.now(), classId);
    return { ok: true };
  }

  // ---------- итог для раскладки по папкам ----------
  exportPlan(classId) {
    const album = this.album(classId);
    const byId = new Map(this.photos(classId).map(p => [p.id, p]));
    // Фото с местом в альбоме при раскладке называются по месту: «Обложка.jpg»
    // номер, как в макете: по алфавиту, кл. рук следующий после всех
    const nums = new Map(numbered(this.students(classId)).map(s => [s.id, s.num]));
    const students = this.students(classId).map(s => {
      const list = this.personalInfo(s.id, album).filter(x => byId.has(x.id));
      return {
        num: nums.get(s.id),
        name: s.name,
        quote: s.quote,
        photos: list.map(x => byId.get(x.id).path),
        roles: list.map(x => x.role ? ROLE_NAMES[x.role] : '')
      };
    });
    const group = this.group(classId, album).map(g => byId.get(g.photo_id)).filter(Boolean).map(p => p.path);
    const t = this.teacherPicks(album, byId);
    const teacher = t.cover || t.list || album.teacher_wish
      ? { num: nums.size + 1, name: album.teacher_name, wish: album.teacher_wish, cover: t.cover ? t.cover.path : '', list: t.list ? t.list.path : '' }
      : null;
    return { students: students, group: group, teacher: teacher };
  }
}

module.exports = { Photos, cleanPath, sectionOf, PHOTO_ID, QUOTE_MAX, WISH_MAX, RETOUCH_MAX, PIN_RE, ROLES, ROLE_NAMES, TEACHER_WISH_MAX };
