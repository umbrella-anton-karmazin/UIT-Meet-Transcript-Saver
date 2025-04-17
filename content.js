/* ******************************************************************
 * Meet Transcript Saver · v1.0.0
 * — убирает всю «мета»‑информацию и сохраняет чистый текст субтитров
 * ******************************************************************/

(() => {
  'use strict';

  /* ======= Константы, утилиты ================================================= */

  const DEBUG = true;
  const log   = (...a) => DEBUG && console.log('[MTS]', ...a);

  /** CSS‑индикатор в левом‑верхнем углу, показывающий работу скрипта. */
  const STYLE = `
    #mtsIndicator{
      position:fixed;top:20px;left:10px;width:24px;height:24px;
      display:flex;align-items:center;justify-content:center;
      font:700 18px/1 sans-serif;border-radius:50%;
      color:#fff;z-index:2147483647;pointer-events:none;user-select:none}
    #mtsIndicator.off{background:#d92b26}
    #mtsIndicator.on {background:#26d968;animation:mts-blink 1s infinite alternate}
    @keyframes mts-blink{from{opacity:1}to{opacity:.35}}
  `;

  /** Селекторы областей и элементов с субтитрами. */
  const ROOT_SEL = "div[aria-live='polite'][role='list'], div[aria-label='Captions'][role='region']";
  const ITEM_SEL =
    "div[role='listitem'][aria-label$=' caption']," +
    "div[aria-label='Captions'][role='region'] div[data-message-index]";

  /** Функции‑утилиты. */
  const JUNK_RE     = /^(arrow[_-]?downward|more_vert|expand_less|settings)$/i;
  const hasLetters  = s => /[a-zа-яё]/i.test(s);
  const clean       = s => s.replace(/\s+/g, ' ').trim();
  const canon       = s => s.toLowerCase()
                            .replace(/[^\p{L}\p{N}\s]/gu, '')
                            .replace(/\s+/g, ' ')
                            .trim();

  /** Примитивное расстояние Левенштейна (для склейки повторов). */
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = a[i - 1] === b[j - 1]
          ? d[i - 1][j - 1]
          : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
      }
    }
    return d[m][n];
  }

  /* ======= UI‑индикатор ======================================================= */

  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: STYLE }));
  const indicator = Object.assign(document.createElement('div'),
    { id: 'mtsIndicator', className: 'off', textContent: '×' });
  document.body.appendChild(indicator);

  const setIndicator = on => {
    indicator.className = on ? 'on' : 'off';
    indicator.textContent = on ? '' : '×';
  };

  /* ======= Логика сбора субтитров ============================================ */

  let meetingStart = Date.now();
  /** @type {{ts:string,text:string,canon:string}[]} */
  const rows = [];
  /** Cохраняем связь DOM‑элемента → индекс строки в rows */
  let track = new WeakMap();

  /** Видны ли субтитры на экране? */
  const captionsVisible = () => Boolean(document.querySelector(ROOT_SEL));
  setInterval(() => setIndicator(captionsVisible()), 750);

  /**
   * Добавляет или обновляет строку субтитра.
   * @param {HTMLElement} el
   */
  function addLine(el) {
    if (!el.closest(ROOT_SEL)) return;

    const raw = clean(el.innerText);
    if (!hasLetters(raw) || raw.length < 2 || JUNK_RE.test(raw)) return;

    // speaker нам сейчас не нужен, но оставим задел
    // const speaker = clean(el.getAttribute('aria-label')?.replace(/ caption$/i, '') || '');

    const pretty = raw;
    const c      = canon(pretty);

    // 1) Обновляем существующую строку, если тот же DOM‑элемент
    if (track.has(el)) {
      const i = track.get(el);
      if (c !== rows[i].canon && pretty.length >= rows[i].text.length) {
        rows[i].text  = pretty;
        rows[i].canon = c;
      }
      return;
    }

    // 2) Склеиваем с последними 5 строками, если они почти совпадают
    for (let i = rows.length - 1; i >= Math.max(0, rows.length - 5); i--) {
      const r = rows[i];
      if (
        levenshtein(r.canon, c) <= 3 ||
        r.canon.startsWith(c) || c.startsWith(r.canon)
      ) {
        if (pretty.length > r.text.length) {
          r.text  = pretty;
          r.canon = c;
        }
        track.set(el, i);
        return;
      }
    }

    // 3) Новая строка
    const rel  = ((Date.now() - meetingStart) / 1000) | 0;
    const ts   = `${String((rel / 60) | 0).padStart(2, '0')}:${String(rel % 60).padStart(2, '0')}`;
    track.set(el, rows.push({ ts, text: pretty, canon: c }) - 1);
  }

  /* ======= Наблюдатели за DOM‑ом ============================================= */

  new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(n => {
        if (n.nodeType === 1 && n.matches?.(ITEM_SEL)) addLine(n);
      });
      if (m.type === 'characterData') addLine(m.target.parentElement);
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  /* ======= Авто‑включение субтитров (первые 15 с) ============================ */

  const toggleCC = () => {
    const btn = document.querySelector(
      'button[aria-label^="Turn on captions"],' +
      'button[aria-label^="Включить субтитры"],' +
      'button[aria-label^="Enable captions"]'
    );
    if (btn) btn.click();
    else document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'C', code: 'KeyC', shiftKey: true, bubbles: true })
    );
  };
  const ccLoop = setInterval(toggleCC, 1500);
  setTimeout(() => clearInterval(ccLoop), 15000);

  /* ======= Сохранение и очистка ============================================== */

  function flush() {
    if (!rows.length) {
      indicator.remove();
      return;
    }

    const titleEl  = document.querySelector('div[role="main"] h1, div[role="main"] span[jsname]');
    const rawTitle = titleEl?.innerText || document.title || 'meet';
    const title    = rawTitle.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 100);

    chrome.runtime.sendMessage({
      type: 'saveTranscript',
      title,
      data: rows.map(r => `[${r.ts}] ${r.text}`)
    });

    log('Saved', rows.length, 'lines');
    rows.length = 0;
    track       = new WeakMap();
    indicator.remove();
  }

  /* Выходим из встречи — сохраняем транскрипт */
  (function bindLeave() {
    const sel = 'button[aria-label^="Leave call"],button[aria-label^="Покинуть звонок"]';
    const btn = document.querySelector(sel);
    if (btn) btn.addEventListener('click', flush, { once: true });
    else setTimeout(bindLeave, 1000);
  })();

  window.addEventListener('pagehide',     flush);
  window.addEventListener('beforeunload', flush);
  window.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && e.code === 'KeyS') flush();
  });

  setIndicator(captionsVisible());
})();
