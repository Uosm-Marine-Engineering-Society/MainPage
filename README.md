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

Analytics use the same Supabase project and are designed for a static GitHub Pages deployment. Run the latest `schema.sql`, keep **Enable visitor analytics** selected in Site settings, and open the **Site analytics** admin tab.

### Tracking whether a sponsor opened the email

Every sponsor gets their own link. In **Site analytics → Sponsor watch**, add the organisation and a tracking code; the portal builds a link such as `https://…/MainPage/?s=petronas` and copies it to the clipboard. Put that link in the outreach email instead of the plain website address. Each sponsor's row then reads:

| Result | What it means |
|---|---|
| **Opened** | Someone followed their link. First open, last seen, reading time and proposal opens are listed beside it. |
| **Delivered, not read** | Only their mailbox security scanner followed the link. The message reached the company's mail system, but no person has clicked it. |
| **Quiet for N days** | Emailed recently, nothing yet. Normal for the first few days. |
| **Nothing after N days** | No visit and no scanner hit after a week. The likeliest explanation is a spam filter or a wrong address — try another contact or channel. |

The code is remembered in the visitor's browser for 90 days, so a sponsor who returns later without the link is still attributed. Anyone who forwards their link internally shows as extra visits on that sponsor.

### What is recorded

Per visit: a first-party visitor ID and per-tab session ID; IP address, and the country, region, city, coordinates, network operator and organisation resolved from it; device, browser and version, operating system, platform, screen, viewport, pixel ratio, colour depth, touch points, CPU cores, memory, connection type, colour-scheme and reduced-motion preference, language list, timezone and page-load time; the sponsor code, referrer and UTM parameters; and the sections read, scroll depth, links and controls clicked, proposal opens, email copies and reading time.

Location comes from a public IP lookup made by the visitor's browser (`ipwho.is`, falling back to `get.geojs.io`). Roughly 10–20% of visitors block it; those visits still record everything else, and the IP address and Cloudflare edge country are captured server-side regardless. The browser never reports its own IP — the `log_visit` database function reads it from the request headers, so it cannot be spoofed by the page.

Visits from mailbox security scanners and crawlers are flagged and hidden from the counts by default; clear **Hide automated hits** to see them.

### Privacy

This stores personal data, including IP addresses and approximate location. Visitors sending a Global Privacy Control signal are not recorded, and local previews are excluded. Rows are insert-only through the validated `log_visit` function; only approved administrators can read or delete them.

**The site needs a privacy notice describing this collection before the tracking links go out**, particularly for sponsors in the UK or EU, where IP addresses are personal data under GDPR. Configure a Supabase Cron retention job — or delete old rows periodically — so visit records do not accumulate indefinitely.

The admin report loads up to 5,000 visits and 20,000 events for the selected period.
