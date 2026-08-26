# STATUS – KinderKasse 2.7.0

Basis: KinderKasse 2.6.0.

Neu – optionale Kassenschublade:
- Standardmäßig deaktiviert.
- ESP32-C3 Super Mini + 5-V-Servo (z.B. MG90S).
- Keine Endschalter-/Sensorpflicht.
- Nach erfolgreicher Barzahlung optional automatisch öffnen.
- Docker/Server: ESP32-C3 pollt `/api/drawer/command` per WLAN/Cloudflare.
- Lokale APK: BLE-Gerät `KasseDrawer`.
- Eigener BLE-Service, getrennt von NFC-Box und Kundendisplay.
- Gemeinsamer BLE-Scan-Lock bleibt erhalten.
- Test-Öffnen in den Einstellungen im lokalen BLE-Modus.
- Fehler/fehlende Schublade blockieren die Barzahlung nicht.

Versionen:
- Frontend 2.7.0
- Backend 2.7.0
- Android versionName 2.7.0
- Android versionCode 13
- Drawer ESP32-C3 Firmware 1.0.0
