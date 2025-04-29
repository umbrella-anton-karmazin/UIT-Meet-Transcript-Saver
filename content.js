/* ────────────────────────── shared config ────────────────────────── */

const DEBUG       = true;
const JUNK_RE     = /^(arrow[_-]?downward|more_vert|expand_less|settings|Jump to the bottom|Перейти вниз)$/i;
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
        position:fixed;top:20px;left:10px;width:48px;height:48px;
        display:flex;align-items:center;justify-content:center;
        border-radius:50%;z-index:2147483647;pointer-events:none;user-select:none;
        background-size:contain;background-position:center;background-repeat:no-repeat}
      #mtsIndicator.off{background-image:url(${chrome.runtime.getURL('icon48off.png')})}
      #mtsIndicator.on {background-image:url(${chrome.runtime.getURL('icon48.png')});animation:mts-blink 1s infinite alternate}
      @keyframes mts-blink{from{opacity:1}to{opacity:.35}}
    `;
    document.head.appendChild(style);

    this.#el = Object.assign(document.createElement('div'), {
      id: 'mtsIndicator',
      className: 'off'
    });
    document.body.appendChild(this.#el);
  }

  set active(v) {
    this.#el.className = v ? 'on' : 'off';
  }

  remove() { this.#el.remove(); }
}

/* ────────────────────────── Subtitle buffer ────────────────────────── */

class CaptionBuffer {
  #rows    = [];               // {ts, text, canon}
  #track   = new WeakMap();     // DOM element → row index
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
    if (!hasChars(raw) || JUNK_RE.test(raw)) return;

    const pretty = raw;
    const c = canon(pretty);

    // 1) Same DOM element → update existing row
    if (this.#track.has(el)) {
      const i = this.#track.get(el);
      if (c !== this.#rows[i].canon && pretty.length >= this.#rows[i].text.length) {
        Object.assign(this.#rows[i], { text: pretty, canon: c });
      }
      return;
    }

    // 2) Защита коротких фраз от объединения (имена, короткие реплики)
    const isShortPhrase = pretty.length <= 20;
    
    // 3) Проверяем, есть ли двоеточие - признак имени говорящего
    const hasColon = pretty.includes(':');
    
    // 4) Если это короткая фраза или содержит имя - никогда не объединяем
    if (isShortPhrase || hasColon) {
      const rel = ((performance.now() - this.#start) / 1000) | 0;
      const ts = `${String((rel / 60) | 0).padStart(2,'0')}:${String(rel % 60).padStart(2,'0')}`;
      
      this.#track.set(el, this.#rows.push({ 
          ts, 
          text: pretty, 
          canon: c 
      }) - 1);
      
      if (DEBUG) log('Сохранена короткая фраза:', pretty);
      return;
    }
    
    // 5) Улучшенная логика объединения для длинных фраз
    for (let i = this.#rows.length - 1; i >= Math.max(0, this.#rows.length - 5); i--) {
      const r = this.#rows[i];
      
      // Никогда не объединяем с короткими фразами
      if (r.text.length <= 20 || r.text.includes(':')) {
        continue;
      }
      
      // Более строгие условия для объединения
      const isSimilar = levenshtein(r.canon, c) <= 3 && 
                        (r.canon.length > 25 || c.length > 25) &&
                        (r.canon.startsWith(c) || c.startsWith(r.canon));
      
      if (isSimilar) {
        if (pretty.length > r.text.length) {
          Object.assign(r, { text: pretty, canon: c });
          if (DEBUG) log('Объединена длинная фраза:', pretty);
        }
        this.#track.set(el, i);
        return;
      }
    }

    // 6) Новая запись для всех остальных случаев
    const rel = ((performance.now() - this.#start) / 1000) | 0;
    const ts = `${String((rel / 60) | 0).padStart(2,'0')}:${String(rel % 60).padStart(2,'0')}`;

    this.#track.set(el, this.#rows.push({ 
        ts, 
        text: pretty, 
        canon: c 
    }) - 1);
    
    if (DEBUG) log('Сохранена новая запись:', pretty);
  }

  /**
   * Returns array of strings `[mm:ss] text`.
   * Does NOT clear the buffer.
   */
  toLines() { 
    return this.#rows.map(r => `[${r.ts}] ${r.text}`); 
  }
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
  #attempted = false;
  #maxAttempts = 10; // Try up to 10 times with 500ms intervals
  #attemptCount = 0;

  start() {
    const toggle = () => {
      if (this.#attempted) return; // Don't try if we already attempted
      
      const btn = document.querySelector(CC_BTN_SEL);
      if (btn) {
        btn.click();
        this.#attempted = true;
        this.stop();
        return;
      }
      
      // If button not found, try keyboard shortcut
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key:'C', code:'KeyC', shiftKey:true, bubbles:true
      }));
      
      this.#attemptCount++;
      if (this.#attemptCount >= this.#maxAttempts) {
        this.#attempted = true;
        this.stop();
      }
    };
    
    // Try every 500ms up to maxAttempts times
    this.#timer = setInterval(toggle, 500);
  }
  
  stop() { 
    clearInterval(this.#timer);
    this.#timer = null;
  }
}

/* ────────────────────────── Saver & export ────────────────────────── */

class TranscriptSaver {
  constructor(buffer, indicator) {
    this.buffer    = buffer;
    this.indicator = indicator;
    this.title     = null;
    this.isExtensionValid = true;

    // auto‑flush on "leave call" button
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

  #getTitle() {
    if (this.title) return this.title;
    
    const titleEl  = document.querySelector('div[role="main"] h1, div[role="main"] span[jsname]');
    const rawTitle = titleEl?.innerText || document.title || 'meet';
    this.title = rawTitle.replace(/[\\/:*?"<>|]+/g,'').trim().slice(0,100);
    return this.title;
  }

  sendMessage(message) {
    if (!this.isExtensionValid) return;
    
    try {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
              this.isExtensionValid = false;
              reject(chrome.runtime.lastError);
            } else {
              reject(chrome.runtime.lastError);
            }
          } else {
            resolve(response);
          }
        });
      });
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        this.isExtensionValid = false;
      }
      throw error;
    }
  }

  async updateTranscript() {
    if (!this.buffer.length || !this.isExtensionValid) return;

    try {
      await this.sendMessage({
        type: 'updateTranscript',
        title: this.#getTitle(),
        data: this.buffer.toLines()
      });
    } catch (error) {
      log('Error updating transcript:', error);
    }
  }

  async flush() {
    if (!this.buffer.length || !this.isExtensionValid) { 
      this.indicator.remove(); 
      return; 
    }

    try {
      await this.sendMessage({
        type: 'saveTranscript',
        title: this.#getTitle(),
        data: this.buffer.toLines()
      });

      log('Saved', this.buffer.length, 'lines');
      this.buffer.reset();
      this.indicator.remove();
    } catch (error) {
      log('Error saving transcript:', error);
    }
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
    this.updateInterval = null;
  }

  async init() {
    this.observer.start();
    this.ccToggler.start();

    try {
      // Notify background script that meeting has started
      await this.saver.sendMessage({ type: 'meetingStarted' });

      // small loop to blink indicator only when captions area is mounted
      setInterval(() => {
        this.indicator.active = Boolean(document.querySelector(ROOT_SEL)?.checkVisibility());
      }, 750);

      // Periodic transcript updates
      this.updateInterval = setInterval(() => {
        this.saver.updateTranscript();
      }, 1000);

      // Handle meeting end
      window.addEventListener('beforeunload', () => {
        if (this.saver.isExtensionValid) {
          this.saver.sendMessage({ type: 'meetingEnded' }).catch(() => {});
        }
      });
    } catch (error) {
      log('Error initializing:', error);
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
    }
  }
}

/* ────────────────────────── bootstrap ────────────────────────── */

(new MeetTranscriptSaver()).init();
