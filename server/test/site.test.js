'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JPEG_WIDE, JPEG_TALL, mp4, start, client, adminLogin, createClass } = require('./helpers');
const { toLocalInput } = require('../lib/util');

test('загрузка фото: только JPEG и только с токеном', async t => {
  const { app, base, dataDir, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);

  // Без входа и без токена нельзя
  const anon = client(base);
  let r = await anon.req('POST', '/admin/api/media', { raw: JPEG_WIDE, type: 'image/jpeg' });
  assert.strictEqual(r.status, 403);
  r = await admin.req('POST', '/admin/api/media', { raw: JPEG_WIDE, type: 'image/jpeg' });
  assert.strictEqual(r.status, 403);

  // Не JPEG и не видео
  r = await admin.upload('/admin/api/media', Buffer.from('hello'), 'image/jpeg');
  assert.strictEqual(r.status, 400);
  assert.match(r.data.error, /JPEG/);
  r = await admin.upload('/admin/api/media', Buffer.from('hello'), 'text/plain');
  assert.strictEqual(r.status, 415);

  // Слишком большой файл отклоняется сразу по заголовку
  r = await admin.upload('/admin/api/media', Buffer.alloc(16 * 1024 * 1024, 1), 'image/jpeg');
  assert.strictEqual(r.status, 413);

  const m = await admin.photo(JPEG_WIDE);
  assert.deepStrictEqual([m.w, m.h], [3, 2]);
  assert.ok(fs.existsSync(path.join(dataDir, 'media', m.id + '-lg.jpg')));
  assert.ok(fs.existsSync(path.join(dataDir, 'media', m.id + '-sm.jpg')));

  r = await client(base).req('GET', '/media/' + m.id + '-sm.jpg');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/jpeg');
  assert.match(r.headers.get('cache-control'), /immutable/);
  for (const bad of ['/media/' + m.id + '.jpg', '/media/aaaaaaaaaaaaaaaa-sm.jpg', '/media/..%2Fdata.db', '/media/' + m.id + '-sm.png']) {
    r = await client(base).req('GET', bad);
    assert.strictEqual(r.status, 404, bad);
  }
  assert.strictEqual(app.store.getMedia(m.id).w, 3);
});

test('фото на сайте: замена, варианты размеров, возврат', async t => {
  const { base, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);
  const guest = client(base);

  let r = await guest.req('GET', '/');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /assets\/home\/arthur\.jpg/);
  assert.doesNotMatch(r.text, /<!--@/, 'служебные комментарии не попадают на страницу');
  const etag = r.headers.get('etag');
  r = await guest.req('GET', '/index.html', { headers: { 'if-none-match': etag } });
  assert.strictEqual(r.status, 304);

  const m = await admin.photo(JPEG_TALL);
  r = await admin.api('/admin/api/site/arthur', { media: m.id });
  assert.strictEqual(r.status, 200);
  r = await guest.req('GET', '/index.html', { headers: { 'if-none-match': etag } });
  assert.strictEqual(r.status, 200, 'после правки старый ETag не подходит');
  assert.match(r.text, new RegExp('<img src="media/' + m.id + '-sm\\.jpg" alt="Артур Дзахмишев"'));
  r = await guest.req('GET', '/contacts.html');
  assert.match(r.text, new RegExp('media/' + m.id + '-lg\\.jpg'), 'в «Контактах» крупная версия');

  // Место под фото без картинки превращается в фото
  const s = await admin.photo(JPEG_WIDE);
  await admin.api('/admin/api/site/studio.main', { media: s.id });
  r = await guest.req('GET', '/studio.html');
  assert.match(r.text, new RegExp('<img class="slot-img" src="media/' + s.id + '-lg\\.jpg"'));

  // У фото альбома есть srcset и размеры
  await admin.api('/admin/api/site/album', { media: s.id });
  r = await guest.req('GET', '/albums.html');
  assert.match(r.text, new RegExp('srcset="media/' + s.id + '-sm\\.jpg 3w, media/' + s.id + '-lg\\.jpg 3w"'));
  assert.match(r.text, /width="3" height="2"/);

  // Обложка тематики меняется и в колоде, и на полке
  await admin.api('/admin/api/site/cover.money', { media: m.id });
  r = await guest.req('GET', '/');
  assert.strictEqual(r.text.split('media/' + m.id + '-sm.jpg').length - 1, 3, 'колода, полка и фото Артура');

  // Ошибки
  r = await admin.api('/admin/api/site/nope', { media: m.id });
  assert.strictEqual(r.status, 404);
  r = await admin.api('/admin/api/site/arthur', { media: 'zzzzzzzzzzzzzzzz' });
  assert.strictEqual(r.status, 400);
  r = await admin.req('POST', '/admin/api/site/arthur', { json: { media: m.id } });
  assert.strictEqual(r.status, 403, 'без токена в заголовке нельзя');

  // Вернуть как было
  r = await admin.post('/admin/site/reset/arthur');
  assert.strictEqual(r.status, 303);
  r = await guest.req('GET', '/');
  assert.match(r.text, /assets\/home\/arthur\.jpg/);

  r = await admin.req('GET', '/admin/site');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Обложки тематик/);
});

