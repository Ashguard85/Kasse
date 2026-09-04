# KinderKasse – Kundendisplay

Diese Anleitung gehört zur **Display-Box** der KinderKasse. Die Display-Box arbeitet ab Firmware **1.4.0 ausschließlich über BLE**. WLAN, WiFiManager, HTTP/HTTPS, Cloudflare-Zugangsdaten und ein WLAN-Setup-Portal wurden aus der ESP32-Firmware entfernt.

## Hardware

Vorgesehen ist das **Waveshare ESP32-S3-Touch-LCD-4.3 (800 × 480) mit kapazitivem GT911-Touch**. Die Firmware ist auf die ursprüngliche 4.3-Version ausgelegt, nicht auf 4.3B/4.3C.

Zusätzlich benötigt:
- USB-C-Datenkabel zum Flashen und zur Stromversorgung
- Android-Tablet/Handy mit KinderKasse oder ein Browser mit Web-Bluetooth-Unterstützung
- keine zusätzliche Display- oder Touch-Platine

Die Firmware verwendet den auf dem Board vorhandenen ESP32-S3, das RGB-Display, den GT911-Touchcontroller und den CH422G für Hintergrundbeleuchtung/Touch-Reset.

## Firmware

Arduino-Sketch:

`KinderKasseDisplay/KinderKasseDisplay.ino`

Firmware-Version: **1.4.1**

Verbindung:
- **Lokaler Modus:** KinderKasse → BLE → `KasseDisplay`
- **Docker-/Servermodus:** KinderKasse-App liest die Daten von Docker und sendet den aktuellen Displayzustand direkt per BLE → `KasseDisplay`
- Der ESP32 selbst baut **keine WLAN-Verbindung** auf und benötigt keine Server-URL.

BLE-Protokoll:
- Gerätename: `KasseDisplay`
- Service: `7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10`
- Status/RX: `7a0f1002-1b55-4e2a-9c2e-9a6b9f3a2c10`
- Eingabe/Notify: `7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10`

Der Docker-Container selbst braucht dafür **keinen Bluetooth-Adapter**. Die BLE-Verbindung wird vom aktiven KinderKasse-Client hergestellt. In der Android-App funktioniert das nativ; ein kompatibler Browser kann Web Bluetooth verwenden.

## Verdrahtung

Beim fertigen Waveshare-Board ist keine externe Displayverdrahtung nötig.

Intern verwendet die KinderKasse-Firmware unter anderem:
- GT911 SDA: **GPIO 8**
- GT911 SCL: **GPIO 9**
- Touch IRQ: **GPIO 4**
- Touch-Reset: **CH422G EXIO1**
- Hintergrundbeleuchtung: **CH422G EXIO2**

Die RGB-Panel-Pins sind bereits im Sketch hinterlegt und sollten für dieses Board nicht geändert werden.

## Arduino IDE vorbereiten

1. Arduino IDE 2.x installieren.
2. Im Boardverwalter **esp32 by Espressif Systems** installieren.
3. Im Bibliotheksverwalter installieren:
   - `GFX Library for Arduino` (`Arduino_GFX_Library`)
   - `ArduinoJson`
4. Für BLE wird die Bibliothek aus dem ESP32-Boardpaket verwendet. **Keine separate NimBLE-Arduino-Library ist für das Display nötig.**
5. `KinderKasseDisplay.ino` öffnen.

Nicht mehr benötigt:
- `WiFiManager`
- `ESP32_Display_Panel`
- `ESP32_IO_Expander`
- Cloudflare-/HTTP-Bibliotheken

Empfohlene Einstellungen unter **Werkzeuge**:
- Board: `ESP32S3 Dev Module`
- Flash Size: **16MB**
- PSRAM: **OPI PSRAM**
- USB CDC On Boot: **Disabled** empfohlen für CH343-UART
- Partition Scheme: **Huge APP**
- CPU Frequency: **240 MHz**
- Flash Mode: **QIO**
- Upload Speed: bei Problemen 460800 verwenden

Serieller Monitor: **115200 Baud**.

## Flashen

1. Display per USB-C-Datenkabel anschließen.
2. Arduino IDE → **Werkzeuge → Port** → passenden COM-Port wählen.
3. Sketch **Überprüfen/Kompilieren**.
4. **Hochladen**.
5. Das Display startet neu und zeigt die Willkommen-Ansicht.

Wenn der Upload nicht startet:
1. BOOT gedrückt halten.
2. RESET kurz drücken.
3. BOOT loslassen.
4. Erneut hochladen.

## BLE verbinden

In KinderKasse unter **Einstellungen → Kundenanzeige → ESP32 Display-Box**:

1. Kundenanzeige aktivieren.
2. `ESP32 Display-Box` auswählen.
3. **ESP32 per BLE verbinden** drücken.
4. `KasseDisplay` auswählen bzw. den automatischen Scan abwarten.

