#include <SoftwareSerial.h>
#include <Adafruit_Fingerprint.h>

// -----------------------------
// CONFIGURACIÓN DE PUERTOS
// -----------------------------
// AS608 TX -> pin 2 (RX Arduino)
// AS608 RX -> pin 3 (TX Arduino)
SoftwareSerial fingerSerial(2, 3); // RX, TX hacia sensor
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fingerSerial);

// -----------------------------
// SERIAL NODE <-> ARDUINO
// -----------------------------
const uint32_t SERIAL_BAUD = 57600;
const uint16_t FINGER_TIMEOUT = 10000; // 10s

void handleCommand(String cmd);
void sendSensorError(const String &msg);

bool enrollFinger(uint16_t id);
bool verifyFinger();
bool deleteFinger(uint16_t id);
bool emptyDatabase();

bool waitForFingerPressed(uint16_t timeout);
bool waitForFingerReleased(uint16_t timeout);

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(SERIAL_BAUD);
  while (!Serial) { } // en UNO no bloquea

  fingerSerial.begin(57600);
  delay(200);

  Serial.println(F("SENSOR:INIT"));
  finger.begin(57600);

  if (finger.verifyPassword()) {
    Serial.println(F("SENSOR:OK"));
  } else {
    Serial.println(F("SENSOR:ERROR:No se puede verificar password del AS608"));
  }
}

// =====================================================
// LOOP
// =====================================================
void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) {
      Serial.print(F("CMD:"));
      Serial.println(cmd);   // debug
      handleCommand(cmd);
    }
  }
}

// =====================================================
// COMANDOS DESDE NODE / MONITOR
// =====================================================
void handleCommand(String cmd) {
  cmd.trim();
  String originalCmd = cmd;  // para debug
  cmd.toUpperCase();

  if (cmd.startsWith("ENROLL")) {
    int spaceIndex = cmd.indexOf(' ');
    if (spaceIndex == -1) {
      sendSensorError("ENROLL:ID faltante");
      return;
    }
    String idStr = cmd.substring(spaceIndex + 1);
    idStr.trim();
    uint16_t id = (uint16_t) idStr.toInt();
    if (id < 1 || id > 127) {
      sendSensorError("ENROLL:ID fuera de rango (1-127)");
      return;
    }

    Serial.println(F("ENROLL:START"));
    Serial.print(F("ENROLL:DEBUG:ID="));
    Serial.println(id);

    bool ok = enrollFinger(id);
    if (ok) {
      Serial.print(F("ENROLL:OK:ID="));
      Serial.println(id);
    }

  } else if (cmd.startsWith("VERIFY")) {

    Serial.println(F("VERIFY:START"));
    bool ok = verifyFinger();
    (void)ok;

  } else if (cmd.startsWith("DELETE")) {

    int spaceIndex = cmd.indexOf(' ');
    if (spaceIndex == -1) {
      sendSensorError("DELETE:ID faltante");
      return;
    }
    String idStr = cmd.substring(spaceIndex + 1);
    idStr.trim();
    uint16_t id = (uint16_t) idStr.toInt();
    if (id < 1 || id > 127) {
      sendSensorError("DELETE:ID fuera de rango (1-127)");
      return;
    }

    Serial.print(F("DELETE:DEBUG:ID="));
    Serial.println(id);

    bool ok = deleteFinger(id);
    if (ok) {
      Serial.print(F("DELETE:OK:ID="));
      Serial.println(id);
    }

  } else if (cmd.startsWith("EMPTY")) {

    Serial.println(F("EMPTY:DEBUG:VACIANDO"));
    bool ok = emptyDatabase();
    if (ok) {
      Serial.println(F("EMPTY:OK"));
    }

  } else {
    sendSensorError("Comando desconocido: " + originalCmd);
  }
}

