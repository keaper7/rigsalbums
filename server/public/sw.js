// Помощник админки в телефоне Артура (service worker, /admin/sw.js).
// 1. Файлы админки с версией в адресе и шрифты берёт из памяти телефона, без запроса к сайту.
// 2. Каждую открытую страницу админки запоминает. Если сайт не отвечает (нет связи, мобильный интернет
//    режет сайт), через несколько секунд показывает последнюю сохранённую версию с плашкой «Нет связи»,
//    а не белый экран. Ничего не отправляет и не меняет: сохранённая страница только для просмотра.
// Если с помощником что-то пойдёт не так, его можно снять: заменить этот файл на
// self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', () => self.registration.unregister());
'use strict';

var STATIC = 'rigs-static-v1';
var PAGES = 'rigs-pages-v1';
var WAIT = 7000;   // сколько ждать сайт, прежде чем показать сохранённую страницу
var GIVE_UP = 15000; // сохранённой нет: сколько всего ждать, прежде чем объяснить, что связи нет
var KEEP = 60;     // сколько страниц помнить

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('rigs-') === 0 && k !== STATIC && k !== PAGES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Вышли из админки — сохранённое стираем
self.addEventListener('message', function (e) {
  if (e.data === 'clear') e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method !== 'GET') {
    // форма отправляется без связи — вместо белого экрана объясняем, что не ушло
    if (req.mode === 'navigate') e.respondWith(fetch(req).catch(function () { return offline(true); }));
    return;
  }
  if ((url.pathname.indexOf('/admin/static/') === 0 && url.searchParams.has('v')) || url.pathname.indexOf('/assets/fonts/') === 0) {
    e.respondWith(fromStatic(req));
    return;
  }
  if (req.mode !== 'navigate' || url.pathname.indexOf('/admin') !== 0 || url.pathname === '/admin/login' || url.pathname === '/admin/sw.js') return;
  e.respondWith(page(req, e));
});

function fromStatic(req) {
  return caches.open(STATIC).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res.ok) c.put(req, res.clone());
        return res;
      });
    });
  });
}

// Ключ страницы: без ?m= (это одноразовое «Сохранено» после действия)
function key(u) {
  var url = new URL(u);
  url.searchParams.delete('m');
  url.hash = '';
  return url.href;
}

function good(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected && /text\/html/.test(res.headers.get('content-type') || '');
}

function save(req, res) {
  return res.text().then(function (body) {
    return caches.open(PAGES).then(function (c) {
      return c.put(key(req.url), new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Saved-At': String(Date.now()) } }))
        .then(function () { return c.keys(); })
        .then(function (keys) { return Promise.all(keys.slice(0, Math.max(0, keys.length - KEEP)).map(function (k) { return c.delete(k); })); });
    });
  });
}

function page(req, e) {
  var net = fetch(req);
  e.waitUntil(net.then(function (res) { if (good(res)) return save(req, res.clone()); }).catch(function () {}));
  var late = new Promise(function (ok) { setTimeout(function () { ok('late'); }, WAIT); });
  return Promise.race([net.catch(function () { return 'fail'; }), late]).then(function (r) {
    if (r !== 'late' && r !== 'fail') return r;
    return saved(req).then(function (s) {
      if (s) return s;
      if (r === 'fail') return offline(false);
      // сохранённой нет: вдруг сайт просто медленный — ждём ещё, но не бесконечно
      var more = new Promise(function (ok) { setTimeout(function () { ok('late'); }, GIVE_UP - WAIT); });
      return Promise.race([net.catch(function () { return 'fail'; }), more]).then(function (x) { return x === 'late' || x === 'fail' ? offline(false) : x; });
    });
  });
}

var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function when(ms) {
  var d = new Date(ms), now = new Date();
  var t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  return d.toDateString() === now.toDateString() ? 'сегодня в ' + t : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' в ' + t;
}

var BAR = 'position:sticky;top:0;z-index:9999;margin:0;padding:10px 16px;background:#9A5B12;color:#fff;font:600 14px/1.35 -apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center';

function saved(req) {
  return caches.open(PAGES).then(function (c) { return c.match(key(req.url)); }).then(function (hit) {
    if (!hit) return null;
    var at = +hit.headers.get('X-Saved-At') || 0;
    return hit.text().then(function (body) {
      var bar = '<p style="' + BAR + '">Нет связи с сайтом. Это сохранённая страница' + (at ? ' от ' + when(at) : '') +
        ', изменения сейчас не сохранятся. <a href="' + esc(req.url) + '" style="color:#fff;text-decoration:underline">Обновить</a></p>';
      return new Response(body.replace(/<body([^>]*)>/i, function (m) { return m + bar; }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    });
  });
}

function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// Нет ни связи, ни сохранённой страницы: простая страница с объяснением и списком того, что сохранено
function offline(post) {
  return caches.open(PAGES).then(function (c) {
    return c.keys().then(function (keys) {
      return Promise.all(keys.slice(-12).reverse().map(function (k) {
        return c.match(k).then(function (r) { return r.text(); }).then(function (t) {
          var m = /<title>([^<]*)<\/title>/i.exec(t);
          return { url: k.url, title: m ? m[1].replace(/ · Админка RIGSARTHUR$/, '') : k.url };
        });
      }));
    });
  }).catch(function () { return []; }).then(function (list) {
    var html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Нет связи</title></head>' +
      '<body style="margin:0;background:#F4EFE7;color:#3A2321;font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
      '<main style="max-width:520px;margin:0 auto;padding:40px 20px">' +
      '<h1 style="font-size:24px;margin:0 0 10px">Нет связи с сайтом</h1>' +
      '<p style="margin:0 0 18px;color:#7A6660">' + (post ? 'Изменение не отправилось. Вернитесь назад и попробуйте ещё раз, когда появится связь.' : 'Сайт сейчас не отвечает: нет интернета или мобильный интернет его не пропускает. Попробуйте ещё раз чуть позже или через Wi-Fi.') + '</p>' +
      '<p style="margin:0 0 26px"><a href="" style="display:inline-block;padding:12px 20px;border-radius:99px;background:#8C2B2B;color:#fff;text-decoration:none;font-weight:700">Попробовать снова</a></p>' +
      (list.length ? '<h2 style="font-size:16px;margin:0 0 8px">Сохранённые страницы</h2><ul style="margin:0;padding:0 0 0 18px">' +
        list.map(function (x) { return '<li style="margin:6px 0"><a href="' + esc(x.url) + '" style="color:#8C2B2B">' + esc(x.title) + '</a></li>'; }).join('') + '</ul>' : '') +
      '</main></body></html>';
    return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
}
