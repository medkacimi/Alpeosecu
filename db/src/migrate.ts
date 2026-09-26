import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const SEEDS_DIR = fileURLToPath(new URL("../seeds/", import.meta.url));

/**
 * Applique, dans l'ordre alphabétique, les fichiers de db/migrations/ qui ne
 * l'ont pas encore été. Chaque fichier est exécuté dans une transaction :
 * s'il échoue, rien n'est appliqué et on s'arrête.
 *
 * Règle d'équipe : une migration déjà appliquée (donc commitée) ne se modifie
 * JAMAIS ; on en ajoute une nouvelle (0002_..., 0003_...).
 */
export async function migrate(pool: pg.Pool, log: (msg: string) => void = console.log): Promise<string[]> {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS radar;
    CREATE TABLE IF NOT EXISTS radar.schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM radar.schema_migrations");
  const alreadyApplied = new Set(rows.map((r) => r.filename));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    if (alreadyApplied.has(file)) continue;

    const sql = await readFile(MIGRATIONS_DIR + file, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO radar.schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log(`✔ migration appliquée : ${file}`);
      applied.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Échec de la migration ${file} : ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  if (applied.length === 0) log("Base déjà à jour.");
  return applied;
}

/** Exécute tous les fichiers de db/seeds/ (données de démonstration). */
export async function seed(pool: pg.Pool, log: (msg: string) => void = console.log): Promise<void> {
  const files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await pool.query(await readFile(SEEDS_DIR + file, "utf8"));
    log(`✔ seed exécuté : ${file}`);
  }
}

/** Supprime TOUT le schéma radar (données comprises). Réservé au développement et aux tests. */
export async function dropSchema(pool: pg.Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS radar CASCADE");
}
