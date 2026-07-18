# SMART-ATT Project Context

> Dokumen arsitektur dan handoff maintainer. Disusun dari audit source code pada 18 Juli 2026 (Asia/Jakarta). Dokumen ini menggambarkan working tree saat audit, termasuk perubahan lokal yang sudah ada sebelumnya. Tidak ada source code yang diubah dalam proses audit.

## 1. Executive summary

SMART-ATT adalah aplikasi sekolah berbasis web untuk guru, siswa, wali murid, dan superadmin. Produk memusatkan data akademik per akun guru di Firebase Authentication dan Cloud Firestore, sementara foto siswa dan sampul artikel disimpan di Cloudflare R2 melalui Worker terautentikasi. Aplikasi dibangun sebagai satu client-heavy catch-all application dengan Next.js App Router API, React 19, Vinext, Vite, dan Cloudflare Pages.

Status implementasi adalah MVP lanjut: autentikasi, siswa, QR, absensi, tugas, ujian, nilai, tabungan, artikel, dan token sudah memiliki implementasi nyata. Risiko utama berada pada desain keamanan ujian publik, ukuran dan tanggung jawab `SmartAttApp.tsx`, duplikasi Worker deployment, aturan Firestore yang terlalu permisif pada attempt ujian, serta test coverage yang belum menguji perilaku bisnis dan rules secara nyata.

## 2. Scope dan metode audit

Source yang diaudit:

- seluruh `app/**`, termasuk semua komponen dan library;
- `worker/index.ts`;
- seluruh script `build/**`;
- `firestore.rules` dan konfigurasi Firebase/Cloudflare/Vite/Next/TypeScript/ESLint;
- `tests/rendered-html.test.mjs`;
- `README.md`, PRD, package manifest, dan metadata hosting.

Artefak generated seperti `.next`, `dist`, `.pages-deploy`, `.firebase`, log, dan `node_modules` diinventaris tetapi tidak diperlakukan sebagai source of truth.

Validasi read-only:

- `npx tsc --noEmit --incremental false`: lulus;
- ESLint: 111 masalah, terdiri dari 55 error dan 56 warning;
- `npm test` tidak dijalankan karena script melakukan build dan akan menulis artefak.

## 3. Teknologi

| Area | Teknologi | Peran |
|---|---|---|
| UI | React 19, React DOM 19 | Client components dan state lokal |
| Framework API | Next.js 16 App Router | Layout, metadata, navigation API, route convention |
| Runtime/build | Vinext, Vite 8 | Kompilasi Next-compatible untuk Cloudflare |
| Styling | Tailwind CSS 4, global CSS | Layout responsif, print rules, mobile UI |
| Backend data | Firebase Authentication, Cloud Firestore | Identitas dan data utama |
| Object storage | Cloudflare R2 | Foto siswa dan sampul artikel |
| Edge runtime | Cloudflare Worker/Pages | RSC handler, storage API, image optimization |
| QR/PDF | qrcode.react, jsPDF | QR siswa, kartu, laporan tabungan |
| Icons | lucide-react | Icon system |
| Database tooling | Drizzle ORM/Kit | Terpasang, tetapi belum dipakai aplikasi |
| Test | Node test runner | Smoke SSR dan pemeriksaan source-string |

Node minimum adalah 22.13.0.

## 4. Struktur project

```text
SMART-ATT/
├── app/
│   ├── [[...slug]]/page.tsx       # Satu route catch-all
│   ├── layout.tsx                 # Metadata, viewport, root HTML
│   ├── globals.css                # Global/mobile/print styling
│   ├── chatgpt-auth.ts            # Helper auth header Sites; belum digunakan
│   ├── components/
│   │   ├── SmartAttApp.tsx        # Composition root + banyak fitur legacy/inline
│   │   ├── AdminViews.tsx         # Superadmin + profil profesional
│   │   ├── OperationalViews.tsx   # Scanner dan rekap absensi profesional
│   │   ├── GradeViews.tsx         # Nilai dan pengaturan akademik
│   │   ├── ExamPortal.tsx         # Portal ujian publik profesional
│   │   └── ArticleViews.tsx       # Artikel publik + CMS admin
│   └── lib/
│       ├── firebase.ts            # Firebase singleton/Auth/Firestore/Analytics
│       ├── attendance.ts          # Normalisasi dan pencarian QR/NIS
│       ├── csv.ts                 # Parser import siswa
│       ├── quiz.ts                # Parser output AI menjadi soal
│       ├── quizRuntime.ts         # Seeded shuffle, countdown, HTML escape
│       └── studentPhoto.ts        # Crop/resize/compress foto
├── worker/index.ts                # Worker source untuk RSC, R2, image transform
├── build/
│   ├── sites-vite-plugin.ts       # Packaging metadata Sites/Drizzle
│   ├── stage-cloudflare-pages.mjs # Membuat Pages bundle dan Worker kedua
│   ├── run-vinext-build.cjs       # Entrypoint build dengan spawn fix
│   └── vite-windows-spawn-fix.cjs # Compatibility Windows
├── firestore.rules                # Authorization dan validation rules
├── tests/rendered-html.test.mjs   # Smoke test
├── public/                        # Logo, favicon, routes config
├── drizzle/                       # Hanya journal kosong
├── drizzle.config.ts              # Menunjuk db/schema.ts yang tidak ada
├── vite.config.ts
├── wrangler.toml
├── firebase.json
└── package.json
```

