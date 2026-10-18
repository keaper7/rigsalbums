'use strict';

// Работа над альбомами: статусы, правки, дизайнер по ссылке, деньги, правка от ученика

const test = require('node:test');
const assert = require('node:assert');
const { JPEG_WIDE, start, client, adminLogin, createClass } = require('./helpers');
const { calc, amount, normSeason, SEASON_DEFAULT, parsePrint, parseProcessors } = require('../lib/work');

async function setup(t) {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  let r = await admin.req('GET', '/admin/c/' + id + '/photos');
  const slug = /\/f\/([a-z0-9-]+)/.exec(r.text)[1];
  await admin.post('/admin/c/' + id + '/photos/students', { names: 'Анна\nТимур' });
  const st = s.app.store.db.prepare('SELECT id, name FROM pk_students ORDER BY sort').all();
  // ученица выбирает фото, пишет цитату и пожелание
  const a = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent('Девочки/1.jpg'), JPEG_WIDE);
  await admin.upload('/admin/api/media/pk/' + id + '/' + a.data.id + '/sm', JPEG_WIDE);
  const kid = client(s.base);
  r = await kid.req('POST', '/f/' + slug + '/me', { json: { student: st[0].id, newPin: '4821' } });
  assert.strictEqual(r.status, 200);
  await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: a.data.id, on: true } });
  await kid.req('POST', '/f/' + slug + '/role', { json: { photo: a.data.id, role: 'cover' } });
  await kid.req('POST', '/f/' + slug + '/quote', { json: { text: 'Мы были "вместе"; навсегда' } });
  await kid.req('POST', '/f/' + slug + '/wish', { json: { text: 'Секретное пожелание' } });
  return { s, admin, id, slug, st, kid, photo: a.data.id };
}

async function designerLink(s, admin, name) {
  const r = await admin.post('/admin/work/designer', { name: name || 'Мадина' });
  assert.strictEqual(r.status, 303);
  const d = s.app.store.db.prepare('SELECT * FROM wk_designers ORDER BY id DESC').get();
  return '/d/' + d.token;
}

test('расчёт денег как в таблице Артура', () => {
  assert.strictEqual(amount('12 500 ₽'), 12500);
  assert.strictEqual(amount(''), null);
  assert.strictEqual(amount('abc'), null);
  assert.strictEqual(amount('-5'), null);
  // СММ ровно 7000, как сейчас в таблице, — тогда цифры совпадают с ней строка в строку
  const se = normSeason(Object.assign({}, SEASON_DEFAULT, { smm_per: 0, smm_fixed: 7000 }));
  // 30 учеников + классный руководитель, обрабатывает сам
  let m = calc({ students: 30, teacher: 1, price: 4000 }, se, 0, 'Артур');
  assert.strictEqual(m.books, 31);
  assert.strictEqual(m.spreads, 22);
  assert.strictEqual(m.printOne, 1328);
  assert.strictEqual(m.printAll, 41168);
  assert.strictEqual(m.costs, 53668);
  // в таблице 120 000, а 2000 за учителя Артур добавлял руками
  assert.strictEqual(m.total, 122000);
  assert.strictEqual(m.profit, 122000 - 53668);
  // 15 учеников: 7,5 → 8 + 7 = 15 разворотов, обработчик Инал
  m = calc({ students: 15, teacher: 1, price: 4000, prepaid: 1 }, se, 0, 'Инал');
  assert.strictEqual(m.spreads, 15);
  assert.strictEqual(m.printOne, 1151);
  assert.strictEqual(m.printAll, 18416);
  assert.strictEqual(m.costs, 34916);
  assert.strictEqual(m.prepay, 10000);
  assert.strictEqual(m.rest, 62000 - 10000);
  // СММ за ученика и за класс, обработчик не выбран — без расхода
  m = calc({ students: 10, price: 4000 }, normSeason(SEASON_DEFAULT), 0, '');
  assert.strictEqual(m.smm, 10 * 200 + 2000);
  assert.strictEqual(m.proc, 0);
  // разворотов больше, чем в прайсе, — не считаем и говорим почему; своя цена печати выручает
  m = calc({ students: 60, price: 4000 }, se, 0, '');
  assert.ok(!m.ready);
  assert.match(m.missing.join(), /37 разворотов/);
  assert.ok(calc({ students: 60, price: 4000, print: 1700 }, se, 0, '').ready);
  // учеников Артур пишет сам: число из отбора в расчёт само не идёт
  assert.strictEqual(calc({}, se, 12, '').students, 0);
  assert.ok(!calc({}, se, 12, '').ready);
  assert.ok(!calc({}, se, 0, '').ready);
  assert.deepStrictEqual(parsePrint('10 — 1024\n11: 1 049 ₽\nчушь\n30 1530'), { 10: 1024, 11: 1049, 30: 1530 });
  assert.deepStrictEqual(parseProcessors('Инал 4000\nТамик — 4 500 ₽\nАртур 0\nИнал 1'), [{ name: 'Инал', rate: 4000 }, { name: 'Тамик', rate: 4500 }]);
});

