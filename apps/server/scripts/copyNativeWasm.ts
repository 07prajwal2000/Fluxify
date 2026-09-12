import { createRequire } from "module";
import path from "path";

/**
 * The Kafka client's compression helper (@platformatic/wasm-utils) loads
 * `new URL("../dist/native.wasm", import.meta.url)` at runtime. Bundling keeps
 * that relative path, so it resolves against the bundle: for a bundle in any
 * `<dir>/x.js` it means `<dir>/../dist/native.wasm`. Copying the file into
 * dist/ covers local runs of the bundles; the Docker images copy it again to
 * /app/dist, the path their bundle directories resolve to.
 */
const serverPath = path.join(import.meta.dir, "..");
const fromAdapters = createRequire(path.join(serverPath, "../../packages/adapters/package.json"));
const fromKafka = createRequire(fromAdapters.resolve("@platformatic/kafka"));
const wasm = path.join(path.dirname(fromKafka.resolve("@platformatic/wasm-utils")), "native.wasm");

await Bun.write(path.join(serverPath, "dist/native.wasm"), Bun.file(wasm));
