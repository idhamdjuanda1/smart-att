import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const serviceAccount = require("../smart-att-90ef9-firebase-adminsdk-fbsvc-eb1cf48f9f.json");

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const articles = [
  {
    id: "absensi-qr-kartu-pelajar-smart-att",
    slug: "absensi-qr-kartu-pelajar-smart-att",
    title: "Revolusi Absensi Sekolah Digital SMART-ATT: Scan QR Kartu Pelajar, Rekap Otomatis & Verifikasi WhatsApp Instant",
    excerpt: "Tinggalkan cara manual yang menyita waktu. SMART-ATT menghadirkan sistem absensi QR Code kartu pelajar tercepat, rekap kehadiran harian/mingguan/bulanan otomatis, serta fitur verifikasi izin/sakit langsung ke WhatsApp wali murid dalam 1-klik!",
    tags: ["Absensi QR Code", "SMART-ATT", "Kartu Pelajar", "Absen Sekolah", "Konfirmasi WhatsApp", "Sekolah Digital"],
    coverUrl: "/images/qr_absensi_banner.jpg",
    published: true,
    publishedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    body: `Efisiensi waktu dan transparansi informasi kehadiran siswa merupakan fondasi utama tata kelola sekolah digital modern. Memahami beban administrasi guru yang tinggi, platform **SMART-ATT (smart-att.web.id)** menghadirkan solusi **Absensi QR Code Kartu Pelajar Terpadu** yang dirancang khusus untuk sekolah SD, SMP, SMA/SMK di seluruh Indonesia.

Dengan sistem ini, proses absensi harian yang biasanya memakan waktu puluhan menit kini diselesaikan hanya dalam beberapa hitungan detik.

---

### 1. Kecepatan Absensi: Cukup Tap / Scan Kartu Pelajar

Tidak ada lagi pemanggilan nama siswa satu per satu di awal jam pelajaran. Di **SMART-ATT**, setiap siswa memiliki **Kartu Pelajar Digital / Cetak dengan QR Code Unik**.

* **Scan Kilat Sub-Detik**: Siswa cukup menunjukkan QR Code di depan kamera HP/tablet atau pemindai barcode meja. Sistem langsung mencatat waktu hadir secara presisi.
* **Respon Suara Otomatis**: Petugas dan siswa mendengar respon suara (*audio feedback*) instan ("Hadir Tepat Waktu" atau "Terlambat") sehingga proses masuk gerbang atau kelas berjalan tertib tanpa antrean panjang.
* **Dukungan Multi-Device & Kamera iPhone/Android**: Scanner SMART-ATT berjalan mulus di laptop, HP Android, hingga browser Safari iOS tanpa perlu instalasi aplikasi tambahan yang rumit.

---

### 2. Rekap Otomatis: Harian, Mingguan, dan Bulanan

Salah satu keunggulan terbesar **SMART-ATT** adalah pengolahan data kehadiran secara *real-time*. Begitu QR Code terscan, data langsung terakumulasi ke dalam dashboard sekolah.

* **Rekap Harian**: Menampilkan grafik kehadiran hari ini secara visual. Guru piket, wali kelas, dan Kepala Sekolah dapat melihat secara detil siswa yang Hadir, Terlambat, Izin, Sakit, atau Alpa.
* **Rekap Mingguan & Bulanan**: Sistem menghitung persentase kehadiran per siswa, per kelas, hingga tingkat sekolah tanpa perlu rekap manual menggunakan tabel kertas.
* **Cetak Laporan & Export Data**: Rekapitulasi dapat diunduh kapan saja dalam format PDF resmi atau file Excel untuk kebutuhan laporan bulanan Dinas Pendidikan maupun rapat evaluasi sekolah.

---

### 3. Verifikasi Izin & Sakit Langsung via WhatsApp Wali Murid (1-Klik)

Bagaimana jika ada siswa yang belum hadir atau tidak masuk tanpa keterangan? Di sinilah fitur unggulan **Verifikasi WhatsApp SMART-ATT** bekerja!

1. **Tombol WhatsApp Instan di Dashboard**: Di samping nama siswa yang belum tercatat hadir (Alpa), sistem menyediakan tombol **Konfirmasi WhatsApp**.
2. **Pesan Otomatis & Terformat**: Saat tombol diklik, sistem langsung membuka aplikasi WhatsApp dengan draf pesan sopan dan profesional yang ditujukan kepada nomor HP wali murid.
3. **Tautan Konfirmasi Mandiri**: Pesan tersebut dilengkapi tautan konfirmasi khusus. Wali murid cukup mengklik tautan tersebut untuk mengunggah surat izin/sakit atau konfirmasi kehadiran langsung dari HP mereka tanpa harus datang ke sekolah.
4. **Verifikasi Guru 1-Klik**: Wali kelas atau admin sekolah dapat menyetujui izin/sakit tersebut secara langsung di dashboard, sehingga status absensi siswa otomatis berubah secara sah.

---

### Mengapa Sekolah Harus Beralih ke SMART-ATT?

* **Menghemat Waktu Belajar**: Guru dapat langsung fokus pada materi pembelajaran tanpa membuang 15–20 menit untuk absensi manual.
* **Menjalin Kemitraan dengan Wali Murid**: Orang tua merasa tenang karena sekolah bersikap proaktif memberikan perhatian cepat jika anak tidak hadir.
* **Terintegrasi Terpadu**: Satu akun **smart-att.web.id** sudah mencakup Absensi QR, Kuis Live Interaktif, Modul Tabungan Siswa, Penilaian Digital, dan Generator Jadwal Pelajaran.

Tingkatkan kedisiplinan dan modernisasi sekolah Anda hari ini bersama **SMART-ATT** di [smart-att.web.id](https://smart-att.web.id)!`
  },
  {
    id: "kuis-interaktif-kahoot-smart-att",
    slug: "kuis-interaktif-kahoot-smart-att",
    title: "Kuis Interaktif Ala Kahoot di SMART-ATT: Solusi Ulangan Harian Seru & Bebas Ribet untuk Sekolah",
    excerpt: "SMART-ATT kini menghadirkan fitur Kuis Live Interaktif mirip Kahoot yang terintegrasi dengan generator soal AI dan data sekolah. Guru bisa menguji kelas secara seru, cepat, dan transparan via HP!",
    tags: ["Kuis Interaktif", "SMART-ATT", "Ulangan Online", "Game Edukasi", "Sekolah Digital"],
    coverUrl: "/images/kahoot_quiz_banner.jpg",
    published: true,
    publishedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    body: `Dunia pendidikan di era digital menuntut inovasi pembelajaran yang menyenangkan sekaligus efisien. Memahami kebutuhan guru dan sekolah di Indonesia, ekosistem **SMART-ATT (smart-att.web.id)** resmi meluncurkan fitur terbaru: **Kuis Live Interaktif Ala Kahoot**.

Fitur ini dirancang khusus untuk mengubah suasana ulangan harian, kuis singkat, maupun evaluasi pembelajaran menjadi pengalaman bermain kuis kelompok yang interaktif, kompetitif, dan transparan.

---

### Mengapa Kuis Interaktif SMART-ATT Diperlukan di Kelas?

Selama ini, pelaksanaan ulangan harian kerap terbentur kendala teknis: jaringan internet lambat, siswa harus mengingat username dan kata sandi rumit, atau suasana kelas yang tegang.

Dengan fitur **Kuis Live SMART-ATT**, semua hambatan tersebut teratasi:

1. **Akses Super Praktis (Tanpa Login / Tanpa Lupa Password)**
   Siswa cukup membuka **smart-att.web.id/link** di browser smartphone mereka, memasukkan **4 Digit Kode Room**, lalu memasukkan nama mereka. Tanpa perlu registrasi akun atau memasukkan NIS!

2. **Soal & Pilihan Tampil Langsung di HP Siswa**
   Berbeda dengan kuis layar tunggal tradisional yang mewajibkan proyektor, di SMART-ATT teks soal dan 4 tombol jawaban interaktif (🔴 A, 🔷 B, 🟡 C, 🟢 D) muncul secara jelas dan cepat di masing-masing layar HP siswa.

3. **Sistem Poin Kecepatan (Speed Bonus)**
   Jawaban yang benar dan lebih cepat akan mendapatkan skor hingga 1.000 poin. Sistem ini mendorong fokus, ketepatan, dan antusiasme siswa sepanjang kuis berlangsung.

4. **Generator Soal AI Otomatis**
   Guru tidak perlu repot mengetik soal dari awal. Modul Generator Soal AI SMART-ATT dapat membuat puluhan soal pilihan ganda berkualitas sesuai tingkatan kelas dan materi pelajaran hanya dalam beberapa detik.

5. **Podium Juara Real-Time (Juara 1 👑, 2 🥈, 3 🥉)**
   Di akhir kuis, papan peringkat otomatis menampilkan selebrasi podium juara untuk 3 peserta dengan skor akumulasi tertinggi, menciptakan momentum apresiasi positif di dalam kelas.

---

### Panduan 3 Langkah Memulai Kuis Live di SMART-ATT

1. **Buat & Pilih Soal**: Buka dashboard guru di SMART-ATT, pilih draf soal dari Bank Soal AI, lalu klik tombol **⚡ Main Kuis Live (Kahoot)**.
2. **Bagikan Kode 4-Digit**: Tampilkan kode room 4 angka (contoh: 8492) di papan tulis atau proyektor. Siswa bergabung melalui **smart-att.web.id/link**.
3. **Mulai & Rayakan**: Tekan **Mulai Kuis Live** ketika peserta berkumpul, jalankan soal per 15 detik, dan umumkan pemenang di akhir kuis!

---

### Bagian dari Ekosistem Sekolah Digital SMART-ATT

Platform **SMART-ATT** bukan sekadar aplikasi absensi siswa, melainkan solusi manajemen sekolah terpadu yang mencakup:
- Absensi QR Code Kartu Pelajar & GPS Location
- Modul Tabungan Siswa Digital
- Generator Jadwal Pelajaran Bebas Bentrok
- Ulangan Harian Formal dengan Proteksi Anti-Curang
- Kuis Live Interaktif Intermezo Pembelajaran

Buka **smart-att.web.id** hari ini dan rasakan kemudahan mengelola sekolah modern serta menghidupkan suasana kelas dengan Kuis Live Interaktif SMART-ATT!`
  }
];

async function seed() {
  for (const art of articles) {
    await db.collection("articles").doc(art.slug).set(art, { merge: true });
    console.log(`Seeded article to Firestore: ${art.slug}`);
  }
}

seed().then(() => process.exit(0)).catch(console.error);
