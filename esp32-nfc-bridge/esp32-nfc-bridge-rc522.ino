/*
 * ESP32 + RC522 → Web Bluetooth NFC Bridge (Variante für RC522 statt PN532)
 * =============================================================================
 * Liest NFC-Karten-UIDs über den RC522 (SPI) und sendet sie als
 * BLE-Notification an den Browser (Web Bluetooth API).
 *
 * Lenovo Tab M11 hat kein eigenes NFC — dieser Bridge ersetzt es.
 *
 * Verkabelung (SPI-Modus, RC522 läuft IMMER über SPI, kein Umschalten nötig):
 *   RC522 SDA(SS) -> ESP32 GPIO5
 *   RC522 SCK     -> ESP32 GPIO18
 *   RC522 MOSI    -> ESP32 GPIO23
 *   RC522 MISO    -> ESP32 GPIO19
 *   RC522 RST     -> ESP32 GPIO22
 *   RC522 GND     -> ESP32 GND
 *   RC522 3.3V    -> ESP32 3.3V   (NIEMALS 5V! RC522 ist 3.3V-only)
 *
 * Benötigte Libraries (über Arduino IDE Library Manager):
 *   - "MFRC522" von GithubCommunity (oft als "MFRC522v2" gelistet)
 *   - ESP32 BLE Arduino (kommt mit dem ESP32-Board-Paket)
 *
 * Unterstützt MIFARE Classic / Ultralight (ISO14443A) — die gängigsten
 * NFC-Karten und -Schlüsselanhänger. Reicht für dieses Kassenspiel-Projekt.
 *
 * Nach dem Flashen erscheint das Gerät als "KasseNFC" in der
 * Bluetooth-Geräteliste. Die Web-App verbindet sich automatisch,
 * sobald man in der Kasse auf "Mit NFC-Box bezahlen" tippt.
 */

#include <SPI.h>
#include <MFRC522.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── RC522 Setup (SPI) ────────────────────────────────────────────────────────
#define RST_PIN   22
#define SS_PIN     5
MFRC522 mfrc522(SS_PIN, RST_PIN);

// ── BLE GATT UUIDs ──────────────────────────────────────────────────────────
// Eigene, zufällig generierte UUIDs — müssen exakt mit dem Frontend übereinstimmen!
#define SERVICE_UUID        "7a0f0001-1b55-4e2a-9c2e-9a6b9f3a2c10"
#define UID_CHAR_UUID        "7a0f0002-1b55-4e2a-9c2e-9a6b9f3a2c10"
#define DEVICE_NAME          "KasseNFC"

BLEServer* pServer = nullptr;
BLECharacteristic* pUidCharacteristic = nullptr;
bool deviceConnected = false;

// Verhindert, dass dieselbe Karte mehrfach pro Auflegen gesendet wird
String lastUid = "";
unsigned long lastReadTime = 0;
const unsigned long DEBOUNCE_MS = 1500;

// ── BLE Server Callbacks ──────────────────────────────────────────────────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    Serial.println("BLE: Client verbunden");
  }
  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    Serial.println("BLE: Client getrennt — Advertising neu starten");
    BLEDevice::startAdvertising();
  }
};

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Kasse NFC-Bridge (RC522) startet ===");

  // RC522 initialisieren
  SPI.begin(); // Standard ESP32 SPI-Pins: SCK=18, MISO=19, MOSI=23
  mfrc522.PCD_Init();

  // Firmware-Version prüfen, um sicherzustellen, dass der Chip erreichbar ist
  byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0x00 || version == 0xFF) {
    Serial.println("FEHLER: RC522 nicht gefunden! Verkabelung prüfen.");
    while (1) { delay(1000); }
  }
  Serial.print("RC522 gefunden, Versions-Register: 0x");
  Serial.println(version, HEX);

  // BLE Server aufsetzen
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);
  pUidCharacteristic = pService->createCharacteristic(
    UID_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pUidCharacteristic->addDescriptor(new BLE2902());
  pUidCharacteristic->setValue("ready");

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("BLE Advertising gestartet, Gerätename: " DEVICE_NAME);
  Serial.println("Bereit zum Kartenlesen.");
}

void loop() {
  // Neue Karte in Reichweite?
  if (!mfrc522.PICC_IsNewCardPresent()) {
    // Keine Karte erkannt — Debounce nach kurzer Zeit zurücksetzen,
    // damit dieselbe Karte erneut gelesen werden kann, nachdem sie kurz weg war
    if (millis() - lastReadTime > DEBOUNCE_MS * 2) {
      lastUid = "";
    }
    delay(50);
    return;
  }

  // UID auslesen
  if (!mfrc522.PICC_ReadCardSerial()) {
    return;
  }

  String uidHex = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uidHex += "0";
    uidHex += String(mfrc522.uid.uidByte[i], HEX);
  }
  uidHex.toUpperCase();

  unsigned long now = millis();
  bool isDuplicate = (uidHex == lastUid) && (now - lastReadTime < DEBOUNCE_MS);

  if (!isDuplicate) {
    Serial.print("Karte gelesen: ");
    Serial.println(uidHex);

    if (deviceConnected && pUidCharacteristic != nullptr) {
      pUidCharacteristic->setValue(uidHex.c_str());
      pUidCharacteristic->notify();
      Serial.println("  -> per BLE gesendet");
    } else {
      Serial.println("  -> kein BLE-Client verbunden, ignoriert");
    }

    lastUid = uidHex;
    lastReadTime = now;
  }

  // Karte "schlafen legen", damit der RC522 bereit für die nächste ist
  mfrc522.PICC_HaltA();
}
