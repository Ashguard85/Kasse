import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, details) {
    console.error("KinderKasse Startfehler:", error, details);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f3f4f6", color: "#1f2937", padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <h1>KinderKasse konnte nicht starten</h1>
          <p>Beim Laden ist ein Fehler aufgetreten. Bitte versuche es erneut. Deine gespeicherten Daten bleiben erhalten.</p>
          <button style={{ padding: "14px 24px", borderRadius: 10, border: 0, background: "#146b38", color: "white", fontWeight: 700 }} onClick={() => window.location.reload()}>Erneut laden</button>
          <p style={{ marginTop: 20, color: "#6b7280", fontSize: 12, overflowWrap: "anywhere" }}>{String(this.state.error?.message || "Unbekannter Fehler")}</p>
        </div>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <StartupErrorBoundary><App /></StartupErrorBoundary>
);
