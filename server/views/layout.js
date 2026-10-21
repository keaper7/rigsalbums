'use strict';

// Макет альбома для проверки: загрузка у Артура и дизайнера, альбом ученика по ссылке отбора

const { html, raw, plural, fmtWhen } = require('../lib/util');
const { pageOf, pageLabel } = require('../lib/layout');

const pad = (n, w) => String(n).padStart(w, '0');

// Сколько файлов и чьи обложки загружены, ссылка для учеников
function stateCard(o) {
  const l = o.lay;
  const n = o.list.length;
  const withCover = l ? o.list.filter(s => l.covers.indexOf(s.num) !== -1).length : 0;
  if (!l || !l.ver) return html`<div class="card"><h2 class="h">Макет ещё не загружен</h2><p class="muted">Выберите ниже файлы макета: развороты <b>000-01</b>, <b>000-02</b>… и обложки учеников <b>001-00</b>, <b>002-00</b>…</p></div>`;
  return html`<div class="card lay-now">
  <div class="card__h"><h2 class="h">Загружен макет</h2><span class="chip chip--done">${l.spreads} ${plural(l.spreads, 'разворот', 'разворота', 'разворотов')}</span></div>
  <p class="muted">Обложки: ${withCover} из ${n}${o.teacherCover ? ' и кл. руку' : ''} · ${fmtWhen(l.uploaded_at)}${l.uploaded_by ? ' · ' + l.uploaded_by : ''}</p>
  ${o.link ? html`<div class="lay-link"><input value="${o.link}" readonly aria-label="Ссылка для учеников"><button class="b b--main b--sm" type="button" data-copy="${o.link}">Скопировать ссылку</button></div>
  <p class="muted small">Это та же ссылка, что на отбор фото, с /album на конце. Ученики входят своим кодом из отбора.</p>` : ''}
</div>`;
}

// Загрузка: файлы режет и ужимает браузер, сюда приходят готовые страницы
function uploadCard(o) {
  return html`<div class="card lay-up" data-lay data-start="${o.api.start}" data-file="${o.api.file}" data-finish="${o.api.finish}"${o.csrf ? html` data-csrf="${o.csrf}"` : ''} data-students="${o.list.length}">
  <div class="card__h"><h2 class="h">${o.lay && o.lay.ver ? 'Загрузить новый макет' : 'Загрузить макет'}</h2></div>
  <p class="muted small">Можно выбрать сразу всю папку или все файлы. Развороты <b>000-NN</b>, обложки <b>PPP-00</b>, где PPP — номер ученика по списку ниже. Файлы ужимаются прямо здесь, в браузере, это может занять пару минут. Пока новый макет не загрузится целиком, ученики видят прежний.</p>
  <div class="lay-pick">
    <label class="b b--main"><input type="file" accept=".jpg,.jpeg,image/jpeg" multiple data-lay-files><span>Выбрать файлы</span></label>
    <label class="b"><input type="file" webkitdirectory data-lay-files><span>Выбрать папку</span></label>
  </div>
  <div class="lay-sum" data-lay-sum hidden></div>
  <div class="upl__state" data-lay-state hidden><div class="upl__bar"><i></i></div><p></p></div>
</div>`;
}

