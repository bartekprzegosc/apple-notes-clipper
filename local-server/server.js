const express = require('express')
const cors = require('cors')
const { execFile } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const CONFIG_PATH = path.join(__dirname, 'config.json')

let config
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
} catch (err) {
  console.error('Failed to load config.json. Run "node setup.js" first.')
  process.exit(1)
}

if (!config.token || config.token === 'REPLACE_WITH_GENERATED_TOKEN') {
  console.error('Invalid token in config.json. Run "node setup.js" first.')
  process.exit(1)
}

const PORT = config.port || 3333
const TOKEN = config.token
const FOLDER = config.notesFolder || 'Media Vault'

const app = express()

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('chrome-extension://')) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  }
}))

app.use(express.json({ limit: '5mb' }))

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid authorization header' })
  }
  const token = authHeader.slice(7)
  const tokenBuf = Buffer.from(token)
  const expectedBuf = Buffer.from(TOKEN)
  if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
    return res.status(401).json({ success: false, error: 'Invalid token' })
  }
  next()
}

// Fetch a remote image, save to a temp file, return { filePath, ext } or null on failure
function fetchImageToTempFile(imageUrl) {
  return new Promise((resolve) => {
    if (!imageUrl) return resolve(null)
    try {
      const parsedUrl = new URL(imageUrl)
      const lib = parsedUrl.protocol === 'https:' ? https : http
      const req = lib.get(imageUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        // Follow one redirect
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return fetchImageToTempFile(res.headers.location).then(resolve)
        }
        if (res.statusCode !== 200) return resolve(null)
        const contentType = res.headers['content-type'] || 'image/jpeg'
        const mimeType = contentType.split(';')[0].trim()
        const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
        const ext = extMap[mimeType] || 'jpg'
        const tmpPath = path.join('/tmp', `notes-hero-${Date.now()}.${ext}`)
        const chunks = []
        let totalSize = 0
        res.on('data', (chunk) => {
          totalSize += chunk.length
          if (totalSize > 3 * 1024 * 1024) { res.destroy(); return resolve(null) } // skip >3MB
          chunks.push(chunk)
        })
        res.on('end', () => {
          try {
            fs.writeFileSync(tmpPath, Buffer.concat(chunks))
            resolve(tmpPath)
          } catch (e) { resolve(null) }
        })
        res.on('error', () => resolve(null))
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    } catch (e) {
      resolve(null)
    }
  })
}

// Convert headings to bold (Apple Notes ignores h1-h6 via AppleScript)
// h1/h2 → bold + underline, h3/h4 → bold, h5/h6 → bold italic
function addHeadingSpacing(html) {
  if (!html) return html
  return html
    .replace(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi, '<p><br><b><u>$1</u></b></p>')
    .replace(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/gi, '<p><br><b>$1</b></p>')
    .replace(/<h[56][^>]*>([\s\S]*?)<\/h[56]>/gi, '<p><br><b><i>$1</i></b></p>')
}

// Download all remote images in HTML to temp files, replace src with file:// URLs
// Returns { html, tempFiles[] } — tempFiles must be cleaned up after use
async function inlineImagesInHtml(html) {
  if (!html) return { html, tempFiles: [] }

  // Collect unique remote image URLs (max 15 images per article)
  const srcRegex = /(<img[^>]*?\ssrc=")((https?:\/\/)[^"]+)(")/gi
  const matches = []
  let m
  while ((m = srcRegex.exec(html)) !== null) {
    matches.push({ original: m[0], prefix: m[1], url: m[2], suffix: m[4] })
    if (matches.length >= 15) break
  }

  // Download all images in parallel
  const results = await Promise.all(
    matches.map(async (item) => {
      const tmpPath = await fetchImageToTempFile(item.url)
      return { ...item, tmpPath }
    })
  )

  // Replace each matched src with file:// path (or keep original if download failed)
  let processed = html
  for (const r of results) {
    if (r.tmpPath) {
      processed = processed.replace(r.original, `${r.prefix}file://${r.tmpPath}${r.suffix}`)
    }
  }

  const tempFiles = results.filter(r => r.tmpPath).map(r => r.tmpPath)
  return { html: processed, tempFiles }
}

