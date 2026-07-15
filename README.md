# Absensi Digital — Pemerintah Desa Baleharjo (Versi Simpel)

Versi ini **tanpa npm, tanpa build, tanpa install apapun**. Cukup file HTML/CSS/JS biasa. Tinggal edit 2 tempat, lalu upload ke GitHub → Vercel.

---

## Isi Folder

```
absensi-static/
├── index.html          ← halaman absen (untuk pegawai)
├── admin.html           ← halaman admin (kelola pegawai & pengaturan)
├── manifest.json
├── assets/
│   ├── app.js            ← SEMUA logic ada di sini (1 tempat edit penting: SCRIPT_URL)
│   ├── style.css
│   └── face-api.min.js   ← library pengenalan wajah (sudah termasuk)
├── models/                ← model AI pengenalan wajah (sudah termasuk)
├── icons/                  ← ikon aplikasi
└── apps-script/Code.gs     ← kode backend untuk Google Sheets
```

---

## LANGKAH 1 — Setup Google Sheets (database)

1. Buka [sheets.google.com](https://sheets.google.com) → buat spreadsheet baru, beri nama misalnya **"DB Absensi Baleharjo"**.
2. Klik menu **Extensions → Apps Script**.
3. Hapus semua kode default di editor yang muncul, lalu buka file **`apps-script/Code.gs`** di folder ini, copy semua isinya, paste ke editor Apps Script tadi.
4. Di dropdown pilihan fungsi (atas editor), pilih fungsi **`setup`** → klik ▶️ **Run**.
   - Google akan minta izin — klik **Review permissions** → pilih akun Google desa → **Advanced** → **Go to (nama project)** → **Allow**.
   - Sheet **Pegawai**, **Absensi**, **Config** otomatis terbentuk di spreadsheet Anda.
5. Cari fungsi **`aturPasswordAdmin`** di kode, ganti tulisan `"ubah-password-ini"` dengan kata sandi admin pilihan Anda. Jalankan sekali (▶️ Run).
6. Klik **Deploy → New deployment**:
   - Klik ikon gerigi ⚙️, pilih **Web app**
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
   - Klik **Deploy**
7. **Salin "Web app URL"** yang muncul — bentuknya seperti:
   `https://script.google.com/macros/s/AKfycb.../exec`

---

## LANGKAH 2 — Isi URL ke dalam aplikasi (SATU-SATUNYA edit wajib)

1. Buka file **`assets/app.js`** pakai Notepad (atau text editor apa saja).
2. Cari baris paling atas:
   ```js
   const SCRIPT_URL = "TEMPEL_URL_GOOGLE_APPS_SCRIPT_DI_SINI";
   ```
3. Ganti bagian dalam tanda kutip dengan URL dari Langkah 1 tadi, misalnya:
   ```js
   const SCRIPT_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   ```
4. Simpan file.

Selesai — tidak ada langkah edit lain yang wajib. (Koordinat kantor, radius, jam, dan hari kerja diatur belakangan lewat halaman admin di browser, bukan lewat kode.)

---

## LANGKAH 3 — Coba dulu di komputer (opsional tapi disarankan)

Karena browser modern memblokir akses kamera di file lokal biasa (`file://`), gunakan salah satu cara berikut:

**Cara termudah — pakai ekstensi VS Code "Live Server":**
1. Install [VS Code](https://code.visualstudio.com/) (gratis)
2. Buka folder `absensi-static` di VS Code
3. Install ekstensi **"Live Server"**
4. Klik kanan `index.html` → **Open with Live Server**

**Atau langsung saja lanjut ke Langkah 4** (deploy ke Vercel) — di sana otomatis HTTPS dan kamera akan berfungsi normal tanpa perlu uji coba lokal.

---

## LANGKAH 4 — Push ke GitHub

1. Buat repository baru di [github.com](https://github.com), misalnya nama `absensi-baleharjo`.
2. Upload semua isi folder `absensi-static` ke repo tersebut — cara termudah **tanpa command line**:
   - Buka halaman repo di GitHub → klik **"Add file" → "Upload files"**
   - Drag & drop semua file dan folder dari `absensi-static`
   - Klik **Commit changes**

   *(Kalau familiar dengan Git, bisa juga pakai `git add . && git commit -m "init" && git push` seperti biasa.)*

---

## LANGKAH 5 — Deploy ke Vercel

1. Buka [vercel.com](https://vercel.com) → login pakai akun GitHub Anda.
2. Klik **Add New → Project** → pilih repo `absensi-baleharjo`.
3. **PENTING**: Di bagian "Framework Preset", pilih **"Other"** (karena ini situs statis biasa, tidak perlu proses build apapun).
4. Klik **Deploy**. Tunggu ±30 detik.
5. Anda akan mendapat URL seperti `https://absensi-baleharjo.vercel.app` — buka di HP.

Setiap kali Anda mengedit file di GitHub (misalnya lewat "Edit" langsung di web GitHub), Vercel otomatis deploy ulang dalam hitungan detik.

---

## LANGKAH 6 — Atur Lokasi Kantor & Data Pegawai

1. Buka `https://absensi-baleharjo.vercel.app/admin.html`
2. Login pakai password dari Langkah 1.5.
3. Tab **Jadwal & Lokasi**: sambil berdiri di kantor desa, klik **"Gunakan lokasi perangkat saat ini"**, atur radius/jam/hari, klik **Simpan Pengaturan**.
4. Tab **Data Pegawai**: klik **+ Tambah Pegawai**, isi nama, klik **Ambil Foto Wajah** (arahkan kamera ke wajah pegawai, pencahayaan cukup), klik **Rekam Wajah Ini**, lalu **Simpan Pegawai**. Ulangi untuk tiap pegawai.

Selesai — aplikasi siap dipakai di `https://absensi-baleharjo.vercel.app`.

---

## Catatan

- Data wajah disimpan sebagai angka (descriptor), **bukan foto** — aman dari sisi privasi.
- Validasi jam kerja & radius kantor dicek ulang di server (Google Apps Script), jadi tidak bisa dicurangi lewat browser.
- Kalau lupa password admin, buka lagi Apps Script → jalankan ulang fungsi `aturPasswordAdmin` dengan password baru.
- Ingin ganti warna/logo? Edit `assets/style.css` (warna) dan file di folder `icons/` (logo).
