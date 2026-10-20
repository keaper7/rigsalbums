'use strict';

// Вкладка «Классы»: на карточке видно, что выбрал класс, когда съёмка и на каком этапе работа

const test = require('node:test');
const assert = require('node:assert');
const { start, adminLogin, createClass } = require('./helpers');

test('карточка класса: итоги голосования, ничья, съёмка, этап', async t => {
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
  s.app.work.addDate(id, { d: '2030-05-14', t: '10:00', kind: 'ind' });
  s.app.work.setStep(id, 'prepay', true, 'Артур');
  const r = await admin.req('GET', '/admin');
  assert.strictEqual(r.status, 200);
  const card = r.text.slice(r.text.indexOf('11 «Б»'));
  assert.match(card, new RegExp('Тема:</i> ' + theme[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(card, /fact--warn"><i>Цвет:<\/i> ничья/);
  assert.match(card, /Съёмка:<\/i> вторник, 14 мая, 10:00/);
  assert.match(card, /Этап:<\/i> запись и подготовка, дальше группа/);
  // класс без голосов и без работы — карточка как раньше, без пустого блока
  await createClass(admin, 'Школа №5', '9 «А»');
  const r2 = await admin.req('GET', '/admin');
  const plain = r2.text.slice(r2.text.indexOf('9 «А»'), r2.text.indexOf('9 «А»') + 900);
  assert.doesNotMatch(plain.split('row--class')[0], /row__more/);
});
