'use strict';

// Макет альбома для проверки: загрузка версиями, номера учеников по алфавиту, вход по коду отбора,
// правки дизайнеру, «всё верно», загрузка дизайнером по его ссылке

const test = require('node:test');
const assert = require('node:assert');
const { start, client, adminLogin, createClass, JPEG_WIDE } = require('./helpers');
const { numbered, pageOf, pageLabel } = require('../lib/layout');

test('номера по алфавиту и личная страница', () => {
  const list = numbered([{ id: 5, name: 'Тимур Ахов' }, { id: 2, name: 'Анна Белова' }, { id: 9, name: 'Зарина Кодзокова' }]);
  assert.deepStrictEqual(list.map(s => s.num + ':' + s.name), ['1:Анна Белова', '2:Зарина Кодзокова', '3:Тимур Ахов']);
  const lay = { first_page: 3, spreads: 3 };
  assert.deepStrictEqual(pageOf(lay, 1), { page: 3, spread: 2, side: 'l' });
  assert.deepStrictEqual(pageOf(lay, 2), { page: 4, spread: 2, side: 'r' });
  assert.strictEqual(pageOf(lay, 5), null, 'страница за пределами макета');
  assert.strictEqual(pageLabel(2, 'r'), 'разворот 2, правая страница');
});

async function setup(t) {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  let r = await admin.req('GET', '/admin/c/' + id + '/photos');
  const slug = /\/f\/([a-z0-9-]+)/.exec(r.text)[1];
  await admin.post('/admin/c/' + id + '/photos/students', { names: 'Тимур\nАнна\nЗарина' });
  const st = s.app.store.db.prepare('SELECT id, name FROM pk_students ORDER BY name').all();
  return { s, admin, id, slug, st };
}

// Все файлы макета на 2 разворота и обложки 1 и 2
async function uploadAll(up, start, finish, covers) {
  let r = await start({ spreads: 2, covers: covers });
  assert.strictEqual(r.status, 200, r.text);
  const ver = r.data.ver;
  const names = ['s01-l', 's01-r', 's02-l', 's02-r'].concat(...covers.map(n => ['c00' + n, 'b00' + n]));
  for (const n of names) for (const sfx of ['', '-sm']) {
    r = await up(ver, n + sfx);
    assert.strictEqual(r.status, 200, n + sfx + ' ' + r.text);
  }
  return { ver, finish: await finish(ver) };
}

