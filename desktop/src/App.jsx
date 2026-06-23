import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [devices, setDevices] = useState([])
  const [dragging, setDragging] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [fileOffer, setFileOffer] = useState(null)
  const [progress, setProgress] = useState(null)
  const [done, setDone] = useState(false)
  const [received, setReceived] = useState(0)

  useEffect(() => {
    window.electronAPI.on('device-found', (device) => {
      setDevices(prev => {
        const exists = prev.find(d => d.ip === device.ip)
        if (exists) return prev
        return [...prev, device]
      })
    })

    window.electronAPI.on('file-offer', (offer) => {
      setFileOffer(offer)
      setDone(false)
      setProgress(null)
      setReceived(0)
    })

    window.electronAPI.on('file-progress', ({ received: r, total }) => {
      setReceived(prev => {
        const newTotal = prev + r
        setProgress(Math.min(100, Math.round((newTotal / total) * 100)))
        return newTotal
      })
    })

    window.electronAPI.on('file-complete', () => {
      setDone(true)
      setFileOffer(null)
      setTimeout(() => setDone(false), 3000)
    })

    return () => {
      ['device-found','file-offer','file-progress','file-complete']
        .forEach(c => window.electronAPI.removeAllListeners(c))
    }
  }, [])

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (!selectedDevice) { alert('Seleccioná un dispositivo primero'); return }
    const files = Array.from(e.dataTransfer.files)
    files.forEach(file => {
      window.electronAPI.send('send-file', {
        filePath: file.path,
        fileName: file.name,
        fileSize: file.size,
        targetIP: selectedDevice.ip
      })
    })
  }

  return (
    <div className="app">
      <header>
        <h1>LocalSend</h1>
        <span className="status active">🟢 Activo</span>
      </header>

      <div className="devices">
        <h2>Dispositivos en la red</h2>
        {devices.length === 0 ? (
          <p className="empty">Buscando dispositivos...</p>
        ) : (
          devices.map((d, i) => (
            <div
              key={i}
              className={`device-card ${selectedDevice?.ip === d.ip ? 'selected' : ''}`}
              onClick={() => setSelectedDevice(d)}
            >
              <span>{d.deviceType === 'desktop' ? '🖥️' : '📱'}</span>
              <div>
                <strong>{d.alias}</strong>
                <small>{d.ip}</small>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Diálogo de oferta de archivo */}
      {fileOffer && (
        <div className="offer-modal">
          <div className="offer-box">
            <p>📥 <strong>{fileOffer.fileName}</strong></p>
            <small>{(fileOffer.fileSize / 1024 / 1024).toFixed(2)} MB</small>
            <div className="offer-actions">
              <button className="accept" onClick={() => {
                window.electronAPI.send('accept-file')
                setFileOffer(null)
              }}>Aceptar</button>
              <button className="reject" onClick={() => {
                window.electronAPI.send('reject-file')
                setFileOffer(null)
              }}>Rechazar</button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de progreso */}
      {progress !== null && (
        <div className="progress-bar-wrap">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
          <span>{progress}%</span>
        </div>
      )}

      {done && <p className="success">✅ Archivo recibido correctamente</p>}

      <div
        className={`dropzone ${dragging ? 'drag-over' : ''} ${selectedDevice ? 'ready' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {selectedDevice
          ? `📂 Soltá archivos para enviar a ${selectedDevice.alias}`
          : '📂 Seleccioná un dispositivo y arrastrá archivos aquí'}
      </div>
    </div>
  )
}

export default App