/*
  KinderKasse Kundendisplay – ESP32-S3 4.3"
  ================================================

  Arduino IDE – benötigte Libraries (Bibliotheksverwalter):
    - GFX Library for Arduino (Arduino_GFX_Library)
    - BLE-Bibliothek aus dem ESP32 Board-Paket (keine separate NimBLE-Library)
    - ArduinoJson

  Board in Arduino IDE:
    - ESP32S3 Dev Module
    - Flash Size: 16MB
    - PSRAM: OPI PSRAM
    - USB CDC On Boot: Disabled (empfohlen fuer CH343-Seriell)
    - Partition Scheme: Huge APP

  Hardware:
    - Waveshare ESP32-S3-Touch-LCD-4.3, 800x480
    - Touch GT911: SDA GPIO8, SCL GPIO9, IRQ GPIO4, Reset ueber CH422G EXIO1
    - Touch ab 1.3.4 ausschliesslich ueber Arduino Wire (kein ESP32_Display_Panel)

  Verbindung:
    - ausschliesslich BLE als "KasseDisplay"
    - lokaler Modus: KinderKasse -> BLE -> Display
    - Docker-/Servermodus: KinderKasse-App holt Daten vom Server und sendet sie -> BLE -> Display
    - der ESP32 selbst nutzt kein WLAN, HTTP, WiFiManager oder Cloudflare

  Serieller Monitor: 115200 Baud.

  Rendering ab 1.4.1:
    - stabiler 800x480 RGB565-Canvas im PSRAM bleibt erhalten
    - Shop-Ansicht wird in Dirty-Regions aktualisiert (Artikelzeilen, Total, Zahlung)
    - PIN/Konto aktualisieren nur ihre dynamischen Teilbereiche
    - kompletter Frame nur noch bei Seiten-/Themewechsel oder erzwungenem Neuaufbau
    - semantischer Zustandsvergleich verhindert unnoetige Refreshs

  Diese Datei ist der Arduino-IDE-Hauptsketch.
*/

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <math.h>
#include <ArduinoJson.h>
#include <Arduino_GFX_Library.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Wire.h>

static const char *FW_VERSION = "1.4.1";
static const char *BLE_NAME = "KasseDisplay";
static const char *SERVICE_UUID = "7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10";
static const char *RX_UUID = "7a0f1002-1b55-4e2a-9c2e-9a6b9f3a2c10";
static const char *INPUT_UUID = "7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10";
static BLECharacteristic *inputCharacteristic = nullptr;
static BLEServer *bleServer = nullptr;
static BLEAdvertising *bleAdvertising = nullptr;
static bool bleAdvertisingStarted = false;
static bool bleConnected = false;
static bool bleRestartAdvertising = false;
static unsigned long bleRestartRequestedAt = 0;

// BLE-Callbacks laufen in einem eigenen FreeRTOS-Kontext. Seit 1.3.5 wird
// dort NICHT mehr gerendert. Der fertige JSON-Zustand wird nur zwischengespeichert
// und anschliessend im normalen Arduino-loop() verarbeitet.
static SemaphoreHandle_t bleJsonMutex = nullptr;
static String pendingBleJson = "";
static volatile bool pendingBleJsonReady = false;

String bleBuffer;
String pinEntry;
String accountCurrentPin, accountNewPin;
bool pinScreen = false;
bool accountScreen = false;
int accountStep = 0; // 0=home,1=current pin,2=new pin,3=confirm,4=disable current
unsigned long lastTouchMs = 0;

// Service-Geste: obere linke Ecke 5 Sekunden gedrueckt halten.
// Da die Firmware keine WLAN-Konfiguration mehr besitzt, fuehrt die Geste
// einen sauberen Neustart von Display/BLE aus.
static const uint16_t SERVICE_RESTART_X_MAX = 120;
static const uint16_t SERVICE_RESTART_Y_MAX = 100;
static const unsigned long SERVICE_RESTART_HOLD_MS = 5000;
static const unsigned long SERVICE_RESTART_RELEASE_GAP_MS = 700;
unsigned long serviceRestartHoldStart = 0;
unsigned long serviceRestartLastSeen = 0;
bool serviceRestartTriggered = false;

uint16_t bleMessageId = 0;
uint8_t bleExpected = 0, bleReceived = 0;

// Waveshare ESP32-S3-Touch-LCD-4.3 RGB mapping.
Arduino_ESP32RGBPanel *rgbpanel = new Arduino_ESP32RGBPanel(
  5, 3, 46, 7,
  1, 2, 42, 41, 40,
  39, 0, 45, 48, 47, 21,
  14, 38, 18, 17, 10,
  0, 40, 48, 88,
  0, 13, 3, 32,
  1, 16000000
);
Arduino_RGB_Display *panelDisplay = new Arduino_RGB_Display(800, 480, rgbpanel, 0, true);
Arduino_Canvas *frameCanvas = new Arduino_Canvas(800, 480, panelDisplay);
Arduino_GFX *gfx = nullptr;
bool bufferedRendering = false;
bool appFrameValid = false;
uint32_t lastRenderedHash = 0;
uint32_t renderCounter = 0;
uint32_t partialRenderCounter = 0;

// Snapshot der zuletzt wirklich auf dem Panel sichtbaren Regionen.
// So kann eine neue BLE-Nachricht gezielt nur die Pixelbereiche aktualisieren,
// deren sichtbarer Inhalt sich geaendert hat.
struct RenderSnapshot {
  bool valid=false;
  uint8_t screen=255; // 0=shop, 1=pin, 2=account
  uint32_t themeHash=0;
  bool shopWasEmpty=true;
  uint32_t shopEmptyHash=0;
  uint32_t itemHash[9]={0};
  uint32_t totalHash=0;
  uint32_t paymentHash=0;
  uint32_t pinDynamicHash=0;
  uint32_t accountLeftHash=0;
  uint32_t accountRightHash=0;
} rendered;

static uint16_t rgb565(uint8_t r,uint8_t g,uint8_t b){return ((r&0xF8)<<8)|((g&0xFC)<<3)|(b>>3);}
static uint16_t colorHex(const char* s,uint16_t fallback){
  if(!s||s[0]!='#'||strlen(s)<7)return fallback;
  long v=strtol(s+1,nullptr,16); return rgb565((v>>16)&255,(v>>8)&255,v&255);
}

