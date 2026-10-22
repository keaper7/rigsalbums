'use strict';

// Админка: листающиеся альбомы на странице «Работы» — список, порядок, цвет края, загрузка нового

const { html, raw, plural } = require('../lib/util');

function booksBody(o) {
  const list = o.books;
  return html`<a class="back" href="/admin/site">← Сайт</a>
<div class="head"><div><h1 class="h1">Альбомы на сайте</h1><p class="muted">Листающиеся альбомы на странице «Работы». <a href="${o.base}/works.html#albums" target="_blank" rel="noopener">Открыть страницу</a></p></div></div>

<div class="card lay-up" data-lay data-mode="book" data-start="/admin/api/books/start" data-file="/admin/api/media/book" data-finish="/admin/api/books/finish" data-csrf="${o.csrf}" data-students="1">
  <div class="card__h"><h2 class="h">Добавить альбом</h2></div>
  <p class="muted small">Те же файлы, что для типографии: развороты <b>000-01</b>, <b>000-02</b>… и обложка <b>001-00</b>. Можно выбрать всю папку. Файлы ужимаются прямо здесь, в браузере, это может занять пару минут.</p>
  <label class="field"><span>Название (видно только вам и в подсказке на сайте)</span><input data-lay-title maxlength="60" placeholder="Например: 11 «А», школа 33, AMERICAN VIBE" autocomplete="off"></label>
  <div class="lay-pick">
    <label class="b b--main"><input type="file" accept=".jpg,.jpeg,image/jpeg" multiple data-lay-files><span>Выбрать файлы</span></label>
    <label class="b"><input type="file" webkitdirectory data-lay-files><span>Выбрать папку</span></label>
  </div>
  <div class="lay-sum" data-lay-sum hidden></div>
  <div class="upl__state" data-lay-state hidden><div class="upl__bar"><i></i></div><p></p></div>
</div>

<section class="card" id="list">
  <div class="card__h"><h2 class="h">На сайте сейчас</h2><span class="muted small">${list.length} ${plural(list.length, 'альбом', 'альбома', 'альбомов')}</span></div>
  ${list.length ? '' : html`<p class="muted">Пока ни одного: блок «Альбомы целиком» на странице «Работы» скрыт.</p>`}
  <ul class="bk-admin">${list.map((b, i) => html`<li id="b${b.id}">
    <img src="${b.base.charAt(0) === '/' ? b.base : '/' + b.base}front-sm.jpg" alt="" loading="lazy">
    <div class="bk-admin__main">
      <form class="form bk-admin__form" method="post" action="/admin/books/${b.id}/update">
        <input type="hidden" name="_csrf" value="${o.csrf}">
        <label class="field"><span>Название</span><input name="title" value="${b.title}" maxlength="60"></label>
        <div class="bk-admin__colors">
          <label class="field field--inline"><span>край</span><input type="color" name="board" value="${b.board}"></label>
          <label class="field field--inline"><span>корешок</span><input type="color" name="spine" value="${b.spine}"></label>
          <button class="b b--sm" type="submit">Сохранить</button>
        </div>
      </form>
      <p class="muted small">${b.spreads} ${plural(b.spreads, 'разворот', 'разворота', 'разворотов')}${b.base.indexOf('assets/') === 0 ? ' · с главной страницы' : ''}</p>
      <div class="bk-admin__btns">
        ${i > 0 ? html`<form method="post" action="/admin/books/${b.id}/up"><input type="hidden" name="_csrf" value="${o.csrf}"><button class="b b--sm" type="submit">↑ Выше</button></form>` : ''}
        ${i < list.length - 1 ? html`<form method="post" action="/admin/books/${b.id}/down"><input type="hidden" name="_csrf" value="${o.csrf}"><button class="b b--sm" type="submit">↓ Ниже</button></form>` : ''}
        <form method="post" action="/admin/books/${b.id}/delete" data-confirm="Убрать «${b.title}» со страницы «Работы»?${b.base.indexOf('assets/') === 0 ? ' Файлы альбома с главной останутся, на главной он будет как раньше.' : ' Загруженные файлы удалятся.'}"><input type="hidden" name="_csrf" value="${o.csrf}"><button class="b b--sm b--danger" type="submit">Убрать</button></form>
      </div>
    </div>
  </li>`)}</ul>
  <p class="muted small">Первый в списке открывается на странице сразу, остальные выбирают по обложке под альбомом.</p>
</section>`;
}

module.exports = { booksBody };
