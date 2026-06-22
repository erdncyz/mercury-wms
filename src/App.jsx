import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineBuildingStorefront,
  HiOutlineChevronDown,
  HiOutlineClipboardDocumentList,
  HiOutlineLanguage,
  HiOutlineQrCode,
  HiOutlineSparkles,
  HiOutlineSquares2X2,
  HiOutlineUserCircle
} from "react-icons/hi2";
import { auth } from "./firebase";
import { labels } from "./i18n";

const AuthScreen = lazy(() => import("./components/AuthScreen"));
const InventoryScreen = lazy(() => import("./components/InventoryScreen"));
const ScannerScreen = lazy(() => import("./components/ScannerScreen"));
const ActivityLogScreen = lazy(() => import("./components/ActivityLogScreen"));
const DealerManagementScreen = lazy(() => import("./components/DealerManagementScreen"));
const CREATOR_URL = "https://erdincyilmaz.netlify.app/";

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState("list");
  const [lang, setLang] = useState("tr");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileMenuRef = useRef(null);

  const t = useMemo(() => labels[lang], [lang]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!profileMenuRef.current) return;
      if (!profileMenuRef.current.contains(event.target)) {
        setIsProfileOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  if (!authReady) {
    return <div className="grid min-h-screen place-items-center text-slate-300">{t.loading}</div>;
  }

  if (!user) {
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-slate-300">{t.loading}</div>}>
        <AuthScreen t={t} lang={lang} onLanguageToggle={() => setLang((v) => (v === "tr" ? "en" : "tr"))} />
      </Suspense>
    );
  }

  return (
    <div className="app-shell min-h-screen text-slate-100">
      <header className="topbar-shell sticky top-0 z-40 border-b border-white/10 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="brand-mark hidden shrink-0 sm:flex">
                <span className="brand-mark-letter">M</span>
              </div>
              <div className="min-w-0">
                <h1 className="brand-title font-display text-[1.85rem] font-bold leading-[1.05] sm:text-xl">{t.appName}</h1>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400 sm:text-xs">
                  <span className="brand-dot" />
                  {t.appSubtitle}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setLang((v) => (v === "tr" ? "en" : "tr"))}
                className="chip-button rounded-xl p-2"
                aria-label="Change language"
              >
                <HiOutlineLanguage size={20} />
              </button>

              <div className="relative" ref={profileMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsProfileOpen((v) => !v)}
                  className="profile-chip flex max-w-[154px] items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-200 sm:max-w-none"
                >
                  <HiOutlineUserCircle size={18} />
                  <span className="truncate">{user.displayName || user.email?.split("@")[0] || t.loggedInAs}</span>
                  <HiOutlineChevronDown size={14} className={`${isProfileOpen ? "rotate-180" : ""} transition-transform`} />
                </button>

                {isProfileOpen ? (
                  <div className="glass absolute right-0 top-12 z-50 min-w-[220px] rounded-xl p-2 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
                    <p className="px-3 py-2 text-xs text-slate-400">{t.loggedInAs}</p>
                    <p className="px-3 pb-2 text-sm font-semibold text-slate-100">{user.displayName || user.email}</p>
                    <p className="px-3 pb-2 text-[11px] text-slate-400 break-all">{t.uidLabel}: {user.uid}</p>

                    <button
                      type="button"
                      onClick={() => signOut(auth)}
                      className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-300 hover:bg-rose-500/10"
                    >
                      <HiOutlineArrowRightOnRectangle size={16} /> {t.logout}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <a
            href={CREATOR_URL}
            target="_blank"
            rel="noreferrer"
            className="creator-link mt-3 inline-flex w-full justify-center sm:mt-2 sm:w-auto"
          >
            <HiOutlineSparkles size={15} className="creator-link-icon" />
            Geliştiren Erdinç Yılmaz
          </a>
        </div>
      </header>

      <main className="main-shell mx-auto w-full max-w-4xl px-4 py-4 pb-32 sm:pb-28">
        <Suspense fallback={<div className="glass rounded-2xl p-4 text-slate-300">{t.loading}</div>}>
          {activeTab === "scan" ? <ScannerScreen t={t} /> : null}
          {activeTab === "list" ? <InventoryScreen t={t} /> : null}
          {activeTab === "logs" ? <ActivityLogScreen t={t} /> : null}
          {activeTab === "dealers" ? <DealerManagementScreen t={t} /> : null}
        </Suspense>
      </main>

      <nav className="bottom-nav-shell fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur sm:p-3">
        <div className="mx-auto grid w-full max-w-4xl grid-cols-4 gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("list")}
            className={`tab-pill flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[0.95rem] tracking-[0.005em] sm:gap-2 sm:rounded-2xl sm:py-4 sm:text-base ${
              activeTab === "list" ? "tab-pill-active" : ""
            }`}
          >
            <HiOutlineSquares2X2 className="h-5 w-5 shrink-0 sm:h-[22px] sm:w-[22px]" />
            <span className="truncate">{t.listTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("scan")}
            className={`tab-pill flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[0.95rem] tracking-[0.005em] sm:gap-2 sm:rounded-2xl sm:py-4 sm:text-base ${
              activeTab === "scan" ? "tab-pill-active" : ""
            }`}
          >
            <HiOutlineQrCode className="h-5 w-5 shrink-0 sm:h-[22px] sm:w-[22px]" />
            <span className="truncate">{t.scanTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("logs")}
            className={`tab-pill flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[0.95rem] tracking-[0.005em] sm:gap-2 sm:rounded-2xl sm:py-4 sm:text-base ${
              activeTab === "logs" ? "tab-pill-active" : ""
            }`}
          >
            <HiOutlineClipboardDocumentList className="h-5 w-5 shrink-0 sm:h-[22px] sm:w-[22px]" />
            <span className="truncate">{t.logTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("dealers")}
            className={`tab-pill flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[0.95rem] tracking-[0.005em] sm:gap-2 sm:rounded-2xl sm:py-4 sm:text-base ${
              activeTab === "dealers" ? "tab-pill-active" : ""
            }`}
          >
            <HiOutlineBuildingStorefront className="h-5 w-5 shrink-0 sm:h-[22px] sm:w-[22px]" />
            <span className="truncate">{t.dealerTab}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
