// Статистика: «сейчас на сайте» обновляется само
(function () {
  'use strict';
  var box = document.querySelector('[data-live]');
  if (!box) return;
  var NAMES = { 'index.html': 'Главная', 'works.html': 'Работы', 'albums.html': 'Альбомы и цены', 'designs.html': 'Дизайны', 'studio.html': 'Студия', 'contacts.html': 'Контакты', 'prep.html': 'Подготовка' };
  function word(n) { var a = n % 100, b = n % 10; return a > 10 && a < 20 ? 'человек' : b > 1 && b < 5 ? 'человека' : 'человек'; }
  function li(title, sub) {
    var l = document.createElement('li');
    var b = document.createElement('b'); b.textContent = title; l.appendChild(b);
    if (sub) { var s = document.createElement('small'); s.textContent = sub; l.appendChild(s); }
    return l;
  }
  function paint(j) {
    box.querySelector('[data-live-total]').textContent = j.total;
    box.querySelector('[data-live-total]').nextElementSibling.textContent = word(j.total) + ' сейчас';
    var list = box.querySelector('[data-live-list]');
    list.textContent = '';
    if (!j.total) { var e = li('Сейчас никого нет'); e.className = 'muted'; list.appendChild(e); return; }
    if (j.site) list.appendChild(li('На сайте: ' + j.site, Object.keys(j.pages).map(function (p) { return (NAMES[p] || p) + ' ' + j.pages[p]; }).join(', ')));
    j.classes.forEach(function (c) { list.appendChild(li((c.kind === 'class' ? 'Голосуют: ' : 'Выбирают фото: ') + c.n, c.name)); });
  }
  setInterval(function () {
    if (document.hidden) return;
    fetch(box.getAttribute('data-live'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) paint(j); }).catch(function () {});
  }, 10000);
})();
