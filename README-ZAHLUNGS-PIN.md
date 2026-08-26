# Zahlungs-PIN – KinderKasse 2.6.0

## Einrichten
Karten/Kunden → Kunde öffnen → Zahlungs-PIN.

Verfügbare Regeln:
- Kein PIN
- PIN immer verlangen
- PIN ab Betrag

Der PIN besteht aus 4–8 Ziffern.

## Zahlungsablauf
1. Kundenkarte/NFC/QR lesen.
2. KinderKasse prüft, ob für diesen Kunden und Betrag ein PIN nötig ist.
3. Falls nein: Zahlung wie bisher.
4. Falls ja: noch keine Abbuchung; Kundendisplay zeigt PIN-Tastatur.
5. Kundendisplay sendet PIN an die Kasse.
6. Richtiger PIN: Zahlung wird ausgeführt.
7. Falscher PIN: keine Abbuchung, erneute Eingabe.

## Kundendisplays
- Docker/Server + Tablet/Handy: Rückkanal `/api/customer-display/input`
- Lokale APK + Tablet/Handy: lokaler Displayserver Port 3890, `/input`
- Docker/Server + ESP32: WLAN/Cloudflare, `/api/customer-display/input`
- Lokale APK + ESP32: BLE Notify Characteristic `7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10`

## Sicherheit
Der PIN wird nicht auf dem Kundendisplay gespeichert.
Im Docker-Backend wird er mit scrypt und Salt gespeichert. Im lokalen App-Datenspeicher
wird er nur als gesalzener Hash gespeichert.
