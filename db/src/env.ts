import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Charge le fichier .env à la racine du monorepo, s'il existe. */
export function loadRootEnv(): void {
  const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  }
  return value;
}
