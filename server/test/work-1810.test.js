'use strict';

// Правки Артура 18.10: создание класса сразу с данными для работы, город, переименование, пробники,
// несколько альбомов кл. руку, лиды, шаблоны сообщений, школы, фильтры, силуэты съёмок, WhatsApp

const test = require('node:test');
const assert = require('node:assert');
const { start, adminLogin, createClass } = require('./helpers');
const { calc, normSeason, SEASON_DEFAULT, fill } = require('../lib/work');

const nb = r => { r.text = r.text.replace(/ /g, ' '); return r; };

test('расчёт: два альбома кл. руку и пробники', () => {
  const se = normSeason(SEASON_DEFAULT);
  // старая галочка (1) считается как один альбом
  let m = calc({ students: 20, teacher: 1 }, se, 0, 'Артур');
  assert.strictEqual(m.books, 21);
  assert.strictEqual(m.total, 20 * 4000 + 2000);
  m = calc({ students: 20, teacher: 2 }, se, 0, 'Артур', [], [{ name: 'Хасанов' }, { name: 'Для себя' }]);
  assert.strictEqual(m.books, 22);
  assert.strictEqual(m.total, 20 * 4000 + 4000);
  // 20 учеников: 10 + 7 = 17 разворотов → 1201 за альбом
  assert.strictEqual(m.printOne, 1201);
  assert.strictEqual(m.probes, 2);
  assert.strictEqual(m.probeCost, 2 * 1201);
  assert.strictEqual(m.costs, 22 * 1201 + 2 * 1201 + 5500 + 20 * 200 + 2000);
});

test('шаблон: подстановка, строка без ссылки убирается вместе с подписью', () => {
  const t = 'Выбираем фото:\n{отбор}\n\nОригиналы:\n{wfolio}\n\n{класс}, {школа}';
  assert.strictEqual(fill(t, { 'отбор': 'https://x/f/a', 'класс': '11А', 'школа': 'Лицей' }), 'Выбираем фото:\nhttps://x/f/a\n\n11А, Лицей');
});

test('новый класс сразу с городом, ценой, учениками, телефоном и датой; несколько классов школы', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  let r = await admin.req('GET', '/admin/new');
  assert.match(r.text, /name="city"/);
  assert.match(r.text, /name="students"/);
  r = await admin.post('/admin/new', { school: 'Лицей 2', title: '11 «А»', year: '2026', duration_min: '45', city: 'Нальчик', price: '4500', students: '24', phone: '8 928 111-22-33', pname: 'кл. рук', sd: '2099-11-05', st: '10:00', sk: 'group' });
  assert.strictEqual(r.status, 303);
  const id = +/\/admin\/c\/(\d+)/.exec(r.headers.get('location'))[1];
  const w = s.app.work.get(id);
  assert.strictEqual(w.city, 'Нальчик');
  assert.strictEqual(w.money.price, 4500);
  assert.strictEqual(w.money.students, 24);
  assert.deepStrictEqual(w.contacts, [{ name: 'кл. рук', phone: '8 928 111-22-33' }]);
  assert.strictEqual(w.dates[0].kind, 'group');
  // в форме новой школы подсказка с городом
  r = await admin.req('GET', '/admin/new');
  assert.match(r.text, /<option value="Лицей 2" data-city="Нальчик">/);
  // несколько классов: цена и город всем, ученики и телефон — нет
  r = await admin.post('/admin/new', { school: 'Гимназия 4', title: '11А, 11Б', year: '2026', duration_min: '45', city: 'Баксан', price: '5000', students: '30', phone: '89280000000' });
  const two = s.app.store.listClasses().filter(c => c.school === 'Гимназия 4');
  assert.strictEqual(two.length, 2);
  two.forEach(c => {
    const x = s.app.work.get(c.id);
    assert.strictEqual(x.city, 'Баксан');
    assert.strictEqual(x.money.price, 5000);
    assert.strictEqual(x.money.students, undefined);
    assert.strictEqual(x.contacts.length, 0);
  });
  // ссылки на работу и отбор сразу под ссылкой класса, город в заголовке
  r = await admin.req('GET', '/admin/c/' + id);
  assert.ok(r.text.indexOf('cls-links') < r.text.indexOf('Шпаргалка'));
  assert.match(r.text, /Лицей 2 · Нальчик/);
  assert.match(r.text, /Запись и подготовка · 1 из 5/);
});

