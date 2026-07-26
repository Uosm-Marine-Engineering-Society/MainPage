# Marine Engineering Society website

The public site for the Marine Engineering Society at the University of Southampton Malaysia. Its founding project, UoSM ARUS I, is the highlighted project on the page.

Deployed through GitHub Pages:

https://uosm-marine-engineering-society.github.io/MainPage/

## Editing the public site

Society copy, project facts, engineering scope, roadmap, cost schedules and sponsorship tiers are edited directly in `index.html`. Every figure on the page comes from the sponsorship proposal in `assets/documents/` — keep them in step.

The admin portal manages project updates, people, partners, and global site settings. Open `admin.html` for the local preview and sign in with:

- Username: `admin`
- Password: `admin`

Local preview changes only affect that browser. It is not a security boundary and does not publish changes for other visitors.

### Adding a site setting

Site settings are gated by a `siteKeys` allowlist that is duplicated in **both** `app.js` and `admin.js`, plus a default in `content.js`. A key missing from any of the three is silently dropped. Booleans must be read from `form.elements.<name>.checked` rather than `FormData`, which omits unchecked boxes entirely — see the `animations` toggle for the working pattern.

### Deployment

`.github/workflows/static.yml` copies an explicit file list. Any **new top-level file** must be added to that `cp` line or it will not deploy. Files under `assets/` are copied recursively and need no change.

## Live publishing with Supabase

1. Create a Supabase project.
2. Run `schema.sql` in the Supabase SQL editor.
3. Create an Auth user with a real email address and secure password.
4. Insert that user’s UUID into `public.admins` as shown at the bottom of `schema.sql`.
5. Copy the project URL and publishable key into `supabase-config.js`.

Once configured, `admin.html` uses the approved Supabase account to publish updates, people, partners, and site settings. Never place a service-role key in browser code.

## Site analytics

Analytics use the same Supabase project and are designed for a static GitHub Pages deployment. Run the latest `schema.sql`, keep **Enable anonymous site analytics** selected in Site settings, and open the **Site analytics** admin tab to view the reports.

The public page records:

- one random session ID per browser tab;
- visit and page-view counts;
- referrer and UTM source/medium/campaign;
- coarse device, browser, platform, language, timezone and screen-size context;
- sections viewed, scroll-depth milestones, links and controls clicked;
- proposal opens, successful email-copy actions and visible-page engagement time.

It does not store IP addresses, raw user-agent strings, form contents, cookies, persistent visitor identifiers or precise location. Global Privacy Control and Do Not Track signals disable collection, and local previews are excluded. Analytics rows are insert-only through the validated `log_analytics_events` database function; only approved administrators can read or delete them.

The admin report loads up to 10,000 events for the selected 7-, 30- or 90-day period. For long-running deployments, configure a Supabase Cron retention job or periodically delete old rows according to the society’s privacy policy.
