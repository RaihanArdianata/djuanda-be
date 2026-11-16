# Kebijakan severity alert

Jumlah alert yang terlalu banyak membuat operator mengabaikan yang benar-benar kritis. Karena itu severity ditentukan oleh **seberapa cepat operator harus bertindak**, bukan oleh jenis aturannya, dan setiap aturan menyatakan dengan jelas kapan ia Critical, Warning, atau Info.

> Angka di bawah adalah nilai bawaan dari praktik umum A-SMGCS, bukan standar resmi. Semuanya bisa diubah per bandara di halaman Alert Rules (kunci konfigurasi disebut di tiap aturan). Validasi dengan unit operasi ATC sebelum dipakai sebagai kebijakan.

## Definisi

| Level | Arti | Harapan |
|---|---|---|
| **CRITICAL** | Bahaya langsung; perlu tindakan dalam hitungan detik. | Langka. Selalu ber-identitas dan sudah terkonfirmasi. |
| **WARNING** | Pelanggaran atau bahaya yang sedang berkembang; perlu perhatian dalam hitungan menit, belum ada risiko tabrakan seketika. | Ber-identitas dan terkonfirmasi. |
| **INFO** | Untuk diketahui; tidak perlu tindakan. | Tidak dihitung "perlu tindakan" di Manajemen Alert dan statistik. |

**Target tanpa identitas** (tanpa callsign, registrasi, atau armada kendaraan) **tidak pernah Critical atau Warning**. Paling tinggi Info, dan baru setelah bertahan lebih lama. Itu menahan gema sensor dan track radar tanpa nama.

## Matriks per aturan

| Aturan | Critical | Warning | Info |
|---|---|---|---|
| **Runway Incursion** | Dua target ber-identitas di runway aktif yang sama, dan salah satunya melaju ≥ 30 kt (lepas landas atau mendarat) atau keduanya berjarak ≤ 500 m. | Dua target ber-identitas, tetapi pelan dan berjauhan. | Salah satunya tanpa identitas (15 detik). Satu target tanpa identitas yang sendirian hanya bila `reportUnidentifiedAlone` aktif. |
| **Area Penetration** | Target ber-identitas melintasi area berstatus CLOSED dengan kecepatan ≥ 15 kt. | Target ber-identitas di area terbatas selama 5 detik. | Target tanpa identitas di area terbatas selama 15 detik. |
| **Taxiway/Apron** | Dua target ber-identitas, salah satunya bergerak ≥ 3 kt, saling mendekat dan dalam 10 detik akan sedekat ≤ 25 m. | Saling mendekat dan sudah dalam 80 m (taxiway) atau 40 m (apron); atau target ber-identitas di permukaan RESTRICTED/INACTIVE; atau menyimpang dari rute yang diharapkan. | Salah satu pihaknya tanpa identitas (15 detik). |
| **STCA** | Prediksi pelanggaran pemisahan dalam `predictionTimeSeconds` (bawaan 60 detik). | (belum ada tingkat ini) | (tidak ada) |
| **Deviation** | (tidak ada) | Menyimpang dari rute yang diharapkan. | (tidak ada) |
| **Cuaca** | Pengamatan melewati batas (minima, angin silang, kategori, badai petir di bandara). | Prakiraan TAF melewati batas dalam beberapa jam; badai di sekitar bandara. | (tidak ada) |

Keberadaan bersama di taxiway atau apron **bukan** alert: dua target yang sama-sama diam (parkir berdampingan, antre) atau yang saling menjauh atau mengikuti tidak pernah memicu apa pun. Yang dinilai adalah gerak mendekat dalam beberapa detik ke depan.

## Pengendali derau (berlaku di aturan incursion)

1. **Konfirmasi.** Kondisi harus bertahan `confirmSeconds` (bawaan 3 detik; 5 detik di area terbatas; 15 detik untuk target tanpa identitas) tanpa terputus sebelum alert dibuat. Laporan sesaat dan gema yang hilang dalam sedetik berhenti di sini.
2. **Histeresis batas.** Target dihitung "masuk" hanya bila sedikitnya `enterMarginM` dari tepi poligon (3 sampai 5 m), supaya goyangan di garis batas tidak memicu alert berulang.
3. **Gerak.** Target yang diam tidak "memasuki" apa pun.
4. **Eskalasi, bukan duplikat.** Bila kejadian yang sama makin gawat (Warning menjadi Critical), alert yang ada dinaikkan severity-nya dan disiarkan sebagai pembaruan; tidak dibuat alert kedua.
5. **Buka kembali.** Kejadian yang sama muncul lagi dalam `reopenWindowSeconds` (bawaan 300 detik) setelah alertnya selesai: alert lama dibuka kembali, bukan dibuat baru. Diatur di aturan `ALERT_ENGINE` atau env `ALERT_REOPEN_WINDOW_SECONDS`; 0 mematikan.

## Batasan yang perlu diketahui

- **Masuk runway tanpa izin ATC tidak bisa dideteksi**: data izin tidak tersedia. Yang dideteksi adalah konflik dua target di runway aktif.
- Target tanpa identitas yang nyata (kendaraan tanpa nama) hanya menghasilkan Info.
- Alert yang sudah tersimpan sebelum perubahan ini tidak diubah.

## Mengukur hasilnya

Fitur verifikasi (Valid Alert dan False Alert) memberi persentase alert salah per jenis. Bandingkan sebelum dan sesudah perubahan ini, lalu setel ambang berdasarkan data.
