'use strict';

// Своя статистика сайта. Браузер присылает: открыли страницу, до каких блоков долистали и сколько
// на них пробыли, что нажали. Без cookie и без имён: посетитель — случайный номер из localStorage,
// здесь он ещё раз хэшируется. Сами IP не хранятся. Всё в таблицах st_*, старше 400 дней удаляется

const crypto = require('crypto');
const { tzParts } = require('./util');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS st_views (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  wd INTEGER NOT NULL,
  page TEXT NOT NULL,
  kind TEXT NOT NULL,
  class_id INTEGER,
  visitor TEXT NOT NULL,
  fresh INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL,
  dur INTEGER NOT NULL DEFAULT 0,
  depth INTEGER NOT NULL DEFAULT 0,
  spent TEXT NOT NULL DEFAULT '{}',
  reached TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS st_clicks (
  id INTEGER PRIMARY KEY,
  view_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  page TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  block TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS st_visitors (
  visitor TEXT PRIMARY KEY,
  first_day TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS st_links (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT 'index.html',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS st_views_day ON st_views (day);
CREATE INDEX IF NOT EXISTS st_clicks_day ON st_clicks (day);
CREATE INDEX IF NOT EXISTS st_clicks_view ON st_clicks (view_id);
`;

// Страницы сайта по-человечески
const PAGE_NAMES = {
  'index.html': 'Главная', 'works.html': 'Работы', 'albums.html': 'Альбомы и цены', 'designs.html': 'Дизайны',
  'studio.html': 'Студия', 'contacts.html': 'Контакты', 'prep.html': 'Подготовка'
};
const SITE_PAGES = Object.keys(PAGE_NAMES);
// Откуда пришли
const SOURCES = [
  ['instagram', 'Instagram'], ['yandex', 'Яндекс'], ['google', 'Google'], ['whatsapp', 'WhatsApp'],
  ['telegram', 'Telegram'], ['vk', 'ВКонтакте'], ['site', 'Другие сайты'], ['direct', 'Напрямую']
];
const SOURCE_NAMES = Object.fromEntries(SOURCES);
// Кнопки связи — то, ради чего сайт
const CONTACT = ['whatsapp', 'phone', 'telegram', 'instagram', 'vk'];
const KINDS = ['whatsapp', 'phone', 'instagram', 'telegram', 'vk', 'design', 'link', 'button'];
const ONLINE_MS = 40 * 1000;
const KEEP_DAYS = 400;
// Боты и превью ссылок скрипт почти никогда не запускают, но на всякий случай
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|vkshare|whatsapp\/|telegrambot|yandex(?!browser)/i;

function day(ms) {
  const p = tzParts(ms);
  return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
}

// Откуда пришёл человек: по странице, с которой перешёл, а если её нет — по встроенному браузеру приложения
function source(ref, ua, host) {
  let h = '';
  try { h = ref ? new URL(ref).hostname.replace(/^www\./, '') : ''; } catch (e) {}
  if (h && host && (h === host || h.endsWith('.' + host))) return 'internal';
  if (/instagram|ig\.me/.test(h) || /Instagram/.test(ua)) return 'instagram';
  if (/(^|\.)vk\.(com|ru)$|vkontakte/.test(h) || /VKClient|vkontakte/i.test(ua)) return 'vk';
  if (/(^|\.)t\.me$|telegram/.test(h) || /Telegram/.test(ua)) return 'telegram';
  if (/whatsapp/.test(h) || /WhatsApp/.test(ua)) return 'whatsapp';
  if (/(^|\.)ya(ndex)?\.(ru|com|by|kz)$|yandex/.test(h)) return 'yandex';
  if (/(^|\.)google\./.test(h)) return 'google';
  if (h) return 'site';
  return 'direct';
}

function device(ua, w) {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua) || (w && w < 700)) return 'mobile';
  return 'desktop';
}

function line(t, max) { return String(t || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function parse(s, def) { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : def; } catch (e) { return def; } }

class Stats {
  constructor(store, secret) {
    this.db = store.db;
    this.secret = secret;
    this.db.exec(SCHEMA);
    this.online = new Map();
    this.prune();
  }

  hash(s) { return crypto.createHmac('sha256', this.secret).update('st:' + s).digest('base64url').slice(0, 22); }
  key(id) { return this.hash('view:' + id).slice(0, 16); }
  keyOk(id, k) {
    const want = Buffer.from(this.key(id));
    const got = Buffer.from(String(k || ''));
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  // Открыли страницу. page — 'index.html' или '/k/<класс>', '/f/<отбор>'
  start(o) {
    if (BOT_RE.test(o.ua || '')) return 0;
    const now = o.now || Date.now();
    const p = tzParts(now);
    const d = day(now);
    // посетитель: номер браузера, а если localStorage недоступен — IP и браузер на этот день
    const visitor = this.hash(/^[a-f0-9]{24}$/.test(o.vid || '') ? 'v:' + o.vid : 'ip:' + o.ip + ':' + o.ua + ':' + d);
    const fresh = this.db.prepare('INSERT OR IGNORE INTO st_visitors (visitor, first_day) VALUES (?, ?)').run(visitor, d).changes ? 1 : 0;
    let link = '';
    const m = /[?&](?:s|utm_campaign)=([a-z0-9-]{1,40})/i.exec(o.search || '');
    if (m && this.db.prepare('SELECT 1 FROM st_links WHERE slug = ?').get(m[1].toLowerCase())) link = m[1].toLowerCase();
    const id = Number(this.db.prepare(`INSERT INTO st_views (at, day, hour, wd, page, kind, class_id, visitor, fresh, source, link, device)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(now, d, p.hour, new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(), o.page, o.kind,
      o.classId || null, visitor, fresh, source(o.ref, o.ua || '', o.host), link, device(o.ua || '', o.w)).lastInsertRowid);
    this.online.set(id, { at: now, page: o.page, kind: o.kind, classId: o.classId || null });
    return id;
  }

  // Сколько пробыли, до какого места долистали, сколько на каких блоках
  update(id, b) {
    const row = this.db.prepare('SELECT id, page, kind, class_id FROM st_views WHERE id = ?').get(id);
    if (!row) return false;
    const spent = {};
    Object.keys(b.s && typeof b.s === 'object' ? b.s : {}).slice(0, 60).forEach(k => {
      const n = Math.round(+b.s[k]);
      const name = line(k, 40);
      if (name && n > 0 && n < 6 * 3600 * 1000) spent[name] = n;
    });
    const reached = (Array.isArray(b.r) ? b.r : []).slice(0, 60).map(x => line(x, 40)).filter(Boolean);
    const dur = Math.max(0, Math.min(6 * 3600 * 1000, Math.round(+b.d) || 0));
    const depth = Math.max(0, Math.min(100, Math.round(+b.dp) || 0));
    this.db.prepare('UPDATE st_views SET dur = MAX(dur, ?), depth = MAX(depth, ?), spent = ?, reached = ? WHERE id = ?')
      .run(dur, depth, JSON.stringify(spent), JSON.stringify(reached), id);
    if (b.e) this.online.delete(id);
    else this.online.set(id, { at: Date.now(), page: row.page, kind: row.kind, classId: row.class_id });
    return true;
  }

  click(id, b) {
    const row = this.db.prepare('SELECT page FROM st_views WHERE id = ?').get(id);
    if (!row || KINDS.indexOf(b.kind) === -1) return false;
    const label = line(b.label, 40);
    if (!label) return false;
    // одна и та же кнопка много раз подряд в одном просмотре — считаем один раз
    if (this.db.prepare('SELECT 1 FROM st_clicks WHERE view_id = ? AND label = ? AND kind = ?').get(id, label, b.kind)) return true;
    const now = Date.now();
    this.db.prepare('INSERT INTO st_clicks (view_id, at, day, page, kind, label, block) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, now, day(now), row.page, b.kind, label, line(b.at, 40));
    return true;
  }

  // Кто сейчас на сайте: за последние 40 секунд
  onlineNow() {
    const now = Date.now();
    const out = [];
    this.online.forEach((v, k) => { if (now - v.at > ONLINE_MS) this.online.delete(k); else out.push(v); });
    return out;
  }

  prune() {
    const old = day(Date.now() - KEEP_DAYS * 86400000);
    this.db.prepare('DELETE FROM st_clicks WHERE day < ?').run(old);
    this.db.prepare('DELETE FROM st_views WHERE day < ?').run(old);
  }

  // ---------- ссылки для постов и сторис ----------
  links() { return this.db.prepare('SELECT * FROM st_links ORDER BY created_at DESC').all(); }
  addLink(slug, name, page) {
    this.db.prepare('INSERT INTO st_links (slug, name, page, created_at) VALUES (?, ?, ?, ?)').run(slug, line(name, 60), SITE_PAGES.indexOf(page) !== -1 ? page : 'index.html', Date.now());
  }
  linkTaken(slug) { return !!this.db.prepare('SELECT 1 FROM st_links WHERE slug = ?').get(slug); }
  removeLink(slug) { return this.db.prepare('DELETE FROM st_links WHERE slug = ?').run(slug).changes === 1; }

  // ---------- сводка за период: from и to — дни «2026-10-01» включительно ----------
  // Коротко за другой период — для сравнения: сколько людей и сколько хотели записаться
  summary(from, to) {
    const v = this.db.prepare('SELECT COUNT(DISTINCT visitor) n FROM st_views WHERE day >= ? AND day <= ?').get(from, to).n;
    const c = this.db.prepare(`SELECT COUNT(DISTINCT v.visitor) n FROM st_clicks c JOIN st_views v ON v.id = c.view_id
      WHERE c.day >= ? AND c.day <= ? AND c.kind IN ('whatsapp', 'phone', 'telegram')`).get(from, to).n;
    return { visitors: v, contacts: c };
  }

  report(from, to) {
    const views = this.db.prepare('SELECT * FROM st_views WHERE day >= ? AND day <= ?').all(from, to);
    const clicks = this.db.prepare('SELECT * FROM st_clicks WHERE day >= ? AND day <= ?').all(from, to);
    const site = views.filter(v => v.kind === 'site');
    const visitors = new Set(views.map(v => v.visitor));
    const siteVisitors = new Set(site.map(v => v.visitor));
    const fresh = new Set(views.filter(v => v.fresh).map(v => v.visitor));
    const contactViews = new Set(clicks.filter(c => CONTACT.indexOf(c.kind) !== -1 && (c.kind === 'whatsapp' || c.kind === 'phone' || c.kind === 'telegram')).map(c => c.view_id));
    const viewById = new Map(views.map(v => [v.id, v]));
    const contactVisitors = new Set(Array.from(contactViews).map(id => (viewById.get(id) || {}).visitor).filter(Boolean));

    // по дням
    const days = [];
    for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
    const byDay = days.map(d => {
      const vs = views.filter(v => v.day === d);
      return { day: d, visitors: new Set(vs.map(v => v.visitor)).size, views: vs.length };
    });
    // по неделям — для длинного периода. Человек, заходивший несколько дней за неделю, считается один раз
    const byWeek = [];
    for (let i = 0; i < days.length; i += 7) {
      const part = new Set(days.slice(i, i + 7));
      byWeek.push({ day: days[i], visitors: new Set(views.filter(v => part.has(v.day)).map(v => v.visitor)).size });
    }

    // откуда: первая страница визита (пришли не с нашего же сайта)
    const landings = views.filter(v => v.source !== 'internal');
    const src = {};
    landings.forEach(v => { src[v.source] = (src[v.source] || new Set()).add(v.visitor); });
    const sources = SOURCES.map(s => ({ key: s[0], name: s[1], n: src[s[0]] ? src[s[0]].size : 0 })).filter(s => s.n).sort((a, b) => b.n - a.n);

    // страницы сайта
    const pages = SITE_PAGES.map(p => {
      const vs = site.filter(v => v.page === p);
      const timed = vs.filter(v => v.dur > 0);
      return {
        page: p, name: PAGE_NAMES[p], views: vs.length, visitors: new Set(vs.map(v => v.visitor)).size,
        time: timed.length ? Math.round(timed.reduce((n, v) => n + v.dur, 0) / timed.length / 1000) : 0,
        depth: vs.length ? Math.round(vs.reduce((n, v) => n + v.depth, 0) / vs.length) : 0
      };
    }).filter(p => p.views).sort((a, b) => b.views - a.views);

    // блоки каждой страницы: сколько дошли и сколько в среднем пробыли
    const blocks = {};
    site.forEach(v => {
      const b = blocks[v.page] || (blocks[v.page] = { total: 0, list: {} });
      b.total++;
      const reached = parse(v.reached, []);
      const spent = parse(v.spent, {});
      Object.keys(spent).forEach(k => { if (reached.indexOf(k) === -1) reached.push(k); });
      reached.forEach(k => {
        const x = b.list[k] || (b.list[k] = { name: k, reached: 0, ms: 0, timed: 0 });
        x.reached++;
        if (spent[k]) { x.ms += spent[k]; x.timed++; }
      });
    });

    // кнопки
    const btn = {};
    clicks.forEach(c => {
      const k = c.kind + '|' + c.label;
      const x = btn[k] || (btn[k] = { kind: c.kind, label: c.label, n: 0, pages: {}, blocks: {} });
      x.n++;
      x.pages[c.page] = (x.pages[c.page] || 0) + 1;
      if (c.block) x.blocks[c.block] = (x.blocks[c.block] || 0) + 1;
    });
    const buttons = Object.values(btn).sort((a, b) => b.n - a.n);

    // тематики: время на карточке и сколько раз открывали фото
    const themes = {};
    (blocks['designs.html'] ? Object.values(blocks['designs.html'].list) : []).forEach(x => {
      if (/^Тематика /.test(x.name)) themes[x.name.slice(9)] = { name: x.name.slice(9), reached: x.reached, ms: x.ms, timed: x.timed, opens: 0 };
    });
    buttons.filter(b => b.kind === 'design').forEach(b => {
      const t = themes[b.label] || (themes[b.label] = { name: b.label, reached: 0, ms: 0, timed: 0, opens: 0 });
      t.opens += b.n;
    });

    // когда заходят: сколько людей. Один человек за день в один час считается один раз,
    // сколько бы страниц он ни открыл; в разные дни — каждый день
    const hourSets = Array.from({ length: 24 }, () => new Set());
    const weekSets = Array.from({ length: 7 }, () => new Set());
    site.forEach(v => { hourSets[v.hour].add(v.visitor + '|' + v.day); weekSets[v.wd].add(v.visitor + '|' + v.day); });
    const hours = hourSets.map(x => x.size);
    const week = weekSets.map(x => x.size);

    // телефон или компьютер — по людям
    const dev = { mobile: new Set(), desktop: new Set(), tablet: new Set() };
    views.forEach(v => { (dev[v.device] || dev.desktop).add(v.visitor); });

    // ссылки из постов
    const linkStats = {};
    views.filter(v => v.link).forEach(v => {
      const x = linkStats[v.link] || (linkStats[v.link] = { visitors: new Set(), contacts: new Set() });
      x.visitors.add(v.visitor);
      if (contactViews.has(v.id)) x.contacts.add(v.visitor);
    });
    // тот же человек мог нажать «написать» уже на другой странице после перехода по ссылке
    const linkOf = new Map();
    views.filter(v => v.link).forEach(v => { if (!linkOf.has(v.visitor)) linkOf.set(v.visitor, v.link); });
    contactVisitors.forEach(vis => { const l = linkOf.get(vis); if (l && linkStats[l]) linkStats[l].contacts.add(vis); });

    // классы: голосование и отбор
    const cls = {};
    views.filter(v => v.class_id).forEach(v => {
      const x = cls[v.class_id] || (cls[v.class_id] = { classId: v.class_id, vote: new Set(), pick: new Set() });
      (v.kind === 'class' ? x.vote : x.pick).add(v.visitor);
    });

    // прошлый такой же период для сравнения: «вчера» для «сегодня», прошлые 7 дней для 7 дней
    const len = days.length;
    const prev = this.summary(day(Date.parse(from + 'T12:00:00Z') - len * 86400000), day(Date.parse(from + 'T12:00:00Z') - 86400000));

    return {
      prev,
      visitors: visitors.size, siteVisitors: siteVisitors.size, views: views.length, siteViews: site.length,
      fresh: fresh.size, contacts: contactVisitors.size,
      byDay, byWeek, sources, pages, blocks, buttons, themes: Object.values(themes).sort((a, b) => (b.ms + b.opens * 4000) - (a.ms + a.opens * 4000)),
      hours, week,
      devices: { mobile: dev.mobile.size, desktop: dev.desktop.size, tablet: dev.tablet.size },
      links: Object.fromEntries(Object.keys(linkStats).map(k => [k, { visitors: linkStats[k].visitors.size, contacts: linkStats[k].contacts.size }])),
      classes: Object.values(cls).map(x => ({ classId: x.classId, vote: x.vote.size, pick: x.pick.size }))
    };
  }
}

module.exports = { Stats, source, device, day, PAGE_NAMES, SITE_PAGES, SOURCES, SOURCE_NAMES, CONTACT };
