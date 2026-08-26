# KinderKasse Docker 2.8.0

Dieses Paket enthält die zentrale KinderKasse-Webapp, API, SQLite-Datenhaltung und
die zu diesem Stand passenden Mikrocontroller-/Zusatzgeräte-Unterlagen.

## Inhalt des Pakets

- KinderKasse Webapp + Backend
- Docker-/Portainer-Konfiguration
- persistente SQLite-Datenhaltung
- NFC-Box-Quellcode
- ESP32-S3 Kundendisplay-Firmware 1.2.0
- ESP32-C3 Kassenschubladen-Firmware 1.0.0
- aktuelle Anleitungen für Kundendisplay, Zahlungs-PIN und Kassenschublade

Die Zusatzgeräte sind **optional**. KinderKasse funktioniert weiterhin ohne
Kundendisplay oder Kassenschublade.

## Start

1. Persistenten Host-Pfad in `docker-compose.yml` bzw. `portainer-stack.yml` prüfen.
2. Im Paketverzeichnis starten:

```bash
docker compose up -d --build
```

Standardmäßig ist die Webapp über Port `3800` erreichbar. Das Backend läuft intern
beziehungsweise über Port `3801`.

## Android-App mit Docker verbinden

In der Android-App:

1. **Einstellungen → Betriebsmodus**
2. **Server verwenden**
3. Adresse der Docker-Webapp eintragen, z. B.:

```text
http://192.168.1.50:3800
```

Bei Reverse Proxy / Cloudflare die HTTPS-Domain verwenden. Nicht `localhost` vom
Android-Gerät verwenden.

## Zusatzgeräte – Übersicht

| Gerät | Docker-/Servermodus | Lokaler APK-Modus | Name |
|---|---|---|---|
| NFC-Box | über KinderKasse-App/Backend-Konfiguration | BLE | `KasseNFC` |
| ESP32-S3 Kundendisplay | WLAN/Cloudflare → `/api/customer-display` | BLE | `KasseDisplay` |
| Zweites Handy/Tablet | Web/API → `#/kundendisplay` | WLAN/Hotspot | KinderKasse Display |
| ESP32-C3 Kassenschublade | WLAN/Cloudflare → `/api/drawer/command` | BLE | `KasseDrawer` |

Alle drei ESP-Geräte verwenden getrennte BLE-Services. Die Android-App koordiniert
die BLE-Scans, damit NFC-Box, Display und Kassenschublade nebeneinander betrieben
werden können.

## Kundendisplay

Unter **Einstellungen → Kundenanzeige** kann gewählt werden:

### ESP32-S3 Display-Box

Docker/Server:
- WLAN
- optional Cloudflare Access Service Token
- keine Profil-ID auf dem Display nötig
- zeigt immer den aktuellen Live-Zustand der Kasse

Lokale APK:
- BLE-Verbindung als `KasseDisplay`
- einmal verbinden, danach Auto-Reconnect

Anzeige:
- aktives Profil und Design
- Artikel in normaler Erfassungsreihenfolge
- automatischer Fokus auf die neuesten Positionen
- Total
- Zahlungsart
- Barzahlung / gegeben / Rückgeld
- Zahlungs-PIN-Eingabe per Touch
- Abschlussanzeige „Vielen Dank“

Firmware:
`devices/KinderKasse-DisplayBox-ESP32-S3-v1.2.0.zip`

## Zweites Handy oder Tablet als Kundendisplay

Docker/Server:
- KinderKasse öffnen
- `#/kundendisplay` aufrufen

Lokale APK:
- beide Geräte im selben WLAN oder Hotspot
- Kassen-Tablet startet lokalen Displayserver auf Port `3890`
- Displaygerät verbindet sich mit der angezeigten Adresse

Damit kann auch ein altes Android-Gerät ohne ESP32 dauerhaft als reines
Kundendisplay verwendet werden.

## Zahlungs-PIN

Optional pro Kunde:
- kein PIN
- PIN immer
- PIN ab Betrag

Bei PIN-Pflicht wird noch nichts abgebucht. Erst nach erfolgreicher PIN-Prüfung
wird die Zahlung durchgeführt.

PIN-Eingabe ist möglich über:
- ESP32-S3 Touch-Kundendisplay
- zweites Handy/Tablet als Kundendisplay

Details: `README-ZAHLUNGS-PIN.md`

## Kassenschublade

Unter **Einstellungen → Kassenschublade** optional aktivierbar.

Minimalhardware:
- ESP32-C3 Super Mini
- 5-V-Servo, z. B. MG90S
- USB-5-V-Versorgung
- empfohlen 470–1000 µF Kondensator am Servo

KinderKasse sendet den Öffnungsbefehl erst nach erfolgreich gespeicherter
Barzahlung. Ein Verbindungsfehler der Schublade macht den Verkauf nicht rückgängig.

Docker/Server:
- ESP32-C3 per WLAN/Cloudflare
- Abfrage `/api/drawer/command`

Lokale APK:
- BLE als `KasseDrawer`

Firmware:
`devices/KinderKasse-Drawer-ESP32-C3-v1.0.0.zip`

## NFC-Box

Der vorhandene NFC-Box-Quellcode bleibt Bestandteil des Pakets und wurde zusätzlich
unter `devices/nfc-box/` einsortiert. Der bisherige Pfad `esp32-nfc-bridge/` bleibt
aus Kompatibilitätsgründen ebenfalls erhalten.

Die NFC-Box bleibt unabhängig von Display und Kassenschublade.

## Profile

Profile werden in den Einstellungen verwaltet. Pro Profil getrennt sind unter anderem:
- Produkte
- Kundenaktivierung und Guthaben
- Verkäufe und Statistik
- Zahlungs-, Drucker- und Bon-Einstellungen
- Design, Farben und Banner
- Kundendisplay-/Kassenschubladen-Einstellungen

Kundenstammdaten und Zahlungsmittel-Zuordnungen bleiben profilübergreifend gemeinsam.

## Datenbank / Update

Für ein normales Update auf 2.8.0 ist **kein Datenbank-Reset nötig**. Bestehende
persistente Docker-Daten weiterverwenden und vor Updates wie gewohnt sichern.

## Datensicherung

Die SQLite-Daten liegen im persistent gemounteten Host-Verzeichnis. Dieses
Verzeichnis wird nicht im ZIP mitgeliefert und sollte separat gesichert werden.