## 5. Dependency graph

```text
app/layout.tsx
└── app/[[...slug]]/page.tsx
    └── SmartAttApp.tsx
        ├── lib/firebase.ts
        ├── lib/attendance.ts
        ├── lib/csv.ts
        ├── lib/quiz.ts
        ├── lib/quizRuntime.ts ──> lib/quiz.ts (type only)
        ├── lib/studentPhoto.ts
        ├── OperationalViews.tsx ──> firebase + attendance
        ├── GradeViews.tsx ────────> firebase
        ├── ExamPortal.tsx ────────> firebase + quiz + quizRuntime
        ├── AdminViews.tsx ────────> firebase + ArticleViews
        └── ArticleViews.tsx ──────> firebase + Worker storage API

Cloudflare request
└── worker/index.ts
    ├── /api/storage/** ──> Firebase Identity Toolkit + SMARTATT_R2
    ├── /_vinext/image ───> ASSETS + Cloudflare Images binding
    └── other paths ──────> vinext app-router handler
```

`app/chatgpt-auth.ts` tidak memiliki consumer. Drizzle tidak terhubung ke runtime aplikasi.

## 6. Hubungan komponen dan composition root

`SmartAttApp` adalah composition root sekaligus router, auth gate, subscription coordinator, navigation state, dan tempat banyak implementasi fitur. Jalur render aktif:

```text
SmartAttApp
├── public info pages
├── PublicArticles
├── PublicQuizProfessional
├── PublicTask
├── AbsenceConfirmationForm
├── GuardianDataForm
├── AuthScreen
├── SuperAdminProfessional
├── AccountLockedScreen
└── DashboardShell
    ├── Overview
    ├── StudentsView
    ├── ScannerViewPro
    ├── AttendanceViewPro
    ├── SavingsView
    ├── SubjectsView
    ├── TasksView
    ├── ExamsViewWithManual / ExamsViewAdvanced
    ├── AiGeneratorConnected
    ├── ScoresView
    ├── AcademicView
    └── ProfileProfessional
```

Komponen `SuperAdmin`, `LegacyScannerView`, `ScannerView`, `AbsensiView`, `ExamsView`, `AiGenerator`, `LegacyScoresView`, `LegacyAcademicView`, `ProfileView`, `PublicQuizAdvanced`, dan `PublicQuiz` adalah implementasi lama atau alternatif yang tidak berada pada jalur render utama.

## 7. State management

Tidak ada Redux, Zustand, Context domain, atau server state library. State memakai:

- `useState` untuk state form, modal, filter, current view, loading, error, timer;
- `useEffect` untuk Firebase auth, Firestore realtime subscriptions, heartbeat, browser events, dan sinkronisasi respons publik;
- `useMemo` untuk derived lists, totals, scores, filter, dan ranking;
- `useRef` untuk media stream, scanner state, timer/submission guards, dan session identity;
- Firestore `onSnapshot` sebagai server-state synchronization layer.

State global semu berada di `SmartAttApp`: `user`, `demo`, `view`, `students`, `activeSession`, toast, dan account gate. Props kemudian diteruskan beberapa tingkat. Tidak ada cache/query deduplication; setiap modul membuat subscription sendiri saat dirender.

Data operasional utama tidak menggunakan `localStorage` atau `sessionStorage`, sesuai prinsip PRD. Identitas sesi ujian dibuat di memori browser sehingga refresh menghasilkan client session baru.

## 8. Routing

Hanya ada satu file route `app/[[...slug]]/page.tsx`. Semua pathname diproses client-side oleh `SmartAttApp` melalui `usePathname()`.

| Path | Renderer |
|---|---|
| `/` | Auth, dashboard guru, atau superadmin berdasarkan state/user |
| `/superadmin...` | `SuperAdminProfessional` atau denied |
| `/faq` | FAQ publik |
| `/syarat-ketentuan` | Terms publik |
| `/refund-policy` | Refund policy |
| `/kontak` | Kontak |
| `/articles` | Daftar artikel |
| `/articles/{slug}` | Detail artikel |
| `/public/quiz/{id}` | Portal ujian profesional |
| `/public/task/{id}` | Tugas publik |
| `/public/absence/{id}` | Konfirmasi sakit/izin |
| `/public/guardian-data/{id}` | Pendataan wali |
| `/public/guardian/{id}` | Alias pendataan wali |

