import pg from "pg";

/**
 * Crée un pool de connexions PostgreSQL.
 * Convention : dans le code applicatif, on préfixe toujours les tables par
 * leur schéma (`radar.trails`) plutôt que de modifier le search_path.
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 5 });
}
