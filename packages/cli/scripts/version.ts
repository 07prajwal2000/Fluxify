// Writes today's version, `YYYY.M.DDNN`, the same scheme as the SDK.
import { nextVersion } from "../../sdk/scripts/version";

const file = Bun.file(new URL("../package.json", import.meta.url));
const pkg = await file.json();
pkg.version = nextVersion(pkg.version);
await Bun.write(file, `${JSON.stringify(pkg, null, "\t")}\n`);
console.log(pkg.version);
