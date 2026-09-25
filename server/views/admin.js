'use strict';

const { html, raw, plural, fmtTime, fmtDate, fmtWhen, toLocalInput, tzParts } = require('../lib/util');
const { STEP_NAMES, status, opensAt, visibleOptions, activeSteps, resolve } = require('../lib/voting');
const { STEPS } = require('../lib/db');
const { SLOTS, GALLERIES, TEXTS, TOGGLES, THEMES, isWide } = require('../lib/site');

const MSG = {
  saved: 'Сохранено',
  created: 'Класс создан. Проверьте данные и отправьте ссылку классу',
  copied: 'Копия создана. Проверьте название класса',
  opened: 'Голосование началось',
  scheduled: 'Старт запланирован. Страница откроется для голосования сама',
  unscheduled: 'Запланированный старт отменён',
  closed: 'Голосование закрыто',
  extended: 'Время продлено',
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
  optdeleted: 'Вариант удалён',
  opthidden: 'Вариант убран с сайта и у новых классов. Его уже выбирали, поэтому в их итогах он сохранится',
  optcreated: 'Вариант создан и пока скрыт. Добавьте фото и тексты, потом снимите галочку «Скрыть»'
};

const ERR = {
  last: 'Последнее фото убрать нельзя. Сначала добавьте новые',
  lastphoto: 'Последнее фото убрать нельзя, пока вариант показан классам',
  name: 'Напишите название',
  used: 'Этот вариант уже выбирали классы, поэтому удалить его нельзя: сломаются их итоги. Поставьте галочку «Скрыть у всех классов», и новые классы его не увидят',
  lastopt: 'Это последний вариант этапа, его нельзя удалить'
};

const DURATIONS = [15, 30, 45, 60, 90, 120];
const REACT = { wow: '😍', love: '❤️', ok: '🙂', bad: '💩' };

function votes(n) { return n + ' ' + plural(n, 'голос', 'голоса', 'голосов'); }
function people(n) { return n + ' ' + plural(n, 'человек', 'человека', 'человек'); }
function photosN(n) { return n + ' фото'; }

