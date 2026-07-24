-- UoSM ARUS I website content database
-- Fresh Supabase bootstrap. Export legacy data before moving from the previous
-- members, advisors, and announcements tables.

create extension if not exists pgcrypto;

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.site_settings (
  id text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'team' check (kind in ('team', 'advisor')),
  name text not null,
  role text not null,
  department text not null default '',
  bio text not null default '',
  image_url text not null default '',
  image_path text not null default '',
  profile_url text not null default '',
  display_order integer not null default 10 check (display_order > 0),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  published_at date not null default current_date,
  link_url text not null default '',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier text not null default 'Project Supporter',
  description text not null default '',
  logo_url text not null default '',
  logo_path text not null default '',
  website_url text not null default '',
  display_order integer not null default 10 check (display_order > 0),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_site_settings_updated_at on public.site_settings;
create trigger set_site_settings_updated_at before update on public.site_settings for each row execute procedure public.set_updated_at();
drop trigger if exists set_people_updated_at on public.people;
create trigger set_people_updated_at before update on public.people for each row execute procedure public.set_updated_at();
drop trigger if exists set_project_updates_updated_at on public.project_updates;
create trigger set_project_updates_updated_at before update on public.project_updates for each row execute procedure public.set_updated_at();
drop trigger if exists set_partners_updated_at on public.partners;
create trigger set_partners_updated_at before update on public.partners for each row execute procedure public.set_updated_at();

alter table public.admins enable row level security;
alter table public.site_settings enable row level security;
alter table public.people enable row level security;
alter table public.project_updates enable row level security;
alter table public.partners enable row level security;

revoke all on table public.admins from anon, authenticated;
grant select on table public.site_settings, public.people, public.project_updates, public.partners to anon, authenticated;
grant insert, update, delete on table public.site_settings, public.people, public.project_updates, public.partners to authenticated;

drop policy if exists "Public read site settings" on public.site_settings;
drop policy if exists "Admins manage site settings" on public.site_settings;
create policy "Public read site settings" on public.site_settings for select to anon, authenticated using (true);
create policy "Admins manage site settings" on public.site_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Public read active people" on public.people;
drop policy if exists "Authenticated read active people" on public.people;
drop policy if exists "Admins manage people" on public.people;
create policy "Public read active people" on public.people for select to anon using (active);
create policy "Authenticated read active people" on public.people for select to authenticated using (active);
create policy "Admins manage people" on public.people for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Public read active project updates" on public.project_updates;
drop policy if exists "Authenticated read active project updates" on public.project_updates;
drop policy if exists "Admins manage project updates" on public.project_updates;
create policy "Public read active project updates" on public.project_updates for select to anon using (active);
create policy "Authenticated read active project updates" on public.project_updates for select to authenticated using (active);
create policy "Admins manage project updates" on public.project_updates for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Public read active partners" on public.partners;
drop policy if exists "Authenticated read active partners" on public.partners;
drop policy if exists "Admins manage partners" on public.partners;
create policy "Public read active partners" on public.partners for select to anon using (active);
create policy "Authenticated read active partners" on public.partners for select to authenticated using (active);
create policy "Admins manage partners" on public.partners for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can view ARUS media" on storage.objects;
drop policy if exists "Admins upload ARUS media" on storage.objects;
drop policy if exists "Admins update ARUS media" on storage.objects;
drop policy if exists "Admins delete ARUS media" on storage.objects;
create policy "Public can view ARUS media" on storage.objects for select to public using (bucket_id = 'media');
create policy "Admins upload ARUS media" on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.is_admin());
create policy "Admins update ARUS media" on storage.objects for update to authenticated using (bucket_id = 'media' and public.is_admin()) with check (bucket_id = 'media' and public.is_admin());
create policy "Admins delete ARUS media" on storage.objects for delete to authenticated using (bucket_id = 'media' and public.is_admin());

insert into public.site_settings (id, content)
values (
  'main',
  $content$
  {
    "projectName":"UoSM ARUS I",
    "clubName":"Marine Engineering Society",
    "navProposalLabel":"View proposal",
    "university":"University of Southampton Malaysia",
    "proposalUrl":"assets/documents/arus-1-sponsorship-proposal-v2.3.pdf",
    "contactEmail":"",
    "instagram":"",
    "linkedin":"",
    "footerText":"Student engineering project · University of Southampton Malaysia"
  }
  $content$::jsonb
)
on conflict (id) do nothing;

-- Page copy now lives in index.html. Remove the obsolete editable-section payload
-- from existing installations and clear the old placeholder contact address.
update public.site_settings
set content = (content - 'sections') || case
  when content ->> 'contactEmail' = 'replace-with-team-email@example.com' then '{"contactEmail":""}'::jsonb
  else '{}'::jsonb
end
where id = 'main' and (content ? 'sections' or content ->> 'contactEmail' = 'replace-with-team-email@example.com');

-- Align existing seeded records with sponsorship proposal v2.3.
delete from public.people
where name in ('Balqis Husni', 'Professor Vun Jack', 'Professor Ana Mesbahi');

update public.people as person
set kind = seed.kind,
    role = seed.role,
    department = seed.department,
    bio = seed.bio,
    display_order = seed.display_order,
    active = seed.active
