import type { ReactNode } from "react";
import { css } from "@csslit/core";
import { theme } from "./theme.ts";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      className={css`
        position: relative;
        isolation: isolate;
        display: inline-flex;
        align-items: center;
        height: 28px;
        padding: 0 10px;
        border: 1px solid transparent;
        border-radius: 999px;
        backdrop-filter: blur(3px);
        box-shadow: 0 4px 12px ${theme.shadow};
        color: ${theme.text};
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
        white-space: nowrap;

        &::before {
          position: absolute;
          z-index: -1;
          inset: -1px;
          border: 1px solid transparent;
          border-radius: inherit;
          background:
            padding-box image(rgb(from ${theme.panel} r g b / 1)),
            border-box
              linear-gradient(
                200deg,
                color-mix(
                  in srgb,
                  ${theme.text} 48%,
                  color-mix(in srgb, ${theme.secondary} 18%, ${theme.background})
                ),
                color-mix(in srgb, ${theme.text} 34%, ${theme.background})
              );
          content: "";
          opacity: 0.3;
          pointer-events: none;
        }
      `}
    >
      {children}
    </span>
  );
}
