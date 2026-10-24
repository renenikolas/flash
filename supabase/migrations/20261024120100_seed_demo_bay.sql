-- Seed: ein fiktiver Stellplatz in Berlin-Mitte.
-- lock_id bleibt leer: Der Server ordnet dann den Lock aus ECURIOUS_LOCK_ID zu
-- (bzw. den ersten Lock aus GET /api/v1/locks). Fest verknüpfen geht mit:
--   update public.bays set lock_id = '<lock-id>' where id = '00000000-0000-4000-8000-000000000001';
insert into public.bays (id, name, lat, lng)
values ('00000000-0000-4000-8000-000000000001', 'FLASH Demo-Stellplatz Berlin-Mitte (fiktiv)', 52.5219, 13.4132)
on conflict (id) do nothing;
