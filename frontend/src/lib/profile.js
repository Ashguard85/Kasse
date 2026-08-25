const ACTIVE_PROFILE_KEY = "kasseActiveProfileId";

export function getActiveProfileId() {
  try {
    const id = Number(localStorage.getItem(ACTIVE_PROFILE_KEY));
    return Number.isInteger(id) && id > 0 ? id : 1;
  } catch {
    return 1;
  }
}

export function setActiveProfileId(value) {
  const id = Number(value);
  const clean = Number.isInteger(id) && id > 0 ? id : 1;
  try { localStorage.setItem(ACTIVE_PROFILE_KEY, String(clean)); } catch {}
  window.dispatchEvent(new CustomEvent("kasse:profile-changed", { detail: { profileId: clean } }));
  return clean;
}
