'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JPEG_WIDE, JPEG_TALL, start, client, adminLogin, createClass } = require('./helpers');
const { cleanPath } = require('../lib/photos');

test('пути файлов из папки с оригиналами', () => {
  assert.strictEqual(cleanPath('Парни/IMG_1.jpg'), 'Парни/IMG_1.jpg');
  assert.strictEqual(cleanPath('Групповые\\IMG_2.JPG'), 'Групповые/IMG_2.JPG');
  assert.strictEqual(cleanPath('../etc/passwd.jpg'), null);
  assert.strictEqual(cleanPath('.hidden/a.jpg'), null);
  assert.strictEqual(cleanPath('Парни/IMG_1.png'), null);
  assert.strictEqual(cleanPath(''), null);
});

test('отбор фото: загрузка, выбор учеников, групповые, раскладка', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Школа №1', '11 «А»');

  // Голосование класса до этого не трогаем: проверим в конце, что оно на месте
  const before = s.app.store.getClass(+id);

  let r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.strictEqual(r.status, 200);
  const slug = /\/f\/([a-z0-9-]+)/.exec(r.text)[1];

  // Загрузка: большая копия и маленькая, путь — относительный внутри папки
  const up = async (p, buf) => {
    const a = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent(p), buf || JPEG_WIDE);
    assert.strictEqual(a.status, 200, a.text);
    const b = await admin.upload('/admin/api/media/pk/' + id + '/' + a.data.id + '/sm', buf || JPEG_WIDE);
    assert.strictEqual(b.status, 200, b.text);
    return a.data.id;
  };
  const p1 = await up('Парни/IMG_1.jpg');
  const p2 = await up('Девочки/IMG_1.jpg', JPEG_TALL);
  const p3 = await up('Девочки/IMG_2.jpg');
  const g1 = await up('Групповые/G_1.jpg');
  const g2 = await up('Групповые/G_2.jpg');
  const g3 = await up('Групповые/G_3.jpg');
  // Тот же путь повторно — это замена файла, а не новое фото; версия меняется, чтобы не показывалась старая картинка
  const ver = () => s.app.store.db.prepare('SELECT ver FROM pk_photos WHERE id = ?').get(p1).ver;
  const v1 = ver();
  await new Promise(res => setTimeout(res, 5));
  const re = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent('Парни/IMG_1.jpg'), JPEG_TALL);
  assert.strictEqual(re.data.id, p1);
  // пока маленькая копия не догрузилась, фото не показывается ученикам и считается недогруженным
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/have');
  assert.ok(r.data.paths.indexOf('Парни/IMG_1.jpg') === -1);
  assert.strictEqual(await up('Парни/IMG_1.jpg'), p1);
  assert.ok(ver() > v1);
  // IMG_2 раньше IMG_10
  await up('Парни/IMG_10.jpg');
  await up('Парни/IMG_2.jpg');
  assert.deepStrictEqual(s.app.photos.photos(+id).filter(x => x.section === 'Парни').map(x => x.path), ['Парни/IMG_1.jpg', 'Парни/IMG_2.jpg', 'Парни/IMG_10.jpg']);
  r = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent('../x.jpg'), JPEG_WIDE);
  assert.strictEqual(r.status, 400);
  r = await admin.upload('/admin/api/media/pk/' + id + '?path=a.jpg', Buffer.from('not a jpeg'));
  assert.strictEqual(r.status, 415);
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/have');
  assert.strictEqual(r.data.paths.length, 8);

  // Копия больше 1 МБ (бывает у детальных фото) принимается; больше 6 МБ — нет
  const big = Buffer.concat([JPEG_WIDE, Buffer.alloc(2.5 * 1024 * 1024, 1)]);
  r = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent('Временный/BIG.jpg'), big);
  assert.strictEqual(r.status, 200, r.text);
  r = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent('Временный/HUGE.jpg'), Buffer.concat([JPEG_WIDE, Buffer.alloc(7 * 1024 * 1024, 1)]));
  assert.strictEqual(r.status, 413);
  assert.strictEqual(s.app.photos.deleteSection(+id, 'Временный'), 1);

  // Мало места на диске — новые фото не принимаем, чтобы не сломать базу
  s.app.photos.reserve = 10;
  r = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent('Парни/X.jpg'), JPEG_WIDE);
  assert.strictEqual(r.status, 507);
  assert.match(r.data.error, /заканчивается место/);
  delete s.app.photos.reserve;

  // Без входа в админку загружать нельзя
  const anon = client(s.base);
  r = await anon.req('POST', '/admin/api/media/pk/' + id + '?path=a.jpg', { raw: JPEG_WIDE, type: 'image/jpeg' });
  assert.strictEqual(r.status, 403);

  // Одинаковые имена не склеиваем молча: список не сохраняется, текст в поле остаётся
  r = await admin.post('/admin/c/' + id + '/photos/students', { names: 'Анна\nТимур\nанна ' });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /Повторяются имена: анна/);
  assert.match(r.text, /Тимур/);
  assert.strictEqual(s.app.store.db.prepare('SELECT COUNT(*) n FROM pk_students').get().n, 0);
  await admin.post('/admin/c/' + id + '/photos/students', { names: 'Анна\nТимур' });
  await admin.post('/admin/c/' + id + '/photos/settings', { personal_max: '2', group_max: '2' });
  const students = s.app.store.db.prepare('SELECT id, name FROM pk_students ORDER BY sort').all();
  assert.deepStrictEqual(students.map(x => x.name), ['Анна', 'Тимур']);

  // Артур заранее отмечает групповые
  r = await admin.req('POST', '/f/' + slug + '/group', { json: { photo: g1, on: true } });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(r.data.group, [[g1, 'Артур']]);

  // Ученик: сначала находит себя
  const kid = client(s.base);
  r = await kid.req('GET', '/f/' + slug);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  r = await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: p1, on: true } });
  assert.strictEqual(r.status, 403);
  r = await kid.req('POST', '/f/' + slug + '/me', { json: { student: students[0].id } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.me.name, 'Анна');

  // Личные: лимит 2, групповое фото как личное выбрать нельзя
  r = await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: p1, on: true } });
  assert.strictEqual(r.status, 200);
  r = await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: p2, on: true } });
  assert.deepStrictEqual(r.data.mine, [p1, p2]);
  r = await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: p3, on: true } });
  assert.strictEqual(r.status, 409);
  r = await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: g2, on: true } });
  assert.strictEqual(r.status, 400);

  // Групповые: общий лимит 2, заменить — убрать и добавить
  r = await kid.req('POST', '/f/' + slug + '/group', { json: { photo: g2, on: true } });
  assert.strictEqual(r.data.group.length, 2);
  r = await kid.req('POST', '/f/' + slug + '/group', { json: { photo: g3, on: true } });
  assert.strictEqual(r.status, 409);
  r = await kid.req('POST', '/f/' + slug + '/group', { json: { photo: g1, on: false } });
  r = await kid.req('POST', '/f/' + slug + '/group', { json: { photo: g3, on: true } });
  assert.deepStrictEqual(r.data.group.map(g => g[0]).sort(), [g2, g3].sort());
  assert.ok(r.data.group.every(g => g[1] === 'Анна'));

  r = await kid.req('POST', '/f/' + slug + '/quote', { json: { text: '  Вместе навсегда  ' } });
  assert.strictEqual(r.data.quote, 'Вместе навсегда');

  // Второй ученик видит общий выбор
  const kid2 = client(s.base);
  await kid2.req('POST', '/f/' + slug + '/me', { json: { student: students[1].id } });
  r = await kid2.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.group.length, 2);
  assert.deepStrictEqual(r.data.mine, []);

  // Картинки отдаются только по ссылке альбома
  r = await kid2.req('GET', '/f/' + slug + '/p/' + p1 + '-sm.jpg');
  assert.strictEqual(r.status, 200);
  r = await kid2.req('GET', '/f/wrong-slug/p/' + p1 + '-sm.jpg');
  assert.strictEqual(r.status, 404);

  // На странице видно, кто уже начал выбирать (для предупреждения «под этим именем уже выбирали»)
  r = await client(s.base).req('GET', '/f/' + slug);
  const pageData = JSON.parse(/<script type="application\/json" id="pk-data">([\s\S]*?)<\/script>/.exec(r.text)[1]);
  assert.deepStrictEqual(pageData.students.map(x => [x.name, x.started]), [['Анна', true], ['Тимур', false]]);

  // В админке: сообщение для чата со ссылкой, напоминание и выбор каждого
  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.match(r.text, /Сообщение для чата класса/);
  assert.ok(r.text.indexOf('/f/' + slug) !== -1);
  assert.match(r.text, /Ещё не закончили: Тимур/);
  assert.match(r.text, /Что выбрали ученики/);
  assert.match(r.text, /Вместе навсегда/);

  // Артур открывает «как Артур» в браузере, где раньше выбирал ученика, — входит как Артур
  await admin.req('POST', '/f/' + slug + '/me', { json: { student: students[1].id } });
  r = await admin.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me.name, 'Тимур');
  r = await admin.req('GET', '/f/' + slug + '?admin=1');
  r = await admin.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me, null);
  assert.strictEqual(r.data.admin, true);
  // а у ученика ?admin=1 ничего не меняет
  r = await kid.req('GET', '/f/' + slug + '?admin=1');
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me.name, 'Анна');

  // Ученика, который уже выбирал, из списка не убрать
  r = await admin.post('/admin/c/' + id + '/photos/students', { names: 'Тимур' });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /Анна/);

  // Опечатку в имени исправляем без потери выбора; занятое имя не даём
  r = await admin.post('/admin/c/' + id + '/photos/rename', { student: String(students[0].id), name: 'Тимур' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/c/' + id + '/photos/rename', { student: String(students[0].id), name: 'Анна Козлова' });
  assert.strictEqual(r.status, 303);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.strictEqual(r.data.me.name, 'Анна Козлова');
  assert.deepStrictEqual(r.data.mine, [p1, p2]);
  await admin.post('/admin/c/' + id + '/photos/rename', { student: String(students[0].id), name: 'Анна' });

  // История и «вернуть»
  r = await admin.req('GET', '/admin/c/' + id + '/photos');
  assert.match(r.text, /убрал\(а\)/);

  // Закрыт — ученики не меняют
  await admin.post('/admin/c/' + id + '/photos/close');
  r = await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: p1, on: false } });
  assert.strictEqual(r.status, 409);
  await admin.post('/admin/c/' + id + '/photos/open');

  // Несколько галочек — как отправляет браузер: повторяющееся поле group
  const setGroups = list => {
    const f = new URLSearchParams({ _csrf: admin.csrf });
    list.forEach(g => f.append('group', g));
    return admin.req('POST', '/admin/c/' + id + '/photos/sections', { form: f });
  };
  // Артур переключил «Девочки» в групповые: отметку Анны на фото оттуда не считаем, но и не теряем
  await setGroups(['Групповые', 'Девочки']);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.deepStrictEqual(r.data.mine, [p1]);
  r = await kid.req('POST', '/f/' + slug + '/pick', { json: { photo: p3, on: true } });
  assert.strictEqual(r.status, 400);
  await setGroups(['Групповые']);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.deepStrictEqual(r.data.mine, [p1, p2]);
  // Ни одного группового раздела — тоже можно
  await setGroups([]);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.deepStrictEqual(r.data.group, []);
  await setGroups(['Групповые']);

  // План раскладки — относительные пути оригиналов
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/export');
  assert.deepStrictEqual(r.data.students[0], { name: 'Анна', quote: 'Вместе навсегда', photos: ['Парни/IMG_1.jpg', 'Девочки/IMG_1.jpg'] });
  assert.deepStrictEqual(r.data.group.sort(), ['Групповые/G_2.jpg', 'Групповые/G_3.jpg']);

  // Голосование класса не изменилось
  const after = s.app.store.getClass(+id);
  assert.deepStrictEqual({ hidden: after.hidden, picks: after.picks, slug: after.slug }, { hidden: before.hidden, picks: before.picks, slug: before.slug });

  // База восстановлена из бэкапа, а копий фото на диске нет: такие фото не считаются загруженными,
  // ученикам не показываются, а повторная загрузка папки их догружает с тем же выбором
  fs.unlinkSync(path.join(s.dataDir, 'photos', String(+id), p1 + '-sm.jpg'));
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/have');
  assert.ok(r.data.paths.indexOf('Парни/IMG_1.jpg') === -1);
  const shown = async () => {
    const pg = await kid.req('GET', '/f/' + slug);
    return JSON.parse(/<script type="application\/json" id="pk-data">([\s\S]*?)<\/script>/.exec(pg.text)[1]).photos.map(x => x[0]);
  };
  assert.ok((await shown()).indexOf(p1) === -1);
  assert.strictEqual(await up('Парни/IMG_1.jpg'), p1);
  assert.ok((await shown()).indexOf(p1) !== -1);
  r = await admin.req('GET', '/admin/api/c/' + id + '/photos/have');
  assert.ok(r.data.paths.indexOf('Парни/IMG_1.jpg') !== -1);
  r = await kid.req('GET', '/f/' + slug + '/state');
  assert.ok(r.data.mine.indexOf(p1) !== -1);

  // Удаление класса убирает и копии фото
  const dir = path.join(s.dataDir, 'photos', String(+id));
  assert.ok(fs.existsSync(dir));
  await admin.post('/admin/c/' + id + '/delete');
  assert.ok(!fs.existsSync(dir));
  assert.strictEqual(s.app.store.db.prepare('SELECT COUNT(*) n FROM pk_photos').get().n, 0);
});

