#!/usr/bin/env node
/**
 * Satış kaydını Firestore'dan siler
 * Kullanım: node delete-sales.js
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Firebase Admin SDK ile başlat
// Service account JSON dosyasının path'ini belirt
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT || 
  path.join(__dirname, 'serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`❌ Service account dosyası bulunamadı: ${serviceAccountPath}`);
  console.error('Lütfen firebase-adminsdk service account JSON dosyasını indir.');
  console.error('Firebase Console > Project Settings > Service Accounts > Generate New Private Key');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function deleteSalesRecord() {
  try {
    console.log('🔍 Satış kaydı aranıyor...');
    
    // BK GRUP SHOWROOM bayisinden VX MID BACK PREMIUM GRİ ürünün 2 adet satış kaydını bul
    const query = db.collection('activity_logs')
      .where('dealerName', '==', 'BK GRUP SHOWROOM')
      .where('productName', '==', 'VX MID BACK PREMIUM GRİ')
      .where('amount', '==', 2)
      .where('stockType', '==', 'OUT');
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      console.log('❌ Eşleşen satış kaydı bulunamadı.');
      console.log('Filtreler:');
      console.log('  - Bayi: BK GRUP SHOWROOM');
      console.log('  - Ürün: VX MID BACK PREMIUM GRİ');
      console.log('  - Miktar: 2');
      console.log('  - Tip: OUT (Satış)');
      process.exit(0);
    }
    
    console.log(`✅ ${snapshot.size} satış kaydı bulundu.\n`);
    
    // Bulduğu kayıtları göster
    snapshot.forEach((doc) => {
      console.log(`📋 Kayıt ID: ${doc.id}`);
      console.log(`   Bayi: ${doc.data().dealerName}`);
      console.log(`   Ürün: ${doc.data().productName}`);
      console.log(`   Miktar: ${doc.data().amount}`);
      console.log(`   Tarih: ${doc.data().timestamp?.toDate()}`);
      console.log('');
    });
    
    // Silme onayı
    if (process.argv[2] !== '--force') {
      console.log('⚠️  Silmek için şu komutu çalıştır:');
      console.log('   node delete-sales.js --force');
      process.exit(0);
    }
    
    // Tüm kayıtları sil
    const batch = db.batch();
    snapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`✅ ${snapshot.size} satış kaydı silindi!`);
    
  } catch (error) {
    console.error('❌ Hata:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Çalıştır
deleteSalesRecord();