test('галерея: добавить, переставить, убрать, вернуть', async t => {
  const { base, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);
  const guest = client(base);

  let r = await admin.req('GET', '/admin/site/g/works');
  assert.strictEqual(r.status, 200);
  assert.strictEqual((r.text.match(/class="gi[ "]/g) || []).length, 65);

  const a = await admin.photo(JPEG_WIDE);
  const b = await admin.photo(JPEG_TALL);
  r = await admin.api('/admin/api/site/g/works', { media: [a.id, b.id] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.count, 67);
  r = await guest.req('GET', '/works.html');
  const first = /<a class="pic( pic--wide)?" href="([^"]+)"/.exec(r.text);
  assert.strictEqual(first[2], 'media/' + a.id + '-lg.jpg', 'новые фото в начале');
  assert.strictEqual(first[1], ' pic--wide', 'горизонтальное фото на всю ширину');
  assert.match(r.text, /<span>67 фото<\/span>/);

  r = await admin.post('/admin/site/g/works', { op: 'down:0' });
  assert.strictEqual(r.status, 303);
  r = await guest.req('GET', '/works.html');
  assert.strictEqual(/<a class="pic( pic--wide)?" href="([^"]+)"/.exec(r.text)[2], 'media/' + b.id + '-lg.jpg');

  r = await admin.post('/admin/site/g/works', { op: 'del:0' });
  r = await guest.req('GET', '/works.html');
  assert.doesNotMatch(r.text, new RegExp(b.id));
  assert.match(r.text, /<span>66 фото<\/span>/);

  // На главной не больше 16 фото
  const many = [];
  for (let i = 0; i < 7; i++) many.push((await admin.photo(JPEG_TALL)).id);
  r = await admin.api('/admin/api/site/g/home.works', { media: many });
  assert.strictEqual(r.status, 400);

  r = await admin.post('/admin/site/reset/works');
  r = await guest.req('GET', '/works.html');
  assert.match(r.text, /<span>65 фото<\/span>/);
  assert.doesNotMatch(r.text, /media\//);
});

test('цены: тексты и скрытие скидки для параллели', async t => {
  const { base, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);
  const guest = client(base);

  let r = await admin.post('/admin/site/texts', {
    'price.main': '5 000', 'price.tag': '', 'price.note': 'с человека <b>всё включено</b>',
    'price.group.title': '', 'price.group.two': '', 'price.group.three': ''
  });
  assert.strictEqual(r.status, 303);
  for (const page of ['/', '/albums.html']) {
    r = await guest.req('GET', page);
    assert.match(r.text, /<p class="offer__price">5&nbsp;000<small>₽<\/small><\/p>/, page);
    assert.match(r.text, /<span class="offer__tag">До Нового года<\/span>/, 'пустое поле возвращает исходный текст');
    assert.match(r.text, /с человека &lt;b&gt;всё включено&lt;\/b&gt;/, 'текст экранируется');
    assert.match(r.text, /data-show="price\.group" hidden>/, 'скидка для параллели скрыта');
  }
  r = await admin.post('/admin/site/texts', { 'price.main': '4 500', 'price.group': '1' });
  r = await guest.req('GET', '/');
  assert.doesNotMatch(r.text, /data-show="price\.group" hidden/);
});

test('видео на главной: MP4, HEVC и обложка', async t => {
  const { base, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);
  const guest = client(base);

  let r = await admin.upload('/admin/api/media', Buffer.from('not a video at all'), 'video/mp4');
  assert.strictEqual(r.status, 400);

  r = await admin.upload('/admin/api/media', mp4('avc1'), 'video/mp4');
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.data.codec, 'avc');
  const vid = r.data.id;
  const poster = await admin.photo(JPEG_TALL);
  r = await admin.api('/admin/api/site/home.video', { media: vid, poster: poster.id });
  assert.strictEqual(r.status, 200);
  r = await guest.req('GET', '/');
  assert.match(r.text, new RegExp('data-src="media/' + vid + '\\.mp4" poster="media/' + poster.id + '-lg\\.jpg"'));

  const range = await fetch(base + '/media/' + vid + '.mp4', { headers: { range: 'bytes=0-15' } });
  assert.strictEqual(range.status, 206);
  assert.strictEqual(range.headers.get('content-type'), 'video/mp4');

  // Фото вместо видео поставить нельзя
  r = await admin.api('/admin/api/site/home.video', { media: poster.id });
  assert.strictEqual(r.status, 400);

  r = await admin.upload('/admin/api/media', mp4('hvc1'), 'video/quicktime');
  assert.strictEqual(r.data.codec, 'hevc');
  await admin.api('/admin/api/site/home.video', { media: r.data.id });
  r = await admin.req('GET', '/admin/site');
  assert.match(r.text, /формате HEVC/);
});