function studentsCard(o) {
  const l = o.lay;
  if (!o.list.length) return '';
  return html`<div class="card" id="students">
  <div class="card__h"><h2 class="h">Ученики и их страницы</h2><span class="muted small">${o.checked} из ${o.list.length} проверили</span></div>
  <form class="form lay-first" method="post" action="${o.api.first}">
    ${o.csrf ? html`<input type="hidden" name="_csrf" value="${o.csrf}">` : ''}
    <span>Личные страницы начинаются:</span>
    <label class="field field--inline"><span>разворот</span><input name="spread" type="number" min="1" max="80" value="${Math.ceil((l ? l.first_page : 3) / 2)}"></label>
    <label class="field field--inline"><span>страница</span><select name="side"><option value="l"${!l || l.first_page % 2 ? raw(' selected') : ''}>левая</option><option value="r"${l && !(l.first_page % 2) ? raw(' selected') : ''}>правая</option></select></label>
    <button class="b b--sm" type="submit">Сохранить</button>
  </form>
  ${notCheckedCopy(o)}
  <p class="muted small">Номер — как у дизайнера: по алфавиту. Обложка ученика — файл с его номером, например 003-00. Если порядок у дизайнера другой, проверьте, как написаны фамилии в отборе.</p>
  <ol class="lay-list">${o.list.map(s => {
    const pg = l && l.spreads ? pageOf(l, s.num) : null;
    const cover = l && l.covers.indexOf(s.num) !== -1;
    const fixes = o.fixCount.get(s.id) || 0;
    return html`<li>
      <span class="lay-list__n">${pad(s.num, 3)}</span>
      <span class="lay-list__name"><b>${s.name}</b><small>${l && l.ver ? html`${cover ? 'обложка ✓' : html`<span class="wk-warn">нет обложки ${pad(s.num, 3)}-00</span>`} · ${pg ? pageLabel(pg.spread, pg.side) : html`<span class="wk-warn">личной страницы нет в макете</span>`}` : 'обложка ' + pad(s.num, 3) + '-00'}</small></span>
      <span class="lay-list__st">${fixes ? html`<span class="chip chip--warn">правок: ${fixes}</span>` : ''}${o.oks.get(s.id) ? html`<span class="chip chip--done">всё верно</span>` : ''}${o.preview && l && l.ver ? html`<a class="link" href="${o.preview(s)}" target="_blank" rel="noopener">открыть</a>` : ''}</span>
    </li>`;
  })}${teacherRow(o)}</ol>
</div>`;
}

// Кто ещё не проверил — готовым сообщением для чата класса (только у Артура)
function notCheckedCopy(o) {
  if (!o.csrf || !o.link || !o.lay || !o.lay.ver) return '';
  const left = o.list.filter(s => !o.oks.get(s.id) && !o.fixCount.get(s.id));
  if (!left.length) return html`<p class="lay-all">Все ученики посмотрели альбом${o.fixCount.size ? ', у кого-то есть правки' : ' и отметили, что всё верно'}.</p>`;
  const text = 'Ещё не проверили альбом (' + left.length + '):\n' + left.map(s => s.name).join('\n') + '\n\nСсылка: ' + o.link + '\nВход тем же кодом, что на выборе фото.';
  return html`<div class="lay-left"><span>Не отметили «всё верно» и не писали правок: <b>${left.length}</b></span><button class="b b--sm" type="button" data-copy="${text}">Скопировать напоминание</button></div>`;
}

// Правки из проверки, которые ещё открыты: после новой загрузки их можно закрыть разом
function openFixesCard(o) {
  const n = o.openLayoutFixes || 0;
  if (!n || !o.lay || !o.lay.ver || !o.api.fixesDone) return '';
  return html`<form class="card lay-fixes" method="post" action="${o.api.fixesDone}" data-confirm="Отметить исправленными все правки из проверки (${n})? Ученики увидят у своих правок «исправлено».">
  ${o.csrf ? html`<input type="hidden" name="_csrf" value="${o.csrf}">` : ''}
  <div><h2 class="h">Правки из проверки: ${n}</h2><p class="muted small">Если в загруженном макете они уже исправлены, отметьте все разом, чтобы не закрывать по одной.</p></div>
  <button class="b b--main b--sm" type="submit">Всё исправлено</button>
</form>`;
}

// Классный руководитель: номер после всех учеников, только обложка, своя ссылка без кода
function teacherRow(o) {
  const l = o.lay, k = o.teacher;
  if (!k) return '';
  const num = o.list.length + 1;
  return html`<li class="lay-list__kr">
      <span class="lay-list__n">${pad(num, 3)}</span>
      <span class="lay-list__name"><b>Классный руководитель${k.name ? ' · ' + k.name : ''}</b><small>${l && l.ver ? (o.teacherCover ? 'обложка ✓' : html`<span class="wk-warn">нет обложки ${pad(num, 3)}-00</span>`) : 'обложка ' + pad(num, 3) + '-00'}${o.teacherLink ? html` · <button class="link" type="button" data-copy="${o.teacherLink}">ссылка для проверки</button>` : ''}</small></span>
      <span class="lay-list__st">${k.fixes ? html`<span class="chip chip--warn">правок: ${k.fixes}</span>` : ''}${k.ok ? html`<span class="chip chip--done">всё верно</span>` : ''}${o.preview && l && l.ver ? html`<a class="link" href="${o.preview('kr')}" target="_blank" rel="noopener">открыть</a>` : ''}</span>
    </li>`;
}

