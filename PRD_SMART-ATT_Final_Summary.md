# SMART-ATT - Ringkasan PRD Final

## Ringkasan Produk
SMART-ATT adalah webapp sekolah untuk absensi QR, manajemen siswa, komunikasi wali murid, tugas sekolah, dan ujian online. Aplikasi berjalan di browser, dapat dibuka lewat HP maupun desktop, dan menggunakan Firebase sebagai backend utama untuk autentikasi serta penyimpanan data.

## Tujuan
- Memudahkan guru mencatat absensi harian dengan QR.
- Memudahkan sekolah mengelola data siswa, kelas, wali murid, dan tahun ajaran.
- Menyediakan quiz/ulangan online tanpa login siswa, cukup memakai NIS.
- Mengurangi kecurangan ujian dengan randomisasi soal, randomisasi jawaban, monitoring, dan log aktivitas.
- Memudahkan guru membuat soal manual atau dengan bantuan prompt AI.
- Membuat data dapat diakses lintas perangkat tanpa bergantung pada penyimpanan lokal browser.

## Role Pengguna
### Super Admin
- Login dengan akun khusus.
- Membuat token aktivasi.
- Melihat daftar akun guru/pendaftar.
- Melihat status akun aktif/tidak aktif dan masa berlaku.
- Mengelola aktivasi akun sekolah/guru.

### Guru
- Mengatur profil guru.
- Mengelola tahun ajaran dan semester.
- Mengelola sekolah dan kelas.
- Mengelola siswa, termasuk NIS, nama siswa, foto, wali murid, dan nomor WhatsApp.
- Import siswa dari CSV.
- Cetak kartu QR siswa ukuran kartu nama di kertas A4.
- Scan absensi harian menggunakan kamera.
- Melihat rekap absensi harian, mingguan, 6 bulanan, dan tahunan.
- Membuat tugas PR dengan link publish.
- Membuat soal dan ulangan.
- Generate prompt AI untuk pembuatan soal.
- Monitoring ujian dan log aktivitas siswa.
- Menutup ulangan lebih awal ketika seluruh siswa yang hadir sudah selesai.

### Siswa
- Mengikuti quiz/ulangan melalui link publish.
- Tidak perlu login.
- Masuk menggunakan NIS.
- Melihat hasil nilai, jawaban, dan pembahasan setelah ujian selesai atau waktu habis.

### Wali Murid
- Mengisi data wali/orang tua melalui link publish.
- Mengisi alasan ketidakhadiran siswa melalui link konfirmasi.
- Alasan tersedia seperti sakit atau izin, dengan kolom keterangan.

## Modul Utama
### 1. Authentication
- Login guru dan superadmin menggunakan Firebase Authentication email/password.
- Pendaftaran guru menggunakan trial 14 hari atau token aktivasi.
- Reset password menggunakan Firebase Auth.
- Data akun tersimpan di Firestore.

### 2. Super Admin
- Generate token aktivasi.
- Durasi token: 1 hari, 14 hari, dan 1 bulan.
- Melihat daftar akun guru beserta email, nama sekolah, status aktif, dan sisa masa aktif.

### 3. Data Akademik
- Tahun ajaran.
- Semester ganjil/genap.
- Sekolah.
- Kelas.
- Siswa.
- Data wali murid.

### 4. Siswa dan QR
- Tambah siswa manual.
- Import siswa via CSV.
- Edit dan hapus siswa.
- Upload foto siswa.
- Foto siswa disimpan ke Cloudflare R2.
- QR unik otomatis dibuat berdasarkan data siswa.
- Cetak kartu QR berisi nama, NIS, sekolah, dan barcode.
- Layout cetak A4 dibuat rapi dengan garis titik-titik untuk digunting manual.

### 5. Absensi QR
- Guru menentukan jam masuk.
- Guru membuka scan absen harian.
- Kamera terbuka otomatis untuk scan QR.
- Jika scan sebelum atau sesuai jam masuk: hadir.
- Jika scan setelah jam masuk: terlambat.
- Popup scan menampilkan foto siswa, sekolah, kelas, nama siswa, dan NIS.
- Rekap absen menampilkan hadir, terlambat, sakit, izin, dan tanpa keterangan.

### 6. Konfirmasi Wali Murid
- Link wali murid bersifat umum per kelas.
- Wali memasukkan NIS.
- Sistem menampilkan data siswa terkait.
- Wali mengisi nama orang tua/wali dan nomor WhatsApp.
- Untuk siswa belum hadir, guru dapat mengirim WhatsApp berisi link konfirmasi sakit/izin.
- Jika tidak ada konfirmasi, siswa dapat dianggap tanpa keterangan.

