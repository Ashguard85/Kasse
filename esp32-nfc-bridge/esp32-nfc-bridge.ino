/*
 * ESP32 + PN532 → Web Bluetooth NFC Bridge
 * ==========================================
 * Liest NFC-Karten-UIDs über den PN532 (I2C) und sendet sie als
 * BLE-Notification an den Browser (Web Bluetooth API).
 *
 * Lenovo Tab M11 hat kein eigenes NFC — dieser Bridge ersetzt es.
 *
 * Verkabelung (I2C-Modus, PN532-Dip-Switches: Switch1=ON, Switch2=OFF):
 *   PN532 VCC  -> ESP32 3.3V
 *   PN532 GND  -> ESP32 GND
 *   PN532 SDA  -> ESP32 GPIO21
 *   PN532 SCL  -> ESP32 GPIO22
 *
 * Benötigte Libraries (über Arduino IDE Library Manager):
 *   - "Adafruit PN532" von Adafruit
 *   - ESP32 BLE Arduino (kommt mit dem ESP32-Board-Paket)
 *
 * Nach dem Flashen erscheint das Gerät als "KasseNFC" in der
 * Bluetooth-Geräteliste. Die Web-App verbindet sich automatisch,
 * sobald man in der Kasse auf "Mit NFC bezahlen" tippt.
 */

#include <Wire.h>
#include <Adafruit_PN532.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── PN532 Setup (I2C) ──────────────────────────────────────────────────────
#define PN532_IRQ   (-1)   // nicht verwendet
#define PN532_RESET (-1)   // nicht verwendet
Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);

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
  Serial.println("\n=== Kasse NFC-Bridge startet ===");

  // PN532 initialisieren
  Wire.begin(21, 22); // SDA=21, SCL=22 (Standard ESP32 I2C-Pins)
  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("FEHLER: PN532 nicht gefunden! Verkabelung prüfen.");
    while (1) { delay(1000); }
  }
  Serial.print("PN532 gefunden, Firmware-Version: ");
  Serial.println((versiondata >> 16) & 0xFF, HEX);

  nfc.SAMConfig();
  nfc.setPassiveActivationRetries(0xFF);

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
  uint8_t uid[7];
  uint8_t uidLength;

  // Kurzer Timeout (100ms), damit BLE-Stack nicht blockiert
  bool success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 100);

  if (success) {
    String uidHex = "";
    for (uint8_t i = 0; i < uidLength; i++) {
      if (uid[i] < 0x10) uidHex += "0";
      uidHex += String(uid[i], HEX);
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
  } else {
    // Keine Karte erkannt — Debounce nach kurzer Zeit zurücksetzen,
    // damit dieselbe Karte erneut gelesen werden kann, nachdem sie kurz weg war
    if (millis() - lastReadTime > DEBOUNCE_MS * 2) {
      lastUid = "";
    }
  }
}
