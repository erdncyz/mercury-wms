import {
  addDoc,
  collection,
  deleteDoc,
  updateDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  doc,
  onSnapshot,
  orderBy,
  writeBatch
} from "firebase/firestore";
import { db } from "../firebase";

async function compressImageFile(file, { maxSide = 640, quality = 0.5 } = {}) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    return file;
  }

  const imageUrl = URL.createObjectURL(file);

  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const targetWidth = Math.max(1, Math.round(bitmap.width * ratio));
    const targetHeight = Math.max(1, Math.round(bitmap.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/jpeg", quality);
    });

    if (!blob) return file;

    return blob;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("DATA_URL_CONVERSION_FAILED"));
    reader.readAsDataURL(blob);
  });
}

export async function findProductByBarcode(barcode) {
  const q = query(collection(db, "products"), where("barcode", "==", barcode), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const item = snap.docs[0];
  return { id: item.id, ...item.data() };
}

export async function findExistingProduct({ barcode }) {
  const normalizedBarcode = String(barcode || "").trim();

  if (normalizedBarcode) {
    const byBarcode = await findProductByBarcode(normalizedBarcode);
    if (byBarcode) return byBarcode;
  }

  return null;
}

export async function createProduct(payload) {
  const details = payload.details && typeof payload.details === "object" ? payload.details : {};
  const normalizedBarcode = String(payload.barcode || "").trim();
  const normalizedName = String(payload.name || "").trim();
  const normalizedCategory = String(payload.category || "Genel").trim() || "Genel";
  const normalizedImageUrl = String(payload.imageUrl || "").trim();
  const incomingQty = Number(payload.quantity || 0);
  const incomingPrice = Number(payload.price || 0);

  const existing = await findExistingProduct({ barcode: normalizedBarcode });

  if (existing) {
    const productRef = doc(db, "products", existing.id);
    const nextQty = Number(existing.quantity || 0) + Math.max(0, incomingQty);

    await runTransaction(db, async (tx) => {
      tx.update(productRef, {
        name: normalizedName || existing.name,
        barcode: normalizedBarcode || existing.barcode,
        category: normalizedCategory || existing.category,
        quantity: nextQty,
        price: Number.isFinite(incomingPrice) && incomingPrice > 0 ? incomingPrice : Number(existing.price || 0),
        imageUrl: normalizedImageUrl || existing.imageUrl || "",
        details: { ...(existing.details || {}), ...details },
        updatedAt: serverTimestamp()
      });
    });

    if (incomingQty > 0) {
      await addDoc(collection(db, "stock_logs"), {
        productId: existing.id,
        productName: normalizedName || existing.name,
        type: "IN",
        amount: incomingQty,
        timestamp: serverTimestamp()
      });
    }

    return {
      id: existing.id,
      existed: true,
      quantity: nextQty
    };
  }

  const productRef = await addDoc(collection(db, "products"), {
    name: normalizedName,
    barcode: normalizedBarcode,
    category: normalizedCategory,
    quantity: incomingQty,
    price: incomingPrice,
    imageUrl: normalizedImageUrl,
    details,
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, "stock_logs"), {
    productId: productRef.id,
    productName: normalizedName,
    type: "IN",
    amount: incomingQty,
    timestamp: serverTimestamp()
  });

  return {
    id: productRef.id,
    existed: false,
    quantity: incomingQty
  };
}

export async function uploadProductImage(file, productId) {
  const compressed = await compressImageFile(file, { maxSide: 640, quality: 0.45 });
  return blobToDataUrl(compressed);
}

export async function uploadProductRefImage(file, productId) {
  const compressed = await compressImageFile(file, { maxSide: 640, quality: 0.45 });
  return blobToDataUrl(compressed);
}

export async function updateProduct(productId, payload) {
  const productRef = doc(db, "products", productId);
  const nextData = {
    name: String(payload.name || "").trim(),
    barcode: String(payload.barcode || "").trim(),
    category: String(payload.category || "Genel").trim() || "Genel",
    quantity: Number(payload.quantity || 0),
    price: Number(payload.price || 0),
    imageUrl: String(payload.imageUrl || "").trim(),
    details: payload.details && typeof payload.details === "object" ? payload.details : {},
    updatedAt: serverTimestamp()
  };

  await updateDoc(productRef, nextData);
}

export async function deleteProduct(productId) {
  await deleteDoc(doc(db, "products", productId));
}

export async function deleteProductsBulk(productIds) {
  const ids = Array.isArray(productIds) ? productIds.filter(Boolean) : [];
  if (ids.length === 0) return;

  const batch = writeBatch(db);
  ids.forEach((id) => {
    batch.delete(doc(db, "products", id));
  });

  await batch.commit();
}

export async function applyStockChange({ productId, productName, amount, type }) {
  const productDoc = doc(db, "products", productId);
  const parsedAmount = Number(amount);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(productDoc);
    if (!snap.exists()) throw new Error("Product not found");

    const currentQty = Number(snap.data().quantity || 0);
    const nextQty = type === "IN" ? currentQty + parsedAmount : currentQty - parsedAmount;

    if (nextQty < 0) {
      throw new Error("Insufficient stock");
    }

    tx.update(productDoc, {
      quantity: nextQty,
      updatedAt: serverTimestamp()
    });
  });

  await addDoc(collection(db, "stock_logs"), {
    productId,
    productName,
    type,
    amount: parsedAmount,
    timestamp: serverTimestamp()
  });
}

