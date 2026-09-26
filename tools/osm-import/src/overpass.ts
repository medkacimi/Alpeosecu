/**
 * Types et accès HTTP à l'API Overpass.
 * Format des réponses : https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export type Tags = Record<string, string>;

export interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}

export interface OverpassWay {
  type: "way";
  id: number;
  tags?: Tags;
  /** Présent avec `out geom`. */
  geometry?: LatLon[];
  /** Présent avec `out center`. */
  center?: LatLon;
}

export interface OverpassRelationMember {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
  /** Présent pour les membres de type way avec `out geom`. */
  geometry?: LatLon[];
}

export interface OverpassRelation {
  type: "relation";
  id: number;
  tags?: Tags;
  members?: OverpassRelationMember[];
  center?: LatLon;
}

export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

export interface OverpassResponse {
  elements: OverpassElement[];
  /** Overpass renvoie parfois un HTTP 200 avec une réponse tronquée et un message ici. */
  remark?: string;
}

/** Vérifie qu'une réponse est complète ; lève une erreur sinon. */
export function assertCompleteResponse(response: OverpassResponse, label: string): void {
  if (!Array.isArray(response.elements)) {
    throw new Error(`Réponse Overpass invalide pour "${label}" : pas de tableau "elements".`);
  }
  if (response.remark) {
    throw new Error(`Réponse Overpass incomplète pour "${label}" : ${response.remark}`);
  }
}

const USER_AGENT = "RadarMontagne-import/0.1 (projet etudiant)";

/**
 * Envoie une requête Overpass QL. Réessaie avec un délai croissant en cas de
 * surcharge du serveur (429 / 504), pour respecter le serveur public.
 */
export async function fetchOverpass(overpassUrl: string, query: string, maxAttempts = 4): Promise<OverpassResponse> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(overpassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(6 * 60 * 1000),
    });

    if (response.ok) {
      return (await response.json()) as OverpassResponse;
    }

    const retryable = response.status === 429 || response.status === 504;
    if (!retryable || attempt >= maxAttempts) {
      throw new Error(`Overpass a répondu ${response.status} : ${(await response.text()).slice(0, 300)}`);
    }

    const waitSeconds = 30 * attempt;
    console.warn(`Overpass occupé (${response.status}), nouvel essai dans ${waitSeconds} s…`);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
}
