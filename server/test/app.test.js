'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { nextTitle } = require('../app');
const { PASS, start: boot, client, adminLogin, createClass } = require('./helpers');

// Старые тесты ждут { app, server, base }, сервер закрываем вместе с временной папкой
async function start() {
  const s = await boot();
  s.server.close = s.stop;
  return s;
}

test('варианты названия при дублировании', () => {
  assert.strictEqual(nextTitle('11 «Б»'), '11 «В»');
  assert.strictEqual(nextTitle('11А'), '11Б');
  assert.strictEqual(nextTitle('выпуск'), '11 «Б»');
});

test('полный сценарий голосования', async t => {
  const { app, server, base } = await start();
  t.after(() => server.close());

  // Без входа админка недоступна
  const anon = client(base);
  let r = await anon.req('GET', '/admin');
  assert.strictEqual(r.status, 302);
  r = await anon.req('POST', '/admin/login', { form: { password: 'wrong' } });
  assert.strictEqual(r.status, 401);

  const admin = await adminLogin(base);
  const id = await createClass(admin, 'Лицей №2', '11 «Б»');
  const cls = app.store.getClass(+id);
  assert.match(cls.slug, /^11-b-licey-2-[a-z0-9]{3}$/);
  assert.strictEqual(cls.school, 'Лицей №2');

  // Без CSRF-токена действия не проходят
  r = await admin.req('POST', '/admin/c/' + id + '/open', { form: { duration_min: '30' } });
  assert.strictEqual(r.status, 403);

  // До старта: страница открывается, голосовать нельзя
  const kid1 = client(base);
  r = await kid1.req('GET', '/k/' + cls.slug);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Голосование ещё не началось/);
  assert.match(r.text, /Лицей №2/);
  assert.ok(kid1.jar.rv, 'выдана cookie голосующего');
  r = await kid1.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'money' } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.data.error, 'closed');

  // Старт
  r = await admin.post('/admin/c/' + id + '/open', { duration_min: '30' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(app.store.getClass(+id).duration_min, 30);

  r = await kid1.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'money' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.state.counts.theme.money, 1);
  assert.strictEqual(r.data.state.mine.theme, 'money');

  // Повторный голос с той же cookie не проходит
  r = await kid1.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'neon' } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.data.error, 'already');
  assert.strictEqual(r.data.state.counts.theme.money, 1);
  assert.strictEqual(r.data.state.counts.theme.neon, 0);

  // Передумал: снимает голос и голосует заново
  r = await kid1.req('POST', '/k/' + cls.slug + '/unvote', { json: { step: 'theme' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.state.counts.theme.money, 0);
  assert.strictEqual(r.data.state.mine.theme, undefined);
  r = await kid1.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'neon' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.state.counts.theme.neon, 1);
  r = await kid1.req('POST', '/k/' + cls.slug + '/unvote', { json: { step: 'theme' } });
  r = await kid1.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'money' } });
  assert.strictEqual(r.data.state.counts.theme.money, 1);
  assert.strictEqual(r.data.state.counts.theme.neon, 0);
  r = await kid1.req('POST', '/k/' + cls.slug + '/unvote', { json: { step: 'nope' } });
  assert.strictEqual(r.status, 400);

  // Несуществующий вариант, голос формой, голос без cookie
  r = await kid1.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'nope' } });
  assert.strictEqual(r.status, 400);
  r = await kid1.req('POST', '/k/' + cls.slug + '/vote', { form: { step: 'wear', option: 'casual' } });
  assert.strictEqual(r.status, 415);
  const nocookie = client(base);
  r = await nocookie.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'money' } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.data.error, 'cookies');

  // Второй ученик: ничья по тематике
  const kid2 = client(base);
  await kid2.req('GET', '/k/' + cls.slug);
  r = await kid2.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'neon' } });
  assert.strictEqual(r.status, 200);
  await kid2.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'wear', option: 'casual' } });
  await kid2.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'color', option: 'red' } });
  await kid2.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'place', option: 'studio' } });

  r = await kid2.req('GET', '/k/' + cls.slug + '/state');
  assert.strictEqual(r.data.status, 'open');
  assert.strictEqual(r.data.voters, 2);

  // Продление
  const endsBefore = app.store.getClass(+id).ends_at;
  await admin.post('/admin/c/' + id + '/extend', { min: '10' });
  assert.strictEqual(app.store.getClass(+id).ends_at, endsBefore + 10 * 60000);

  // Закрытие: ничья ждёт решения
  await admin.post('/admin/c/' + id + '/close');
  r = await kid1.req('GET', '/k/' + cls.slug + '/state');
  assert.strictEqual(r.data.status, 'closed');
  assert.strictEqual(r.data.pending, true);
  r = await kid1.req('GET', '/k/' + cls.slug);
  assert.match(r.text, /Ничья: NEON и NEW MONEY|Ничья: NEW MONEY и NEON/);
  assert.doesNotMatch(r.text, /class="voting"/);
  r = await kid2.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'money' } });
  assert.strictEqual(r.status, 409);
  // После закрытия голос уже не снять
  r = await kid2.req('POST', '/k/' + cls.slug + '/unvote', { json: { step: 'theme' } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.data.state.counts.theme.neon, 1);

  r = await admin.req('GET', '/admin');
  assert.match(r.text, /Нужно выбрать победителя/);

  // Артур выбирает победителя
  await admin.post('/admin/c/' + id + '/pick', { step: 'theme', option: 'neon' });
  r = await kid1.req('GET', '/k/' + cls.slug + '/state');
  assert.strictEqual(r.data.pending, false);
  r = await kid1.req('GET', '/k/' + cls.slug);
  assert.match(r.text, /Выбор класса/);
  assert.match(r.text, /t--neon/);
  assert.doesNotMatch(r.text, /t--money/);
  assert.match(r.text, /Повседневка, в цвете: тёмно-красный, бордовый, кирпичный \+ чёрный и белый/);
  assert.match(r.text, /Сообщу в чате класса/);

  // Шпаргалка
  await admin.post('/admin/c/' + id + '/cheat', { shoot: 'Суббота, 15:00', address: 'ул. Ленина, 1', bring: 'Расчёску <script>', note: '' });
  r = await kid1.req('GET', '/k/' + cls.slug);
  assert.match(r.text, /Суббота, 15:00/);
  assert.match(r.text, /Расчёску &lt;script&gt;/);

  // Страница класса в админке
  r = await admin.req('GET', '/admin/c/' + id);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Выбрано вручную/);

  // Дублирование: те же настройки, без голосов, черновик
  r = await admin.post('/admin/c/' + id + '/duplicate', { school: 'Лицей №2', title: '11 «В»' });
  const copyId = /\/admin\/c\/(\d+)/.exec(r.headers.get('location'))[1];
  const copy = app.store.getClass(+copyId);
  assert.strictEqual(copy.title, '11 «В»');
  assert.strictEqual(copy.address, 'ул. Ленина, 1');
  assert.strictEqual(copy.duration_min, 30);
  assert.strictEqual(copy.opened_at, null);
  assert.notStrictEqual(copy.slug, cls.slug);
  assert.strictEqual(app.store.voters(+copyId), 0);

  // Скрытые для класса варианты не видны и за них нельзя голосовать
  const on = [];
  const cat = app.store.listOptions();
  ['theme', 'place', 'wear', 'color'].forEach(s => cat[s].forEach(o => { if (!(s === 'theme' && o.key === 'neon')) on.push(s + ':' + o.key); }));
  const form = new URLSearchParams({ _csrf: admin.csrf });
  on.forEach(v => form.append('on', v));
  r = await admin.req('POST', '/admin/c/' + copyId + '/options', { form: form });
  assert.strictEqual(r.status, 303);
  assert.deepStrictEqual(app.store.getClass(+copyId).hidden, ['theme:neon']);
  await admin.post('/admin/c/' + copyId + '/open', { duration_min: '15' });
  const kid3 = client(base);
  r = await kid3.req('GET', '/k/' + copy.slug);
  assert.doesNotMatch(r.text, /t--neon/);
  assert.match(r.text, /8 вариантов/);
  r = await kid3.req('POST', '/k/' + copy.slug + '/vote', { json: { step: 'theme', option: 'neon' } });
  assert.strictEqual(r.status, 400);

  // Заново открыть закрытое голосование: ручной выбор сбрасывается
  await admin.post('/admin/c/' + id + '/open', { duration_min: '15' });
  const again = app.store.getClass(+id);
  assert.deepStrictEqual(again.picks, {});
  assert.strictEqual(again.closed_at, null);

  // Смена адреса страницы
  r = await admin.post('/admin/c/' + id + '/info', { school: 'Лицей №2', title: '11 «Б»', year: '2026', duration_min: '30', slug: 'admin' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/c/' + id + '/info', { school: 'Лицей №2', title: '11 «Б»', year: '2026', duration_min: '30', slug: copy.slug });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/c/' + id + '/info', { school: 'Лицей №2', title: '11 «Б»', year: '2026', duration_min: '30', slug: 'licey2-11b' });
  assert.strictEqual(r.status, 303);
  r = await kid1.req('GET', '/k/licey2-11b');
  assert.strictEqual(r.status, 200);
  r = await kid1.req('GET', '/k/' + cls.slug);
  assert.strictEqual(r.status, 404);

  // Сброс и удаление
  await admin.post('/admin/c/' + id + '/reset');
  assert.strictEqual(app.store.voters(+id), 0);
  await admin.post('/admin/c/' + id + '/delete');
  assert.strictEqual(app.store.getClass(+id), null);
});

