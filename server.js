// server.js
// ----------------------------------------------------
// Servidor Node.js para:
// - Servir la web (public/index.html)
// - Hacer de BRIDGE con Arduino (Serial + Socket.IO)
// - Reemplazar api.php (API MySQL)
// - Login (usuario + contraseña) con JWT
// ----------------------------------------------------

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const { SerialPort, ReadlineParser } = require("serialport");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// =========================
// CONFIGURACIÓN BÁSICA
// =========================
const APP_PORT = 3000;

// Ajusta estos datos a tu MySQL
const DB_CONFIG = {
  host: "localhost",
  user: "root",
  password: "", // pon tu contraseña
  database: "biometrico",
};

// Puerto del Arduino
const SERIAL_PORT = "COM4";
const SERIAL_BAUDRATE = 57600;

// JWT
const JWT_SECRET = process.env.JWT_SECRET || "cambia-esto-por-un-secreto-largo";
const JWT_EXPIRES_IN = "8h";

// =========================
// INICIALIZAR APP
// =========================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// =========================
// CONEXIÓN A MySQL
// =========================
let pool;

async function initDB() {
  pool = await mysql.createPool(DB_CONFIG);
  console.log("✅ Conectado a MySQL");
}

// =========================
// AUTH HELPERS
// =========================
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");
    if (type !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        error: true,
        message: "No autorizado (token faltante)",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({
      success: false,
      error: true,
      message: "Token inválido o expirado",
    });
  }
}

function isAdminUser(req) {
  const rol = String(req.user?.rol || "").toUpperCase();
  return rol === "ADMIN";
}

// =========================
// ENDPOINT LOGIN
// =========================
app.post("/api/auth/login", async (req, res) => {
  try {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) {
      return res.status(400).json({
        success: false,
        error: true,
        message: "Falta usuario o contraseña",
      });
    }

    const [rows] = await pool.execute(
      "SELECT id, usuario, password_hash, nombre, rol FROM admins WHERE usuario = ? LIMIT 1",
      [usuario]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        error: true,
        message: "Credenciales inválidas",
      });
    }

    const admin = rows[0];
    const ok = await bcrypt.compare(password, admin.password_hash);

    if (!ok) {
      return res.status(401).json({
        success: false,
        error: true,
        message: "Credenciales inválidas",
      });
    }

    const token = signToken({
      id: admin.id,
      usuario: admin.usuario,
      rol: admin.rol,
    });

    return res.json({
      success: true,
      token,
      user: {
        id: admin.id,
        usuario: admin.usuario,
        nombre: admin.nombre,
        rol: admin.rol,
      },
    });
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err);
    return res.status(500).json({
      success: false,
      error: true,
      message: "Error interno del servidor",
    });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  return res.json({ success: true, user: req.user });
});

// =========================
// SERIAL CON ARDUINO
// =========================
let port;
let parser;
let arduinoConnected = false;

