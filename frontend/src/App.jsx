import React from "react";
import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import Kasse from "./pages/Kasse";
import Admin from "./pages/Admin";
import Karten from "./pages/Karten";
import Einstellungen from "./pages/Einstellungen";
import Drucker from "./pages/Drucker";
import Statistik from "./pages/Statistik";
import { CartProvider } from "./CartContext";
import { NfcProvider } from "./NfcContext";
import NfcStatus from "./NfcStatus";
import styles from "./App.module.css";

export default function App() {
  return (
    <NfcProvider>
      <CartProvider>
        <HashRouter>
          <div className={styles.app}>
            {/* Portrait mode hint */}
            <div className={styles.portraitHint}>
              <span>🔄</span>
              Bitte das Tablet drehen
            </div>

            <nav className={styles.nav}>
              <div className={styles.logo}>🛒 Kasse</div>
              <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ""}>🛒 Kasse</NavLink>
              <NavLink to="/karten" className={({ isActive }) => isActive ? styles.active : ""}>💳 Karten</NavLink>
              <NavLink to="/admin" className={({ isActive }) => isActive ? styles.active : ""}>📦 Artikel</NavLink>
              <NavLink to="/drucker" className={({ isActive }) => isActive ? styles.active : ""}>🧾 Drucker</NavLink>
              <NavLink to="/statistik" className={({ isActive }) => isActive ? styles.active : ""}>📊 Statistik</NavLink>
              <NavLink to="/einstellungen" className={({ isActive }) => isActive ? styles.active : ""}>⚙️ Einstellungen</NavLink>
              <NfcStatus />
            </nav>
            <main className={styles.main}>
              <Routes>
                <Route path="/" element={<Kasse />} />
                <Route path="/karten" element={<Karten />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/drucker" element={<Drucker />} />
                <Route path="/statistik" element={<Statistik />} />
                <Route path="/einstellungen" element={<Einstellungen />} />
              </Routes>
            </main>
          </div>
        </HashRouter>
      </CartProvider>
    </NfcProvider>
  );
}
