# KinderKasse – NFC-Box

Die NFC-Box liest Karten/Tags und überträgt deren UID per Bluetooth Low Energy an die KinderKasse. Es gibt zwei unterstützte Varianten: **PN532** und **RC522**.

## Gemeinsame Funktion

BLE-Gerätename: `KasseNFC`

BLE-Protokoll:
- Service: `7a0f0001-1b55-4e2a-9c2e-9a6b9f3a2c10`
- UID-Characteristic: `7a0f0002-1b55-4e2a-9c2e-9a6b9f3a2c10`

Eine erkannte UID wird als BLE-Notification an die KinderKasse übertragen. Eine kurze Entprellung verhindert Mehrfachbuchungen derselben aufgelegten Karte.

Serieller Monitor: **115200 Baud**.

---

# Variante A – PN532

## Material

- ESP32-Board mit BLE
- PN532 NFC-Modul
- 4 Dupont-Leitungen
- USB-Datenkabel
- NFC-Karten/Tags nach ISO14443A, z. B. MIFARE

Firmware:

`KinderKasseNFC_PN532/KinderKasseNFC_PN532.ino`

Arduino-Library:
- `Adafruit PN532`

## PN532 auf I2C stellen

Das PN532-Modul muss im **I2C-Modus** betrieben werden. Bei der im Projekt vorgesehenen Schalterbelegung:

- Switch 1: **ON**
- Switch 2: **OFF**

Je nach PN532-Platinenhersteller kann die Beschriftung abweichen. Im Zweifel die I2C-Schaltertabelle des konkreten Moduls prüfen.

## Verdrahtung PN532

```text
PN532 VCC  → ESP32 3.3V
PN532 GND  → ESP32 GND
PN532 SDA  → ESP32 GPIO21
PN532 SCL  → ESP32 GPIO22
```

Die Firmware initialisiert I2C mit SDA 21 / SCL 22.

---

# Variante B – RC522

## Material

- ESP32-Board mit BLE
- RC522/MFRC522 RFID/NFC-Modul
- 7 Dupont-Leitungen
- USB-Datenkabel
- kompatible ISO14443A/MIFARE-Karten oder Tags

Firmware:

`KinderKasseNFC_RC522/KinderKasseNFC_RC522.ino`

Arduino-Library:
- `MFRC522` / zur verwendeten `MFRC522.h` kompatible Library

## Verdrahtung RC522

```text
RC522 SDA/SS → ESP32 GPIO5
RC522 SCK    → ESP32 GPIO18
RC522 MOSI   → ESP32 GPIO23
RC522 MISO   → ESP32 GPIO19
RC522 RST    → ESP32 GPIO22
RC522 GND    → ESP32 GND
RC522 3.3V   → ESP32 3.3V
```

**RC522 niemals an 5 V anschließen.** Das Modul wird mit 3,3 V betrieben.

---

# Arduino IDE / Flashen

1. Arduino IDE 2.x installieren.
2. `esp32 by Espressif Systems` über den Boardverwalter installieren.
3. Je nach Hardware die oben genannte NFC-Library installieren.
4. Den passenden Sketch öffnen:
   - PN532: `KinderKasseNFC_PN532.ino`
   - RC522: `KinderKasseNFC_RC522.ino`
5. Das zu deinem ESP32 passende Board auswählen.
6. COM-Port auswählen.
7. **Überprüfen/Kompilieren**.
8. **Hochladen**.
9. Seriellen Monitor auf 115200 Baud stellen.

Nach dem Start sollte im seriellen Monitor gemeldet werden, dass das NFC-Modul gefunden wurde und BLE als `KasseNFC` bereit ist.

## Verwendung mit KinderKasse

Die NFC-Box ist besonders für Kassentablets ohne eigenes NFC gedacht. Die KinderKasse verbindet sich per BLE mit `KasseNFC`. Beim Auflegen einer Karte wird die UID übertragen und der zugehörige Kunde kann erkannt bzw. für den Bezahlvorgang verwendet werden.

## Fehlersuche

**NFC-Modul wird nicht gefunden:**  
Versorgung, GND, Pins und bei PN532 den I2C-Modus prüfen. Bei RC522 besonders SDA/SS, SCK, MOSI, MISO und RST kontrollieren.

**RC522 funktioniert gar nicht:**  
Prüfen, dass es an **3,3 V** und nicht 5 V angeschlossen ist.

**PN532 funktioniert nicht:**  
I2C-Schalterstellung und SDA/SCL prüfen.

**`KasseNFC` wird nicht gefunden:**  
Bluetooth einschalten, ESP neu starten und seriellen Monitor prüfen. Sicherstellen, dass der Sketch auf einem ESP32 mit BLE läuft.

**Karte wird gelesen, aber KinderKasse reagiert nicht:**  
Im seriellen Monitor prüfen, ob ein BLE-Client verbunden ist und die UID tatsächlich als Notification gesendet wird.

## Welche Variante verwenden?

Wenn du bereits eine funktionierende NFC-Box hast, musst du nicht wechseln. PN532 und RC522 verwenden gegenüber der KinderKasse denselben BLE-Gerätenamen und dieselben KinderKasse-UUIDs; nur die Ansteuerung des Lesers unterscheidet sich.