function initSerial() {
  try {
    port = new SerialPort(
      { path: SERIAL_PORT, baudRate: SERIAL_BAUDRATE },
      (err) => {
        if (err) {
          console.error("❌ Error abriendo puerto serie:", err.message);
          arduinoConnected = false;
          io.emit("arduino-status", {
            connected: false,
            message: "Error abriendo puerto serie: " + err.message,
          });
        }
      }
    );

    parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.on("open", () => {
      arduinoConnected = true;
      console.log("✅ Puerto serie abierto en", SERIAL_PORT);
      io.emit("arduino-status", {
        connected: true,
        message: `Puerto ${SERIAL_PORT} abierto`,
      });
    });

    port.on("close", () => {
      arduinoConnected = false;
      console.log("⚠️ Puerto serie cerrado");
      io.emit("arduino-status", { connected: false, message: "Puerto serie cerrado" });
    });

    port.on("error", (err) => {
      arduinoConnected = false;
      console.error("❌ Error en puerto serie:", err.message);
      io.emit("arduino-status", { connected: false, message: "Error puerto serie: " + err.message });
    });

    // Interpretar mensajes Arduino
    parser.on("data", (rawLine) => {
      const line = rawLine.toString().trim();
      console.log("📨 [SERIAL]", line);
      io.emit("arduino-message", { message: line });

      // ---------- Sensor status ----------
      if (line.startsWith("SENSOR:OK")) {
        io.emit("sensor-status", { status: "ok", message: "Sensor AS608 OK" });
        return;
      }

      if (line.startsWith("SENSOR:ERROR")) {
        io.emit("sensor-status", { status: "error", message: line });

        // Si el error viene de ENROLL / VERIFY
        if (line.includes("ENROLL:")) {
          io.emit("enroll-status", { status: "error", message: line });
        } else if (line.includes("VERIFY:")) {
          io.emit("verify-status", { status: "error", message: line });
        }
        return;
      }

      // ---------- Enroll flow ----------
      if (line.startsWith("ENROLL:START")) {
        io.emit("enroll-status", { status: "started" });
        return;
      }

      if (line.startsWith("ENROLL:MSG:")) {
        const msg = line.replace("ENROLL:MSG:", "").trim();
        io.emit("enroll-status", { status: "msg", message: msg });
        return;
      }

      if (line.startsWith("ENROLL:ERROR:DUPLICATE")) {
        const idMatch = line.match(/ID=(\d+)/);
        const confMatch = line.match(/CONF=(\d+)/);
        io.emit("enroll-status", {
          status: "duplicate",
          fingerId: idMatch ? parseInt(idMatch[1], 10) : null,
          confidence: confMatch ? parseInt(confMatch[1], 10) : null,
          message: "Huella ya registrada (duplicada)",
        });
        return;
      }

      if (line.startsWith("ENROLL:OK")) {
        const match = line.match(/ID=(\d+)/);
        const id = match ? parseInt(match[1], 10) : null;
        io.emit("enroll-status", { status: "success", id });
        return;
      }

      // ---------- Verify flow ----------
      if (line.startsWith("VERIFY:START")) {
        io.emit("verify-status", { status: "started" });
        return;
      }

      if (line.startsWith("VERIFY:MSG:")) {
        const msg = line.replace("VERIFY:MSG:", "").trim();
        io.emit("verify-status", { status: "msg", message: msg });
        return;
      }

      if (line.startsWith("VERIFY:OK")) {
        const idMatch = line.match(/ID=(\d+)/);
        const confMatch = line.match(/CONF=(\d+)/);
        const fingerId = idMatch ? parseInt(idMatch[1], 10) : null;
        const confidence = confMatch ? parseInt(confMatch[1], 10) : null;
        io.emit("verify-status", { status: "success", fingerId, confidence });
        return;
      }

      if (line.startsWith("VERIFY:NOT_FOUND")) {
        io.emit("verify-status", { status: "not_found" });
        return;
      }
    });
  } catch (err) {
    console.error("❌ Error inicializando Serial:", err.message);
  }
}

// =========================
// SOCKET.IO (Bridge status)
// =========================
io.on("connection", (socket) => {
  console.log("🧑‍💻 Cliente conectado vía WebSocket");
  socket.emit("arduino-status", {
    connected: arduinoConnected,
    message: arduinoConnected ? "Conectado" : "Desconectado",
  });
});

// =========================
// ENDPOINTS BRIDGE (Arduino) - SIN LOGIN
// =========================
function requireArduino(res) {
  if (!arduinoConnected || !port) {
    res.json({ success: false, message: "Arduino no conectado" });
    return false;
  }
  return true;
}

app.post("/enroll", async (req, res) => {
  if (!requireArduino(res)) return;

  const { id } = req.body;
  if (!id) return res.json({ success: false, message: "ID de huella requerido" });

  // Validar que el ID no esté ya usado en BD (evita pisar usuarios)
  try {
    const [[exists]] = await pool.execute(
      "SELECT id FROM usuarios WHERE huella = ? LIMIT 1",
      [String(id)]
    );
    if (exists) {
      return res.json({
        success: false,
        message: `El ID de huella ${id} ya está asignado en la base de datos`,
      });
    }
  } catch (e) {
    console.error("⚠️ Validación BD (huella) falló:", e.message);
  }

  port.write(`ENROLL ${id}\n`, (err) => {
    if (err) {
      return res.json({
        success: false,
        message: "Error enviando comando: " + err.message,
      });
    }
    res.json({ success: true, message: "Comando ENROLL enviado" });
  });
});

app.post("/verify", (req, res) => {
  if (!requireArduino(res)) return;

  port.write("VERIFY\n", (err) => {
    if (err)
      return res.json({
        success: false,
        message: "Error enviando comando: " + err.message,
      });
    res.json({ success: true, message: "Comando VERIFY enviado" });
  });
});

app.post("/delete", (req, res) => {
  if (!requireArduino(res)) return;

  const { id } = req.body;
  if (!id) return res.json({ success: false, message: "ID requerido" });

  port.write(`DELETE ${id}\n`, (err) => {
    if (err)
      return res.json({
        success: false,
        message: "Error enviando comando: " + err.message,
      });
    res.json({ success: true, message: "Comando DELETE enviado" });
  });
});

app.post("/empty", (req, res) => {
  if (!requireArduino(res)) return;

  port.write("EMPTY\n", (err) => {
    if (err)
      return res.json({
        success: false,
        message: "Error enviando comando: " + err.message,
      });
    res.json({ success: true, message: "Comando EMPTY enviado" });
  });
});

