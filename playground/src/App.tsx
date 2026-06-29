import type { ReactNode } from "react";
import { useState } from "react";
import { css } from "csslit";
import { Badge } from "./Badge.tsx";
import { theme, themeDeclarations, type ThemeName } from "./theme.ts";

const sellingPoints = ["Run real TypeScript at build time", "Ship extracted CSS modules", "Keep runtime styling small"];
const lightTheme = css`
  color-scheme: light;
`;
const darkTheme = css`
  color-scheme: dark;
`;

function FeatureCard({
  eyebrow,
  title,
  children,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <article
      className={css`
        min-height: 160px;
        padding: 18px;
        border: 1px solid ${theme.line};
        border-radius: 8px;
        background:
          linear-gradient(135deg, color-mix(in srgb, ${theme.panel} 90%, transparent), transparent),
          ${theme.panel};
        box-shadow: 0 20px 60px ${theme.glow};
      `}
    >
      <p
        className={css`
          margin: 0 0 10px;
          color: ${theme.secondary};
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
        `}
      >
        {eyebrow}
      </p>
      <h2
        className={css`
          margin: 0 0 12px;
          color: ${theme.text};
          font-size: 20px;
          line-height: 1.12;
          letter-spacing: 0;
        `}
      >
        {title}
      </h2>
      <p
        className={css`
          margin: 0;
          color: ${theme.muted};
          font-size: 14px;
          line-height: 1.55;
        `}
      >
        {children}
      </p>
    </article>
  );
}

export default function App() {
  const [themeOverride, setThemeOverride] = useState<ThemeName | null>(null);
  const preferredTheme: ThemeName = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const themeName = themeOverride ?? preferredTheme;
  const nextTheme: ThemeName = themeName === "dark" ? "light" : "dark";

  return (
    <main
      className={`${css`
        ${themeDeclarations("light")} color-scheme: light dark;

        @media (prefers-color-scheme: dark) {
        ${themeDeclarations("dark")}
        }

        &.${lightTheme} {
          ${themeDeclarations("light")}
        }

        &.${darkTheme} {
          ${themeDeclarations("dark")}
        }

        position: fixed;
        inset: 0;
        overflow: auto;
        min-width: 320px;
        padding: 28px;
        background:
          linear-gradient(180deg, color-mix(in srgb, ${theme.background} 70%, #000), ${theme.background}),
          radial-gradient(circle at 20% 10%, ${theme.glow}, transparent 32%),
          radial-gradient(circle at 82% 18%, color-mix(in srgb, ${theme.secondary} 26%, transparent), transparent 30%);
        color: ${theme.text};
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-sizing: border-box;
      `} ${themeOverride === "light" ? lightTheme : themeOverride === "dark" ? darkTheme : ""}`}
    >
      <section
        className={css`
          width: min(100%, 1040px);
          margin: 0 auto;
        `}
      >
        <header
          className={css`
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 20px;
            align-items: start;
            margin-bottom: 28px;

            @media (max-width: 720px) {
              grid-template-columns: 1fr;
            }
          `}
        >
          <div>
            <div
              className={css`
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 18px;
              `}
            >
              <Badge>csslit</Badge>
              <Badge>compile-time css</Badge>
              <Badge>{themeOverride ? `${themeName} mode` : "system theme"}</Badge>
            </div>
            <h1
              className={css`
                max-width: 780px;
                margin: 0;
                color: ${theme.text};
                font-size: clamp(42px, 8vw, 86px);
                line-height: 0.92;
                letter-spacing: 0;
              `}
            >
              CSS literals that execute before they ship.
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setThemeOverride(nextTheme)}
            className={css`
              min-width: 144px;
              height: 44px;
              padding: 0 16px;
              border: 1px solid ${theme.line};
              border-radius: 8px;
              background: ${theme.panel};
              color: ${theme.text};
              font: inherit;
              font-weight: 800;
              letter-spacing: 0;
              cursor: pointer;
              box-shadow: 0 16px 40px ${theme.glow};

              &:hover {
                border-color: ${theme.secondary};
                color: ${theme.secondary};
              }
            `}
          >
            Use {nextTheme}
          </button>
        </header>

        <div
          className={css`
            display: grid;
            grid-template-columns: 1.1fr 0.9fr;
            gap: 18px;

            @media (max-width: 860px) {
              grid-template-columns: 1fr;
            }
          `}
        >
          <section
            className={css`
              padding: 22px;
              border: 1px solid ${theme.line};
              border-radius: 8px;
              background: ${theme.panel};
              box-shadow: 0 24px 80px ${theme.glow};
            `}
          >
            <p
              className={css`
                margin: 0 0 18px;
                color: ${theme.muted};
                font-size: 16px;
                line-height: 1.6;
              `}
            >
              csslit evaluates template interpolations while your app builds, so styles can
              use real JavaScript and TypeScript without becoming a client-side styling runtime.
            </p>
            <ol
              className={css`
                display: grid;
                gap: 10px;
                margin: 0;
                padding: 0;
                list-style: none;
              `}
            >
              {sellingPoints.map((sellingPoint, index) => (
                <li
                  key={sellingPoint}
                  className={css`
                    display: grid;
                    grid-template-columns: 34px minmax(0, 1fr);
                    gap: 12px;
                    align-items: center;
                    padding: 12px;
                    border: 1px solid ${theme.line};
                    border-radius: 8px;
                    background: color-mix(in srgb, ${theme.background} 72%, transparent);
                    color: ${theme.text};
                    font-size: 14px;
                  `}
                >
                  <span
                    className={css`
                      display: grid;
                      place-items: center;
                      width: 34px;
                      height: 34px;
                      border-radius: 999px;
                      background: ${theme.accent};
                      color: ${theme.background};
                      font-weight: 900;
                    `}
                  >
                    {index + 1}
                  </span>
                  <code
                    className={css`
                      overflow-wrap: anywhere;
                      color: ${theme.text};
                      font: 600 13px/1.4 "SFMono-Regular", Consolas, monospace;
                    `}
                  >
                    {sellingPoint}
                  </code>
                </li>
              ))}
            </ol>
          </section>

          <aside
            className={css`
              display: grid;
              gap: 18px;
            `}
          >
            <FeatureCard eyebrow="Build time" title="Execute the code you already trust">
              Use constants, functions, and typed modules inside styles. csslit resolves the static
              parts before the browser ever sees the component.
            </FeatureCard>
            <FeatureCard eyebrow="Runtime" title="No styling runtime tax">
              CSS is emitted as static styles and scoped by CSS Modules, while your
              components keep ordinary class names and predictable rendering.
            </FeatureCard>
          </aside>
        </div>
      </section>
    </main>
  );
}
