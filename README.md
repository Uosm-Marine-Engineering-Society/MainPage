# UoSM ARUS I website

The public site is deployed through GitHub Pages:

https://uosm-marine-engineering-society.github.io/MainPage/

## Editing the public site

Public page copy, project facts, engineering scope, roadmap and sponsorship tiers are edited directly in `index.html`.

The admin portal manages project updates, people, partners, and global site settings. Open `admin.html` for the local preview and sign in with:

- Username: `admin`
- Password: `admin`

Local preview changes only affect that browser. It is not a security boundary and does not publish changes for other visitors.

## Live publishing with Supabase

1. Create a Supabase project.
2. Run `schema.sql` in the Supabase SQL editor.
3. Create an Auth user with a real email address and secure password.
4. Insert that user’s UUID into `public.admins` as shown at the bottom of `schema.sql`.
5. Copy the project URL and publishable key into `supabase-config.js`.

Once configured, `admin.html` uses the approved Supabase account to publish updates, people, partners, and site settings. Never place a service-role key in browser code.
