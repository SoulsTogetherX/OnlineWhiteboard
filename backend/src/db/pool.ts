//#region Imports
import { Pool } from "pg"
//#endregion

//#region Pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
})
//#endregion

//#region Exports
export default pool
//#endregion
