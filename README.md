# UoSM ARUS I website

This package contains a public marketing website and a content dashboard.

## Open the website

Run a local server from this folder.

```bash
python -m http.server 8000
```

Open:

- Public site: http://localhost:8000
- Content dashboard: http://localhost:8000/admin.html

Do not open the HTML files only by double-clicking if you want every browser feature to work consistently.

## Editing without code

The dashboard supports two modes.

### Local preview mode

This works immediately.

- Add or edit team members
- Add or edit partners
- Publish announcements
- Change project details
- Upload small images
- Export and import a JSON backup

Changes are saved in the current browser only. This is useful for preparing content and testing the website.

### Live publishing mode

Connect Supabase once. Then authorised users can sign in to `admin.html` and changes appear for every website visitor.

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run `schema.sql`.
4. Create an email and password user in Supabase Authentication.
5. Copy the user's UUID.
6. Run:

```sql
insert into public.admins (user_id)
values ('PASTE-THE-AUTH-USER-UUID-HERE');
```

7. Open `supabase-config.js`.
8. Add the project URL and public publishable or anon key.
9. Never add a service-role key to browser files.
10. Upload the full folder to your web host.

Example configuration:

```js
window.ARUS_SUPABASE = {
  url: "https://your-project.supabase.co",
  publishableKey: "your-public-key"
};
```

## Hosting

The website is static and can be hosted on services such as GitHub Pages, Netlify, Cloudflare Pages, or the university web server.

Supabase stores the editable content and uploaded images. The hosting service delivers the website files.

## Files

- `index.html`, public website
- `admin.html`, content dashboard
- `content.js`, bundled starter content and local fallback
- `supabase-config.js`, public connection values
- `schema.sql`, database tables and access policies
- `styles.css`, public website design
- `admin.css`, dashboard design
- `app.js`, public data loading and rendering
- `admin.js`, dashboard editing and publishing
- `assets/`, MES logo files

## Replace before launch

- Contact email
- Social media links
- Team photographs
- Partner logos and websites
- Any project figures that change after design review
- University approval wording and required brand or legal text
