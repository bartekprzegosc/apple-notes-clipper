chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'clipToNotes') {
    chrome.storage.local.get(['token', 'port', 'notesFolder'], async (config) => {
      try {
        const port = config.port || 3333
        const token = config.token || ''
        const response = await fetch(`http://127.0.0.1:${port}/clip`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(request.data)
        })
        const result = await response.json()
        sendResponse({ success: response.ok, result })
      } catch (e) {
        sendResponse({ success: false, error: 'Cannot connect to local server. Is it running?' })
      }
    })
    return true
  }
})
