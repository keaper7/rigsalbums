'use strict';

// Работа над альбомами. У Артура: вкладки «Работа» (классы по этапам), «Деньги» (сезон, осень, весна)
// и «Телефоны», страница класса с этапами и деньгами. У дизайнера — кабинет по личной ссылке
const { html, raw, plural, fmtWhen } = require('../lib/util');
const { layout } = require('./admin');
const { ROLES, ROLE_NAMES } = require('../lib/photos');
const { LEAD_STATUSES, TEMPLATES, fill, STATUSES, STATUS_NAMES, PARTS, FIXES, FIX_NAMES, FILE_LABELS, SELF, SEASON_FIELDS, STAGES, HALVES, HALF_NAMES, DATE_KINDS, DATE_KIND_NAMES, stepOn, stageOf, upcoming } = require('../lib/work');

function csrf(sess) { return html`<input type="hidden" name="_csrf" value="${sess.csrf}">`; }

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEK = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
// '2026-10-12' → «12 октября»
function day(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? +m[3] + ' ' + MONTHS[+m[2] - 1] : '';
}
// Дата съёмки для списка: «сегодня, 10:00», «завтра», «пт, 18 октября, 10:00»
function when(x, today) {
  const t = x.t ? ', ' + x.t : '';
  if (x.d === today) return 'сегодня' + t;
  const a = Date.UTC(+x.d.slice(0, 4), +x.d.slice(5, 7) - 1, +x.d.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  if (a - b === 86400000) return 'завтра' + t;
  return WEEK[new Date(a).getUTCDay()] + ', ' + day(x.d) + t;
}
// 125000 → «125 000 ₽»
function rub(n) {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (n < 0 ? '−' : '') + s + ' ₽';
}
function fixesN(n) { return n + ' ' + plural(n, 'правка', 'правки', 'правок'); }
function classesN(n) { return n + ' ' + plural(n, 'класс', 'класса', 'классов'); }
// Номер для ссылки tel:
function tel(p) { return 'tel:' + String(p).replace(/[^\d+]/g, ''); }
// WhatsApp: 8 928… и 928… → 7928…
function wa(p, text) {
  let d = String(p).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}

// Цвет школы: свой у каждой, чтобы классы одной школы узнавались сразу (как цветом в таблице)
const SCHOOL_COLORS = ['#2F5E8C', '#B4581B', '#6B3D86', '#2F6B4F', '#A23A5B', '#1F7A80', '#8A6A12', '#5A4FA3', '#9C3D2E', '#3F6F2A', '#B04A86', '#4A6378'];
function schoolColor(name) {
  let h = 0;
  String(name || '').toLowerCase().replace(/\s+/g, ' ').trim().split('').forEach(ch => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; });
  return SCHOOL_COLORS[h % SCHOOL_COLORS.length];
}
function schoolTag(name, city) {
  return html`<span class="wk-school" style="--sc:${schoolColor(name)}"><i></i>${name}${city ? html`<small>${city}</small>` : ''}</span>`;
}

// Съёмки силуэтами: индивидуальная — один, групповая — три.
// Красный — даты нет, жёлтый — дата есть, зелёный — отсняли (галочка этапа)
function shootState(w, kind) {
  if (stepOn(w, kind === 'ind' ? 'shot_ind' : 'shot_group')) return { st: 'done', text: 'отсняли' };
  const d = (w.dates || []).find(x => x.kind === kind || x.kind === 'other');
  return d ? { st: 'date', text: day(d.d) + (d.t ? ', ' + d.t : '') } : { st: 'none', text: 'даты нет' };
}
const ONE = '<circle cx="12" cy="7.5" r="3.6"/><path d="M5 21v-1.5a7 7 0 0 1 14 0V21z"/>';
const THREE = '<circle cx="12" cy="7" r="3.1"/><path d="M6.6 20.5v-1.2a5.4 5.4 0 0 1 10.8 0v1.2z"/><circle cx="4.9" cy="9.3" r="2.4"/><path d="M.6 19.5v-.8a4.3 4.3 0 0 1 5.9-4"/><circle cx="19.1" cy="9.3" r="2.4"/><path d="M23.4 19.5v-.8a4.3 4.3 0 0 0-5.9-4"/>';
function shootIcons(w) {
  const one = shootState(w, 'ind'), grp = shootState(w, 'group');
  return html`<span class="wk-shoots">
    <span class="wk-sh wk-sh--${one.st}" title="Индивидуальная: ${one.text}">${raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' + ONE + '</svg>')}<span class="sr">Индивидуальная: ${one.text}</span></span>
    <span class="wk-sh wk-sh--${grp.st}" title="Групповая: ${grp.text}">${raw('<svg viewBox="0 0 24 24" width="22" height="18" aria-hidden="true">' + THREE + '</svg>')}<span class="sr">Групповая: ${grp.text}</span></span>
  </span>`;
}

const MSG = {
  saved: 'Сохранено',
  status: 'Статус изменён',
  fix: 'Правка добавлена. Дизайнер увидит её у себя',
  fixpart: 'Правка добавлена, но не все фото загрузились. Можно добавить их отдельной правкой',
  fixdone: 'Отмечено',
  fixdel: 'Правка удалена',
  note: 'Сообщение добавлено',
  designer: 'Ссылка для дизайнера создана. Скопируйте и отправьте ей',
  designerdel: 'Ссылка отключена, по ней больше не войти',
  prices: 'Цены сезона сохранены',
  delivery: 'Доставка добавлена',
  deliverydel: 'Доставка удалена',
  date: 'Дата съёмки добавлена',
  datedel: 'Дата убрана',
  contacts: 'Телефоны сохранены',
  probe: 'Пробник добавлен',
  probedel: 'Пробник убран',
  lead: 'Лид добавлен',
  leaddel: 'Лид удалён',
  templates: 'Шаблоны сохранены',
  pay: 'Оплата записана',
  paydel: 'Оплата убрана'
};

function flash(o) {
  return html`${o.msg && MSG[o.msg] ? html`<p class="flash" role="status">${MSG[o.msg]}</p>` : ''}${o.err ? html`<p class="flash flash--err" role="alert">${o.err}</p>` : ''}`;
}

function statusChip(st) {
  return html`<span class="chip wk-st wk-st--${st}">${STATUS_NAMES[st]}</span>`;
}
function halfChip(h) {
  return html`<span class="chip wk-half wk-half--${h}">${HALF_NAMES[h]}</span>`;
}

const PHONE_ICON = raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>');


// Галочки дизайнера кружками: ●●●○○
function partsDots(done) {
  const n = PARTS.filter(p => done[p[0]]).length;
  return html`<span class="wk-dots" title="${PARTS.map(p => (done[p[0]] ? '✓ ' : '○ ') + p[1]).join(', ')}">${PARTS.map(p => html`<i class="${done[p[0]] ? 'is-on' : ''}"></i>`)}<small>${n}/${PARTS.length}</small></span>`;
}

// Выборка (отбор фото учениками): сколько закончили, закрыта ли, ждут ли ретуши
function pkLine(pk) {
  if (!pk || !pk.total) return html`<span class="muted">выборки нет</span>`;
  return html`<span>выборка ${pk.done}/${pk.total}${pk.closed ? ' · закрыта' : ''}</span>${pk.retouchWait ? html`<span class="wk-warn">ретушь ждут ${pk.retouchWait}</span>` : ''}`;
}

function notesList(list) {
  if (!list.length) return html`<p class="muted small">Пока ничего нет.</p>`;
  return html`<ul class="wk-notes">${list.map(n => html`<li class="${n.kind !== 'comment' ? 'is-event' : ''}"><p><b>${n.who}</b> <span class="muted">${fmtWhen(n.at)}</span></p><p class="wk-notes__t">${n.text}</p></li>`)}</ul>`;
}

// Фото и скрины к правке: для замены группового — подписаны «Убрать» и «Поставить»
function fixFiles(list, base) {
  if (!list || !list.length) return '';
  return html`<div class="wk-ffiles">${list.map(x => html`<a class="wk-ffile${x.label ? ' wk-ffile--' + x.label : ''}" href="${base}${x.id}.jpg" target="_blank" rel="noopener"><img src="${base}${x.id}.jpg" alt="${FILE_LABELS[x.label] || 'Фото к правке'}" loading="lazy">${x.label ? html`<span>${FILE_LABELS[x.label]}</span>` : ''}</a>`)}</div>`;
}

// Правка одной строкой: кому, что, текст, фото, кто и когда
function fixBody(f, files, base) {
  return html`<p class="wk-fix__h"><b>${f.student_name || 'Весь класс'}</b> · ${FIX_NAMES[f.kind] || f.kind}${f.auto ? html` <small class="chip">${f.kind === 'teacher_wish' ? 'поменял сам' : 'ученик поменял сам'}</small>` : ''}</p>
    ${f.text ? html`<p class="wk-fix__t">${f.text}</p>` : ''}
    ${files ? fixFiles(files.get(f.id), base) : ''}
    <p class="muted small">${f.done_at ? html`исправлено ${fmtWhen(f.done_at)}${f.done_by ? ' · ' + f.done_by : ''}` : html`${f.who} · ${fmtWhen(f.created_at)}`}</p>`;
}

// Фото ученика по местам альбома: обложка, личная, список, потом без места
function sortedPicks(list) {
  const order = x => { const i = ROLES.findIndex(r => r[0] === x.role); return i === -1 ? 99 : i; };
  return list.slice().sort((a, b) => order(a) - order(b));
}
function thumbs(pk, st) {
  const list = sortedPicks((pk.picks.get(st.id) || []).filter(x => pk.byId.has(x.id)));
  if (!list.length) return html`<p class="muted small">Фото ещё не выбраны</p>`;
  return html`<div class="pk-thumbs">${list.map(x => {
    const ph = pk.byId.get(x.id);
    return html`<figure class="pk-ph"><a href="/f/${pk.album.slug}/p/${ph.id}.jpg?v=${ph.ver}" target="_blank" rel="noopener" title="${ph.path}"><img src="/f/${pk.album.slug}/p/${ph.id}-sm.jpg?v=${ph.ver}" alt="${ph.path}" loading="lazy"></a><figcaption><b class="${x.role ? '' : 'muted'}">${x.role ? ROLE_NAMES[x.role] : 'без места'}</b><span class="muted wk-file">${ph.path.split('/').pop()}</span></figcaption></figure>`;
  })}</div>`;
}
function retouchLine(pk, st) {
  const list = (pk.picks.get(st.id) || []).filter(x => x.retouch);
  if (!list.length) return '';
  return st.retouch_done_at ? html`<p class="wk-ok small">✓ Доп. ретушь сделана</p>` : html`<p class="wk-warn small">Ждёт доп. ретуши</p>`;
}

