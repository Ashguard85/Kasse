# KinderKasse Kassenschublade – 2.7.1

Die Kassenschublade ist vollständig optional.

Firmware:
`devices/KinderKasse-Drawer-ESP32-C3-v1.0.0.zip`

## Minimalhardware

- ESP32-C3 Super Mini
- 5-V-Servo, empfohlen MG90S
- USB-C / 5-V-Versorgung
- empfohlen 470–1000 µF Kondensator nahe am Servo

Mechanik und Verriegelung können frei selbst gebaut werden.

## KinderKasse-Einstellungen

**Einstellungen → Kassenschublade**

- Kassenschublade aktivieren
- nach erfolgreicher Barzahlung automatisch öffnen

Ist die Funktion deaktiviert, verhält sich KinderKasse exakt wie ohne
Kassenschublade.

## Docker / Server

Der ESP32-C3 verbindet sich per WLAN und fragt ab:

`/api/drawer/command`

Cloudflare Access Service Token kann in der Firmware konfiguriert werden.

## Lokale APK

BLE-Gerätename:
`KasseDrawer`

Service:
`7a0f2001-1b55-4e2a-9c2e-9a6b9f3a2c10`

Command:
`7a0f2002-1b55-4e2a-9c2e-9a6b9f3a2c10`

Einmal in den Einstellungen verbinden, danach Auto-Reconnect.

## Sicherheits-/Ablauflogik

Der Öffnungsbefehl wird erst gesendet, wenn die Barzahlung erfolgreich in der
KinderKasse gespeichert wurde.

Wenn die Schublade nicht erreichbar ist:
- Verkauf bleibt gespeichert
- Kasse bleibt bedienbar
- keine Pflicht zur angeschlossenen Schublade
