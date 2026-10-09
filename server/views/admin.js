'use strict';

const { html, raw, plural, fmtTime, fmtDate, fmtWhen, toLocalInput, tzParts } = require('../lib/util');
const { STEP_NAMES, status, opensAt, visibleOptions, activeSteps, resolve } = require('../lib/voting');
const { STEPS } = require('../lib/db');
const { SLOTS, GALLERIES, TEXTS, TOGGLES, isWide } = require('../lib/site');

const MSG = {
  saved: 'Сохранено',
  created: 'Класс создан. Проверьте данные и отправьте ссылку классу',
  copied: 'Класс создан с теми же настройками. Можно поправить, что нужно',
  createdmany: 'Классы созданы с одинаковыми настройками',
  opened: 'Голосование началось',
  scheduled: 'Старт запланирован. Страница откроется для голосования сама',
  unscheduled: 'Запланированный старт отменён',
  closed: 'Голосование закрыто',
  extended: 'Время продлено',
  until: 'Время окончания изменено',
  stepreset: 'Голоса этапа обнулены. Ребята могут проголосовать в нём заново',
  reopened: 'Голосование открыто заново',
  picked: 'Выбор класса сохранён',
  unpicked: 'Ручной выбор сброшен, итог снова по голосам',
  reset: 'Голоса сброшены',
  deleted: 'Класс удалён',
  archived: 'Класс перенесён в архив',
  unarchived: 'Класс вернулся из архива',
  password: 'Пароль изменён',
  bye: 'Вы вышли',
  photo: 'Фото обновлено, на сайте оно уже стоит',
  photos: 'Фото добавлены',
  video: 'Видео загружено, на сайте оно уже стоит',
  restored: 'Вернули как было',
  removed: 'Фото убрано',
  moved: 'Фото перенесено',
  optdeleted: 'Вариант удалён',
  opthidden: 'Вариант убран с сайта и у новых классов. Его уже выбирали, поэтому в их итогах он сохранится',
  optcreated: 'Вариант создан и пока скрыт. Добавьте фото и тексты, потом снимите галочку «Скрыть»'
};

const ERR = {
  last: 'Последнее фото убрать нельзя. Сначала добавьте новые',
  full: 'В том разделе уже максимум фото',
  lastphoto: 'Последнее фото убрать нельзя, пока вариант показан классам',
  name: 'Напишите название',
  used: 'Этот вариант уже выбирали классы, поэтому удалить его нельзя: сломаются их итоги. Поставьте галочку «Скрыть у всех классов», и новые классы его не увидят',
  lastopt: 'Это последний вариант этапа, его нельзя удалить'
};

const DURATIONS = [60, 120, 180];
const REOPEN = [15, 30, 60];

// '2027-01-01' → «1 января 2027»
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function dateText(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? +m[3] + ' ' + MONTHS_GEN[+m[2] - 1] + ' ' + m[1] : d;
}

// 60 → «1 час», 90 → «1 ч 30 мин», 30 → «30 мин»
function minutes(m) {
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return r + ' мин';
  if (!r) return h + ' ' + plural(h, 'час', 'часа', 'часов');
  return h + ' ч ' + r + ' мин';
}

function votes(n) { return n + ' ' + plural(n, 'голос', 'голоса', 'голосов'); }
function people(n) { return n + ' ' + plural(n, 'человек', 'человека', 'человек'); }
function photosN(n) { return n + ' фото'; }

function left(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  if (d) return d + ' д ' + Math.floor(s / 3600) % 24 + ' ч';
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const two = n => (n < 10 ? '0' : '') + n;
  return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
}

// Короткая подпись старта для списка: «в 18:00», «завтра в 18:00», «26.09 в 18:00»
function startShort(ms, now) {
  const w = fmtWhen(ms, now);
  if (w.indexOf('сегодня ') === 0) return w.slice(8);
  if (w.indexOf('завтра ') === 0) return w;
  const p = tzParts(ms);
  return (p.day < 10 ? '0' : '') + p.day + '.' + (p.month < 10 ? '0' : '') + p.month + ' в ' + fmtTime(ms);
}

function u(p) { return p ? '/' + String(p).replace(/^\/+/, '') : ''; }

function csrf(sess) { return html`<input type="hidden" name="_csrf" value="${sess.csrf}">`; }

function layout(o) {
  const nav = [['classes', '/admin', 'Классы'], ['site', '/admin/site', 'Сайт'], ['catalog', '/admin/catalog', 'Варианты'], ['settings', '/admin/settings', 'Настройки']];
  const err = o.err || (o.errCode && ERR[o.errCode]) || '';
  return '<!doctype html>\n' + html`<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${o.title} · Админка RIGSARTHUR</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F4EFE7">
${o.sess ? html`<meta name="csrf" content="${o.sess.csrf}">
` : ''}<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Админка">
<link rel="manifest" href="/admin/static/manifest.webmanifest">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/admin/static/admin.css">
</head>
<body>
${o.sess ? html`<header class="ah">
  <div class="ah__in">
    <a class="ah__logo" href="/admin"><b>RIGSARTHUR</b><span>админка</span></a>
    <a class="ah__site" href="/" target="_blank" rel="noopener">Открыть сайт ↗</a>
    <nav class="ah__nav">${nav.map(n => html`<a href="${n[1]}"${o.nav === n[0] ? raw(' aria-current="page"') : ''}>${n[2]}</a>`)}</nav>
  </div>
</header>
` : ''}<main class="aw${o.narrow ? ' aw--narrow' : ''}">
${o.msg && MSG[o.msg] ? html`<p class="flash" role="status">${MSG[o.msg]}</p>
` : ''}${err ? html`<p class="flash flash--err" role="alert">${err}</p>
` : ''}${o.body}
</main>
<p class="toast" role="status" aria-live="polite" hidden></p>
<script src="/admin/static/admin.js"></script>
${(o.scripts || []).map(src => html`<script src="${src}"></script>
`)}</body>
</html>
`.s;
}

// Кнопка загрузки файла. Саму загрузку делает admin.js
function uploadButton(o) {
  return html`<label class="b upl${o.main ? ' b--main' : ''}${o.sm ? ' b--sm' : ''}${o.wide ? ' b--wide' : ''}">
      <input type="file" accept="${o.accept || 'image/*'}" data-upload="${o.mode}" data-url="${o.url}"${o.multiple ? raw(' multiple') : ''}${o.back ? html` data-back="${o.back}"` : ''}>
      <span>${o.label}</span>
    </label>`;
}

function uploadState() {
  return html`<div class="upl__state" hidden><div class="upl__bar"><i></i></div><p></p></div>`;
}

// ---------- вход ----------

