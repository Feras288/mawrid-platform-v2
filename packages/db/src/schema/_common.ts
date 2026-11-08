import { uuidv7 } from "@platform/core";
import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
export const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** numeric(18,2) as string — use Decimal in code. */
export const amount = (name: string) => numeric(name, { precision: 18, scale: 2 });
/** numeric(18,4) as string. */
export const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