// ---------- общая шапка раздела: вкладки, сезоны, осень и весна ----------
function sectionTabs(cur, q, newLeads) {
  const tabs = [['work', '/admin/work', 'Работа'], ['money', '/admin/work/money', 'Деньги'], ['phones', '/admin/work/phones', 'Телефоны'], ['leads', '/admin/work/leads', 'Лиды']];
  return html`<nav class="wk-tabs wk-tabs--4" aria-label="Разделы">${tabs.map(t => html`<a href="${t[1]}${t[0] === 'work' || t[0] === 'money' ? q || '' : ''}"${cur === t[0] ? raw(' aria-current="page"') : ''}>${t[2]}${t[0] === 'leads' && newLeads ? html` <i class="wk-badge" title="Новых: ${newLeads}">${newLeads}</i>` : ''}</a>`)}</nav>`;
}

// Годы и половины сезона. counts: { год: число классов }, halves: { autumn, spring, all }
function seasonNav(o, base) {
  const link = (y, h) => base + '?year=' + y + (h ? '&half=' + h : '');
  return html`<div class="wk-filters">
  <nav class="wk-years" aria-label="Сезон">${o.years.map(y => html`<a href="${link(y, o.half)}"${y === o.year ? raw(' aria-current="page"') : ''}>${y - 1}/${String(y).slice(2)}${o.counts[y] ? html`<small>${o.counts[y]}</small>` : ''}</a>`)}</nav>
  <nav class="wk-halves" aria-label="Осень или весна">
    <a href="${link(o.year, '')}"${!o.half ? raw(' aria-current="page"') : ''}>Весь сезон <small>${o.halves.all}</small></a>
    ${HALVES.map(h => html`<a href="${link(o.year, h[0])}"${o.half === h[0] ? raw(' aria-current="page"') : ''}>${h[1]} <small>${o.halves[h[0]]}</small></a>`)}
  </nav>
</div>`;
}

// ---------- вкладка «Работа»: /admin/work ----------
const WA_ICON = raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2.2a9.7 9.7 0 0 0-8.4 14.6L2.3 21.8l5.1-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c-.1-.1-.2-.2-.5-.3z"/></svg>');
const TG_ICON = raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.4 3.6 2.9 10.8c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.8.8s.6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.4-1.4zM9.4 14.1l8.5-7.7c.4-.3-.1-.5-.6-.2L6.9 13.2"/></svg>');
// Кнопки связи на карточке: группа в Telegram, WhatsApp и звонок по первому телефону
function callButton(contacts, tgLink) {
  const c = (contacts || [])[0];
  if (!c && !tgLink) return '';
  return html`<span class="wk-calls">${tgLink ? html`<a class="wk-call wk-call--tg" href="${tgLink}" target="_blank" rel="noopener" aria-label="Группа класса в Telegram" title="Группа в Telegram">${TG_ICON}</a>` : ''}${c ? html`<a class="wk-call wk-call--wa" href="${wa(c.phone)}" target="_blank" rel="noopener" aria-label="WhatsApp${c.name ? ': ' + c.name : ''}" title="WhatsApp · ${c.phone}">${WA_ICON}</a><a class="wk-call" href="${tel(c.phone)}" aria-label="Позвонить${c.name ? ': ' + c.name : ''}" title="${c.name ? c.name + ' · ' : ''}${c.phone}">${PHONE_ICON}</a>` : ''}</span>`;
}
// Номер с двумя кнопками: позвонить и WhatsApp
function phoneLine(x) {
  return html`<div class="wk-pn"><a class="wk-ph__n" href="${tel(x.phone)}">${PHONE_ICON}<span><b>${x.phone}</b>${x.name ? html`<small>${x.name}</small>` : ''}</span></a><a class="wk-pn__wa" href="${wa(x.phone)}" target="_blank" rel="noopener" aria-label="Написать в WhatsApp">${WA_ICON}</a></div>`;
}

// Цвет этапа: 0 запись, 1 работа, 2 печать, 3 готово
function stageClass(sg) { return 'wk-c' + Math.min(sg.index, STAGES.length); }

function progress(sg) {
  const pct = Math.round(sg.done / sg.total * 100);
  return html`<span class="wk-prog"><span class="wk-prog__bar"><i style="width:${pct}%"></i></span><span class="wk-prog__t">${sg.done}/${sg.total}${sg.next ? html` · дальше: <b>${sg.next}</b>` : ''}</span></span>`;
}

function classCard(r, today) {
  const sg = stageOf(r.w);
  const next = upcoming(r.w, today)[0];
  const phones = r.w.contacts.map(c => c.phone + ' ' + c.name).join(' ');
  const noPrepay = !sg.finished && !r.m.prepaid;
  return html`<div class="wk-card ${stageClass(sg)}${noPrepay ? ' is-noprepay' : ''}" data-find="${r.c.title} ${r.c.school} ${r.w.city} ${phones} ${phones.replace(/[^\d]/g, '')}" data-school="${r.c.school}" data-noprepay="${noPrepay ? 1 : 0}">
    <div class="wk-card__top">
      <a class="wk-card__t" href="/admin/c/${r.c.id}/work"><b>${r.c.title}</b>${schoolTag(r.c.school, r.w.city)}</a>
      ${callButton(r.w.contacts, r.w.tg)}
    </div>
    ${sg.finished ? html`<p class="wk-ok small">Альбом забрали, класс готов</p>` : html`<p class="wk-stagename">${sg.stage.name}</p>${progress(sg)}`}
    <div class="wk-meta">
      ${shootIcons(r.w)}
      ${halfChip(r.half)}
      ${noPrepay ? html`<span class="wk-noprepay">без предоплаты</span>` : ''}
      ${next ? html`<span class="wk-date">${when(next, today)} · ${DATE_KIND_NAMES[next.kind].toLowerCase()}</span>` : ''}
      ${r.pk && r.pk.total && sg.index === 1 ? pkLine(r.pk) : ''}
      ${r.w.status !== 'todo' ? statusChip(r.w.status) : ''}
      ${r.open ? html`<span class="wk-warn">${fixesN(r.open)}</span>` : ''}
      ${r.m.paidUp ? html`<span class="wk-paid">оплачено</span>` : sg.index >= 2 && r.m.ready && r.m.rest > 0 ? html`<span class="wk-warn">с родителей ещё ${rub(r.m.rest)}</span>` : ''}
    </div>
  </div>`;
}

// Ближайшие съёмки: первые сразу, остальные раскрываются списком по порядку
const SOON_SHOWN = 4;
function soonItem(x, today) {
  return html`<li><span class="wk-soon__d">${when(x.d, today)}</span><a href="/admin/c/${x.r.c.id}/work">${x.r.c.title} ${schoolTag(x.r.c.school, '')}</a><small class="muted">${DATE_KIND_NAMES[x.d.kind]}${x.d.note ? ' · ' + x.d.note : ''}${x.r.w.city ? ' · ' + x.r.w.city : ''}</small></li>`;
}

