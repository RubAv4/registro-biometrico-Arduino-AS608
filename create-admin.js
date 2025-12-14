// create-admin.js
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
  });

  const usuario = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin123';
  const nombre = process.argv[4] || 'Administrador';
  const rol = (process.argv[5] || 'ADMIN').toUpperCase();

  const hash = await bcrypt.hash(password, 10);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      nombre VARCHAR(100) NULL,
      rol ENUM('ADMIN','OPERADOR') NOT NULL DEFAULT 'ADMIN',
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(
    `INSERT INTO admins (usuario, password_hash, nombre, rol)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), nombre=VALUES(nombre), rol=VALUES(rol)`,
    [usuario, hash, nombre, rol]
  );

  console.log('✅ Admin creado/actualizado:', { usuario, password, nombre, rol });
  process.exit(0);
})().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
