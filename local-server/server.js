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

// ─── Security headers ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('Cache-Control', 'no-store')
  next()
})

// ─── CORS: only chrome-extension:// origins ──────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('chrome-extension://')) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  }
}))

// ─── Body limit: 500 KB is plenty for article metadata ───────────────────────
app.use(express.json({ limit: '500kb' }))

// ─── Simple in-memory rate limiter: max 10 requests/minute per token ─────────
const rateLimitMap = new Map()
function rateLimit(req, res, next) {
  const now = Date.now()
  const key = req.headers.authorization || req.ip
  const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + 60000 }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000 }
  entry.count++
  rateLimitMap.set(key, entry)
  if (entry.count > 10) {
    return res.status(429).json({ success: false, error: 'Too many requests. Try again in a minute.' })
  }
  next()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
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

// ─── Validate that a URL is http/https and not a private/local address ────────
function isAllowedImageUrl(rawUrl) {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const h = u.hostname
    // Block private / loopback ranges
    if (/^localhost$/i.test(h)) return false
    if (/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
    if (/^::1$|^fc00:|^fe80:/.test(h)) return false
    return true
  } catch (e) { return false }
}

// ─── Fetch remote image to a secure temp file (max 3 redirects) ──────────────
function fetchImageToTempFile(imageUrl, depth = 0) {
  return new Promise((resolve) => {
    if (!imageUrl || depth > 2) return resolve(null)
    if (!isAllowedImageUrl(imageUrl)) return resolve(null)
    try {
      const parsedUrl = new URL(imageUrl)
      const lib = parsedUrl.protocol === 'https:' ? https : http
      const req = lib.get(imageUrl, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return fetchImageToTempFile(res.headers.location, depth + 1).then(resolve)
        }
        if (res.statusCode !== 200) return resolve(null)
        const contentType = res.headers['content-type'] || ''
        const mimeType = contentType.split(';')[0].trim()
        const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
        if (!extMap[mimeType]) return resolve(null) // reject unexpected MIME types
        const ext = extMap[mimeType]
        // Secure random filename — not guessable
        const rand = crypto.randomBytes(12).toString('hex')
        const tmpPath = path.join('/tmp', `nc-img-${rand}.${ext}`)
        const chunks = []
        let totalSize = 0
        res.on('data', (chunk) => {
          totalSize += chunk.length
          if (totalSize > 3 * 1024 * 1024) { res.destroy(); return resolve(null) }
          chunks.push(chunk)
        })
        res.on('end', () => {
          try {
            fs.writeFileSync(tmpPath, Buffer.concat(chunks), { mode: 0o600 }) // owner-only
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

// ─── Convert h1-h6 to bold (Apple Notes ignores heading tags via AppleScript) ─
function addHeadingSpacing(html) {
  if (!html) return html
  return html
    .replace(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi, '<p><br><b><u>$1</u></b></p>')
    .replace(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/gi, '<p><br><b>$1</b></p>')
    .replace(/<h[56][^>]*>([\s\S]*?)<\/h[56]>/gi, '<p><br><b><i>$1</i></b></p>')
}

// ─── Inline remote images in HTML → file:// paths ────────────────────────────
async function inlineImagesInHtml(html) {
  if (!html) return { html, tempFiles: [] }
  const srcRegex = /(<img[^>]*?\ssrc=")((https?:\/\/)[^"]+)(")/gi
  const matches = []
  let m
  while ((m = srcRegex.exec(html)) !== null) {
    matches.push({ original: m[0], prefix: m[1], url: m[2], suffix: m[4] })
    if (matches.length >= 15) break
  }
  const results = await Promise.all(
    matches.map(async (item) => {
      const tmpPath = await fetchImageToTempFile(item.url)
      return { ...item, tmpPath }
    })
  )
  let processed = html
  for (const r of results) {
    if (r.tmpPath) {
      processed = processed.replace(r.original, `${r.prefix}file://${r.tmpPath}${r.suffix}`)
    }
  }
  const tempFiles = results.filter(r => r.tmpPath).map(r => r.tmpPath)
  return { html: processed, tempFiles }
}

// ─── Escape special chars for AppleScript string literals ────────────────────
function escapeAppleScript(str) {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\\\')   // backslash first
    .replace(/"/g, '\\"')     // double quotes
    .replace(/\r/g, '')       // strip carriage returns
    .replace(/\n/g, '\\n')    // newlines
    .replace(/\t/g, ' ')      // tabs → space
    .replace(/\0/g, '')       // null bytes
}

// ─── Sanitise a plain-text field (strip control chars, limit length) ──────────
function sanitiseField(str, maxLen = 500) {
  if (!str) return ''
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen)
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/ping', authenticate, (req, res) => {
  res.json({ status: 'ok', folder: FOLDER })
})

app.post('/clip', authenticate, rateLimit, async (req, res) => {
  try {
    const raw = req.body
    const title       = sanitiseField(raw.title, 500)
    const url         = sanitiseField(raw.url, 2048)
    const content     = sanitiseField(raw.content, 200000)
    const contentHtml = typeof raw.contentHtml === 'string' ? raw.contentHtml.slice(0, 500000) : ''
    const author      = sanitiseField(raw.author || raw.byline, 200)
    const description = sanitiseField(raw.description, 500)
    const publishedDate = sanitiseField(raw.publishedDate || raw.date, 100)
    const savedDate   = sanitiseField(raw.savedDate, 100)
    const imageUrl    = sanitiseField(raw.imageUrl, 2048)

    if (!title)   return res.status(400).json({ success: false, error: 'Missing required field: title' })
    if (!url)     return res.status(400).json({ success: false, error: 'Missing required field: url' })
    if (!content) return res.status(400).json({ success: false, error: 'Missing required field: content' })

    // Validate article URL is a real http/https URL
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error()
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid article URL' })
    }

    // Fetch hero image + inline all article images in parallel
    const [heroTmpPath, inlined] = await Promise.all([
      isAllowedImageUrl(imageUrl) ? fetchImageToTempFile(imageUrl) : Promise.resolve(null),
      inlineImagesInHtml(contentHtml)
    ])
    const allTempFiles = [heroTmpPath, ...inlined.tempFiles].filter(Boolean)

    // Derive display values
    let domain = url
    try { domain = new URL(url).hostname.replace(/^www\./, '') } catch (e) {}
    const clipDate = savedDate || new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })

    // Build Obsidian-style metadata header
    let noteBody = ''
    if (heroTmpPath) noteBody += `<p><img src="file://${heroTmpPath}"></p>`
    noteBody += `<p><b>🔗 Source:</b> &nbsp;<a href="${url}">${domain}</a></p>`
    if (author)        noteBody += `<p><b>✍️ Author:</b> &nbsp;${author}</p>`
    if (publishedDate) noteBody += `<p><b>📅 Published:</b> &nbsp;${publishedDate}</p>`
    noteBody +=        `<p><b>🗓 Saved:</b> &nbsp;${clipDate}</p>`
    if (description)   noteBody += `<br><p><i>${description}</i></p>`
    noteBody += `<hr>`

    if (inlined.html) {
      noteBody += addHeadingSpacing(inlined.html)
    } else {
      const paragraphs = content.split(/\n{2,}/).filter(p => p.trim())
      noteBody += paragraphs.map(p => `<p>${p.trim()}</p>`).join('\n')
    }

    const escapedTitle  = escapeAppleScript(title)
    const escapedBody   = escapeAppleScript(noteBody)
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
      for (const f of allTempFiles) try { fs.unlinkSync(f) } catch (e) {}
      if (error) {
        console.error('AppleScript error:', stderr || error.message)
        // Return generic message — don't leak internals to client
        return res.status(500).json({ success: false, error: 'Failed to save note to Apple Notes.' })
      }
      res.json({ success: true, message: 'Saved to Notes' })
    })
  } catch (err) {
    console.error('Clip error:', err.message)
    res.status(500).json({ success: false, error: 'Internal server error' })
  }
})

// ─── Cleanup temp files on graceful shutdown ──────────────────────────────────
process.on('SIGTERM', () => {
  try {
    const files = fs.readdirSync('/tmp').filter(f => f.startsWith('nc-img-'))
    files.forEach(f => { try { fs.unlinkSync(path.join('/tmp', f)) } catch (e) {} })
  } catch (e) {}
  process.exit(0)
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Apple Notes Clipper server running on http://127.0.0.1:${PORT}`)
  console.log(`Notes folder: ${FOLDER}`)
})