function boardPage(o) {
  const rows = o.rows;
  const groups = STAGES.map((st, i) => [st, rows.filter(r => stageOf(r.w).index === i)]);
  const ready = rows.filter(r => stageOf(r.w).finished);
  // ближайшие съёмки всех классов сезона
  const soon = [];
  rows.forEach(r => upcoming(r.w, o.today).forEach(d => soon.push({ d: d, r: r })));
  soon.sort((a, b) => (a.d.d + (a.d.t || '99')).localeCompare(b.d.d + (b.d.t || '99')));
  const q = '?year=' + o.year + (o.half ? '&half=' + o.half : '');
  // школы сезона для фильтра: где больше классов — раньше
  const schools = {};
  rows.forEach(r => { schools[r.c.school] = (schools[r.c.school] || 0) + 1; });
  const schoolList = Object.keys(schools).sort((a, b) => schools[b] - schools[a] || a.localeCompare(b, 'ru'));
  const noPrepay = rows.filter(r => !stageOf(r.w).finished && !r.m.prepaid).length;
  const KEYS = ['prep', 'work', 'print', 'ready'];
  const jump = groups.map((g, i) => [KEYS[i], g[0].name.split(' ')[0], g[1].length, i]).concat([['ready', 'Готово', ready.length, 3]]).filter(x => x[2]);
  const body = html`${flash(o)}<div class="head wk-headrow"><h1 class="h1 wk-h1">Работа</h1><a class="b b--main b--sm" href="/admin/new">+ Новый класс</a></div>
${sectionTabs('work', q, o.newLeads)}
${seasonNav(o, '/admin/work')}
${soon.length ? html`<section class="card wk-soon">
  <div class="card__h"><h2 class="h">Ближайшие съёмки</h2>${soon.length > SOON_SHOWN ? html`<span class="muted small">всего ${soon.length}</span>` : ''}</div>
  <ul>${soon.slice(0, SOON_SHOWN).map(x => soonItem(x, o.today))}</ul>
  ${soon.length > SOON_SHOWN ? html`<details class="wk-soon__more"><summary>Все съёмки по порядку · ещё ${soon.length - SOON_SHOWN}</summary><ul>${soon.slice(SOON_SHOWN).map(x => soonItem(x, o.today))}</ul></details>` : ''}
</section>` : ''}
${rows.length ? html`<div class="wk-views"><nav class="wk-view" aria-label="Как показать">
  <a href="/admin/work${q}"${o.by !== 'school' ? raw(' aria-current="page"') : ''}>По этапам</a>
  <a href="/admin/work${q}&by=school"${o.by === 'school' ? raw(' aria-current="page"') : ''}>По школам</a>
</nav>
<nav class="wk-view" aria-label="Сортировка">
  <a href="/admin/work${q}${o.by === 'school' ? '&by=school' : ''}&sort=recent"${o.sort !== 'added' ? raw(' aria-current="true"') : ''}>Недавно открытые</a>
  <a href="/admin/work${q}${o.by === 'school' ? '&by=school' : ''}&sort=added"${o.sort === 'added' ? raw(' aria-current="true"') : ''}>По дате бронирования</a>
</nav></div>` : ''}
${o.by !== 'school' && jump.length > 1 ? html`<nav class="wk-jump" aria-label="Этапы">${jump.map(x => html`<a class="wk-c${x[3]}" href="#stage-${x[0]}"><i class="wk-dot"></i>${x[1]} <b>${x[2]}</b></a>`)}</nav>` : ''}
${rows.length > 3 ? html`<div class="wk-find" data-wkfilter>
  <label class="search"><span class="sr">Поиск</span><input type="search" placeholder="Класс, школа, город или телефон" data-wk-q autocomplete="off"></label>
  <div class="wk-chips">
    ${noPrepay ? html`<button type="button" class="wk-chip wk-chip--warn" data-f-noprepay aria-pressed="false">Без предоплаты <b>${noPrepay}</b></button>` : ''}
    ${schoolList.length > 1 ? schoolList.map(sc => html`<button type="button" class="wk-chip" data-f-school="${sc}" aria-pressed="false" style="--sc:${schoolColor(sc)}"><i></i>${sc} <b>${schools[sc]}</b></button>`) : ''}
  </div>
  <p class="muted small search__none" data-wk-none hidden>Ничего не нашлось</p>
</div>` : ''}
${rows.length ? '' : html`<div class="card empty"><h2 class="h">В этом сезоне классов нет</h2><p class="muted">Классы появляются здесь сами, как только вы их создадите. Сезон это год выпуска класса.</p><a class="b b--main" href="/admin/new">Создать класс</a></div>`}
${o.by === 'school' ? schoolList.map(sc => html`<section class="group wk-stage wk-byschool" data-group>
  <h2 class="group__h">${schoolTag(sc, '')} <span>${schools[sc]}</span></h2>
  <div class="wk-cards">${rows.filter(r => r.c.school === sc).map(r => classCard(r, o.today))}</div>
</section>`) : ''}
${o.by !== 'school' ? groups.map((g, i) => g[1].length ? html`<section class="group wk-stage wk-c${i}" id="stage-${KEYS[i]}" data-group>
  <h2 class="group__h"><i class="wk-dot"></i>${g[0].name} <span>${g[1].length}</span></h2>
  <div class="wk-cards">${g[1].map(r => classCard(r, o.today))}</div>
</section>` : '') : ''}
${o.by !== 'school' && ready.length ? html`<details class="group wk-stage wk-c3" id="stage-ready" data-group>
  <summary class="group__h"><i class="wk-dot"></i>Готово <span>${ready.length}</span></summary>
  <div class="wk-cards">${ready.map(r => classCard(r, o.today))}</div>
</details>` : ''}

${templatesFold(o)}

<details class="card fold" id="designers">
  <summary class="fold__h"><span><b>Доступ дизайнера</b><small>${o.designers.length ? o.designers.map(d => d.name).join(', ') : 'Ссылка для дизайнера, без пароля'}</small></span></summary>
  <div class="fold__in">
  <p class="muted small">Вход по ссылке, без пароля. Дизайнер видит классы, съёмки, фото, цитаты и ваши правки и отмечает, что сделала. Деньги, телефоны, коды и пожелания учеников ей не видны.</p>
  ${o.designers.map(d => {
    const url = o.base + '/d/' + d.token;
    return html`<div class="wk-des">
    <p><b>${d.name}</b> <span class="muted small">${d.seen_at ? 'заходила ' + fmtWhen(d.seen_at) : 'ещё не заходила'}</span></p>
    <p class="link"><code>${url}</code></p>
    <div class="two">
      <button class="b b--sm" type="button" data-copy="${url}">Скопировать ссылку</button>
      <form method="post" action="/admin/work/designer/${d.id}/delete" data-confirm="Отключить ссылку для «${d.name}»? Войти по ней больше не получится. Можно будет создать новую">${csrf(o.sess)}<button class="b b--sm b--danger b--wide" type="submit">Отключить</button></form>
    </div>
  </div>`;
  })}
  <form class="form wk-des__add" method="post" action="/admin/work/designer">
    ${csrf(o.sess)}
    <label class="field"><span>${o.designers.length ? 'Ещё одна ссылка' : 'Имя дизайнера'}</span><input name="name" maxlength="60" placeholder="Как её зовут" required autocomplete="off"></label>
    <button class="b${o.designers.length ? '' : ' b--main'}" type="submit">Создать ссылку</button>
  </form>
  </div>
</details>`;
  return layout({ title: 'Работа', nav: 'work', sess: o.sess, body: body, scripts: ['/admin/static/work.js'] });
}

// Шаблоны сообщений: Артур правит текст один раз, дальше он подставляется для каждого класса
function templatesFold(o) {
  return html`<details class="card fold" id="templates">
  <summary class="fold__h"><span><b>Шаблоны сообщений</b><small>Предоплата, загрузка, сверка, уведомить родителей</small></span></summary>
  <form class="form" method="post" action="/admin/work/templates">
    ${csrf(o.sess)}
    <p class="muted small">Эти тексты появляются у пунктов этапов в каждом классе. Вместо {класс}, {школа}, {сумма}, {отбор} (выбор фото) и {wfolio} подставятся данные класса.</p>
    ${TEMPLATES.map(t => html`<label class="field"><span>${t[1]}</span><textarea name="${t[0]}" rows="6" maxlength="3000">${o.templates[t[0]]}</textarea></label>`)}
    <p class="muted small">Пустое поле вернёт стандартный текст.</p>
    <button class="b b--main" type="submit">Сохранить шаблоны</button>
  </form>
</details>`;
}

// ---------- вкладка «Телефоны»: /admin/work/phones ----------
function phonesPage(o) {
  const body = html`<h1 class="h1 wk-h1">Работа</h1>
${sectionTabs('phones', '', o.newLeads)}
<label class="search wk-psearch"><span class="sr">Поиск</span><input type="search" placeholder="Класс, школа, имя или номер" data-search autocomplete="off" autofocus></label>
<p class="muted small search__none" hidden>Ничего не нашлось</p>
<section class="group" data-group>
  <div class="rows wk-phones">${o.rows.map(r => {
    const phones = r.w.contacts.map(c => c.phone + ' ' + c.name).join(' ');
    return html`<div class="wk-ph" data-find="${r.c.title} ${r.c.school} ${r.w.city} ${phones} ${phones.replace(/[^\d]/g, '')}">
      <a class="wk-ph__t" href="/admin/c/${r.c.id}/work#contacts"><b>${r.c.title}</b>${schoolTag(r.c.school, r.w.city)}</a>
      ${r.w.contacts.length ? html`<div class="wk-ph__list">${r.w.contacts.map(phoneLine)}</div>`
        : html`<a class="wk-ph__add" href="/admin/c/${r.c.id}/work#contacts">+ добавить телефон</a>`}
      ${r.w.tg ? html`<a class="wk-ph__tg" href="${r.w.tg}" target="_blank" rel="noopener">${TG_ICON}<span>Группа в Telegram</span></a>` : ''}
    </div>`;
  })}</div>
</section>`;
  return layout({ title: 'Телефоны', nav: 'work', sess: o.sess, body: body });
}

// ---------- вкладка «Лиды»: /admin/work/leads ----------
// Кто спрашивал про съёмку: номер, иногда школа и класс. Позвонить, написать, сделать классом
function leadsPage(o) {
  const f = o.form || {};
  const by = st => o.leads.filter(l => l.status === st);
  const card = l => {
    const cls = l.class_id ? o.classes.get(l.class_id) : null;
    const newUrl = '/admin/new?lead=' + l.id;
    const place = [l.title, l.school].filter(Boolean).join(' · ');
    return html`<li class="wk-lead wk-lead--${l.status}" id="lead-${l.id}" data-find="${l.phone} ${l.phone.replace(/\D/g, '')} ${l.school} ${l.title} ${l.note}">
      <div class="wk-lead__top">
        <div class="wk-lead__main">${l.phone ? html`<b>${l.phone}</b>${place ? html`<span>${place}</span>` : ''}` : html`<b>${place || 'Без номера'}</b>${place ? html`<span class="muted">номера пока нет</span>` : ''}`}<small class="muted">${fmtWhen(l.created_at)}</small></div>
        ${l.phone ? html`<span class="wk-calls"><a class="wk-call wk-call--wa" href="${wa(l.phone)}" target="_blank" rel="noopener" aria-label="Написать в WhatsApp">${WA_ICON}</a><a class="wk-call" href="${tel(l.phone)}" aria-label="Позвонить">${PHONE_ICON}</a></span>` : ''}
      </div>
      ${l.note ? html`<p class="wk-lead__note">${l.note}</p>` : ''}
      <div class="wk-lead__btns">
        ${cls ? html`<a class="b b--sm" href="/admin/c/${cls.id}/work">Открыть класс ${cls.title}</a>` : l.status !== 'class' ? html`<a class="b b--sm b--main" href="${newUrl}">Сделать классом</a>` : ''}
        ${l.status === 'new' ? html`<form method="post" action="/admin/work/leads/${l.id}" class="inline">${csrf(o.sess)}<input type="hidden" name="status" value="talk"><button class="b b--sm" type="submit">Связался</button></form>` : ''}
        ${l.status === 'new' || l.status === 'talk' ? html`<form method="post" action="/admin/work/leads/${l.id}" class="inline">${csrf(o.sess)}<input type="hidden" name="status" value="lost"><button class="b b--sm" type="submit">Не актуально</button></form>` : ''}
        ${l.status === 'lost' ? html`<form method="post" action="/admin/work/leads/${l.id}" class="inline">${csrf(o.sess)}<input type="hidden" name="status" value="new"><button class="b b--sm" type="submit">Вернуть</button></form>` : ''}
        <form method="post" action="/admin/work/leads/${l.id}" class="inline" data-confirm="Удалить из лидов: ${l.phone || place || 'без номера'}?">${csrf(o.sess)}<input type="hidden" name="delete" value="1"><button class="b b--sm b--danger" type="submit">Удалить</button></form>
      </div>
    </li>`;
  };
  const section = (st, name, open) => {
    const list = by(st);
    if (!list.length) return '';
    return open
      ? html`<section class="group" data-group><h2 class="group__h">${name} <span>${list.length}</span></h2><ul class="wk-leads">${list.map(card)}</ul></section>`
      : html`<details class="group" data-group><summary class="group__h">${name} <span>${list.length}</span></summary><ul class="wk-leads">${list.map(card)}</ul></details>`;
  };
  const body = html`${flash(o)}<h1 class="h1 wk-h1">Работа</h1>
${sectionTabs('leads', '', o.leads.filter(l => l.status === 'new').length)}
<details class="card fold wk-leadadd"${!o.leads.length || o.err ? raw(' open') : ''}>
  <summary class="fold__h"><span><b>+ Новый лид</b></span></summary>
  <form class="form" method="post" action="/admin/work/leads">
  ${csrf(o.sess)}
  <label class="field"><span>Телефон</span><input name="phone" type="tel" value="${f.phone || ''}" maxlength="40" placeholder="+7 …" autocomplete="off"></label>
  <p class="muted small">Можно и без номера, если пока известна только школа или класс.</p>
  <div class="two">
    <label class="field"><span>Школа</span><input name="school" value="${f.school || ''}" maxlength="60" autocomplete="off"></label>
    <label class="field"><span>Класс</span><input name="title" value="${f.title || ''}" maxlength="40" autocomplete="off"></label>
  </div>
  <label class="field"><span>Заметка</span><input name="note" value="${f.note || ''}" maxlength="500" placeholder="мама, спросила цены" autocomplete="off"></label>
  <button class="b b--main" type="submit">Добавить</button>
  </form>
</details>
${o.leads.length > 5 ? html`<label class="search"><span class="sr">Поиск</span><input type="search" placeholder="Номер, школа или заметка" data-search autocomplete="off"></label>
<p class="muted small search__none" hidden>Ничего не нашлось</p>` : ''}
${o.leads.length ? '' : html`<p class="muted small">Пока пусто. Сюда записываются номера тех, кто спрашивал про съёмку.</p>`}
${section('new', 'Новые', true)}
${section('talk', 'Связался', true)}
${section('class', 'Стали классами', false)}
${section('lost', 'Не актуально', false)}`;
  return layout({ title: 'Лиды', nav: 'work', sess: o.sess, err: o.err, body: body });
}

