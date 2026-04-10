const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, 'config.json')

function setup() {
  try {
    let config = {}

    if (fs.existsSync(CONFIG_PATH)) {
      const existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      if (existing.token && existing.token !== 'REPLACE_WITH_GENERATED_TOKEN') {
        console.log('Config already exists with a valid token.')
        console.log('To regenerate, delete config.json and run setup again.')
        return
      }
      config = existing
    }

    const token = crypto.randomBytes(32).toString('hex')

    config.token = token
    config.port = config.port || 3333
    config.notesFolder = config.notesFolder || 'Media Vault'

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })

    console.log('')
    console.log('Apple Notes Clipper — Setup Complete')
    console.log('====================================')
    console.log('')
    console.log('Your secret token (copy this to the Chrome extension options):')
    console.log('')
    console.log(`  ${token}`)
    console.log('')
    console.log(`Server port: ${config.port}`)
    console.log(`Notes folder: ${config.notesFolder}`)
    console.log('')
    console.log('Config saved to: ' + CONFIG_PATH)
    console.log('')
  } catch (err) {
    console.error('Setup failed:', err.message)
    process.exit(1)
  }
}

setup()
