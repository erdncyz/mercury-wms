import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App.jsx";

const updateSW = registerSW({
	immediate: true,
	onNeedRefresh() {
		updateSW(true);
	}
});

function safeReloadOnce() {
	const key = "mercury-reload-once";
	if (sessionStorage.getItem(key) === "1") return;
	sessionStorage.setItem(key, "1");
	window.location.reload();
}

window.addEventListener("unhandledrejection", (event) => {
	const message = String(event?.reason?.message || event?.reason || "").toLowerCase();
	if (message.includes("failed to fetch dynamically imported module") || message.includes("importing a module script failed")) {
		safeReloadOnce();
	}
});

createRoot(document.getElementById("root")).render(<App />);