function loginPage(o) {
  return layout({
    title: 'Вход', narrow: true, msg: o.msg, err: o.err,
    body: html`<section class="login">
  <p class="ah__logo ah__logo--big"><b>RIGSARTHUR</b><span>админка</span></p>
  ${o.noPassword ? html`<div class="card">
    <h1 class="h">Пароль ещё не задан</h1>
    <p class="muted">Задайте его на сервере командой <code>npm run password</code> в папке server, потом обновите страницу.</p>
  </div>` : html`<form class="card form" method="post" action="/admin/login">
    <label class="field"><span>Пароль</span><span class="pw"><input type="password" name="password" autocomplete="current-password" required autofocus><button class="pw__eye" type="button" data-eye aria-label="Показать пароль">Показать</button></span></label>
    <button class="b b--main b--wide" type="submit">Войти</button>
  </form>`}
</section>`
  });
}

// ---------- список классов ----------

function chip(c, now) {
  const st = status(c, now);
  if (c.archived) return html`<span class="chip chip--muted">Архив</span>`;
  if (st === 'open') return html`<span class="chip chip--live" data-ends="${c.ends_at}">Идёт · <b>${left(c.ends_at - now)}</b></span>`;
  if (st === 'draft') {
    const at = opensAt(c, now);
    return at ? html`<span class="chip chip--plan">Старт ${startShort(at, now)}</span>` : html`<span class="chip chip--draft">Не начато</span>`;
  }
  if (c.pending) return html`<span class="chip chip--warn">Нужно решение</span>`;
  return html`<span class="chip chip--done">Закрыто</span>`;
}

function classRow(c, now, base) {
  return html`<div class="row row--class" data-find="${(c.title + ' ' + c.school).toLowerCase()}">
      <a class="row__link" href="/admin/c/${c.id}">
        <span class="row__main"><b>${c.title}</b><small>${c.school}</small></span>
        <span class="row__side">${chip(c, now)}<small>${c.voters ? 'проголосовали ' + people(c.voters) : 'пока без голосов'}</small></span>
      </a>
      <button class="row__copy" type="button" data-copy="${base}/k/${c.slug}" title="Скопировать ссылку на страницу класса"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.6 6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6"/></svg><span>ссылка</span></button>
    </div>`;
}

function classesPage(o) {
  const now = Date.now();
  const live = o.classes.filter(c => !c.archived);
  const groups = [
    ['Сейчас голосуют', live.filter(c => status(c, now) === 'open')],
    ['Нужно выбрать победителя', live.filter(c => status(c, now) === 'closed' && c.pending)],
    ['Запланировано', live.filter(c => status(c, now) === 'draft' && opensAt(c, now))],
    ['Не начато', live.filter(c => status(c, now) === 'draft' && !opensAt(c, now))],
    ['Закрыто', live.filter(c => status(c, now) === 'closed' && !c.pending)]
  ];
  const archived = o.classes.filter(c => c.archived);
  return layout({
    title: 'Классы', nav: 'classes', sess: o.sess, msg: o.msg,
    body: html`<div class="head">
  <h1 class="h1">Классы</h1>
  <a class="b b--main" href="/admin/new">+ Новый класс</a>
</div>
${o.classes.length ? '' : html`<div class="card empty">
  <h2 class="h">Пока нет ни одного класса</h2>
  <p class="muted">Создайте страницу класса, отправьте ссылку в чат и запустите голосование, когда все будут на месте.</p>
  <a class="b b--main" href="/admin/new">Создать первый класс</a>
</div>`}
${o.classes.length > 5 ? html`<label class="search"><span class="sr">Поиск</span><input type="search" placeholder="Найти класс или школу" data-search autocomplete="off"></label>
<p class="muted small search__none" hidden>Ничего не нашлось</p>
` : ''}${groups.filter(g => g[1].length).map(g => html`<section class="group" data-group>
  <h2 class="group__h">${g[0]} <span>${g[1].length}</span></h2>
  <div class="rows">${g[1].map(c => classRow(c, now, o.base))}</div>
</section>
`)}${archived.length ? html`<details class="group group--archive" data-group>
  <summary class="group__h">Архив <span>${archived.length}</span></summary>
  <div class="rows">${archived.map(c => classRow(c, now, o.base))}</div>
</details>` : ''}`
  });
}

// «Или до» — точная дата окончания вместо длительности
function untilField(now, label) {
  return html`<label class="field field--inline until"><span>${label || 'или до'}</span><input type="datetime-local" name="until" min="${toLocalInput(now)}"></label>`;
}

// ---------- новый класс ----------

function durationSelect(name, value, base) {
  base = base || DURATIONS;
  const list = base.indexOf(value) === -1 ? base.concat(value).sort((a, b) => a - b) : base;
  return html`<select name="${name}">${list.map(d => html`<option value="${d}"${d === value ? raw(' selected') : ''}>${minutes(d)}</option>`)}</select>`;
}

function newClassPage(o) {
  const d = o.defaults;
  const f = o.form || {};
  const list = o.classes || [];
  const from = +(f.from || o.from || 0);
  const pick = list.length ? html`
  <label class="field"><span>Настройки взять из</span><select name="from" data-from>
    <option value="0">Обычные настройки</option>
    ${list.map(c => html`<option value="${c.id}" data-school="${c.school}" data-year="${c.year}" data-duration="${c.duration_min}"${c.id === from ? raw(' selected') : ''}>${c.school} · ${c.title}</option>`)}
  </select></label>
  <p class="muted small">Скопируются скрытые варианты, дата съёмки, адрес, что взять с собой и заметка. Голоса не копируются.</p>` : '';
  return layout({
    title: 'Новый класс', nav: 'classes', sess: o.sess, err: o.err,
    body: html`<a class="back" href="/admin">← Классы</a>
<h1 class="h1">Новый класс</h1>
<form class="card form" method="post" action="/admin/new">
  ${csrf(o.sess)}${pick}
  <label class="field"><span>Школа</span><input name="school" value="${f.school || ''}" placeholder="Лицей №2" required maxlength="60" autocomplete="off"></label>
  <label class="field"><span>Класс</span><input name="title" value="${f.title || ''}" placeholder="${o.nextTitle || '11 «Б»'}" required maxlength="400" autocomplete="off"></label>
  <p class="muted small">Можно сразу несколько через запятую: 11А, 11Б, 11В. Каждому классу будет своя ссылка.</p>
  <div class="two">
    <label class="field"><span>Год выпуска</span><input name="year" type="number" inputmode="numeric" min="2020" max="2100" value="${f.year || d.year}" required></label>
    <label class="field"><span>Голосование длится</span>${durationSelect('duration_min', +(f.duration_min || d.duration_min))}</label>
  </div>
  <button class="b b--main b--wide" type="submit">Создать</button>
</form>`
  });
}

// ---------- страница класса ----------

