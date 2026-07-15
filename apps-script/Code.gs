/**
 * ABSENSI DIGITAL — PEMERINTAH DESA BALEHARJO
 * Backend Google Apps Script (Web App) yang membaca & menulis ke Google Sheets.
 *
 * CARA PASANG (ringkas — detail lengkap ada di README.md):
 * 1. Buat Google Spreadsheet baru, beri nama misalnya "DB Absensi Baleharjo".
 * 2. Buka menu Extensions > Apps Script.
 * 3. Hapus isi default, tempel seluruh isi file ini.
 * 4. Jalankan fungsi `setup` sekali (pilih dari dropdown fungsi, klik Run) untuk
 *    membuat sheet & header otomatis, lalu berikan izin akses yang diminta.
 * 5. Jalankan fungsi `aturPasswordAdmin` sekali untuk mengatur kata sandi admin
 *    (ubah nilai di dalam fungsi tersebut sebelum menjalankannya).
 * 6. Klik Deploy > New deployment > pilih tipe "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 7. Salin "Web app URL" yang diberikan, tempel sebagai NEXT_PUBLIC_SCRIPT_URL
 *    di file .env.local proyek Next.js.
 */

const SHEET_PEGAWAI = "Pegawai";
const SHEET_ABSENSI = "Absensi";
const SHEET_CONFIG = "Config";

const HEADER_PEGAWAI = ["id", "nama", "nip", "jabatan", "descriptor", "dibuatPada"];
const HEADER_ABSENSI = [
  "id",
  "tanggal",
  "jam",
  "pegawaiId",
  "nama",
  "jenis",
  "lat",
  "lon",
  "jarakMeter",
  "skorKecocokan",
];

/* ============================ SETUP ============================ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  buatSheetJikaBelumAda(ss, SHEET_PEGAWAI, HEADER_PEGAWAI);
  buatSheetJikaBelumAda(ss, SHEET_ABSENSI, HEADER_ABSENSI);

  const configSheet = buatSheetJikaBelumAda(ss, SHEET_CONFIG, ["key", "value"]);
  const configDefault = {
    namaKantor: "Kantor Desa Baleharjo",
    lat: -8.0326,
    lon: 112.7361,
    radiusMeter: 30,
    hariAktif: JSON.stringify([1, 2, 3, 4, 5]),
    jamBuka: "07:00",
    jamTutup: "16:00",
  };
  if (configSheet.getLastRow() <= 1) {
    Object.entries(configDefault).forEach(([k, v]) => configSheet.appendRow([k, v]));
  }
  Logger.log("Setup selesai. Jangan lupa jalankan aturPasswordAdmin().");
}

function buatSheetJikaBelumAda(ss, nama, header) {
  let sheet = ss.getSheetByName(nama);
  if (!sheet) {
    sheet = ss.insertSheet(nama);
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Jalankan fungsi ini SEKALI untuk mengatur kata sandi admin.
// Ganti "ubah-password-ini" dengan kata sandi rahasia pilihan Anda.
function aturPasswordAdmin() {
  PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", "ubah-password-ini");
  Logger.log("Kata sandi admin berhasil diatur.");
}

/* ============================ ROUTER ============================ */

function doGet() {
  return keluaranJSON({ sukses: true, pesan: "Absensi Baleharjo API aktif." });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, token } = body;

    switch (action) {
      case "login":
        return keluaranJSON(login(body.password));
      case "getConfig":
        return keluaranJSON({ sukses: true, config: ambilConfig() });
      case "updateConfig":
        wajibAdmin(token);
        return keluaranJSON(updateConfig(body.config));
      case "getPegawaiUntukAbsen":
        return keluaranJSON({ sukses: true, pegawaiList: ambilPegawaiUntukAbsen() });
      case "getPegawaiAdmin":
        wajibAdmin(token);
        return keluaranJSON({ sukses: true, pegawaiList: ambilPegawaiAdmin() });
      case "tambahPegawai":
        wajibAdmin(token);
        return keluaranJSON(tambahPegawai(body.pegawai));
      case "ubahPegawai":
        wajibAdmin(token);
        return keluaranJSON(ubahPegawai(body.pegawai));
      case "hapusPegawai":
        wajibAdmin(token);
        return keluaranJSON(hapusPegawai(body.id));
      case "catatAbsen":
        return keluaranJSON(catatAbsen(body.data));
      case "getRekapAbsen":
        wajibAdmin(token);
        return keluaranJSON({ sukses: true, rekap: ambilRekapAbsen(body.filter) });
      default:
        return keluaranJSON({ sukses: false, pesan: "Aksi tidak dikenali." });
    }
  } catch (err) {
    return keluaranJSON({ sukses: false, pesan: "Error: " + err.message });
  }
}

function keluaranJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ============================ AUTH ============================ */

function login(password) {
  const asli = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (!asli) throw new Error("Kata sandi admin belum diatur di server.");
  if (password !== asli) throw new Error("Kata sandi salah.");
  // Token sederhana: memakai password sebagai token sesi (lihat catatan keamanan di README)
  return { sukses: true, token: password };
}

function wajibAdmin(token) {
  const asli = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (!token || token !== asli) {
    throw new Error("Akses ditolak. Sesi admin tidak valid, silakan login ulang.");
  }
}

/* ============================ CONFIG ============================ */

function ambilConfig() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  const data = sheet.getDataRange().getValues().slice(1);
  const config = {};
  data.forEach(([key, value]) => {
    if (key === "hariAktif") {
      config[key] = JSON.parse(value);
    } else if (key === "lat" || key === "lon" || key === "radiusMeter") {
      config[key] = Number(value);
    } else {
      config[key] = value;
    }
  });
  return config;
}

