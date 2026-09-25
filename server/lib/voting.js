'use strict';

const { STEPS } = require('./db');

const STEP_NAMES = { theme: 'Тематика', wear: 'Стиль одежды', color: 'Цвет одежды' };
const LATER = 'Сообщу в чате класса';

// draft: ссылка уже работает, варианты видно, но голосовать нельзя
//        (в том числе когда старт запланирован на будущее время)
// open: идёт голосование до ends_at
// closed: время вышло или Артур закрыл вручную
function status(c, now) {
  const t = now || Date.now();
  if (!c.opened_at || t < c.opened_at) return 'draft';
  if (c.closed_at || (c.ends_at && t >= c.ends_at)) return 'closed';
  return 'open';
}

// Время запланированного старта, если он ещё впереди
function opensAt(c, now) {
  return c.opened_at && (now || Date.now()) < c.opened_at ? c.opened_at : null;
}

// Варианты, которые видит этот класс: без скрытых в каталоге и скрытых для класса
function visibleOptions(catalog, cls) {
  const off = cls && cls.hidden ? cls.hidden : [];
  const out = {};
  STEPS.forEach(step => {
    out[step] = (catalog[step] || []).filter(o => !o.hidden && off.indexOf(step + ':' + o.key) === -1);
  });
  return out;
}

function activeSteps(opts) {
  return STEPS.filter(s => opts[s] && opts[s].length);
}

// Итог по каждому этапу. Ничья или ноль голосов ждут решения Артура
function resolve(cls, opts, counts) {
  const out = {};
  activeSteps(opts).forEach(step => {
    const list = opts[step];
    const c = counts[step] || {};
    const pick = cls.picks && cls.picks[step];
    const manual = pick && list.find(o => o.key === pick);
    if (manual) {
      out[step] = { option: manual, manual: true, tie: [] };
      return;
    }
    let max = 0;
    list.forEach(o => { if ((c[o.key] || 0) > max) max = c[o.key]; });
    const top = max ? list.filter(o => (c[o.key] || 0) === max) : [];
    if (top.length === 1) out[step] = { option: top[0], manual: false, tie: [] };
    else out[step] = { option: null, manual: false, tie: top };
  });
  return out;
}

function isPending(res) {
  return Object.keys(res).some(s => !res[s].option);
}

function coverNote(o) {
  return o.covers === 2 ? '. Какую из двух обложек, утверждаем в чате' : '';
}

// Строки шпаргалки после закрытия голосования
function cheat(cls, res) {
  const rows = [];
  const th = res.theme && res.theme.option;
  const wr = res.wear && res.wear.option;
  const cl = res.color && res.color.option;
  if (res.theme) rows.push({ label: 'Тематика', value: th ? th.name + coverNote(th) : 'Скоро выберу и напишу в чате' });
  if (res.wear || res.color) {
    let v;
    if (wr && cl) v = wr.name + ', в цвете: ' + cl.name.toLowerCase() + (cl.plus ? ' + чёрный и белый' : '');
    else if (wr) v = wr.name + (res.color ? ', цвет скоро напишу в чате' : '');
    else if (cl) v = 'Цвет: ' + cl.name.toLowerCase() + (cl.plus ? ' + чёрный и белый' : '');
    else v = 'Скоро выберу и напишу в чате';
    rows.push({ label: 'Одежда', value: v });
  }
  if (res.theme) rows.push({ label: 'Групповые', value: (th && th.loc ? 'Рекомендуемая локация: ' + th.loc + '. ' : '') + 'Место выбираем в чате' });
  rows.push({ label: 'Дата и время съёмки', value: cls.shoot || LATER, muted: !cls.shoot });
  rows.push({ label: 'Адрес студии', value: cls.address || LATER, muted: !cls.address });
  rows.push({ label: 'Что взять с собой', value: cls.bring || LATER, muted: !cls.bring });
  if (cls.note) rows.push({ label: 'Ещё', value: cls.note });
  return rows;
}

// Состояние для страницы класса: без чужих данных, только цифры
function publicState(store, catalog, cls, voter) {
  const now = Date.now();
  const opts = visibleOptions(catalog, cls);
  const all = store.counts(cls.id);
  const counts = {};
  activeSteps(opts).forEach(s => {
    counts[s] = {};
    opts[s].forEach(o => { counts[s][o.key] = all[s][o.key] || 0; });
  });
  const st = status(cls, now);
  return {
    status: st,
    now: now,
    opensAt: opensAt(cls, now),
    endsAt: cls.ends_at || null,
    counts: counts,
    voters: store.voters(cls.id),
    mine: store.mine(cls.id, voter),
    pending: st === 'closed' ? isPending(resolve(cls, opts, all)) : false,
    rev: cls.updated_at
  };
}

module.exports = { STEP_NAMES, status, opensAt, visibleOptions, activeSteps, resolve, isPending, cheat, publicState, coverNote };