// Sichtbaren Zustand hashen statt rohe JSON-Strings zu vergleichen.
// Dadurch loesen Zeitstempel, Feldreihenfolge oder wiederholte BLE-Pakete
// keinen erneuten Bildschirmaufbau aus, solange sich die Anzeige nicht aendert.
static void hashByte(uint32_t &h,uint8_t value){
  h ^= value;
  h *= 16777619u;
}
static void hashU32(uint32_t &h,uint32_t value){
  hashByte(h,(uint8_t)(value));
  hashByte(h,(uint8_t)(value>>8));
  hashByte(h,(uint8_t)(value>>16));
  hashByte(h,(uint8_t)(value>>24));
}
static void hashString(uint32_t &h,const String& value){
  hashU32(h,(uint32_t)value.length());
  for(size_t i=0;i<value.length();i++) hashByte(h,(uint8_t)value[i]);
}
static void hashMoney(uint32_t &h,float value){
  int32_t cents=(int32_t)lroundf(value*100.0f);
  hashU32(h,(uint32_t)cents);
}
static const uint8_t TOUCH_SDA_PIN = 8;
static const uint8_t TOUCH_SCL_PIN = 9;
static const uint8_t TOUCH_IRQ_PIN = 4;

static const uint8_t CH422_MODE_ADDR = 0x24;
static const uint8_t CH422_OUT_ADDR  = 0x38;
static const uint8_t CH422_BL_BIT    = 2; // EXIO2 = Backlight
static const uint8_t CH422_RST_BIT   = 1; // EXIO1 = GT911 Reset

static const uint8_t GT911_ADDR_PRIMARY = 0x5D;
static const uint8_t GT911_ADDR_BACKUP  = 0x14;
static uint8_t gt911Address = 0;
static bool touchReady = false;
static unsigned long lastTouchLogMs = 0;
static unsigned long lastTouchDiagMs = 0;

// Firmware 1.3.5: GT911 ausschliesslich ueber Arduino Wire.
// Kein ESP32_Display_Panel und damit kein Mix aus altem/neuem ESP-IDF-I2C-Treiber.
// Dieser Code basiert direkt auf dem erfolgreich getesteten KinderKasseTouchTest-1.0.
static bool ch422Write(uint8_t addr,uint8_t value){
  Wire.beginTransmission(addr);
  Wire.write(value);
  return Wire.endTransmission()==0;
}

static bool i2cProbe(uint8_t addr){
  Wire.beginTransmission(addr);
  return Wire.endTransmission()==0;
}

static bool gt911ReadBytes(uint16_t reg,uint8_t *data,size_t len){
  if(!gt911Address) return false;

  Wire.beginTransmission(gt911Address);
  Wire.write((uint8_t)(reg>>8));
  Wire.write((uint8_t)(reg&0xFF));
  if(Wire.endTransmission(false)!=0) return false;

  size_t got=Wire.requestFrom((int)gt911Address,(int)len);
  if(got!=len){
    while(Wire.available()) Wire.read();
    return false;
  }
  for(size_t i=0;i<len;i++) data[i]=Wire.read();
  return true;
}

static bool gt911WriteByte(uint16_t reg,uint8_t value){
  if(!gt911Address) return false;
  Wire.beginTransmission(gt911Address);
  Wire.write((uint8_t)(reg>>8));
  Wire.write((uint8_t)(reg&0xFF));
  Wire.write(value);
  return Wire.endTransmission()==0;
}

static void printI2cScan(){
  Serial.print("I2C Scan:");
  bool any=false;
  for(uint8_t addr=1;addr<0x7F;addr++){
    if(i2cProbe(addr)){
      Serial.printf(" 0x%02X",addr);
      any=true;
    }
  }
  if(!any) Serial.print(" keines");
  Serial.println();
}

static void resetGt911(){
  Serial.println("GT911 Resetsequenz ...");

  if(!ch422Write(CH422_MODE_ADDR,0x01)){
    Serial.println("WARNUNG: CH422G Mode-Write fehlgeschlagen");
  }

  // Adresse 0x5D waehlen: INT waehrend Reset-Freigabe LOW halten.
  pinMode(TOUCH_IRQ_PIN,OUTPUT);
  digitalWrite(TOUCH_IRQ_PIN,LOW);
  delay(10);

  // Backlight bleibt an, Touch-Reset LOW.
  ch422Write(CH422_OUT_ADDR,(1<<CH422_BL_BIT));
  delay(100);

  // Touch-Reset freigeben.
  ch422Write(CH422_OUT_ADDR,(1<<CH422_BL_BIT)|(1<<CH422_RST_BIT));
  delay(200);

  // INT nach der Adresswahl freigeben.
  pinMode(TOUCH_IRQ_PIN,INPUT_PULLUP);
  delay(20);
}

static bool initGt911(){
  if(i2cProbe(GT911_ADDR_PRIMARY)) gt911Address=GT911_ADDR_PRIMARY;
  else if(i2cProbe(GT911_ADDR_BACKUP)) gt911Address=GT911_ADDR_BACKUP;
  else return false;

  uint8_t id[4]={0};
  if(gt911ReadBytes(0x8140,id,4)){
    Serial.printf("GT911 gefunden bei 0x%02X, Product-ID: %c%c%c%c\n",
                  gt911Address,
                  (id[0]>=32&&id[0]<127)?id[0]:'?',
                  (id[1]>=32&&id[1]<127)?id[1]:'?',
                  (id[2]>=32&&id[2]<127)?id[2]:'?',
                  (id[3]>=32&&id[3]<127)?id[3]:'?');
  }

  uint8_t cfg[5]={0};
  if(gt911ReadBytes(0x8047,cfg,sizeof(cfg))){
    uint16_t xMax=((uint16_t)cfg[2]<<8)|cfg[1];
    uint16_t yMax=((uint16_t)cfg[4]<<8)|cfg[3];
    Serial.printf("GT911 Config: Version=%u Xmax=%u Ymax=%u\n",cfg[0],xMax,yMax);
  }

  // Alten Data-Ready-Status beim Start einmal loeschen.
  gt911WriteByte(0x814E,0x00);
  return true;
}

