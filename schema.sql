-- =========================================================
-- Bibliothèque personnelle — schéma Supabase (étape 1)
-- =========================================================

-- ---------- Table principale : un contenu = une fiche ----------
create table public.contenus (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,

  type            text not null check (type in ('serie', 'film', 'article', 'video')),
  titre           text not null,
  createur        text,             -- auteur, réalisateur ou chaîne selon le type
  genre           text,
  annee           smallint check (annee between 1850 and 2100),
  tags            text[] not null default '{}',

  statut          text not null default 'a_voir'
                  check (statut in ('a_voir', 'en_cours', 'termine', 'abandonne')),
  note            numeric(2,1) check (note between 0.5 and 5 and note * 2 = floor(note * 2)), -- étoiles, demi-étoiles permises
  avis            text,
  date_visionnage date,
  nb_visionnages  smallint not null default 1 check (nb_visionnages >= 0),

  lien            text,
  image_url       text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index contenus_user_idx   on public.contenus (user_id);
create index contenus_type_idx   on public.contenus (user_id, type);
create index contenus_statut_idx on public.contenus (user_id, statut);

-- ---------- Épisodes : uniquement pour les séries ----------
create table public.episodes (
  id              uuid primary key default gen_random_uuid(),
  contenu_id      uuid not null references public.contenus(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,

  saison          smallint not null check (saison >= 0),
  episode         smallint not null check (episode >= 1),
  titre           text,
  note            numeric(2,1) check (note between 0.5 and 5 and note * 2 = floor(note * 2)),
  avis            text,
  date_visionnage date,

  created_at      timestamptz not null default now(),
  unique (contenu_id, saison, episode)
);

create index episodes_contenu_idx on public.episodes (contenu_id);
create index episodes_user_idx    on public.episodes (user_id);

-- Empêche d'ajouter des épisodes à autre chose qu'une série
create or replace function public.verifier_episode_serie()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.contenus where id = new.contenu_id and type = 'serie') then
    raise exception 'Les épisodes ne peuvent être ajoutés qu''à une série';
  end if;
  return new;
end $$;

create trigger episodes_serie_only
  before insert or update on public.episodes
  for each row execute function public.verifier_episode_serie();

-- Mise à jour automatique de updated_at
create or replace function public.maj_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger contenus_updated_at
  before update on public.contenus
  for each row execute function public.maj_updated_at();

-- ---------- Sécurité : chacun ne voit que sa bibliothèque ----------
alter table public.contenus enable row level security;
alter table public.episodes enable row level security;

create policy "contenus_proprietaire" on public.contenus
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "episodes_proprietaire" on public.episodes
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
