-- Synchronizace: nová oblast dat účtu „devices“ – Moje počítače (Nastavení).
-- Každý počítač přihlášený k účtu do ní zapisuje svůj stručný přehled: název
-- počítače, kdy HubGet naposledy běžel, verzi Windows a HubGetu a nainstalované
-- aplikace, které HubGet spravuje (zdroj, id balíčku, název, verze, nabízená verze);
-- src/store/devices.ts. Data dál vidí a mění jen jejich vlastník (RLS beze změny).
--
-- Přehled jednoho počítače s ~300 aplikacemi má kolem 25 kB, oblast s několika
-- počítači se do 256 kB nemusí vejít – pro ni platí 1 MB. Aplikace stahuje data
-- oblasti jen tehdy, když se od poslední synchronizace změnila (podle revize).
--
-- Spuštění: Supabase → SQL Editor → vložit celý soubor → Run (jednou; opakované
-- spuštění nevadí – kontroly se nahradí stejnými).

-- Kontroly sloupců (výčet oblastí, velikost dat) se nahradí novými. Hledají se
-- podle tabulky, ne podle názvu – název přidělil Postgres.
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
    check (kind in ('settings', 'favorites', 'bundle', 'notifications', 'looks', 'devices')),
  add constraint user_data_data_check
    check (
      jsonb_typeof(data) = 'object'
      and pg_column_size(data) <= case kind when 'looks' then 2097152 when 'devices' then 1048576 else 262144 end
    );

-- Oprávnění beze změny (projekt nemá výchozí granty – pro jistotu znovu)
grant select, insert, update, delete on public.user_data to authenticated;
