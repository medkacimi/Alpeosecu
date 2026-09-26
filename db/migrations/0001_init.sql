-- ============================================================
-- Radar Montagne — schéma V1 (PostgreSQL 15+ / PostGIS 3.x)
-- Règle unique : on STOCKE en geometry SRID 4326 (lon/lat WGS84),
-- on MESURE en mètres via un cast ::geography.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- Schéma dédié : il n'est PAS exposé par l'API REST automatique de Supabase
-- (seul "public" l'est par défaut). Seule notre API Express y accède.
CREATE SCHEMA IF NOT EXISTS radar;
-- "extensions" : schéma où Supabase installe PostGIS (ignoré s'il n'existe pas).
SET search_path = radar, public, extensions;

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