test('макет: загрузка, вход ученика, своя обложка и страница, правка и «всё верно»', async t => {
  const { s, admin, id, slug, st } = await setup(t);
  const csrf = { 'x-csrf-token': admin.csrf };
  // пока макета нет — ученик видит, что он готовится
  const kid = client(s.base);
  let r = await kid.req('GET', '/f/' + slug + '/album');
  assert.match(r.text, /Макет альбома ещё готовится/);
  // загрузка: лишний файл не принимается, недогруженная версия не публикуется
  r = await admin.req('POST', '/admin/api/c/' + id + '/layout/start', { json: { spreads: 2, covers: [1, 2] }, headers: csrf });
  const v1 = r.data.ver;
  r = await admin.upload('/admin/api/media/lay/' + id + '/' + v1 + '?name=c009', JPEG_WIDE);
  assert.strictEqual(r.status, 400);
  r = await admin.upload('/admin/api/media/lay/' + id + '/' + v1 + '?name=s01-l', Buffer.from('not a jpeg'));
  assert.strictEqual(r.status, 400);
  r = await admin.req('POST', '/admin/api/c/' + id + '/layout/finish', { json: { ver: v1 }, headers: csrf });
  assert.strictEqual(r.status, 400);
  assert.match(r.data.error, /Дошли не все файлы/);
  const res = await uploadAll(
    (ver, name) => admin.upload('/admin/api/media/lay/' + id + '/' + ver + '?name=' + name, JPEG_WIDE),
    b => admin.req('POST', '/admin/api/c/' + id + '/layout/start', { json: b, headers: csrf }),
    ver => admin.req('POST', '/admin/api/c/' + id + '/layout/finish', { json: { ver }, headers: csrf }),
    [1, 2]);
  assert.strictEqual(res.finish.status, 200, res.finish.text);
  const lay = s.app.layout.get(+id);
  assert.strictEqual(lay.spreads, 2);
  assert.deepStrictEqual(lay.covers, [1, 2]);
  // страница макета у Артура: номера по алфавиту, ссылка для учеников
  r = await admin.req('GET', '/admin/c/' + id + '/layout');
  assert.match(r.text, /\/f\/[a-z0-9-]+\/album/);
  assert.ok(r.text.indexOf('Анна') < r.text.indexOf('Зарина') && r.text.indexOf('Зарина') < r.text.indexOf('Тимур'));
  assert.match(r.text, /нет обложки 003-00/);
  // без входа — выбор себя и код; картинки чужим не отдаются
  r = await kid.req('GET', '/f/' + slug + '/album');
  assert.match(r.text, /data-al-login/);
  r = await kid.req('GET', '/f/' + slug + '/lay/' + res.ver + '/c001.jpg');
  assert.strictEqual(r.status, 404);
  // Зарина (№2) придумывает код и входит
  const zarina = st.find(x => x.name === 'Зарина');
  r = await kid.req('POST', '/f/' + slug + '/me', { json: { student: zarina.id, newPin: '4321' } });
  assert.strictEqual(r.status, 200, r.text);
  r = await kid.req('GET', '/f/' + slug + '/album');
  assert.match(r.text, /data-front="c002"/);
  assert.match(r.text, /data-no-back/, 'задник на проверке не показываем');
  assert.doesNotMatch(r.text, /data-back=/);
  assert.match(r.text, /data-mine="s02-r"/, 'первая личная — страница 3 (разворот 2 слева), у второго ученика — справа');
  r = await kid.req('GET', '/f/' + slug + '/lay/' + res.ver + '/c001-sm.jpg');
  assert.strictEqual(r.status, 200);
  // старая версия больше не отдаётся
  r = await kid.req('GET', '/f/' + slug + '/lay/' + v1 + '/c001.jpg');
  assert.strictEqual(r.status, 404);
  // правка уходит дизайнеру с номером страницы
  r = await kid.req('POST', '/f/' + slug + '/album/fix', { json: { where: '2-r', text: 'Опечатка в цитате' } });
  assert.strictEqual(r.status, 200, r.text);
  r = await kid.req('POST', '/f/' + slug + '/album/fix', { json: { where: '9-l', text: 'нет такой' } });
  assert.strictEqual(r.status, 400);
  const fx = s.app.work.fixes(+id).find(f => f.kind === 'layout');
  assert.strictEqual(fx.student_id, zarina.id);
  assert.strictEqual(fx.text, 'Разворот 2, правая страница: Опечатка в цитате');
  r = await kid.req('GET', '/f/' + slug + '/album');
  assert.match(r.text, /Твои правки/);
  // «всё верно»
  r = await kid.req('POST', '/f/' + slug + '/album/ok', { json: { on: true } });
  assert.strictEqual(r.status, 200);
  assert.ok(s.app.layout.oks(+id).get(zarina.id));
  r = await admin.req('GET', '/admin/c/' + id + '/layout');
  assert.match(r.text, /1 из 3 проверили/);
  // напоминание в чат: только те, кто не отметил «всё верно» и не писал правок
  assert.match(r.text, /Ещё не проверили альбом \(2\):\nАнна\nТимур\n\nСсылка: http[^"]*\/album/);
  assert.match(r.text, /Правки из проверки: 1/);
  // на доске работы — сколько проверили
  r = await admin.req('GET', '/admin/work');
  assert.match(r.text, /макет: проверили 1\/3/);
  // у пункта «Сверка» — сколько проверили и ссылка на макет; в сообщении — ссылка на альбом
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /проверили 1 из 3, правок 1/);
  assert.match(r.text, /class="card wk-lay"[\s\S]*Загружен: 2 разворота · проверили 1 из 3[\s\S]*Открыть макет/, 'заметная карточка макета у Артура');
  assert.match(r.text, new RegExp('/f/' + slug + '/album'));
  // первая личная страница меняется
  await admin.post('/admin/c/' + id + '/layout/first', { spread: '1', side: 'r' });
  r = await kid.req('GET', '/f/' + slug + '/album');
  assert.match(r.text, /data-mine="s02-l"/);
  // все правки из проверки закрываются разом
  await admin.post('/admin/c/' + id + '/layout/fixesdone', {});
  assert.ok(s.app.work.fixes(+id).filter(f => f.kind === 'layout').every(f => f.done_at));
  r = await admin.req('GET', '/admin/c/' + id + '/layout');
  assert.doesNotMatch(r.text, /Правки из проверки:/);
  r = await kid.req('GET', '/f/' + slug + '/album');
  assert.match(r.text, /исправлено/);
  // все проверили, правок нет — у «Сверка пройдена» подсказка
  st.forEach(x => s.app.layout.setOk(+id, x.id, true));
  r = await admin.req('GET', '/admin/c/' + id + '/work');
  assert.match(r.text, /все ученики проверили, правок нет/);
  // Артур смотрит альбом за ученика, без формы правок
  r = await admin.req('GET', '/f/' + slug + '/album?s=' + st.find(x => x.name === 'Анна').id);
  assert.match(r.text, /data-front="c001"/);
  assert.match(r.text, /Так альбом видит Анна/);
  assert.doesNotMatch(r.text, /data-al-check/);
});

test('макет: дизайнер загружает по своей ссылке, без пароля админки', async t => {
  const { s, admin, id, slug } = await setup(t);
  const token = s.app.work.addDesigner('Дизайнер');
  const des = client(s.base);
  // на странице класса у дизайнера — заметная кнопка загрузки макета
  let r = await des.req('GET', '/d/' + token + '/c/' + id);
  assert.match(r.text, new RegExp('class="card wk-lay"[\\s\\S]*href="/d/' + token + '/c/' + id + '/layout">Загрузить макет'));
  r = await des.req('GET', '/d/' + token + '/c/' + id + '/layout');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /data-lay/);
  const res = await uploadAll(
    (ver, name) => des.req('POST', '/admin/api/media/dlay/' + token + '/' + id + '/' + ver + '?name=' + name, { raw: JPEG_WIDE, type: 'image/jpeg' }),
    b => des.req('POST', '/d/' + token + '/c/' + id + '/layout/start', { json: b }),
    ver => des.req('POST', '/d/' + token + '/c/' + id + '/layout/finish', { json: { ver } }),
    [1]);
  assert.strictEqual(res.finish.status, 200, res.finish.text);
  assert.strictEqual(s.app.layout.get(+id).uploaded_by, 'Дизайнер');
  // дизайнер закрывает правки из проверки разом
  s.app.work.addFix(+id, { studentName: 'Классный руководитель', kind: 'layout', text: 'Обложка: опечатка', who: 'Кл', auto: true });
  r = await des.req('GET', '/d/' + token + '/c/' + id + '/layout');
  assert.match(r.text, /Правки из проверки: 1/);
  assert.doesNotMatch(r.text, /Скопировать напоминание/, 'напоминание ученикам — только у Артура');
  r = await des.req('POST', '/d/' + token + '/c/' + id + '/layout/fixesdone', { json: {} });
  assert.strictEqual(r.data.n, 1);
  assert.ok(s.app.work.fixes(+id).every(f => f.done_at));
  // чужая ссылка не работает
  r = await client(s.base).req('POST', '/admin/api/media/dlay/nope/' + id + '/' + res.ver + '?name=s01-l', { raw: JPEG_WIDE, type: 'image/jpeg' });
  assert.strictEqual(r.status, 403);
  // дизайнер видит альбом глазами ученика
  r = await des.req('GET', '/d/' + token + '/c/' + id + '/album?s=' + s.app.store.db.prepare('SELECT id FROM pk_students LIMIT 1').get().id);
  assert.match(r.text, /data-book/);
  r = await des.req('GET', '/d/' + token + '/c/' + id + '/lay/' + res.ver + '/s01-l.jpg');
  assert.strictEqual(r.status, 200);
  assert.ok(slug && admin);
});

