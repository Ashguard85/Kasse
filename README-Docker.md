# KinderKasse Docker 2.2.0

Dieses Paket startet die zentrale Webapp, API und SQLite-Datenhaltung.

## Start

1. Den Host-Pfad für persistente Daten in `docker-compose.yml` beziehungsweise `portainer-stack.yml` prüfen.
2. Im Paketverzeichnis starten:

```bash
docker compose up -d --build
```

Standardmäßig ist die Webapp über Port `3800` erreichbar. Das Backend läuft intern beziehungsweise über Port `3801`.

## Android-Verbindung

In der Android-App unter **Einstellungen → Betriebsmodus → Server verwenden** die Adresse der Webapp eintragen, zum Beispiel:

```text
http://192.168.1.50:3800
```

Bei einem Reverse Proxy wird die HTTPS-Domain verwendet. Nicht `localhost` eintragen; auf dem Android-Gerät verweist das auf das Gerät selbst.

## Profile

Profile werden ausschließlich in den Einstellungen verwaltet und gewechselt. Pro Profil getrennt sind:

- Produkte
- Kundenaktivierung und Guthaben
- Verkäufe und Statistiken
- Zahlungs-, Drucker- und Bon-Einstellungen
- Farben, Kassenhintergrund und Banner

Kundenstammdaten sowie NFC-/QR-/Bluetooth-Zuordnungen sind global gemeinsam.

## Datensicherung

Die persistenten Daten liegen im gemounteten Host-Verzeichnis. Dieses Verzeichnis gehört nicht in das Quellpaket und muss separat gesichert werden.

## Designvorlagen und Lesbarkeit

Unter **Einstellungen → Profil und App-Design** stehen fertige Vorlagen zur Verfügung. Farben, Hell-/Dunkelmodus, Logo und Bannerbild werden je Profil gespeichert. Die automatische Lesbarkeitsfunktion berechnet passende Textfarben und zeigt die Kontrastwerte direkt in der Live-Vorschau.
