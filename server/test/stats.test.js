'use strict';

// Своя статистика: просмотры, источники, блоки страниц, кнопки, онлайн, ссылки для постов

const test = require('node:test');
const assert = require('node:assert');
const { start, client, adminLogin, createClass } = require('./helpers');
const { source, device } = require('../lib/stats');

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const UA_INSTA = UA_IPHONE + ' Instagram 300.0';
const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function visitor(base, ua) {
  const c = client(base);
  const vid = require('crypto').randomBytes(12).toString('hex');
  c.view = async (p, extra) => {
    const r = await c.req('POST', '/s/v', { json: Object.assign({ p: p, q: '', r: '', v: vid, w: 390 }, extra || {}), headers: { 'user-agent': ua || UA_IPHONE } });
    assert.strictEqual(r.status, 200, r.text);
    return r.data;
  };
  return c;
}

test('откуда пришли и с чего зашли — разбор', () => {
  assert.strictEqual(source('https://l.instagram.com/?u=x', UA_IPHONE, 'rigsarthur.ru'), 'instagram');
  assert.strictEqual(source('', UA_INSTA, 'rigsarthur.ru'), 'instagram');
  assert.strictEqual(source('https://yandex.ru/search/?text=альбом', UA_MAC, 'rigsarthur.ru'), 'yandex');
  assert.strictEqual(source('https://www.google.com/', UA_MAC, 'rigsarthur.ru'), 'google');
  assert.strictEqual(source('https://rigsarthur.ru/works.html', UA_MAC, 'rigsarthur.ru'), 'internal');
  assert.strictEqual(source('https://vk.com/feed', UA_MAC, 'rigsarthur.ru'), 'vk');
  assert.strictEqual(source('https://t.me/somechat', UA_MAC, 'rigsarthur.ru'), 'telegram');
  assert.strictEqual(source('https://example.com/', UA_MAC, 'rigsarthur.ru'), 'site');
  assert.strictEqual(source('', UA_MAC, 'rigsarthur.ru'), 'direct');
  assert.strictEqual(device(UA_IPHONE, 390), 'mobile');
  assert.strictEqual(device(UA_MAC, 1440), 'desktop');
});

