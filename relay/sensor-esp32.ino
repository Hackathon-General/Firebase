/*
 * Carmel-Kinneret IoT tracker — ESP32 + GPS → HTTP relay
 * ------------------------------------------------------------------
 * Posts the sensor's live position to the HTTP→HTTPS relay over PLAIN HTTP.
 * The relay (relay.js) re-attaches the IOT secret and forwards to the HTTPS
 * `ingest` Cloud Function — so the device itself needs NO TLS and NO secret.
 *
 * Hardware:
 *   - ESP32 dev board
 *   - GPS module (NEO-6M / NEO-M8N) on UART2: GPS TX -> GPIO16 (RX2), GPS RX -> GPIO17 (TX2)
 *
 * Libraries (Arduino Library Manager):
 *   - TinyGPSPlus  (by Mikal Hart)
 *   (WiFi + HTTPClient are built into the ESP32 core)
 *
 * Payload sent (matches ingest):
 *   { "id", "lat", "lon", "speed_kmh", "heading_deg", "utc" }
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>

// ---------- CONFIG: edit these ----------
const char* WIFI_SSID  = "YOUR_WIFI";
const char* WIFI_PASS  = "YOUR_WIFI_PASSWORD";

// The relay URL the organizers give you (LAN IP of the machine running relay.js).
// NOTE: plain http, port 8080, no auth header.
const char* RELAY_URL  = "http://192.168.1.118:8080/";

const char* SENSOR_ID  = "sensor-01";    // unique per device
const unsigned long SEND_INTERVAL_MS = 5000; // post every 5s
// ----------------------------------------

TinyGPSPlus gps;
HardwareSerial GPS(2);          // UART2
unsigned long lastSend = 0;

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf("\nWiFi OK  IP=%s\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);
  GPS.begin(9600, SERIAL_8N1, 16, 17);   // RX2=16, TX2=17
  connectWifi();
}

String isoUtc() {
  // GPS gives date+time in UTC. Build a simple ISO-8601 string.
  char buf[25];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ",
           gps.date.year(), gps.date.month(), gps.date.day(),
           gps.time.hour(), gps.time.minute(), gps.time.second());
  return String(buf);
}

void postPosition() {
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); return; }

  // Build JSON body. heading/speed are optional — include when valid.
  String body = "{";
  body += "\"id\":\"" + String(SENSOR_ID) + "\"";
  body += ",\"lat\":" + String(gps.location.lat(), 6);
  body += ",\"lon\":" + String(gps.location.lng(), 6);
  if (gps.speed.isValid())   body += ",\"speed_kmh\":" + String(gps.speed.kmph(), 1);
  if (gps.course.isValid())  body += ",\"heading_deg\":" + String(gps.course.deg(), 0);
  if (gps.date.isValid() && gps.time.isValid()) body += ",\"utc\":\"" + isoUtc() + "\"";
  body += "}";

  HTTPClient http;
  http.begin(RELAY_URL);                  // plain HTTP — no TLS, no auth header
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int code = http.POST(body);
  Serial.printf("POST %s -> %d %s\n", RELAY_URL, code, http.getString().c_str());
  http.end();
}

void loop() {
  // Feed the GPS parser continuously.
  while (GPS.available() > 0) gps.encode(GPS.read());

  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    if (gps.location.isValid()) {
      postPosition();
    } else {
      Serial.printf("Waiting for GPS fix… (sats=%d)\n", gps.satellites.value());
    }
  }
}