test('переименование и город со страницы работы', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей 2', '11 «А»');
  let r = await admin.post('/admin/c/' + id + '/work/rename', { title: '11 «Б»', school: 'Лицей №2', city: 'Нальчик' });
  assert.strictEqual(r.status, 303);
  const c = s.app.store.getClass(+id);
  assert.strictEqual(c.title, '11 «Б»');
  assert.strictEqual(c.school, 'Лицей №2');
  assert.strictEqual(s.app.work.get(+id).city, 'Нальчик');
  r = await admin.post('/admin/c/' + id + '/work/rename', { title: '', school: 'x' });
  assert.strictEqual(r.status, 400);
  // и со страницы класса
  r = await admin.post('/admin/c/' + id + '/info', { title: '11 «Б»', school: 'Лицей №2', city: 'Баксан', slug: c.slug, year: '2026', duration_min: '45' });
  assert.strictEqual(s.app.work.get(+id).city, 'Баксан');
});

test('деньги: пробники и альбомы кл. руку на странице', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  await admin.post('/admin/c/' + id + '/work/money', { students: '20', teacher: '2', prepaid: '1' });
  let r = nb(await admin.req('GET', '/admin/c/' + id + '/work/money'));
  assert.match(r.text, /<option value="2" selected>2<\/option>/);
  assert.match(r.text, /Альбомов<\/span><b>22 \(2 кл\. руку\)/);
  r = await admin.post('/admin/c/' + id + '/work/probe', { name: 'Хасанов' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual((await admin.post('/admin/c/' + id + '/work/probe', { name: '' })).status, 400);
  r = nb(await admin.req('GET', '/admin/c/' + id + '/work/money'));
  assert.match(r.text, /Пробники \(1\)<\/span><b>1 201 ₽/);
  assert.match(r.text, /<b>Хасанов<\/b>/);
  // сохранение денег не трогает пробники
  await admin.post('/admin/c/' + id + '/work/money', { students: '20', teacher: '2' });
  assert.strictEqual(s.app.work.get(+id).probes.length, 1);
  await admin.post('/admin/c/' + id + '/work/probedel', { i: '0' });
  assert.strictEqual(s.app.work.get(+id).probes.length, 0);
  // в таблице сезона имя класса жирно, без предоплаты отмечен
  r = await admin.req('GET', '/admin/work/money?year=2026');
  assert.match(r.text, /class="wk-tname"/);
  assert.match(r.text, /tr class="is-noprepay"/);
});

test('лиды: добавить, связался, сделать классом — телефон и школа переносятся', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  let r = await admin.post('/admin/work/leads', { phone: 'abc' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/work/leads', { phone: '8 (928) 555-44-33', school: 'Школа 9', title: '11 «В»', note: 'спросила цены' });
  assert.strictEqual(r.status, 303);
  await admin.post('/admin/work/leads', { phone: '+7 900 000 00 00' });
  const ld = s.app.work.leads().find(l => l.school === 'Школа 9');
  r = await admin.req('GET', '/admin/work/leads');
  assert.match(r.text, /Новые <span>2<\/span>/);
  assert.match(r.text, /https:\/\/wa\.me\/79285554433/);
  await admin.post('/admin/work/leads/' + ld.id, { status: 'talk' });
  assert.strictEqual(s.app.work.lead(ld.id).status, 'talk');
  // «Сделать классом»: форма нового класса уже заполнена
  r = await admin.req('GET', '/admin/new?lead=' + ld.id);
  assert.match(r.text, /name="school" value="Школа 9"/);
  assert.match(r.text, /name="phone" type="tel" value="8 \(928\) 555-44-33"/);
  assert.match(r.text, /name="lead" value="\d+"/);
  r = await admin.post('/admin/new', { school: 'Школа 9', title: '11 «В»', year: '2026', duration_min: '45', phone: ld.phone, lead: String(ld.id) });
  const cid = +/\/admin\/c\/(\d+)/.exec(r.headers.get('location'))[1];
  assert.strictEqual(s.app.work.lead(ld.id).status, 'class');
  assert.strictEqual(s.app.work.lead(ld.id).class_id, cid);
  assert.strictEqual(s.app.work.get(cid).contacts[0].phone, '8 (928) 555-44-33');
  r = await admin.req('GET', '/admin/work/leads');
  assert.match(r.text, /Стали классами <span>1<\/span>/);
  assert.match(r.text, /Открыть класс 11 «В»/);
  // удалить
  const other = s.app.work.leads().find(l => l.status === 'new');
  await admin.post('/admin/work/leads/' + other.id, { delete: '1' });
  assert.strictEqual(s.app.work.leads().length, 1);
});

test('шаблоны сообщений у загрузки, сверки и уведомления; Артур меняет текст', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  let r = await admin.req('GET', '/admin/c/' + id + '/work');
  // отбора ещё нет — подсказка создать, строки со ссылками убраны
  assert.match(r.text, /Сначала <a href="\/admin\/c\/\d+\/photos">создайте выборку<\/a>/);
  assert.match(r.text, /альбомы 11 «А» готовы/);
  assert.ok(r.text.indexOf('Найдите себя в списке') === -1);
  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  const slug = /\/f\/([a-z0-9-]+)/.exec(r.text)[1];
  await admin.post('/admin/c/' + id + '/photos/wfolio', { wfolio: 'https://wfolio.ru/x' });
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, new RegExp('/f/' + slug + '\\n\\nОригиналы всех фото:\\nhttps://wfolio.ru/x'));
  await admin.post('/admin/work/templates', { upload: 'Привет, {класс}! {отбор}', check: '', notify: 'Готово' });
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, new RegExp('Привет, 11 «А»! http[^<]*/f/' + slug));
  // стёртый шаблон возвращается к обычному
  assert.match(r.text, /Макет альбома готов/);
  assert.deepStrictEqual(Object.keys(s.app.store.getSetting('work.templates')).sort(), ['notify', 'upload']);
});

