const WHITE = "#ffffff";
const BLACK = "#17181c";

function clamp(value, min = 0, max = 255) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

export function hexToRgb(hex) {
  const safe = isHexColor(hex) ? hex.slice(1) : "000000";
  return {
    r: parseInt(safe.slice(0, 2), 16),
    g: parseInt(safe.slice(2, 4), 16),
    b: parseInt(safe.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((part) => clamp(part).toString(16).padStart(2, "0")).join("")}`;
}

export function mixColors(first, second, secondWeight = 0.5) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  const weight = Math.min(1, Math.max(0, Number(secondWeight) || 0));
  return rgbToHex({
    r: a.r * (1 - weight) + b.r * weight,
    g: a.g * (1 - weight) + b.g * weight,
    b: a.b * (1 - weight) + b.b * weight,
  });
}

export function darkenColor(color, amount = 0.22) {
  return mixColors(color, "#000000", amount);
}

function linearChannel(value) {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color) {
  const { r, g, b } = hexToRgb(color);
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

export function contrastRatio(background, foreground) {
  const lighter = Math.max(relativeLuminance(background), relativeLuminance(foreground));
  const darker = Math.min(relativeLuminance(background), relativeLuminance(foreground));
  return (lighter + 0.05) / (darker + 0.05);
}

export function bestTextColor(background) {
  return contrastRatio(background, WHITE) >= contrastRatio(background, BLACK) ? WHITE : BLACK;
}

export function normalizeTheme(theme = {}) {
  const next = { ...theme };
  next.appearanceMode = next.appearanceMode === "dark" ? "dark" : "light";
  next.autoContrast = next.autoContrast !== false;
  if (next.autoContrast) {
    next.primaryDark = darkenColor(next.primaryColor, 0.24);
    next.bannerTextColor = bestTextColor(next.bannerBackground);
  }
  return next;
}

export function applyAppearanceMode(theme, mode) {
  const nextMode = mode === "dark" ? "dark" : "light";
  const backgrounds = nextMode === "dark"
    ? { pageBackground: "#17181d", registerBackground: "#1f2229" }
    : { pageBackground: "#f3f4f6", registerBackground: "#f3f4f6" };
  return normalizeTheme({ ...theme, ...backgrounds, appearanceMode: nextMode });
}

export function getThemeRuntime(theme = {}) {
  const normalized = normalizeTheme(theme);
  const dark = normalized.appearanceMode === "dark";
  const surface = dark ? "#252932" : "#ffffff";
  const surfaceRaised = dark ? "#2d323d" : "#ffffff";
  const primaryText = bestTextColor(normalized.primaryColor);
  const accentText = bestTextColor(normalized.accentColor);
  return {
    ...normalized,
    dark,
    surface,
    surfaceRaised,
    primaryText,
    primaryTextMuted: mixColors(primaryText, normalized.primaryColor, 0.24),
    accentText,
    primaryLight: mixColors(normalized.primaryColor, surface, dark ? 0.72 : 0.88),
    accentDark: darkenColor(normalized.accentColor, 0.2),
    palette: dark
      ? {
          gray50: "#272b34",
          gray100: "#1f2229",
          gray200: "#3b414d",
          gray400: "#a4acb9",
          gray600: "#d0d5dd",
          gray800: "#f7f8fa",
          redLight: "#44272b",
        }
      : {
          gray50: "#f9fafb",
          gray100: "#f3f4f6",
          gray200: "#e5e7eb",
          gray400: "#9ca3af",
          gray600: "#4b5563",
          gray800: "#1f2937",
          redLight: "#fff5f5",
        },
  };
}

export function getThemeChecks(theme = {}) {
  const runtime = getThemeRuntime(theme);
  return [
    {
      id: "primary",
      label: "Hauptfarbe",
      ratio: contrastRatio(runtime.primaryColor, runtime.primaryText),
    },
    {
      id: "accent",
      label: "Akzentfarbe",
      ratio: contrastRatio(runtime.accentColor, runtime.accentText),
    },
    {
      id: "banner",
      label: "Banner",
      ratio: contrastRatio(runtime.bannerBackground, runtime.bannerTextColor),
    },
  ];
}

export const THEME_PRESETS = [
  {
    id: "kinderladen",
    name: "Kinderladen",
    icon: "🧸",
    description: "Frisch, freundlich und vertraut",
    theme: {
      appearanceMode: "light",
      autoContrast: true,
      primaryColor: "#1a7a3c",
      primaryDark: "#145c2d",
      accentColor: "#f5c400",
      pageBackground: "#f3f4f6",
      registerBackground: "#edf6f0",
      bannerBackground: "#1a7a3c",
      bannerTextColor: "#ffffff",
    },
  },
  {
    id: "nagelstudio",
    name: "Nagelstudio",
    icon: "💅",
    description: "Altrosa, Creme und elegantes Gold",
    theme: {
      appearanceMode: "light",
      autoContrast: true,
      primaryColor: "#8f4961",
      primaryDark: "#673546",
      accentColor: "#d8b466",
      pageBackground: "#f8f4f1",
      registerBackground: "#f4ecea",
      bannerBackground: "#8f4961",
      bannerTextColor: "#ffffff",
    },
  },
  {
    id: "spa",
    name: "Modern Spa",
    icon: "🌿",
    description: "Salbei, Rosé und ruhige Flächen",
    theme: {
      appearanceMode: "light",
      autoContrast: true,
      primaryColor: "#4f6d63",
      primaryDark: "#394f48",
      accentColor: "#c88c8c",
      pageBackground: "#eef3f0",
      registerBackground: "#e4ece8",
      bannerBackground: "#4f6d63",
      bannerTextColor: "#ffffff",
    },
  },
  {
    id: "cafe",
    name: "Café",
    icon: "☕",
    description: "Kaffee, Karamell und warme Creme",
    theme: {
      appearanceMode: "light",
      autoContrast: true,
      primaryColor: "#6b4637",
      primaryDark: "#4d3328",
      accentColor: "#d9a15f",
      pageBackground: "#f5efe8",
      registerBackground: "#eee3d7",
      bannerBackground: "#6b4637",
      bannerTextColor: "#ffffff",
    },
  },
  {
    id: "baeckerei",
    name: "Bäckerei",
    icon: "🥐",
    description: "Honig, Sand und ein warmer Braunton",
    theme: {
      appearanceMode: "light",
      autoContrast: true,
      primaryColor: "#92572f",
      primaryDark: "#693f22",
      accentColor: "#efc66f",
      pageBackground: "#fff7e8",
      registerBackground: "#f8ecd7",
      bannerBackground: "#92572f",
      bannerTextColor: "#ffffff",
    },
  },
  {
    id: "friseur",
    name: "Friseur",
    icon: "✂️",
    description: "Violett, Lavendel und klare Kontraste",
    theme: {
      appearanceMode: "light",
      autoContrast: true,
      primaryColor: "#514876",
      primaryDark: "#3b3556",
      accentColor: "#c7a7d8",
      pageBackground: "#f5f2f8",
      registerBackground: "#ede8f3",
      bannerBackground: "#514876",
      bannerTextColor: "#ffffff",
    },
  },
  {
    id: "kiosk",
    name: "Kiosk",
    icon: "🧃",
    description: "Blau, Gelb und gut sichtbar",
    theme: {
      appearanceMode: "light",
      autoContrast: true,
      primaryColor: "#25598a",
      primaryDark: "#1b4064",
      accentColor: "#f2b544",
      pageBackground: "#eef4fa",
      registerBackground: "#e5eef7",
      bannerBackground: "#25598a",
      bannerTextColor: "#ffffff",
    },
  },
  {
    id: "luxus",
    name: "Luxury Dark",
    icon: "✨",
    description: "Anthrazit, Roségold und dunkle Flächen",
    theme: {
      appearanceMode: "dark",
      autoContrast: true,
      primaryColor: "#704c5a",
      primaryDark: "#503741",
      accentColor: "#d1af62",
      pageBackground: "#17181d",
      registerBackground: "#1f2229",
      bannerBackground: "#704c5a",
      bannerTextColor: "#ffffff",
    },
  },
];
