/*
 * Future Eagle IIoT SaaS — Hardened ESP32 Edge Sensor Node (v2.0)
 * Improvements over prototype esp32_dht11.ino:
 *  - Zero hardcoded secrets (loaded from gitignored secrets.h)
 *  - Verified mTLS (WiFiClientSecure + CA + unique per-device X.509 client cert on port 8883)
 *  - Multi-tenant MQTT topics: tenants/{org}/devices/{uid}/{telemetry|status}
 *  - MQTT Last Will & Testament (LWT) + retained online/offline presence
 *  - Non-blocking Wi-Fi & MQTT exponential backoff reconnects
 *  - ESP32 Hardware Watchdog Timer (esp_task_wdt)
 *  - NTP UTC ISO-8601 timestamps + 20-sample local RAM ring-buffer for Wi-Fi dropouts
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <time.h>
#include <esp_task_wdt.h>
#include "secrets.h"

#define DHTPIN  4
#define DHTTYPE DHT11
#define WDT_TIMEOUT_SEC 30
#define PUBLISH_INTERVAL_MS 5000
#define RING_BUFFER_SIZE 20

DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure tlsClient;
PubSubClient mqttClient(tlsClient);

String topicTelemetry;
String topicStatus;

unsigned long lastPublishMs     = 0;
unsigned long lastReconnectMs   = 0;
unsigned long reconnectDelayMs  = 2000;
unsigned long loopCounter       = 0;

struct ReadingSample {
  float temperature;
  float humidity;
  float vibration_hz;
  float power_w;
  char  timestamp_utc[32];
  bool  valid;
};

ReadingSample ringBuf[RING_BUFFER_SIZE];
int ringHead = 0;
int ringCount = 0;

// Simulation baselines (replace simulateVibration / simulatePower with ADXL345/IIS3DWB + CT clamp in production)
const float BASELINE_TEMP      = 30.0f;
const float BASELINE_VIBRATION = 12.0f;
const float BASELINE_POWER     = 85.0f;

float pseudoNoise(float range, unsigned long seed) {
  unsigned long n = (seed * 1664525UL + 1013904223UL) & 0xFFFFFFFF;
  return ((float)(n % 1000) / 1000.0f - 0.5f) * 2.0f * range;
}

float simulateVibration(float realTemp, unsigned long tick) {
  float delta = realTemp - BASELINE_TEMP;
  return max(0.0f, BASELINE_VIBRATION + (delta * 0.4f) + pseudoNoise(0.5f, tick));
}

float simulatePower(float realTemp, unsigned long tick) {
  float delta = realTemp - BASELINE_TEMP;
  return max(0.0f, BASELINE_POWER + (delta * 3.2f) + pseudoNoise(1.5f, tick + 42));
}

void formatUtcNow(char* out, size_t len) {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 50)) {
    strftime(out, len, "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  } else {
    out[0] = '\0';
  }
}

void pushToRingBuffer(const ReadingSample& s) {
  int idx = (ringHead + ringCount) % RING_BUFFER_SIZE;
  if (ringCount == RING_BUFFER_SIZE) {
    ringHead = (ringHead + 1) % RING_BUFFER_SIZE;
  } else {
    ringCount++;
  }
  ringBuf[idx] = s;
}

bool publishSample(const ReadingSample& s) {
  StaticJsonDocument<320> doc;
  doc["device_id"]    = DEVICE_UID;
  doc["temperature"]  = serialized(String(s.temperature, 2));
  doc["humidity"]     = serialized(String(s.humidity, 1));
  doc["vibration_hz"] = serialized(String(s.vibration_hz, 2));
  doc["power_w"]      = serialized(String(s.power_w, 1));
  doc["sim_sensors"]  = "vibration,power_w";
  if (s.timestamp_utc[0] != '\0') {
    doc["timestamp_utc"] = s.timestamp_utc;
  }

  char payload[320];
  size_t n = serializeJson(doc, payload, sizeof(payload));
  return mqttClient.publish(topicTelemetry.c_str(), (const uint8_t*)payload, n, false);
}

void flushRingBuffer() {
  while (ringCount > 0 && mqttClient.connected()) {
    if (!publishSample(ringBuf[ringHead])) {
      break;
    }
    ringHead = (ringHead + 1) % RING_BUFFER_SIZE;
    ringCount--;
    mqttClient.loop();
    esp_task_wdt_reset();
  }
}

void ensureConnectivity() {
  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastReconnectMs >= reconnectDelayMs) {
      lastReconnectMs = now;
      Serial.println("[WiFi] Reconnecting...");
      WiFi.disconnect(false);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      reconnectDelayMs = min(reconnectDelayMs * 2, 30000UL);
    }
    return;
  }

  if (!mqttClient.connected()) {
    if (now - lastReconnectMs >= reconnectDelayMs) {
      lastReconnectMs = now;
      String clientId = String(ORG_SLUG) + "-" + String(DEVICE_UID);
      Serial.print("[MQTT] Connecting mTLS to ");
      Serial.print(MQTT_BROKER);
      Serial.print(":");
      Serial.println(MQTT_PORT);

      // Connect with Last Will & Testament (QoS 1, retained) so platform detects sudden power loss
      const char* lwtPayload = "{\"status\":\"offline\"}";
      bool ok = mqttClient.connect(
        clientId.c_str(),
        nullptr,
        nullptr,
        topicStatus.c_str(),
        1,
        true,
        lwtPayload
      );
      if (ok) {
        reconnectDelayMs = 2000;
        mqttClient.publish(topicStatus.c_str(), "{\"status\":\"online\"}", true);
        Serial.println("[MQTT] Connected (mTLS verified) & published online presence.");
        flushRingBuffer();
      } else {
        Serial.print("[MQTT] Connect failed rc=");
        Serial.println(mqttClient.state());
        reconnectDelayMs = min(reconnectDelayMs * 2, 30000UL);
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  dht.begin();

  // Hardware watchdog prevents silent hangs on the factory floor
  esp_task_wdt_init(WDT_TIMEOUT_SEC, true);
  esp_task_wdt_add(NULL);

  topicTelemetry = "tenants/" + String(ORG_SLUG) + "/devices/" + String(DEVICE_UID) + "/telemetry";
  topicStatus    = "tenants/" + String(ORG_SLUG) + "/devices/" + String(DEVICE_UID) + "/status";

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Sync UTC clock via NTP
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  // Strict mTLS verification using per-device certificate
  tlsClient.setCACert(CA_CERT_PEM);
  tlsClient.setCertificate(CLIENT_CERT_PEM);
  tlsClient.setPrivateKey(CLIENT_KEY_PEM);

  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setBufferSize(512);
  mqttClient.setKeepAlive(30);

  Serial.println("[SYSTEM] Future Eagle IIoT v2.0 Node initialized.");
}

void loop() {
  esp_task_wdt_reset();
  ensureConnectivity();

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  unsigned long now = millis();
  if (now - lastPublishMs >= PUBLISH_INTERVAL_MS) {
    lastPublishMs = now;
    loopCounter++;

    float temperature = dht.readTemperature();
    float humidity    = dht.readHumidity();
    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("[DHT11] Read failed — check GPIO4 wiring.");
      return;
    }

    ReadingSample sample{};
    sample.temperature  = temperature;
    sample.humidity     = humidity;
    sample.vibration_hz = simulateVibration(temperature, loopCounter);
    sample.power_w      = simulatePower(temperature, loopCounter);
    formatUtcNow(sample.timestamp_utc, sizeof(sample.timestamp_utc));
    sample.valid        = true;

    if (mqttClient.connected()) {
      flushRingBuffer();
      if (!publishSample(sample)) {
        pushToRingBuffer(sample);
      }
    } else {
      pushToRingBuffer(sample);
      Serial.printf("[BUFFER] Offline — cached sample (%d/%d)\n", ringCount, RING_BUFFER_SIZE);
    }
  }
}
