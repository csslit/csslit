import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/licenses", { recursive: true });
copyFileSync("../node_modules/@tsrx/core/LICENSE", "dist/licenses/tsrx-core.txt");
copyFileSync("../node_modules/typescript6/LICENSE.txt", "dist/licenses/typescript6.txt");
copyFileSync("../node_modules/typescript/LICENSE", "dist/licenses/typescript7.txt");
copyFileSync("../node_modules/typescript/NOTICE.txt", "dist/licenses/typescript7-notice.txt");
