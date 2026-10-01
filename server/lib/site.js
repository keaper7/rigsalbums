'use strict';

// Содержимое сайта, которое Артур меняет из админки.
//
// Страницы остаются обычными HTML-файлами (их же отдаёт GitHub Pages).
// Места, которые можно менять, отмечены комментариями:
//   <!--@media arthur lg--><img src="..."><!--@end-->   фото или видео
//   <!--@gallery works-->...плитки...<!--@end-->        список фото
//   <!--@text price.main-->4 500<!--@end-->             текст
//   <!--@count works-->65 фото<!--@end-->               число фото в галерее
//   <!--@film works home.works-->...ленты...<!--@end-->  плёнка на главной: фото из works без тех, что уже в home.works
//   <!--@catalog themes-->...<!--@end-->                тематики из раздела «Варианты»
//   <div data-show="price.group">                        блок, который можно скрыть
// Внутри комментариев лежит вариант по умолчанию. Сервер подставляет
// вместо него то, что сохранено в админке.

const fs = require('fs');
const path = require('path');
const { esc, plural, fromLocalInput } = require('./util');

const PAGES = ['index.html', 'works.html', 'albums.html', 'designs.html', 'studio.html', 'contacts.html'];

const THEMES = [
  ['classic', 'CLASSIC'], ['siren', 'OFFICE SIREN'], ['american', 'AMERICAN VIBE'], ['canon', 'CANON VIBE'], ['white', 'WHITE'],
  ['grey', 'GREY'], ['aesthetic', 'AESTHETIC'], ['money', 'NEW MONEY'], ['neon', 'NEON']
];

// shape: как показать превью в админке (cover, circle, wide, square, tall)
const SLOTS = {
  'home.video': { type: 'video', label: 'Видео «Как это выглядит вживую»', where: 'Главная, сразу после первого экрана', hint: 'Вертикальное 9:16, от 20 секунд до минуты. На сайте играет без звука.' },
  'arthur': { type: 'image', label: 'Личная', where: 'Главная (в конце) и «Контакты»', shape: 'circle', hint: 'Лицо по центру: фото обрежется в круг.' },
  'album': { type: 'image', label: 'Фото альбома', where: '«Альбомы и цены», самый верх', shape: 'wide', hint: 'Лучше на белом фоне: белый растворится в странице.' },
  'studio.main': { type: 'image', label: 'Студия общим планом', where: '«Студия», самый верх', shape: 'wide', hint: 'Горизонтальное, лучше с ребятами в кадре.' }
};
// Обложка тематики живёт в разделе «Варианты», но хранится как место на сайте cover.<ключ>.
// Так обложки, загруженные раньше, остаются на месте
const COVER = { type: 'image', label: 'Обложка', where: 'Главная: колода обложек и полка дизайнов', shape: 'cover' };
// Обложки, которые лежат в самом сайте, пока в админке не загрузили свою
const COVER_FILES = {
  classic: 'cover-classic-a', siren: 'cover-siren-b', american: 'cover-american-b', canon: 'cover-canon-a', white: 'cover-white-a',
  grey: 'cover-grey-a', aesthetic: 'cover-aesthetic-a', money: 'cover-money-a', neon: 'cover-neon-a'
};
function coverKey(key) { return /^cover\.[a-z0-9]+$/.test(key); }

