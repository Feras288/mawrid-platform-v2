import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Load the nearest .env walking up from cwd (Node built-in loader; no override of existing vars).
let dir = process.cwd();
for (let i = 0; i < 6; i++) {
  const f = join(dir, ".env");
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