// ---------- страница класса: /admin/c/:id/work и /admin/c/:id/work/money ----------
function studentsFixes(o, open) {
  const pk = o.pk;
  if (!pk || !pk.students.length) return '';
  return pk.students.map(st => {
    const mine = open.filter(f => f.student_id === st.id);
    return html`<details class="wk-stu${mine.length ? ' has-fix' : ''}" id="st-${st.id}">
    <summary><b>${st.name}</b>${mine.length ? html` <span class="wk-warn">${fixesN(mine.length)}</span>` : ''}<small class="muted">${st.quote ? st.quote.slice(0, 80) + (st.quote.length > 80 ? '…' : '') : 'цитаты нет'}</small></summary>
    ${fixForm(o, st)}
  </details>`;
  });
}

// Для ученика — все частые правки, для всего класса — групповые и «другое»
const CLASS_FIXES = ['group_swap', 'group_del', 'other'];

function fixForm(o, st) {
  const c = o.cls;
  const kinds = FIXES.filter(f => !f[3] && (st || CLASS_FIXES.indexOf(f[0]) !== -1));
  const first = st ? kinds[0] : kinds.find(f => f[0] === 'other');
  return html`<form class="form wk-fixform" method="post" action="/admin/c/${c.id}/work/fix" data-quote="${st ? st.quote : ''}" data-api="/admin/api/c/${c.id}/work/fix" data-upload="/admin/api/media/fix/${c.id}/">
    ${csrf(o.sess)}
    <input type="hidden" name="student" value="${st ? st.id : 0}">
    <div class="wk-kinds" role="radiogroup" aria-label="Что исправить">${kinds.map(f => html`<label class="wk-kind"><input type="radio" name="kind" value="${f[0]}" data-hint="${f[2]}"${f === first ? raw(' checked') : ''}><span>${f[1]}</span></label>`)}</div>
    <label class="field"><span class="sr">Подробности</span><textarea name="text" rows="3" maxlength="2000" placeholder="${first[2]}">${st && first[0] === 'quote' ? st.quote : ''}</textarea></label>
    <div class="wk-attach" data-attach hidden>
      <label class="wk-pick" data-for="group_swap group_del"><input type="file" accept="image/*" data-label="remove"><span><b>Какое фото убрать</b><small>фото или скрин</small></span></label>
      <label class="wk-pick" data-for="group_swap"><input type="file" accept="image/*" data-label="add"><span><b>Какое поставить</b><small>фото или скрин</small></span></label>
      <label class="wk-pick" data-for="other quote typo mixup photo swap name"><input type="file" accept="image/*" multiple data-label=""><span><b>Прикрепить фото или скрин</b><small>до 6 штук</small></span></label>
    </div>
    <button class="b b--main b--sm" type="submit">Добавить правку</button>
  </form>`;
}

// Готовое сообщение у пункта этапа: текст из шаблона, ссылки класса подставлены
function stepMessage(o, key) {
  const t = TEMPLATES.find(x => x[0] === key);
  if (!t || !o.templates) return '';
  // напоминание о предоплате — только пока её нет
  if (key === 'prepay' && stepOn(o.w, 'prepay')) return '';
  const pk = o.pk;
  const text = fill(o.templates[key], {
    'класс': o.cls.title, 'школа': o.cls.school,
    'отбор': pk ? o.base + '/f/' + pk.album.slug : '',
    'wfolio': pk && pk.album.wfolio ? pk.album.wfolio : '',
    'сумма': o.se ? rub(o.se.prepay) : ''
  });
  const needPick = /\{отбор\}/i.test(o.templates[key]) && !pk;
  // без ссылки на выбор фото сообщение ученикам бесполезно: сначала выборка
  if (needPick) return html`<details class="wk-msg"><summary>Сообщение ученикам</summary><p class="wk-warn small">Сначала <a href="/admin/c/${o.cls.id}/photos">создайте выборку</a>, тогда здесь будет сообщение со ссылкой.</p></details>`;
  return html`<details class="wk-msg"><summary>${key === 'prepay' ? 'Напомнить о предоплате' : 'Сообщение' + (key === 'notify' ? ' родителям' : ' ученикам')}</summary>
    ${key === 'upload' && pk && !pk.album.wfolio ? html`<p class="muted small">Ссылки на wfolio нет, её можно добавить в <a href="/admin/c/${o.cls.id}/photos">отборе</a>.</p>` : ''}
    <textarea readonly rows="${Math.min(12, text.split('\n').length + Math.ceil(text.length / 38))}">${text}</textarea>
    <div class="two"><button class="b b--sm" type="button" data-copy="${text}">Скопировать</button><a class="b b--sm" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Отправить в WhatsApp</a></div>
    <p class="muted small">Текст меняется во вкладке «Работа» → «Шаблоны сообщений».</p>
  </details>`;
}

// Подсказка рядом с пунктом этапа
function stepHint(o, key) {
  const pk = o.pk;
  if (key === 'prepay') return html`<small class="muted">${rub(o.se.prepay)}, та же галочка в деньгах</small>`;
  if (key === 'pick') return html`<small class="muted">убрать дубли</small>`;
  if (key === 'select') {
    const t = pk && pk.teacher && pk.teacher.n ? html` · кл. рук: ${pk.teacher.done ? 'выбрал ✓' : 'ещё нет'}` : '';
    return pk && pk.total
      ? html`<small class="muted">ученики выбирают фото: ${pk.done}/${pk.total} закончили${pk.closed ? ', закрыт' : ''}${t} · <a href="/admin/c/${o.cls.id}/photos">открыть</a></small>`
      : html`<small class="muted">ученики выбирают фото · <a class="wk-mk" href="/admin/c/${o.cls.id}/photos">создать выборку</a></small>`;
  }
  if (key === 'extra' && pk && pk.retouchWait) return html`<small class="wk-warn">ждут: ${pk.retouchWait} · <a href="/admin/c/${o.cls.id}/photos">отметить в отборе</a></small>`;
  if (key === 'check') return html`<small class="muted">ученики проверяют свой макет</small>`;
  return '';
}

// Группа класса в Telegram: кнопка перехода, а если ссылки нет — поле, куда её вставить
function tgBlock(o) {
  const c = o.cls, w = o.w;
  const form = html`<form class="form wk-tgf" method="post" action="/admin/c/${c.id}/work/tg">
        ${csrf(o.sess)}
        <input name="tg" value="${w.tg}" maxlength="220" placeholder="t.me/… или @имя группы" autocomplete="off" inputmode="url" aria-label="Ссылка на группу в Telegram">
        <button class="b b--sm" type="submit">Сохранить</button>
      </form>`;
  if (!w.tg) return html`<div class="wk-tg" id="group"><p class="muted small">Ссылка на группу класса в Telegram, чтобы открывать её в одно нажатие:</p>${form}</div>`;
  return html`<div class="wk-tg" id="group">
    <a class="b b--sm wk-tg__go" href="${w.tg}" target="_blank" rel="noopener">${TG_ICON}<span>Открыть группу в Telegram</span></a>
    <details class="wk-tg__edit"><summary>изменить</summary>${form}<p class="muted small">Чтобы убрать ссылку, сотрите её и сохраните.</p></details>
  </div>`;
}

function datesBlock(o) {
  const c = o.cls, w = o.w;
  return html`<div class="wk-dates" id="dates">
    ${w.dates.length ? html`<ul>${w.dates.map((d, i) => html`<li class="${d.d < o.today ? 'is-past' : ''}"><span><b>${when(d, o.today)}</b> · ${DATE_KIND_NAMES[d.kind]}${d.note ? ' · ' + d.note : ''}${d.d < o.today ? html` <small class="muted">прошла</small>` : ''}</span><form method="post" action="/admin/c/${c.id}/work/datedel" class="inline">${csrf(o.sess)}<input type="hidden" name="i" value="${i}"><button class="pk-x" type="submit" aria-label="Убрать дату" title="Убрать дату">×</button></form></li>`)}</ul>` : ''}
    <details class="wk-adddate"${w.dates.length ? '' : raw(' open')}>
      <summary>+ Добавить дату съёмки</summary>
      <form class="form" method="post" action="/admin/c/${c.id}/work/date">
        ${csrf(o.sess)}
        <div class="wk-date3">
          <label class="field"><span>День</span><input type="date" name="d" required></label>
          <label class="field"><span>Время</span><input type="time" name="t"></label>
          <label class="field"><span>Съёмка</span><select name="kind">${DATE_KINDS.map(k => html`<option value="${k[0]}">${k[1]}</option>`)}</select></label>
        </div>
        <label class="field"><span>Где или что ещё</span><input name="note" maxlength="80" placeholder="Например: студия, школа" autocomplete="off"></label>
        <button class="b b--sm b--main" type="submit">Добавить</button>
      </form>
    </details>
  </div>`;
}