const GALLERIES = {
  'studio.zones': { label: 'Зоны студии', where: 'Страница «Студия», под «Что есть в студии»', hint: 'Фото разных зон студии. Первое фото показывается крупнее. Если убрать все, блок на сайте пропадёт.', lb: 'zones', max: 60, empty: true },
  'home.works': { label: 'Работы на главной', where: 'Главная, блок «Вот так я снимаю выпускников»', hint: 'Лучше 8–12 фото. Горизонтальные фото займут всю ширину.', lb: 'home', max: 16 },
  // Разделы страницы «Работы». У каждого своя ссылка, её можно отправить родителям.
  // Пустой раздел на сайте не показывается
  'works': { label: 'Индивидуальная фотосессия', where: 'Страница «Работы» и плёнка на главной', hint: 'Новые фото встают в начало. Первые 16 фото, которых нет в «Работах на главной», едут на плёнке.', lb: 'shoots', max: 300, section: 'individual', empty: true },
  'works.spring': { label: 'Групповая на природе: весна', where: 'Страница «Работы»', hint: 'Новые фото встают в начало.', lb: 'spring', max: 300, section: 'spring', empty: true },
  'works.autumn': { label: 'Групповая на природе: осень', where: 'Страница «Работы»', hint: 'Новые фото встают в начало.', lb: 'autumn', max: 300, section: 'autumn', empty: true },
  'works.school': { label: 'Групповая в школе', where: 'Страница «Работы»', hint: 'Новые фото встают в начало.', lb: 'school', max: 300, section: 'school', empty: true },
  'works.studio': { label: 'Групповая в студии', where: 'Страница «Работы»', hint: 'Новые фото встают в начало.', lb: 'studio', max: 300, section: 'studio', empty: true }
};

const TEXTS = {
  'price.tag': { label: 'Надпись над ценой', max: 40 },
  'price.main': { label: 'Цена сейчас, ₽', max: 12, nbsp: true },
  'price.note': { label: 'Под ценой', max: 140 },
  'price.later.tag': { label: 'Надпись над второй ценой', max: 40 },
  'price.later': { label: 'Обычная цена, ₽', max: 12, nbsp: true },
  'price.save': { label: 'Про скидку', max: 140 },
  'price.group.title': { label: 'Заголовок', max: 140 },
  'price.group.two': { label: '2 класса', max: 20 },
  'price.group.three': { label: '3 класса и больше', max: 20 }
};

// С этой даты скидка закончилась и сайт сам показывает обычную цену. Меняется в админке
const PRICE_UNTIL = '2027-01-01';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Надпись над ценой по дате: для 1 января «Скидка до Нового года», иначе «Скидка по 14 марта»
// (последний день скидки — накануне даты окончания)
function untilLabels(date) {
  const m = DATE_RE.exec(date);
  if (!m || (m[2] === '01' && m[3] === '01')) return null;
  const last = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 86400000);
  return { tag: 'Скидка по ' + last.getUTCDate() + ' ' + MONTHS[last.getUTCMonth()] };
}

const TOGGLES = {
  'price.group': { label: 'Показывать цены для параллели' },
  'price.early': { label: 'Показывать скидку: обычную цену, плашку и счётчик дней' }
};

const MARK = /<!--@(media|gallery|text|count|catalog|film|pile|retouch) ([a-z0-9.]+)(?: (sm|lg|[a-z0-9.]+))?-->([\s\S]*?)<!--@end-->/g;
const SHOW = /<([a-z]+)([^>]*?) data-show="([a-z0-9.]+)"([^>]*)>/g;
// Блок, который виден, только пока в галерее есть фото
const NEED = /<([a-z]+)([^>]*?) data-need="([a-z0-9.]+)"([^>]*?)( hidden)?>/g;

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