static void initBoardIoAndTouch(){
  Serial.printf("Touch HW: Waveshare ESP32-S3-Touch-LCD-4.3 / GT911, SDA=%u SCL=%u IRQ=%u\n",
                TOUCH_SDA_PIN,TOUCH_SCL_PIN,TOUCH_IRQ_PIN);
  Serial.println("Touch Treiber: Arduino Wire (kein ESP32_Display_Panel)");

  Wire.begin(TOUCH_SDA_PIN,TOUCH_SCL_PIN);
  Wire.setClock(400000);

  resetGt911();
  printI2cScan();

  touchReady=initGt911();
  if(touchReady){
    Serial.printf("Touch bereit: JA (Adresse 0x%02X, Arduino Wire)\n",gt911Address);
  }else{
    Serial.println("Touch bereit: NEIN - GT911 nicht bei 0x5D/0x14 gefunden");
  }
}

static void flushFrame(){
  // Vollbild-Flush nur fuer ersten Aufbau, Seitenwechsel oder Themewechsel.
  if(bufferedRendering && gfx) gfx->flush();
}

static void flushRegion(int16_t x,int16_t y,int16_t w,int16_t h){
  // Im Direktmodus schreibt Arduino_RGB_Display ohnehin direkt in sein RGB-Framebuffer.
  if(!bufferedRendering || !frameCanvas || !panelDisplay) return;
  if(x<0){w+=x;x=0;}
  if(y<0){h+=y;y=0;}
  if(x+w>800) w=800-x;
  if(y+h>480) h=480-y;
  if(w<=0 || h<=0) return;

  uint16_t *fb=frameCanvas->getFramebuffer();
  if(!fb){
    flushFrame();
    return;
  }

  // Eine Teilregion ist im Canvas wegen des 800-Pixel-Zeilenstrides nicht
  // zusammenhaengend. Deshalb werden nur die betroffenen Scanlines ins echte
  // RGB-Framebuffer kopiert. Das vermeidet den bisherigen 800x480-Vollbildcopy.
  for(int16_t row=0;row<h;row++){
    uint16_t *src=fb + ((int32_t)(y+row)*800) + x;
    panelDisplay->draw16bitRGBBitmap(x,y+row,src,w,1);
  }
}

struct DisplayState {
  String profile="KinderKasse", banner="Willkommen!", status="shop", payment="", message="", pinCustomer="";
  String accountName="", accountMessage="", accountError="";
  bool pinInvalid=false, accountPinConfigured=false;
  float accountBalance=0;
  uint16_t primary=rgb565(26,122,60), bg=rgb565(243,244,246), bannerBg=rgb565(26,122,60), bannerText=0xFFFF;
  float total=0, tendered=-1, change=-1;
  struct Item { String name; int qty; float price; } items[12];
  int count=0;
} state;

void drawConnectionStatus(const String& line1,const String& line2="",const String& line3="");
static void flushFrame();
static void flushRegion(int16_t x,int16_t y,int16_t w,int16_t h);
static uint32_t visibleStateHash();
bool render(bool force=false);

static uint8_t currentScreenKind(){
  if(state.status=="pin") return 1;
  if(state.status=="account") return 2;
  return 0;
}

static uint32_t themeRenderHash(){
  uint32_t h=2166136261u;
  hashU32(h,state.primary);
  hashU32(h,state.bg);
  hashU32(h,state.bannerBg);
  hashU32(h,state.bannerText);
  return h;
}

static uint32_t shopItemSlotHash(int slot){
  uint32_t h=2166136261u;
  if(state.count<=0) return h;
  int start=state.count>9?state.count-9:0;
  int idx=start+slot;
  if(slot<0 || slot>=9 || idx>=state.count){
    hashU32(h,0);
    return h;
  }
  hashString(h,state.items[idx].name);
  hashU32(h,(uint32_t)state.items[idx].qty);
  hashMoney(h,state.items[idx].price);
  return h;
}

static uint32_t shopEmptyHash(){
  uint32_t h=2166136261u;
  hashString(h,state.status=="success"?String("Danke"):String("Willkommen"));
  return h;
}

static uint32_t totalRegionHash(){
  uint32_t h=2166136261u;
  hashMoney(h,state.total);
  return h;
}

static uint32_t paymentRegionHash(){
  uint32_t h=2166136261u;
  hashString(h,state.status);
  hashString(h,state.payment);
  hashMoney(h,state.tendered);
  hashMoney(h,state.change);
  return h;
}

static uint32_t pinDynamicRegionHash(){
  uint32_t h=2166136261u;
  hashString(h,state.pinCustomer);
  hashU32(h,state.pinInvalid?1u:0u);
  hashString(h,pinEntry);
  return h;
}

static uint32_t accountLeftRegionHash(){
  uint32_t h=2166136261u;
  hashString(h,state.accountName);
  hashMoney(h,state.accountBalance);
  hashU32(h,state.accountPinConfigured?1u:0u);
  return h;
}

static uint32_t accountRightRegionHash(){
  uint32_t h=2166136261u;
  hashString(h,state.accountMessage);
  hashString(h,state.accountError);
  hashU32(h,(uint32_t)accountStep);
  hashString(h,pinEntry);
  return h;
}

void drawCentered(const String& text,int y,uint16_t color,int size){
  gfx->setTextColor(color); gfx->setTextSize(size);
  int16_t x1,y1; uint16_t w,h;
  gfx->getTextBounds(text,0,y,&x1,&y1,&w,&h);
  gfx->setCursor(max(8,(800-(int)w)/2),y); gfx->print(text);
}
bool gt911Read(uint16_t &x,uint16_t &y){
  if(!touchReady || !gt911Address) return false;

  uint8_t status=0;
  if(!gt911ReadBytes(0x814E,&status,1)){
    if(millis()-lastTouchDiagMs>1000){
      lastTouchDiagMs=millis();
      Serial.println("GT911 Status konnte nicht gelesen werden");
    }
    return false;
  }

  const bool ready=(status&0x80)!=0;
  const uint8_t count=status&0x0F;
  if(!ready) return false;

  if(count==0 || count>5){
    gt911WriteByte(0x814E,0x00);
    return false;
  }

  uint8_t data[5*8]={0};
  const size_t bytes=(size_t)count*8;
  if(!gt911ReadBytes(0x814F,data,bytes)){
    Serial.println("GT911 Punktdaten konnten nicht gelesen werden");
    gt911WriteByte(0x814E,0x00);
    return false;
  }

  // Ersten Touchpunkt fuer die Bedienoberflaeche verwenden.
  const uint8_t *point=&data[0];
  uint16_t rawX=((uint16_t)point[2]<<8)|point[1];
  uint16_t rawY=((uint16_t)point[4]<<8)|point[3];
  uint16_t size=((uint16_t)point[6]<<8)|point[5];

  // Erst quittieren, nachdem der komplette Punkt-Frame gelesen wurde.
  gt911WriteByte(0x814E,0x00);

  // Das Original-Waveshare-4.3 meldet 800x480. Falls eine Firmwarevariante
  // die Achsen als 480x800 liefert, wird das automatisch erkannt.
  if(rawX<800 && rawY<480){
    x=rawX;
    y=rawY;
  }else if(rawX<480 && rawY<800){
    x=rawY;
    y=rawX;
  }else{
    if(millis()-lastTouchDiagMs>500){
      lastTouchDiagMs=millis();
      Serial.printf("Touch ausserhalb Bereich: rawX=%u rawY=%u\n",rawX,rawY);
    }
    return false;
  }

  if(millis()-lastTouchLogMs>200){
    lastTouchLogMs=millis();
    Serial.printf("Touch: x=%u y=%u raw=%u/%u size=%u points=%u IRQ=%s\n",
                  x,y,rawX,rawY,size,count,
                  digitalRead(TOUCH_IRQ_PIN)==LOW?"LOW":"HIGH");
  }
  return true;
}

