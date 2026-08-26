# STATUS – KinderKasse 2.7.1

Basis: KinderKasse 2.7.0.

Diese Version konsolidiert den aktuellen Gesamtstand und integriert die
Zusatzgeräte sauber in Source- und Docker-Paket.

## Aktueller Funktionsstand

### Kasse / Profile
- beliebig viele Profile
- gemeinsame Kundenstammdaten
- Guthaben/Aktivierung pro Profil
- eigene Produkte, Verkäufe, Statistiken und Designs pro Profil
- Kassenmodus mit PIN/Recovery

### Zahlungen
- NFC / QR / Kundenguthaben
- Barzahlung
- optionale Rückgeld-Stückelung
- optionaler Zahlungs-PIN pro Kunde:
  - aus
  - immer
  - ab Betrag

### NFC-Box
- eigenes BLE-Gerät `KasseNFC`
- vorhandener Quellcode bleibt enthalten
- zusätzlich unter `devices/nfc-box/` einsortiert

### Kundendisplay
- ESP32-S3 4.3" per WLAN/Cloudflare im Servermodus
- ESP32-S3 per BLE im lokalen APK-Modus
- zweites Handy/Tablet über Docker-Webanzeige
- zweites Handy/Tablet lokal per WLAN/Hotspot
- neueste Artikel bleiben sichtbar
- PIN-Eingabe am Kundenterminal
- Firmware 1.1.0 im Paket unter `devices/`

### Kassenschublade
- vollständig optional
- ESP32-C3 Super Mini + 5-V-Servo
- Docker/Server per WLAN/Cloudflare
- lokale APK per BLE als `KasseDrawer`
- öffnet optional erst nach erfolgreich gespeicherter Barzahlung
- Firmware 1.0.0 im Paket unter `devices/`

### BLE-Zusammenspiel
- `KasseNFC`
- `KasseDisplay`
- `KasseDrawer`
- getrennte Services
- gemeinsamer Scan-Lock in der Android-App

## Dokumentation aktualisiert

- README-Docker.md → 2.7.1 Gesamtübersicht
- README-Android.md → 2.7.1
- APK_BUILD_README.md → 2.7.1
- README-KUNDENDISPLAY.md → aktueller Stand
- README-DISPLAYBOX.md → aktueller Stand
- README-KASSENSCHUBLADE.md → aktueller Stand
- README-ZAHLUNGS-PIN.md → aktueller Stand

## Versionen

- KinderKasse 2.7.1
- Frontend 2.7.1
- Backend 2.7.1
- Android versionName 2.7.1
- Android versionCode 14
- ESP32-S3 Display-Firmware 1.1.0
- ESP32-C3 Drawer-Firmware 1.0.0

Ein Datenbank-Reset ist für dieses Update nicht erforderlich.