Navigasi internal dashboard memakai state `NavKey`, bukan URL. Akibatnya deep-link, back/forward browser, bookmark modul, dan persistence setelah reload belum tersedia.

## 9. Reusable components dan utilities

Reusable UI saat ini tersebar, belum menjadi design system:

- `Logo`, `SectionHeading`, `Field`, `Modal`, `ToastMessage`, `PublicFrame` di `SmartAttApp.tsx`;
- `Panel`, `MiniStat`, `AccountBadge`, `Input` di `AdminViews.tsx`;
- `EmptyState`, `MiniStat`, field labels di `GradeViews.tsx`;
- `StudentPhoto`, `Detail`, status/summary components di `OperationalViews.tsx`;
- `PublicFrame`/result statistics dalam portal ujian.

Nama seperti `MiniStat`, `Logo`, dan public frame memiliki implementasi berulang. Type domain seperti Student, Toast, AcademicSettings, QuizAttempt, dan grade category juga dideklarasikan ulang lintas file.

Utilities yang relatif reusable dan terisolasi dengan baik:

- `findStudentByQrOrNis` dan `canonicalNis`;
- `parseStudentsCsv`;
- `parseAiQuizText`;
- `createRandomizedQuiz`, `formatCountdown`, `escapeHtml`;
- photo processing utilities.

## 10. Backend: Firebase Authentication

### Login

- Firebase Email/Password melalui `signInWithEmailAndPassword`.
- `onAuthStateChanged` menjadi sumber status autentikasi.
- Setelah login, client menulis `lastLoginAtMs`, `lastLoginAt`, `lastSeenAtMs`, `online`, dan `updatedAt` pada `users/{uid}`.
- Heartbeat setiap 60 detik dan ketika tab kembali visible.
- Cleanup mencoba menulis `online: false`.

### Registrasi

- Akun dibuat dengan `createUserWithEmailAndPassword`.
- Dokumen `users/{uid}` dibuat dengan role `teacher`, kecuali alamat superadmin yang diizinkan menjadi `superadmin` oleh rules.
- Trial/status dan data profil disimpan pada dokumen user.
- Race penting: Auth account dapat berhasil dibuat sementara write dokumen user gagal; user kemudian masuk kondisi verification error tanpa rollback server-side.

### Reset password

- Menggunakan `sendPasswordResetEmail`.

### Role dan account gate

- Frontend mengenali superadmin dari email environment/fallback.
- Rules mensyaratkan email khusus dan `users/{uid}.role == superadmin`.
- Akun guru diblokir jika `disabled/status` nonaktif atau expiry lewat.
- Jika status tidak dapat diverifikasi, UI menunggu enam detik lalu menampilkan error dan tidak menganggap akun expired.

### ChatGPT/Sites auth

`app/chatgpt-auth.ts` membaca header `oai-authenticated-user-*`, menyediakan redirect login/logout aman, tetapi tidak dipanggil dari route atau komponen mana pun.

## 11. Backend: model koleksi Firestore

### Koleksi privat per guru

| Path | Isi utama |
|---|---|
| `users/{uid}` | profil, role, status, expiry, online/last seen, active token |
| `users/{uid}/students/{id}` | NIS/NISN, nama, kelas, wali, WA, foto, metadata transfer |
| `users/{uid}/attendanceSessions/{id}` | tanggal, kelas, entry time, map records per siswa |
| `users/{uid}/tasks/{id}` | tugas, deadline, status publikasi, snapshot ID |
| `users/{uid}/exams/{id}` | metadata ujian, questions, schedule, status, snapshot ID |
| `users/{uid}/manualGrades/{id}` | nilai manual dan kategori |
| `users/{uid}/settings/academic` | sekolah, tahun, semester, kelas, jam masuk, KKM, bobot |
| `users/{uid}/settings/activeTeachingSession` | mapel/kelas/jam sesi aktif |
| subkoleksi tambahan | data domain lain yang dilindungi wildcard owner rules |

### Koleksi root/cross-user/public

| Koleksi | Fungsi |
|---|---|
| `activationTokens` | token sekali pakai, durasi, expiry token/account, usedBy |
| `publicSnapshots` | snapshot guardian, absence, task, atau quiz |
| `publicResponses` | kiriman data wali |
| `publicAbsenceResponses` | kiriman sakit/izin |
| `publicQuizAttempts` | jawaban, violations, timer, skor, hasil |
| `publicQuizDeviceLocks` | lock sesi/perangkat per attempt |
| `studentDirectory` | lookup satu dokumen siswa lintas akun tanpa list |
| `studentClassLinks` | hubungan siswa sumber dan siswa target |
| `crossClassAttendance` | absensi oleh scanner akun lain |
| `savingsTransactions` | ledger tabungan root dengan owner UID |
| `articles` | artikel dan status publikasi |

