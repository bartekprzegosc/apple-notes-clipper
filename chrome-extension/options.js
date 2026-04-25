document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('token')
  const toggleBtn = document.getElementById('toggleToken')
  toggleBtn.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password'
    tokenInput.type = isPassword ? 'text' : 'password'
    toggleBtn.textContent = isPassword ? 'Hide' : 'Show'
  })

  chrome.storage.local.get(['token', 'port', 'notesFolder'], (config) => {
    document.getElementById('port').value = config.port || 3333
    document.getElementById('token').value = config.token || ''
    document.getElementById('notesFolder').value = config.notesFolder || 'Media Vault'
  })

  document.getElementById('saveBtn').addEventListener('click', () => {
    const config = {
      port: parseInt(document.getElementById('port').value, 10) || 3333,
      token: document.getElementById('token').value.trim(),
      notesFolder: document.getElementById('notesFolder').value.trim() || 'Media Vault'
    }

    if (!config.token) {
      setStatus('Please enter a token', 'error')
      return
    }

    chrome.storage.local.set(config, () => {
      setStatus('Settings saved!', 'success')
    })
  })

  document.getElementById('testBtn').addEventListener('click', async () => {
    const port = parseInt(document.getElementById('port').value, 10) || 3333
    const token = document.getElementById('token').value.trim()

    if (!token) {
      setStatus('Enter a token first', 'error')
      return
    }

    setStatus('Testing...', 'info')

    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (res.ok) {
        setStatus(`Connected! Folder: ${data.folder}`, 'success')
      } else {
        setStatus(`Auth failed: ${data.error}`, 'error')
      }
    } catch (e) {
      setStatus('Cannot connect. Is the server running?', 'error')
    }
  })
})

function setStatus(message, type) {
  const el = document.getElementById('statusMsg')
  el.textContent = message
  const colors = { success: '#22c55e', error: '#ef4444', info: '#8b7355' }
  el.style.color = colors[type] || '#5b4636'
}
