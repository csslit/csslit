export const themeVarNames = {
  accent: "--theme-accent",
  background: "--theme-background",
  line: "--theme-line",
  muted: "--theme-muted",
  panel: "--theme-panel",
  secondary: "--theme-secondary",
  shadow: "--theme-shadow",
  text: "--theme-text",
} satisfies Record<string, `--${string}`>;

type ThemeKey = keyof typeof themeVarNames;
type ThemeValues = Record<ThemeKey, string>;
export type ThemeName = "dark" | "light";

export const theme = {
  accent: `var(${themeVarNames.accent})`,
  background: `var(${themeVarNames.background})`,
  line: `var(${themeVarNames.line})`,
  muted: `var(${themeVarNames.muted})`,
  panel: `var(${themeVarNames.panel})`,
  secondary: `var(${themeVarNames.secondary})`,
  shadow: `var(${themeVarNames.shadow})`,
  text: `var(${themeVarNames.text})`,
} satisfies Record<ThemeKey, `var(--${string})`>;

export const themes = {
  dark: {
    accent: "#e85aca",
    background: "#121016",
    line: "rgba(255, 255, 255, 0.12)",
    muted: "#aaa0b2",
    panel: "rgba(39, 32, 50, 0.3)",
    secondary: "#63d8d0",
    shadow: "rgba(0, 0, 0, 0.28)",
    text: "#f7f2f8",
  },
  light: {
    accent: "#a92a9e",
    background: "#f8f5fa",
    line: "rgba(36, 30, 41, 0.14)",
    muted: "#6f6675",
    panel: "rgba(255, 255, 255, 0.3)",
    secondary: "#087f87",
    shadow: "rgba(43, 29, 48, 0.12)",
    text: "#241e29",
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
