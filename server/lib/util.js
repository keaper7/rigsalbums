'use strict';

const crypto = require('crypto');

// Шаблоны: всё, что подставляется в html`...`, экранируется, кроме raw()
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (v instanceof Raw) return v.s;
  return esc(v);
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

function raw(s) { return new Raw(String(s)); }

// 1 голос, 2 голоса, 5 голосов
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

function slugify(s) {
  return String(s).toLowerCase()
    .split('').map(c => (c in TR ? TR[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Короткий случайный хвост для ссылки, без похожих букв
function randomCode(len) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += abc[bytes[i] % abc.length];
  return out;
}

function token(bytes) { return crypto.randomBytes(bytes || 24).toString('base64url'); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// ---------- время по часовому поясу студии (по умолчанию Москва) ----------
const TZ = process.env.TIMEZONE || 'Europe/Moscow';
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});

function tzParts(ms) {
  const o = {};
  PARTS.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour % 24, minute: +o.minute, second: +o.second };
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

function fmtTime(ms) {
  const p = tzParts(ms);
  return pad(p.hour) + ':' + pad(p.minute);
}

function fmtDate(ms) {
  if (!ms) return '';
  const p = tzParts(ms);
  return p.day + ' ' + MONTHS[p.month - 1] + ', ' + pad(p.hour) + ':' + pad(p.minute);
}

// «сегодня в 18:00», «завтра в 18:00» или «26 сентября в 18:00»
function fmtWhen(ms, now) {
  const p = tzParts(ms), n = tzParts(now || Date.now());
  const day = Date.UTC(p.year, p.month - 1, p.day), today = Date.UTC(n.year, n.month - 1, n.day);
  const diff = Math.round((day - today) / 86400000);
  const time = pad(p.hour) + ':' + pad(p.minute);
  if (diff === 0) return 'сегодня в ' + time;
  if (diff === 1) return 'завтра в ' + time;
  return p.day + ' ' + MONTHS[p.month - 1] + ' в ' + time;
}

// Значение для <input type="datetime-local"> и обратно
function toLocalInput(ms) {
  const p = tzParts(ms);
  return p.year + '-' + pad(p.month) + '-' + pad(p.day) + 'T' + pad(p.hour) + ':' + pad(p.minute);
}

function fromLocalInput(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(str || ''));
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = ms => {
    const p = tzParts(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  let t = guess - offset(guess);
  const again = guess - offset(t);
  if (again !== t) t = again;
  return t;
}

module.exports = { Raw, html, raw, esc, plural, slugify, randomCode, token, sha256, tzParts, fmtTime, fmtDate, fmtWhen, toLocalInput, fromLocalInput };
