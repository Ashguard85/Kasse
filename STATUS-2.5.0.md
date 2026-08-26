# STATUS – KinderKasse 2.5.0

Basis: KinderKasse 2.4.0.

Kundenanzeige vereinheitlicht:
- Auswahl pro Profil: ESP32 Display-Box oder zweites Gerät.
- ESP32 + Server/Docker: WLAN/Cloudflare über `/api/customer-display`.
- ESP32 + lokale Android-APK: BLE (`KasseDisplay`).
- Zweites Handy/Tablet + Server/Docker: dieselbe KinderKasse über `#/kundendisplay`.
- Zweites Handy/Tablet + lokale Android-APK: direkter LAN/Hotspot-Displayserver auf Port 3890.
- Die Kassen-APK zeigt die lokale Display-Adresse an.
- Die Display-APK speichert diese Adresse und startet danach direkt als Kundenanzeige.
- Aktives Profil, Theme, Warenkorb, Zahlungsstatus, Gegeben und Rückgeld werden übertragen.
- NFC-Box und ESP32-Display verwenden getrennte BLE-Services und einen gemeinsamen Scan-Lock.
- Bluetooth-ESC/POS-Drucker bleibt separat über Bluetooth Classic/RFCOMM.
- Release-Signierung bleibt unverändert erhalten.

Versionen:
- Frontend 2.5.0
- Backend 2.5.0
- Android versionName 2.5.0
- Android versionCode 10
