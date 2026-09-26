/**
 * Conversion des éléments Overpass en objets prêts à être insérés en base.
 * Fonctions pures (sans réseau ni base) : faciles à tester.
 */
import type { Activity } from "@radar/shared";
import type { LatLon, OverpassElement, Tags } from "./overpass";

/** Géométrie GeoJSON (coordonnées [longitude, latitude]). */
export interface MultiLineString {
  type: "MultiLineString";
  coordinates: [number, number][][];
}

export interface TrailRow {
  osmType: "way" | "relation";
  osmId: number;
  name: string | null;
  ref: string | null;
  activities: Activity[];
  difficulty: string | null;
  geometry: MultiLineString;
  tags: Tags;
}

export interface ParkingRow {
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string | null;
  lon: number;
  lat: number;
  capacity: number | null;
  tags: Tags;
}

/** Déduit les activités à partir des tags OSM. Un même itinéraire peut en avoir plusieurs. */
export function activitiesFromTags(tags: Tags): Activity[] {
  const activities = new Set<Activity>();
  const route = tags["route"];
  const piste = tags["piste:type"];

  if (route === "hiking" || route === "foot") activities.add("hiking");
  if (route === "mtb") activities.add("mtb");
  if (piste === "nordic" || piste === "skitour") activities.add("ski");

  return [...activities];
}

/** Niveau de difficulté brut, dans la notation OSM de l'activité principale. */
export function difficultyFromTags(tags: Tags): string | null {
  return tags["sac_scale"] ?? tags["mtb:scale"] ?? tags["piste:difficulty"] ?? null;
}

function toLine(points: LatLon[]): [number, number][] {
  return points.map((p) => [p.lon, p.lat]);
}

/** Construit la géométrie : les chemins (ways) membres d'une relation, ou le way lui-même. */
function geometryOf(element: OverpassElement): MultiLineString | null {
  let lines: [number, number][][] = [];

  if (element.type === "way" && element.geometry) {
    lines = [toLine(element.geometry)];
  } else if (element.type === "relation" && element.members) {
    lines = element.members
      .filter((m) => m.type === "way" && m.geometry)
      .map((m) => toLine(m.geometry!));
  }

  // Une ligne a besoin d'au moins 2 points.
  lines = lines.filter((line) => line.length >= 2);
  return lines.length > 0 ? { type: "MultiLineString", coordinates: lines } : null;
}

/**
 * Convertit un élément en itinéraire, ou renvoie null s'il est inutilisable
 * (activité non couverte, pas de géométrie — ex. une « superroute » qui ne
 * contient que d'autres relations).
 */
export function toTrail(element: OverpassElement): TrailRow | null {
  if (element.type === "node") return null;

  const tags = element.tags ?? {};
  const activities = activitiesFromTags(tags);
  if (activities.length === 0) return null;

  const geometry = geometryOf(element);
  if (!geometry) return null;

  return {
    osmType: element.type,
    osmId: element.id,
    name: tags["name"] ?? null,
    ref: tags["ref"] ?? null,
    activities,
    difficulty: difficultyFromTags(tags),
    geometry,
    tags,
  };
}

function parseCapacity(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/** Convertit un parking (nœud, ou surface avec `out center`) ; null si pas de position. */
export function toParking(element: OverpassElement): ParkingRow | null {
  const tags = element.tags ?? {};
  if (tags["amenity"] !== "parking") return null;
  // Parkings privés (résidences, entreprises) : inutiles pour les pratiquants.
  if (tags["access"] === "private" || tags["access"] === "no") return null;

  const position = element.type === "node" ? { lon: element.lon, lat: element.lat } : element.center;
  if (!position) return null;

  return {
    osmType: element.type,
    osmId: element.id,
    name: tags["name"] ?? null,
    lon: position.lon,
    lat: position.lat,
    capacity: parseCapacity(tags["capacity"]),
    tags,
  };
}
