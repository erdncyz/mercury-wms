import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  signInWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import { auth } from "../firebase";

const CREATOR_URL = "https://erdincyilmaz.netlify.app/";

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function mapAuthError(err, t) {
  const code = err?.code || "";
  const message = err?.message || "";

  if (code === "auth/operation-not-allowed") return t.authOperationNotAllowed;
  if (code === "auth/unauthorized-domain") return t.authUnauthorizedDomain;
  if (code === "auth/invalid-api-key") return t.authInvalidApiKey;
  if (code === "auth/configuration-not-found" || message.includes("CONFIGURATION_NOT_FOUND")) {
    return t.authConfigurationNotFound;
  }
  if (code === "auth/email-already-in-use") return t.authEmailInUse;
  if (code === "auth/invalid-email") return t.authInvalidEmailFormat;
  if (code === "auth/weak-password") return t.authWeakPassword;
  if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
    return t.authInvalidCredential;
  }
  if (code === "auth/too-many-requests") return t.authTooManyRequests;

  return t.authError;
}

export default function AuthScreen({ t, onLanguageToggle }) {
  const [mode, setMode] = useState("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        if (!fullName.trim()) {
          setError(t.authNameRequired);
          return;
        }

        if (!isValidEmail(email)) {
          setError(t.authInvalidEmailFormat);
          return;
        }

        const signInMethods = await fetchSignInMethodsForEmail(auth, email.trim());
        if (Array.isArray(signInMethods) && signInMethods.length > 0) {
          setError(t.authEmailInUse);
          return;
        }

        const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(userCredential.user, {
          displayName: fullName.trim()
        });
      }
    } catch (err) {
      setError(mapAuthError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10 text-slate-100">
      <div className="glass w-full max-w-md rounded-3xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
        <div className="mb-6 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-300/85">Mercury</p>
            <h1 className="font-display text-3xl font-bold">WMS</h1>
            <p className="mt-1 text-xs text-slate-400">{t.appSubtitle}</p>
          </div>
          <button type="button" onClick={onLanguageToggle} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold">
            TR / EN
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "register" ? (
            <input
              type="text"
              required
              placeholder={t.fullName}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-4 text-base outline-none focus:border-cyan-300"
            />
          ) : null}

          <input
            type="email"
            required
            placeholder={t.email}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-4 text-base outline-none focus:border-cyan-300"
          />
          <input
            type="password"
            required
            placeholder={t.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-4 text-base outline-none focus:border-cyan-300"
          />

          {error ? <p className="rounded-xl bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-cyan-300 px-4 py-4 text-lg font-extrabold text-slate-900 disabled:opacity-60"
          >
            {busy ? t.loading : mode === "login" ? t.login : t.register}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-300">
          {mode === "login" ? t.noAccount : t.hasAccount}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              setMode((m) => (m === "login" ? "register" : "login"));
            }}
            className="font-bold text-cyan-300"
          >
            {mode === "login" ? t.switchToRegister : t.switchToLogin}
          </button>
        </p>

        <a
          href={CREATOR_URL}
          target="_blank"
          rel="noreferrer"
          className="creator-link mt-5 inline-flex"
        >
          Geliştiren Erdinç Yılmaz
        </a>
      </div>
    </div>
  );
}
