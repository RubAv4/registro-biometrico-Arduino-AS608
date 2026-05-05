# Sistema de Registro Biométrico con Arduino AS608

Sistema completo para registrar asistencia mediante lectura de huellas dactilares usando Arduino con sensor AS608, servidor Node.js y base de datos MySQL.

---

## 📋 Descripción del Proyecto

Este proyecto integra:

- **Sensor biométrico AS608**: Lee huellas dactilares
- **Arduino**: Comunica con el sensor y envía datos serialmente
- **Servidor Node.js**: Actúa como bridge entre Arduino y la web
- **Base de datos MySQL**: Almacena usuarios, huellas y registros de asistencia
- **Interfaz web**: Panel para visualizar asistencias y gestionar actividades
- **Autenticación JWT**: Seguridad con tokens de sesión

---

## 🔧 Requisitos Previos

Antes de instalar, asegúrate de tener:

### Software requerido:

- **Node.js** (v14 o superior) - [Descargar](https://nodejs.org/)
- **MySQL** (v5.7 o superior) - [Descargar](https://dev.mysql.com/downloads/mysql/)
- **Arduino IDE** - [Descargar](https://www.arduino.cc/en/software)
- **npm** (se instala con Node.js)

### Hardware requerido:

- Placa Arduino (Uno, Nano, Mega, etc.)
- Sensor de huellas dactilares AS608
- Cable USB para Arduino
- Conexión USB a COM port disponible

### Conocimientos básicos:

- Terminal/Consola de comandos
- Configuración básica de MySQL
- Subida de sketches a Arduino

---

## 🚀 Instalación

### 1. Clonar o descargar el repositorio

```bash
git clone <tu-repositorio>
cd registro-biometrico-Arduino-AS608
```

### 2. Instalar dependencias de Node.js

```bash
npm install
```

Este comando instala las siguientes librerías:

- **express**: Servidor web
- **socket.io**: Comunicación en tiempo real
- **mysql2**: Conexión a MySQL
- **bcryptjs**: Encriptación de contraseñas
- **jsonwebtoken**: Autenticación JWT
- **serialport**: Comunicación con Arduino
- **cors**: Control de origen cruzado
- **dotenv**: Variables de entorno

### 3. Configurar la base de datos MySQL

1. Abre MySQL (phpMyAdmin o línea de comandos)
2. Ejecuta el script SQL para crear la base de datos:

```bash
mysql -u root -p < sql/biometrico.sql
```

3. Se crearán las siguientes tablas:
   - `usuarios`: Almacena datos de personas y huellas
   - `actividades`: Lista de actividades a registrar
   - `asistencias`: Registro de asistencias
   - `admins`: Usuarios administradores

### 4. Configurar credenciales de MySQL

Abre `server.js` y modifica la sección de configuración:

```javascript
const DB_CONFIG = {
  host: "localhost",
  user: "root", // Tu usuario de MySQL
  password: "tu_clave", // Tu contraseña de MySQL
  database: "biometrico",
};
```

### 5. Configurar puerto del Arduino

En `server.js`, asegúrate de que el puerto serial sea correcto:

```javascript
const SERIAL_PORT = "COM4"; // Windows (COM3, COM4, COM5, etc.)
// const SERIAL_PORT = "/dev/ttyUSB0";  // Linux
// const SERIAL_PORT = "/dev/cu.usbserial-14130";  // macOS
const SERIAL_BAUDRATE = 57600; // Velocidad de comunicación
```

**Para encontrar tu puerto:**

- **Windows**: Abre Administrador de dispositivos → Puertos COM
- **Linux/Mac**: `ls /dev/tty*` en terminal

### 6. Crear usuario administrador

```bash
npm run create-admin
```

Sigue las indicaciones para crear el usuario admin.

---

## 📱 Cómo Funciona

### Flujo General:

```
Arduino (AS608)
    ↓ (Serial USB)
Node.js Server (server.js)
    ↓ (Socket.IO + HTTP)
Interfaz Web (public/index.html)
    ↓ (API REST + JWT)
MySQL (biometrico)
```

### Proceso de Registro de Asistencia:

1. **Usuario coloca dedo** en el sensor AS608
2. **Arduino detecta** la huella y envía datos por serial
3. **Node.js recibe** la huella mediante `serialport`
4. **Socket.IO emite** evento a navegadores conectados
5. **Script busca** coincidencia en base de datos
6. **Registra asistencia** en tabla `asistencias`
7. **Interfaz actualiza** en tiempo real

### Componentes Principales:

#### `server.js` (Servidor Principal)

- Inicia servidor Express en puerto 3000
- Maneja conexión a MySQL
- Gestiona Socket.IO para Arduino
- Implementa rutas API REST con autenticación JWT
- Procesa datos seriales del Arduino

#### `public/index.html` (Interfaz Web)

- Panel de control para operadores
- Visualización en tiempo real de asistencias
- Gestión de actividades
- Gráficos y estadísticas
- Login con autenticación JWT

#### `fingerprint_arduino.ino.ino` (Código Arduino)

- Comunica con sensor AS608
- Lee huellas dactilares
- Envía datos por serial a Node.js
- Controla LED y buzzer para feedback

#### `create-admin.js` (Script de Administrador)

- Crea usuarios administrador
- Encripta contraseñas con bcryptjs
- Asigna roles (ADMIN, OPERADOR)

---

## ▶️ Ejecución

### Iniciar el servidor:

```bash
npm start
```

O con nodemon para desarrollo (reinicia automáticamente):

```bash
npm install -g nodemon
nodemon server.js
```

### Acceder a la interfaz web:

1. Abre tu navegador
2. Ve a `http://localhost:3000`
3. Inicia sesión con usuario y contraseña admin
4. ¡Sistema listo para registrar asistencias!

---

## 🗂️ Estructura del Proyecto

```
registro-biometrico-Arduino-AS608/
├── server.js                      # Servidor Node.js principal
├── fingerprint_arduino.ino.ino    # Código para Arduino
├── create-admin.js                # Script para crear admin
├── package.json                   # Dependencias de Node.js
├── README.md                      # Este archivo
├── public/
│   └── index.html                 # Interfaz web
└── sql/
    └── biometrico.sql             # Script de base de datos
```

---

## 🔐 Seguridad

- **Contraseñas**: Encriptadas con bcryptjs
- **Autenticación**: JWT con expiración de 8 horas
- **Base de datos**: Consultas preparadas contra SQL injection
- **CORS**: Configurado para origen específico
- **Variables sensibles**: Usar `.env` en producción

### Archivo `.env` recomendado (crear en raíz):

```env
JWT_SECRET=tu_clave_secreta_muy_larga_aqui
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=tu_clave_mysql
DB_NAME=biometrico
SERIAL_PORT=COM4
APP_PORT=3000
```

---

## 🐛 Solución de Problemas

### Arduino no se conecta

- Verificar cable USB
- Instalar drivers CH340 o FTDI
- Confirmar puerto COM en Administrador de dispositivos
- Comprobar velocidad en baudrate (57600)

### Error de conexión MySQL

- Asegurar que MySQL está iniciado
- Verificar usuario y contraseña en `server.js`
- Confirmar que base de datos existe: `mysql -u root -e "SHOW DATABASES;"`

### Interfaz no carga

- Verificar servidor en `http://localhost:3000`
- Abrir consola del navegador (F12) para ver errores
- Verificar que Node.js está ejecutándose

### Huella no se detecta

- Limpiar dedo (no debe estar mojado)
- Asegurar buena iluminación del sensor
- Verificar conexión del sensor AS608 a Arduino
- Probar sketch Arduino directamente

---

## 📊 Endpoints API

| Método | Ruta               | Descripción                         |
| ------ | ------------------ | ----------------------------------- |
| POST   | `/login`           | Autenticarse con usuario/contraseña |
| GET    | `/api/usuarios`    | Obtener lista de usuarios           |
| POST   | `/api/usuarios`    | Crear nuevo usuario                 |
| GET    | `/api/actividades` | Obtener actividades                 |
| GET    | `/api/asistencias` | Obtener registros de asistencia     |

---

## 📝 Notas Importantes

- Cambiar `JWT_SECRET` en producción
- Hacer backup regular de la base de datos
- Mantener Arduino alimentado durante uso
- Calibrar sensor AS608 antes de uso masivo
- Tener registro de huellas actualizado

---

## 📄 Licencia

ISC

---

## 👤 Autor

Proyecto de Sistema de Registro Biométrico

Para más información o reportar problemas, abre un issue en el repositorio.

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/b2a06a4b-23d3-457f-9877-d76cff583f5d" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/1db2e0ba-54fc-47e9-aa3e-da9377ebdf72" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/d619abbd-0211-48d3-860b-3d27aa2738c6" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/e1c929d5-c609-452a-9ed2-358d67d3ce4a" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/dbbd1b02-6e2b-4f7a-8965-0465138ccd00" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/e60defa2-68cc-41ca-9b83-ac1d057c1e8c" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/5eb7b599-384f-403c-9401-1322f2cc17db" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/8ca1ba62-7fc0-4a59-9954-58e0d6068cd4" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/4d77fc30-9088-48b1-9072-80c2d503aa86" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/0d222e10-4261-417a-a8ca-8d09d00ce629" />
