# 🎓 Aplikasi Presensi Siswa

Aplikasi presensi siswa berbasis Node.js dengan integrasi AWS (EFS, S3, RDS MariaDB).

## Arsitektur

```
Client (Browser)
     │
     ▼
Node.js Express (REST API)
     ├── RDS MariaDB  → Data siswa, presensi
     ├── S3 (IAM)   → Foto profil siswa
     └── EFS        → Foto presensi harian
```

## Fitur

- ✅ Dashboard presensi harian dengan statistik
- ✅ Input presensi (Hadir/Sakit/Izin/Alpha)
- ✅ Presensi massal per kelas
- ✅ Foto presensi tersimpan di EFS
- ✅ Foto profil siswa tersimpan di S3 (via IAM Role)
- ✅ Rekap presensi per siswa & per kelas
- ✅ Export CSV
- ✅ Info sistem di top bar (IP, EFS, S3, RDS status)

## Struktur File

```
presensi-app/
├── server.js              # Entry point
├── package.json
├── .env                   # Konfigurasi environment
├── db/
│   ├── connection.js      # Koneksi MariaDB pool
│   └── schema.sql         # DDL database
├── config/
│   └── s3.js              # S3 client (IAM Role)
├── routes/
│   ├── sistem.js          # GET /api/sistem/info
│   ├── siswa.js           # CRUD /api/siswa
│   ├── presensi.js        # /api/presensi
│   └── kelas.js           # /api/kelas
└── public/
    └── index.html         # Frontend SPA
```

## Setup

### 1. Prasyarat di AWS
- EC2 dengan IAM Role yang punya akses S3 (AmazonS3FullAccess)
- RDS MariaDB dengan endpoint yang bisa diakses dari EC2
- EFS sudah di-mount ke EC2 di path `/mnt/efs/presensi`
- S3 bucket sudah dibuat

### 2. Deploy ke instance EC2

```bash
apt update -y
apt install nodejs npm git -y

mkdir /opt/presensi-app
cd /opt/presensi-app
git clone https://github.com/paknux/presensi-app .
npm install
npm install -g pm2
```

### 3. Konfigurasi .env
```bash
nano .env
```
Edit dan sesuaikan nilai berikut:
```
# Database RDS MariaDB
DB_HOST=your-rds-endpoint.rds.amazonaws.com
DB_PORT=3306
DB_USER=admin
DB_PASS=P4ssw0rd
DB_NAME=presensi_db

# S3
S3_BUCKET_NAME=your-s3-bucket-name
AWS_REGION=us-east-1

# EFS
EFS_MOUNT_PATH=/mnt/efs/presensi

# App
PORT=80
```



### 4. Jalankan Aplikasi
```bash
pm2 start server.js --name presensi-app
pm2 save
```

### 6. Akses Aplikasi
```
http://ippublic
```

## REST API Endpoints

### Sistem
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /api/sistem/info | Info sistem (hostname, IP, status EFS/S3/RDS) |

### Siswa
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /api/siswa | List siswa (filter: kelas_id, search) |
| GET | /api/siswa/:id | Detail siswa |
| POST | /api/siswa | Tambah siswa (multipart/form-data) |
| PUT | /api/siswa/:id | Update siswa |
| DELETE | /api/siswa/:id | Hapus siswa |

### Presensi
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /api/presensi | Presensi harian (filter: tanggal, kelas_id) |
| POST | /api/presensi | Input presensi (multipart/form-data) |
| GET | /api/presensi/rekap/siswa/:id | Rekap per siswa |
| GET | /api/presensi/rekap/kelas | Rekap per kelas |
| GET | /api/presensi/export/csv | Export CSV |

### Kelas
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | /api/kelas | List semua kelas |
| POST | /api/kelas | Tambah kelas |

## Keamanan S3

Aplikasi menggunakan **IAM Role** pada EC2 — tidak ada credential yang disimpan di kode.
Foto profil diakses via **Presigned URL** (berlaku 1 jam) sehingga tidak perlu bucket public.

## Catatan EFS

Foto presensi disimpan dengan struktur:
```
/mnt/efs/presensi/
└── foto-presensi/
    ├── 2024-01-15/
    │   ├── uuid1.jpg
    │   └── uuid2.jpg
    └── 2024-01-16/
        └── uuid3.jpg
```
