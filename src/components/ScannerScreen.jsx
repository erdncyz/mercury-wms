import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { applyStockChange, createProduct, findProductByBarcode, findProductByLabelNumber, uploadProductRefImage } from "../services/stockService";

const SUPPORTED_SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.PDF_417
];

function getCameraErrorMessage(err, t) {
  const message = String(err?.message || "").toLowerCase();
  const name = String(err?.name || "").toLowerCase();

  if (message.includes("permission") || name.includes("notallowederror")) {
    return t.cameraPermissionDenied;
  }
  if (message.includes("notfound") || name.includes("notfounderror")) {
    return t.cameraNotFound;
  }
  if (message.includes("secure") || message.includes("https") || !window.isSecureContext) {
    return t.cameraSecureContextRequired;
  }

  return t.cameraError;
}

function playBeep() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = 960;
  gain.gain.value = 0.03;

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();

  setTimeout(() => {
    osc.stop();
    ctx.close();
  }, 120);
}

function emptyProduct() {
  return {
    name: "",
    barcode: "",
    labelNumber: "",
    quantity: 1,
    details: {
      productCode: "",
      containerNumber: "",
      warehouseLocation: "",
      totalProductCount: "",
      unitKg: "",
      totalKg: "",
      widthCm: "",
      lengthCm: "",
      heightCm: "",
      unitM3: "",
      totalM3: "",
      imageRef: "",
      features: ""
    }
  };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function sanitizeDetails(details) {
  const next = {
    productCode: String(details?.productCode || "").trim(),
    containerNumber: String(details?.containerNumber || "").trim(),
    warehouseLocation: String(details?.warehouseLocation || "").trim(),
    imageRef: String(details?.imageRef || "").trim(),
    features: String(details?.features || "").trim(),
    totalProductCount: toNumberOrNull(details?.totalProductCount),
    unitKg: toNumberOrNull(details?.unitKg),
    totalKg: toNumberOrNull(details?.totalKg),
    widthCm: toNumberOrNull(details?.widthCm),
    lengthCm: toNumberOrNull(details?.lengthCm),
    heightCm: toNumberOrNull(details?.heightCm),
    unitM3: toNumberOrNull(details?.unitM3),
    totalM3: toNumberOrNull(details?.totalM3)
  };

  const compact = {};
  Object.entries(next).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string" && !value.trim()) return;
    compact[key] = value;
  });

  return compact;
}

function mapSaveError(error, t) {
  const code = String(error?.code || "").toLowerCase();
  if (code === "permission-denied") {
    return t.permissionDeniedHint;
  }
  return code ? `${t.saveError}: ${code}` : t.saveError;
}

function pickPreferredCamera(cameras) {
  if (!Array.isArray(cameras) || cameras.length === 0) return "";

  const rearCamera = cameras.find((camera) => {
    const label = String(camera?.label || "").toLowerCase();
    return label.includes("back") || label.includes("rear") || label.includes("environment") || label.includes("arka");
  });

  return rearCamera?.id || cameras[0]?.id || "";
}

