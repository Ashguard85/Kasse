# KinderKasse Display-Box

Passende Firmware: `KinderKasse-DisplayBox-ESP32-S3-v1.1.0.zip`

Docker-Modus:
- Display ruft `/api/customer-display` über WLAN ab.
- Keine Profil-ID erforderlich.
- Cloudflare Access Service Token kann per Header mitgesendet werden.

Lokaler APK-Modus:
- Display-Box per BLE als `KasseDisplay` verbinden.
- BLE Service UUID: `7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10`
- Einmal in Einstellungen verbinden, danach Auto-Reconnect.
