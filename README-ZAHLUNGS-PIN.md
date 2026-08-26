# Zahlungs-PIN und Kundenkonto – KinderKasse 2.8.0

## Zahlungs-PIN pro Kunde

In **Karten → Kunde → Zahlungs-PIN** stehen zur Verfügung:

- Kein PIN
- PIN immer verlangen
- PIN ab Betrag

PIN-Länge: 4–8 Ziffern.

Der PIN ist nicht auslesbar. Docker speichert einen gesalzenen scrypt-Hash; der
lokale APK-Modus einen gesalzenen Hash im lokalen Datenspeicher.

## PIN vergessen

Ein vergessener PIN kann nicht angezeigt werden.

Das Kassenpersonal öffnet:
**Karten → Kunde → Zahlungs-PIN → PIN vergessen / zurücksetzen**

Damit wird nur der Zahlungs-PIN entfernt. Guthaben, Karten, Kundenkonto und
Verlauf bleiben erhalten.

Danach kann der Kunde seine Karte bei leerem Warenkorb erneut scannen und am
Kundendisplay einen neuen PIN aktivieren.

## Kunden-Self-Service am Kundendisplay

Voraussetzungen:
- Kundenanzeige aktiviert
- Warenkorb leer
- NFC-Box verbunden
- bekannte Kundenkarte wird gescannt

Dann wechselt das Kundendisplay automatisch ins Kundenkonto.

Der Kunde sieht:
- Name
- aktuelles Guthaben
- PIN-Status

Mögliche Aktionen:
- PIN aktivieren
- PIN ändern
- PIN deaktivieren
- Kundenkonto schließen

Bei vorhandenem PIN gilt:
- Ändern → aktueller PIN erforderlich
- Deaktivieren → aktueller PIN erforderlich

Nicht erlaubt sind:
- Guthaben aufladen
- Kundendaten ändern
- andere Kunden ansehen
- Profile/Einstellungen verwalten

## Anzeigevarianten

### ESP32-S3 Touchdisplay
Firmware 1.2.0.

Docker/Server:
- WLAN/Cloudflare
- `/api/customer-display`
- Rückkanal `/api/customer-display/input`

Lokale APK:
- BLE `KasseDisplay`
- Rückkanal per BLE Notify

### Zweites Handy / Tablet
Docker:
- `#/kundendisplay`

Lokal:
- WLAN/Hotspot
- Kassen-APK Displayserver Port 3890
- Rückkanal `/input`

## Zahlungsablauf

Bei einer normalen Kartenzahlung mit PIN-Pflicht wird vor korrekter PIN-Prüfung
nichts abgebucht. Ein falscher PIN verändert Guthaben und Verkauf nicht.
