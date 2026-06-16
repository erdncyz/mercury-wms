import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { subscribeActivityLogs } from "../services/stockService";

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

export default function ActivityLogScreen({ t }) {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);

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
    return logs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (!q) return true;
      const name = String(log.productName || "").toLocaleLowerCase("tr");
      const user = String(log.userName || "").toLocaleLowerCase("tr");
      return name.includes(q) || user.includes(q);
    });
  }, [logs, search, actionFilter]);

  const onExport = () => {
    if (filtered.length === 0) return;
    const data = filtered.map((log) => ({
      [t.activityTitle]: actionLabels[log.action] || log.action,
      [t.productName]: log.productName || "-",
      [t.columnStock]: log.amount || 0,
      [t.activityUser]: log.userName || t.activityUnknownUser,
      Tarih: formatDateTime(toDate(log.timestamp))
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Loglar");
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `mercury-wms-loglar-${date}.xlsx`);
  };

  return (
    <section className="space-y-4">
      <div className="glass rounded-3xl p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-100">{t.activityTitle}</h2>
            <p className="mt-1 text-xs text-slate-400">{t.activitySubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onExport}
            disabled={filtered.length === 0}
            className="shrink-0 rounded-xl border border-emerald-300/35 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-200 disabled:opacity-50"
          >
            {t.activityExport}
          </button>
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
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="glass rounded-2xl px-4 py-4 text-sm text-slate-300">{t.loading}</div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl px-4 py-4 text-sm text-slate-300">
            {logs.length === 0 ? t.activityNoRecords : t.activityNoMatch}
          </div>
        ) : (
          filtered.map((log) => {
            const badgeStyle = ACTION_STYLES[log.action] || "border-white/15 bg-slate-900/40 text-slate-200";
            const isStock = log.action === "stock_in" || log.action === "stock_out";
            const sign = log.action === "stock_in" ? "+" : log.action === "stock_out" ? "-" : "";
            return (
              <div key={log.id} className="glass rounded-2xl p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${badgeStyle}`}>
                    {actionLabels[log.action] || log.action}
                  </span>
                  {isStock && log.amount ? (
                    <span className="text-sm font-bold text-slate-100">{sign}{log.amount}</span>
                  ) : null}
                  <span className="ml-auto text-[11px] text-slate-400">{formatDateTime(toDate(log.timestamp))}</span>
                </div>

                <p className="mt-2 break-words font-semibold text-slate-100">{log.productName || "-"}</p>

                <p className="mt-1 text-xs text-slate-400">
                  {t.activityUser}: <span className="text-slate-200">{log.userName || t.activityUnknownUser}</span>
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
