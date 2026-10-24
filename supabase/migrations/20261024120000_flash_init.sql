-- FLASH: Stellplätze und Reservierungen.
-- RLS ist an und es gibt keine Tabellen-Policies: Clients kommen nur über die RPCs unten an Daten.

create table public.bays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  goingelectric_id bigint,
  lock_id text
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  bay_id uuid not null references public.bays (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'held' check (status in ('held', 'cancelled', 'completed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  request_id uuid not null unique
);

-- Höchstens ein aktiver Hold pro Stellplatz, auch falls die RPC-Logik einmal versagt.
create unique index reservations_one_held_per_bay on public.reservations (bay_id) where status = 'held';
create index reservations_user_id_idx on public.reservations (user_id);

alter table public.bays enable row level security;
alter table public.reservations enable row level security;
revoke all on table public.bays, public.reservations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- reserve_bay: atomar per Zeilen-Lock, räumt abgelaufene Holds auf, idempotent über request_id.
-- Ablaufzeit kommt aus der DB-Uhr (now()).
create function public.reserve_bay(bay_id uuid, minutes integer, request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  res public.reservations;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if minutes is null or minutes not between 1 and 30 then
    raise exception 'invalid_minutes' using errcode = '22023';
  end if;

  -- Parallele Aufrufe für denselben Stellplatz warten hier aufeinander.
  perform 1 from public.bays b where b.id = reserve_bay.bay_id for update;
  if not found then
    raise exception 'bay_not_found' using errcode = 'P0002';
  end if;

  select * into res from public.reservations r where r.request_id = reserve_bay.request_id;
  if found then
    if res.user_id <> uid then
      raise exception 'request_id_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('id', res.id, 'bay_id', res.bay_id, 'status', res.status,
                              'expires_at', res.expires_at, 'server_now', now());
  end if;

  update public.reservations r set status = 'expired'
  where r.bay_id = reserve_bay.bay_id and r.status = 'held' and r.expires_at <= now();

  if exists (select 1 from public.reservations r where r.bay_id = reserve_bay.bay_id and r.status = 'held') then
    raise exception 'bay_taken' using errcode = 'P0001';
  end if;

  insert into public.reservations (bay_id, user_id, expires_at, request_id)
  values (reserve_bay.bay_id, uid, now() + make_interval(mins => minutes), reserve_bay.request_id)
  returning * into res;

  return jsonb_build_object('id', res.id, 'bay_id', res.bay_id, 'status', res.status,
                            'expires_at', res.expires_at, 'server_now', now());
end;
$$;

-- cancel_reservation: nur der eigene, noch laufende Hold.
create function public.cancel_reservation(id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  res public.reservations;
begin
  update public.reservations r set status = 'cancelled'
  where r.id = cancel_reservation.id
    and r.user_id = auth.uid()
    and r.status = 'held'
    and r.expires_at > now()
  returning * into res;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', res.id, 'bay_id', res.bay_id, 'status', res.status,
                            'expires_at', res.expires_at, 'server_now', now());
end;
$$;

-- list_bays: Stellplätze mit aktuellem Status. Gibt nie fremde User-IDs heraus,
-- nur held_by_me und die eigene reservation_id.
create function public.list_bays()
returns table (
  id uuid, name text, lat double precision, lng double precision,
  goingelectric_id bigint, lock_id text,
  status text, held_by_me boolean, reservation_id uuid,
  expires_at timestamptz, server_now timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, b.lat, b.lng, b.goingelectric_id, b.lock_id,
         case when r.id is null then 'free' else 'held' end,
         coalesce(r.user_id = auth.uid(), false),
         case when r.user_id = auth.uid() then r.id end,
         r.expires_at,
         now()
  from public.bays b
  left join public.reservations r
    on r.bay_id = b.id and r.status = 'held' and r.expires_at > now()
  order by b.name;
$$;

revoke execute on function public.reserve_bay(uuid, integer, uuid), public.cancel_reservation(uuid), public.list_bays()
  from public, anon;
grant execute on function public.reserve_bay(uuid, integer, uuid), public.cancel_reservation(uuid), public.list_bays()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: "Broadcast from Database" auf den privaten Kanal "bays".
-- Payload ohne user_id; Clients laden danach list_bays() neu.
create function public.broadcast_reservation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.reservations := coalesce(new, old);
begin
  begin
    perform realtime.send(
      payload => jsonb_build_object('bay_id', rec.bay_id, 'status', rec.status, 'op', tg_op),
      event => 'reservation_changed',
      topic => 'bays',
      private => true
    );
  exception when others then
    -- Eine Reservierung darf nie an Realtime scheitern.
    raise warning 'flash: realtime.send fehlgeschlagen: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.broadcast_reservation_change() from public, anon, authenticated;

create trigger reservations_broadcast
after insert or update or delete on public.reservations
for each row execute function public.broadcast_reservation_change();

-- Gäste (anonyme User haben die Rolle authenticated) dürfen den Kanal "bays" empfangen.
create policy "flash guests receive bay broadcasts"
on realtime.messages
for select
to authenticated
using ((select realtime.topic()) = 'bays' and realtime.messages.extension = 'broadcast');