test('страницы сайта подключают счётчик, у блоков есть названия', async t => {
  const s = await start();
  t.after(() => s.stop());
  const c = client(s.base);
  for (const p of ['/', '/works.html', '/designs.html', '/studio.html', '/albums.html', '/contacts.html']) {
    const r = await c.req('GET', p);
    assert.strictEqual(r.status, 200, p);
    assert.match(r.text, /assets\/st\.js/, p);
    // блоки размечает сам счётчик, вёрстка не меняется
    assert.doesNotMatch(r.text, /data-st="/, p);
  }
  const js = await c.req('GET', '/assets/st.js');
  assert.strictEqual(js.status, 200);
});

test('просмотр, блоки, кнопки, онлайн, отчёт; Артура и подделки не считаем', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);

  // Артур в админке — не считается
  let r = await admin.req('POST', '/s/v', { json: { p: '/', v: 'a'.repeat(24) } });
  assert.strictEqual(r.data.id, 0);
  // незнакомая страница — тоже
  const a = visitor(s.base, UA_INSTA);
  assert.strictEqual((await a.view('/nope.html')).id, 0);

  // первый человек: пришёл из инсты на главную, долистал до цен, нажал WhatsApp
  const v1 = await a.view('/');
  assert.ok(v1.id && v1.k);
  r = await a.req('POST', '/s/u', { json: { id: v1.id, k: v1.k, d: 42000, dp: 80, s: { 'Первый экран': 9000, 'Цены': 21000 }, r: ['Первый экран', 'Видео «вживую»', 'Цены'] } });
  assert.strictEqual(r.status, 200);
  r = await a.req('POST', '/s/c', { json: { id: v1.id, k: v1.k, kind: 'whatsapp', label: 'WhatsApp', at: 'Цены' } });
  assert.strictEqual(r.status, 200);
  // повторное нажатие той же кнопки в том же просмотре не задваиваем
  await a.req('POST', '/s/c', { json: { id: v1.id, k: v1.k, kind: 'whatsapp', label: 'WhatsApp', at: 'Цены' } });
  // чужой ключ не подходит, странный тип кнопки не принимается
  r = await a.req('POST', '/s/u', { json: { id: v1.id, k: 'x'.repeat(16), d: 1 } });
  assert.strictEqual(r.status, 400);
  await a.req('POST', '/s/c', { json: { id: v1.id, k: v1.k, kind: 'hack', label: 'x' } });
  // тот же человек перешёл на «Работы» — это не новый источник
  const v2 = await a.view('/works.html', { r: s.base + '/' });

  // второй человек: с компьютера напрямую, дизайны, открыл фото тематики
  const b = visitor(s.base, UA_MAC);
  const v3 = await b.view('/designs.html');
  await b.req('POST', '/s/u', { json: { id: v3.id, k: v3.k, d: 60000, dp: 50, s: { 'Тематика CLASSIC': 20000 }, r: ['Тематика CLASSIC'] } });
  await b.req('POST', '/s/c', { json: { id: v3.id, k: v3.k, kind: 'design', label: 'CLASSIC' } });

  // голосование класса тоже видно онлайн
  const cid = await createClass(admin, 'Лицей', '11 «А»');
  const slug = s.app.store.getClass(+cid).slug;
  const c = visitor(s.base, UA_IPHONE);
  await c.view('/k/' + slug);

  r = await admin.req('GET', '/admin/api/stats/online');
  assert.strictEqual(r.data.total, 4);
  assert.strictEqual(r.data.vote, 1);
  assert.match(r.data.classes[0].name, /11 «А» Лицей/);
  // ушёл со страницы — пропал из онлайна
  await a.req('POST', '/s/u', { json: { id: v2.id, k: v2.k, d: 3000, e: true } });
  r = await admin.req('GET', '/admin/api/stats/online');
  assert.strictEqual(r.data.total, 3);

  const rep = s.app.stats.report('2000-01-01', '2100-01-01');
  assert.strictEqual(rep.visitors, 3);
  assert.strictEqual(rep.siteVisitors, 2);
  assert.strictEqual(rep.contacts, 1);
  assert.deepStrictEqual(rep.sources.map(x => x.key).sort(), ['direct', 'instagram'].sort());
  // источник считается по людям: из инсты один, напрямую двое (с компьютера и на голосование)
  assert.strictEqual(rep.sources.find(x => x.key === 'instagram').n, 1);
  assert.strictEqual(rep.sources.find(x => x.key === 'direct').n, 2);
  const home = rep.blocks['index.html'].list;
  assert.strictEqual(home['Цены'].reached, 1);
  assert.strictEqual(home['Цены'].ms, 21000);
  assert.strictEqual(rep.buttons.find(x => x.kind === 'whatsapp').n, 1);
  assert.strictEqual(rep.buttons.some(x => x.kind === 'hack'), false);
  assert.strictEqual(rep.themes[0].name, 'CLASSIC');
  assert.strictEqual(rep.themes[0].opens, 1);
  assert.strictEqual(rep.classes[0].vote, 1);

  // страница статистики
  r = await admin.req('GET', '/admin/stats?period=30');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Откуда пришли/);
  assert.match(r.text, /Instagram/);
  assert.match(r.text, /Где задерживаются/);
  assert.match(r.text, /Цены/);
  assert.match(r.text, /CLASSIC/);
  r = await admin.req('GET', '/admin/stats?period=today&page=designs.html');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Сегодня по часам/);
});

test('ссылки для постов: создать, переход по ссылке считается за ней, удалить', async t => {
  const s = await start();
  t.after(() => s.stop());
  const admin = await adminLogin(s.base);
  let r = await admin.post('/admin/stats/link', { name: 'Сторис 16 октября', page: 'designs.html' });
  assert.strictEqual(r.status, 303);
  r = await admin.post('/admin/stats/link', { name: 'Сторис 16 октября', page: 'index.html' });
  const links = s.app.stats.links();
  assert.strictEqual(links.length, 2);
  assert.notStrictEqual(links[0].slug, links[1].slug);
  r = await admin.post('/admin/stats/link', { name: '' });
  assert.strictEqual(r.status, 400);
  const slug = links.find(l => l.page === 'designs.html').slug;
  // переход по ссылке и «написать» уже на другой странице
  const v = visitor(s.base, UA_INSTA);
  const a = await v.view('/designs.html', { q: '?s=' + slug });
  const b = await v.view('/contacts.html', { r: s.base + '/designs.html' });
  await v.req('POST', '/s/c', { json: { id: b.id, k: b.k, kind: 'whatsapp', label: 'WhatsApp' } });
  // несуществующая метка не считается
  await visitor(s.base).view('/', { q: '?s=nope' });
  const rep = s.app.stats.report('2000-01-01', '2100-01-01');
  assert.deepStrictEqual(rep.links[slug], { visitors: 1, contacts: 1 });
  assert.ok(a.id);
  r = await admin.req('GET', '/admin/stats');
  assert.match(r.text, new RegExp('/designs\\.html\\?s=' + slug));
  assert.match(r.text, /написали 1/);
  await admin.post('/admin/stats/link/' + slug + '/delete', {});
  assert.strictEqual(s.app.stats.links().length, 1);
});
