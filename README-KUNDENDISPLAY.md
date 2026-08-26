# KinderKasse Kundendisplay – 2.5.0

## 1. ESP32 Display-Box

### Mit Docker / Server
Die Display-Box verbindet sich per WLAN mit:
`/api/customer-display`

Optional können Cloudflare-Access-Client-ID und -Secret auf der Box gespeichert werden.
Eine Profil-ID ist nicht nötig. Die Box zeigt immer den aktuellen Live-Zustand der Kasse.

### Lokale APK ohne Docker
Die Display-Box verbindet sich per BLE als `KasseDisplay`.
In KinderKasse:
Einstellungen → Kundenanzeige → ESP32 Display-Box → BLE-Display verbinden.

NFC-Box und Kundendisplay verwenden getrennte BLE-Services.

## 2. Zweites Handy / Tablet

### Mit Docker / Server
Auf dem zweiten Gerät dieselbe KinderKasse öffnen bzw. installieren, denselben Server
konfigurieren und `#/kundendisplay` öffnen. Alternativ in den Einstellungen:
`Dieses Gerät als Kundendisplay starten`.

### Lokale APK ohne Docker
Auf dem Kassen-Tablet:
1. Datenmodus `Lokal`.
2. Kundenanzeige aktivieren.
3. Typ `Zweites Gerät`.
4. `Lokalen Display-Server starten`.
5. Die angezeigte Adresse notieren, z. B. `http://192.168.43.1:3890/state`.

Auf dem zweiten Gerät:
1. Dieselbe KinderKasse-APK installieren.
2. Datenmodus `Lokal`.
3. `#/kundendisplay` öffnen / `Dieses Gerät als Kundendisplay starten`.
4. Die Adresse des Kassen-Tablets eingeben.

Beide Geräte müssen im selben WLAN sein. Alternativ kann das Kassen-Tablet einen
WLAN-Hotspot bereitstellen und das Display-Gerät verbindet sich mit diesem Hotspot.

Der lokale Displayserver speichert keine Verkäufe und verändert keine Datenbank.
Er liefert nur den aktuellen Live-Anzeigestatus aus.

## Anzeigeverhalten ab 2.5.1

Artikel bleiben in normaler Kassenreihenfolge. Neue Positionen erscheinen unten. Tablet/Handy scrollen automatisch zum neuesten Eintrag; die ESP32-Firmware 1.1.0 zeigt bei langen Warenkörben die letzten acht Positionen.
