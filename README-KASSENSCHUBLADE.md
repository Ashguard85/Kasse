# Kassenschublade – KinderKasse 2.7.0

Hardware-Minimalaufbau:
- ESP32-C3 Super Mini
- 5-V-Servo, empfohlen MG90S
- USB-C / 5-V-Versorgung
- empfohlen 470–1000 µF Kondensator am Servo

Die Mechanik/Verriegelung bleibt frei.

Einstellungen → Kassenschublade:
- Kassenschublade aktivieren
- Nach erfolgreicher Barzahlung öffnen

Docker/Server:
Der ESP32 pollt `/api/drawer/command` über WLAN. Cloudflare Service Token kann in
der Drawer-Firmware hinterlegt werden.

Lokale APK:
Einmal `KasseDrawer` per BLE verbinden. Danach Auto-Reconnect.

Der OPEN-Befehl wird erst nach erfolgreicher Speicherung einer Barzahlung ausgelöst.
Die Schublade ist optional; Verbindungsfehler ändern den Verkauf nicht.
