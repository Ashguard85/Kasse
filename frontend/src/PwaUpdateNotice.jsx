import { useEffect, useState } from "react";
import styles from "./PwaUpdateNotice.module.css";

// Compiled into the app bundle; the server advertises its current build in
// /version.json. A difference means this open tab is using older app files.
const CURRENT_VERSION = __KASSE_VERSION__;
const DISMISSED_KEY = "kassePwaDeferredUpdate";
const CHECK_INTERVAL_MS = 3 * 60 * 1000;

function getDeferredVersion() {
  try { return sessionStorage.getItem(DISMISSED_KEY) || ""; } catch { return ""; }
}
function deferVersion(version) {
  try { sessionStorage.setItem(DISMISSED_KEY, version); } catch {}
}
function isNativeApp() {
  try { return window.Capacitor?.isNativePlatform?.() === true; } catch { return false; }
}

export default function PwaUpdateNotice() {
  const [available, setAvailable] = useState("");
  const [deferred, setDeferred] = useState(getDeferredVersion);

  useEffect(() => {
    // The APK is updated via Android, not through the Docker/PWA endpoint.
    if (import.meta.env.DEV || isNativeApp()) return undefined;
    let disposed = false;
    let inProgress = false;

    const check = async () => {
      if (disposed || inProgress || document.visibilityState === "hidden") return;
      inProgress = true;
      try {
        // cache-busting and no-store prevent Safari or an old SW from providing
        // a stale version.json. Cloudflare Access cookies are preserved.
        const response = await fetch(`/version.json?check=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          headers: { Accept: "application/json" },
        });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
        const info = await response.json();
        const remoteVersion = typeof info?.version === "string" ? info.version.trim() : "";
        if (!remoteVersion) return;
        if (!disposed) setAvailable(remoteVersion === CURRENT_VERSION ? "" : remoteVersion);
      } catch {
        // Being offline or behind an expired Cloudflare Access session should
        // never interrupt the checkout or show a false update notice.
      } finally {
        inProgress = false;
      }
    };

    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const onPageShow = () => { void check(); };
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onPageShow);
    void check();
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onPageShow);
    };
  }, []);

  if (!available || available === deferred) return null;

  const reload = () => {
    // Reloading is deliberately only user-initiated. Keep route (#/...) and
    // local browser data intact; a unique URL avoids stale Safari navigation.
    const url = new URL(window.location.href);
    url.searchParams.set("kasse_update", String(Date.now()));
    window.location.replace(url.toString());
  };

  return (
    <aside className={styles.notice} role="status" aria-live="polite" aria-label="KinderKasse Update verfügbar">
      <div className={styles.message}>
        <strong>Neue KinderKasse-Version verfügbar: {available}</strong>
        <span>Bitte einen offenen Verkauf zuerst abschliessen. Das Update wird erst nach deiner Bestätigung geladen.</span>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.later} onClick={() => {
          deferVersion(available);
          setDeferred(available);
        }}>Später</button>
        <button type="button" className={styles.reload} onClick={reload}>Jetzt neu laden</button>
      </div>
    </aside>
  );
}