function resultsBlock(o) {
  const c = o.cls;
  const now = Date.now();
  const st = status(c, now);
  const opts = visibleOptions(o.catalog, c);
  const res = resolve(c, opts, o.counts);
  const closed = st === 'closed';
  const steps = activeSteps(opts).map(step => {
    const cnt = o.counts[step] || {};
    const total = opts[step].reduce((s, x) => s + (cnt[x.key] || 0), 0);
    const r = res[step];
    const tieKeys = r.tie.map(x => x.key);
    const sorted = opts[step].slice().sort((a, b) => (cnt[b.key] || 0) - (cnt[a.key] || 0));
    const note = !closed ? '' : r.option
      ? (r.manual
        ? html`<div class="note note--ok">Выбрано вручную: <b>${r.option.name}</b>
          <form method="post" action="/admin/c/${c.id}/pick">${csrf(o.sess)}<input type="hidden" name="step" value="${step}"><input type="hidden" name="option" value=""><button class="link" type="submit">Вернуть итог по голосам</button></form></div>`
        : html`<div class="note note--ok">Выбор класса: <b>${r.option.name}</b></div>`)
      : html`<div class="note note--warn">${r.tie.length > 1 ? 'Ничья. Выберите победителя, класс увидит его сразу' : 'Голосов нет. Выберите вариант сами'}</div>`;
    const row = x => {
      const n = cnt[x.key] || 0;
      const pct = total ? Math.round(n * 100 / total) : 0;
      const win = r.option && r.option.key === x.key;
      const tie = !r.option && tieKeys.indexOf(x.key) !== -1;
      // Крупная кнопка только у тех, кто делит первое место, у остальных ссылка
      let btn = '';
      if (closed && !win) {
        if (tie) btn = html`<button class="b b--main b--sm" type="submit">Выбрать победителем</button>`;
        else if (!r.option && !r.tie.length) btn = html`<button class="b b--sm" type="submit">Выбрать</button>`;
        else btn = html`<button class="link" type="submit">Сделать выбором класса</button>`;
      }
      const ask = r.option || (r.tie.length && !tie);
      return html`<li class="bar${win ? ' is-win' : ''}${tie ? ' is-tie' : ''}">
        <div class="bar__top"><span>${x.name}</span><b>${n}</b></div>
        <div class="bar__line"><i style="width:${pct}%"></i></div>
        ${btn ? html`<form method="post" action="/admin/c/${c.id}/pick"${ask ? raw(' data-confirm="Сделать этот вариант выбором класса, хотя по голосам он не первый?"') : ''}>${csrf(o.sess)}<input type="hidden" name="step" value="${step}"><input type="hidden" name="option" value="${x.key}">${btn}</form>` : ''}
      </li>`;
    };
    // Пока голосование идёт или никто не голосовал, видны все. Иначе нули — под спойлером
    const shown = sorted.filter(x => !closed || !total || (cnt[x.key] || 0) > 0 || (r.option && r.option.key === x.key));
    const rest = sorted.filter(x => shown.indexOf(x) === -1);
    return html`<div class="res">
    <h3 class="res__h">${STEP_NAMES[step]} <small>${votes(total)}</small></h3>
    ${note}
    <ul class="bars">${shown.map(row)}</ul>
    ${rest.length ? html`<details class="more more--rest"><summary>Показать ещё ${rest.length} без голосов</summary><ul class="bars">${rest.map(row)}</ul></details>` : ''}
    ${total ? html`<form method="post" action="/admin/c/${c.id}/resetstep" class="res__reset" data-confirm="Обнулить все голоса этапа «${STEP_NAMES[step]}» (${votes(total)})? Ребята смогут проголосовать в нём заново, остальные этапы не изменятся.">${csrf(o.sess)}<input type="hidden" name="step" value="${step}"><button class="link" type="submit">Обнулить голоса этапа</button></form>` : ''}
  </div>`;
  });
  return html`<div class="card" id="results"${st === 'open' ? html` data-refresh="/admin/c/${c.id}/results"` : ''}>
  <div class="card__h"><h2 class="h">Голоса</h2><span class="muted">${people(o.voters)}</span></div>
  ${st === 'open' ? html`<p class="online"><i></i>Сейчас на странице: <b>${o.online}</b></p>` : ''}
  ${steps}
  ${o.summary ? html`<div class="sum">
    <p class="sum__h">Итог одним сообщением для чата</p>
    <pre class="sum__text">${o.summary}</pre>
    <div class="sum__btns">
      <button class="b b--main b--sm" type="button" data-copy="${o.summary}">Скопировать итог</button>
      <a class="b b--sm" href="https://wa.me/?text=${encodeURIComponent(o.summary)}" data-share data-share-text="${o.summary}" target="_blank" rel="noopener">Отправить</a>
    </div>
  </div>` : ''}
</div>`;
}

function controlBlock(o) {
  const c = o.cls;
  const now = Date.now();
  const st = status(c, now);
  if (st === 'draft') {
    const at = opensAt(c, now);
    if (at) {
      return html`<div class="card ctl ctl--plan">
  <div class="card__h"><h2 class="h">Старт запланирован</h2><span class="chip chip--plan">${fmtWhen(at, now)}</span></div>
  <p class="muted">Голосование начнётся ${fmtWhen(at, now)} и ${c.ends_at === at + c.duration_min * 60000 ? html`продлится ${minutes(c.duration_min)}` : html`закончится ${fmtWhen(c.ends_at, now)}`}. До этого ребята видят варианты, но голосовать не могут. Страница откроется у всех сама.</p>
  <p class="count count--sm" data-ends="${at}" data-now="${now}">${left(at - now)}</p>
  <div class="ctl__btns ctl__btns--two">
    <form method="post" action="/admin/c/${c.id}/open">${csrf(o.sess)}<input type="hidden" name="duration_min" value="${c.duration_min}"><button class="b b--main" type="submit">Начать сейчас</button></form>
    <form method="post" action="/admin/c/${c.id}/schedule" data-confirm="Отменить запланированный старт?">${csrf(o.sess)}<input type="hidden" name="cancel" value="1"><button class="b" type="submit">Отменить старт</button></form>
  </div>
</div>`;
    }
    const soon = Math.ceil((now + 60 * 60 * 1000) / (15 * 60 * 1000)) * 15 * 60 * 1000;
    return html`<div class="card ctl">
  <div class="card__h"><h2 class="h">Голосование</h2><span class="chip chip--draft">Не начато</span></div>
  <p class="muted">Ссылку можно отправить заранее: до старта ребята смотрят варианты, но голосовать не могут. Когда голосование начнётся, страница у всех обновится сама.</p>
  <form method="post" action="/admin/c/${c.id}/open" class="ctl__row">
    ${csrf(o.sess)}
    <label class="field field--inline"><span>Длится</span>${durationSelect('duration_min', c.duration_min)}</label>
    ${untilField(now)}
    <button class="b b--main" type="submit">Начать сейчас</button>
  </form>
  <p class="muted small until__hint">Можно указать точную дату окончания, например 12 октября 23:59 — тогда длительность не учитывается.</p>
  <details class="more">
    <summary>Запланировать старт на время</summary>
    <form method="post" action="/admin/c/${c.id}/schedule" class="form plan">
      ${csrf(o.sess)}
      <label class="field"><span>Когда начать</span><input type="datetime-local" name="at" value="${toLocalInput(soon)}" min="${toLocalInput(now)}" required></label>
      <label class="field field--inline"><span>Длится</span>${durationSelect('duration_min', c.duration_min)}</label>
      ${untilField(now)}
      <button class="b b--main" type="submit">Запланировать</button>
    </form>
  </details>
</div>`;
  }
  if (st === 'open') {
    return html`<div class="card ctl ctl--live">
  <div class="card__h"><h2 class="h">Идёт голосование</h2><span class="chip chip--live">до ${c.ends_at - now < 20 * 60 * 60 * 1000 ? fmtTime(c.ends_at) : fmtWhen(c.ends_at, now)}</span></div>
  <p class="count" data-ends="${c.ends_at}" data-now="${now}">${left(c.ends_at - now)}</p>
  <div class="ctl__btns">
    <form method="post" action="/admin/c/${c.id}/extend">${csrf(o.sess)}<input type="hidden" name="min" value="15"><button class="b" type="submit">+15 мин</button></form>
    <form method="post" action="/admin/c/${c.id}/extend">${csrf(o.sess)}<input type="hidden" name="min" value="60"><button class="b" type="submit">+1 час</button></form>
    <form method="post" action="/admin/c/${c.id}/close" data-confirm="Закрыть голосование сейчас? Класс сразу увидит итог.">${csrf(o.sess)}<button class="b b--danger" type="submit">Закрыть сейчас</button></form>
  </div>
  <details class="more">
    <summary>Изменить время окончания</summary>
    <form method="post" action="/admin/c/${c.id}/until" class="ctl__row">
      ${csrf(o.sess)}
      <label class="field field--inline"><span>До</span><input type="datetime-local" name="until" value="${toLocalInput(c.ends_at)}" min="${toLocalInput(now)}" required></label>
      <button class="b b--main" type="submit">Сохранить</button>
    </form>
  </details>
</div>`;
  }
  return html`<div class="card ctl">
  <div class="card__h"><h2 class="h">Голосование закрыто</h2><span class="chip chip--done">${fmtDate(c.closed_at || c.ends_at)}</span></div>
  <details class="more">
    <summary>Открыть заново</summary>
    <p class="muted small">Голоса сохранятся, ручной выбор победителя сбросится.</p>
    <form method="post" action="/admin/c/${c.id}/open" class="ctl__row" data-confirm="Открыть голосование заново?">
      ${csrf(o.sess)}
      <label class="field field--inline"><span>Ещё</span>${durationSelect('duration_min', 30, REOPEN)}</label>
      ${untilField(now)}
      <button class="b" type="submit">Открыть</button>
    </form>
  </details>
</div>`;
}

