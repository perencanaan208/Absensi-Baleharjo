/* =========================================================================
   ABSENSI DIGITAL DESA BALEHARJO — app.js
   Semua logic aplikasi ada di sini. Tidak perlu build tool apapun.
   ========================================================================= */

// URL Web App Google Apps Script sudah tertanam di sini — tidak perlu diedit lagi
// kecuali Anda membuat deployment Apps Script yang benar-benar baru.
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyK1o7ISJO9AtB-Mou5B6IB3psGZ7CGnuTJofB_rdeHYB83wQIVjnBbFUoDvYcbYvRV7Q/exec";

const KUNCI_TOKEN = "absensi_baleharjo_admin_token";
const AMBANG_KECOCOKAN = 0.5; // ambang jarak descriptor wajah (semakin kecil semakin ketat)

/* ------------------------- Komunikasi ke Apps Script ------------------------- */

async function panggilAPI(action, payload = {}, token) {
  if (!SCRIPT_URL || SCRIPT_URL.includes("TEMPEL_URL")) {
    throw new Error(
      "SCRIPT_URL belum diisi. Buka assets/app.js, ganti baris SCRIPT_URL dengan URL Google Apps Script Anda."
    );
  }

  // Batas waktu tunggu supaya UI tidak macet selamanya kalau server lambat
  // merespons (mis. Google Apps Script sedang lambat/cold start).
  const kontrolBatalkan = new AbortController();
  const batasWaktu = setTimeout(() => kontrolBatalkan.abort(), 25000);

  let res;
  try {
    res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token, ...payload }),
      signal: kontrolBatalkan.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Waktu permintaan habis (server tidak merespons dalam 25 detik). Periksa koneksi internet Anda, lalu coba lagi.");
    }
    throw new Error("Tidak bisa terhubung ke server: " + err.message);
  } finally {
    clearTimeout(batasWaktu);
  }

  if (!res.ok) throw new Error("Server merespons dengan status " + res.status);
  const data = await res.json();
  if (data.sukses === false) throw new Error(data.pesan || "Terjadi kesalahan pada server.");
  return data;
}

const api = {
  getConfig: () => panggilAPI("getConfig"),
  updateConfig: (config, token) => panggilAPI("updateConfig", { config }, token),
  getLibur: (tahun) => panggilAPI("getLibur", { tahun }),
  tambahLibur: (data, token) => panggilAPI("tambahLibur", { data }, token),
  tambahLiburBanyak: (dataList, token) => panggilAPI("tambahLiburBanyak", { dataList }, token),
  hapusLibur: (id, token) => panggilAPI("hapusLibur", { id }, token),
  getPegawaiUntukAbsen: () => panggilAPI("getPegawaiUntukAbsen"),
  getPegawaiAdmin: (token) => panggilAPI("getPegawaiAdmin", {}, token),
  tambahPegawai: (pegawai, token) => panggilAPI("tambahPegawai", { pegawai }, token),
  ubahPegawai: (pegawai, token) => panggilAPI("ubahPegawai", { pegawai }, token),
  hapusPegawai: (id, token) => panggilAPI("hapusPegawai", { id }, token),
  catatAbsen: (data) => panggilAPI("catatAbsen", { data }),
  getStatusHariIni: (pegawaiId) => panggilAPI("getStatusHariIni", { pegawaiId }),
  getRingkasanHariIni: () => panggilAPI("getRingkasanHariIni"),
  getRekapAbsen: (token, filter) => panggilAPI("getRekapAbsen", { filter }, token),
  hapusAbsen: (id, token) => panggilAPI("hapusAbsen", { id }, token),
  hapusAbsenBanyak: (idList, token) => panggilAPI("hapusAbsenBanyak", { idList }, token),
  login: (password) => panggilAPI("login", { password }),
  gantiPasswordAdmin: (passwordLama, passwordBaru, token) => panggilAPI("gantiPasswordAdmin", { passwordLama, passwordBaru }, token),
};

/* ------------------------------- Geolokasi ------------------------------- */

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

function ambilLokasiSaatIni() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Perangkat ini tidak mendukung layanan lokasi."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, akurasi: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

