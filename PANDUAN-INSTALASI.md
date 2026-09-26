# Panduan Instalasi & Deploy — Brotherhood Workshop Manager

Aplikasi ini terdiri dari dua bagian yang di-deploy secara terpisah:

- **Backend** (`Kode.gs` + `appsscript.json`) → dijalankan di **Google Apps Script**, sebagai REST API (JSON), memakai **Google Sheets** sebagai database dan **Google Drive** sebagai penyimpanan bukti/nota.
- **Frontend** (`index.html`, folder `css/`, folder `js/`) → di-hosting statis di **GitHub Pages**.

Ikuti urutan di bawah ini: **Backend dulu**, baru **Frontend**, karena frontend butuh URL Web App dari backend.

---

## BAGIAN A — Deploy Backend (Google Apps Script)

### A1. Buat proyek Apps Script baru

1. Buka [script.google.com](https://script.google.com) → **Proyek Baru**.
2. Beri nama proyek, misalnya "Brotherhood Workshop Manager — Backend".
3. Hapus semua isi file `Code.gs` bawaan, lalu salin-tempel seluruh isi file **`Kode.gs`** yang diberikan terpisah di chat.

### A2. Isi `appsscript.json` (manifest)

1. Di editor Apps Script, klik ikon gerigi **Project Settings** (Pengaturan Proyek) di sidebar kiri.
2. Centang **"Show 'appsscript.json' manifest file in editor"**.
3. Kembali ke tab **Editor**, buka file `appsscript.json` yang baru muncul, dan timpa isinya dengan isi file **`appsscript.json`** yang diberikan terpisah di chat.
   - File ini mengaktifkan **Advanced Drive Service v2**, yang dipakai untuk fitur ekspor Laporan ke PDF.

### A3. Jalankan setup sekali (membuat Spreadsheet & folder Drive otomatis)

1. Di dropdown fungsi (bagian atas editor, sebelah tombol ▷ Jalankan), pilih fungsi **`setupAppEnvironment`**.
2. Klik **Jalankan (Run)**.
3. Google akan meminta **otorisasi izin** (akses Sheets, Drive, dll) — klik **Lanjutkan**, pilih akun Anda, klik **Advanced/Lanjutan** → **Buka (nama proyek) (tidak aman)** bila muncul peringatan (ini normal untuk skrip milik sendiri), lalu **Izinkan**.
4. Setelah selesai, buka **Log Eksekusi** (`Ctrl+Enter` atau menu **Lihat → Log**). Akan tampil tautan Spreadsheet dan folder Drive yang baru dibuat — simpan tautan Spreadsheet ini, karena di situlah semua data tersimpan.
5. **Penting:** `setupAppEnvironment` hanya perlu dijalankan **SEKALI** saat instalasi pertama. Jangan jalankan ulang di kemudian hari — ini akan membuat Spreadsheet & folder baru yang kosong dan meninggalkan data lama.

### A4. Deploy sebagai Web App

1. Klik tombol **Deploy** (kanan atas) → **New deployment (Deployment baru)**.
2. Klik ikon gerigi di sebelah "Select type" → pilih **Web app**.
3. Isi:
   - **Description**: bebas, misal "v1"
   - **Execute as**: **Me (akun Anda)**
   - **Who has access**: **Anyone (Siapa saja)**
4. Klik **Deploy**.
5. Google akan menampilkan **URL Web App** — bentuknya seperti:
   `https://script.google.com/macros/s/AKfycbxXXXXXXXXXXXXXXXXXXXXXX/exec`
   **Salin URL ini** — akan dipakai di langkah Frontend berikutnya.

### A5. Update deployment di kemudian hari

Jika Anda mengubah kode `Kode.gs` setelah deploy pertama (bug fix, fitur baru, dll):

1. **Deploy → Manage deployments (Kelola deployment)**.
2. Klik ikon pensil pada deployment yang aktif.
3. Ganti **Version** ke **New version (Versi baru)**.
4. Klik **Deploy**.

> URL Web App **tidak berubah** setiap kali update versi — jadi frontend tidak perlu diubah lagi setelah langkah ini, kecuali Anda membuat deployment yang benar-benar baru.

### A6. Verifikasi login pertama

Setelah deploy, sistem sudah membuat akun default. Cek sheet **User** di Spreadsheet hasil setup untuk melihat username & PIN awal (biasanya `owner` dengan PIN default — **segera ganti PIN ini setelah login pertama kali** lewat menu Pengaturan).

---

## BAGIAN B — Deploy Frontend (GitHub Pages)

### B1. Isi URL Backend di frontend

**WAJIB dilakukan sebelum upload ke GitHub**, jika tidak situs akan tampil error "Tidak dapat menghubungi server".

1. Buka file **`js/config.js`** di dalam folder frontend hasil ekstrak ZIP.
2. Cari baris:
   ```js
   const GAS_URL = 'GANTI_DENGAN_URL_WEB_APP_ANDA';
   ```
3. Ganti dengan URL Web App dari langkah **A4** di atas (harus diakhiri `/exec`), contoh:
   ```js
   const GAS_URL = 'https://script.google.com/macros/s/AKfycbxXXXXXXXXXXXXXXXXXXXXXX/exec';
   ```
4. Simpan file.

### B2. Verifikasi struktur folder SEBELUM upload

Pastikan isi folder hasil ekstrak ZIP terlihat seperti ini (jalankan `dir` di PowerShell atau `ls` di Terminal/Git Bash dari dalam folder ini):

```
index.html          ← harus ada di root, bukan di dalam subfolder
css/
  └── style.css
js/
  ├── config.js
  ├── state.js
  ├── ui.js
  ├── api.js
  ├── pages.js
  ├── import.js
  └── app.js
PANDUAN-INSTALASI.md
```

Jika `index.html` tidak terlihat di baris teratas saat `dir`/`ls`, Anda berada di folder yang salah — jangan lanjutkan sebelum masuk ke folder yang benar.

### B3. Upload ke GitHub via terminal (Git)

Gunakan skill/panduan **deploy GitHub Pages** langkah demi langkah (Git init → commit → push), dengan folder kerja adalah **folder hasil ekstrak ZIP ini** (yang berisi `index.html` langsung di root). Ringkasannya:

```bash
git init
git add .
git commit -m "Upload pertama Brotherhood Workshop Manager"
git branch -M main
git remote add origin https://github.com/USERNAME/NAMA-REPO.git
git push -u origin main
```

**Jangan** menggunakan fitur "Upload files" di web GitHub — cara ini merusak struktur folder `css/` dan `js/` sehingga situs tampil tanpa styling dan fitur JS tidak berjalan.

### B4. Aktifkan GitHub Pages

1. Di repository GitHub → **Settings → Pages**.
2. **Source**: `Deploy from a branch`.
3. **Branch**: `main` / `(root)`.
4. Centang **Enforce HTTPS**.
5. Simpan, tunggu 1–2 menit, buka URL `https://USERNAME.github.io/NAMA-REPO/`.

### B5. Uji coba

1. Buka situs, login memakai username & PIN dari sheet **User** (lihat A6).
2. Sistem akan meminta **ganti PIN wajib** pada login pertama — ikuti instruksi di layar.
3. Coba buka beberapa menu (Dashboard, Order, Karyawan, dll) — perpindahan menu harus instan tanpa reload halaman (sesuai desain Instant UX aplikasi ini).
4. Jika muncul error "Tidak dapat menghubungi server", cek kembali `js/config.js` (langkah B1) dan pastikan deployment Web App di langkah A4 memakai akses **"Anyone"**.

### B6. Update Frontend di Kemudian Hari (setelah ada perbaikan/fitur baru)

Setiap kali Anda menerima file frontend baru (ZIP baru) dari perbaikan/fitur tambahan:

1. **Ekstrak ZIP baru** ke folder sementara mana pun di komputer Anda.
2. **Salin isinya** (index.html, folder `css/`, folder `js/`, PANDUAN-INSTALASI.md) **menimpa** file-file lama di folder kerja Git lokal Anda (folder yang sama tempat Anda menjalankan `git init` pertama kali di langkah B3).
   - **Jangan timpa** `js/config.js` bila Anda sudah pernah mengisinya dengan URL backend — bandingkan dulu isinya; kalau ZIP baru mengubah `config.js`, isi ulang `GAS_URL` dengan URL Anda sebelum lanjut (lihat B1).
3. Dari folder tersebut, jalankan tiga perintah ini (folder yang sama, **jangan** `git init` ulang):
   ```bash
   git add .
   git commit -m "Update: perbaikan logo, bug fix, fitur baru"
   git push
   ```
4. Tunggu 1–2 menit, lalu buka situs GitHub Pages Anda dan tekan **Ctrl+Shift+R** (hard refresh) supaya browser tidak menampilkan versi lama dari cache.

> Jika `git push` meminta username/password lagi dan menolak password akun biasa, gunakan **Personal Access Token** seperti saat push pertama kali (lihat bagian Personal Access Token di panduan deploy GitHub Pages).

---

## Catatan Penting — Bagian PERLU KONFIRMASI

Aplikasi ini memuat 13 poin data/aturan dari data historis Excel yang **belum bisa dipastikan otomatis oleh sistem** (lihat PRD bagian 12 dan menu bantuan di aplikasi, ditandai label kuning "PERLU KONFIRMASI"). Poin-poin ini TIDAK diasumsikan oleh sistem — Owner/Admin perlu meninjau dan mengonfirmasi manual melalui menu terkait (Harga, Kasbon, Gaji, Impor, dll) sebelum data historis dianggap final.

## Dukungan Teknis

- Semua data tersimpan di Google Sheets — Anda tetap punya kendali penuh dan bisa membuka/mengekspor data kapan saja lewat Google Drive.
- Backup rutin disarankan: **File → Buat salinan** pada Spreadsheet database dari Google Sheets, dilakukan berkala (misalnya mingguan).