test('время вышло: голосование закрывается само', async t => {
  const { app, server, base } = await start();
  t.after(() => server.close());
  const admin = await adminLogin(base);
  const id = await createClass(admin, 'Школа 5', '11А');
  await admin.post('/admin/c/' + id + '/open', { duration_min: '30' });
  const cls = app.store.getClass(+id);
  const kid = client(base);
  await kid.req('GET', '/k/' + cls.slug);
  await kid.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'theme', option: 'grey' } });
  // Переводим часы голосования в прошлое
  app.store.updateClass(+id, { ends_at: Date.now() - 1000 });
  const r = await kid.req('GET', '/k/' + cls.slug + '/state');
  assert.strictEqual(r.data.status, 'closed');
  // По тематике один голос, по одежде и цвету голосов нет: ждём решения
  assert.strictEqual(r.data.pending, true);
  const page = await kid.req('GET', '/k/' + cls.slug);
  assert.match(page.text, /t--grey/);
  assert.match(page.text, /Голосов не было/);
});

test('каталог: правка и порядок', async t => {
  const { app, server, base } = await start();
  t.after(() => server.close());
  const admin = await adminLogin(base);
  const neon = app.store.listOptions().theme.find(o => o.key === 'neon');
  let r = await admin.post('/admin/o/' + neon.id, {
    name: 'NEON 2', tag: 'NEW', lead: 'Смело', about: 'Первый абзац.\n\nВторой\nабзац.', loc: 'студия', covers: '2'
  });
  assert.strictEqual(r.status, 303);
  let upd = app.store.getOption(neon.id);
  assert.strictEqual(upd.name, 'NEON 2');
  assert.deepStrictEqual(upd.about, ['Первый абзац.', 'Второй абзац.']);
  assert.strictEqual(upd.photos.length, 5);

  // Подписи к фото сохраняются в своей форме
  const caps = { op: 'save' };
  upd.photos.forEach((p, i) => { caps['cap' + i] = i === 0 ? 'Обложка' : ''; });
  r = await admin.post('/admin/o/' + neon.id + '/photos', caps);
  assert.strictEqual(r.status, 303);
  upd = app.store.getOption(neon.id);
  assert.strictEqual(upd.photos[0].cap, 'Обложка');
  assert.strictEqual(upd.photos[1].cap, undefined);

  r = await admin.post('/admin/o/' + neon.id + '/move', { dir: '-1' });
  const order = app.store.listOptions().theme.map(o => o.key);
  assert.strictEqual(order.indexOf('neon'), order.length - 2);

  const bw = app.store.listOptions().color.find(o => o.key === 'bw');
  r = await admin.post('/admin/o/' + bw.id, { name: 'Ч/Б', count: '2', c0: '#000000', c1: '#ffffff', c2: '#123456', plus: '1', hidden: '1' });
  assert.strictEqual(r.status, 303);
  const c = app.store.getOption(bw.id);
  assert.deepStrictEqual(c.colors, ['#000000', '#FFFFFF']);
  assert.strictEqual(c.hidden, true);
  r = await admin.post('/admin/o/' + bw.id, { name: 'Ч/Б', count: '1', c0: 'red' });
  assert.strictEqual(r.status, 400);
});

