'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { Store, STEPS } = require('./lib/db');
const { Auth, Limiter, SESSION_TTL } = require('./lib/auth');
const H = require('./lib/http');
const { slugify, randomCode, token, fromLocalInput, plural } = require('./lib/util');
const V = require('./lib/voting');
const { Media, FILE_RE, ID_RE } = require('./lib/media');
const { Site, SLOTS, GALLERIES, TEXTS, TOGGLES, PAGES } = require('./lib/site');
const klassView = require('./views/klass');
const A = require('./views/admin');

const RESERVED = ['admin', 'assets', 'state', 'vote', 'react', 'new', 'media'];
const VOTER_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const YEAR = 365 * 24 * 60 * 60 * 1000;
const ONLINE = 40 * 1000;
const DRAIN_MAX = 64 * 1024 * 1024;

function defaultsFor(store) {
  const d = store.getSetting('defaults', {}) || {};
  const now = new Date();
  // Учебный год: с сентября уже следующий выпуск
  const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
  return {
    year: d.year || year,
    duration_min: d.duration_min || 45,
    address: d.address || '',
    bring: d.bring || ''
  };
}

function str(v, max) {
  if (Array.isArray(v)) v = v[0];
  return String(v === undefined || v === null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max || 200);
}

function int(v, min, max, def) {
  const n = parseInt(Array.isArray(v) ? v[0] : v, 10);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// 11 «Б» → 11 «В», чтобы при дублировании подсказать следующий класс
function nextTitle(t) {
  const abc = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ';
  const m = /([А-Я])(?!.*[А-Я])/.exec(t || '');
  if (!m) return '11 «Б»';
  const i = abc.indexOf(m[1]);
  if (i === -1 || i === abc.length - 1) return t;
  return t.slice(0, m.index) + abc[i + 1] + t.slice(m.index + 1);
}

// Итог голосования одним сообщением для чата класса
function resultText(cls, res, voters, url) {
  const lines = ['Итоги голосования · ' + cls.title + ', ' + cls.school];
  if (res.theme && res.theme.option) lines.push('Тематика: ' + res.theme.option.name);
  if (res.wear && res.wear.option) lines.push('Стиль одежды: ' + res.wear.option.name);
  if (res.color && res.color.option) {
    lines.push('Цвет одежды: ' + res.color.option.name.toLowerCase() + (res.color.option.plus ? ' + чёрный и белый' : ''));
  }
  if (voters) lines.push('Проголосовали ' + voters + ' ' + plural(voters, 'человек', 'человека', 'человек') + '.');
  lines.push('', 'Вся информация и шпаргалка к съёмке: ' + url);
  return lines.join('\n');
}

function createApp(cfg) {
  cfg = Object.assign({
    dataDir: path.join(__dirname, 'data'),
    siteRoot: path.join(__dirname, '..'),
    siteUrl: '',
    trustProxy: false,
    cookieSecure: false,
    adminPassword: ''
  }, cfg || {});

  const store = new Store(cfg.dbFile || path.join(cfg.dataDir, 'rigs.db'));
  const auth = new Auth(store);
  if (!auth.hasPassword() && cfg.adminPassword) auth.setPassword(cfg.adminPassword);
  const voteLimit = new Limiter(300, 10 * 60 * 1000);
  const publicDir = path.join(__dirname, 'public');
  const siteRoot = path.resolve(cfg.siteRoot);
  const media = new Media(store, cfg.mediaDir || path.join(cfg.dataDir, 'media'));
  const site = new Site(siteRoot, store);
  const presence = new Map();
  const r = new H.Router();

  const catalog = () => store.listOptions();

  // Уборка неиспользуемых файлов: при запуске и после правок, не чаще раза в минуту
  let gcTimer = null;
  function changed() {
    site.touch();
    if (gcTimer) return;
    gcTimer = setTimeout(() => { gcTimer = null; try { media.gc(); } catch (e) { console.error(e); } }, 60 * 1000);
    if (gcTimer.unref) gcTimer.unref();
  }
  try { media.gc(); } catch (e) { console.error(e); }

  function baseUrl(ctx) {
    if (cfg.siteUrl) return cfg.siteUrl.replace(/\/+$/, '');
    const host = ctx.req.headers.host || 'localhost';
    return (ctx.secure ? 'https' : 'http') + '://' + host;
  }

  function cookieOpts(ctx, maxAge) {
    return { maxAge: maxAge / 1000, secure: ctx.secure, httpOnly: true, sameSite: 'Lax' };
  }

  function page(ctx, status, body) {
    H.send(ctx.res, status, body, 'text/html; charset=utf-8', {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    });
  }

  function back(ctx, where, msg) {
    const hash = where.indexOf('#');
    const base = hash === -1 ? where : where.slice(0, hash);
    const tail = hash === -1 ? '' : where.slice(hash);
    H.redirect(ctx.res, base + (msg ? (base.indexOf('?') === -1 ? '?' : '&') + 'm=' + msg : '') + tail);
  }

  function notFound(ctx) {
    if (ctx.url.pathname.indexOf('/admin') === 0 && ctx.sess) return page(ctx, 404, A.notFoundPage(ctx));
    let body = 'Страница не найдена';
    try {
      body = fs.readFileSync(path.join(siteRoot, '404.html'), 'utf8').replace('<head>', '<head>\n<base href="/">');
    } catch (e) {}
    H.send(ctx.res, 404, body, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  // ---------- кто сейчас на странице класса ----------

  function seen(classId, voter) {
    if (!voter) return;
    let m = presence.get(classId);
    if (!m) { m = new Map(); presence.set(classId, m); }
    m.set(voter, Date.now());
  }

  function online(classId) {
    const m = presence.get(classId);
    if (!m) return 0;
    const now = Date.now();
    let n = 0;
    m.forEach((t, v) => { if (now - t < ONLINE) n++; else m.delete(v); });
    return n;
  }

  // ---------- страница класса ----------

  function voterOf(ctx) {
    const v = ctx.cookies.rv;
    return v && VOTER_RE.test(v) ? v : null;
  }

  r.get('/k/:slug', ctx => {
    const cls = store.getClassBySlug(ctx.params.slug);
    if (!cls) return notFound(ctx);
    let voter = voterOf(ctx);
    if (!voter) {
      voter = token(18);
      H.setCookie(ctx.res, 'rv', voter, cookieOpts(ctx, YEAR));
    }
    seen(cls.id, voter);
    const cat = catalog();
    const opts = V.visibleOptions(cat, cls);
    const state = V.publicState(store, cat, cls, voter);
    const st = state.status;
    const result = st === 'closed' ? V.resolve(cls, opts, store.counts(cls.id)) : null;
    const nonce = crypto.randomBytes(12).toString('base64');
    const url = baseUrl(ctx) + '/k/' + cls.slug;
    const body = klassView.classPage({
      cls: cls, opts: opts, status: st, state: state, result: result, base: '/', demo: false, nonce: nonce,
      meta: {
        title: cls.title + ' · Выбор альбома · RIGSARTHUR',
        ogTitle: 'Выбор альбома · ' + cls.title + ', ' + cls.school,
        image: baseUrl(ctx) + '/assets/og-class.jpg',
        url: url
      },
      config: {
        api: '/k/' + encodeURIComponent(cls.slug),
        steps: V.activeSteps(opts),
        state: state,
        reaction: store.myReaction(cls.id, voter)
      }
    });
    H.send(ctx.res, 200, body, 'text/html; charset=utf-8', {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-" + nonce + "'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
  });

  r.get('/k/:slug/state', ctx => {
    const cls = store.getClassBySlug(ctx.params.slug);
    if (!cls) return H.json(ctx.res, 404, { error: 'not_found' });
    const voter = voterOf(ctx);
    seen(cls.id, voter);
    H.json(ctx.res, 200, V.publicState(store, catalog(), cls, voter));
  });

  r.post('/k/:slug/vote', ctx => {
    const cls = store.getClassBySlug(ctx.params.slug);
    if (!cls) return H.json(ctx.res, 404, { error: 'not_found' });
    const voter = voterOf(ctx);
    if (!voter) return H.json(ctx.res, 400, { error: 'cookies' });
    if (!voteLimit.hit(ctx.ip)) return H.json(ctx.res, 429, { error: 'busy' });
    const cat = catalog();
    const opts = V.visibleOptions(cat, cls);
    const b = ctx.body || {};
    const step = String(b.step || '');
    const option = String(b.option || '');
    if (V.activeSteps(opts).indexOf(step) === -1 || !opts[step].some(o => o.key === option)) {
      return H.json(ctx.res, 400, { error: 'bad_option' });
    }
    if (V.status(cls) !== 'open') return H.json(ctx.res, 409, { error: 'closed', state: V.publicState(store, cat, cls, voter) });
    const ok = store.addVote(cls.id, voter, step, option);
    const state = V.publicState(store, cat, cls, voter);
    if (!ok) return H.json(ctx.res, 409, { error: 'already', state: state });
    H.json(ctx.res, 200, { ok: true, state: state });
  });

  r.post('/k/:slug/react', ctx => {
    const cls = store.getClassBySlug(ctx.params.slug);
    if (!cls) return H.json(ctx.res, 404, { error: 'not_found' });
    const voter = voterOf(ctx);
    const value = String((ctx.body || {}).value || '');
    if (!voter || ['wow', 'love', 'ok', 'bad'].indexOf(value) === -1) return H.json(ctx.res, 400, { error: 'bad' });
    if (!voteLimit.hit(ctx.ip)) return H.json(ctx.res, 429, { error: 'busy' });
    store.setReaction(cls.id, voter, value);
    H.json(ctx.res, 200, { ok: true });
  });

  // ---------- загруженные файлы ----------

  r.get('/media/:file', ctx => {
    const m = FILE_RE.exec(ctx.params.file);
    if (!m || !store.getMedia(m[1])) return notFound(ctx);
    // Имя файла уникальное и не меняется, поэтому кэшируем надолго
    if (!H.serveStatic(media.dir, ctx.req, ctx.res, '/' + ctx.params.file, [], { cache: 'public, max-age=31536000, immutable' })) notFound(ctx);
  });

  // ---------- вход в админку ----------

  r.get('/admin/static/:file', ctx => {
    if (!H.serveStatic(publicDir, ctx.req, ctx.res, '/' + ctx.params.file, [])) notFound(ctx);
  });

  r.get('/admin/login', ctx => {
    if (ctx.sess) return H.redirect(ctx.res, '/admin');
    page(ctx, 200, A.loginPage({ noPassword: !auth.hasPassword(), msg: ctx.url.searchParams.get('m') }));
  });

  r.post('/admin/login', ctx => {
    if (!auth.hasPassword()) return H.redirect(ctx.res, '/admin/login');
    if (auth.logins.blocked(ctx.ip)) {
      return page(ctx, 429, A.loginPage({ err: 'Слишком много попыток. Подождите 15 минут' }));
    }
    const pw = str(ctx.form.password, 200);
    if (!pw || !auth.check(pw)) {
      auth.logins.hit(ctx.ip);
      return page(ctx, 401, A.loginPage({ err: 'Неверный пароль' }));
    }
    auth.logins.reset(ctx.ip);
    H.setCookie(ctx.res, 'rs', auth.login(), cookieOpts(ctx, SESSION_TTL));
    H.redirect(ctx.res, '/admin');
  });

  r.post('/admin/logout', ctx => {
    auth.logout(ctx.cookies.rs);
    H.setCookie(ctx.res, 'rs', '', cookieOpts(ctx, 0));
    back(ctx, '/admin/login', 'bye');
  });

  // ---------- классы ----------

  function withPending(list) {
    const cat = catalog();
    const now = Date.now();
    return list.map(c => {
      if (V.status(c, now) === 'closed') {
        c.pending = V.isPending(V.resolve(c, V.visibleOptions(cat, c), store.counts(c.id)));
      }
      return c;
    });
  }

  r.get('/admin', ctx => {
    page(ctx, 200, A.classesPage({ sess: ctx.sess, msg: ctx.q('m'), classes: withPending(store.listClasses()), base: baseUrl(ctx) }));
  });

  // Классы, с которых можно взять настройки: свежие сверху, архив не нужен
  function templates() {
    return store.listClasses().filter(c => !c.archived);
  }

  function newView(ctx, extra) {
    const from = parseInt(ctx.q('from') || (extra && extra.form && extra.form.from) || '', 10) || 0;
    const src = from ? store.getClass(from) : null;
    return A.newClassPage(Object.assign({
      sess: ctx.sess, defaults: defaultsFor(store), classes: templates(), from: src ? src.id : 0,
      nextTitle: src ? nextTitle(src.title) : ''
    }, extra || {}, src && !(extra && extra.form) ? { form: { school: src.school, year: src.year, duration_min: src.duration_min } } : {}));
  }

  r.get('/admin/new', ctx => {
    page(ctx, 200, newView(ctx));
  });

  function newSlug(school, title) {
    const base = slugify(title + ' ' + school) || 'klass';
    for (let i = 0; i < 20; i++) {
      const s = base.slice(0, 32) + '-' + randomCode(3);
      if (!store.slugTaken(s)) return s;
    }
    return base.slice(0, 20) + '-' + randomCode(8);
  }

  // «11А, 11Б, 11В» — сразу несколько классов одной параллели
  function splitTitles(v) {
    const seen = {};
    return String(v || '').split(/[,;\n]/).map(t => t.trim().slice(0, 40)).filter(t => {
      if (!t || seen[t.toLowerCase()]) return false;
      seen[t.toLowerCase()] = true;
      return true;
    });
  }

  function createFrom(src, school, title, year, duration) {
    const d = defaultsFor(store);
    const base = { slug: newSlug(school, title), school: school, title: title, year: year, duration_min: duration };
    return store.createClass(Object.assign(base, src
      ? { hidden: src.hidden, shoot: src.shoot, address: src.address, bring: src.bring, note: src.note }
      : { address: d.address, bring: d.bring }));
  }

  r.post('/admin/new', ctx => {
    const f = ctx.form;
    const d = defaultsFor(store);
    const school = str(f.school, 60);
    const titles = splitTitles(f.title);
    const from = parseInt(f.from, 10) || 0;
    const src = from ? store.getClass(from) : null;
    const fail = err => page(ctx, 400, newView(ctx, { form: f, err: err }));
    if (!school || !titles.length) return fail('Заполните школу и класс');
    if (titles.length > 10) return fail('За раз можно создать до 10 классов');
    if (from && !src) return fail('Класс, с которого брали настройки, уже удалён. Выберите другой');
    const year = int(f.year, 2020, 2100, src ? src.year : d.year);
    const duration = int(f.duration_min, 5, 600, src ? src.duration_min : d.duration_min);
    const ids = titles.map(t => createFrom(src, school, t, year, duration));
    if (ids.length === 1) return back(ctx, '/admin/c/' + ids[0], src ? 'copied' : 'created');
    back(ctx, '/admin', 'createdmany');
  });

  function loadClass(ctx) {
    const id = parseInt(ctx.params.id, 10);
    return id ? store.getClass(id) : null;
  }

  function resultsData(ctx, cls) {
    const cat = catalog();
    const counts = store.counts(cls.id);
    const voters = store.voters(cls.id);
    const res = V.resolve(cls, V.visibleOptions(cat, cls), counts);
    const url = baseUrl(ctx) + '/k/' + cls.slug;
    return {
      sess: ctx.sess, cls: cls, catalog: cat, counts: counts, voters: voters,
      reactions: store.reactionCounts(cls.id), online: online(cls.id),
      summary: V.status(cls) === 'closed' && !V.isPending(res) ? resultText(cls, res, voters, url) : ''
    };
  }

  function classView(ctx, cls, extra) {
    return A.classPage(Object.assign(resultsData(ctx, cls), {
      msg: ctx.q('m'),
      url: baseUrl(ctx) + '/k/' + cls.slug,
      nextTitle: nextTitle(cls.title)
    }, extra || {}));
  }

  r.get('/admin/c/:id', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    page(ctx, 200, classView(ctx, cls));
  });

  r.get('/admin/c/:id/results', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    const body = A.resultsBlock(resultsData(ctx, cls)).s;
    H.send(ctx.res, 200, body, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Status': V.status(cls) });
  });

  // Действия с классом: все POST, все с проверкой CSRF (см. handle)
  function act(name, fn) {
    r.post('/admin/c/:id/' + name, ctx => {
      const cls = loadClass(ctx);
      if (!cls) return notFound(ctx);
      return fn(ctx, cls);
    });
  }

  act('open', (ctx, cls) => {
    const now = Date.now();
    const st = V.status(cls, now);
    if (st === 'open') return back(ctx, '/admin/c/' + cls.id);
    const min = int(ctx.form.duration_min, 1, 600, cls.duration_min);
    const f = { opened_at: st === 'draft' ? now : cls.opened_at, ends_at: now + min * 60000, closed_at: null };
    if (st === 'draft') f.duration_min = min;
    else f.picks = {};
    store.updateClass(cls.id, f);
    back(ctx, '/admin/c/' + cls.id, st === 'draft' ? 'opened' : 'reopened');
  });

  // Старт по расписанию: до этого времени страница работает как «не начато»
  act('schedule', (ctx, cls) => {
    const now = Date.now();
    if (V.status(cls, now) !== 'draft') return back(ctx, '/admin/c/' + cls.id);
    if (ctx.form.cancel === '1') {
      store.updateClass(cls.id, { opened_at: null, ends_at: null, closed_at: null });
      return back(ctx, '/admin/c/' + cls.id, 'unscheduled');
    }
    const at = fromLocalInput(str(ctx.form.at, 30));
    const min = int(ctx.form.duration_min, 1, 600, cls.duration_min);
    if (!at || at < now + 30 * 1000) return page(ctx, 400, classView(ctx, cls, { err: 'Время старта должно быть в будущем' }));
    if (at > now + 60 * 24 * 60 * 60 * 1000) return page(ctx, 400, classView(ctx, cls, { err: 'Запланировать можно не дальше чем на два месяца вперёд' }));
    store.updateClass(cls.id, { opened_at: at, ends_at: at + min * 60000, closed_at: null, duration_min: min });
    back(ctx, '/admin/c/' + cls.id, 'scheduled');
  });

  act('close', (ctx, cls) => {
    if (V.status(cls) === 'open') store.updateClass(cls.id, { closed_at: Date.now() });
    back(ctx, '/admin/c/' + cls.id, 'closed');
  });

  act('extend', (ctx, cls) => {
    if (V.status(cls) !== 'open') return back(ctx, '/admin/c/' + cls.id);
    const min = int(ctx.form.min, 1, 240, 10);
    store.updateClass(cls.id, { ends_at: cls.ends_at + min * 60000 });
    back(ctx, '/admin/c/' + cls.id, 'extended');
  });

  act('pick', (ctx, cls) => {
    if (V.status(cls) !== 'closed') return back(ctx, '/admin/c/' + cls.id);
    const step = str(ctx.form.step, 20);
    const option = str(ctx.form.option, 60);
    const opts = V.visibleOptions(catalog(), cls);
    if (STEPS.indexOf(step) === -1) return back(ctx, '/admin/c/' + cls.id);
    const picks = Object.assign({}, cls.picks);
    if (!option) delete picks[step];
    else if (opts[step].some(o => o.key === option)) picks[step] = option;
    else return back(ctx, '/admin/c/' + cls.id);
    store.updateClass(cls.id, { picks: picks });
    back(ctx, '/admin/c/' + cls.id + '#results', option ? 'picked' : 'unpicked');
  });

  act('cheat', (ctx, cls) => {
    const f = ctx.form;
    store.updateClass(cls.id, { shoot: str(f.shoot, 120), address: str(f.address, 160), bring: str(f.bring, 600), note: str(f.note, 600) });
    back(ctx, '/admin/c/' + cls.id + '#cheat', 'saved');
  });

  act('options', (ctx, cls) => {
    const on = [].concat(ctx.form.on || []);
    const cat = catalog();
    const hidden = [];
    let empty = false;
    STEPS.forEach(step => {
      const visible = cat[step].filter(o => !o.hidden);
      let kept = 0;
      visible.forEach(o => {
        const k = step + ':' + o.key;
        if (on.indexOf(k) === -1) hidden.push(k); else kept++;
      });
      if (visible.length && !kept) empty = true;
    });
    if (empty) return page(ctx, 400, classView(ctx, cls, { err: 'В каждом этапе должен остаться хотя бы один вариант' }));
    store.updateClass(cls.id, { hidden: hidden });
    back(ctx, '/admin/c/' + cls.id + '#options', 'saved');
  });

  act('info', (ctx, cls) => {
    const f = ctx.form;
    const school = str(f.school, 60);
    const title = str(f.title, 40);
    const slug = str(f.slug, 60).toLowerCase();
    let err = '';
    if (!school || !title) err = 'Заполните школу и класс';
    else if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug) || slug.length < 3) err = 'Адрес страницы: от 3 символов, латиница, цифры и дефис';
    else if (RESERVED.indexOf(slug) !== -1 || store.slugTaken(slug, cls.id)) err = 'Такой адрес уже занят, придумайте другой';
    if (err) return page(ctx, 400, classView(ctx, cls, { err: err }));
    const f2 = {
      school: school, title: title, slug: slug,
      year: int(f.year, 2020, 2100, cls.year), duration_min: int(f.duration_min, 1, 600, cls.duration_min)
    };
    // Если старт запланирован, конец двигаем вместе с новой длительностью
    if (V.opensAt(cls)) f2.ends_at = cls.opened_at + f2.duration_min * 60000;
    store.updateClass(cls.id, f2);
    back(ctx, '/admin/c/' + cls.id + '#info', 'saved');
  });

  act('duplicate', (ctx, cls) => {
    const school = str(ctx.form.school, 60) || cls.school;
    const title = str(ctx.form.title, 40);
    if (!title) return page(ctx, 400, classView(ctx, cls, { err: 'Напишите, для какого класса копия' }));
    const id = createFrom(cls, school, title, cls.year, cls.duration_min);
    back(ctx, '/admin/c/' + id, 'copied');
  });

  act('archive', (ctx, cls) => {
    const on = ctx.form.on === '1';
    store.updateClass(cls.id, { archived: on ? 1 : 0 });
    back(ctx, on ? '/admin' : '/admin/c/' + cls.id, on ? 'archived' : 'unarchived');
  });

  act('reset', (ctx, cls) => {
    store.resetVotes(cls.id);
    store.updateClass(cls.id, { picks: {} });
    back(ctx, '/admin/c/' + cls.id, 'reset');
  });

  act('delete', (ctx, cls) => {
    store.deleteClass(cls.id);
    presence.delete(cls.id);
    back(ctx, '/admin', 'deleted');
  });

  // ---------- загрузка файлов из админки ----------
  // Фото уже ужаты в браузере: сначала большая версия, потом маленькая

  r.post('/admin/api/media', async ctx => {
    const type = String(ctx.req.headers['content-type'] || '');
    if (type.indexOf('image/jpeg') === 0) return H.json(ctx.res, 200, await media.saveImage(ctx.req));
    if (type.indexOf('video/') === 0) return H.json(ctx.res, 200, await media.saveVideo(ctx.req));
    ctx.req.resume();
    H.json(ctx.res, 415, { error: 'Нужно фото JPEG или видео MP4/MOV' });
  }, { raw: true });

  r.post('/admin/api/media/:id/sm', async ctx => {
    if (!ID_RE.test(ctx.params.id)) { ctx.req.resume(); return H.json(ctx.res, 404, { error: 'Фото не найдено' }); }
    H.json(ctx.res, 200, await media.saveSmall(ctx.params.id, ctx.req));
  }, { raw: true });

  // ---------- сайт: фото, видео, галереи, цены ----------

  function siteView(ctx, extra) {
    const vals = site.values();
    return A.sitePage(Object.assign({
      sess: ctx.sess, msg: ctx.q('m'), defaults: site.defaults(), values: vals,
      galleries: Object.keys(GALLERIES).reduce((o, k) => { o[k] = site.gallery(k); return o; }, {}),
      texts: Object.keys(TEXTS).reduce((o, k) => { o[k] = site.text(k); return o; }, {}),
      toggles: Object.keys(TOGGLES).reduce((o, k) => { o[k] = site.shown(k); return o; }, {}),
      videoNote: vals['home.video'] && vals['home.video'].media ? (store.getMedia(vals['home.video'].media) || {}).note : ''
    }, extra || {}));
  }

  r.get('/admin/site', ctx => page(ctx, 200, siteView(ctx)));

  r.post('/admin/site/texts', ctx => {
    const f = ctx.form;
    Object.keys(TEXTS).forEach(k => {
      const v = str(f[k], TEXTS[k].max).replace(/\s+/g, ' ');
      if (v) store.setSite(k, v);
      else store.deleteSite(k);
    });
    Object.keys(TOGGLES).forEach(k => {
      if (f[k] === '1') store.deleteSite(k);
      else store.setSite(k, false);
    });
    changed();
    back(ctx, '/admin/site#prices', 'saved');
  });

  // Поставить загруженное фото или видео на место
  r.post('/admin/api/site/:key', ctx => {
    const key = ctx.params.key;
    const def = SLOTS[key];
    const b = ctx.body || {};
    if (!def) return H.json(ctx.res, 404, { error: 'Нет такого места на сайте' });
    let value;
    if (def.type === 'video') {
      const v = media.video(String(b.media || ''));
      if (!v) return H.json(ctx.res, 400, { error: 'Видео не найдено, загрузите ещё раз' });
      const poster = b.poster ? media.image(String(b.poster)) : null;
      value = { media: v.media, video: v.video, poster: poster ? poster.lg : null, posterMedia: poster ? poster.media : null };
    } else {
      value = media.image(String(b.media || ''));
      if (!value) return H.json(ctx.res, 400, { error: 'Фото не найдено, загрузите ещё раз' });
    }
    store.setSite(key, value);
    changed();
    H.json(ctx.res, 200, { ok: true });
  });

  r.post('/admin/site/reset/:key', ctx => {
    const key = ctx.params.key;
    if (!SLOTS[key] && !GALLERIES[key]) return notFound(ctx);
    store.deleteSite(key);
    changed();
    back(ctx, GALLERIES[key] ? '/admin/site/g/' + key : '/admin/site#' + key, 'restored');
  });

  r.get('/admin/site/g/:key', ctx => {
    const key = ctx.params.key;
    if (!GALLERIES[key]) return notFound(ctx);
    page(ctx, 200, A.galleryPage({ sess: ctx.sess, msg: ctx.q('m'), errCode: ctx.q('e'), key: key, def: GALLERIES[key], gallery: site.gallery(key) }));
  });

  // Новые фото в галерею: в начало списка
  r.post('/admin/api/site/g/:key', ctx => {
    const key = ctx.params.key;
    const def = GALLERIES[key];
    if (!def) return H.json(ctx.res, 404, { error: 'Нет такой галереи' });
    const ids = [].concat((ctx.body || {}).media || []).map(String).slice(0, 100);
    const add = ids.map(id => media.image(id)).filter(Boolean);
    if (!add.length) return H.json(ctx.res, 400, { error: 'Фото не найдены, загрузите ещё раз' });
    const items = add.concat(site.gallery(key).items);
    if (items.length > def.max) return H.json(ctx.res, 400, { error: 'Здесь можно не больше ' + def.max + ' фото. Сначала уберите лишние' });
    store.setSite(key, items);
    changed();
    H.json(ctx.res, 200, { ok: true, count: items.length });
  });

  r.post('/admin/site/g/:key', ctx => {
    const key = ctx.params.key;
    if (!GALLERIES[key]) return notFound(ctx);
    const items = site.gallery(key).items;
    const op = /^(up|down|first|del):(\d+)$/.exec(str(ctx.form.op, 20));
    if (op) {
      const i = +op[2];
      if (i >= 0 && i < items.length) {
        if (op[1] === 'del') {
          if (items.length <= 1) return back(ctx, '/admin/site/g/' + key + '?e=last');
          items.splice(i, 1);
        } else {
          const j = op[1] === 'up' ? i - 1 : op[1] === 'down' ? i + 1 : 0;
          if (j >= 0 && j < items.length && j !== i) {
            const it = items.splice(i, 1)[0];
            items.splice(j, 0, it);
          }
        }
        store.setSite(key, items);
        changed();
      }
    }
    back(ctx, '/admin/site/g/' + key + '#g' + (op ? op[2] : ''), op && op[1] === 'del' ? 'removed' : '');
  });

  // ---------- каталог ----------

  r.get('/admin/catalog', ctx => {
    page(ctx, 200, A.catalogPage({ sess: ctx.sess, msg: ctx.q('m'), errCode: ctx.q('e'), catalog: catalog() }));
  });

  // Новый вариант появляется скрытым: сначала фото и тексты, потом показать
  r.post('/admin/catalog/new', ctx => {
    const step = str(ctx.form.step, 10);
    const name = str(ctx.form.name, step === 'color' ? 80 : 40);
    if (STEPS.indexOf(step) === -1) return back(ctx, '/admin/catalog');
    if (!name) return back(ctx, '/admin/catalog?e=name');
    let key = slugify(name).replace(/-/g, '').slice(0, 20) || step;
    let k = key, n = 2;
    while (store.optionKeyTaken(step, k)) k = key + n++;
    const data = step === 'theme' ? { name: name, tag: 'NEW', lead: '', about: [], loc: '', covers: 1, photos: [] }
      : step === 'wear' ? { name: name, sub: '', pin: '', photos: [] }
        : { name: name, colors: ['#D8C3A5'], plus: true };
    const id = store.addOption(step, k, data, true);
    changed();
    back(ctx, '/admin/o/' + id, 'optcreated');
  });

  function loadOption(ctx) {
    const id = parseInt(ctx.params.id, 10);
    return id ? store.getOption(id) : null;
  }

  r.get('/admin/o/:id', ctx => {
    const o = loadOption(ctx);
    if (!o) return notFound(ctx);
    page(ctx, 200, A.optionPage({ sess: ctx.sess, msg: ctx.q('m'), errCode: ctx.q('e'), option: o }));
  });

  r.post('/admin/o/:id', ctx => {
    const o = loadOption(ctx);
    if (!o) return notFound(ctx);
    const f = ctx.form;
    const data = Object.assign({}, o);
    const fail = err => page(ctx, 400, A.optionPage({ sess: ctx.sess, option: o, err: err }));
    data.name = str(f.name, o.step === 'color' ? 80 : 40);
    if (!data.name) return fail('Название не может быть пустым');
    if (o.step === 'theme') {
      data.tag = str(f.tag, 30);
      data.lead = str(f.lead, 400);
      data.about = str(f.about, 2000).split(/\n\s*\n/).map(s => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
      data.loc = str(f.loc, 80);
      data.covers = f.covers === '2' ? 2 : 1;
    } else if (o.step === 'wear') {
      data.sub = str(f.sub, 80);
      const pin = str(f.pin, 300);
      if (pin && !/^https?:\/\/\S+$/.test(pin)) return fail('Ссылка на Pinterest должна начинаться с https://');
      data.pin = pin;
    } else {
      const n = int(f.count, 1, 4, (o.colors || []).length || 1);
      const colors = [];
      for (let i = 0; i < n; i++) {
        const c = str(f['c' + i], 7);
        if (!HEX_RE.test(c)) return fail('Цвет указан неверно');
        colors.push(c.toUpperCase());
      }
      data.colors = colors;
      data.plus = f.plus === '1';
    }
    const hide = f.hidden === '1';
    if (hide && !o.hidden) {
      const left = catalog()[o.step].filter(x => !x.hidden && x.id !== o.id);
      if (!left.length) return fail('Нельзя скрыть последний вариант этапа');
    }
    if (!hide && o.step !== 'color' && !(o.photos || []).length) return fail('Сначала добавьте хотя бы одно фото, потом вариант можно показать');
    store.updateOption(o.id, data, hide);
    changed();
    back(ctx, '/admin/o/' + o.id, 'saved');
  });

  // Фото варианта: подписи, порядок, удаление одной формой
  r.post('/admin/o/:id/photos', ctx => {
    const o = loadOption(ctx);
    if (!o || o.step === 'color') return notFound(ctx);
    const f = ctx.form;
    const photos = (o.photos || []).map((p, i) => {
      const np = Object.assign({}, p);
      if (o.step === 'theme' && ('cap' + i) in f) {
        const cap = str(f['cap' + i], 60);
        if (cap) np.cap = cap; else delete np.cap;
      }
      return np;
    });
    const op = /^(up|down|del):(\d+)$/.exec(str(f.op, 20));
    if (op) {
      const i = +op[2];
      if (i >= 0 && i < photos.length) {
        if (op[1] === 'del') {
          if (photos.length <= 1 && !o.hidden) return back(ctx, '/admin/o/' + o.id + '?e=lastphoto#photos');
          photos.splice(i, 1);
        } else {
          const j = op[1] === 'up' ? i - 1 : i + 1;
          if (j >= 0 && j < photos.length) { const t = photos[i]; photos[i] = photos[j]; photos[j] = t; }
        }
      }
    }
    store.updateOption(o.id, Object.assign({}, o, { photos: photos }), o.hidden);
    changed();
    back(ctx, '/admin/o/' + o.id + '#photos', op && op[1] === 'del' ? 'removed' : 'saved');
  });

  r.post('/admin/api/o/:id/photos', ctx => {
    const o = loadOption(ctx);
    if (!o || o.step === 'color') return H.json(ctx.res, 404, { error: 'Вариант не найден' });
    const ids = [].concat((ctx.body || {}).media || []).map(String).slice(0, 50);
    const add = ids.map(id => media.image(id)).filter(Boolean)
      .map(m => ({ src: 'media/' + m.media, ar: Math.round(m.w / m.h * 10000) / 10000 }));
    if (!add.length) return H.json(ctx.res, 400, { error: 'Фото не найдены, загрузите ещё раз' });
    const photos = (o.photos || []).concat(add);
    if (photos.length > 20) return H.json(ctx.res, 400, { error: 'У варианта может быть не больше 20 фото' });
    store.updateOption(o.id, Object.assign({}, o, { photos: photos }), o.hidden);
    changed();
    H.json(ctx.res, 200, { ok: true, count: photos.length });
  });

  // Вариант, который уже выбирали классы, не стираем, а прячем: иначе сломаются их итоги
  r.post('/admin/o/:id/delete', ctx => {
    const o = loadOption(ctx);
    if (!o) return notFound(ctx);
    if (!o.hidden && !catalog()[o.step].some(x => !x.hidden && x.id !== o.id)) return back(ctx, '/admin/catalog?e=lastopt');
    if (store.optionUsage(o.step, o.key)) {
      store.updateOption(o.id, o, true);
      changed();
      return back(ctx, '/admin/catalog', 'opthidden');
    }
    store.deleteOption(o.id);
    changed();
    back(ctx, '/admin/catalog', 'optdeleted');
  });

  r.post('/admin/o/:id/move', ctx => {
    const o = loadOption(ctx);
    if (!o) return notFound(ctx);
    store.moveOption(o.id, ctx.form.dir === '-1' ? -1 : 1);
    changed();
    back(ctx, '/admin/catalog');
  });

  // ---------- настройки ----------

  r.get('/admin/settings', ctx => {
    page(ctx, 200, A.settingsPage({ sess: ctx.sess, msg: ctx.q('m'), defaults: defaultsFor(store) }));
  });

  r.post('/admin/settings', ctx => {
    const f = ctx.form;
    const d = defaultsFor(store);
    store.setSetting('defaults', {
      year: int(f.year, 2020, 2100, d.year),
      duration_min: int(f.duration_min, 1, 600, d.duration_min),
      address: str(f.address, 160),
      bring: str(f.bring, 600)
    });
    back(ctx, '/admin/settings', 'saved');
  });

  r.post('/admin/password', ctx => {
    const f = ctx.form;
    const fail = err => page(ctx, 400, A.settingsPage({ sess: ctx.sess, defaults: defaultsFor(store), err: err }));
    if (auth.logins.blocked(ctx.ip)) return fail('Слишком много попыток. Подождите 15 минут');
    if (!auth.check(str(f.current, 200))) { auth.logins.hit(ctx.ip); return fail('Текущий пароль неверный'); }
    const next = str(f.next, 200);
    if (next.length < 8) return fail('Новый пароль: минимум 8 символов');
    if (next !== str(f.repeat, 200)) return fail('Пароли не совпадают');
    auth.setPassword(next);
    H.setCookie(ctx.res, 'rs', auth.login(), cookieOpts(ctx, SESSION_TTL));
    back(ctx, '/admin/settings', 'password');
  });

  // ---------- страницы сайта с правками из админки ----------

  function sitePage(ctx, file) {
    let pg;
    try { pg = site.render(file, catalog()); } catch (e) { return false; }
    const headers = { 'Cache-Control': 'no-cache', 'ETag': pg.etag };
    if (ctx.req.headers['if-none-match'] === pg.etag) {
      ctx.res.writeHead(304, headers);
      ctx.res.end();
      return true;
    }
    H.send(ctx.res, 200, pg.text, 'text/html; charset=utf-8', headers);
    return true;
  }

  // ---------- обработчик запросов ----------

  const OPEN_ADMIN = ['/admin/login', '/admin/static/'];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const fwdProto = cfg.trustProxy ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
    const fwdFor = cfg.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const ctx = {
      req: req, res: res, url: url, params: {}, form: {}, body: null,
      cookies: H.parseCookies(req.headers.cookie),
      secure: cfg.cookieSecure || fwdProto === 'https',
      ip: fwdFor || req.socket.remoteAddress || '',
      q: k => url.searchParams.get(k)
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const p = url.pathname;
    const isApi = p.indexOf('/admin/api/') === 0;

    try {
      const isAdmin = p === '/admin' || p.indexOf('/admin/') === 0;
      if (isAdmin) {
        ctx.sess = auth.session(ctx.cookies.rs);
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      }
      const route = r.find(req.method, p);
      if (!route) {
        if ((req.method === 'GET' || req.method === 'HEAD') && !isAdmin) {
          if (p === '/k' || p === '/k/') return notFound(ctx);
          const file = p === '/' ? 'index.html' : p.slice(1);
          if (PAGES.indexOf(file) !== -1 && sitePage(ctx, file)) return;
          if (H.serveStatic(siteRoot, req, res, p, ['server', 'node_modules'])) return;
        }
        if (req.method === 'POST') req.resume();
        return notFound(ctx);
      }
      if (route.notAllowed) return H.send(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
      ctx.params = route.params;

      if (isAdmin && !ctx.sess && !OPEN_ADMIN.some(x => p === x || (x.endsWith('/') && p.indexOf(x) === 0))) {
        if (req.method === 'POST') req.resume();
        if (req.method === 'GET') return H.redirect(res, '/admin/login', 302);
        if (isApi) return H.json(res, 403, { error: 'Нужно заново войти в админку' });
        return H.send(res, 403, 'Нужно войти', 'text/plain; charset=utf-8');
      }

      if (req.method === 'POST') {
        const type = String(req.headers['content-type'] || '');
        const header = req.headers['x-csrf-token'];
        if (!isAdmin) {
          const raw = await H.readBody(req, 64 * 1024);
          // Голос принимаем только как JSON: чужой сайт не отправит такой запрос без спроса
          if (type.indexOf('application/json') !== 0) return H.json(res, 415, { error: 'json_only' });
          try { ctx.body = JSON.parse(raw || '{}'); } catch (e) { return H.json(res, 400, { error: 'bad_json' }); }
        } else if (route.raw) {
          // Файл читает сам обработчик, проверяем только токен из заголовка
          if (!auth.csrfOk(ctx.sess, header)) { req.resume(); return H.json(res, 403, { error: 'Страница устарела, обновите её' }); }
        } else {
          const raw = await H.readBody(req, 64 * 1024);
          let tokenValue = header;
          if (type.indexOf('application/json') === 0) {
            try { ctx.body = JSON.parse(raw || '{}'); } catch (e) { return H.json(res, 400, { error: 'bad_json' }); }
          } else if (type.indexOf('application/x-www-form-urlencoded') === 0) {
            ctx.form = H.parseForm(raw);
            tokenValue = ctx.form._csrf || header;
          }
          if (ctx.sess && !auth.csrfOk(ctx.sess, tokenValue)) {
            if (isApi) return H.json(res, 403, { error: 'Страница устарела, обновите её' });
            return H.send(res, 403, 'Страница устарела. Вернитесь назад, обновите её и повторите', 'text/plain; charset=utf-8');
          }
        }
      }
      await route.handler(ctx);
    } catch (e) {
      if (!e || !e.expose) console.error(new Date().toISOString(), req.method, req.url, e);
      const status = e && e.status ? e.status : 500;
      const msg = e && e.expose ? e.message : status === 413 ? 'Слишком большой запрос' : 'Что-то пошло не так. Попробуйте ещё раз';
      if (!res.headersSent) {
        // Тело не дочитано: дочитываем в никуда, чтобы браузер получил понятный ответ,
        // но не бесконечно
        if (!req.complete) {
          let drained = 0;
          req.on('data', ch => { drained += ch.length; if (drained > DRAIN_MAX) req.destroy(); });
          req.resume();
        }
        if (isApi) H.json(res, status, { error: msg });
        else H.send(res, status, msg, 'text/plain; charset=utf-8');
      } else res.destroy();
    }
  }

  return { handle: handle, store: store, auth: auth, media: media, site: site };
}

module.exports = { createApp, nextTitle, resultText };
