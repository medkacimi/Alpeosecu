/**
 * Import des itinéraires et parkings OSM de Haute-Savoie dans PostGIS.
 *
 * Usage (depuis la racine du monorepo) :
 *   npm run osm:import                                  interroge Overpass
 *   npm run osm:import -- --save-dir cache              … et garde les réponses brutes
 *   npm run osm:import -- --from-dir cache              rejoue des réponses déjà téléchargées
 *   npm run osm:import -- --from-dir fixtures           jeu d'essai (sans réseau)
 *   npm run osm:import -- --force                       désactive le garde-fou de volume
 *
 * Le serveur Overpass public est partagé : ne pas lancer l'import en boucle.
 * Une fois par semaine suffit ; utiliser --save-dir / --from-dir pendant le développement.
 *
 * Données © contributeurs OpenStreetMap, licence ODbL.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createPool, loadRootEnv, requireEnv } from "@radar/db";
import { toParking, toTrail } from "./convert";
import { assertCompleteResponse, fetchOverpass, type OverpassResponse } from "./overpass";
import { storeImport } from "./store";

const QUERIES_DIR = new URL("../queries/", import.meta.url);
const DATASETS = ["trails", "parkings"] as const;
type Dataset = (typeof DATASETS)[number];

async function loadDataset(
  name: Dataset,
  options: { fromDir?: string; saveDir?: string; overpassUrl: string },
): Promise<OverpassResponse> {
  if (options.fromDir) {
    const file = path.resolve(options.fromDir, `${name}.json`);
    console.log(`Lecture de ${file}`);
    return JSON.parse(await readFile(file, "utf8")) as OverpassResponse;
  }

  const query = await readFile(new URL(`${name}.overpassql`, QUERIES_DIR), "utf8");
  console.log(`Requête Overpass « ${name} » (peut prendre plusieurs minutes)…`);
  const response = await fetchOverpass(options.overpassUrl, query);

  if (options.saveDir) {
    await mkdir(options.saveDir, { recursive: true });
    const file = path.resolve(options.saveDir, `${name}.json`);
    await writeFile(file, JSON.stringify(response));
    console.log(`Réponse brute enregistrée dans ${file}`);
  }
  return response;
}

async function main(): Promise<void> {
  loadRootEnv();
  const { values } = parseArgs({
    options: {
      "from-dir": { type: "string" },
      "save-dir": { type: "string" },
      force: { type: "boolean", default: false },
    },
  });

  // npm lance le script depuis tools/osm-import : on résout les chemins
  // relatifs par rapport au dossier où l'utilisateur a tapé la commande.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const options = {
    fromDir: values["from-dir"] && path.resolve(cwd, values["from-dir"]),
    saveDir: values["save-dir"] && path.resolve(cwd, values["save-dir"]),
    overpassUrl: process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter",
  };

  const [trailsResponse, parkingsResponse] = [
    await loadDataset("trails", options),
    await loadDataset("parkings", options),
  ];
  assertCompleteResponse(trailsResponse, "trails");
  assertCompleteResponse(parkingsResponse, "parkings");

  const trails = trailsResponse.elements.map(toTrail).filter((t) => t !== null);
  const parkings = parkingsResponse.elements.map(toParking).filter((p) => p !== null);
  console.log(`${trails.length} itinéraires et ${parkings.length} parkings exploitables.`);

  const pool = createPool(requireEnv("DATABASE_URL"));
  try {
    const stats = await storeImport(pool, trails, parkings, { force: values.force });
    console.table(stats);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
