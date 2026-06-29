import type { ReactNode } from "react";
import { css } from "csslit";
import { theme } from "./theme.ts";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      className={css`
        display: inline-flex;
        align-items: center;
        height: 28px;
        padding: 0 10px;
        border: 1px solid ${theme.line};
        border-radius: 999px;
        background: color-mix(in srgb, ${theme.accent} 16%, transparent);
        color: ${theme.text};
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
        white-space: nowrap;
      `}
    >
      {children}
    </span>
  );
}
