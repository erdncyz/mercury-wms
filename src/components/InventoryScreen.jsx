import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { deleteProduct, deleteProductsBulk, subscribeProducts, updateProduct, uploadProductRefImage } from "../services/stockService";

const OPTIONAL_TEXT_FIELDS = ["productCode", "containerNumber", "features", "imageRef"];
const OPTIONAL_NUMERIC_FIELDS = ["qtyPerBox", "totalBox", "unitKg", "totalKg", "widthCm", "lengthCm", "heightCm", "unitM3", "totalM3"];

function sanitizeDetails(details) {
  const next = {};

  OPTIONAL_TEXT_FIELDS.forEach((key) => {
    const value = String(details?.[key] || "").trim();
    if (value) {
      next[key] = value;
    }
  });

  OPTIONAL_NUMERIC_FIELDS.forEach((key) => {
    const raw = details?.[key];
    if (raw === "" || raw === null || raw === undefined) return;
    const parsed = Number(String(raw).replace(",", "."));
    if (Number.isFinite(parsed)) {
      next[key] = parsed;
    }
  });

  return next;
}

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

export default function InventoryScreen({ t }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState([]);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [refImageFile, setRefImageFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const scanner = useRef(null);
  const [scannerTarget, setScannerTarget] = useState("");
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [scanError, setScanError] = useState("");

  useEffect(() => {
    const unsub = subscribeProducts((rows) => setProducts(rows));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;

    return products.filter((p) => {
      const name = String(p.name || "").toLowerCase();
      const barcode = String(p.barcode || "").toLowerCase();
      const labelNumber = String(p.labelNumber || "").toLowerCase();
      return name.includes(q) || barcode.includes(q) || labelNumber.includes(q);
    });
  }, [products, search]);

  const openEdit = (product) => {
    setError("");
    setMessage("");
    setRefImageFile(null);
    setEditing({
      id: product.id,
      name: product.name || "",
      barcode: product.barcode || "",
      labelNumber: product.labelNumber || "",
      category: product.category || "",
      quantity: Number(product.quantity || 0),
      price: Number(product.price || 0),
      imageUrl: product.imageUrl || "",
      details: product.details || {}
    });
    setScannerTarget("");
    setScanError("");
  };

  const stopInlineScanner = useCallback(async () => {
    try {
      if (scanner.current?.isScanning) {
        await scanner.current.stop();
      }
      if (scanner.current) {
        await scanner.current.clear();
        scanner.current = null;
      }
    } catch {
      // Ignore scanner stop errors to keep modal close flow smooth.
    } finally {
      setScannerTarget("");
      setIsStartingScan(false);
    }
  }, []);

  const onStartScanFor = useCallback(async (target) => {
    if (!editing || !target || isStartingScan || scannerTarget) return;

    setScanError("");

    if (!window.isSecureContext) {
      setScanError(t.cameraSecureContextRequired);
      return;
    }

    setIsStartingScan(true);
    setScannerTarget(target);

    try {
      // Wait one frame so scanner container is rendered before Html5Qrcode starts.
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const mountNode = document.getElementById("inventory-edit-scanner-region");
      if (!mountNode) {
        throw new Error("scanner-region-not-ready");
      }

      if (!scanner.current) {
        scanner.current = new Html5Qrcode("inventory-edit-scanner-region");
      }

      await scanner.current.start(
        { facingMode: "environment" },
        {
          fps: 16,
          qrbox: { width: 280, height: 170 },
          aspectRatio: 1.7778
        },
        async (decodedText) => {
          const normalized = String(decodedText || "").trim();
          setEditing((prev) => {
            if (!prev) return prev;
            return { ...prev, [target]: normalized };
          });
          await stopInlineScanner();
        }
      );
    } catch (err) {
      setScanError(getCameraErrorMessage(err, t));
      setScannerTarget("");
    } finally {
      setIsStartingScan(false);
    }
  }, [editing, isStartingScan, scannerTarget, stopInlineScanner, t]);

  const closeEditModal = useCallback(async () => {
    await stopInlineScanner();
    setEditing(null);
    setRefImageFile(null);
    setScanError("");
  }, [stopInlineScanner]);

  useEffect(() => {
    if (!editing) {
      stopInlineScanner().catch(() => {});
    }
  }, [editing, stopInlineScanner]);

  useEffect(() => {
    return () => {
      stopInlineScanner().catch(() => {});
    };
  }, [stopInlineScanner]);

  const onDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteProduct(pendingDelete.id);
      setMessage(t.deleteSuccess);
      setPendingDelete(null);
    } catch {
      setError(t.saveError);
    }
  };

  const onToggleBulkMode = () => {
    setBulkMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedIds([]);
      }
      return next;
    });
  };

  const onToggleSelected = (productId) => {
    setSelectedIds((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      }
      return [...prev, productId];
    });
  };

  const onToggleExpanded = (productId) => {
    setExpandedIds((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      }
      return [...prev, productId];
    });
  };

  const onDeleteSelected = async () => {
    if (selectedIds.length === 0) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      await deleteProductsBulk(selectedIds);
      setSelectedIds([]);
      setBulkMode(false);
      setPendingBulkDelete(false);
      setMessage(t.bulkDeleteSuccess.replace("{count}", String(selectedIds.length)));
    } catch {
      setError(t.saveError);
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = async (event) => {
    event.preventDefault();
    if (!editing) return;
    if (!editing.name) {
      setError(t.fillAll);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const nextDetails = { ...(editing.details || {}) };

      if (refImageFile) {
        const uploadedRefUrl = await uploadProductRefImage(refImageFile, editing.id);
        nextDetails.imageRef = uploadedRefUrl;
      }

      await updateProduct(editing.id, {
        ...editing,
        barcode: String(editing.barcode || "").trim(),
        labelNumber: String(editing.labelNumber || "").trim(),
        details: sanitizeDetails(nextDetails)
      });

      await closeEditModal();
      setMessage(t.updateSuccess);
    } catch {
      setError(t.saveError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="glass rounded-3xl p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-4 text-base outline-none focus:border-cyan-300"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleBulkMode}
            className="rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-sm font-bold text-amber-200"
          >
            {bulkMode ? t.exitBulkDeleteMode : t.bulkDeleteMode}
          </button>

          {bulkMode ? (
            <>
              <span className="text-xs text-slate-300">{t.selectedCount.replace("{count}", String(selectedIds.length))}</span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-slate-200"
              >
                {t.clearSelection}
              </button>
              <button
                type="button"
                disabled={selectedIds.length === 0 || busy}
                onClick={() => setPendingBulkDelete(true)}
                className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-300 disabled:opacity-50"
              >
                {t.deleteSelected}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="max-h-[70vh] space-y-3 overflow-auto pr-1">
        {filtered.length === 0 ? (
          <div className="glass rounded-2xl px-4 py-4 text-sm text-slate-300">{products.length === 0 ? t.emptyState : t.loading}</div>
        ) : null}

        {filtered.map((p) => {
          const qty = Number(p.quantity || 0);
          const cardImage = String(p.details?.imageRef || p.imageUrl || "").trim();
          const details = p.details || {};
          const isExpanded = expandedIds.includes(p.id);

          const basePairs = [
            { key: t.barcode, value: p.barcode || "-" },
            { key: t.labelNumber, value: p.labelNumber || "-" },
            { key: t.category, value: p.category || "-" },
            { key: t.price, value: Number(p.price || 0).toFixed(2) },
            { key: t.quantityLabel, value: String(qty) }
          ];

          const optionalPairs = [
            { key: t.productCode, value: details.productCode },
            { key: t.containerNumber, value: details.containerNumber },
            { key: t.qtyPerBox, value: details.qtyPerBox },
            { key: t.totalBox, value: details.totalBox },
            { key: t.unitKg, value: details.unitKg },
            { key: t.totalKg, value: details.totalKg },
            { key: t.widthCm, value: details.widthCm },
            { key: t.lengthCm, value: details.lengthCm },
            { key: t.heightCm, value: details.heightCm },
            { key: t.unitM3, value: details.unitM3 },
            { key: t.totalM3, value: details.totalM3 }
          ].filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== "");

          const hasFeatures = typeof details.features === "string" && details.features.trim().length > 0;

          return (
            <article key={p.id} className="glass rounded-2xl p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex items-start gap-2">
                <div className="flex items-start gap-2.5">
                  {cardImage ? (
                    <img src={cardImage} alt={p.name} className="h-16 w-16 rounded-lg object-cover border border-white/10 shrink-0 sm:h-20 sm:w-20" />
                  ) : (
                    <div className="h-16 w-16 rounded-lg border border-white/10 bg-slate-900/40 sm:h-20 sm:w-20" />
                  )}

                  <div>
                    <h3 className="text-lg font-bold leading-tight text-slate-100 sm:text-xl">{p.name}</h3>
                  </div>
                </div>
              </div>

              <div className="mt-2.5 rounded-xl border border-white/10 bg-slate-900/30 p-2">
                <button
                  type="button"
                  onClick={() => onToggleExpanded(p.id)}
                  className="w-full rounded-lg border border-cyan-300/20 bg-slate-950/50 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-cyan-200"
                >
                  {isExpanded ? t.hideDetails : t.showDetails}
                </button>

                {isExpanded ? (
                  <>
                    <div className="mt-2 grid gap-x-3 gap-y-1 text-xs md:grid-cols-2">
                      {basePairs.map((item) => (
                        <p key={item.key} className="text-slate-300">
                          <span className="text-slate-500">{item.key}:</span> {item.value}
                        </p>
                      ))}
                      {optionalPairs.map((item) => (
                        <p key={item.key} className="text-slate-300">
                          <span className="text-slate-500">{item.key}:</span> {String(item.value)}
                        </p>
                      ))}
                    </div>

                    {hasFeatures ? (
                      <p className="mt-2 text-xs text-slate-300">
                        <span className="text-slate-500">{t.features}:</span> {details.features}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>

              {bulkMode ? (
                <label className="mt-2.5 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/30 px-2.5 py-1.5 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(p.id)}
                    onChange={() => onToggleSelected(p.id)}
                    className="h-4 w-4 accent-cyan-300"
                  />
                  {t.selectForBulkDelete}
                </label>
              ) : null}

              {!bulkMode ? (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-sm font-semibold text-cyan-200"
                  >
                    {t.editProduct}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(p)}
                    className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-sm font-semibold text-rose-300"
                  >
                    {t.deleteProduct}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
          <form onSubmit={onSaveEdit} className="glass w-full max-w-lg rounded-3xl p-4 space-y-3">
            <h3 className="font-display text-xl font-bold">{t.editProduct}</h3>

            <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-300">{t.optionalIdentifiersTitle}</p>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.barcode}</span>
                  <input
                    value={editing.barcode ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, barcode: e.target.value }))}
                    placeholder={t.barcode}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.labelNumber}</span>
                  <input
                    value={editing.labelNumber ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, labelNumber: e.target.value }))}
                    placeholder={t.labelNumber}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !!scannerTarget || isStartingScan}
                  onClick={() => onStartScanFor("barcode")}
                  className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50"
                >
                  {t.scanBarcode}
                </button>
                <button
                  type="button"
                  disabled={busy || !!scannerTarget || isStartingScan}
                  onClick={() => onStartScanFor("labelNumber")}
                  className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50"
                >
                  {t.scanLabel}
                </button>
              </div>

              {scannerTarget ? (
                <>
                  <div id="inventory-edit-scanner-region" className="h-[190px] overflow-hidden rounded-xl border border-cyan-300/30 bg-slate-950/70" />
                  <button
                    type="button"
                    onClick={() => stopInlineScanner()}
                    className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200"
                  >
                    {t.cancel}
                  </button>
                </>
              ) : null}

              {scanError ? <p className="text-xs text-rose-300">{scanError}</p> : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-300">{t.optionalDetailsTitle}</p>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.productCode}</span>
                  <input
                    value={editing.details?.productCode ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), productCode: e.target.value } }))}
                    placeholder={t.productCode}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.containerNumber}</span>
                  <input
                    value={editing.details?.containerNumber ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), containerNumber: e.target.value } }))}
                    placeholder={t.containerNumber}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.qtyPerBox}</span>
                  <input
                    value={editing.details?.qtyPerBox ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), qtyPerBox: e.target.value } }))}
                    placeholder={t.qtyPerBox}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.totalBox}</span>
                  <input
                    value={editing.details?.totalBox ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), totalBox: e.target.value } }))}
                    placeholder={t.totalBox}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.unitKg}</span>
                  <input
                    value={editing.details?.unitKg ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), unitKg: e.target.value } }))}
                    placeholder={t.unitKg}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.totalKg}</span>
                  <input
                    value={editing.details?.totalKg ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), totalKg: e.target.value } }))}
                    placeholder={t.totalKg}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.widthCm}</span>
                  <input
                    value={editing.details?.widthCm ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), widthCm: e.target.value } }))}
                    placeholder={t.widthCm}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.lengthCm}</span>
                  <input
                    value={editing.details?.lengthCm ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), lengthCm: e.target.value } }))}
                    placeholder={t.lengthCm}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.heightCm}</span>
                  <input
                    value={editing.details?.heightCm ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), heightCm: e.target.value } }))}
                    placeholder={t.heightCm}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.unitM3}</span>
                  <input
                    value={editing.details?.unitM3 ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), unitM3: e.target.value } }))}
                    placeholder={t.unitM3}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.totalM3}</span>
                  <input
                    value={editing.details?.totalM3 ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), totalM3: e.target.value } }))}
                    placeholder={t.totalM3}
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

              {editing.details?.imageRef ? (
                <img src={editing.details.imageRef} alt={t.imageRef} className="h-20 w-20 rounded-xl object-cover border border-white/10" />
              ) : null}

              <p className="text-[11px] text-slate-400">{t.imageCompressionHint}</p>

              <textarea
                value={editing.details?.features ?? ""}
                onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), features: e.target.value } }))}
                placeholder={t.features}
                rows={3}
                className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => closeEditModal()} className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-bold">
                {t.cancel}
              </button>
              <button type="submit" disabled={busy} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-extrabold text-slate-900 disabled:opacity-60">
                {busy ? t.loading : t.saveChanges}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
          <div className="glass w-full max-w-md rounded-3xl p-4">
            <h3 className="font-display text-lg font-bold text-slate-100">{t.deleteProduct}</h3>
            <p className="mt-2 text-sm text-slate-300">{t.deleteConfirm.replace("{name}", pendingDelete.name || "")}</p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-bold"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-extrabold text-white"
              >
                {t.deleteProduct}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingBulkDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
          <div className="glass w-full max-w-md rounded-3xl p-4">
            <h3 className="font-display text-lg font-bold text-slate-100">{t.deleteSelected}</h3>
            <p className="mt-2 text-sm text-slate-300">{t.bulkDeleteConfirm.replace("{count}", String(selectedIds.length))}</p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPendingBulkDelete(false)}
                className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-bold"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={busy || selectedIds.length === 0}
                onClick={onDeleteSelected}
                className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-extrabold text-white disabled:opacity-60"
              >
                {busy ? t.loading : t.deleteSelected}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="rounded-xl bg-rose-400/10 px-4 py-3 text-sm text-rose-300">{error}</p> : null}
      {message ? <p className="rounded-xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">{message}</p> : null}
    </section>
  );
}
