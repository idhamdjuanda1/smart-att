# SMART-ATT

Web app sekolah untuk absensi QR, manajemen siswa, komunikasi wali murid, tugas, ujian online, dan rekap nilai. Dibangun dengan React (Vinext), Tailwind CSS, Firebase Authentication/Firestore, dan Cloudflare R2.

## Menjalankan aplikasi

Persyaratan: Node.js 22.13 atau lebih baru.

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`. Tombol **Lihat demo dashboard guru** dapat digunakan tanpa akun untuk mengeksplorasi antarmuka.

## Firebase

1. Aktifkan Email/Password pada Firebase Authentication.
2. Buat database Cloud Firestore.
3. Deploy aturan dari `firestore.rules`.
4. Salin `.env.example` menjadi `.env.local` bila konfigurasi proyek berbeda.

Email superadmin ditentukan melalui `NEXT_PUBLIC_SUPERADMIN_EMAIL`. Password tidak pernah disimpan di source code; akun tetap harus dibuat pada Firebase Authentication melalui halaman daftar atau Firebase Console.

Struktur data utama memakai `users/{uid}/...`, sehingga setiap guru hanya dapat membaca data miliknya sendiri. Snapshot yang dibagikan ke siswa/wali berada di koleksi `publicSnapshots`.

## Cloudflare R2

Foto siswa diunggah melalui Worker `/api/storage/photos` ke binding privat `SMARTATT_R2`. Token R2 tidak pernah dikirim ke browser. Saat deploy di luar Sites, hubungkan bucket R2 Anda ke binding dengan nama yang sama.

Endpoint S3 dan Account ID hanya diperlukan oleh tooling server/deployment, bukan kode frontend. Jangan menaruh secret access key atau token R2 pada variabel `NEXT_PUBLIC_*`.

## Halaman publik

- `/public/quiz/demo` — alur ujian siswa tanpa login
- `/public/task/demo` — tampilan tugas publik
- `/public/guardian/demo` — konfirmasi wali murid

## Catatan produksi

Sebelum digunakan sekolah, lengkapi data profil, periode akademik, kelas, serta indeks Firestore yang diminta konsol. Aktifkan App Check dan deploy rules sebelum mengundang pengguna nyata.
