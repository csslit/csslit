import { createServeWebLocator } from "./serve-web-locator.ts";
import { createTsgoLocator } from "./tsgo-locator.ts";
import { createTsServerLocator } from "./tsserver-locator.ts";
import type { TemplateLocator } from "./locator.ts";
import type { HarnessInit } from "./vscode-harness.ts";

type FrameworkIntegration = {
  installExtension: string;
  tsserverPlugin: string;
  harness: Omit<HarnessInit, "file">;
  workspacePlugins?: readonly { name: string }[];
};

export type Framework = {
  name: string;
  fileExtension: string;
  integration?: FrameworkIntegration;
  serveWebPortOffset: number;
  wrap: (declaration: string) => string;
};

const IMPORT = 'import { css } from "@csslit/core";';

const tsx: Framework = {
  name: "tsx",
  fileExtension: ".tsx",
  serveWebPortOffset: 0,
  wrap: (declaration) =>
    `${IMPORT}\n\n${declaration}\n\nexport const App = () => <div className={a} />;\n`,
};

const tsrx: Framework = {
  name: "tsrx",
  fileExtension: ".tsrx",
  serveWebPortOffset: 1,
  integration: {
    installExtension: "ripple-ts.ripple-ts-vscode-plugin@2.0.61",
    tsserverPlugin: "@tsrx/typescript-plugin",
    harness: {
      activateExtension: "ripple-ts.ripple-ts-vscode-plugin",
      expectedFrameworkPlugin: "@tsrx/typescript-plugin",
    },
    workspacePlugins: [{ name: "@csslit/typescript-plugin" }, { name: "@tsrx/typescript-plugin" }],
  },
  wrap: (declaration) =>
    `${IMPORT}\n\nexport function Box() @{\n  ${declaration}\n  <div class={a}>{"hi"}</div>\n}\n`,
};

const vue: Framework = {
  name: "vue",
  fileExtension: ".vue",
  serveWebPortOffset: 2,
  integration: {
    installExtension: "Vue.volar@3.3.8",
    tsserverPlugin: "@vue/typescript-plugin",
    harness: {
      activateExtension: "Vue.volar",
      expectedFrameworkPlugin: "vue-typescript-plugin-pack",
    },
  },
  wrap: (declaration) =>
    `<script setup lang="ts">\n${IMPORT}\n\n${declaration}\n</script>\n\n<template><div :class="a" /></template>\n`,
};

const mdx: Framework = {
  name: "mdx",
  fileExtension: ".mdx",
  serveWebPortOffset: 3,
  integration: {
    installExtension: "unifiedjs.vscode-mdx@1.8.17",
    tsserverPlugin: "@mdx-js/typescript-plugin",
    // MDX contributes its tsserver plugin statically. Activating it is unnecessary and slow.
    harness: {
      expectedFrameworkPlugin: "@mdx-js/typescript-plugin",
    },
  },
  wrap: (declaration) =>
    `${IMPORT}\n\n${declaration.replace(/^const /gm, "export const ")}\n\n# Heading\n`,
};

export type Target = {
  name: string;
  framework: Framework;
  createLocator: () => TemplateLocator;
  tsgo?: boolean;
};

export const serveWebTargets: Target[] = [
  {
    name: "tsx",
    framework: tsx,
    createLocator: () => createServeWebLocator(tsx),
  },
  {
    name: "tsrx",
    framework: tsrx,
    createLocator: () => createServeWebLocator(tsrx),
  },
  {
    name: "vue",
    framework: vue,
    createLocator: () => createServeWebLocator(vue),
  },
  {
    name: "mdx",
    framework: mdx,
    createLocator: () => createServeWebLocator(mdx),
  },
];

export const fastTargets: Target[] = [
  {
    name: "tsx (tsserver)",
    framework: tsx,
    createLocator: () => createTsServerLocator(tsx),
  },
  {
    name: "tsx (tsgo)",
    framework: tsx,
    createLocator: createTsgoLocator,
    tsgo: true,
  },
  {
    name: "tsrx",
    framework: tsrx,
    createLocator: () => createTsServerLocator(tsrx),
  },
  {
    name: "vue",
    framework: vue,
    createLocator: () => createTsServerLocator(vue),
  },
  {
    name: "mdx",
    framework: mdx,
    createLocator: () => createTsServerLocator(mdx),
  },
];