// Плёнка на главной: две ленты по кругу. Берём фото из галереи src, кроме тех, что уже есть в skip
// (галерея сразу под плёнкой), — чтобы одни и те же снимки не шли подряд. Каждая лента повторена дважды,
// чтобы анимация сдвигом на половину зацикливалась без стыка
const FILM_MAX = 16;
const PILE_MAX = 7;
// Фото из «Работ», которых нет в галерее главной (skip)
function freshPool(items, skip) {
  const used = new Set();
  (skip || []).forEach(it => { used.add(it.sm); used.add(it.lg); });
  return items.filter(it => !used.has(it.sm) && !used.has(it.lg));
}
// Кадрик плёнки — 125×90: берём маленькую копию фото (360 px), если она есть. Иначе телефон, когда плёнка
// подъезжает, разом уменьшает три десятка фото 720×1080, и прокрутка подвисает
const XS = new Map();
function filmSrc(sm) {
  const m = /^(assets\/gallery\/[A-Za-z0-9_-]+)-sm\.jpg$/.exec(sm || '');
  if (!m) return sm;
  if (!XS.has(m[1])) XS.set(m[1], fs.existsSync(path.join(__dirname, '..', '..', m[1] + '-xs.jpg')));
  return XS.get(m[1]) ? m[1] + '-xs.jpg' : sm;
}
function filmHtml(items, skip) {
  let pool = freshPool(items, skip);
  // Если почти всё уже есть внизу — лучше повтор, чем пустая плёнка
  if (pool.length < 6) pool = items.slice();
  pool = pool.slice(0, FILM_MAX);
  if (pool.length < 2) return null;
  const half = Math.ceil(pool.length / 2);
  const frame = it => '<span class="film__f' + (isWide(it) ? ' film__f--w' : '') + '"><img src="' + esc(filmSrc(it.sm)) + '" alt="" loading="lazy" decoding="async"></span>';
  const strip = (cls, list) => {
    const f = list.map(frame).join('');
    return '<div class="film__strip ' + cls + '"><div class="film__track">' + f + f + '</div></div>';
  };
  const a = pool.slice(0, half), b = pool.slice(half);
  return '\n  ' + strip('film__strip--a', a) + '\n  ' + strip('film__strip--b', b.length ? b : a) + '\n';
}

// «Фото на стол» после галереи: вертикальные фото из «Работ», которых нет ни в галерее главной, ни на плёнке
// (плёнка берёт первые FILM_MAX). Если таких мало — добираем из остальных, кроме галереи
function pileHtml(items, skip) {
  const pool = freshPool(items, skip).filter(it => !isWide(it));
  let list = pool.slice(FILM_MAX, FILM_MAX + PILE_MAX);
  if (list.length < PILE_MAX) list = list.concat(pool.slice(0, FILM_MAX).reverse()).slice(0, PILE_MAX);
  if (list.length < 4) return null;
  return list.map(it => '<figure class="desk__ph"><img src="' + esc(it.sm) + '" alt="" decoding="async"></figure>').join('');
}

