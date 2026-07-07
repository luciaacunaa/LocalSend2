import { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, FlatList,
  Alert, ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { styles } from "./styles/main";

const WS_PORT = 53318;

const fetchWithTimeout = (url, ms) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    fetch(url)
      .then((res) => { clearTimeout(timer); resolve(res) })
      .catch((err) => { clearTimeout(timer); reject(err) })
  })
}

export default function App() {
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [progress, setProgress] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    startScanning();
  }, []);

  const startScanning = async () => {
    setScanning(true);
    setDevices([]);

    const bases = ["10.56.2", "10.56.4", "10.56.5"];
    const found = [];
    const promises = [];

    for (const base of bases) {
      for (let i = 1; i <= 254; i++) {
        const targetIP = `${base}.${i}`;
        promises.push(
          fetchWithTimeout(`http://${targetIP}:${WS_PORT}/ping`, 800)
            .then((res) => {
              console.log('RESPUESTA:', targetIP, res.status)
              if (!found.find(d => d.ip === targetIP)) {
                found.push({ ip: targetIP, alias: targetIP, deviceType: "desktop" })
              }
            })
            .catch((err) => {
              if (err.message !== 'timeout') console.log('ERROR:', targetIP, err.message)
            })
        );
      }
    }

    await Promise.all(promises);
    console.log('Escaneo completo, encontrados:', found.length)
    setDevices(found);
    setScanning(false);
  };

  const sendFile = async () => {
    if (!selectedDevice) { Alert.alert("Seleccioná un dispositivo"); return; }

    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return;

    const file = result.assets[0];
    const ws = new WebSocket(`ws://${selectedDevice.ip}:${WS_PORT}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "file-offer", fileName: file.name, fileSize: file.size }));
    };
 
    ws.onmessage = async (e) => {
    console.log('MENSAJE RECIBIDO:', e.data)
    const msg = JSON.parse(e.data);
    if (msg.type === "ready") {
        const response = await fetch(file.uri);
        const buffer = await response.arrayBuffer();
        const chunkSize = 64 * 1024;
        let offset = 0;
        while (offset < buffer.byteLength) {
          const chunk = buffer.slice(offset, offset + chunkSize);
          ws.send(chunk);
          offset += chunkSize;
          setProgress(Math.round((offset / buffer.byteLength) * 100));
        }
        ws.close();
        setProgress(null);
        Alert.alert("✅ Enviado", `${file.name} enviado correctamente`);
      }
      if (msg.type === "rejected") {
        Alert.alert("❌ Rechazado", "El receptor rechazó el archivo");
        ws.close();
        setProgress(null);
      }
    };

    ws.onerror = () => {
      Alert.alert("Error", "No se pudo conectar al dispositivo");
      setProgress(null);
    };
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LocalSend</Text>

      <TouchableOpacity style={styles.scanBtn} onPress={startScanning}>
        <Text style={styles.scanBtnText}>🔍 Buscar dispositivos</Text>
      </TouchableOpacity>

      {scanning && (
        <View style={styles.scanningWrap}>
          <ActivityIndicator color="#4ade80" />
          <Text style={styles.scanningText}>Escaneando red...</Text>
        </View>
      )}

      <Text style={styles.subtitle}>Dispositivos encontrados</Text>

      <FlatList
        data={devices}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.device, selectedDevice?.ip === item.ip && styles.deviceSelected]}
            onPress={() => setSelectedDevice(item)}
          >
            <Text style={styles.deviceIcon}>🖥️</Text>
            <View>
              <Text style={styles.deviceName}>{item.alias}</Text>
              <Text style={styles.deviceIP}>{item.ip}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !scanning && <Text style={styles.empty}>No se encontraron dispositivos</Text>
        }
      />

      {progress !== null && (
        <View style={styles.progressWrap}>
          <View style={[styles.progressBar, { width: `${progress}%` }]} />
          <Text style={styles.progressText}>{progress}%</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.sendBtn, !selectedDevice && styles.sendBtnDisabled]}
        onPress={sendFile}
        disabled={!selectedDevice}
      >
        <Text style={styles.sendBtnText}>📂 Seleccionar y enviar archivo</Text>
      </TouchableOpacity>
    </View>
  );
}