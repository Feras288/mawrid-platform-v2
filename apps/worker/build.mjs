// Production bundle for the worker and the one-shot migrate command.
// Workspace packages (@platform/*) are TypeScript sources → bundled. npm dependencies stay external and
// are installed in the image (pnpm deploy), so native/binary packages keep working.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifests = ["apps/worker", "packages/core", "packages/db", "packages/integrations", "packages/modules"].map((p) => JSON.parse(readFileSync(join(root, p, "package.json"), "utf8")));
const external = new Set(["pg-native"]);
for (const m of manifests) for (const d of Object.keys({ ...m.dependencies, ...m.peerDependencies })) if (!d.startsWith("@platform/")) external.add(d);

await build({
  entryPoints: { main: join(root, "apps/worker/src/main.ts"), migrate: join(root, "packages/db/src/cli/migrate.ts") },
  outdir: join(root, "apps/worker/dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: [...external].flatMap((d) => [d, `${d}/*`]),
  // some bundled sources use require() via createRequire; provide a module-scoped require for safety
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
