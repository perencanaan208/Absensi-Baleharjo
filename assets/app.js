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
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token, ...payload }),
  });
  if (!res.ok) throw new Error("Server merespons dengan status " + res.status);
  const data = await res.json();
  if (data.sukses === false) throw new Error(data.pesan || "Terjadi kesalahan pada server.");
  return data;
}

const api = {
  getConfig: () => panggilAPI("getConfig"),
  updateConfig: (config, token) => panggilAPI("updateConfig", { config }, token),
  getPegawaiUntukAbsen: () => panggilAPI("getPegawaiUntukAbsen"),
  getPegawaiAdmin: (token) => panggilAPI("getPegawaiAdmin", {}, token),
  tambahPegawai: (pegawai, token) => panggilAPI("tambahPegawai", { pegawai }, token),
  ubahPegawai: (pegawai, token) => panggilAPI("ubahPegawai", { pegawai }, token),
  hapusPegawai: (id, token) => panggilAPI("hapusPegawai", { id }, token),
  catatAbsen: (data) => panggilAPI("catatAbsen", { data }),
  getRekapAbsen: (token, filter) => panggilAPI("getRekapAbsen", { filter }, token),
  login: (password) => panggilAPI("login", { password }),
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

/* -------------------------------- Jadwal -------------------------------- */

const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function waktuJakartaSaatIni() {
  const now = new Date();
  const bagian = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    hour12: false,
    weekday: "short",
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
    jam: parseInt(ambil("hour"), 10),
    menit: parseInt(ambil("minute"), 10),
    jamMenitTeks: `${ambil("hour")}:${ambil("minute")}:${ambil("second")}`,
  };
}

function cariKelompokJadwal(config, hariIndex) {
  const jadwal = config?.jadwal ?? [];
  return jadwal.find((k) => (k.hari || []).includes(hariIndex)) || null;
}

function ringkasanJadwal(config) {
  const jadwal = config?.jadwal ?? [];
  return jadwal.map((k) => {
    const label = k.label || k.hari.map((h) => NAMA_HARI[h]).join(", ");
    return `${label}: ${k.jamBuka}–${k.jamTutup} WIB`;
  });
}

function statusJadwal(config) {
  const waktu = waktuJakartaSaatIni();
  const kelompok = cariKelompokJadwal(config, waktu.hariIndex);

  if (!kelompok) {
    return {
      buka: false,
      waktu,
      kelompok: null,
      pesan: `Hari ${waktu.namaHari} bukan hari kerja. Absensi ditutup.`,
    };
  }

  const [jamBukaJ, jamBukaM] = (kelompok.jamBuka ?? "07:00").split(":").map(Number);
  const [jamTutupJ, jamTutupM] = (kelompok.jamTutup ?? "16:00").split(":").map(Number);
  const menitSekarang = waktu.jam * 60 + waktu.menit;
  const menitBuka = jamBukaJ * 60 + jamBukaM;
  const menitTutup = jamTutupJ * 60 + jamTutupM;
  const dalamJamKerja = menitSekarang >= menitBuka && menitSekarang <= menitTutup;
  return {
    buka: dalamJamKerja,
    waktu,
    kelompok,
    pesan: dalamJamKerja
      ? "Absensi sedang dibuka."
      : `Absensi hari ${waktu.namaHari} (${kelompok.label || "hari ini"}) dibuka pukul ${kelompok.jamBuka}–${kelompok.jamTutup} WIB.`,
  };
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
