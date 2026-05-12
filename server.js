const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { initDatabase } = require('./db/connection');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Pastikan direktori EFS ada
const EFS_PATH = process.env.EFS_MOUNT_PATH || '/mnt/efs/presensi';
if (!fs.existsSync(EFS_PATH)) {
  try {
    fs.mkdirSync(EFS_PATH, { recursive: true });
    console.log(`✅ EFS directory created: ${EFS_PATH}`);
  } catch (err) {
    console.warn(`⚠️  Tidak bisa buat direktori EFS: ${err.message}`);
  }
}

// Routes
app.use('/api/sistem', require('./routes/sistem'));
app.use('/api/siswa', require('./routes/siswa'));
app.use('/api/presensi', require('./routes/presensi'));
app.use('/api/kelas', require('./routes/kelas'));

// ✅ Health check untuk ALB Target Group — HARUS sebelum catch-all (*)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Catch-all ke frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message });
});

// Jalankan init DB dulu, baru start server
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
  ╔══════════════════════════════════════╗
  ║   🎓 Aplikasi Presensi Siswa        ║
  ║   Server berjalan di port ${PORT}      ║
  ╚══════════════════════════════════════╝
    `);
    console.log(`📡 REST API: http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  });
});