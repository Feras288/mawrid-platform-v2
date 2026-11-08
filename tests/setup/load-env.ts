import { existsSync } from "node:fs";
import { join } from "node:path";

const f = join(process.cwd(), ".env");
if (existsSync(f)) process.loadEnvFile(f);
