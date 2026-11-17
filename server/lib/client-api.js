'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { json } = require('./http');

const stages = [
  ['culling', 'Отбор', 'pick'],
  ['exposure', 'Цветокор', 'color'],
  ['retouch', 'Ретушь', 'retouch'],
  ['layout', 'Вёрстка', null]
];
const iso = time => time > 0 ? new Date(time).toISOString() : null;
const hash = value => createHash('sha256').update(value).digest();

function createClientApi(store, work, token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
  const expected = hash('Bearer ' + token);
  let minute = 0;
  let count = 0;

  function view(cls) {
    const w = work.get(cls.id);
    const dates = [...new Set(w.dates.map(d => d.d))];
    if (!dates.length && w.shoot_date) dates.push(w.shoot_date);
    return {
      id: cls.id, school: cls.school, name: cls.title,
      shoot_date: dates[0] || null, shoot_dates: dates,
      students_count: null, note: null, site_url: null,
      updated_at: iso(Math.max(cls.created_at || 0, w.updated_at || 0)),
      stages: stages.map(([key, title, field]) => {
        const time = field && w.steps[field];
        return {key, title, done: !!time, done_at: iso(time), done_by: null, updated_at: null};
      })
    };
  }

  return function handle(req, res, url) {
    const error = (status, code) => json(res, status, {error: {code, message: code}});
    if (!timingSafeEqual(hash(req.headers.authorization || ''), expected)) return error(401, 'unauthorized');
    if (req.method !== 'GET') return error(405, 'method_not_allowed');
    const current = Math.floor(Date.now() / 60000);
    if (current !== minute) {
      minute = current;
      count = 0;
    }
    if (++count > 120) return error(429, 'rate_limit');

    const path = url.pathname.slice('/api/v1'.length);
    if (path === '/ping') return json(res, 200, {
      ok: true, api_version: '1.0.0', token: {name: 'rigsarthur-retouch', scopes: ['classes:read']},
      server_time: new Date().toISOString()
    });
    if (path === '/stages') return json(res, 200, {
      items: stages.map(([key, title], order) => ({key, title, order, writable: false}))
    });
    const detail = /^\/classes\/(\d+)$/.exec(path);
    if (detail) {
      const cls = store.getClass(Number(detail[1]));
      return cls && !cls.archived ? json(res, 200, view(cls)) : error(404, 'class_not_found');
    }
    if (path !== '/classes') return error(404, 'not_found');

    const q = url.searchParams;
    const limit = Number(q.get('limit') ?? 100);
    const cursor = Number(q.get('cursor') ?? 0);
    const since = q.has('updated_since') ? Date.parse(q.get('updated_since')) : -Infinity;
    const exact = q.get('shoot_date');
    const from = q.get('date_from');
    const to = q.get('date_to');
    const school = (q.get('school') ?? '').toLocaleLowerCase('ru');
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 ||
        !Number.isSafeInteger(cursor) || cursor < 0 || Number.isNaN(since) || school.length > 80 ||
        [exact, from, to].some(date => date !== null && (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date
        ))) return error(400, 'invalid_filter');
    const items = store.listClasses()
      .filter(cls => !cls.archived && cls.id > cursor && cls.school.toLocaleLowerCase('ru').includes(school))
      .sort((a, b) => a.id - b.id)
      .map(view)
      .filter(cls => (!q.has('updated_since') || Date.parse(cls.updated_at) > since) &&
        (!(exact || from || to) || cls.shoot_dates.some(date =>
          (!exact || date === exact) && (!from || date >= from) && (!to || date <= to))));
    return json(res, 200, {items: items.slice(0, limit), next_cursor: items.length > limit ? String(items[limit - 1].id) : null});
  };
}

module.exports = { createClientApi };
