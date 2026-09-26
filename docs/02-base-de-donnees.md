# 02 — Schéma de base de données (PostgreSQL + PostGIS)

> Statut : **proposition à valider**. Le SQL ci-dessous a été exécuté sans
> erreur sur PostgreSQL 16 + PostGIS 3.4, et les requêtes de la section 4 ont
> été testées sur des données factices. Il deviendra `db/migrations/0001_init.sql`
> une fois validé.

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

## 3. DDL complet

```sql
-- ============================================================
-- Radar Montagne — schéma V1 (PostgreSQL 15+ / PostGIS 3.x)
-- Règle unique : on STOCKE en geometry SRID 4326 (lon/lat WGS84),
-- on MESURE en mètres via un cast ::geography.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- Schéma dédié : il n'est PAS exposé par l'API REST automatique de Supabase
-- (seul "public" l'est par défaut). Seule notre API Express y accède.
CREATE SCHEMA IF NOT EXISTS radar;
SET search_path = radar, public;

-- ------------------------------------------------------------
-- 1. Référentiels
-- ------------------------------------------------------------
CREATE TYPE activity AS ENUM ('hiking', 'mtb', 'ski');

-- Types de condition : table plutôt qu'ENUM pour pouvoir modifier
-- une durée de vie ou un libellé sans migration de type.
CREATE TABLE condition_types (
    code        text PRIMARY KEY,               -- 'mud', 'snow', ...
    label_fr    text NOT NULL,
    ttl_hours   integer NOT NULL CHECK (ttl_hours BETWEEN 1 AND 72),
    sort_order  integer NOT NULL DEFAULT 0
);

INSERT INTO condition_types (code, label_fr, ttl_hours, sort_order) VALUES
    ('mud',          'Boue',                48, 1),
    ('snow',         'Neige',               48, 2),
    ('closed',       'Chemin fermé',        48, 3),
    ('parking_busy', 'Parking saturé',      24, 4),
    ('all_clear',    'RAS',                 24, 5);

-- ------------------------------------------------------------
-- 2. Données OpenStreetMap importées (licence ODbL)
-- ------------------------------------------------------------
CREATE TABLE trails (
    id           bigserial PRIMARY KEY,
    osm_type     text   NOT NULL CHECK (osm_type IN ('way', 'relation')),
    osm_id       bigint NOT NULL,
    name         text,
    ref          text,                           -- ex. "GR 5"
    activities   activity[] NOT NULL CHECK (cardinality(activities) > 0),
    difficulty   text,                           -- sac_scale / mtb:scale / piste:difficulty brut
    geom         geometry(MultiLineString, 4326) NOT NULL,
    length_m     integer GENERATED ALWAYS AS (round(ST_Length(geom::geography))::integer) STORED,
    osm_tags     jsonb  NOT NULL DEFAULT '{}'::jsonb,
    imported_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (osm_type, osm_id)
);
CREATE INDEX trails_geom_gix       ON trails USING gist (geom);
CREATE INDEX trails_geog_gix       ON trails USING gist ((geom::geography));
CREATE INDEX trails_activities_gin ON trails USING gin (activities);

CREATE TABLE parkings (
    id           bigserial PRIMARY KEY,
    osm_type     text   NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id       bigint NOT NULL,
    name         text,
    geom         geometry(Point, 4326) NOT NULL,   -- centroïde si surface
    capacity     integer,                          -- tag OSM "capacity" si présent
    imported_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (osm_type, osm_id)
);
CREATE INDEX parkings_geom_gix ON parkings USING gist (geom);
CREATE INDEX parkings_geog_gix ON parkings USING gist ((geom::geography));

-- ------------------------------------------------------------
-- 3. Utilisateurs (l'identité vit dans Supabase Auth)
-- ------------------------------------------------------------
-- id = claim "sub" du JWT Supabase. Pas de FK vers auth.users :
-- le schéma reste portable si la base n'est pas hébergée chez Supabase.
CREATE TABLE profiles (
    id            uuid PRIMARY KEY,
    display_name  text CHECK (char_length(display_name) <= 40),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 4. Signalements
-- ------------------------------------------------------------
CREATE TABLE reports (
    id               bigserial PRIMARY KEY,
    user_id          uuid   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    condition_code   text   NOT NULL REFERENCES condition_types(code),
    activity         activity,                       -- ce que faisait l'auteur (facultatif)
    location         geometry(Point, 4326) NOT NULL,
    location_source  text   NOT NULL CHECK (location_source IN ('gps', 'map_tap')),
    accuracy_m       real   CHECK (accuracy_m >= 0), -- précision GPS fournie par Expo Location
    trail_id         bigint REFERENCES trails(id)   ON DELETE SET NULL,
    parking_id       bigint REFERENCES parkings(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    deleted_at       timestamptz,                    -- retrait par l'auteur (soft delete)
    CHECK (expires_at > created_at)
);
CREATE INDEX reports_location_gix  ON reports USING gist (location);
CREATE INDEX reports_expires_idx   ON reports (expires_at) WHERE deleted_at IS NULL;
CREATE INDEX reports_trail_idx     ON reports (trail_id);
CREATE INDEX reports_user_idx      ON reports (user_id, created_at DESC);

-- Vue de lecture : la SEULE source utilisée par GET /reports.
-- L'expiration est « automatique » par construction : aucune tâche
-- planifiée n'est nécessaire pour que la carte reste fraîche.
CREATE VIEW active_reports AS
    SELECT *
    FROM reports
    WHERE deleted_at IS NULL
      AND expires_at > now();

-- ------------------------------------------------------------
-- 5. Suivi d'itinéraires & notifications push
-- ------------------------------------------------------------
CREATE TABLE trail_follows (
    user_id     uuid   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    trail_id    bigint NOT NULL REFERENCES trails(id)   ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, trail_id)
);
CREATE INDEX trail_follows_trail_idx ON trail_follows (trail_id);

CREATE TABLE push_tokens (
    token         text PRIMARY KEY,                -- "ExponentPushToken[...]"
    user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    platform      text NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);

-- Journal d'envoi : empêche d'envoyer deux fois la même alerte.
CREATE TABLE notifications_sent (
    report_id  bigint NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    user_id    uuid   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    sent_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (report_id, user_id)
);
```