void restartDisplayService(){
  if(serviceRestartTriggered) return;
  serviceRestartTriggered=true;
  Serial.println("SERVICE: Display/BLE wird neu gestartet ...");
  drawConnectionStatus("Service Neustart", "BLE wird neu gestartet", "Bitte kurz warten ...");
  delay(500);
  ESP.restart();
}

bool handleServiceRestartPoint(uint16_t x,uint16_t y){
  unsigned long now=millis();
  bool inCorner=(x<=SERVICE_RESTART_X_MAX && y<=SERVICE_RESTART_Y_MAX);
  if(!inCorner){
    serviceRestartHoldStart=0;
    serviceRestartLastSeen=0;
    return false;
  }

  // Kurze Luecken zwischen GT911-Reports tolerieren, ohne den 5-Sekunden-
  // Zaehler bei jedem Touch-Report neu zu starten.
  if(serviceRestartHoldStart==0 || (serviceRestartLastSeen && now-serviceRestartLastSeen>SERVICE_RESTART_RELEASE_GAP_MS)){
    serviceRestartHoldStart=now;
    Serial.println("SERVICE: Neustart-Geste erkannt - Ecke 5 Sekunden halten ...");
  }
  serviceRestartLastSeen=now;

  if(now-serviceRestartHoldStart>=SERVICE_RESTART_HOLD_MS){
    restartDisplayService();
  }
  return true; // Ecke ist fuer die Service-Geste reserviert.
}

void serviceRestartRelease(){
  if(serviceRestartHoldStart && millis()-serviceRestartLastSeen>SERVICE_RESTART_RELEASE_GAP_MS){
    serviceRestartHoldStart=0;
    serviceRestartLastSeen=0;
  }
}

void handleServiceRestartTouch(){
  if(pinScreen || accountScreen) return;
  if(millis()-lastTouchMs<90){serviceRestartRelease();return;}
  uint16_t x,y;
  if(!gt911Read(x,y)){serviceRestartRelease();return;}
  lastTouchMs=millis();
  handleServiceRestartPoint(x,y);
}