Die Verbindung gilt sowohl im lokalen Datenmodus als auch im Docker-/Servermodus. Im Docker-/Servermodus bleibt Docker nur die Datenquelle; der ESP32 bekommt den fertig aufbereiteten Anzeigestand direkt vom Kassenclient per BLE.

Eine klassische Bluetooth-Kopplung in den Android-Systemeinstellungen ist nicht erforderlich.

## Touch

Firmware 1.4.1 übernimmt den in Firmware 1.3.5 erfolgreich laufenden Touch-Pfad:
- GT911 direkt über Arduino `Wire`
- I²C: SDA GPIO8, SCL GPIO9, 400 kHz
- Adressen `0x5D` und `0x14` werden geprüft
- GT911-Reset über CH422G EXIO1
- IRQ über GPIO4

Beim Start sollte im seriellen Monitor etwa erscheinen:

```text
Touch HW: Waveshare ESP32-S3-Touch-LCD-4.3 / GT911, SDA=8 SCL=9 IRQ=4
GT911 gefunden bei 0x5D, Product-ID: 911?
Touch bereit: JA (Adresse 0x5D, Arduino Wire)
```

Bei Berührung werden Koordinaten ausgegeben, z. B.:

```text
Touch: x=325 y=180 raw=325/180 size=... points=1 IRQ=LOW
```

Die obere linke Ecke ist als Service-Geste reserviert: etwa **5 Sekunden halten**, um Display und BLE neu zu starten. Es werden keine WLAN-Daten gelöscht, weil die Firmware keine WLAN-Konfiguration mehr besitzt.

## Funktionen

Das Display zeigt abhängig vom Kassenstatus:
- Warenkorb und Gesamtbetrag
- Zahlungsstatus
- Barzahlung, gegebenen Betrag und Rückgeld
- Abschluss-/Danke-Anzeige
- Kundenkonto und Guthaben
- PIN-Eingabe per Touch
- PIN aktivieren, ändern und deaktivieren

Touch-Eingaben wie PIN/Konto-Aktionen gehen ebenfalls ausschließlich über BLE zurück an den aktiven KinderKasse-Client.

## Ruhiges Rendering / Partial Render

Ab Firmware **1.4.1** bleibt der stabile **800 × 480 RGB565-Canvas im PSRAM** erhalten, aber eine normale Kassenänderung überträgt nicht mehr den kompletten Bildschirm. Die Firmware arbeitet mit Dirty-Regions:
- geänderte Artikelzeilen werden einzeln aktualisiert
- der Gesamtbetrag hat eine eigene Region
- der Zahlungs-/Rückgeldbereich hat eine eigene Region
- bei der PIN-Seite wird nur der dynamische obere Bereich aktualisiert
- beim Kundenkonto werden linke und rechte Karte getrennt aktualisiert
- ein kompletter 800×480-Flush erfolgt nur beim ersten Aufbau, Seitenwechsel, Themewechsel oder einem erzwungenen Neuaufbau
- identische BLE-Zustände lösen weiterhin überhaupt keinen Render aus

Beim Start sollte erscheinen:

`Display Rendering: PSRAM-Canvas aktiv (800x480 RGB565).`

Im seriellen Monitor unterscheidet die Firmware nun:

```text
Display FULL #...
Display PARTIAL #...
```

Beim normalen Hinzufügen eines Artikels sollte überwiegend `Display PARTIAL` erscheinen. Bei unverändertem Inhalt darf keiner der Zähler fortlaufend steigen.

## Fehlersuche

**BLE wird nicht gefunden:**
- Seriellen Monitor prüfen: `BLE Advertising gestartet: JA`
- Mit nRF Connect nach `KasseDisplay` suchen
- Bluetooth am Tablet aktivieren
- in KinderKasse erneut **ESP32 per BLE verbinden** drücken
- klassische Android-Kopplung ist nicht nötig

**Im Docker-Modus kommt kein Betrag:**
- Sicherstellen, dass der Kassenclient selbst mit `KasseDisplay` per BLE verbunden ist
- der ESP32 fragt Docker nicht mehr selbst ab
- in KinderKasse muss `ESP32 Display-Box` als Kundenanzeige gewählt und aktiviert sein

**Touch reagiert nicht:**
- seriellen Monitor auf 115200 Baud öffnen
- beim Tippen müssen `Touch: x=... y=...`-Zeilen erscheinen
- bei fehlendem GT911 die I²C-Scan-Ausgabe prüfen

**Display ruckelt:**
- `PSRAM: OPI PSRAM` prüfen
- im seriellen Monitor muss der PSRAM-Canvas aktiv sein
- `Display FULL #...` und `Display PARTIAL #...` dürfen bei unverändertem Inhalt nicht fortlaufend steigen

**Display schwarz nach Flash:**
- Flash Size 16MB und OPI PSRAM prüfen
- richtiges Waveshare-Modell verwenden

## Aktualisieren

Bei einer neuen KinderKasse-Version immer den Sketch aus dem aktuellen `devices/display-box/`-Ordner verwenden. Die Display-Firmware-Version ist unabhängig von der Hauptversion der KinderKasse.
