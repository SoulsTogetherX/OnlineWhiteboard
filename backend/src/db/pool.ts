//#region Imports
import { Kysely, PostgresDialect } from "kysely"
import { Pool } from "pg"

import type { Database } from "./schema"
//#endregion

//#region Pool
// The raw pg Pool is still the thing that actually holds TCP connections to
// Postgres. Kysely does not manage connections itself — it borrows them from a
// pool you give it, via a "dialect". So there is exactly one pool process-wide.
//
// Every query now goes through Kysely; nothing issues raw `pool.query` any more.
// The default export is kept only so shutdown and test teardown can close the
// pool directly.
const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
})
//#endregion

//#region Kysely
// `db` is the typed query builder used by the repository layer. It is generic
// over the Database interface in ./schema, so every query it builds is checked
// against that shape at compile time.
export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
})
//#endregion

//#region Exports
export default pool
//#endregion