void sendInputJson(const String& body){
  if(inputCharacteristic && bleConnected){
    inputCharacteristic->setValue(body.c_str());
    inputCharacteristic->notify();
    Serial.println("Touch-Eingabe -> BLE");
    return;
  }
  Serial.println("Touch-Eingabe verworfen: KasseDisplay ist nicht per BLE verbunden");
}
void drawFrame(){
  gfx->drawRoundRect(5,5,790,470,12,state.bannerBg);
  gfx->drawRoundRect(6,6,788,468,11,state.bannerBg);
}
void drawPaymentPinDynamic(){
  // Nur oberer dynamischer Bereich; der Tastenblock bleibt unangetastet.
  gfx->fillRect(12,18,776,150,state.bg);
  drawCentered(state.pinCustomer.length()?("Hallo "+state.pinCustomer):"PIN erforderlich",28,state.primary,3);
  drawCentered("PIN eingeben",76,0x2104,2);
  String dots="";
  for(size_t i=0;i<pinEntry.length();i++) dots+="* ";
  drawCentered(dots,112,state.primary,3);
  if(state.pinInvalid) drawCentered("PIN falsch - erneut versuchen",150,rgb565(185,28,28),2);
}
void drawPaymentKeypadStatic(){
  const int x0=205,y0=188,w=120,h=58,g=12;
  const char* keys[12]={"1","2","3","4","5","6","7","8","9","<-","0","OK"};
  for(int i=0;i<12;i++){
    int col=i%3,row=i/3; int x=x0+col*(w+g),y=y0+row*(h+g);
    uint16_t fill=(i==11)?state.primary:0xFFFF;
    gfx->fillRoundRect(x,y,w,h,10,fill); gfx->drawRoundRect(x,y,w,h,10,0xC618);
    gfx->setTextColor(i==11?0xFFFF:0x2104); gfx->setTextSize(2);
    int16_t x1,y1;uint16_t tw,th;gfx->getTextBounds(keys[i],0,0,&x1,&y1,&tw,&th);
    gfx->setCursor(x+(w-tw)/2,y+19);gfx->print(keys[i]);
  }
}
void drawPaymentKeypad(){
  gfx->fillScreen(state.bg);
  drawFrame();
  drawPaymentPinDynamic();
  drawPaymentKeypadStatic();
}
void drawAccountLeft(){
  gfx->fillRoundRect(18,18,310,444,14,0xFFFF);
  gfx->setTextColor(0x2104);gfx->setTextSize(2);
  gfx->setCursor(38,42);gfx->print("Kundenkonto");
  gfx->setTextColor(state.primary);gfx->setTextSize(3);
  gfx->setCursor(38,82);gfx->print(state.accountName.substring(0,16));
  gfx->setTextColor(0x4208);gfx->setTextSize(2);
  gfx->setCursor(38,132);gfx->print("Guthaben");
  gfx->setTextColor(state.primary);gfx->setTextSize(3);
  gfx->setCursor(38,160);gfx->print(String(state.accountBalance,2)+" CHF");

  gfx->setTextColor(0x4208);gfx->setTextSize(2);
  gfx->setCursor(38,212);gfx->print("Zahlungs-PIN");
  gfx->setTextColor(state.accountPinConfigured?state.primary:0x4208);
  gfx->setCursor(38,240);gfx->print(state.accountPinConfigured?"Aktiv":"Nicht aktiv");

  const int x=38,w=270,h=54;
  gfx->fillRoundRect(x,298,w,h,10,state.primary);
  gfx->setTextColor(0xFFFF);gfx->setTextSize(2);gfx->setCursor(65,316);
  gfx->print(state.accountPinConfigured?"PIN aendern":"PIN aktivieren");
  if(state.accountPinConfigured){
    gfx->fillRoundRect(x,360,w,h,10,rgb565(185,28,28));
    gfx->setTextColor(0xFFFF);gfx->setCursor(72,378);gfx->print("PIN deaktivieren");
  }
  gfx->fillRoundRect(x,422,w,30,8,0xC618);
  gfx->setTextColor(0x2104);gfx->setTextSize(1);gfx->setCursor(151,432);gfx->print("Fertig");
}
void drawAccountRight(){
  gfx->fillRoundRect(344,18,438,444,14,0xFFFF);
  if(state.accountMessage.length()){
    gfx->setTextColor(rgb565(22,101,52));gfx->setTextSize(2);gfx->setCursor(374,42);gfx->print(state.accountMessage.substring(0,30));
  } else if(state.accountError.length()){
    gfx->setTextColor(rgb565(185,28,28));gfx->setTextSize(2);gfx->setCursor(374,42);gfx->print(state.accountError.substring(0,30));
  }

  if(accountStep==0){
    gfx->setTextColor(0x4208);gfx->setTextSize(2);
    gfx->setCursor(405,190);gfx->print("Links Aktion waehlen");
    gfx->setCursor(424,226);gfx->print("Eingabe erscheint hier");
    return;
  }

  String title = accountStep==1 ? "Aktueller PIN" :
                 accountStep==2 ? "Neuer PIN" :
                 accountStep==3 ? "PIN wiederholen" : "PIN deaktivieren";
  gfx->setTextColor(state.primary);gfx->setTextSize(3);gfx->setCursor(385,72);gfx->print(title);
  String dots="";for(size_t i=0;i<pinEntry.length();i++)dots+="* ";
  gfx->setTextColor(0x2104);gfx->setTextSize(2);gfx->setCursor(475,112);gfx->print(dots);

  const int x0=390,y0=150,w=105,h=58,g=12;
  const char* keys[12]={"1","2","3","4","5","6","7","8","9","<-","0","OK"};
  for(int i=0;i<12;i++){
    int col=i%3,row=i/3;int x=x0+col*(w+g),y=y0+row*(h+g);
    uint16_t fill=(i==11)?state.primary:rgb565(245,245,245);
    gfx->fillRoundRect(x,y,w,h,9,fill);gfx->drawRoundRect(x,y,w,h,9,0xC618);
    gfx->setTextColor(i==11?0xFFFF:0x2104);gfx->setTextSize(2);
    int16_t x1,y1;uint16_t tw,th;gfx->getTextBounds(keys[i],0,0,&x1,&y1,&tw,&th);
    gfx->setCursor(x+(w-tw)/2,y+19);gfx->print(keys[i]);
  }
}
void drawAccount(){
  gfx->fillScreen(state.bg);drawFrame();drawAccountLeft();drawAccountRight();
}
void handlePaymentPinTouch(){
  if(!pinScreen)return;
  if(millis()-lastTouchMs<120){serviceRestartRelease();return;}
  uint16_t x,y;if(!gt911Read(x,y)){serviceRestartRelease();return;}lastTouchMs=millis();
  if(handleServiceRestartPoint(x,y))return;
  const int x0=205,y0=188,w=120,h=58,g=12;
  int col=(x-x0)/(w+g),row=(y-y0)/(h+g);
  if(x<x0||y<y0||col<0||col>2||row<0||row>3)return;
  int bx=x0+col*(w+g),by=y0+row*(h+g);if(x>bx+w||y>by+h)return;
  int idx=row*3+col;const char* keys[12]={"1","2","3","4","5","6","7","8","9","B","0","O"};
  char k=keys[idx][0];
  if(k>='0'&&k<='9'&&pinEntry.length()<8)pinEntry+=k;
  else if(k=='B'&&pinEntry.length())pinEntry.remove(pinEntry.length()-1);
  else if(k=='O'&&pinEntry.length()>=4){sendInputJson(String("{\"pin\":\"")+pinEntry+"\"}");pinEntry="";}
  render();
}
void handleAccountKeypadTouch(uint16_t x,uint16_t y){
  const int x0=390,y0=150,w=105,h=58,g=12;
  int col=(x-x0)/(w+g),row=(y-y0)/(h+g);
  if(x<x0||y<y0||col<0||col>2||row<0||row>3)return;
  int bx=x0+col*(w+g),by=y0+row*(h+g);if(x>bx+w||y>by+h)return;
  int idx=row*3+col;const char* keys[12]={"1","2","3","4","5","6","7","8","9","B","0","O"};
  char k=keys[idx][0];
  if(k>='0'&&k<='9'&&pinEntry.length()<8)pinEntry+=k;
  else if(k=='B'&&pinEntry.length())pinEntry.remove(pinEntry.length()-1);
  else if(k=='O'&&pinEntry.length()>=4){
    if(accountStep==1){accountCurrentPin=pinEntry;pinEntry="";accountStep=2;}
    else if(accountStep==2){accountNewPin=pinEntry;pinEntry="";accountStep=3;}
    else if(accountStep==3){
      if(pinEntry==accountNewPin){
        sendInputJson(String("{\"action\":\"account_set_pin\",\"currentPin\":\"")+accountCurrentPin+"\",\"newPin\":\""+accountNewPin+"\"}");
        accountStep=0;accountCurrentPin="";accountNewPin="";pinEntry="";
      }else{pinEntry="";accountNewPin="";accountStep=2;state.accountError="PINs stimmen nicht ueberein";}
    }else if(accountStep==4){
      sendInputJson(String("{\"action\":\"account_disable_pin\",\"currentPin\":\"")+pinEntry+"\"}");
      accountStep=0;pinEntry="";
    }
  }
}
void handleAccountTouch(){
  if(!accountScreen)return;
  if(millis()-lastTouchMs<120){serviceRestartRelease();return;}
  uint16_t x,y;if(!gt911Read(x,y)){serviceRestartRelease();return;}lastTouchMs=millis();
  if(handleServiceRestartPoint(x,y))return;
  if(x>=38&&x<=308&&y>=298&&y<=352){
    pinEntry="";accountCurrentPin="";accountNewPin="";
    accountStep=state.accountPinConfigured?1:2;state.accountError="";render();return;
  }
  if(state.accountPinConfigured&&x>=38&&x<=308&&y>=360&&y<=414){
    pinEntry="";accountStep=4;state.accountError="";render();return;
  }
  if(x>=38&&x<=308&&y>=422&&y<=452){sendInputJson("{\"action\":\"account_close\"}");return;}
  if(accountStep!=0){handleAccountKeypadTouch(x,y);render();}
}
static void drawShopItemSlot(int slot){
  const int rowY=28 + slot*38;
  gfx->fillRect(12,rowY-5,776,31,state.bg);
  if(state.count<=0) return;
  int start=state.count>9?state.count-9:0;
  int idx=start+slot;
  if(idx>=state.count) return;
  String left=String(state.items[idx].qty)+" x "+state.items[idx].name;
  String right=String(state.items[idx].qty*state.items[idx].price,2)+" CHF";
  gfx->setTextColor(0x2104);
  gfx->setTextSize(2);
  gfx->setCursor(24,rowY);
  gfx->print(left.substring(0,30));
  gfx->setCursor(620,rowY);
  gfx->print(right);
}

