import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./lib/api";
import { DEFAULT_THEME } from "./lib/localDb";
import { getActiveProfileId, setActiveProfileId } from "./lib/profile";

const ProfileContext = createContext(null);

function applyTheme(profile) {
  const theme = { ...DEFAULT_THEME, ...(profile?.theme || {}) };
  const root = document.documentElement;
  root.style.setProperty("--green", theme.primaryColor);
  root.style.setProperty("--green-dark", theme.primaryDark);
  root.style.setProperty("--green-light", `${theme.primaryColor}20`);
  root.style.setProperty("--yellow", theme.accentColor);
  root.style.setProperty("--app-background", theme.pageBackground);
  root.style.setProperty("--register-background", theme.registerBackground);
  root.style.setProperty("--profile-banner-background", theme.bannerBackground);
  root.style.setProperty("--profile-banner-text", theme.bannerTextColor);
  document.body.style.background = theme.pageBackground;
}

export function ProfileProvider({ children }) {
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/profiles?includeArchived=1");
      if (!res.ok) throw new Error("Profile konnten nicht geladen werden");
      const rows = await res.json();
      setProfiles(rows);
      const savedId = getActiveProfileId();
      let current = rows.find((p) => Number(p.id) === savedId && p.active);
      if (!current) current = rows.find((p) => p.active) || rows[0] || null;
      if (current && Number(current.id) !== savedId) setActiveProfileId(current.id);
      setActiveProfile(current);
      applyTheme(current);
      return rows;
    } finally {
      setLoading(false);
    }
  }, []);

  const switchProfile = useCallback(async (profileId) => {
    const id = setActiveProfileId(profileId);
    const found = profiles.find((p) => Number(p.id) === id) || null;
    setActiveProfile(found);
    applyTheme(found);
    window.dispatchEvent(new CustomEvent("kasse:profile-data-refresh", { detail: { profileId: id } }));
    return found;
  }, [profiles]);

  useEffect(() => {
    refreshProfiles().catch(() => {
      const fallback = { id: 1, name: "Einkaufsladen", active: true, theme: DEFAULT_THEME };
      setProfiles([fallback]);
      setActiveProfile(fallback);
      applyTheme(fallback);
    });
    const refresh = () => refreshProfiles().catch(() => {});
    window.addEventListener("kasse:data-mode-updated", refresh);
    window.addEventListener("kasse:local-data-updated", refresh);
    window.addEventListener("kasse:profiles-updated", refresh);
    return () => {
      window.removeEventListener("kasse:data-mode-updated", refresh);
      window.removeEventListener("kasse:local-data-updated", refresh);
      window.removeEventListener("kasse:profiles-updated", refresh);
    };
  }, [refreshProfiles]);

  const value = useMemo(() => ({ profiles, activeProfile, loading, refreshProfiles, switchProfile }), [profiles, activeProfile, loading, refreshProfiles, switchProfile]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile muss innerhalb von <ProfileProvider> verwendet werden");
  return ctx;
}