// Perkiraan kotak wilayah Indonesia — dipakai untuk memperingatkan admin
// kalau koordinat kantor yang disimpan tampak salah (mis. masih 0,0 atau
// tertukar lat/lon), bukan untuk membatasi absen secara ketat.
function koordinatDalamIndonesia(lat, lon) {
  return lat >= -11.5 && lat <= 6.5 && lon >= 94 && lon <= 141.5;
}

/* -------------------------------- Jadwal -------------------------------- */

const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function waktuJakartaSaatIni() {
  const now = new Date();
  const bagian = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const ambil = (t) => bagian.find((b) => b.type === t)?.value;
  const peta = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hariIndex = peta[ambil("weekday")];
  return {
    hariIndex,
    namaHari: NAMA_HARI[hariIndex],
    tahun: parseInt(ambil("year"), 10),
    bulan: parseInt(ambil("month"), 10),
    tanggal: parseInt(ambil("day"), 10),
    jam: parseInt(ambil("hour"), 10),
    menit: parseInt(ambil("minute"), 10),
    jamMenitTeks: `${ambil("hour")}:${ambil("minute")}:${ambil("second")}`,
  };
}

function cariKelompokJadwal(config, hariIndex) {
  const jadwal = config?.jadwal ?? [];
  return jadwal.find((k) => k.aktif !== false && (k.hari || []).includes(hariIndex)) || null;
}

function ringkasanJadwal(config) {
  const jadwal = (config?.jadwal ?? []).filter((k) => k.aktif !== false);
  return jadwal.map((k) => {
    const label = k.label || k.hari.map((h) => NAMA_HARI[h]).join(", ");
    return `${label}: ${k.jamBuka}–${k.jamTutup} WIB`;
  });
}