### 7. Tugas PR
- Guru membuat tugas PR.
- Field utama: mata pelajaran, judul, deskripsi/tugas, deadline.
- Tugas dapat dipublish lewat link.
- Link dapat dibuka tanpa login.

### 8. Soal dan Ulangan
- Guru membuat soal pilihan ganda.
- Jumlah soal bebas.
- Pilihan jawaban minimal 3 dan maksimal 5.
- Ulangan memiliki judul, kelas, durasi, tanggal mulai, dan jam mulai.
- Link publish berisi countdown sebelum ujian dimulai.
- Siswa memasukkan NIS untuk mengerjakan.
- Ujian otomatis tertutup setelah durasi selesai.
- Guru dapat menekan **Matikan ulangan** untuk mengakhiri ujian lebih awal.
- Jawaban terakhir peserta yang masih aktif langsung dinilai, sedangkan siswa yang tidak pernah ikut tidak dihitung sebagai peserta.
- Setelah dimatikan guru, hasil, ranking, jawaban, dan pembahasan langsung dapat dilihat oleh siswa yang mengikuti ujian.
- Siswa yang sudah selesai hanya dapat melihat hasil, jawaban, dan pembahasan.
- Setiap publikasi ulangan memiliki kode akses alfanumerik unik sepanjang 10 karakter.
- Siswa dapat mengetik kode melalui `smart-att.web.id/link`, `/quiz`, atau `/soal`; link langsung pendek memakai format `smart-att.web.id/link/{kode}`.
- Kode dipesan secara transaksional di Firestore sehingga tidak dapat dipakai oleh dua ulangan atau dua pengguna yang berbeda.
- ID snapshot dan link publik lama tetap dapat digunakan untuk menjaga kompatibilitas data existing.

### 9. Keamanan Ujian
- Random urutan soal per siswa.
- Random urutan jawaban per siswa.
- Seed random konsisten agar refresh tidak mengubah urutan.
- Proteksi double login/perangkat.
- Permintaan lanjut ujian setelah keluar/HP mati memerlukan persetujuan guru.
- Wajib fullscreen.
- Deteksi keluar fullscreen.
- Deteksi pindah tab/minimize.
- Auto-save jawaban.
- Timer berbasis waktu server.
- Log aktivitas ujian mencatat login, mulai, selesai, refresh, pindah tab, keluar fullscreen, perangkat, dan status.

### 10. AI Prompt Generator
- Guru memilih mata pelajaran, kelas, bab, jumlah soal, dan jumlah pilihan ganda.
- Sistem membuat prompt siap copy untuk ChatGPT/Gemini.
- Output AI diarahkan dalam format JSON agar dapat diupload kembali ke SMART-ATT.
- Sistem membaca JSON soal, pilihan jawaban, kunci, dan pembahasan.

### 11. Rekap dan Nilai
- Rekap absensi harian, mingguan, 6 bulanan, dan tahunan.
- Riwayat ujian.
- Rata-rata hasil quiz/ulangan.
- Pengaturan bobot nilai per semester.
- Nilai manual.
- Rekap nilai siswa.

## Backend dan Storage
### Firebase
- Firebase Authentication untuk login, daftar, dan lupa password.
- Cloud Firestore untuk data akun, app state, siswa, kelas, absensi, quiz, tugas, dan public snapshot.
- Firestore Rules digunakan untuk menjaga akses data per akun.

### Cloudflare R2
- Digunakan untuk menyimpan foto siswa.
- Bucket private dapat diakses melalui Cloudflare Pages Function/Worker.
- Binding R2 menggunakan `SMARTATT_R2`.

### Cloudflare Pages
- Webapp dideploy ke Cloudflare Pages.
- Domain produksi resmi: `https://smart-att.web.id/`.
- Subdomain `pages.dev` hanya menjadi alamat teknis deployment dan tidak digunakan pada link yang dibagikan kepada siswa.

## Prinsip Data
- Data operasional tidak bergantung pada localStorage.
- Semua data utama harus tersimpan di Firebase.
- Setiap akun guru hanya melihat data miliknya sendiri.
- Setiap data memiliki owner berdasarkan UID Firebase.
- Public link hanya membaca snapshot yang memang dibuat untuk publik.

## Status Akhir yang Diharapkan
SMART-ATT siap digunakan sebagai webapp sekolah untuk absensi QR, tugas, dan ujian online. Guru dapat mengelola data sekolah dari HP atau desktop, siswa dapat mengikuti ujian melalui link, wali murid dapat mengisi konfirmasi, dan superadmin dapat mengatur akun serta token aktivasi.

