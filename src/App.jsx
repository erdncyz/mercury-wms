import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineChevronDown,
  HiOutlineDocumentArrowUp,
  HiOutlineLanguage,
  HiOutlineQrCode,
  HiOutlineSquares2X2,
  HiOutlineUserCircle
} from "react-icons/hi2";
import { auth } from "./firebase";
import { labels } from "./i18n";

const AuthScreen = lazy(() => import("./components/AuthScreen"));
const InventoryScreen = lazy(() => import("./components/InventoryScreen"));
const ScannerScreen = lazy(() => import("./components/ScannerScreen"));
const ImportScreen = lazy(() => import("./components/ImportScreen"));

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("list");
  const [lang, setLang] = useState("tr");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileMenuRef = useRef(null);

  const t = useMemo(() => labels[lang], [lang]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser || null);
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

  if (!user) {
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-slate-300">{t.loading}</div>}>
        <AuthScreen t={t} lang={lang} onLanguageToggle={() => setLang((v) => (v === "tr" ? "en" : "tr"))} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1220]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="font-display text-xl font-bold">{t.appName}</h1>
            <p className="text-xs text-slate-400">{t.appSubtitle}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang((v) => (v === "tr" ? "en" : "tr"))}
              className="glass rounded-xl p-2"
              aria-label="Change language"
            >
              <HiOutlineLanguage size={20} />
            </button>

            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setIsProfileOpen((v) => !v)}
                className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-200"
              >
                <HiOutlineUserCircle size={18} />
                <span>{user.displayName || user.email?.split("@")[0] || t.loggedInAs}</span>
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
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-4 pb-28">
        <Suspense fallback={<div className="glass rounded-2xl p-4 text-slate-300">{t.loading}</div>}>
          {activeTab === "scan" ? <ScannerScreen t={t} /> : null}
          {activeTab === "list" ? <InventoryScreen t={t} /> : null}
          {activeTab === "import" ? <ImportScreen t={t} /> : null}
        </Suspense>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0b1220]/95 p-3 backdrop-blur">
        <div className="mx-auto grid w-full max-w-4xl grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("list")}
            className={`flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold ${
              activeTab === "list" ? "bg-cyan-300 text-slate-900" : "glass"
            }`}
          >
            <HiOutlineSquares2X2 size={22} /> {t.listTab}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("scan")}
            className={`flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold ${
              activeTab === "scan" ? "bg-cyan-300 text-slate-900" : "glass"
            }`}
          >
            <HiOutlineQrCode size={22} /> {t.scanTab}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("import")}
            className={`flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold ${
              activeTab === "import" ? "bg-cyan-300 text-slate-900" : "glass"
            }`}
          >
            <HiOutlineDocumentArrowUp size={22} /> {t.importTab}
          </button>
        </div>
      </nav>
    </div>
  );
}
