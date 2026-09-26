/**
 * Zone pilote : Haute-Savoie (département 74).
 *
 * L'emprise (bbox) est un rectangle APPROXIMATIF englobant le département,
 * relevé à la main : il déborde un peu sur la Savoie, l'Ain et la Suisse.
 * Il sert à refuser les points manifestement hors zone et à découper les
 * itinéraires qui sortent du département (ex. GR 5). À affiner si besoin
 * avec le vrai contour administratif.
 */
export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export const PILOT_ZONE = {
  name: "Haute-Savoie",
  inseeCode: "74",
  bbox: { minLon: 5.8, minLat: 45.68, maxLon: 7.05, maxLat: 46.42 } satisfies BBox,
  /** Centre de carte par défaut (environ Annecy / Aravis). */
  center: { lon: 6.35, lat: 45.95 },
} as const;

export function isInBBox(lon: number, lat: number, bbox: BBox): boolean {
  return lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
}

export function isInPilotZone(lon: number, lat: number): boolean {
  return isInBBox(lon, lat, PILOT_ZONE.bbox);
}
