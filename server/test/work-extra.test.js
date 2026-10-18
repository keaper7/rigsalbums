'use strict';

// Правки Артура 17.10: этапы «Отбор» и «Выборка», сверка у учеников, оплата остатка,
// групповое фото в правках с фото и скринами, выбор классного руководителя по своей ссылке

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { JPEG_WIDE, JPEG_TALL, start, client, adminLogin, createClass } = require('./helpers');
const { STAGES, stageOf } = require('../lib/work');

async function upload(admin, id, rel, buf) {
  const a = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent(rel), buf || JPEG_WIDE);
  assert.strictEqual(a.status, 200, a.text);
  const b = await admin.upload('/admin/api/media/pk/' + id + '/' + a.data.id + '/sm', buf || JPEG_WIDE);
  assert.strictEqual(b.status, 200, b.text);
  return a.data.id;
}

async function designerLink(s, admin) {
  await admin.post('/admin/work/designer', { name: 'Дизайнер' });
  return '/d/' + s.app.store.db.prepare('SELECT token FROM wk_designers ORDER BY id DESC').get().token;
}

test('этапы: «Отбор» — чистка дублей, после загрузки «Выборка» с отбором учеников, сверка не связана с дизайнером', async t => {
  const work = STAGES.find(x => x.key === 'work').steps.map(x => x[0]);
  assert.deepStrictEqual(work, ['shot_ind', 'shot_group', 'pick', 'color', 'retouch', 'upload', 'select', 'extra', 'check', 'checked']);
  // старые отметки этапа остаются на месте: ключи прежние, новый пункт просто не отмечен
  assert.strictEqual(stageOf({ steps: { prepay: 1, approved: 1, pick: 1 }, money: { prepaid: 1 }, dates: [] }).index, 1);

  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  let r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /<b>Отбор<\/b>[\s\S]*убрать дубли/);
  assert.match(r.text, /<b>Выборка<\/b>[\s\S]*создать выборку/);
  assert.match(r.text, /<b>Сверка<\/b>[\s\S]*ученики проверяют свой макет/);
  // этапы раскрашены, на доске видно название этапа
  assert.match(r.text, /wk-stg is-now wk-c0/);
  await admin.post('/admin/c/' + id + '/work/status', { status: 'review' });
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.ok(r.text.indexOf('у дизайнера:') === -1);
  r = await admin.req('GET', '/admin/work');
  assert.match(r.text, /wk-stage wk-c0[\s\S]*Запись и подготовка[\s\S]*wk-card wk-c0/);
  // отбор начат — у «Выборки» прогресс и ссылка
  await admin.req('GET', '/admin/c/' + id + '/photos');
  await admin.post('/admin/c/' + id + '/photos/students', { names: 'Анна' });
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /ученики выбирают фото: 0\/1 закончили/);
});

test('оплата: весь остаток одной кнопкой или частями, итог сезона', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  // суммы на странице с неразрывными пробелами: «70 000 ₽»
  const get = admin.req;
  admin.req = async (...a) => { const r = await get(...a); r.text = r.text.replace(/\u00a0/g, ' '); return r; };
  const id = await createClass(admin, 'Лицей', '11 «А»');
  // учеников ещё нет — оплату некуда записывать
  let r = await admin.req('GET', '/admin/c/' + id + '/work/money');
  assert.ok(r.text.indexOf('id="pay"') === -1);
  await admin.post('/admin/c/' + id + '/work/money', { students: '20', prepaid: '1' });
  r = await admin.req('GET', '/admin/c/' + id + '/work/money');
  // 20 × 4000 − 10 000 предоплаты
  assert.match(r.text, /Класс доплатил остаток 70 000 ₽/);
  // часть: 30 000
  r = await admin.post('/admin/c/' + id + '/work/pay', { sum: '30 000', note: '8 человек' });
  assert.strictEqual(r.status, 303);
  r = await admin.req('GET', '/admin/c/' + id + '/work/money');
  assert.match(r.text, /Оплачено после предоплаты<\/span><b>−30 000 ₽/);
  assert.match(r.text, /Осталось получить<\/span><b>40 000 ₽/);
  assert.match(r.text, /8 человек/);
  assert.strictEqual((await admin.post('/admin/c/' + id + '/work/pay', { sum: 'abc' })).status, 400);
  // остаток одной кнопкой
  await admin.post('/admin/c/' + id + '/work/pay', { sum: '', note: 'остаток' });
  r = await admin.req('GET', '/admin/c/' + id + '/work/money');
  assert.match(r.text, /Оплачено полностью/);
  assert.ok(r.text.indexOf('Класс доплатил остаток') === -1);
  const w = s.app.work.get(+id);
  assert.deepStrictEqual(w.paid.map(p => p.sum), [30000, 40000]);
  // сохранение денег не трогает оплаты
  await admin.post('/admin/c/' + id + '/work/money', { students: '20', prepaid: '1', teacher: '1' });
  assert.strictEqual(s.app.work.get(+id).paid.length, 2);
  r = await admin.req('GET', '/admin/c/' + id + '/work/money');
  assert.match(r.text, /Осталось получить<\/span><b>2 000 ₽/);
  // итог сезона и доска
  r = await admin.req('GET', '/admin/work/money?year=2026');
  assert.match(r.text, /Оплаты после предоплаты<\/span><b>70 000 ₽/);
  assert.match(r.text, /Осталось получить<\/span><b>2 000 ₽/);
  // убрать ошибочную оплату
  await admin.post('/admin/c/' + id + '/work/paydel', { i: '1' });
  assert.deepStrictEqual(s.app.work.get(+id).paid.map(p => p.sum), [30000]);
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /убрана оплата 40000/);
  // дизайнер в истории не видит ни оплат, ни предоплаты, ни этапов Артура
  await admin.api('/admin/api/c/' + id + '/work/step', { step: 'group', on: true });
  await admin.post('/admin/c/' + id + '/work/note', { text: 'Вопрос по обложке' });
  const link = await designerLink(s, admin);
  r = await client(s.base).req('GET', link + '/c/' + id);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Вопрос по обложке/);
  assert.ok(!/оплат|Предоплата|₽|✓ Группа/.test(r.text), 'деньги и этапы видны дизайнеру');
});

