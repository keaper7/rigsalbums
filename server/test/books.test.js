'use strict';

// Листающиеся альбомы на «Работах»: четыре с главной сразу в списке, новый загружается файлами
// для типографии, порядок, цвет края, удаление

const test = require('node:test');
const assert = require('node:assert');
const { start, client, adminLogin, JPEG_WIDE } = require('./helpers');

test('альбомы на «Работах»: загрузка, страница, порядок, удаление', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  const csrf = { 'x-csrf-token': admin.csrf };
  // сразу четыре альбома с главной
  let r = await client(s.base).req('GET', '/works.html');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /id="albums"/);
  assert.strictEqual((r.text.match(/data-bk-album/g) || []).length, 4);
  assert.match(r.text, /data-base="assets\/book1\/"/);
  // загрузка нового: без обложки нельзя
  r = await admin.req('POST', '/admin/api/books/start', { json: { spreads: 2, covers: [] }, headers: csrf });
  assert.strictEqual(r.status, 400);
  r = await admin.req('POST', '/admin/api/books/start', { json: { spreads: 2, covers: [1], title: 'AMERICAN VIBE' }, headers: csrf });
  assert.strictEqual(r.status, 200, r.text);
  const { id, ver } = r.data;
  for (const n of ['c001', 'b001', 's01-l', 's01-r', 's02-l', 's02-r']) for (const sfx of ['', '-sm']) {
    r = await admin.upload('/admin/api/media/book/' + id + '/' + ver + '?name=' + n + sfx, JPEG_WIDE);
    assert.strictEqual(r.status, 200, n + sfx + ' ' + r.text);
  }
  r = await admin.upload('/admin/api/media/book/' + id + '/' + ver + '?name=s03-l', JPEG_WIDE);
  assert.strictEqual(r.status, 400, 'лишний разворот не принимается');
  r = await admin.req('POST', '/admin/api/books/finish', { json: { id, ver }, headers: csrf });
  assert.strictEqual(r.status, 200, r.text);
  // на странице пятым, картинки отдаются надолго
  r = await client(s.base).req('GET', '/works.html');
  assert.strictEqual((r.text.match(/data-bk-album/g) || []).length, 5);
  assert.match(r.text, new RegExp('data-base="/books/' + id + '/v' + ver + '/"[^>]*aria-label="AMERICAN VIBE"'));
  r = await client(s.base).req('GET', '/books/' + id + '/v' + ver + '/front-sm.jpg');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('cache-control'), /immutable/);
  r = await client(s.base).req('GET', '/books/' + id + '/v' + ver + '/nope.jpg');
  assert.strictEqual(r.status, 404);
  // наверх списка — открывается первым
  for (let i = 0; i < 4; i++) await admin.post('/admin/books/' + id + '/up', {});
  r = await client(s.base).req('GET', '/works.html');
  assert.match(r.text, new RegExp('<div class="bk" data-book data-base="/books/' + id + '/'));
  // цвет края
  await admin.post('/admin/books/' + id + '/update', { title: 'AV', board: '#112233', spine: 'red' });
  const b = s.app.store.db.prepare('SELECT * FROM site_books WHERE id = ?').get(id);
  assert.strictEqual(b.board, '#112233');
  assert.strictEqual(b.spine, '#2A1D17', 'не цвет — не принимаем');
  // страница админки
  r = await admin.req('GET', '/admin/books');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /data-mode="book"/);
  // удалить все — блок со страницы пропадает
  for (const x of s.app.store.db.prepare('SELECT id FROM site_books').all()) await admin.post('/admin/books/' + x.id + '/delete', {});
  r = await client(s.base).req('GET', '/works.html');
  assert.doesNotMatch(r.text, /id="albums"/);
  // без входа в админку загрузить нельзя
  r = await client(s.base).req('POST', '/admin/api/books/start', { json: { spreads: 1, covers: [1] } });
  assert.notStrictEqual(r.status, 200);
});
