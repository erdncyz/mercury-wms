import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { deleteActivityLog, deleteActivityLogsBulk, subscribeActivityLogs } from "../services/stockService";

const ACTION_STYLES = {
  create: "border-emerald-300/35 bg-emerald-300/10 text-emerald-200",
  update: "border-cyan-300/35 bg-cyan-300/10 text-cyan-200",
  delete: "border-rose-300/35 bg-rose-500/10 text-rose-300",
  stock_in: "border-emerald-300/35 bg-emerald-300/10 text-emerald-200",
  stock_out: "border-amber-300/35 bg-amber-300/10 text-amber-200"
};

function toDate(timestamp) {
  if (!timestamp) return null;
  if (typeof timestamp.toDate === "function") return timestamp.toDate();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
  return null;
}

function formatDateTime(date) {
  if (!date) return "-";
  return date.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatStockChange(log) {
  const type = String(log.stockType || "").toUpperCase();
  const amount = Number(log.amount || 0);
  if (!Number.isFinite(amount) || amount === 0) return "-";
  const sign = type === "OUT" || log.action === "stock_out" ? "-" : "+";
  return `${sign}${Math.abs(amount)}`;
}

function getSummaryText(log, actionLabel) {
  const summary = String(log.summary || "").trim();
  if (summary) return summary;
  if (log.action === "stock_in" || log.action === "stock_out") {
    const change = formatStockChange(log);
    return `${actionLabel} ${change !== "-" ? `(${change})` : ""}`.trim();
  }
  return actionLabel;
}

export default function ActivityLogScreen({ t }) {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const unsub = subscribeActivityLogs((rows) => {
      setLogs(rows);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const actionLabels = useMemo(() => ({
    create: t.activityActionCreate,
    update: t.activityActionUpdate,
    delete: t.activityActionDelete,
    stock_in: t.activityActionStockIn,
    stock_out: t.activityActionStockOut
  }), [t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    const fromDateBoundary = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const toDateBoundary = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;

    return logs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;

      if (fromDateBoundary || toDateBoundary) {
        const logDate = toDate(log.timestamp);
        if (!logDate) return false;
        if (fromDateBoundary && logDate < fromDateBoundary) return false;
        if (toDateBoundary && logDate > toDateBoundary) return false;
      }

      if (!q) return true;
      const name = String(log.productName || "").toLocaleLowerCase("tr");
      const user = String(log.userName || "").toLocaleLowerCase("tr");
      const destination = String(log.destination || "").toLocaleLowerCase("tr");
      const summary = String(log.summary || "").toLocaleLowerCase("tr");
      const source = String(log.source || "").toLocaleLowerCase("tr");
      const warehouseFrom = String(log.warehouseFrom || "").toLocaleLowerCase("tr");
      const warehouseTo = String(log.warehouseTo || "").toLocaleLowerCase("tr");
      const changedFields = Array.isArray(log.changedFields)
        ? log.changedFields.join(" ").toLocaleLowerCase("tr")
        : "";
      return name.includes(q)
        || user.includes(q)
        || destination.includes(q)
        || summary.includes(q)
        || source.includes(q)
        || warehouseFrom.includes(q)
        || warehouseTo.includes(q)
        || changedFields.includes(q);
    });
  }, [logs, search, actionFilter, dateFrom, dateTo]);

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
  }, [search, actionFilter, dateFrom, dateTo, pageSize]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const onExport = () => {
    if (filtered.length === 0) return;
    const data = filtered.map((log) => ({
      [t.activityTitle]: actionLabels[log.action] || log.action,
      [t.activitySummary]: getSummaryText(log, actionLabels[log.action] || log.action),
      [t.productName]: log.productName || "-",
      [t.columnStock]: log.amount || 0,
      [t.activityStockBefore]: Number.isFinite(Number(log.beforeStock)) ? Number(log.beforeStock) : "-",
      [t.activityStockAfter]: Number.isFinite(Number(log.afterStock)) ? Number(log.afterStock) : "-",
      [t.activityStockType]: log.stockType || "-",
      [t.activityDestination]: log.destination || "-",
      [t.activityWarehouseFrom]: log.warehouseFrom || "-",
      [t.activityWarehouseTo]: log.warehouseTo || "-",
      [t.activitySource]: log.source || "-",
      [t.activityChangedFields]: Array.isArray(log.changedFields) && log.changedFields.length > 0 ? log.changedFields.join(", ") : "-",
      [t.barcode]: log.barcode || "-",
      [t.activityProductId]: log.productId || "-",
      [t.activityUser]: log.userName || t.activityUnknownUser,
      Tarih: formatDateTime(toDate(log.timestamp))
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Loglar");
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `mercury-wms-loglar-${date}.xlsx`);
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      return [...prev, id];
    });
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const onDeleteOne = async (log) => {
    if (!log?.id || isDeleting) return;

    const confirmed = window.confirm(
      t.activityDeleteConfirmSingle.replace("{name}", String(log.productName || "-"))
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setActionMessage("");
    setActionError("");

    try {
      await deleteActivityLog(log.id);
      setSelectedIds((prev) => prev.filter((item) => item !== log.id));
      setActionMessage(t.activityDeleteSuccess);
    } catch {
      setActionError(t.activityDeleteError);
    } finally {
      setIsDeleting(false);
    }
  };

  const onDeleteSelected = async () => {
    if (selectedIds.length === 0 || isDeleting) {
      if (selectedIds.length === 0) setActionError(t.activityNoSelection);
      return;
    }

    const confirmed = window.confirm(
      t.activityDeleteConfirmBulk.replace("{count}", String(selectedIds.length))
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setActionMessage("");
    setActionError("");

    try {
      const total = selectedIds.length;
      await deleteActivityLogsBulk(selectedIds);
      setSelectedIds([]);
      setActionMessage(t.activityDeleteBulkSuccess.replace("{count}", String(total)));
    } catch {
      setActionError(t.activityDeleteError);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="glass rounded-3xl p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-100">{t.activityTitle}</h2>
            <p className="mt-1 text-xs text-slate-400">{t.activitySubtitle}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDeleteMode((prev) => !prev);
                setActionError("");
                setActionMessage("");
                setSelectedIds([]);
              }}
              className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300"
            >
              {deleteMode ? t.activityExitDeleteMode : t.activityDeleteMode}
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={filtered.length === 0}
              className="rounded-xl border border-emerald-300/35 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-200 disabled:opacity-50"
            >
              {t.activityExport}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.activitySearchPlaceholder}
            className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-cyan-300"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-cyan-300 sm:max-w-[220px]"
          >
            <option value="">{t.activityAllActions}</option>
            <option value="create">{t.activityActionCreate}</option>
            <option value="update">{t.activityActionUpdate}</option>
            <option value="delete">{t.activityActionDelete}</option>
            <option value="stock_in">{t.activityActionStockIn}</option>
            <option value="stock_out">{t.activityActionStockOut}</option>
          </select>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">{t.activityDateFrom}</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">{t.activityDateTo}</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-cyan-300"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="w-full rounded-2xl border border-white/10 px-3 py-2 text-xs text-slate-300"
            >
              {t.activityClearDateFilter}
            </button>
          </div>
        </div>

        {deleteMode ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-rose-300/20 bg-rose-500/5 px-3 py-2 text-xs">
            <span className="text-rose-200">{t.activitySelectedCount.replace("{count}", String(selectedIds.length))}</span>
            <button
              type="button"
              onClick={clearSelection}
              disabled={selectedIds.length === 0 || isDeleting}
              className="rounded-lg border border-white/10 px-2 py-1 text-slate-300 disabled:opacity-50"
            >
              {t.activityClearSelection}
            </button>
            <button
              type="button"
              onClick={onDeleteSelected}
              disabled={selectedIds.length === 0 || isDeleting}
              className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-2 py-1 font-bold text-rose-300 disabled:opacity-50"
            >
              {isDeleting ? t.loading : t.activityDeleteSelected}
            </button>
          </div>
        ) : null}

        {actionMessage ? <p className="mt-3 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">{actionMessage}</p> : null}
        {actionError ? <p className="mt-3 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{actionError}</p> : null}
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="glass rounded-2xl px-4 py-4 text-sm text-slate-300">{t.loading}</div>
        ) : totalCount === 0 ? (
          <div className="glass rounded-2xl px-4 py-4 text-sm text-slate-300">
            {logs.length === 0 ? t.activityNoRecords : t.activityNoMatch}
          </div>
        ) : (
          paged.map((log) => {
            const badgeStyle = ACTION_STYLES[log.action] || "border-white/15 bg-slate-900/40 text-slate-200";
            const isStock = log.action === "stock_in" || log.action === "stock_out";
            const sign = log.action === "stock_in" ? "+" : log.action === "stock_out" ? "-" : "";
            const actionLabel = actionLabels[log.action] || log.action;
            const summaryText = getSummaryText(log, actionLabel);
            const changedFields = Array.isArray(log.changedFields) ? log.changedFields.filter(Boolean) : [];
            return (
              <div key={log.id} className="glass rounded-2xl p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {deleteMode ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(log.id)}
                      onChange={() => toggleSelected(log.id)}
                      className="h-4 w-4 accent-rose-400"
                    />
                  ) : null}
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${badgeStyle}`}>
                    {actionLabel}
                  </span>
                  {isStock && log.amount ? (
                    <span className="text-sm font-bold text-slate-100">{sign}{log.amount}</span>
                  ) : null}
                  <span className="ml-auto text-[11px] text-slate-400">{formatDateTime(toDate(log.timestamp))}</span>
                </div>

                {deleteMode ? (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onDeleteOne(log)}
                      disabled={isDeleting}
                      className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-300 disabled:opacity-50"
                    >
                      {isDeleting ? t.loading : t.deleteProduct}
                    </button>
                  </div>
                ) : null}

                <p className="mt-2 break-words font-semibold text-slate-100">{log.productName || "-"}</p>

                <p className="mt-1 text-xs text-cyan-200 break-words">{summaryText}</p>

                <p className="mt-1 text-xs text-slate-400">
                  {t.activityUser}: <span className="text-slate-200">{log.userName || t.activityUnknownUser}</span>
                </p>

                <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-slate-400 sm:grid-cols-2">
                  {Number.isFinite(Number(log.beforeStock)) ? (
                    <p>{t.activityStockBefore}: <span className="text-slate-200">{Number(log.beforeStock)}</span></p>
                  ) : null}
                  {Number.isFinite(Number(log.afterStock)) ? (
                    <p>{t.activityStockAfter}: <span className="text-slate-200">{Number(log.afterStock)}</span></p>
                  ) : null}
                  {log.stockType ? (
                    <p>{t.activityStockType}: <span className="text-slate-200">{log.stockType}</span></p>
                  ) : null}
                  {log.source ? (
                    <p>{t.activitySource}: <span className="text-slate-200 break-all">{log.source}</span></p>
                  ) : null}
                  {log.warehouseFrom ? (
                    <p>{t.activityWarehouseFrom}: <span className="text-slate-200 break-words">{log.warehouseFrom}</span></p>
                  ) : null}
                  {log.warehouseTo ? (
                    <p>{t.activityWarehouseTo}: <span className="text-slate-200 break-words">{log.warehouseTo}</span></p>
                  ) : null}
                  {log.barcode ? (
                    <p>{t.barcode}: <span className="text-slate-200 break-all">{log.barcode}</span></p>
                  ) : null}
                  {log.productId ? (
                    <p>{t.activityProductId}: <span className="text-slate-200 break-all">{log.productId}</span></p>
                  ) : null}
                </div>

                {log.destination ? (
                  <p className="mt-1 text-xs text-slate-400">
                    {t.activityDestination}: <span className="text-slate-200 break-words">{log.destination}</span>
                  </p>
                ) : null}

                {changedFields.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-400">
                    {t.activityChangedFields}: <span className="text-slate-200 break-words">{changedFields.join(", ")}</span>
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {!loading && totalCount > 0 ? (
        <div className="glass rounded-2xl px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-300">
              {t.showingRange
                .replace("{from}", String(rangeFrom))
                .replace("{to}", String(rangeTo))
                .replace("{total}", String(totalCount))}
            </p>

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

          <div className="mt-3 flex items-center justify-between gap-2">
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
      ) : null}
    </section>
  );
}