test('сезоны, осень и весна: свои цены у каждого года, доставка, итоги отдельно', async t => {
  const { s, admin, id } = await setup(t);
  const y = s.app.store.getClass(+id).year;
  let r = await admin.post('/admin/work/money/' + y, { price: '4000', teacher: '2000', designer: '6000', prepay: '10000', smm_per: '0', smm_fixed: '7000', divisor: '2', extra: '7', processors: 'Инал 4000\nТамик 4500', print: '10 — 1024\n11 — 1049' });
  assert.strictEqual(r.status, 303);
  // следующий сезон берёт цены прошлого, но меняется отдельно
  await admin.post('/admin/work/money/' + (y + 1), { designer: '9000' });
  assert.strictEqual(s.app.work.season(y).designer, 6000);
  assert.strictEqual(s.app.work.season(y + 1).designer, 9000);
  assert.strictEqual(s.app.work.season(y + 1).smm_fixed, 7000);
  // класс осенний: 2 ученика из отбора → 1 + 7 = 8 разворотов, в прайсе нет — своя цена печати
  await admin.post('/admin/c/' + id + '/work/half', { half: 'autumn' });
  await admin.post('/admin/c/' + id + '/work/info', { processor: 'Тамик' });
  await admin.post('/admin/c/' + id + '/work/money', { students: '2', teacher: '1', prepaid: '1', print: '1000' });
  r = await admin.req('GET', '/admin/c/' + id + '/work/money');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /2 ÷ 2 → 1 \+ 7 = 8/);
  // доход 2×4000+2000 = 10 000; затраты 3×1000 + 6000 + 4500 + 7000 = 20 500
  assert.match(r.text, /−10 500 ₽/);
  // второй класс того же сезона — весенний, считается отдельно
  const id2 = await createClass(admin, 'Гимназия', '11 «Б»');
  await admin.post('/admin/c/' + id2 + '/work/half', { half: 'spring' });
  await admin.post('/admin/c/' + id2 + '/work/money', { students: '2', print: '1000' });
  r = await admin.post('/admin/work/money/' + y + '/delivery', { amount: '2 500', note: '2 коробки', half: 'autumn' });
  assert.strictEqual(r.status, 303);
  r = await admin.post('/admin/work/money/' + y + '/delivery', { amount: '', note: 'x', half: 'autumn' });
  assert.strictEqual(r.status, 400);
  r = await admin.req('GET', '/admin/work/money?year=' + y + '&half=autumn');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Обработка · Тамик/);
  assert.match(r.text, /2 коробки/);
  // осень: −10 500 и 2 500 доставки
  assert.match(r.text, /−13 000 ₽/);
  assert.match(r.text, /Предоплаты внесены \(1 из 1\)/);
  // весна: 8000 − (2000 + 6000 + 7000) = −7000; весь сезон: −20 000
  r = await admin.req('GET', '/admin/work/money?year=' + y + '&half=spring');
  assert.match(r.text, /−7 000 ₽/);
  r = await admin.req('GET', '/admin/work/money?year=' + y);
  assert.match(r.text, /−20 000 ₽/);
  // старый адрес ведёт на новую страницу
  r = await admin.req('GET', '/admin/work/season/' + y);
  assert.strictEqual(r.status, 303);
  const did = s.app.store.db.prepare('SELECT id FROM wk_delivery').get().id;
  await admin.post('/admin/work/money/' + y + '/delivery/' + did + '/delete', {});
  assert.strictEqual(s.app.store.db.prepare('SELECT COUNT(*) n FROM wk_delivery').get().n, 0);
  r = await admin.post('/admin/work/money/1999', {});
  assert.strictEqual(r.status, 404);
  // дизайнер не видит денег
  const link = await designerLink(s, admin);
  r = await client(s.base).req('GET', link + '/c/' + id);
  assert.ok(r.text.indexOf('₽') === -1);
});

