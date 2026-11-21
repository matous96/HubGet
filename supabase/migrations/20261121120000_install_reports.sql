-- Žebříček instalací v HubGetu: dobrovolné anonymní hlášení instalace aplikace
-- (Nastavení → Aktualizace balíčků → Přispívat do žebříčku instalací, výchozí vypnuto;
-- Nejstahovanější → Nejinstalovanější v HubGetu za 30, 90 nebo 365 dní).
--
-- Co se ukládá: id aplikace z katalogu HubGetu (videolan-vlc), den instalace a náhodné id
-- instalace HubGetu (stejné jako u spolehlivosti verzí – ne účet, ne počítač). Jedna instalace
-- HubGetu = jeden hlas na aplikaci; další instalace téže aplikace jen posune den. Žádné jméno,
-- IP adresa, verze ani seznam ostatních aplikací.
--
-- Pravidla:
--  - zapisuje se jen funkcí report_install() (anonymně i přihlášeně), tabulka sama není
--    přístupná – nikdo nevidí jednotlivá hlášení,
--  - jedna instalace HubGetu smí poslat nejvýš 200 hlášení za den (ochrana před zahlcením),
--  - žebříček vrací install_ranking() jen za 30, 90 nebo 365 dní a jen aplikace s aspoň
--    3 hlasy (z menšího počtu by šlo poznat jednotlivce), nejvýš 200 aplikací.
--
-- Spuštění: Supabase → SQL Editor → vložit celý soubor → Run (jednou).

create table public.install_reports (
  -- Id aplikace v katalogu HubGetu (malá písmena, číslice, pomlčky, tečky)
  app_id     text        not null check (app_id ~ '^[a-z0-9][a-z0-9._+\-]{0,199}$'),
  -- Náhodné id instalace HubGetu (crypto.randomUUID, sdílené se spolehlivostí verzí)
  reporter   uuid        not null,
  day        date        not null default current_date,
  updated_at timestamptz not null default now(),
  primary key (app_id, reporter)
);

comment on table public.install_reports is 'Anonymní instalace aplikací (žebříček v HubGetu): 1 instalace HubGetu = 1 hlas na aplikaci.';

-- Žebříček za období a denní limit hlášení jedné instalace
create index install_reports_day_idx on public.install_reports (day);
create index install_reports_reporter_idx on public.install_reports (reporter, updated_at);

alter table public.install_reports enable row level security;
-- Žádná pravidla pro anon / authenticated = tabulka není přímo přístupná (jen přes funkce níže)
revoke all on public.install_reports from anon, authenticated;

-- Hlášení instalace. security definer = zapíše do tabulky, ke které volající přístup nemá.
create function public.report_install(p_app_id text, p_reporter uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.install_reports r
    where r.reporter = p_reporter and r.updated_at > now() - interval '1 day'
  ) >= 200 then
    raise exception 'too many reports' using errcode = 'P0001';
  end if;
  insert into public.install_reports (app_id, reporter)
  values (p_app_id, p_reporter)
  on conflict (app_id, reporter)
  do update set day = current_date, updated_at = now();
end;
$$;

revoke execute on function public.report_install(text, uuid) from public;
grant execute on function public.report_install(text, uuid) to anon, authenticated;

-- Žebříček: počet instalací aplikací za posledních 30, 90 nebo 365 dní (jiné období = nic).
create function public.install_ranking(p_days integer)
returns table (app_id text, installs integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.app_id, count(*)::integer
  from public.install_reports r
  where p_days in (30, 90, 365) and r.day > current_date - p_days
  group by r.app_id
  having count(*) >= 3
  order by count(*) desc, r.app_id
  limit 200;
$$;

revoke execute on function public.install_ranking(integer) from public;
grant execute on function public.install_ranking(integer) to anon, authenticated;
