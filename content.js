/* ────────────────────────── shared config ────────────────────────── */

const DEBUG       = true;
const JUNK_RE     = /^(arrow[_-]?downward|more_vert|expand_less|settings|Jump to the bottom)$/i;
const ROOT_SEL    = `div[aria-live='polite'][role='list'],
                      div[aria-label='Captions'][role='region'],
                      div[aria-label='Субтитры'][role='region']`;
const ITEM_SEL    = `div[role='listitem'][aria-label$=' caption'],
                      div[aria-label='Субтитры'][role='region'] div[data-message-index],
                      div[aria-label='Captions'][role='region'] div[data-message-index]`;
const CC_BTN_SEL  = `button[aria-label^="Turn on captions"],
                      button[aria-label^="Включить субтитры"],
                      button[aria-label^="Enable captions"]`;
const LEAVE_BTN_SEL = `button[aria-label^="Leave call"],
                        button[aria-label^="Покинуть звонок"]`;

/* ────────────────────────── helpers ────────────────────────── */

const log      = (...a) => DEBUG && console.log('[MTS]', ...a);
const hasChars = s => /[a-zа-яё]/i.test(s);
const clean    = s => s.replace(/\s+/g, ' ').trim();
const canon    = s => s.toLowerCase()
                       .replace(/[^\p{L}\p{N}\s]/gu, '')
                       .replace(/\s+/g, ' ')
                       .trim();

/** Very small Levenshtein implementation – good enough for fuzzy‑match duplicates */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => new Uint16Array(n + 1));
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

/* ────────────────────────── UI Indicator ────────────────────────── */

class Indicator {
  #el;

  constructor() {
    const style = document.createElement('style');
    style.textContent = `
      #mtsIndicator{
        position:fixed;top:20px;left:10px;width:24px;height:24px;
        display:flex;align-items:center;justify-content:center;
        font:700 18px/1 sans-serif;border-radius:50%;
        color:#fff;z-index:2147483647;pointer-events:none;user-select:none}
      #mtsIndicator.off{background:#d92b26}
      #mtsIndicator.on {background:#26d968;animation:mts-blink 1s infinite alternate}
      @keyframes mts-blink{from{opacity:1}to{opacity:.35}}
    `;
    document.head.appendChild(style);

    this.#el = Object.assign(document.createElement('div'), {
      id: 'mtsIndicator',
      className: 'off',
      textContent: '×'
    });
    document.body.appendChild(this.#el);
  }

  set active(v) {
    this.#el.className   = v ? 'on' : 'off';
    this.#el.textContent = v ? ''  : '×';
  }

  remove() { this.#el.remove(); }
}

/* ────────────────────────── Subtitle buffer ────────────────────────── */

class CaptionBuffer {
  #rows    = [];               // {ts, text, canon}
  #track   = new WeakMap();     // DOM element → row index
  #start   = performance.now(); // meeting start (ms)

