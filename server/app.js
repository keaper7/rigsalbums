'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { Store, STEPS } = require('./lib/db');
const { Auth, Limiter, SESSION_TTL } = require('./lib/auth');
const H = require('./lib/http');
const { slugify, randomCode, token, fromLocalInput, plural, tzParts } = require('./lib/util');
const V = require('./lib/voting');
const { Media, FILE_RE, ID_RE } = require('./lib/media');
const { Site, SLOTS, COVER, coverKey, coverSrc, GALLERIES, TEXTS, TOGGLES, PAGES, DATE_RE } = require('./lib/site');
const klassView = require('./views/klass');
const A = require('./views/admin');
const PV = require('./views/photos');
const { Photos, PHOTO_ID, PIN_RE, ROLES } = require('./lib/photos');
const { Layout, numbered, pageOf, pageLabel, FILE_MAX: LAY_FILE_MAX } = require('./lib/layout');
const LV = require('./views/layout');
const { Work, half, shootText, stageOf, readFile, FILE_MAX, STATUS_NAMES, DESIGNER_STATUSES, PART_NAMES, HALF_NAMES } = require('./lib/work');
const WV = require('./views/work');
const { Stats, day: statDay, SITE_PAGES } = require('./lib/stats');
const SV = require('./views/stats');

const RESERVED = ['admin', 'assets', 'state', 'vote', 'react', 'new', 'media'];
const VOTER_RE = /^[A-Za-z0-9_-]{16,64}$/;
// Так подписаны правки классного руководителя у дизайнера
const TEACHER_LABEL = 'Классный руководитель';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const COLORS_MAX = 7;
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
    duration_min: [60, 120, 180].indexOf(d.duration_min) !== -1 ? d.duration_min : 60,
    shoot: d.shoot || '',
    address: d.address || '',
    bring: d.bring || '',
    note: d.note || ''
  };
}

