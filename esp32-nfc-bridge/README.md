# 🔵 ESP32 + NFC-Modul Bluetooth-Bridge

Das Lenovo Tab M11 hat **kein eigenes NFC**. Diese Bridge ersetzt es: ein ESP32
liest NFC-Karten und schickt die Karten-ID per Bluetooth Low Energy (BLE) an
die Kasse-App. In der App einfach den Modus **"🔵 NFC-Box"** auswählen statt
"📡 NFC".

Zwei Varianten stehen zur Auswahl, je nachdem welches NFC-Modul du hast oder
bestellen möchtest:

| Datei | Modul | Verkabelung | Preis |
|-------|-------|-------------|-------|
| `esp32-nfc-bridge.ino` | PN532 | I2C, nur 4 Drähte | 8–15 CHF |
| `esp32-nfc-bridge-rc522.ino` | RC522 (MFRC522) | SPI, 7 Drähte | 2–10 CHF |

**Für dieses Projekt reicht der günstigere RC522 völlig aus** — beide
unterstützen Mifare Classic/Ultralight-Karten (ISO14443A), die gängigsten
NFC-Karten und -Schlüsselanhänger. Der PN532 kann zusätzlich mit echten
Smartphones als NFC-Tag kommunizieren und hat etwas mehr Reichweite — für eine
Kinder-Kasse mit eigenen Karten ist das aber kein Vorteil, der den
Mehrpreis rechtfertigt.

---

## Einkaufsliste

### Variante RC522 (günstiger, empfohlen für dieses Projekt)

| Teil | Beispiel | Preis ca. |
|------|----------|-----------|
| ESP32 Dev Board | "ESP32 DevKit V1" oder "ESP32-WROOM-32" | 5–10 CHF |
| RC522 RFID-Modul | "MFRC522 RFID Reader Module" | 2–10 CHF |
| Jumper-Kabel (7 Stück) | weiblich-weiblich, 10–15cm | 2 CHF |

### Variante PN532

| Teil | Beispiel | Preis ca. |
|------|----------|-----------|
| ESP32 Dev Board | "ESP32 DevKit V1" oder "ESP32-WROOM-32" | 5–10 CHF |
| PN532 NFC-Modul | "PN532 NFC RFID Module V3" | 8–15 CHF |
| Jumper-Kabel (4 Stück) | weiblich-weiblich, 10–15cm | 2 CHF |

Beide Module gibt's günstig auf AliExpress, Amazon oder bei lokalen Elektronik-Shops (z.B. Distrelec, digitec in der Schweiz). Meist liegen auch ein paar Mifare-Testkarten/Schlüsselanhänger dabei.

---

## Verkabelung

### RC522 (SPI — läuft immer über SPI, kein Umschalten nötig)

```
RC522          ESP32
─────          ─────
3.3V     →     3.3V      (NIEMALS 5V! RC522 ist 3.3V-only)
GND      →     GND
SDA(SS)  →     GPIO5
SCK      →     GPIO18
MOSI     →     GPIO23
MISO     →     GPIO19
RST      →     GPIO22
```

7 Drähte, kein Lötkolben erforderlich.

### PN532 (I2C-Modus, DIP-Schalter: Switch 1 = ON, Switch 2 = OFF)

```
PN532          ESP32
─────          ─────
VCC      →     3.3V
GND      →     GND
SDA      →     GPIO21
SCL      →     GPIO22
```

Nur 4 Drähte.

---

## Firmware flashen

1. **Arduino IDE installieren** (falls noch nicht vorhanden): https://www.arduino.cc/en/software
2. **ESP32-Board-Unterstützung hinzufügen**:
   - Arduino IDE → Einstellungen → "Zusätzliche Boardverwalter-URLs"
   - Eintragen: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Dann: Werkzeuge → Board → Boardverwalter → "esp32" suchen → installieren
3. **Library installieren** je nach gewählter Variante:
   - RC522: Werkzeuge → Bibliotheken verwalten → "MFRC522" von GithubCommunity suchen → installieren
   - PN532: Werkzeuge → Bibliotheken verwalten → "Adafruit PN532" suchen → installieren
4. Die passende `.ino`-Datei öffnen (`esp32-nfc-bridge-rc522.ino` oder `esp32-nfc-bridge.ino`)
5. Board auswählen: Werkzeuge → Board → ESP32 Dev Module (oder passend zu deinem Board)
6. ESP32 per USB anschliessen, richtigen Port auswählen
7. Hochladen (Pfeil-Symbol oben links)
8. Seriellen Monitor öffnen (115200 baud) — sollte zeigen: `RC522 gefunden` bzw. `PN532 gefunden` und `BLE Advertising gestartet`

---

## Verwendung

1. ESP32 einschalten (USB-Strom reicht, z.B. über ein Ladegerät oder eine Powerbank)
2. In der Kasse-App: Zahlungsmodus auf **"🔵 NFC-Box"** stellen
3. "Mit NFC-Box bezahlen" antippen
4. Ein Chrome-Dialog zeigt **"KasseNFC"** in der Geräteliste — antippen
5. Karte ans NFC-Modul halten (nicht ans Tablet!) — die Karten-UID wird automatisch übertragen

**Wichtig:** Web Bluetooth verlangt — wie NFC und Kamera — einen sicheren Kontext (HTTPS). Funktioniert also nur über den Cloudflare Tunnel, nicht über `http://192.168.x.x`.

---

## Fehlerbehebung

**"RC522/PN532 nicht gefunden" im seriellen Monitor**
→ Verkabelung prüfen. Beim RC522 unbedingt auf **3.3V** achten, nicht 5V — sonst geht das Modul kaputt. Beim PN532 die DIP-Schalter auf I2C-Modus prüfen.

**Kein "KasseNFC" in der Bluetooth-Liste**
→ ESP32 neu starten, prüfen ob der serielle Monitor "BLE Advertising gestartet" zeigt.

**Karte wird nicht erkannt**
→ Karte muss sehr nah (wenige mm bis 2-3cm beim RC522, etwas mehr beim PN532) ans Modul gehalten werden, nicht ans Tablet. Unterstützt Mifare Classic/Ultralight (ISO14443A) — die gängigsten NFC-Karten und -Chips.

**Mehrere Karten kurz hintereinander lösen keine neue Zahlung aus**
→ Eingebauter Debounce (1.5 Sekunden) verhindert Doppel-Lesungen derselben Karte. Karte kurz wegnehmen und neu auflegen.