## 12. Firestore queries dan pola akses

Pola utama:

- realtime `onSnapshot` pada user, students, settings, tasks, exams, attempts, articles, attendance, grades, tokens, dan users admin;
- `where("ownerUid", "==", user.uid)` untuk koleksi root multi-tenant;
- `orderBy("name")` pada siswa;
- `collectionGroup("students")` untuk total siswa superadmin;
- batch write untuk konsistensi task/exam dengan public snapshot dan respons absence;
- transaction untuk redeem token;
- map field update `records.{studentId}` pada attendance session;
- public pages memakai `getDoc` atau `onSnapshot` terhadap snapshot ID langsung.

Potensi kebutuhan index terdapat pada query root dengan `where`, terutama attempts, savings, public responses, cross-class attendance, dan kombinasi filter/order bila dikembangkan lebih lanjut. Repository tidak menyimpan `firestore.indexes.json`.

## 13. Firestore Rules

### Kekuatan

- isolasi `users/{uid}/**` berdasarkan UID;
- owner tidak dapat bebas mengubah role;
- superadmin memerlukan email khusus dan role dokumen;
- redeem token memvalidasi `getAfter` antara token dan user;
- public response divalidasi terhadap published snapshot;
- ledger tabungan tidak dapat dihapus dan void dibatasi;
- `studentDirectory` menolak list massal;
- public snapshot create dibatasi type dan owner;
- artikel write hanya superadmin.

### Risiko kritis

1. `publicSnapshots` quiz dapat dibaca siapa pun ketika `published == true`, sementara snapshot berisi array `questions` lengkap termasuk `answerIndex` dan pembahasan. Kunci jawaban dapat diambil melalui SDK/network/devtools sebelum ujian selesai.
2. `publicQuizAttempts/{attemptId}` memiliki `allow get: if true`. Attempt individual, jawaban, pelanggaran, identitas siswa, dan skor dapat terbaca publik jika ID diketahui/ditebak dari pola.
3. Update attempt tidak mensyaratkan autentikasi atau kepemilikan session. Immutable identity fields diperiksa, tetapi client publik tetap dipercaya mengirim `score`, `correctCount`, status, answers, dan violations. Siswa dapat memodifikasi request dan memalsukan skor/jawaban.
4. Penilaian dilakukan di client dengan answer key yang juga berada di client. Tidak ada server-authoritative grading.

### Risiko lain

- `publicQuizDeviceLocks` create/update bersifat publik dan tidak mengikat request ke identitas autentikasi; keamanan bergantung pada entropy ID/session.
- Public response menggunakan NIS dan snapshot data sebagai bukti identitas; cocok untuk low-assurance form, bukan autentikasi kuat.
- Wildcard owner subcollection rules memberi owner write penuh pada subcollection apa pun; praktis tetapi minim schema validation.
- Email superadmin di-hard-code pada rules dan Worker sehingga rotasi harus dilakukan di banyak tempat.

## 14. Cloudflare R2 dan Worker

Binding bucket adalah `SMARTATT_R2`, bucket deploy `smartatt-storage`.

Endpoint:

| Method/path | Auth | Fungsi |
|---|---|---|
| `POST /api/storage/photos` | Firebase ID token | Upload foto/thumbnail ke prefix user |
| `GET /api/storage/file/{key}` | Firebase ID token + prefix UID | Baca file privat |
| `DELETE /api/storage/file/{key}` | Firebase ID token + prefix UID | Hapus file privat |
| `POST /api/storage/articles` | Firebase token + email superadmin | Upload sampul artikel |
| `GET /api/storage/article/{key}` | Publik | Baca sampul artikel |
| `POST /api/storage/transfer-student-photo` | Firebase token | Salin foto siswa lama ke owner baru |
| `/_vinext/image` | Publik | Optimasi asset gambar |

Firebase ID token diverifikasi melalui Google Identity Toolkit `accounts:lookup`. Ini valid tetapi menambah network round-trip setiap request storage dan tidak memiliki cache token/identity di Worker.

### Risiko R2

- `transfer-student-photo` hanya memvalidasi pola `sourceOwnerUid/sourceKey`, tidak memverifikasi Firestore `studentClassLinks` atau persetujuan owner lama. Setiap guru terautentikasi yang mengetahui key privat guru lain dapat menyalinnya.
- Hapus data siswa perlu dipastikan juga menghapus foto dan thumbnail; kegagalan parsial dapat meninggalkan orphan object.
- Sampul artikel lama tidak otomatis dihapus ketika artikel/sampul diganti.
- MIME diperiksa, tetapi content signature/magic bytes tidak diverifikasi.

