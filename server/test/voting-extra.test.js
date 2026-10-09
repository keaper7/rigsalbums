'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { start, client, adminLogin, createClass } = require('./helpers');
const { toLocalInput, fromLocalInput } = require('../lib/util');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

test('голосование до точной даты вместо длительности', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  const cls = () => s.app.store.getClass(+id);

  // Дата в прошлом и слишком далеко — понятная ошибка, ничего не меняется
  let r = await admin.post('/admin/c/' + id + '/open', { duration_min: '60', until: toLocalInput(Date.now() - 10 * MIN) });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /позже начала/);
  r = await admin.post('/admin/c/' + id + '/open', { duration_min: '60', until: toLocalInput(Date.now() + 70 * DAY) });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/c/' + id + '/open', { duration_min: '60', until: 'вчера' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(cls().opened_at, null);

  // До 3 дней вперёд, 23:59 — длительность не учитывается
  const until = toLocalInput(Date.now() + 3 * DAY).slice(0, 11) + '23:59';
  r = await admin.post('/admin/c/' + id + '/open', { duration_min: '60', until: until });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(cls().ends_at, fromLocalInput(until));
  assert.strictEqual(cls().duration_min, 45, 'длительность класса не трогаем');

  // Ученик видит «д ч», а не 70-часовой счётчик
  const kid = client(s.base);
  r = await kid.req('GET', '/k/' + cls().slug);
  assert.match(r.text, /id="timer">\d+ д \d+ ч</);

  // Пока идёт: поменять время окончания на точное
  const later = toLocalInput(Date.now() + 5 * DAY);
  r = await admin.post('/admin/c/' + id + '/until', { until: later });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(cls().ends_at, fromLocalInput(later));
  r = await admin.post('/admin/c/' + id + '/until', { until: toLocalInput(Date.now() - MIN) });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(cls().ends_at, fromLocalInput(later));
  r = await admin.req('GET', '/admin/c/' + id);
  assert.match(r.text, /Изменить время окончания/);

  // Обычная длительность работает как раньше
  const id2 = await createClass(admin, 'Лицей', '11 «Б»');
  const t0 = Date.now();
  await admin.post('/admin/c/' + id2 + '/open', { duration_min: '120', until: '' });
  const c2 = s.app.store.getClass(+id2);
  assert.ok(Math.abs(c2.ends_at - (t0 + 120 * MIN)) < 5000);
  assert.strictEqual(c2.duration_min, 120);
});

test('запланированный старт с точной датой окончания', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «В»');
  const at = Math.ceil((Date.now() + 2 * DAY) / MIN) * MIN;
  const until = toLocalInput(at + 2 * DAY);
  let r = await admin.post('/admin/c/' + id + '/schedule', { at: toLocalInput(at), duration_min: '60', until: until });
  assert.strictEqual(r.status, 303);
  let c = s.app.store.getClass(+id);
  assert.strictEqual(c.opened_at, at);
  assert.strictEqual(c.ends_at, fromLocalInput(until));
  r = await admin.req('GET', '/admin/c/' + id);
  assert.match(r.text, /и закончится/);

  // Окончание раньше старта — нельзя
  const id2 = await createClass(admin, 'Лицей', '11 «Г»');
  r = await admin.post('/admin/c/' + id2 + '/schedule', { at: toLocalInput(at), duration_min: '60', until: toLocalInput(at - DAY) });
  assert.strictEqual(r.status, 400);

  // Правка названия не сбивает точную дату окончания
  await admin.post('/admin/c/' + id + '/info', { school: 'Лицей', title: '11 «В»', year: '2026', duration_min: '120', slug: c.slug });
  c = s.app.store.getClass(+id);
  assert.strictEqual(c.ends_at, fromLocalInput(until));
});

test('обнулить голоса одного этапа', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «Д»');
  await admin.post('/admin/c/' + id + '/open', { duration_min: '60' });
  const slug = s.app.store.getClass(+id).slug;
  const kids = [client(s.base), client(s.base), client(s.base)];
  for (const k of kids) {
    await k.req('GET', '/k/' + slug);
    let r = await k.req('POST', '/k/' + slug + '/vote', { json: { step: 'theme', option: 'neon' } });
    assert.strictEqual(r.status, 200, r.text);
    r = await k.req('POST', '/k/' + slug + '/vote', { json: { step: 'wear', option: 'casual' } });
    assert.strictEqual(r.status, 200, r.text);
  }
  const counts = () => s.app.store.counts(+id);
  assert.strictEqual(counts().theme.neon, 3);

  let r = await admin.req('GET', '/admin/c/' + id);
  assert.match(r.text, /Обнулить голоса этапа/);
  r = await admin.post('/admin/c/' + id + '/resetstep', { step: 'theme' });
  assert.strictEqual(r.status, 303);
  assert.deepStrictEqual(counts().theme, {});
  assert.strictEqual(counts().wear.casual, 3, 'другие этапы не трогаем');

  // Ученик видит, что его голос в этапе снят, и голосует заново
  r = await kids[0].req('GET', '/k/' + slug + '/state');
  assert.strictEqual(r.data.mine.theme, undefined);
  assert.strictEqual(r.data.mine.wear, 'casual');
  r = await kids[0].req('POST', '/k/' + slug + '/vote', { json: { step: 'theme', option: 'classic' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(counts().theme.classic, 1);

  // После закрытия: ручной выбор этапа тоже сбрасывается
  await admin.post('/admin/c/' + id + '/close');
  await admin.post('/admin/c/' + id + '/pick', { step: 'theme', option: 'neon' });
  assert.strictEqual(s.app.store.getClass(+id).picks.theme, 'neon');
  await admin.post('/admin/c/' + id + '/resetstep', { step: 'theme' });
  assert.strictEqual(s.app.store.getClass(+id).picks.theme, undefined);
  assert.deepStrictEqual(counts().theme, {});

  // Неизвестный этап — ничего не делаем
  r = await admin.post('/admin/c/' + id + '/resetstep', { step: 'zzz' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(counts().wear.casual, 3);

  // Без входа в админку — нельзя
  r = await client(s.base).req('POST', '/admin/c/' + id + '/resetstep', { form: { step: 'wear' } });
  assert.notStrictEqual(r.status, 303);
  assert.strictEqual(counts().wear.casual, 3);
});