function escapeAppleScript(str) {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
}

app.get('/ping', authenticate, (req, res) => {
  res.json({ status: 'ok', folder: FOLDER })
})

app.post('/clip', authenticate, async (req, res) => {
  try {
    const { title, url, content, contentHtml, author, date, imageUrl, description, publishedDate, savedDate, byline } = req.body

    if (!title) return res.status(400).json({ success: false, error: 'Missing required field: title' })
    if (!url) return res.status(400).json({ success: false, error: 'Missing required field: url' })
    if (!content) return res.status(400).json({ success: false, error: 'Missing required field: content' })

    // Fetch hero image + inline all article images in parallel
    const [heroTmpPath, inlined] = await Promise.all([
      fetchImageToTempFile(imageUrl || ''),
      inlineImagesInHtml(contentHtml || '')
    ])
    const allTempFiles = [heroTmpPath, ...inlined.tempFiles].filter(Boolean)

    // Derive display values
    let domain = url
    try { domain = new URL(url).hostname.replace(/^www\./, '') } catch (e) {}
    const authorDisplay = author || byline || ''
    const pubDate = publishedDate || date || ''
    const clipDate = savedDate || new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })

    // Build Obsidian-style metadata header
    let noteBody = ''
    if (heroTmpPath) {
      noteBody += `<p><img src="file://${heroTmpPath}"></p>`
    }
    noteBody += `<p><b>🔗 Source:</b> &nbsp;<a href="${url}">${domain}</a></p>`
    if (authorDisplay) noteBody += `<p><b>✍️ Author:</b> &nbsp;${authorDisplay}</p>`
    if (pubDate)       noteBody += `<p><b>📅 Published:</b> &nbsp;${pubDate}</p>`
    noteBody +=        `<p><b>🗓 Saved:</b> &nbsp;${clipDate}</p>`
    if (description)   noteBody += `<br><p><i>${description}</i></p>`
    noteBody += `<hr>`

    if (inlined.html) {
      noteBody += addHeadingSpacing(inlined.html)
    } else {
      const paragraphs = content.split(/\n{2,}/).filter(p => p.trim())
      noteBody += paragraphs.map(p => `<p>${p.trim()}</p>`).join('\n')
    }

    const escapedTitle = escapeAppleScript(title)
    const escapedBody = escapeAppleScript(noteBody)
    const escapedFolder = escapeAppleScript(FOLDER)

    const appleScript = `
tell application "Notes"
  tell account "iCloud"
    set targetFolder to missing value
    repeat with f in every folder
      if name of f is "${escapedFolder}" then
        set targetFolder to f
        exit repeat
      end if
    end repeat
    if targetFolder is missing value then
      set targetFolder to make new folder with properties {name:"${escapedFolder}"}
    end if
    tell targetFolder
      make new note with properties {name:"${escapedTitle}", body:"${escapedBody}"}
    end tell
  end tell
end tell`

    execFile('osascript', ['-e', appleScript], { timeout: 30000 }, (error, stdout, stderr) => {
      // Clean up all temp image files regardless of outcome
      for (const f of allTempFiles) try { fs.unlinkSync(f) } catch (e) {}
      if (error) {
        console.error('AppleScript error:', stderr || error.message)
        return res.status(500).json({
          success: false,
          error: 'Failed to save note: ' + (stderr || error.message)
        })
      }
      res.json({ success: true, message: 'Saved to Notes' })
    })
  } catch (err) {
    console.error('Clip error:', err.message)
    res.status(500).json({ success: false, error: 'Internal server error' })
  }
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Apple Notes Clipper server running on http://127.0.0.1:${PORT}`)
  console.log(`Notes folder: ${FOLDER}`)
})