function classPage(o) {
  const c = o.cls;
  const url = o.url;
  const share = 'Привет! Это страница вашего класса, тут выбираем альбом: ' + url;
  const all = o.catalog;
  const hiddenCount = STEPS.reduce((n, step) => n + all[step].filter(x => !x.hidden && c.hidden.indexOf(step + ':' + x.key) !== -1).length, 0);
  // Этапы, где класс не видит ни одного варианта, — убраны из голосования
  const offSteps = STEPS.filter(step => {
    const vis = all[step].filter(x => !x.hidden);
    return vis.length && vis.every(x => c.hidden.indexOf(step + ':' + x.key) !== -1);
  });
  return layout({
    title: c.title + ' · ' + c.school, nav: 'classes', sess: o.sess, msg: o.msg, err: o.err,
    body: html`<a class="back" href="/admin">← Классы</a>
<div class="head head--class">
  <div><h1 class="h1">${c.title}</h1><p class="muted">${c.school} · ${c.year}${c.archived ? ' · в архиве' : ''}</p></div>
</div>

<div class="card share">
  <p class="share__url">${url}</p>
  <div class="share__btns">
    <button class="b b--main" type="button" data-copy="${url}">Скопировать ссылку</button>
    <a class="b" href="https://wa.me/?text=${encodeURIComponent(share)}" data-share data-share-text="${share}" target="_blank" rel="noopener">Отправить</a>
    <a class="b" href="${url}" target="_blank" rel="noopener">Открыть</a>
  </div>
</div>

${controlBlock(o)}
${resultsBlock(o)}

<form class="card form" method="post" action="/admin/c/${c.id}/cheat" id="cheat">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Шпаргалка</h2></div>
  <p class="muted small">Класс увидит это после голосования. Шпаргалка общая для всех классов, её пишут один раз в <a href="/admin/settings">настройках</a>. Серым показан общий текст. Поле здесь заполняйте, только если этому классу нужно другое.</p>
  <label class="field"><span>Дата и время съёмки${c.shoot || !o.defaults.shoot ? '' : html` <small class="muted">общая</small>`}</span><input name="shoot" value="${c.shoot}" placeholder="${o.defaults.shoot || 'Суббота, 12 октября, 15:00'}" maxlength="120"></label>
  <label class="field"><span>Адрес студии${c.address ? '' : html` <small class="muted">общий</small>`}</span><input name="address" value="${c.address}" placeholder="${o.defaults.address || 'Сообщу в чате класса'}" maxlength="160"></label>
  <label class="field"><span>Что взять с собой${c.bring ? '' : html` <small class="muted">общий</small>`}</span><textarea name="bring" rows="3" maxlength="600" placeholder="${o.defaults.bring || 'Сообщу в чате класса'}">${c.bring}</textarea></label>
  <label class="field"><span>Ещё (по желанию)${c.note || !o.defaults.note ? '' : html` <small class="muted">общее</small>`}</span><textarea name="note" rows="2" maxlength="600" placeholder="${o.defaults.note || ''}">${c.note}</textarea></label>
  <button class="b b--main" type="submit">Сохранить шпаргалку</button>
</form>

<details class="card fold" id="options"${o.open === 'options' ? raw(' open') : ''}>
  <summary class="fold__h"><span><b>Варианты для этого класса</b><small>${offSteps.length ? 'Убрано из голосования: ' + offSteps.map(st => STEP_NAMES[st].toLowerCase()).join(', ') + (hiddenCount > offSteps.reduce((n, st) => n + all[st].filter(x => !x.hidden).length, 0) ? '; есть скрытые варианты' : '') : hiddenCount ? 'Скрыто для класса: ' + hiddenCount : 'Класс видит все варианты'}</small></span></summary>
  <form class="form" method="post" action="/admin/c/${c.id}/options">
  ${csrf(o.sess)}
  <p class="muted small">Снимите галочку, чтобы вариант не показывался этому классу. Снимите все галочки в этапе — и этап уберётся из голосования целиком (например, место уже выбрали заранее; его можно написать в шпаргалке в поле «Ещё»).</p>
  ${STEPS.map(step => html`<fieldset class="checks">
    <legend>${STEP_NAMES[step]}${offSteps.indexOf(step) !== -1 ? html` <small class="muted">убран из голосования</small>` : ''}</legend>
    ${all[step].map(x => {
      const on = c.hidden.indexOf(step + ':' + x.key) === -1;
      return html`<label class="check${x.hidden ? ' is-off' : ''}"><input type="checkbox" name="on" value="${step}:${x.key}"${on ? raw(' checked') : ''}${x.hidden ? raw(' disabled') : ''}><span>${x.name}${x.hidden ? html` <small>скрыт в разделе «Варианты»</small>` : ''}</span></label>`;
    })}
  </fieldset>`)}
  <button class="b b--main" type="submit">Сохранить варианты</button>
  </form>
</details>

<a class="card fold__link" href="/admin/c/${c.id}/photos"><b>Отбор фото</b><small>${o.pk && (o.pk.photos || o.pk.students) ? (o.pk.closed ? 'Отбор закрыт · ' : '') + o.pk.photos + ' фото · начали выбирать ' + o.pk.started + ' из ' + o.pk.students : 'Личные фото, общие групповые, цитаты и раскладка по папкам'}</small></a>

<details class="card fold" id="info"${o.open === 'info' ? raw(' open') : ''}>
  <summary class="fold__h"><span><b>Название, год, адрес ссылки</b><small>${c.school} · ${c.title} · ${c.year}</small></span></summary>
  <form class="form" method="post" action="/admin/c/${c.id}/info">
  ${csrf(o.sess)}
  <label class="field"><span>Школа</span><input name="school" value="${c.school}" required maxlength="60"></label>
  <label class="field"><span>Класс</span><input name="title" value="${c.title}" required maxlength="40"></label>
  <div class="two">
    <label class="field"><span>Год выпуска</span><input name="year" type="number" inputmode="numeric" min="2020" max="2100" value="${c.year}" required></label>
    <label class="field"><span>Длительность</span>${durationSelect('duration_min', c.duration_min)}</label>
  </div>
  <label class="field"><span>Адрес страницы</span><span class="slug"><em>/k/</em><input name="slug" value="${c.slug}" required maxlength="60" pattern="[a-z0-9\\-]+" autocapitalize="off" autocorrect="off" spellcheck="false"></span></label>
  <p class="muted small">Только латиница, цифры и дефис. Если поменять адрес, старая ссылка перестанет работать.</p>
  <button class="b b--main" type="submit">Сохранить</button>
  </form>
</details>

<div class="card" id="duplicate">
  <div class="card__h"><h2 class="h">Ещё</h2></div>
  <a class="b b--wide" href="/admin/new?from=${c.id}">Создать похожий класс</a>
  <p class="muted small">С теми же вариантами и шпаргалкой. Можно сразу несколько классов параллели.</p>
  <div class="danger">
  <form method="post" action="/admin/c/${c.id}/archive">${csrf(o.sess)}<input type="hidden" name="on" value="${c.archived ? 0 : 1}"><button class="b" type="submit">${c.archived ? 'Вернуть из архива' : 'Убрать в архив'}</button></form>
  <form method="post" action="/admin/c/${c.id}/reset" data-confirm="Удалить все голоса этого класса? Это нельзя отменить.">${csrf(o.sess)}<button class="b b--danger" type="submit">Сбросить голоса</button></form>
  <form method="post" action="/admin/c/${c.id}/delete" data-confirm="Удалить страницу класса вместе с голосами${o.pk && (o.pk.photos || o.pk.students) ? ' и отбором фото (выбор учеников и цитаты)' : ''}? Ссылки перестанут работать. Это нельзя отменить.">${csrf(o.sess)}<button class="b b--danger" type="submit">Удалить класс</button></form>
  </div>
</div>`
  });
}