test('этапы: галочки, переход, даты съёмки, телефоны, вкладка «Телефоны»', async t => {
  const { s, admin, id } = await setup(t);
  const step = (k, on) => admin.api('/admin/api/c/' + id + '/work/step', { step: k, on: on });
  let r = await admin.req('GET', '/admin/work');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Запись и подготовка/);
  assert.match(r.text, /0\/5/);
  // даты отмечаются сами, руками нельзя; без токена страницы нельзя
  r = await step('dates', true);
  assert.strictEqual(r.status, 400);
  r = await admin.req('POST', '/admin/api/c/' + id + '/work/step', { json: { step: 'group', on: true } });
  assert.strictEqual(r.status, 403);
  // предоплата — та же галочка, что в деньгах
  r = await step('prepay', true);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.done, 1);
  assert.strictEqual(JSON.parse(s.app.store.db.prepare('SELECT money FROM wk_classes').get().money).prepaid, 1);
  await step('group', true);
  await step('talk', true);
  // даты съёмки: прошедшая и будущая
  r = await admin.post('/admin/c/' + id + '/work/date', { d: '2020-01-10', t: '10:00', kind: 'ind' });
  assert.strictEqual(r.status, 303);
  r = await admin.post('/admin/c/' + id + '/work/date', { d: '2099-05-20', t: '25:00', kind: 'group', note: 'школа' });
  assert.strictEqual(r.status, 303);
  r = await admin.post('/admin/c/' + id + '/work/date', { d: 'вчера' });
  assert.strictEqual(r.status, 400);
  const w = s.app.work.get(+id);
  assert.strictEqual(w.dates.length, 2);
  assert.strictEqual(w.dates[1].t, '');
  r = await admin.req('GET', '/admin/work');
  // на доске видна только будущая дата
  assert.match(r.text, /20 мая · групповая/);
  assert.ok(r.text.indexOf('10 января, 10:00 · индивидуальная') === -1);
  // силуэты: индивидуальная дата прошла — отмечено само (зелёный), групповая назначена (жёлтый)
  assert.match(r.text, /wk-sh wk-sh--done" title="Индивидуальная: отсняли"/);
  assert.match(r.text, /wk-sh wk-sh--date" title="Групповая: 20 мая"/);
  assert.match(r.text, /дальше: <b>Утвердили<\/b>/);
  // «Утвердили» — класс переходит в работу
  r = await step('approved', true);
  assert.strictEqual(r.data.stage, 1);
  assert.strictEqual(r.data.next, 'Отсняли групповую');
  // съёмку видно и дизайнеру
  await step('shot_ind', true);
  assert.ok(s.app.work.get(+id).shot);
  // до конца: класс готов
  for (const k of ['shot_group', 'pick', 'color', 'retouch', 'upload', 'extra', 'check', 'checked', 'verify', 'ship', 'printing', 'pack', 'notify']) await step(k, true);
  r = await step('taken', true);
  assert.ok(r.data.finished);
  r = await admin.req('GET', '/admin/work');
  assert.match(r.text, /Готово/);
  assert.match(r.text, /Альбом забрали, класс готов/);
  // история в переписке
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /✓ Альбом забрали/);
  await admin.post('/admin/c/' + id + '/work/datedel', { i: '0' });
  assert.strictEqual(s.app.work.get(+id).dates.length, 1);

  // телефоны: пустые строки пропадают, в списке с поиском — ссылка для звонка
  r = await admin.req('POST', '/admin/c/' + id + '/work/contacts', { raw: new URLSearchParams([['_csrf', admin.csrf], ['phone', '+7 (928) 111-22-33'], ['pname', 'Мама Азамата'], ['phone', ''], ['pname', 'никто'], ['phone', '8 900 000 00 00'], ['pname', '']]).toString(), type: 'application/x-www-form-urlencoded' });
  assert.strictEqual(r.status, 303);
  assert.deepStrictEqual(s.app.work.get(+id).contacts, [{ name: 'Мама Азамата', phone: '+7 (928) 111-22-33' }, { name: '', phone: '8 900 000 00 00' }]);
  r = await admin.req('GET', '/admin/work/phones');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /href="tel:\+79281112233"/);
  assert.match(r.text, /Мама Азамата/);
  // поиск по цифрам номера
  assert.match(r.text, /data-find="[^"]*79281112233/);
  // дизайнер телефонов не видит
  const link = await designerLink(s, admin);
  r = await client(s.base).req('GET', link + '/c/' + id);
  assert.ok(r.text.indexOf('111-22-33') === -1);
});