test('правка группового фото: что убрать и что поставить, фото видят Артур и дизайнер, удаляются вместе с правкой', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  let r = await admin.req('GET', '/admin/c/' + id + '/work');
  // у всего класса — групповые и «другое», у формы есть места для фото
  assert.match(r.text, /Заменить групповое фото/);
  assert.match(r.text, /Удалить групповое фото/);
  assert.match(r.text, /Какое фото убрать/);
  r = await admin.api('/admin/api/c/' + id + '/work/fix', { student: 0, kind: 'group_swap', text: 'Где Тимур моргнул' });
  assert.strictEqual(r.status, 200, r.text);
  const fid = r.data.id;
  r = await admin.upload('/admin/api/media/fix/' + id + '/' + fid + '?label=remove', JPEG_WIDE);
  assert.strictEqual(r.status, 200, r.text);
  const f1 = r.data.id;
  r = await admin.upload('/admin/api/media/fix/' + id + '/' + fid + '?label=add', JPEG_TALL);
  assert.strictEqual(r.status, 200, r.text);
  // не фото — не принимаем
  r = await admin.upload('/admin/api/media/fix/' + id + '/' + fid, Buffer.from('<svg></svg>'), 'image/jpeg');
  assert.strictEqual(r.status, 400);
  // без токена страницы — нет
  r = await admin.req('POST', '/admin/api/media/fix/' + id + '/' + fid, { raw: JPEG_WIDE, type: 'image/jpeg' });
  assert.strictEqual(r.status, 403);
  // просто удалить: правка без текста, только скрин
  r = await admin.api('/admin/api/c/' + id + '/work/fix', { student: 0, kind: 'group_del', text: '' });
  assert.strictEqual(r.status, 200);

  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /Весь класс<\/b> · Заменить групповое фото/);
  assert.match(r.text, /wk-ffile--remove[\s\S]*Убрать[\s\S]*wk-ffile--add[\s\S]*Поставить/);
  r = await admin.req('GET', '/admin/c/' + id + '/work/file/' + f1 + '.jpg');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/jpeg');

  const link = await designerLink(s, admin);
  const d = client(s.base);
  r = await d.req('GET', link + '/c/' + id);
  assert.match(r.text, /Заменить групповое фото/);
  assert.match(r.text, new RegExp(link + '/c/' + id + '/file/' + f1 + '\\.jpg'));
  r = await d.req('GET', link + '/c/' + id + '/file/' + f1 + '.jpg');
  assert.strictEqual(r.status, 200);
  // чужой человек без ссылки файл не получит
  r = await client(s.base).req('GET', '/admin/c/' + id + '/work/file/' + f1 + '.jpg');
  assert.strictEqual(r.status, 302);

  const file = s.app.work.filePath(+id, f1);
  assert.ok(fs.existsSync(file));
  await admin.post('/admin/c/' + id + '/work/fixdel', { fix: String(fid) });
  assert.ok(!fs.existsSync(file));
  assert.strictEqual(s.app.store.db.prepare('SELECT COUNT(*) n FROM wk_fix_files WHERE fix_id = ?').get(fid).n, 0);
  r = await d.req('GET', link + '/c/' + id + '/file/' + f1 + '.jpg');
  assert.strictEqual(r.status, 404);
});