// ---------- сайт: фото, видео, галереи, цены ----------

function slotPic(key, value, defSrc, shape) {
  const src = value ? u(value.sm) : u(defSrc);
  return html`<span class="pic pic--${shape || 'square'}">${src ? html`<img src="${src}" alt="" loading="lazy">` : html`<span class="pic__empty">Фото ещё нет</span>`}</span>`;
}

function slotRow(o, key) {
  const def = SLOTS[key];
  const value = o.values[key];
  const custom = !!value;
  return html`<div class="slotrow" id="${key}">
    ${slotPic(key, value, o.defaults.media[key], def.shape)}
    <div class="slotrow__body">
      <b>${def.label}</b>
      <small>${def.where}</small>
      ${def.hint ? html`<small class="hint">${def.hint}</small>` : ''}
      <div class="slotrow__btns">
        ${uploadButton({ mode: 'slot', url: '/admin/api/site/' + key, back: '/admin/site?m=photo#' + key, label: custom || o.defaults.media[key] ? 'Заменить фото' : 'Загрузить фото', main: true, sm: true })}
        ${custom ? html`<form method="post" action="/admin/site/reset/${key}" data-confirm="Вернуть фото, которое было изначально?">${csrf(o.sess)}<button class="link" type="submit">Вернуть как было</button></form>` : ''}
      </div>
      ${uploadState()}
    </div>
  </div>`;
}

function galleryCard(o, key) {
  const def = GALLERIES[key];
  const g = o.galleries[key];
  return html`<a class="gcard" href="/admin/site/g/${key}">
    <span class="gcard__pics">${g.items.slice(0, 6).map(it => html`<img src="${u(it.sm)}" alt="" loading="lazy">`)}</span>
    <span class="gcard__body"><b>${def.label}</b><small>${def.where} · ${photosN(g.items.length)}</small></span>
    <span class="gcard__go">Изменить →</span>
  </a>`;
}

