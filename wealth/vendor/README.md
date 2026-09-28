# Сторонние библиотеки, которые приложение раздаёт само

Раздаём со своего адреса, а не с CDN: код, который видит страницу с выписками, не меняется без нашего ведома.

- `pdfjs/` — PDF.js 4.10.38 (pdfjs-dist, legacy build: работает и в старых Safari). Apache-2.0. Нужен, чтобы превратить
  страницы PDF в изображения и текстовый слой для Claude и показать страницу-источник в карточке позиции.

- `mixpanel/` — mixpanel-browser 2.83.0 (npm, `dist/mixpanel.min.js`, контрольная сумма сверена с реестром npm). Apache-2.0.
  Аналитика воронки (wealth/track.js): грузится только после согласия на cookies там, где оно нужно; данные — в ЕС
  (api-eu.mixpanel.com). Модули записи экрана и флагов библиотека тянула бы с cdn.mxpnl.com — политика безопасности страницы
  их не пускает, и они не нужны.
- `sentry/` — @sentry/browser 11.1.0 (`bundle.min.js` с browser.sentry-cdn.com, только ошибки, без трассировки и записи экрана).
  MIT. Отчёты о сбоях приложения (wealth/errors.js), данные — в ЕС.

Excel читается и выгружается SheetJS 0.18.5 с cdnjs (подгружается только когда нужен).
Распознавание сканов в браузере (Tesseract) больше не нужно: сканы и фото читает Claude.

Обновление PDF.js: `npm pack pdfjs-dist@<версия>`, скопировать legacy-сборку (pdf.min.mjs, pdf.worker.min.mjs), проверить чтение.

Обновление Mixpanel: `npm pack mixpanel-browser@<версия>`, взять `dist/mixpanel.min.js`, сверить загрузчик в track.js с `dist/mixpanel-jslib-snippet.min.js`.
Обновление Sentry: `https://browser.sentry-cdn.com/<версия>/bundle.min.js`; проверка — qa/claude/analytics.mjs.
