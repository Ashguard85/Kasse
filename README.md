# KinderKasse

KinderKasse ist ein Kassensystem für Docker/Serverbetrieb und eine lokale Android-App.
Es unterstützt mehrere Kassenprofile, Kundenkarten mit Guthaben, NFC/QR, Barzahlung,
Kundendisplay, Zahlungs-PIN, Bondrucker, Kassenschublade und optionale ESP32-Geräte.

## Inhalt

1. Schnellstart Docker
2. Android-App
3. Profile und Kassenbetrieb
4. Kunden, Karten und Guthaben
5. Zahlungs-PIN und Kunden-Self-Service
6. Kundendisplay
7. Bondrucker
8. Kassenschublade
9. Kassenmodus
10. ESP32-Geräte
11. Datensicherung und Updates
12. Android-Release bauen

---

## 1. Schnellstart Docker

Voraussetzungen:
- Docker mit Docker Compose oder Portainer
- ein persistentes Verzeichnis/Volume für die KinderKasse-Daten
- Browser im lokalen Netz oder ein abgesicherter HTTPS-Zugang

Start mit Docker Compose:

```bash
docker compose up -d --build
```

Alternativ kann `portainer-stack.yml` in Portainer verwendet werden.

Nach dem Start KinderKasse im Browser öffnen und zuerst ein Profil sowie die
gewünschten Zahlungsarten und Geräte konfigurieren.

Für produktiven Zugriff über das Internet HTTPS und eine vorgeschaltete
Authentifizierung verwenden. Zugangsdaten und Secrets nicht in öffentliche
Repositories einchecken.

---

## 2. Android-App

Die Android-App kann vollständig lokal arbeiten. Die Kassendaten liegen dann auf
dem Android-Gerät. Alternativ kann der Servermodus verwendet werden.

Wichtig:
- NFC, Kamera und Bluetooth benötigen die jeweiligen Android-Berechtigungen.
- Für BLE-Geräte Bluetooth aktivieren.
- Für ein zweites lokales Kundendisplay müssen beide Geräte im selben WLAN sein
  oder das Kassen-Tablet stellt einen Hotspot bereit.
- Vor Neuinstallation oder Gerätewechsel eine Datensicherung erstellen.

---

## 3. Profile und Kassenbetrieb

KinderKasse unterstützt mehrere Profile. Pro Profil können unter anderem Artikel,
Design, Zahlungsarten und Anzeigeeinstellungen getrennt verwaltet werden.

Für das Profil-Design stehen mehrere Presets zur Verfügung, darunter **Bier & Cocktail Bar** mit dunklem Petrol, Messing-Akzent und dunklen Flächen.

Typischer Ablauf:
1. Profil auswählen.
2. Artikel in den Warenkorb legen.
3. Zahlungsart wählen.
4. Zahlung abschließen.
5. Optional Bon drucken und bei Barzahlung die Kassenschublade öffnen.

Unterstützte Zahlungswege:
- NFC-Karte
- QR-Code
- externe NFC-Box über Bluetooth
- manuelle Kundenauswahl
- Barzahlung

---

## 4. Kunden, Karten und Guthaben

In der Kunden-/Kartenverwaltung können Kunden angelegt und Karten bzw. Tokens
zugeordnet werden. Ein Kunde kann Guthaben besitzen und dieses für Einkäufe
verwenden.

Funktionen:
- Kunden anlegen und verwalten
- NFC-/QR-Tokens zuordnen
- Guthaben aufladen
- Transaktions-/Kaufverlauf
- Zahlungs-PIN konfigurieren oder zurücksetzen

Eine Karte darf nur dem vorgesehenen Kunden zugeordnet werden. Vor größeren
Änderungen empfiehlt sich eine Datensicherung.

---

## 5. Zahlungs-PIN und Kunden-Self-Service

Pro Kunde kann ein Zahlungs-PIN mit 4 bis 8 Ziffern verwendet werden.

PIN-Modi:
- kein PIN
- PIN immer verlangen
- PIN ab einem festgelegten Betrag

Bei einer PIN-pflichtigen Zahlung wird vor erfolgreicher PIN-Prüfung nichts
abgebucht.