function stagesBlock(o) {
  const c = o.cls, w = o.w;
  const cur = stageOf(w);
  return STAGES.map((st, i) => {
    const done = st.steps.filter(x => stepOn(w, x[0])).length;
    const state = i < cur.index ? 'is-past' : i === cur.index ? 'is-now' : 'is-next';
    return html`<details class="card wk-stg ${state} wk-c${i}" data-stage="${i}"${i === cur.index ? raw(' open') : ''}>
  <summary class="wk-stg__h"><span class="wk-stg__n">${i + 1}</span><span class="wk-stg__name"><b>${st.name}</b><small data-stage-count="${i}">${done} из ${st.steps.length}${i < cur.index ? ' · готово' : ''}</small></span></summary>
  <ul class="wk-steps">${st.steps.map((x, k) => {
      const on = stepOn(w, x[0]);
      const last = k === st.steps.length - 1;
      return html`<li class="${last ? 'is-last' : ''}${on ? ' is-on' : ''}">
      <label class="wk-step"><input type="checkbox" data-step="${x[0]}" data-url="/admin/api/c/${c.id}/work/step"${on ? raw(' checked') : ''}${x[2] === 'auto' && x[0] === 'dates' ? raw(' disabled') : ''}><span><b>${x[1]}</b>${last ? html`<small class="muted">${i === STAGES.length - 1 ? 'класс готов' : 'переход: ' + STAGES[i + 1].name.toLowerCase()}</small>` : ''}${stepHint(o, x[0])}</span></label>
      ${x[0] === 'dates' ? datesBlock(o) : ''}
      ${x[0] === 'group' ? tgBlock(o) : ''}
      ${stepMessage(o, x[0])}
    </li>`;
    })}</ul>
</details>`;
  });
}

function contactsCard(o) {
  const c = o.cls, w = o.w;
  const rows = w.contacts.concat([{ name: '', phone: '' }, { name: '', phone: '' }]).slice(0, Math.max(3, w.contacts.length + 1));
  return html`<section class="card wk-contacts" id="contacts">
  <div class="card__h"><h2 class="h">Телефоны</h2></div>
  ${w.contacts.length ? html`<div class="wk-ph__list">${w.contacts.map(phoneLine)}</div>` : html`<p class="muted small">Добавьте телефоны родителей или классного руководителя, чтобы звонить в одно нажатие. Все номера есть во вкладке «Телефоны» с поиском.</p>`}
  <details class="wk-more"${w.contacts.length ? '' : raw(' open')}>
    <summary>${w.contacts.length ? 'Изменить телефоны' : 'Добавить телефоны'}</summary>
    <form class="form" method="post" action="/admin/c/${c.id}/work/contacts">
      ${csrf(o.sess)}
      ${rows.map(x => html`<div class="wk-crow">
        <label class="field"><span class="sr">Номер</span><input name="phone" type="tel" value="${x.phone}" maxlength="40" placeholder="+7 …" autocomplete="off"></label>
        <label class="field"><span class="sr">Кто это</span><input name="pname" value="${x.name}" maxlength="60" placeholder="Кто: мама Азамата, кл. рук." autocomplete="off"></label>
      </div>`)}
      <p class="muted small">Чтобы убрать номер, сотрите его. Нужно больше строк: сохраните, появится ещё одна.</p>
      <button class="b b--sm b--main" type="submit">Сохранить телефоны</button>
    </form>
  </details>
</section>`;
}

function classHead(o, tab) {
  const c = o.cls;
  return html`<a class="back" href="/admin/work?year=${c.year}">← Работа</a>
${flash(o)}<div class="head head--class wk-chead">
  <div><h1 class="h1">${c.title}</h1><p class="wk-chead__s">${schoolTag(c.school, o.w.city)}<span class="muted">сезон ${c.year - 1}/${String(c.year).slice(2)} · <a href="/admin/c/${c.id}">страница класса</a></span></p>
  <details class="wk-rename"><summary>Изменить название, школу, город</summary>
    <form class="form" method="post" action="/admin/c/${c.id}/work/rename">
      ${csrf(o.sess)}
      <div class="wk-date3">
        <label class="field"><span>Класс</span><input name="title" value="${c.title}" required maxlength="40" autocomplete="off"></label>
        <label class="field"><span>Школа</span><input name="school" value="${c.school}" required maxlength="60" autocomplete="off"></label>
        <label class="field"><span>Город</span><input name="city" value="${o.w.city}" maxlength="60" placeholder="Нальчик" autocomplete="off"></label>
      </div>
      <button class="b b--sm b--main" type="submit">Сохранить</button>
    </form>
  </details></div>
  <form method="post" action="/admin/c/${c.id}/work/half" class="wk-halfsw" aria-label="Осень или весна">
    ${csrf(o.sess)}<input type="hidden" name="back" value="${tab}">
    ${HALVES.map(h => html`<button type="submit" name="half" value="${h[0]}" class="${o.half === h[0] ? 'is-on' : ''}"${o.half === h[0] ? raw(' aria-pressed="true"') : ''}>${h[1]}</button>`)}
  </form>
</div>
<nav class="wk-tabs" aria-label="Класс"><a href="/admin/c/${c.id}/work"${tab === 'work' ? raw(' aria-current="page"') : ''}>Работа</a><a href="/admin/c/${c.id}/work/money"${tab === 'money' ? raw(' aria-current="page"') : ''}>Деньги</a></nav>`;
}

function classPage(o) {
  const c = o.cls, w = o.w;
  const open = o.fixes.filter(f => !f.done_at);
  const done = o.fixes.filter(f => f.done_at);
  // пока класс на записи и дизайнеру ещё нечего делать, её блоки свёрнуты
  const early = stageOf(w).index === 0 && w.status === 'todo' && !o.fixes.length && !o.notes.some(n => n.kind === 'comment');
  const body = html`${classHead(o, 'work')}
${contactsCard(o)}
${stagesBlock(o)}

${early ? raw('<details class="wk-later" id="designer-fold"><summary><span><b>Дизайнер и правки</b><small>Понадобятся на этапе «Работа». Открыть, если нужно сейчас</small></span></summary>') : ''}
<section class="card" id="designer">
  <div class="card__h"><h2 class="h">Дизайнер</h2>${statusChip(w.status)}</div>
  <form method="post" action="/admin/c/${c.id}/work/status" class="wk-status">
    ${csrf(o.sess)}
    ${STATUSES.map(s => html`<button class="wk-sbtn wk-st--${s[0]}${w.status === s[0] ? ' is-on' : ''}" type="submit" name="status" value="${s[0]}"${w.status === s[0] ? raw(' aria-pressed="true"') : ''}>${s[1]}</button>`)}
  </form>
  <p class="muted small" style="margin-top:10px">Новая правка сама возвращает класс в «Новые корректировки», если дизайнер уже отдала работу. «На утверждении» дизайнер ставит сама.</p>
  <p class="wk-lab">Что сделала дизайнер</p>
  <form method="post" action="/admin/c/${c.id}/work/parts" class="wk-parts">
    ${csrf(o.sess)}
    ${PARTS.map(p => html`<label class="check check--sm"><input type="checkbox" name="part" value="${p[0]}"${w.done[p[0]] ? raw(' checked') : ''}><span>${p[1]}</span></label>`)}
    <button class="b b--sm" type="submit">Сохранить отметки</button>
  </form>
</section>

<section class="card" id="fixes">
  <div class="card__h"><h2 class="h">Правки для дизайнера</h2>${open.length ? html`<span class="chip chip--warn">${open.length}</span>` : html`<span class="chip chip--done">всё исправлено</span>`}</div>
  ${open.length ? html`<ul class="wk-fixes">${open.map(f => html`<li class="wk-fix">
    ${fixBody(f, o.files, '/admin/c/' + c.id + '/work/file/')}
    <div class="wk-fix__btns">
      <form method="post" action="/admin/c/${c.id}/work/fixdone" class="inline">${csrf(o.sess)}<input type="hidden" name="fix" value="${f.id}"><input type="hidden" name="on" value="1"><button class="b b--sm" type="submit">Исправлено</button></form>
      <form method="post" action="/admin/c/${c.id}/work/fixdel" class="inline" data-confirm="Удалить правку?">${csrf(o.sess)}<input type="hidden" name="fix" value="${f.id}"><button class="b b--sm b--danger" type="submit">Удалить</button></form>
    </div>
  </li>`)}</ul>` : ''}
  <p class="wk-lab">Добавить правку</p>
  ${o.pk && o.pk.students.length ? html`<p class="muted small">Нажмите на ученика, выберите, что исправить, и при необходимости допишите подробности.</p>
  <div class="wk-stus">${studentsFixes(o, open)}</div>` : html`<p class="muted small">Список учеников берётся из отбора фото. Пока его нет, можно добавить правку на весь класс.</p>`}
  <details class="wk-stu" id="st-all"><summary><b>Весь класс</b><small class="muted">групповые фото, учитель, общий список и другое</small></summary>${fixForm(o, null)}</details>
  ${done.length ? html`<details class="wk-done"><summary>Исправлено: ${done.length}</summary><ul class="wk-fixes">${done.map(f => html`<li class="wk-fix is-done">
    ${fixBody(f, o.files, '/admin/c/' + c.id + '/work/file/')}
    <form method="post" action="/admin/c/${c.id}/work/fixdone" class="inline">${csrf(o.sess)}<input type="hidden" name="fix" value="${f.id}"><input type="hidden" name="on" value="0"><button class="b b--sm" type="submit">Вернуть в работу</button></form>
  </li>`)}</ul></details>` : ''}
</section>

<section class="card" id="notes">
  <div class="card__h"><h2 class="h">Переписка и история</h2></div>
  <form class="form" method="post" action="/admin/c/${c.id}/work/note">
    ${csrf(o.sess)}
    <label class="field"><span class="sr">Сообщение</span><textarea name="text" rows="2" maxlength="2000" placeholder="Комментарий для дизайнера" required></textarea></label>
    <button class="b b--sm" type="submit">Отправить</button>
  </form>
  ${notesList(o.notes)}
</section>
${early ? raw('</details>') : ''}

<form class="card form" method="post" action="/admin/c/${c.id}/work/info" id="info">
  ${csrf(o.sess)}
  <div class="card__h"><h2 class="h">Обработка и заметки</h2></div>
  <div class="two">
    <label class="field"><span>Обработчик</span><select name="processor">
      <option value=""${w.processor ? '' : raw(' selected')}>Не выбран</option>
      <option value="${SELF}"${w.processor === SELF ? raw(' selected') : ''}>Я сам</option>
      ${o.se.processors.map(p => html`<option value="${p.name}"${w.processor === p.name ? raw(' selected') : ''}>${p.name}</option>`)}
      ${w.processor && w.processor !== SELF && !o.se.processors.some(p => p.name === w.processor) ? html`<option value="${w.processor}" selected>${w.processor}</option>` : ''}
    </select></label>
    <label class="field"><span>Где снимали</span><input name="shoot_place" value="${w.shoot_place}" maxlength="120" placeholder="Студия, школа, природа" autocomplete="off"></label>
  </div>
  <label class="field"><span>Заметка для себя</span><textarea name="note" rows="3" maxlength="2000" placeholder="Дизайнер это не видит">${w.note}</textarea></label>
  <button class="b b--main" type="submit">Сохранить</button>
</form>`;
  return layout({ title: 'Работа · ' + c.title, sess: o.sess, nav: 'work', body: body, scripts: ['/admin/static/work.js'] });
}

