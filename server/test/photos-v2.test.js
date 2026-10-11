'use strict';

// Отбор фото, вторая версия: код ученика, места в альбоме, доп. ретушь, пожелание,
// ссылка на оригиналы и «Освободить место»

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JPEG_WIDE, start, client, adminLogin, createClass } = require('./helpers');

async function setup(t) {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Лицей', '11 «А»');
  let r = await admin.req('GET', '/admin/c/' + id + '/photos');
  const slug = /\/f\/([a-z0-9-]+)/.exec(r.text)[1];
  const up = async p => {
    const a = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent(p), JPEG_WIDE);
    assert.strictEqual(a.status, 200, a.text);
    const b = await admin.upload('/admin/api/media/pk/' + id + '/' + a.data.id + '/sm', JPEG_WIDE);
    assert.strictEqual(b.status, 200, b.text);
    return a.data.id;
  };
  await admin.post('/admin/c/' + id + '/photos/students', { names: 'Анна\nТимур\nЗарина' });
  const st = s.app.store.db.prepare('SELECT id, name FROM pk_students ORDER BY sort').all();
  return { s, admin, id, slug, up, st };
}

test('код ученика: придумать, войти снова, неверный код, подделка cookie, сброс', async t => {
  const { s, admin, id, slug, st } = await setup(t);
  const anna = st[0].id;

  // Первый вход — без кода нельзя, код только из 4 цифр
  const kid = client(s.base);
  let r = await kid.req('POST', '/f/' + slug + '/me', { json: { student: anna } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.pin, 'new');
  r = await kid.req('POST', '/f/' + slug + '/me', { json: { student: anna, newPin: '12a4' } });
  assert.strictEqual(r.status, 400);
  r = await kid.req('POST', '/f/' + slug + '/me', { json: { student: anna, newPin: '4821' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.me.name, 'Анна');

  // На странице у имени замок, сам код никому не отдаётся
  r = await client(s.base).req('GET', '/f/' + slug);
  assert.ok(r.text.indexOf('4821') === -1);
  const data = JSON.parse(/id="pk-data">([\s\S]*?)<\/script>/.exec(r.text)[1]);
  assert.deepStrictEqual(data.students.map(x => x.locked), [true, false, false]);

  // Другой человек выбирает то же имя: придумать новый код уже нельзя, нужен тот самый
  const other = client(s.base);
  r = await other.req('POST', '/f/' + slug + '/me', { json: { student: anna, newPin: '0000' } });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.data.pin, 'ask');
  r = await other.req('POST', '/f/' + slug + '/me', { json: { student: anna, pin: '1111' } });
  assert.strictEqual(r.status, 403);
  assert.match(r.data.error, /Неверный код/);
  r = await other.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me, null);

  // Подделать cookie нельзя: ни голым номером, как раньше, ни с чужой подписью
  const forged = client(s.base);
  forged.jar['rp' + id] = String(anna);
  r = await forged.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me, null);
  forged.jar['rp' + id] = anna + '.' + 'A'.repeat(24);
  r = await forged.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me, null);
  r = await forged.req('POST', '/f/' + slug + '/quote', { json: { text: 'взлом' } });
  assert.strictEqual(r.status, 403);

  // С правильным кодом — входит с другого телефона
  const phone2 = client(s.base);
  r = await phone2.req('POST', '/f/' + slug + '/me', { json: { student: anna, pin: '4821' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.me.name, 'Анна');

  // Подбор: после 10 неверных попыток имя блокируется, даже верный код не пускает
  const bad = client(s.base);
  for (let i = 0; i < 10; i++) {
    r = await bad.req('POST', '/f/' + slug + '/me', { json: { student: anna, pin: String(1000 + i) } });
    assert.strictEqual(r.status, 403);
  }
  r = await bad.req('POST', '/f/' + slug + '/me', { json: { student: anna, pin: '4821' } });
  assert.strictEqual(r.status, 429);
  // а у тех, кто уже вошёл, всё работает
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me.name, 'Анна');

  // Артур видит коды в админке
  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.match(r.text, /<span class="pk-pin">4821<\/span>/);

  // Сброс кода: старые входы больше не действуют, выбор сохраняется, ученик придумывает новый
  await kid.req('POST', '/f/' + slug + '/quote', { json: { text: 'Моя цитата' } });
  r = await admin.post('/admin/c/' + id + '/photos/resetpin', { student: String(anna) });
  assert.strictEqual(r.status, 303);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me, null);
  const fresh = client(s.base);
  r = await fresh.req('POST', '/f/' + slug + '/me', { json: { student: anna, newPin: '7777' } });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.data.quote, 'Моя цитата');

  // Артур из админки входит за ученика без кода
  r = await admin.req('POST', '/f/' + slug + '/me', { json: { student: anna } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.me.name, 'Анна');
  // Без входа в админку сбросить код нельзя
  r = await client(s.base).req('POST', '/admin/c/' + id + '/photos/resetpin', { form: { student: String(anna) } });
  assert.notStrictEqual(r.status, 303);
});