test('настройки и пароль', async t => {
  const { app, server, base } = await start();
  t.after(() => server.close());
  const admin = await adminLogin(base);
  await admin.post('/admin/settings', { year: '2027', duration_min: '60', shoot: 'Суббота, 11:00', address: 'Студия, Нальчик', bring: 'Хорошее настроение', note: 'Не опаздываем' });
  const id = await createClass(admin, 'Гимназия 1', '11 «А»');
  // Адрес и «что взять» общие: у класса пусто, а на его странице общий текст
  const c = app.store.getClass(+id);
  assert.strictEqual(c.address, '');
  await admin.post('/admin/c/' + id + '/open', { duration_min: '30' });
  await admin.post('/admin/c/' + id + '/close');
  const kid = client(base);
  let r = await kid.req('GET', '/k/' + c.slug);
  assert.match(r.text, /Студия, Нальчик/);
  assert.match(r.text, /Хорошее настроение/);
  assert.match(r.text, /Суббота, 11:00/);
  assert.match(r.text, /Не опаздываем/);
  assert.ok(r.text.indexOf('class="cheat"') < r.text.indexOf('data-slot="theme"'), 'шпаргалка выше выбора класса');
  // Поменяли общий текст: меняется у всех классов, свой текст у класса важнее
  await admin.post('/admin/settings', { year: '2027', duration_min: '60', address: 'Новый адрес', bring: 'Хорошее настроение' });
  r = await kid.req('GET', '/k/' + c.slug);
  assert.match(r.text, /Новый адрес/);
  await admin.post('/admin/c/' + id + '/cheat', { shoot: '', address: 'Школьный двор', bring: '', note: '' });
  r = await kid.req('GET', '/k/' + c.slug);
  assert.match(r.text, /Школьный двор/);
  assert.doesNotMatch(r.text, /Новый адрес/);
  // Старый класс, куда общий текст был скопирован раньше, начинает следовать общему
  app.store.updateClass(+id, { address: 'Новый адрес' });
  await admin.post('/admin/settings', { year: '2027', duration_min: '60', address: 'Третий адрес', bring: 'Хорошее настроение' });
  assert.strictEqual(app.store.getClass(+id).address, '');

  r = await admin.post('/admin/password', { current: 'bad', next: 'new-password-2', repeat: 'new-password-2' });
  assert.strictEqual(r.status, 400);
  r = await admin.post('/admin/password', { current: PASS, next: 'new-password-2', repeat: 'new-password-2' });
  assert.strictEqual(r.status, 303);
  const fresh = client(base);
  r = await fresh.req('POST', '/admin/login', { form: { password: PASS } });
  assert.strictEqual(r.status, 401);
  r = await fresh.req('POST', '/admin/login', { form: { password: 'new-password-2' } });
  assert.strictEqual(r.status, 303);
});