### PIN vergessen

Der vorhandene PIN kann nicht ausgelesen werden.

Das Kassenpersonal öffnet:

**Karten → Kunde → Zahlungs-PIN → PIN vergessen / zurücksetzen**

Der Reset entfernt nur den Zahlungs-PIN. Guthaben, Karten und Verlauf bleiben
erhalten. Danach kann der Kunde einen neuen PIN einrichten.

### Self-Service am Kundendisplay

Wenn der Warenkorb leer ist und eine bekannte Kundenkarte an der verbundenen
NFC-Box gescannt wird, öffnet sich das Kundenkonto auf dem Kundendisplay.

Der Kunde kann dort:
- Name und Guthaben sehen
- PIN aktivieren
- PIN ändern
- PIN deaktivieren
- Kundenkonto schließen

Auf Breitbildgeräten ist das Kundenkonto zweigeteilt:
- links: Kunde, Guthaben, PIN-Status und Aktionsauswahl
- rechts: PIN-Eingabe und Bestätigung

Das gilt sowohl für ein zweites Tablet/Handy als auch für das ESP32-S3-Touchdisplay.

Bei einem vorhandenen PIN muss zum Ändern oder Deaktivieren zuerst der aktuelle
PIN eingegeben werden.

Nicht möglich sind dort:
- Guthaben aufladen
- Kundendaten verändern
- andere Kundenkonten öffnen
- administrative Einstellungen ändern

---

## 6. Kundendisplay

Die Kundenanzeige zeigt Warenkorb, Summe, Zahlungsstatus und PIN-Eingaben. Sie
kann außerdem das Kunden-Self-Service-Konto anzeigen.

Das große Profilbanner wird auf dem Kundendisplay bewusst nicht angezeigt. Stattdessen
liegt ein schmaler Rahmen in der im Profil eingestellten Banner-/Primärfarbe um die
Anzeige. Dadurch bleibt mehr Platz für Artikel und Bedienung.

### Zweites Handy oder Tablet – Serverbetrieb

Auf dem zweiten Gerät die Kundendisplay-Seite von KinderKasse öffnen:

```text
#/kundendisplay
```

### Zweites Handy oder Tablet – lokale Android-Kasse

Beide Geräte müssen im selben WLAN sein. Alternativ kann das Kassen-Tablet einen
Hotspot bereitstellen. In der Kasse unter **Einstellungen → Kundenanzeige** die
angezeigte lokale Adresse verwenden. Der lokale Displayserver nutzt Port `3890`.

### ESP32-S3 Touchdisplay

Das ESP32-S3-Display arbeitet ab Firmware **1.4.0 ausschließlich per BLE** als
`KasseDisplay`. Das gilt sowohl im lokalen Datenmodus als auch im Docker-/Servermodus.
Im Servermodus holt der aktive KinderKasse-Client die Kassendaten von Docker und
überträgt den fertigen Displayzustand direkt per BLE an den ESP32. Der ESP32 selbst
benötigt deshalb weder WLAN noch Server-URL noch Cloudflare-Zugangsdaten.

Es unterstützt:
- Warenkorb und Summe
- Zahlungsstatus
- PIN-Eingabe per Touch
- Kundenkonto
- Guthabenanzeige
- PIN aktivieren/ändern/deaktivieren

Auch Touch-Rückmeldungen laufen in beiden Datenmodi direkt über BLE zurück an den
aktiven KinderKasse-Client. Der PIN wird nicht dauerhaft auf dem Displaygerät gespeichert.

---

## 7. Bondrucker

Der Bondrucker wird in den Druckereinstellungen eingerichtet. Dort kann die
Verbindung aktiviert und die Druckeradresse hinterlegt werden.

Der Bon enthält die Daten des abgeschlossenen Verkaufs. Bei Problemen zuerst
Verbindung, Druckeradresse und Erreichbarkeit prüfen.

Für Sonderzeichen und Umlaute muss der verwendete Drucker die entsprechende
Zeichencodierung unterstützen.

---

## 8. Kassenschublade

Die Kassenschublade ist optional. Sie kann so eingestellt werden, dass sie nach
erfolgreicher Barzahlung automatisch öffnet.

