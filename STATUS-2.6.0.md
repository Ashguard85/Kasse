# STATUS – KinderKasse 2.6.0

Basis: KinderKasse 2.5.1.

Neu – optionaler Zahlungs-PIN pro Kunde:
- Kein PIN, PIN immer oder PIN ab einstellbarem Betrag.
- PIN 4–8 Ziffern.
- Serverseitig mit scrypt + zufälligem Salt gehasht.
- Lokalmodus mit SHA-256 + zufälligem Salt gehasht.
- Bei PIN-Pflicht wird vor erfolgreicher Prüfung nichts abgebucht.
- Falscher PIN verändert weder Guthaben noch Verkauf.
- PIN-Eingabe über Kundenanzeige auf Tablet/Handy.
- PIN-Eingabe über Waveshare ESP32-S3 Touch-LCD-4.3 ab Firmware 1.1.0.
- Docker-Kundendisplay sendet PIN über `/api/customer-display/input`.
- Lokales Zweitgerät sendet PIN über den nativen Displayserver `/input`.
- ESP32 im lokalen APK-Modus sendet PIN per BLE Notify.
- Abbrechen der PIN-Abfrage ist am Kundendisplay möglich (Tablet/Handy).
- Bestehende Kunden ohne PIN bleiben unverändert.

Versionen:
- Frontend 2.6.0
- Backend 2.6.0
- Android versionName 2.6.0
- Android versionCode 12
- ESP32 Display-Firmware 1.1.0
