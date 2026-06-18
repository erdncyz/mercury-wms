import {
  addDoc,
  collection,
  deleteDoc,
  getDoc,
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
import { auth, db } from "../firebase";

function getActor() {
  const current = auth.currentUser;
  return {
    userId: current?.uid || "",
    userName: current?.displayName || current?.email || ""
  };
}

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeChangedFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field) => String(field || "").trim())
    .filter((field) => Boolean(field))
    .slice(0, 30);
}

function buildActivitySummary(payload) {
  const {
    action,
    amount,
    stockType,
    beforeStock,
    afterStock,
    destination,
    dealerName,
    warehouseFrom,
    warehouseTo,
    changedFields
  } = payload;

  const absAmount = Math.abs(toSafeNumber(amount, 0));
  const hasBeforeAfter = Number.isFinite(Number(beforeStock)) && Number.isFinite(Number(afterStock));

  if (action === "stock_in" || action === "stock_out") {
    const op = stockType === "OUT" || action === "stock_out" ? "Stok dusuruldu" : "Stok artirildi";
    const base = absAmount > 0 ? `${op}: ${absAmount}` : op;
    const stockTrail = hasBeforeAfter ? ` (${beforeStock} -> ${afterStock})` : "";

    if (warehouseFrom && warehouseTo) {
      return `${base}${stockTrail} | ${warehouseFrom} -> ${warehouseTo}`;
    }
    if (warehouseTo) {
      return `${base}${stockTrail} | Hedef: ${warehouseTo}`;
    }
    if (destination) {
      return `${base}${stockTrail} | Gonderim: ${destination}`;
    }
    if (dealerName) {
      return `${base}${stockTrail} | Bayi: ${dealerName}`;
    }
    return `${base}${stockTrail}`;
  }

  if (action === "create") {
    return "Yeni urun kaydi olusturuldu";
  }

  if (action === "update") {
    if (Array.isArray(changedFields) && changedFields.length > 0) {
      return `Urun guncellendi: ${changedFields.join(", ")}`;
    }
    return "Urun guncellendi";
  }

  if (action === "delete") {
    return "Urun silindi";
  }

  return "Islem kaydi";
}

async function logActivity({
  action,
  productId,
  productName,
  amount = 0,
  destination = "",
  source = "",
  stockType = "",
  beforeStock = null,
  afterStock = null,
  dealerId = "",
  dealerName = "",
  warehouseFrom = "",
  warehouseTo = "",
  barcode = "",
  changedFields = []
}) {
  try {
    const actor = getActor();
    const cleanedChangedFields = sanitizeChangedFields(changedFields);
    const summary = buildActivitySummary({
      action,
      amount,
      stockType,
      beforeStock,
      afterStock,
      destination,
      dealerName,
      warehouseFrom,
      warehouseTo,
      changedFields: cleanedChangedFields
    });

    await addDoc(collection(db, "activity_logs"), {
      action,
      productId: String(productId || ""),
      productName: String(productName || "").trim().slice(0, 200) || "-",
      amount: Number.isFinite(Number(amount)) ? Number(amount) : 0,
      destination: String(destination || "").trim().slice(0, 200),
      source: String(source || "").trim().slice(0, 80),
      stockType: String(stockType || "").trim().toUpperCase().slice(0, 8),
      beforeStock: Number.isFinite(Number(beforeStock)) ? Number(beforeStock) : null,
      afterStock: Number.isFinite(Number(afterStock)) ? Number(afterStock) : null,
      dealerId: String(dealerId || "").trim().slice(0, 128),
      dealerName: String(dealerName || "").trim().slice(0, 160),
      warehouseFrom: String(warehouseFrom || "").trim().slice(0, 120),
      warehouseTo: String(warehouseTo || "").trim().slice(0, 120),
      barcode: String(barcode || "").trim().slice(0, 120),
      changedFields: cleanedChangedFields,
      summary,
      userId: actor.userId,
      userName: actor.userName,
      timestamp: serverTimestamp()
    });
  } catch {
    // Activity logging must never block the main operation.
  }
}

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