function sitePage(o) {
  const video = o.values['home.video'];
  const vdef = SLOTS['home.video'];
  const photoKeys = ['arthur', 'album', 'studio.main'];
  const t = o.texts;
  return layout({
    title: 'Сайт', nav: 'site', sess: o.sess, msg: o.msg, err: o.err,
    body: html`<div class="head">
  <h1 class="h1">Сайт</h1>
</div>
<p class="muted intro">Здесь меняются фото, видео и цены на сайте. Всё видно на сайте сразу после сохранения. Фото с телефона сами уменьшаются перед загрузкой, ничего готовить не нужно.</p>
<nav class="toc">
  <a href="#prices">Цены</a><a href="#home.video">Видео</a><a href="#galleries">Работы</a><a href="#photos">Другие фото</a>
</nav>

<form class="card form" method="post" action="/admin/site/texts" id="prices">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Цены</h2><span class="muted small">Главная и «Альбомы и цены»</span></div>
  <div class="two">
    <label class="field"><span>${TEXTS['price.main'].label}</span><input name="price.main" value="${t['price.main']}" maxlength="${TEXTS['price.main'].max}" inputmode="numeric" required></label>
    <label class="field"><span>${TEXTS['price.note'].label}</span><input name="price.note" value="${t['price.note']}" maxlength="${TEXTS['price.note'].max}"></label>
  </div>
  <fieldset class="checks group-price">
    <legend>Скидка</legend>
    ${o.priceOver
      ? html`<p class="note note--warn">Скидка закончилась: на сайте обычная цена ${o.laterPrice} ₽, скидка для параллели тоже скрыта. Чтобы запустить новую скидку, поставьте новый последний день и цены.</p>`
      : html`<p class="note note--ok">Сейчас на сайте цена со скидкой ${t['price.main']} ₽. После ${dateText(o.lastDay)} скидка закончится сама, и на сайте будет обычная цена ${o.laterPrice} ₽.</p>`}
    <div class="two">
      <label class="field"><span>Последний день скидки</span><input type="date" name="price.last" value="${o.lastDay}" required></label>
      <label class="field"><span>${TEXTS['price.later'].label}</span><input name="price.later" value="${t['price.later']}" maxlength="${TEXTS['price.later'].max}" inputmode="numeric" required></label>
    </div>
    <label class="check"><input type="checkbox" name="price.early" value="1"${o.toggles['price.early'] ? raw(' checked') : ''}><span>${TOGGLES['price.early'].label}</span></label>
    <div class="two">
      <label class="field"><span>${TEXTS['price.tag'].label}</span><input name="price.tag" value="${t['price.tag']}" maxlength="${TEXTS['price.tag'].max}"></label>
      <label class="field"><span>${TEXTS['price.later.tag'].label}</span><input name="price.later.tag" value="${t['price.later.tag']}" maxlength="${TEXTS['price.later.tag'].max}"></label>
    </div>
    <label class="field"><span>${TEXTS['price.save'].label}</span><input name="price.save" value="${t['price.save']}" maxlength="${TEXTS['price.save'].max}"></label>
    <p class="muted small">Надпись над ценой подстраивается под дату сама. Рядом со скидкой сайт пишет, сколько дней она ещё действует.</p>
  </fieldset>
  <fieldset class="checks group-price">
    <legend>Скидка для параллели</legend>
    <label class="check"><input type="checkbox" name="price.group" value="1"${o.toggles['price.group'] ? raw(' checked') : ''}><span>${TOGGLES['price.group'].label}</span></label>
    <label class="field"><span>${TEXTS['price.group.title'].label}</span><input name="price.group.title" value="${t['price.group.title']}" maxlength="${TEXTS['price.group.title'].max}"></label>
    <div class="two">
      <label class="field"><span>${TEXTS['price.group.two'].label}</span><input name="price.group.two" value="${t['price.group.two']}" maxlength="${TEXTS['price.group.two'].max}"></label>
      <label class="field"><span>${TEXTS['price.group.three'].label}</span><input name="price.group.three" value="${t['price.group.three']}" maxlength="${TEXTS['price.group.three'].max}"></label>
    </div>
  </fieldset>
  <p class="muted small">Если поле очистить, вернётся исходный текст.</p>
  <button class="b b--main" type="submit">Сохранить цены</button>
</form>

<section class="card" id="home.video">
  <div class="card__h"><h2 class="h">Видео на главной</h2>${video ? html`<span class="chip chip--done">Стоит на сайте</span>` : html`<span class="chip chip--draft">Пока нет</span>`}</div>
  ${video ? html`<video class="vid" src="${u(video.video)}"${video.poster ? html` poster="${u(video.poster)}"` : ''} controls muted playsinline preload="metadata"></video>` : html`<div class="vid vid--empty">На сайте сейчас место под видео</div>`}
  <p class="muted small">${vdef.hint} Лучше MP4. Если загрузка долгая, не закрывайте страницу.</p>
  ${o.videoNote === 'hevc' ? html`<p class="flash flash--warn">Видео в формате HEVC: на части Android-телефонов оно может не открыться. Надёжнее отправить видео себе в WhatsApp или Telegram как обычное видео, сохранить оттуда и загрузить заново.</p>` : ''}
  <div class="slotrow__btns">
    ${uploadButton({ mode: 'video', accept: 'video/mp4,video/quicktime,video/*', url: '/admin/api/site/home.video', back: '/admin/site?m=video#home.video', label: video ? 'Заменить видео' : 'Загрузить видео', main: true })}
    ${video ? html`<form method="post" action="/admin/site/reset/home.video" data-confirm="Убрать видео с сайта? Вместо него снова будет место под видео.">${csrf(o.sess)}<button class="link" type="submit">Убрать видео</button></form>` : ''}
  </div>
  ${uploadState()}
</section>

<section class="card" id="galleries">
  <div class="card__h"><h2 class="h">Работы</h2></div>
  ${Object.keys(GALLERIES).map(k => galleryCard(o, k))}
</section>

<section class="card" id="photos">
  <div class="card__h"><h2 class="h">Другие фото</h2></div>
  ${photoKeys.map(k => slotRow(o, k))}
</section>

<p class="muted small">Тематики с обложками и фото разворотов меняются в разделе <a href="/admin/catalog">«Варианты»</a>: там же добавляются новые и убираются старые. Всё сразу обновится на главной, на странице «Дизайны» и у классов.</p>`
  });
}

function galleryPage(o) {
  const g = o.gallery;
  const n = g.items.length;
  return layout({
    title: o.def.label, nav: 'site', sess: o.sess, msg: o.msg, errCode: o.errCode,
    body: html`<a class="back" href="/admin/site#galleries">← Сайт</a>
<h1 class="h1">${o.def.label}</h1>
<p class="muted">${o.def.where} · ${photosN(n)}${o.def.empty && !n ? ' · пока пустой раздел на сайте не виден' : ''}</p>
${o.link ? html`<div class="card share">
  <p class="muted small">Ссылка прямо на этот раздел. Её можно отправить родителям как пример.</p>
  <p class="share__url">${o.link}</p>
  <div class="share__btns">
    <button class="b b--main" type="button" data-copy="${o.link}">Скопировать ссылку</button>
    <a class="b" href="${o.link}" target="_blank" rel="noopener">Открыть</a>
  </div>
</div>` : ''}
<div class="card">
  <p class="muted small">${o.def.hint} Можно выбрать сразу несколько фото. Стрелками меняется порядок, крестиком фото убирается с сайта.</p>
  ${uploadButton({ mode: 'gallery', url: '/admin/api/site/g/' + o.key, back: '/admin/site/g/' + o.key + '?m=photos', label: '+ Добавить фото', main: true, multiple: true, wide: true })}
  ${uploadState()}
  ${g.custom ? html`<form method="post" action="/admin/site/reset/${o.key}" data-confirm="Вернуть исходные фото? Все изменения в этой галерее пропадут.">${csrf(o.sess)}<button class="link" type="submit">Вернуть исходные фото</button></form>` : ''}
</div>
<form class="gal" method="post" action="/admin/site/g/${o.key}">
  ${csrf(o.sess)}
  ${g.items.map((it, i) => html`<div class="gi${isWide(it) ? ' gi--wide' : ''}" id="g${i}">
    <img src="${u(it.sm)}" alt="" loading="lazy">
    <span class="gi__n">${i + 1}</span>
    <div class="gi__tools">
      <button class="gi__b" type="submit" name="op" value="up:${i}" aria-label="Раньше"${i === 0 ? raw(' disabled') : ''}>←</button>
      <button class="gi__b gi__b--del" type="submit" name="op" value="del:${i}" aria-label="Убрать фото" data-confirm="Убрать это фото с сайта?">✕</button>
      <button class="gi__b" type="submit" name="op" value="down:${i}" aria-label="Позже"${i === n - 1 ? raw(' disabled') : ''}>→</button>
    </div>
    ${o.sections && o.sections.length ? html`<details class="gi__move"><summary>Перенести</summary>${o.sections.map(s => html`<button type="submit" name="op" value="to:${i}:${s.key}">${s.label}</button>`)}</details>` : ''}
  </div>`)}
</form>`
  });
}

