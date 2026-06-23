const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const dgram = require('dgram')
const { WebSocketServer, WebSocket } = require('ws')
const os = require('os')
const fs = require('fs')
const http = require('http')

const UDP_PORT = 53317
const WS_PORT = 53318

function getLocalIP() {
  const interfaces = os.networkInterfaces()
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) return alias.address
    }
  }
  return '127.0.0.1'
}

function startUDPServer(win) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString())
      if (data.type === 'beacon') {
        win.webContents.send('device-found', {
          alias: data.alias,
          ip: rinfo.address,
          deviceType: data.deviceType
        })
      }
    } catch (e) {}
  })

  socket.bind(UDP_PORT, () => {
    socket.setBroadcast(true)
    console.log('UDP escuchando en', UDP_PORT)
  })

  setInterval(() => {
    const beacon = JSON.stringify({
      type: 'beacon',
      alias: os.hostname(),
      deviceType: 'desktop',
      ip: getLocalIP()
    })
    const buf = Buffer.from(beacon)
    socket.send(buf, 0, buf.length, UDP_PORT, '255.255.255.255')
  }, 3000)
}

function startWSServer(win) {
  const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' })
      res.end('pong')
    }
  })

  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws) => {
    global.activeWS = ws
    let fileStream = null
    let fileInfo = null

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'file-offer') {
          fileInfo = msg
          win.webContents.send('file-offer', msg)
        }
        if (msg.type === 'accepted') {
          const savePath = path.join(os.homedir(), 'Downloads', fileInfo.fileName)
          fileStream = fs.createWriteStream(savePath)
          ws.send(JSON.stringify({ type: 'ready' }))
        }
      } else {
        if (fileStream) {
          fileStream.write(data)
          win.webContents.send('file-progress', {
            received: data.length,
            total: fileInfo?.fileSize
          })
        }
      }
    })

    ws.on('close', () => {
      if (fileStream) {
        fileStream.end()
        win.webContents.send('file-complete')
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
    startUDPServer(win)
    console.log('UDP OK')
    startWSServer(win)
    console.log('WS OK')
  } catch(e) {
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
  if (process.platform !== 'darwin') app.quit()
})