'use strict';

// Страница класса. Из этого же шаблона собирается демо class.html (node cli.js demo)

const { html, raw, plural, fmtWhen } = require('../lib/util');
const { activeSteps, cheat } = require('../lib/voting');

const STEP_TITLE = { theme: 'Тематика альбома', wear: 'Стиль одежды', color: 'Цвет одежды' };
const STEP_SHORT = { theme: 'Тематика', wear: 'Одежда', color: 'Цвет' };
const STEP_OK = { theme: 'Голос за тематику учтён.', wear: 'Голос за одежду учтён.', color: 'Голос за цвет учтён.' };

// JSON внутри <script>: без </script> и переводов строк, которые ломают JS
function safeJson(o) {
  return JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// Длина самого длинного слова: по ней уменьшается шрифт названия школы
function longest(s) {
  return Math.max(5, ...String(s).split(/[\s-]+/).map(w => w.length));
}

function variants(n) { return n + ' ' + plural(n, 'вариант', 'варианта', 'вариантов'); }
function people(n) { return n + ' ' + plural(n, 'человек', 'человека', 'человек'); }

function strip(base, photos, tall) {
  return raw('<div class="strip' + (tall ? ' strip--tall' : '') + '" data-carousel data-auto="3600">' + photos.map((p, i) => {
    const cls = !tall && i === 0 ? 'ph ph--cover' : 'ph';
    const cap = p.cap || '';
    return html`<a class="${cls}" href="${base + p.src}-lg.jpg" style="--ar:${p.ar}"><img src="${base + p.src}-sm.jpg" alt="${cap}" loading="lazy" decoding="async">${cap ? html`<span>${cap}</span>` : ''}</a>`.s;
  }).join('') + '</div>');
}

function foot(o, pickLabel, disabled) {
  return html`<div class="opt__foot"><button class="pick" type="button" data-label="${o.name}"${disabled ? raw(' disabled') : ''}>${pickLabel}</button><div class="res"><div class="res__bar"><i></i></div><b class="res__pct">0%</b></div></div>`;
}

function themeCard(base, o, v) {
  const about = (o.about || []).map(p => html`<p>${p}</p>`);
  const loc = o.loc ? html`<p class="loc">Групповые: ${o.loc}</p>` : '';
  const more = about.length || o.loc
    ? html`
      <details class="more"${v.open ? raw(' open') : ''}><summary>Подробнее о стиле</summary>${about}${loc}</details>`
    : '';
  return html`
    <article class="opt theme t--${o.key}"${v.ids ? html` id="t-${o.key}"` : ''} data-id="${o.key}" data-name="${o.name}" data-loc="${o.loc || ''}" data-covers="${o.covers === 2 ? 2 : 1}">
      <div class="theme__head">
        ${o.tag ? html`<span class="theme__tag">${o.tag}</span>` : ''}
        <h3 class="theme__title">${o.name}</h3>
        ${o.lead ? html`<p class="theme__lead">${o.lead}</p>` : ''}
      </div>
      ${strip(base, o.photos || [], false)}${more}
      ${foot(o, v.pick, v.disabled)}
    </article>`;
}

function wearCard(base, o, v) {
  return html`
    <article class="opt wear"${v.ids ? html` id="w-${o.key}"` : ''} data-id="${o.key}" data-name="${o.name}">
      <div class="wear__head"><h3>${o.name}</h3>${o.sub ? html`<p>${o.sub}</p>` : ''}</div>
      ${strip(base, o.photos || [], true)}
      ${o.pin ? html`<a class="pin" href="${o.pin}" target="_blank" rel="noopener">Больше примеров в Pinterest</a>` : ''}
      ${foot(o, v.pick, v.disabled)}
    </article>`;
}

function colorCard(base, o, v) {
  const sw = (o.colors || []).map(c => html`<i style="background:${c}"></i>`);
  return html`
    <article class="opt color"${v.ids ? html` id="c-${o.key}"` : ''} data-id="${o.key}" data-name="${o.name}">
      <div class="sw">${sw}</div>
      <h3>${o.name}</h3>
      ${o.plus ? html`<p class="color__plus"><i></i><i></i>+ чёрный и белый</p>` : ''}
      ${foot(o, v.pick, v.disabled)}
    </article>`;
}

const CARD = { theme: themeCard, wear: wearCard, color: colorCard };

function stepSection(base, step, n, total, list, v) {
  const next = v.next;
  const head = {
    theme: 'Листай развороты вбок, нажми на фото, чтобы рассмотреть. Выбери одну тематику.',
    wear: 'Во что одеваемся на съёмку. Примеры можно листать.',
    color: 'Нужно, чтобы у всех была одна цветовая гамма, поэтому выбираем акцентный оттенок, который будет у всех. К любому цвету можно чёрный и белый, но оттенок, который выберет класс, должен быть обязательно.'
  }[step];
  const jump = step === 'theme' && list.length > 1
    ? html`
  <nav class="jump" aria-label="Все тематики">${list.map(o => html`<a href="#t-${o.key}">${o.name}</a>`)}</nav>`
    : '';
  const cards = list.map(o => CARD[step](base, o, v));
  const body = step === 'color' ? html`
  <div class="colors">${cards}</div>` : cards;
  const ok = next
    ? html`<p class="step__ok">${STEP_OK[step]} <a href="#s-${next}">Дальше ${STEP_SHORT[next].toLowerCase()}</a></p>`
    : html`<p class="step__ok">${STEP_OK[step]}</p>`;
  return html`
<section class="step" id="s-${step}" data-step="${step}">
  <header class="step__head">
    <p class="step__n">Этап ${n} из ${total}</p>
    <h2>${STEP_TITLE[step]}</h2>
    <p>${head}</p>
  </header>${jump}
  ${body}
  ${ok}
</section>
`;
}

function pendingBox(step, r) {
  const names = r.tie.map(o => o.name);
  const title = names.length > 1 ? 'Ничья: ' + names.join(' и ') : 'Голосов не было';
  return html`<div class="pending"><p class="eyebrow">${STEP_TITLE[step]}</p><h3>${title}</h3><p>Выберу сам и напишу в чате класса. Страница обновится.</p></div>`;
}

function resultSection(base, p) {
  const r = p.result;
  const slot = step => {
    if (!r) return '';
    if (!r[step]) return '';
    if (!r[step].option) return pendingBox(step, r[step]);
    return CARD[step](base, r[step].option, { ids: false, open: true, pick: 'Выбрать', disabled: true });
  };
  const rows = r ? cheat(p.cls, r) : [
    { label: 'Тематика', fill: 'theme' },
    { label: 'Одежда', fill: 'wear' },
    { label: 'Групповые', fill: 'loc' },
    { label: 'Дата и время съёмки', value: 'Сообщу в чате класса', muted: true },
    { label: 'Адрес студии', value: 'Сообщу в чате класса', muted: true },
    { label: 'Что взять с собой', value: 'Сообщу в чате класса', muted: true }
  ];
  const total = r ? p.state.voters : null;
  return html`
<section class="result" id="result">
  <header class="result__head">
    <p class="eyebrow">Голосование закрыто</p>
    <h2>Выбор класса</h2>
    <p>${r ? (total ? html`Проголосовали <b>${people(total)}</b>. ` : '') : html`Проголосовали <b data-fill="total">22</b> человека. `}Теперь это ваша шпаргалка по альбому.</p>
  </header>
  <div class="result__slot" data-slot="theme">${slot('theme')}</div>
  <div class="result__pair">
    <div class="result__slot" data-slot="wear">${slot('wear')}</div>
    <div class="result__slot" data-slot="color">${slot('color')}</div>
  </div>
  <div class="cheat">
    <h3>Шпаргалка к съёмке</h3>
    <dl>
${rows.map(x => html`      <div${x.muted ? raw(' class="is-admin"') : ''}><dt>${x.label}</dt><dd${x.fill ? html` data-fill="${x.fill}"` : ''}>${x.value || ''}</dd></div>
`)}    </dl>
  </div>
</section>
`;
}

function timerText(p) {
  if (p.status === 'closed') return 'закрыто';
  if (p.status === 'draft') {
    if (!p.state || !p.state.opensAt) return 'скоро';
    const s = Math.max(0, Math.floor((p.state.opensAt - Date.now()) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    const two = n => (n < 10 ? '0' : '') + n;
    return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
  }
  const left = Math.max(0, (p.state && p.state.endsAt ? p.state.endsAt : Date.now() + 45 * 60000) - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// p: { cls, opts, status, state, result, base, demo, meta, nonce, config }
function classPage(p) {
  const base = p.base;
  const opts = p.opts;
  const steps = activeSteps(opts);
  const closed = p.status === 'closed';
  const draft = p.status === 'draft';
  const planned = draft && p.state && p.state.opensAt;
  const year = p.cls.year;
  const v = { ids: true, pick: draft ? 'Голосование скоро' : 'Выбрать', disabled: draft };
  const nonce = p.nonce ? html` nonce="${p.nonce}"` : '';
  const voters = p.state ? p.state.voters : 22;
  const cfg = p.config ? raw(safeJson(p.config)) : null;

  const voting = closed ? '' : html`
<div class="voting">
${steps.map((s, i) => stepSection(base, s, i + 1, steps.length, opts[s], Object.assign({ next: steps[i + 1] }, v)))}
<section class="done" id="done">
  <p class="eyebrow">Готово</p>
  <h2>${steps.length === 3 ? 'Все три голоса учтены' : 'Все голоса учтены'}</h2>
  <p>Когда голосование закроется, на этой странице останется выбор класса и всё, что нужно знать перед съёмкой. Ссылка та же.</p>
</section>

</div>
`;

  return '<!doctype html>\n' + html`<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${p.meta.title}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#F4EFE7">
<link rel="icon" href="${base}assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${base}assets/apple-touch-icon.png">
<link rel="manifest" href="${base}assets/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RIGSARTHUR SCHOOL ALBUMS">
<meta property="og:title" content="${p.meta.ogTitle}">
<meta property="og:description" content="Голосование за тематику альбома, одежду и цвет. RIGSARTHUR SCHOOL ALBUMS.">
<meta property="og:image" content="${p.meta.image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${p.meta.url}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="${base}assets/fonts/unbounded-cyrillic-cb504d.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${base}assets/fonts/manrope-cyrillic-c9a5f1.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${base}assets/fonts/fonts.css">
<link rel="stylesheet" href="${base}assets/fonts/theme-fonts.css">
<link rel="stylesheet" href="${base}assets/klass/klass.css">
<script${nonce}>document.documentElement.className += ' js';</script>
</head>
<body class="is-${p.status}">
${p.demo ? html`
<div class="demo" role="region" aria-label="Панель показа">
  <button type="button" data-demo="open" aria-pressed="true">Голосование</button>
  <button type="button" data-demo="closed" aria-pressed="false">Итог</button>
  <button type="button" data-demo="reset">Сбросить мой голос</button>
</div>
` : ''}
<header class="top">
  <div class="top__row">
    <a class="logo" href="#top"><b>RIGSARTHUR</b><span>SCHOOL ALBUMS</span></a>
    <p class="timer"><i></i><span class="timer__label"${p.status === 'open' || planned ? '' : raw(' style="display:none"')}>${planned ? 'до старта' : 'до конца'}</span> <b id="timer">${timerText(p)}</b></p>
  </div>
${closed ? '' : html`  <nav class="steps" aria-label="Этапы">
${steps.map((s, i) => html`    <a href="#s-${s}" data-step="${s}"><i>${i + 1}</i>${STEP_SHORT[s]}</a>
`)}  </nav>
`}</header>

<main id="top">

<section class="hero">
  <p class="hero__spine" aria-hidden="true">RIGSARTHUR · SCHOOL ALBUMS · ${year}</p>
  <p class="eyebrow">Выпускной альбом ${year}</p>
  <h1 style="--w:${longest(p.cls.school)}"><span>${p.cls.school}</span><em>${p.cls.title}</em></h1>
  <p class="hero__lead">Привет, ребят, это личная страничка вашего класса для альбомов. Тут вы выберете понравившийся вариант, а потом останется только ваш выбор и вся основная информация по альбому. Короче, ваша шпаргалка.</p>
${draft ? html`  <p class="draft">${planned ? 'Голосование начнётся ' + fmtWhen(p.state.opensAt) + '.' : 'Голосование ещё не началось.'} Варианты уже можно посмотреть, а когда голосование откроется, страница обновится сама.</p>
` : ''}  <ol class="hero__steps">
${steps.map((s, i) => html`    <li><b>${i + 1}</b><span>${STEP_TITLE[s]}</span><small>${variants(opts[s].length)}</small></li>
`)}  </ol>
  <p class="hero__small">Локацию для групповых выбираем в чате. Если у тематики на выбор две обложки, вариант тоже утверждаем в чате.</p>
  <div class="hero__meta"><span><b id="voters">${voters}</b> уже проголосовали</span><a class="btn" href="#s-${steps[0] || 'theme'}">${draft ? 'Смотреть варианты' : 'Начать выбор'}</a></div>
</section>
${voting}${closed || p.demo ? resultSection(base, p) : ''}
<section class="react">
  <p>Как тебе страница выбора? Я очень старался, чтобы вам было удобно</p>
  <div class="react__row">
    <button type="button" data-v="bad" aria-label="Плохо">💩</button>
    <button type="button" data-v="love" aria-label="Нравится">❤️</button>
    <button type="button" data-v="ok" aria-label="Нормально">🙂</button>
    <button type="button" data-v="wow" aria-label="Очень нравится">😍</button>
  </div>
</section>

</main>

<footer class="foot">
  <p><b>RIGSARTHUR SCHOOL ALBUMS</b> · Нальчик</p>
  <p>Вопросы по альбому: <a href="https://wa.me/79287100102">Артур в WhatsApp</a></p>
</footer>

<div class="bar" aria-live="polite">
  <p><small>Твой выбор</small><b class="bar__name"></b></p>
  <button type="button" class="bar__go">Голосую</button>
</div>

<div class="lb" hidden>
  <button type="button" class="lb__close" aria-label="Закрыть">Закрыть</button>
  <figure><img alt=""><figcaption></figcaption></figure>
  <button type="button" class="lb__nav lb__prev" aria-label="Назад">‹</button>
  <button type="button" class="lb__nav lb__next" aria-label="Дальше">›</button>
</div>

${cfg ? html`<script${nonce}>window.RIGS_CLASS = ${cfg};</script>
` : ''}<script src="${base}assets/carousel.js"></script>
<script src="${base}assets/klass/klass.js"></script>
</body>
</html>
`.s;
}

module.exports = { classPage };
