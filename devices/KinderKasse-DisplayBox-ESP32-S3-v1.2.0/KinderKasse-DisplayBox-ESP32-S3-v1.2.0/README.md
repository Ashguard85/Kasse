# KinderKasse Display-Box – ESP32-S3 4.3" – v1.2.0

Zielhardware: **Waveshare ESP32-S3-Touch-LCD-4.3, 800×480**.

## Betriebsarten

Die Firmware kann gleichzeitig beide Wege bereitstellen:

1. **Docker/WLAN**  
   Die Box ruft regelmäßig `https://DEIN-SERVER/api/customer-display` ab.  
   Optional sendet sie `CF-Access-Client-Id` und `CF-Access-Client-Secret`.

2. **Lokale Android-APK/BLE**  
   Die Box heißt `KasseDisplay` und bietet den BLE-Service  
   `7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10`.  
   KinderKasse 2.4.0 kann die Live-Daten direkt per BLE übertragen.

Es gibt **keine Profilkonfiguration auf der Box**. Profilname, Farben, Warenkorb,
Total, Zahlungsart und Rückgeld kommen immer von der aktiven Kasse.

## Was du brauchst

- Waveshare ESP32-S3-Touch-LCD-4.3
- USB-C-Datenkabel
- VS Code + PlatformIO **oder** PlatformIO Core
- 5-V-USB-Netzteil für den späteren Betrieb

## Flashen mit VS Code / PlatformIO

1. ZIP entpacken.
2. Ordner in VS Code öffnen.
3. PlatformIO-Erweiterung installieren.
4. Board per USB-C anschließen.
5. In PlatformIO **Upload** drücken.
6. Danach **Monitor** mit 115200 Baud öffnen.

Falls das Board nicht in den Flash-Modus geht:
- BOOT gedrückt halten,
- RESET kurz drücken,
- BOOT loslassen,
- erneut Upload starten.

## Ersteinrichtung WLAN / Cloudflare

Beim ersten Start erzeugt die Box ein WLAN:

`KinderKasse-Display-Setup`

Mit Handy/Tablet verbinden. Das Konfigurationsportal öffnet sich normalerweise
automatisch; sonst `192.168.4.1` im Browser öffnen.

Eintragen:

- **KinderKasse Server URL**  
  z. B. `https://kasse.example.ch` oder `http://192.168.1.50:3800`
- **Cloudflare Client ID** – optional
- **Cloudflare Client Secret** – optional

Die Box braucht **keine Profil-ID**.

Für Cloudflare Access empfiehlt sich ein eigener Service Token nur für die
Display-Box. Der Access-Policy sollte nach Möglichkeit nur
`/api/customer-display*` erlauben.

## Lokaler APK-Modus ohne Docker

1. KinderKasse 2.4.0 installieren.
2. In KinderKasse **Einstellungen → Kundenanzeige** aktivieren.
3. Datenmodus auf **Lokal** stellen.
4. Display-Box einschalten.
5. Einmal **BLE-Display verbinden** drücken.
6. `KasseDisplay` wird gesucht und gespeichert.

Danach versucht die APK automatisch, das bekannte Display wieder zu verbinden.

NFC-Box und Display nutzen getrennte BLE-Services. Die App koordiniert BLE-Scans,
damit die beiden Suchvorgänge sich nicht gegenseitig beenden. Der ESC/POS-Drucker
läuft weiterhin separat über Bluetooth Classic/RFCOMM.

## Anzeige

Die Box zeigt:
- Profilname und Bannertext
- bis zu 8 aktuelle Positionen
- Total
- Zahlungsstatus
- bei Barzahlung: Gegeben und Rückgeld
- nach Abschluss: Vielen Dank

## Hinweis TLS

Firmware v1.0 verwendet für HTTPS `setInsecure()`: Die Verbindung ist verschlüsselt,
das Serverzertifikat wird aber nicht geprüft. Für ein Gerät mit dauerhaftem
Cloudflare-Service-Token ist Zertifikatsprüfung langfristig empfehlenswert.
Eine spätere Firmware kann CA-Pinning bzw. ein Root-CA-Bundle ergänzen.

## Hardwarebasis

Die Firmware verwendet die dokumentierte RGB-Pinbelegung des Waveshare-Boards
(800×480) und schaltet die Hintergrundbeleuchtung über den CH422G-I/O-Expander
(EXIO2).

## Touch

Der Touchscreen ist in v1.0 bewusst noch nicht nötig. Die Ersteinrichtung erfolgt
über das WLAN-Portal. Dadurch bleibt die Firmware kleiner und die Anzeige robust.
Touch kann später für Helligkeit, Diagnose oder einen Setup-Knopf ergänzt werden.

## Anzeigeverhalten 1.0.1

Artikel bleiben in normaler Erfassungsreihenfolge. Bei mehr als acht Positionen zeigt das 4,3-Zoll-Display automatisch die letzten acht Positionen, sodass der zuletzt erfasste Artikel immer sichtbar ist.

## Zahlungs-PIN ab Firmware 1.2.0

Wenn KinderKasse 2.6.0 einen Zahlungs-PIN verlangt, wechselt das Display automatisch
auf eine numerische Touch-Tastatur. Der GT911-Touchcontroller läuft über GPIO8/9 (I2C)
und GPIO4 (IRQ), passend zur Waveshare-Dokumentation.

Der PIN wird nie auf der Display-Box gespeichert. Die Box sendet nur die aktuelle
Eingabe zurück:
- im WLAN/Docker-Modus an `/api/customer-display/input`
- im lokalen APK-Modus per BLE-Notify-Characteristic
  `7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10`

Die eigentliche PIN-Prüfung und Abbuchung erfolgen ausschließlich in KinderKasse.


## Kundenkonto / Self-Service ab 1.2.0

Bei leerem Warenkorb kann eine Kundenkarte an der NFC-Box das Kundenkonto auf dem
Display öffnen. Angezeigt werden Name und aktuelles Guthaben.

Per Touch kann der Kunde:
- PIN erstmals aktivieren
- vorhandenen PIN ändern (aktueller PIN erforderlich)
- PIN deaktivieren (aktueller PIN erforderlich)
- Kundenkonto schließen

Der PIN wird weiterhin niemals auf dem ESP32 gespeichert. Die Display-Box sammelt
nur die Eingabe und sendet sie an KinderKasse zurück. Bei vergessenem PIN muss das
Kassenpersonal den PIN in der Kundenverwaltung zurücksetzen.
