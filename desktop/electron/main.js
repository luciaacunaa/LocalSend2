const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { WebSocketServer, WebSocket } = require('ws')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { Bonjour } = require('bonjour-service')

// @ts-ignore 
const WS_PORT = 53318
const bonjour = new Bonjour()

function getLocalIP() {
  const interfaces = os.networkInterfaces()
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) return alias.address
    }
  }
  return '127.0.0.1'
}

function startMDNS() {
  bonjour.publish({
    name: os.hostname(),
    type: 'localsend',
    port: WS_PORT,
    txt: { alias: os.hostname(), deviceType: 'desktop' }
  })
  console.log('mDNS publicado:', os.hostname())
}

function startWSServer(win) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (req.url === '/ping') {
      res.writeHead(200)
      res.end('pong')
    } else if (req.url === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        alias: os.hostname(),
        deviceType: 'desktop',
        ip: getLocalIP()
      }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })


  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws) => {
    global.activeWS = ws
    let fileStream = null
    let fileInfo = null
    let bytesReceived = 0

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const msg = JSON.parse(data.toString())

        if (msg.type === 'file-offer') {
          fileInfo = msg
          win.webContents.send('file-offer', msg)
        }

        if (msg.type === 'accepted') {
          let savePath = path.join(os.homedir(), 'Downloads', fileInfo.fileName)

          if (fs.existsSync(savePath)) {
            const ext = path.extname(fileInfo.fileName)
            const base = path.basename(fileInfo.fileName, ext)
            savePath = path.join(os.homedir(), 'Downloads', `${base}_${Date.now()}${ext}`)
          }

          fileStream = fs.createWriteStream(savePath)
          bytesReceived = 0
          ws.send(JSON.stringify({ type: 'ready' }))
        }
      } else {
        if (fileStream) {
          fileStream.write(data)
          bytesReceived += data.length
          win.webContents.send('file-progress', {
            received: bytesReceived,
            total: fileInfo?.fileSize
          })
        }
      }
    })

    ws.on('close', () => {
      if (fileStream) {
        fileStream.end()
        win.webContents.send('file-complete')
        fileStream = null
      }
    })

    ws.on('error', (err) => {
      console.error('WS error:', err)
      if (fileStream) {
        fileStream.destroy()
        fileStream = null
      }
    })
  })

  server.listen(WS_PORT, '0.0.0.0', () => {
    console.log('HTTP+WS escuchando en', WS_PORT)
  })
}

ipcMain.on('accept-file', () => {
  global.activeWS?.send(JSON.stringify({ type: 'accepted' }))
})

ipcMain.on('reject-file', () => {
  global.activeWS?.send(JSON.stringify({ type: 'rejected' }))
  global.activeWS?.close()
})

ipcMain.on('send-file', (event, { filePath, fileName, fileSize, targetIP }) => {
  const ws = new WebSocket(`ws://${targetIP}:${WS_PORT}`)

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'file-offer', fileName, fileSize }))
  })

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'ready') {
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })
      stream.on('data', (chunk) => ws.send(chunk))
      stream.on('end', () => ws.close())
    }
  })

  ws.on('error', (err) => {
    console.error('Send error:', err)
  })
})

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  try {
    startWSServer(win)
    console.log('WS OK')
    startMDNS()
  } catch (e) {
    console.error('ERROR EN SERVIDORES:', e)
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  bonjour.destroy()
  if (process.platform !== 'darwin') app.quit()
})