Die ESP32-C3-Schubladenbox kommuniziert unabhängig von NFC-Box und Kundendisplay.
Ein Ausfall der Schublade darf den eigentlichen Kassiervorgang nicht blockieren.

---

## Display wach halten

Unter **Einstellungen → Display wach halten** gibt es zwei getrennte Schalter:

- **Kasse wach halten** – standardmäßig aktiviert
- **Kundendisplay wach halten** – standardmäßig aktiviert

In der Android-APK wird die Displaysperre nativ unterdrückt, solange die jeweilige
Ansicht aktiv ist. Wird die Option deaktiviert oder zur anderen Ansicht gewechselt,
gilt wieder die normale Android-Displayeinstellung.

Auf einem Kundendisplay im Browser wird zusätzlich die Screen-Wake-Lock-API
verwendet. Nach Rückkehr aus dem Hintergrund versucht KinderKasse automatisch,
die Wachhaltung erneut zu aktivieren. Browser und Betriebssystem können diese
Funktion einschränken; insbesondere auf iPhone/iPad hängt sie von Safari/iOS und
einem unterstützten sicheren Web-Kontext ab.

---

## 9. Kassenmodus

Der Kassenmodus schützt den laufenden Kassenbetrieb vor unbeabsichtigtem Verlassen
oder administrativen Änderungen. Je nach Konfiguration ist zum Verlassen ein
Kassenmodus-PIN erforderlich.

Den Kassenmodus-PIN getrennt vom Zahlungs-PIN der Kunden behandeln.

---

## 10. ESP32-Geräte – Arduino IDE

Alle ESP32-Geräte sind für die **Arduino IDE 2.x** vorbereitet. PlatformIO wird für
die KinderKasse-Geräte nicht mehr benötigt. Jeder Sketch liegt in einem Ordner,
dessen Name exakt zur Haupt-`.ino` passt, damit er direkt in Arduino geöffnet
werden kann.

```text
devices/
├── nfc-box/
│   ├── KinderKasseNFC_PN532/
│   │   └── KinderKasseNFC_PN532.ino
│   └── KinderKasseNFC_RC522/
│       └── KinderKasseNFC_RC522.ino
├── display-box/
│   └── KinderKasseDisplay/
│       └── KinderKasseDisplay.ino
└── drawer-box/
    └── KinderKasseDrawer/
        └── KinderKasseDrawer.ino
```

### Arduino IDE vorbereiten

1. Arduino IDE 2.x installieren.
2. Im Boardverwalter **esp32 by Espressif Systems** installieren.
3. Den gewünschten Geräteordner öffnen bzw. die darin liegende `.ino` doppelklicken.
4. Die unten genannten Libraries über **Sketch → Bibliothek einbinden → Bibliotheken verwalten** installieren.
5. Board und COM-Port unter **Werkzeuge** auswählen.
6. Zuerst **Überprüfen**, danach **Hochladen**.
7. Für Diagnose den **Seriellen Monitor mit 115200 Baud** öffnen.

### NFC-Box – PN532

Sketch:

```text
devices/nfc-box/KinderKasseNFC_PN532/KinderKasseNFC_PN532.ino
```

BLE-Gerätename: `KasseNFC`

Benötigte Library:

- **Adafruit PN532**

Die Pinbelegung und Hinweise für den PN532 stehen zusätzlich direkt am Anfang des
Sketches. Die NFC-Box liest Karten-UIDs und sendet sie per BLE an KinderKasse.

### NFC-Box – RC522

Sketch:

```text
devices/nfc-box/KinderKasseNFC_RC522/KinderKasseNFC_RC522.ino
```

BLE-Gerätename: `KasseNFC`

Die RC522-Variante ist eine Alternative zur PN532-Box. Pinbelegung und benötigte
Library stehen direkt im Sketch.

### Kundendisplay – Waveshare ESP32-S3 Touch LCD 4.3"

Sketch:

```text
devices/display-box/KinderKasseDisplay/KinderKasseDisplay.ino
```

Firmware: `1.4.1`  
BLE-Gerätename: `KasseDisplay`