## Pengembangan Multi-Mode dan RBAC (Juli 2026)

### Kompatibilitas
- Field baru `accountType` memiliki nilai `individual` atau `school`.
- Dokumen akun lama yang tidak memiliki `accountType` selalu diperlakukan sebagai `individual`.
- Token aktivasi memiliki `accountType` yang sama dengan akun tujuan. Token individual (`SATT-I-...`) tidak dapat dipakai akun sekolah dan token sekolah (`SATT-S-...`) tidak dapat dipakai akun individual.
- Token lama yang belum memiliki `accountType` tetap berlaku sebagai token individual agar akun Guru SD existing tidak memerlukan migrasi manual.
- Data dan UI akun individual tetap menggunakan jalur lama `users/{uid}/...`; tidak ada migrasi manual dan tidak ada perubahan flow Guru SD existing.
- Data mode sekolah memakai workspace terpisah `schools/{schoolId}/...` agar tidak bercampur dengan data individual.

### Role Sekolah
- `principal` (Kepala Sekolah): akses penuh profil sekolah, tahun ajaran, kelas, mapel, guru, siswa, jadwal, penugasan, absensi, quiz, nilai, laporan, dan pengaturan.
- `administration` (Tata Usaha): administrasi profil sekolah, tahun ajaran, kelas, mapel, guru, siswa, jadwal, penugasan, rekap absensi, nilai, dan laporan; tidak mengendalikan ujian siswa.
- `teacher` (Guru): hanya Dashboard, Kelas Saya, Absensi, Quiz, Nilai, dan Profil.
- Menu tanpa izin tidak dirender. Firestore Rules mengulang pemeriksaan role dan penugasan kelas; keamanan tidak bergantung pada tombol atau sidebar.

### Onboarding dan Akun Guru
- Registrasi menyediakan pilihan Guru SD Perorangan atau Per Sekolah.
- Administrator sekolah memilih Kepala Sekolah atau Tata Usaha pada login pertama.
- Guru dibuat oleh Kepala Sekolah/Tata Usaha menggunakan nama, email, password awal, mata pelajaran, dan daftar kelas.
- Password dibuat langsung melalui Firebase Authentication sekunder dan tidak pernah disimpan di Firestore.
- Penghapusan guru berupa penonaktifan akses. Akun Firebase yang masih ada tetap tidak dapat membaca workspace karena membership menjadi nonaktif.

### Model Data Sekolah
- `schools/{schoolId}`: profil sekolah.
- `schools/{schoolId}/members/{uid}`: role, status, mapel, dan kelas penugasan.
- `schools/{schoolId}/academicYears/{academicYearId}`: periode akademik sekolah; dokumen `settings/academic` tetap dipertahankan untuk kompatibilitas.
- `classes`, `subjects`, `students`, `schedules`: data induk bersama.
- `teachingAssignments`: kebutuhan guru–mata pelajaran–kelas beserta jumlah JP per minggu.
- `attendanceSessions`, `exams`, `manualGrades`, `settings`: data operasional bersama dengan pembatasan kelas untuk guru.
- Public snapshot ujian tetap memakai `ownerUid` dan menambahkan `schoolId` secara opsional. Data individual lama tetap valid tanpa field tersebut.

### ERP Penugasan dan Jadwal
- Admin mengikuti setup terpandu: Guru → Kelas → Mata Pelajaran → Siswa → Penugasan Mengajar → Jadwal.
- Kelas SMP dapat dibuat massal, misalnya VII A sampai IX E. Setiap kelas memiliki ruang kerja siswa, import CSV, dan jadwal kelas.
- Penugasan menyimpan guru, mata pelajaran, kelas, dan kebutuhan JP per minggu. Penugasan tanpa guru tetap dapat disimpan sebagai kebutuhan dan ditampilkan sebagai kekurangan.
- Pemeriksaan kesiapan menghitung jumlah kelas, mapel, guru, total JP, kelas tanpa penugasan, penugasan tanpa guru, dan guru yang melebihi kapasitas slot.
- Generator jadwal membuat draft dengan aturan tidak ada guru atau kelas yang berada pada dua pelajaran di waktu yang sama. Kekurangan slot membatalkan penyimpanan draft dan menghasilkan peringatan.
- Draft dapat dipindahkan dengan drag-and-drop atau diedit manual; setiap perubahan divalidasi ulang terhadap bentrok.
- Jadwal baru terlihat pada menu Jadwal Saya milik guru setelah admin menerapkannya. Guru tidak dapat mengubah jadwal.
