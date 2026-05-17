# Mercury WMS

Mercury WMS, React + Vite + Firebase ile gelistirilmis, mobil agirlikli bir depo ve stok yonetim uygulamasidir.

Uygulama 3 ana is akisina odaklanir:

1. Tarama: kamera ile barkod/etiket okut, urun bul, stok arttir/azalt.
2. Liste: urunleri goruntule, detay ac/kapat, duzenle, tekli/toplu sil.
3. Ice Aktar: Excel/CSV/PDF dosyalarindan urunleri toplu sisteme yukle.

PWA destegi sayesinde uygulama webde hizli acilir ve guncellemeleri otomatik alir.

## Teknoloji Yigini

- React 19
- Vite 8
- Tailwind CSS 4
- Firebase
  - Authentication (email/sifre)
  - Firestore
  - Storage (kurallar mevcut)
- html5-qrcode (kamera tarama)
- xlsx (Excel/CSV okuma)
- pdfjs-dist (PDF parse)
- vite-plugin-pwa (service worker + manifest)

## Ozellikler

### Kimlik Dogrulama

- Email/sifre ile kayit ve giris
- Oturum acik kaldigi surece ekranlar dogrudan erisilebilir
- Profil menusu: kullanici bilgisi + cikis

### Tarama Ekrani

- Barkod ve Etiket No icin ayri tarama modu
- Kamera ile kod okuma
- Urun bulunursa anlik stok artir/azalt islemi
- Urun bulunamazsa manuel urun olusturma akisi
- Kamera hatalari icin kullanici dostu uyari mesajlari

### Stok Listesi

- Arama (urun adi, barkod, etiket no)
- Kart bazli listeleme
- Detaylari goster/gizle
- Duzenle modalinda opsiyonel kimlik ve tablo alanlari
- Urun silme ve toplu silme modu

### Ice Aktar (Import)

- Desteklenen formatlar: .xlsx, .xls, .csv, .pdf
- Baslik esleme (TR/EN kolon adlari)
- PDF icin yapisal parser + fallback parser
- Onizleme (ilk 10 satir)
- Opsiyonel alan dahil et/cikar secimi
- Toplu import sonuc raporu: created/updated/skipped/failed

### Dil ve Deneyim

- TR/EN dil gecisi
- Mobil odakli alt sekme navigasyonu
- PWA auto-update

## Proje Yapisi

src/
- App.jsx: ana kabuk, sekmeler, auth kontrolu
- main.jsx: React bootstrapping, PWA register
- firebase.js: Firebase init ve env validasyonu
- i18n.js: TR/EN metinler
- components/
  - AuthScreen.jsx
  - ScannerScreen.jsx
  - InventoryScreen.jsx
  - ImportScreen.jsx
- services/
  - stockService.js: Firestore islemleri, image compression, import islemleri

Kok dizin:
- firestore.rules
- storage.rules
- netlify.toml

## Gereksinimler

- Node.js 20+ (Netlify ayari da 20)
- npm 9+
- Firebase projesi

## Ortam Degiskenleri

.env dosyanizda su anahtarlar zorunludur:

- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_AUTH_DOMAIN
- VITE_FIREBASE_PROJECT_ID
- VITE_FIREBASE_STORAGE_BUCKET
- VITE_FIREBASE_MESSAGING_SENDER_ID
- VITE_FIREBASE_APP_ID

Eksik anahtar varsa uygulama baslangicta hata firlatir.

## Lokal Kurulum

1. Bagimliliklari yukleyin:

	npm install

2. Ornek env dosyasini kopyalayin:

	cp .env.example .env

3. Firebase degerlerinizi .env icine yazin.

4. Gelistirme sunucusunu baslatin:

	npm run dev

5. Build alin:

	npm run build

6. Build onizleme:

	npm run preview

## NPM Scriptleri