static void drawShopBodyFull(){
  gfx->fillRect(12,12,776,374,state.bg);
  if(state.count==0){
    drawCentered(state.status=="success"?"Vielen Dank!":"Willkommen!",180,state.primary,4);
    return;
  }
  for(int slot=0;slot<9;slot++) drawShopItemSlot(slot);
}

static void drawTotalRegion(){
  // Trennlinie liegt ausserhalb dieses Loeschbereichs und bleibt stabil stehen.
  gfx->fillRect(12,398,776,50,state.bg);
  gfx->setTextColor(state.primary);
  gfx->setTextSize(3);
  gfx->setCursor(24,410);
  gfx->print("TOTAL");
  gfx->setCursor(555,410);
  gfx->print(String(state.total,2)+" CHF");
}

static void drawPaymentRegion(){
  gfx->fillRect(12,449,776,25,state.bg);
  if(state.status!="payment") return;
  gfx->setTextSize(2);
  gfx->setTextColor(0x2104);
  gfx->setCursor(24,454);
  gfx->print(state.payment=="cash"?"Barzahlung":"Bitte bezahlen");
  if(state.payment=="cash"&&state.tendered>=0){
    gfx->setCursor(260,454);
    gfx->print("Gegeben "+String(state.tendered,2));
    gfx->setCursor(520,454);
    gfx->print("Rueckgeld "+String(state.change,2));
  }
}

static void drawShopFull(){
  gfx->fillScreen(state.bg);
  drawFrame();
  drawShopBodyFull();
  gfx->drawFastHLine(20,390,760,0xC618);
  drawTotalRegion();
  drawPaymentRegion();
}

static uint32_t visibleStateHash(){
  uint32_t h=2166136261u;
  hashString(h,state.status);
  hashU32(h,state.primary);
  hashU32(h,state.bg);
  hashU32(h,state.bannerBg);

  if(state.status=="pin"){
    hashString(h,state.pinCustomer);
    hashU32(h,state.pinInvalid?1u:0u);
    hashString(h,pinEntry);
    return h;
  }

  if(state.status=="account"){
    hashString(h,state.accountName);
    hashMoney(h,state.accountBalance);
    hashU32(h,state.accountPinConfigured?1u:0u);
    hashString(h,state.accountMessage);
    hashString(h,state.accountError);
    hashU32(h,(uint32_t)accountStep);
    hashString(h,pinEntry);
    return h;
  }

  hashString(h,state.payment);
  hashMoney(h,state.total);
  hashMoney(h,state.tendered);
  hashMoney(h,state.change);
  hashU32(h,(uint32_t)state.count);
  int start=state.count>9?state.count-9:0;
  for(int i=start;i<state.count;i++){
    hashString(h,state.items[i].name);
    hashU32(h,(uint32_t)state.items[i].qty);
    hashMoney(h,state.items[i].price);
  }
  return h;
}