function updateConfig(config) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  const rows = sheet.getDataRange().getValues();
  Object.entries(config).forEach(([key, value]) => {
    const simpan = key === "hariAktif" ? JSON.stringify(value) : value;
    let ditemukan = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(simpan);
        ditemukan = true;
        break;
      }
    }
    if (!ditemukan) sheet.appendRow([key, simpan]);
  });
  return { sukses: true };
}

/* ============================ PEGAWAI ============================ */

function ambilPegawaiUntukAbsen() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEGAWAI);
  const data = sheet.getDataRange().getValues().slice(1);
  return data
    .filter((r) => r[0] && r[4])
    .map((r) => ({
      id: r[0],
      nama: r[1],
      descriptor: JSON.parse(r[4]),
    }));
}

function ambilPegawaiAdmin() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEGAWAI);
  const data = sheet.getDataRange().getValues().slice(1);
  return data
    .filter((r) => r[0])
    .map((r) => ({
      id: r[0],
      nama: r[1],
      nip: r[2],
      jabatan: r[3],
      punyaWajah: !!r[4],
    }));
}

function tambahPegawai(pegawai) {
  if (!pegawai || !pegawai.nama || !pegawai.descriptor) {
    throw new Error("Nama dan data wajah wajib diisi.");
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEGAWAI);
  const id = Utilities.getUuid();
  sheet.appendRow([
    id,
    pegawai.nama,
    pegawai.nip || "",
    pegawai.jabatan || "",
    JSON.stringify(pegawai.descriptor),
    new Date().toISOString(),
  ]);
  return { sukses: true, id };
}

function ubahPegawai(pegawai) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEGAWAI);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === pegawai.id) {
      sheet.getRange(i + 1, 2).setValue(pegawai.nama);
      sheet.getRange(i + 1, 3).setValue(pegawai.nip || "");
      sheet.getRange(i + 1, 4).setValue(pegawai.jabatan || "");
      if (pegawai.descriptor) {
        sheet.getRange(i + 1, 5).setValue(JSON.stringify(pegawai.descriptor));
      }
      return { sukses: true };
    }
  }
  throw new Error("Pegawai tidak ditemukan.");
}

function hapusPegawai(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEGAWAI);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { sukses: true };
    }
  }
  throw new Error("Pegawai tidak ditemukan.");
}

/* ============================ ABSENSI ============================ */

function catatAbsen(data) {
  if (!data || !data.pegawaiId || !data.jenis) {
    throw new Error("Data absen tidak lengkap.");
  }

  // Validasi ulang di sisi server: jadwal & radius kantor, agar tidak bisa
  // dilewati hanya dengan memodifikasi kode di sisi klien (browser).
  const config = ambilConfig();
  const statusJadwalSaatIni = cekJadwalServer(config);
  if (!statusJadwalSaatIni.buka) {
    throw new Error(statusJadwalSaatIni.pesan);
  }

  const jarak = hitungJarakMeter(data.lat, data.lon, config.lat, config.lon);
  if (jarak > (config.radiusMeter || 30)) {
    throw new Error(
      "Lokasi di luar radius kantor (" + Math.round(jarak) + " m). Absen ditolak."
    );
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ABSENSI);
  const sekarang = waktuJakarta();
  sheet.appendRow([
    Utilities.getUuid(),
    sekarang.tanggal,
    sekarang.jam,
    data.pegawaiId,
    data.nama,
    data.jenis,
    data.lat,
    data.lon,
    Math.round(jarak),
    data.skorKecocokan || "",
  ]);

  return { sukses: true };
}

function ambilRekapAbsen(filter) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ABSENSI);
  const data = sheet.getDataRange().getValues().slice(1);
  return data
    .filter((r) => r[0])
    .map((r) => ({
      id: r[0],
      tanggal: r[1],
      jam: r[2],
      pegawaiId: r[3],
      nama: r[4],
      jenis: r[5],
      lat: r[6],
      lon: r[7],
      jarakMeter: r[8],
      skorKecocokan: r[9],
    }))
    .reverse()
    .slice(0, 200);
}

/* ============================ UTIL ============================ */

function hitungJarakMeter(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function waktuJakarta() {
  const tz = "Asia/Jakarta";
  const now = new Date();
  return {
    tanggal: Utilities.formatDate(now, tz, "yyyy-MM-dd"),
    jam: Utilities.formatDate(now, tz, "HH:mm:ss"),
    hariIndex: Number(Utilities.formatDate(now, tz, "u")) % 7, // 1=Senin..7=Minggu -> %7 => 1..6,0
  };
}

function cekJadwalServer(config) {
  const tz = "Asia/Jakarta";
  const now = new Date();
  const namaHariEN = Utilities.formatDate(now, tz, "EEE");
  const petaHari = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hariIndex = petaHari[namaHariEN];

  const jamStr = Utilities.formatDate(now, tz, "HH:mm");
  const [jamB, menB] = (config.jamBuka || "07:00").split(":").map(Number);
  const [jamT, menT] = (config.jamTutup || "16:00").split(":").map(Number);
  const [jamS, menS] = jamStr.split(":").map(Number);

  const menitSekarang = jamS * 60 + menS;
  const menitBuka = jamB * 60 + menB;
  const menitTutup = jamT * 60 + menT;

  const hariAktif = config.hariAktif || [1, 2, 3, 4, 5];
  const hariOk = hariAktif.includes(hariIndex);
  const jamOk = menitSekarang >= menitBuka && menitSekarang <= menitTutup;

  return {
    buka: hariOk && jamOk,
    pesan: !hariOk
      ? "Hari ini bukan hari kerja."
      : !jamOk
      ? "Di luar jam layanan absensi."
      : "",
  };
}