function moneyCalc(m) {
  return html`<div class="wk-calc">
    <p><span>Альбомов</span><b>${m.books}${m.teachers ? ' (' + (m.teachers > 1 ? m.teachers + ' кл. руку' : 'с кл. руком') + ')' : ''}</b></p>
    <p><span>Разворотов</span><b>${m.students} ÷ ${m.divisor} → ${m.spreads - m.extra} + ${m.extra} = ${m.spreads}</b></p>
    <p><span>Печать альбома</span><b>${m.printOne !== null ? rub(m.printOne) : 'нет в прайсе'}</b></p>
    <p class="wk-calc__sep"><span>Печать всего</span><b>${rub(m.printAll)}</b></p>
    ${m.probes ? html`<p><span>Пробники (${m.probes})</span><b>${rub(m.probeCost)}</b></p>` : ''}
    <p><span>Дизайнер</span><b>${rub(m.designer)}</b></p>
    <p><span>Обработка${m.processor ? ' · ' + (m.processor === SELF ? 'сам' : m.processor) : ''}</span><b>${m.processor ? rub(m.proc) : 'не выбран'}</b></p>
    <p><span>СММ и помощь</span><b>${rub(m.smm)}</b></p>
    <p class="wk-calc__sep"><span>Затраты</span><b>${rub(m.costs)}</b></p>
    <p><span>Оплата от родителей</span><b>${rub(m.total)}</b></p>
    <p><span>${m.prepaid ? 'Предоплата внесена' : 'Предоплаты нет'}</span><b>${m.prepaid ? '−' + rub(m.prepay) : ''}</b></p>
    ${m.paid ? html`<p><span>Оплачено после предоплаты</span><b>−${rub(m.paid)}</b></p>` : ''}
    ${m.paidUp ? html`<p class="wk-calc__ok"><span>${m.rest < 0 ? 'Оплачено, переплата' : 'Оплачено полностью'}</span><b>${m.rest < 0 ? rub(-m.rest) : '✓'}</b></p>`
      : html`<p class="wk-calc__left"><span>Осталось получить чистыми<small>родители ещё отдадут ${rub(m.rest)}</small></span><b>${rub(m.restNet)}</b></p>`}
    <p class="wk-calc__total"><span>Чистая прибыль</span><b class="${m.profit < 0 ? 'is-neg' : ''}">${rub(m.profit)}</b></p>
  </div>`;
}

// Оплата после предоплаты: одной кнопкой весь остаток или частями
function payCard(o) {
  const c = o.cls, m = o.m, w = o.w;
  if (!m.ready && !w.paid.length) return '';
  return html`<section class="card" id="pay">
  <div class="card__h"><h2 class="h">Оплата</h2>${m.paidUp ? html`<span class="chip chip--done">оплачено</span>` : m.ready ? html`<span class="chip chip--warn">с родителей ещё ${rub(m.rest)}</span>` : ''}</div>
  <div class="wk-calc wk-calc--pay">
    <p><span>Нужно получить всего</span><b>${rub(m.total)}</b></p>
    <p><span>Предоплата</span><b>${m.prepaid ? rub(m.prepay) : html`<span class="muted">не отмечена</span>`}</b></p>
  </div>
  ${w.paid.length ? html`<ul class="wk-dlv wk-pays">${w.paid.map((p, i) => html`<li><b>${rub(p.sum)}</b><span>${p.note || 'оплата'}<small class="muted"> · ${fmtWhen(p.at)}</small></span><form method="post" action="/admin/c/${c.id}/work/paydel" class="inline" data-confirm="Убрать оплату ${rub(p.sum)}?">${csrf(o.sess)}<input type="hidden" name="i" value="${i}"><button class="pk-x" type="submit" aria-label="Убрать" title="Убрать">×</button></form></li>`)}</ul>` : ''}
  ${!m.paidUp && m.rest > 0 ? html`<form method="post" action="/admin/c/${c.id}/work/pay" class="wk-payall">
    ${csrf(o.sess)}<input type="hidden" name="sum" value=""><input type="hidden" name="note" value="остаток">
    <button class="b b--main b--wide" type="submit">Класс доплатил остаток ${rub(m.rest)}</button>
  </form>
  <details class="wk-more">
    <summary>Заплатили часть</summary>
    <form class="form" method="post" action="/admin/c/${c.id}/work/pay">
      ${csrf(o.sess)}
      <div class="two">
        <label class="field"><span>Сумма</span><input name="sum" inputmode="numeric" maxlength="8" required placeholder="${m.rest}" autocomplete="off"></label>
        <label class="field"><span>Кто или за что</span><input name="note" maxlength="80" placeholder="Например: 5 человек" autocomplete="off"></label>
      </div>
      <button class="b b--sm" type="submit">Записать оплату</button>
    </form>
  </details>` : ''}
</section>`;
}

// Пробники: альбомы для себя, подписаны фамилией; идут в расход по цене печати
function probeCard(o) {
  const c = o.cls, w = o.w, m = o.m;
  return html`<section class="card" id="probes">
  <div class="card__h"><h2 class="h">Пробники</h2>${w.probes.length ? html`<span class="muted small">${w.probes.length} · ${m.printOne !== null ? rub(m.probeCost) : 'цена печати не указана'}</span>` : ''}</div>
  <p class="muted small">Идёт только в расход, по цене печати альбома${m.printOne !== null ? ' (' + rub(m.printOne) + ')' : ''}.</p>
  ${w.probes.length ? html`<ul class="wk-dlv">${w.probes.map((p, i) => html`<li><b>${p.name}</b><span><small class="muted">${fmtWhen(p.at)}</small></span><form method="post" action="/admin/c/${c.id}/work/probedel" class="inline" data-confirm="Убрать пробник «${p.name}»?">${csrf(o.sess)}<input type="hidden" name="i" value="${i}"><button class="pk-x" type="submit" aria-label="Убрать" title="Убрать">×</button></form></li>`)}</ul>` : ''}
  <form class="wk-probe" method="post" action="/admin/c/${c.id}/work/probe">
    ${csrf(o.sess)}
    <label class="field"><span class="sr">Фамилия</span><input name="name" maxlength="60" placeholder="Фамилия" required autocomplete="off"></label>
    <button class="b b--sm" type="submit">+ Пробник</button>
  </form>
</section>`;
}

function classMoneyPage(o) {
  const c = o.cls, w = o.w, m = o.m, pk = o.pk;
  const body = html`${classHead(o, 'money')}
<form class="card form" method="post" action="/admin/c/${c.id}/work/money" id="money">
  ${csrf(o.sess)}
  <div class="two">
    <label class="field"><span>Учеников</span><input name="students" inputmode="numeric" maxlength="4" value="${m.studentsOwn ? m.students : ''}" placeholder="${pk && pk.total ? 'в отборе ' + pk.total : 'сколько'}" autocomplete="off"></label>
    <label class="field"><span>Цена альбома</span><input name="price" inputmode="numeric" maxlength="8" value="${m.priceOwn ? m.price : ''}" placeholder="${o.se.price}" autocomplete="off"></label>
  </div>
  <label class="field wk-tch"><span>Альбомов классному руководителю</span><select name="teacher">${[0, 1, 2, 3].map(n => html`<option value="${n}"${m.teachers === n ? raw(' selected') : ''}>${n === 0 ? 'нет' : n}</option>`)}</select><small class="muted">за каждый +1 в печать и +${rub(o.se.teacher)} к оплате</small></label>
  <label class="check"><input type="checkbox" name="prepaid" value="1"${m.prepaid ? raw(' checked') : ''}><span>Предоплата внесена<small>${rub(o.se.prepay)}</small></span></label>
  <details class="wk-more"${w.money.divisor || w.money.extra !== undefined || w.money.print ? raw(' open') : ''}>
    <summary>Развороты и печать не как обычно</summary>
    <div class="wk-money">
      <label class="field"><span>Учеников на разворот</span><input name="divisor" inputmode="numeric" maxlength="2" value="${w.money.divisor || ''}" placeholder="${o.se.divisor}" autocomplete="off"></label>
      <label class="field"><span>Разворотов сверху</span><input name="extra" inputmode="numeric" maxlength="3" value="${w.money.extra !== undefined ? w.money.extra : ''}" placeholder="${o.se.extra}" autocomplete="off"></label>
      <label class="field"><span>Печать одного альбома</span><input name="print" inputmode="numeric" maxlength="8" value="${m.printOwn ? m.printOne : ''}" placeholder="${m.printOwn ? '' : m.printOne !== null ? m.printOne + ' по прайсу' : 'нет в прайсе'}" autocomplete="off"></label>
    </div>
  </details>
  ${m.students ? moneyCalc(m) : ''}
  ${m.missing.length ? html`<p class="flash flash--warn">Чтобы посчитать, укажите ${m.missing.join(', ')}${m.missing.some(x => /печати/.test(x)) ? html`. Цену можно добавить в <a href="/admin/work/money?year=${c.year}#prices">прайс сезона</a> или написать в «Печать одного альбома»` : ''}.</p>` : ''}
  <button class="b b--main" type="submit">Сохранить и посчитать</button>
</form>
${payCard(o)}
${probeCard(o)}
<p class="muted small">Обработчик выбирается во вкладке «Работа». Дизайнер, СММ, прайс типографии и ставки обработчиков меняются в <a href="/admin/work/money?year=${c.year}#prices">ценах сезона</a>.</p>`;
  return layout({ title: 'Деньги · ' + c.title, sess: o.sess, nav: 'work', body: body, scripts: ['/admin/static/work.js'] });
}