test('два человека одновременно придумывают код для одного имени — код у одного', async t => {
  const { s, slug, st } = await setup(t);
  const a = client(s.base), b = client(s.base);
  const [ra, rb] = await Promise.all([
    a.req('POST', '/f/' + slug + '/me', { json: { student: st[1].id, newPin: '1111' } }),
    b.req('POST', '/f/' + slug + '/me', { json: { student: st[1].id, newPin: '2222' } })
  ]);
  // второй получает отказ с просьбой ввести код (403, а если запросы совпали совсем впритык — 409)
  const lose = ra.status === 200 ? rb : ra;
  assert.ok([ra.status, rb.status].includes(200));
  assert.ok([403, 409].includes(lose.status));
  assert.strictEqual(lose.data.pin, 'ask');
  const pin = s.app.store.db.prepare('SELECT pin FROM pk_students WHERE id = ?').get(st[1].id).pin;
  const winner = ra.status === 200 ? '1111' : '2222';
  assert.strictEqual(pin, winner);
});

test('места в альбоме, доп. ретушь, пожелание и раскладка с именами по местам', async t => {
  const { s, admin, id, slug, up, st } = await setup(t);
  const p = [];
  for (let i = 1; i <= 5; i++) p.push(await up('Парни/IMG_' + i + '.jpg'));
  const g1 = await up('Групповые/G_1.jpg');
  const kid = client(s.base);
  await kid.req('POST', '/f/' + slug + '/me', { json: { student: st[0].id, newPin: '1234' } });
  const pick = (ph, on) => kid.req('POST', '/f/' + slug + '/pick', { json: { photo: ph, on: on !== false } });
  const role = (ph, rl) => kid.req('POST', '/f/' + slug + '/role', { json: { photo: ph, role: rl } });
  const retouch = (ph, text) => kid.req('POST', '/f/' + slug + '/retouch', { json: { photo: ph, text: text } });

  // Место можно отметить только у своего выбранного фото
  let r = await role(p[0], 'cover');
  assert.strictEqual(r.status, 400);
  await pick(p[0]);
  await pick(p[1]);
  await pick(p[2]);
  r = await role(p[0], 'cover');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.roles, { [p[0]]: 'cover' });
  r = await role(p[0], 'zzz');
  assert.strictEqual(r.status, 400);
  r = await role(g1, 'cover');
  assert.strictEqual(r.status, 400);

  // Одно место — одно фото: обложка переходит к другому фото
  r = await role(p[1], 'cover');
  assert.deepStrictEqual(r.data.roles, { [p[1]]: 'cover' });
  r = await role(p[0], 'page');
  r = await role(p[2], 'list');
  assert.deepStrictEqual(r.data.roles, { [p[0]]: 'page', [p[1]]: 'cover', [p[2]]: 'list' });
  // Снять место
  r = await role(p[2], '');
  assert.strictEqual(r.data.roles[p[2]], undefined);
  await role(p[2], 'list');

  // Ретушь: только у своего выбранного фото, длинный текст обрезается
  r = await retouch(p[3], 'нос');
  assert.strictEqual(r.status, 400);
  r = await retouch(p[0], '  убрать прыщик на лбу  ');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.retouch, { [p[0]]: 'убрать прыщик на лбу' });
  r = await retouch(p[1], 'x'.repeat(900));
  assert.strictEqual(r.data.retouch[p[1]].length, 500);
  await retouch(p[1], '');

  // Цитата в несколько абзацев и пожелание; пожелание видит только сам ученик
  const long = 'Первый абзац.\r\n\r\nВторой абзац. ' + 'а'.repeat(1500);
  r = await kid.req('POST', '/f/' + slug + '/quote', { json: { text: long } });
  assert.strictEqual(r.data.quote, long.replace(/\r\n/g, '\n'));
  r = await kid.req('POST', '/f/' + slug + '/wish', { json: { text: 'Не бросай рисовать' } });
  assert.strictEqual(r.data.wish, 'Не бросай рисовать');
  const kid2 = client(s.base);
  await kid2.req('POST', '/f/' + slug + '/me', { json: { student: st[1].id, newPin: '5555' } });
  r = await kid2.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.wish, '');
  assert.deepStrictEqual(r.data.roles, {});
  assert.deepStrictEqual(r.data.retouch, {});
  r = await client(s.base).req('GET', '/f/' + slug);
  assert.ok(r.text.indexOf('Не бросай рисовать') === -1);
  assert.ok(r.text.indexOf('прыщик') === -1);

  // Админка: место у каждого фото, ретушь, пожелание; Анна закончила (фото, места, цитата, пожелание)
  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.match(r.text, /<b class="">Обложка<\/b>/);
  assert.match(r.text, /✎ убрать прыщик на лбу/);
  assert.match(r.text, /Пожелание себе в будущее/);
  assert.match(r.text, /Не бросай рисовать/);
  assert.match(r.text, /ждут ретуши: 1/);
  assert.match(r.text, /Ещё не закончили: Тимур, Зарина\./);

  // Артур отметил «обработан»; ученик поменял ретушь — отметка снялась
  const done = () => s.app.store.db.prepare('SELECT retouch_done_at d FROM pk_students WHERE id = ?').get(st[0].id).d;
  r = await admin.post('/admin/c/' + id + '/photos/retouched', { student: String(st[0].id), on: '1' });
  assert.strictEqual(r.status, 303);
  assert.match(r.headers.get('location'), /#st-\d+$/);
  assert.ok(done());
  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.match(r.text, /✓ Обработан/);
  assert.doesNotMatch(r.text, /ждут ретуши/);
  await retouch(p[0], 'убрать прыщик на лбу'); // тот же текст — не изменение
  assert.ok(done());
  await retouch(p[0], 'убрать прыщик и подправить брови');
  assert.strictEqual(done(), null);
  // смена фото — тоже изменение
  await admin.post('/admin/c/' + id + '/photos/retouched', { student: String(st[0].id), on: '1' });
  await role(p[2], 'cover');
  assert.strictEqual(done(), null);
  await role(p[1], 'cover');
  await role(p[2], 'list');

  // Убрал фото — его место и ретушь уходят вместе с ним
  await pick(p[0], false);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.deepStrictEqual(r.data.roles, { [p[1]]: 'cover', [p[2]]: 'list' });
  assert.deepStrictEqual(r.data.retouch, {});
  await pick(p[0]);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.roles[p[0]], undefined);
  await role(p[0], 'page');

  // Раскладка: имена по местам, пожелание и ретушь в раскладку не идут
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/export');
  const anna = r.data.students[0];
  assert.deepStrictEqual(anna.photos, ['Парни/IMG_2.jpg', 'Парни/IMG_3.jpg', 'Парни/IMG_1.jpg']);
  assert.deepStrictEqual(anna.roles, ['Обложка', 'Список класса', 'Личная страница']);
  assert.strictEqual(anna.wish, undefined);
  assert.ok(JSON.stringify(r.data).indexOf('прыщик') === -1);

  // Отбор закрыт — места, ретушь и тексты не меняются
  await admin.post('/admin/c/' + id + '/photos/close');
  for (const [u, b] of [['/role', { photo: p[0], role: 'cover' }], ['/retouch', { photo: p[0], text: 'x' }], ['/wish', { text: 'x' }]]) {
    r = await kid.req('POST', '/f/' + slug + u, { json: b });
    assert.strictEqual(r.status, 409);
  }
});

