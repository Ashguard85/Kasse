# KinderKasse 2.2.0 – Status

- Gesamtversion: 2.2.0
- Frontend: 2.2.0
- Backend: 2.2.0
- Android versionName: 2.2.0
- Android versionCode: 7
- Application ID: ch.pmattmann.kinderkasse
- Dauerhafte Release-Signierung: vorhanden (seit 2.1.3; derselbe Keystore muss weiterverwendet werden)
- Automatische Bluetooth-Drucker-Wiedererkennung: vorhanden
- Mehrprofil-System: vorhanden
- Barzahlung: neu in 2.2.0
- Optionale Rückgeld-Stückelung pro Profil: neu in 2.2.0
- Kundenanzeige für zweites Tablet über Docker-Server: neu in 2.2.0

## Barzahlung
Barverkäufe werden als normale Verkäufe in Statistik und Bon erfasst, verändern aber kein Kundenguthaben. Gegebener Betrag und Rückgeld werden auf dem Bon ausgegeben.

## Kundenanzeige
In Einstellungen > Zahlungsmethoden/Kundenanzeige pro Profil aktivieren. Das zweite Tablet nutzt Servermodus, wählt dasselbe Profil und öffnet `#/kundendisplay`. Die Ansicht zeigt Warenkorb, Total, Zahlungsart, Bar-Rückgeld und Abschlussmeldung.
