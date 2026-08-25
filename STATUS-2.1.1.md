# Status 2.1.1

## Umgesetzt

- Dynamische, beliebig erweiterbare Profile
- Profilwechsel ausschließlich in den Einstellungen
- Gemeinsame Kundenstammdaten
- Aktivierung und Guthaben je Kunde und Profil
- Produkte, Verkäufe und Statistiken je Profil
- Zahlungs-, Drucker- und Bon-Einstellungen je Profil
- Acht fertige Designvorlagen: Kinderladen, Nagelstudio, Modern Spa, Café, Bäckerei, Friseur, Kiosk und Luxury Dark
- Vereinfachter Theme-Editor mit Hell-/Dunkelmodus
- Automatische Textfarben und Kontrastprüfung für Hauptfarbe, Akzent und Banner
- Eigene Seiten-, Kassen- und Bannerfarben je Profil
- Eigenes Profil-Logo und Bannerbild je Profil
- Live-Vorschau der Kassenoberfläche in den Einstellungen
- Serverbetrieb über Docker
- Lokaler Android-Betrieb mit profilgetrennter lokaler Datenbank
- Verbindung der Android-App mit der Docker-Webapp
- Android-GitHub-Workflow und Docker-Build-Workflow
- Einheitlich grosse Bon-Schrift für Artikel- und Mengenzeilen
- Automatischer Zeilenumbruch für lange Artikelnamen statt Schriftverkleinerung
- Leicht vergrösserter Zeilenabstand auf 58-mm-Bons

## Versionen

- Frontend: 2.1.1
- Backend: 2.1.1
- Android versionName: 2.1.1
- Android versionCode: 4

## Kompatibilität

Android-Clients ohne Profil-Header werden serverseitig weiterhin dem Standardprofil mit ID 1 zugeordnet. Für Designvorlagen, Profil-Logo und Hell-/Dunkelmodus ist die Android-Version 2.1.1 erforderlich.
