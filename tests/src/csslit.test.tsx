import { expect, test } from "vite-plus/test";
import { css } from "csslit";
import theme from "./theme";

test("css litteral works", async () => {
  document.body.className = css`
    background: hotpink;
  `;

  expect(getComputedStyle(document.body).backgroundColor).toBe("rgb(255, 105, 180)");
});

test("css litteral with theme interpolation works", async () => {
  document.body.className = css`
    background: ${theme.colors.primary};
  `;

  expect(getComputedStyle(document.body).backgroundColor).toBe("rgb(255, 105, 180)");
});
