const express = require('express');
const router = express.Router();
const { pool } = require('../db/connection');



// GET /api/kelas
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM kelas ORDER BY nama_kelas');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/kelas
router.post('/', async (req, res) => {
  try {
    const { nama_kelas, wali_kelas } = req.body;
    const [result] = await pool.query('INSERT INTO kelas (nama_kelas, wali_kelas) VALUES (?, ?)', [nama_kelas, wali_kelas]);
    res.status(201).json({ success: true, message: 'Kelas berhasil ditambahkan', data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
