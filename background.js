/* ------------------------------------------------------------------
 * Meet Transcript Saver · Background service‑worker (MV3)
 * Сохраняет полученный набор строк субтитров в файл .txt
 * -----------------------------------------------------------------*/

'use strict';

/**
 * Создаёт и скачивает файл с субтитрами.
 * @param {string[]} transcript  Массив строк субтитров.
 * @param {string}   title       Название встречи (будет частью имени файла).
 * @param {function} respond     Ответ в content‑script.
 */
function downloadTranscript(transcript, title, respond) {
  const text     = transcript.join('\n');
  const dataUrl  = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);

  const safeTitle = title || 'meet';
  const dateStr   = new Date().toISOString().split('T')[0];      // YYYY‑MM‑DD
  const filename  = `${safeTitle}-${dateStr}.txt`;

  chrome.downloads.download(
    { url: dataUrl, filename, saveAs: false },
    downloadId => {
      const err = chrome.runtime.lastError;
      respond(err ? { ok: false, err: err.message } : { ok: true, id: downloadId });
    }
  );
}

// централизованный обработчик сообщений из content‑script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'saveTranscript') {
    downloadTranscript(msg.data, msg.title, sendResponse);
    return true;                // сообщает Chrome, что ответ будет асинхронным
  }
});
