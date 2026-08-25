# STATUS – KinderKasse 2.3.0

Basis: KinderKasse 2.2.0.

Neu:
- PIN-geschützter Kassenmodus pro Gerät.
- Im gesperrten Zustand wird ausschließlich die Kassenansicht gerendert.
- PIN: 4–8 Ziffern, lokal nur als PBKDF2-SHA-256-Hash mit zufälligem Salt gespeichert.
- Keine Verzögerung oder Sperre nach falschen PIN-Eingaben.
- Einmaliger Recovery-Code beim Einrichten/Ändern des PINs; ebenfalls nur gehasht gespeichert.
- PIN-Wiederherstellung direkt am Sperrbildschirm.
- Docker-Notfallreset über serverseitigen Reset-Zähler, ohne öffentliche Reset-API.
- Notfallreset löscht keine Kassen-/Serverdaten.
- Kundenanzeige aus 2.2.0 bleibt unabhängig nutzbar.
- Release-Signierung aus 2.1.3 bleibt unverändert erhalten.

Versionen:
- Frontend 2.3.0
- Backend 2.3.0
- Android versionName 2.3.0
- Android versionCode 8
