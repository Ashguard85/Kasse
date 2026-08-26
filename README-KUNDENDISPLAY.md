# KinderKasse Kundendisplay – 2.8.0

KinderKasse unterstützt zwei Kundendisplay-Arten.

## 1. ESP32-S3 Touch-Display

### Docker / Server

WLAN → KinderKasse:

`/api/customer-display`

Optional Cloudflare Access Service Token. Keine Profil-ID nötig.

### Lokale APK

BLE als `KasseDisplay`.

Die Android-App merkt sich das gekoppelte Display und verbindet automatisch wieder.

### Funktionen

- Profilname und Profilfarben
- Warenkorb
- neue Artikel unten, automatische Anzeige der neuesten Positionen
- Total
- Zahlung
- Barzahlung: gegeben / Rückgeld
- optionaler Zahlungs-PIN über Touch
- „Vielen Dank“-Abschluss

Firmware:
`devices/KinderKasse-DisplayBox-ESP32-S3-v1.2.0.zip`

## 2. Zweites Handy / Tablet

### Docker / Server

Auf dem zweiten Gerät KinderKasse öffnen und:

`#/kundendisplay`

aufrufen.

### Lokale APK ohne Docker

Auf dem Kassen-Tablet:
1. Datenmodus `Lokal`
2. Kundenanzeige aktivieren
3. Typ `Zweites Gerät`
4. lokalen Displayserver starten
5. angezeigte Adresse verwenden, z. B. `http://192.168.43.1:3890`

Auf dem Display-Gerät:
1. KinderKasse öffnen/installieren
2. Kundendisplay starten
3. Adresse des Kassen-Tablets eingeben

Beide Geräte müssen im selben WLAN sein; alternativ Hotspot des Kassen-Tablets.

Der lokale Displayserver überträgt nur den Live-Anzeigestatus und verändert keine
Verkaufsdaten.

## Zusammenspiel mit NFC und Kassenschublade

- `KasseNFC` → NFC-Box
- `KasseDisplay` → ESP32-Kundendisplay
- `KasseDrawer` → Kassenschublade

Alle BLE-Geräte sind getrennt und können parallel verwendet werden.


## Kundenkonto / Self-Service ab 2.8.0

Bei leerem Warenkorb kann eine bekannte Karte an der verbundenen NFC-Box direkt
das Kundenkonto auf dem Kundendisplay öffnen.

Verfügbar:
- Guthaben ansehen
- PIN aktivieren
- PIN ändern (alter PIN erforderlich)
- PIN deaktivieren (alter PIN erforderlich)
- Konto schließen

Ein vergessener PIN wird durch das Kassenpersonal in der Kundenverwaltung
zurückgesetzt. Der PIN selbst kann nie angezeigt werden.

ESP32-S3 benötigt dafür Display-Firmware 1.2.0.