// «Обработка» в начале главной: вертикальный снимок из «Работ», которого нет ни в галерее, ни на плёнке, ни на столе.
// Посетитель сам крутит ему свет, контраст и тепло
function retouchHtml(items, skip) {
  const pool = freshPool(items, skip).filter(it => !isWide(it));
  const it = pool[FILM_MAX + PILE_MAX] || pool[pool.length - 1] || items[0];
  if (!it) return null;
  return '<img class="edit__img" src="' + esc(it.sm) + '" alt="Фото выпускника для примера обработки" decoding="async">';
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

// Картинка обложки: своя из админки, потом из сайта, потом первое фото тематики
function coverSrc(o, vals) {
  const v = vals['cover.' + o.key];
  if (v && v.sm) return v.sm;
  if (COVER_FILES[o.key]) return 'assets/home/' + COVER_FILES[o.key] + '-sm.jpg';
  const p = (o.photos || [])[0];
  return p ? p.src + '-sm.jpg' : '';
}

function coverPart(name, cat, vals) {
  const list = visible(cat.theme);
  const img = (o, attrs) => {
    const src = coverSrc(o, vals);
    return src ? '<img src="' + esc(src) + '" alt="' + attrs.alt + '"' + attrs.more + '>' : '';
  };
  if (name === 'deck') {
    return list.map((o, i) => '<figure class="deck__card" data-name="' + esc(o.name) + '" data-f="' + esc(o.key) + '">' +
      img(o, { alt: 'Обложка ' + esc(o.name), more: i === 0 ? ' fetchpriority="high"' : '' }) + '</figure>').join('\n        ');
  }
  if (name === 'decklabel') {
    return list.length ? '<span class="deck__name f-' + esc(list[0].key) + '">' + esc(list[0].name) + '</span>' : '<span class="deck__name"></span>';
  }
  if (name === 'ticker') {
    const once = list.map(o => '<span class="f-' + esc(o.key) + '">' + esc(o.name) + '</span>').join('');
    return once + '\n    ' + once;
  }
  if (name === 'shelf') {
    return list.map(o => '<a class="book" href="designs.html#' + esc(o.key) + '"><span class="book__cover">' + img(o, { alt: '', more: ' loading="lazy"' }) +
      '</span><span class="book__name f-' + esc(o.key) + '">' + esc(o.name) + '</span>' + (o.tag ? '<span class="book__tag">' + esc(o.tag) + '</span>' : '') + '</a>').join('\n    ');
  }
  return null;
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
    return typeof v === 'string' ? v : this.defaultText(key);
  }

  // Текст без правок: из HTML, а подписи у цены — по дате повышения
  defaultText(key) {
    const labels = key === 'price.tag' && untilLabels(this.priceUntil());
    if (labels) return labels.tag;
    return this.defaults().text[key] || '';
  }

  shown(key) { return this.store.getSite(key) !== false; }

  priceUntil() {
    const v = this.store.getSite('price.until');
    return typeof v === 'string' && DATE_RE.test(v) ? v : PRICE_UNTIL;
  }

  // Наступила ли дата повышения цены (полночь по часовому поясу студии)
  priceOver(now) {
    return (now || Date.now()) >= fromLocalInput(this.priceUntil() + 'T00:00');
  }

  // Что сейчас видит посетитель: после даты — цена «после», без выгоды и скидки параллели
  effective(vals, over) {
    const v = Object.assign({}, vals);
    if (untilLabels(this.priceUntil())) v['price.tag'] = this.text('price.tag');
    if (over) {
      v['price.main'] = this.text('price.later');
      v['price.early'] = false;
      v['price.group'] = false;
    }
    return v;
  }

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
    const over = this.priceOver();
    if (hit && hit.mtime === src.mtime && hit.rev === this.rev && hit.over === over) return hit;
    const vals = this.effective(this.values(), over);
    let out = src.text.replace(MARK, (all, type, key, variant, inner) => {
      if (type === 'media') return this.renderMedia(key, variant, inner, vals[key]);
      if (type === 'gallery') {
        if (!GALLERIES[key] || !Array.isArray(vals[key])) return inner;
        return galleryHtml(key, vals[key]);
      }
      if (type === 'film' || type === 'pile' || type === 'retouch') {
        const list = k => (Array.isArray(vals[k]) ? vals[k] : this.defaults().gallery[k] || []);
        const part = ({ film: filmHtml, pile: pileHtml, retouch: retouchHtml })[type](list(key), variant ? list(variant) : []);
        return part === null ? inner : part;
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
        const part = coverPart(key, catalog, vals) || catalogPart(key, catalog);
        return part === null ? inner : part;
      }
      return inner;
    });
    out = out.replace(NEED, (m, tag, a, key, b) => {
      const n = Array.isArray(vals[key]) ? vals[key].length : (this.defaults().gallery[key] || []).length;
      return '<' + tag + a + ' data-need="' + key + '"' + b + (n ? '' : ' hidden') + '>';
    });
    out = out.replace(SHOW, (m, tag, a, key, b) => (vals[key] === false ? '<' + tag + a + ' data-show="' + key + '"' + b + ' hidden>' : m));
    out = out.replace(/ data-until="[^"]*"/g, ' data-until="' + this.priceUntil() + '"');
    const page = { mtime: src.mtime, rev: this.rev, over: over, text: out, etag: 'W/"p' + Math.floor(src.mtime).toString(36) + '-' + this.rev.toString(36) + (over ? '-z' : '') + '"' };
    this.pages.set(file, page);
    return page;
  }
}

module.exports = { PRICE_UNTIL, DATE_RE, Site, SLOTS, COVER, coverKey, coverSrc, GALLERIES, TEXTS, TOGGLES, THEMES, PAGES, galleryItems, isWide };
