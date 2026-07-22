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

// Versi ringan (tanpa menghitung descriptor 128-d yang berat) khusus dipakai
// di loop pemantauan real-time (posisi wajah + kedipan mata). Descriptor
// tetap dihitung sekali saja di deteksiSatuWajah() saat verifikasi akhir.
// inputSize 320 (sama seperti deteksi akhir) dipertahankan supaya presisi
// titik kelopak mata cukup baik untuk melacak kedipan, terutama di kondisi
// pencahayaan kurang ideal (backlight/kontra cahaya) — walau lebih berat
// dari inputSize kecil, tetap jauh lebih cepat dari versi lengkap karena
// tidak menghitung descriptor.
async function deteksiWajahRingan(video) {
  const hasil = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
    .withFaceLandmarks();
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

/* ------------------------- Liveness (anti-spoof) ------------------------- */
// Deteksi kedipan mata memakai 68 titik landmark wajah yang sudah dimuat
// untuk keperluan pengenalan wajah — jadi tidak perlu model tambahan.
// Tujuannya mencegah verifikasi lolos hanya dengan foto cetak/foto di layar
// HP yang disodorkan ke kamera, karena foto diam tidak bisa berkedip.
//
// Eye Aspect Ratio (EAR): rasio tinggi vs lebar bentuk mata dari 6 titik
// kontur mata. Nilainya turun tajam saat mata menutup, lalu naik lagi saat
// terbuka — pola inilah yang dipakai untuk mendeteksi satu siklus kedipan.
// Ambang EAR TETAP (fixed) ternyata kurang cocok untuk selfie HP: sudut
// kamera yang biasanya di bawah wajah membuat mata tampak lebih "sipit" di
// mata kamera walau sedang terbuka normal, jadi nilai EAR terbuka tiap orang
// bisa berbeda-beda. Solusinya pakai ambang ADAPTIF: sistem mempelajari
// "baseline" EAR mata terbuka orang itu secara real-time, lalu mendeteksi
// kedipan sebagai PENURUNAN RELATIF dari baseline tsb — bukan angka mutlak.
const RASIO_TUTUP = 0.86; // EAR turun ke ≤86% baseline → dianggap mulai menutup
const RASIO_BUKA = 0.93;  // EAR naik ke ≥93% baseline → dianggap sudah terbuka lagi
const EAR_MIN_VALID = 0.08; // buang pembacaan EAR yang jelas tidak wajar (noise deteksi)
const EAR_MAX_VALID = 0.6;
const JUMLAH_SAMPEL_HALUS = 3; // rata-rata bergerak N pembacaan terakhir, meredam noise per-frame

function jarakTitik(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// points: array 6 titik kontur satu mata, urutan hasil faceapi getLeftEye()/getRightEye()
function hitungEAR(points) {
  if (!points || points.length < 6) return null;
  const [p1, p2, p3, p4, p5, p6] = points;
  const vertikal = jarakTitik(p2, p6) + jarakTitik(p3, p5);
  const horizontal = jarakTitik(p1, p4);
  if (horizontal === 0) return null;
  return vertikal / (2 * horizontal);
}

// Rata-rata EAR kedua mata dari hasil faceapi.withFaceLandmarks(). Semakin
// kecil nilainya semakin tertutup matanya.
function hitungRataEAR(landmarks) {
  if (!landmarks) return null;
  const earKiri = hitungEAR(landmarks.getLeftEye());
  const earKanan = hitungEAR(landmarks.getRightEye());
  if (earKiri == null || earKanan == null) return null;
  return (earKiri + earKanan) / 2;
}

function buatPelacakKedipan() {
  let baseline = null;
  let status = "terbuka";
  let riwayat = []; // buffer kecil untuk rata-rata bergerak (smoothing)

  return function prosesFrameEAR(earMentah) {
    if (earMentah == null || earMentah < EAR_MIN_VALID || earMentah > EAR_MAX_VALID) return false;

    // Smoothing: pakai rata-rata beberapa pembacaan terakhir supaya satu
    // frame noise (mis. landmark meleset sesaat) tidak salah dibaca sebagai
    // kedipan, tanpa membuat kedipan asli (yang berlangsung beberapa frame)
    // ikut hilang.
    riwayat.push(earMentah);
    if (riwayat.length > JUMLAH_SAMPEL_HALUS) riwayat.shift();
    const ear = riwayat.reduce((a, b) => a + b, 0) / riwayat.length;

    if (baseline == null) { baseline = ear; return false; }

    if (status === "terbuka") {
      baseline = ear > baseline ? ear : baseline * 0.97 + ear * 0.03;
    }

    const ambangTutup = baseline * RASIO_TUTUP;
    const ambangBuka = baseline * RASIO_BUKA;

    if (status === "terbuka" && ear < ambangTutup) {
      status = "menutup";
      return false;
    }
    if (status === "menutup" && ear > ambangBuka) {
      status = "terbuka";
      return true; // satu siklus kedipan lengkap terdeteksi
    }
    return false;
  };
}

/* --------------------- Liveness alternatif: geser kepala --------------------- */
// Opsi cadangan kalau kedipan mata sulit terbaca (mis. pencahayaan
// backlight yang membuat kelopak mata kurang kontras). Catatan keamanan:
// ini SEDIKIT LEBIH LEMAH dari deteksi kedipan — foto cetak yang dipegang
// tangan secara teori bisa dimiringkan untuk meniru pola geser kepala,
// sedangkan foto tidak mungkin "berkedip" apa pun yang dilakukan pelaku.
// Karena itu opsi ini hanya ditawarkan sebagai jalan keluar setelah
// kedipan gagal terdeteksi beberapa saat, bukan pilihan utama.
//
// Cara kerja: melacak posisi ujung hidung relatif terhadap titik tengah
// kedua mata, dinormalisasi dengan jarak antar-mata (supaya tidak
// terpengaruh jarak wajah ke kamera). Saat kepala menoleh ke kiri/kanan,
// posisi relatif ini bergeser cukup jauh dari posisi tengah awal, lalu
// diminta kembali ke tengah — pola "menoleh lalu kembali" inilah yang
// dianggap satu gestur geser kepala.
const RASIO_AMBANG_MENOLEH = 0.20; // pergeseran ≥20% jarak antar-mata dari titik tengah awal
const RASIO_AMBANG_KEMBALI = 0.09; // harus kembali ke ≤9% dari titik tengah untuk dianggap selesai
const JUMLAH_KALIBRASI_AWAL = 5;   // jumlah frame pertama dipakai menetapkan posisi "tengah"

// Mengembalikan {offsetX, skala} — offsetX = jarak horizontal ujung hidung
// dari titik tengah kedua mata (piksel, bisa negatif/positif tergantung
// arah), skala = jarak antar-mata (piksel, dipakai untuk normalisasi.
function hitungPosisiKepala(landmarks) {
  if (!landmarks) return null;
  const mataKiri = landmarks.getLeftEye();
  const mataKanan = landmarks.getRightEye();
  const hidung = landmarks.getNose();
  if (!mataKiri?.length || !mataKanan?.length || !hidung?.length) return null;

  const rataX = (pts) => pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const rataY = (pts) => pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const tengahMataKiri = { x: rataX(mataKiri), y: rataY(mataKiri) };
  const tengahMataKanan = { x: rataX(mataKanan), y: rataY(mataKanan) };
  const titikTengahMata = { x: (tengahMataKiri.x + tengahMataKanan.x) / 2 };
  const ujungHidung = hidung[Math.min(6, hidung.length - 1)]; // titik hidung bagian bawah/ujung

  const skala = jarakTitik(tengahMataKiri, tengahMataKanan);
  if (!skala) return null;

  return { offsetX: ujungHidung.x - titikTengahMata.x, skala };
}

function buatPelacakGeserKepala() {
  let baselineRasio = null;
  let sampelKalibrasi = [];
  let status = "tengah";

  return function prosesFramePosisi(posisi) {
    if (!posisi) return false;
    const rasio = posisi.offsetX / posisi.skala;

    if (baselineRasio == null) {
      sampelKalibrasi.push(rasio);
      if (sampelKalibrasi.length >= JUMLAH_KALIBRASI_AWAL) {
        baselineRasio = sampelKalibrasi.reduce((a, b) => a + b, 0) / sampelKalibrasi.length;
      }
      return false;
    }

    const deviasi = rasio - baselineRasio;

    if (status === "tengah" && Math.abs(deviasi) > RASIO_AMBANG_MENOLEH) {
      status = "menoleh";
      return false;
    }
    if (status === "menoleh" && Math.abs(deviasi) < RASIO_AMBANG_KEMBALI) {
      status = "tengah";
      return true; // gestur menoleh lalu kembali ke tengah selesai
    }
    return false;
  };
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