test('ссылка на оригиналы (wfolio)', async t => {
  const { s, admin, id, slug, st } = await setup(t);
  let r = await admin.post('/admin/c/' + id + '/photos/wfolio', { wfolio: 'javascript:alert(1)' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/c/' + id + '/photos/wfolio', { wfolio: 'https://rigsarthur.wfolio.pro/disk/11a' });
  assert.strictEqual(r.status, 303);
  const kid = client(s.base);
  r = await kid.req('GET', '/f/' + slug);
  assert.match(r.text, /"wfolio":"https:\/\/rigsarthur\.wfolio\.pro\/disk\/11a"/);
  await kid.req('POST', '/f/' + slug + '/me', { json: { student: st[0].id, newPin: '1234' } });
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.wfolio, 'https://rigsarthur.wfolio.pro/disk/11a');
  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.match(r.text, /Оригиналы: https:\/\/rigsarthur\.wfolio\.pro\/disk\/11a/);
  // Убрать ссылку
  await admin.post('/admin/c/' + id + '/photos/wfolio', { wfolio: '' });
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.wfolio, '');
});

test('освободить место: невыбранные удаляются, выбор и маленькие копии остаются', async t => {
  const { s, admin, id, slug, up, st } = await setup(t);
  const p = [];
  for (let i = 1; i <= 4; i++) p.push(await up('Парни/IMG_' + i + '.jpg'));
  const g = [await up('Групповые/G_1.jpg'), await up('Групповые/G_2.jpg')];
  const kid = client(s.base);
  await kid.req('POST', '/f/' + slug + '/me', { json: { student: st[0].id, newPin: '1234' } });
  await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: p[1], on: true } });
  await kid.req('POST', '/f/' + slug + '/role', { json: { photo: p[1], role: 'cover' } });
  await kid.req('POST', '/f/' + slug + '/retouch', { json: { photo: p[1], text: 'нос' } });
  await kid.req('POST', '/f/' + slug + '/quote', { json: { text: 'Цитата' } });
  await kid.req('POST', '/f/' + slug + '/group', { json: { photo: g[0], on: true } });
  const dir = path.join(s.dataDir, 'photos', String(+id));

  // Пока отбор открыт — нельзя
  let r = await admin.post('/admin/c/' + id + '/photos/slim');
  assert.strictEqual(r.status, 400);
  assert.strictEqual(fs.readdirSync(dir).length, 12);

  await admin.post('/admin/c/' + id + '/photos/close');
  const before = s.app.photos.usage(+id);
  r = await admin.post('/admin/c/' + id + '/photos/slim');
  assert.strictEqual(r.status, 303);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [p[1] + '-sm.jpg', g[0] + '-sm.jpg'].sort());
  assert.ok(s.app.photos.usage(+id) < before);

  // Выбор на месте, фото показываются (большая ссылка отдаёт маленькую копию)
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.deepStrictEqual(r.data.mine, [p[1]]);
  assert.deepStrictEqual(r.data.roles, { [p[1]]: 'cover' });
  assert.deepStrictEqual(r.data.retouch, { [p[1]]: 'нос' });
  assert.deepStrictEqual(r.data.group.map(x => x[0]), [g[0]]);
  assert.strictEqual(r.data.slim, true);
  r = await kid.req('GET', '/f/' + slug + '/p/' + p[1] + '.jpg');
  assert.strictEqual(r.status, 200);
  r = await kid.req('GET', '/f/' + slug + '/p/' + p[0] + '-sm.jpg');
  assert.strictEqual(r.status, 404);
  r = await kid.req('GET', '/f/' + slug);
  const shown = JSON.parse(/id="pk-data">([\s\S]*?)<\/script>/.exec(r.text)[1]).photos.map(x => x[0]);
  assert.deepStrictEqual(shown.sort(), [p[1], g[0]].sort());

  // Админка: выбор и ретушь видны, раскладка — те же пути оригиналов
  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.match(r.text, /Место освобождено/);
  assert.match(r.text, /✎ нос/);
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/export');
  assert.deepStrictEqual(r.data.students[0].photos, ['Парни/IMG_2.jpg']);
  assert.deepStrictEqual(r.data.group, ['Групповые/G_1.jpg']);
  // При повторной загрузке папки выбранные уже есть, остальные загрузятся заново
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/have');
  assert.deepStrictEqual(r.data.paths.sort(), ['Групповые/G_1.jpg', 'Парни/IMG_2.jpg']);
  // Повторная загрузка выбранного фото возвращает ему большую копию, выбор тот же
  assert.strictEqual(await up('Парни/IMG_2.jpg'), p[1]);
  assert.strictEqual(s.app.photos.photo(+id, p[1]).slim, 0);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.deepStrictEqual(r.data.roles, { [p[1]]: 'cover' });
});

