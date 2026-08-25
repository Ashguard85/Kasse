# Kassenmodus / PIN – KinderKasse 2.3.0

## Normal entsperren

Im gesperrten Kassenmodus unten rechts auf das Schloss tippen und den PIN eingeben.

## PIN vergessen

Auf **PIN vergessen?** tippen, den beim Einrichten erzeugten Recovery-Code eingeben
und einen neuen PIN (4–8 Ziffern) setzen.

## Notfallreset über Docker

Wenn sowohl PIN als auch Recovery-Code verloren sind, auf dem Docker-Host ausführen:

```bash
docker exec kasse-backend node -e "const D=require('better-sqlite3');const db=new D('/app/data/kasse.db');db.prepare(\"INSERT INTO settings(key,value) VALUES('kiosk_reset_version','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1\").run();console.log('Kassenmodus-Reset ausgelöst')"
```

Danach die KinderKasse-App auf dem gesperrten Tablet öffnen bzw. kurz geöffnet lassen.
Die App prüft den Server beim Start und danach alle 15 Sekunden. Sobald sie die neue
Reset-Version erkennt, werden auf allen Kassenmodus-Geräten, die diesen Server verwenden und die neue Reset-Version erkennen, der lokale PIN und der Kassenmodus entfernt.

Nicht gelöscht werden:
- Profile
- Produkte
- Kunden
- Guthaben
- Verkäufe / Statistiken
- Bon- und Druckereinstellungen
- Serverdaten

Der Reset-Zähler liegt serverseitig in der vorhandenen SQLite-Tabelle `settings`.
Es gibt bewusst keinen öffentlichen HTTP-Endpunkt, der den Reset auslösen kann.
