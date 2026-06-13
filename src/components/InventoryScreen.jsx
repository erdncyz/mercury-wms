import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { HiOutlineCamera, HiOutlineXMark } from "react-icons/hi2";
import { createProduct, deleteProduct, deleteProductsBulk, subscribeProducts, updateProduct, uploadProductRefImage } from "../services/stockService";

const OPTIONAL_TEXT_FIELDS = ["productCode", "containerNumber", "warehouseLocation", "features", "imageRef"];
const OPTIONAL_NUMERIC_FIELDS = ["totalProductCount", "unitKg", "totalKg", "widthCm", "lengthCm", "heightCm", "unitM3", "totalM3"];

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

function emptyEditableProduct() {
  return {
    name: "",
    barcode: "",
    labelNumber: "",
    category: "Genel",
    quantity: 1,
    price: 0,
    imageUrl: "",
    details: {}
  };
}

function mapSaveError(error, t) {
  const code = String(error?.code || "").toLowerCase();
  if (code === "permission-denied") {
    return t.permissionDeniedHint;
  }
  return code ? `${t.saveError}: ${code}` : t.saveError;
}

function getImageFileFromClipboardEvent(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => String(item.type || "").startsWith("image/"));
  return imageItem?.getAsFile() || null;
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
  const searchScanner = useRef(null);
  const [scannerTarget, setScannerTarget] = useState("");
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [scanError, setScanError] = useState("");
  const [isSearchScannerOpen, setIsSearchScannerOpen] = useState(false);
  const [isStartingSearchScan, setIsStartingSearchScan] = useState(false);
  const [searchScanError, setSearchScanError] = useState("");
  const isAnyOverlayOpen = Boolean(editing || pendingDelete || pendingBulkDelete);

  const onPasteRefImage = useCallback((event) => {
    const pastedFile = getImageFileFromClipboardEvent(event);
    if (!pastedFile) return;
    event.preventDefault();
    setRefImageFile(pastedFile);
    setError("");
  }, []);

  useEffect(() => {
    const unsub = subscribeProducts((rows) => setProducts(rows));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const normalizeForSearch = (value) => String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[-_]/g, "");
    const q = normalizeForSearch(search.trim());
    if (!q) return products;

    return products.filter((p) => {
      const name = normalizeForSearch(p.name);
      const barcode = normalizeForSearch(p.barcode);
      const labelNumber = normalizeForSearch(p.labelNumber);
      const productCode = normalizeForSearch(p.details?.productCode || p.productCode || p.details?.productcode);

      return name.includes(q) || barcode.includes(q) || labelNumber.includes(q) || productCode.includes(q);
    });
  }, [products, search]);

  const isCreating = Boolean(editing && !editing.id);

  const openCreate = () => {
    setError("");
    setMessage("");
    setRefImageFile(null);
    setEditing(emptyEditableProduct());
    setScannerTarget("");
    setScanError("");
  };

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

  const stopSearchScanner = useCallback(async () => {
    try {
      if (searchScanner.current?.isScanning) {
        await searchScanner.current.stop();
      }
      if (searchScanner.current) {
        await searchScanner.current.clear();
        searchScanner.current = null;
      }
    } catch {
      // Ignore scanner stop errors to keep the search flow smooth.
    } finally {
      setIsSearchScannerOpen(false);
      setIsStartingSearchScan(false);
    }
  }, []);

  const applyScannedSearch = useCallback((value) => {
    const normalized = String(value || "").trim();
    if (!normalized) return;

    setSearch(normalized);

    const matchedProduct = products.find((product) => {
      const barcode = String(product.barcode || "").trim().toLowerCase();
      const labelNumber = String(product.labelNumber || "").trim().toLowerCase();
      const query = normalized.toLowerCase();
      return barcode === query || labelNumber === query;
    });

    if (matchedProduct?.id) {
      setExpandedIds((prev) => (prev.includes(matchedProduct.id) ? prev : [...prev, matchedProduct.id]));
      setMessage(t.productFound);
      setError("");
      return;
    }

    setMessage("");
    setError(t.productNotFound);
  }, [products, t]);

  const onStartSearchScan = useCallback(async () => {
    if (isStartingSearchScan || isSearchScannerOpen || scannerTarget) return;

    setSearchScanError("");
    setMessage("");
    setError("");

    if (!window.isSecureContext) {
      setSearchScanError(t.cameraSecureContextRequired);
      return;
    }

    setIsStartingSearchScan(true);
    setIsSearchScannerOpen(true);

    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const mountNode = document.getElementById("inventory-search-scanner-region");
      if (!mountNode) {
        throw new Error("search-scanner-region-not-ready");
      }

      if (!searchScanner.current) {
        searchScanner.current = new Html5Qrcode("inventory-search-scanner-region");
      }

      await searchScanner.current.start(
        { facingMode: "environment" },
        {
          fps: 16,
          qrbox: { width: 280, height: 170 },
          aspectRatio: 1.7778
        },
        async (decodedText) => {
          applyScannedSearch(decodedText);
          await stopSearchScanner();
        }
      );
    } catch (err) {
      setSearchScanError(getCameraErrorMessage(err, t));
      setIsSearchScannerOpen(false);
    } finally {
      setIsStartingSearchScan(false);
    }
  }, [applyScannedSearch, isSearchScannerOpen, isStartingSearchScan, scannerTarget, stopSearchScanner, t]);

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
    if (!editing) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeEditModal().catch(() => {});
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeEditModal, editing]);

  useEffect(() => {
    return () => {
      stopInlineScanner().catch(() => {});
    };
  }, [stopInlineScanner]);

  useEffect(() => {
    return () => {
      stopSearchScanner().catch(() => {});
    };
  }, [stopSearchScanner]);

  useEffect(() => {
    if (!isAnyOverlayOpen) return;

    const body = document.body;
    const html = document.documentElement;

    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscrollBehavior = body.style.overscrollBehavior;
    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlOverscrollBehavior = html.style.overscrollBehavior;

    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscrollBehavior;
      html.style.overflow = prevHtmlOverflow;
      html.style.overscrollBehavior = prevHtmlOverscrollBehavior;
    };
  }, [isAnyOverlayOpen]);

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
    if (editing.id && !String(editing.name || "").trim()) {
      setError(t.fillAll);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const nextDetails = { ...(editing.details || {}) };
      const detailsName = String(nextDetails.productCode || "").trim();
      const manualName = String(editing.name || "").trim();
      const normalizedQuantity = Math.max(0, Number(editing.quantity || 0));

      const normalizedBarcode = String(editing.barcode || "").trim();
      const normalizedLabelNumber = String(editing.labelNumber || "").trim();

      if (!editing.id && !detailsName) {
        setError(t.productCodeAndQuantityRequired);
        return;
      }

      if (refImageFile) {
        const uploadKey = String(editing.id || normalizedBarcode || normalizedLabelNumber || editing.name || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "_");
        const uploadedRefUrl = await uploadProductRefImage(refImageFile, uploadKey);
        nextDetails.imageRef = uploadedRefUrl;
      }

      const payload = {
        ...editing,
        name: editing.id
          ? String(editing.name || "").trim()
          : manualName || detailsName,
        barcode: normalizedBarcode,
        labelNumber: normalizedLabelNumber,
        category: editing.id ? String(editing.category || "Genel").trim() || "Genel" : "Genel",
        quantity: editing.id ? normalizedQuantity : 1,
        price: editing.id ? Math.max(0, Number(editing.price || 0)) : 0,
        details: sanitizeDetails(nextDetails)
      };

      if (!payload.name) {
        setError(editing.id ? t.fillAll : t.productCodeAndQuantityRequired);
        return;
      }

      if (editing.id) {
        await updateProduct(editing.id, payload);
        setMessage(t.updateSuccess);
      } else {
        const created = await createProduct(payload);
        setMessage(created.existed ? t.productMerged : t.actionDone);
      }

      await closeEditModal();
    } catch (saveError) {
      setError(mapSaveError(saveError, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="glass rounded-3xl p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-4 text-base outline-none focus:border-cyan-300"
          />
          <button
            type="button"
            onClick={isSearchScannerOpen ? () => stopSearchScanner() : onStartSearchScan}
            disabled={busy || !!scannerTarget || isStartingSearchScan}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-4 text-sm font-bold text-cyan-200 disabled:opacity-50 sm:min-w-[180px]"
          >
            {isSearchScannerOpen ? <HiOutlineXMark size={18} /> : <HiOutlineCamera size={18} />}
            {isSearchScannerOpen ? t.cancel : t.searchByCamera}
          </button>
        </div>

        {isSearchScannerOpen ? (
          <div className="mt-3 rounded-2xl border border-cyan-300/25 bg-slate-950/45 p-3">
            <p className="mb-2 text-xs text-slate-300">{t.searchCameraHint}</p>
            <div id="inventory-search-scanner-region" className="h-[220px] overflow-hidden rounded-xl border border-cyan-300/30 bg-slate-950/70" />
          </div>
        ) : null}

        {searchScanError ? <p className="mt-2 text-xs text-rose-300">{searchScanError}</p> : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-200"
          >
            {t.manualAddProduct}
          </button>

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

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="glass rounded-2xl px-4 py-4 text-sm text-slate-300">
            {products.length === 0 ? t.emptyState : search.trim() ? t.productNotFound : t.emptyState}
          </div>
        ) : null}

        {filtered.map((p) => {
          const qty = Number(p.quantity || 0);
          const cardImage = String(p.details?.imageRef || p.imageUrl || "").trim();
          const details = p.details || {};
          const isExpanded = expandedIds.includes(p.id);

          const basePairs = [
            { key: t.barcode, value: p.barcode || "-" },
            { key: t.labelNumber, value: p.labelNumber || "-" },
            { key: t.price, value: Number(p.price || 0).toFixed(2) },
            { key: t.quantityLabel, value: String(qty) }
          ];

          const optionalPairs = [
            { key: t.productCode, value: details.productCode },
            { key: t.containerNumber, value: details.containerNumber },
            { key: t.warehouseLocation, value: details.warehouseLocation },
            { key: t.totalProductCount, value: details.totalProductCount },
            { key: t.unitKg, value: details.unitKg },
            { key: t.totalKg, value: details.totalKg },
            { key: t.widthCm, value: details.widthCm },
            { key: t.lengthCm, value: details.lengthCm },
            { key: t.heightCm, value: details.heightCm },
            { key: t.unitM3, value: details.unitM3 },
            { key: t.totalM3, value: details.totalM3 }
          ];

          const hasFeatures = typeof details.features === "string" && details.features.trim().length > 0;

          return (
            <article key={p.id} className="glass rounded-3xl p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:rounded-2xl sm:p-3">
              <div className="flex min-w-0 items-start gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  {cardImage ? (
                    <img src={cardImage} alt={p.name} className="h-16 w-16 rounded-lg object-cover border border-white/10 shrink-0 sm:h-20 sm:w-20" />
                  ) : (
                    <div className="h-16 w-16 rounded-lg border border-white/10 bg-slate-900/40 sm:h-20 sm:w-20" />
                  )}

                  <div className="min-w-0">
                    <h3 className="text-[1.22rem] font-semibold leading-snug text-slate-100 sm:text-xl sm:font-bold">
                      {p.name}
                      {details.productCode ? ` - ${details.productCode}` : ""}
                    </h3>
                    {details.warehouseLocation ? (
                      <p className="mt-1 text-sm text-slate-400">
                        {t.warehouseLocation}: {details.warehouseLocation}
                      </p>
                    ) : null}
                    {details.totalProductCount !== undefined && details.totalProductCount !== null && String(details.totalProductCount).trim() !== "" ? (
                      <p className="mt-1 text-sm text-slate-400">
                        {t.totalProductCount}: {details.totalProductCount}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/30 p-2.5 sm:mt-2.5 sm:p-2">
                <button
                  type="button"
                  onClick={() => onToggleExpanded(p.id)}
                  className="w-full rounded-xl border border-cyan-300/20 bg-slate-950/50 px-3 py-2 text-left text-sm font-bold tracking-[0.01em] text-cyan-200 sm:rounded-lg sm:py-1.5 sm:text-[11px] sm:font-semibold sm:uppercase sm:tracking-[0.09em]"
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
                    </div>

                    {optionalPairs.length > 0 || hasFeatures ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/35 p-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-200">
                          {t.optionalDetailsTitle}
                        </p>

                        {optionalPairs.length > 0 ? (
                          <div className="grid gap-x-3 gap-y-1 text-xs md:grid-cols-2">
                            {optionalPairs.map((item) => (
                              <p key={item.key} className="text-slate-300">
                                <span className="text-slate-500">{item.key}:</span> {item.value !== undefined && item.value !== null && String(item.value).trim() !== "" ? String(item.value) : "-"}
                              </p>
                            ))}
                          </div>
                        ) : null}

                        {hasFeatures ? (
                          <p className="mt-2 text-xs text-slate-300">
                            <span className="text-slate-500">{t.features}:</span> {details.features}
                          </p>
                        ) : null}
                      </div>
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
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:mt-2.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2.5 text-base font-semibold text-cyan-200 sm:rounded-lg sm:py-1.5 sm:text-sm"
                  >
                    {t.editProduct}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(p)}
                    className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2.5 text-base font-semibold text-rose-300 sm:rounded-lg sm:py-1.5 sm:text-sm"
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
        <div
          className="fixed inset-0 z-50 overflow-y-auto overscroll-y-contain touch-pan-y bg-black/55 p-2 [-webkit-overflow-scrolling:touch] sm:grid sm:place-items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEditModal().catch(() => {});
            }
          }}
        >
          <form onSubmit={onSaveEdit} onPasteCapture={onPasteRefImage} className="glass relative mx-auto w-full max-w-lg rounded-3xl p-3 space-y-3 sm:p-4">
            <button
              type="button"
              onClick={() => closeEditModal()}
              aria-label={t.cancel}
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-slate-900/40 text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-200"
            >
              <HiOutlineXMark size={16} />
            </button>
            {!isCreating ? <h3 className="font-display text-xl font-bold">{t.editProduct}</h3> : null}

            {isCreating ? <p className="text-sm text-amber-300">{t.manualAddHint}</p> : null}
            {isCreating ? <p className="text-xs text-cyan-200">{t.requiredManualFields}</p> : null}

            {isCreating ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.manualProductName}</span>
                    <input
                      value={editing.name ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={t.manualProductName}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {!isCreating ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-3 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 col-span-2">
                    <span className="text-[11px] text-slate-400">{t.productName}</span>
                    <input
                      value={editing.name ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={t.productName}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.price}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editing.price ?? 0}
                      onChange={(e) => setEditing((prev) => ({ ...prev, price: e.target.value }))}
                      placeholder={t.price}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-300">{t.optionalIdentifiersTitle}</p>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">
                    {t.barcode}
                    {isCreating ? ` (${t.optionalFields})` : ""}
                  </span>
                  <input
                    value={editing.barcode ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, barcode: e.target.value }))}
                    placeholder={t.barcode}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">
                    {t.labelNumber}
                    {isCreating ? ` (${t.optionalFields})` : ""}
                  </span>
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

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.productCode}{isCreating ? " *" : ""}</span>
                  <input
                    value={editing.details?.productCode ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), productCode: e.target.value } }))}
                    placeholder={t.productCode}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                {isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.warehouseLocation}</span>
                    <select
                      value={editing.details?.warehouseLocation ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), warehouseLocation: e.target.value } }))}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    >
                      <option value="">{t.selectWarehouse}</option>
                      <option value={t.warehouseSiteler}>{t.warehouseSiteler}</option>
                      <option value={t.warehouseAkyurt}>{t.warehouseAkyurt}</option>
                    </select>
                  </label>
                ) : null}
                {!isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.containerNumber}</span>
                    <input
                      value={editing.details?.containerNumber ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), containerNumber: e.target.value } }))}
                      placeholder={t.containerNumber}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : null}
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">{t.totalProductCount}</span>
                  <input
                    value={editing.details?.totalProductCount ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), totalProductCount: e.target.value } }))}
                    placeholder={t.totalProductCount}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                  />
                </label>
                {!isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.unitKg}</span>
                    <input
                      value={editing.details?.unitKg ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), unitKg: e.target.value } }))}
                      placeholder={t.unitKg}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : null}
                {!isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.totalKg}</span>
                    <input
                      value={editing.details?.totalKg ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), totalKg: e.target.value } }))}
                      placeholder={t.totalKg}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : null}
                {!isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.widthCm}</span>
                    <input
                      value={editing.details?.widthCm ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), widthCm: e.target.value } }))}
                      placeholder={t.widthCm}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : null}
                {!isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.lengthCm}</span>
                    <input
                      value={editing.details?.lengthCm ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), lengthCm: e.target.value } }))}
                      placeholder={t.lengthCm}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : null}
                {!isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.heightCm}</span>
                    <input
                      value={editing.details?.heightCm ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), heightCm: e.target.value } }))}
                      placeholder={t.heightCm}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : null}
                {!isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.unitM3}</span>
                    <input
                      value={editing.details?.unitM3 ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), unitM3: e.target.value } }))}
                      placeholder={t.unitM3}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : null}
                {!isCreating ? (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">{t.totalM3}</span>
                    <input
                      value={editing.details?.totalM3 ?? ""}
                      onChange={(e) => setEditing((prev) => ({ ...prev, details: { ...(prev.details || {}), totalM3: e.target.value } }))}
                      placeholder={t.totalM3}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : null}
                <label
                  tabIndex={0}
                  onPaste={(event) => {
                    const pastedFile = getImageFileFromClipboardEvent(event);
                    if (!pastedFile) return;
                    event.preventDefault();
                    setRefImageFile(pastedFile);
                  }}
                  className="flex items-center rounded-xl border border-dashed border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 cursor-pointer outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/30"
                >
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setRefImageFile(e.target.files?.[0] || null)}
                  />
                  {refImageFile ? `${t.imageRef}: ${refImageFile.name}` : t.uploadRefImageWithPaste}
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

            {isCreating ? (
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-2xl bg-amber-300 px-4 py-4 text-lg font-extrabold text-slate-900 disabled:opacity-60"
              >
                {busy ? t.loading : t.saveProduct}
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => closeEditModal()} className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-bold">
                  {t.cancel}
                </button>
                <button type="submit" disabled={busy} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-extrabold text-slate-900 disabled:opacity-60">
                  {busy ? t.loading : t.saveChanges}
                </button>
              </div>
            )}
          </form>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/55 p-3 sm:grid sm:place-items-center sm:p-4">
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
        <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/55 p-3 sm:grid sm:place-items-center sm:p-4">
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
