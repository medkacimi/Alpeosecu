/**
 * Usage (depuis la racine du monorepo) :
 *   npm run db:migrate   applique les migrations manquantes
 *   npm run db:seed      insère les données de démonstration
 *   npm run db:reset     efface le schéma radar puis ré-applique tout (base LOCALE uniquement)
 */
import { createPool, dropSchema, loadRootEnv, migrate, requireEnv, seed } from "./index";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db"]);

async function main(): Promise<void> {
  loadRootEnv();
  const command = process.argv[2];
  const url = requireEnv("DATABASE_URL");
  const pool = createPool(url);

  try {
    switch (command) {
      case "migrate":
        await migrate(pool);
        break;
      case "seed":
        await seed(pool);
        break;
      case "reset": {
        // Garde-fou : on refuse d'effacer une base distante (ex. production).
        const host = new URL(url).hostname;
        if (!LOCAL_HOSTS.has(host)) {
          throw new Error(`Refus de réinitialiser une base non locale (${host}).`);
        }
        await dropSchema(pool);
        await migrate(pool);
        await seed(pool);
        break;
      }
      default:
        throw new Error(`Commande inconnue : "${command}". Attendu : migrate | seed | reset`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
