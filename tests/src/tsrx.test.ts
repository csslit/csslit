import { expect, test } from "vite-plus/test";
import tsrxReact from "@tsrx/vite-plugin-react";
import tsrxPreact from "@tsrx/vite-plugin-preact";
import tsrxSolid from "@tsrx/vite-plugin-solid";
import { ripple } from "@ripple-ts/vite-plugin";
import solid from "vite-plugin-solid";

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
    const _jsx = __vite__cjsImport2_react_jsxRuntime["jsx"];import __css_module_import from "/src/Box.tsrx.csslit.module.js";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import __vite__cjsImport2_react_jsxRuntime from "/@fs/<root>/tests/node_modules/.vite/deps/react_jsx-runtime.js";
    const box = __css_module_import.css_3_13;
    export function Box() {
    	return /* @__PURE__ */ _jsx("div", {
    		class: box,
    		children: "hi"
    	});
    }

    # js /src/Box.tsrx.csslit.module.js
    import "/src/Box.tsrx.csslit.css";
    export default { "css_3_13": "uTwjTV_3_13" };

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
    import __css_module_import from "/src/Box.tsrx.csslit.module.js";
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    import { jsx as _jsx } from "/@fs/<root>/tests/node_modules/.vite/deps/preact_jsx-runtime.js";
    const box = __css_module_import.css_3_13;
    export function Box() {
    	return /* @__PURE__ */ _jsx("div", {
    		class: box,
    		children: "hi"
    	});
    }

    # js /src/Box.tsrx.csslit.module.js
    import "/src/Box.tsrx.csslit.css";
    export default { "css_3_13": "uTwjTV_3_13" };

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
    import __css_module_import from "/src/Box.tsrx.tsx.csslit.module.js";
    import { template as _$template } from "/@fs/<root>/tests/node_modules/.vite/deps/solid-js_web.js";
    import { className as _$className } from "/@fs/<root>/tests/node_modules/.vite/deps/solid-js_web.js";
    var _tmpl$ = /*#__PURE__*/ _$template(\`<div>hi\`);
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const box = __css_module_import.css_5_13;
    export function Box() {
    	return (() => {
    		var _el$ = _tmpl$();
    		_$className(_el$, box);
    		return _el$;
    	})();
    }

    # js /src/Box.tsrx.csslit.module.js
    import "/src/Box.tsrx.tsx.csslit.css";
    export default { "css_5_13": "bAiTpx_5_13" };

    # css /src/Box.tsrx.tsx.csslit.css
    .bAiTpx_5_13 {
      color: #ff69b4;
    }
    "
  `);
});

test("ripple build extracts csslit css", async () => {
  const result = await buildSnapshot({
    entry: "/src/Box.tsrx",
    files: { "/src/Box.tsrx": tsrxComponent },
    moduleType: { ".tsrx": "js" },
    plugins: [ripple()],
  });

  expect(result).toMatchInlineSnapshot(`
    "
    # js /src/Box.tsrx
    import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/@id/<root>/src/Box.tsrx");import __css_module_import from "/src/Box.tsrx.csslit.module.js";
    import * as _$_ from "/@fs/<root>/tests/node_modules/.vite/deps/ripple_internal_client.js";
    var root = _$_.template(\`<div>hi</div>\`, 0);
    import { css } from "/@fs/<root>/packages/core/dist/index.js";
    const box = __css_module_import.css_7_13;
    function Box() {
    	return _$_.tsrx_element((__anchor, __block) => {
    		var div = root();
    		_$_.set_class(div, box, void 0, true);
    		_$_.append(__anchor, div);
    	});
    }
    Box = _$_.hmr(Box);
    export { Box };
    if (import.meta.hot) {
    	import.meta.hot.accept((module) => {
    		Box[_$_.HMR].update(module.Box);
    	});
    }
    ;

    # js /src/Box.tsrx.csslit.module.js
    import "/src/Box.tsrx.csslit.css";
    export default { "css_7_13": "yhtN6t_7_13" };

    # css /src/Box.tsrx.csslit.css
    .yhtN6t_7_13 {
      color: #ff69b4;
    }
    "
  `);
});
