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
            function getMeta(...selectors) {
              for (const sel of selectors) {
                const el = document.querySelector(sel)
                if (el && el.content) return el.content.trim()
              }
              return ''
            }
            function getPublishedDate() {
              const raw = getMeta(
                'meta[property="article:published_time"]',
                'meta[property="og:article:published_time"]',
                'meta[name="publish-date"]',
                'meta[itemprop="datePublished"]'
              )
              if (raw) { const d = new Date(raw); if (!isNaN(d)) return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) }
              try {
                for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
                  const objs = [].concat(JSON.parse(s.textContent))
                  for (const o of objs) {
                    const dp = o.datePublished || o.dateCreated
                    if (dp) { const d = new Date(dp); if (!isNaN(d)) return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) }
                  }
                }
              } catch(e) {}
              return ''
            }
            const imageUrl = getMeta('meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]')
            const description = getMeta('meta[property="og:description"]', 'meta[name="twitter:description"]', 'meta[name="description"]')
            const publishedDate = getPublishedDate()
            const savedDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
            try {
              const clone = document.cloneNode(true)
              const reader = new Readability(clone)
              const article = reader.parse()
              return {
                title: article?.title || document.title,
                content: article?.textContent?.trim() || document.body.innerText.substring(0, 50000),
                contentHtml: article?.content || '',
                byline: article?.byline || '',
                imageUrl, description, publishedDate, savedDate,
                url: window.location.href
              }
            } catch(e) {
              return {
                title: document.title,
                content: document.body.innerText.substring(0, 50000),
                contentHtml: '', byline: '',
                imageUrl, description, publishedDate, savedDate,
                url: window.location.href
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
    chrome.storage.local.get(['token', 'port'], resolve)
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