bool render(bool force){
  pinScreen=state.status=="pin";
  accountScreen=state.status=="account";

  uint32_t nextHash=visibleStateHash();
  if(!force && appFrameValid && nextHash==lastRenderedHash){
    return false;
  }

  const uint8_t screen=currentScreenKind();
  const uint32_t themeHash=themeRenderHash();
  const bool needsFull=force || !appFrameValid || !rendered.valid || rendered.screen!=screen || rendered.themeHash!=themeHash;

  if(needsFull){
    if(screen==1) drawPaymentKeypad();
    else if(screen==2) drawAccount();
    else drawShopFull();

    flushFrame();
    renderCounter++;
    Serial.printf("Display FULL #%lu: status=%s total=%.2f items=%d\n",
                  (unsigned long)renderCounter,state.status.c_str(),state.total,state.count);
  }else if(screen==0){
    int changedRegions=0;
    const bool nowEmpty=(state.count==0);

    if(rendered.shopWasEmpty!=nowEmpty){
      drawShopBodyFull();
      flushRegion(12,12,776,374);
      changedRegions++;
    }else if(nowEmpty){
      uint32_t h=shopEmptyHash();
      if(h!=rendered.shopEmptyHash){
        drawShopBodyFull();
        flushRegion(12,12,776,374);
        changedRegions++;
      }
    }else{
      for(int slot=0;slot<9;slot++){
        uint32_t h=shopItemSlotHash(slot);
        if(h!=rendered.itemHash[slot]){
          drawShopItemSlot(slot);
          const int rowY=28 + slot*38;
          flushRegion(12,rowY-5,776,31);
          changedRegions++;
        }
      }
    }

    uint32_t totalH=totalRegionHash();
    if(totalH!=rendered.totalHash){
      drawTotalRegion();
      flushRegion(12,398,776,50);
      changedRegions++;
    }

    uint32_t paymentH=paymentRegionHash();
    if(paymentH!=rendered.paymentHash){
      drawPaymentRegion();
      flushRegion(12,449,776,25);
      changedRegions++;
    }

    if(changedRegions){
      partialRenderCounter++;
      Serial.printf("Display PARTIAL #%lu: %d Region(en), status=%s total=%.2f items=%d\n",
                    (unsigned long)partialRenderCounter,changedRegions,state.status.c_str(),state.total,state.count);
    }
  }else if(screen==1){
    uint32_t h=pinDynamicRegionHash();
    if(h!=rendered.pinDynamicHash){
      drawPaymentPinDynamic();
      flushRegion(12,18,776,150);
      partialRenderCounter++;
      Serial.printf("Display PARTIAL #%lu: PIN-Dynamik\n",(unsigned long)partialRenderCounter);
    }
  }else{
    int changedRegions=0;
    uint32_t leftH=accountLeftRegionHash();
    if(leftH!=rendered.accountLeftHash){
      drawAccountLeft();
      flushRegion(18,18,310,444);
      changedRegions++;
    }
    uint32_t rightH=accountRightRegionHash();
    if(rightH!=rendered.accountRightHash){
      drawAccountRight();
      flushRegion(344,18,438,444);
      changedRegions++;
    }
    if(changedRegions){
      partialRenderCounter++;
      Serial.printf("Display PARTIAL #%lu: Konto %d Region(en)\n",
                    (unsigned long)partialRenderCounter,changedRegions);
    }
  }

  // Snapshot nach erfolgreichem Rendern aktualisieren.
  rendered.valid=true;
  rendered.screen=screen;
  rendered.themeHash=themeHash;
  rendered.shopWasEmpty=(state.count==0);
  rendered.shopEmptyHash=shopEmptyHash();
  for(int slot=0;slot<9;slot++) rendered.itemHash[slot]=shopItemSlotHash(slot);
  rendered.totalHash=totalRegionHash();
  rendered.paymentHash=paymentRegionHash();
  rendered.pinDynamicHash=pinDynamicRegionHash();
  rendered.accountLeftHash=accountLeftRegionHash();
  rendered.accountRightHash=accountRightRegionHash();

  lastRenderedHash=nextHash;
  appFrameValid=true;
  return true;
}

bool applyJson(const String& json){
  JsonDocument doc;
  DeserializationError jsonError=deserializeJson(doc,json);
  if(jsonError){
    Serial.printf("JSON FEHLER: %s, Bytes=%u\n",jsonError.c_str(),(unsigned)json.length());
    String preview=json.substring(0,min((size_t)180,json.length()));
    preview.replace("\r"," "); preview.replace("\n"," ");
    Serial.print("Antwort-Anfang: "); Serial.println(preview);
    if(preview.startsWith("<") || preview.indexOf("<!DOCTYPE")>=0 || preview.indexOf("<html")>=0){
      Serial.println("HINWEIS: BLE-Nutzdaten sind kein gueltiges KinderKasse-JSON.");
    }
    return false;
  }
  state.profile=doc["profile"]["name"]|"KinderKasse";
  state.banner=doc["profile"]["theme"]["bannerText"]|"Willkommen!";
  state.primary=colorHex(doc["profile"]["theme"]["primaryColor"]|"#1a7a3c",state.primary);
  state.bg=colorHex(doc["profile"]["theme"]["registerBackground"]|"#f3f4f6",state.bg);
  state.bannerBg=colorHex(doc["profile"]["theme"]["bannerBackground"]|"#1a7a3c",state.bannerBg);
  state.bannerText=colorHex(doc["profile"]["theme"]["bannerTextColor"]|"#ffffff",0xFFFF);
  state.status=doc["status"]|"shop"; state.payment=doc["paymentMode"]|"";
  state.pinCustomer=doc["pinRequest"]["customerName"]|"";
  state.pinInvalid=doc["pinRequest"]["invalid"]|false;
  state.accountName=doc["account"]["customerName"]|"";
  state.accountBalance=doc["account"]["balance"]|0.0;
  state.accountPinConfigured=doc["account"]["pinConfigured"]|false;
  state.accountMessage=doc["account"]["message"]|"";
  state.accountError=doc["account"]["error"]|"";
  if(state.status!="pin" && state.status!="account") pinEntry="";
  if(state.status!="account"){accountStep=0;accountCurrentPin="";accountNewPin="";}
  state.message=doc["message"]|"";
  state.total=doc["total"]|0.0; state.tendered=doc["tendered"].isNull()?-1:(float)doc["tendered"];
  state.change=doc["change"].isNull()?-1:(float)doc["change"];
  state.count=0;
  for(JsonObject item: doc["items"].as<JsonArray>()){
    if(state.count>=12) break;
    state.items[state.count].name=String((const char*)(item["name"]|"Artikel"));
    state.items[state.count].qty=item["qty"]|1;
    state.items[state.count].price=item["price"]|0.0;
    state.count++;
  }
  render();
  return true;
}
class RxCallbacks: public BLECharacteristicCallbacks{
  void onWrite(BLECharacteristic *c) override{
    auto raw=c->getValue();
    const char *data=raw.c_str();
    size_t len=raw.length();
    if(len<6 || (uint8_t)data[0]!=0x4b || (uint8_t)data[1]!=0x44) return;
    uint16_t id=((uint8_t)data[2]<<8)|(uint8_t)data[3];
    uint8_t idx=(uint8_t)data[4], total=(uint8_t)data[5];
    if(id!=bleMessageId || idx==0){bleMessageId=id;bleBuffer="";bleReceived=0;bleExpected=total;}
    if(idx!=bleReceived) return;
    for(size_t i=6;i<len;i++) bleBuffer+=(char)data[i];
    bleReceived++;
    if(bleReceived>=bleExpected){
      Serial.printf("BLE Zustand komplett: %u Bytes - Verarbeitung im Hauptloop\n", (unsigned)bleBuffer.length());
      if(bleJsonMutex && xSemaphoreTake(bleJsonMutex,pdMS_TO_TICKS(20))==pdTRUE){
        pendingBleJson=bleBuffer;
        pendingBleJsonReady=true;
        xSemaphoreGive(bleJsonMutex);
      }else{
        Serial.println("WARNUNG: BLE Zustand konnte nicht in die Hauptloop-Queue gelegt werden");
      }
    }
  }
};
static RxCallbacks rxCallbacks;

