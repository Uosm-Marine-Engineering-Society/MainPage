-- UoSM ARUS I website content database
-- Run in the Supabase SQL editor.

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

create table if not exists public.site_settings (
  id text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  id text primary key,
  name text not null,
  role text not null,
  department text default '',
  bio text default '',
  image_url text default '',
  linkedin_url text default '',
  display_order integer not null default 10,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.advisors (
  id text primary key,
  name text not null,
  role text not null default 'Academic Advisor',
  display_order integer not null default 10,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.partners (
  id text primary key,
  name text not null,
  tier text not null default 'Project Supporter',
  description text default '',
  logo_url text default '',
  website_url text default '',
  display_order integer not null default 10,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id text primary key,
  title text not null,
  summary text not null,
  published_at date not null default current_date,
  link_url text default '',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.site_settings enable row level security;
alter table public.members enable row level security;
alter table public.advisors enable row level security;
alter table public.partners enable row level security;
alter table public.announcements enable row level security;

-- Public website read access
create policy "Public can read site settings" on public.site_settings for select to anon, authenticated using (true);
create policy "Public can read members" on public.members for select to anon, authenticated using (true);
create policy "Public can read advisors" on public.advisors for select to anon, authenticated using (true);
create policy "Public can read partners" on public.partners for select to anon, authenticated using (true);
create policy "Public can read announcements" on public.announcements for select to anon, authenticated using (true);

-- Approved administrators can create, edit, and delete content
create policy "Admins manage site settings" on public.site_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage members" on public.members for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage advisors" on public.advisors for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage partners" on public.partners for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage announcements" on public.announcements for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Public media bucket for team photos and partner logos
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = excluded.public;

create policy "Public can view ARUS media" on storage.objects for select to public using (bucket_id = 'media');
create policy "Admins upload ARUS media" on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.is_admin());
create policy "Admins update ARUS media" on storage.objects for update to authenticated using (bucket_id = 'media' and public.is_admin()) with check (bucket_id = 'media' and public.is_admin());
create policy "Admins delete ARUS media" on storage.objects for delete to authenticated using (bucket_id = 'media' and public.is_admin());

-- Seed project details
insert into public.site_settings (id, content)
values (
  'main',
  '{
    "projectName":"UoSM ARUS I",
    "clubName":"Marine Engineering Society",
    "university":"University of Southampton Malaysia",
    "tagline":"Engineering Malaysia''s next electric race boat.",
    "summary":"A student-led marine engineering programme designing, building, testing, and racing an energy-efficient competition boat.",
    "contactEmail":"replace-with-team-email@example.com",
    "instagram":"",
    "linkedin":"",
    "campaignTarget":"RM150,000",
    "engineeringBudget":"RM81,826",
    "qualifier":"Darwin, September 2027",
    "final":"Monaco, early 2028"
  }'::jsonb
)
on conflict (id) do nothing;

-- After creating your first Supabase Auth user, add the user UUID here:
-- insert into public.admins (user_id) values ('YOUR-AUTH-USER-UUID');

-- Starter team profiles
insert into public.members (id, name, role, department, bio, display_order, active) values
('omar-ahmed', 'Omar Ahmed', 'Team Leader & Treasurer', 'Project Leadership', 'Coordinates the project programme, team operations, budget, sponsorship, and competition readiness.', 1, true),
('ahmed-atheek', 'Ahmed Atheek', 'Technical Director', 'Technical Leadership', 'Leads technical integration across the boat, reviews design decisions, and coordinates engineering delivery.', 2, true),
('bujee-shinebayar', 'Bujee Shinebayar', 'Secretary & Marketing', 'Operations & Communications', 'Supports governance, documentation, public communication, events, and project marketing.', 3, true),
('gauthaman-senthil', 'Gauthaman Senthil', 'Head of Electrical', 'Electrical Engineering', 'Leads the battery, low-voltage, control, monitoring, safety, and electrical integration workstreams.', 4, true),
('ng-jen-shen', 'Ng Jen Shen', 'Head of Mechanical', 'Mechanical Engineering', 'Leads hull integration, propulsion mechanics, structural design, manufacturing, and testing preparation.', 5, true)
on conflict (id) do nothing;

insert into public.advisors (id, name, role, display_order, active) values
('ehsan-mesbahi', 'Professor Ehsan Mesbahi', 'Academic Advisor', 1, true),
('suan-hui-pu', 'Professor Suan Hui Pu', 'Academic Advisor', 2, true),
('vun-jack', 'Professor Vun Jack', 'Academic Advisor', 3, true),
('ana-mesbahi', 'Professor Ana Mesbahi', 'Academic Advisor', 4, true)
on conflict (id) do nothing;

insert into public.partners (id, name, tier, description, display_order, active) values
('hydrocomp', 'HydroComp', 'Project Supporter', 'Supporting the team as it develops its marine engineering capability and competition pathway.', 1, true)
on conflict (id) do nothing;

insert into public.announcements (id, title, summary, published_at, active) values
('campaign-target', 'Project campaign target set at RM150,000', 'The campaign brings together financial sponsorship, technical equipment, manufacturing access, testing support, and competition logistics.', '2026-07-21', true),
('competition-pathway', 'Competition pathway confirmed', 'ARUS I is preparing for the Darwin Asia-Pacific Qualifier in September 2027, followed by the Monaco World Final in early 2028 if qualification is secured.', '2026-07-17', true),
('mes-student-office', 'Marine Engineering Society submitted to the Student Office', 'The society is being established as the student platform behind marine engineering projects, workshops, technical talks, industry links, and competitions.', '2026-07-17', true)
on conflict (id) do nothing;
