# KinderKasse 2.1.3 – Status

- Frontend: 2.1.3
- Backend: 2.1.3
- Android versionName: 2.1.3
- Android versionCode: 6
- Application ID: ch.pmattmann.kinderkasse
- APK-Build: signierter Release-Build (`assembleRelease`)
- Dauerhafter Signing-Key: über GitHub Actions Secrets
- Mehrprofil-System: vorhanden
- Automatische Bluetooth-Drucker-Wiedererkennung: vorhanden (seit 2.1.2)
- Bon-Schriftanpassung: vorhanden (seit 2.1.1)

Wichtig: 2.1.3 ist der Startpunkt der dauerhaften Release-Signierung. Eine zuvor anders signierte Debug-App muss einmal deinstalliert werden. Danach sind In-Place-Updates möglich, sofern derselbe Signing-Key beibehalten und `versionCode` je Release erhöht wird.
