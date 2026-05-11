const mysql2 = require('mysql2/promise');
require('dotenv').config();

const DB_NAME = process.env.DB_NAME || 'presensi_db';

// Pool tanpa database dulu (untuk buat database jika belum ada)
const poolInit = mysql2.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  waitForConnections: true,
  connectionLimit: 3,
  connectTimeout: 10000
});

// Pool utama dengan database
const pool = mysql2.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000
});

async function initDatabase() {
  let conn;
  try {
    // 1. Buat database jika belum ada
    conn = await poolInit.getConnection();
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    console.log(`✅ Database '${DB_NAME}' siap`);
    conn.release();

    // 2. Buat tabel-tabel jika belum ada
    const db = await pool.getConnection();

    await db.query(`
      CREATE TABLE IF NOT EXISTS kelas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama_kelas VARCHAR(50) NOT NULL,
        wali_kelas VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS siswa (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nis VARCHAR(20) UNIQUE NOT NULL,
        nama VARCHAR(100) NOT NULL,
        kelas_id INT,
        jenis_kelamin ENUM('L', 'P') NOT NULL,
        foto_profil_s3_key VARCHAR(255),
        foto_profil_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (kelas_id) REFERENCES kelas(id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS presensi (
        id INT AUTO_INCREMENT PRIMARY KEY,
        siswa_id INT NOT NULL,
        tanggal DATE NOT NULL,
        waktu_checkin TIME,
        status ENUM('Hadir', 'Sakit', 'Izin', 'Alpha') NOT NULL DEFAULT 'Hadir',
        foto_presensi_path VARCHAR(500),
        keterangan TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (siswa_id) REFERENCES siswa(id),
        UNIQUE KEY unique_presensi (siswa_id, tanggal)
      )
    `);

    console.log('✅ Tabel kelas, siswa, presensi siap');

    // 3. Insert data kelas awal jika tabel kelas masih kosong
    const [rows] = await db.query('SELECT COUNT(*) as total FROM kelas');
    if (rows[0].total === 0) {
      await db.query(`
        INSERT INTO kelas (nama_kelas, wali_kelas) VALUES
        ('X-A', 'Budi Santoso, S.Pd'),
        ('X-B', 'Siti Rahayu, S.Pd'),
        ('XI-A', 'Ahmad Fauzi, S.Pd'),
        ('XI-B', 'Dewi Kusuma, S.Pd'),
        ('XII-A', 'Hendra Wijaya, S.Pd')
      `);
      console.log('✅ Data kelas awal berhasil ditambahkan');
    }

    db.release();
    console.log('🚀 Inisialisasi database selesai');
  } catch (err) {
    console.error('❌ Gagal inisialisasi database:', err.message);
    if (conn) conn.release();
    process.exit(1);
  }
}

module.exports = { pool, initDatabase };