test('доска и страница класса: дизайнер, отметки, обработчик, деньги на своей вкладке', async t => {
  const { s, admin, id } = await setup(t);
  let r = await admin.req('GET', '/admin/work');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /11 «А»/);
  // деньги не на главном экране
  assert.ok(r.text.indexOf('₽') === -1);
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Запись и подготовка/);
  // со страницы класса есть переход
  r = await admin.req('GET', '/admin/c/' + id);
  assert.match(r.text, /\/admin\/c\/\d+\/work/);

  r = await admin.post('/admin/c/' + id + '/work/status', { status: 'check' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(s.app.store.db.prepare('SELECT status FROM wk_classes WHERE class_id = ?').get(id).status, 'check');
  await admin.post('/admin/c/' + id + '/work/status', { status: 'bogus' });
  assert.strictEqual(s.app.store.db.prepare('SELECT status FROM wk_classes WHERE class_id = ?').get(id).status, 'check');

  // несколько галочек — одно поле много раз
  const parts = new URLSearchParams([['_csrf', admin.csrf], ['part', 'cover'], ['part', 'list'], ['part', 'nope']]).toString();
  r = await admin.req('POST', '/admin/c/' + id + '/work/parts', { raw: parts, type: 'application/x-www-form-urlencoded' });
  assert.strictEqual(r.status, 303);
  const done = JSON.parse(s.app.store.db.prepare('SELECT done FROM wk_classes WHERE class_id = ?').get(id).done);
  assert.deepStrictEqual(Object.keys(done).sort(), ['cover', 'list']);

  await admin.post('/admin/c/' + id + '/work/info', { shoot_place: 'Студия', processor: 'Артур', note: 'для себя' });
  // 26 учеников: 13 + 7 = 20 разворотов по 1278 → 33 228; затраты 33 228 + 5500 + 7200 = 45 928; доход 104 000
  await admin.post('/admin/c/' + id + '/work/money', { students: '26', price: '4000' });
  r = await admin.req('GET', '/admin/c/' + id + '/work/money');
  assert.match(r.text, /Чистая прибыль/);
  assert.match(r.text, /58 072 ₽/);
  assert.match(r.text, /Обработка · сам/);
  r = await admin.req('GET', '/admin/work/money?year=' + s.app.store.getClass(+id).year);
  assert.match(r.text, /58 072 ₽/);
});

