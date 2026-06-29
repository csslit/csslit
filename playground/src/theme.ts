export const themeVarNames = {
  accent: "--theme-accent",
  background: "--theme-background",
  glow: "--theme-glow",
  line: "--theme-line",
  muted: "--theme-muted",
  panel: "--theme-panel",
  secondary: "--theme-secondary",
  text: "--theme-text",
} satisfies Record<string, `--${string}`>;

type ThemeKey = keyof typeof themeVarNames;
type ThemeValues = Record<ThemeKey, string>;
export type ThemeName = "dark" | "light";

export const theme = {
  accent: `var(${themeVarNames.accent})`,
  background: `var(${themeVarNames.background})`,
  glow: `var(${themeVarNames.glow})`,
  line: `var(${themeVarNames.line})`,
  muted: `var(${themeVarNames.muted})`,
  panel: `var(${themeVarNames.panel})`,
  secondary: `var(${themeVarNames.secondary})`,
  text: `var(${themeVarNames.text})`,
} satisfies Record<ThemeKey, `var(--${string})`>;

export const themes = {
  dark: {
    accent: "#ff4fd8",
    background: "#12081f",
    glow: "rgba(255, 79, 216, 0.34)",
    line: "rgba(255, 255, 255, 0.18)",
    muted: "#baa8d8",
    panel: "rgba(30, 14, 54, 0.78)",
    secondary: "#42f5e9",
    text: "#fff8ff",
  },
  light: {
    accent: "#c31fb8",
    background: "#fff0fb",
    glow: "rgba(195, 31, 184, 0.22)",
    line: "rgba(57, 20, 72, 0.18)",
    muted: "#6c5a78",
    panel: "rgba(255, 255, 255, 0.76)",
    secondary: "#008d98",
    text: "#23142f",
  },
} satisfies Record<ThemeName, ThemeValues>;

export function themeDeclarations(themeName: ThemeName) {
  const theme = themes[themeName];
  let declarations = "";

  for (const key of Object.keys(themeVarNames) as ThemeKey[]) {
    declarations += `${themeVarNames[key]}: ${theme[key]};\n`;
  }

  return declarations;
}
