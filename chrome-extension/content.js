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

function extractArticle() {
  try {
    const documentClone = document.cloneNode(true)
    const reader = new Readability(documentClone)
    const article = reader.parse()
    return {
      title: article?.title || document.title,
      content: article?.textContent?.trim() || '',
      contentHtml: article?.content || '',
      excerpt: article?.excerpt || '',
      byline: article?.byline || '',
      imageUrl: getHeroImage(),
      url: window.location.href,
      date: new Date().toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }
  } catch (e) {
    return {
      title: document.title,
      content: document.body.innerText.substring(0, 50000),
      contentHtml: '',
      excerpt: '',
      byline: '',
      imageUrl: getHeroImage(),
      url: window.location.href,
      date: new Date().toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
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