test('доска: школы, фильтры, без предоплаты, переход к этапам, WhatsApp, порядок добавления', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const a = await createClass(admin, 'Лицей 2', '11 «Б»');
  const b = await createClass(admin, 'Гимназия', '11 «А»');
  const c = await createClass(admin, 'Лицей 2', '11 «А»');
  await createClass(admin, 'Школа 5', '9 «А»');
  await admin.post('/admin/c/' + a + '/work/contacts', { phone: '8 928 123-45-67', pname: 'мама' });
  await admin.api('/admin/api/c/' + b + '/work/step', { step: 'prepay', on: true });
  await admin.api('/admin/api/c/' + c + '/work/step', { step: 'approved', on: true });
  const r = await admin.req('GET', '/admin/work');
  // порядок — как добавляли: «11 «Б» Лицей 2» раньше «11 «А» Гимназия»
  const prep = r.text.slice(r.text.indexOf('id="stage-prep"'));
  assert.ok(prep.indexOf('11 «Б»') < prep.indexOf('Гимназия'));
  assert.match(r.text, /data-f-school="Лицей 2"[^>]*>.*Лицей 2 <b>2<\/b>/);
  assert.match(r.text, /Без предоплаты <b>3<\/b>/);
  assert.match(r.text, /href="#stage-prep"/);
  assert.match(r.text, /href="#stage-work"/);
  assert.match(r.text, /href="https:\/\/wa\.me\/79281234567"/);
  assert.match(r.text, /wk-sh wk-sh--none" title="Индивидуальная: даты нет"/);
  assert.match(r.text, /href="\/admin\/new">\+ Новый класс/);
  // «Съёмка» без типа больше не выбирается
  await admin.post('/admin/c/' + a + '/work/date', { d: '2099-01-01', kind: 'other' });
  assert.strictEqual(s.app.work.get(+a).dates[0].kind, 'ind');
});

test('ближайшие съёмки: первые четыре сразу, остальные раскрываются по порядку', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  for (let d = 10; d < 16; d++) await admin.post('/admin/c/' + id + '/work/date', { d: '2099-03-' + d, t: '10:00', kind: d % 2 ? 'ind' : 'group' });
  await admin.post('/admin/c/' + id + '/work/date', { d: '2099-02-01', kind: 'ind' });
  const r = await admin.req('GET', '/admin/work');
  const box = r.text.slice(r.text.indexOf('wk-soon'), r.text.indexOf('</section>', r.text.indexOf('wk-soon')));
  assert.match(box, /всего 7/);
  assert.match(box, /Все съёмки по порядку · ещё 3/);
  // по порядку: 1 февраля первой, 15 марта последней — в раскрывающемся списке
  assert.ok(box.indexOf('1 февраля') < box.indexOf('10 марта'));
  assert.ok(box.indexOf('wk-soon__more') < box.indexOf('15 марта'));
});

test('напоминание о предоплате и счётчик новых лидов', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  let r = nb(await admin.req('GET', '/admin/c/' + id + '/work'));
  assert.match(r.text, /Напомнить о предоплате/);
  assert.match(r.text, /предоплату за выпускные альбомы 11 «А»: 10 000 ₽/);
  await admin.api('/admin/api/c/' + id + '/work/step', { step: 'prepay', on: true });
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.ok(r.text.indexOf('Напомнить о предоплате') === -1);
  await admin.post('/admin/work/leads', { phone: '89281112233' });
  await admin.post('/admin/work/leads', { phone: '89281112244' });
  r = await admin.req('GET', '/admin/work');
  assert.match(r.text, /Лиды <i class="wk-badge" title="Новых: 2">2<\/i>/);
});

