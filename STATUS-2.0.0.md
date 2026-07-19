# Status 2.0.0

## Umgesetzt

- Dynamische, beliebig erweiterbare Profile
- Profilwechsel nur in Einstellungen
- Gemeinsame Kundenstammdaten
- Aktivierung und Guthaben je Kunde und Profil
- Produkte je Profil
- Verkäufe und Statistik je Profil
- Zahlungs-, Drucker- und Bon-Einstellungen je Profil
- Theme je Profil: Primärfarben, Akzent, Seiten- und Kassenhintergrund, Bannerfarben, Bannertext und Bannerbild
- Serverbetrieb über Docker
- Lokaler Android-Betrieb mit profilgetrennter lokaler Datenbank
- Verbindung der Android-App mit der Docker-Webapp
- Android-GitHub-Workflow
- Docker-Build-Workflow

## Versionen

- Frontend: 2.0.0
- Backend: 2.0.0
- Android versionName: 2.0.0
- Android versionCode: 2

## Kompatibilität

Android-Clients ohne Profil-Header werden serverseitig dem Standardprofil mit ID 1 zugeordnet. Für die vollständige Mehrprofil-Funktion ist die Android-Version 2.0.0 erforderlich.
