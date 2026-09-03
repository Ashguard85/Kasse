# KinderKasse – Kundendisplay

Diese Anleitung gehört zur **Display-Box** der KinderKasse. Sie enthält Material, Arduino-IDE-Setup, Flash-Anleitung, Verbindung, Funktionen und Fehlersuche.

## Hardware

Vorgesehen ist das **Waveshare ESP32-S3 Touch LCD 4.3" (800 × 480)** mit GT911-Touchcontroller.

Zusätzlich benötigt:
- USB-C-**Daten**kabel zum Flashen und zur Stromversorgung
- WLAN nur für Docker-/Serverbetrieb
- keine zusätzliche Display- oder Touch-Platine

Die Firmware verwendet den auf dem Board vorhandenen ESP32-S3, das RGB-Display, den GT911-Touchcontroller und den CH422G für Hintergrundbeleuchtung/Touch-Reset.

## Firmware

Arduino-Sketch:

`KinderKasseDisplay/KinderKasseDisplay.ino`

Firmware-Version: **1.2.3**

Betriebsarten:
- **Lokale Android-Kasse:** BLE-Gerät `KasseDisplay`
- **Docker-Kasse:** WLAN und HTTP/HTTPS-Verbindung zur KinderKasse

BLE-Protokoll:
- Service: `7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10`
- Status/RX: `7a0f1002-1b55-4e2a-9c2e-9a6b9f3a2c10`
- Eingabe/Notify: `7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10`

Docker-Endpunkte:
- Status: `/api/customer-display`
- Eingaben: `/api/customer-display/input`

## Verdrahtung

Beim fertigen Waveshare-Board ist **keine externe Displayverdrahtung nötig**.

Intern verwendet die KinderKasse-Firmware unter anderem:
- GT911 SDA: **GPIO 8**
- GT911 SCL: **GPIO 9**
- Touch IRQ: **GPIO 4**
- Touch-Reset und Hintergrundbeleuchtung: über **CH422G**

Die RGB-Panel-Pins sind bereits im Sketch hinterlegt. Diese Werte nicht ändern, solange exakt das vorgesehene Waveshare-Board verwendet wird.

## Arduino IDE vorbereiten

1. Arduino IDE 2.x installieren.
2. Im Boardverwalter **esp32 by Espressif Systems** installieren.
3. Im Bibliotheksverwalter installieren:
   - `GFX Library for Arduino`
   - `NimBLE-Arduino`
   - `WiFiManager`
   - `ArduinoJson`
4. `KinderKasseDisplay.ino` öffnen.

Empfohlene Einstellungen unter **Werkzeuge**:
- Board: `ESP32S3 Dev Module`
- Flash Size: **16MB**
- PSRAM: **OPI PSRAM**
- USB CDC On Boot: **Enabled**
- Partition Scheme: **Huge APP**
- CPU Frequency: **240 MHz**
- Upload Speed: bei Problemen 460800 verwenden

Unter Windows 11 muss nach dem Anschließen ein COM-Port erscheinen. Wenn das Board bereits im Geräte-Manager/Arduino-Portmenü sichtbar ist, ist kein weiterer Treiber nötig.

## Flashen

1. Display mit einem USB-C-Datenkabel anschließen.
2. Arduino IDE → **Werkzeuge → Port** → passenden COM-Port wählen.
3. Sketch zuerst **Überprüfen/Kompilieren**.
4. **Hochladen**.
5. Nach erfolgreichem Upload startet das Display neu.

Wenn Upload nicht startet:
1. BOOT gedrückt halten.
2. RESET kurz drücken.
3. BOOT loslassen.
4. Erneut hochladen.

Serieller Monitor: **115200 Baud**.

## Start und WLAN-Einrichtung

Firmware 1.2.3 startet BLE sofort und blockiert nicht mehr minutenlang auf dem Startbildschirm.

Ohne gespeichertes WLAN startet nach kurzer Zeit das Setup-Netz:

`KinderKasse-Display-Setup`

Mit Handy/PC verbinden und im WiFiManager das WLAN auswählen. Für Docker zusätzlich die KinderKasse-Server-URL eintragen, zum Beispiel:

`http://192.168.1.50:3000`

Bei Cloudflare Access können Client ID und Client Secret im Portal eingetragen werden.

Für die **lokale Android-Kasse per BLE** ist keine Docker-Server-URL erforderlich.

## Funktionen

Das Display zeigt abhängig vom Kassenstatus:
- Warenkorb und Gesamtbetrag
- Zahlungsstatus
- Barzahlung, gegebenen Betrag und Rückgeld
- Abschluss-/Danke-Anzeige
- Kundenkonto und Guthaben
- PIN-Eingabe
- PIN aktivieren, ändern und deaktivieren

Das große Banner wird nicht verwendet; die Anzeige erhält stattdessen einen schmalen Rahmen in der konfigurierten Banner-/Primärfarbe.

## Fehlersuche

**Es steht nur „KinderKasse Display …“:**  
Seriellen Monitor mit 115200 Baud öffnen und RESET drücken. Bei Firmware 1.2.3 sollte danach eine Status-/Kundenansicht erscheinen.

**`KinderKasse-Display-Setup` ist nicht sichtbar:**  
Etwa 5–10 Sekunden warten. Danach WLAN-Liste neu laden. Seriellen Monitor prüfen. Ein gespeichertes WLAN kann dazu führen, dass sich das Display direkt damit verbindet.

**Display schwarz nach Flash:**  
Flash Size 16MB und **OPI PSRAM** prüfen. Außerdem sicherstellen, dass das richtige Waveshare-Board verwendet wird.

**BLE wird nicht gefunden:**  
Bluetooth am Kassentablet einschalten, Display neu starten und prüfen, ob `KasseDisplay` beworben wird. Die KinderKasse verbindet über BLE; eine klassische Bluetooth-Kopplung in Windows/Android ist nicht zwingend der eigentliche Verbindungsschritt.

**Docker zeigt keine Daten:**  
Server-URL, WLAN und Erreichbarkeit der KinderKasse prüfen. Bei Cloudflare Access auch Service-Token prüfen.

## Aktualisieren

Bei einer neuen KinderKasse-Version immer den Sketch aus dem aktuellen `devices/display-box/`-Ordner verwenden. Die auf dem Startbildschirm angezeigte Display-Firmware-Version kann unabhängig von der Hauptversion der KinderKasse sein.
