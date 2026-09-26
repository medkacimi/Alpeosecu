/** Test d'intégration : nécessite TEST_DATABASE_URL (base vidée à chaque exécution). */
import { readFileSync } from "node:fs";
import { createPool, dropSchema, loadRootEnv, migrate } from "@radar/db";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toParking, toTrail } from "../src/convert";
import type { OverpassResponse } from "../src/overpass";
import { storeImport } from "../src/store";

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8")) as OverpassResponse;
const trails = load("trails").elements.map(toTrail).filter((t) => t !== null);
const parkings = load("parkings").elements.map(toParking).filter((p) => p !== null);

describe.skipIf(!url)("storeImport", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(url!);
    await dropSchema(pool);
    await migrate(pool, () => {});
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("importe les itinéraires de la zone et écarte ceux hors zone", async () => {
    const stats = await storeImport(pool, trails, parkings);
    expect(stats).toMatchObject({ trailsUpserted: 3, trailsOutsideZone: 1, trailsRemoved: 0 });
  });

  it("découpe un itinéraire qui sort de la zone", async () => {
    const { rows } = await pool.query<{ min_lon: number }>(
      "SELECT ST_XMin(geom) AS min_lon FROM radar.trails WHERE osm_id = 9000002",
    );
    expect(rows[0]?.min_lon).toBeCloseTo(5.8, 6);
  });

  it("fusionne les tronçons contigus et calcule la longueur", async () => {
    const { rows } = await pool.query<{ parts: number; length_m: number }>(
      "SELECT ST_NumGeometries(geom) AS parts, length_m FROM radar.trails WHERE osm_id = 9000001",
    );
    expect(rows[0]?.parts).toBe(1);
    expect(rows[0]?.length_m).toBeGreaterThan(1000);
    expect(rows[0]?.length_m).toBeLessThan(1600);
  });

  it("ne garde que les parkings proches d'un itinéraire", async () => {
    const { rows } = await pool.query<{ osm_id: string }>("SELECT osm_id FROM radar.parkings ORDER BY osm_id");
    expect(rows.map((r) => Number(r.osm_id))).toEqual([9100001, 9100002]);
  });

  it("est ré-exécutable sans doublon et conserve les identifiants internes", async () => {
    const before = await pool.query("SELECT id, osm_id FROM radar.trails ORDER BY id");
    await storeImport(pool, trails, parkings);
    const after = await pool.query("SELECT id, osm_id FROM radar.trails ORDER BY id");
    expect(after.rows).toEqual(before.rows);
  });

  it("supprime un itinéraire disparu d'OSM", async () => {
    const stats = await storeImport(pool, trails.filter((t) => t.osmId !== 9000003), parkings);
    expect(stats.trailsRemoved).toBe(1);
  });

  it("refuse un import anormalement petit, sauf avec force", async () => {
    await expect(storeImport(pool, [], parkings)).rejects.toThrow(/Import refusé/);
    const count = await pool.query("SELECT 1 FROM radar.trails");
    expect(count.rowCount).toBe(2); // rien n'a été effacé (ROLLBACK)
  });
});