- npm run dev: Vite gelistirme sunucusu
- npm run build: production build
- npm run preview: build cikisinin lokal onizlemesi
- npm run lint: ESLint kontrolu

## Firebase Kurulumu

### 1) Authentication

Firebase Console > Authentication > Sign-in method altindan Email/Password aktif edilmeli.

### 2) Firestore

Firestore Database olusturun ve firestore.rules dosyasindaki kurallari yayinlayin.

Kurallar ozet:
- Sadece login kullanici erisebilir.
- products icin alan tipi ve zorunlu alan validasyonu var.
- stock_logs sadece create edilebilir; update/delete kapali.

### 3) Storage

storage.rules dosyasinda sadece kimligi dogrulanmis kullanicilarin image/* tipinde ve 5MB alti dosya yuklemesine izin verilir.

Not: Mevcut uygulamada referans gorsel yukleme islevi image verisini Data URL olarak kaydeder. Yani aktif akista dosya URL yerine sikistirilmis base64 verisi kullanilir.

## Veri Modeli

### products koleksiyonu

- name: string
- barcode: string
- labelNumber: string (opsiyonel)
- category: string
- quantity: number
- price: number
- imageUrl: string (opsiyonel)
- details: map (opsiyonel alanlar)
  - productCode
  - imageRef
  - features
  - containerNumber
  - qtyPerBox
  - totalBox
  - unitKg
  - totalKg
  - widthCm
  - lengthCm
  - heightCm
  - unitM3
  - totalM3
- updatedAt: timestamp

### stock_logs koleksiyonu

- productId: string
- productName: string
- type: IN | OUT
- amount: number (>0)
- timestamp: timestamp

## Import Kurallari ve Beklenen Veri

### Desteklenen dosyalar

- Excel: .xlsx, .xls
- CSV: .csv
- PDF: .pdf

### Minimum zorunlu alanlar

- Urun adi
- Barkod (veya urun kodundan turetilebilen barkod)
- Adet

### Is kurallari

- Mevcut urun bulunursa quantity artirilir (merge).
- Ayni barkoddan birden fazla satir varsa daha yuksek quantity degeri tercih edilir.
- Opsiyonel kolonlar details altinda saklanir.

## PWA ve Guncelleme Davranisi

- Service worker otomatik kaydolur.
- Yeni versiyon bulundugunda otomatik refresh tetiklenir.
- Dinamik import fetch hatalarinda tek seferlik guvenli sayfa yenileme mekanizmasi vardir.

## Netlify Deploy

netlify.toml hazir oldugu icin standart deploy yeterlidir.

### Otomatik ayarlar

- Build command: npm run build
- Publish directory: dist
- SPA redirect: /* -> /index.html (200)
- Node version: 20

### Ortam degiskenleri

Netlify panelinde .env anahtarlarinin tamami tanimli olmalidir.

## Sorun Giderme

### Kamera baslamiyor

- Uygulamayi localhost veya HTTPS uzerinden acin.
- Tarayici kamera iznini kontrol edin.
- Cihazda kullanilabilir kamera oldugundan emin olun.

### Giris/kayit hatalari

- Email/Password provider aktif mi kontrol edin.
- Authorized domains listesinde aktif domain var mi kontrol edin.
- Env anahtarlarini ve Firebase proje baglantisini dogrulayin.

### Save/import hatalari

- Firestore ve Storage rules yayinlandi mi kontrol edin.
- Kullanici login durumunda mi kontrol edin.
- Import dosyasinda zorunlu alanlarin dolu oldugundan emin olun.

## Gelistirme Notlari

- UI metinleri i18n.js icindedir.
- Stok degisimi islemleri transaction ile yapilir.
- Toplu silme writeBatch ile yapilir.
- Kod tabani mobil oncelikli tasarlanmistir.

## Lisans

Bu repo icin lisans tanimi yapilmadiysa, tum haklari varsayilan olarak repo sahibine aittir.
