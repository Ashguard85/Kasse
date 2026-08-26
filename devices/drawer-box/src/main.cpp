#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <NimBLEDevice.h>
#include <ESP32Servo.h>

static const char *FW_VERSION = "1.0.0";
static const char *BLE_NAME = "KasseDrawer";
static NimBLEUUID SERVICE_UUID("7a0f2001-1b55-4e2a-9c2e-9a6b9f3a2c10");
static NimBLEUUID CMD_UUID("7a0f2002-1b55-4e2a-9c2e-9a6b9f3a2c10");

// Bei Bedarf hier an deine Mechanik anpassen.
static const int SERVO_PIN = 4;
static const int SERVO_CLOSED_DEG = 0;
static const int SERVO_OPEN_DEG = 40;
static const int OPEN_HOLD_MS = 400;

Preferences prefs;
Servo drawerServo;
String serverUrl, cfClientId, cfClientSecret;
unsigned long lastPoll = 0;
long lastCommandVersion = -1;
bool commandVersionInitialized = false;

void openDrawer() {
  Serial.println("OPEN: Servo entriegelt");
  drawerServo.write(SERVO_OPEN_DEG);
  delay(OPEN_HOLD_MS);
  drawerServo.write(SERVO_CLOSED_DEG);
  Serial.println("OPEN: Servo wieder in Ruhestellung");
}

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo&) override {
    std::string raw = c->getValue();
    String cmd;
    for (char ch : raw) cmd += ch;
    cmd.trim();
    cmd.toUpperCase();
    if (cmd == "OPEN") openDrawer();
  }
};

void setupBle() {
  NimBLEDevice::init(BLE_NAME);
  auto *server = NimBLEDevice::createServer();
  auto *service = server->createService(SERVICE_UUID);
  auto *cmd = service->createCharacteristic(CMD_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  cmd->setCallbacks(new CommandCallbacks());
  service->start();
  auto *adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setName(BLE_NAME);
  adv->start();
}

int getCommandVersion(const String &body) {
  int pos = body.indexOf("\"version\"");
  if (pos < 0) return -1;
  pos = body.indexOf(':', pos);
  if (pos < 0) return -1;
  pos++;
  while (pos < (int)body.length() && (body[pos] == ' ' || body[pos] == '\t')) pos++;
  return body.substring(pos).toInt();
}

bool pollDrawerCommand() {
  if (serverUrl.length() < 8 || WiFi.status() != WL_CONNECTED) return false;
  String url = serverUrl;
  if (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/api/drawer/command";

  HTTPClient http;
  int code = -1;
  String body;

  if (url.startsWith("https://")) {
    WiFiClientSecure client;
    client.setInsecure(); // TLS verschlüsselt; Zertifikatsprüfung siehe README.
    if (!http.begin(client, url)) return false;
    if (cfClientId.length()) http.addHeader("CF-Access-Client-Id", cfClientId);
    if (cfClientSecret.length()) http.addHeader("CF-Access-Client-Secret", cfClientSecret);
    code = http.GET();
    if (code == 200) body = http.getString();
  } else {
    WiFiClient client;
    if (!http.begin(client, url)) return false;
    if (cfClientId.length()) http.addHeader("CF-Access-Client-Id", cfClientId);
    if (cfClientSecret.length()) http.addHeader("CF-Access-Client-Secret", cfClientSecret);
    code = http.GET();
    if (code == 200) body = http.getString();
  }
  http.end();
  if (code != 200) return false;

  long version = getCommandVersion(body);
  if (version < 0) return false;

  // Beim ersten Kontakt nur synchronisieren. So öffnet die Schublade nach
  // Neustart nicht wegen eines alten OPEN-Befehls.
  if (!commandVersionInitialized) {
    lastCommandVersion = version;
    commandVersionInitialized = true;
    return true;
  }
  if (version > lastCommandVersion) {
    lastCommandVersion = version;
    openDrawer();
  }
  return true;
}

void configurePortal() {
  WiFiManager wm;
  WiFiManagerParameter pUrl("url", "KinderKasse Server URL", serverUrl.c_str(), 120);
  WiFiManagerParameter pId("cfid", "Cloudflare Client ID", cfClientId.c_str(), 120);
  WiFiManagerParameter pSecret("cfsecret", "Cloudflare Client Secret", cfClientSecret.c_str(), 180);
  wm.addParameter(&pUrl);
  wm.addParameter(&pId);
  wm.addParameter(&pSecret);
  wm.setConfigPortalTimeout(240);

  if (wm.autoConnect("KinderKasse-Drawer-Setup")) {
    serverUrl = pUrl.getValue();
    cfClientId = pId.getValue();
    cfClientSecret = pSecret.getValue();
    prefs.putString("server", serverUrl);
    prefs.putString("cfid", cfClientId);
    prefs.putString("cfsecret", cfClientSecret);
  }
}

void setup() {
  Serial.begin(115200);
  Serial.printf("KinderKasse Drawer %s\n", FW_VERSION);

  drawerServo.setPeriodHertz(50);
  drawerServo.attach(SERVO_PIN, 500, 2400);
  drawerServo.write(SERVO_CLOSED_DEG);
  delay(300);

  prefs.begin("kdrawer", false);
  serverUrl = prefs.getString("server", "");
  cfClientId = prefs.getString("cfid", "");
  cfClientSecret = prefs.getString("cfsecret", "");

  setupBle();
  WiFi.mode(WIFI_STA);
  configurePortal();
}

void loop() {
  if (millis() - lastPoll > 700) {
    lastPoll = millis();
    pollDrawerCommand();
  }
  delay(10);
}
