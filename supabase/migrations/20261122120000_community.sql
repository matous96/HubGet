-- Komunita v HubGetu:
--  1. Navrhnout aplikaci – když hledání nic nenajde, přihlášený uživatel aplikaci navrhne,
--     ostatní hlasují (Navržené aplikace); stav (přidáno / zamítnuto) mění správce HubGetu.
--  2. Odpovědi vývojářů na recenze – vývojář aplikace (schválený správcem HubGetu) odpoví
--     pod recenzí, jako v App Storu.
--  3. Počty instalací jedné aplikace pro vývojáře (Publikovat → Statistiky vaší aplikace)
--     z anonymních hlášení instalací (20261121120000_install_reports.sql – spustit dřív).
--
-- Zápis jde jen přes funkce níže (security definer); tabulky samy přístupné nejsou.
--
-- Schválení vývojáře (správce HubGetu, SQL Editor) – po kontrole, že GitHub účet patří
-- k repozitáři aplikace:
--   update public.app_maintainers set approved = true where app_id = '<id aplikace>' and github_login = '<login>';
-- Stav návrhu aplikace:
--   update public.app_requests set status = 'added' where id = '<id návrhu>';   -- nebo 'rejected'
--
-- Spuštění: Supabase → SQL Editor → vložit celý soubor → Run (jednou).

-- ── 1. Návrhy aplikací ─────────────────────────────────────────────────

create table public.app_requests (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (char_length(btrim(name)) between 2 and 80),
  url        text        check (url is null or url ~ '^https://[^[:space:]]{3,300}$'),
  note       text        check (note is null or char_length(note) <= 500),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  status     text        not null default 'open' check (status in ('open', 'added', 'rejected')),
  created_at timestamptz not null default now()
);

