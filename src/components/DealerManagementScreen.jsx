import { useEffect, useMemo, useState } from "react";
import { applyStockChange, createDealer, deleteDealer, subscribeActivityLogs, subscribeDealers, subscribeProducts, updateDealer } from "../services/stockService";

function emptyDealerForm() {
  return {
    name: "",
    code: "",
    contactName: "",
    phone: "",
    email: "",
    city: "",
    address: "",
    note: ""
  };
}

function mapSaveError(error, t) {
  const code = String(error?.code || error?.message || "").toLowerCase();
  if (code.includes("permission-denied")) {
    return t.permissionDeniedHint;
  }
  return code ? `${t.saveError}: ${code}` : t.saveError;
}

export default function DealerManagementScreen({ t }) {
  const [dealers, setDealers] = useState([]);
  const [products, setProducts] = useState([]);
  const [salesLogs, setSalesLogs] = useState([]);
  const [expandedSalesIds, setExpandedSalesIds] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [form, setForm] = useState(emptyDealerForm());
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingReturn, setPendingReturn] = useState(null);
  const [editedSalesAmount, setEditedSalesAmount] = useState(1);

  useEffect(() => {
    const unsub = subscribeDealers((rows) => {
      setDealers(rows);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeProducts((rows) => {
      setProducts(rows);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeActivityLogs((rows) => {
      setSalesLogs(rows);
    }, 2000);
    return () => unsub();
  }, []);

  // Bayi bazinda net satilan urunleri hesapla (OUT ekle, IN iade dus).
  const salesByDealer = useMemo(() => {
    const map = new Map();
    const normalizeDealerName = (value) => String(value || "").trim().toLocaleLowerCase("tr");

    salesLogs.forEach((log) => {
      const isStockOut = String(log.stockType || "").toUpperCase() === "OUT" || log.action === "stock_out";
      const isStockIn = String(log.stockType || "").toUpperCase() === "IN" || log.action === "stock_in";
      if (!isStockOut && !isStockIn) return;

      const dealerId = String(log.dealerId || "").trim();
      const dealerName = String(log.dealerName || "").trim();
      if (!dealerId && !dealerName) return;

      const key = dealerId || `name:${normalizeDealerName(dealerName)}`;
      const qty = Math.abs(Number(log.amount || 0));
      if (!Number.isFinite(qty) || qty <= 0) return;
      const delta = isStockOut ? qty : -qty;

      const productName = String(log.productName || "-").trim() || "-";
      const productId = String(log.productId || "");
      const productKey = productId || productName;

      let entry = map.get(key);
      if (!entry) {
        entry = { totalQty: 0, products: new Map() };
        map.set(key, entry);
      }
      entry.totalQty += delta;

      const existing = entry.products.get(productKey);
      if (existing) {
        existing.qty += delta;
        if (!existing.productId && productId) {
          existing.productId = productId;
        }
      } else {
        entry.products.set(productKey, { name: productName, productId, qty: delta });
      }
    });

    map.forEach((entry) => {
      entry.totalQty = Math.max(0, entry.totalQty);
      entry.products.forEach((product, productKey) => {
        if (product.qty <= 0) {
          entry.products.delete(productKey);
          return;
        }
        product.qty = Math.max(0, product.qty);
      });
    });

    return map;
  }, [salesLogs]);

  const getDealerSales = (dealer) => {
    const byId = salesByDealer.get(String(dealer.id));
    const byName = salesByDealer.get(`name:${String(dealer.name || "").trim().toLocaleLowerCase("tr")}`);

    if (!byId && !byName) {
      return { totalQty: 0, products: [] };
    }

    const products = new Map();
    let totalQty = 0;

    [byId, byName].forEach((entry) => {
      if (!entry) return;
      totalQty += entry.totalQty;
      entry.products.forEach((value, productKey) => {
        const current = products.get(productKey);
        if (current) {
          current.qty += value.qty;
        } else {
          products.set(productKey, { name: value.name, qty: value.qty });
        }
      });
    });

    const productList = Array.from(products.values())
      .filter((item) => item.qty > 0)
      .sort((a, b) => b.qty - a.qty);
    return { totalQty: Math.max(0, totalQty), products: productList };
  };

  const toggleSales = (dealerId) => {
    setExpandedSalesIds((prev) => (
      prev.includes(dealerId) ? prev.filter((id) => id !== dealerId) : [...prev, dealerId]
    ));
  };

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLocaleLowerCase("tr");
    if (!q) return dealers;

    return dealers.filter((dealer) => {
      const haystack = [
        dealer.name,
        dealer.code,
        dealer.contactName,
        dealer.phone,
        dealer.email,
        dealer.city,
        dealer.address,
        dealer.note
      ]
        .map((v) => String(v || "").toLocaleLowerCase("tr"))
        .join(" ");

      return haystack.includes(q);
    });
  }, [dealers, search]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);

  const paged = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const rangeFrom = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeTo = Math.min(currentPage * pageSize, totalCount);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const resetForm = () => {
    setForm(emptyDealerForm());
    setEditingId("");
  };

  const onSave = async (event) => {
    event.preventDefault();
    if (busy) return;

    if (!String(form.name || "").trim()) {
      setError(t.dealerNameRequired);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (editingId) {
        await updateDealer(editingId, form);
        setMessage(t.dealerUpdateSuccess);
      } else {
        await createDealer(form);
        setMessage(t.dealerCreateSuccess);
      }
      resetForm();
    } catch (saveError) {
      setError(mapSaveError(saveError, t));
    } finally {
      setBusy(false);
    }
  };

  const onEdit = (dealer) => {
    setEditingId(dealer.id);
    setForm({
      name: String(dealer.name || ""),
      code: String(dealer.code || ""),
      contactName: String(dealer.contactName || ""),
      phone: String(dealer.phone || ""),
      email: String(dealer.email || ""),
      city: String(dealer.city || ""),
      address: String(dealer.address || ""),
      note: String(dealer.note || "")
    });
    setMessage("");
    setError("");
  };

  const onDelete = async () => {
    if (!pendingDelete?.id || busy) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await deleteDealer(pendingDelete.id);
      setMessage(t.dealerDeleteSuccess);
      if (editingId === pendingDelete.id) {
        resetForm();
      }
      setPendingDelete(null);
    } catch (deleteError) {
      setError(mapSaveError(deleteError, t));
    } finally {
      setBusy(false);
    }
  };

  const onReturnProduct = async () => {
    if (!pendingReturn || busy) return;

    // İade edilecek miktar = mevcut satış - yeni satılan miktar
    const soldQty = Math.floor(Number(pendingReturn.qty));
    const newSoldQty = Math.floor(Number(editedSalesAmount));

    if (!Number.isFinite(newSoldQty) || newSoldQty < 0) {
      setError(t.invalidAmount || "Geçersiz miktar");
      return;
    }

    if (newSoldQty > soldQty) {
      setError("Yeni satılan miktar mevcuttan fazla olamaz");
      return;
    }

    const returnQty = soldQty - newSoldQty;

    if (returnQty <= 0) {
      setError("İade edilecek miktar 0. Satılan miktarı azaltın.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      // Ürünün depo bilgisini al
      let warehouseLocation = "";
      const productId = String(pendingReturn.productId || "").trim();
      if (productId) {
        const product = products.find((p) => String(p.id || "").trim() === productId);
        warehouseLocation = String(product?.details?.warehouseLocation || "").trim();
      }

      await applyStockChange({
        productId: productId || "",
        productName: String(pendingReturn.name || "").trim(),
        amount: returnQty,
        type: "IN",
        destination: warehouseLocation,
        dealerId: String(pendingReturn.dealerId || ""),
        dealerName: String(pendingReturn.dealerName || "")
      });

      setMessage(t.actionDone || "İade işlemi başarılı");
      setPendingReturn(null);
      setEditedSalesAmount(1);
    } catch (returnError) {
      const msg = String(returnError?.message || "");
      setError(msg.includes("Insufficient") ? (t.notEnoughStock || "Yetersiz stok") : (t.saveError || "Bir hata oluştu"));
    } finally {
      setBusy(false);
    }
  };

  const onRemoveAllSales = async () => {
    if (!pendingReturn || busy) return;

    // Tüm satış kaydını sil (orijinal qty kadar iade et)
    const amount = Math.floor(Number(pendingReturn.qty));

    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t.invalidAmount || "Geçersiz miktar");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      // Ürünün depo bilgisini al
      let warehouseLocation = "";
      const productId = String(pendingReturn.productId || "").trim();
      if (productId) {
        const product = products.find((p) => String(p.id || "").trim() === productId);
        warehouseLocation = String(product?.details?.warehouseLocation || "").trim();
      }

      await applyStockChange({
        productId: productId || "",
        productName: String(pendingReturn.name || "").trim(),
        amount,
        type: "IN",
        destination: warehouseLocation,
        dealerId: String(pendingReturn.dealerId || ""),
        dealerName: String(pendingReturn.dealerName || "")
      });

      setMessage("Satış tamamen çıkarıldı ve stok geri alındı");
      setPendingReturn(null);
      setEditedSalesAmount(1);
    } catch (returnError) {
      const msg = String(returnError?.message || "");
      setError(msg.includes("Insufficient") ? (t.notEnoughStock || "Yetersiz stok") : (t.saveError || "Bir hata oluştu"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="glass rounded-3xl p-4">
        <h2 className="font-display text-lg font-bold text-slate-100">{t.dealerTab}</h2>
        <p className="mt-1 text-xs text-slate-400">{t.dealerManagementSubtitle}</p>

        <form onSubmit={onSave} className="mt-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={`${t.dealerName} *`}
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
            <input
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              placeholder={t.dealerCode}
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
            <input
              value={form.contactName}
              onChange={(e) => setForm((prev) => ({ ...prev, contactName: e.target.value }))}
              placeholder={t.dealerContactName}
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder={t.dealerPhone}
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
            <input
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder={t.email}
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
            <input
              value={form.city}
              onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
              placeholder={t.dealerCity}
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
          </div>

          <input
            value={form.address}
            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
            placeholder={t.dealerAddress}
            className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
          />

          <textarea
            value={form.note}
            onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
            placeholder={t.dealerNote}
            rows={2}
            className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-200 disabled:opacity-50"
            >
              {busy ? t.loading : editingId ? t.saveChanges : t.dealerAddButton}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                disabled={busy}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
              >
                {t.cancel}
              </button>
            ) : null}
          </div>
        </form>

        {message ? <p className="mt-3 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">{message}</p> : null}
        {error ? <p className="mt-3 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{error}</p> : null}
      </div>

      <div className="glass rounded-3xl p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.dealerSearchPlaceholder}
            className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-cyan-300"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{t.perPage}</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) || 25)}
              className="rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1 text-xs outline-none focus:border-cyan-300"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {totalCount === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-900/30 px-4 py-3 text-sm text-slate-300">
              {t.dealerNoRecords}
            </div>
          ) : (
            paged.map((dealer) => (
              <div key={dealer.id} className="rounded-2xl border border-white/10 bg-slate-900/30 p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold text-slate-100">{dealer.name || "-"}</p>
                    <p className="mt-1 text-xs text-slate-400 break-words">
                      {t.dealerCode}: <span className="text-slate-200">{dealer.code || "-"}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400 break-words">
                      {t.dealerContactName}: <span className="text-slate-200">{dealer.contactName || "-"}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400 break-words">
                      {t.dealerPhone}: <span className="text-slate-200">{dealer.phone || "-"}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400 break-words">
                      {t.dealerCity}: <span className="text-slate-200">{dealer.city || "-"}</span>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(dealer)}
                      disabled={busy}
                      className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 text-[11px] font-bold text-cyan-200 disabled:opacity-50"
                    >
                      {t.editProduct}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(dealer)}
                      disabled={busy}
                      className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-300 disabled:opacity-50"
                    >
                      {t.deleteProduct}
                    </button>
                  </div>
                </div>

                {(() => {
                  const sales = getDealerSales(dealer);
                  const isOpen = expandedSalesIds.includes(dealer.id);

                  return (
                    <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-cyan-200">
                          {t.dealerSalesTitle}
                        </p>
                        <span className="rounded-lg bg-cyan-300/10 px-2 py-0.5 text-[11px] font-bold text-cyan-200">
                          {t.dealerSalesTotal}: {sales.totalQty}
                        </span>
                      </div>

                      {sales.products.length === 0 ? (
                        <p className="mt-2 text-[11px] text-slate-400">{t.dealerSalesNone}</p>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleSales(dealer.id)}
                            className="mt-2 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200"
                          >
                            {isOpen ? t.dealerSalesHide : t.dealerSalesShow}
                          </button>

                          {isOpen ? (
                            <ul className="mt-2 space-y-1">
                              {sales.products.map((item) => (
                                <li
                                  key={item.name}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/40 px-2 py-1 text-[11px]"
                                >
                                  <div className="min-w-0 flex-1">
                                    <span className="break-words text-slate-200">{item.name}</span>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <span className="font-bold text-cyan-200">
                                      {t.dealerSalesCount.replace("{count}", String(item.qty))}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPendingReturn({
                                          ...item,
                                          dealerId: dealer.id,
                                          dealerName: dealer.name
                                        });
                                        setEditedSalesAmount(item.qty);
                                      }}
                                      disabled={busy}
                                      className="rounded-lg border border-amber-300/35 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-200 hover:bg-amber-300/20 disabled:opacity-50"
                                      title="Satıştan azalt veya sil"
                                    >
                                      ↙ İade
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))
          )}
        </div>

        {totalCount > 0 ? (
          <div className="mt-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-300">
                {t.showingRange
                  .replace("{from}", String(rangeFrom))
                  .replace("{to}", String(rangeTo))
                  .replace("{total}", String(totalCount))}
              </p>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
                >
                  {t.previousPage}
                </button>

                <p className="text-xs text-slate-300">
                  {t.pageOf
                    .replace("{page}", String(currentPage))
                    .replace("{pages}", String(totalPages))}
                </p>

                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
                >
                  {t.nextPage}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="glass relative w-full max-w-md rounded-3xl border border-white/10 p-4">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              disabled={busy}
              className="absolute right-4 top-4 inline-flex h-6 w-6 items-center justify-center rounded-lg border border-white/20 text-sm font-bold text-slate-300 hover:border-white/40 hover:text-white disabled:opacity-50"
            >
              ✕
            </button>

            <h3 className="font-display text-lg font-bold text-slate-100">{t.dealerDeleteTitle}</h3>
            <p className="mt-2 text-sm text-slate-300">
              {t.dealerDeleteConfirm.replace("{name}", String(pendingDelete.name || "-"))}
            </p>
            <div className="mt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-300 disabled:opacity-50"
              >
                {busy ? t.loading : t.deleteProduct}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingReturn ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="glass relative w-full max-w-md rounded-3xl border border-white/10 p-4">
            <button
              type="button"
              onClick={() => setPendingReturn(null)}
              disabled={busy}
              className="absolute right-4 top-4 inline-flex h-6 w-6 items-center justify-center rounded-lg border border-white/20 text-sm font-bold text-slate-300 hover:border-white/40 hover:text-white disabled:opacity-50"
            >
              ✕
            </button>
            
            <h3 className="font-display text-lg font-bold text-amber-200">Satıştan Azalt / İade</h3>
            <div className="mt-3 space-y-2">
              <p className="text-sm text-slate-300">
                Ürün: <span className="font-bold text-slate-100">{pendingReturn.name}</span>
              </p>
              <p className="text-sm text-slate-300">
                Mevcut Satılan: <span className="font-bold text-cyan-200">{pendingReturn.qty} adet</span>
              </p>
              <p className="text-sm text-slate-300">
                Depo: <span className="font-bold text-purple-300">
                  {(() => {
                    if (!pendingReturn.productId) return "-";
                    const prod = products.find((p) => p.id === pendingReturn.productId);
                    return String(prod?.details?.warehouseLocation || "-").trim() || "-";
                  })()}
                </span>
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <label className="block text-sm text-slate-300">Yeni satılan miktar (fark stoğa iade edilir)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  max={pendingReturn.qty}
                  value={editedSalesAmount}
                  onChange={(e) => setEditedSalesAmount(e.target.value)}
                  className="flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-amber-300"
                />
                <button
                  type="button"
                  onClick={() => setEditedSalesAmount(0)}
                  disabled={busy}
                  className="rounded-xl border border-amber-300/35 bg-amber-300/10 px-2 py-2 text-xs font-bold text-amber-200 disabled:opacity-50"
                  title="Tümünü iade et"
                >
                  Tümü
                </button>
              </div>
              <p className="text-xs text-amber-200/80">
                İade edilecek: <span className="font-bold">{Math.max(0, pendingReturn.qty - (Math.floor(Number(editedSalesAmount)) || 0))} adet</span>
              </p>
            </div>

            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={onRemoveAllSales}
                disabled={busy}
                className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-300 disabled:opacity-50"
                title="Bayiden çek, satıştan tamamen sil"
              >
                🗑️ Tamamen Çıkar
              </button>
              <button
                type="button"
                onClick={onReturnProduct}
                disabled={busy}
                className="rounded-xl border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-sm font-bold text-amber-200 disabled:opacity-50"
              >
                {busy ? t.loading : "✓ İade Tamamla"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