test('отбор фото: старая таблица без новых полей дополняется, данные сохраняются', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { Store } = require('../lib/db');
  const { Photos } = require('../lib/photos');
  const store = new Store(':memory:');
  const cid = store.createClass({ slug: 'old-class', school: 'Ш', title: '11', year: 2026 });
  // таблица в виде первой версии — без поля ver
  store.db.exec(`CREATE TABLE pk_photos (id TEXT PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    section TEXT NOT NULL, path TEXT NOT NULL, w INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0,
    has_sm INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE (class_id, path))`);
  store.db.prepare("INSERT INTO pk_photos (id, class_id, section, path, has_sm, created_at) VALUES ('aaaaaaaaaaaaaaaa', ?, 'Парни', 'Парни/1.jpg', 1, 1)").run(cid);
  const ph = new Photos(store, require('os').tmpdir());
  const row = ph.photos(cid)[0];
  assert.strictEqual(row.path, 'Парни/1.jpg');
  assert.strictEqual(row.ver, 0);
  new Photos(store, require('os').tmpdir()); // повторный запуск ничего не ломает
  store.close();
});

test('отбор фото: одновременные нажатия не превышают лимит и не теряются', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const id = await createClass(admin, 'Школа №2', '11 «Б»');
  let r = await admin.req('GET', '/admin/c/' + id + '/photos');
  const slug = /\/f\/([a-z0-9-]+)/.exec(r.text)[1];
  const ids = [];
  for (let i = 1; i <= 12; i++) {
    const a = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent('Групповые/G_' + i + '.jpg'), JPEG_WIDE);
    await admin.upload('/admin/api/media/pk/' + id + '/' + a.data.id + '/sm', JPEG_WIDE);
    ids.push(a.data.id);
  }
  const p = await admin.upload('/admin/api/media/pk/' + id + '?path=' + encodeURIComponent('Парни/P.jpg'), JPEG_WIDE);
  await admin.upload('/admin/api/media/pk/' + id + '/' + p.data.id + '/sm', JPEG_WIDE);
  const names = Array.from({ length: 10 }, (_, i) => 'Ученик ' + (i + 1));
  await admin.post('/admin/c/' + id + '/photos/students', { names: names.join('\n') });
  await admin.post('/admin/c/' + id + '/photos/settings', { personal_max: '1', group_max: '3' });
  const st = s.app.store.db.prepare('SELECT id FROM pk_students ORDER BY sort').all();
  const kids = await Promise.all(st.map(async row => {
    const k = client(s.base);
    await k.req('POST', '/f/' + slug + '/me', { json: { student: row.id } });
    return k;
  }));

  // 10 учеников одновременно добавляют разные групповые при лимите 3
  const res = await Promise.all(kids.map((k, i) => k.req('POST', '/f/' + slug + '/group', { json: { photo: ids[i], on: true } })));
  assert.strictEqual(res.filter(x => x.status === 200).length, 3);
  assert.ok(res.filter(x => x.status !== 200).every(x => x.status === 409));
  assert.strictEqual(s.app.photos.group(+id).length, 3);

  // Все разом жмут на одно и то же фото — одна запись, без ошибок
  const free = ids[11];
  await Promise.all(s.app.photos.group(+id).map(g => admin.req('POST', '/f/' + slug + '/group', { json: { photo: g.photo_id, on: false } })));
  const same = await Promise.all(kids.map(k => k.req('POST', '/f/' + slug + '/group', { json: { photo: free, on: true } })));
  assert.ok(same.every(x => x.status === 200));
  assert.deepStrictEqual(s.app.photos.group(+id).map(g => g.photo_id), [free]);

  // Один ученик быстро жмёт много раз — личных не больше лимита
  const spam = await Promise.all(Array.from({ length: 8 }, () => kids[0].req('POST', '/f/' + slug + '/pick', { json: { photo: p.data.id, on: true } })));
  assert.ok(spam.every(x => x.status === 200));
  assert.strictEqual(s.app.photos.personal(st[0].id).length, 1);
});
