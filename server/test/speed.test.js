'use strict';

// Админка на слабом интернете: файлы с версией в адресе хранятся в телефоне, помощник /admin/sw.js,
// при выходе сохранённое стирается

const test = require('node:test');
const assert = require('node:assert');
const { start, client, adminLogin } = require('./helpers');

test('файлы админки с версией кешируются надолго, без версии — проверяются', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  let r = await admin.req('GET', '/admin/work');
  const css = /href="(\/admin\/static\/admin\.css\?v=[0-9a-f]{10})"/.exec(r.text);
  assert.ok(css, 'у стилей версия в адресе');
  assert.match(r.text, /src="\/admin\/static\/admin\.js\?v=[0-9a-f]{10}"/);
  assert.match(r.text, /href="\/admin\/static\/fonts\.css\?v=[0-9a-f]{10}"/);
  r = await client(s.base).req('GET', css[1]);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('cache-control'), /max-age=31536000, immutable/);
  r = await client(s.base).req('GET', '/admin/static/admin.css');
  assert.strictEqual(r.headers.get('cache-control'), 'no-cache');
  // шрифты сайта под адресом админки: пути к файлам шрифтов от корня
  r = await client(s.base).req('GET', '/admin/static/fonts.css?v=1');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /url\(\/assets\/fonts\/[\w-]+\.woff2\)/);
  assert.doesNotMatch(r.text, /url\((?!\/assets\/fonts\/)/);
});

test('помощник админки открыт без входа, разрешён на весь /admin; выход стирает сохранённое', async t => {
  const s = await start();
  t.after(() => s.stop());
  let r = await client(s.base).req('GET', '/admin/sw.js');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.strictEqual(r.headers.get('service-worker-allowed'), '/admin');
  assert.strictEqual(r.headers.get('cache-control'), 'no-cache');
  assert.match(r.text, /rigs-pages-v1/);
  const admin = await adminLogin(s.base);
  r = await admin.post('/admin/logout', {});
  assert.strictEqual(r.status, 303);
  assert.strictEqual(r.headers.get('clear-site-data'), '"cache", "storage"');
});