### Duplikasi Worker

Storage dan image behavior ada di dua implementasi:

- `worker/index.ts`;
- string Worker besar di `build/stage-cloudflare-pages.mjs`.

Keduanya sudah memiliki perbedaan implementasi image/static handling. Ini merupakan risiko drift produksi: perbaikan security dapat diterapkan di satu Worker tetapi terlupakan di yang lain.

## 15. Flow fitur

### 15.1 Login

1. Auth screen menerima email/password.
2. Firebase login dipanggil.
3. `onAuthStateChanged` memasang user.
4. Dokumen user disubscribe dan heartbeat dimulai.
5. Email superadmin masuk panel admin; guru melewati expiry/disabled gate.
6. User masuk dashboard atau locked/error screen.

Mode demo melewati Firebase dan memakai data lokal contoh.

### 15.2 Registrasi

1. User mengisi identitas, sekolah, email, password.
2. Firebase Auth account dibuat.
3. `users/{uid}` dan default status/trial dibuat.
4. Auth observer meneruskan ke account gate.

Risiko partial completion telah dicatat pada bagian auth.

### 15.3 Aktivasi token

1. Superadmin membuat `activationTokens/{code}` dengan duration dan masa valid token.
2. Guru memasukkan token pada profil/locked screen.
3. Transaction membaca token dan user.
4. Token ditandai used, menyimpan user/email/waktu/expiry.
5. User disetel active, `activeTokenId` dan `activeUntilMs` disamakan.
6. Rules memvalidasi kedua dokumen melalui `getAfter`.

### 15.4 Dashboard

- Menampilkan ringkasan data siswa dan shortcut modul.
- Header membaca academic settings realtime.
- Navigasi desktop/mobile mengubah state `view`.
- Notifikasi dan panel bantuan masih visual/non-fungsional.

### 15.5 Data siswa

- Subscription ke `users/{uid}/students`, urut nama.
- Tambah/edit/hapus manual.
- Import CSV dengan auto delimiter, alias header, dan dedupe NIS/NISN.
- Upload/crop/compress foto, menyimpan key dan thumbnail key.
- Publish/maintain `studentDirectory` untuk lookup lintas guru.
- Transfer siswa memindai QR lama, membuat salinan/link, dan dapat menyalin foto.
- Kiriman guardian publik diterapkan otomatis ke data siswa oleh subscription guru.

### 15.6 QR Attendance

- QR berisi identitas SMART-ATT/student ID/NIS dan informasi pemilik.
- Scanner memakai kamera (`BarcodeDetector` bila tersedia) serta input manual/fallback.
- Siswa dicari berdasarkan student ID atau canonical NIS.
- Status hadir/terlambat ditentukan dari waktu scan versus jam masuk.
- Attendance record ditulis pada session harian.
- Cross-class scan menulis `crossClassAttendance` tanpa menyalin data privat siswa ke guru scanner.
- Media stream dibersihkan saat komponen ditutup/unmount.

### 15.7 Student ID Card

- QR code dibuat dengan `QRCodeSVG`.
- Template kartu dengan atau tanpa foto.
- Pilihan layout single atau 8/10/12 kartu A4 dan orientasi.
- Print memakai DOM/CSS print dan jsPDF pada jalur tertentu.
- Data sekolah/tahun akademik ditarik dari settings/profile.

### 15.8 Rekap absensi

- Membaca attendance sessions milik guru dan cross-class records yang relevan.
- Filter kelas, tanggal, nama/NIS, dan mode rekap.
- Status: present, late presentation detail, sick, permission, alpha, not yet scanned.
- Menampilkan ringkasan harian, bulanan, semester, dan persentase.
- Guru dapat membuat snapshot absence lalu mengirim link WhatsApp.
- Respons wali diterapkan ke record dan snapshot dinonaktifkan.

### 15.9 Mata pelajaran

- Mata pelajaran wajib berasal dari constant default.
- User memilih mapel, kelas, dan rentang waktu sebagai sesi mengajar aktif.
- Sesi disimpan di `settings/activeTeachingSession` dan dipakai task/AI generator.
- Model mapel khusus belum tampak sekuat settings lain; sebagian bersifat predefined/local.

### 15.10 Nilai

- Membaca attempts ujian dan manual grades.
- Academic settings menyimpan KKM dan bobot kategori.
- Mendukung dashboard, per siswa, per mapel, input manual, dan konfigurasi bobot.
- Nilai akhir merupakan derived state dari quiz attempts/manual entries.
- Export CSV/Excel dan print tersedia.
- Tombol “Ambil ujian” hanya memberi notifikasi karena sinkronisasi sebenarnya realtime.

### 15.11 Tugas

- CRUD task pada subcollection user.
- Publish membuat `publicSnapshots` type `task`.
- Update menggunakan batch agar task dan snapshot selaras.
- Unpublish mengubah snapshot `published: false`.
- Public task membaca snapshot ID dan menampilkan instruksi/deadline.

