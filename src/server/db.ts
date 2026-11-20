import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export type Row = Record<string, any>;
export interface Database { query<T extends Row = Row>(statement: SQL): Promise<T[]>; transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> }
const globalDb = globalThis as typeof globalThis & { hubDb?: Promise<Database> };

export async function database(): Promise<Database> {
  if (!globalDb.hubDb) globalDb.hubDb = openDatabase().catch(error => { globalDb.hubDb = undefined; throw error; });
  return globalDb.hubDb;
}
async function openDatabase(): Promise<Database> {
  const migration = await readFile(path.join(process.cwd(), 'src/server/migration.sql'), 'utf8');
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const migrationClient = await pool.connect();
    let migrationFailed = false;
    try {
      await migrationClient.query('BEGIN');
      // Serialize first boot across web and worker; IF NOT EXISTS alone can race.
      await migrationClient.query('SELECT pg_advisory_xact_lock(73819021)');
      await migrationClient.query(migration);
      await migrationClient.query('COMMIT');
    } catch (error) {
      migrationFailed = true;
      await migrationClient.query('ROLLBACK');
      throw error;
    } finally { migrationClient.release(); if (migrationFailed) await pool.end(); }
    const wrap = (orm: any): Database => ({
      async query<T extends Row>(statement: SQL) { const result = await orm.execute(statement); return result.rows as T[]; },
      transaction<T>(fn: (db: Database) => Promise<T>) { return orm.transaction((tx: any) => fn(wrap(tx))); },
    });
    return wrap(drizzle(pool));
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production');
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const location = process.env.HUB_DATA_DIR || path.join(process.cwd(), '.data', 'postgres');
  await mkdir(location, { recursive: true });
  const pg = new PGlite(location);
  await pg.exec(migration);
  const wrap = (orm: any): Database => ({
    async query<T extends Row>(statement: SQL) { const result = await orm.execute(statement); return result.rows as T[]; },
    transaction<T>(fn: (db: Database) => Promise<T>) { return orm.transaction((tx: any) => fn(wrap(tx))); },
  });
  return wrap(drizzle(pg));
}
export async function query<T extends Row = Row>(statement: SQL) { return (await database()).query<T>(statement); }
export { sql };