function layoutBody(o) {
  return html`<a class="back" href="${o.back}">← ${o.backLabel}</a>
<div class="head head--class"><div><h1 class="h1">Макет для проверки</h1><p class="muted">${o.cls.title} · ${o.cls.school}</p></div></div>
${o.noPick ? html`<div class="card"><h2 class="h">Сначала нужен отбор фото</h2><p class="muted">Ученики и их коды берутся из отбора. ${o.pickLink ? html`<a href="${o.pickLink}">Создать отбор</a>` : 'Попросите Артура создать отбор для этого класса.'}</p></div>` : html`${stateCard(o)}
${openFixesCard(o)}
${uploadCard(o)}
${studentsCard(o)}`}`;
}

// ---------- страница ученика ----------

function albumShell(o, body) {
  return '<!doctype html>\n' + html`<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Проверка альбома · ${o.cls.title} · RIGSARTHUR</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F4EFE7">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="stylesheet" href="/admin/static/fonts.css">
<link rel="stylesheet" href="/admin/static/pick.css">
<link rel="stylesheet" href="/admin/static/book.css">
<link rel="stylesheet" href="/admin/static/album.css">
</head>
<body class="al">
<header class="pt">
  <div class="pt__in">
    <a class="pt__logo" href="/"><b>RIGSARTHUR</b><span>проверка альбома</span></a>
    ${o.me ? html`<span class="pt__who">${o.me.name}${o.admin || o.teacher ? '' : html` · <button type="button" class="link" data-al-leave>не я</button>`}</span>` : ''}
  </div>
</header>
<main class="pm al__main">
  <p class="eyebrow">Выпускной альбом ${o.cls.year}</p>
  <h1>${o.cls.school}<small>${o.cls.title}</small></h1>
${body}
</main>
<p class="toast" role="status" aria-live="polite" hidden></p>
<script src="/admin/static/book.js"></script>
<script src="/admin/static/album.js"></script>
</body>
</html>
`.s;
}

// Вход: имя из списка и код, как в отборе
function albumLogin(o) {
  return albumShell(o, html`<section class="al-in" data-al-login data-me="${o.api.me}">
  <p class="al-lead">Здесь твой альбом целиком, как он будет напечатан. Найди свою страницу и обложку, проверь имя, фото и цитату. Если что-то не так, отметь, и дизайнер поправит.</p>
  <label class="field"><span>Кто ты</span><select data-al-student><option value="">Выбери себя в списке</option>${o.students.map(s => html`<option value="${s.id}" data-locked="${s.locked ? 1 : 0}">${s.name}</option>`)}</select></label>
  <label class="field" data-al-pinbox hidden><span data-al-pinlabel>Код из отбора фото</span><input type="tel" inputmode="numeric" maxlength="4" autocomplete="off" data-al-pin placeholder="4 цифры"></label>
  <p class="al-err" data-al-err hidden></p>
  <button class="btn btn--main" type="button" data-al-go disabled>Открыть альбом</button>
</section>`);
}

function albumNotReady(o) {
  return albumShell(o, html`<section class="al-in"><p class="al-lead">Макет альбома ещё готовится. Когда дизайнер его загрузит, он откроется по этой же ссылке.</p></section>`);
}