// =========================
// API MySQL (reemplaza api.php) - CON LOGIN
// =========================
app.all("/api.php", requireAuth, async (req, res) => {
  const action = req.query.action;

  try {
    switch (action) {

      // ==================================================
      // 🔥 ELIMINAR TODOS LOS USUARIOS (MYSQL) 🔥
      // ==================================================
      case "eliminar_todos_usuarios":
        if (req.method !== "POST") {
          return res.status(405).json({ error: true, message: "Método no permitido" });
        }
        if (!isAdminUser(req)) {
          return res.status(403).json({
            error: true,
            message: "No autorizado. Solo ADMIN puede realizar esta acción",
          });
        }

        await pool.execute("DELETE FROM asistencias");
        await pool.execute("DELETE FROM usuarios");

        return res.json({
          success: true,
          message: "Todos los usuarios y asistencias fueron eliminados correctamente",
        });

      // ==================================================
      // CREAR USUARIO
      // ==================================================
      case "crear_usuario":
        if (req.method !== "POST") {
          return res.status(405).json({ error: true, message: "Método no permitido" });
        }
        {
          const {
            nombre,
            apellido,
            lugar,
            clases,
            religion,
            huella,
            usuario_login,
            password,
          } = req.body;

          if (!nombre || !apellido || !lugar) {
            return res.json({ error: true, message: "Faltan campos obligatorios" });
          }

          const hasHuella = !!huella;
          const hasCreds = !!(usuario_login && password);

          if (!hasHuella && !hasCreds) {
            return res.json({
              error: true,
              message: "Debes registrar huella o credenciales (usuario y contraseña)",
            });
          }

          // Si viene huella, asegurar que NO exista ya en BD
          if (hasHuella) {
            const [[huellaExists]] = await pool.execute(
              "SELECT id FROM usuarios WHERE huella = ? LIMIT 1",
              [String(huella)]
            );
            if (huellaExists) {
              return res.json({
                error: true,
                message: `La huella ${huella} ya está asignada a otro usuario`,
              });
            }
          }

          let password_hash = null;

          if (hasCreds) {
            if (String(usuario_login).length < 3) {
              return res.json({ error: true, message: "El usuario_login debe tener al menos 3 caracteres" });
            }
            if (String(password).length < 4) {
              return res.json({ error: true, message: "La contraseña debe tener al menos 4 caracteres" });
            }

            const [[exists]] = await pool.execute(
              "SELECT id FROM usuarios WHERE usuario_login = ? LIMIT 1",
              [usuario_login]
            );
            if (exists) {
              return res.json({ error: true, message: "Ese usuario_login ya existe" });
            }

            password_hash = await bcrypt.hash(password, 10);
          }

          const [result] = await pool.execute(
            `INSERT INTO usuarios (nombre, apellido, lugar, clases, religion, huella, usuario_login, password_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              nombre,
              apellido,
              lugar,
              clases || null,
              religion || null,
              hasHuella ? String(huella) : null,
              hasCreds ? String(usuario_login) : null,
              password_hash,
            ]
          );

          return res.json({
            success: true,
            message: "Usuario creado correctamente",
            id: result.insertId,
          });
        }

      // ==================================================
      // GET USUARIOS
      // ==================================================
      case "get_usuarios": {
        const [rows] = await pool.execute(
          `SELECT id, nombre, apellido, lugar, clases, religion, huella, usuario_login, fecha_registro
           FROM usuarios
           ORDER BY fecha_registro DESC`
        );
        return res.json({ success: true, data: rows });
      }

      // ==================================================
      // GET ACTIVIDADES
      // ==================================================
      case "get_actividades": {
        const [rows] = await pool.execute(
          `SELECT nombre FROM actividades WHERE activa = 1 ORDER BY id ASC`
        );
        return res.json({ success: true, data: rows.map((r) => r.nombre) });
      }

      // ==================================================
      // ASISTENCIA POR CREDENCIALES
      // ==================================================
      case "registrar_asistencia_credenciales":
        if (req.method !== "POST") {
          return res.status(405).json({ error: true, message: "Método no permitido" });
        }
        {
          const { usuario_login, password, actividad } = req.body;
          if (!usuario_login || !password || !actividad) {
            return res.json({ error: true, message: "Datos incompletos" });
          }

          const [[user]] = await pool.execute(
            "SELECT id, nombre, apellido, password_hash FROM usuarios WHERE usuario_login = ? LIMIT 1",
            [usuario_login]
          );

          if (!user || !user.password_hash) {
            return res.json({ error: true, message: "Usuario o contraseña inválidos" });
          }

          const ok = await bcrypt.compare(password, user.password_hash);
          if (!ok) {
            return res.json({ error: true, message: "Usuario o contraseña inválidos" });
          }

          await pool.execute(
            "INSERT INTO asistencias (usuario_id, actividad) VALUES (?, ?)",
            [user.id, actividad]
          );

          return res.json({
            success: true,
            message: "Asistencia registrada correctamente",
            usuario_nombre: `${user.nombre} ${user.apellido}`,
          });
        }

      // ==================================================
      // ASISTENCIA MANUAL (por user_id)
      // ==================================================
      case "registrar_asistencia":
        if (req.method !== "POST") {
          return res.status(405).json({ error: true, message: "Método no permitido" });
        }
        {
          const { usuario_id, actividad } = req.body;
          if (!usuario_id || !actividad) {
            return res.json({ error: true, message: "Datos incompletos" });
          }

          const [[user]] = await pool.execute(
            "SELECT nombre, apellido FROM usuarios WHERE id = ? LIMIT 1",
            [usuario_id]
          );
          if (!user) return res.json({ error: true, message: "Usuario no encontrado" });

          await pool.execute(
            "INSERT INTO asistencias (usuario_id, actividad) VALUES (?, ?)",
            [usuario_id, actividad]
          );

          return res.json({
            success: true,
            message: "Asistencia registrada correctamente",
            usuario_nombre: `${user.nombre} ${user.apellido}`,
          });
        }

      // ==================================================
      // ASISTENCIA POR HUELLA
      // ==================================================
      case "registrar_asistencia_huella":
        if (req.method !== "POST") {
          return res.status(405).json({ error: true, message: "Método no permitido" });
        }
        {
          const { huella, actividad } = req.body;
          if (!huella || !actividad) {
            return res.json({ error: true, message: "Datos incompletos" });
          }

          const [[user]] = await pool.execute(
            "SELECT id, nombre, apellido FROM usuarios WHERE huella = ? LIMIT 1",
            [String(huella)]
          );

          if (!user) {
            return res.json({ error: true, message: "Usuario no encontrado para esa huella" });
          }

          await pool.execute(
            "INSERT INTO asistencias (usuario_id, actividad) VALUES (?, ?)",
            [user.id, actividad]
          );

          return res.json({
            success: true,
            message: "Asistencia registrada correctamente",
            usuario_nombre: `${user.nombre} ${user.apellido}`,
          });
        }

      // ==================================================
      // ESTADÍSTICAS (🔥 FALTABA EN TU SERVER)
      // ==================================================
      case "get_estadisticas": {
        const [[{ total_usuarios }]] = await pool.execute(
          "SELECT COUNT(*) AS total_usuarios FROM usuarios"
        );

        const [[{ total_asistencias }]] = await pool.execute(
          "SELECT COUNT(*) AS total_asistencias FROM asistencias"
        );

        const [[{ asistencias_hoy }]] = await pool.execute(
          `SELECT COUNT(*) AS asistencias_hoy
           FROM asistencias
           WHERE DATE(fecha_hora) = CURDATE()`
        );

        const [[{ actividades_registradas }]] = await pool.execute(
          "SELECT COUNT(*) AS actividades_registradas FROM actividades WHERE activa = 1"
        );

        const [por_actividad] = await pool.execute(
          `SELECT actividad, COUNT(*) AS total
           FROM asistencias
           GROUP BY actividad
           ORDER BY total DESC`
        );

        return res.json({
          success: true,
          data: {
            total_usuarios,
            total_asistencias,
            asistencias_hoy,
            actividades_registradas,
            por_actividad,
          },
        });
      }

      // ==================================================
      // ASISTENCIAS (🔥 FALTABA EN TU SERVER)
      // ==================================================
      case "get_asistencias": {
        const limit = parseInt(req.query.limit || "50", 10);
        const [rows] = await pool.execute(
          `SELECT a.id,
                  CONCAT(u.nombre, ' ', u.apellido) AS usuario_nombre,
                  a.actividad,
                  a.fecha_hora
           FROM asistencias a
           JOIN usuarios u ON a.usuario_id = u.id
           ORDER BY a.fecha_hora DESC
           LIMIT ?`,
          [limit]
        );
        return res.json({ success: true, data: rows });
      }

      default:
        return res.status(400).json({ error: true, message: "Acción no válida" });
    }
  } catch (err) {
    console.error("❌ Error en API:", err);
    return res.status(500).json({ error: true, message: "Error interno del servidor" });
  }
});

// =========================
// INICIO DEL SERVIDOR
// =========================
(async () => {
  try {
    await initDB();
    initSerial();

    server.listen(APP_PORT, () => {
      console.log(`🚀 Servidor escuchando en http://localhost:${APP_PORT}`);
    });
  } catch (err) {
    console.error("❌ Error iniciando aplicación:", err);
    process.exit(1);
  }
})();