// Шпаргалка общая для всех классов. Своё значение у класса важнее общего
const CHEAT = ['shoot', 'address', 'bring', 'note'];
function withCommon(cls, d) {
  const out = Object.assign({}, cls);
  CHEAT.forEach(k => { out[k] = cls[k] || d[k] || ''; });
  return out;
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
  if (res.place && res.place.option) lines.push('Групповые: ' + res.place.option.name);
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
  // Ограничение на голоса. Считаем по каждому ученику (его cookie), а не по IP: целый класс в школьном Wi‑Fi
  // или у одного мобильного оператора выходит в интернет с одного адреса, и общий лимит на IP их бы отсекал.
  // По IP остаётся только большой запас — от явного флуда
  const voteLimit = new Limiter(60, 10 * 60 * 1000);
  const ipLimit = new Limiter(5000, 10 * 60 * 1000);
  const tooMany = (ctx, voter) => !voteLimit.hit(voter) || !ipLimit.hit(ctx.ip);
  const publicDir = path.join(__dirname, 'public');
  const siteRoot = path.resolve(cfg.siteRoot);
  const media = new Media(store, cfg.mediaDir || path.join(cfg.dataDir, 'media'));
  const site = new Site(siteRoot, store);
  const photos = new Photos(store, cfg.photosDir || path.join(cfg.dataDir, 'photos'));
  const work = new Work(store, cfg.fixesDir || path.join(cfg.dataDir, 'fixes'));
  const layout = new Layout(store, cfg.layoutDir || path.join(cfg.dataDir, 'layout'));
  const stats = new Stats(store, auth.secret);
  // старые записи статистики — раз в сутки
  const pruneTimer = setInterval(() => { try { stats.prune(); } catch (e) { console.error(e); } }, 24 * 3600 * 1000);
  if (pruneTimer.unref) pruneTimer.unref();

  // «Работы» разделились на пять разделов. Если галерею уже меняли в админке,
  // групповые фото из неё переезжают в свои разделы, в «Индивидуальной» остаются остальные
  // Два отдельных фото студии стали одной галереей «Зоны студии»
  if (store.getSite('studio.zones') === null || store.getSite('studio.zones') === undefined) {
    const old = ['studio.rest', 'studio.extra'].map(k => store.getSite(k)).filter(v => v && v.sm && v.lg);
    // к фото студии, которые лежат в самом сайте, добавляем загруженные раньше
    if (old.length) store.setSite('studio.zones', old.concat(site.defaults().gallery['studio.zones'] || []));
  }

  if (!store.getSetting('works.split')) {
    const v = store.getSite('works');
    if (Array.isArray(v)) {
      const d = site.defaults().gallery;
      const moved = new Set();
      ['works.spring', 'works.autumn', 'works.school', 'works.studio'].forEach(k => (d[k] || []).forEach(it => moved.add(it.sm)));
      store.setSite('works', v.filter(it => !moved.has(it.sm)));
    }
    store.setSetting('works.split', true);
  }
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

  // Раньше на домене было портфолио на wfolio (облако с фото клиентов). Незнакомые адреса
  // отправляем туда, где оно живёт теперь, чтобы старые ссылки клиентов не ломались
  const OWN = /^\/(admin|k|d|kr|media|assets)(\/|$)|\.(html|css|js|png|jpg|ico|txt|xml|webmanifest|woff2)$/;
  function legacy(ctx) {
    const base = String(cfg.legacyUrl || '').replace(/\/+$/, '');
    const p = ctx.url.pathname;
    if (!base || (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') || p === '/' || OWN.test(p)) return false;
    H.redirect(ctx.res, base + p + ctx.url.search, 302);
    return true;
  }

  function notFound(ctx) {
    if (ctx.url.pathname.indexOf('/admin') === 0 && ctx.sess) return page(ctx, 404, A.notFoundPage(ctx));
    if (legacy(ctx)) return;
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
      cls: withCommon(cls, cheatDefaults(cls)), opts: opts, status: st, state: state, result: result, base: '/', demo: false, nonce: nonce,
      meta: {
        title: cls.title + ' · Выбор альбома · RIGSARTHUR',
        ogTitle: 'Выбор альбома · ' + cls.title + ', ' + cls.school,
        image: baseUrl(ctx) + '/assets/og-class.jpg',
        url: url
      },
      config: {
        api: '/k/' + encodeURIComponent(cls.slug),
        steps: V.votingSteps(cls, opts),
        state: state
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
    if (tooMany(ctx, voter)) return H.json(ctx.res, 429, { error: 'busy' });
    const cat = catalog();
    const opts = V.visibleOptions(cat, cls);
    const b = ctx.body || {};
    const step = String(b.step || '');
    const option = String(b.option || '');
    if (V.activeSteps(opts).indexOf(step) === -1 || !opts[step].some(o => o.key === option)) {
      return H.json(ctx.res, 400, { error: 'bad_option' });
    }
    if (V.status(cls) !== 'open') return H.json(ctx.res, 409, { error: 'closed', state: V.publicState(store, cat, cls, voter) });
    // во время переголосования остальные этапы уже решены
    if (V.votingSteps(cls, opts).indexOf(step) === -1) return H.json(ctx.res, 409, { error: 'locked', state: V.publicState(store, cat, cls, voter) });
    const ok = store.addVote(cls.id, voter, step, option);
    const state = V.publicState(store, cat, cls, voter);
    if (!ok) return H.json(ctx.res, 409, { error: 'already', state: state });
    H.json(ctx.res, 200, { ok: true, state: state });
  });

  // Пока голосование идёт, свой голос можно отменить и выбрать заново
  r.post('/k/:slug/unvote', ctx => {
    const cls = store.getClassBySlug(ctx.params.slug);
    if (!cls) return H.json(ctx.res, 404, { error: 'not_found' });
    const voter = voterOf(ctx);
    if (!voter) return H.json(ctx.res, 400, { error: 'cookies' });
    if (tooMany(ctx, voter)) return H.json(ctx.res, 429, { error: 'busy' });
    const cat = catalog();
    const step = String((ctx.body || {}).step || '');
    if (V.activeSteps(V.visibleOptions(cat, cls)).indexOf(step) === -1) return H.json(ctx.res, 400, { error: 'bad_step' });
    if (V.status(cls) !== 'open') return H.json(ctx.res, 409, { error: 'closed', state: V.publicState(store, cat, cls, voter) });
    if (V.votingSteps(cls, V.visibleOptions(cat, cls)).indexOf(step) === -1) return H.json(ctx.res, 409, { error: 'locked', state: V.publicState(store, cat, cls, voter) });
    store.removeVote(cls.id, voter, step);
    H.json(ctx.res, 200, { ok: true, state: V.publicState(store, cat, cls, voter) });
  });

  // ---------- макет альбома для проверки учениками ----------

  // Ученики по номерам, как у дизайнера, что загружено, кто проверил, сколько правок
  function layoutData(cls) {
    const album = photos.album(cls.id);
    const list = numbered(photos.students(cls.id));
    const lay = layout.get(cls.id);
    const fixCount = new Map();
    let teacherFixes = 0;
    work.fixes(cls.id).forEach(f => {
      if (f.kind !== 'layout' || f.done_at) return;
      if (f.student_id) fixCount.set(f.student_id, (fixCount.get(f.student_id) || 0) + 1);
      else if (f.student_name === TEACHER_LABEL) teacherFixes++;
    });
    const oks = layout.oks(cls.id);
    return {
      cls: cls, album: album, lay: lay, list: list, oks: oks, fixCount: fixCount,
      checked: list.filter(s => oks.get(s.id)).length,
      teacherCover: !!(lay && lay.covers.indexOf(list.length + 1) !== -1),
      teacher: album ? { name: album.teacher_name, ok: !!(lay && lay.teacher_ok_at), fixes: teacherFixes } : null,
      noPick: !album
    };
  }

  r.get('/admin/c/:id/layout', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    const d = layoutData(cls);
    const base = '/admin/api/c/' + cls.id + '/layout';
    page(ctx, 200, A.layout({
      title: 'Макет · ' + cls.title, nav: 'work', sess: ctx.sess, msg: ctx.q('m'), scripts: ['/admin/static/layout.js'],
      body: LV.layoutBody(Object.assign(d, {
        back: '/admin/c/' + cls.id + '/work', backLabel: cls.title,
        csrf: ctx.sess.csrf,
        api: { start: base + '/start', file: '/admin/api/media/lay/' + cls.id, finish: base + '/finish', first: '/admin/c/' + cls.id + '/layout/first' },
        link: d.album ? baseUrl(ctx) + '/f/' + d.album.slug + '/album' : '',
        teacherLink: d.album ? baseUrl(ctx) + '/kr/' + photos.teacherToken(cls.id) + '/album' : '',
        pickLink: '/admin/c/' + cls.id + '/photos',
        preview: d.album ? s => '/f/' + d.album.slug + '/album?s=' + (s === 'kr' ? 'kr' : s.id) : null
      }))
    }));
  });

  r.post('/admin/api/c/:id/layout/start', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return H.json(ctx.res, 404, { error: 'Класс не найден' });
    const res = layout.start(cls.id, ctx.body || {});
    H.json(ctx.res, res.error ? 400 : 200, res);
  });

  r.post('/admin/api/media/lay/:id/:ver', async ctx => {
    const cls = loadClass(ctx);
    if (!cls) { ctx.req.resume(); return H.json(ctx.res, 404, { error: 'Класс не найден' }); }
    const buf = await readFile(ctx.req, LAY_FILE_MAX);
    const res = layout.saveFile(cls.id, parseInt(ctx.params.ver, 10) || 0, String(ctx.q('name') || ''), buf);
    H.json(ctx.res, res.error ? 400 : 200, res);
  }, { raw: true });

  r.post('/admin/api/c/:id/layout/finish', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return H.json(ctx.res, 404, { error: 'Класс не найден' });
    const res = layout.finish(cls.id, parseInt((ctx.body || {}).ver, 10) || 0, 'Артур');
    if (res.ok) work.event(cls.id, 'Артур', 'загружен макет для проверки');
    H.json(ctx.res, res.error ? 400 : 200, res);
  });

  // Первая личная страница: разворот и сторона
  function firstPageFrom(f) {
    const spread = parseInt(f.spread, 10) || 0;
    return spread * 2 - (f.side === 'r' ? 0 : 1);
  }

  r.post('/admin/c/:id/layout/first', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    layout.setFirstPage(cls.id, firstPageFrom(ctx.form));
    back(ctx, '/admin/c/' + cls.id + '/layout#students', 'saved');
  });

  // ----- то же для дизайнера, по его ссылке -----
  r.get('/d/:token/c/:id/layout', ctx => {
    const d = designerCtx(ctx);
    if (!d) return;
    const cls = designerClass(ctx);
    if (!cls) return H.redirect(ctx.res, '/d/' + d.token);
    const data = layoutData(cls);
    const base = '/d/' + d.token + '/c/' + cls.id;
    dpage(ctx, WV.dlayout({
      title: 'Макет · ' + cls.title, designer: d, home: '/d/' + d.token, scripts: ['/admin/static/layout.js'],
      body: LV.layoutBody(Object.assign(data, {
        back: base, backLabel: cls.title,
        api: { start: base + '/layout/start', file: '/admin/api/media/dlay/' + d.token + '/' + cls.id, finish: base + '/layout/finish', first: base + '/layout/first' },
        link: data.album ? baseUrl(ctx) + '/f/' + data.album.slug + '/album' : '',
        preview: s => base + '/album?s=' + (s === 'kr' ? 'kr' : s.id)
      }))
    }));
  });

  function designerJson(path, fn) {
    r.post('/d/:token/c/:id/' + path, ctx => {
      const d = work.designerByToken(ctx.params.token);
      if (!d) return H.json(ctx.res, 403, { error: 'Ссылка больше не работает. Попросите у Артура новую' });
      if (!designerLimit.hit('d' + d.id)) return H.json(ctx.res, 429, { error: 'Слишком часто. Подождите минуту' });
      const cls = designerClass(ctx);
      if (!cls) return H.json(ctx.res, 404, { error: 'Класс не найден' });
      const res = fn(ctx.body || {}, cls, d);
      H.json(ctx.res, res.error ? 400 : 200, res);
    });
  }
  designerJson('layout/start', (b, cls) => layout.start(cls.id, b));
  designerJson('layout/finish', (b, cls, d) => {
    const res = layout.finish(cls.id, parseInt(b.ver, 10) || 0, d.name);
    if (res.ok) work.event(cls.id, d.name, 'загружен макет для проверки');
    return res;
  });
  designerJson('layout/first', (b, cls) => layout.setFirstPage(cls.id, firstPageFrom(b)) ? { ok: true } : { error: 'Проверьте номер разворота' });

  // Файлы дизайнера: много запросов подряд, поэтому лимит щедрый
  const layUpLimit = new Limiter(3000, 10 * 60 * 1000);
  r.post('/admin/api/media/dlay/:token/:id/:ver', async ctx => {
    const d = work.designerByToken(ctx.params.token);
    if (!d || !layUpLimit.hit('d' + d.id)) { ctx.req.resume(); return H.json(ctx.res, 403, { error: 'Ссылка больше не работает' }); }
    const cls = designerClass(ctx);
    if (!cls) { ctx.req.resume(); return H.json(ctx.res, 404, { error: 'Класс не найден' }); }
    const buf = await readFile(ctx.req, LAY_FILE_MAX);
    const res = layout.saveFile(cls.id, parseInt(ctx.params.ver, 10) || 0, String(ctx.q('name') || ''), buf);
    H.json(ctx.res, res.error ? 400 : 200, res);
  }, { raw: true, open: true });

  function sendLayFile(ctx, classId) {
    const f = layout.file(classId, parseInt(ctx.params.ver, 10) || 0, String(ctx.params.file || '').replace(/\.jpg$/, ''));
    if (!f || !H.serveStatic(f.dir, ctx.req, ctx.res, '/' + f.file, [], { cache: 'private, max-age=604800' })) notFound(ctx);
  }

  r.get('/d/:token/c/:id/lay/:ver/:file', ctx => {
    const d = designerCtx(ctx);
    if (!d) return;
    const cls = designerClass(ctx);
    if (!cls) return notFound(ctx);
    sendLayFile(ctx, cls.id);
  });

  // Дизайнер смотрит альбом глазами ученика
  r.get('/d/:token/c/:id/album', ctx => {
    const d = designerCtx(ctx);
    if (!d) return;
    const cls = designerClass(ctx);
    if (!cls) return notFound(ctx);
    const lay = layout.ready(cls.id);
    const list = numbered(photos.students(cls.id));
    const me = list.find(s => s.id === +ctx.q('s')) || null;
    const base = '/d/' + d.token + '/c/' + cls.id;
    if (!lay) return dpage(ctx, LV.albumNotReady({ cls: cls }));
    if (ctx.q('s') === 'kr') return dpage(ctx, teacherAlbum(cls, lay, list, { view: true, api: { files: base + '/lay/' + lay.ver + '/' } }));
    dpage(ctx, LV.albumPage({ cls: cls, lay: lay, me: me, num: me ? me.num : 0, admin: true, view: true, fixes: [], ok: false,
      api: { files: base + '/lay/' + lay.ver + '/' } }));
  });

  // ----- страница ученика: та же ссылка, что у отбора, с /album -----
  const ALBUM_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  function albumSend(ctx, body) {
    H.send(ctx.res, 200, body, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': ALBUM_CSP });
  }

  r.get('/f/:slug/album', ctx => {
    const p = pickCtx(ctx);
    if (!p) return notFound(ctx);
    const lay = layout.ready(p.cls.id);
    const list = numbered(photos.students(p.cls.id));
    const base = '/f/' + p.album.slug;
    if (!lay) return albumSend(ctx, LV.albumNotReady({ cls: p.cls }));
    // Артур из админки смотрит альбом за любого ученика
    if (p.admin && ctx.q('s') === 'kr') return albumSend(ctx, teacherAlbum(p.cls, lay, list, { view: true, api: { files: base + '/lay/' + lay.ver + '/' } }));
    let me = p.me ? list.find(s => s.id === p.me.id) : null;
    const view = p.admin && ctx.q('s');
    if (view) me = list.find(s => s.id === +ctx.q('s')) || null;
    if (!me && !view) {
      return albumSend(ctx, LV.albumLogin({ cls: p.cls, students: photos.students(p.cls.id).map(s => ({ id: s.id, name: s.name, locked: !!s.pin })), api: { me: base + '/me' } }));
    }
    const fixes = me && !view ? work.fixes(p.cls.id).filter(f => f.kind === 'layout' && f.student_id === me.id) : [];
    albumSend(ctx, LV.albumPage({
      cls: p.cls, lay: lay, me: me, num: me ? me.num : 0, admin: !!view, view: !!view, fixes: fixes, ok: me && !view ? !!layout.oks(p.cls.id).get(me.id) : false,
      api: { files: base + '/lay/' + lay.ver + '/', fix: base + '/album/fix', ok: base + '/album/ok', leave: base + '/leave' }
    }));
  });

  r.get('/f/:slug/lay/:ver/:file', ctx => {
    const p = pickCtx(ctx);
    if (!p || !(p.me || p.admin)) return notFound(ctx);
    sendLayFile(ctx, p.cls.id);
  });

  function albumWrite(name, fn) {
    r.post('/f/:slug/album/' + name, ctx => {
      const p = pickCtx(ctx);
      if (!p) return H.json(ctx.res, 404, { error: 'not_found' });
      if (!p.me) return H.json(ctx.res, 403, { error: 'Войдите заново: выберите себя и введите код' });
      if (!pickLimit.hit('a' + p.me.id + ':' + ctx.ip)) return H.json(ctx.res, 429, { error: 'Слишком часто. Подождите минуту' });
      const lay = layout.ready(p.cls.id);
      if (!lay) return H.json(ctx.res, 409, { error: 'Макет обновляется. Обновите страницу' });
      const res = fn(ctx.body || {}, p, lay);
      H.json(ctx.res, res.error ? 400 : 200, res);
    });
  }

  // Правка из альбома уходит дизайнеру вместе со страницей, где ошибка
  function layoutFix(b, lay) {
    const text = String(b.text || '').trim().slice(0, 1500);
    if (!text) return { error: 'Напишите, что исправить' };
    const m = /^(\d{1,2})-([lr])$/.exec(String(b.where || ''));
    let where = 'обложка';
    if (m && +m[1] >= 1 && +m[1] <= lay.spreads) where = pageLabel(+m[1], m[2]);
    else if (b.where !== 'cover') return { error: 'Выберите, где ошибка' };
    return { text: where[0].toUpperCase() + where.slice(1) + ': ' + text };
  }

  albumWrite('fix', (b, p, lay) => {
    const fx = layoutFix(b, lay);
    if (fx.error) return fx;
    const res = work.addFix(p.cls.id, { studentId: p.me.id, studentName: p.me.name, kind: 'layout', text: fx.text, who: p.me.name, auto: true });
    if (res.error) return res;
    layout.setOk(p.cls.id, p.me.id, false);
    return { ok: true };
  });

  albumWrite('ok', (b, p) => {
    const on = b.on !== false && b.on !== 0 && b.on !== '0';
    layout.setOk(p.cls.id, p.me.id, on);
    if (on) work.event(p.cls.id, p.me.name, 'проверил(а) альбом: всё верно');
    return { ok: true };
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
    // из лида: школа, класс и телефон уже известны
    const lead = parseInt(ctx.q('lead') || (extra && extra.form && extra.form.lead) || '', 10) || 0;
    const ld = lead ? work.lead(lead) : null;
    const prefill = src ? { school: src.school, year: src.year, duration_min: src.duration_min, city: work.get(src.id).city }
      : ld ? { school: ld.school, title: ld.title, phone: ld.phone, lead: ld.id } : null;
    return A.newClassPage(Object.assign({
      sess: ctx.sess, defaults: defaultsFor(store), classes: templates(), from: src ? src.id : 0,
      nextTitle: src ? nextTitle(src.title) : '', schools: knownSchools()
    }, extra || {}, prefill && !(extra && extra.form) ? { form: prefill } : {}));
  }

  // Школы и города, которые уже были: подсказки при создании класса
  function knownSchools() {
    const all = work.all();
    const seen = new Map();
    store.listClasses().forEach(c => { if (!seen.has(c.school)) seen.set(c.school, (all.get(c.id) || {}).city || ''); });
    return Array.from(seen, ([school, city]) => ({ school: school, city: city }));
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
    const base = { slug: newSlug(school, title), school: school, title: title, year: year, duration_min: duration };
    return store.createClass(Object.assign(base, src
      ? { hidden: src.hidden, shoot: src.shoot, address: src.address, bring: src.bring, note: src.note }
      : {}));
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
    // сразу для работы: город и цена — всем классам, телефон, ученики и дата съёмки — если класс один
    const city = str(f.city, 60);
    ids.forEach(id => {
      if (city) work.setCity(id, city);
      if (HALF_NAMES[f.half]) work.setHalf(id, f.half);
      const m = {};
      if (f.price) m.price = f.price;
      if (ids.length === 1 && f.students) m.students = f.students;
      if (Object.keys(m).length) work.updateMoney(id, m);
      if (ids.length === 1 && str(f.phone, 40)) work.setContacts(id, [str(f.pname, 60)], [str(f.phone, 40)]);
      if (ids.length === 1 && f.sd) work.addDate(id, { d: f.sd, t: f.st, kind: f.sk });
    });
    const ld = parseInt(f.lead, 10) ? work.lead(parseInt(f.lead, 10)) : null;
    if (ld) work.updateLead(ld.id, { status: 'class', classId: ids[0] });
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
      online: online(cls.id),
      summary: V.status(cls) === 'closed' && !V.isPending(res) ? resultText(cls, res, voters, url) : ''
    };
  }

  // Шпаргалка класса: своё значение у класса, иначе дата индивидуальной съёмки из «Работы», иначе общее
  function cheatDefaults(cls) {
    const d = defaultsFor(store);
    const t = shootText(work.get(cls.id), today());
    if (t) d.shoot = t;
    return d;
  }

  function classView(ctx, cls, extra) {
    syncShoots();
    return A.classPage(Object.assign(resultsData(ctx, cls), {
      msg: ctx.q('m'),
      url: baseUrl(ctx) + '/k/' + cls.slug,
      nextTitle: nextTitle(cls.title),
      defaults: defaultsFor(store),
      workShoot: shootText(work.get(cls.id), today()),
      pk: { photos: photos.photos(cls.id).length, students: photos.students(cls.id).length, started: photos.startedIds(cls.id).size, closed: !!(photos.album(cls.id) || {}).closed_at },
      // коротко, где сейчас класс: этап и что дальше
      work: (w => { const sg = stageOf(w); return (sg.finished ? 'Готово, альбом забрали' : sg.stage.name + ' · ' + sg.done + ' из ' + sg.total + (sg.next ? ' · дальше: ' + sg.next : '')) + (work.openCounts().get(cls.id) ? ' · правок: ' + work.openCounts().get(cls.id) : ''); })(work.get(cls.id)),
      city: work.get(cls.id).city
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

  // Конец голосования: либо «длится N», либо «до такого-то дня и времени» (поле until)
  const UNTIL_MAX = 60 * 24 * 60 * 60 * 1000;
  function endFrom(ctx, start, def) {
    const raw = str(ctx.form.until, 30);
    if (raw) {
      const until = fromLocalInput(raw);
      if (!until) return { err: 'Не получилось прочитать дату окончания' };
      if (until < start + 60 * 1000) return { err: 'Время окончания должно быть позже начала' };
      if (until > start + UNTIL_MAX) return { err: 'Голосование может длиться не больше двух месяцев' };
      return { ends: until };
    }
    const min = int(ctx.form.duration_min, 1, 600, def);
    return { ends: start + min * 60000, min: min };
  }

  act('open', (ctx, cls) => {
    const now = Date.now();
    const st = V.status(cls, now);
    if (st === 'open') return back(ctx, '/admin/c/' + cls.id);
    const e = endFrom(ctx, now, cls.duration_min);
    if (e.err) return page(ctx, 400, classView(ctx, cls, { err: e.err }));
    const f = { opened_at: st === 'draft' ? now : cls.opened_at, ends_at: e.ends, closed_at: null, revote: [] };
    if (st === 'draft' && e.min) f.duration_min = e.min;
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
    if (!at || at < now + 30 * 1000) return page(ctx, 400, classView(ctx, cls, { err: 'Время старта должно быть в будущем' }));
    if (at > now + 60 * 24 * 60 * 60 * 1000) return page(ctx, 400, classView(ctx, cls, { err: 'Запланировать можно не дальше чем на два месяца вперёд' }));
    const e = endFrom(ctx, at, cls.duration_min);
    if (e.err) return page(ctx, 400, classView(ctx, cls, { err: e.err }));
    const f = { opened_at: at, ends_at: e.ends, closed_at: null };
    if (e.min) f.duration_min = e.min;
    store.updateClass(cls.id, f);
    back(ctx, '/admin/c/' + cls.id, 'scheduled');
  });

  act('close', (ctx, cls) => {
    if (V.status(cls) === 'open') store.updateClass(cls.id, { closed_at: Date.now() });
    back(ctx, '/admin/c/' + cls.id, 'closed');
  });

  // Идущее голосование: поставить точное время окончания
  act('until', (ctx, cls) => {
    const now = Date.now();
    if (V.status(cls, now) !== 'open') return back(ctx, '/admin/c/' + cls.id);
    const until = fromLocalInput(str(ctx.form.until, 30));
    if (!until) return page(ctx, 400, classView(ctx, cls, { err: 'Не получилось прочитать дату окончания' }));
    if (until < now + 60 * 1000) return page(ctx, 400, classView(ctx, cls, { err: 'Время окончания должно быть в будущем. Чтобы закончить сейчас, нажмите «Закрыть сейчас»' }));
    if (until > now + UNTIL_MAX) return page(ctx, 400, classView(ctx, cls, { err: 'Голосование может длиться не больше двух месяцев' }));
    store.updateClass(cls.id, { ends_at: until });
    back(ctx, '/admin/c/' + cls.id, 'until');
  });

  // Переголосовать один этап: его голоса и ручной выбор обнуляются, голосование открывается заново
  // на заданное время, и ребята видят только этот этап. Итоги остальных этапов не меняются
  act('revote', (ctx, cls) => {
    const now = Date.now();
    const step = str(ctx.form.step, 20);
    if (V.status(cls, now) !== 'closed') return back(ctx, '/admin/c/' + cls.id);
    if (V.activeSteps(V.visibleOptions(catalog(), cls)).indexOf(step) === -1) return back(ctx, '/admin/c/' + cls.id);
    const e = endFrom(ctx, now, cls.duration_min);
    if (e.err) return page(ctx, 400, classView(ctx, cls, { err: e.err }));
    store.resetStepVotes(cls.id, step);
    const picks = Object.assign({}, cls.picks);
    delete picks[step];
    store.updateClass(cls.id, { picks: picks, ends_at: e.ends, closed_at: null, revote: [step] });
    back(ctx, '/admin/c/' + cls.id, 'revote');
  });

  // Обнулить голоса одного этапа: ребята смогут проголосовать в нём заново
  act('resetstep', (ctx, cls) => {
    const step = str(ctx.form.step, 20);
    if (STEPS.indexOf(step) === -1) return back(ctx, '/admin/c/' + cls.id);
    store.resetStepVotes(cls.id, step);
    const picks = Object.assign({}, cls.picks);
    delete picks[step];
    store.updateClass(cls.id, { picks: picks });
    back(ctx, '/admin/c/' + cls.id + '#results', 'stepreset');
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
    // Этап без единого варианта убирается у класса целиком (например, место уже выбрали заранее).
    // Но хотя бы один этап для голосования должен остаться
    let steps = 0;
    STEPS.forEach(step => {
      let kept = 0;
      cat[step].filter(o => !o.hidden).forEach(o => {
        const k = step + ':' + o.key;
        if (on.indexOf(k) === -1) hidden.push(k); else kept++;
      });
      if (kept) steps++;
    });
    if (!steps) return page(ctx, 400, classView(ctx, cls, { err: 'Оставьте хотя бы один этап для голосования' }));
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
    // Если старт запланирован и конец считался по длительности, двигаем его вместе с ней (точную дату окончания не трогаем)
    if (V.opensAt(cls) && cls.ends_at === cls.opened_at + cls.duration_min * 60000) f2.ends_at = cls.opened_at + f2.duration_min * 60000;
    store.updateClass(cls.id, f2);
    if ('city' in f) work.setCity(cls.id, f.city);
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
    photos.removeFiles(cls.id);
    work.removeFiles(cls.id);
    layout.removeFiles(cls.id);
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
      lastDay: (m => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 86400000).toISOString().slice(0, 10))(DATE_RE.exec(site.priceUntil())),
      priceOver: site.priceOver(), laterPrice: site.text('price.later'),
      videoNote: vals['home.video'] && vals['home.video'].media ? (store.getMedia(vals['home.video'].media) || {}).note : ''
    }, extra || {}));
  }

  // Место на сайте: обычное или обложка существующей тематики
  function slotDef(key) {
    if (SLOTS[key]) return SLOTS[key];
    return coverKey(key) && store.optionKeyTaken('theme', key.slice(6)) ? COVER : null;
  }

  r.get('/admin/site', ctx => page(ctx, 200, siteView(ctx)));

  r.post('/admin/site/texts', ctx => {
    const f = ctx.form;
    // Текст, совпадающий с исходным (до или после смены даты), не храним:
    // тогда он сам следует за правками страницы и датой
    const norm = t => String(t).replace(/\s+/g, ' ').trim();
    const before = {};
    Object.keys(TEXTS).forEach(k => { before[k] = norm(site.defaultText(k)); });
    // В форме последний день скидки, храним следующий: с него действует обычная цена
    const last = DATE_RE.exec(str(f['price.last'], 10));
    if (last) store.setSite('price.until', new Date(Date.UTC(+last[1], +last[2] - 1, +last[3]) + 86400000).toISOString().slice(0, 10));
    else if (!f['price.last']) store.deleteSite('price.until');
    Object.keys(TEXTS).forEach(k => {
      const v = norm(str(f[k], TEXTS[k].max));
      if (v && v !== before[k] && v !== norm(site.defaultText(k))) store.setSite(k, v);
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
    const def = slotDef(key);
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
    if (!slotDef(key) && !GALLERIES[key]) return notFound(ctx);
    store.deleteSite(key);
    changed();
    const from = parseInt(ctx.form.from, 10);
    back(ctx, from ? '/admin/o/' + from + '#cover' : GALLERIES[key] ? '/admin/site/g/' + key : '/admin/site#' + key, 'restored');
  });

  r.get('/admin/site/g/:key', ctx => {
    const key = ctx.params.key;
    if (!GALLERIES[key]) return notFound(ctx);
    const sections = Object.keys(GALLERIES).filter(k => GALLERIES[k].section && k !== key).map(k => ({ key: k, label: GALLERIES[k].label }));
    page(ctx, 200, A.galleryPage({ sess: ctx.sess, msg: ctx.q('m'), errCode: ctx.q('e'), key: key, def: GALLERIES[key], gallery: site.gallery(key),
      link: GALLERIES[key].section ? baseUrl(ctx) + '/works.html#' + GALLERIES[key].section : '', sections: GALLERIES[key].section ? sections : [] }));
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
    const op = /^(up|down|first|del|to):(\d+)(?::([a-z0-9.]+))?$/.exec(str(ctx.form.op, 40));
    if (op) {
      const i = +op[2];
      if (i >= 0 && i < items.length) {
        if (op[1] === 'to') {
          // Перенести фото в другой раздел «Работ»: встаёт там первым
          const to = op[3];
          const def = GALLERIES[to];
          if (!def || to === key || !def.section || !GALLERIES[key].section) return back(ctx, '/admin/site/g/' + key);
          const dest = site.gallery(to).items;
          if (dest.length >= def.max) return back(ctx, '/admin/site/g/' + key + '?e=full');
          dest.unshift(items.splice(i, 1)[0]);
          store.setSite(to, dest);
          store.setSite(key, items);
          changed();
          return back(ctx, '/admin/site/g/' + key + '#g' + Math.max(0, i - 1), 'moved');
        }
        if (op[1] === 'del') {
          if (items.length <= 1 && !GALLERIES[key].empty) return back(ctx, '/admin/site/g/' + key + '?e=last');
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
        : step === 'place' ? { name: name, sub: '', link: '', photos: [] }
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
    const cover = o.step === 'theme' ? { own: store.getSite('cover.' + o.key) || null, src: coverSrc(o, {}) } : null;
    page(ctx, 200, A.optionPage({ sess: ctx.sess, msg: ctx.q('m'), errCode: ctx.q('e'), option: o, cover: cover }));
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
    } else if (o.step === 'place') {
      data.sub = str(f.sub, 120);
      // Ссылка на раздел «Работ» (works.html#school) или любая https-ссылка
      const link = str(f.link, 300);
      if (link && !/^(https?:\/\/\S+|[a-z0-9-]+\.html(#[a-z0-9-]+)?)$/.test(link)) return fail('Ссылка должна быть вида works.html#school или начинаться с https://');
      data.link = link;
    } else if (o.step === 'wear') {
      data.sub = str(f.sub, 80);
      const pin = str(f.pin, 300);
      if (pin && !/^https?:\/\/\S+$/.test(pin)) return fail('Ссылка на Pinterest должна начинаться с https://');
      data.pin = pin;
    } else {
      const n = int(f.count, 1, COLORS_MAX, (o.colors || []).length || 1);
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
    const next = {
      year: int(f.year, 2020, 2100, d.year),
      duration_min: int(f.duration_min, 1, 600, d.duration_min),
      shoot: str(f.shoot, 120),
      address: str(f.address, 160),
      bring: str(f.bring, 600),
      note: str(f.note, 600)
    };
    store.setSetting('defaults', next);
    // Раньше общий текст копировался в каждый класс. Такие копии убираем,
    // чтобы эти классы тоже показывали новый общий текст
    store.listClasses().forEach(c => {
      const ch = {};
      CHEAT.forEach(k => { if (c[k] && (c[k] === d[k] || c[k] === next[k])) ch[k] = ''; });
      if (Object.keys(ch).length) store.updateClass(c.id, ch);
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

  // ---------- отбор фото ----------
  // Админка: /admin/c/:id/photos. Ученики: /f/:slug — отдельная ссылка, голосование /k/ не трогаем

  const pickLimit = new Limiter(600, 10 * 60 * 1000);
  // Неверный код ученика: 10 попыток за 15 минут на имя, чтобы код из 4 цифр нельзя было подобрать
  const pinLimit = new Limiter(10, 15 * 60 * 1000);

  function albumFor(cls) {
    return photos.ensureAlbum(cls.id, slugify(cls.title + '-' + cls.school).slice(0, 30) + '-' + randomCode(6));
  }

  function photosView(ctx, cls, extra) {
    const album = albumFor(cls);
    const list = photos.photos(cls.id);
    const students = photos.students(cls.id);
    const picks = new Map(students.map(s => [s.id, photos.personalInfo(s.id, album)]));
    const counts = new Map(students.map(s => [s.id, picks.get(s.id).length]));
    const group = photos.group(cls.id, album);
    const inGroup = new Set(group.map(g => g.photo_id));
    const byId = new Map(list.map(p => [p.id, p]));
    const log = photos.log(cls.id, 60).map(l => Object.assign({}, l, { path: byId.has(l.photo_id) ? byId.get(l.photo_id).path : '', inGroup: inGroup.has(l.photo_id) }));
    const teacher = {
      token: photos.teacherToken(cls.id), photos: photos.teacherPhotos(cls.id),
      picks: photos.teacherPicks(photos.album(cls.id), byId), done: photos.teacherDone(photos.album(cls.id))
    };
    return PV.adminPage(Object.assign({
      cls: cls, album: photos.album(cls.id), photos: list, teacher: teacher,
      isTeacher: s => photos.isTeacherSection(s), students: students, counts: counts, groupCount: group.length, log: log,
      disk: photos.disk(), usage: photos.usage(cls.id), picks: picks, byId: byId,
      isGroup: s => photos.isGroupSection(album, s), sess: ctx.sess, base: baseUrl(ctx), msg: ctx.q('m')
    }, extra || {}));
  }

  r.get('/admin/c/:id/photos', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    page(ctx, 200, photosView(ctx, cls));
  });

  function pact(name, fn) {
    r.post('/admin/c/:id/photos/' + name, ctx => {
      const cls = loadClass(ctx);
      if (!cls) return notFound(ctx);
      fn(ctx, cls, albumFor(cls));
    });
  }
  const pback = (ctx, cls, msg) => back(ctx, '/admin/c/' + cls.id + '/photos', msg);

  pact('students', (ctx, cls) => {
    const res = photos.setStudents(cls.id, String(ctx.form.names || '').slice(0, 20000));
    if (res.dups.length) return page(ctx, 400, photosView(ctx, cls, { err: 'Повторяются имена: ' + res.dups.join(', ') + '. Если это разные ученики, добавьте фамилию или первую букву. Список не сохранён', names: ctx.form.names }));
    if (res.kept.length) return page(ctx, 400, photosView(ctx, cls, { err: 'Остались в списке, потому что уже выбрали фото или написали цитату: ' + res.kept.join(', ') + '. Остальное сохранено' }));
    pback(ctx, cls, 'students');
  });

  pact('rename', (ctx, cls) => {
    const res = photos.renameStudent(cls.id, +ctx.form.student, ctx.form.name);
    if (res.error) return page(ctx, 400, photosView(ctx, cls, { err: res.error }));
    pback(ctx, cls, 'saved');
  });

  pact('settings', (ctx, cls, album) => {
    photos.updateAlbum(cls.id, { personal_max: int(ctx.form.personal_max, 1, 20, album.personal_max), group_max: int(ctx.form.group_max, 1, 300, album.group_max) });
    pback(ctx, cls, 'saved');
  });

  // Ссылка на оригиналы в wfolio — кнопка «Скачать оригиналы» у учеников
  pact('wfolio', (ctx, cls) => {
    const url = str(ctx.form.wfolio, 500);
    if (url && !/^https?:\/\/[^\s<>"']+$/i.test(url)) return page(ctx, 400, photosView(ctx, cls, { err: 'Ссылка должна начинаться с https://' }));
    photos.updateAlbum(cls.id, { wfolio: url });
    pback(ctx, cls, 'saved');
  });

  pact('resetpin', (ctx, cls) => {
    photos.resetPin(cls.id, +ctx.form.student);
    pback(ctx, cls, 'pinreset');
  });

  pact('retouched', (ctx, cls) => {
    const sid = +ctx.form.student;
    photos.setRetouchDone(cls.id, sid, ctx.form.on === '1');
    back(ctx, '/admin/c/' + cls.id + '/photos#st-' + sid);
  });

  pact('slim', (ctx, cls, album) => {
    if (!album.closed_at) return page(ctx, 400, photosView(ctx, cls, { err: 'Сначала закройте отбор: пока он открыт, ученикам нужны все фото' }));
    photos.slim(cls.id);
    pback(ctx, cls, 'slim');
  });

  pact('sections', (ctx, cls) => {
    const names = new Set(photos.photos(cls.id).map(p => p.section));
    const on = [].concat(ctx.form.group || []).filter(s => names.has(s));
    // Пустой список значит «по названию папки», поэтому «ни одного группового» храним явной меткой
    photos.updateAlbum(cls.id, { group_sections: on.length ? on : ['\u0000'] });
    pback(ctx, cls, 'saved');
  });

  pact('close', (ctx, cls) => { photos.updateAlbum(cls.id, { closed_at: Date.now() }); pback(ctx, cls, 'closed'); });
  pact('open', (ctx, cls) => { photos.updateAlbum(cls.id, { closed_at: null }); pback(ctx, cls, 'opened'); });

  pact('restore', (ctx, cls, album) => {
    const ph = photos.photo(cls.id, ctx.form.photo);
    if (!ph) return pback(ctx, cls);
    const res = photos.setGroup(album, ph.id, true, null, 'Артур');
    if (!res.ok) return page(ctx, 400, photosView(ctx, cls, { err: 'Групповых уже максимум. Уберите какое-то фото или увеличьте лимит' }));
    pback(ctx, cls, 'saved');
  });

  pact('delsection', (ctx, cls) => {
    photos.deleteSection(cls.id, str(ctx.form.section, 120));
    pback(ctx, cls, 'removed');
  });

  r.get('/admin/api/c/:id/photos/have', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return H.json(ctx.res, 404, { error: 'Класс не найден' });
    H.json(ctx.res, 200, { paths: photos.paths(cls.id) });
  });

  // Загрузка — под /admin/api/media/…: для этого пути nginx на сервере уже разрешает большие файлы
  // (у остальных путей предел 1 МБ, а копия 1600 px с камеры бывает больше)
  r.post('/admin/api/media/pk/:id', async ctx => {
    const cls = loadClass(ctx);
    if (!cls) { ctx.req.resume(); return H.json(ctx.res, 404, { error: 'Класс не найден' }); }
    albumFor(cls);
    H.json(ctx.res, 200, await photos.savePhoto(cls.id, ctx.q('path'), ctx.req));
  }, { raw: true });

  r.post('/admin/api/media/pk/:id/:pid/sm', async ctx => {
    const cls = loadClass(ctx);
    if (!cls) { ctx.req.resume(); return H.json(ctx.res, 404, { error: 'Класс не найден' }); }
    H.json(ctx.res, 200, await photos.saveSmall(cls.id, ctx.params.pid, ctx.req));
  }, { raw: true });

  r.get('/admin/api/c/:id/photos/export', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return H.json(ctx.res, 404, { error: 'Класс не найден' });
    H.json(ctx.res, 200, photos.exportPlan(cls.id));
  });

  // ----- страница учеников -----
  const PK_COOKIE = id => 'rp' + id;
  // В cookie — номер ученика и подпись, в которую входит его код: подделать cookie нельзя,
  // а если Артур сбросит код, вход в этом браузере тоже сбросится
  const pkSig = s => crypto.createHmac('sha256', auth.secret).update('pk:' + s.class_id + ':' + s.id + ':' + s.pin).digest('base64url').slice(0, 24);
  const pkCookie = s => s.id + '.' + pkSig(s);

  function pickCtx(ctx) {
    const album = photos.albumBySlug(ctx.params.slug);
    if (!album) return null;
    const cls = store.getClass(album.class_id);
    if (!cls) return null;
    const admin = !!auth.session(ctx.cookies.rs);
    const m = /^(\d{1,10})\.([A-Za-z0-9_-]{24})$/.exec(String(ctx.cookies[PK_COOKIE(cls.id)] || ''));
    let me = m ? photos.student(cls.id, +m[1]) : null;
    if (me && !(me.pin && crypto.timingSafeEqual(Buffer.from(pkSig(me)), Buffer.from(m[2])))) me = null;
    return { album: album, cls: cls, admin: admin, me: me };
  }

  function pickState(p) {
    const students = photos.students(p.cls.id);
    const names = {};
    students.forEach(s => { names[s.id] = s.name; });
    const mine = p.me ? photos.personalInfo(p.me.id, p.album) : [];
    return {
      closed: !!p.album.closed_at,
      personalMax: p.album.personal_max,
      groupMax: p.album.group_max,
      group: photos.group(p.cls.id, p.album).map(g => [g.photo_id, g.student_id ? names[g.student_id] || 'ученик' : 'Артур']),
      mine: mine.map(x => x.id),
      roles: Object.fromEntries(mine.filter(x => x.role).map(x => [x.id, x.role])),
      retouch: Object.fromEntries(mine.filter(x => x.retouch).map(x => [x.id, x.retouch])),
      quote: p.me ? p.me.quote : '',
      wish: p.me ? p.me.wish : '',
      wfolio: p.album.wfolio || '',
      slim: !!p.album.slim_at,
      me: p.me ? { id: p.me.id, name: p.me.name } : null,
      admin: p.admin && !p.me
    };
  }

  r.get('/f/:slug', ctx => {
    const p = pickCtx(ctx);
    if (!p) return notFound(ctx);
    // «Открыть как Артур» из админки: даже если в этом браузере раньше выбирали ученика, заходим как Артур
    if (ctx.q('admin') && p.admin && p.me) {
      H.setCookie(ctx.res, PK_COOKIE(p.cls.id), '', cookieOpts(ctx, 0));
      p.me = null;
    }
    const list = photos.ready(p.cls.id);
    const data = Object.assign(pickState(p), {
      slug: p.album.slug,
      students: (started => photos.students(p.cls.id).map(s => ({ id: s.id, name: s.name, started: started.has(s.id), locked: !!s.pin })))(photos.startedIds(p.cls.id)),
      placeList: ROLES,
      klass: { school: p.cls.school, title: p.cls.title, year: p.cls.year },
      photos: list.filter(ph => !photos.isTeacherSection(ph.section)).map(ph => [ph.id, ph.section, ph.w, ph.h, photos.isGroupSection(p.album, ph.section) ? 1 : 0, ph.ver])
    });
    H.send(ctx.res, 200, PV.pickPage({ cls: p.cls, data: data }), 'text/html; charset=utf-8', {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
  });

  r.get('/f/:slug/state', ctx => {
    const p = pickCtx(ctx);
    if (!p) return H.json(ctx.res, 404, { error: 'not_found' });
    H.json(ctx.res, 200, pickState(p));
  });

  r.get('/f/:slug/p/:file', ctx => {
    const album = photos.albumBySlug(ctx.params.slug);
    const m = /^([a-z0-9]{16})(-sm)?\.jpg$/.exec(ctx.params.file);
    const ph = album && m ? photos.photo(album.class_id, m[1]) : null;
    if (!ph) return notFound(ctx);
    // После «Освободить место» большой копии нет — показываем маленькую
    const file = ph.slim ? ph.id + '-sm.jpg' : ctx.params.file;
    if (!H.serveStatic(photos.classDir(album.class_id), ctx.req, ctx.res, '/' + file, [], { cache: 'private, max-age=604800' })) notFound(ctx);
  });

  r.post('/f/:slug/me', ctx => {
    const p = pickCtx(ctx);
    if (!p) return H.json(ctx.res, 404, { error: 'not_found' });
    const b = ctx.body || {};
    let s = photos.student(p.cls.id, +b.student);
    if (!s) return H.json(ctx.res, 400, { error: 'Такого ученика нет в списке' });
    // Артур из админки входит за ученика без кода
    if (!p.admin) {
      const key = 'pin:' + s.id;
      if (s.pin) {
        if (pinLimit.blocked(key)) return H.json(ctx.res, 429, { error: 'Слишком много попыток. Подождите 15 минут или спросите код у Артура', pin: 'ask' });
        if (String(b.pin || '') !== s.pin) {
          pinLimit.hit(key);
          return H.json(ctx.res, 403, { error: b.pin ? 'Неверный код. Забыли — спросите у Артура' : 'Введите код', pin: 'ask' });
        }
        pinLimit.reset(key);
      } else {
        if (!PIN_RE.test(String(b.newPin || ''))) return H.json(ctx.res, 400, { error: 'Придумайте код из 4 цифр', pin: 'new' });
        // Код успел придумать кто-то другой (два человека выбрали одно имя одновременно)
        if (!photos.setPin(p.cls.id, s.id, b.newPin)) return H.json(ctx.res, 409, { error: 'Под этим именем только что вошли и придумали код. Если это не вы — напишите Артуру', pin: 'ask' });
        s = photos.student(p.cls.id, s.id);
      }
    } else if (!s.pin) {
      // за ученика без кода Артур входит без cookie-подписи — подпись требует кода
      return H.json(ctx.res, 400, { error: 'Ученик ещё не входил и не придумал код' });
    }
    H.setCookie(ctx.res, PK_COOKIE(p.cls.id), pkCookie(s), cookieOpts(ctx, YEAR));
    p.me = s;
    H.json(ctx.res, 200, pickState(p));
  });

  r.post('/f/:slug/leave', ctx => {
    const p = pickCtx(ctx);
    if (!p) return H.json(ctx.res, 404, { error: 'not_found' });
    H.setCookie(ctx.res, PK_COOKIE(p.cls.id), '', cookieOpts(ctx, 0));
    p.me = null;
    H.json(ctx.res, 200, pickState(p));
  });

  function pickWrite(name, fn) {
    r.post('/f/:slug/' + name, ctx => {
      const p = pickCtx(ctx);
      if (!p) return H.json(ctx.res, 404, { error: 'not_found' });
      if (!pickLimit.hit((p.me ? 's' + p.me.id : 'a') + ':' + ctx.ip)) return H.json(ctx.res, 429, { error: 'Слишком часто. Подождите минуту' });
      if (p.album.closed_at && !p.admin) return H.json(ctx.res, 409, { error: 'Отбор уже закрыт', state: pickState(p) });
      const res = fn(ctx, p, ctx.body || {});
      if (res && res.error) return H.json(ctx.res, res.status || 400, { error: res.error, state: pickState(p) });
      H.json(ctx.res, 200, pickState(p));
    });
  }

  pickWrite('pick', (ctx, p, b) => {
    if (!p.me) return { error: 'Сначала выберите себя в списке', status: 403 };
    const ph = photos.photo(p.cls.id, b.photo);
    if (!ph || photos.isGroupSection(p.album, ph.section) || photos.isTeacherSection(ph.section)) return { error: 'Фото не найдено' };
    const res = photos.setPersonal(p.album, p.me.id, ph.id, !!b.on);
    if (!res.ok) return { error: 'Уже выбрано ' + p.album.personal_max + ' фото. Чтобы выбрать это, уберите какое-то из выбранных', status: 409 };
  });

  pickWrite('group', (ctx, p, b) => {
    if (!p.me && !p.admin) return { error: 'Сначала выберите себя в списке', status: 403 };
    const ph = photos.photo(p.cls.id, b.photo);
    if (!ph || !photos.isGroupSection(p.album, ph.section)) return { error: 'Фото не найдено' };
    const res = photos.setGroup(p.album, ph.id, !!b.on, p.me ? p.me.id : null, p.me ? p.me.name : 'Артур');
    if (!res.ok) return { error: 'Уже выбрано ' + p.album.group_max + ' групповых — это максимум. Чтобы добавить это фото, сначала уберите другое', status: 409 };
  });

  pickWrite('quote', (ctx, p, b) => {
    if (!p.me) return { error: 'Сначала выберите себя в списке', status: 403 };
    const before = p.me.quote;
    p.me.quote = photos.setQuote(p.cls.id, p.me.id, b.text);
    // дизайнер уже начала — у неё появится правка «Заменить цитату»
    if (p.me.quote !== before) work.studentQuote(p.cls.id, p.me, p.me.quote);
  });

  pickWrite('wish', (ctx, p, b) => {
    if (!p.me) return { error: 'Сначала выберите себя в списке', status: 403 };
    p.me.wish = photos.setWish(p.cls.id, p.me.id, b.text);
  });

  pickWrite('role', (ctx, p, b) => {
    if (!p.me) return { error: 'Сначала выберите себя в списке', status: 403 };
    const res = photos.setRole(p.album, p.me.id, String(b.photo || ''), String(b.role || ''));
    if (!res.ok) return { error: 'Сначала выберите это фото' };
  });

  pickWrite('retouch', (ctx, p, b) => {
    if (!p.me) return { error: 'Сначала выберите себя в списке', status: 403 };
    const res = photos.setRetouch(p.album, p.me.id, String(b.photo || ''), b.text);
    if (!res.ok) return { error: 'Сначала выберите это фото' };
  });

  // ----- классный руководитель: /kr/:token — своя простая ссылка, без кода -----
  // Выбирает только из папки «кл рук»: фото на обложку, фото в общий список и пишет пожелание классу
  function teacherCtx(ctx) {
    const album = photos.albumByTeacher(ctx.params.token);
    const cls = album ? store.getClass(album.class_id) : null;
    return cls ? { album: album, cls: cls } : null;
  }

  function teacherState(t) {
    const a = photos.album(t.cls.id);
    const picks = photos.teacherPicks(a);
    return {
      cover: picks.cover ? picks.cover.id : '', list: picks.list ? picks.list.id : '',
      wish: a.teacher_wish, name: a.teacher_name, closed: !!a.closed_at, done: photos.teacherDone(a)
    };
  }

  r.get('/kr/:token', ctx => {
    const t = teacherCtx(ctx);
    if (!t) return notFound(ctx);
    const list = photos.teacherPhotos(t.cls.id);
    H.send(ctx.res, 200, PV.teacherPage({ cls: t.cls, album: t.album, photos: list, state: teacherState(t), token: ctx.params.token, layoutReady: !!layout.ready(t.cls.id) }), 'text/html; charset=utf-8', {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
  });

  r.post('/kr/:token/save', ctx => {
    const t = teacherCtx(ctx);
    if (!t) return H.json(ctx.res, 404, { error: 'Ссылка не работает. Попросите у Артура новую' });
    if (!pickLimit.hit('kr' + t.cls.id + ':' + ctx.ip)) return H.json(ctx.res, 429, { error: 'Слишком часто. Подождите минуту' });
    if (t.album.closed_at) return H.json(ctx.res, 409, { error: 'Выбор уже закрыт. Если нужно что-то поменять, напишите Артуру', state: teacherState(t) });
    const b = ctx.body || {};
    const f = {};
    ['cover', 'list', 'wish', 'name'].forEach(k => { if (k in b) f[k] = b[k]; });
    const before = photos.album(t.cls.id).teacher_wish;
    const res = photos.setTeacher(t.cls.id, f);
    if (res.error) return H.json(ctx.res, 400, { error: res.error, state: teacherState(t) });
    // дизайнер уже начала, а пожелание поменялось — у неё появится правка
    if ('wish' in f && photos.album(t.cls.id).teacher_wish !== before) work.teacherWish(t.cls.id, photos.album(t.cls.id).teacher_wish);
    H.json(ctx.res, 200, teacherState(t));
  });

  // Альбом классного руководителя: обложка с номером после всех учеников, правки и «всё верно».
  // Своя ссылка, без кода, как и выбор фото
  function teacherAlbum(cls, lay, list, o) {
    const album = photos.album(cls.id);
    const fixes = o.view ? [] : work.fixes(cls.id).filter(f => f.kind === 'layout' && !f.student_id && f.student_name === TEACHER_LABEL);
    return LV.albumPage({
      cls: cls, lay: lay, me: { name: album.teacher_name || TEACHER_LABEL }, num: list.length + 1, teacher: true,
      admin: !!o.view, view: !!o.view, fixes: fixes, ok: !o.view && !!lay.teacher_ok_at, api: o.api
    });
  }

  r.get('/kr/:token/album', ctx => {
    const t = teacherCtx(ctx);
    if (!t) return notFound(ctx);
    const lay = layout.ready(t.cls.id);
    if (!lay) return albumSend(ctx, LV.albumNotReady({ cls: t.cls, teacher: true }));
    const base = '/kr/' + ctx.params.token;
    albumSend(ctx, teacherAlbum(t.cls, lay, numbered(photos.students(t.cls.id)), {
      api: { files: base + '/lay/' + lay.ver + '/', fix: base + '/album/fix', ok: base + '/album/ok' }
    }));
  });

  r.get('/kr/:token/lay/:ver/:file', ctx => {
    const t = teacherCtx(ctx);
    if (!t) return notFound(ctx);
    sendLayFile(ctx, t.cls.id);
  });

  function teacherAlbumWrite(name, fn) {
    r.post('/kr/:token/album/' + name, ctx => {
      const t = teacherCtx(ctx);
      if (!t) return H.json(ctx.res, 404, { error: 'Ссылка не работает. Попросите у Артура новую' });
      if (!pickLimit.hit('kra' + t.cls.id + ':' + ctx.ip)) return H.json(ctx.res, 429, { error: 'Слишком часто. Подождите минуту' });
      const lay = layout.ready(t.cls.id);
      if (!lay) return H.json(ctx.res, 409, { error: 'Макет обновляется. Обновите страницу' });
      const res = fn(ctx.body || {}, t, lay);
      H.json(ctx.res, res.error ? 400 : 200, res);
    });
  }

  teacherAlbumWrite('fix', (b, t, lay) => {
    const fx = layoutFix(b, lay);
    if (fx.error) return fx;
    const who = t.album.teacher_name || TEACHER_LABEL;
    const res = work.addFix(t.cls.id, { studentName: TEACHER_LABEL, kind: 'layout', text: fx.text, who: who, auto: true });
    if (res.error) return res;
    layout.setTeacherOk(t.cls.id, false);
    return { ok: true };
  });

  teacherAlbumWrite('ok', (b, t) => {
    const on = b.on !== false && b.on !== 0 && b.on !== '0';
    layout.setTeacherOk(t.cls.id, on);
    if (on) work.event(t.cls.id, t.album.teacher_name || TEACHER_LABEL, 'проверил(а) альбом: всё верно');
    return { ok: true };
  });

  // ---------- работа над альбомами ----------
  // Артур: /admin/work и /admin/c/:id/work. Дизайнер: /d/:token — личная ссылка без пароля

  // Отбор фото класса для доски и страниц: кто закончил, ждут ли ретуши, что выбрали
  function pkInfo(cls) {
    const album = photos.album(cls.id);
    if (!album) return null;
    const students = photos.students(cls.id);
    const all = photos.personalByStudent(album);
    const picks = new Map(students.map(s => [s.id, all.get(s.id) || []]));
    const rolesNeed = Math.min(ROLES.length, album.personal_max);
    const finished = s => {
      const list = picks.get(s.id);
      return list.length >= album.personal_max && list.filter(x => x.role).length >= rolesNeed && !!s.quote && !!s.wish;
    };
    return {
      album: album, students: students, picks: picks,
      total: students.length,
      done: students.filter(finished).length,
      closed: !!album.closed_at,
      retouchWait: students.filter(s => picks.get(s.id).some(x => x.retouch) && !s.retouch_done_at).length,
      // классный руководитель: есть ли его папка и выбрал ли он всё
      teacher: { n: photos.teacherCount(cls.id), done: photos.teacherDone(album) }
    };
  }
  // То же, плюс фото по id и групповые — для страницы класса
  function pkFull(cls) {
    const pk = pkInfo(cls);
    if (!pk) return null;
    const list = photos.photos(cls.id);
    pk.byId = new Map(list.map(ph => [ph.id, ph]));
    pk.group = photos.group(cls.id, pk.album).map(g => pk.byId.get(g.photo_id)).filter(Boolean);
    pk.teacher.picks = photos.teacherPicks(pk.album, pk.byId);
    pk.teacher.name = pk.album.teacher_name;
    pk.teacher.wish = pk.album.teacher_wish;
    return pk;
  }

  // Сезон сейчас: с июля начинается учебный год, выпуск — следующей весной
  function currentSeason() {
    const p = tzParts(Date.now());
    return p.month >= 7 ? p.year + 1 : p.year;
  }
  // Сегодня по времени студии, «2026-10-14»: даты съёмок сравниваем с ним
  function today() {
    const p = tzParts(Date.now());
    return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
  }

  // Съёмки, у которых дата прошла, отмечаются сами — перед тем как показать классы
  function syncShoots() {
    const p = tzParts(Date.now());
    work.autoShoots(today(), p.hour * 60 + p.minute);
  }

  // noPick: вкладкам «Деньги» и «Телефоны» отбор фото не нужен — не считаем его, так быстрее
  function workRows(filter, withArchive, noPick) {
    syncShoots();
    const all = work.all();
    const open = work.openCounts();
    return store.listClasses().filter(c => withArchive || !c.archived).map(c => {
      const w = all.get(c.id) || work.get(c.id);
      const pk = noPick ? null : pkInfo(c);
      return { c: c, w: w, pk: pk, open: open.get(c.id) || 0, half: half(c, w), m: work.money(w, c, pk ? pk.total : 0) };
    }).filter(filter || (() => true));
  }

  // Сезон и половина из адреса. Без года — текущий сезон, а если в нём пусто — последний, где есть классы
  function seasonCtx(ctx, rows) {
    const counts = {};
    rows.forEach(r => { counts[r.c.year] = (counts[r.c.year] || 0) + 1; });
    let year = parseInt(ctx.q('year'), 10);
    if (!(year >= 2020 && year <= 2100)) {
      year = currentSeason();
      if (!counts[year]) {
        const have = Object.keys(counts).map(Number).filter(y => y <= year).sort();
        if (have.length) year = have[have.length - 1];
        else if (Object.keys(counts).length) year = Math.min.apply(null, Object.keys(counts).map(Number));
      }
    }
    const h = HALF_NAMES[ctx.q('half')] ? ctx.q('half') : '';
    const inYear = rows.filter(r => +r.c.year === year);
    const years = Array.from(new Set(Object.keys(counts).map(Number).concat(currentSeason(), year))).sort();
    return {
      year: year, half: h, years: years, counts: counts, inYear: inYear,
      rows: inYear.filter(r => !h || r.half === h),
      halves: { all: inYear.length, autumn: inYear.filter(r => r.half === 'autumn').length, spring: inYear.filter(r => r.half === 'spring').length }
    };
  }

  r.get('/admin/work', ctx => {
    const sc = seasonCtx(ctx, workRows());
    // Сортировка: недавно открытые (по умолчанию) или по дате бронирования — в этом порядке Артур
    // раздаёт даты съёмок. Выбор запоминается
    let sort = ctx.q('sort');
    if (sort === 'added' || sort === 'recent') H.setCookie(ctx.res, 'wsort', sort, cookieOpts(ctx, YEAR));
    else sort = ctx.cookies.wsort === 'added' ? 'added' : 'recent';
    const t = today();
    sc.rows.sort(sort === 'added' ? byAdded : byViewed);
    page(ctx, 200, WV.boardPage(Object.assign(sc, {
      sess: ctx.sess, msg: ctx.q('m'), base: baseUrl(ctx), today: t, designers: work.designers(), templates: work.templates(), newLeads: work.newLeads(), by: ctx.q('by') === 'school' ? 'school' : '', sort: sort
    })));
  });

  const byAdded = (a, b) => (a.c.created_at - b.c.created_at) || (a.c.id - b.c.id);
  // недавно открытые в админке сверху, ни разу не открытые — по дате бронирования
  const byViewed = (a, b) => ((b.c.viewed_at || 0) - (a.c.viewed_at || 0)) || byAdded(a, b);

  r.get('/admin/work/phones', ctx => {
    const rows = workRows(null, false, true).sort(byAdded);
    page(ctx, 200, WV.phonesPage({ sess: ctx.sess, rows: rows, newLeads: work.newLeads() }));
  });

  // ----- деньги за сезон, осень и весну -----
  function moneyTotals(rows, deliveries) {
    const t = { students: 0, total: 0, prepay: 0, prepaidN: 0, paid: 0, paidUpN: 0, rest: 0, restNet: 0, print: 0, designer: 0, proc: {}, smm: 0, costs: 0, profit: 0, notReady: [] };
    rows.forEach(r => {
      const m = r.m;
      if (m.prepaid) { t.prepay += m.prepay; t.prepaidN++; }
      t.paid += m.paid;
      if (!m.ready) { t.notReady.push(r); return; }
      if (m.paidUp) t.paidUpN++;
      t.students += m.students;
      t.total += m.total;
      t.rest += Math.max(0, m.rest);
      t.restNet += m.restNet;
      t.print += m.printAll;
      t.designer += m.designer;
      if (m.proc) t.proc[m.processor] = (t.proc[m.processor] || 0) + m.proc;
      t.smm += m.smm;
      t.costs += m.costs;
      t.profit += m.profit;
    });
    t.delivery = deliveries.reduce((n, d) => n + d.amount, 0);
    t.final = t.profit - t.delivery;
    return t;
  }

  function moneyView(ctx, extra) {
    const sc = seasonCtx(ctx, workRows(null, true, true));
    sc.rows.sort(byAdded);
    const deliveries = work.deliveries(sc.year);
    const byHalf = h => sc.inYear.filter(r => r.half === h);
    // доставка без пометки (старые записи) идёт только в итог сезона
    const totals = {
      all: moneyTotals(sc.inYear, deliveries),
      autumn: moneyTotals(byHalf('autumn'), deliveries.filter(d => d.half === 'autumn')),
      spring: moneyTotals(byHalf('spring'), deliveries.filter(d => d.half === 'spring'))
    };
    const p = tzParts(Date.now());
    return WV.moneyPage(Object.assign(sc, {
      sess: ctx.sess, msg: ctx.q('m'), se: work.season(sc.year), deliveries: deliveries, totals: totals, newLeads: work.newLeads(),
      defaultHalf: p.month >= 7 ? 'autumn' : 'spring'
    }, extra || {}));
  }

  r.get('/admin/work/money', ctx => page(ctx, 200, moneyView(ctx)));

  // старый адрес первой версии
  r.get('/admin/work/season/:year', ctx => H.redirect(ctx.res, '/admin/work/money?year=' + (parseInt(ctx.params.year, 10) || '')));

  const seasonOf = ctx => { const y = parseInt(ctx.params.year, 10); return y >= 2020 && y <= 2100 ? y : 0; };

  r.post('/admin/work/money/:year', ctx => {
    const y = seasonOf(ctx);
    if (!y) return notFound(ctx);
    work.setSeason(y, ctx.form);
    back(ctx, '/admin/work/money?year=' + y + '#prices', 'prices');
  });

  r.post('/admin/work/money/:year/delivery', ctx => {
    const y = seasonOf(ctx);
    if (!y) return notFound(ctx);
    if (!work.addDelivery(y, ctx.form.amount, ctx.form.note, ctx.form.half)) {
      ctx.url.searchParams.set('year', y);
      return page(ctx, 400, moneyView(ctx, { err: 'Напишите сумму доставки' }));
    }
    back(ctx, '/admin/work/money?year=' + y + '#delivery', 'delivery');
  });

  r.post('/admin/work/money/:year/delivery/:id/delete', ctx => {
    const y = seasonOf(ctx);
    if (!y) return notFound(ctx);
    work.removeDelivery(parseInt(ctx.params.id, 10) || 0);
    back(ctx, '/admin/work/money?year=' + y + '#delivery', 'deliverydel');
  });

  // ----- лиды -----
  function leadsView(ctx, extra) {
    const classes = new Map(store.listClasses().map(c => [c.id, c]));
    return WV.leadsPage(Object.assign({ sess: ctx.sess, msg: ctx.q('m'), leads: work.leads(), classes: classes }, extra || {}));
  }
  r.get('/admin/work/leads', ctx => page(ctx, 200, leadsView(ctx)));

  r.post('/admin/work/leads', ctx => {
    const res = work.addLead(ctx.form);
    if (res.error) return page(ctx, 400, leadsView(ctx, { err: res.error, form: ctx.form }));
    back(ctx, '/admin/work/leads', 'lead');
  });

  r.post('/admin/work/leads/:id', ctx => {
    const id = parseInt(ctx.params.id, 10) || 0;
    if (ctx.form.delete) work.removeLead(id);
    else work.updateLead(id, { status: String(ctx.form.status || '') });
    back(ctx, '/admin/work/leads#lead-' + id, ctx.form.delete ? 'leaddel' : 'saved');
  });

  r.post('/admin/work/templates', ctx => {
    work.setTemplates(ctx.form);
    back(ctx, '/admin/work#templates', 'templates');
  });

  r.post('/admin/work/designer', ctx => {
    if (!work.addDesigner(ctx.form.name)) return back(ctx, '/admin/work#designers');
    back(ctx, '/admin/work#designers', 'designer');
  });

  r.post('/admin/work/designer/:id/delete', ctx => {
    work.removeDesigner(parseInt(ctx.params.id, 10) || 0);
    back(ctx, '/admin/work#designers', 'designerdel');
  });

  function workData(ctx, cls, extra) {
    syncShoots();
    const w = work.get(cls.id);
    const pk = pkFull(cls);
    return Object.assign({
      sess: ctx.sess, msg: ctx.q('m'), cls: cls, w: w, pk: pk, half: half(cls, w), today: today(),
      lay: (d => ({ ver: d.lay ? d.lay.ver : 0, checked: d.checked, total: d.list.length, fixes: Array.from(d.fixCount.values()).reduce((a, b) => a + b, 0) }))(layoutData(cls)),
      m: work.money(w, cls, pk ? pk.total : 0), se: work.season(cls.year),
      fixes: work.fixes(cls.id), files: work.filesByFix(cls.id), notes: work.notes(cls.id),
      templates: work.templates(), base: baseUrl(ctx)
    }, extra || {});
  }
  const workView = (ctx, cls, extra) => WV.classPage(workData(ctx, cls, extra));

  r.get('/admin/c/:id/work', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    page(ctx, 200, workView(ctx, cls));
  });

  r.get('/admin/c/:id/work/money', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    page(ctx, 200, WV.classMoneyPage(workData(ctx, cls)));
  });

  // Галочка этапа — без перезагрузки страницы
  r.post('/admin/api/c/:id/work/step', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return H.json(ctx.res, 404, { error: 'Класс не найден' });
    const b = ctx.body || {};
    if (!work.setStep(cls.id, String(b.step || ''), !!b.on, 'Артур')) return H.json(ctx.res, 400, { error: 'Этот пункт отмечается сам' });
    const w = work.get(cls.id);
    const sg = stageOf(w);
    H.json(ctx.res, 200, { ok: true, stage: sg.index, done: sg.done, total: sg.total, next: sg.next, finished: sg.finished });
  });

  r.get('/admin/c/:id/work/quotes.csv', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    sendQuotes(ctx, cls);
  });

  function wact(name, fn) {
    r.post('/admin/c/:id/work/' + name, ctx => {
      const cls = loadClass(ctx);
      if (!cls) return notFound(ctx);
      fn(ctx, cls);
    });
  }
  const wback = (ctx, cls, msg, hash) => back(ctx, '/admin/c/' + cls.id + '/work' + (hash ? '#' + hash : ''), msg);

  wact('status', (ctx, cls) => {
    work.setStatus(cls.id, String(ctx.form.status || ''), 'Артур');
    wback(ctx, cls, 'status');
  });

  wact('parts', (ctx, cls) => {
    const on = new Set([].concat(ctx.form.part || []));
    Object.keys(PART_NAMES).forEach(k => work.setPart(cls.id, k, on.has(k), 'Артур'));
    wback(ctx, cls, 'saved');
  });

  wact('info', (ctx, cls) => {
    work.updateInfo(cls.id, ctx.form);
    wback(ctx, cls, 'saved', 'info');
  });

  wact('money', (ctx, cls) => {
    work.updateMoney(cls.id, ctx.form);
    back(ctx, '/admin/c/' + cls.id + '/work/money#money', 'saved');
  });

  wact('tg', (ctx, cls) => {
    if (!work.setTg(cls.id, ctx.form.tg)) return page(ctx, 400, workView(ctx, cls, { err: 'Нужна ссылка на группу в Telegram: t.me/… или @имя группы' }));
    back(ctx, '/admin/c/' + cls.id + '/work#group', 'saved');
  });

  wact('half', (ctx, cls) => {
    work.setHalf(cls.id, String(ctx.form.half || ''));
    back(ctx, '/admin/c/' + cls.id + '/work' + (ctx.form.back === 'money' ? '/money' : ''), 'saved');
  });

  wact('date', (ctx, cls) => {
    const res = work.addDate(cls.id, { d: ctx.form.d, t: ctx.form.t, kind: ctx.form.kind, note: ctx.form.note });
    if (res.error) return page(ctx, 400, workView(ctx, cls, { err: res.error }));
    wback(ctx, cls, 'date', 'dates');
  });

  wact('datedel', (ctx, cls) => {
    work.removeDate(cls.id, parseInt(ctx.form.i, 10));
    wback(ctx, cls, 'datedel', 'dates');
  });

  wact('contacts', (ctx, cls) => {
    work.setContacts(cls.id, ctx.form.pname, ctx.form.phone);
    wback(ctx, cls, 'contacts', 'contacts');
  });

  wact('fix', (ctx, cls) => {
    const sid = parseInt(ctx.form.student, 10) || 0;
    const st = sid ? photos.student(cls.id, sid) : null;
    if (sid && !st) return page(ctx, 400, workView(ctx, cls, { err: 'Ученик не найден. Обновите страницу' }));
    const res = work.addFix(cls.id, { studentId: st ? st.id : null, studentName: st ? st.name : '', kind: String(ctx.form.kind || ''), text: ctx.form.text, who: 'Артур' });
    if (res.error) return page(ctx, 400, workView(ctx, cls, { err: res.error }));
    wback(ctx, cls, 'fix', 'fixes');
  });

  wact('fixdone', (ctx, cls) => {
    work.setFixDone(cls.id, parseInt(ctx.form.fix, 10) || 0, ctx.form.on === '1', 'Артур');
    wback(ctx, cls, 'fixdone', 'fixes');
  });

  wact('fixdel', (ctx, cls) => {
    work.deleteFix(cls.id, parseInt(ctx.form.fix, 10) || 0);
    wback(ctx, cls, 'fixdel', 'fixes');
  });

  // Название класса, школа и город — прямо со страницы работы
  wact('rename', (ctx, cls) => {
    const school = str(ctx.form.school, 60), title = str(ctx.form.title, 40);
    if (!school || !title) return page(ctx, 400, workView(ctx, cls, { err: 'Заполните школу и класс' }));
    store.updateClass(cls.id, { school: school, title: title });
    work.setCity(cls.id, ctx.form.city);
    wback(ctx, cls, 'saved');
  });

  wact('probe', (ctx, cls) => {
    const res = work.addProbe(cls.id, ctx.form.name);
    if (res.error) return page(ctx, 400, WV.classMoneyPage(workData(ctx, cls, { err: res.error })));
    back(ctx, '/admin/c/' + cls.id + '/work/money#probes', 'probe');
  });

  wact('probedel', (ctx, cls) => {
    work.removeProbe(cls.id, parseInt(ctx.form.i, 10));
    back(ctx, '/admin/c/' + cls.id + '/work/money#probes', 'probedel');
  });

  // Оплата после предоплаты: сумма или пусто — весь остаток
  wact('pay', (ctx, cls) => {
    const w = work.get(cls.id);
    const m = work.money(w, cls, 0);
    const res = work.addPayment(cls.id, ctx.form.sum, ctx.form.note, m.rest);
    if (res.error) return page(ctx, 400, WV.classMoneyPage(workData(ctx, cls, { err: res.error })));
    back(ctx, '/admin/c/' + cls.id + '/work/money#pay', 'pay');
  });

  wact('paydel', (ctx, cls) => {
    work.removePayment(cls.id, parseInt(ctx.form.i, 10));
    back(ctx, '/admin/c/' + cls.id + '/work/money#pay', 'paydel');
  });

  // Правка с фото: сначала сама правка (JSON), потом фото по одному
  r.post('/admin/api/c/:id/work/fix', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return H.json(ctx.res, 404, { error: 'Класс не найден' });
    const b = ctx.body || {};
    const sid = parseInt(b.student, 10) || 0;
    const st = sid ? photos.student(cls.id, sid) : null;
    if (sid && !st) return H.json(ctx.res, 400, { error: 'Ученик не найден. Обновите страницу' });
    const res = work.addFix(cls.id, { studentId: st ? st.id : null, studentName: st ? st.name : '', kind: String(b.kind || ''), text: b.text, who: 'Артур', files: +b.files || 0 });
    if (res.error) return H.json(ctx.res, 400, { error: res.error });
    H.json(ctx.res, 200, { ok: true, id: res.id });
  });

  // Под /admin/api/media/…: для этого пути nginx разрешает большие файлы
  r.post('/admin/api/media/fix/:id/:fid', async ctx => {
    const cls = loadClass(ctx);
    if (!cls) { ctx.req.resume(); return H.json(ctx.res, 404, { error: 'Класс не найден' }); }
    const buf = await readFile(ctx.req, FILE_MAX);
    const res = work.saveFixFile(cls.id, parseInt(ctx.params.fid, 10) || 0, String(ctx.q('label') || ''), buf);
    if (res.error) return H.json(ctx.res, 400, { error: res.error });
    H.json(ctx.res, 200, res);
  }, { raw: true });

  function sendFixFile(ctx, cls) {
    const m = /^([a-z0-9]{16})\.jpg$/.exec(String(ctx.params.file || ''));
    const f = m ? work.fixFile(cls.id, m[1]) : null;
    if (!f || !H.serveStatic(work.fileDir(cls.id), ctx.req, ctx.res, '/' + f.id + '.jpg', [], { cache: 'private, max-age=604800' })) notFound(ctx);
  }

  r.get('/admin/c/:id/work/file/:file', ctx => {
    const cls = loadClass(ctx);
    if (!cls) return notFound(ctx);
    sendFixFile(ctx, cls);
  });

  wact('note', (ctx, cls) => {
    work.addNote(cls.id, 'Артур', ctx.form.text);
    wback(ctx, cls, 'note', 'notes');
  });

  function sendQuotes(ctx, cls) {
    const name = 'Цитаты ' + cls.title + ' ' + cls.school + '.csv';
    H.send(ctx.res, 200, WV.quotesCsv(photos.students(cls.id)), 'text/csv; charset=utf-8', {
      'Cache-Control': 'no-store',
      'Content-Disposition': "attachment; filename=\"quotes.csv\"; filename*=UTF-8''" + encodeURIComponent(name)
    });
  }

  // ----- кабинет дизайнера -----
  // Видит все классы сразу после записи: по фотоаппарату видно, была ли съёмка. Архив не видит
  const forDesigner = () => true;

  function dpage(ctx, body) {
    H.send(ctx.res, 200, body, 'text/html; charset=utf-8', {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
  }

  function designerCtx(ctx) {
    const d = work.designerByToken(ctx.params.token);
    if (!d) {
      H.send(ctx.res, 404, WV.designerGone(), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
      return null;
    }
    return d;
  }

  // Класс, который дизайнер может открыть
  function designerClass(ctx) {
    const id = parseInt(ctx.params.id, 10);
    const cls = id ? store.getClass(id) : null;
    if (!cls || cls.archived) return null;
    const w = work.get(cls.id);
    const pk = pkInfo(cls);
    return forDesigner({ w: w, pk: pk }) ? cls : null;
  }

  r.get('/d/:token', ctx => {
    const d = designerCtx(ctx);
    if (!d) return;
    dpage(ctx, WV.designerHome({ designer: d, rows: workRows(forDesigner), today: today() }));
  });

  r.get('/d/:token/c/:id', ctx => {
    const d = designerCtx(ctx);
    if (!d) return;
    const cls = designerClass(ctx);
    if (!cls) return H.redirect(ctx.res, '/d/' + d.token);
    dpage(ctx, WV.designerClass({ designer: d, cls: cls, w: work.get(cls.id), pk: pkFull(cls), fixes: work.fixes(cls.id), files: work.filesByFix(cls.id), notes: work.notes(cls.id, 80, true), today: today() }));
  });

  r.get('/d/:token/c/:id/quotes.csv', ctx => {
    const d = designerCtx(ctx);
    if (!d) return;
    const cls = designerClass(ctx);
    if (!cls) return notFound(ctx);
    sendQuotes(ctx, cls);
  });

  r.get('/d/:token/c/:id/file/:file', ctx => {
    const d = designerCtx(ctx);
    if (!d) return;
    const cls = designerClass(ctx);
    if (!cls) return notFound(ctx);
    sendFixFile(ctx, cls);
  });

  const designerLimit = new Limiter(300, 10 * 60 * 1000);
  function dact(name, fn) {
    r.post('/d/:token/c/:id/' + name, ctx => {
      const d = work.designerByToken(ctx.params.token);
      if (!d) return H.json(ctx.res, 403, { error: 'Ссылка больше не работает. Попросите у Артура новую' });
      if (!designerLimit.hit('d' + d.id)) return H.json(ctx.res, 429, { error: 'Слишком часто. Подождите минуту' });
      const cls = designerClass(ctx);
      if (!cls) return H.json(ctx.res, 404, { error: 'Класс не найден' });
      const res = fn(ctx.body || {}, cls, d);
      if (res && res.error) return H.json(ctx.res, 400, { error: res.error });
      H.json(ctx.res, 200, { ok: true });
    });
  }

  dact('status', (b, cls, d) => {
    if (DESIGNER_STATUSES.indexOf(String(b.status)) === -1) return { error: 'Этот статус ставит Артур' };
    work.setStatus(cls.id, String(b.status), d.name);
  });

  dact('part', (b, cls, d) => {
    if (!PART_NAMES[b.part]) return { error: 'Нет такой отметки' };
    work.setPart(cls.id, b.part, !!b.on, d.name);
  });

  dact('fixdone', (b, cls, d) => {
    if (!work.setFixDone(cls.id, parseInt(b.fix, 10) || 0, b.on !== false && b.on !== '0', d.name) && !work.fix(cls.id, parseInt(b.fix, 10) || 0)) return { error: 'Правка не найдена. Обновите страницу' };
  });

  dact('note', (b, cls, d) => {
    if (!work.addNote(cls.id, d.name, b.text)) return { error: 'Напишите сообщение' };
  });

  // ---------- своя статистика ----------
  // Браузер шлёт /s/v (открыли страницу), /s/u (сколько пробыли и где), /s/c (нажали кнопку).
  // Артура, когда он вошёл в админку, не считаем
  const statLimit = new Limiter(1500, 10 * 60 * 1000);

  function statPage(p) {
    p = String(p || '');
    if (p === '/' || p === '') return { page: 'index.html', kind: 'site' };
    const f = p.replace(/^\//, '');
    if (SITE_PAGES.indexOf(f) !== -1) return { page: f, kind: 'site' };
    let m = /^\/k\/([A-Za-z0-9-]{1,80})\/?$/.exec(p);
    if (m) { const c = store.getClassBySlug(m[1]); return c ? { page: '/k/' + c.slug, kind: 'class', classId: c.id } : null; }
    m = /^\/f\/([A-Za-z0-9-]{1,80})\/?$/.exec(p);
    if (m) { const a = photos.albumBySlug(m[1]); return a ? { page: '/f/' + a.slug, kind: 'pick', classId: a.class_id } : null; }
    return null;
  }

  function statGuard(ctx) {
    if (!statLimit.hit(ctx.ip)) { H.json(ctx.res, 429, { error: 'busy' }); return false; }
    if (auth.session(ctx.cookies.rs)) { H.json(ctx.res, 200, { id: 0 }); return false; }
    return true;
  }

  r.post('/s/v', ctx => {
    if (!statGuard(ctx)) return;
    const b = ctx.body || {};
    const pg = statPage(b.p);
    if (!pg) return H.json(ctx.res, 200, { id: 0 });
    let host = '';
    try { host = cfg.siteUrl ? new URL(cfg.siteUrl).hostname : String(ctx.req.headers.host || '').split(':')[0]; } catch (e) {}
    const id = stats.start(Object.assign({}, pg, {
      search: String(b.q || '').slice(0, 300), ref: String(b.r || '').slice(0, 500), vid: String(b.v || ''),
      w: +b.w || 0, ua: String(ctx.req.headers['user-agent'] || '').slice(0, 300), ip: ctx.ip, host: host.replace(/^www\./, '')
    }));
    H.json(ctx.res, 200, id ? { id: id, k: stats.key(id) } : { id: 0 });
  });

  function statAct(name, fn) {
    r.post('/s/' + name, ctx => {
      if (!statGuard(ctx)) return;
      const b = ctx.body || {};
      const id = parseInt(b.id, 10) || 0;
      if (!id || !stats.keyOk(id, b.k)) return H.json(ctx.res, 400, { error: 'bad' });
      fn(id, b);
      H.json(ctx.res, 200, { ok: true });
    });
  }
  statAct('u', (id, b) => stats.update(id, b));
  statAct('c', (id, b) => stats.click(id, b));

  // ----- статистика в админке -----
  const PERIODS = { today: 1, 7: 7, 30: 30, 90: 90 };
  function onlineData() {
    const list = stats.onlineNow();
    const names = {};
    const byClass = {};
    list.filter(x => x.classId).forEach(x => {
      if (!names[x.classId]) { const c = store.getClass(x.classId); names[x.classId] = c ? c.title + ' ' + c.school : 'класс'; }
      const k = x.classId + ':' + x.kind;
      byClass[k] = byClass[k] || { name: names[x.classId], kind: x.kind, n: 0 };
      byClass[k].n++;
    });
    const pages = {};
    list.filter(x => x.kind === 'site').forEach(x => { pages[x.page] = (pages[x.page] || 0) + 1; });
    return {
      total: list.length,
      site: list.filter(x => x.kind === 'site').length,
      vote: list.filter(x => x.kind === 'class').length,
      pick: list.filter(x => x.kind === 'pick').length,
      pages: pages,
      classes: Object.values(byClass).sort((a, b) => b.n - a.n)
    };
  }

  function statsView(ctx, extra) {
    const period = PERIODS[ctx.q('period')] ? ctx.q('period') : '7';
    const n = PERIODS[period];
    const to = statDay(Date.now());
    const from = statDay(Date.now() - (n - 1) * 86400000);
    const rep = stats.report(from, to);
    const classNames = {};
    rep.classes.forEach(x => { const c = store.getClass(x.classId); classNames[x.classId] = c ? { title: c.title, school: c.school, id: c.id } : null; });
    const page = SITE_PAGES.indexOf(ctx.q('page')) !== -1 ? ctx.q('page') : (rep.pages[0] ? rep.pages[0].page : 'index.html');
    return SV.statsPage(Object.assign({
      sess: ctx.sess, msg: ctx.q('m'), period: period, from: from, to: to, rep: rep, page: page,
      online: onlineData(), links: stats.links(), base: baseUrl(ctx), classNames: classNames
    }, extra || {}));
  }

  r.get('/admin/stats', ctx => page(ctx, 200, statsView(ctx)));
  r.get('/admin/api/stats/online', ctx => H.json(ctx.res, 200, onlineData()));

  r.post('/admin/stats/link', ctx => {
    const name = String(ctx.form.name || '').trim().slice(0, 60);
    if (!name) return page(ctx, 400, statsView(ctx, { err: 'Напишите, для чего ссылка, например «Сторис 16 октября»' }));
    const base = slugify(name).slice(0, 30) || 'link';
    let slug = base;
    for (let i = 2; stats.linkTaken(slug) && i < 100; i++) slug = base.slice(0, 26) + '-' + i;
    stats.addLink(slug, name, String(ctx.form.page || 'index.html'));
    back(ctx, '/admin/stats#links', 'link');
  });

  r.post('/admin/stats/link/:slug/delete', ctx => {
    stats.removeLink(String(ctx.params.slug || ''));
    back(ctx, '/admin/stats#links', 'linkdel');
  });

  // ---------- обработчик запросов ----------

  // загрузка макета дизайнером: путь под /admin/api/media/, чтобы nginx пропускал большие файлы,
  // но вход по ссылке дизайнера, а не по паролю админки
  const OPEN_ADMIN = ['/admin/login', '/admin/static/', '/admin/api/media/dlay/'];

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

      // открыли класс в админке: он поднимется в «недавно открытых». Опрос итогов раз в несколько секунд не считаем
      if (isAdmin && ctx.sess && req.method === 'GET') {
        const vm = /^\/admin\/c\/(\d+)(?:\/(?!results)|$)/.exec(p);
        if (vm) store.touchClass(+vm[1]);
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
          // Файл читает сам обработчик, проверяем только токен из заголовка.
          // Открытые маршруты (дизайнер) проверяют свою ссылку сами
          if (!route.open && !auth.csrfOk(ctx.sess, header)) { req.resume(); return H.json(res, 403, { error: 'Страница устарела, обновите её' }); }
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

  return { handle: handle, store: store, auth: auth, media: media, site: site, photos: photos, work: work, stats: stats, layout: layout };
}

module.exports = { createApp, nextTitle, resultText };
