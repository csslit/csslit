import type { ReactNode } from "react";
import { useInsertionEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { css } from "csslit";
import { Badge } from "./Badge.tsx";
import type { ThemeName } from "./theme.ts";
import { theme, themeDeclarations } from "./theme.ts";

const sellingPoints = [
  "Run real TypeScript at build time",
  "Ship extracted CSS modules",
  "Keep runtime styling small",
];
const lightThemeClass = "theme-light";
const darkThemeClass = "theme-dark";
const transitionAngleDegrees = 20;
const transitionDurationMs = 600;
const transitionQueuedPlaybackRate = 2;

css.global`
  html {
    ${themeDeclarations("light")}
    color-scheme: light dark;
    background:
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" style="background:%23609090"><path stroke="%2378a8a8" d="M.5 2v4m7-4v4M2 .5h4m0 1h1m-6 0h1m0 2h1m0-2h2m0 2h1m0 1h2m-8 0h2m0 1h1m0 1h2m0-1h1m-5 2h1m1 0h2m1 0h1"/></svg>')
        0 0 / 16px 16px repeat,
      radial-gradient(
        circle at 82% 0,
        color-mix(in srgb, ${theme.secondary} 10%, transparent),
        transparent 34%
      ),
      ${theme.background};
    background-attachment: fixed;
    background-blend-mode: overlay, normal;
    color: ${theme.text};
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    -webkit-tap-highlight-color: transparent;
  }

  body {
    margin: 0;
  }

  @media (prefers-color-scheme: dark) {
    html {
      ${themeDeclarations("dark")}
    }
  }

  html.${lightThemeClass} {
    ${themeDeclarations("light")}
  }

  html.${darkThemeClass} {
    ${themeDeclarations("dark")}
  }

  ::view-transition {
    pointer-events: none;
  }

  ::view-transition-group(old-theme),
  ::view-transition-old(old-theme) {
    animation: none;
  }
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
        background: ${theme.panel};
        backdrop-filter: blur(3px);
        box-shadow: 0 12px 28px ${theme.shadow};
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
  const transitionRunning = useRef(false);
  const transitionAnimation = useRef<Animation | null>(null);
  const preferredTheme: ThemeName = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const themeName = themeOverride ?? preferredTheme;
  const nextTheme: ThemeName = themeName === "dark" ? "light" : "dark";
  const targetTheme = useRef(themeName);

  function setDocumentThemeOverride(themeName: ThemeName | null) {
    document.documentElement.classList.toggle(lightThemeClass, themeName === "light");
    document.documentElement.classList.toggle(darkThemeClass, themeName === "dark");
  }

  useInsertionEffect(() => {
    setDocumentThemeOverride(themeOverride);
  }, [themeOverride]);

  async function runThemeTransition(theme: ThemeName) {
    transitionRunning.current = true;

    const angleOffset =
      Math.tan((transitionAngleDegrees * Math.PI) / 180) * document.documentElement.clientWidth;
    document.documentElement.style.viewTransitionName = "old-theme";
    const transition = document.startViewTransition(() => {
      document.documentElement.style.viewTransitionName = "none";
      flushSync(() => setThemeOverride(theme));
    });

    await transition.ready;

    const animation = document.documentElement.animate(
      {
        clipPath: [
          `polygon(0 -${angleOffset}px, 100% 0, 100% 100%, 0 100%)`,
          `polygon(0 100%, 100% calc(100% + ${angleOffset}px), 100% 100%, 0 100%)`,
        ],
      },
      {
        duration: transitionDurationMs,
        easing: "linear",
        fill: "both",
        pseudoElement: "::view-transition-old(old-theme)",
      },
    );
    transitionAnimation.current = animation;

    if (targetTheme.current !== theme) {
      animation.updatePlaybackRate(transitionQueuedPlaybackRate);
    }

    await animation.finished;
    await transition.finished;
    animation.cancel();
    document.documentElement.style.viewTransitionName = "";
    transitionAnimation.current = null;

    if (targetTheme.current !== theme) {
      await runThemeTransition(targetTheme.current);
      return;
    }

    transitionRunning.current = false;
  }

  function switchTheme() {
    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      targetTheme.current = nextTheme;
      flushSync(() => setThemeOverride(nextTheme));
      return;
    }

    targetTheme.current = targetTheme.current === "dark" ? "light" : "dark";

    if (transitionRunning.current) {
      transitionAnimation.current?.updatePlaybackRate(transitionQueuedPlaybackRate);
      return;
    }

    void runThemeTransition(targetTheme.current);
  }

  return (
    <main
      className={css`
        padding: 28px;
        box-sizing: border-box;
      `}
    >
      <section
        className={css`
          width: min(100%, 1040px);
          margin: 0 auto;
        `}
      >
        <div
          className={css`
            position: sticky;
            z-index: 1;
            top: 16px;
            display: flex;
            flex-wrap: wrap;
            width: fit-content;
            gap: 8px;
            margin-bottom: 18px;
          `}
        >
          <Badge>csslit</Badge>
          <Badge>compile-time css</Badge>
          <Badge>{themeOverride ? `${themeName} mode` : "system theme"}</Badge>
        </div>
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
            onClick={switchTheme}
            className={css`
              min-width: 144px;
              height: 44px;
              padding: 0 16px;
              border: 1px solid ${theme.line};
              border-radius: 8px;
              background: ${theme.panel};
              backdrop-filter: blur(3px);
              color: ${theme.text};
              font: inherit;
              font-weight: 800;
              letter-spacing: 0;
              cursor: pointer;
              box-shadow: 0 8px 20px ${theme.shadow};

              &:active {
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
              backdrop-filter: blur(3px);
              box-shadow: 0 18px 48px ${theme.shadow};
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
              csslit evaluates template interpolations while your app builds, so styles can use real
              JavaScript and TypeScript without becoming a client-side styling runtime.
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
                      font:
                        600 13px/1.4 "SFMono-Regular",
                        Consolas,
                        monospace;
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
              CSS is emitted as static styles and scoped by CSS Modules, while your components keep
              ordinary class names and predictable rendering.
            </FeatureCard>
          </aside>
        </div>
      </section>
    </main>
  );
}