  get length() { return this.#rows.length; }
  reset()      { this.#rows.length = 0; this.#track = new WeakMap(); }

  /**
   * Try to add/update a caption taken from a DOM node.
   * @param {HTMLElement} el
   */
  addLine(el) {
    if (!el.closest(ROOT_SEL)) return;

    const raw = clean(el.innerText);
    if (!hasChars(raw) || raw.length < 2 || JUNK_RE.test(raw)) return;

    const pretty = raw;
    const c      = canon(pretty);

    // 1) Same DOM element → update existing row
    if (this.#track.has(el)) {
      const i = this.#track.get(el);
      if (c !== this.#rows[i].canon && pretty.length >= this.#rows[i].text.length) {
        Object.assign(this.#rows[i], { text: pretty, canon: c });
      }
      return;
    }

    // 2) Merge with the last ≤5 rows if “almost” duplicate
    for (let i = this.#rows.length - 1; i >= Math.max(0, this.#rows.length - 5); i--) {
      const r = this.#rows[i];
      if (levenshtein(r.canon, c) <= 3 || r.canon.startsWith(c) || c.startsWith(r.canon)) {
        if (pretty.length > r.text.length) Object.assign(r, { text: pretty, canon: c });
        this.#track.set(el, i);
        return;
      }
    }

    // 3) Brand‑new row
    const rel = ((performance.now() - this.#start) / 1000) | 0;
    const ts  = `${String((rel / 60) | 0).padStart(2,'0')}:${String(rel % 60).padStart(2,'0')}`;

    this.#track.set(el, this.#rows.push({ ts, text: pretty, canon: c }) - 1);
  }

  /**
   * Returns array of strings `[mm:ss] text`.
   * Does NOT clear the buffer.
   */
  toLines() { return this.#rows.map(r => `[${r.ts}] ${r.text}`); }
}

/* ────────────────────────── DOM observer ────────────────────────── */

class CaptionObserver {
  #observer;

  constructor(buffer) {
    this.#observer = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => (n.nodeType === 1 && n.matches?.(ITEM_SEL)) && buffer.addLine(n));
        if (m.type === 'characterData') buffer.addLine(m.target.parentElement);
      });
    });
  }

  start() { this.#observer.observe(document.body, { childList:true, subtree:true, characterData:true }); }
  stop()  { this.#observer.disconnect(); }
}

/* ────────────────────────── Auto‑CC toggle ────────────────────────── */

class CCAutotoggle {
  #timer;

  start() {
    const toggle = () => {
      const btn = document.querySelector(CC_BTN_SEL);
      btn ? btn.click() : document.dispatchEvent(new KeyboardEvent('keydown', {
        key:'C', code:'KeyC', shiftKey:true, bubbles:true
      }));
    };
    this.#timer = setInterval(toggle, 1500);
    setTimeout(() => this.stop(), 15000);
  }
  stop() { clearInterval(this.#timer); }
}

/* ────────────────────────── Saver & export ────────────────────────── */

class TranscriptSaver {
  constructor(buffer, indicator) {
    this.buffer    = buffer;
    this.indicator = indicator;

    // auto‑flush on “leave call” button
    this.#bindLeaveBtn();
    // page lifecycle
    window.addEventListener('pagehide',     () => this.flush());
    window.addEventListener('beforeunload', () => this.flush());
    // manual shortcut
    window.addEventListener('keydown', e => (e.altKey && e.shiftKey && e.code === 'KeyS') && this.flush());
  }

  #bindLeaveBtn() {
    const btn = document.querySelector(LEAVE_BTN_SEL);
    if (btn) btn.addEventListener('click', () => this.flush(), { once:true });
    else     setTimeout(() => this.#bindLeaveBtn(), 1000);        // wait until Meet loads it
  }

  flush() {
    if (!this.buffer.length) { this.indicator.remove(); return; }

    const titleEl  = document.querySelector('div[role="main"] h1, div[role="main"] span[jsname]');
    const rawTitle = titleEl?.innerText || document.title || 'meet';
    const title    = rawTitle.replace(/[\\/:*?"<>|]+/g,'').trim().slice(0,100);

    chrome.runtime?.sendMessage?.({
      type: 'saveTranscript',
      title,
      data: this.buffer.toLines()
    });

    log('Saved', this.buffer.length, 'lines');
    this.buffer.reset();
    this.indicator.remove();
  }
}

/* ────────────────────────── Application root ────────────────────────── */

class MeetTranscriptSaver {
  constructor() {
    this.buffer     = new CaptionBuffer();
    this.indicator  = new Indicator();
    this.observer   = new CaptionObserver(this.buffer);
    this.ccToggler  = new CCAutotoggle();
    this.saver      = new TranscriptSaver(this.buffer, this.indicator);
  }

  init() {
    this.observer.start();
    this.ccToggler.start();

    // small loop to blink indicator only when captions area is mounted
    setInterval(() => {
      this.indicator.active = Boolean(document.querySelector(ROOT_SEL));
    }, 750);
  }
}

/* ────────────────────────── bootstrap ────────────────────────── */

(new MeetTranscriptSaver()).init();