export async function createProduct(payload, options = {}) {
  const details = payload.details && typeof payload.details === "object" ? payload.details : {};
  const normalizedBarcode = String(payload.barcode || "").trim();
  const normalizedName = String(payload.name || "").trim();
  const normalizedCategory = String(payload.category || "Genel").trim() || "Genel";
  const normalizedImageUrl = String(payload.imageUrl || "").trim();
  const incomingQty = Number(payload.quantity || 0);
  const incomingPrice = Number(payload.price || 0);
  const source = String(options?.source || "").trim();

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

      await logActivity({
        action: "stock_in",
        productId: existing.id,
        productName: normalizedName || existing.name,
        amount: incomingQty,
        source: source || "create_merge"
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

  await logActivity({
    action: "create",
    productId: productRef.id,
    productName: normalizedName,
    amount: incomingQty,
    source: source || "create_product",
    barcode: normalizedBarcode,
    warehouseTo: String(details?.warehouseLocation || "").trim(),
    afterStock: toSafeNumber(details?.totalProductCount, Math.max(0, incomingQty))
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
  const prevSnap = await getDoc(productRef);
  const prevData = prevSnap.exists() ? prevSnap.data() : null;

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

  const changedFields = [];
  if (prevData) {
    if (String(prevData.name || "") !== nextData.name) changedFields.push("name");
    if (String(prevData.barcode || "") !== nextData.barcode) changedFields.push("barcode");
    if (String(prevData.category || "") !== nextData.category) changedFields.push("category");
    if (toSafeNumber(prevData.quantity, 0) !== toSafeNumber(nextData.quantity, 0)) changedFields.push("quantity");
    if (toSafeNumber(prevData.price, 0) !== toSafeNumber(nextData.price, 0)) changedFields.push("price");
    if (String(prevData.imageUrl || "") !== nextData.imageUrl) changedFields.push("imageUrl");

    const prevDetails = prevData.details && typeof prevData.details === "object" ? prevData.details : {};
    const nextDetails = nextData.details && typeof nextData.details === "object" ? nextData.details : {};
    const detailKeys = new Set([...Object.keys(prevDetails), ...Object.keys(nextDetails)]);
    detailKeys.forEach((key) => {
      if (String(prevDetails[key] ?? "") !== String(nextDetails[key] ?? "")) {
        changedFields.push(`details.${key}`);
      }
    });
  }

  await logActivity({
    action: "update",
    productId,
    productName: nextData.name,
    source: "inventory_edit",
    barcode: nextData.barcode,
    changedFields
  });
}

export async function deleteProduct(productId, productName) {
  const productRef = doc(db, "products", productId);
  const beforeSnap = await getDoc(productRef);
  const beforeData = beforeSnap.exists() ? beforeSnap.data() : null;
  await deleteDoc(productRef);

  await logActivity({
    action: "delete",
    productId,
    productName,
    source: "inventory_delete",
    barcode: String(beforeData?.barcode || "").trim(),
    warehouseFrom: String(beforeData?.details?.warehouseLocation || "").trim(),
    beforeStock: toSafeNumber(beforeData?.details?.totalProductCount, null)
  });
}

export async function deleteProductsBulk(products) {
  const items = (Array.isArray(products) ? products : [])
    .map((item) => (typeof item === "string" ? { id: item, name: "" } : item))
    .filter((item) => item && item.id);
  if (items.length === 0) return;

  const batch = writeBatch(db);
  items.forEach((item) => {
    batch.delete(doc(db, "products", item.id));
  });

  await batch.commit();

  for (const item of items) {
    await logActivity({
      action: "delete",
      productId: item.id,
      productName: item.name,
      source: "bulk_delete"
    });
  }
}

export async function applyStockChange({
  productId,
  productName,
  amount,
  type,
  destination = "",
  dealerId = "",
  dealerName = ""
}) {
  const productDoc = doc(db, "products", productId);
  const parsedAmount = Number(amount);
  const normalizedDestination = String(destination || "").trim().slice(0, 200);
  const normalizedDealerId = String(dealerId || "").trim().slice(0, 128);
  const normalizedDealerName = String(dealerName || "").trim().slice(0, 160);
  let beforeStock = 0;
  let afterStock = 0;
  let warehouse = "";
  let barcode = "";

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(productDoc);
    if (!snap.exists()) throw new Error("Product not found");

    const data = snap.data();
    const currentCount = Number(data.details?.totalProductCount || 0);
    const nextCount = type === "IN" ? currentCount + parsedAmount : currentCount - parsedAmount;

    beforeStock = currentCount;
    afterStock = nextCount;
    warehouse = String(data.details?.warehouseLocation || "").trim();
    barcode = String(data.barcode || "").trim();

    if (nextCount < 0) {
      throw new Error("Insufficient stock");
    }

    const nextDetails = { ...(data.details || {}), totalProductCount: nextCount };

    tx.update(productDoc, {
      details: nextDetails,
      updatedAt: serverTimestamp()
    });
  });

  await addDoc(collection(db, "stock_logs"), {
    productId,
    productName,
    type,
    amount: parsedAmount,
    destination: normalizedDestination,
    dealerId: normalizedDealerId,
    dealerName: normalizedDealerName,
    timestamp: serverTimestamp()
  });

  await logActivity({
    action: type === "IN" ? "stock_in" : "stock_out",
    productId,
    productName,
    amount: parsedAmount,
    destination: normalizedDestination,
    source: "scanner_stock_action",
    stockType: type,
    beforeStock,
    afterStock,
    dealerId: normalizedDealerId,
    dealerName: normalizedDealerName,
    warehouseFrom: warehouse,
    warehouseTo: type === "IN" ? warehouse : normalizedDestination,
    barcode
  });
}

function normalizeDealerPayload(payload) {
  return {
    name: String(payload?.name || "").trim().slice(0, 160),
    code: String(payload?.code || "").trim().slice(0, 80),
    contactName: String(payload?.contactName || "").trim().slice(0, 120),
    phone: String(payload?.phone || "").trim().slice(0, 80),
    email: String(payload?.email || "").trim().slice(0, 160),
    city: String(payload?.city || "").trim().slice(0, 120),
    address: String(payload?.address || "").trim().slice(0, 300),
    note: String(payload?.note || "").trim().slice(0, 300)
  };
}

export async function createDealer(payload) {
  const next = normalizeDealerPayload(payload);
  if (!next.name) {
    throw new Error("INVALID_DEALER_NAME");
  }

  const ref = await addDoc(collection(db, "dealers"), {
    ...next,
    updatedAt: serverTimestamp()
  });

  return { id: ref.id, ...next };
}

export function subscribeDealers(callback, max = 500) {
  const q = query(collection(db, "dealers"), orderBy("name", "asc"), limit(max));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function transferStock({ sourceProduct, amount, targetWarehouse, targetProductId }) {
  const parsedAmount = Math.floor(Number(amount));
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  const targetWh = String(targetWarehouse || "").trim();
  if (!targetWh) throw new Error("INVALID_TARGET");
  if (!sourceProduct?.id) throw new Error("INVALID_SOURCE");

  const sourceRef = doc(db, "products", sourceProduct.id);
  let targetLogId = targetProductId || "";
  let sourceBefore = 0;
  let sourceAfter = 0;
  let targetBefore = 0;
  let targetAfter = 0;
  let sourceWarehouse = String(sourceProduct.details?.warehouseLocation || "").trim();
  let targetWarehouseName = targetWh;
  let sourceBarcode = String(sourceProduct.barcode || "").trim();

  await runTransaction(db, async (tx) => {
    const sourceSnap = await tx.get(sourceRef);
    if (!sourceSnap.exists()) throw new Error("Product not found");

    const sourceData = sourceSnap.data();
    const sourceCount = Number(sourceData.details?.totalProductCount || 0);
    if (parsedAmount > sourceCount) throw new Error("Insufficient stock");
    sourceBefore = sourceCount;
    sourceAfter = sourceCount - parsedAmount;
    sourceWarehouse = String(sourceData.details?.warehouseLocation || "").trim();
    sourceBarcode = String(sourceData.barcode || "").trim();

    let targetRef = null;
    let targetSnap = null;
    if (targetProductId) {
      targetRef = doc(db, "products", targetProductId);
      targetSnap = await tx.get(targetRef);
    }

    tx.update(sourceRef, {
      details: { ...(sourceData.details || {}), totalProductCount: sourceCount - parsedAmount },
      updatedAt: serverTimestamp()
    });

    if (targetRef && targetSnap?.exists()) {
      const targetData = targetSnap.data();
      const targetCount = Number(targetData.details?.totalProductCount || 0);
      targetBefore = targetCount;
      targetAfter = targetCount + parsedAmount;
      targetWarehouseName = String(targetData.details?.warehouseLocation || targetWh).trim();
      tx.update(targetRef, {
        details: { ...(targetData.details || {}), totalProductCount: targetCount + parsedAmount },
        updatedAt: serverTimestamp()
      });
    } else {
      const newRef = doc(collection(db, "products"));
      targetLogId = newRef.id;
      const srcDetails = sourceData.details || {};
      targetBefore = 0;
      targetAfter = parsedAmount;
      targetWarehouseName = targetWh;
      tx.set(newRef, {
        name: String(sourceData.name || "-").trim() || "-",
        barcode: String(sourceData.barcode || "").trim(),
        category: String(sourceData.category || "Genel").trim() || "Genel",
        quantity: 0,
        price: Number(sourceData.price || 0),
        imageUrl: String(sourceData.imageUrl || "").trim(),
        details: {
          ...srcDetails,
          warehouseLocation: targetWh,
          totalProductCount: parsedAmount
        },
        updatedAt: serverTimestamp()
      });
    }
  });

  await logActivity({
    action: "stock_out",
    productId: sourceProduct.id,
    productName: sourceProduct.name,
    amount: parsedAmount,
    source: "warehouse_transfer",
    stockType: "OUT",
    beforeStock: sourceBefore,
    afterStock: sourceAfter,
    destination: targetWh,
    warehouseFrom: sourceWarehouse,
    warehouseTo: targetWarehouseName,
    barcode: sourceBarcode
  });

  await logActivity({
    action: "stock_in",
    productId: targetLogId,
    productName: sourceProduct.name,
    amount: parsedAmount,
    source: "warehouse_transfer",
    stockType: "IN",
    beforeStock: targetBefore,
    afterStock: targetAfter,
    warehouseFrom: sourceWarehouse,
    warehouseTo: targetWarehouseName,
    barcode: sourceBarcode
  });
}

export function subscribeProducts(callback) {
  const q = query(collection(db, "products"), orderBy("updatedAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeActivityLogs(callback, max = 300) {
  const q = query(collection(db, "activity_logs"), orderBy("timestamp", "desc"), limit(max));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function deleteActivityLog(logId) {
  const id = String(logId || "").trim();
  if (!id) return;
  await deleteDoc(doc(db, "activity_logs", id));
}

export async function deleteActivityLogsBulk(logIds) {
  const ids = (Array.isArray(logIds) ? logIds : [])
    .map((id) => String(id || "").trim())
    .filter((id) => Boolean(id));

  if (ids.length === 0) return;

  const batch = writeBatch(db);
  ids.forEach((id) => {
    batch.delete(doc(db, "activity_logs", id));
  });
  await batch.commit();
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
        await createProduct(row, { source: "import" });
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

        await logActivity({
          action: "stock_in",
          productId: existing.id,
          productName: row.name,
          amount: incomingQty,
          source: "import",
          stockType: "IN",
          beforeStock: currentQty,
          afterStock: nextQty,
          barcode: row.barcode
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
