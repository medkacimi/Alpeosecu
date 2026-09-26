/**
 * Écriture des itinéraires et parkings en base, en UNE transaction :
 * soit tout l'import réussit, soit la base reste inchangée.
 */
import { PILOT_ZONE } from "@radar/shared";
import type pg from "pg";
import type { ParkingRow, TrailRow } from "./convert";

/** Distance max (m) entre un parking et un itinéraire pour qu'il soit conservé. */
export const PARKING_MAX_DISTANCE_M = 500;

/**
 * Garde-fou : si le nouvel import contient moins de la moitié des itinéraires
 * déjà en base, c'est sans doute une réponse Overpass incomplète. On refuse
 * (sauf option force) pour ne pas effacer la moitié de la carte.
 */
export const MIN_RATIO_VS_EXISTING = 0.5;

export interface ImportStats {
  trailsUpserted: number;
  trailsOutsideZone: number;
  trailsRemoved: number;
  parkingsKept: number;
  parkingsRemoved: number;
}

const { minLon, minLat, maxLon, maxLat } = PILOT_ZONE.bbox;
const ZONE_ENVELOPE = `ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;

// On découpe chaque itinéraire à l'emprise de la zone pilote (un GR peut
// traverser plusieurs départements), puis on fusionne les tronçons contigus.
const UPSERT_TRAIL_SQL = `
  WITH clipped AS (
    SELECT ST_Multi(ST_LineMerge(ST_CollectionExtract(
             ST_Intersection(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), ${ZONE_ENVELOPE}),
             2))) AS geom
  )
  INSERT INTO radar.trails (osm_type, osm_id, name, ref, activities, difficulty, geom, osm_tags, imported_at)
  SELECT $1, $2, $3, $4, $5::radar.activity[], $6, clipped.geom, $8, $9
  FROM clipped
  WHERE NOT ST_IsEmpty(clipped.geom)
  ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    name        = EXCLUDED.name,
    ref         = EXCLUDED.ref,
    activities  = EXCLUDED.activities,
    difficulty  = EXCLUDED.difficulty,
    geom        = EXCLUDED.geom,
    osm_tags    = EXCLUDED.osm_tags,
    imported_at = EXCLUDED.imported_at
`;

const UPSERT_PARKING_SQL = `
  INSERT INTO radar.parkings (osm_type, osm_id, name, geom, capacity, imported_at)
  SELECT $1, $2, $3, pt, $6, $7
  FROM (SELECT ST_SetSRID(ST_MakePoint($4, $5), 4326) AS pt) p
  WHERE ST_Intersects(pt, ${ZONE_ENVELOPE})
  ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    name        = EXCLUDED.name,
    geom        = EXCLUDED.geom,
    capacity    = EXCLUDED.capacity,
    imported_at = EXCLUDED.imported_at
`;

export async function storeImport(
  pool: pg.Pool,
  trails: TrailRow[],
  parkings: ParkingRow[],
  options: { force?: boolean } = {},
): Promise<ImportStats> {
  const client = await pool.connect();
  const runStartedAt = new Date();

  try {
    await client.query("BEGIN");

    const existing = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM radar.trails");
    const existingCount = existing.rows[0]?.n ?? 0;
    if (!options.force && existingCount > 0 && trails.length < existingCount * MIN_RATIO_VS_EXISTING) {
      throw new Error(
        `Import refusé : ${trails.length} itinéraires reçus contre ${existingCount} en base. ` +
          `Réponse Overpass probablement incomplète. Relancer avec --force si c'est voulu.`,
      );
    }

    let trailsUpserted = 0;
    for (const t of trails) {
      const result = await client.query(UPSERT_TRAIL_SQL, [
        t.osmType,
        t.osmId,
        t.name,
        t.ref,
        t.activities,
        t.difficulty,
        JSON.stringify(t.geometry),
        t.tags,
        runStartedAt,
      ]);
      trailsUpserted += result.rowCount ?? 0;
    }

    // Itinéraires supprimés d'OSM depuis le dernier import (ou sortis de la zone).
    const removedTrails = await client.query("DELETE FROM radar.trails WHERE imported_at < $1", [runStartedAt]);

    for (const p of parkings) {
      await client.query(UPSERT_PARKING_SQL, [p.osmType, p.osmId, p.name, p.lon, p.lat, p.capacity, runStartedAt]);
    }

    // On ne garde que les parkings récents ET proches d'un itinéraire.
    const removedParkings = await client.query(
      `DELETE FROM radar.parkings p
       WHERE p.imported_at < $1
          OR NOT EXISTS (
            SELECT 1 FROM radar.trails t
            WHERE ST_DWithin(t.geom::geography, p.geom::geography, $2)
          )`,
      [runStartedAt, PARKING_MAX_DISTANCE_M],
    );
    const keptParkings = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM radar.parkings");

    await client.query("COMMIT");

    return {
      trailsUpserted,
      trailsOutsideZone: trails.length - trailsUpserted,
      trailsRemoved: removedTrails.rowCount ?? 0,
      parkingsKept: keptParkings.rows[0]?.n ?? 0,
      parkingsRemoved: removedParkings.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
