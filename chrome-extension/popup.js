document.addEventListener('DOMContentLoaded', async () => {
  await checkServerStatus()

  document.getElementById('optionsLink').addEventListener('click', () => {
    chrome.runtime.openOptionsPage()
  })

  document.getElementById('clipBtn').addEventListener('click', async () => {
    const btn = document.getElementById('clipBtn')
    btn.disabled = true
    setStatus('Clipping...')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      let articleData
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractArticle' })
        if (response?.success) {
          articleData = response.data
        }
      } catch (e) {
        // Content script not available, fall back to executeScript
      }

      if (!articleData) {
        // Inject Readability + extract directly as fallback
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['readability.js']
        })
        const extraction = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try {
              const clone = document.cloneNode(true)
              const reader = new Readability(clone)
              const article = reader.parse()
              return {
                title: article?.title || document.title,
                content: article?.textContent?.trim() || document.body.innerText.substring(0, 50000),
                contentHtml: article?.content || '',
                byline: article?.byline || '',
                url: window.location.href,
                date: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
              }
            } catch(e) {
              return {
                title: document.title,
                content: document.body.innerText.substring(0, 50000),
                contentHtml: '',
                byline: '',
                url: window.location.href,
                date: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
              }
            }
          }
        })
        articleData = extraction[0].result
      }

      chrome.runtime.sendMessage({
        action: 'clipToNotes',
        data: articleData
      }, (response) => {
        if (response?.success) {
          setStatus('✅ Saved to Apple Notes!')
          setTimeout(() => window.close(), 1500)
        } else {
          setStatus(response?.error || response?.result?.error || 'Something went wrong')
          btn.disabled = false
        }
      })
    } catch (err) {
      setStatus('Error: ' + err.message)
      btn.disabled = false
    }
  })
})

async function checkServerStatus() {
  const config = await new Promise(resolve => {
    chrome.storage.sync.get(['token', 'port'], resolve)
  })

  try {
    const port = config.port || 3333
    const res = await fetch(`http://localhost:${port}/ping`, {
      headers: { 'Authorization': `Bearer ${config.token || ''}` }
    })
    const data = await res.json()
    if (res.ok) {
      document.getElementById('status').innerHTML = '<span style="color:#22c55e">● Server running</span>'
      document.getElementById('folderName').textContent = data.folder
      document.getElementById('clipBtn').disabled = false
    } else {
      document.getElementById('status').innerHTML = '<span style="color:#ef4444">● Auth failed</span>'
    }
  } catch (e) {
    document.getElementById('status').innerHTML = '<span style="color:#ef4444">● Server offline</span>'
  }
}

function setStatus(message) {
  document.getElementById('clipStatus').textContent = message
}
