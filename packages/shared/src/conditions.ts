/**
 * Types de condition qu'un utilisateur peut signaler.
 *
 * Les codes doivent être identiques à ceux de la table `radar.condition_types`
 * (un test dans db/test le vérifie). La durée de vie (TTL) n'est PAS ici :
 * la base de données en est la seule source, l'API renvoie `expiresAt`.
 */
export const CONDITION_CODES = ["mud", "snow", "closed", "parking_busy", "all_clear"] as const;

export type ConditionCode = (typeof CONDITION_CODES)[number];

export interface ConditionInfo {
  code: ConditionCode;
  labelFr: string;
  /** Pictogramme provisoire, à remplacer par de vraies icônes. */
  emoji: string;
}

/** Dans l'ordre d'affichage de la feuille de signalement. */
export const CONDITIONS: readonly ConditionInfo[] = [
  { code: "mud", labelFr: "Boue", emoji: "🟤" },
  { code: "snow", labelFr: "Neige", emoji: "❄️" },
  { code: "closed", labelFr: "Chemin fermé", emoji: "⛔" },
  { code: "parking_busy", labelFr: "Parking saturé", emoji: "🅿️" },
  { code: "all_clear", labelFr: "RAS", emoji: "✅" },
];

export function isConditionCode(value: unknown): value is ConditionCode {
  return typeof value === "string" && (CONDITION_CODES as readonly string[]).includes(value);
}
