/**
 * Tests d'intégration sur une vraie base PostGIS.
 * Ils utilisent TEST_DATABASE_URL (base VIDÉE à chaque exécution) et sont
 * ignorés si cette variable n'est pas définie.
 */
import { CONDITION_CODES, ACTIVITIES } from "@radar/shared";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, dropSchema, loadRootEnv, migrate, seed } from "../src";

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("schéma radar", () => {
  let pool: pg.Pool;
  const quiet = () => {};

  beforeAll(async () => {
    pool = createPool(url!);
    await dropSchema(pool);
    await migrate(pool, quiet);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("est idempotent : relancer migrate n'applique rien", async () => {
    expect(await migrate(pool, quiet)).toEqual([]);
  });

  it("a les mêmes codes de condition que @radar/shared", async () => {
    const { rows } = await pool.query<{ code: string }>("SELECT code FROM radar.condition_types ORDER BY sort_order");
    expect(rows.map((r) => r.code)).toEqual([...CONDITION_CODES]);
  });

  it("a les mêmes activités que @radar/shared", async () => {
    const { rows } = await pool.query<{ a: string }>("SELECT unnest(enum_range(NULL::radar.activity))::text AS a");
    expect(rows.map((r) => r.a)).toEqual([...ACTIVITIES]);
  });

  it("n'expose que les signalements non expirés dans active_reports", async () => {
    await seed(pool, quiet);
    const all = await pool.query("SELECT 1 FROM radar.reports");
    const active = await pool.query("SELECT 1 FROM radar.active_reports");
    expect(all.rowCount).toBe(4);
    expect(active.rowCount).toBe(3);
  });

  it("peut ré-exécuter le seed sans doublon", async () => {
    await seed(pool, quiet);
    const all = await pool.query("SELECT 1 FROM radar.reports");
    expect(all.rowCount).toBe(4);
  });
});
