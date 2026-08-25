# KinderKasse Status 2.1.2

Stand: 2026-08-16

## Version
- Gesamtversion: 2.1.2
- Frontend: 2.1.2
- Backend: 2.1.2
- Android versionName: 2.1.2
- Android versionCode: 5

## Änderung gegenüber 2.1.1
- Bondrucker wird nach einmaligem Speichern automatisch wiedererkannt.
- Neue Druckereinstellung `autoConnect`, standardmäßig aktiviert.
- Beim Öffnen der Druckerseite lädt die Android-App gekoppelte Bluetooth-Geräte automatisch.
- Der gespeicherte Drucker wird über seine Bluetooth-Adresse/MAC wieder zugeordnet.
- Manuelles "Gekoppelte Geräte laden" bleibt für Druckerwechsel und Fehlersuche erhalten.
- Beim Drucken wird weiterhin erst bei Bedarf eine Bluetooth-Verbindung geöffnet und danach wieder geschlossen; keine instabile Dauerverbindung.
- Druckereinstellung bleibt profilbezogen und wird mit dem Docker-Server synchronisiert.

## Bestehende Funktionen
- Mehrprofil-System mit gemeinsamen Kunden und profilbezogenem Guthaben.
- Profilbezogene Produkte, Statistiken, Bon-/Druckereinstellungen und Themes.
- Bon-Schriftänderung aus 2.1.1 bleibt enthalten.
- Android/Capacitor-Projekt und Docker-Konfiguration bleiben enthalten.

## Paketformat
`kasse-source.zip` enthält als obersten Ordner `kasse/` und bleibt kompatibel mit dem bestehenden GitHub-Workflow (`working-directory: kasse/frontend`).
