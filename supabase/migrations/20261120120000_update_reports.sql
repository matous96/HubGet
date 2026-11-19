-- Spolehlivost verzí od komunity: dobrovolné anonymní hlášení výsledku aktualizace
-- (Nastavení → Aktualizace balíčků → Spolehlivost verzí od komunity, výchozí vypnuto).
--
-- Co se ukládá: zdroj a id balíčku, verze, výsledek (povedla se / selhala / uživatel ji
-- vrátil na předchozí verzi) a náhodné id instalace HubGetu (ne účet, ne počítač) – jedna
-- instalace = jeden hlas na verzi, novější výsledek starší přepíše. Žádné jméno, IP adresa
-- ani seznam ostatních aplikací.
--
-- Pravidla:
--  - zapisuje se jen funkcí report_update_outcome() (anonymně i přihlášeně), tabulka
--    sama není přístupná – nikdo nevidí jednotlivá hlášení,
--  - jedna instalace smí poslat nejvýš 100 hlášení za den (ochrana před zahlcením),
--  - souhrn vrací update_reliability() jen u verzí s aspoň 5 hlášeními; HubGet
--    automatickou aktualizaci odloží až od 10 hlášení a 25 % problémů – a nikdy
--    bezpečnostní aktualizaci (src/store/reliability.ts). Podvržená hlášení tedy můžou
--    nanejvýš pozdržet automatickou aktualizaci; ručně jde nainstalovat vždy.
--
-- Spuštění: Supabase → SQL Editor → vložit celý soubor → Run (jednou).

create table public.update_reports (
  source     text        not null check (source ~ '^[a-z]{2,20}$'),
  -- Id balíčku správce: VideoLAN.VLC, extras/vlc, @angular/cli…
  package_id text        not null check (package_id ~ '^[A-Za-z0-9@][A-Za-z0-9:._+/@\-]{0,199}$'),
  version    text        not null check (version ~ '^[A-Za-z0-9][A-Za-z0-9._+\-]{0,99}$'),
  outcome    text        not null check (outcome in ('success', 'failed', 'rolledBack')),
  -- Náhodné id instalace HubGetu (crypto.randomUUID při prvním hlášení)
  reporter   uuid        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, package_id, version, reporter)
);

comment on table public.update_reports is 'Anonymní výsledky aktualizací (spolehlivost verzí): 1 instalace HubGetu = 1 hlas na verzi.';

-- Denní limit hlášení jedné instalace
create index update_reports_reporter_idx on public.update_reports (reporter, updated_at);

alter table public.update_reports enable row level security;
-- Žádná pravidla pro anon / authenticated = tabulka není přímo přístupná (jen přes funkce níže)
revoke all on public.update_reports from anon, authenticated;

-- Hlášení výsledku. security definer = zapíše do tabulky, ke které volající přístup nemá.
create function public.report_update_outcome(
  p_source text,
  p_package_id text,
  p_version text,
  p_outcome text,
  p_reporter uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.update_reports r
    where r.reporter = p_reporter and r.updated_at > now() - interval '1 day'
  ) >= 100 then
    raise exception 'too many reports' using errcode = 'P0001';
  end if;
  insert into public.update_reports (source, package_id, version, outcome, reporter)
  values (p_source, p_package_id, p_version, p_outcome, p_reporter)
  on conflict (source, package_id, version, reporter)
  do update set outcome = excluded.outcome, updated_at = now();
end;
$$;

revoke execute on function public.report_update_outcome(text, text, text, text, uuid) from public;
grant execute on function public.report_update_outcome(text, text, text, text, uuid) to anon, authenticated;

-- Souhrn pro dané verze: klíče „zdroj|id balíčku|verze“ (nejvýš 500 najednou).
-- Jen verze s aspoň 5 hlášeními – z menšího počtu nejde nic usoudit a nevydá jednotlivce.
create function public.update_reliability(p_keys text[])
returns table (
  source      text,
  package_id  text,
  version     text,
  reports     integer,
  failed      integer,
  rolled_back integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.source,
    r.package_id,
    r.version,
    count(*)::integer,
    (count(*) filter (where r.outcome = 'failed'))::integer,
    (count(*) filter (where r.outcome = 'rolledBack'))::integer
  from public.update_reports r
  where (r.source || '|' || r.package_id || '|' || r.version) = any (p_keys[1:500])
  group by r.source, r.package_id, r.version
  having count(*) >= 5;
$$;

revoke execute on function public.update_reliability(text[]) from public;
grant execute on function public.update_reliability(text[]) to anon, authenticated;
