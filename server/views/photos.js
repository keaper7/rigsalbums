'use strict';

// Отбор фото: страница в админке и страница для учеников
const { html, raw, plural, fmtWhen } = require('../lib/util');
const { layout } = require('./admin');
const { ROLES, ROLE_NAMES, TEACHER_WISH_MAX } = require('../lib/photos');

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
  removed: 'Раздел удалён',
  pinreset: 'Код сброшен. Ученик при следующем входе придумает новый',
  slim: 'Место освобождено: остались только выбранные фото в маленьком размере'
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
  // Сколько мест в альбоме нужно отметить: по одному фото на место, но не больше, чем фото
  const rolesNeed = Math.min(ROLES.length, a.personal_max);
  const rolesOf = s => (o.picks.get(s.id) || []).filter(x => x.role).length;
  // «Всё выбрал» — свои фото до лимита, места отмечены, цитата и пожелание написаны
  const finished = s => (counts.get(s.id) || 0) >= a.personal_max && rolesOf(s) >= rolesNeed && !!s.quote && !!s.wish;
  const retouchWait = o.students.filter(s => (o.picks.get(s.id) || []).some(x => x.retouch) && !s.retouch_done_at).length;
  const done = o.students.filter(finished).length;
  const left = o.students.filter(s => !finished(s));
  const hasGroup = sections.some(s => o.isGroup(s));
  const pickSections = sections.filter(s => !o.isTeacher(s));
  const places = ROLES.map(r => r[1].toLowerCase()).join(', ');
  const chat = 'Ребята, выбираем фото для выпускного альбома 📸\n\n' + link + '\n\n' +
    '1. Найдите себя в списке и придумайте код из 4 цифр. Запомните его, без кода в ваш выбор никто не зайдёт.\n' +
    '2. «Мои фото»: выберите ' + a.personal_max + ' своих фото и отметьте, какое куда в альбоме' + (rolesNeed === ROLES.length ? ' (' + places + ')' : '') + '. Если нужна доп. ретушь, напишите под фото.\n' +
    (hasGroup ? '3. «Групповые»: это общий выбор всего класса, все видят одно и то же. Не убирайте чужие фото без причины.\n4. «Тексты»: цитата для альбома и пожелание себе в будущее, его никто из класса не увидит.\n'
      : '3. «Тексты»: цитата для альбома и пожелание себе в будущее, его никто из класса не увидит.\n') +
    '\nФото на сайте сжатые, они только для выбора, не скриньте их.' + (a.wfolio ? ' Оригиналы: ' + a.wfolio : '') +
    '\n\nВыбор можно поменять, пока я не закрою отбор.';
  const remind = left.length ? 'Напоминаю про выбор фото для альбома. Ещё не закончили: ' + left.map(s => s.name).join(', ') + '.\n\n' + link : '';
  const body = html`
<a class="back" href="/admin/c/${c.id}">← ${c.title} · ${c.school}</a>
<h1 class="h1">Отбор фото</h1>
<p class="muted small" style="margin:6px 0 18px">Ученикам открывается только по ссылке ниже, голосование класса это не затрагивает.</p>
${o.msg && MSG[o.msg] ? html`<p class="flash" role="status">${MSG[o.msg]}</p>` : ''}
${o.err ? html`<p class="flash flash--err" role="alert">${o.err}</p>` : ''}

<section class="card">
  <div class="card__h"><h2 class="h">Ссылка для класса</h2><span class="chip">${a.closed_at ? 'закрыт' : 'открыт'}</span></div>
  <p class="link"><code>${link}</code></p>
  <div class="two" style="margin-top:12px">
    <button class="b" type="button" data-copy="${link}">Скопировать ссылку</button>
    <a class="b" href="/f/${a.slug}?admin=1" target="_blank" rel="noopener">Открыть как Артур</a>
  </div>
  <p class="muted small" style="margin-top:10px">Через «Открыть как Артур» можно заранее отметить групповые. Ученики увидят ваш выбор и смогут заменить.</p>
  <details class="pk-msg">
    <summary>Сообщение для чата класса</summary>
    <textarea readonly rows="10">${chat}</textarea>
    <div class="two">
      <button class="b b--sm" type="button" data-copy="${chat}">Скопировать</button>
      <a class="b b--sm" href="https://wa.me/?text=${encodeURIComponent(chat)}" target="_blank" rel="noopener" data-share data-share-text="${chat}">Отправить</a>
    </div>
  </details>
  <form class="form pk-wf" method="post" action="/admin/c/${c.id}/photos/wfolio">
    ${csrf(o.sess)}
    <label class="field"><span>Ссылка на оригиналы в wfolio</span><input name="wfolio" type="url" inputmode="url" maxlength="500" placeholder="https://…" value="${a.wfolio || ''}"></label>
    <p class="muted small">У учеников появится кнопка «Оригиналы», чтобы не скринили сжатые фото.</p>
    <button class="b b--sm" type="submit">Сохранить ссылку</button>
  </form>
  <form method="post" action="/admin/c/${c.id}/photos/${a.closed_at ? 'open' : 'close'}" style="margin-top:14px"${a.closed_at ? '' : raw(' data-confirm="Закрыть отбор? Ученики больше не смогут менять выбор"')}>
    ${csrf(o.sess)}
    <button class="b b--wide${a.closed_at ? '' : ' b--main'}" type="submit">${a.closed_at ? 'Открыть отбор снова' : 'Закрыть отбор'}</button>
  </form>
</section>

<section class="card">
  <div class="card__h"><h2 class="h">Фото</h2><span class="muted small">${photosN(o.photos.length)}</span></div>
  <p class="muted small">Выберите папку с оригиналами, внутри которой подпапки: «Парни», «Девочки», «Групповые» и т. д. Браузер сам сделает лёгкие копии и загрузит только их, оригиналы останутся у вас. Уже загруженные фото пропускаются, так что можно добавлять новые в любой момент.</p>
  <label class="b b--main b--wide upl" style="margin-top:12px">
    <input type="file" webkitdirectory multiple data-pk-upload="${c.id}">
    <span>Выбрать папку с фото</span>
  </label>
  <div class="upl__state" data-pk-state hidden><div class="upl__bar"><i></i></div><p></p></div>
  ${o.disk ? html`<p class="muted small pk-disk${o.disk.free < 3 * GB ? ' is-low' : ''}">Копии фото этого класса: ${size(o.usage)}. Свободно на сервере: ${size(o.disk.free)} из ${size(o.disk.total)}${o.disk.free < 3 * GB ? '. Места мало, освободите место у классов, где отбор закончен' : ''}.</p>` : ''}
  ${a.slim_at ? html`<p class="flash pk-slim">Место освобождено ${fmtWhen(a.slim_at)}: остались только выбранные фото в маленьком размере. Если загрузить папку снова, вернутся все фото.</p>`
    : o.photos.length ? html`<form method="post" action="/admin/c/${c.id}/photos/slim" class="pk-slim"${a.closed_at ? raw(' data-confirm="Удалить с сервера все фото, которые никто не выбрал? У выбранных останется маленькая копия, выбор, места, ретушь и тексты сохранятся. Оригиналы на компьютере не трогаются"') : ''}>
    ${csrf(o.sess)}
    <button class="b b--sm" type="submit"${a.closed_at ? '' : raw(' disabled')}>Освободить место</button>
    <span class="muted small">${a.closed_at ? 'Удалит невыбранные фото, выбор сохранится. Лучше после раскладки по папкам' : 'Станет доступно, когда закроете отбор'}</span>
  </form>` : ''}
  ${sections.length ? html`<form method="post" action="/admin/c/${c.id}/photos/sections" class="secs">
    ${csrf(o.sess)}
    <p class="muted small" style="margin:16px 0 8px">С галочкой: групповые, один общий выбор на весь класс. Без галочки: личные, каждый выбирает себе.</p>
    ${pickSections.length && pickSections.every(x => o.isGroup(x)) ? html`<p class="flash flash--err">Все разделы отмечены как групповые, поэтому в «Мои фото» у учеников пусто. Снимите галочку с портретов («Парни», «Девочки») и нажмите «Сохранить разделы».</p>` : ''}
    ${sections.map(s => {
      const st = bySection.get(s);
      if (o.isTeacher(s)) return html`<p class="check pk-tsec"><span><b>${s}</b> <small>${photosN(st.ready)} · классный руководитель, ученикам не видны</small></span></p>`;
      const grp = o.isGroup(s);
      return html`<label class="check"><input type="checkbox" name="group" value="${s}"${grp ? raw(' checked') : ''}><span><b>${s}</b> <small>${photosN(st.ready)}${st.ready < st.n ? ' · не догрузились: ' + (st.n - st.ready) + ', выберите папку ещё раз' : ''} · ${grp ? 'групповые' : 'личные'}</small></span></label>`;
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
    <p class="muted small">Новые имена добавятся, убранные удалятся, если ученик ещё ничего не выбрал. Опечатку у того, кто уже выбирал, можно исправить, нажав на имя в таблице.</p>
    <button class="b b--main" type="submit">Сохранить список</button>
  </form>
  ${o.students.length ? html`<div class="pk-scroll"><table class="pk-table">
    <thead><tr><th>Ученик</th><th>Фото</th><th>Цитата</th><th>Пожел.</th><th>Код</th></tr></thead>
    <tbody>${o.students.map(s => {
      const n = counts.get(s.id) || 0;
      const r = rolesOf(s);
      const full = n >= a.personal_max && r >= rolesNeed;
      return html`<tr><td><details class="pk-ren"><summary>${s.name}</summary><form method="post" action="/admin/c/${c.id}/photos/rename">${csrf(o.sess)}<input type="hidden" name="student" value="${s.id}"><input name="name" value="${s.name}" maxlength="60" required aria-label="Новое имя"><button class="b b--sm" type="submit">Сохранить</button></form></details></td><td class="${full ? 'ok' : n ? '' : 'muted'}">${n} из ${a.personal_max}${n && r < Math.min(n, rolesNeed) ? html`<small class="pk-warn">мест ${r} из ${rolesNeed}</small>` : ''}</td><td class="${s.quote ? 'ok' : 'muted'}">${s.quote ? '✓' : '—'}</td><td class="${s.wish ? 'ok' : 'muted'}">${s.wish ? '✓' : '—'}</td><td>${s.pin ? html`<span class="pk-pin">${s.pin}</span><form method="post" action="/admin/c/${c.id}/photos/resetpin" class="inline" data-confirm="Сбросить код ученика «${s.name}»? При следующем входе он придумает новый. Выбор сохранится">${csrf(o.sess)}<input type="hidden" name="student" value="${s.id}"><button class="pk-x" type="submit" title="Сбросить код" aria-label="Сбросить код">×</button></form>` : html`<span class="muted">—</span>`}</td></tr>`;
    })}</tbody>
  </table></div>
  <p class="muted small" style="margin-top:8px">Код ученик придумывает сам при первом входе, все коды видны здесь. Если под чужим именем зашёл кто-то другой, сбросьте код крестиком, выбор останется.</p>` : ''}
</section>

${teacherCard(o)}

${o.students.some(st => (counts.get(st.id) || 0) || st.quote || st.wish) ? html`<section class="card">
  <details class="pk-picks" open>
    <summary><b class="h">Что выбрали ученики</b><small class="muted">фото с местом в альбоме, доп. ретушь, цитата и пожелание${retouchWait ? html` · <b class="pk-warn">ждут ретуши: ${retouchWait}</b>` : ''}</small></summary>
    ${o.students.map(st => {
      const list = (o.picks.get(st.id) || []).filter(x => o.byId.has(x.id));
      if (!list.length && !st.quote && !st.wish) return '';
      const wants = list.some(x => x.retouch);
      const doneR = !!st.retouch_done_at;
      // Порядок как в альбоме: обложка, личная, список, потом без места
      const order = x => { const i = ROLES.findIndex(r => r[0] === x.role); return i === -1 ? 99 : i; };
      list.sort((x, y) => order(x) - order(y));
      return html`<div class="pk-pick${wants && !doneR ? ' is-wait' : ''}" id="st-${st.id}">
      <div class="pk-pick__h"><p><b>${st.name}</b> <small class="muted">${list.length} из ${a.personal_max}</small></p>
      ${list.length ? html`<form method="post" action="/admin/c/${c.id}/photos/retouched" class="inline">${csrf(o.sess)}<input type="hidden" name="student" value="${st.id}"><input type="hidden" name="on" value="${doneR ? '0' : '1'}"><button class="b b--sm${doneR ? ' is-done' : ''}" type="submit">${doneR ? '✓ Обработан' : 'Отметить: обработан'}</button></form>` : ''}</div>
      ${list.length ? html`<div class="pk-thumbs">${list.map(x => {
        const ph = o.byId.get(x.id);
        return html`<figure class="pk-ph"><a href="/f/${a.slug}/p/${ph.id}.jpg?v=${ph.ver}" target="_blank" rel="noopener" title="${ph.path}"><img src="/f/${a.slug}/p/${ph.id}-sm.jpg?v=${ph.ver}" alt="${ph.path}" loading="lazy"></a><figcaption><b class="${x.role ? '' : 'muted'}">${x.role ? ROLE_NAMES[x.role] : 'без места'}</b>${x.retouch ? html`<span class="pk-ret">✎ ${x.retouch}</span>` : ''}</figcaption></figure>`;
      })}</div>` : ''}
      ${st.quote ? html`<p class="pk-lab">Цитата</p><blockquote>${st.quote}</blockquote>` : ''}
      ${st.wish ? html`<p class="pk-lab">🔒 Пожелание себе в будущее <span class="muted">(видите только вы)</span></p><blockquote class="pk-wish">${st.wish}</blockquote>` : ''}
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
  <p class="muted small">Работает в Chrome на компьютере. Сначала выберите ту же папку с оригиналами, потом папку, куда сложить. Появится папка класса, в ней папка каждого ученика с фото и цитатой, папка «Групповые» и таблица «Цитаты.csv» для Excel. Фото с отмеченным местом называются по ученику и месту, например «обложка_Биттуев Азамат.jpg».</p>
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

// Классный руководитель: своя ссылка, что выбрал
function teacherCard(o) {
  const c = o.cls, a = o.album, t = o.teacher;
  const link = o.base + '/kr/' + t.token;
  const p = t.picks;
  const msg = 'Здравствуйте! Это Артур, фотограф. По ссылке можно выбрать ваши фото для выпускного альбома ' + c.title + ': одно на обложку и одно в общий список, и написать пожелание классу.\n\n' + link;
  const ph = (x, role) => x ? html`<figure class="pk-ph"><a href="/f/${a.slug}/p/${x.id}.jpg?v=${x.ver}" target="_blank" rel="noopener" title="${x.path}"><img src="/f/${a.slug}/p/${x.id}-sm.jpg?v=${x.ver}" alt="${role}" loading="lazy"></a><figcaption><b>${role}</b></figcaption></figure>` : '';
  return html`<section class="card" id="teacher">
  <div class="card__h"><h2 class="h">Классный руководитель</h2>${t.done ? html`<span class="chip chip--done">выбрал</span>` : t.photos.length ? html`<span class="chip">${p.cover || p.list || a.teacher_wish ? 'выбирает' : 'ещё не заходил'}</span>` : ''}</div>
  ${t.photos.length ? html`
  <p class="muted small">Своя ссылка: фото на обложку, фото в общий список и пожелание классу. Фото берутся из папки «${t.photos[0].section}».</p>
  <p class="link"><code>${link}</code></p>
  <div class="two" style="margin-top:12px">
    <button class="b" type="button" data-copy="${link}">Скопировать ссылку</button>
    <a class="b" href="/kr/${t.token}" target="_blank" rel="noopener">Открыть</a>
  </div>
  <details class="pk-msg">
    <summary>Сообщение для классного руководителя</summary>
    <textarea readonly rows="6">${msg}</textarea>
    <div class="two">
      <button class="b b--sm" type="button" data-copy="${msg}">Скопировать</button>
      <a class="b b--sm" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" data-share data-share-text="${msg}">Отправить</a>
    </div>
  </details>
  <ul class="pk-tdone">
    <li class="${p.cover ? 'ok' : 'muted'}">${p.cover ? '✓' : '—'} Обложка</li>
    <li class="${p.list ? 'ok' : 'muted'}">${p.list ? '✓' : '—'} Общий список</li>
    <li class="${a.teacher_wish ? 'ok' : 'muted'}">${a.teacher_wish ? '✓' : '—'} Пожелание классу</li>
  </ul>
  ${p.cover || p.list ? html`<div class="pk-thumbs">${ph(p.cover, 'Обложка')}${ph(p.list, 'Общий список')}</div>` : ''}
  ${a.teacher_name ? html`<p class="pk-lab">Подпись в альбоме</p><p>${a.teacher_name}</p>` : ''}
  ${a.teacher_wish ? html`<p class="pk-lab">Пожелание классу</p><blockquote>${a.teacher_wish}</blockquote>` : ''}`
  : html`<p class="muted small">Положите его фото в папку «кл рук» рядом с «Парни» и «Девочки» и загрузите папку ещё раз. Ученики эти фото не увидят, а здесь появится его ссылка.</p>`}
</section>`;
}

// ---------- страница классного руководителя: /kr/:token ----------
function teacherPage(o) {
  const c = o.cls, a = o.album, st = o.state;
  const data = JSON.stringify({ token: o.token, state: st }).replace(/</g, '\\u003c');
  const grid = role => html`<div class="kr-grid" data-role="${role}">${o.photos.map(ph => html`<div class="kr-ph${st[role] === ph.id ? ' is-on' : ''}"><button type="button" class="kr-sel" data-id="${ph.id}" aria-pressed="${st[role] === ph.id ? 'true' : 'false'}" aria-label="Выбрать фото ${ph.path.split('/').pop()}"${st.closed ? raw(' disabled') : ''}><img src="/f/${a.slug}/p/${ph.id}-sm.jpg?v=${ph.ver}" alt="" loading="lazy"><i class="kr-mark" aria-hidden="true">✓</i></button><button type="button" class="kr-zoom" data-big="/f/${a.slug}/p/${ph.id}.jpg?v=${ph.ver}" aria-label="Посмотреть крупно"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z" fill="currentColor"/></svg></button></div>`)}</div>`;
  return '<!doctype html>\n' + html`<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Фото для альбома · ${c.title} · RIGSARTHUR</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F4EFE7">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="stylesheet" href="/admin/static/fonts.css">
<link rel="stylesheet" href="/admin/static/pick.css">
</head>
<body class="kr">
<header class="pt">
  <div class="pt__in">
    <a class="pt__logo" href="/"><b>RIGSARTHUR</b><span>выпускной альбом</span></a>
  </div>
</header>
<main class="pm kr-m">
  <p class="eyebrow">Выпускной альбом ${c.year}</p>
  <h1>${c.school}<small>${c.title} · классный руководитель</small></h1>
  ${o.layoutReady ? html`<a class="kr-album" href="/kr/${o.token}/album"><b>Макет альбома готов</b><span>Проверить свою обложку →</span></a>` : ''}
  ${st.closed ? html`<p class="kr-note">Выбор уже закрыт. Если нужно что-то поменять, напишите Артуру.</p>` : html`<p class="kr-lead">Всего три шага. Всё сохраняется само, можно вернуться позже.</p>`}
  ${o.photos.length ? html`
  <section class="kr-step" id="cover">
    <h2><span class="kr-n">1</span>Фото на обложку</h2>
    <p class="kr-hint">Нажмите на фото для вашей обложки.</p>
    ${grid('cover')}
  </section>
  <section class="kr-step" id="list">
    <h2><span class="kr-n">2</span>Фото в общий список класса</h2>
    <p class="kr-hint">Можно выбрать то же самое фото, что и на обложку.</p>
    ${grid('list')}
  </section>` : html`<p class="kr-note">Фото ещё не загружены. Артур напишет, когда они появятся.</p>`}
  <section class="kr-step" id="wish">
    <h2><span class="kr-n">${o.photos.length ? '3' : '1'}</span>Пожелание классу</h2>
    <p class="kr-hint">Оно будет в альбоме.</p>
    <label class="kr-field"><span class="sr">Пожелание классу</span><textarea data-field="wish" rows="9" maxlength="${TEACHER_WISH_MAX}" placeholder="Дорогие мои выпускники…"${st.closed ? raw(' disabled') : ''}>${st.wish}</textarea></label>
    <label class="kr-field"><span>Как подписать вас в альбоме</span><input data-field="name" maxlength="60" value="${st.name}" placeholder="Например: Фатима Руслановна" autocomplete="off"${st.closed ? raw(' disabled') : ''}></label>
  </section>
  <div class="kr-bar" data-bar><p data-status>${st.done ? 'Всё выбрано и сохранено ✓' : 'Сохраняется само'}</p></div>
</main>
<div class="lb" data-lb hidden><img alt=""><div class="lb__bar"><button type="button" data-lb-close>Закрыть</button></div></div>
<p class="toast" role="status" aria-live="polite" hidden></p>
<script type="application/json" id="kr-data">${raw(data)}</script>
<script src="/admin/static/kr.js"></script>
</body>
</html>
`.s;
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
<link rel="stylesheet" href="/admin/static/fonts.css">
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
<script src="/assets/st.js" defer></script>
</body>
</html>
`.s;
}

module.exports = { adminPage, pickPage, teacherPage };
