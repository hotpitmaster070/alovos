// PGlite (in-memory Postgres) with stubbed Supabase roles, auth and storage. Not a real Supabase project.
// PGLITE_DIR must point at a node_modules directory that contains @electric-sql/pglite.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const dir = process.env.PGLITE_DIR;
if (!dir) throw new Error("Set PGLITE_DIR to a node_modules directory that contains @electric-sql/pglite");
const load = async (spec) => import(pathToFileURL(createRequire(path.join(dir, "x.js")).resolve(spec)).href);
const { PGlite } = await load("@electric-sql/pglite");
const { pgcrypto } = await load("@electric-sql/pglite/contrib/pgcrypto");

const MIGRATIONS = path.resolve("supabase/migrations");
export const migrationFiles = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
export const readMigration = (file) => fs.readFileSync(path.join(MIGRATIONS, file), "utf8");

process.on("unhandledRejection", (e) => {
  console.log("ERROR " + e.message + (e.query ? " in: " + e.query.slice(0, 300) : ""));
  process.exit(1);
});

export function reporter() {
  const counts = { pass: 0, fail: 0 };
  const ok = (name, cond, extra = "") => {
    cond ? counts.pass++ : counts.fail++;
    console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : " -> " + JSON.stringify(extra)));
  };
  const done = () => {
    console.log(`\n${counts.pass} passed, ${counts.fail} failed`);
    process.exit(counts.fail === 0 ? 0 : 1);
  };
  return { ok, done };
}

export const userId = (n) => `00000000-0000-0000-0000-0000000000${n}`;

export async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'') $$;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text default auth.uid()::text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant execute on all functions in schema auth, storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;`);

  const q = async (sql, params) => (await db.query(sql, params)).rows;

  /** Runs sql as an authenticated user (RLS and column privileges apply). */
  const as = async (uid, sql, params) => {
    await db.exec("set role authenticated");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)",
      [uid],
    );
    try {
      const r = await db.query(sql, params);
      return { rows: r.rows, affected: r.affectedRows };
    } catch (e) {
      return { err: e.message };
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false)");
    }
  };

  /** Applies migrations; returns the error message of the first one that fails, rolling back its transaction. */
  const apply = async (files) => {
    for (const file of files) {
      try {
        await db.exec(readMigration(file));
      } catch (e) {
        await db.exec("rollback").catch(() => {});
        return `${file}: ${e.message}`;
      }
    }
    return null;
  };

  return { db, q, as, apply };
}