from (
  values
    ('team', 'Omar Ahmed', 'Team Leader & Treasurer', 'Leadership', '', 1, true),
    ('team', 'Ahmed Atheek', 'Technical Director', 'Leadership', '', 2, true),
    ('team', 'Bujee Shinebayar', 'Secretary & Marketing', 'Leadership', '', 3, true),
    ('team', 'Gauthaman Senthil', 'Head of Electrical', 'Electrical', '', 4, true),
    ('team', 'Bernard Wong', 'Electrical Engineer', 'Electrical', '', 5, true),
    ('team', 'Umair Hulwan', 'Electrical Engineer', 'Electrical', '', 6, true),
    ('team', 'Ng Jen Shen', 'Head of Mechanical', 'Mechanical', '', 7, true),
    ('team', 'Christopher Hall', 'Mechanical Engineer', 'Mechanical', '', 8, true),
    ('team', 'Kuhaneshwara Nadaraja', 'Mechanical Engineer', 'Mechanical', '', 9, true),
    ('advisor', 'Professor Ehsan Mesbahi', 'Academic Advisor', '', '', 1, true),
    ('advisor', 'Professor Suan Hui Pu', 'Academic Advisor', '', '', 2, true),
    ('advisor', 'Dr. Vun Jack', 'Academic Advisor', '', '', 3, true),
    ('advisor', 'Dr. Ana Mesbahi', 'Academic Advisor', '', '', 4, true)
) as seed(kind, name, role, department, bio, display_order, active)
where person.name = seed.name;

insert into public.people (kind, name, role, department, bio, display_order, active)
select * from (
  values
    ('team', 'Omar Ahmed', 'Team Leader & Treasurer', 'Leadership', '', 1, true),
    ('team', 'Ahmed Atheek', 'Technical Director', 'Leadership', '', 2, true),
    ('team', 'Bujee Shinebayar', 'Secretary & Marketing', 'Leadership', '', 3, true),
    ('team', 'Gauthaman Senthil', 'Head of Electrical', 'Electrical', '', 4, true),
    ('team', 'Bernard Wong', 'Electrical Engineer', 'Electrical', '', 5, true),
    ('team', 'Umair Hulwan', 'Electrical Engineer', 'Electrical', '', 6, true),
    ('team', 'Ng Jen Shen', 'Head of Mechanical', 'Mechanical', '', 7, true),
    ('team', 'Christopher Hall', 'Mechanical Engineer', 'Mechanical', '', 8, true),
    ('team', 'Kuhaneshwara Nadaraja', 'Mechanical Engineer', 'Mechanical', '', 9, true),
    ('advisor', 'Professor Ehsan Mesbahi', 'Academic Advisor', '', '', 1, true),
    ('advisor', 'Professor Suan Hui Pu', 'Academic Advisor', '', '', 2, true),
    ('advisor', 'Dr. Vun Jack', 'Academic Advisor', '', '', 3, true),
    ('advisor', 'Dr. Ana Mesbahi', 'Academic Advisor', '', '', 4, true)
) as seed(kind, name, role, department, bio, display_order, active)
where not exists (select 1 from public.people where people.name = seed.name);

update public.project_updates
set title = 'Campaign target: RM150,000',
    summary = 'The campaign combines financial sponsorship, technical equipment, manufacturing access, testing support and competition logistics.'
where title = 'Project campaign target set at RM150,000';

update public.project_updates
set title = 'Darwin qualifier scheduled for September 2027',
    summary = 'ARUS I is preparing for the Darwin Asia-Pacific Qualifier. Monaco follows only if qualification is secured.'
where title = 'Competition pathway confirmed';

update public.project_updates
set title = 'Marine Engineering Society registration submitted',
    summary = 'The society is being established as a student platform for projects, workshops, technical talks, industry links and competitions.'
where title = 'Marine Engineering Society submitted to the Student Office';

insert into public.project_updates (title, summary, published_at, active)
select * from (
  values
    ('Campaign target: RM150,000', 'The campaign combines financial sponsorship, technical equipment, manufacturing access, testing support and competition logistics.', date '2026-07-21', true),
    ('Darwin qualifier scheduled for September 2027', 'ARUS I is preparing for the Darwin Asia-Pacific Qualifier. Monaco follows only if qualification is secured.', date '2026-07-17', true),
    ('Marine Engineering Society registration submitted', 'The society is being established as a student platform for projects, workshops, technical talks, industry links and competitions.', date '2026-07-17', true)
) as seed(title, summary, published_at, active)
where not exists (select 1 from public.project_updates where project_updates.title = seed.title);

update public.partners
set description = 'Supporting the team’s marine engineering and competition work.'
where name = 'HydroComp' and description = 'Supporting the team as it develops its marine engineering capability and competition pathway.';

insert into public.partners (name, tier, description, display_order, active)
select 'HydroComp', 'Project Supporter', 'Supporting the team’s marine engineering and competition work.', 1, true
where not exists (select 1 from public.partners where partners.name = 'HydroComp');

-- After creating a Supabase Auth user, grant that user access:
-- insert into public.admins (user_id) values ('YOUR-AUTH-USER-UUID');