class DisplayServerCallbacks: public BLEServerCallbacks{
  void onConnect(BLEServer*) override{
    bleConnected=true;
    bleRestartAdvertising=false;
    Serial.println("BLE verbunden - Displaydaten und Touch laufen direkt ueber BLE");
  }

  void onDisconnect(BLEServer*) override{
    bleConnected=false;
    bleAdvertisingStarted=false;
    bleRestartAdvertising=true;
    bleRestartRequestedAt=millis();
    Serial.println("BLE getrennt - Advertising wird neu gestartet");
  }
};
static DisplayServerCallbacks displayServerCallbacks;

bool startBleAdvertising(){
  if(!bleAdvertising) return false;
  bool ok=bleAdvertising->start();
  bleAdvertisingStarted=ok;
  Serial.printf("BLE Advertising gestartet: %s\n", ok ? "JA" : "NEIN");
  return ok;
}

void setupBle(){
  Serial.println("BLE Initialisierung (ESP32 Board-BLE) ...");
  BLEDevice::init(BLE_NAME);
  bleServer=BLEDevice::createServer();
  if(!bleServer){
    Serial.println("FEHLER: BLE Server konnte nicht erstellt werden");
    return;
  }
  bleServer->setCallbacks(&displayServerCallbacks);

  BLEService *service=bleServer->createService(SERVICE_UUID);
  if(!service){
    Serial.println("FEHLER: BLE Service konnte nicht erstellt werden");
    return;
  }
  BLECharacteristic *rx=service->createCharacteristic(
    RX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rx->setCallbacks(&rxCallbacks);
  inputCharacteristic=service->createCharacteristic(INPUT_UUID,BLECharacteristic::PROPERTY_NOTIFY);
  // CCCD ist fuer Notifications mit dem klassischen ESP32-BLE-Stack erforderlich
  // und beim aktuellen Arduino-ESP32 BLE-API ebenfalls kompatibel.
  inputCharacteristic->addDescriptor(new BLE2902());
  service->start();

  bleAdvertising=BLEDevice::getAdvertising();
  if(!bleAdvertising){
    Serial.println("FEHLER: BLE Advertising Objekt fehlt");
    return;
  }
  // Offizielles Arduino-ESP32 Server-Muster: 128-Bit-Service announcen und
  // Scan-Response aktivieren. Der mit BLEDevice::init() gesetzte Name wird vom
  // ESP32-BLE-Stack automatisch in Advertising/Scan-Response einsortiert.
  bleAdvertising->addServiceUUID(SERVICE_UUID);
  bleAdvertising->setScanResponse(true);
  bleAdvertising->setMinPreferred(0x06);
  bleAdvertising->setMaxPreferred(0x12);
  startBleAdvertising();
  Serial.print("BLE Name: "); Serial.println(BLE_NAME);
  Serial.print("BLE Service: "); Serial.println(SERVICE_UUID);
  Serial.println("BLE Hinweis: in nRF Connect nach KasseDisplay suchen - keine Kopplung noetig.");
}

void serviceBleAdvertising(){
  if(!bleAdvertising || bleConnected || !bleRestartAdvertising) return;
  // Dem Stack nach einer Trennung kurz Zeit geben, bevor erneut geworben wird.
  if(millis()-bleRestartRequestedAt<500) return;
  bleRestartAdvertising=false;
  Serial.println("BLE Advertising Neustart ...");
  startBleAdvertising();
}

void serviceBlePayload(){
  if(!pendingBleJsonReady || !bleJsonMutex) return;
  String json;
  if(xSemaphoreTake(bleJsonMutex,0)!=pdTRUE) return;
  if(pendingBleJsonReady){
    json=pendingBleJson;
    pendingBleJson="";
    pendingBleJsonReady=false;
  }
  xSemaphoreGive(bleJsonMutex);
  if(json.length()){
    Serial.printf("BLE Zustand im Hauptloop verarbeitet: %u Bytes\n",(unsigned)json.length());
    applyJson(json);
  }
}

void drawConnectionStatus(const String& line1,const String& line2,const String& line3){
  gfx->fillScreen(rgb565(243,244,246));
  drawCentered("KinderKasse Display",84,rgb565(26,122,60),4);
  drawCentered("Firmware "+String(FW_VERSION),136,0x4208,2);
  drawCentered(line1,232,rgb565(26,122,60),3);
  if(line2.length()) drawCentered(line2,282,0x4208,2);
  if(line3.length()) drawCentered(line3,318,0x4208,2);
  flushFrame();
  appFrameValid=false;
  rendered.valid=false;
}
void setup(){
  Serial.begin(115200);
  initBoardIoAndTouch();

  Serial.printf("PSRAM frei vor Render-Puffer: %u Bytes\n",(unsigned)ESP.getFreePsram());
  if(frameCanvas->begin()){
    gfx=frameCanvas;
    bufferedRendering=true;
    Serial.println("Display Rendering: PSRAM-Canvas aktiv (800x480 RGB565).");
  }else{
    Serial.println("WARNUNG: PSRAM-Canvas konnte nicht gestartet werden - Direktmodus.");
    if(!panelDisplay->begin()){
      Serial.println("FEHLER: RGB-Display konnte nicht gestartet werden.");
      while(true) delay(1000);
    }
    gfx=panelDisplay;
    bufferedRendering=false;
  }

  gfx->fillScreen(rgb565(243,244,246));
  drawCentered("KinderKasse Display",175,rgb565(26,122,60),4);
  drawCentered("Firmware "+String(FW_VERSION),225,0x4208,2);
  flushFrame();
  appFrameValid=false;
  rendered.valid=false;

  bleJsonMutex=xSemaphoreCreateMutex();
  if(!bleJsonMutex) Serial.println("WARNUNG: BLE JSON Mutex konnte nicht erstellt werden");

  setupBle();
  render(true);
  Serial.println("KinderKasse Display bereit: nur BLE, kein WLAN aktiv.");
}
void loop(){
  // Touch und BLE sind die einzigen Laufzeitdienste. Es gibt bewusst kein WLAN.
  handleServiceRestartTouch();
  handlePaymentPinTouch();
  handleAccountTouch();

  // BLE-Daten erst hier anwenden/rendern, niemals direkt im BLE-Callback.
  serviceBlePayload();
  serviceBleAdvertising();
  delay(5);
}
