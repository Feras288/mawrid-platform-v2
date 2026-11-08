import "./_env";
import { runMigrations } from "../migrator";

const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUserPassword = process.env.APP_DB_PASSWORD;
if (!ownerUrl || !appUserPassword) {
  console.error("DATABASE_OWNER_URL and APP_DB_PASSWORD are required");
  process.exit(1);
}
await runMigrations({ ownerUrl, appUserPassword });
console.log("migrations complete");