test('статика: файлы сайта отдаются, служебные нет', async t => {
  const { server, base } = await start();
  t.after(() => server.close());
  const c = client(base);
  let r = await c.req('GET', '/');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /RIGSARTHUR/);
  r = await c.req('GET', '/assets/klass/klass.css');
  assert.strictEqual(r.status, 200);
  for (const p of ['/server/app.js', '/server/data/rigs.db', '/.git/config', '/%2e%2e/etc/passwd', '/assets/../server/app.js', '/.gitignore']) {
    r = await c.req('GET', p);
    assert.strictEqual(r.status, 404, p);
  }
  r = await c.req('GET', '/k/nope');
  assert.strictEqual(r.status, 404);
  assert.match(r.text, /<base href="\/">/);
  const range = await fetch(base + '/assets/og.jpg', { headers: { range: 'bytes=0-99' } });
  assert.strictEqual(range.status, 206);
  assert.strictEqual((await range.arrayBuffer()).byteLength, 100);
  r = await c.req('GET', '/admin/static/admin.css');
  assert.strictEqual(r.status, 200);
});

test('перебор пароля ограничен', async t => {
  const { server, base } = await start();
  t.after(() => server.close());
  const c = client(base);
  let last;
  for (let i = 0; i < 9; i++) last = await c.req('POST', '/admin/login', { form: { password: 'x' + i } });
  assert.strictEqual(last.status, 429);
  last = await c.req('POST', '/admin/login', { form: { password: PASS } });
  assert.strictEqual(last.status, 429);
});