// =====================================================
// ENROLL (con bloqueo de DUPLICADOS)
// =====================================================
bool enrollFinger(uint16_t id) {
  uint8_t p;

  // 1) Primer dedo
  Serial.println(F("ENROLL:MSG:Coloca el dedo"));
  if (!waitForFingerPressed(FINGER_TIMEOUT)) {
    sendSensorError("ENROLL:Tiempo agotado al esperar dedo");
    return false;
  }

  // Capturar imagen #1
  Serial.println(F("ENROLL:DEBUG:getImage #1"));
  p = finger.getImage();
  if (p != FINGERPRINT_OK) {
    sendSensorError("ENROLL:getImage #1 fallo, codigo=" + String(p));
    return false;
  }

  // Convertir a template slot 1
  Serial.println(F("ENROLL:DEBUG:image2Tz #1"));
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    sendSensorError("ENROLL:image2Tz #1 fallo, codigo=" + String(p));
    return false;
  }

  // 🔒 VERIFICAR SI ESA HUELLA YA EXISTE EN EL SENSOR
  Serial.println(F("ENROLL:DEBUG:checkDuplicate"));
  p = finger.fingerFastSearch();
  if (p == FINGERPRINT_OK) {
    // Ya existe: NO permitir registrar el mismo dedo para otro usuario
    Serial.print(F("ENROLL:ERROR:DUPLICATE:ID="));
    Serial.print(finger.fingerID);
    Serial.print(F(";CONF="));
    Serial.println(finger.confidence);

    Serial.println(F("ENROLL:MSG:Huella ya registrada (no se permite duplicar)"));
    // Pedir que retire el dedo para limpiar el estado
    (void)waitForFingerReleased(FINGER_TIMEOUT);
    return false;
  }

  // 2) Retirar dedo
  Serial.println(F("ENROLL:MSG:Retira el dedo"));
  if (!waitForFingerReleased(FINGER_TIMEOUT)) {
    sendSensorError("ENROLL:Tiempo agotado al retirar dedo");
    return false;
  }

  delay(500);

  // 3) Segundo escaneo del mismo dedo
  Serial.println(F("ENROLL:MSG:Coloca el mismo dedo otra vez"));
  if (!waitForFingerPressed(FINGER_TIMEOUT)) {
    sendSensorError("ENROLL:Tiempo agotado en segundo dedo");
    return false;
  }

  Serial.println(F("ENROLL:DEBUG:getImage #2"));
  p = finger.getImage();
  if (p != FINGERPRINT_OK) {
    sendSensorError("ENROLL:getImage #2 fallo, codigo=" + String(p));
    return false;
  }

  Serial.println(F("ENROLL:DEBUG:image2Tz #2"));
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    sendSensorError("ENROLL:image2Tz #2 fallo, codigo=" + String(p));
    return false;
  }

  // 4) Crear modelo y guardar en ID
  Serial.println(F("ENROLL:DEBUG:createModel"));
  p = finger.createModel();
  if (p != FINGERPRINT_OK) {
    sendSensorError("ENROLL:createModel fallo, codigo=" + String(p));
    return false;
  }

  Serial.println(F("ENROLL:DEBUG:storeModel"));
  p = finger.storeModel(id);
  if (p != FINGERPRINT_OK) {
    sendSensorError("ENROLL:storeModel fallo, codigo=" + String(p));
    return false;
  }

  return true;
}

// =====================================================
// VERIFY
// =====================================================
bool verifyFinger() {
  uint8_t p;

  Serial.println(F("VERIFY:MSG:Coloca el dedo para verificar"));
  if (!waitForFingerPressed(FINGER_TIMEOUT)) {
    sendSensorError("VERIFY:Tiempo agotado al esperar dedo");
    Serial.println(F("VERIFY:NOT_FOUND"));
    return false;
  }

  Serial.println(F("VERIFY:DEBUG:getImage"));
  p = finger.getImage();
  if (p != FINGERPRINT_OK) {
    sendSensorError("VERIFY:getImage fallo, codigo=" + String(p));
    Serial.println(F("VERIFY:NOT_FOUND"));
    return false;
  }

  Serial.println(F("VERIFY:DEBUG:image2Tz"));
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    sendSensorError("VERIFY:image2Tz fallo, codigo=" + String(p));
    Serial.println(F("VERIFY:NOT_FOUND"));
    return false;
  }

  Serial.println(F("VERIFY:DEBUG:fingerFastSearch"));
  p = finger.fingerFastSearch();
  if (p == FINGERPRINT_OK) {
    Serial.print(F("VERIFY:OK:ID="));
    Serial.print(finger.fingerID);
    Serial.print(F(";CONF="));
    Serial.println(finger.confidence);
    return true;
  } else {
    sendSensorError("VERIFY:No encontrada, codigo=" + String(p));
    Serial.println(F("VERIFY:NOT_FOUND"));
    return false;
  }
}

// =====================================================
// DELETE
// =====================================================
bool deleteFinger(uint16_t id) {
  uint8_t p = finger.deleteModel(id);
  if (p == FINGERPRINT_OK) {
    return true;
  } else {
    sendSensorError("DELETE:Error codigo=" + String(p));
    return false;
  }
}

// =====================================================
// EMPTY
// =====================================================
bool emptyDatabase() {
  uint8_t p = finger.emptyDatabase();
  if (p == FINGERPRINT_OK) {
    return true;
  } else {
    sendSensorError("EMPTY:Error codigo=" + String(p));
    return false;
  }
}

// =====================================================
// UTILIDADES
// =====================================================
bool waitForFingerPressed(uint16_t timeout) {
  uint32_t start = millis();
  while ((millis() - start) < timeout) {
    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) {
      return true;
    }
    delay(100);
  }
  return false;
}

bool waitForFingerReleased(uint16_t timeout) {
  uint32_t start = millis();
  while ((millis() - start) < timeout) {
    uint8_t p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) {
      return true;
    }
    delay(100);
  }
  return false;
}

void sendSensorError(const String &msg) {
  Serial.print(F("SENSOR:ERROR:"));
  Serial.println(msg);
}