test('старые таблицы отбора дополняются новыми полями без потери данных', () => {
  const { Store } = require('../lib/db');
  const { Photos } = require('../lib/photos');
  const store = new Store(':memory:');
  const cid = store.createClass({ slug: 'old', school: 'Ш', title: '11', year: 2026 });
  // таблицы в виде первой выложенной версии
  store.db.exec(`
    CREATE TABLE pk_albums (class_id INTEGER PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE, slug TEXT NOT NULL UNIQUE,
      personal_max INTEGER NOT NULL DEFAULT 3, group_max INTEGER NOT NULL DEFAULT 60, group_sections TEXT NOT NULL DEFAULT '[]',
      closed_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE pk_students (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, quote TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE TABLE pk_photos (id TEXT PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      section TEXT NOT NULL, path TEXT NOT NULL, w INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0,
      has_sm INTEGER NOT NULL DEFAULT 0, ver INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE (class_id, path));
    CREATE TABLE pk_personal (student_id INTEGER NOT NULL REFERENCES pk_students(id) ON DELETE CASCADE,
      photo_id TEXT NOT NULL REFERENCES pk_photos(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (student_id, photo_id));
  `);
  store.db.prepare("INSERT INTO pk_albums (class_id, slug, created_at) VALUES (?, 'old-x', 1)").run(cid);
  store.db.prepare("INSERT INTO pk_students (id, class_id, name, quote, created_at) VALUES (5, ?, 'Анна', 'Цитата', 1)").run(cid);
  store.db.prepare("INSERT INTO pk_photos (id, class_id, section, path, has_sm, created_at) VALUES ('aaaaaaaaaaaaaaaa', ?, 'Парни', 'Парни/1.jpg', 1, 1)").run(cid);
  store.db.prepare("INSERT INTO pk_personal (student_id, photo_id, created_at) VALUES (5, 'aaaaaaaaaaaaaaaa', 1)").run();
  const ph = new Photos(store, require('os').tmpdir());
  const a = ph.album(cid);
  assert.strictEqual(a.slug, 'old-x');
  assert.strictEqual(a.wfolio, '');
  assert.strictEqual(a.slim_at, null);
  const s = ph.student(cid, 5);
  assert.deepStrictEqual([s.name, s.quote, s.wish, s.pin, s.retouch_done_at], ['Анна', 'Цитата', '', '', null]);
  assert.deepStrictEqual(ph.personalInfo(5, a), [{ id: 'aaaaaaaaaaaaaaaa', role: '', retouch: '' }]);
  assert.strictEqual(ph.photos(cid)[0].slim, 0);
  // код придумывается один раз: второй раз поверх — нельзя
  assert.strictEqual(ph.setPin(cid, 5, '12345'), false);
  assert.strictEqual(ph.setPin(cid, 5, '1234'), true);
  assert.strictEqual(ph.setPin(cid, 5, '9999'), false);
  assert.strictEqual(ph.student(cid, 5).pin, '1234');
  new Photos(store, require('os').tmpdir()); // повторный запуск ничего не ломает
  store.close();
});
