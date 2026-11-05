-- Synchronizace: nová oblast dat účtu „looks“ – vlastní vzhled aplikací
-- (barva banneru a vlastní ikona, které si uživatel nastavil v detailu aplikace;
-- src/store/appLooks.ts). Data dál vidí a mění jen jejich vlastník (RLS beze změny).
--
-- Oblast „looks“ smí být větší než ostatní: ikony jsou malé obrázky WebP (128 px,
-- obvykle 5–15 kB), desítky aplikací se do 256 kB nevejdou – pro ni platí 2 MB.
-- Aplikace stahuje data oblasti jen tehdy, když se od poslední synchronizace změnila
-- (podle revize), takže větší oblast nezvyšuje provoz při každé synchronizaci.
--
-- Spuštění: Supabase → SQL Editor → vložit celý soubor → Run (jednou; opakované
-- spuštění nevadí – kontroly se nahradí stejnými).

-- Kontroly sloupců z migrace 20261027120000_user_data.sql (výčet oblastí, velikost dat)
-- se nahradí novými. Hledají se podle tabulky, ne podle názvu – název přidělil Postgres.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.user_data'::regclass and contype = 'c'
  loop
    execute format('alter table public.user_data drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.user_data
  add constraint user_data_kind_check
    check (kind in ('settings', 'favorites', 'bundle', 'notifications', 'looks')),
  add constraint user_data_data_check
    check (
      jsonb_typeof(data) = 'object'
      and pg_column_size(data) <= case when kind = 'looks' then 2097152 else 262144 end
    );

-- Oprávnění beze změny (projekt nemá výchozí granty – pro jistotu znovu)
grant select, insert, update, delete on public.user_data to authenticated;
