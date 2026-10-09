'use strict';

// Отбор фото: страница в админке и страница для учеников
const { html, raw, plural, fmtWhen } = require('../lib/util');
const { layout } = require('./admin');

function photosN(n) { return n + ' фото'; }
const GB = 1024 * 1024 * 1024;
function size(bytes) {
  if (bytes < GB) return Math.max(bytes ? 1 : 0, Math.round(bytes / 1048576)) + ' МБ';
  return (bytes / GB).toFixed(1).replace('.', ',') + ' ГБ';
}
function people(n) { return n + ' ' + plural(n, 'ученик', 'ученика', 'учеников'); }
function csrf(sess) { return html`<input type="hidden" name="_csrf" value="${sess.csrf}">`; }

const MSG = {
  saved: 'Сохранено',
  students: 'Список учеников сохранён',
  closed: 'Отбор закрыт. Ученики видят свой выбор, но поменять уже не могут',
  opened: 'Отбор снова открыт',
  removed: 'Раздел удалён'
};

// ---------- админка: /admin/c/:id/photos ----------
function adminPage(o) {
  const c = o.cls, a = o.album;
  const link = o.base + '/f/' + a.slug;
  const bySection = new Map();
  o.photos.forEach(p => {
    if (!bySection.has(p.section)) bySection.set(p.section, { n: 0, ready: 0 });
    const s = bySection.get(p.section);
    s.n++;
    if (p.has_sm) s.ready++;
  });
  const sections = Array.from(bySection.keys()).sort((x, y) => x.localeCompare(y, 'ru'));
  const counts = o.counts;
  // «Всё выбрал» — свои фото до лимита и цитата
  const finished = s => (counts.get(s.id) || 0) >= a.personal_max && !!s.quote;
  const done = o.students.filter(finished).length;
  const left = o.students.filter(s => !finished(s));
  const hasGroup = sections.some(s => o.isGroup(s));
  const chat = 'Ребята, выбираем фото для выпускного альбома! 📸\n\n' + link + '\n\n' +
    '1. Найдите себя в списке — выбирайте только себя.\n' +
    '2. «Мои фото» — отметьте ' + a.personal_max + ' своих фото.\n' +
    (hasGroup ? '3. «Групповые» — это ОБЩИЙ выбор всего класса: все видят одно и то же. Не убирайте чужие фото без причины — заменяйте, если очень хочется другое.\n4. «Цитата» — напишите фразу для альбома.\n'
      : '3. «Цитата» — напишите фразу для альбома.\n') +
    '\nПоменять выбор можно, пока я не закрою отбор.';
  const remind = left.length ? 'Напоминаю про выбор фото для альбома. Ещё не закончили: ' + left.map(s => s.name).join(', ') + '.\n\n' + link : '';
  const body = html`
<a class="back" href="/admin/c/${c.id}">← ${c.title} · ${c.school}</a>
<h1 class="h1">Отбор фото</h1>
<p class="muted small" style="margin:6px 0 18px">Пробная версия. Ученикам откроется только по ссылке ниже, голосование класса это не затрагивает.</p>
${o.msg && MSG[o.msg] ? html`<p class="flash" role="status">${MSG[o.msg]}</p>` : ''}
${o.err ? html`<p class="flash flash--err" role="alert">${o.err}</p>` : ''}

<section class="card">
  <div class="card__h"><h2 class="h">Ссылка для класса</h2><span class="chip">${a.closed_at ? 'закрыт' : 'открыт'}</span></div>
  <p class="link"><code>${link}</code></p>
  <div class="two" style="margin-top:12px">
    <button class="b" type="button" data-copy="${link}">Скопировать ссылку</button>
    <a class="b" href="/f/${a.slug}?admin=1" target="_blank" rel="noopener">Открыть как Артур</a>
  </div>
  <p class="muted small" style="margin-top:10px">«Открыть как Артур» — там вы заранее отмечаете общие групповые. Ученики видят ваш выбор и могут заменить.</p>
  <details class="pk-msg">
    <summary>Сообщение для чата класса</summary>
    <textarea readonly rows="10">${chat}</textarea>
    <div class="two">
      <button class="b b--sm" type="button" data-copy="${chat}">Скопировать</button>
      <a class="b b--sm" href="https://wa.me/?text=${encodeURIComponent(chat)}" target="_blank" rel="noopener" data-share data-share-text="${chat}">Отправить</a>
    </div>
  </details>
  <form method="post" action="/admin/c/${c.id}/photos/${a.closed_at ? 'open' : 'close'}" style="margin-top:14px"${a.closed_at ? '' : raw(' data-confirm="Закрыть отбор? Ученики больше не смогут менять выбор"')}>
    ${csrf(o.sess)}
    <button class="b b--wide${a.closed_at ? '' : ' b--main'}" type="submit">${a.closed_at ? 'Открыть отбор снова' : 'Закрыть отбор'}</button>
  </form>
</section>

<section class="card">
  <div class="card__h"><h2 class="h">Фото</h2><span class="muted small">${photosN(o.photos.length)}</span></div>
  <p class="muted small">Выберите папку с оригиналами, внутри которой подпапки: «Парни», «Девочки», «Групповые» и т. д. Браузер сам сделает лёгкие копии и загрузит только их — оригиналы останутся у вас. Уже загруженные фото пропускаются, так что можно добавлять новые в любой момент.</p>
  <label class="b b--main b--wide upl" style="margin-top:12px">
    <input type="file" webkitdirectory multiple data-pk-upload="${c.id}">
    <span>Выбрать папку с фото</span>
  </label>
  <div class="upl__state" data-pk-state hidden><div class="upl__bar"><i></i></div><p></p></div>
  ${o.disk ? html`<p class="muted small pk-disk${o.disk.free < 3 * GB ? ' is-low' : ''}">Копии фото этого класса: ${size(o.usage)}. Свободно на сервере: ${size(o.disk.free)} из ${size(o.disk.total)}${o.disk.free < 3 * GB ? ' — места мало, скоро понадобится тариф побольше' : ''}.</p>` : ''}
  ${sections.length ? html`<form method="post" action="/admin/c/${c.id}/photos/sections" class="secs">
    ${csrf(o.sess)}
    <p class="muted small" style="margin:16px 0 8px">Галочка — общие групповые (один выбор на весь класс). Без галочки — личные фото, каждый выбирает себе.</p>
    ${sections.map(s => {
      const st = bySection.get(s);
      const grp = o.isGroup(s);
      return html`<label class="check"><input type="checkbox" name="group" value="${s}"${grp ? raw(' checked') : ''}><span><b>${s}</b> <small>${photosN(st.ready)}${st.ready < st.n ? ' · не догрузились: ' + (st.n - st.ready) + ' — выберите папку ещё раз' : ''} · ${grp ? 'групповые' : 'личные'}</small></span></label>`;
    })}
    <button class="b b--sm" type="submit" style="margin-top:10px">Сохранить разделы</button>
  </form>` : ''}
</section>

<section class="card">
  <div class="card__h"><h2 class="h">Ученики</h2><span class="muted small">${o.students.length ? 'закончили: ' + done + ' из ' + o.students.length : ''}</span></div>
  ${remind ? html`<details class="pk-msg">
    <summary>Напомнить тем, кто не закончил (${left.length})</summary>
    <textarea readonly rows="5">${remind}</textarea>
    <div class="two">
      <button class="b b--sm" type="button" data-copy="${remind}">Скопировать</button>
      <a class="b b--sm" href="https://wa.me/?text=${encodeURIComponent(remind)}" target="_blank" rel="noopener" data-share data-share-text="${remind}">Отправить</a>
    </div>
  </details>` : ''}
  <form class="form" method="post" action="/admin/c/${c.id}/photos/students">
    ${csrf(o.sess)}
    <label class="field"><span>Имена, каждое с новой строки</span><textarea name="names" rows="${Math.min(14, Math.max(5, o.students.length + 1))}" placeholder="Анна Козлова&#10;Тимур Хасанов">${o.names !== undefined ? o.names : o.students.map(s => s.name).join('\n')}</textarea></label>
    <p class="muted small">Новые имена добавятся, убранные — удалятся (если ученик ещё ничего не выбрал). Чтобы исправить опечатку у того, кто уже выбирал, нажмите на имя в таблице ниже.</p>
    <button class="b b--main" type="submit">Сохранить список</button>
  </form>
  ${o.students.length ? html`<table class="pk-table">
    <thead><tr><th>Ученик</th><th>Личные</th><th>Цитата</th></tr></thead>
    <tbody>${o.students.map(s => {
      const n = counts.get(s.id) || 0;
      return html`<tr><td><details class="pk-ren"><summary>${s.name}</summary><form method="post" action="/admin/c/${c.id}/photos/rename">${csrf(o.sess)}<input type="hidden" name="student" value="${s.id}"><input name="name" value="${s.name}" maxlength="60" required aria-label="Новое имя"><button class="b b--sm" type="submit">Сохранить</button></form></details></td><td class="${n >= a.personal_max ? 'ok' : n ? '' : 'muted'}">${n} из ${a.personal_max}</td><td class="${s.quote ? 'ok' : 'muted'}">${s.quote ? '✓' : '—'}</td></tr>`;
    })}</tbody>
  </table>` : ''}
</section>

${o.students.some(st => (counts.get(st.id) || 0) || st.quote) ? html`<section class="card">
  <details class="pk-picks">
    <summary><b class="h">Что выбрали ученики</b><small class="muted">фото и цитаты каждого</small></summary>
    ${o.students.map(st => {
      const ids = o.picks.get(st.id) || [];
      if (!ids.length && !st.quote) return '';
      return html`<div class="pk-pick">
      <p><b>${st.name}</b> <small class="muted">${ids.length} из ${a.personal_max}</small></p>
      ${ids.length ? html`<div class="pk-thumbs">${ids.map(id => {
        const ph = o.byId.get(id);
        return ph ? html`<a href="/f/${a.slug}/p/${ph.id}.jpg?v=${ph.ver}" target="_blank" rel="noopener" title="${ph.path}"><img src="/f/${a.slug}/p/${ph.id}-sm.jpg?v=${ph.ver}" alt="${ph.path}" loading="lazy"></a>` : '';
      })}</div>` : ''}
      ${st.quote ? html`<blockquote>${st.quote}</blockquote>` : ''}
    </div>`;
    })}
  </details>
</section>` : ''}

<section class="card">
  <div class="card__h"><h2 class="h">Сколько выбирать</h2></div>
  <form class="form" method="post" action="/admin/c/${c.id}/photos/settings">
    ${csrf(o.sess)}
    <div class="two">
      <label class="field"><span>Личных на ученика</span><input name="personal_max" type="number" inputmode="numeric" min="1" max="20" value="${a.personal_max}" required></label>
      <label class="field"><span>Групповых на класс</span><input name="group_max" type="number" inputmode="numeric" min="1" max="300" value="${a.group_max}" required></label>
    </div>
    <p class="muted small">Сейчас выбрано групповых: ${o.groupCount} из ${a.group_max}.</p>
    <button class="b b--main" type="submit">Сохранить</button>
  </form>
</section>

<section class="card">
  <div class="card__h"><h2 class="h">Разложить по папкам</h2></div>
  <p class="muted small">Работает в Chrome на компьютере. Сначала выберите ту же папку с оригиналами, потом — куда сложить. Появится папка класса, в ней папка каждого ученика с его фото и цитатой, и папка «Групповые».</p>
  <button class="b b--main b--wide" type="button" data-pk-export="${c.id}" data-pk-title="${c.title} ${c.school}" style="margin-top:12px">Разложить по папкам</button>
  <div class="upl__state" data-pk-export-state hidden><div class="upl__bar"><i></i></div><p></p></div>
</section>

<section class="card">
  <div class="card__h"><h2 class="h">История групповых</h2></div>
  ${o.log.length ? html`<ul class="pk-log">${o.log.map(l => html`<li><span>${fmtWhen(l.at)}</span> <b>${l.who}</b> ${l.action === 'add' ? 'добавил(а)' : 'убрал(а)'} <code>${l.path || 'фото удалено'}</code>${l.action === 'remove' && l.path && !l.inGroup ? html` <form method="post" action="/admin/c/${c.id}/photos/restore" class="inline">${csrf(o.sess)}<input type="hidden" name="photo" value="${l.photo_id}"><button class="b b--sm" type="submit">вернуть</button></form>` : ''}</li>`)}</ul>` : html`<p class="muted small">Пока никто ничего не менял.</p>`}
</section>

${sections.length ? html`<section class="card">
  <div class="card__h"><h2 class="h">Удалить раздел</h2></div>
  <p class="muted small">Убирает загруженные копии раздела и выборы по ним. Оригиналы на компьютере не трогаются.</p>
  ${sections.map(s => html`<form method="post" action="/admin/c/${c.id}/photos/delsection" class="inline" data-confirm="Удалить раздел «${s}» и все выборы по нему?">${csrf(o.sess)}<input type="hidden" name="section" value="${s}"><button class="b b--sm b--danger" type="submit">${s}</button></form> `)}
</section>` : ''}
`;
  return layout({ title: 'Отбор фото · ' + c.title, sess: o.sess, nav: 'classes', body: body, scripts: ['/admin/static/photos-admin.js'] });
}

// ---------- страница учеников: /f/:slug ----------
function pickPage(o) {
  const c = o.cls;
  const data = JSON.stringify(o.data).replace(/</g, '\\u003c');
  return '<!doctype html>\n' + html`<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Отбор фото · ${c.title} · RIGSARTHUR</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F4EFE7">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/admin/static/pick.css">
</head>
<body>
<header class="pt">
  <div class="pt__in">
    <a class="pt__logo" href="/"><b>RIGSARTHUR</b><span>отбор фото</span></a>
    <span class="pt__who" data-who></span>
  </div>
</header>
<main class="pm">
  <p class="eyebrow">Выпускной альбом ${c.year}</p>
  <h1>${c.school}<small>${c.title}</small></h1>
  <div id="app"><p class="muted">Загружаем…</p></div>
</main>
<div class="lb" data-lb hidden><img alt=""><div class="lb__bar"><button type="button" data-lb-close>Закрыть</button><button type="button" class="lb__pick" data-lb-pick></button></div></div>
<p class="toast" role="status" aria-live="polite" hidden></p>
<script type="application/json" id="pk-data">${raw(data)}</script>
<script src="/admin/static/pick.js"></script>
</body>
</html>
`.s;
}

module.exports = { adminPage, pickPage };
