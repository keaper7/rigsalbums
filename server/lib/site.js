'use strict';

// Содержимое сайта, которое Артур меняет из админки.
//
// Страницы остаются обычными HTML-файлами (их же отдаёт GitHub Pages).
// Места, которые можно менять, отмечены комментариями:
//   <!--@media arthur lg--><img src="..."><!--@end-->   фото или видео
//   <!--@gallery works-->...плитки...<!--@end-->        список фото
//   <!--@text price.main-->4 500<!--@end-->             текст
//   <!--@count works-->65 фото<!--@end-->               число фото в галерее
//   <!--@catalog themes-->...<!--@end-->                тематики из раздела «Варианты»
//   <div data-show="price.group">                        блок, который можно скрыть
// Внутри комментариев лежит вариант по умолчанию. Сервер подставляет
// вместо него то, что сохранено в админке.

const fs = require('fs');
const path = require('path');
const { esc, plural } = require('./util');

const PAGES = ['index.html', 'works.html', 'albums.html', 'designs.html', 'studio.html', 'contacts.html'];

const THEMES = [
  ['classic', 'CLASSIC'], ['siren', 'OFFICE SIREN'], ['american', 'AMERICAN VIBE'], ['canon', 'CANON VIBE'], ['white', 'WHITE'],
  ['grey', 'GREY'], ['aesthetic', 'AESTHETIC'], ['money', 'NEW MONEY'], ['neon', 'NEON']
];

// shape: как показать превью в админке (cover, circle, wide, square, tall)
const SLOTS = {
  'home.video': { type: 'video', label: 'Видео «Как это выглядит вживую»', where: 'Главная, сразу после первого экрана', hint: 'Вертикальное 9:16, от 20 секунд до минуты. На сайте играет без звука.' },
  'arthur': { type: 'image', label: 'Фото Артура', where: 'Главная (в конце) и «Контакты»', shape: 'circle', hint: 'Лицо по центру: фото обрежется в круг.' },
  'album': { type: 'image', label: 'Фото альбома', where: '«Альбомы и цены», самый верх', shape: 'wide', hint: 'Лучше на белом фоне: белый растворится в странице.' },
  'studio.main': { type: 'image', label: 'Студия общим планом', where: '«Студия», самый верх', shape: 'wide', hint: 'Горизонтальное, лучше с ребятами в кадре.' },
  'studio.rest': { type: 'image', label: 'Зона отдыха', where: '«Студия», блок «Что есть в студии»', shape: 'square' },
  'studio.extra': { type: 'image', label: 'Ещё одно фото студии', where: '«Студия», блок «Что есть в студии»', shape: 'square' }
};
THEMES.forEach(t => {
  SLOTS['cover.' + t[0]] = { type: 'image', label: t[1], where: 'Главная: колода обложек и полка дизайнов', shape: 'cover', group: 'covers' };
});

const GALLERIES = {
  'home.works': { label: 'Работы на главной', where: 'Главная, блок «Вот так я снимаю выпускников»', hint: 'Лучше 8–12 фото. Горизонтальные фото займут всю ширину.', lb: 'home', max: 16 },
  'works': { label: 'Все работы', where: 'Страница «Работы»', hint: 'Новые фото встают в начало.', lb: 'shoots', max: 300 }
};

const TEXTS = {
  'price.tag': { label: 'Надпись над ценой', max: 40 },
  'price.main': { label: 'Цена, ₽', max: 12, nbsp: true },
  'price.note': { label: 'Под ценой', max: 140 },
  'price.group.title': { label: 'Заголовок', max: 140 },
  'price.group.two': { label: '2 класса', max: 20 },
  'price.group.three': { label: '3 класса и больше', max: 20 }
};

const TOGGLES = {
  'price.group': { label: 'Показывать цены для параллели' }
};

const MARK = /<!--@(media|gallery|text|count|catalog) ([a-z0-9.]+)(?: (sm|lg))?-->([\s\S]*?)<!--@end-->/g;
const SHOW = /<([a-z]+)([^>]*?) data-show="([a-z0-9.]+)"([^>]*)>/g;

