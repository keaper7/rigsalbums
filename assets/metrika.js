// Яндекс Метрика (счётчик Артура). Считаем только на боевом домене — локально и на тестах не шумим
(function (m, e, t, r, i, k, a) {
  if (!/(^|\.)rigsarthur\.ru$/.test(location.hostname)) return;
  m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
  m[i].l = 1 * new Date();
  for (var j = 0; j < e.scripts.length; j++) { if (e.scripts[j].src === r) return; }
  k = e.createElement(t), a = e.getElementsByTagName(t)[0], k.async = 1, k.src = r, a.parentNode.insertBefore(k, a);
  m[i](113394407, 'init', { ssr: true, webvisor: true, clickmap: true, ecommerce: 'dataLayer', referrer: e.referrer, url: location.href, accurateTrackBounce: true, trackLinks: true });
})(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=113394407', 'ym');
