#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Arduino_GFX_Library.h>
#include <NimBLEDevice.h>
#include <Wire.h>

static const char *FW_VERSION = "1.2.0";
static const char *BLE_NAME = "KasseDisplay";
static NimBLEUUID SERVICE_UUID("7a0f1001-1b55-4e2a-9c2e-9a6b9f3a2c10");
static NimBLEUUID RX_UUID("7a0f1002-1b55-4e2a-9c2e-9a6b9f3a2c10");
static NimBLEUUID INPUT_UUID("7a0f1003-1b55-4e2a-9c2e-9a6b9f3a2c10");
static NimBLECharacteristic *inputCharacteristic = nullptr;

Preferences prefs;
String serverUrl, cfClientId, cfClientSecret;
unsigned long lastPoll = 0, lastWifiOk = 0;
String lastJson;
String bleBuffer;
String pinEntry;
String accountCurrentPin, accountNewPin;
bool pinScreen = false;
bool accountScreen = false;
int accountStep = 0; // 0=home,1=current pin,2=new pin,3=confirm,4=disable current
unsigned long lastTouchMs = 0;
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
Arduino_RGB_Display *gfx = new Arduino_RGB_Display(800, 480, rgbpanel, 0, true);

static uint16_t rgb565(uint8_t r,uint8_t g,uint8_t b){return ((r&0xF8)<<8)|((g&0xFC)<<3)|(b>>3);}
static uint16_t colorHex(const char* s,uint16_t fallback){
  if(!s||s[0]!='#'||strlen(s)<7)return fallback;
  long v=strtol(s+1,nullptr,16); return rgb565((v>>16)&255,(v>>8)&255,v&255);
}
static void ch422Write(uint8_t addr,uint8_t value){
  Wire.beginTransmission(addr); Wire.write(value); Wire.endTransmission();
}
static void backlightOn(){
  Wire.begin(8,9);
  ch422Write(0x24,0x01); // EXIO0..7 output
  ch422Write(0x38,(1<<2)|(1<<1)); // EXIO2 = LCD backlight, EXIO1 = Touch reset released
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

void drawCentered(const String& text,int y,uint16_t color,int size){
  gfx->setTextColor(color); gfx->setTextSize(size);
  int16_t x1,y1; uint16_t w,h;
  gfx->getTextBounds(text,0,y,&x1,&y1,&w,&h);
  gfx->setCursor(max(8,(800-(int)w)/2),y); gfx->print(text);
}
bool gt911ReadAt(uint8_t addr,uint16_t &x,uint16_t &y){
  Wire.beginTransmission(addr); Wire.write(0x81); Wire.write(0x4E);
  if(Wire.endTransmission(false)!=0) return false;
  if(Wire.requestFrom(addr,(uint8_t)1)!=(uint8_t)1) return false;
  uint8_t status=Wire.read();
  if(!(status&0x80) || !(status&0x0F)) return false;
  Wire.beginTransmission(addr); Wire.write(0x81); Wire.write(0x50);
  if(Wire.endTransmission(false)!=0) return false;
  if(Wire.requestFrom(addr,(uint8_t)4)!=(uint8_t)4) return false;
  uint8_t xl=Wire.read(), xh=Wire.read(), yl=Wire.read(), yh=Wire.read();
  x=((uint16_t)xh<<8)|xl; y=((uint16_t)yh<<8)|yl;
  Wire.beginTransmission(addr); Wire.write(0x81); Wire.write(0x4E); Wire.write(0);
  Wire.endTransmission();
  return x<800 && y<480;
}
bool gt911Read(uint16_t &x,uint16_t &y){
  return gt911ReadAt(0x5D,x,y) || gt911ReadAt(0x14,x,y);
}
void sendInputJson(const String& body){
  if(inputCharacteristic){
    inputCharacteristic->setValue(body.c_str());
    inputCharacteristic->notify();
  }
  if(serverUrl.length()>=8 && WiFi.status()==WL_CONNECTED){
    String url=serverUrl; if(url.endsWith("/"))url.remove(url.length()-1);
    url+="/api/customer-display/input";
    HTTPClient http;
    if(url.startsWith("https://")){
      WiFiClientSecure client; client.setInsecure();
      if(!http.begin(client,url)) return;
      if(cfClientId.length())http.addHeader("CF-Access-Client-Id",cfClientId);
      if(cfClientSecret.length())http.addHeader("CF-Access-Client-Secret",cfClientSecret);
      http.addHeader("Content-Type","application/json"); http.POST(body); http.end();
    }else{
      WiFiClient client;
      if(!http.begin(client,url)) return;
      http.addHeader("Content-Type","application/json"); http.POST(body); http.end();
    }
  }
}
void drawKeypad(const String& title,const String& subtitle,bool showError=false,const String& err=""){
  gfx->fillScreen(state.bg);
  gfx->fillRect(0,0,800,92,state.bannerBg);
  drawCentered(title,22,state.bannerText,3);
  drawCentered(subtitle,105,state.primary,3);
  String dots="";
  for(size_t i=0;i<pinEntry.length();i++) dots+="* ";
  drawCentered(dots,155,0x2104,3);
  if(showError && err.length()) drawCentered(err,195,rgb565(185,28,28),2);
  const int x0=205,y0=230,w=120,h=55,g=12;
  const char* keys[12]={"1","2","3","4","5","6","7","8","9","<-","0","OK"};
  for(int i=0;i<12;i++){
    int col=i%3,row=i/3; int x=x0+col*(w+g),y=y0+row*(h+g);
    uint16_t fill=(i==11)?state.primary:0xFFFF;
    gfx->fillRoundRect(x,y,w,h,10,fill); gfx->drawRoundRect(x,y,w,h,10,0xC618);
    gfx->setTextColor(i==11?0xFFFF:0x2104); gfx->setTextSize(2);
    int16_t x1,y1;uint16_t tw,th;gfx->getTextBounds(keys[i],0,0,&x1,&y1,&tw,&th);
    gfx->setCursor(x+(w-tw)/2,y+18);gfx->print(keys[i]);
  }
}
void drawPinScreen(){
  drawKeypad(state.pinCustomer.length()?("Hallo "+state.pinCustomer):"PIN erforderlich",
             "PIN eingeben",state.pinInvalid,"PIN falsch - erneut versuchen");
}
void drawAccountHome(){
  gfx->fillScreen(state.bg);
  gfx->fillRect(0,0,800,92,state.bannerBg);
  drawCentered("Hallo "+state.accountName,20,state.bannerText,3);
  drawCentered("Guthaben "+String(state.accountBalance,2)+" CHF",120,state.primary,4);
  if(state.accountMessage.length()) drawCentered(state.accountMessage,178,rgb565(22,101,52),2);
  if(state.accountError.length()) drawCentered(state.accountError,178,rgb565(185,28,28),2);

  const int x=190,w=420,h=58;
  gfx->fillRoundRect(x,230,w,h,12,state.primary);
  drawCentered(state.accountPinConfigured?"PIN aendern":"PIN aktivieren",248,0xFFFF,2);
  if(state.accountPinConfigured){
    gfx->fillRoundRect(x,305,w,h,12,rgb565(185,28,28));
    drawCentered("PIN deaktivieren",323,0xFFFF,2);
  }
  gfx->fillRoundRect(x,380,w,h,12,0xC618);
  drawCentered("Fertig",398,0x2104,2);
}
void drawAccount(){
  if(accountStep==0){drawAccountHome();return;}
  if(accountStep==1) drawKeypad(state.accountName,"Aktueller PIN",false,"");
  else if(accountStep==2) drawKeypad(state.accountName,"Neuer PIN",false,"");
  else if(accountStep==3) drawKeypad(state.accountName,"PIN wiederholen",false,"");
  else if(accountStep==4) drawKeypad(state.accountName,"PIN zum Deaktivieren",false,"");
}
void handleKeypadTouch(bool paymentPin){
  uint16_t x,y; if(!gt911Read(x,y)) return;
  if(millis()-lastTouchMs<180) return; lastTouchMs=millis();
  const int x0=205,y0=230,w=120,h=55,g=12;
  int col=(x-x0)/(w+g), row=(y-y0)/(h+g);
  if(x<x0||y<y0||col<0||col>2||row<0||row>3) return;
  int bx=x0+col*(w+g),by=y0+row*(h+g);
  if(x>bx+w||y>by+h)return;
  int idx=row*3+col;
  const char* keys[12]={"1","2","3","4","5","6","7","8","9","B","0","O"};
  char k=keys[idx][0];
  if(k>='0'&&k<='9'&&pinEntry.length()<8)pinEntry+=k;
  else if(k=='B'&&pinEntry.length())pinEntry.remove(pinEntry.length()-1);
  else if(k=='O'&&pinEntry.length()>=4){
    if(paymentPin){
      sendInputJson(String("{\"pin\":\"")+pinEntry+"\"}");
      pinEntry="";
    }else if(accountStep==1){
      accountCurrentPin=pinEntry;pinEntry="";accountStep=2;
    }else if(accountStep==2){
      accountNewPin=pinEntry;pinEntry="";accountStep=3;
    }else if(accountStep==3){
      if(pinEntry==accountNewPin){
        sendInputJson(String("{\"action\":\"account_set_pin\",\"currentPin\":\"")+accountCurrentPin+"\",\"newPin\":\""+accountNewPin+"\"}");
        accountStep=0;accountCurrentPin="";accountNewPin="";pinEntry="";
      }else{
        pinEntry="";accountNewPin="";accountStep=2;state.accountError="PINs stimmen nicht ueberein";
      }
    }else if(accountStep==4){
      sendInputJson(String("{\"action\":\"account_disable_pin\",\"currentPin\":\"")+pinEntry+"\"}");
      accountStep=0;pinEntry="";
    }
  }
  if(paymentPin)drawPinScreen();else drawAccount();
}
void handlePinTouch(){
  if(pinScreen) handleKeypadTouch(true);
}
void handleAccountTouch(){
  if(!accountScreen)return;
  if(accountStep!=0){handleKeypadTouch(false);return;}
  uint16_t x,y;if(!gt911Read(x,y))return;
  if(millis()-lastTouchMs<180)return;lastTouchMs=millis();
  if(x>=190&&x<=610&&y>=230&&y<=288){
    pinEntry="";accountCurrentPin="";accountNewPin="";
    accountStep=state.accountPinConfigured?1:2;drawAccount();return;
  }
  if(state.accountPinConfigured&&x>=190&&x<=610&&y>=305&&y<=363){
    pinEntry="";accountStep=4;drawAccount();return;
  }
  if(x>=190&&x<=610&&y>=380&&y<=438){
    sendInputJson("{\"action\":\"account_close\"}");
  }
}
void render(){
  pinScreen = state.status=="pin";
  accountScreen = state.status=="account";
  if(pinScreen){ drawPinScreen(); return; }
  if(accountScreen){ drawAccount(); return; }
  gfx->fillScreen(state.bg);
  gfx->fillRect(0,0,800,92,state.bannerBg);
  drawCentered(state.profile,14,state.bannerText,4);
  drawCentered(state.banner,55,state.bannerText,2);

  int y=112;
  if(state.count==0){
    drawCentered(state.status=="success" ? "Vielen Dank!" : "Willkommen!",190,state.primary,4);
  } else {
    gfx->setTextColor(0x2104); gfx->setTextSize(2);
    int start = state.count > 8 ? state.count - 8 : 0;
    for(int i=start;i<state.count;i++){
      String left=String(state.items[i].qty)+" x "+state.items[i].name;
      String right=String(state.items[i].qty*state.items[i].price,2)+" CHF";
      gfx->setCursor(24,y); gfx->print(left.substring(0,30));
      gfx->setCursor(620,y); gfx->print(right);
      y+=38;
    }
  }
  gfx->drawFastHLine(20,390,760,0xC618);
  gfx->setTextColor(state.primary); gfx->setTextSize(3);
  gfx->setCursor(24,410); gfx->print("TOTAL");
  gfx->setCursor(555,410); gfx->print(String(state.total,2)+" CHF");

  if(state.status=="payment"){
    gfx->setTextSize(2); gfx->setTextColor(0x2104);
    String p = state.payment=="cash" ? "Barzahlung" : "Bitte bezahlen";
    gfx->setCursor(24,454); gfx->print(p);
    if(state.payment=="cash" && state.tendered>=0){
      gfx->setCursor(260,454); gfx->print("Gegeben "+String(state.tendered,2));
      gfx->setCursor(520,454); gfx->print("Rueckgeld "+String(state.change,2));
    }
  }
}
void applyJson(const String& json){
  JsonDocument doc;
  if(deserializeJson(doc,json)) return;
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
}
class RxCallbacks: public NimBLECharacteristicCallbacks{
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo&) override{
    auto v=c->getValue();
    if(v.size()<6 || (uint8_t)v[0]!=0x4b || (uint8_t)v[1]!=0x44) return;
    uint16_t id=((uint8_t)v[2]<<8)|(uint8_t)v[3];
    uint8_t idx=(uint8_t)v[4], total=(uint8_t)v[5];
    if(id!=bleMessageId || idx==0){bleMessageId=id;bleBuffer="";bleReceived=0;bleExpected=total;}
    if(idx!=bleReceived) return;
    for(size_t i=6;i<v.size();i++) bleBuffer+=(char)v[i];
    bleReceived++;
    if(bleReceived>=bleExpected) applyJson(bleBuffer);
  }
};
void setupBle(){
  NimBLEDevice::init(BLE_NAME);
  auto server=NimBLEDevice::createServer();
  auto service=server->createService(SERVICE_UUID);
  auto rx=service->createCharacteristic(RX_UUID,NIMBLE_PROPERTY::WRITE|NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  inputCharacteristic=service->createCharacteristic(INPUT_UUID,NIMBLE_PROPERTY::NOTIFY);
  service->start();
  auto adv=NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID); adv->setName(BLE_NAME); adv->start();
}
bool pollServer(){
  if(serverUrl.length()<8 || WiFi.status()!=WL_CONNECTED) return false;
  String url=serverUrl; if(url.endsWith("/"))url.remove(url.length()-1);
  url+="/api/customer-display";
  HTTPClient http;
  int code=-1;
  if(url.startsWith("https://")){
    WiFiClientSecure client;
    client.setInsecure(); // siehe README: TLS ist verschlüsselt, Zertifikat wird in v1.0 nicht validiert.
    if(!http.begin(client,url)) return false;
    if(cfClientId.length())http.addHeader("CF-Access-Client-Id",cfClientId);
    if(cfClientSecret.length())http.addHeader("CF-Access-Client-Secret",cfClientSecret);
    code=http.GET();
  }else{
    WiFiClient client;
    if(!http.begin(client,url)) return false;
    if(cfClientId.length())http.addHeader("CF-Access-Client-Id",cfClientId);
    if(cfClientSecret.length())http.addHeader("CF-Access-Client-Secret",cfClientSecret);
    code=http.GET();
  }
  if(code==200){String body=http.getString(); if(body!=lastJson){lastJson=body;applyJson(body);} http.end();return true;}
  http.end(); return false;
}
void configurePortal(){
  WiFiManager wm;
  WiFiManagerParameter pUrl("url","KinderKasse Server URL",serverUrl.c_str(),120);
  WiFiManagerParameter pId("cfid","Cloudflare Client ID",cfClientId.c_str(),120);
  WiFiManagerParameter pSecret("cfsecret","Cloudflare Client Secret",cfClientSecret.c_str(),180);
  wm.addParameter(&pUrl); wm.addParameter(&pId); wm.addParameter(&pSecret);
  wm.setConfigPortalTimeout(240);
  if(wm.autoConnect("KinderKasse-Display-Setup")){
    serverUrl=pUrl.getValue(); cfClientId=pId.getValue(); cfClientSecret=pSecret.getValue();
    prefs.putString("server",serverUrl); prefs.putString("cfid",cfClientId); prefs.putString("cfsecret",cfClientSecret);
  }
}
void setup(){
  Serial.begin(115200);
  prefs.begin("kdisplay",false);
  serverUrl=prefs.getString("server","");
  cfClientId=prefs.getString("cfid","");
  cfClientSecret=prefs.getString("cfsecret","");
  backlightOn();
  gfx->begin(); gfx->fillScreen(rgb565(243,244,246));
  drawCentered("KinderKasse Display",175,rgb565(26,122,60),4);
  drawCentered("Firmware "+String(FW_VERSION),225,0x4208,2);
  setupBle();
  WiFi.mode(WIFI_STA);
  configurePortal();
  render();
}
void loop(){
  if(WiFi.status()==WL_CONNECTED) lastWifiOk=millis();
  if(millis()-lastPoll>650){lastPoll=millis();pollServer();}
  handlePinTouch();
  handleAccountTouch();
  delay(10);
}