test('макет: классный руководитель проверяет свою обложку по своей ссылке', async t => {
  const { s, admin, id, slug } = await setup(t);
  const csrf = { 'x-csrf-token': admin.csrf };
  const res = await uploadAll(
    (ver, name) => admin.upload('/admin/api/media/lay/' + id + '/' + ver + '?name=' + name, JPEG_WIDE),
    b => admin.req('POST', '/admin/api/c/' + id + '/layout/start', { json: b, headers: csrf }),
    ver => admin.req('POST', '/admin/api/c/' + id + '/layout/finish', { json: { ver }, headers: csrf }),
    [1, 4]);
  assert.strictEqual(res.finish.status, 200, res.finish.text);
  // у Артура строка кл. рука с номером после учеников и ссылка для проверки
  let r = await admin.req('GET', '/admin/c/' + id + '/layout');
  assert.match(r.text, /004<\/span>\s*<span class="lay-list__name"><b>Классный руководитель/);
  const link = /\/kr\/([A-Za-z0-9_-]+)\/album/.exec(r.text);
  assert.ok(link, 'ссылка кл. руку');
  const base = '/kr/' + link[1];
  // на его странице выбора фото появляется ссылка на макет
  const kr = client(s.base);
  r = await kr.req('GET', base);
  assert.match(r.text, new RegExp(base + '/album'));
  // альбом без кода, обложка 004, личной страницы нет
  r = await kr.req('GET', base + '/album');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /data-front="c004"/);
  assert.doesNotMatch(r.text, /data-mine=/);
  assert.doesNotMatch(r.text, /data-al-leave/);
  assert.match(r.text, /Проверьте свою обложку/);
  r = await kr.req('GET', base + '/lay/' + res.ver + '/c004-sm.jpg');
  assert.strictEqual(r.status, 200);
  // правка уходит дизайнеру с подписью «Классный руководитель», «всё верно» снимается
  r = await kr.req('POST', base + '/album/ok', { json: { on: true } });
  assert.strictEqual(r.status, 200);
  r = await kr.req('POST', base + '/album/fix', { json: { where: 'cover', text: 'Отчество с ошибкой' } });
  assert.strictEqual(r.status, 200, r.text);
  const fx = s.app.work.fixes(+id).find(f => f.kind === 'layout');
  assert.strictEqual(fx.student_id, null);
  assert.strictEqual(fx.student_name, 'Классный руководитель');
  assert.strictEqual(fx.text, 'Обложка: Отчество с ошибкой');
  assert.ok(!s.app.layout.get(+id).teacher_ok_at);
  r = await kr.req('GET', base + '/album');
  assert.match(r.text, /Ваши правки/);
  r = await kr.req('POST', base + '/album/ok', { json: { on: true } });
  r = await admin.req('GET', '/admin/c/' + id + '/layout');
  assert.match(r.text, /lay-list__kr[\s\S]*правок: 1[\s\S]*всё верно/);
  // Артур смотрит альбом кл. рука без формы
  r = await admin.req('GET', '/f/' + slug + '/album?s=kr');
  assert.match(r.text, /data-front="c004"/);
  assert.doesNotMatch(r.text, /data-al-check/);
  // чужая ссылка не работает
  r = await client(s.base).req('GET', '/kr/nope/album');
  assert.strictEqual(r.status, 404);
  r = await client(s.base).req('POST', '/kr/nope/album/ok', { json: { on: true } });
  assert.strictEqual(r.status, 404);
});

test('раскладка для дизайнера: номера как в макете', async t => {
  const { admin, id } = await setup(t);
  const r = await admin.req('GET', '/admin/api/c/' + id + '/photos/export');
  assert.deepStrictEqual(r.data.students.map(x => x.num + ':' + x.name).sort(), ['1:Анна', '2:Зарина', '3:Тимур']);
});
