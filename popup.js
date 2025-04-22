document.addEventListener('DOMContentLoaded', () => {
    const meetingsList = document.getElementById('meetingsList');
    const deleteAllButton = document.getElementById('deleteAll');

    // Load and display meetings
    function loadMeetings() {
        chrome.storage.local.get(['meetings'], (result) => {
            const meetings = result.meetings || [];
            displayMeetings(meetings);
        });
    }

    // Display meetings in the list
    function displayMeetings(meetings) {
        meetingsList.innerHTML = '';
        
        if (meetings.length === 0) {
            meetingsList.innerHTML = '<div class="empty-state">No meetings recorded yet</div>';
            return;
        }

        meetings.forEach((meeting, index) => {
            const meetingElement = createMeetingElement(meeting, index);
            meetingsList.appendChild(meetingElement);
        });
    }

    // Create meeting element
    function createMeetingElement(meeting, index) {
        const div = document.createElement('div');
        div.className = 'meeting-item';
        
        const date = new Date(meeting.timestamp);
        const formattedDate = date.toLocaleString();

        div.innerHTML = `
            <div class="meeting-info">
                <div class="meeting-title">${meeting.title || 'Untitled Meeting'}</div>
                <div class="meeting-date">${formattedDate}</div>
            </div>
            <div class="meeting-actions">
                <button class="btn btn-save" data-index="${index}">Save</button>
                <button class="btn btn-delete" data-index="${index}">Delete</button>
            </div>
        `;

        return div;
    }

    // Save meeting to file
    function saveMeeting(meeting) {
        chrome.runtime.sendMessage({
            type: 'saveTranscript',
            data: meeting.transcript,
            title: meeting.title
        });
    }

    // Delete meeting
    function deleteMeeting(index) {
        chrome.storage.local.get(['meetings'], (result) => {
            const meetings = result.meetings || [];
            meetings.splice(index, 1);
            chrome.storage.local.set({ meetings }, () => {
                loadMeetings();
            });
        });
    }

    // Delete all meetings
    function deleteAllMeetings() {
        if (confirm('Are you sure you want to delete all meetings?')) {
            chrome.storage.local.set({ meetings: [] }, () => {
                loadMeetings();
            });
        }
    }

    // Event listeners
    meetingsList.addEventListener('click', (e) => {
        const index = e.target.dataset.index;
        if (!index) return;

        if (e.target.classList.contains('btn-save')) {
            chrome.storage.local.get(['meetings'], (result) => {
                const meetings = result.meetings || [];
                saveMeeting(meetings[index]);
            });
        } else if (e.target.classList.contains('btn-delete')) {
            deleteMeeting(index);
        }
    });

    deleteAllButton.addEventListener('click', deleteAllMeetings);

    // Initial load
    loadMeetings();
}); 