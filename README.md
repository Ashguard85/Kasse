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

Das ESP32-S3-Display kann je nach Betriebsart über WLAN/Server oder BLE mit der
Kasse kommunizieren. Es unterstützt:
- Warenkorb und Summe
- Zahlungsstatus
- PIN-Eingabe per Touch
- Kundenkonto
- Guthabenanzeige
- PIN aktivieren/ändern/deaktivieren

Der PIN wird nicht dauerhaft auf dem Displaygerät gespeichert.

Hinweis zur PIN-Verwaltung: Der Rückkanal über Docker/Server überträgt neben der
Aktion auch aktuellen und neuen PIN vollständig an KinderKasse. Dadurch funktionieren
PIN aktivieren, ändern und deaktivieren auch im Serverbetrieb.

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

## 10. ESP32-Geräte

Alle Firmware-Projekte liegen direkt im Ordner `devices/` und sind **nicht**
zusätzlich als ZIP verpackt:

```text
devices/
├── nfc-box/
├── display-box/
└── drawer-box/
```

### NFC-Box

`devices/nfc-box/`

BLE-Gerätename: `KasseNFC`

Die NFC-Box liest Karten-UIDs und übergibt sie an KinderKasse. Sie kann für
Zahlungen und bei leerem Warenkorb zum Öffnen des Kunden-Self-Service verwendet
werden.

### Kundendisplay

`devices/display-box/`

BLE-Gerätename: `KasseDisplay`

Das Projekt ist für das ESP32-S3-Touchdisplay vorgesehen. Die Konfiguration und
Build-Abhängigkeiten stehen direkt im Firmware-Projekt (`platformio.ini` und
Quellcode).

### Kassenschubladenbox

`devices/drawer-box/`

BLE-Gerätename: `KasseDrawer`

Die Box steuert den Öffnungsimpuls der Kassenschublade und kann optional nach
Barzahlungen angesprochen werden.

### Firmware bauen

Die ESP32-Projekte sind als PlatformIO-Projekte abgelegt. Beispiel:

```bash
cd devices/display-box
pio run
```

Flashen:

```bash
pio run -t upload
```

Vor dem Flashen das korrekte Board, den seriellen Port und die jeweilige
Hardwareverdrahtung prüfen.

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