### 15.12 Ujian

#### Guru

- Membuat soal manual atau dari AI parser.
- Menyimpan draft exam dengan question, choice, key, explanation.
- Publish membuat public snapshot dengan jadwal, durasi, siswa target, dan questions.
- Monitoring attempt realtime, ranking, progress, violations, dan reset device lock.

#### Siswa

- Membuka public snapshot dan memasukkan NIS.
- Jadwal menghasilkan countdown/waiting state.
- Attempt ID dikonstruksi dari exam/student; existing attempt dapat dilanjutkan/dilihat.
- Soal dan pilihan diacak deterministik memakai seed.
- Fullscreen, visibility, blur/exit events dicatat.
- Jawaban autosave ke Firestore.
- Timer menggunakan deadline ms dari snapshot/attempt di client.
- Selesai menghitung score di browser dan menulis hasil.
- Setelah ujian berakhir tersedia ranking dan review jawaban.

Desain ini fungsional tetapi belum secure untuk ujian berintegritas tinggi karena answer key dan grading berada di client.

### 15.13 Artikel

- Artikel published dibaca realtime oleh publik.
- Jika Firestore kosong/error, satu artikel default lokal ditampilkan.
- Superadmin dapat CRUD artikel dan upload cover ke R2.
- Route list dan slug berada pada catch-all client routing.
- Metadata title/description diubah imperatif melalui `document`, bukan Next metadata API.

### 15.14 Superadmin

- Realtime list semua users dan activation tokens.
- `collectionGroup(students)` menghitung total siswa.
- Generate/disable/delete token.
- Enable/disable akun.
- Menampilkan online/last login/account expiry/token.
- Menyediakan ArticleManager.
- Authorization frontend berdasarkan email; backend rules menambah pemeriksaan role.

## 16. Analisis kode

### 16.1 Duplicate code

- Storage API dan image optimizer terduplikasi antara Worker source dan staging script.
- Legacy dan professional versions untuk scanner, absensi, quiz, nilai, akademik, profil, dan superadmin.
- Type domain dan demo constants berulang antar file.
- UI primitives (`Logo`, stat cards, field, panel, empty state, public frame) berulang.
- Normalisasi tanggal, currency, class list, dan Firestore mapping tersebar.
- Firebase document-to-domain mapping dilakukan inline berkali-kali tanpa converter/schema.

### 16.2 Dead/unused code

- `app/chatgpt-auth.ts` tidak diimpor.
- Drizzle ORM/Kit, `drizzle.config.ts`, dan journal tidak dipakai runtime; target `db/schema.ts` tidak ada.
- Beberapa legacy functions di `SmartAttApp.tsx` tidak pernah dirender.
- Beberapa public/demo quiz lama telah digantikan `PublicQuizProfessional`.
- `next.config.ts` hanya placeholder.
- Asset default Next (`file.svg`, `globe.svg`, `window.svg`) tampaknya tidak digunakan.
- Artefak Firebase Hosting lama dan workflow yang dihapus menunjukkan jalur deployment lama.

### 16.3 Unused imports/symbols

ESLint menemukan simbol tidak terpakai, termasuk `Clock3` di `ExamPortal.tsx` dan local variables tertentu. Daftar lengkap perlu dijadikan baseline setelah legacy code dipisahkan; memperbaiki satu per satu sebelum pemisahan akan menghasilkan churn.

### 16.4 Potential bugs

1. Kunci jawaban quiz terekspos publik; ini bug desain/security, bukan sekadar hardening.
2. Client dapat mengirim score sendiri; nilai dapat dimanipulasi.
3. Registration dapat menghasilkan orphan Auth user tanpa profile Firestore.
4. Update guardian/absence diproses oleh subscription client guru. Jika guru tidak pernah membuka aplikasi, respons tetap `pending` dan belum diterapkan.
5. Dua tab guru dapat memproses respons pending yang sama secara bersamaan; update umumnya idempotent tetapi bukan claim transaction.
6. Attendance record disimpan sebagai map dinamis dalam satu session document; kelas besar/riwayat tambahan dapat mendekati document size dan menyebabkan write contention.
7. Penghapusan entity dan R2 object tidak transaksional; orphan file mungkin terjadi.
8. Public article fallback dapat menyamarkan Firestore error sebagai konten default.
9. Catch-all client routing membuat status HTTP artikel tidak ditemukan tetap kemungkinan 200.
10. `Date.now()` dan synchronous setState dalam effect memicu lint purity dan dapat menghasilkan render cascade.
11. Beberapa hook memiliki dependency tidak lengkap/kompleks; berpotensi stale closure, khususnya timer portal ujian.
12. Encoding mojibake (`â€”`, `Â·`, `â†’`) terlihat pada source/rendered text.
13. Profile/account display memiliki beberapa fallback hard-coded dan versi legacy yang tidak sinkron dengan account gate nyata.