create table public.app_request_votes (
  request_id uuid not null references public.app_requests (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create index app_requests_user_idx on public.app_requests (user_id, created_at);
alter table public.app_requests enable row level security;
alter table public.app_request_votes enable row level security;
revoke all on public.app_requests from anon, authenticated;
revoke all on public.app_request_votes from anon, authenticated;

-- Navrhne aplikaci (přihlášený uživatel). Stejný název mezi otevřenými návrhy = hlas pro
-- existující návrh. Nejvýš 5 návrhů za den. Vrátí id návrhu.
create function public.request_app(p_name text, p_url text default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'login required' using errcode = '28000';
  end if;
  select r.id into v_id from public.app_requests r
   where r.status = 'open' and lower(btrim(r.name)) = lower(btrim(p_name))
   limit 1;
  if v_id is null then
    if (select count(*) from public.app_requests r where r.user_id = v_user and r.created_at > now() - interval '1 day') >= 5 then
      raise exception 'too many requests' using errcode = 'P0001';
    end if;
    insert into public.app_requests (name, url, note, user_id)
    values (btrim(p_name), nullif(btrim(coalesce(p_url, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), v_user)
    returning id into v_id;
  end if;
  insert into public.app_request_votes (request_id, user_id) values (v_id, v_user) on conflict do nothing;
  return v_id;
end;
$$;

-- Hlas pro návrh / jeho zrušení. Vrátí, jestli uživatel teď hlasuje.
create function public.toggle_app_request_vote(p_request_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'login required' using errcode = '28000';
  end if;
  if exists (select 1 from public.app_request_votes v where v.request_id = p_request_id and v.user_id = v_user) then
    delete from public.app_request_votes v where v.request_id = p_request_id and v.user_id = v_user;
    return false;
  end if;
  insert into public.app_request_votes (request_id, user_id) values (p_request_id, v_user);
  return true;
end;
$$;

-- Navržené aplikace podle počtu hlasů (bez autorů). `voted` = hlasoval přihlášený uživatel.
create function public.app_requests_top(p_limit integer default 50)
returns table (id uuid, name text, url text, note text, status text, votes integer, voted boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.url, r.note, r.status,
         (select count(*) from public.app_request_votes v where v.request_id = r.id)::integer as votes,
         exists (select 1 from public.app_request_votes v where v.request_id = r.id and v.user_id = auth.uid()),
         r.created_at
  from public.app_requests r
  where r.status <> 'rejected'
  order by (r.status = 'open') desc, votes desc, r.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke execute on function public.request_app(text, text, text) from public;
revoke execute on function public.toggle_app_request_vote(uuid) from public;
revoke execute on function public.app_requests_top(integer) from public;
grant execute on function public.request_app(text, text, text) to authenticated;
grant execute on function public.toggle_app_request_vote(uuid) to authenticated;
grant execute on function public.app_requests_top(integer) to anon, authenticated;

-- ── 2. Odpovědi vývojářů na recenze ────────────────────────────────────

create table public.app_maintainers (
  app_id       text        not null check (app_id ~ '^[a-z0-9][a-z0-9._+\-]{0,199}$'),
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  -- Přihlášení přes GitHub (z auth.identities, ne z údajů, které si uživatel mění sám)
  github_login text        not null,
  -- Repozitář, který uvedl (owner/name) – podle něj správce HubGetu žádost ověří
  repo         text        check (repo is null or repo ~ '^[A-Za-z0-9_.\-]{1,100}/[A-Za-z0-9_.\-]{1,100}$'),
  approved     boolean     not null default false,
  created_at   timestamptz not null default now(),
  primary key (app_id, user_id)
);

create table public.review_replies (
  review_id  uuid        primary key references public.ratings (id) on delete cascade,
  app_id     text        not null,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  body       text        not null check (char_length(btrim(body)) between 2 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_maintainers enable row level security;
alter table public.review_replies enable row level security;
revoke all on public.app_maintainers from anon, authenticated;
revoke all on public.review_replies from anon, authenticated;

-- GitHub login přihlášeného uživatele (null = nepřihlásil se přes GitHub)
create function public.my_github_login()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(i.identity_data ->> 'user_name', '')
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'github'
  order by i.last_sign_in_at desc nulls last
  limit 1;
$$;

-- Žádost „Jsem vývojář této aplikace“ (jen s účtem GitHub). Čeká na schválení správcem HubGetu.
create function public.request_maintainer(p_app_id text, p_repo text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login text := public.my_github_login();
begin
  if auth.uid() is null or v_login is null then
    raise exception 'github login required' using errcode = '28000';
  end if;
  insert into public.app_maintainers (app_id, user_id, github_login, repo)
  values (p_app_id, auth.uid(), v_login, nullif(btrim(coalesce(p_repo, '')), ''))
  on conflict (app_id, user_id) do update set repo = excluded.repo, github_login = excluded.github_login;
  return (select case when m.approved then 'approved' else 'pending' end
          from public.app_maintainers m where m.app_id = p_app_id and m.user_id = auth.uid());
end;
$$;

-- Stav přihlášeného uživatele u aplikace: 'none' / 'pending' / 'approved'
create function public.my_maintainer_status(p_app_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when m.approved then 'approved' else 'pending' end
       from public.app_maintainers m where m.app_id = p_app_id and m.user_id = auth.uid()),
    'none');
$$;

-- Odpověď na recenzi (jen schválený vývojář aplikace; prázdný text odpověď smaže)
create function public.reply_to_review(p_review_id uuid, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_app text;
begin
  select r.app_id into v_app from public.ratings r where r.id = p_review_id;
  if v_app is null then
    raise exception 'review not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.app_maintainers m where m.app_id = v_app and m.user_id = auth.uid() and m.approved) then
    raise exception 'not a maintainer' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then
    delete from public.review_replies x where x.review_id = p_review_id;
    return;
  end if;
  insert into public.review_replies (review_id, app_id, user_id, body)
  values (p_review_id, v_app, auth.uid(), btrim(p_body))
  on conflict (review_id) do update set body = excluded.body, user_id = excluded.user_id, updated_at = now();
end;
$$;

-- Odpovědi vývojářů u recenzí aplikace (veřejné; autor = GitHub login vývojáře)
create function public.review_replies_of(p_app_id text)
returns table (review_id uuid, body text, author text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select x.review_id, x.body,
         coalesce((select m.github_login from public.app_maintainers m where m.app_id = x.app_id and m.user_id = x.user_id), ''),
         x.updated_at
  from public.review_replies x
  where x.app_id = p_app_id;
$$;

revoke execute on function public.my_github_login() from public;
revoke execute on function public.request_maintainer(text, text) from public;
revoke execute on function public.my_maintainer_status(text) from public;
revoke execute on function public.reply_to_review(uuid, text) from public;
revoke execute on function public.review_replies_of(text) from public;
grant execute on function public.request_maintainer(text, text) to authenticated;
grant execute on function public.my_maintainer_status(text) to authenticated;
grant execute on function public.reply_to_review(uuid, text) to authenticated;
grant execute on function public.review_replies_of(text) to anon, authenticated;

-- ── 3. Instalace jedné aplikace (pro vývojáře) ─────────────────────────

-- Počet instalací za 30, 90 a 365 dní; méně než 3 = null (nevydá jednotlivce).
create function public.app_install_counts(p_app_id text)
returns table (days integer, installs integer)
language sql
stable
security definer
set search_path = ''
as $$
  select d.days,
         nullif((select count(*) from public.install_reports r
                 where r.app_id = p_app_id and r.day > current_date - d.days)::integer, 0) as installs
  from (values (30), (90), (365)) as d (days);
$$;

-- Méně než 3 instalace se nevydají (nahradí se null) – obal nad výpočtem
create function public.app_install_stats(p_app_id text)
returns table (days integer, installs integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.days, case when c.installs >= 3 then c.installs end
  from public.app_install_counts(p_app_id) c;
$$;

revoke execute on function public.app_install_counts(text) from public;
revoke execute on function public.app_install_stats(text) from public;
grant execute on function public.app_install_stats(text) to anon, authenticated;