export function subscribeProducts(callback) {
  const q = query(collection(db, "products"), orderBy("updatedAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

function normalizeImportedRow(row) {
  const quantity = Number(String(row.quantity ?? 0).replace(",", "."));
  const price = Number(String(row.price ?? 0).replace(",", "."));

  const details = row.details && typeof row.details === "object" ? row.details : {};

  return {
    name: String(row.name || "").trim(),
    barcode: String(row.barcode || "").trim(),
    category: String(row.category || "Genel").trim() || "Genel",
    quantity: Number.isFinite(quantity) ? quantity : NaN,
    price: Number.isFinite(price) ? price : NaN,
    imageUrl: String(row.imageUrl || "").trim(),
    details
  };
}

export async function importProductsBulk(rawRows, onProgress) {
  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  for (let i = 0; i < rawRows.length; i += 1) {
    const rowNumber = i + 1;
    const row = normalizeImportedRow(rawRows[i]);

    if (typeof onProgress === "function") {
      onProgress({ current: rowNumber, total: rawRows.length });
    }

    if (!row.name || !row.barcode || Number.isNaN(row.quantity) || Number.isNaN(row.price) || row.quantity < 0 || row.price < 0) {
      result.skipped += 1;
      result.errors.push({ row: rowNumber, reason: "INVALID_ROW" });
      continue;
    }

    try {
      const existing = await findExistingProduct({ barcode: row.barcode });

      if (!existing) {
        await createProduct(row);
        result.created += 1;
        continue;
      }

      const currentQty = Number(existing.quantity || 0);
      const incomingQty = Number(row.quantity || 0);
      const nextQty = currentQty + Math.max(0, incomingQty);

      await runTransaction(db, async (tx) => {
        const productRef = doc(db, "products", existing.id);
        tx.update(productRef, {
          name: row.name,
          barcode: row.barcode || existing.barcode,
          category: row.category,
          quantity: nextQty,
          price: Number(row.price),
          imageUrl: row.imageUrl || existing.imageUrl || "",
          details: { ...(existing.details || {}), ...(row.details || {}) },
          updatedAt: serverTimestamp()
        });
      });

      if (incomingQty > 0) {
        await addDoc(collection(db, "stock_logs"), {
          productId: existing.id,
          productName: row.name,
          type: "IN",
          amount: incomingQty,
          timestamp: serverTimestamp()
        });
      }

      result.updated += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ row: rowNumber, reason: error?.message || "UNKNOWN_ERROR" });
    }
  }

  return result;
}