// ---------- каталог вариантов ----------

function optionThumb(x) {
  if (x.step === 'color') return html`<span class="thumb thumb--sw">${(x.colors || []).map(c => html`<i style="background:${c}"></i>`)}</span>`;
  const p = (x.photos || [])[0];
  return p ? html`<img class="thumb" src="/${p.src}-sm.jpg" alt="" loading="lazy">` : html`<span class="thumb"></span>`;
}

const ADD_LABEL = { theme: 'Новая тематика', place: 'Новое место', wear: 'Новый стиль одежды', color: 'Новый цвет' };

function catalogPage(o) {
  return layout({
    title: 'Варианты', nav: 'catalog', sess: o.sess, msg: o.msg, errCode: o.errCode,
    body: html`<h1 class="h1">Варианты</h1>
<p class="muted">Тематики, места для групповых, стили и цвета, из которых выбирают классы. Изменения сразу видны на страницах классов и на странице «Дизайны».</p>
${STEPS.map(step => html`<section class="group">
  <h2 class="group__h">${STEP_NAMES[step]} <span>${o.catalog[step].length}</span></h2>
  <div class="rows">${o.catalog[step].map((x, i, arr) => html`<div class="row row--opt${x.hidden ? ' is-off' : ''}">
    ${optionThumb(x)}
    <a class="row__main" href="/admin/o/${x.id}"><b>${x.name}</b><small>${x.hidden ? 'Скрыт у всех классов' : step === 'theme' ? (x.tag || '') : step === 'wear' || step === 'place' ? (x.sub || '') : (x.plus ? '+ чёрный и белый' : '')}</small></a>
    <span class="row__tools">
      <form method="post" action="/admin/o/${x.id}/move">${csrf(o.sess)}<input type="hidden" name="dir" value="-1"><button class="ic" type="submit" aria-label="Выше"${i === 0 ? raw(' disabled') : ''}>↑</button></form>
      <form method="post" action="/admin/o/${x.id}/move">${csrf(o.sess)}<input type="hidden" name="dir" value="1"><button class="ic" type="submit" aria-label="Ниже"${i === arr.length - 1 ? raw(' disabled') : ''}>↓</button></form>
      <form method="post" action="/admin/o/${x.id}/delete" data-confirm="Удалить «${x.name}»?">${csrf(o.sess)}<button class="ic ic--del" type="submit" aria-label="Удалить">✕</button></form>
    </span>
  </div>`)}</div>
  <form class="addopt" method="post" action="/admin/catalog/new">
    ${csrf(o.sess)}
    <input type="hidden" name="step" value="${step}">
    <input name="name" placeholder="${ADD_LABEL[step]}" maxlength="${step === 'color' ? 80 : 40}" required aria-label="${ADD_LABEL[step]}">
    <button class="b b--sm" type="submit">Добавить</button>
  </form>
</section>
`)}`
  });
}