test('классный руководитель: своя ссылка, только папка «кл рук», обложка, список и пожелание; ученики эти фото не видят', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  let r = await admin.req('GET', '/admin/c/' + id + '/photos');
  const slug = /\/f\/([a-z0-9-]+)/.exec(r.text)[1];
  // пока папки нет — подсказка, куда положить фото
  assert.match(r.text, /Положите его фото в папку «кл рук»/);
  await admin.post('/admin/c/' + id + '/photos/students', { names: 'Анна' });
  const girl = await upload(admin, id, 'Девочки/1.jpg');
  const t1 = await upload(admin, id, 'кл рук/IMG_1.jpg');
  const t2 = await upload(admin, id, 'кл рук/IMG_2.jpg', JPEG_TALL);

  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  const token = /\/kr\/([a-z0-9]{20})/.exec(r.text)[1];
  assert.match(r.text, /кл рук<\/b> <small>2 фото · классный руководитель/);
  assert.match(r.text, /ещё не заходил/);

  // ученик: в его списке нет фото кл. рука, выбрать их нельзя
  r = await client(s.base).req('GET', '/f/' + slug);
  assert.ok(r.text.indexOf(t1) === -1);
  assert.ok(r.text.indexOf(girl) !== -1);
  const kid = client(s.base);
  const anna = s.app.store.db.prepare('SELECT id FROM pk_students').get().id;
  await kid.req('POST', '/f/' + slug + '/me', { json: { student: anna, newPin: '1111' } });
  r = await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: t1, on: true } });
  assert.strictEqual(r.status, 400);

  // страница кл. рука
  const kr = client(s.base);
  r = await kr.req('GET', '/kr/' + token);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Фото на обложку/);
  assert.match(r.text, /Фото в общий список класса/);
  assert.match(r.text, /Пожелание классу/);
  assert.ok(r.text.indexOf(t1) !== -1 && r.text.indexOf(girl) === -1);
  assert.strictEqual(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.strictEqual((await kr.req('GET', '/kr/' + 'a'.repeat(20))).status, 404);

  r = await kr.req('POST', '/kr/' + token + '/save', { json: { cover: t1 } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.cover, t1);
  assert.strictEqual(r.data.done, false);
  // фото ученика сюда не подставить
  r = await kr.req('POST', '/kr/' + token + '/save', { json: { list: girl } });
  assert.strictEqual(r.status, 400);
  r = await kr.req('POST', '/kr/' + token + '/save', { json: { list: t2, wish: 'Дорогие мои!\nЛюблю вас.', name: 'Фатима Руслановна' } });
  assert.strictEqual(r.data.done, true);
  // то же фото и на обложку, и в список — можно
  r = await kr.req('POST', '/kr/' + token + '/save', { json: { list: t1 } });
  assert.strictEqual(r.data.list, t1);
  await kr.req('POST', '/kr/' + token + '/save', { json: { list: t2 } });

  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.match(r.text, /chip chip--done">выбрал/);
  assert.match(r.text, /Фатима Руслановна/);
  assert.match(r.text, /Дорогие мои!/);
  // раскладка по папкам
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/export');
  assert.deepStrictEqual(r.data.teacher, { name: 'Фатима Руслановна', wish: 'Дорогие мои!\nЛюблю вас.', cover: 'кл рук/IMG_1.jpg', list: 'кл рук/IMG_2.jpg' });
  // на этапе «Выборка» видно, что кл. рук выбрал
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /кл\. рук: выбрал ✓/);

  // дизайнер видит выбор и пожелание
  const link = await designerLink(s, admin);
  const d = client(s.base);
  r = await d.req('GET', link + '/c/' + id);
  assert.match(r.text, /Классный руководитель[\s\S]*Фатима Руслановна/);
  assert.match(r.text, /Дорогие мои!/);
  // дизайнер уже начала — новое пожелание приходит ей правкой, без дублей
  await admin.post('/admin/c/' + id + '/work/status', { status: 'review' });
  await kr.req('POST', '/kr/' + token + '/save', { json: { wish: 'Новый текст' } });
  await kr.req('POST', '/kr/' + token + '/save', { json: { wish: 'Новый текст 2' } });
  const fixes = s.app.work.fixes(+id).filter(f => f.kind === 'teacher_wish');
  assert.strictEqual(fixes.length, 1);
  assert.strictEqual(fixes[0].text, 'Новый текст 2');
  assert.strictEqual(s.app.work.get(+id).status, 'fixes');

  // отбор закрыт — менять нельзя, страница только показывает
  await admin.post('/admin/c/' + id + '/photos/close', {});
  r = await kr.req('POST', '/kr/' + token + '/save', { json: { wish: 'Ещё' } });
  assert.strictEqual(r.status, 409);
  r = await kr.req('GET', '/kr/' + token);
  assert.match(r.text, /Выбор уже закрыт/);

  // «Освободить место» не удаляет выбранные фото кл. рука
  await admin.post('/admin/c/' + id + '/photos/slim', {});
  const left = s.app.photos.photos(+id).map(p => p.id);
  assert.ok(left.indexOf(t1) !== -1 && left.indexOf(t2) !== -1);
});
