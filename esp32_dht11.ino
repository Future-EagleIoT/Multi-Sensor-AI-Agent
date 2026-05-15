#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <math.h>
// -----------------------------------------------
// CONFIGURATION — update before flashing
// -----------------------------------------------
const char* WIFI_SSID     = "Braga-5G";
const char* WIFI_PASSWORD = "Braga2026";
const char* MQTT_BROKER   = "196.187.148.92";    // Your laptop's IPv4 address
const int   MQTT_PORT     = 1883;
const char* MQTT_TOPIC    = "future_eagle_iot/sensors/motor01";
const char* DEVICE_ID     = "esp32-motor-01";

// -----------------------------------------------
// HARDWARE — Real Sensor
// -----------------------------------------------
#define DHTPIN  4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

WiFiClient   espClient;
PubSubClient mqttClient(espClient);
unsigned long lastPublish  = 0;
unsigned long loopCounter  = 0;
const long    PUBLISH_INTERVAL = 5000;  // 5 seconds
// -----------------------------------------------
// SIMULATION BASELINES
// Real-world motor at idle:
//   Temperature baseline: 30.0 °C
//   Vibration baseline:   12.0 Hz  (healthy bearing)
//   Power draw baseline:  85.0 W   (motor at load)
// -----------------------------------------------
const float BASELINE_TEMP      = 30.0;
const float BASELINE_VIBRATION = 12.0;
const float BASELINE_POWER     = 85.0;
// -----------------------------------------------
// Pseudo-random noise — deterministic, no seed needed
// Returns a float in range [-range, +range]
// -----------------------------------------------
float pseudoNoise(float range, unsigned long seed) {
  // Simple LCG-based noise, good enough for simulation
  unsigned long n = (seed * 1664525UL + 1013904223UL) & 0xFFFFFFFF;
  return ((float)(n % 1000) / 1000.0f - 0.5f) * 2.0f * range;
}

// -----------------------------------------------
// Simulated sensor values — correlated to real temp
// Represents a motor exhibiting early bearing wear:
// As temperature rises → vibration and power draw rise
// -----------------------------------------------
float simulateVibration(float realTemp, unsigned long tick) {
  float delta   = realTemp - BASELINE_TEMP;
  float vibHz   = BASELINE_VIBRATION + (delta * 0.4f) + pseudoNoise(0.5f, tick);
  return max(0.0f, vibHz);
}

float simulatePower(float realTemp, unsigned long tick) {
  float delta   = realTemp - BASELINE_TEMP;
  float watts   = BASELINE_POWER + (delta * 3.2f) + pseudoNoise(1.5f, tick + 42);
  return max(0.0f, watts);
}
// -----------------------------------------------
// WiFi
// -----------------------------------------------
void connectWiFi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[WiFi] Connected. IP: " + WiFi.localIP().toString());
}
// -----------------------------------------------
// MQTT
// -----------------------------------------------
void connectMQTT() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Connecting...");
    if (mqttClient.connect(DEVICE_ID)) {
      Serial.println(" Connected.");
    } else {
      Serial.print(" Failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" — retrying in 5s");
      delay(5000);
    }
  }
}

// -----------------------------------------------
// SETUP
// -----------------------------------------------
void setup() {
  Serial.begin(115200);
  dht.begin();
  delay(2000);  // DHT11 needs 1–2s warm-up after power-on
  connectWiFi();
  connectMQTT();
  Serial.println("[SYSTEM] IoT Frontier Episode 2 — Multi-Sensor Agent Online.");
  Serial.println("[SYSTEM] Real: temperature, humidity | Simulated: vibration, power_draw");
}

// -----------------------------------------------
// LOOP
// -----------------------------------------------
void loop() {
  if (!mqttClient.connected()) connectMQTT();
  mqttClient.loop();
  unsigned long now = millis();
  if (now - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = now;
    loopCounter++;
    // --- Real sensor readings ---
    float temperature = dht.readTemperature();   // °C
    float humidity    = dht.readHumidity();       // %
  if (isnan(temperature) || isnan(humidity)) {
      Serial.println("[DHT11] Read failed — check wiring on GPIO4.");
      return;
    }

// --- Simulated sensor readings (correlated to real temp) ---
    float vibration  = simulateVibration(temperature, loopCounter);
    float powerDraw  = simulatePower(temperature, loopCounter);
// --- Build JSON payload ---
    StaticJsonDocument<256> doc;
    doc["device_id"]    = DEVICE_ID;
    // Real sensors
    doc["temperature"]  = serialized(String(temperature, 1));
    doc["humidity"]     = serialized(String(humidity, 1));
    // Simulated sensors — labelled for transparency
    doc["vibration_hz"] = serialized(String(vibration, 2));
    doc["power_w"]      = serialized(String(powerDraw, 1));
    // Metadata
    doc["sim_sensors"]  = "vibration,power_w";   // transparency field
    doc["timestamp_ms"] = millis();

    char payload[256];
    serializeJson(doc, payload);
    mqttClient.publish(MQTT_TOPIC, payload);
    Serial.print("[MQTT] Published → ");
    Serial.println(payload);
  }
}