'use strict';

// Работа над альбомами класса: три этапа с галочками (запись, работа, печать и отдача), даты съёмки,
// телефоны, осень или весна, статус и правки для дизайнера, переписка, деньги по классу и за сезон.
//
// Всё лежит в своих таблицах wk_*: голосование и отбор фото это не задевает.
// Класс попадает сюда сам — запись создаётся при первом обращении

const fs = require('fs');
const path = require('path');
const { token } = require('./util');
const { newId, jpegSize } = require('./media');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wk_classes (
  class_id INTEGER PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'todo',
  status_at INTEGER,
  shot INTEGER NOT NULL DEFAULT 0,
  shoot_date TEXT NOT NULL DEFAULT '',
  shoot_place TEXT NOT NULL DEFAULT '',
  processor TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  done TEXT NOT NULL DEFAULT '{}',
  money TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wk_fixes (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER,
  student_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  who TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  done_at INTEGER,
  done_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS wk_notes (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  who TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment',
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wk_designers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS wk_delivery (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wk_fix_files (
  id TEXT PRIMARY KEY,
  fix_id INTEGER NOT NULL REFERENCES wk_fixes(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  w INTEGER NOT NULL DEFAULT 0,
  h INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wk_leads (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  school TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  class_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wk_fix_files_fix ON wk_fix_files (fix_id);
CREATE INDEX IF NOT EXISTS wk_fixes_class ON wk_fixes (class_id, done_at, created_at);
CREATE INDEX IF NOT EXISTS wk_notes_class ON wk_notes (class_id, at);
`;

// [таблица, поле, описание] — новые поля сюда, только со значением по умолчанию
const COLUMNS = [
  ['wk_classes', 'phone', "TEXT NOT NULL DEFAULT ''"],
  // галочки этапов { ключ: когда отметили }, даты съёмки, телефоны для связи, осень или весна
  ['wk_classes', 'steps', "TEXT NOT NULL DEFAULT '{}'"],
  ['wk_classes', 'dates', "TEXT NOT NULL DEFAULT '[]'"],
  ['wk_classes', 'contacts', "TEXT NOT NULL DEFAULT '[]'"],
  ['wk_classes', 'half', "TEXT NOT NULL DEFAULT ''"],
  // оплаты после предоплаты: [{ sum, note, at }]
  ['wk_classes', 'paid', "TEXT NOT NULL DEFAULT '[]'"],
  // город и пробники (альбомы «для себя» в расход): [{ name, at }]
  ['wk_classes', 'city', "TEXT NOT NULL DEFAULT ''"],
  ['wk_classes', 'probes', "TEXT NOT NULL DEFAULT '[]'"],
  // ссылка на группу класса в Telegram
  ['wk_classes', 'tg', "TEXT NOT NULL DEFAULT ''"],
  ['wk_delivery', 'half', "TEXT NOT NULL DEFAULT ''"]
];

// Этапы работы с классом, как их ведёт Артур. Последний пункт этапа переводит класс на следующий,
// «Альбом забрали» — класс готов. auto: пункт отмечается сам (предоплата — из денег, даты — когда добавлены).
// «Отбор» — это чистка дублей у Артура, а выбор фото учениками — «Выборка», после загрузки.
// «Сверка» — ученики проверяют свой макет, с дизайнером не связана
const STAGES = [
  { key: 'prep', name: 'Запись и подготовка', steps: [['prepay', 'Предоплата', 'auto'], ['group', 'Группа'], ['talk', 'Обсуждение'], ['dates', 'Даты съёмки', 'auto'], ['approved', 'Утвердили']] },
  { key: 'work', name: 'Работа', steps: [['shot_ind', 'Отсняли индивидуальную'], ['shot_group', 'Отсняли групповую'], ['pick', 'Отбор'], ['color', 'Цветокор'], ['retouch', 'Ретушь'], ['upload', 'Загрузка'], ['select', 'Выборка'], ['extra', 'Доп. ретушь'], ['check', 'Сверка'], ['checked', 'Сверка пройдена']] },
  { key: 'print', name: 'Печать и отдача', steps: [['verify', 'Проверка'], ['ship', 'Отгрузка'], ['printing', 'Печать'], ['pack', 'Упаковка'], ['notify', 'Уведомить родителей'], ['taken', 'Альбом забрали']] }
];
const STEP_NAMES = {};
STAGES.forEach(st => st.steps.forEach(x => { STEP_NAMES[x[0]] = x[1]; }));
const HALVES = [['autumn', 'Осень'], ['spring', 'Весна']];
const HALF_NAMES = Object.fromEntries(HALVES);
// Какая съёмка в дате
// «Съёмка» без уточнения больше не выбирается, но у старых дат остаётся
const DATE_KINDS = [['ind', 'Индивидуальная'], ['group', 'Групповая']];
const DATE_KIND_NAMES = Object.assign({ other: 'Съёмка' }, Object.fromEntries(DATE_KINDS));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Статусы класса в том порядке, как идёт работа
const STATUSES = [
  ['todo', 'Нужно сделать'],
  ['review', 'На утверждении'],
  ['fixes', 'Новые корректировки'],
  ['check', 'На сверке'],
  ['print', 'На печать'],
  ['printed', 'Распечатано']
];
const STATUS_NAMES = Object.fromEntries(STATUSES);
// Что дизайнер может поставить сама: сделала или исправила — отдаёт на утверждение
const DESIGNER_STATUSES = ['review'];

// Что дизайнер отмечает по классу
const PARTS = [['cover', 'Обложка'], ['page', 'Личная страница'], ['list', 'Общий список'], ['group', 'Групповые'], ['teacher', 'Учитель']];
const PART_NAMES = Object.fromEntries(PARTS);

// Частые правки. hint — подсказка в поле текста
const FIXES = [
  ['quote', 'Заменить цитату', 'Новая цитата'],
  ['typo', 'Ошибка в цитате', 'Что исправить'],
  ['mixup', 'Перепутаны цитаты', 'С кем перепутали'],
  ['photo', 'Обновить фото', 'Ссылка на новое фото или что поменять'],
  ['swap', 'Поменять фото местами', 'Например: обложку и личную страницу'],
  ['group_swap', 'Заменить групповое фото', 'Комментарий'],
  ['group_del', 'Удалить групповое фото', 'Какое фото убрать'],
  ['name', 'Ошибка в имени', 'Как правильно'],
  ['other', 'Другое', 'Что сделать'],
  // появляется сама, в формах её нет
  ['teacher_wish', 'Новое пожелание классу', '', 'auto']
];
const FIX_NAMES = Object.fromEntries(FIXES.map(f => [f[0], f[1]]));
// Подписи к прикреплённым фото: для замены — что убрать и что поставить
const FILE_LABELS = { remove: 'Убрать', add: 'Поставить', '': '' };
const FILE_MAX = 6 * 1024 * 1024;
const FILES_PER_FIX = 6;
const FILE_ID = /^[a-z0-9]{16}$/;

// Деньги считаются как в таблице Артура. Цены и расходы свои у каждого сезона (сезон — год выпуска):
// когда дизайнер или типография поднимут цены, прошлые классы посчитаются по старым
const SELF = 'Артур';
// Прайс типографии: разворотов → печать одного альбома, ₽
const PRINT_DEFAULT = { 10: 1024, 11: 1049, 12: 1074, 13: 1100, 14: 1125, 15: 1151, 16: 1176, 17: 1201, 18: 1227, 19: 1252, 20: 1278, 21: 1303, 22: 1328, 23: 1354, 24: 1379, 25: 1405, 26: 1430, 27: 1455, 28: 1481, 29: 1510 };
const SEASON_DEFAULT = {
  price: 4000,          // цена альбома, если у класса не указана
  teacher: 2000,        // классный руководитель: +1 альбом и столько к сумме для родителей
  divisor: 2,           // учеников на разворот
  extra: 7,             // разворотов сверху: групповые, общий список и т. д.
  designer: 5500,       // дизайнер за класс
  prepay: 10000,        // предоплата с класса
  smm_per: 200,         // СММ и помощь: за ученика
  smm_fixed: 2000,      // и за класс
  processors: [{ name: 'Инал', rate: 4000 }, { name: 'Тамик', rate: 4000 }],
  print: PRINT_DEFAULT
};
// Поля сезона, которые правит Артур: [ключ, подпись, подсказка]
const SEASON_FIELDS = [
  ['price', 'Цена альбома', 'если у класса не указана своя'],
  ['teacher', 'Альбом классному руководителю', 'за каждый альбом, плюс 1 альбом в печать'],
  ['designer', 'Дизайнер за класс', ''],
  ['prepay', 'Предоплата с класса', ''],
  ['smm_per', 'СММ и помощь: за ученика', ''],
  ['smm_fixed', 'СММ и помощь: за класс', 'чтобы платить ровно, поставьте 0 за ученика и всю сумму сюда'],
  ['divisor', 'Учеников на разворот', ''],
  ['extra', 'Разворотов сверху', 'групповые, общий список и т. д.']
];

// Лиды: новый → связался → стал классом, или не актуально
const LEAD_STATUSES = [['new', 'Новые'], ['talk', 'Связался'], ['class', 'Стали классами'], ['lost', 'Не актуально']];
const LEAD_STATUS = Object.fromEntries(LEAD_STATUSES);

// Шаблоны сообщений на этапах: [ключ, где, текст по умолчанию]. Артур правит текст сам.
// {класс}, {школа}, {отбор}, {wfolio} подставляются; строка, где нечего подставить, убирается
const TEMPLATES = [
  ['prepay', 'Предоплата: напоминание', 'Здравствуйте! Напоминаю про предоплату за выпускные альбомы {класс}: {сумма}. Как будет удобно, напишите, пожалуйста.'],
  ['upload', 'Загрузка: ученикам, выбор фото', 'Фото готовы 📸 Выбираем фото для альбома:\n{отбор}\n\nОригиналы всех фото:\n{wfolio}\n\nНайдите себя в списке, выберите свои фото, напишите цитату и пожелание себе в будущее.'],
  ['check', 'Сверка: ученикам, проверить макет', 'Макет альбома готов. Проверьте, пожалуйста, всё ли правильно: фото, имя и цитата.\n{отбор}\n\nЕсли что-то не так, напишите мне.'],
  ['notify', 'Уведомить родителей: альбомы готовы', 'Здравствуйте! Выпускные альбомы {класс} готовы 🎓 Напишите, пожалуйста, когда вам удобно их забрать.']
];
const TEMPLATE_STEP = { prepay: 'prepay', upload: 'upload', check: 'check', notify: 'notify' };

function fill(text, vars) {
  const lines = String(text || '').split('\n');
  const out = [];
  lines.forEach(l => {
    let empty = false;
    const t = l.replace(/\{(класс|школа|отбор|wfolio|сумма)\}/gi, (m, k) => {
      const v = vars[k.toLowerCase()] || '';
      if (!v) empty = true;
      return v;
    });
    if (empty) {
      // строку-подпись перед пустой ссылкой («Оригиналы всех фото:») тоже убираем
      if (out.length && /:\s*$/.test(out[out.length - 1])) out.pop();
      return;
    }
    out.push(t);
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const TEXT_MAX = 2000;
const NAME_MAX = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(t, max) {
  return String(t || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
}

function line(t, max) {
  return String(t || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// «12 500», «12500 ₽» → 12500. Пусто или мусор — null (значит, взять обычное значение)
function amount(v) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[\s ₽руб.]/gi, '').replace(',', '.');
  if (!s) return null;
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n >= 0 && n <= 100000000 ? n : null;
}

// Тело запроса с фото целиком, с пределом
function readFile(req, limit) {
  return new Promise((resolve, reject) => {
    const big = () => Object.assign(new Error('Фото слишком большое'), { status: 413, expose: true });
    if (+req.headers['content-length'] > limit) return reject(big());
    let size = 0, over = false;
    const chunks = [];
    req.on('data', ch => {
      if (over) return;
      size += ch.length;
      if (size > limit) { over = true; chunks.length = 0; reject(big()); return; }
      chunks.push(ch);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function parseJson(s, def) {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : def; } catch (e) { return def; }
}

// Сезон — год выпуска класса, внутри него осень и весна. Артур ставит тег сам;
// пока не поставил — по первой дате съёмки (июль–декабрь осень), иначе по дате создания класса
function half(cls, w) {
  if (HALF_NAMES[w.half]) return w.half;
  const first = (w.dates || [])[0];
  const m = /^(\d{4})-(\d{2})/.exec(first ? first.d : w.shoot_date || '');
  const month = m ? +m[2] : new Date(cls.created_at || Date.now()).getMonth() + 1;
  return month >= 7 ? 'autumn' : 'spring';
}

// Ссылка на группу в Telegram: t.me/… , telegram.me/… или @имя. Другие адреса не принимаем,
// чтобы в кнопку не попало что-то постороннее
function tgUrl(v) {
  const s = String(v || '').trim();
  const at = /^@([A-Za-z0-9_]{4,64})$/.exec(s);
  if (at) return 'https://t.me/' + at[1];
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_+\-\/=?&.]{2,200})$/i.exec(s);
  return m ? 'https://t.me/' + m[1] : '';
}

// Дата индивидуальной съёмки словами для шпаргалки: «Суббота, 12 октября, 15:00».
// Берём ближайшую ещё не прошедшую, а если все прошли — последнюю
const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function shootText(w, today) {
  const ind = (w.dates || []).filter(d => d && d.kind === 'ind' && DATE_RE.test(d.d));
  if (!ind.length) return '';
  const d = ind.find(x => x.d >= today) || ind[ind.length - 1];
  const day = new Date(d.d + 'T12:00:00Z').getUTCDay();
  return WEEKDAYS[day] + ', ' + (+d.d.slice(8, 10)) + ' ' + MONTHS_GEN[+d.d.slice(5, 7) - 1] + (d.t ? ', ' + d.t : '');
}

// Отмечен ли пункт этапа. Предоплата — та же галочка, что в деньгах; даты — когда есть хоть одна
function stepOn(w, key) {
  if (key === 'prepay') return !!(w.money && w.money.prepaid);
  if (key === 'dates') return !!(w.dates && w.dates.length);
  return !!(w.steps && w.steps[key]);
}

// Где сейчас класс: этап, сколько отмечено, что дальше. Последний пункт этапа — переход
function stageOf(w) {
  for (let i = 0; i < STAGES.length; i++) {
    const st = STAGES[i];
    const last = st.steps[st.steps.length - 1][0];
    if (stepOn(w, last)) continue;
    const done = st.steps.filter(x => stepOn(w, x[0])).length;
    const next = st.steps.find(x => !stepOn(w, x[0]));
    return { index: i, stage: st, done: done, total: st.steps.length, next: next ? next[1] : '', finished: false };
  }
  const st = STAGES[STAGES.length - 1];
  return { index: STAGES.length, stage: null, done: st.steps.length, total: st.steps.length, next: '', finished: true };
}

// Даты съёмки, которые ещё не прошли (сегодняшняя тоже)
function upcoming(w, today) {
  return (w.dates || []).filter(d => d.d >= today);
}

// Деньги по классу, как в таблице: own — поля класса, se — цены сезона.
// Учеников Артур пишет сам (как в его таблице): число из отбора только подсказка в поле, в расчёт само не идёт
function calc(own, se, fallback, processor, payments, probes) {
  const n = amount(own.students) !== null ? amount(own.students) : 0;
  // альбомов классному руководителю: обычно 1, бывает 2. Каждый +1 в печать и +цена для родителей
  const teachers = Math.min(5, amount(own.teacher) || 0);
  const teacher = teachers > 0;
  const books = n + teachers;
  const price = amount(own.price) !== null ? amount(own.price) : se.price;
  const divisor = Math.max(1, amount(own.divisor) || se.divisor || 2);
  const extra = amount(own.extra) !== null ? amount(own.extra) : se.extra;
  const spreads = n ? Math.ceil(n / divisor) + extra : 0;
  const printOwn = amount(own.print);
  const printOne = printOwn !== null ? printOwn : (se.print[spreads] !== undefined ? se.print[spreads] : null);
  const printAll = printOne !== null ? books * printOne : 0;
  // пробники: альбомы для себя, только расход по цене печати одного альбома
  const probeN = Array.isArray(probes) ? probes.length : 0;
  const probeCost = printOne !== null ? probeN * printOne : 0;
  // обработчик: сам Артур — без расхода; не выбран — пока без расхода
  const who = String(processor || '');
  const p = se.processors.find(x => x.name === who);
  const proc = !who || who === SELF ? 0 : p ? p.rate : (se.processors[0] ? se.processors[0].rate : 0);
  const smm = n ? n * se.smm_per + se.smm_fixed : 0;
  const designer = n ? se.designer : 0;
  const costs = printAll + probeCost + designer + proc + smm;
  const total = n * (price || 0) + teachers * se.teacher;
  const prepay = own.prepaid ? se.prepay : 0;
  // оплаты после предоплаты: остаток одной суммой или частями
  const pays = Array.isArray(payments) ? payments : [];
  const paid = pays.reduce((n, p) => n + (amount(p.sum) || 0), 0);
  const received = prepay + paid;
  const missing = [];
  if (!n) missing.push('количество учеников');
  if (price === null || price === undefined) missing.push('цену альбома');
  if (n && printOne === null) missing.push('цену печати ' + spreads + ' разворотов');
  return {
    students: n, studentsOwn: amount(own.students) !== null, teacher: teacher, teachers: teachers, books: books,
    probes: probeN, probeCost: probeCost,
    price: price, priceOwn: amount(own.price) !== null, divisor: divisor, extra: extra, spreads: spreads,
    printOne: printOne, printOwn: printOwn !== null, printAll: printAll,
    designer: designer, processor: who, proc: proc, smm: smm, costs: costs,
    total: total, prepaid: !!own.prepaid, prepay: prepay, payments: pays, paid: paid, received: received,
    // rest — сколько ещё отдадут родители; restNet — сколько из этого чистыми, после всех расходов
    // (уже полученные деньги считаем полученной прибылью, как Артур и считает)
    rest: total - received, restNet: Math.max(0, total - costs - received), paidUp: total > 0 && received >= total,
    profit: total - costs, missing: missing, ready: !missing.length
  };
}

// «Инал 4000» по строке → [{ name, rate }]
function parseProcessors(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(l => {
    const m = /^(.*?)[\s—–:-]*([\d\s]+)?\s*(₽|руб\.?)?\s*$/.exec(l.trim());
    const name = line(m ? m[1] : l, NAME_MAX).replace(/[—–:-]+$/, '').trim();
    if (!name || name === SELF || out.some(x => x.name === name)) return;
    out.push({ name: name, rate: amount(m && m[2]) || 0 });
  });
  return out.slice(0, 20);
}

// «10 — 1024» по строке → { 10: 1024 }
function parsePrint(text) {
  const out = {};
  String(text || '').split(/\r?\n/).forEach(l => {
    const m = /^\s*(\d{1,3})\s*[^\d]+\s*([\d\s]+?)\s*(₽|руб\.?)?\s*$/.exec(l);
    if (!m) return;
    const k = +m[1], v = amount(m[2]);
    if (k > 0 && k < 200 && v) out[k] = v;
  });
  return out;
}

function normSeason(se) {
  const out = Object.assign({}, SEASON_DEFAULT, se);
  SEASON_FIELDS.forEach(x => { const n = amount(out[x[0]]); out[x[0]] = n === null ? SEASON_DEFAULT[x[0]] : n; });
  out.processors = Array.isArray(out.processors) ? out.processors.filter(p => p && p.name) : SEASON_DEFAULT.processors;
  out.print = out.print && typeof out.print === 'object' ? out.print : PRINT_DEFAULT;
  return out;
}

class Work {
  constructor(store, dir) {
    this.store = store;
    this.db = store.db;
    // фото и скрины к правкам: <dir>/<класс>/<id>.jpg
    this.dir = dir || '';
    this.db.exec(SCHEMA);
    COLUMNS.forEach(c => {
      const have = this.db.prepare('PRAGMA table_info(' + c[0] + ')').all().map(r => r.name);
      if (have.indexOf(c[1]) === -1) this.db.exec('ALTER TABLE ' + c[0] + ' ADD COLUMN ' + c[1] + ' ' + c[2]);
    });
  }

  // ---------- класс ----------
  parse(row, classId) {
    const r = row ? Object.assign({}, row) : {
      class_id: classId, status: 'todo', status_at: null, shot: 0, shoot_date: '', shoot_place: '',
      processor: '', phone: '', note: '', done: '{}', money: '{}', steps: '{}', dates: '[]', contacts: '[]', half: '', paid: '[]', city: '', probes: '[]', tg: '',
      created_at: 0, updated_at: 0
    };
    r.done = parseJson(r.done, {});
    r.money = parseJson(r.money, {});
    r.steps = parseJson(r.steps || '{}', {});
    r.dates = (Array.isArray(parseJson(r.dates || '[]', [])) ? parseJson(r.dates || '[]', []) : []).filter(d => d && DATE_RE.test(d.d))
      .sort((a, b) => (a.d + (a.t || '')).localeCompare(b.d + (b.t || '')));
    r.contacts = (Array.isArray(parseJson(r.contacts || '[]', [])) ? parseJson(r.contacts || '[]', []) : []).filter(c => c && c.phone);
    r.probes = (Array.isArray(parseJson(r.probes || '[]', [])) ? parseJson(r.probes || '[]', []) : []).filter(p => p && p.name);
    r.paid = (Array.isArray(parseJson(r.paid || '[]', [])) ? parseJson(r.paid || '[]', []) : []).filter(p => p && amount(p.sum));
    if (!r.contacts.length && r.phone) r.contacts = [{ name: '', phone: r.phone }];
    if (!STATUS_NAMES[r.status]) r.status = 'todo';
    if (!HALF_NAMES[r.half]) r.half = '';
    // фотосессия была — для дизайнера: отсняли индивидуальную или групповую
    r.shot = !!(r.steps.shot_ind || r.steps.shot_group || r.shot);
    return r;
  }

  get(classId) {
    return this.parse(this.db.prepare('SELECT * FROM wk_classes WHERE class_id = ?').get(classId), classId);
  }

  all() {
    const m = new Map();
    this.db.prepare('SELECT * FROM wk_classes').all().forEach(r => m.set(r.class_id, this.parse(r)));
    return m;
  }

  ensure(classId) {
    const now = Date.now();
    this.db.prepare('INSERT OR IGNORE INTO wk_classes (class_id, created_at, updated_at) VALUES (?, ?, ?)').run(classId, now, now);
  }

  // Обработчик, где снимали, заметка
  updateInfo(classId, f) {
    this.ensure(classId);
    this.db.prepare('UPDATE wk_classes SET shoot_place = ?, processor = ?, note = ?, updated_at = ? WHERE class_id = ?')
      .run(line(f.shoot_place, 120), line(f.processor, NAME_MAX), clean(f.note, TEXT_MAX), Date.now(), classId);
  }

  save(classId, field, value) {
    this.ensure(classId);
    this.db.prepare('UPDATE wk_classes SET ' + field + ' = ?, updated_at = ? WHERE class_id = ?').run(typeof value === 'string' ? value : JSON.stringify(value), Date.now(), classId);
  }

  // Галочка этапа. Предоплата пишется в деньги, даты отмечаются сами
  setStep(classId, key, on, who) {
    if (!STEP_NAMES[key] || key === 'dates') return false;
    if (key === 'prepay') {
      const was = stepOn(this.get(classId), 'prepay');
      this.setPrepaid(classId, on);
      if (was !== !!on) this.event(classId, who, (on ? '✓ ' : 'снято: ') + 'Предоплата', true);
      return true;
    }
    const w = this.get(classId);
    if (!!w.steps[key] === !!on) return true;
    if (on) w.steps[key] = Date.now(); else delete w.steps[key];
    this.save(classId, 'steps', w.steps);
    this.event(classId, who, (on ? '✓ ' : 'снято: ') + STEP_NAMES[key], true);
    return true;
  }

  setHalf(classId, h) {
    this.save(classId, 'half', HALF_NAMES[h] ? h : '');
  }

  // Даты съёмки: день, время (можно без него), какая съёмка
  addDate(classId, f) {
    const d = String(f.d || '');
    if (!DATE_RE.test(d)) return { error: 'Выберите дату съёмки' };
    const t = TIME_RE.test(String(f.t || '')) ? f.t : '';
    const w = this.get(classId);
    if (w.dates.length >= 20) return { error: 'Слишком много дат' };
    w.dates.push({ d: d, t: t, kind: f.kind === 'group' ? 'group' : 'ind', note: line(f.note, 80) });
    this.save(classId, 'dates', w.dates);
    return { ok: true };
  }

  // Дата съёмки прошла — «Отсняли индивидуальную/групповую» отмечается само.
  // Прошла: на следующий день, а если указано время — через 3 часа после начала.
  // Каждая дата срабатывает один раз (метка auto): если Артур снимет галочку (съёмку перенесли),
  // она сама больше не вернётся — до новой даты
  autoShoots(today, nowMin) {
    const rows = this.db.prepare("SELECT class_id, steps, dates FROM wk_classes WHERE dates != '[]'").all();
    let n = 0;
    rows.forEach(row => {
      const steps = parseJson(row.steps || '{}', {});
      const dates = parseJson(row.dates || '[]', []);
      if (!Array.isArray(dates)) return;
      let changed = false;
      dates.forEach(d => {
        if (!d || d.auto || (d.kind !== 'ind' && d.kind !== 'group') || !DATE_RE.test(d.d)) return;
        const m = TIME_RE.test(d.t || '') ? +d.t.slice(0, 2) * 60 + +d.t.slice(3, 5) : null;
        const passed = d.d < today || (d.d === today && m !== null && nowMin >= m + 180);
        if (!passed) return;
        d.auto = 1;
        changed = true;
        const key = d.kind === 'ind' ? 'shot_ind' : 'shot_group';
        if (!steps[key]) {
          steps[key] = Date.now();
          this.event(row.class_id, 'Артур', '✓ ' + STEP_NAMES[key] + ' (дата съёмки прошла, отмечено само)', true);
          n++;
        }
      });
      if (changed) this.db.prepare('UPDATE wk_classes SET steps = ?, dates = ?, updated_at = ? WHERE class_id = ?').run(JSON.stringify(steps), JSON.stringify(dates), Date.now(), row.class_id);
    });
    return n;
  }

  removeDate(classId, i) {
    const w = this.get(classId);
    if (!w.dates[i]) return false;
    w.dates.splice(i, 1);
    this.save(classId, 'dates', w.dates);
    return true;
  }

  // Телефоны для связи: «Мама Азамата» и номер, по строке. Пустые убираем
  setContacts(classId, names, phones) {
    names = [].concat(names || []);
    phones = [].concat(phones || []);
    const list = [];
    phones.forEach((p, i) => {
      const phone = line(p, 40);
      if (phone && list.length < 10) list.push({ name: line(names[i], 60), phone: phone });
    });
    this.save(classId, 'contacts', list);
    this.save(classId, 'phone', '');
  }

  // Деньги класса: количество, классный руководитель, цена, предоплата; развороты и печать — если не как обычно
  updateMoney(classId, f) {
    this.ensure(classId);
    const m = {};
    ['students', 'price', 'divisor', 'extra', 'print'].forEach(k => { const n = amount(f[k]); if (n !== null) m[k] = n; });
    if (m.divisor === 0) delete m.divisor;
    // раньше была галочка (1), теперь число альбомов
    const tn = amount(f.teacher);
    if (tn) m.teacher = Math.min(5, tn);
    if (f.prepaid) m.prepaid = 1;
    this.db.prepare('UPDATE wk_classes SET money = ?, updated_at = ? WHERE class_id = ?').run(JSON.stringify(m), Date.now(), classId);
  }

  setPrepaid(classId, on) {
    this.ensure(classId);
    const m = this.get(classId).money;
    if (on) m.prepaid = 1; else delete m.prepaid;
    this.db.prepare('UPDATE wk_classes SET money = ?, updated_at = ? WHERE class_id = ?').run(JSON.stringify(m), Date.now(), classId);
  }

  // Оплата после предоплаты. Сумма пустая — значит «весь остаток»
  addPayment(classId, sum, note, rest) {
    // пустое поле — весь остаток, а непонятная сумма — ошибка, а не «весь остаток»
    const empty = !String(sum === undefined || sum === null ? '' : sum).trim();
    let n = amount(sum);
    if (empty && rest > 0) n = rest;
    if (!n) return { error: 'Напишите сумму' };
    const w = this.get(classId);
    if (w.paid.length >= 50) return { error: 'Слишком много оплат' };
    w.paid.push({ sum: n, note: line(note, 80), at: Date.now() });
    this.save(classId, 'paid', w.paid);
    this.event(classId, 'Артур', 'оплата ' + n + ' ₽' + (note ? ' · ' + line(note, 80) : ''), true);
    return { ok: true, sum: n };
  }

  removePayment(classId, i) {
    const w = this.get(classId);
    if (!w.paid[i]) return false;
    const p = w.paid.splice(i, 1)[0];
    this.save(classId, 'paid', w.paid);
    this.event(classId, 'Артур', 'убрана оплата ' + p.sum + ' ₽', true);
    return true;
  }

  setCity(classId, city) {
    this.save(classId, 'city', line(city, 60));
  }

  // Группа класса в Telegram. Пустая строка — убрать. Ссылка появилась — пункт «Группа» отмечается сам
  setTg(classId, v) {
    const raw = String(v || '').trim();
    const url = raw ? tgUrl(raw) : '';
    if (raw && !url) return false;
    this.save(classId, 'tg', url);
    if (url) this.setStep(classId, 'group', true, 'Артур');
    return true;
  }

  // Пробник: альбом для себя, подписан фамилией, чтобы знать, чей
  addProbe(classId, name) {
    const n = line(name, NAME_MAX);
    if (!n) return { error: 'Напишите фамилию' };
    const w = this.get(classId);
    if (w.probes.length >= 20) return { error: 'Слишком много пробников' };
    w.probes.push({ name: n, at: Date.now() });
    this.save(classId, 'probes', w.probes);
    this.event(classId, 'Артур', 'пробник: ' + n, true);
    return { ok: true };
  }

  removeProbe(classId, i) {
    const w = this.get(classId);
    if (!w.probes[i]) return false;
    w.probes.splice(i, 1);
    this.save(classId, 'probes', w.probes);
    return true;
  }

  // ---------- лиды: кто спрашивал про съёмку ----------
  newLeads() { return this.db.prepare("SELECT COUNT(*) n FROM wk_leads WHERE status = 'new'").get().n; }

  leads() {
    return this.db.prepare("SELECT * FROM wk_leads ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'talk' THEN 1 ELSE 2 END, created_at DESC, id DESC").all();
  }

  lead(id) { return this.db.prepare('SELECT * FROM wk_leads WHERE id = ?').get(id) || null; }

  // Номер не обязателен: бывает, что параллель «будет брать», а родители ещё не написали
  addLead(f) {
    const phone = line(f.phone, 40);
    if (phone && !/\d{5,}/.test(phone.replace(/\D/g, ''))) return { error: 'Номер какой-то не такой, проверьте' };
    if (!phone && !line(f.school, 60) && !line(f.title, 40) && !clean(f.note, 500)) return { error: 'Напишите номер, школу или заметку' };
    const now = Date.now();
    const id = this.db.prepare('INSERT INTO wk_leads (phone, school, title, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(phone, line(f.school, 60), line(f.title, 40), clean(f.note, 500), now, now).lastInsertRowid;
    return { ok: true, id: Number(id) };
  }

  updateLead(id, f) {
    const l = this.lead(id);
    if (!l) return false;
    const upd = {};
    if ('status' in f && LEAD_STATUS[f.status]) upd.status = f.status;
    if ('note' in f) upd.note = clean(f.note, 500);
    if ('classId' in f) upd.class_id = f.classId || null;
    const keys = Object.keys(upd);
    if (!keys.length) return true;
    this.db.prepare('UPDATE wk_leads SET ' + keys.map(k => k + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?').run(...keys.map(k => upd[k]), Date.now(), id);
    return true;
  }

  removeLead(id) {
    return this.db.prepare('DELETE FROM wk_leads WHERE id = ?').run(id).changes === 1;
  }

  // ---------- шаблоны сообщений на этапах ----------
  templates() {
    const own = this.store.getSetting('work.templates', null) || {};
    const out = {};
    TEMPLATES.forEach(t => { out[t[0]] = typeof own[t[0]] === 'string' && own[t[0]].trim() ? own[t[0]] : t[2]; });
    return out;
  }

  setTemplates(f) {
    const own = {};
    TEMPLATES.forEach(t => {
      const v = clean(f[t[0]], 3000);
      if (v && v !== t[2]) own[t[0]] = v;
    });
    this.store.setSetting('work.templates', own);
  }

  // ---------- сезоны ----------
  seasons() {
    return this.db.prepare("SELECT key FROM settings WHERE key LIKE 'work.season.%'").all().map(r => +r.key.slice(12)).filter(Boolean).sort();
  }

  // Цены сезона. Если сезон ещё не настраивали — как у ближайшего прошлого, иначе обычные
  season(year) {
    year = +year;
    let se = this.store.getSetting('work.season.' + year, null);
    if (!se) {
      const list = this.seasons();
      const prev = list.filter(y => y < year).pop() || list.filter(y => y > year)[0];
      se = prev ? this.store.getSetting('work.season.' + prev, null) : null;
    }
    return normSeason(se || SEASON_DEFAULT);
  }

  setSeason(year, f) {
    const se = this.season(year);
    SEASON_FIELDS.forEach(x => { const n = amount(f[x[0]]); if (n !== null) se[x[0]] = n; });
    if (!se.divisor) se.divisor = 1;
    if (typeof f.processors === 'string') se.processors = parseProcessors(f.processors);
    if (typeof f.print === 'string') {
      const t = parsePrint(f.print);
      if (Object.keys(t).length) se.print = t;
    }
    this.store.setSetting('work.season.' + (+year), se);
    return se;
  }

  money(w, cls, fallback) { return calc(w.money, this.season(cls.year), fallback, w.processor, w.paid, w.probes); }

  // ---------- доставка: за сезон, суммы вручную ----------
  deliveries(season) {
    return this.db.prepare('SELECT * FROM wk_delivery WHERE season = ? ORDER BY at DESC, id DESC').all(+season);
  }
  addDelivery(season, sum, note, h) {
    const n = amount(sum);
    if (!n) return false;
    this.db.prepare('INSERT INTO wk_delivery (season, amount, note, half, at) VALUES (?, ?, ?, ?, ?)').run(+season, n, line(note, 200), HALF_NAMES[h] ? h : '', Date.now());
    return true;
  }
  removeDelivery(id) {
    return this.db.prepare('DELETE FROM wk_delivery WHERE id = ?').run(id).changes === 1;
  }

  // Статус. who — «Артур» или имя дизайнера; пишется в переписку
  setStatus(classId, status, who) {
    if (!STATUS_NAMES[status]) return false;
    this.ensure(classId);
    const cur = this.get(classId);
    if (cur.status === status) return false;
    const now = Date.now();
    this.db.prepare('UPDATE wk_classes SET status = ?, status_at = ?, updated_at = ? WHERE class_id = ?').run(status, now, now, classId);
    this.event(classId, who, 'статус: ' + STATUS_NAMES[status]);
    return true;
  }

  setPart(classId, part, on, who) {
    if (!PART_NAMES[part]) return false;
    this.ensure(classId);
    const done = this.get(classId).done;
    if (!!done[part] === !!on) return false;
    if (on) done[part] = Date.now(); else delete done[part];
    this.db.prepare('UPDATE wk_classes SET done = ?, updated_at = ? WHERE class_id = ?').run(JSON.stringify(done), Date.now(), classId);
    this.event(classId, who, (on ? 'готово: ' : 'снята галочка: ') + PART_NAMES[part]);
    return true;
  }

  // ---------- правки ----------
  fixes(classId) {
    return this.db.prepare('SELECT * FROM wk_fixes WHERE class_id = ? ORDER BY done_at IS NOT NULL, CASE WHEN done_at IS NULL THEN created_at END, done_at DESC, id').all(classId);
  }

  openCounts() {
    const m = new Map();
    this.db.prepare('SELECT class_id, COUNT(*) n FROM wk_fixes WHERE done_at IS NULL GROUP BY class_id').all().forEach(r => m.set(r.class_id, r.n));
    return m;
  }

  // Новая правка. Если дизайнер уже отдала работу, класс возвращается к ней: «Новые корректировки»
  addFix(classId, f) {
    if (!FIX_NAMES[f.kind]) return { error: 'Выберите, что исправить' };
    const text = clean(f.text, f.kind === 'teacher_wish' ? 4000 : TEXT_MAX);
    if (f.kind === 'other' && !text) return { error: 'Напишите, что сделать' };
    this.ensure(classId);
    const id = this.db.prepare('INSERT INTO wk_fixes (class_id, student_id, student_name, kind, text, who, auto, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(classId, f.studentId || null, line(f.studentName, NAME_MAX), f.kind, text, line(f.who, NAME_MAX) || 'Артур', f.auto ? 1 : 0, Date.now()).lastInsertRowid;
    this.event(classId, f.who || 'Артур', 'правка' + (f.studentName ? ' · ' + f.studentName : ' · весь класс') + ': ' + FIX_NAMES[f.kind]);
    this.reopen(classId, f.who || 'Артур');
    return { ok: true, id: Number(id) };
  }

  reopen(classId, who) {
    const st = this.get(classId).status;
    if (st === 'review' || st === 'check' || st === 'print') this.setStatus(classId, 'fixes', who);
  }

  fix(classId, id) {
    return this.db.prepare('SELECT * FROM wk_fixes WHERE class_id = ? AND id = ?').get(classId, id) || null;
  }

  setFixDone(classId, id, on, who) {
    const f = this.fix(classId, id);
    if (!f || !!f.done_at === !!on) return false;
    this.db.prepare('UPDATE wk_fixes SET done_at = ?, done_by = ? WHERE id = ?').run(on ? Date.now() : null, on ? line(who, NAME_MAX) : '', f.id);
    this.event(classId, who, (on ? 'исправлено' : 'снова нужно исправить') + (f.student_name ? ' · ' + f.student_name : '') + ': ' + FIX_NAMES[f.kind]);
    return true;
  }

  deleteFix(classId, id) {
    const files = this.fixFiles(classId, id);
    const gone = this.db.prepare('DELETE FROM wk_fixes WHERE class_id = ? AND id = ?').run(classId, id).changes === 1;
    if (gone) files.forEach(f => this.unlinkFile(classId, f.id));
    return gone;
  }

  // ---------- фото и скрины к правкам ----------
  // Браузер сам ужимает фото перед отправкой, здесь только проверяем, что это JPEG, и сохраняем
  fileDir(classId) { return path.join(this.dir, String(+classId)); }
  filePath(classId, id) { return path.join(this.fileDir(classId), id + '.jpg'); }

  fixFiles(classId, fixId) {
    return this.db.prepare('SELECT * FROM wk_fix_files WHERE class_id = ? AND fix_id = ? ORDER BY created_at, rowid').all(classId, fixId);
  }

  // Все файлы правок класса: { правка: [файлы] }
  filesByFix(classId) {
    const m = new Map();
    this.db.prepare('SELECT * FROM wk_fix_files WHERE class_id = ? ORDER BY created_at, rowid').all(classId).forEach(f => {
      if (!m.has(f.fix_id)) m.set(f.fix_id, []);
      m.get(f.fix_id).push(f);
    });
    return m;
  }

  fixFile(classId, id) {
    if (!FILE_ID.test(String(id))) return null;
    return this.db.prepare('SELECT * FROM wk_fix_files WHERE class_id = ? AND id = ?').get(classId, id) || null;
  }

  saveFixFile(classId, fixId, label, buf) {
    if (!this.dir) return { error: 'Файлы не настроены' };
    const f = this.fix(classId, fixId);
    if (!f) return { error: 'Правка не найдена' };
    if (this.fixFiles(classId, fixId).length >= FILES_PER_FIX) return { error: 'К одной правке можно прикрепить до ' + FILES_PER_FIX + ' фото' };
    if (!buf || buf.length > FILE_MAX) return { error: 'Фото слишком большое' };
    const size = jpegSize(buf);
    if (!size) return { error: 'Это не похоже на фото' };
    const id = newId();
    fs.mkdirSync(this.fileDir(classId), { recursive: true });
    const tmp = this.filePath(classId, id) + '.' + process.pid + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.filePath(classId, id));
    this.db.prepare('INSERT INTO wk_fix_files (id, fix_id, class_id, label, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, f.id, classId, FILE_LABELS[label] !== undefined ? label : '', size.w, size.h, Date.now());
    return { ok: true, id: id };
  }

  unlinkFile(classId, id) {
    try { fs.unlinkSync(this.filePath(classId, id)); } catch (e) {}
  }

  // Класс удалён: записи ушли каскадом, здесь — файлы
  removeFiles(classId) {
    if (this.dir) fs.rmSync(this.fileDir(classId), { recursive: true, force: true });
  }

  // Ученик поменял цитату, когда дизайнер уже начала: правка «Заменить цитату» появляется сама.
  // Пока она не исправлена, новые изменения цитаты дописываются в неё же, а не плодят новые
  studentQuote(classId, student, quote) {
    const w = this.db.prepare('SELECT status FROM wk_classes WHERE class_id = ?').get(classId);
    if (!w || w.status === 'todo') return false;
    const open = this.db.prepare("SELECT id FROM wk_fixes WHERE class_id = ? AND student_id = ? AND kind = 'quote' AND auto = 1 AND done_at IS NULL").get(classId, student.id);
    const text = clean(quote, TEXT_MAX);
    if (open) {
      this.db.prepare('UPDATE wk_fixes SET text = ?, created_at = ? WHERE id = ?').run(text, Date.now(), open.id);
      return true;
    }
    this.addFix(classId, { studentId: student.id, studentName: student.name, kind: 'quote', text: text, who: student.name, auto: true });
    return true;
  }

  // Классный руководитель поменял пожелание классу, когда дизайнер уже начала. Как с цитатой ученика
  teacherWish(classId, wish) {
    const w = this.db.prepare('SELECT status FROM wk_classes WHERE class_id = ?').get(classId);
    if (!w || w.status === 'todo') return false;
    const open = this.db.prepare("SELECT id FROM wk_fixes WHERE class_id = ? AND kind = 'teacher_wish' AND auto = 1 AND done_at IS NULL").get(classId);
    const text = clean(wish, 4000);
    if (open) {
      this.db.prepare('UPDATE wk_fixes SET text = ?, created_at = ? WHERE id = ?').run(text, Date.now(), open.id);
      return true;
    }
    this.addFix(classId, { studentName: 'Классный руководитель', kind: 'teacher_wish', text: text, who: 'Классный руководитель', auto: true });
    return true;
  }

  // ---------- переписка ----------
  // Дизайнеру — без записей «только для Артура»: оплаты и его этапы. Старые записи этапов узнаём по началу
  notes(classId, limit, forDesigner) {
    const hide = forDesigner ? " AND kind != 'admin' AND NOT (kind = 'event' AND (text LIKE '✓ %' OR text LIKE 'снято: %'))" : '';
    return this.db.prepare('SELECT * FROM wk_notes WHERE class_id = ?' + hide + ' ORDER BY at DESC, id DESC LIMIT ?').all(classId, limit || 80);
  }

  addNote(classId, who, text) {
    const t = clean(text, TEXT_MAX);
    if (!t) return false;
    this.ensure(classId);
    this.db.prepare('INSERT INTO wk_notes (class_id, who, kind, text, at) VALUES (?, ?, ?, ?, ?)').run(classId, line(who, NAME_MAX), 'comment', t, Date.now());
    return true;
  }

  // own — видит только Артур (деньги и его этапы), дизайнеру не показывается
  event(classId, who, text, own) {
    this.db.prepare('INSERT INTO wk_notes (class_id, who, kind, text, at) VALUES (?, ?, ?, ?, ?)').run(classId, line(who, NAME_MAX) || 'Артур', own ? 'admin' : 'event', text, Date.now());
  }

  // ---------- дизайнеры: вход по личной ссылке ----------
  designers() {
    return this.db.prepare('SELECT * FROM wk_designers ORDER BY id').all();
  }

  addDesigner(name) {
    const n = line(name, NAME_MAX);
    if (!n) return null;
    const t = token(24);
    this.db.prepare('INSERT INTO wk_designers (name, token, created_at) VALUES (?, ?, ?)').run(n, t, Date.now());
    return t;
  }

  removeDesigner(id) {
    return this.db.prepare('DELETE FROM wk_designers WHERE id = ?').run(id).changes === 1;
  }

  designerByToken(t) {
    if (typeof t !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(t)) return null;
    const d = this.db.prepare('SELECT * FROM wk_designers WHERE token = ?').get(t);
    if (d && (!d.seen_at || Date.now() - d.seen_at > 60 * 1000)) this.db.prepare('UPDATE wk_designers SET seen_at = ? WHERE id = ?').run(Date.now(), d.id);
    return d || null;
  }
}

module.exports = { Work, tgUrl, shootText, FILE_LABELS, FILE_MAX, readFile, LEAD_STATUSES, LEAD_STATUS, TEMPLATES, TEMPLATE_STEP, fill, calc, half, stepOn, stageOf, upcoming, STAGES, STEP_NAMES, HALVES, HALF_NAMES, DATE_KINDS, DATE_KIND_NAMES, amount, parsePrint, parseProcessors, normSeason, SELF, SEASON_DEFAULT, SEASON_FIELDS, STATUSES, STATUS_NAMES, DESIGNER_STATUSES, PARTS, PART_NAMES, FIXES, FIX_NAMES };