### 16.5 Race conditions dan consistency

- Auth registration versus Firestore profile creation.
- Publish/unpublish sebagian sudah aman dengan batch, tetapi upload R2 + Firestore metadata tidak atomic.
- Public response processors tidak menggunakan transaction/claim.
- Multiple tabs dapat membuat heartbeat/account online saling menimpa; satu tab unload dapat menulis offline sementara tab lain masih aktif.
- Quiz autosave, finish, timer auto-submit, dan manual submit perlu satu server-side idempotency boundary. Ref lokal membantu, tetapi client multi-session tetap berisiko.
- Device lock heartbeat dan reset guru dapat berlomba.
- Token redeem menggunakan transaction dan merupakan salah satu flow konsistensi terbaik di project.

### 16.6 Performance bottlenecks

- `SmartAttApp.tsx` 303 KB dan banyak domain dalam satu client chunk meningkatkan parse/compile/maintenance cost.
- Banyak realtime listener root/owner aktif tanpa query limit atau pagination.
- Superadmin `collectionGroup("students")` membaca keseluruhan student set hanya untuk count; mahal saat skala naik.
- Lists siswa, akun, attempts, transactions, dan artikel belum semuanya dipaginasi.
- Repeated mapping/derived calculations dilakukan client-side.
- `<img>` tanpa Next/Image terdeteksi lint dan dapat memperburuk LCP/bandwidth, meskipun private-token image memang memerlukan custom strategy.
- Firebase token diverifikasi ke Identity Toolkit untuk setiap storage request.
- Foto blob URL dan media stream perlu audit lifecycle berkelanjutan untuk mencegah leak.

### 16.7 Security issues

Critical:

- answer key dalam public quiz snapshot;
- public readable attempts;
- client-authoritative grading/update attempt.

High:

- transfer R2 photo tidak memverifikasi hubungan/persetujuan Firestore;
- authorization superadmin di-hard-code pada tiga tempat atau lebih;
- public NIS forms rentan enumeration jika snapshot students memuat daftar lengkap;
- tidak ada App Check/rate limiting yang terlihat;
- wildcard owner writes tidak memvalidasi schema domain.

Medium:

- public article object immutable cache 24 jam tanpa versioned URL saat object content diganti;
- file type hanya berdasarkan MIME dari upload;
- data pribadi siswa/wali dalam public snapshot perlu minimization dan expiry policy;
- tidak ada audit log server-side yang immutable untuk tindakan admin/ujian.

### 16.8 Technical debt

- God component dan mixed concerns.
- Domain types tidak terpusat dan tanpa runtime validation.
- Client-side router manual di atas App Router.
- Legacy code tersimpan bersama production path.
- Backend workflows penting bergantung pada tab guru aktif.
- Tidak ada repository/service layer.
- Tidak ada Cloud Functions/Worker API untuk grading, response processing, atau aggregate count.
- Tidak ada Firestore emulator/rules tests/E2E.
- Build/deploy logic kompleks dan terduplikasi.
- README/PRD tertinggal dari fitur aktual.
- Working tree dan generated artifacts menunjukkan hygiene deployment/repository perlu ditertibkan.

## 17. Refactor plan

### Critical — keamanan dan integritas data

1. Pindahkan answer key dan grading keluar dari public snapshot/client.
   - Snapshot siswa hanya berisi prompt dan choices tanpa `answerIndex`/explanation.
   - Simpan key privat pada exam owner.
   - Submit/finish melalui Worker atau trusted Firebase backend yang menghitung nilai.
2. Perketat `publicQuizAttempts` rules.
   - Hapus public `get: if true`.
   - Gunakan capability/session token yang diverifikasi server atau endpoint Worker.
   - Jangan izinkan client menulis score/correctCount/finished authority langsung.
3. Buat rules emulator tests sebelum deploy perubahan rules.
4. Amankan transfer foto dengan validasi `studentClassLinks`/one-time transfer grant di trusted backend.
5. Audit dan minimalkan student data pada semua public snapshots; tambahkan expiry dan revoke semantics.

### High — reliability dan architecture boundary

1. Ekstrak `SmartAttApp.tsx` per domain dan hapus legacy setelah behavior tests tersedia.
2. Gunakan route nyata App Router untuk public pages, articles, superadmin, dan dashboard modules.
3. Buat domain types + Firestore converters/runtime schema validation terpusat.
4. Pindahkan processor guardian/absence dari subscription client ke trusted backend/idempotent transaction.
5. Jadikan satu Worker source sebagai source of truth; staging script hanya membundle/copy.
6. Tambahkan idempotent command untuk quiz start/autosave/finish dan device lock.
7. Perbaiki account presence multi-tab atau ubah menjadi per-session presence records.
8. Tambahkan App Check, rate limits, abuse monitoring, dan audit logs.