function decode(s) {
  return String(s).replace(/&nbsp;/g, ' ').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

// Заменить или добавить атрибут в теге <img ...>
function setAttr(tag, name, value) {
  const re = new RegExp('\\s' + name + '="[^"]*"');
  const attr = ' ' + name + '="' + esc(value) + '"';
  if (re.test(tag)) return tag.replace(re, attr);
  return tag.replace(/\s*\/?>$/, attr + '>');
}

function smWidth(v) {
  const k = Math.min(1, 1000 / Math.max(v.w || 1, v.h || 1));
  return Math.round((v.w || 1000) * k);
}

function galleryItems(inner) {
  const out = [];
  const re = /<a class="pic( pic--wide)?" href="([^"]+)"[^>]*>\s*<img src="([^"]+)"/g;
  let m;
  while ((m = re.exec(inner))) out.push({ sm: m[3], lg: m[2], wide: !!m[1] });
  return out;
}

function isWide(it) {
  if (typeof it.wide === 'boolean' && !it.w) return it.wide;
  return (it.w || 1) / (it.h || 1) >= 1.2;
}

function galleryHtml(key, items) {
  const lb = GALLERIES[key].lb;
  return '\n' + items.map(it => '      <a class="pic' + (isWide(it) ? ' pic--wide' : '') + '" href="' + esc(it.lg) + '" data-lb="' + lb +
    '"><img src="' + esc(it.sm) + '" alt="Фотосессия RIGSARTHUR" loading="lazy" decoding="async"></a>').join('\n') + '\n    ';
}

// ---------- тематики, одежда и цвета из раздела «Варианты» ----------

function visible(list) { return (list || []).filter(o => !o.hidden); }

function themeCards(themes) {
  return visible(themes).map(o => {
    const strip = (o.photos || []).map(p => {
      const cap = p.cap || '';
      return '<a class="ph-i" href="' + esc(p.src) + '-lg.jpg" data-lb="' + esc(o.key) + '" data-cap="' + esc(o.name + (cap ? ' · ' + cap : '')) +
        '" style="--ar:' + (+p.ar || 1) + '"><img src="' + esc(p.src) + '-sm.jpg" alt="' + esc(o.name + (cap ? ': ' + cap : '')) +
        '" loading="lazy" decoding="async">' + (cap ? '<span>' + esc(cap) + '</span>' : '') + '</a>';
    }).join('');
    const about = (o.about || []).map(t => '<p>' + esc(t) + '</p>').join('');
    return '\n  <article class="tcard t--' + esc(o.key) + ' rv" id="' + esc(o.key) + '">\n' +
      '    <div class="tcard__head">\n' +
      (o.tag ? '      <span class="tcard__tag">' + esc(o.tag) + '</span>\n' : '') +
      '      <h3 class="tcard__title f-' + esc(o.key) + '">' + esc(o.name) + '</h3>\n' +
      (o.lead ? '      <p class="tcard__lead">' + esc(o.lead) + '</p>\n' : '') +
      '    </div>\n' +
      (strip ? '    <div class="strip" data-carousel data-auto="2800">' + strip + '</div>\n' : '') +
      (about ? '    <details class="tcard__more"><summary>Подробнее о стиле</summary>' + about + '</details>\n' : '') +
      (o.loc ? '    <p class="tcard__loc">Групповые: ' + esc(o.loc) + '</p>\n' : '') +
      '  </article>';
  }).join('') + '\n';
}

function catalogPart(name, cat) {
  if (name === 'jump') {
    return visible(cat.theme).map(o => '<a href="#' + esc(o.key) + '" class="f-' + esc(o.key) + '">' + esc(o.name) + '</a>').join('');
  }
  if (name === 'themes') return themeCards(cat.theme);
  if (name === 'themecount') {
    const n = visible(cat.theme).length;
    return n + ' ' + plural(n, 'тематика', 'тематики', 'тематик') + ' на выбор';
  }
  if (name === 'wear') return visible(cat.wear).map(o => '<span>' + esc(o.name) + '</span>').join('');
  if (name === 'colors') {
    const dot = c => '<i style="width:14px;height:14px;border-radius:50%;background:' + esc(c) + ';box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)"></i>';
    return visible(cat.color).map(o => '<span style="display:inline-flex;align-items:center;gap:8px">' + (o.colors || []).map(dot).join('') + esc(o.name) + '</span>').join('');
  }
  return null;
}

class Site {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    // Номер правки начинается со времени запуска: после перезапуска старые ETag не совпадут
    this.rev = Date.now();
    this.files = new Map();
    this.pages = new Map();
    this.defs = null;
  }

  // Что-то поменяли: сбрасываем готовые страницы
  touch() { this.rev++; }

  read(file) {
    const full = path.join(this.root, file);
    const st = fs.statSync(full);
    const hit = this.files.get(file);
    if (hit && hit.mtime === st.mtimeMs) return hit;
    const entry = { mtime: st.mtimeMs, text: fs.readFileSync(full, 'utf8') };
    this.files.set(file, entry);
    this.defs = null;
    return entry;
  }

  // Значения по умолчанию прямо из HTML: первое место, где встречается ключ
  defaults() {
    const stamp = PAGES.map(f => { try { return this.read(f).mtime; } catch (e) { return 0; } }).join(',');
    if (this.defs && this.defs.stamp === stamp) return this.defs;
    const d = { stamp: stamp, media: {}, gallery: {}, text: {} };
    PAGES.forEach(file => {
      let text;
      try { text = this.read(file).text; } catch (e) { return; }
      let m;
      MARK.lastIndex = 0;
      while ((m = MARK.exec(text))) {
        const type = m[1], key = m[2], inner = m[4];
        if (type === 'media' && !(key in d.media)) {
          const src = /<img\b[^>]*\ssrc="([^"]+)"/.exec(inner);
          d.media[key] = src ? src[1] : null;
        } else if (type === 'gallery' && !(key in d.gallery)) d.gallery[key] = galleryItems(inner);
        else if (type === 'text' && !(key in d.text)) d.text[key] = decode(inner);
      }
    });
    this.defs = d;
    return d;
  }

  values() { return this.store.allSite(); }

  gallery(key) {
    const v = this.store.getSite(key);
    if (Array.isArray(v)) return { items: v, custom: true };
    return { items: (this.defaults().gallery[key] || []).slice(), custom: false };
  }

  text(key) {
    const v = this.store.getSite(key);
    return typeof v === 'string' ? v : (this.defaults().text[key] || '');
  }

  shown(key) { return this.store.getSite(key) !== false; }

  renderMedia(key, variant, inner, v) {
    const def = SLOTS[key];
    if (!def || !v) return inner;
    if (def.type === 'video') {
      if (!v.video) return inner;
      let out = inner;
      if (v.poster) out = out.replace(/(<img\b[^>]*?\ssrc=")[^"]*(")/, '$1' + esc(v.poster) + '$2');
      return out.replace(/\sdata-src="[^"]*"/, ' data-src="' + esc(v.video) + '"' + (v.poster ? ' poster="' + esc(v.poster) + '"' : ''));
    }
    const src = variant === 'lg' ? v.lg : v.sm;
    const m = /<img\b[^>]*>/.exec(inner);
    if (!m) {
      return '<img class="slot-img" src="' + esc(src) + '" alt="' + esc(def.label) + '" width="' + v.w + '" height="' + v.h + '" loading="lazy" decoding="async">';
    }
    let tag = setAttr(m[0], 'src', src);
    if (/\ssrcset="/.test(tag)) tag = setAttr(tag, 'srcset', v.sm + ' ' + smWidth(v) + 'w, ' + v.lg + ' ' + v.w + 'w');
    if (/\swidth="/.test(tag)) tag = setAttr(setAttr(tag, 'width', String(v.w)), 'height', String(v.h));
    return inner.slice(0, m.index) + tag + inner.slice(m.index + m[0].length);
  }

  // Страница сайта с подставленными правками. Готовый результат кэшируется
  // до следующего изменения в админке или правки файла
  render(file, catalog) {
    const src = this.read(file);
    const hit = this.pages.get(file);
    if (hit && hit.mtime === src.mtime && hit.rev === this.rev) return hit;
    const vals = this.values();
    let out = src.text.replace(MARK, (all, type, key, variant, inner) => {
      if (type === 'media') return this.renderMedia(key, variant, inner, vals[key]);
      if (type === 'gallery') {
        if (!GALLERIES[key] || !Array.isArray(vals[key])) return inner;
        return galleryHtml(key, vals[key]);
      }
      if (type === 'count') {
        if (!Array.isArray(vals[key])) return inner;
        return vals[key].length + ' фото';
      }
      if (type === 'text') {
        if (!TEXTS[key] || typeof vals[key] !== 'string') return inner;
        const t = esc(vals[key]);
        return TEXTS[key].nbsp ? t.replace(/ /g, '&nbsp;') : t;
      }
      if (type === 'catalog' && catalog) {
        const part = catalogPart(key, catalog);
        return part === null ? inner : part;
      }
      return inner;
    });
    out = out.replace(SHOW, (m, tag, a, key, b) => (vals[key] === false ? '<' + tag + a + ' data-show="' + key + '"' + b + ' hidden>' : m));
    const page = { mtime: src.mtime, rev: this.rev, text: out, etag: 'W/"p' + Math.floor(src.mtime).toString(36) + '-' + this.rev.toString(36) + '"' };
    this.pages.set(file, page);
    return page;
  }
}

module.exports = { Site, SLOTS, GALLERIES, TEXTS, TOGGLES, THEMES, PAGES, galleryItems, isWide };