test('место для групповых: голосование, ссылка на галерею, старые классы без нового этапа', async t => {
  const { app, server, base } = await start();
  t.after(() => server.close());
  const admin = await adminLogin(base);
  const id = await createClass(admin, 'Школа 5', '11 «Г»');
  const cls = app.store.getClass(+id);
  await admin.post('/admin/c/' + id + '/open', { duration_min: '30' });
  const kid = client(base);
  let r = await kid.req('GET', '/k/' + cls.slug);
  assert.match(r.text, /Место для групповых/);
  assert.match(r.text, /id="p-nature"/);
  assert.match(r.text, /href="\/works\.html#school"/);
  assert.match(r.text, /Этап 2 из 4/);
  r = await kid.req('POST', '/k/' + cls.slug + '/vote', { json: { step: 'place', option: 'school' } });
  assert.strictEqual(r.status, 200);
  await admin.post('/admin/c/' + id + '/close');
  r = await kid.req('GET', '/k/' + cls.slug);
  assert.match(r.text, /Школа\. Точное место обсудим в чате/);

  // Миграция: у базы без этапа place классы, уже начавшие голосовать, его не получают
  const os = require('os');
  const path = require('path');
  const { Store } = require('../lib/db');
  const file = path.join(os.tmpdir(), 'rigs-mig-' + Date.now() + '.db');
  let s = new Store(file);
  s.db.exec("DELETE FROM options WHERE step = 'place'");
  s.setSetting('steps', ['theme', 'wear', 'color']);
  const started = s.createClass({ slug: 'a', school: 'Ш', title: '11 А', year: 2027, duration_min: 60 });
  const draft = s.createClass({ slug: 'b', school: 'Ш', title: '11 Б', year: 2027, duration_min: 60 });
  s.updateClass(started, { opened_at: Date.now() - 1000 });
  s.close();
  s = new Store(file);
  assert.strictEqual(s.listOptions().place.length, 3);
  assert.deepStrictEqual(s.getClass(started).hidden, ['place:nature', 'place:school', 'place:studio']);
  assert.deepStrictEqual(s.getClass(draft).hidden, []);
  s.close();
  s = new Store(file);
  assert.strictEqual(s.listOptions().place.length, 3, 'второй раз не добавляется');
  s.close();
});

test('весь класс с одного адреса (школьный Wi‑Fi): голоса проходят у всех, флуд одного ученика отсекается', async t => {
  const { app, server, base } = await start();
  t.after(() => server.close());
  const admin = await adminLogin(base);
  const id = await createClass(admin, 'Школа №5', '11 «А»');
  const slug = app.store.getClass(+id).slug;
  await admin.post('/admin/c/' + id + '/open', { duration_min: '30' });
  // 3 класса по 35 человек одновременно, каждый — все этапы, а каждый пятый ещё и переголосовывает
  const kids = Array.from({ length: 105 }, () => client(base));
  await Promise.all(kids.map(k => k.req('GET', '/k/' + slug)));
  const results = await Promise.all(kids.map(async (k, i) => {
    const out = [];
    for (const [step, option] of [['theme', 'money'], ['wear', 'casual'], ['color', 'bw']]) {
      out.push((await k.req('POST', '/k/' + slug + '/vote', { json: { step, option } })).status);
    }
    if (i % 5 === 0) {
      out.push((await k.req('POST', '/k/' + slug + '/unvote', { json: { step: 'theme' } })).status);
      out.push((await k.req('POST', '/k/' + slug + '/vote', { json: { step: 'theme', option: 'neon' } })).status);
    }
    return out;
  }));
  assert.ok(results.every(r => r.every(s => s === 200)), 'никому не отказано');
  const c = app.store.counts(+id);
  assert.strictEqual(c.theme.money + c.theme.neon, 105);
  assert.strictEqual(app.store.voters(+id), 105);
  // Один ученик, который жмёт без остановки, упирается в ограничение, остальные — нет
  const spam = kids[1];
  let busy = 0;
  for (let i = 0; i < 70; i++) {
    const r = await spam.req('POST', '/k/' + slug + '/unvote', { json: { step: 'color' } });
    if (r.status === 429) busy++;
  }
  assert.ok(busy > 0, 'флуд ограничен');
  const r = await kids[2].req('POST', '/k/' + slug + '/unvote', { json: { step: 'color' } });
  assert.strictEqual(r.status, 200);
});
