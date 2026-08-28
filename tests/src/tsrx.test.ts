import { expect, test } from "vite-plus/test";
import tsrxReact from "@tsrx/vite-plugin-react";
import tsrxPreact from "@tsrx/vite-plugin-preact";
import tsrxSolid from "@tsrx/vite-plugin-solid";
import { octane } from "@octanejs/vite-plugin";
import solid from "@solidjs/vite-plugin";

import { buildSnapshot } from "../harness/csslit-harness.ts";

const tsrxComponent = `
  import { css } from "@csslit/core";

  const box = css\`
    color: hotpink;
  \`;

  export function Box() @{
    <div class={box}>{"hi"}</div>
  }
`;

test("react tsrx build extracts csslit css", async () => {
  const result = await buildSnapshot({
    entry: "/src/Box.tsrx",
    files: { "/src/Box.tsrx": tsrxComponent },
    moduleType: { ".tsrx": "js" },
    plugins: [tsrxReact()],
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/Box.tsrx
    const _jsx = __vite__cjsImport3_react_jsxRuntime["jsx"];
    import "/src/Box.tsrx.csslit.css";
    import __css_module_import from "/src/Box.tsrx.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import __vite__cjsImport3_react_jsxRuntime from "/@fs/<root>/tests/node_modules/.vite/deps/react_jsx-runtime.js";
    const box = __css_module_import.css_3_13;
    export function Box() {
      return /* @__PURE__ */ _jsx("div", {
        class: box,
        children: "hi",
      });
    }

    # js /src/Box.tsrx.csslit.json
    export const css_3_13 = "uTwjTV_3_13";
    export default {
      css_3_13,
    };

    # css /src/Box.tsrx.csslit.css
    .uTwjTV_3_13 {
      color: #ff69b4;
    }
    "
  `);
});

test("preact tsrx build extracts csslit css", async () => {
  const result = await buildSnapshot({
    entry: "/src/Box.tsrx",
    files: { "/src/Box.tsrx": tsrxComponent },
    moduleType: { ".tsrx": "js" },
    plugins: [tsrxPreact()],
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/Box.tsrx
    import "/src/Box.tsrx.csslit.css";
    import __css_module_import from "/src/Box.tsrx.csslit.json?import";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import { jsx as _jsx } from "/@fs/<root>/tests/node_modules/.vite/deps/preact_jsx-runtime.js";
    const box = __css_module_import.css_3_13;
    export function Box() {
      return /* @__PURE__ */ _jsx("div", {
        class: box,
        children: "hi",
      });
    }

    # js /src/Box.tsrx.csslit.json
    export const css_3_13 = "uTwjTV_3_13";
    export default {
      css_3_13,
    };

    # css /src/Box.tsrx.csslit.css
    .uTwjTV_3_13 {
      color: #ff69b4;
    }
    "
  `);
});

test("solid tsrx build extracts csslit css", async () => {
  const result = await buildSnapshot({
    entry: "/src/Box.tsrx",
    files: { "/src/Box.tsrx": tsrxComponent },
    plugins: [tsrxSolid(), solid({ hot: false })],
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/Box.tsrx
    import "/src/Box.tsrx.tsx.csslit.css";
    import __css_module_import from "/src/Box.tsrx.tsx.csslit.json?import";
    import { template as _$template } from "/@fs/<root>/tests/node_modules/.vite/deps/@solidjs_web.js";
    import { className as _$className } from "/@fs/<root>/tests/node_modules/.vite/deps/@solidjs_web.js";
    import { effect as _$effect } from "/@fs/<root>/tests/node_modules/.vite/deps/@solidjs_web.js";
    var _tmpl$ = /* @__PURE__ */ _$template(\`<div>hi\`);
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const box = __css_module_import.css_6_13;
    export function Box() {
      var _el$ = _tmpl$();
      _$effect(
        () => box,
        (_v$, _$p) => {
          _$className(_el$, _v$, _$p);
        },
      );
      return _el$;
    }

    # js /src/Box.tsrx.csslit.json
    export const css_6_13 = "Q6ncYu_6_13";
    export default {
      css_6_13,
    };

    # css /src/Box.tsrx.tsx.csslit.css
    .Q6ncYu_6_13 {
      color: #ff69b4;
    }
    "
  `);
});

test("octane tsrx build extracts csslit css", async () => {
  const result = await buildSnapshot({
    entry: "/src/Box.tsrx",
    files: { "/src/Box.tsrx": tsrxComponent },
    moduleType: { ".tsrx": "js" },
    plugins: [octane()],
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/Box.tsrx
    import { createHotContext as __vite__createHotContext } from "/@vite/client";
    import.meta.hot = __vite__createHotContext(
      "/@id/<root>/src/Box.tsrx",
    );
    import "/src/Box.tsrx.csslit.css";
    import __css_module_import from "/src/Box.tsrx.csslit.json?import";
    import {
      HMR as _$HMR,
      bag2 as _$bag2,
      clone as _$clone,
      hmr as _$hmr,
      setClassAttr as _$setClassAttr,
      template as _$template,
    } from "/@fs/<root>/node_modules/octane/dist/index.js";
    const _t$0 = /* @__PURE__ */ _$template("<div>hi</div>");
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const box = __css_module_import.css_14_13;
    export const Box = _$hmr(function Box(__props, __s, __extra) {
      let _b = __s.slots[0];
      if (_b === undefined) {
        let _m1;
        const _root = _$clone(_t$0, "Box.tsrx:8:2");
        _root.__oct_loc = "Box.tsrx:8:2";
        _m1 = _root;
        _b = _$bag2(__s, _root, undefined, _m1);
      }
      {
        const _v = box;
        if (_b.a !== _v) {
          _$setClassAttr(_b.b, _v);
          _b.a = _v;
        }
      }
    });
    Box.$$singleRoot = true;
    try {
      Box.__oct_loc = "Box.tsrx:7:7";
    } catch {}
    if (import.meta.hot) {
      import.meta.hot.accept((module) => {
        if (!Box[_$HMR].update(module.Box)) import.meta.hot.invalidate();
      });
    }

    # js /src/Box.tsrx.csslit.json
    export const css_14_13 = "yFx7zL_14_13";
    export default {
      css_14_13,
    };

    # css /src/Box.tsrx.csslit.css
    .yFx7zL_14_13 {
      color: #ff69b4;
    }
    "
  `);
});
