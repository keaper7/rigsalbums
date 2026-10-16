'use strict';

// Статистика сайта в админке: /admin/stats
const { html, raw, plural } = require('../lib/util');
const { layout } = require('./admin');
const { PAGE_NAMES, SITE_PAGES } = require('../lib/stats');

function csrf(sess) { return html`<input type="hidden" name="_csrf" value="${sess.csrf}">`; }

const MSG = { link: 'Ссылка создана. Скопируйте её и вставьте в пост или сторис', linkdel: 'Ссылка удалена' };
const PERIODS = [['today', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней']];
const WEEK = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const KIND_ICON = { whatsapp: '💬', phone: '📞', instagram: '📷', telegram: '✈️', vk: '🅥', design: '🎨', link: '↗', button: '•' };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function people(n) { return n + ' ' + plural(n, 'человек', 'человека', 'человек'); }
function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
// секунды → «14 с», «2 мин 5 с»
function secs(s) {
  s = Math.round(s);
  if (s < 60) return s + ' с';
  const m = Math.floor(s / 60), r = s % 60;
  return m + ' мин' + (r ? ' ' + r + ' с' : '');
}
function shortDay(d) { return +d.slice(8, 10) + ' ' + MONTHS[+d.slice(5, 7) - 1]; }

// Столбики: values — числа, labels — подписи под ними (можно реже)
function bars(values, labels, opts) {
  opts = opts || {};
  const max = Math.max(1, ...values);
  const n = values.length;
  const w = 100 / n;
  const every = opts.every || 1;
  return raw(`<div class="st-bars${opts.small ? ' st-bars--sm' : ''}" role="img" aria-label="${opts.label || ''}">
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${values.map((v, i) => {
      const h = v ? Math.max(1.5, v / max * 38) : 0;
      return `<rect x="${(i * w + w * 0.15).toFixed(2)}" y="${(40 - h).toFixed(2)}" width="${(w * 0.7).toFixed(2)}" height="${h.toFixed(2)}" rx="0.6"><title>${labels[i]}: ${v}</title></rect>`;
    }).join('')}</svg>
    <div class="st-bars__x">${labels.map((l, i) => `<span style="width:${w}%">${i % every === 0 ? l : ''}</span>`).join('')}</div>
  </div>`);
}

// Полоска с долей: название, число, процент
function share(name, n, total, extra) {
  const p = pct(n, total);
  return html`<li class="st-share"><div class="st-share__t"><span>${name}</span><b>${n}${extra ? html` <small>${extra}</small>` : ''}</b></div><div class="st-share__bar"><i style="width:${Math.max(p, n ? 2 : 0)}%"></i></div></li>`;
}

function onlineCard(o) {
  const on = o.online;
  return html`<section class="card st-live" data-live="/admin/api/stats/online">
  <div class="st-live__h"><span class="st-dot"></span><b data-live-total>${on.total}</b><span>${plural(on.total, 'человек', 'человека', 'человек')} сейчас</span></div>
  <ul class="st-live__list" data-live-list>
    ${onlineList(on)}
  </ul>
  <p class="muted small">Обновляется само каждые 10 секунд.</p>
</section>`;
}
function onlineList(on) {
  if (!on.total) return html`<li class="muted">Сейчас никого нет</li>`;
  const pages = Object.keys(on.pages).map(p => (PAGE_NAMES[p] || p) + ' ' + on.pages[p]).join(', ');
  return html`${on.site ? html`<li><b>На сайте: ${on.site}</b><small>${pages}</small></li>` : ''}
    ${on.classes.map(c => html`<li><b>${c.kind === 'class' ? 'Голосуют' : 'Выбирают фото'}: ${c.n}</b><small>${c.name}</small></li>`)}`;
}

function statsPage(o) {
  const r = o.rep;
  const today = o.period === 'today';
  const empty = !r.views;
  const pg = r.blocks[o.page];
  // в порядке страницы: так блоки записываются, пока человек листает сверху вниз
  const blockList = pg ? Object.values(pg.list) : [];
  const hourLabels = Array.from({ length: 24 }, (_, i) => String(i));
  const body = html`${o.msg && MSG[o.msg] ? html`<p class="flash" role="status">${MSG[o.msg]}</p>` : ''}${o.err ? html`<p class="flash flash--err" role="alert">${o.err}</p>` : ''}
<h1 class="h1 wk-h1">Статистика</h1>
${onlineCard(o)}

<nav class="wk-halves st-periods" aria-label="Период">${PERIODS.map(p => html`<a href="/admin/stats?period=${p[0]}"${o.period === p[0] ? raw(' aria-current="page"') : ''}>${p[1]}</a>`)}</nav>

${empty ? html`<div class="card empty"><h2 class="h">Пока данных нет</h2><p class="muted">Статистика начнёт собираться с первого посетителя. Ваши собственные заходы, пока вы вошли в админку, не считаются.</p></div>` : html`
<div class="st-kpi">
  <div class="card"><small>Посетители</small><b>${r.visitors}</b><span>новых ${r.fresh}</span></div>
  <div class="card"><small>Хотели записаться</small><b>${r.contacts}</b><span>${pct(r.contacts, r.siteVisitors)}% от посетителей сайта</span></div>
  <div class="card"><small>Просмотры страниц</small><b>${r.views}</b><span>${r.siteVisitors ? (r.siteViews / r.siteVisitors).toFixed(1).replace('.', ',') : 0} на человека</span></div>
  <div class="card"><small>С телефона</small><b>${pct(r.devices.mobile + r.devices.tablet, r.devices.mobile + r.devices.tablet + r.devices.desktop)}%</b><span>с компьютера ${r.devices.desktop}</span></div>
</div>
<p class="muted small st-note">«Хотели записаться»: нажали WhatsApp, Telegram или «Позвонить».</p>

<section class="card">
  <div class="card__h"><h2 class="h">${today ? 'Сегодня по часам' : 'Посетители по дням'}</h2></div>
  ${today ? bars(r.hours, hourLabels, { every: 3, label: 'По часам' }) : bars(r.byDay.map(d => d.visitors), r.byDay.map(d => shortDay(d.day)), { every: Math.ceil(r.byDay.length / 7), label: 'По дням' })}
</section>

<section class="card">
  <div class="card__h"><h2 class="h">Откуда пришли</h2></div>
  ${r.sources.length ? html`<ul class="st-list">${r.sources.map(s => share(s.name, s.n, r.sources.reduce((n, x) => n + x.n, 0)))}</ul>` : html`<p class="muted small">Пока нет данных.</p>`}
  <p class="muted small">Чтобы видеть, какой пост или сторис привели людей, сделайте для него <a href="#links">отдельную ссылку</a>.</p>
</section>

<section class="card">
  <div class="card__h"><h2 class="h">Страницы</h2></div>
  ${r.pages.length ? html`<div class="st-pages">${r.pages.map(p => html`<a class="st-page${p.page === o.page ? ' is-on' : ''}" href="/admin/stats?period=${o.period}&page=${p.page}#blocks"><b>${p.name}</b><span>${people(p.visitors)}</span><span>${secs(p.time)} в среднем</span><span>долистали ${p.depth}%</span></a>`)}</div>` : html`<p class="muted small">Пока нет данных.</p>`}
</section>

<section class="card" id="blocks">
  <div class="card__h"><h2 class="h">Где задерживаются</h2></div>
  <nav class="wk-halves st-pagesel">${SITE_PAGES.filter(p => r.blocks[p]).map(p => html`<a href="/admin/stats?period=${o.period}&page=${p}#blocks"${p === o.page ? raw(' aria-current="page"') : ''}>${PAGE_NAMES[p]}</a>`)}</nav>
  ${blockList.length ? html`<p class="muted small">${PAGE_NAMES[o.page]}: открыли ${pg.total} раз. Полоска показывает, сколько людей долистали до блока, справа сколько в среднем на нём пробыли.</p>
  <ul class="st-list st-blocks">${blockList.map(b => html`<li class="st-share"><div class="st-share__t"><span>${b.name}</span><b>${pct(b.reached, pg.total)}%<small>${b.timed ? secs(b.ms / b.timed / 1000) : '—'}</small></b></div><div class="st-share__bar"><i style="width:${pct(b.reached, pg.total)}%"></i></div></li>`)}</ul>` : html`<p class="muted small">Пока нет данных по этой странице.</p>`}
</section>

<section class="card">
  <div class="card__h"><h2 class="h">Кнопки</h2></div>
  ${r.buttons.filter(b => b.kind !== 'design').length ? html`<ul class="st-btns">${r.buttons.filter(b => b.kind !== 'design').slice(0, 25).map(b => html`<li class="st-btn st-btn--${b.kind}"><span class="st-btn__i" aria-hidden="true">${KIND_ICON[b.kind] || '•'}</span><span class="st-btn__t"><b>${b.label}</b><small>${Object.keys(b.pages).map(p => PAGE_NAMES[p] || 'класс').join(', ')}${Object.keys(b.blocks).length ? ' · ' + Object.keys(b.blocks).sort((x, y) => b.blocks[y] - b.blocks[x]).slice(0, 3).join(', ') : ''}</small></span><b class="st-btn__n">${b.n}</b></li>`)}</ul>` : html`<p class="muted small">Пока никто ничего не нажимал.</p>`}
</section>

${r.themes.length ? html`<section class="card">
  <div class="card__h"><h2 class="h">Тематики альбомов</h2></div>
  <p class="muted small">Сколько всего смотрели каждую тематику на странице «Дизайны» и сколько раз открывали её фото.</p>
  <ul class="st-btns">${r.themes.map(t => html`<li class="st-btn"><span class="st-btn__t"><b>${t.name}</b><small>${t.timed ? 'смотрели ' + secs(t.ms / 1000) + ' всего, ' + secs(t.ms / t.timed / 1000) + ' в среднем' : 'долистали ' + t.reached}</small></span><b class="st-btn__n" title="Открыли фото">${t.opens ? '🖼 ' + t.opens : ''}</b></li>`)}</ul>
</section>` : ''}

<section class="card">
  <div class="card__h"><h2 class="h">Когда заходят</h2></div>
  <p class="wk-lab">По часам</p>
  ${bars(r.hours, hourLabels, { every: 3, small: true, label: 'По часам' })}
  <p class="wk-lab">По дням недели</p>
  ${bars([1, 2, 3, 4, 5, 6, 0].map(i => r.week[i]), ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'], { small: true, label: 'По дням недели' })}
</section>

${r.classes.length ? html`<section class="card">
  <div class="card__h"><h2 class="h">Классы</h2></div>
  <p class="muted small">Сколько человек заходили на страницу голосования и в отбор фото.</p>
  <div class="pk-scroll"><table class="pk-table">
    <thead><tr><th>Класс</th><th>Голосование</th><th>Отбор</th></tr></thead>
    <tbody>${r.classes.filter(c => o.classNames[c.classId]).map(c => { const k = o.classNames[c.classId]; return html`<tr><td><a href="/admin/c/${k.id}">${k.title}</a><small class="muted"> ${k.school}</small></td><td>${c.vote || '—'}</td><td>${c.pick || '—'}</td></tr>`; })}</tbody>
  </table></div>
</section>` : ''}`}

<section class="card" id="links">
  <div class="card__h"><h2 class="h">Ссылки для постов и сторис</h2></div>
  <p class="muted small">Сделайте отдельную ссылку на каждый пост, сторис или рекламу. Здесь будет видно, сколько людей по ней пришло и сколько из них написали.</p>
  ${o.links.length ? html`<ul class="st-links">${o.links.map(l => {
    const url = o.base + (l.page === 'index.html' ? '/' : '/' + l.page) + '?s=' + l.slug;
    const s = r.links[l.slug] || { visitors: 0, contacts: 0 };
    return html`<li><div class="st-links__h"><b>${l.name}</b><span>${people(s.visitors)}${s.contacts ? html` · <b class="wk-ok">написали ${s.contacts}</b>` : ''}</span></div>
      <p class="link"><code>${url}</code></p>
      <div class="two"><button class="b b--sm" type="button" data-copy="${url}">Скопировать</button>
      <form method="post" action="/admin/stats/link/${l.slug}/delete" data-confirm="Удалить ссылку «${l.name}»? Сама ссылка продолжит открывать сайт, но считаться отдельно перестанет">${csrf(o.sess)}<button class="b b--sm b--danger b--wide" type="submit">Удалить</button></form></div></li>`;
  })}</ul>` : ''}
  <form class="form st-links__add" method="post" action="/admin/stats/link">
    ${csrf(o.sess)}
    <label class="field"><span>Для чего ссылка</span><input name="name" maxlength="60" placeholder="Например: сторис 16 октября" required autocomplete="off"></label>
    <label class="field"><span>Куда ведёт</span><select name="page">${SITE_PAGES.map(p => html`<option value="${p}">${PAGE_NAMES[p]}</option>`)}</select></label>
    <button class="b b--main" type="submit">Создать ссылку</button>
  </form>
  <p class="muted small">Цифры в списке за выбранный сверху период.</p>
</section>`;
  return layout({ title: 'Статистика', nav: 'stats', sess: o.sess, body: body, scripts: ['/admin/static/stats-admin.js'] });
}

module.exports = { statsPage, onlineList };