// ---------- вкладка «Деньги»: /admin/work/money ----------
function totalsShort(label, t, n, on, href) {
  return html`<a class="wk-tot${on ? ' is-on' : ''}" href="${href}">
    <small>${label} · ${classesN(n)}</small>
    <span><i>приход</i><b>${rub(t.total)}</b></span>
    <span><i>расход</i><b>${rub(t.costs + t.delivery)}</b></span>
    <span class="wk-tot__p"><i>прибыль</i><b class="${t.final < 0 ? 'is-neg' : ''}">${rub(t.final)}</b></span>
  </a>`;
}

function moneyPage(o) {
  const se = o.se, y = o.year, t = o.totals[o.half || 'all'];
  const printText = Object.keys(se.print).map(Number).sort((a, b) => a - b).map(k => k + ' — ' + se.print[k]).join('\n');
  const procText = se.processors.map(p => p.name + ' ' + p.rate).join('\n');
  const q = '?year=' + y + (o.half ? '&half=' + o.half : '');
  const base = '/admin/work/money?year=' + y;
  const label = o.half ? HALF_NAMES[o.half] : 'Весь сезон';
  const body = html`${flash(o)}<h1 class="h1 wk-h1">Работа</h1>
${sectionTabs('money', q, o.newLeads)}
${seasonNav(o, '/admin/work/money')}
<div class="wk-tots">
  ${totalsShort('Весь сезон', o.totals.all, o.halves.all, !o.half, base)}
  ${HALVES.map(h => totalsShort(h[1], o.totals[h[0]], o.halves[h[0]], o.half === h[0], base + '&half=' + h[0]))}
</div>

<section class="card">
  <div class="card__h"><h2 class="h">${label} ${y - 1}/${String(y).slice(2)}</h2><span class="muted small">${t.students} учеников</span></div>
  <div class="wk-calc">
    <p><span>Оплата от родителей</span><b>${rub(t.total)}</b></p>
    <p><span>Предоплаты внесены (${t.prepaidN} из ${o.rows.length})</span><b>${rub(t.prepay)}</b></p>
    <p><span>Оплаты после предоплаты</span><b>${rub(t.paid)}</b></p>
    <p class="wk-calc__left"><span>Осталось получить чистыми<small>родители ещё отдадут ${rub(t.rest)}${t.paidUpN ? ' · оплатили полностью: ' + t.paidUpN : ''}</small></span><b>${rub(t.restNet)}</b></p>
    <p class="wk-calc__sep"><span>Печать</span><b>${rub(t.print)}</b></p>
    <p><span>Дизайнер</span><b>${rub(t.designer)}</b></p>
    ${Object.keys(t.proc).map(k => html`<p><span>Обработка · ${k}</span><b>${rub(t.proc[k])}</b></p>`)}
    <p><span>СММ и помощь</span><b>${rub(t.smm)}</b></p>
    <p><span>Доставка</span><b>${rub(t.delivery)}</b></p>
    <p class="wk-calc__sep"><span>Общий расход</span><b>${rub(t.costs + t.delivery)}</b></p>
    <p class="wk-calc__total"><span>Чистая прибыль</span><b class="${t.final < 0 ? 'is-neg' : ''}">${rub(t.final)}</b></p>
  </div>
  ${t.notReady.length ? html`<p class="flash flash--warn">Не посчитаны: ${t.notReady.map(r => r.c.title + ' ' + r.c.school).join(', ')}. Откройте класс → «Деньги».</p>` : ''}
</section>

${o.rows.length ? html`<section class="card">
  <div class="card__h"><h2 class="h">Классы</h2></div>
  <div class="pk-scroll"><table class="pk-table wk-table">
    <thead><tr><th>Класс</th><th>Уч.</th><th>Оплата</th><th>Затраты</th><th>Прибыль</th></tr></thead>
    <tbody>${o.rows.map(r => html`<tr class="${!r.m.prepaid ? 'is-noprepay' : ''}">
      <td><a class="wk-tname" href="/admin/c/${r.c.id}/work/money">${r.c.title}</a>${schoolTag(r.c.school, r.w.city)}<small class="muted">${HALF_NAMES[r.half].toLowerCase()}${r.m.paidUp ? ' · оплачено ✓' : r.m.prepaid ? ' · предоплата ✓' + (r.m.ready ? ', осталось чистыми ' + rub(r.m.restNet) : '') : ''}</small>${!r.m.prepaid ? html`<span class="wk-noprepay">без предоплаты</span>` : ''}</td>
      <td>${r.m.students || '—'}</td>
      <td>${r.m.ready ? rub(r.m.total) : '—'}</td>
      <td>${r.m.ready ? rub(r.m.costs) : '—'}</td>
      <td class="${r.m.ready ? (r.m.profit < 0 ? 'is-neg' : 'ok') : 'muted'}">${r.m.ready ? rub(r.m.profit) : 'не посчитан'}</td>
    </tr>`)}</tbody>
  </table></div>
</section>` : ''}

<section class="card" id="delivery">
  <div class="card__h"><h2 class="h">Доставка</h2><span class="muted small">${rub(o.totals.all.delivery)} за сезон</span></div>
  <p class="muted small">Сумма каждый раз разная, поэтому пишется вручную. Вычитается из прибыли.</p>
  ${o.deliveries.length ? html`<ul class="wk-dlv">${o.deliveries.map(d => html`<li><b>${rub(d.amount)}</b><span>${d.note || ''}<small class="muted"> ${d.half ? HALF_NAMES[d.half].toLowerCase() + ' · ' : ''}${fmtWhen(d.at)}</small></span><form method="post" action="/admin/work/money/${y}/delivery/${d.id}/delete" class="inline" data-confirm="Удалить эту доставку?">${csrf(o.sess)}<button class="pk-x" type="submit" aria-label="Удалить" title="Удалить">×</button></form></li>`)}</ul>` : ''}
  <form class="form wk-dlv__add" method="post" action="/admin/work/money/${y}/delivery">
    ${csrf(o.sess)}
    <div class="wk-date3">
      <label class="field"><span>Сумма</span><input name="amount" inputmode="numeric" maxlength="8" required autocomplete="off"></label>
      <label class="field"><span>Когда</span><select name="half">${HALVES.map(h => html`<option value="${h[0]}"${(o.half || o.defaultHalf) === h[0] ? raw(' selected') : ''}>${h[1]}</option>`)}</select></label>
      <label class="field"><span>За что</span><input name="note" maxlength="200" placeholder="6 коробок" autocomplete="off"></label>
    </div>
    <button class="b b--sm" type="submit">Добавить</button>
  </form>
</section>

<details class="card fold" id="prices">
  <summary class="fold__h"><span><b>Цены сезона ${y - 1}/${String(y).slice(2)}</b><small>Дизайнер ${rub(se.designer)}, предоплата ${rub(se.prepay)}, СММ, обработчики, прайс типографии</small></span></summary>
  <form class="form" method="post" action="/admin/work/money/${y}">
  ${csrf(o.sess)}
  <p class="muted small">Считаются для всех классов этого сезона. Новый сезон берёт цены прошлого, а если их поменять, прошлые классы останутся со старыми.</p>
  <div class="wk-money">${SEASON_FIELDS.map(f => html`<label class="field"><span>${f[1]}</span><input name="${f[0]}" inputmode="numeric" maxlength="8" value="${se[f[0]]}" required autocomplete="off">${f[2] ? html`<small class="muted">${f[2]}</small>` : ''}</label>`)}</div>
  <label class="field"><span>Обработчики и сколько платите за класс</span><textarea name="processors" rows="${Math.max(3, se.processors.length + 1)}" placeholder="Инал 4000">${procText}</textarea><small class="muted">Каждый с новой строки: имя и сумма. «Я сам» есть всегда, без расхода.</small></label>
  <label class="field"><span>Прайс типографии: разворотов и цена печати альбома</span><textarea name="print" rows="8" class="wk-print">${printText}</textarea><small class="muted">Каждая строка: число разворотов и цена, например «22 — 1328». Новые строки можно дописать в конец.</small></label>
  <button class="b b--main" type="submit">Сохранить цены</button>
  </form>
</details>`;
  return layout({ title: 'Деньги · сезон ' + y, sess: o.sess, nav: 'work', body: body });
}

// ---------- кабинет дизайнера: /d/:token ----------
function dlayout(o) {
  return '<!doctype html>\n' + html`<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${o.title} · RIGSARTHUR</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F4EFE7">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/admin/static/admin.css">
</head>
<body class="wk-d">
<header class="ah">
  <div class="ah__in">
    <a class="ah__logo" href="${o.home}"><b>RIGSARTHUR</b><span>для дизайнера</span></a>
    <span class="wk-who">${o.designer.name}</span>
  </div>
</header>
<main class="aw">
${o.body}
</main>
<p class="toast" role="status" aria-live="polite" hidden></p>
<script src="/admin/static/admin.js"></script>
<script src="/admin/static/work.js"></script>
</body>
</html>
`.s;
}

// Порядок для дизайнера: сначала то, что ждёт её работы
const D_ORDER = ['fixes', 'todo', 'review', 'check', 'print', 'printed'];

// Класс, где ещё нечего делать: съёмки не было и фото не загружены
const waiting = r => r.w.status === 'todo' && !r.w.shot && !(r.pk && r.pk.total);

