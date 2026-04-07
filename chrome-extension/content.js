function getHeroImage() {
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[property="og:image:secure_url"]'
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el && el.content) return el.content
  }
  return ''
}

function getDescription() {
  const selectors = [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]'
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el && el.content) return el.content.trim()
  }
  return ''
}

function getPublishedDate() {
  // Try meta tags first
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="publish-date"]',
    'meta[name="publication_date"]',
    'meta[itemprop="datePublished"]'
  ]
  for (const sel of metaSelectors) {
    const el = document.querySelector(sel)
    if (el && el.content) {
      const d = new Date(el.content)
      if (!isNaN(d)) return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
    }
  }
  // Try JSON-LD
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      const json = JSON.parse(s.textContent)
      const objs = Array.isArray(json) ? json : [json]
      for (const obj of objs) {
        const raw = obj.datePublished || obj.dateCreated
        if (raw) {
          const d = new Date(raw)
          if (!isNaN(d)) return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
        }
      }
    }
  } catch (e) {}
  return ''
}

function todayFormatted() {
  return new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
}

function extractArticle() {
  const imageUrl = getHeroImage()
  const description = getDescription()
  const publishedDate = getPublishedDate()
  const savedDate = todayFormatted()
  try {
    const documentClone = document.cloneNode(true)
    const reader = new Readability(documentClone)
    const article = reader.parse()
    return {
      title: article?.title || document.title,
      content: article?.textContent?.trim() || '',
      contentHtml: article?.content || '',
      byline: article?.byline || '',
      imageUrl,
      description,
      publishedDate,
      savedDate,
      url: window.location.href
    }
  } catch (e) {
    return {
      title: document.title,
      content: document.body.innerText.substring(0, 50000),
      contentHtml: '',
      byline: '',
      imageUrl,
      description,
      publishedDate,
      savedDate,
      url: window.location.href
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractArticle') {
    try {
      sendResponse({ success: true, data: extractArticle() })
    } catch (e) {
      sendResponse({ success: false, error: e.message })
    }
  }
  return true
})
