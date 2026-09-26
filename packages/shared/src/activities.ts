/**
 * Activités couvertes par Radar Montagne.
 * Doit rester identique au type SQL `radar.activity` (db/migrations/0001_init.sql).
 */
export const ACTIVITIES = ["hiking", "mtb", "ski"] as const;

export type Activity = (typeof ACTIVITIES)[number];

export const ACTIVITY_LABELS_FR: Record<Activity, string> = {
  hiking: "Randonnée",
  mtb: "VTT",
  ski: "Ski de fond / rando",
};

export function isActivity(value: unknown): value is Activity {
  return typeof value === "string" && (ACTIVITIES as readonly string[]).includes(value);
}