test('правки: добавить, класс возвращается дизайнеру, исправить, удалить', async t => {
  const { s, admin, id, st } = await setup(t);
  const wk = () => s.app.store.db.prepare('SELECT status FROM wk_classes WHERE class_id = ?').get(id).status;
  // пока дизайнер не начинала, статус не меняется
  let r = await admin.post('/admin/c/' + id + '/work/fix', { student: st[1].id, kind: 'name', text: 'Тимур Хасанов' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(wk(), 'todo');
  // «Другое» без текста не принимаем, чужой ученик — тоже
  r = await admin.post('/admin/c/' + id + '/work/fix', { student: 0, kind: 'other', text: '' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/c/' + id + '/work/fix', { student: 999999, kind: 'name', text: 'x' });
  assert.strictEqual(r.status, 400);
  await admin.post('/admin/c/' + id + '/work/status', { status: 'review' });
  r = await admin.post('/admin/c/' + id + '/work/fix', { student: 0, kind: 'other', text: 'Групповое фото посветлее' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(wk(), 'fixes');
  const fixes = s.app.store.db.prepare('SELECT * FROM wk_fixes WHERE class_id = ? ORDER BY id').all(id);
  assert.strictEqual(fixes.length, 2);
  assert.strictEqual(fixes[0].student_name, 'Тимур');
  assert.strictEqual(fixes[1].student_id, null);
  await admin.post('/admin/c/' + id + '/work/fixdone', { fix: fixes[0].id, on: '1' });
  assert.ok(s.app.store.db.prepare('SELECT done_at FROM wk_fixes WHERE id = ?').get(fixes[0].id).done_at);
  await admin.post('/admin/c/' + id + '/work/fixdel', { fix: fixes[1].id });
  assert.strictEqual(s.app.store.db.prepare('SELECT COUNT(*) n FROM wk_fixes').get().n, 1);
  // всё записано в переписку
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /статус: На утверждении/);
  assert.match(r.text, /исправлено · Тимур: Ошибка в имени/);
});

test('дизайнер по ссылке: видит нужное, не видит лишнего, действует только своими кнопками', async t => {
  const { s, admin, id, st } = await setup(t);
  // класс без съёмки и отбора дизайнер видит сразу после записи, внизу «Съёмки ещё не было»; архивный не видит
  const empty = await createClass(admin, 'Гимназия', '11 «Б»');
  const old = await createClass(admin, 'Школа 5', '11 «В»');
  await admin.post('/admin/c/' + old + '/archive', { on: '1' });
  const link = await designerLink(s, admin);
  const d = client(s.base);
  let r = await d.req('GET', link);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /11 «А»/);
  assert.match(r.text, /Съёмки ещё не было[\s\S]*11 «Б»/);
  assert.ok(r.text.indexOf('11 «В»') === -1);
  assert.strictEqual(r.headers.get('referrer-policy'), 'no-referrer');
  r = await d.req('GET', link + '/c/' + empty);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Индивидуальная: даты нет/);
  r = await d.req('GET', link + '/c/' + old);
  assert.strictEqual(r.status, 303);

  r = await d.req('GET', link + '/c/' + id);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Анна/);
  assert.match(r.text, /Обложка/);
  assert.match(r.text, /Мы были &quot;вместе&quot;; навсегда/);
  // пожелание, код ученика и деньги — только у Артура
  assert.ok(r.text.indexOf('Секретное пожелание') === -1);
  assert.ok(r.text.indexOf('4821') === -1);
  assert.ok(r.text.indexOf('прибыль') === -1);
  // в админку ссылка не пускает
  r = await d.req('GET', '/admin/work');
  assert.strictEqual(r.status, 302);

  // своя галочка, «на утверждение»; статус Артура поставить нельзя
  r = await d.req('POST', link + '/c/' + id + '/part', { json: { part: 'cover', on: true } });
  assert.strictEqual(r.status, 200);
  r = await d.req('POST', link + '/c/' + id + '/status', { json: { status: 'print' } });
  assert.strictEqual(r.status, 400);
  r = await d.req('POST', link + '/c/' + id + '/status', { json: { status: 'review' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(s.app.store.db.prepare('SELECT status FROM wk_classes WHERE class_id = ?').get(id).status, 'review');
  // форма обычным POST не принимается — только JSON
  r = await d.req('POST', link + '/c/' + id + '/note', { form: { text: 'x' } });
  assert.strictEqual(r.status, 415);
  r = await d.req('POST', link + '/c/' + id + '/note', { json: { text: 'Не хватает фото учителя' } });
  assert.strictEqual(r.status, 200);

  // Артур добавляет правку — у дизайнера она появляется, класс снова у неё
  await admin.post('/admin/c/' + id + '/work/fix', { student: st[0].id, kind: 'swap', text: 'Обложку и личную' });
  r = await d.req('GET', link + '/c/' + id);
  assert.match(r.text, /Поменять фото местами/);
  assert.match(r.text, /Исправила, отправить на утверждение/);
  const fix = s.app.store.db.prepare('SELECT id FROM wk_fixes').get().id;
  r = await d.req('POST', link + '/c/' + id + '/fixdone', { json: { fix: fix, on: true } });
  assert.strictEqual(r.status, 200);
  const row = s.app.store.db.prepare('SELECT done_at, done_by FROM wk_fixes WHERE id = ?').get(fix);
  assert.ok(row.done_at);
  assert.strictEqual(row.done_by, 'Мадина');
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /Не хватает фото учителя/);
  assert.match(r.text, /Мадина/);

  // таблица цитат
  r = await d.req('GET', link + '/c/' + id + '/quotes.csv');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''/);
  // в начале BOM, чтобы Excel понял кодировку (fetch в text() его прячет)
  const bytes = new Uint8Array(await (await fetch(s.base + link + '/c/' + id + '/quotes.csv')).arrayBuffer());
  assert.deepStrictEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  assert.match(r.text, /^Ученик;Цитата\r\n/);
  assert.match(r.text, /"Анна";"Мы были ""вместе""; навсегда"/);

  // архив и отключённая ссылка
  await admin.post('/admin/c/' + id + '/archive', {});
  const arch = s.app.store.db.prepare('SELECT archived FROM classes WHERE id = ?').get(id).archived;
  if (arch) {
    r = await d.req('GET', link + '/c/' + id);
    assert.strictEqual(r.status, 303);
  }
  const did = s.app.store.db.prepare('SELECT id FROM wk_designers').get().id;
  await admin.post('/admin/work/designer/' + did + '/delete', {});
  r = await d.req('GET', link);
  assert.strictEqual(r.status, 404);
  assert.match(r.text, /Ссылка не работает/);
  r = await d.req('POST', link + '/c/' + id + '/note', { json: { text: 'x' } });
  assert.strictEqual(r.status, 403);
  r = await d.req('GET', '/d/' + 'x'.repeat(32));
  assert.strictEqual(r.status, 404);
});

test('ученик меняет цитату, когда дизайнер уже начала: правка появляется сама, без дублей', async t => {
  const { s, admin, id, slug, kid } = await setup(t);
  const count = () => s.app.store.db.prepare("SELECT COUNT(*) n FROM wk_fixes WHERE kind = 'quote'").get().n;
  // дизайнер ещё не начинала — правок нет
  await kid.req('POST', '/f/' + slug + '/quote', { json: { text: 'Первая' } });
  assert.strictEqual(count(), 0);
  await admin.post('/admin/c/' + id + '/work/status', { status: 'review' });
  await kid.req('POST', '/f/' + slug + '/quote', { json: { text: 'Вторая' } });
  await kid.req('POST', '/f/' + slug + '/quote', { json: { text: 'Третья' } });
  assert.strictEqual(count(), 1);
  const f = s.app.store.db.prepare('SELECT * FROM wk_fixes').get();
  assert.strictEqual(f.text, 'Третья');
  assert.strictEqual(f.who, 'Анна');
  assert.strictEqual(f.auto, 1);
  assert.strictEqual(s.app.store.db.prepare('SELECT status FROM wk_classes WHERE class_id = ?').get(id).status, 'fixes');
  // та же цитата — ничего не меняется; после исправления новая смена — новая правка
  await kid.req('POST', '/f/' + slug + '/quote', { json: { text: 'Третья' } });
  assert.strictEqual(count(), 1);
  await admin.post('/admin/c/' + id + '/work/fixdone', { fix: f.id, on: '1' });
  await kid.req('POST', '/f/' + slug + '/quote', { json: { text: 'Четвёртая' } });
  assert.strictEqual(count(), 2);
});

test('удаление класса убирает его работу, старая база без новых таблиц открывается', async t => {
  const { s, admin, id } = await setup(t);
  await admin.post('/admin/c/' + id + '/work/fix', { student: 0, kind: 'other', text: 'x' });
  await admin.post('/admin/c/' + id + '/work/note', { text: 'привет' });
  const r = await admin.post('/admin/c/' + id + '/delete', {});
  assert.strictEqual(r.status, 303);
  const db = s.app.store.db;
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM wk_classes').get().n, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM wk_fixes').get().n, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM wk_notes').get().n, 0);
});