function left(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
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
</body>
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
      <button class="ic ic--copy" type="button" data-copy="${base}/k/${c.slug}" aria-label="Скопировать ссылку на страницу класса" title="Скопировать ссылку">⧉</button>
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

// ---------- новый класс ----------

function durationSelect(name, value) {
  const list = DURATIONS.indexOf(value) === -1 ? DURATIONS.concat(value).sort((a, b) => a - b) : DURATIONS;
  return html`<select name="${name}">${list.map(d => html`<option value="${d}"${d === value ? raw(' selected') : ''}>${d} мин</option>`)}</select>`;
}

function newClassPage(o) {
  const d = o.defaults;
  const f = o.form || {};
  return layout({
    title: 'Новый класс', nav: 'classes', sess: o.sess, err: o.err,
    body: html`<a class="back" href="/admin">← Классы</a>
<h1 class="h1">Новый класс</h1>
<form class="card form" method="post" action="/admin/new">
  ${csrf(o.sess)}
  <label class="field"><span>Школа</span><input name="school" value="${f.school || ''}" placeholder="Лицей №2" required maxlength="60" autocomplete="off"></label>
  <label class="field"><span>Класс</span><input name="title" value="${f.title || ''}" placeholder="11 «Б»" required maxlength="40" autocomplete="off"></label>
  <div class="two">
    <label class="field"><span>Год выпуска</span><input name="year" type="number" inputmode="numeric" min="2020" max="2100" value="${f.year || d.year}" required></label>
    <label class="field"><span>Голосование длится</span>${durationSelect('duration_min', +(f.duration_min || d.duration_min))}</label>
  </div>
  <p class="muted small">Адрес, что взять с собой и остальное для шпаргалки подставятся из настроек, их можно поменять на странице класса.</p>
  <button class="b b--main b--wide" type="submit">Создать страницу класса</button>
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
    return html`<div class="res">
    <h3 class="res__h">${STEP_NAMES[step]} <small>${votes(total)}</small></h3>
    ${note}
    <ul class="bars">${sorted.map(x => {
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
    })}</ul>
  </div>`;
  });
  const reacts = Object.keys(REACT).filter(k => o.reactions[k]);
  return html`<div class="card" id="results"${st === 'open' ? html` data-refresh="/admin/c/${c.id}/results"` : ''}>
  <div class="card__h"><h2 class="h">Голоса</h2><span class="muted">${people(o.voters)}</span></div>
  ${st === 'open' ? html`<p class="online"><i></i>Сейчас на странице: <b>${o.online}</b></p>` : ''}
  ${steps}
  ${reacts.length ? html`<p class="reacts">Как им страница: ${reacts.map(k => html`<span>${REACT[k]} ${o.reactions[k]}</span>`)}</p>` : ''}
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
  <p class="muted">Голосование начнётся ${fmtWhen(at, now)} и продлится ${c.duration_min} мин. До этого ребята видят варианты, но голосовать не могут. Страница откроется у всех сама.</p>
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
    <button class="b b--main" type="submit">Начать сейчас</button>
  </form>
  <details class="more">
    <summary>Запланировать старт на время</summary>
    <form method="post" action="/admin/c/${c.id}/schedule" class="form plan">
      ${csrf(o.sess)}
      <label class="field"><span>Когда начать</span><input type="datetime-local" name="at" value="${toLocalInput(soon)}" min="${toLocalInput(now)}" required></label>
      <label class="field field--inline"><span>Длится</span>${durationSelect('duration_min', c.duration_min)}</label>
      <button class="b b--main" type="submit">Запланировать</button>
    </form>
  </details>
</div>`;
  }
  if (st === 'open') {
    return html`<div class="card ctl ctl--live">
  <div class="card__h"><h2 class="h">Идёт голосование</h2><span class="chip chip--live">до ${fmtTime(c.ends_at)}</span></div>
  <p class="count" data-ends="${c.ends_at}" data-now="${now}">${left(c.ends_at - now)}</p>
  <div class="ctl__btns">
    <form method="post" action="/admin/c/${c.id}/extend">${csrf(o.sess)}<input type="hidden" name="min" value="10"><button class="b" type="submit">+10 мин</button></form>
    <form method="post" action="/admin/c/${c.id}/extend">${csrf(o.sess)}<input type="hidden" name="min" value="30"><button class="b" type="submit">+30 мин</button></form>
    <form method="post" action="/admin/c/${c.id}/close" data-confirm="Закрыть голосование сейчас? Класс сразу увидит итог.">${csrf(o.sess)}<button class="b b--danger" type="submit">Закрыть сейчас</button></form>
  </div>
</div>`;
  }
  return html`<div class="card ctl">
  <div class="card__h"><h2 class="h">Голосование закрыто</h2><span class="chip chip--done">${fmtDate(c.closed_at || c.ends_at)}</span></div>
  <details class="more">
    <summary>Открыть заново</summary>
    <p class="muted small">Голоса сохранятся, ручной выбор победителя сбросится.</p>
    <form method="post" action="/admin/c/${c.id}/open" class="ctl__row" data-confirm="Открыть голосование заново?">
      ${csrf(o.sess)}
      <label class="field field--inline"><span>Ещё</span>${durationSelect('duration_min', 15)}</label>
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
  <p class="muted small">Класс увидит это после голосования. Пустые поля покажутся как «Сообщу в чате класса».</p>
  <label class="field"><span>Дата и время съёмки</span><input name="shoot" value="${c.shoot}" placeholder="Суббота, 12 октября, 15:00" maxlength="120"></label>
  <label class="field"><span>Адрес студии</span><input name="address" value="${c.address}" maxlength="160"></label>
  <label class="field"><span>Что взять с собой</span><textarea name="bring" rows="3" maxlength="600">${c.bring}</textarea></label>
  <label class="field"><span>Ещё (по желанию)</span><textarea name="note" rows="2" maxlength="600">${c.note}</textarea></label>
  <button class="b b--main" type="submit">Сохранить шпаргалку</button>
</form>

<form class="card form" method="post" action="/admin/c/${c.id}/options" id="options">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Варианты для этого класса</h2></div>
  <p class="muted small">Снимите галочку, чтобы вариант не показывался этому классу.</p>
  ${STEPS.map(step => html`<fieldset class="checks">
    <legend>${STEP_NAMES[step]}</legend>
    ${all[step].map(x => {
      const on = c.hidden.indexOf(step + ':' + x.key) === -1;
      return html`<label class="check${x.hidden ? ' is-off' : ''}"><input type="checkbox" name="on" value="${step}:${x.key}"${on ? raw(' checked') : ''}${x.hidden ? raw(' disabled') : ''}><span>${x.name}${x.hidden ? html` <small>скрыт в разделе «Варианты»</small>` : ''}</span></label>`;
    })}
  </fieldset>`)}
  <button class="b b--main" type="submit">Сохранить варианты</button>
</form>

<form class="card form" method="post" action="/admin/c/${c.id}/info" id="info">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Данные класса</h2></div>
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

<form class="card form" method="post" action="/admin/c/${c.id}/duplicate" id="duplicate">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Дублировать</h2></div>
  <p class="muted small">Новая страница с теми же вариантами, шпаргалкой и длительностью. Голоса не копируются.</p>
  <label class="field"><span>Школа</span><input name="school" value="${c.school}" required maxlength="60"></label>
  <label class="field"><span>Класс</span><input name="title" value="" placeholder="${o.nextTitle}" required maxlength="40"></label>
  <button class="b b--main" type="submit">Создать копию</button>
</form>

<div class="card danger">
  <div class="card__h"><h2 class="h">Ещё</h2></div>
  <form method="post" action="/admin/c/${c.id}/archive">${csrf(o.sess)}<input type="hidden" name="on" value="${c.archived ? 0 : 1}"><button class="b" type="submit">${c.archived ? 'Вернуть из архива' : 'Убрать в архив'}</button></form>
  <form method="post" action="/admin/c/${c.id}/reset" data-confirm="Удалить все голоса этого класса? Это нельзя отменить.">${csrf(o.sess)}<button class="b b--danger" type="submit">Сбросить голоса</button></form>
  <form method="post" action="/admin/c/${c.id}/delete" data-confirm="Удалить страницу класса вместе с голосами? Ссылка перестанет работать. Это нельзя отменить.">${csrf(o.sess)}<button class="b b--danger" type="submit">Удалить класс</button></form>
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

function coverTile(o, key) {
  const def = SLOTS[key];
  const value = o.values[key];
  return html`<div class="cover" id="${key}">
    ${slotPic(key, value, o.defaults.media[key], 'cover')}
    <b>${def.label}</b>
    ${uploadButton({ mode: 'slot', url: '/admin/api/site/' + key, back: '/admin/site?m=photo#' + key, label: 'Заменить', sm: true, wide: true })}
    ${value ? html`<form method="post" action="/admin/site/reset/${key}" data-confirm="Вернуть исходную обложку ${def.label}?">${csrf(o.sess)}<button class="link" type="submit">Вернуть как было</button></form>` : ''}
    ${uploadState()}
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
  const coverKeys = THEMES.map(t => 'cover.' + t[0]);
  const photoKeys = ['arthur', 'album', 'studio.main', 'studio.rest', 'studio.extra'];
  const t = o.texts;
  return layout({
    title: 'Сайт', nav: 'site', sess: o.sess, msg: o.msg, err: o.err,
    body: html`<div class="head">
  <h1 class="h1">Сайт</h1>
  <a class="b b--sm" href="/" target="_blank" rel="noopener">Открыть сайт ↗</a>
</div>
<p class="muted intro">Здесь меняются фото, видео и цены на сайте. Всё видно на сайте сразу после сохранения. Фото с телефона сами уменьшаются перед загрузкой, ничего готовить не нужно.</p>
<nav class="toc">
  <a href="#prices">Цены</a><a href="#home.video">Видео</a><a href="#galleries">Работы</a><a href="#covers">Обложки</a><a href="#photos">Другие фото</a>
</nav>

<form class="card form" method="post" action="/admin/site/texts" id="prices">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Цены</h2><span class="muted small">Главная и «Альбомы и цены»</span></div>
  <div class="two">
    <label class="field"><span>${TEXTS['price.main'].label}</span><input name="price.main" value="${t['price.main']}" maxlength="${TEXTS['price.main'].max}" inputmode="numeric" required></label>
    <label class="field"><span>${TEXTS['price.tag'].label}</span><input name="price.tag" value="${t['price.tag']}" maxlength="${TEXTS['price.tag'].max}"></label>
  </div>
  <label class="field"><span>${TEXTS['price.note'].label}</span><input name="price.note" value="${t['price.note']}" maxlength="${TEXTS['price.note'].max}"></label>
  <fieldset class="checks group-price">
    <legend>Скидка для параллели</legend>
    <label class="check"><input type="checkbox" name="price.group" value="1"${o.toggles['price.group'] ? raw(' checked') : ''}><span>${TOGGLES['price.group'].label}</span></label>
    <label class="field"><span>${TEXTS['price.group.title'].label}</span><input name="price.group.title" value="${t['price.group.title']}" maxlength="${TEXTS['price.group.title'].max}"></label>
    <div class="two">
      <label class="field"><span>${TEXTS['price.group.two'].label}</span><input name="price.group.two" value="${t['price.group.two']}" maxlength="${TEXTS['price.group.two'].max}"></label>
      <label class="field"><span>${TEXTS['price.group.three'].label}</span><input name="price.group.three" value="${t['price.group.three']}" maxlength="${TEXTS['price.group.three'].max}"></label>
    </div>
  </fieldset>
  <p class="muted small">Если поле очистить, вернётся исходный текст. Например, после Нового года поставьте цену 5 000, надпись над ценой можно убрать, а скидку для параллели выключить.</p>
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

<section class="card" id="covers">
  <div class="card__h"><h2 class="h">Обложки тематик</h2></div>
  <p class="muted small">Вертикальные, как обложка альбома. Видны на первом экране главной и на полке «Каждый год новый уникальный дизайн».</p>
  <div class="covers">${coverKeys.map(k => coverTile(o, k))}</div>
</section>

<section class="card" id="photos">
  <div class="card__h"><h2 class="h">Другие фото</h2></div>
  ${photoKeys.map(k => slotRow(o, k))}
</section>

<p class="muted small">Фото разворотов в карточках тематик меняются в разделе <a href="/admin/catalog">«Варианты»</a>: там они сразу обновятся и на странице «Дизайны», и у классов.</p>`
  });
}

function galleryPage(o) {
  const g = o.gallery;
  const n = g.items.length;
  return layout({
    title: o.def.label, nav: 'site', sess: o.sess, msg: o.msg, errCode: o.errCode,
    body: html`<a class="back" href="/admin/site#galleries">← Сайт</a>
<h1 class="h1">${o.def.label}</h1>
<p class="muted">${o.def.where} · ${photosN(n)}</p>
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

const ADD_LABEL = { theme: 'Новая тематика', wear: 'Новый стиль одежды', color: 'Новый цвет' };

function catalogPage(o) {
  return layout({
    title: 'Варианты', nav: 'catalog', sess: o.sess, msg: o.msg, errCode: o.errCode,
    body: html`<h1 class="h1">Варианты</h1>
<p class="muted">Тематики, стили и цвета, из которых выбирают классы. Изменения сразу видны на страницах классов и на странице «Дизайны».</p>
${STEPS.map(step => html`<section class="group">
  <h2 class="group__h">${STEP_NAMES[step]} <span>${o.catalog[step].length}</span></h2>
  <div class="rows">${o.catalog[step].map((x, i, arr) => html`<div class="row row--opt${x.hidden ? ' is-off' : ''}">
    ${optionThumb(x)}
    <a class="row__main" href="/admin/o/${x.id}"><b>${x.name}</b><small>${x.hidden ? 'Скрыт у всех классов' : step === 'theme' ? (x.tag || '') : step === 'wear' ? (x.sub || '') : (x.plus ? '+ чёрный и белый' : '')}</small></a>
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
  } else if (x.step === 'wear') {
    fields = html`<label class="field"><span>Название</span><input name="name" value="${x.name}" required maxlength="40"></label>
  <label class="field"><span>Подпись</span><input name="sub" value="${x.sub || ''}" maxlength="80"></label>
  <label class="field"><span>Ссылка на Pinterest</span><input name="pin" type="url" value="${x.pin || ''}" maxlength="300" placeholder="https://pin.it/..."></label>`;
  } else {
    fields = html`<label class="field"><span>Название</span><input name="name" value="${x.name}" required maxlength="80"></label>
  <label class="field"><span>Цвета</span><span class="colors">${[0, 1, 2, 3].map(i => html`<input type="color" name="c${i}" value="${(x.colors || [])[i] || '#ffffff'}" aria-label="Цвет ${i + 1}">`)}</span></label>
  <label class="field"><span>Сколько цветов показывать</span><select name="count">${[1, 2, 3, 4].map(n => html`<option value="${n}"${n === (x.colors || []).length ? raw(' selected') : ''}>${n}</option>`)}</select></label>
  <label class="check"><input type="checkbox" name="plus" value="1"${x.plus ? raw(' checked') : ''}><span>Подпись «+ чёрный и белый»</span></label>`;
  }
  const theme = x.step === 'theme';
  const photoCard = x.step === 'color' ? '' : html`
<form class="card form photos-card" method="post" action="/admin/o/${x.id}/photos" id="photos">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Фото</h2><span class="muted">${photosN(photos.length)}</span></div>
  <p class="muted small">${theme ? 'Первое фото показывается как обложка тематики. ' : ''}Можно выбрать сразу несколько фото. Стрелками меняется порядок.</p>
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
  return layout({
    title: x.name, nav: 'catalog', sess: o.sess, msg: o.msg, err: o.err, errCode: o.errCode,
    body: html`<a class="back" href="/admin/catalog">← Варианты</a>
<h1 class="h1">${x.name}</h1>
<p class="muted">${STEP_NAMES[x.step]}${x.hidden ? ' · скрыт у всех классов' : ''}</p>
<form class="card form" method="post" action="/admin/o/${x.id}">
  ${csrf(o.sess)}
  ${fields}
  <label class="check"><input type="checkbox" name="hidden" value="1"${x.hidden ? raw(' checked') : ''}><span>Скрыть у всех классов</span></label>
  <button class="b b--main" type="submit">Сохранить</button>
</form>
${photoCard}
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
  <p class="muted small">Подставляется при создании класса. У уже созданных классов не меняется.</p>
  <div class="two">
    <label class="field"><span>Год выпуска</span><input name="year" type="number" inputmode="numeric" min="2020" max="2100" value="${d.year}" required></label>
    <label class="field"><span>Голосование длится</span>${durationSelect('duration_min', d.duration_min)}</label>
  </div>
  <label class="field"><span>Адрес студии</span><input name="address" value="${d.address}" maxlength="160"></label>
  <label class="field"><span>Что взять с собой</span><textarea name="bring" rows="3" maxlength="600">${d.bring}</textarea></label>
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
