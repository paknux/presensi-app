const express = require('express');
const router = express.Router();
const { pool } = require('../db/connection');
const { uploadFotoProfil, getPresignedUrl, deleteFotoS3 } = require('../config/s3');

// GET /api/siswa - Ambil semua siswa
router.get('/', async (req, res) => {
  try {
    const { kelas_id, search } = req.query;
    let query = `
      SELECT s.*, k.nama_kelas, k.wali_kelas
      FROM siswa s
      LEFT JOIN kelas k ON s.kelas_id = k.id
      WHERE 1=1
    `;
    const params = [];

    if (kelas_id) {
      query += ' AND s.kelas_id = ?';
      params.push(kelas_id);
    }
    if (search) {
      query += ' AND (s.nama LIKE ? OR s.nis LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY k.nama_kelas, s.nama';

    const [rows] = await pool.query(query, params);

    // Generate presigned URL untuk setiap foto profil
    const siswaWithUrl = await Promise.all(rows.map(async (s) => {
      if (s.foto_profil_s3_key) {
        s.foto_profil_url = await getPresignedUrl(s.foto_profil_s3_key);
      }
      return s;
    }));

    res.json({ success: true, data: siswaWithUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/siswa/:id - Detail siswa
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, k.nama_kelas, k.wali_kelas
      FROM siswa s
      LEFT JOIN kelas k ON s.kelas_id = k.id
      WHERE s.id = ?
    `, [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });

    const siswa = rows[0];
    if (siswa.foto_profil_s3_key) {
      siswa.foto_profil_url = await getPresignedUrl(siswa.foto_profil_s3_key);
    }

    res.json({ success: true, data: siswa });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/siswa - Tambah siswa baru
router.post('/', uploadFotoProfil.single('foto_profil'), async (req, res) => {
  try {
    const { nis, nama, kelas_id, jenis_kelamin } = req.body;
    if (!nis || !nama || !kelas_id || !jenis_kelamin) {
      return res.status(400).json({ success: false, message: 'Field nis, nama, kelas_id, jenis_kelamin wajib diisi' });
    }

    let foto_profil_s3_key = null;
    if (req.file) {
      foto_profil_s3_key = req.file.key;
    }

    const [result] = await pool.query(
      'INSERT INTO siswa (nis, nama, kelas_id, jenis_kelamin, foto_profil_s3_key) VALUES (?, ?, ?, ?, ?)',
      [nis, nama, kelas_id, jenis_kelamin, foto_profil_s3_key]
    );

    res.status(201).json({ success: true, message: 'Siswa berhasil ditambahkan', data: { id: result.insertId } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'NIS sudah terdaftar' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/siswa/:id - Update siswa
router.put('/:id', uploadFotoProfil.single('foto_profil'), async (req, res) => {
  try {
    const { nama, kelas_id, jenis_kelamin } = req.body;
    const { id } = req.params;

    const [existing] = await pool.query('SELECT * FROM siswa WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });

    let foto_profil_s3_key = existing[0].foto_profil_s3_key;

    if (req.file) {
      // Hapus foto lama dari S3
      if (foto_profil_s3_key) await deleteFotoS3(foto_profil_s3_key);
      foto_profil_s3_key = req.file.key;
    }

    await pool.query(
      'UPDATE siswa SET nama=?, kelas_id=?, jenis_kelamin=?, foto_profil_s3_key=? WHERE id=?',
      [nama, kelas_id, jenis_kelamin, foto_profil_s3_key, id]
    );

    res.json({ success: true, message: 'Data siswa berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/siswa/:id - Hapus siswa
router.delete('/:id', async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM siswa WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });

    // Hapus foto profil dari S3
    if (existing[0].foto_profil_s3_key) {
      await deleteFotoS3(existing[0].foto_profil_s3_key);
    }

    await pool.query('DELETE FROM presensi WHERE siswa_id = ?', [req.params.id]);
    await pool.query('DELETE FROM siswa WHERE id = ?', [req.params.id]);

    res.json({ success: true, message: 'Siswa berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/siswa/kelas/list - List semua kelas
router.get('/kelas/list', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM kelas ORDER BY nama_kelas');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
