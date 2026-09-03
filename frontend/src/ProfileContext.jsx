import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./lib/api";
import { DEFAULT_THEME } from "./lib/localDb";
import { getActiveProfileId, setActiveProfileId } from "./lib/profile";
import { getThemeRuntime } from "./lib/themePresets";

const ProfileContext = createContext(null);

function applyTheme(profile) {
  const theme = getThemeRuntime({ ...DEFAULT_THEME, ...(profile?.theme || {}) });
  const root = document.documentElement;

  root.style.setProperty("--green", theme.primaryColor);
  root.style.setProperty("--green-dark", theme.primaryDark);
  root.style.setProperty("--green-light", theme.primaryLight);
  root.style.setProperty("--primary-text", theme.primaryText);
  root.style.setProperty("--primary-text-muted", theme.primaryTextMuted);
  root.style.setProperty("--yellow", theme.accentColor);
  root.style.setProperty("--yellow-dark", theme.accentDark);
  root.style.setProperty("--accent-text", theme.accentText);
  root.style.setProperty("--app-background", theme.pageBackground);
  root.style.setProperty("--register-background", theme.registerBackground);
  root.style.setProperty("--surface", theme.surface);
  root.style.setProperty("--surface-raised", theme.surfaceRaised);
  root.style.setProperty("--profile-banner-background", theme.bannerBackground);
  root.style.setProperty("--profile-banner-text", theme.bannerTextColor);

  root.style.setProperty("--gray-50", theme.palette.gray50);
  root.style.setProperty("--gray-100", theme.palette.gray100);
  root.style.setProperty("--gray-200", theme.palette.gray200);
  root.style.setProperty("--gray-400", theme.palette.gray400);
  root.style.setProperty("--gray-600", theme.palette.gray600);
  root.style.setProperty("--gray-800", theme.palette.gray800);
  root.style.setProperty("--red-light", theme.palette.redLight);

  root.dataset.appearance = theme.dark ? "dark" : "light";
  root.style.colorScheme = theme.dark ? "dark" : "light";
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
      let current = rows.find((profile) => Number(profile.id) === savedId && profile.active);
      if (!current) current = rows.find((profile) => profile.active) || rows[0] || null;
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
    const found = profiles.find((profile) => Number(profile.id) === id) || null;
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

  const value = useMemo(
    () => ({ profiles, activeProfile, loading, refreshProfiles, switchProfile }),
    [profiles, activeProfile, loading, refreshProfiles, switchProfile],
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile muss innerhalb von <ProfileProvider> verwendet werden");
  return ctx;
}