test('тематики: фото из админки видны на «Дизайнах» и у класса', async t => {
  const { app, base, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);
  const guest = client(base);
  const neon = app.store.listOptions().theme.find(o => o.key === 'neon');

  const m = await admin.photo(JPEG_WIDE);
  let r = await admin.api('/admin/api/o/' + neon.id + '/photos', { media: [m.id] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.count, 6);
  r = await guest.req('GET', '/designs.html');
  const neonCard = r.text.slice(r.text.indexOf('id="neon"'));
  assert.match(neonCard, new RegExp('href="media/' + m.id + '-lg\\.jpg" data-lb="neon"'));
  assert.match(neonCard, /style="--ar:1\.5"/);

  const id = await createClass(admin, 'Школа 1', '11А');
  r = await guest.req('GET', '/k/' + app.store.getClass(+id).slug);
  assert.match(r.text, new RegExp('/media/' + m.id + '-sm\\.jpg'));

  // Новое фото наверх, подпись, потом удалить
  r = await admin.post('/admin/o/' + neon.id + '/photos', { op: 'up:5', cap4: 'Подпись' });
  let photos = app.store.getOption(neon.id).photos;
  assert.strictEqual(photos[4].src, 'media/' + m.id);
  assert.strictEqual(photos[5].cap, 'Подпись');
  r = await admin.post('/admin/o/' + neon.id + '/photos', { op: 'del:4' });
  photos = app.store.getOption(neon.id).photos;
  assert.strictEqual(photos.length, 5);
  assert.ok(!photos.some(p => p.src === 'media/' + m.id));

  // Новая тематика появляется скрытой и без фото не показывается
  r = await admin.post('/admin/catalog/new', { step: 'theme', name: 'Retro Wave' });
  assert.strictEqual(r.status, 303);
  const retro = app.store.listOptions().theme.find(o => o.name === 'Retro Wave');
  assert.ok(retro && retro.hidden);
  assert.strictEqual(retro.key, 'retrowave');
  r = await guest.req('GET', '/designs.html');
  assert.doesNotMatch(r.text, /Retro Wave/);
  r = await admin.post('/admin/o/' + retro.id, { name: 'Retro Wave', tag: 'NEW', lead: '', about: '', loc: '' });
  assert.strictEqual(r.status, 400, 'без фото показать нельзя');
  await admin.api('/admin/api/o/' + retro.id + '/photos', { media: [m.id] });
  r = await admin.post('/admin/o/' + retro.id, { name: 'Retro Wave', tag: 'NEW', lead: 'Ретро', about: '', loc: '' });
  assert.strictEqual(r.status, 303);
  r = await guest.req('GET', '/designs.html');
  assert.match(r.text, /<a href="#retrowave" class="f-retrowave">Retro Wave<\/a>/);
  assert.match(r.text, /10 тематик на выбор/);

  // Второй с тем же названием получает другой ключ
  await admin.post('/admin/catalog/new', { step: 'theme', name: 'Retro Wave' });
  assert.ok(app.store.listOptions().theme.some(o => o.key === 'retrowave2'));
});

test('старт по расписанию', async t => {
  const { app, base, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);
  const id = await createClass(admin, 'Школа 7', '11В');
  const slug = app.store.getClass(+id).slug;
  const kid = client(base);
  await kid.req('GET', '/k/' + slug);

  let r = await admin.post('/admin/c/' + id + '/schedule', { at: toLocalInput(Date.now() - 60 * 60000), duration_min: '30' });
  assert.strictEqual(r.status, 400, 'в прошлое нельзя');

  const at = Date.now() + 2 * 60 * 60000;
  r = await admin.post('/admin/c/' + id + '/schedule', { at: toLocalInput(at), duration_min: '30' });
  assert.strictEqual(r.status, 303);
  const cls = app.store.getClass(+id);
  assert.ok(Math.abs(cls.opened_at - at) < 60000, 'время по Москве пересчитано правильно');
  assert.strictEqual(cls.ends_at - cls.opened_at, 30 * 60000);

  r = await kid.req('GET', '/k/' + slug + '/state');
  assert.strictEqual(r.data.status, 'draft');
  assert.strictEqual(r.data.opensAt, cls.opened_at);
  r = await kid.req('GET', '/k/' + slug);
  assert.match(r.text, /Голосование начнётся (сегодня|завтра) в/);
  assert.match(r.text, /до старта/);
  r = await kid.req('POST', '/k/' + slug + '/vote', { json: { step: 'theme', option: 'money' } });
  assert.strictEqual(r.status, 409);

  r = await admin.req('GET', '/admin');
  assert.match(r.text, /Запланировано/);

  // Время подошло
  app.store.updateClass(+id, { opened_at: Date.now() - 1000, ends_at: Date.now() + 30 * 60000 });
  r = await kid.req('POST', '/k/' + slug + '/vote', { json: { step: 'theme', option: 'money' } });
  assert.strictEqual(r.status, 200);

  // Отмена работает только до старта
  const id2 = await createClass(admin, 'Школа 7', '11Г');
  await admin.post('/admin/c/' + id2 + '/schedule', { at: toLocalInput(at), duration_min: '45' });
  r = await admin.post('/admin/c/' + id2 + '/schedule', { cancel: '1' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(app.store.getClass(+id2).opened_at, null);

  // «Начать сейчас» при запланированном старте открывает сразу
  await admin.post('/admin/c/' + id2 + '/schedule', { at: toLocalInput(at), duration_min: '45' });
  await admin.post('/admin/c/' + id2 + '/open', { duration_min: '45' });
  const c2 = app.store.getClass(+id2);
  assert.ok(c2.opened_at <= Date.now() && c2.ends_at > Date.now());
});

test('кто на странице и итог для чата', async t => {
  const { app, base, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);
  const id = await createClass(admin, 'Гимназия 4', '11 «А»');
  const slug = app.store.getClass(+id).slug;
  await admin.post('/admin/c/' + id + '/open', { duration_min: '30' });
  const a = client(base), b = client(base);
  await a.req('GET', '/k/' + slug);
  await b.req('GET', '/k/' + slug);
  let r = await admin.req('GET', '/admin/c/' + id + '/results');
  assert.match(r.text, /Сейчас на странице: <b>2<\/b>/);

  await a.req('POST', '/k/' + slug + '/vote', { json: { step: 'theme', option: 'money' } });
  await a.req('POST', '/k/' + slug + '/vote', { json: { step: 'wear', option: 'casual' } });
  await a.req('POST', '/k/' + slug + '/vote', { json: { step: 'color', option: 'red' } });
  await admin.post('/admin/c/' + id + '/close');
  r = await admin.req('GET', '/admin/c/' + id);
  assert.match(r.text, /Итоги голосования · 11 «А», Гимназия 4/);
  assert.match(r.text, /Тематика: NEW MONEY/);
  assert.match(r.text, /Цвет одежды: тёмно-красный, бордовый, кирпичный \+ чёрный и белый/);
  assert.match(r.text, new RegExp('/k/' + slug));

  // Кнопка копирования ссылки есть прямо в списке классов
  r = await admin.req('GET', '/admin');
  assert.match(r.text, new RegExp('data-copy="http://127\\.0\\.0\\.1:\\d+/k/' + slug + '"'));
});

test('ненужные файлы удаляются, нужные остаются', async t => {
  const { app, base, dataDir, stop } = await start();
  t.after(stop);
  const admin = await adminLogin(base);
  const used = await admin.photo(JPEG_WIDE);
  const lost = await admin.photo(JPEG_WIDE);
  const fresh = await admin.photo(JPEG_WIDE);
  await admin.api('/admin/api/site/arthur', { media: used.id });
  // Два файла «старые», третий только что загружен
  app.store.db.prepare('UPDATE media SET created_at = ? WHERE id IN (?, ?)').run(Date.now() - 2 * 86400000, used.id, lost.id);
  const removed = app.media.gc();
  assert.strictEqual(removed, 1);
  assert.ok(app.store.getMedia(used.id));
  assert.ok(app.store.getMedia(fresh.id));
  assert.strictEqual(app.store.getMedia(lost.id), null);
  assert.ok(!fs.existsSync(path.join(dataDir, 'media', lost.id + '-lg.jpg')));
  assert.ok(fs.existsSync(path.join(dataDir, 'media', used.id + '-lg.jpg')));

  // Фото в тематиках тоже считаются используемыми
  const neon = app.store.listOptions().theme.find(o => o.key === 'neon');
  const cat = await admin.photo(JPEG_WIDE);
  await admin.api('/admin/api/o/' + neon.id + '/photos', { media: [cat.id] });
  app.store.db.prepare('UPDATE media SET created_at = ? WHERE id = ?').run(Date.now() - 2 * 86400000, cat.id);
  app.media.gc();
  assert.ok(app.store.getMedia(cat.id));
});