### Medium — maintainability, scale, dan UX

1. Bentuk repository/service hooks per domain (`useStudents`, `useAttendance`, `useExams`, dan sebagainya).
2. Ekstrak shared UI/design tokens dan hilangkan duplikasi components.
3. Tambahkan pagination/limits dan aggregate counters untuk admin/list besar.
4. Pecah attendance records menjadi dokumen per student/session bila skala menuntut.
5. Tambahkan unit tests parser CSV, AI quiz, randomization, grade calculation, QR lookup, dan date logic.
6. Tambahkan E2E untuk auth, siswa, scan manual, publish task, quiz, token, dan public response.
7. Selesaikan seluruh 111 lint findings setelah legacy split; pertahankan TypeScript clean.
8. Perbaiki encoding mojibake dan tetapkan UTF-8 repository policy.
9. Implementasikan notification/help/profile controls atau hapus affordance palsu.
10. Tambahkan cleanup job R2 orphan objects dan lifecycle policy.

### Low — hygiene dan dokumentasi

1. Putuskan apakah Drizzle/D1 dan ChatGPT auth diperlukan; implementasikan penuh atau hapus.
2. Hapus asset default dan generated/deployment artifact yang tidak diperlukan dari version control.
3. Sinkronkan README, PRD, collection catalog, route catalog, dan deployment runbook.
4. Gunakan Next metadata API untuk artikel dan status HTTP route yang benar.
5. Evaluasi image component/custom authenticated loader untuk optimasi LCP.
6. Tambahkan ADR untuk Firebase + Cloudflare split backend dan public snapshot model.

## 18. Proposed target architecture

```text
app routes
├── (public)/articles, task, guardian, absence
├── (exam)/quiz
├── (auth)/login, register, reset
├── (teacher)/dashboard/{domain}
└── (admin)/superadmin

features/
├── auth/
├── students/
├── attendance/
├── savings/
├── tasks/
├── exams/
├── grades/
├── academic/
├── articles/
└── admin/
    ├── components
    ├── hooks
    ├── repository
    ├── schema
    └── types

shared/
├── ui
├── firebase
├── errors
└── utils

worker/
├── auth
├── storage
├── exams (trusted grading/session)
├── public-responses
└── index
```

Migrasi harus incremental: terlebih dahulu tests dan security boundary, kemudian ekstraksi tanpa perubahan behavior, baru routing dan optimasi.

## 19. Maintenance rules untuk sesi berikutnya

1. Anggap working tree user sebagai data berharga; jangan reset atau menimpa perubahan yang tidak terkait.
2. Sebelum perubahan security, baca bersamaan client write shape dan `firestore.rules`.
3. Perubahan quiz harus memeriksa `SmartAttApp.tsx`, `ExamPortal.tsx`, rules, tests, dan Worker.
4. Perubahan students/photo harus memeriksa StudentsView, OperationalViews, student directory/link rules, dan seluruh storage endpoints.
5. Perubahan account/token harus memeriksa AuthScreen, AccountLockedScreen, ProfileProfessional, SuperAdminProfessional, dan token rules.
6. Jangan menganggap komponen bernama lama sebagai aktif; mulai dari `DashboardShell` dan pathname branches.
7. Jalankan minimal `tsc --noEmit`, lint file yang berubah, unit tests, rules tests, dan relevant E2E.
8. Jangan memperluas data public snapshot tanpa privacy/security review.
9. Jangan menambah backend behavior ke staging string Worker; satukan Worker terlebih dahulu.
10. Dokumentasikan keputusan arsitektur material sebagai ADR dan perbarui dokumen ini.

## 20. Known validation baseline

- TypeScript: lulus pada audit 18 Juli 2026.
- ESLint: gagal dengan 55 error dan 56 warning.
- Existing test suite: hanya dua smoke/source-presence tests dan belum cukup membuktikan correctness.
- Firestore Rules: belum memiliki emulator tests dalam repository.
- Formal `TODO`/`FIXME`: hampir tidak ada; backlog harus diturunkan dari behavior dan temuan audit di atas.

## 21. Kesimpulan maintainer

SMART-ATT memiliki cakupan fitur kuat dan pola multi-tenant dasar yang cukup baik: private user subcollections, public snapshots, batch writes, token transaction, dan R2 prefix isolation. Namun ujian belum boleh dianggap aman untuk penggunaan high-stakes sampai answer key, grading, attempt access, dan session authority dipindah ke trusted backend. Prioritas maintainer pertama adalah menutup risiko tersebut dan membangun safety net test; pemecahan god component dilakukan setelahnya agar tidak mengubah behavior tanpa perlindungan.