export default function ScannerScreen({ t }) {
  const scanner = useRef(null);
  const startLockRef = useRef(false);
  const [, setIsStarting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMode, setScanMode] = useState("barcode");
  const [manualMode, setManualMode] = useState(false);
  const [scannedCode, setScannedCode] = useState("");
  const [product, setProduct] = useState(null);
  const [amount, setAmount] = useState(1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyProduct());
  const [refImageFile, setRefImageFile] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [isLoadingCameras, setIsLoadingCameras] = useState(false);

  const stopScan = useCallback(async () => {
    try {
      if (scanner.current?.isScanning) {
        await scanner.current.stop();
      }
      if (scanner.current) {
        await scanner.current.clear();
        scanner.current = null;
      }
    } catch {
      // Ignore stop errors so the next scan attempt can recover cleanly.
    } finally {
      setIsScanning(false);
    }
  }, []);

  const loadCameras = useCallback(async () => {
    setIsLoadingCameras(true);

    try {
      const availableCameras = await Html5Qrcode.getCameras();
      setCameras(availableCameras);
      setSelectedCameraId((prev) => {
        if (prev && availableCameras.some((camera) => camera.id === prev)) {
          return prev;
        }
        return pickPreferredCamera(availableCameras);
      });
      return availableCameras;
    } catch (cameraError) {
      setError(getCameraErrorMessage(cameraError, t));
      return [];
    } finally {
      setIsLoadingCameras(false);
    }
  }, [t]);

  const startScan = useCallback(async () => {
    if (manualMode || startLockRef.current || scanner.current?.isScanning) return;

    startLockRef.current = true;

    setIsStarting(true);
    setError("");

    if (!window.isSecureContext) {
      setError(t.cameraSecureContextRequired);
      setIsStarting(false);
      setIsScanning(false);
      startLockRef.current = false;
      return;
    }

    try {
      let nextCameraId = selectedCameraId;
      if (!nextCameraId) {
        const availableCameras = await loadCameras();
        nextCameraId = pickPreferredCamera(availableCameras);
      }

      if (!nextCameraId) {
        setError(t.cameraNotFound);
        setIsScanning(false);
        return;
      }

      // Match the inventory screen scanner flow: wait for the mount node, then start a fresh instance.
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const mountNode = document.getElementById("scanner-region");
      if (!mountNode) {
        throw new Error("scanner-region-not-ready");
      }

      if (!scanner.current) {
        scanner.current = new Html5Qrcode("scanner-region");
      }

      await scanner.current.start(
        nextCameraId,
        {
          fps: 16,
          qrbox: { width: 280, height: 170 },
          aspectRatio: 1.7778,
          formatsToSupport: SUPPORTED_SCAN_FORMATS,
          disableFlip: false,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          }
        },
        async (decodedText) => {
          setMessage("");
          setError("");
          const normalized = String(decodedText || "").trim();
          setScannedCode(normalized);
          playBeep();

          try {
            const found = await findProductByBarcode(normalized) || await findProductByLabelNumber(normalized);

            setProduct(found);

            if (!found) {
              setManualMode(true);
              setNewProduct((prev) => ({
                ...prev,
                barcode: scanMode === "barcode" ? normalized : prev.barcode,
                labelNumber: scanMode === "label" ? normalized : prev.labelNumber
              }));
            } else {
              setManualMode(false);
            }
          } catch {
            setError(t.saveError);
          }

          await stopScan();
        },
        () => {}
      );

      setIsScanning(true);
      setError("");
    } catch (err) {
      const low = String(err?.message || "").toLowerCase();
      if (low.includes("already") || low.includes("in progress") || low.includes("scanning")) {
        setIsScanning(true);
        setError("");
      } else {
        setError(getCameraErrorMessage(err, t));
        setIsScanning(false);
      }
    } finally {
      setIsStarting(false);
      startLockRef.current = false;
    }
  }, [loadCameras, manualMode, scanMode, selectedCameraId, stopScan, t]);

  useEffect(() => {
    loadCameras().catch(() => {});
  }, [loadCameras]);

  useEffect(() => {
    if (isScanning) {
      setError("");
    }
  }, [isScanning]);

  useEffect(() => {
    startScan();

    return () => {
      stopScan().catch(() => {});
    };
  }, [startScan, stopScan]);

  const resetFlow = async () => {
    setScannedCode("");
    setManualMode(false);
    setProduct(null);
    setAmount(1);
    setError("");
    setMessage("");
    setNewProduct(emptyProduct());
    setRefImageFile(null);
    await startScan();
  };

  const onSwitchScanMode = async (mode) => {
    if (mode === scanMode) return;
    await stopScan();
    setScanMode(mode);
    setScannedCode("");
    setManualMode(false);
    setProduct(null);
    setError("");
    setMessage("");
    setNewProduct(emptyProduct());
    setRefImageFile(null);
  };

  const onOpenManualMode = async () => {
    await stopScan();
    setScannedCode("");
    setProduct(null);
    setError("");
    setMessage("");
    setManualMode(true);
    setNewProduct(emptyProduct());
    setRefImageFile(null);
  };

  const onCameraChange = async (event) => {
    const nextCameraId = String(event.target.value || "");
    if (!nextCameraId || nextCameraId === selectedCameraId) return;

    await stopScan();
    setSelectedCameraId(nextCameraId);
    setScannedCode("");
    setProduct(null);
    setError("");
    setMessage("");
    setManualMode(false);
    setNewProduct(emptyProduct());
    setRefImageFile(null);
  };

  const onScanIdentifierFromManual = async (mode) => {
    await onSwitchScanMode(mode);
    await startScan();
  };

  const onStockAction = async (type) => {
    const parsed = Number(amount);
    if (!parsed || parsed < 1) {
      setError(t.invalidAmount);
      return;
    }

    if (!product) return;

    setError("");
    setMessage("");

    try {
      await applyStockChange({
        productId: product.id,
        productName: product.name,
        amount: parsed,
        type
      });

      setProduct((prev) => {
        const current = Number(prev.quantity || 0);
        const next = type === "IN" ? current + parsed : current - parsed;
        return { ...prev, quantity: next };
      });

      setMessage(t.actionDone);
    } catch (e) {
      setError(e.message === "Insufficient stock" ? t.notEnoughStock : t.saveError);
    }
  };

  const onCreateProduct = async (event) => {
    event.preventDefault();
    if (isSaving) return;

    const resolvedBarcode = scanMode === "barcode"
      ? String(scannedCode || newProduct.barcode || "").trim()
      : String(newProduct.barcode || "").trim();

    const resolvedLabel = scanMode === "label"
      ? String(scannedCode || newProduct.labelNumber || "").trim()
      : String(newProduct.labelNumber || "").trim();

    const detailsName = String(newProduct.details?.productCode || "").trim();
    const manualName = String(newProduct.name || "").trim();
    const parsedQuantity = Number(newProduct.quantity);
    const resolvedQuantity = Number.isFinite(parsedQuantity) ? parsedQuantity : NaN;

    if (!detailsName || !Number.isFinite(resolvedQuantity) || resolvedQuantity < 1) {
      setError(t.productCodeAndQuantityRequired);
      return;
    }

    const resolvedName = manualName || detailsName;

    setError("");
    setMessage("");
    setIsSaving(true);

    try {
      const storageKey = String(resolvedBarcode || resolvedLabel || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "_");
      const preparedDetails = sanitizeDetails(newProduct.details);

      if (refImageFile) {
        try {
          const imageUrl = await uploadProductRefImage(refImageFile, storageKey);
          preparedDetails.imageRef = imageUrl;
        } catch (uploadError) {
          console.error("Ref image upload failed", uploadError);
        }
      }

      const created = await createProduct({
        barcode: resolvedBarcode,
        labelNumber: resolvedLabel,
        name: resolvedName,
        category: "Genel",
        price: 0,
        quantity: resolvedQuantity,
        details: preparedDetails
      });

      setProduct({
        id: created.id,
        barcode: resolvedBarcode,
        labelNumber: resolvedLabel,
        name: resolvedName,
        category: "Genel",
        price: 0,
        quantity: Number(created.quantity),
        details: preparedDetails
      });

      setManualMode(false);
      setScannedCode(resolvedBarcode || resolvedLabel || detailsName);
      setRefImageFile(null);
      setMessage(created.existed ? t.productMerged : t.actionDone);
    } catch (saveError) {
      setError(mapSaveError(saveError, t));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="glass rounded-3xl p-4">
        <h2 className="font-display text-xl font-bold">{t.scannerTitle}</h2>
        <p className="mt-1 text-sm text-slate-400">{t.scannerHint}</p>

        <button
          type="button"
          onClick={resetFlow}
          className="mt-3 w-full rounded-xl bg-cyan-300 px-3 py-3 text-sm font-bold text-slate-900"
        >
          {t.scanAnyCode}
        </button>

        <div className="mt-3 space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">{t.selectCamera}</span>
            <select
              value={selectedCameraId}
              onChange={onCameraChange}
              disabled={isLoadingCameras || cameras.length === 0}
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300 disabled:opacity-60"
            >
              {cameras.length === 0 ? <option value="">{t.loading}</option> : null}
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.label || `${t.cameraLabel} ${camera.id.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-slate-400">{t.scannerFormatsHint}</p>
        </div>

        <button
          type="button"
          onClick={onOpenManualMode}
          className="mt-3 w-full rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-sm font-bold text-amber-200"
        >
          {t.manualAddProduct}
        </button>
      </div>

      {!manualMode ? (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/40 p-2">
          {!scannedCode ? (
            <div id="scanner-region" className="min-h-[220px] rounded-2xl" />
          ) : (
            <button
              type="button"
              onClick={resetFlow}
              className="w-full rounded-2xl bg-cyan-300 px-4 py-4 text-lg font-extrabold text-slate-900"
            >
              {t.scanAgain}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={resetFlow}
          className="w-full rounded-2xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-3 text-sm font-bold text-cyan-200"
        >
          {t.backToScanner}
        </button>
      )}

      {!scannedCode && !manualMode && error && !isScanning ? (
        <button
          type="button"
          onClick={startScan}
          className="w-full rounded-2xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-3 text-sm font-bold text-cyan-200"
        >
          {t.retryCamera}
        </button>
      ) : null}

      {scannedCode && product && !manualMode ? (
        <div className="glass rounded-3xl p-4">
          <p className="text-sm text-cyan-300">{t.productFound}</p>
          <h3 className="mt-1 text-2xl font-bold">{product.name}</h3>
          <p className="mt-1 text-sm text-slate-400">{t.barcode}: {product.barcode}</p>
          <p className="mt-1 text-sm text-slate-400">{t.labelNumber}: {product.labelNumber || "-"}</p>
          <p className="mt-3 text-lg">
            {t.currentStock}: <span className="font-extrabold text-cyan-300">{product.quantity}</span>
          </p>

          <div className="mt-4">
            <label className="text-sm text-slate-300">{t.amount}</label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-4 text-lg outline-none focus:border-cyan-300"
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onStockAction("IN")}
              className="rounded-2xl bg-emerald-500 px-4 py-4 text-lg font-bold"
            >
              {t.addStock}
            </button>
            <button
              type="button"
              onClick={() => onStockAction("OUT")}
              className="rounded-2xl bg-rose-500 px-4 py-4 text-lg font-bold"
            >
              {t.removeStock}
            </button>
          </div>
        </div>
      ) : null}

      {(manualMode || (scannedCode && !product)) ? (
        <form onSubmit={onCreateProduct} className="glass space-y-3 rounded-3xl p-4">
          <p className="text-sm text-amber-300">{scannedCode ? t.productNotFound : t.manualAddHint}</p>
          <p className="text-xs text-cyan-200">{t.requiredManualFields}</p>

          <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">{t.manualProductName}</span>
                <input
                  value={newProduct.name || ""}
                  onChange={(e) => setNewProduct((s) => ({ ...s, name: e.target.value }))}
                  placeholder={t.manualProductName}
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">{t.quantityLabel} *</span>
                <input
                  type="number"
                  min="1"
                  value={newProduct.quantity ?? 1}
                  onChange={(e) => setNewProduct((s) => ({ ...s, quantity: e.target.value }))}
                  placeholder={t.quantityLabel}
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-300">{t.optionalIdentifiersTitle}</p>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">{t.barcode} ({t.optionalFields})</span>
                <input
                  value={newProduct.barcode || ""}
                  onChange={(e) => setNewProduct((s) => ({ ...s, barcode: e.target.value }))}
                  placeholder={t.barcode}
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">{t.labelNumber} ({t.optionalFields})</span>
                <input
                  value={newProduct.labelNumber || ""}
                  onChange={(e) => setNewProduct((s) => ({ ...s, labelNumber: e.target.value }))}
                  placeholder={t.labelNumber}
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                />
              </label>
              <button
                type="button"
                onClick={() => onScanIdentifierFromManual("barcode")}
                className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200"
              >
                {t.scanBarcode}
              </button>
              <button
                type="button"
                onClick={() => onScanIdentifierFromManual("label")}
                className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200"
              >
                {t.scanLabel}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-300">{t.optionalDetailsTitle}</p>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">{t.productCode} *</span>
                <input
                  value={newProduct.details?.productCode || ""}
                  onChange={(e) => setNewProduct((s) => ({ ...s, details: { ...(s.details || {}), productCode: e.target.value } }))}
                  placeholder={t.productCode}
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">{t.warehouseLocation}</span>
                <select
                  value={newProduct.details?.warehouseLocation || ""}
                  onChange={(e) => setNewProduct((s) => ({ ...s, details: { ...(s.details || {}), warehouseLocation: e.target.value } }))}
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                >
                  <option value="">{t.selectWarehouse}</option>
                  <option value={t.warehouseSiteler}>{t.warehouseSiteler}</option>
                  <option value={t.warehouseAkyurt}>{t.warehouseAkyurt}</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">{t.totalProductCount}</span>
                <input
                  value={newProduct.details?.totalProductCount || ""}
                  onChange={(e) => setNewProduct((s) => ({ ...s, details: { ...(s.details || {}), totalProductCount: e.target.value } }))}
                  placeholder={t.totalProductCount}
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                />
              </label>
              <label className="flex items-center rounded-xl border border-dashed border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setRefImageFile(e.target.files?.[0] || null)}
                />
                {refImageFile ? `${t.imageRef}: ${refImageFile.name}` : t.uploadRefImage}
              </label>
            </div>

            <p className="text-[11px] text-slate-400">{t.imageCompressionHint}</p>

            <textarea
              value={newProduct.details?.features || ""}
              onChange={(e) => setNewProduct((s) => ({ ...s, details: { ...(s.details || {}), features: e.target.value } }))}
              placeholder={t.features}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
          </div>

          {error ? <p className="rounded-xl bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p> : null}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full rounded-2xl bg-amber-300 px-4 py-4 text-lg font-extrabold text-slate-900 disabled:opacity-60"
          >
            {isSaving ? t.loading : t.saveProduct}
          </button>
        </form>
      ) : null}

      {!isScanning && error ? <p className="rounded-xl bg-rose-400/10 px-4 py-3 text-sm text-rose-300">{error}</p> : null}
      {message ? <p className="rounded-xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">{message}</p> : null}
    </section>
  );
}
