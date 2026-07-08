# 🛒 Kinder-Kasse

Eine spielerische Supermarkt-Kassen-App für Tablets, mit NFC-, QR- und manueller
Bezahlung. Schweizer Franken (CHF), kindgerechte Bedienung.

## Schnellstart

```bash
mkdir -p /home/buebi/docker/kasse/data/uploads
docker compose up -d --build
```

Oder in Portainer den Stack aktualisieren und neu deployen. Danach im Browser
(Chrome auf Android empfohlen): **http://deine-ip:3800**

---

## Was die App kann

| Bereich | Funktion |
|---------|----------|
| **🛒 Kasse** | Artikel antippen → Warenkorb → mit NFC, QR-Code, NFC-Box oder Name bezahlen |
| **💳 Karten** | Kunden anlegen, mehrere NFC-Karten/QR-Codes pro Kunde verwalten, Guthaben aufladen, Verlauf sehen |
| **📦 Artikel** | Artikel verwalten mit Bild/Emoji, Name und Preis; einzelne Artikel ein-/ausblenden (👁️/🙈) |
| **⚙️ Einstellungen** | Zahlungsmethoden aktivieren/deaktivieren und Standard festlegen; Cloudflare-Access-Zugangsdaten hinterlegen |

Der Warenkorb bleibt beim Wechsel zwischen den Bereichen erhalten und wird erst
nach dem Bezahlen oder über „Warenkorb leeren" zurückgesetzt.

---

## Bezahlung — vier Modi

In den **Einstellungen** lässt sich festlegen, welche Methoden in der Kasse
angeboten werden und welche vorausgewählt ist. Deaktivierte Methoden werden in
der Kasse ausgeblendet. Die Einstellung gilt geräteübergreifend (serverseitig).

1. **📡 NFC** — Web NFC API, nur wenn das Tablet selbst NFC-Hardware hat
2. **📷 QR-Code** — Kamera scannt den QR-Code, funktioniert auf jedem Gerät mit Kamera
3. **🔵 NFC-Box** — externe ESP32-Bluetooth-Bridge für Tablets ohne NFC (siehe unten)
4. **✏️ Name** — Kundenname von Hand eintippen, funktioniert überall (auch ohne HTTPS)

**Ablauf:** Kunde anlegen (Karten-Seite → Karte/Code scannen oder Name) →
Guthaben aufladen → in der Kasse Artikel in den Warenkorb → Zahlungsmodus wählen →
Karte/Code/NFC-Box verwenden oder Namen eingeben.

Der Status der NFC-Box (verbunden/getrennt) wird oben in der Navigation
angezeigt; nach der ersten Freigabe verbindet sich die App beim Start
automatisch wieder, ohne erneuten Geräte-Auswahldialog.

---

## 🔵 Kein NFC im Tablet? → ESP32-Bridge

Viele günstige Android-Tablets (z.B. **Lenovo Tab M11**) haben trotz Android
**keinen NFC-Chip**. Für rund 10–25 CHF lässt sich das mit einem ESP32 + RC522-
oder PN532-Modul nachrüsten. Die komplette Anleitung samt Firmware (beide
Modul-Varianten) und Verkabelung liegt im Ordner **`esp32-nfc-bridge/`**.

