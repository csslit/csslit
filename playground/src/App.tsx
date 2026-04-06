import { theme, multiply } from "./theme.ts";
import { css } from "csslit";
import { Badge } from "./Badge.tsx";

export default function App() {
  return (
    <div
      className={css`
        display: flex;
        flex-direction: column;
        gap: ${multiply(theme.gap, 2)}px;
        padding: 10px;
        background-color: #f0f0f0;
        border: 10px solid ${theme.colors.secondary};
        border-radius: 30px;
      `}
    >
      <h1
        className={css`
          margin: 0px;
          color: ${theme.colors.primary};
        `}
      >
        Hello Compile-Time CSS!
      </h1>
      <button
        className={css`
          padding: 10px;
          background: ${theme.colors.primary};
          color: white;
          border: none;
          border-radius: 10px;
          &:hover {
            background: ${theme.colors.secondary};
          }
        `}
      >
        Click Me
      </button>
      <Badge label="New" />
    </div>
  );
}
