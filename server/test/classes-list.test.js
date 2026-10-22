'use strict';

// Доска «Работа» вместо вкладки «Классы»: голосования, что выбрал класс, рабочий стол, архив,
// одна шапка класса с разделами

const test = require('node:test');
const assert = require('node:assert');
const { start, adminLogin, createClass } = require('./helpers');

test('доска: голосование ждёт решения, что выбрал класс, рабочий стол, архив', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = +(await createClass(admin, 'Гимназия №4', '11 «Б»'));
  const store = s.app.store;
  const opts = store.listOptions();
  const now = Date.now();
  store.updateClass(id, { opened_at: now - 7200000, ends_at: now - 3600000 });
  const theme = opts.theme.filter(o => !o.hidden), color = opts.color.filter(o => !o.hidden);
  // тема: явный победитель, цвет: ничья
  ['a', 'b', 'c'].forEach(v => store.addVote(id, 'voter_' + v + '_xxxxxxxxxxxx', 'theme', theme[0].key));
  store.addVote(id, 'voter_a_xxxxxxxxxxxx', 'color', color[0].key);
  store.addVote(id, 'voter_b_xxxxxxxxxxxx', 'color', color[1].key);
  // «Классы» больше нет в меню, /admin — это доска
  let r = await admin.req('GET', '/admin');
  assert.strictEqual(r.status, 200);
  assert.doesNotMatch(r.text, />Классы</);
  assert.match(r.text, /class="card wk-votes"[\s\S]*Гимназия №4 · 11 «Б»[\s\S]*нужно выбрать победителя/);
  const card = r.text.slice(r.text.indexOf('class="wk-card '));
  assert.match(card, /<b class="wk-card__name">.*Гимназия №4 · 11 «Б»<\/b>/);
  assert.match(card, new RegExp('<i>Тема:</i> ' + theme[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(card, /голосование: нужно выбрать/);
  // рабочий стол
  r = await admin.post('/admin/c/' + id + '/work/pin', { on: '1', back: '/admin/work' });
  assert.strictEqual(r.status, 303);
  assert.match(r.headers.get('location'), /^\/admin\/work\?m=pinned$/);
  r = await admin.req('GET', '/admin/work');
  assert.match(r.text, /id="desk"[\s\S]*Гимназия №4 · 11 «Б»/);
  // чужой адрес возврата не принимается
  r = await admin.post('/admin/c/' + id + '/work/pin', { on: '0', back: 'https://evil.example/' });
  assert.match(r.headers.get('location'), /^\/admin\/work\?m=unpinned$/);
  r = await admin.req('GET', '/admin/work');
  assert.doesNotMatch(r.text, /id="desk"/);
  // архив внизу доски
  store.updateClass(id, { archived: 1 });
  r = await admin.req('GET', '/admin/work');
  assert.match(r.text, /id="archive"[\s\S]*Гимназия №4 · 11 «Б»/);
});

test('папка с фото для дизайнера и индивидуальный дизайн', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = +(await createClass(admin, 'Лицей 2', '11 «А»'));
  let r = await admin.post('/admin/c/' + id + '/work/folder', { folder: 'javascript:alert(1)' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/c/' + id + '/work/folder', { folder: 'https://disk.yandex.ru/d/abc' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(s.app.work.get(id).folder, 'https://disk.yandex.ru/d/abc');
  r = await admin.post('/admin/c/' + id + '/work/design', { on: '1', design: 'Совмещённый стиль грей и классик' });
  assert.strictEqual(s.app.work.get(id).design, 'Совмещённый стиль грей и классик');
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /disk\.yandex\.ru\/d\/abc/);
  assert.match(r.text, /Совмещённый стиль грей и классик/);
  // дизайнер видит кнопку скачать и пометку
  const token = s.app.work.addDesigner('Мадина');
  const d = require('./helpers').client(s.base);
  r = await d.req('GET', '/d/' + token + '/c/' + id);
  assert.match(r.text, /href="https:\/\/disk\.yandex\.ru\/d\/abc"[^>]*>Скачать фото класса/);
  assert.match(r.text, /Индивидуальный дизайн[\s\S]*Совмещённый стиль грей и классик/);
  // ребята видят пометку на странице класса
  r = await require('./helpers').client(s.base).req('GET', '/k/' + s.app.store.getClass(id).slug);
  assert.match(r.text, /Совмещённый стиль грей и классик/);
  // выключили — снова обычный
  await admin.post('/admin/c/' + id + '/work/design', {});
  assert.strictEqual(s.app.work.get(id).design, '');
});
