# KinderKasse Kassenschublade – ESP32-C3 – Firmware 1.0.0

Für einen **ESP32-C3 Super Mini + 5-V-Servo (z. B. MG90S)**.

Die Mechanik ist absichtlich nicht vorgegeben. Die Firmware macht nur:

1. Servo in Ruhestellung.
2. `OPEN` empfangen.
3. Servo von 0° auf 40° drehen.
4. 400 ms halten.
5. Servo zurück auf 0°.

Die Winkel und Haltezeit stehen oben in `src/main.cpp` und können an deine
selbstgebaute Verriegelung angepasst werden.

## Verdrahtung

- ESP32-C3 GPIO4 → Servo Signal
- USB 5 V → Servo 5 V
- USB GND → Servo GND und ESP32 GND
- ESP32-C3 über USB-C versorgen

Empfohlen: 470–1000 µF Kondensator zwischen 5 V und GND nahe am Servo.

**Servo nicht aus dem 3,3-V-Pin versorgen.**

## Betriebsarten

### Docker / Server / Cloudflare

Die Box verbindet sich mit WLAN und fragt regelmäßig ab:

`/api/drawer/command`

Beim ersten Start erzeugt sie das WLAN:

`KinderKasse-Drawer-Setup`

Im Portal können eingetragen werden:
- KinderKasse Server URL
- Cloudflare Client ID (optional)
- Cloudflare Client Secret (optional)

Eine alte OPEN-Anweisung wird beim Neustart nicht erneut ausgeführt.

### Lokale Android-APK ohne Docker

BLE-Gerätename:

`KasseDrawer`

Service:
`7a0f2001-1b55-4e2a-9c2e-9a6b9f3a2c10`

Command Characteristic:
`7a0f2002-1b55-4e2a-9c2e-9a6b9f3a2c10`

KinderKasse sendet einfach `OPEN`.

## KinderKasse

In KinderKasse:
Einstellungen → Kassenschublade

Die Funktion ist standardmäßig **deaktiviert**. Wenn sie deaktiviert ist, hat sie
keinen Einfluss auf Barzahlungen.

Bei aktivierter Option „Nach erfolgreicher Barzahlung öffnen“ kommt der OPEN-Befehl
erst nachdem der Verkauf erfolgreich gespeichert wurde.

## Flashen

Projekt in VS Code/PlatformIO öffnen, ESP32-C3 Super Mini per USB anschließen und
`Upload` ausführen.

Falls dein konkreter C3-Super-Mini ein anderes Boardprofil benötigt, bleibt der
Quellcode gleich; nur `board` in `platformio.ini` muss angepasst werden.

## HTTPS-Hinweis

Firmware 1.0.0 verwendet bei HTTPS `setInsecure()`. Die Verbindung ist verschlüsselt,
das Serverzertifikat wird aber nicht validiert. Für einen dauerhaft eingesetzten
Cloudflare-Service-Token ist CA-Pinning als spätere Härtung sinnvoll.
