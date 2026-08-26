# STATUS – KinderKasse 2.8.0

Basis: KinderKasse 2.7.1.

## Neu: Kundenkonto / Self-Service

- Bei leerem Warenkorb öffnet ein Scan an der verbundenen NFC-Box das Kundenkonto.
- Kundenkonto erscheint ausschließlich am Kundendisplay.
- Anzeige von Kundenname und aktuellem Guthaben.
- PIN erstmals aktivieren.
- PIN ändern; vorhandener PIN muss bestätigt werden.
- PIN deaktivieren; vorhandener PIN muss bestätigt werden.
- Self-Service erlaubt keine Aufladung oder Änderung sonstiger Kundendaten.
- Kundenkonto kann am Terminal geschlossen werden.
- ESP32-S3 Touchdisplay Firmware 1.2.0 unterstützt den neuen Konto-Modus.
- Zweites Handy/Tablet unterstützt denselben Self-Service.

## PIN vergessen

- PIN kann nicht ausgelesen werden.
- In der Admin-Kundenverwaltung gibt es `PIN vergessen / zurücksetzen`.
- Reset löscht nur den PIN.
- Danach kann der Kunde über Self-Service einen neuen PIN setzen.

## Bestehender Stand bleibt erhalten

- Mehrprofil-System
- NFC-Box `KasseNFC`
- Kundendisplay `KasseDisplay`
- Zahlungs-PIN immer/ab Betrag
- Barzahlung und Rückgeld-Stückelung
- optionale Kassenschublade `KasseDrawer`
- Kassenmodus-PIN
- Docker + lokale APK
- Release-Signierung

## Versionen

- KinderKasse 2.8.0
- Frontend 2.8.0
- Backend 2.8.0
- Android versionName 2.8.0
- Android versionCode 15
- ESP32-S3 Display-Firmware 1.2.0
- ESP32-C3 Drawer-Firmware 1.0.0

Kein Datenbank-Reset erforderlich.