function formatMenit(totalMenit) {
  const m = Math.max(0, Math.min(1439, Math.round(totalMenit)));
  const j = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(j).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function tanggalISOJakartaSaatIni() {
  const w = waktuJakartaSaatIni();
  return `${w.tahun}-${String(w.bulan).padStart(2, "0")}-${String(w.tanggal).padStart(2, "0")}`;
}

function cariLiburHariIni(liburList) {
  const tanggalHariIni = tanggalISOJakartaSaatIni();
  return (liburList || []).find((l) => l.tanggal === tanggalHariIni) || null;
}

// Jendela sistem absen sengaja dibuka lebih lebar dari jam operasional resmi
// (default 60 menit sebelum & sesudah), supaya pegawai tetap bisa absen kalau
// datang sedikit lebih awal/pulang sedikit lebih lambat. Status "mendahului"
// atau "terlambat" tetap dihitung terhadap jam operasional resmi (lihat
// hitungKeteranganWaktu), bukan terhadap jendela sistem ini.
//
// Parameter liburHariIni (opsional): objek {keterangan, jenis} kalau hari ini
// terdaftar sebagai libur nasional/cuti bersama — kalau ada, absen otomatis
// dianggap tutup apapun jadwal & toleransi jamnya.
function statusJadwal(config, liburHariIni) {
  const waktu = waktuJakartaSaatIni();

  if (liburHariIni) {
    const labelJenis = liburHariIni.jenis === "cuti_bersama" ? "Cuti Bersama" : "Libur Nasional";
    return {
      buka: false,
      waktu,
      kelompok: null,
      libur: true,
      pesan: `Hari ini ${labelJenis}: ${liburHariIni.keterangan}. Absensi ditutup.`,
    };
  }

  const kelompok = cariKelompokJadwal(config, waktu.hariIndex);

  if (!kelompok) {
    return {
      buka: false,
      waktu,
      kelompok: null,
      pesan: `Hari ${waktu.namaHari} bukan hari kerja. Absensi ditutup.`,
    };
  }

  const toleransi = config?.toleransiMenit ?? 60;
  const [jamBukaJ, jamBukaM] = (kelompok.jamBuka ?? "07:00").split(":").map(Number);
  const [jamTutupJ, jamTutupM] = (kelompok.jamTutup ?? "16:00").split(":").map(Number);
  const menitSekarang = waktu.jam * 60 + waktu.menit;
  const menitBukaResmi = jamBukaJ * 60 + jamBukaM;
  const menitTutupResmi = jamTutupJ * 60 + jamTutupM;
  const menitBukaSistem = menitBukaResmi - toleransi;
  const menitTutupSistem = menitTutupResmi + toleransi;
  const dalamJendela = menitSekarang >= menitBukaSistem && menitSekarang <= menitTutupSistem;

  return {
    buka: dalamJendela,
    waktu,
    kelompok,
    toleransi,
    pesan: dalamJendela
      ? "Absensi sedang dibuka."
      : `Absensi hari ${waktu.namaHari} (${kelompok.label || "hari ini"}) dibuka pukul ${formatMenit(menitBukaSistem)}–${formatMenit(menitTutupSistem)} WIB.`,
  };
}

// Menghitung apakah absen masuk/pulang dilakukan mendahului atau terlambat
// dari jam operasional RESMI (bukan jendela toleransi sistem).
function hitungKeteranganWaktu(kelompok, jenis, waktu) {
  if (!kelompok || (jenis !== "masuk" && jenis !== "pulang")) return null;

  const [jamBukaJ, jamBukaM] = (kelompok.jamBuka ?? "07:00").split(":").map(Number);
  const [jamTutupJ, jamTutupM] = (kelompok.jamTutup ?? "16:00").split(":").map(Number);
  const menitSekarang = waktu.jam * 60 + waktu.menit;
  const menitBuka = jamBukaJ * 60 + jamBukaM;
  const menitTutup = jamTutupJ * 60 + jamTutupM;

  if (jenis === "masuk") {
    if (menitSekarang < menitBuka) {
      const selisih = menitBuka - menitSekarang;
      return { tipe: "mendahului", menit: selisih, teks: `Datang ${selisih} menit lebih awal dari jam masuk (${kelompok.jamBuka}).` };
    }
    if (menitSekarang > menitBuka) {
      const selisih = menitSekarang - menitBuka;
      return { tipe: "terlambat", menit: selisih, teks: `Terlambat ${selisih} menit dari jam masuk (${kelompok.jamBuka}).` };
    }
    return { tipe: "tepat", menit: 0, teks: "Tepat waktu." };
  }

  // jenis === "pulang"
  if (menitSekarang < menitTutup) {
    const selisih = menitTutup - menitSekarang;
    return { tipe: "mendahului", menit: selisih, teks: `Pulang ${selisih} menit lebih awal dari jam pulang (${kelompok.jamTutup}).` };
  }
  if (menitSekarang > menitTutup) {
    const selisih = menitSekarang - menitTutup;
    return { tipe: "lewat", menit: selisih, teks: `Pulang ${selisih} menit setelah jam pulang usai (${kelompok.jamTutup}).` };
  }
  return { tipe: "tepat", menit: 0, teks: "Tepat waktu." };
}

/* -------------------------------- Wajah -------------------------------- */

let modelSiapPromise = null;

function muatModelWajah() {
  if (!modelSiapPromise) {
    modelSiapPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
    ]);
  }
  return modelSiapPromise;
}

async function deteksiSatuWajah(video) {
  const hasil = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return hasil || null;
}

function cocokkanWajah(descriptorBaru, daftarPegawai) {
  let terbaik = null;
  let jarakTerkecil = Infinity;
  for (const pegawai of daftarPegawai) {
    if (!pegawai.descriptor || pegawai.descriptor.length === 0) continue;
    const jarak = faceapi.euclideanDistance(descriptorBaru, new Float32Array(pegawai.descriptor));
    if (jarak < jarakTerkecil) {
      jarakTerkecil = jarak;
      terbaik = pegawai;
    }
  }
  if (terbaik && jarakTerkecil <= AMBANG_KECOCOKAN) {
    return { pegawai: terbaik, jarak: jarakTerkecil };
  }
  return null;
}

/* ----------------------------- Kamera helper ----------------------------- */

async function nyalakanKamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  return stream;
}

function matikanKamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}
