# KinderKasse – Kassenschublade / Servo-Latch

Diese Anleitung gehört zur optionalen **Drawer-Box**. Sie steuert einen SG90-Servo, der den mechanischen Riegel der Kassenschublade kurz entriegelt.

## Material

- **ESP32-C3 SuperMini**
- **SG90 5-V-Microservo**
- gedruckter Servo-Latch-/Riegelmechanismus
- stabile **5-V-Stromversorgung**, mindestens 1 A, empfohlen 2 A
- USB-C-Datenkabel zum Flashen
- **470–1000 µF Elektrolytkondensator**, mindestens 10 V; empfohlen 1000 µF / 10–16 V
- optional 100 nF Keramikkondensator
- Kabel/Dupont-Leitungen
- optional Lochraster-/Verteilerplatine und Servo-Verlängerung

Für einen einzelnen SG90 ist kein Relais, Motortreiber oder PCA9685 nötig.

## Firmware

Arduino-Sketch:

`KinderKasseDrawer/KinderKasseDrawer.ino`

Firmware-Version: **1.0.1**

Betriebsarten:
- lokale Android-Kasse: BLE `KasseDrawer`
- Docker: WLAN und Abfrage von `/api/drawer/command`

BLE:
- Service: `7a0f2001-1b55-4e2a-9c2e-9a6b9f3a2c10`
- Command: `7a0f2002-1b55-4e2a-9c2e-9a6b9f3a2c10`
- Öffnungsbefehl: `OPEN`

## Verdrahtung

SG90-Farben sind üblicherweise:
- **Rot:** +5 V
- **Braun/Schwarz:** GND
- **Orange/Gelb:** PWM-Signal

Standard in der Firmware:
- SG90 Signal → **GPIO 4**
- SG90 +5 V → externe/stabile 5-V-Versorgung
- SG90 GND → Versorgung GND
- ESP32 GND → **dieselbe Masse**

Schema:

```text
5-V-Versorgung
   +5V ───────────── SG90 Rot
    │
    └─────────────── ESP32 5V/VBUS (nur bei geeigneter gemeinsamer 5-V-Versorgung)

   GND ───────────── SG90 Braun/Schwarz
    │
    └─────────────── ESP32 GND

ESP32 GPIO4 ──────── SG90 Orange/Gelb

1000-µF-Elko möglichst nahe am Servo:
   + an +5 V
   - an GND
```

**Wichtig:** SG90 nicht vom 3,3-V-Pin des ESP32 versorgen. ESP32 und Servo müssen eine gemeinsame Masse haben. Beim Elektrolytkondensator Polarität beachten.

## Servo-Winkel einstellen

Die Mechanik wird **direkt im Arduino-Code** angepasst:

```cpp
static const int SERVO_PIN = 4;
static const int SERVO_CLOSED_DEG = 0;
static const int SERVO_OPEN_DEG = 40;
static const int OPEN_HOLD_MS = 400;
```

Bedeutung:
- `SERVO_CLOSED_DEG`: Verriegelungs-/Ruhestellung
- `SERVO_OPEN_DEG`: Entriegelungsstellung
- `OPEN_HOLD_MS`: Dauer der Entriegelung in Millisekunden

Beispiel:

```cpp
static const int SERVO_CLOSED_DEG = 15;
static const int SERVO_OPEN_DEG = 55;
static const int OPEN_HOLD_MS = 500;
```

### Sicherer erster Mechaniktest

1. Servo zunächst **ohne fest montierten Servoarm/Riegel** einschalten.
2. Prüfen, wo die Ruhestellung liegt.
3. Servoarm mechanisch passend montieren.
4. Öffnungswinkel zunächst nur in kleinen Schritten erhöhen.
5. Der Servo darf weder in Ruhe noch beim Öffnen hart gegen einen mechanischen Anschlag drücken.
6. Erst danach den kompletten Riegel testen.

Brummt der Servo dauerhaft, ist meist der Winkel zu weit gewählt oder die Mechanik verspannt.

## Arduino IDE

1. Arduino IDE 2.x installieren.
2. Im Boardverwalter **esp32 by Espressif Systems** installieren.
3. Bibliotheken installieren:
   - `NimBLE-Arduino`
   - `WiFiManager`
   - `ESP32Servo`
4. `KinderKasseDrawer.ino` öffnen.
5. Board: `ESP32C3 Dev Module`
6. USB CDC On Boot: **Enabled**, sofern angeboten.
7. richtigen COM-Port wählen.
8. Kompilieren und hochladen.

Serieller Monitor: **115200 Baud**.

## WLAN / Docker

Beim WLAN-Setup verwendet die Firmware:

`KinderKasse-Drawer-Setup`

Dort können WLAN, KinderKasse-Server-URL sowie optional Cloudflare Access Client ID/Secret hinterlegt werden.

Die Firmware fragt anschließend:

`/api/drawer/command`

ab. Beim ersten Kontakt wird nur die aktuelle Befehlsversion synchronisiert. Dadurch öffnet die Schublade nach einem Neustart nicht versehentlich wegen eines alten Befehls.

## Funktionen

- Öffnen per BLE aus der lokalen Android-Kasse
- Öffnen per Docker/WLAN
- optional automatisches Öffnen nach erfolgreicher Barzahlung
- Rückkehr des SG90 in die Verriegelungsstellung
- einstellbarer Öffnungs-/Schließwinkel und Haltezeit
- optional Cloudflare-Access-Service-Token
- ein Schubladenfehler macht einen bereits erfolgreichen Verkauf nicht rückgängig

## Fehlersuche

**ESP32 startet neu, sobald der Servo fährt:**  
Fast immer Stromversorgung. Separate/stabile 5 V verwenden, gemeinsame Masse prüfen und 470–1000 µF nahe am Servo einsetzen.

**Servo bewegt sich nicht:**  
5 V, GND, GPIO4 und gemeinsame Masse prüfen. Danach seriellen Monitor öffnen.

**Servo brummt:**  
Winkel reduzieren und prüfen, ob der Riegel mechanisch gegen einen Anschlag drückt.

**BLE nicht gefunden:**  
Bluetooth am Kassengerät aktivieren, ESP neu starten und nach `KasseDrawer` suchen bzw. aus der KinderKasse verbinden.

**Docker öffnet nicht:**  
WLAN, Server-URL und `/api/drawer/command` prüfen. Bei Cloudflare Access Client ID/Secret kontrollieren.

## Sicherheit

Die Konstruktion ist für eine leichte, federbelastete Spiel-/Kassenschublade gedacht. Den Servo nicht als Kraftantrieb verwenden; er soll nur den Riegel freigeben.