test('доска по школам: классы одной школы вместе, этап виден на карточке', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  await createClass(admin, 'Лицей 2', '11 «Б»');
  await createClass(admin, 'Гимназия', '11 «А»');
  await createClass(admin, 'Лицей 2', '11 «А»');
  let r = await admin.req('GET', '/admin/work');
  assert.match(r.text, /aria-current="page">По этапам/);
  r = await admin.req('GET', '/admin/work?year=2026&by=school');
  assert.match(r.text, /aria-current="page">По школам/);
  const lic = r.text.indexOf('wk-byschool');
  // первой идёт школа, где больше классов, оба её класса в одной группе
  assert.match(r.text.slice(lic, r.text.indexOf('</section>', lic)), /Лицей 2[\s\S]*11 «Б»[\s\S]*11 «А»/);
  assert.match(r.text, /wk-stagename">Запись и подготовка/);
  assert.ok(r.text.indexOf('id="stage-prep"') === -1);
});

test('съёмка отмечается сама, когда дата прошла; один раз на дату', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  await admin.post('/admin/c/' + id + '/work/date', { d: '2020-05-10', t: '10:00', kind: 'ind' });
  await admin.post('/admin/c/' + id + '/work/date', { d: '2099-05-10', kind: 'group' });
  let r = await admin.req('GET', '/admin/work');
  let w = s.app.work.get(+id);
  assert.ok(w.steps.shot_ind, 'прошедшая индивидуальная отмечена');
  assert.ok(!w.steps.shot_group, 'будущая групповая не отмечена');
  assert.match(r.text, /wk-sh wk-sh--done" title="Индивидуальная: отсняли"/);
  // Артур снял галочку (съёмку перенесли) — сама она больше не вернётся
  await admin.api('/admin/api/c/' + id + '/work/step', { step: 'shot_ind', on: false });
  await admin.req('GET', '/admin/work');
  assert.ok(!s.app.work.get(+id).steps.shot_ind);
  // сегодня, но время ещё не прошло — не отмечаем; через 3 часа после начала — отмечаем
  s.app.work.autoShoots('2030-01-01', 9 * 60);
  const id2 = await createClass(admin, 'Лицей', '11 «Б»');
  s.app.work.addDate(+id2, { d: '2030-01-01', t: '10:00', kind: 'group' });
  s.app.work.autoShoots('2030-01-01', 12 * 60);
  assert.ok(!s.app.work.get(+id2).steps.shot_group);
  s.app.work.autoShoots('2030-01-01', 13 * 60);
  assert.ok(s.app.work.get(+id2).steps.shot_group);
  // в истории видно, что отмечено само; дизайнеру эта запись не показывается
  assert.ok(s.app.work.notes(+id2).some(n => /отмечено само/.test(n.text) && n.kind === 'admin'));
});

test('лид без номера: школа или заметка, без кнопок звонка', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  let r = await admin.post('/admin/work/leads', { phone: '', school: '', note: '' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/work/leads', { phone: '12', school: 'Лицей 1' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/work/leads', { school: 'Лицей 1', title: '11-е', note: 'параллель будет брать, жду родителей' });
  assert.strictEqual(r.status, 303);
  r = await admin.req('GET', '/admin/work/leads');
  assert.match(r.text, /<b>11-е · Лицей 1<\/b><span class="muted">номера пока нет<\/span>/);
  assert.ok(r.text.indexOf('wa.me/') === -1);
  const ld = s.app.work.leads()[0];
  r = await admin.req('GET', '/admin/new?lead=' + ld.id);
  assert.match(r.text, /name="school" value="Лицей 1"/);
});

test('деньги: «осталось получить» — чистыми, после расходов', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  await admin.post('/admin/c/' + id + '/work/money', { students: '20', prepaid: '1' });
  const m = s.app.work.money(s.app.work.get(+id), s.app.store.getClass(+id), 0);
  // 80 000 оплата, расходы 35 520, прибыль 44 480, предоплата 10 000 → чистыми осталось 34 480
  assert.strictEqual(m.profit, 44480);
  assert.strictEqual(m.restNet, 34480);
  assert.strictEqual(m.rest, 70000);
  let r = nb(await admin.req('GET', '/admin/c/' + id + '/work/money'));
  assert.match(r.text, /Осталось получить чистыми<small>родители ещё отдадут 70 000 ₽<\/small><\/span><b>34 480 ₽/);
  // кнопка оплаты — по деньгам от родителей
  assert.match(r.text, /Класс доплатил остаток 70 000 ₽/);
  r = nb(await admin.req('GET', '/admin/work/money?year=2026'));
  assert.match(r.text, /Осталось получить чистыми<small>родители ещё отдадут 70 000 ₽<\/small><\/span><b>34 480 ₽/);
  // когда получено больше прибыли, чистыми осталось 0, а не минус
  await admin.post('/admin/c/' + id + '/work/pay', { sum: '50000' });
  assert.strictEqual(s.app.work.money(s.app.work.get(+id), s.app.store.getClass(+id), 0).restNet, 0);
});
