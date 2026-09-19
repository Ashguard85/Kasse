import {
  THEME_PRESETS,
  contrastRatio,
  getThemeChecks,
  getThemeRuntime,
} from "../src/lib/themePresets.js";

const MIN_TEXT_CONTRAST = 4.5;
let failures = 0;

for (const preset of THEME_PRESETS) {
  const runtime = getThemeRuntime(preset.theme);
  const checks = [
    ...getThemeChecks(preset.theme),
    {
      id: "navMuted",
      label: "Navigation sekundär",
      ratio: contrastRatio(runtime.primaryColor, runtime.primaryTextMuted),
    },
  ];

  for (const check of checks) {
    if (check.ratio + 1e-9 < MIN_TEXT_CONTRAST) {
      failures += 1;
      console.error(`${preset.name}: ${check.label} ${check.ratio.toFixed(2)}:1 < ${MIN_TEXT_CONTRAST}:1`);
    }
  }
}

if (failures) {
  console.error(`Kontrastprüfung fehlgeschlagen: ${failures} Problem(e).`);
  process.exit(1);
}

console.log(`Kontrastprüfung OK: ${THEME_PRESETS.length} Vorlagen, alle geprüften Textkombinationen >= ${MIN_TEXT_CONTRAST}:1.`);
