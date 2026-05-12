const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const { pool } = require('../db/connection');
const { s3Client, BUCKET_NAME } = require('../config/s3');
const { HeadBucketCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

// GET /api/sistem/info - Info sistem untuk top bar
router.get('/info', async (req, res) => {
  const info = {
    hostname: os.hostname(),
    ip_private: '',
    ip_public: '',
    platform: os.platform(),
    uptime: Math.floor(os.uptime() / 60) + ' menit',
    memory: {
      total: Math.round(os.totalmem() / 1024 / 1024) + ' MB',
      free: Math.round(os.freemem() / 1024 / 1024) + ' MB'
    },
    efs: {
      status: 'unknown',
      path: process.env.EFS_MOUNT_PATH || '/mnt/efs/presensi',
      mounted: false
    },
    s3: {
      status: 'unknown',
      bucket: BUCKET_NAME
    },
    rds: {
      status: 'unknown',
      host: process.env.DB_HOST,
      database: process.env.DB_NAME
    }
  };

  // Ambil IP private
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        info.ip_private = net.address;
        break;
      }
    }
  }

  // Cek EFS
  try {
    const efsPath = process.env.EFS_MOUNT_PATH || '/mnt/efs/presensi';
    if (fs.existsSync(efsPath)) {
      info.efs.mounted = true;
      info.efs.status = 'connected';
      // Hitung jumlah file di EFS
      const files = fs.readdirSync(efsPath);
      info.efs.total_files = files.length;
    } else {
      info.efs.status = 'not mounted';
    }
  } catch (err) {
    info.efs.status = 'error: ' + err.message;
  }

  // Cek S3
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    info.s3.status = 'connected';
  } catch (err) {
    info.s3.status = 'error: ' + err.message;
  }

  // Cek RDS
  try {
    const conn = await pool.getConnection();
    await conn.query('SELECT 1');
    conn.release();
    info.rds.status = 'connected';
  } catch (err) {
    info.rds.status = 'error: ' + err.message;
  }

  res.json({ success: true, data: info });
});

module.exports = router;