function albumPage(o) {
  const l = o.lay;
  // классному руководителю — на «вы», у него только обложка
  const t = !!o.teacher;
  const pg = o.num && !t ? pageOf(l, o.num) : null;
  const hasCover = o.num && l.covers.indexOf(o.num) !== -1;
  // обложки нет — показываем первую загруженную
  const cn = hasCover ? o.num : l.covers[0];
  const mine = pg ? 's' + pad(pg.spread, 2) + '-' + pg.side : '';
  const open = o.fixes.filter(f => !f.done_at), done = o.fixes.filter(f => f.done_at);
  return albumShell(o, html`<p class="al-lead">${t ? 'Это альбом класса целиком, как он будет напечатан. Проверьте свою обложку: имя и фото. Остальные страницы тоже можно полистать. Нажмите «Крупно», чтобы рассмотреть страницу ближе.' : 'Листай альбом и проверь свою страницу и обложку: имя, фото, цитату. Нажми «Крупно», чтобы рассмотреть страницу ближе.'}</p>
<div class="bk al-bk" data-book data-no-intro data-base="${o.api.files}" data-spreads="${l.spreads}" data-front="${cn ? 'c' + pad(cn, 3) : 's01-r'}" data-no-back data-big="900"${mine ? html` data-mine="${mine}"` : ''} tabindex="0" aria-label="Альбом: листайте стрелками влево и вправо" style="--bk-board: #3B2A22; --bk-spine: #2A1D17">
  <div class="bk__stage"><div class="bk__book"></div></div>
  <div class="bk__bar">
    <button class="bk__btn" type="button" data-bk-prev aria-label="Назад">‹</button>
    <span class="bk__label" data-bk-label aria-live="polite">Обложка</span>
    <button class="bk__btn" type="button" data-bk-next aria-label="Вперёд">›</button>
    <button class="bk__zoom" type="button" data-bk-zoom>Крупно</button>
  </div>
</div>
<div class="al-go">
  ${pg ? html`<button class="btn" type="button" data-al-goto="${pg.spread}" data-al-side="${pg.side}">Моя страница</button>` : ''}
  <button class="btn" type="button" data-al-goto="0" data-al-side="l">Моя обложка</button>
</div>
<p class="al-full" data-al-full hidden>В полном качестве: <a href="#" target="_blank" rel="noopener" data-al-full-l>левая</a><a href="#" target="_blank" rel="noopener" data-al-full-r>правая</a></p>
${!hasCover ? html`<p class="al-note">${t ? 'Вашей обложки в макете пока нет, сейчас показана обложка ученика. Напишите об этом в правке.' : 'Твоей обложки в макете пока нет, сейчас показана обложка одноклассника. Напиши об этом в правке.'}</p>` : ''}
${o.view ? html`<p class="al-note">${t ? 'Так альбом видит классный руководитель. Правки и «всё верно» отмечаются по его ссылке.' : html`Так альбом видит ${o.me ? o.me.name : 'ученик'}. Правки и «всё верно» отмечает сам ученик по своей ссылке.`}</p>` : html`<section class="al-check" data-al-check data-fix="${o.api.fix}" data-ok="${o.api.ok}">
  <h2>Всё верно?</h2>
  ${o.ok ? html`<p class="al-okd">${t ? 'Отмечено, что всё верно. Если заметите ошибку, всё равно напишите о ней.' : 'Отмечено, что всё верно. Если заметишь ошибку, всё равно напиши о ней.'}</p>` : ''}
  <div class="al-btns">
    <button class="btn" type="button" data-al-fixopen>Есть ошибка</button>
    ${o.ok ? html`<button class="btn" type="button" data-al-ok="0">Отменить «всё верно»</button>` : html`<button class="btn btn--main" type="button" data-al-ok="1">Всё верно, ошибок нет</button>`}
  </div>
  <form class="al-fix" data-al-fix hidden>
    <label class="field"><span>Где ошибка</span><select data-al-where>
      <option value="cover">Обложка</option>
      ${Array.from({ length: l.spreads }, (_, i) => i + 1).map(k => html`<option value="${k}-l">${pageLabel(k, 'l')}</option><option value="${k}-r">${pageLabel(k, 'r')}</option>`)}
    </select></label>
    <label class="field"><span>Что исправить</span><textarea rows="3" maxlength="1500" data-al-text placeholder="Например: в цитате опечатка, должно быть «навсегда»"></textarea></label>
    <p class="al-err" data-al-fixerr hidden></p>
    <div class="al-btns"><button class="btn btn--main" type="submit">Отправить дизайнеру</button><button class="btn" type="button" data-al-fixclose>Отмена</button></div>
  </form>
  ${o.fixes.length ? html`<div class="al-fixes"><h3>${t ? 'Ваши правки' : 'Твои правки'}</h3><ul>${open.concat(done).map(f => html`<li class="${f.done_at ? 'is-done' : ''}"><span>${f.text}</span><small>${f.done_at ? 'исправлено' : 'ждёт дизайнера'}</small></li>`)}</ul></div>` : ''}
</section>`}`);
}

module.exports = { layoutBody, albumLogin, albumNotReady, albumPage };