function designerHome(o) {
  const home = '/d/' + o.designer.token;
  const groups = D_ORDER.map(st => [st, o.rows.filter(r => r.w.status === st && !waiting(r))]).filter(g => g[1].length);
  const later = o.rows.filter(waiting);
  const card = r => html`<a class="row wk-row" href="${home}/c/${r.c.id}" data-find="${r.c.title} ${r.c.school}">
    <span class="wk-row__main">
      <b>${r.c.title}</b> <span class="muted">${r.c.school}</span>
      <span class="wk-meta">${shootIcons(r.w)}${r.pk && r.pk.total ? pkLine(r.pk) : ''}${waiting(r) ? '' : partsDots(r.w.done)}${r.open ? html`<span class="wk-warn">${fixesN(r.open)}</span>` : ''}</span>
    </span>
  </a>`;
  const body = html`<h1 class="h1">Классы</h1>
<p class="muted small wk-lead">Сверху классы с новыми правками. Один силуэт: индивидуальная съёмка, три: групповая. Красный: даты нет, жёлтый: дата назначена, зелёный: отсняли.</p>
${o.rows.length ? '' : html`<div class="card empty"><h2 class="h">Пока классов нет</h2><p class="muted">Они появятся, когда Артур запишет класс.</p></div>`}
${o.rows.length > 5 ? html`<label class="search"><span class="sr">Поиск</span><input type="search" placeholder="Найти класс или школу" data-search autocomplete="off"></label>
<p class="muted small search__none" hidden>Ничего не нашлось</p>` : ''}
${groups.map(g => g[0] === 'printed'
    ? html`<details class="group" data-group><summary class="group__h">${statusChip('printed')} <span>${g[1].length}</span></summary><div class="rows">${g[1].map(card)}</div></details>`
    : html`<section class="group" data-group><h2 class="group__h">${statusChip(g[0])} <span>${g[1].length}</span></h2><div class="rows">${g[1].map(card)}</div></section>`)}
${later.length ? html`<section class="group" data-group><h2 class="group__h">Съёмки ещё не было <span>${later.length}</span></h2><div class="rows">${later.map(card)}</div></section>` : ''}`;
  return dlayout({ title: 'Классы', designer: o.designer, home: home, body: body });
}

function designerClass(o) {
  const home = '/d/' + o.designer.token;
  const api = home + '/c/' + o.cls.id;
  const c = o.cls, w = o.w, pk = o.pk;
  const open = o.fixes.filter(f => !f.done_at);
  const done = o.fixes.filter(f => f.done_at);
  const canSend = w.status === 'todo' || w.status === 'fixes';
  const students = pk ? pk.students : [];
  const quotes = students.filter(s => s.quote);
  const allQuotes = quotes.map(s => s.name + '\n' + s.quote).join('\n\n');
  const body = html`<a class="back" href="${home}">← Все классы</a>
<div class="head head--class">
  <div><h1 class="h1">${c.title}</h1><p class="muted">${c.school} · ${c.year}</p></div>
</div>

<section class="card wk-dhead">
  <div class="card__h"><h2 class="h">Статус</h2>${statusChip(w.status)}</div>
  <div class="wk-facts">
    <p class="wk-shootline">${shootIcons(w)}<span>индивидуальная: ${shootState(w, 'ind').text}, групповая: ${shootState(w, 'group').text}</span></p>
    <p>${pkLine(pk)}</p>
  </div>
  ${canSend ? html`<form data-dw action="${api}/status" class="wk-send">
    <input type="hidden" name="status" value="review">
    <button class="b b--main b--wide" type="submit"${open.length ? raw(' data-confirm="Ещё есть неисправленные правки: ' + open.length + '. Всё равно отправить на утверждение?"') : ''}>${w.status === 'fixes' ? 'Исправила, отправить на утверждение' : 'Сделала, отправить на утверждение'}</button>
  </form>` : html`<p class="muted small" style="margin-top:12px">${w.status === 'review' ? 'Ждёт проверки Артура. Если он добавит правки, класс вернётся к вам со статусом «Новые корректировки».' : w.status === 'check' ? 'Класс проверяет макет. Если будут правки, они появятся ниже.' : 'Работа по классу закончена.'}</p>`}
  <p class="wk-lab">Что сделано</p>
  <div class="wk-parts">${PARTS.map(p => html`<label class="check check--sm"><input type="checkbox" data-part="${p[0]}" data-url="${api}/part"${w.done[p[0]] ? raw(' checked') : ''}><span>${p[1]}</span></label>`)}</div>
</section>

${open.length ? html`<section class="card wk-open" id="fixes">
  <div class="card__h"><h2 class="h">Правки</h2><span class="chip chip--warn">${open.length}</span></div>
  <ul class="wk-fixes">${open.map(f => html`<li class="wk-fix">
    ${fixBody(f, o.files, api + '/file/')}
    ${(f.kind === 'quote' || f.kind === 'teacher_wish') && f.text ? html`<button class="b b--sm" type="button" data-copy="${f.text}">${f.kind === 'quote' ? 'Скопировать цитату' : 'Скопировать пожелание'}</button> ` : ''}
    <form data-dw action="${api}/fixdone" class="inline"><input type="hidden" name="fix" value="${f.id}"><input type="hidden" name="on" value="1"><button class="b b--sm b--main" type="submit">Исправила</button></form>
  </li>`)}</ul>
</section>` : ''}

<section class="card" id="students">
  <div class="card__h"><h2 class="h">Ученики</h2><span class="muted small">${students.length ? 'цитат: ' + quotes.length + ' из ' + students.length : ''}</span></div>
  ${quotes.length ? html`<div class="two wk-qbtns">
    <a class="b b--sm" href="${api}/quotes.csv" download>Скачать таблицу цитат</a>
    <button class="b b--sm" type="button" data-copy="${allQuotes}">Скопировать все цитаты</button>
  </div>` : ''}
  ${students.length ? students.map(st => {
    const mine = open.filter(f => f.student_id === st.id);
    return html`<div class="wk-dst${mine.length ? ' has-fix' : ''}" id="st-${st.id}">
    <div class="wk-dst__h"><b>${st.name}</b>${mine.length ? html`<span class="wk-warn">${fixesN(mine.length)}</span>` : ''}</div>
    ${thumbs(pk, st)}
    ${retouchLine(pk, st)}
    ${st.quote ? html`<blockquote class="wk-q">${st.quote}</blockquote><button class="wk-copy" type="button" data-copy="${st.quote}">Скопировать цитату</button>` : html`<p class="muted small">Цитаты пока нет</p>`}
  </div>`;
  }) : html`<p class="muted small">Список учеников появится, когда Артур начнёт отбор фото.</p>`}
</section>

${teacherBlock(pk)}

${pk && pk.group.length ? html`<details class="card fold" id="group">
  <summary class="fold__h"><span><b>Групповые фото</b><small>Выбрано: ${pk.group.length}</small></span></summary>
  <div class="pk-thumbs wk-group">${pk.group.map(ph => html`<a href="/f/${pk.album.slug}/p/${ph.id}.jpg?v=${ph.ver}" target="_blank" rel="noopener" title="${ph.path}"><img src="/f/${pk.album.slug}/p/${ph.id}-sm.jpg?v=${ph.ver}" alt="${ph.path}" loading="lazy"></a>`)}</div>
</details>` : ''}

<section class="card" id="notes">
  <div class="card__h"><h2 class="h">Переписка с Артуром</h2></div>
  <form data-dw action="${api}/note" class="form">
    <label class="field"><span class="sr">Сообщение</span><textarea name="text" rows="2" maxlength="2000" placeholder="Вопрос или комментарий по классу" required></textarea></label>
    <button class="b b--sm" type="submit">Отправить</button>
  </form>
  ${notesList(o.notes)}
</section>

${done.length ? html`<details class="card fold"><summary class="fold__h"><span><b>Исправленные правки</b><small>${done.length}</small></span></summary><ul class="wk-fixes">${done.map(f => html`<li class="wk-fix is-done">${fixBody(f, o.files, api + '/file/')}</li>`)}</ul></details>` : ''}`;
  return dlayout({ title: c.title + ' · ' + c.school, designer: o.designer, home: home, body: body });
}

// Выбор классного руководителя для дизайнера: два фото и пожелание классу
function teacherBlock(pk) {
  if (!pk || !pk.teacher || (!pk.teacher.n && !pk.teacher.wish)) return '';
  const t = pk.teacher;
  const ph = (x, role) => x ? html`<figure class="pk-ph"><a href="/f/${pk.album.slug}/p/${x.id}.jpg?v=${x.ver}" target="_blank" rel="noopener" title="${x.path}"><img src="/f/${pk.album.slug}/p/${x.id}-sm.jpg?v=${x.ver}" alt="${role}" loading="lazy"></a><figcaption><b>${role}</b><span class="muted wk-file">${x.path.split('/').pop()}</span></figcaption></figure>` : '';
  const chosen = t.picks.cover || t.picks.list;
  return html`<section class="card" id="teacher">
  <div class="card__h"><h2 class="h">Классный руководитель</h2>${t.done ? html`<span class="chip chip--done">выбрал</span>` : html`<span class="chip">ещё выбирает</span>`}</div>
  ${t.name ? html`<p><b>${t.name}</b></p>` : ''}
  ${chosen ? html`<div class="pk-thumbs">${ph(t.picks.cover, 'Обложка')}${ph(t.picks.list, 'Общий список')}</div>` : html`<p class="muted small">Фото ещё не выбраны</p>`}
  ${t.wish ? html`<p class="wk-lab">Пожелание классу</p><blockquote class="wk-q">${t.wish}</blockquote><button class="wk-copy" type="button" data-copy="${t.wish}">Скопировать пожелание</button>` : ''}
</section>`;
}

function designerGone() {
  return '<!doctype html>\n' + html`<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Ссылка не работает</title><link rel="stylesheet" href="/assets/fonts/fonts.css"><link rel="stylesheet" href="/admin/static/admin.css"></head>
<body><main class="aw aw--narrow"><div class="card"><h1 class="h">Ссылка не работает</h1><p class="muted" style="margin-top:8px">Её отключили или в ней опечатка. Попросите у Артура новую.</p></div></main></body></html>
`.s;
}

// Таблица цитат для Excel: точка с запятой и BOM — так русский Excel открывает без кракозябр
function quotesCsv(students) {
  const cell = v => '"' + String(v || '').replace(/"/g, '""') + '"';
  return '﻿' + ['Ученик;Цитата'].concat(students.map(s => cell(s.name) + ';' + cell(s.quote))).join('\r\n') + '\r\n';
}

module.exports = { boardPage, phonesPage, leadsPage, classPage, classMoneyPage, moneyPage, designerHome, designerClass, designerGone, quotesCsv, MSG };
