# KinderKasse ESP32-S3 Kundendisplay – Firmware 1.2.0

Passendes Firmwarepaket im Docker-/Source-Paket:

`devices/KinderKasse-DisplayBox-ESP32-S3-v1.2.0.zip`

## Hardware

Zielgerät:
Waveshare ESP32-S3 Touch-LCD 4.3", 800×480.

## Docker-/Servermodus

Die Box verbindet sich per WLAN mit KinderKasse und liest:

`/api/customer-display`

Keine Profil-ID ist erforderlich. Die aktuell aktive Kasse liefert Profilname,
Design, Warenkorb und Zahlungsstatus.

Cloudflare Access kann mit eigenem Service Token verwendet werden.

## Lokaler APK-Modus

BLE-Gerätename:
`KasseDisplay`

Service:
`7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10`

PIN-/Eingabe-Rückkanal:
`7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10`

Einmal unter **Einstellungen → Kundenanzeige** verbinden. Danach Auto-Reconnect.

## Anzeigeverhalten

- normale Kassenreihenfolge
- neueste Artikel bleiben sichtbar
- bei langen Warenkörben letzte Positionen anzeigen
- Total / Zahlungsart / Rückgeld
- Touch-PIN-Tastatur bei optionaler Kunden-PIN-Abfrage

NFC-Box und Kassenschublade sind technisch getrennte BLE-Geräte.


## Self-Service ab Firmware 1.2.0

Das Touchdisplay unterstützt zusätzlich das Kundenkonto bei leerem Warenkorb:
Guthaben anzeigen, PIN aktivieren, PIN ändern und PIN deaktivieren.

Ein vorhandener PIN muss zum Ändern oder Deaktivieren zuerst eingegeben werden.
Die Display-Box speichert keinen Kunden-PIN.