Die Box liest die Karte und schickt die UID per Bluetooth Low Energy an die App
(Modus „🔵 NFC-Box"). Sie funktioniert technisch wie ein externer Kartenleser
und wird von Kasse und Kartenverwaltung gemeinsam genutzt.

> **Hinweis:** nRF Connect oder andere BLE-Tools nicht gleichzeitig mit der Box
> verbunden lassen — sonst kann die Web-App nicht darauf zugreifen.

---

## ⚠️ Wichtig: NFC, QR-Kamera und Bluetooth brauchen alle HTTPS

Web NFC, `getUserMedia()` (Kamera für QR-Scan) und Web Bluetooth (ESP32-Bridge)
funktionieren **nur in einem sicheren Kontext** (HTTPS oder `localhost`). Reines
`http://192.168.x.x:3800` im Heimnetz reicht für **keine dieser drei Methoden**.

Optionen für HTTPS:
- **Cloudflare Tunnel** (empfohlen) — echtes HTTPS ohne offene Ports
- Eigenes Reverse-Proxy-Setup mit TLS-Zertifikat

Ohne HTTPS bleibt der Modus **✏️ Name**: Kundenname manuell eintippen statt
scannen — das funktioniert auch über einfaches HTTP, da dabei weder Kamera, NFC
noch Bluetooth aufgerufen werden.

---

## 🔐 Cloudflare Access (Zero Trust)

Falls für die Domain eine **Cloudflare Access Policy** (Login-Schutz) aktiv ist,
kann unter **⚙️ Einstellungen** ein Service-Token hinterlegt werden
(Client-ID + Client-Secret). Das Secret ist beim Eingeben sichtbar und wird nach
dem Speichern maskiert. Die App sendet dann bei jedem API-Aufruf diese Header:

- `CF-Access-Client-Id`
- `CF-Access-Client-Secret`

Dafür in Cloudflare Access eine **Service-Auth-Regel** für das Service Token
erlauben. So funktionieren API-Calls und Bilder, ohne dass das Tablet eine
interaktive Login-Seite durchlaufen muss.

### PWA-Installation hinter Access

Das Manifest wird mit `crossorigin="use-credentials"` geladen, damit Chrome das
Access-Cookie beim Manifest-Request mitschickt und die App als installierbare
PWA erkennt. Falls die Installation nicht klappt, direkt auf dem Tablet prüfen,
ob unter diesen URLs echte Dateien (statt einer Login-Seite) ausgeliefert
werden:

```
https://deine-domain/manifest.json
https://deine-domain/sw.js
https://deine-domain/icon-192.png
```

Falls dort die Login-Seite erscheint, in Cloudflare Zero Trust eine **Bypass-
Regel** nur für `/manifest.json`, `/sw.js`, `/icon-192.png`, `/icon-512.png`
einrichten — das gibt nur App-Metadaten und Icons frei, keine Kassendaten.

Nach Änderungen an Manifest/Service-Worker auf dem Tablet unter Chrome →
Website-Einstellungen → „Daten löschen", sonst bleibt eine alte Service-Worker-
Version aktiv. Nach jedem Deploy zusätzlich den **Cloudflare-Cache leeren**,
damit kein veraltetes JS ausgeliefert wird.

---

## Ports

| Service | Port |
|---------|------|
| Frontend (Web-App) | 3800 |
| Backend (API) | 3801 |

---

## Datenpersistenz

Die SQLite-Datenbank und die hochgeladenen Bilder liegen unter
`/home/buebi/docker/kasse/data` auf dem Host (fester Pfad, kein anonymes
Docker-Volume).

Backup:
```bash
cp /home/buebi/docker/kasse/data/kasse.db ./kasse-backup-$(date +%Y%m%d).db
```

Zurücksetzen (Container vorher stoppen):
```bash
docker compose down
rm -rf /home/buebi/docker/kasse/data/*
docker compose up -d --build
```

Die Datenbank migriert sich beim Start automatisch (neue Spalten, Schweizer
Artikelnamen etc.) — bestehende Kunden, Guthaben und Artikel bleiben erhalten.

---

## Demo-Daten

Beim ersten Start werden automatisch **51 Beispielartikel mit passenden Emojis**
angelegt (🍎 Apfel, 🥕 Rüebli, 🧀 Käse, 🍫 Schoggi …), mit Schweizer
Bezeichnungen. Lädst du bei einem Artikel ein eigenes Foto hoch, ersetzt es das
Emoji; das Foto wird automatisch zugeschnitten und (auch HEIC/iPhone) zu JPEG
konvertiert.

---

## Hinweise für Safari / iOS

- **NFC** funktioniert auf iOS grundsätzlich **nicht** (Plattform-Einschränkung
  von Apple) — nur Chrome auf Android unterstützt Web NFC.
- **QR-Scan** ist auf Safari/iOS unzuverlässig (die benötigte
  `BarcodeDetector`-API fehlt dort meist).
- **Verlässlicher Weg auf iOS/Safari:** den Modus **✏️ Name** verwenden bzw.
  NFC-UID/QR-Wert manuell eintippen.

Kurz gesagt: für Geräte ausserhalb von Chrome/Android ist die manuelle Eingabe
der verlässliche Weg.

---

## Für das lokale Netz

Das Tablet muss im **gleichen WLAN** wie der Server sein (oder die App per
Cloudflare Tunnel von überall erreichen). Server-IP herausfinden:

```bash
ip a | grep "inet "    # Linux/Mac
ipconfig               # Windows
```

Dann im Tablet-Browser `http://192.168.x.x:3800` öffnen. Ohne HTTPS funktioniert
nur der Modus ✏️ Name (siehe oben).
