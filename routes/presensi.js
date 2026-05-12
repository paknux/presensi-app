const express = require('express');
const router = express.Router();
const { pool } = require('../db/connection');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { getPresignedUrl } = require('../config/s3');
require('dotenv').config();

const EFS_PATH = process.env.EFS_MOUNT_PATH || '/mnt/efs/presensi';

// Pastikan direktori EFS ada
const ensureEfsDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Multer storage ke EFS
const efsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const today = moment().format('YYYY-MM-DD');
    const dir = path.join(EFS_PATH, 'foto-presensi', today);
    ensureEfsDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const uploadFotoPresensi = multer({
  storage: efsStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Hanya file gambar yang diperbolehkan'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // max 10MB
});

// GET /api/presensi - Rekap harian
router.get('/', async (req, res) => {
  try {
    const tanggal = req.query.tanggal || moment().format('YYYY-MM-DD');
    const kelas_id = req.query.kelas_id;

    let query = `
      SELECT p.*, s.nis, s.nama, s.foto_profil_s3_key, k.nama_kelas
      FROM presensi p
      JOIN siswa s ON p.siswa_id = s.id
      JOIN kelas k ON s.kelas_id = k.id
      WHERE p.tanggal = ?
    `;
    const params = [tanggal];

    if (kelas_id) {
      query += ' AND s.kelas_id = ?';
      params.push(kelas_id);
    }
    query += ' ORDER BY k.nama_kelas, s.nama';

    const [rows] = await pool.query(query, params);

    const result = await Promise.all(rows.map(async (p) => {
      if (p.foto_profil_s3_key) {
        p.foto_profil_url = await getPresignedUrl(p.foto_profil_s3_key);
      }
      return p;
    }));

    res.json({ success: true, data: result, tanggal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/presensi/rekap/siswa/:id - Rekap per siswa
router.get('/rekap/siswa/:id', async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    const now = moment();
    const m = bulan || now.format('MM');
    const y = tahun || now.format('YYYY');

    const [siswa] = await pool.query('SELECT s.*, k.nama_kelas FROM siswa s LEFT JOIN kelas k ON s.kelas_id = k.id WHERE s.id = ?', [req.params.id]);
    if (siswa.length === 0) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });

    const [presensi] = await pool.query(`
      SELECT * FROM presensi
      WHERE siswa_id = ? AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?
      ORDER BY tanggal DESC
    `, [req.params.id, m, y]);

    const rekap = {
      Hadir: 0, Sakit: 0, Izin: 0, Alpha: 0
    };
    presensi.forEach(p => rekap[p.status]++);

    if (siswa[0].foto_profil_s3_key) {
      siswa[0].foto_profil_url = await getPresignedUrl(siswa[0].foto_profil_s3_key);
    }

    res.json({
      success: true,
      data: {
        siswa: siswa[0],
        rekap,
        total: presensi.length,
        detail: presensi,
        periode: `${m}/${y}`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/presensi/rekap/kelas - Rekap per kelas
router.get('/rekap/kelas', async (req, res) => {
  try {
    const tanggal = req.query.tanggal || moment().format('YYYY-MM-DD');

    const [kelas] = await pool.query('SELECT * FROM kelas ORDER BY nama_kelas');
    const result = [];

    for (const k of kelas) {
      const [total] = await pool.query('SELECT COUNT(*) as total FROM siswa WHERE kelas_id = ?', [k.id]);
      const [hadir] = await pool.query(`
        SELECT status, COUNT(*) as jumlah FROM presensi p
        JOIN siswa s ON p.siswa_id = s.id
        WHERE s.kelas_id = ? AND p.tanggal = ?
        GROUP BY status
      `, [k.id, tanggal]);

      const rekapStatus = { Hadir: 0, Sakit: 0, Izin: 0, Alpha: 0 };
      hadir.forEach(h => rekapStatus[h.status] = h.jumlah);

      result.push({
        kelas: k,
        total_siswa: total[0].total,
        rekap: rekapStatus,
        belum_presensi: total[0].total - Object.values(rekapStatus).reduce((a, b) => a + b, 0)
      });
    }

    res.json({ success: true, data: result, tanggal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/presensi - Input presensi
router.post('/', uploadFotoPresensi.single('foto_presensi'), async (req, res) => {
  try {
    const { siswa_id, tanggal, status, keterangan } = req.body;
    if (!siswa_id || !status) {
      return res.status(400).json({ success: false, message: 'siswa_id dan status wajib diisi' });
    }

    const tgl = tanggal || moment().format('YYYY-MM-DD');
    const waktu = moment().format('HH:mm:ss');

    let foto_presensi_path = null;
    if (req.file) {
      foto_presensi_path = req.file.path;
    }

    // Cek apakah sudah presensi hari ini
    const [existing] = await pool.query(
      'SELECT id FROM presensi WHERE siswa_id = ? AND tanggal = ?',
      [siswa_id, tgl]
    );

    if (existing.length > 0) {
      // Update jika sudah ada
      await pool.query(
        'UPDATE presensi SET status=?, waktu_checkin=?, foto_presensi_path=?, keterangan=? WHERE siswa_id=? AND tanggal=?',
        [status, waktu, foto_presensi_path, keterangan, siswa_id, tgl]
      );
      return res.json({ success: true, message: 'Presensi berhasil diupdate' });
    }

    const [result] = await pool.query(
      'INSERT INTO presensi (siswa_id, tanggal, waktu_checkin, status, foto_presensi_path, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
      [siswa_id, tgl, waktu, status, foto_presensi_path, keterangan]
    );

    res.status(201).json({ success: true, message: 'Presensi berhasil dicatat', data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/presensi/export/csv - Export CSV
router.get('/export/csv', async (req, res) => {
  try {
    const { tanggal, kelas_id } = req.query;
    const tgl = tanggal || moment().format('YYYY-MM-DD');

    let query = `
      SELECT s.nis, s.nama, k.nama_kelas, 
             COALESCE(p.status, 'Alpha') as status,
             p.waktu_checkin, p.keterangan, p.tanggal
      FROM siswa s
      LEFT JOIN kelas k ON s.kelas_id = k.id
      LEFT JOIN presensi p ON s.id = p.siswa_id AND p.tanggal = ?
      WHERE 1=1
    `;
    const params = [tgl];

    if (kelas_id) {
      query += ' AND s.kelas_id = ?';
      params.push(kelas_id);
    }
    query += ' ORDER BY k.nama_kelas, s.nama';

    const [rows] = await pool.query(query, params);

    // Buat CSV manual
    const header = 'NIS,Nama,Kelas,Status,Waktu Check-in,Keterangan,Tanggal\n';
    const csvRows = rows.map(r =>
      `"${r.nis}","${r.nama}","${r.nama_kelas}","${r.status}","${r.waktu_checkin || '-'}","${r.keterangan || '-'}","${r.tanggal || tgl}"`
    ).join('\n');

    const csv = header + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=presensi-${tgl}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/presensi/foto/:tanggal/:filename - Serve foto dari EFS
router.get('/foto/:tanggal/:filename', (req, res) => {
  const filePath = path.join(EFS_PATH, 'foto-presensi', req.params.tanggal, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ success: false, message: 'Foto tidak ditemukan' });
  }
});

module.exports = router;