function optionPage(o) {
  const x = o.option;
  const photos = x.photos || [];
  let fields;
  if (x.step === 'theme') {
    fields = html`<label class="field"><span>Название</span><input name="name" value="${x.name}" required maxlength="40"></label>
  <label class="field"><span>Метка над названием</span><input name="tag" value="${x.tag || ''}" maxlength="30" placeholder="NEW 2026"></label>
  <label class="field"><span>Коротко о стиле</span><textarea name="lead" rows="3" maxlength="400">${x.lead || ''}</textarea></label>
  <label class="field"><span>Подробнее о стиле</span><textarea name="about" rows="7" maxlength="2000">${(x.about || []).join('\n\n')}</textarea></label>
  <p class="muted small">Абзацы разделяйте пустой строкой.</p>
  <label class="field"><span>Локация для групповых</span><input name="loc" value="${x.loc || ''}" maxlength="80" placeholder="студия или улица"></label>
  <label class="check"><input type="checkbox" name="covers" value="2"${x.covers === 2 ? raw(' checked') : ''}><span>Две обложки на выбор</span></label>`;
  } else if (x.step === 'place') {
    fields = html`<label class="field"><span>Название</span><input name="name" value="${x.name}" required maxlength="40"></label>
  <label class="field"><span>Подпись</span><input name="sub" value="${x.sub || ''}" maxlength="120"></label>
  <label class="field"><span>Ссылка «Больше фото»</span><input name="link" value="${x.link || ''}" maxlength="300" placeholder="works.html#school"></label>
  <p class="muted small">Раздел страницы «Работы»: works.html#nature (природа, весна и осень), works.html#spring, works.html#autumn, works.html#school, works.html#studio.</p>`;
  } else if (x.step === 'wear') {
    fields = html`<label class="field"><span>Название</span><input name="name" value="${x.name}" required maxlength="40"></label>
  <label class="field"><span>Подпись</span><input name="sub" value="${x.sub || ''}" maxlength="80"></label>
  <label class="field"><span>Ссылка на Pinterest</span><input name="pin" type="url" value="${x.pin || ''}" maxlength="300" placeholder="https://pin.it/..."></label>`;
  } else {
    fields = html`<label class="field"><span>Название</span><input name="name" value="${x.name}" required maxlength="80"></label>
  <label class="field"><span>Цвета</span><span class="colors">${[0, 1, 2, 3, 4, 5, 6].map(i => html`<input type="color" name="c${i}" value="${(x.colors || [])[i] || '#ffffff'}" list="sw-bw" aria-label="Цвет ${i + 1}">`)}</span></label>
  <datalist id="sw-bw"><option value="#000000"></option><option value="#ffffff"></option></datalist>
  <label class="field"><span>Сколько цветов показывать</span><select name="count">${[1, 2, 3, 4, 5, 6, 7].map(n => html`<option value="${n}"${n === (x.colors || []).length ? raw(' selected') : ''}>${n}</option>`)}</select></label>
  <label class="check"><input type="checkbox" name="plus" value="1"${x.plus ? raw(' checked') : ''}><span>«+ чёрный и белый»: подпись и полоски в палитре</span></label>`;
  }
  const theme = x.step === 'theme';
  const photoCard = x.step === 'color' ? '' : html`
<form class="card form photos-card" method="post" action="/admin/o/${x.id}/photos" id="photos">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Фото</h2><span class="muted">${photosN(photos.length)}</span></div>
  <p class="muted small">${theme ? 'Развороты альбома: их листают в карточке тематики. ' : ''}Можно выбрать сразу несколько фото. Стрелками меняется порядок.</p>
  ${theme && photos.length ? html`<button class="b b--main photos-card__save" type="submit" name="op" value="save">Сохранить подписи</button>` : ''}
  ${photos.length ? html`<div class="photos">${photos.map((p, i) => html`<div class="photo">
      <img src="/${p.src}-sm.jpg" alt="" loading="lazy">
      ${theme ? html`<input name="cap${i}" value="${p.cap || ''}" maxlength="60" placeholder="Подпись" aria-label="Подпись к фото ${i + 1}">` : ''}
      <div class="photo__tools">
        <button class="gi__b" type="submit" name="op" value="up:${i}" aria-label="Раньше"${i === 0 ? raw(' disabled') : ''}>←</button>
        <button class="gi__b gi__b--del" type="submit" name="op" value="del:${i}" aria-label="Убрать фото" data-confirm="Убрать это фото?">✕</button>
        <button class="gi__b" type="submit" name="op" value="down:${i}" aria-label="Позже"${i === photos.length - 1 ? raw(' disabled') : ''}>→</button>
      </div>
    </div>`)}</div>` : html`<p class="empty-photos">Фото пока нет</p>`}
  ${uploadButton({ mode: 'photos', url: '/admin/api/o/' + x.id + '/photos', back: '/admin/o/' + x.id + '?m=photos#photos', label: '+ Добавить фото', multiple: true, wide: true })}
  ${uploadState()}
</form>`;
  const cv = o.cover;
  const coverKey = 'cover.' + x.key;
  const coverCard = cv ? html`
<section class="card" id="cover">
  <div class="card__h"><h2 class="h">Обложка</h2></div>
  <div class="slotrow">
    <span class="pic pic--cover">${cv.own || cv.src ? html`<img src="${u(cv.own ? cv.own.sm : cv.src)}" alt="" loading="lazy">` : html`<span class="pic__empty">Обложки ещё нет</span>`}</span>
    <div class="slotrow__body">
      <b>Вертикальная, как обложка альбома</b>
      <small>Главная: колода обложек на первом экране и полка «Каждый год новый уникальный дизайн»</small>
      ${!cv.own && !cv.src ? html`<small class="hint">Пока обложки нет, на главной тематика будет без картинки</small>` : ''}
      <div class="slotrow__btns">
        ${uploadButton({ mode: 'slot', url: '/admin/api/site/' + coverKey, back: '/admin/o/' + x.id + '?m=photo#cover', label: cv.own || cv.src ? 'Заменить обложку' : 'Загрузить обложку', main: true, sm: true })}
        ${cv.own ? html`<form method="post" action="/admin/site/reset/${coverKey}" data-confirm="Вернуть обложку, которая была изначально?">${csrf(o.sess)}<input type="hidden" name="from" value="${x.id}"><button class="link" type="submit">Вернуть как было</button></form>` : ''}
      </div>
      ${uploadState()}
    </div>
  </div>
</section>` : '';
  return layout({
    title: x.name, nav: 'catalog', sess: o.sess, msg: o.msg, err: o.err, errCode: o.errCode,
    body: html`<a class="back" href="/admin/catalog">← Варианты</a>
<h1 class="h1">${x.name}</h1>
<p class="muted">${STEP_NAMES[x.step]}${x.hidden ? ' · скрыт у всех классов' : ''}</p>
${coverCard}
${photoCard}
<form class="card form" method="post" action="/admin/o/${x.id}">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Название и описание</h2></div>
  ${fields}
  <label class="check"><input type="checkbox" name="hidden" value="1"${x.hidden ? raw(' checked') : ''}><span>Скрыть у всех классов</span></label>
  <button class="b b--main" type="submit">Сохранить</button>
</form>
<form class="card" method="post" action="/admin/o/${x.id}/delete">
  ${csrf(o.sess)}
  <p class="muted small">Если вариант больше не нужен. Если его уже выбирал какой-то класс, он пропадёт с сайта и у новых классов, но в прошлых итогах останется.</p>
  <button class="b b--wide b--danger" type="submit" data-confirm="Удалить «${x.name}» насовсем? Вернуть не получится">Удалить вариант</button>
</form>`
  });
}

// ---------- настройки ----------

function settingsPage(o) {
  const d = o.defaults;
  return layout({
    title: 'Настройки', nav: 'settings', sess: o.sess, msg: o.msg, err: o.err,
    body: html`<h1 class="h1">Настройки</h1>
<form class="card form" method="post" action="/admin/settings">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Для новых классов</h2></div>
  <p class="muted small">Подставляется при создании класса.</p>
  <div class="two">
    <label class="field"><span>Год выпуска</span><input name="year" type="number" inputmode="numeric" min="2020" max="2100" value="${d.year}" required></label>
    <label class="field"><span>Голосование длится</span>${durationSelect('duration_min', d.duration_min)}</label>
  </div>
  <div class="card__h"><h2 class="h">Шпаргалка для всех классов</h2></div>
  <p class="muted small">Видят все классы после голосования, и уже созданные тоже. Если у какого-то класса своё значение, оно важнее общего.</p>
  <label class="field"><span>Дата и время съёмки</span><input name="shoot" value="${d.shoot}" placeholder="Можно оставить пустым: у каждого класса своя" maxlength="120"></label>
  <label class="field"><span>Адрес студии</span><input name="address" value="${d.address}" maxlength="160"></label>
  <label class="field"><span>Что взять с собой</span><textarea name="bring" rows="3" maxlength="600">${d.bring}</textarea></label>
  <label class="field"><span>Ещё (по желанию)</span><textarea name="note" rows="2" maxlength="600">${d.note}</textarea></label>
  <button class="b b--main" type="submit">Сохранить</button>
</form>

<div class="card">
  <div class="card__h"><h2 class="h">Админка на телефоне</h2></div>
  <p class="muted small">Её можно поставить на экран «Домой», как приложение. На iPhone: в Safari нажмите «Поделиться», потом «На экран Домой». На Android: меню браузера, потом «Добавить на главный экран».</p>
</div>

<form class="card form" method="post" action="/admin/password">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Пароль</h2></div>
  <label class="field"><span>Текущий пароль</span><input type="password" name="current" autocomplete="current-password" required></label>
  <label class="field"><span>Новый пароль</span><input type="password" name="next" autocomplete="new-password" minlength="8" required></label>
  <label class="field"><span>Ещё раз</span><input type="password" name="repeat" autocomplete="new-password" minlength="8" required></label>
  <button class="b b--main" type="submit">Сменить пароль</button>
</form>

<form class="card" method="post" action="/admin/logout">
  ${csrf(o.sess)}
  <button class="b b--wide" type="submit">Выйти</button>
</form>`
  });
}

function notFoundPage(o) {
  return layout({ title: 'Не найдено', nav: '', sess: o.sess, body: html`<h1 class="h1">Не найдено</h1><p><a class="back" href="/admin">← Классы</a></p>` });
}

module.exports = {
  layout, loginPage, classesPage, newClassPage, classPage, resultsBlock, sitePage, galleryPage,
  catalogPage, optionPage, settingsPage, notFoundPage, fmtDate
};