Vorgesehen für **Waveshare ESP32-S3-Touch-LCD-4.3, 800 × 480**.

Benötigte Libraries im Arduino-Bibliotheksverwalter:

- **GFX Library for Arduino** (`Arduino_GFX_Library`)
- **ArduinoJson**
- BLE kommt aus dem **ESP32 Board-Paket**; keine separate NimBLE-Arduino-Library nötig

Nicht mehr benötigt werden WiFiManager, ESP32_Display_Panel oder HTTP-/Cloudflare-
Bibliotheken für das Display.

Empfohlene Arduino-Einstellungen:

```text
Board:              ESP32S3 Dev Module
Flash Size:         16MB
PSRAM:              OPI PSRAM
USB CDC On Boot:    Disabled
Partition Scheme:   Huge APP
Flash Mode:         QIO
```

Nach dem Flashen startet das Display direkt als BLE-Gerät `KasseDisplay`. Es gibt
**kein Setup-WLAN mehr**. In KinderKasse unter **Einstellungen → Kundenanzeige** die
ESP32 Display-Box auswählen und per BLE verbinden. Diese direkte BLE-Verbindung wird
sowohl im lokalen Modus als auch im Docker-/Servermodus verwendet.

Der Docker-Container selbst benötigt keinen Bluetooth-Adapter. Entscheidend ist der
aktive KinderKasse-Client: Die Android-App verwendet natives BLE; kompatible Browser
können Web Bluetooth verwenden. Im Servermodus bleiben die Daten auf Docker, aber der
Client reicht den aktuellen Warenkorb/Status direkt per BLE an das Display weiter.

Firmware **1.4.1** basiert beim Touch auf dem erfolgreich laufenden 1.3.5-Pfad:
GT911 direkt über Arduino `Wire`, SDA GPIO8, SCL GPIO9, IRQ GPIO4 und Reset über
CH422G EXIO1. Das Display-Rendering bleibt im 800×480-RGB565-PSRAM-Canvas und wird nur
bei sichtbaren Zustandsänderungen geflusht.

Die obere linke Ecke kann etwa fünf Sekunden gehalten werden, um Display und BLE neu
zu starten. Es werden dabei keine Netzwerkdaten gelöscht, weil das Display keine
Netzwerkkonfiguration mehr besitzt.

Weitere Details stehen in `devices/display-box/README.md`.

### Kassenschubladenbox – ESP32-C3 + SG90

Sketch:

```text
devices/drawer-box/KinderKasseDrawer/KinderKasseDrawer.ino
```

Firmware: `1.0.1`  
BLE-Gerätename: `KasseDrawer`

Benötigte Libraries:

- **NimBLE-Arduino**
- **WiFiManager**
- **ESP32Servo**

Für einen ESP32-C3 SuperMini in Arduino IDE **ESP32C3 Dev Module** wählen.

#### SG90 verdrahten

```text
5-V-Versorgung +  ───── ESP32-C3 5V
                  └──── SG90 rot

GND ─────────────────── ESP32-C3 GND
 └───────────────────── SG90 braun/schwarz

ESP32 GPIO4 ─────────── SG90 orange/gelb (Signal)

470–1000 µF Elko:
+ an 5 V
- an GND
möglichst nahe am Servo
```

Den SG90 **nicht am 3,3-V-Ausgang** des ESP32 betreiben. Servo und ESP32 müssen eine
gemeinsame Masse haben. Für einen einzelnen SG90 ist kein Motortreiber oder Relais
notwendig.

#### Winkel an den Mechanismus anpassen

Direkt am Anfang von `KinderKasseDrawer.ino` stehen die drei wichtigen Werte:

```cpp
static const int SERVO_PIN = 4;
static const int SERVO_CLOSED_DEG = 0;
static const int SERVO_OPEN_DEG = 40;
static const int OPEN_HOLD_MS = 400;
```

- `SERVO_CLOSED_DEG`: verriegelte Ruhestellung
- `SERVO_OPEN_DEG`: Winkel zum Entriegeln
- `OPEN_HOLD_MS`: wie lange die Entriegelungsposition gehalten wird

Beispiel für eine Mechanik, die etwas mehr Weg benötigt:

