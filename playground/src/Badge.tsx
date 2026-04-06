import { css } from "csslit";
import { theme } from "./theme.ts";

export function Badge({ label }: { label: string }) {
  return (
    <span
      className={css`
        display: inline-block;
        padding: 10px 10px;
        background: ${theme.colors.secondary};
        color: white;
        border-radius: 10px;
        font-size: 12px;
      `}
    >
      {label}
    </span>
  );
}
