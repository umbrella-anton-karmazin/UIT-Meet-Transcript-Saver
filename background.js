/* ------------------------------------------------------------------
 * Meet Transcript Saver · Background service‑worker (MV3)
 * Сохраняет полученный набор строк субтитров в файл .txt
 * -----------------------------------------------------------------*/

'use strict';

let currentMeeting = null;
let updateInterval = null;

/**
 * Создаёт и скачивает файл с субтитрами.
 * @param {string[]} transcript  Массив строк субтитров.
 * @param {string}   title       Название встречи (будет частью имени файла).
 * @param {function} respond     Ответ в content‑script.
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

/**
 * Updates the current meeting in storage
 * @param {Object} meetingData Meeting data to store
 */
function updateCurrentMeeting(meetingData) {
  if (!currentMeeting) {
    currentMeeting = {
      ...meetingData,
      timestamp: Date.now()
    };
  } else {
    currentMeeting = {
      ...currentMeeting,
      ...meetingData
    };
  }

  // Store in chrome.storage
  chrome.storage.local.get(['meetings'], (result) => {
    const meetings = result.meetings || [];
    const existingIndex = meetings.findIndex(m => m.timestamp === currentMeeting.timestamp);
    
    if (existingIndex >= 0) {
      meetings[existingIndex] = currentMeeting;
    } else {
      meetings.push(currentMeeting);
    }
    
    chrome.storage.local.set({ meetings });
  });
}

// Start periodic updates when meeting starts
function startMeetingUpdates() {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  
  updateInterval = setInterval(() => {
    if (currentMeeting) {
      updateCurrentMeeting(currentMeeting);
    }
  }, 1000);
}

// Stop periodic updates when meeting ends
function stopMeetingUpdates() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  currentMeeting = null;
}

// централизованный обработчик сообщений из content‑script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'saveTranscript') {
    downloadTranscript(msg.data, msg.title, sendResponse);
    return true;
  } else if (msg.type === 'meetingStarted') {
    startMeetingUpdates();
    sendResponse({ ok: true });
    return true;
  } else if (msg.type === 'meetingEnded') {
    stopMeetingUpdates();
    sendResponse({ ok: true });
    return true;
  } else if (msg.type === 'updateTranscript') {
    updateCurrentMeeting({
      title: msg.title,
      transcript: msg.data
    });
    sendResponse({ ok: true });
    return true;
  }
});