```cpp
static const int SERVO_CLOSED_DEG = 15;
static const int SERVO_OPEN_DEG = 55;
static const int OPEN_HOLD_MS = 500;
```

**Erster Test:** Servoarm noch nicht fest mit dem Riegel verbinden. Zuerst kleine
Winkel testen und beobachten, in welche Richtung der Servo fährt. Erst wenn
`CLOSED` und `OPEN` sicher passen, den Arm montieren. Der Servo darf in keiner
Position dauerhaft gegen einen mechanischen Anschlag drücken oder stark brummen.

Die Kasse sendet nur den Befehl `OPEN`. Die mechanischen Winkel bleiben deshalb
vollständig in der ESP32-Firmware einstellbar und müssen in KinderKasse nicht
geändert werden.

Die Drawer-Box unterstützt beide Betriebsarten:

- **Lokale Android-Kasse:** BLE `KasseDrawer`
- **Docker:** WLAN, Abruf über `/api/drawer/command`

Beim ersten Kontakt im Docker-Modus wird nur der aktuelle Befehlsstand
synchronisiert. Dadurch wird nach einem ESP-Neustart kein alter Öffnungsbefehl erneut
ausgeführt.

### Firmware aktualisieren

Bei allen Geräten gilt:

1. Passenden Arduino-Sketch öffnen.
2. Richtiges ESP32-Board und COM-Port wählen.
3. **Überprüfen** klicken.
4. Erst bei erfolgreicher Kompilierung **Hochladen**.
5. Nach Upload seriellen Monitor auf **115200 Baud** öffnen.

Die BLE-Namen und UUIDs sind auf die KinderKasse abgestimmt. Diese Werte nicht
ändern, sofern nicht gleichzeitig die KinderKasse-Software angepasst wird.

---

## 11. Datensicherung und Updates

Vor Updates:
1. Kassendaten sichern.
2. Bei Docker das persistente Datenvolume sichern.
3. Bei lokaler Android-Nutzung den Datenexport verwenden.
4. Erst danach Anwendung oder Firmware aktualisieren.

Bestehende Kundendaten nicht durch Löschen des Datenverzeichnisses oder Volumes
ersetzen.

Die Datei `VERSION` enthält nur die aktuelle Anwendungsversion für Build und
Softwarebetrieb. Separate Status-/Versionsdokumente werden nicht geführt.

---

## 12. Android-Release bauen

Das Android-Projekt liegt unter:

```text
frontend/android/
```

Der automatisierte Build kann über den vorhandenen GitHub-Workflow ausgeführt
werden. Für eine installierbare Release-APK müssen die Signing-Secrets im
Repository hinterlegt sein.

Benötigte Secrets:
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Keystore erzeugen, Base64-Wert erstellen und die Werte als GitHub Actions Secrets
hinterlegen. Den privaten Keystore niemals in das Repository committen.

Der Workflow unter `.github/workflows/` baut anschließend die Android-APK.

---

## Projektstruktur

```text
backend/              Backend/API
frontend/             Weboberfläche und Android-Projekt
devices/nfc-box/      NFC-Box Firmware
devices/display-box/  ESP32-S3 Kundendisplay Firmware
devices/drawer-box/   ESP32-C3 Kassenschubladen-Firmware
docker-compose.yml    Docker Compose
portainer-stack.yml   Portainer Stack
VERSION               aktuelle Softwareversion
README.md             Funktionen und vollständige Anleitung
```

Damit sind Funktionen, Installation und Geräteanleitungen an einer Stelle
dokumentiert. Historische Status- und Einzel-README-Dateien werden nicht benötigt.


## Geräte-Dokumentation

Jedes Zusatzgerät hat zusätzlich eine eigene `README.md` direkt im Geräteordner. Dort stehen Materialliste, Firmware, Verdrahtung, Arduino-IDE-Setup, Funktionen und Fehlersuche:

- `devices/nfc-box/README.md`
- `devices/display-box/README.md`
- `devices/drawer-box/README.md`

Die Geräte-READMEs sind die erste Anlaufstelle beim Aufbau oder Flashen eines Zusatzgeräts.