## 4. Requêtes types (testées)

**Créer un signalement** : l'expiration et le sentier le plus proche (≤ 50 m)
sont calculés par la base.

```sql
WITH p AS (SELECT ST_SetSRID(ST_MakePoint($lon, $lat), 4326) AS pt)
INSERT INTO reports (user_id, condition_code, location, location_source, trail_id, expires_at)
SELECT $userId, $condition, p.pt, $locationSource,
       (SELECT t.id FROM trails t
         WHERE ST_DWithin(t.geom::geography, p.pt::geography, 50)
         ORDER BY t.geom::geography <-> p.pt::geography
         LIMIT 1),
       now() + make_interval(hours => (SELECT ttl_hours FROM condition_types WHERE code = $condition))
FROM p
RETURNING id, trail_id, created_at, expires_at;
```

**Lire les signalements actifs visibles à l'écran**

```sql
SELECT id, condition_code, trail_id, created_at, expires_at,
       ST_AsGeoJSON(location)::json AS geometry
FROM active_reports
WHERE location && ST_MakeEnvelope($minLon, $minLat, $maxLon, $maxLat, 4326);
```

**Lire les sentiers visibles** (géométrie simplifiée selon le zoom ; la
tolérance exacte sera réglée en test)

```sql
SELECT id, name, ref, activities, difficulty, length_m,
       ST_AsGeoJSON(ST_Simplify(geom, $toleranceDeg))::json AS geometry
FROM trails
WHERE geom && ST_MakeEnvelope($minLon, $minLat, $maxLon, $maxLat, 4326)
  AND ($activity::radar.activity IS NULL OR $activity::radar.activity = ANY (activities));
```

**Qui notifier après un signalement ?** (itinéraire suivi à ≤ 200 m)

```sql
SELECT DISTINCT f.user_id
FROM reports r
JOIN trails t        ON ST_DWithin(t.geom::geography, r.location::geography, 200)
JOIN trail_follows f ON f.trail_id = t.id
WHERE r.id = $reportId
  AND f.user_id <> r.user_id
  AND NOT EXISTS (SELECT 1 FROM notifications_sent n
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
