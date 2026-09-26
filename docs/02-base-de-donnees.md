# 02 — Schéma de base de données (PostgreSQL + PostGIS)

> Statut : **validé**. Le schéma est dans
> [`db/migrations/0001_init.sql`](../db/migrations/0001_init.sql), testé
> automatiquement sur PostgreSQL 16 + PostGIS 3.4 (`db/test`, `tools/osm-import/test`).

## 1. Modèle en un coup d'œil

```
 condition_types ──┐
   (code, ttl)     │
                   ▼
 profiles ──< reports >── trails        (données OSM importées)
   │  (uuid     (point,     (multiligne)
   │   Supabase) expires_at)   ▲
   │               │           │
   │               └──> parkings        (données OSM importées)
   │
   ├──< trail_follows >── trails
   ├──< push_tokens
   └──< notifications_sent >── reports
```

| Table | Contenu | Écrite par |
|---|---|---|
| `condition_types` | Boue, Neige, Fermé, Parking saturé, RAS + durée de vie | migration |
| `trails` | Itinéraires rando / VTT / ski issus d'OSM | `tools/osm-import` |
| `parkings` | Parkings OSM proches des itinéraires | `tools/osm-import` |
| `profiles` | 1 ligne par compte Supabase (id + pseudo, rien d'autre) | API, à la 1ʳᵉ requête authentifiée |
| `reports` | Les signalements | API (`POST /reports`) |
| `trail_follows` | Itinéraires suivis par un utilisateur | API |
| `push_tokens` | Tokens Expo Push des appareils | API |
| `notifications_sent` | Journal anti-doublon des notifications | API |

## 2. Décisions de conception

1. **Une seule règle spatiale à retenir : stocker en `geometry(…, 4326)`,
   mesurer en `::geography`.** Le SRID 4326 correspond aux coordonnées GPS
   (longitude, latitude) : c'est ce que renvoient Expo Location, Leaflet et
   GeoJSON, donc aucune conversion. Pour les distances en mètres
   (« sentier à moins de 50 m »), on caste en `geography`. Des **index sur
   l'expression `(geom::geography)`** permettent à ces requêtes d'utiliser un
   index (vérifié avec `EXPLAIN`). Il faut écrire le cast exactement
   `geom::geography` dans les requêtes pour qu'il soit utilisé.
2. **Expiration sans tâche planifiée.** Chaque signalement a un `expires_at`
   calculé à l'insertion (`now() + ttl_hours` de son type). Toutes les lectures
   passent par la vue `active_reports`, qui filtre `expires_at > now()`. Un
   signalement expiré disparaît donc de la carte tout seul. Les vieilles lignes
   restent en base (utile pour des statistiques en soutenance). Une purge peut
   être ajoutée plus tard si besoin.
3. **Types de condition en table, pas en `ENUM`.** Changer une durée de vie ou
   ajouter un type = un `UPDATE`/`INSERT`, pas une migration de type. Les codes
   sont dupliqués dans `packages/shared/conditions.ts` (pour les pictos) ; un
   test automatique vérifiera que les deux listes sont identiques.
4. **Pas de commentaire libre sur les signalements.** Sans modération (hors
   scope V1), un champ texte libre est un risque (contenu abusif, données
   personnelles). Le signalement se limite à « type + lieu + heure ».
5. **Pas de clé étrangère vers `auth.users`.** `profiles.id` reprend le `sub`
   du JWT Supabase. Le schéma reste ainsi valable si la base est hébergée
   ailleurs que chez Supabase.
6. **Schéma `radar` dédié.** Si la base est celle de Supabase, les tables du
   schéma `public` sont exposées par défaut via l'API REST automatique de
   Supabase. Un schéma séparé non exposé garantit que seule notre API Express
   y accède. À vérifier dans les réglages « Data API → Exposed schemas » du
   projet Supabase.
7. **`location_source` et `accuracy_m`.** On sait si le point vient du GPS ou
   d'un appui sur la carte, et avec quelle précision. Cela coûte deux colonnes et
   permettra plus tard de pondérer la fiabilité sans changer le schéma.
8. **Clé d'import `(osm_type, osm_id)`.** Réimporter OSM met à jour les
   sentiers existants au lieu de les dupliquer ; les `id` internes restent
   stables, donc les signalements et suivis ne sont pas cassés.

## 3. DDL

Le SQL complet et commenté se trouve dans
[`db/migrations/0001_init.sql`](../db/migrations/0001_init.sql). Il n'est pas
recopié ici pour éviter deux versions divergentes.

Règles pour la suite :

- Une migration commitée ne se modifie **jamais** : toute évolution passe par
  un nouveau fichier `0002_….sql`, appliqué avec `npm run db:migrate`.
- La migration commence par `SET search_path = radar, public, extensions;` :
  chez Supabase, PostGIS est installé dans le schéma `extensions`.
- Dans le code applicatif (API, import), les tables sont toujours écrites
  avec leur schéma : `radar.trails`, `radar.reports`…

## 4. Requêtes types (testées)

**Créer un signalement** : l'expiration et le sentier le plus proche (≤ 50 m)
sont calculés par la base.

```sql
WITH p AS (SELECT ST_SetSRID(ST_MakePoint($lon, $lat), 4326) AS pt)
INSERT INTO radar.reports (user_id, condition_code, location, location_source, trail_id, expires_at)
SELECT $userId, $condition, p.pt, $locationSource,
       (SELECT t.id FROM radar.trails t
         WHERE ST_DWithin(t.geom::geography, p.pt::geography, 50)
         ORDER BY t.geom::geography <-> p.pt::geography
         LIMIT 1),
       now() + make_interval(hours => (SELECT ttl_hours FROM radar.condition_types WHERE code = $condition))
FROM p
RETURNING id, trail_id, created_at, expires_at;
```

**Lire les signalements actifs visibles à l'écran**

```sql
SELECT id, condition_code, trail_id, created_at, expires_at,
       ST_AsGeoJSON(location)::json AS geometry
FROM radar.active_reports
WHERE location && ST_MakeEnvelope($minLon, $minLat, $maxLon, $maxLat, 4326);
```

**Lire les sentiers visibles** (géométrie simplifiée selon le zoom ; la
tolérance exacte sera réglée en test)

```sql
SELECT id, name, ref, activities, difficulty, length_m,
       ST_AsGeoJSON(ST_Simplify(geom, $toleranceDeg))::json AS geometry
FROM radar.trails
WHERE geom && ST_MakeEnvelope($minLon, $minLat, $maxLon, $maxLat, 4326)
  AND ($activity::radar.activity IS NULL OR $activity::radar.activity = ANY (activities));
```

**Qui notifier après un signalement ?** (itinéraire suivi à ≤ 200 m)

```sql
SELECT DISTINCT f.user_id
FROM radar.reports r
JOIN radar.trails t        ON ST_DWithin(t.geom::geography, r.location::geography, 200)
JOIN radar.trail_follows f ON f.trail_id = t.id
WHERE r.id = $reportId
  AND f.user_id <> r.user_id
  AND NOT EXISTS (SELECT 1 FROM radar.notifications_sent n
                  WHERE n.report_id = r.id AND n.user_id = f.user_id);
```

(`$…` = paramètres ; avec la lib `pg` ils s'écriront `$1, $2…`.)

## 5. Hors V1, mais le schéma ne l'empêche pas

- Confirmation d'un signalement par d'autres (« toujours d'actualité ») :
  table `report_confirmations(report_id, user_id)` qui repousserait `expires_at`.
- Purge / archivage des signalements expirés (`DELETE … WHERE expires_at < now() - interval '90 days'`).
- Tuiles vectorielles (`ST_AsMVT`) si l'affichage des sentiers en GeoJSON
  devient trop lourd.
- Autres zones géographiques : aucune colonne propre à la Haute-Savoie dans le
  schéma ; seule l'emprise de l'import et de la validation change.
