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

// Add breathing room around headings
function addHeadingSpacing(html) {
  if (!html) return html
  return html
    .replace(/<(h[1-6])/gi, '<br><$1')
    .replace(/<\/(h[1-6])>/gi, '</$1><br>')
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
    const { title, url, content, author, date, imageUrl } = req.body

    if (!title) return res.status(400).json({ success: false, error: 'Missing required field: title' })
    if (!url) return res.status(400).json({ success: false, error: 'Missing required field: url' })
    if (!content) return res.status(400).json({ success: false, error: 'Missing required field: content' })

    // Fetch hero image to a temp file (if it fails, note saves without image)
    const heroTmpPath = await fetchImageToTempFile(imageUrl || '')

    // Build HTML body for rich Apple Notes formatting
    const { contentHtml } = req.body
    let meta = `<a href="${url}">${url}</a>`
    if (date) meta += ` &nbsp;·&nbsp; 📅 ${date}`
    if (author) meta += ` &nbsp;·&nbsp; ✍️ ${author}`

    // Note title is set via AppleScript name: property — no duplicate h1 in body
    let noteBody = ''
    if (heroTmpPath) {
      // file:// URL so Apple Notes reads the local image inline (not as attachment)
      noteBody += `<p><img src="file://${heroTmpPath}"></p>`
    }
    noteBody += `<p>${meta}</p>`
    noteBody += `<hr>`

    if (contentHtml) {
      // Use structured HTML from Readability, with heading spacing added
      noteBody += addHeadingSpacing(contentHtml)
    } else {
      // Fallback: plain text wrapped in paragraphs
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

    execFile('osascript', ['-e', appleScript], { timeout: 15000 }, (error, stdout, stderr) => {
      // Clean up temp image file regardless of outcome
      if (heroTmpPath) try { fs.unlinkSync(heroTmpPath) } catch (e) {}
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
