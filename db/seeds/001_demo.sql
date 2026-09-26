-- Données de DÉMONSTRATION pour le développement local (jamais en production).
-- Ré-exécutable : les signalements de démo sont recréés à chaque fois,
-- avec des dates relatives à maintenant pour qu'ils soient « actifs ».

INSERT INTO radar.profiles (id, display_name) VALUES
    ('00000000-0000-4000-8000-000000000001', 'demo_rando'),
    ('00000000-0000-4000-8000-000000000002', 'demo_vtt')
ON CONFLICT (id) DO NOTHING;

DELETE FROM radar.reports
WHERE user_id IN ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

INSERT INTO radar.reports (user_id, condition_code, activity, location, location_source, created_at, expires_at)
VALUES
    -- Semnoz (au-dessus d'Annecy)
    ('00000000-0000-4000-8000-000000000001', 'mud',          'hiking', ST_SetSRID(ST_MakePoint(6.0935, 45.8020), 4326), 'gps',     now() - interval '3 hours',  now() + interval '45 hours'),
    -- Col de la Colombière
    ('00000000-0000-4000-8000-000000000001', 'snow',         'hiking', ST_SetSRID(ST_MakePoint(6.4686, 46.0086), 4326), 'map_tap', now() - interval '1 hour',   now() + interval '47 hours'),
    -- Parking du Plateau des Glières
    ('00000000-0000-4000-8000-000000000002', 'parking_busy', 'mtb',    ST_SetSRID(ST_MakePoint(6.3346, 45.9689), 4326), 'gps',     now() - interval '30 minutes', now() + interval '23 hours'),
    -- Signalement EXPIRÉ : ne doit pas apparaître dans radar.active_reports
    ('00000000-0000-4000-8000-000000000002', 'closed',       'mtb',    ST_SetSRID(ST_MakePoint(6.2260, 45.9470), 4326), 'map_tap', now() - interval '3 days',   now() - interval '1 day');
