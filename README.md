# Marine Engineering Society website

The public site for the Marine Engineering Society at the University of Southampton Malaysia. Its founding project, UoSM ARUS I, is the highlighted project on the page.

Deployed through GitHub Pages:

https://uosm-marine-engineering-society.github.io/MainPage/

## Proposal enquiry form

The "Request the proposal" buttons open a contact form. Submitting it stores the
message in Supabase and emails it to the society. The store happens first and on
purpose: if the email provider is down or out of quota, the enquiry is still in
`contact_messages` rather than lost.

Until the steps below are done the form will open, validate, and then report that
it could not send, pointing the visitor at the mailbox instead. Every button also
keeps a `mailto:` link, so a browser without `<dialog>` still reaches us.

### 1. Create the table

Run `schema.sql` in the Supabase SQL editor. It is safe to re-run — it creates
`contact_messages` and its policies only if they are missing. Nothing in a
browser can read or write that table: the edge function reaches it with the
service role, and administrators through the RLS policies.

### 2. Get a Resend API key

Sign up at https://resend.com (the free tier covers 3,000 emails a month, far
more than this form will ever send) and create an API key.

Without a verified domain, Resend only allows its shared `onboarding@resend.dev`
sender, which is what the function uses by default. Mail still arrives, and
replies still reach the enquirer because the function sets `reply_to` to their
address. To send from a society address later, verify the domain in Resend and
set `ENQUIRY_FROM`.

### 3. Deploy the edge function

```sh
npm install -g supabase
supabase login
supabase link --project-ref owkmlifdaovtbhjousno

supabase secrets set RESEND_API_KEY=re_your_key_here
supabase functions deploy send-enquiry
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform — do
not set them, and never put the service-role key in any file in this repository.

Optional secrets:

| Secret | Default | Purpose |
| --- | --- | --- |
| `ENQUIRY_TO` | `uosmmes@gmail.com` | Where enquiries are delivered |
| `ENQUIRY_FROM` | `ARUS I website <onboarding@resend.dev>` | Sender, once a domain is verified |

### 4. Check it

Submit the form on the live site. The email should arrive within a minute, and

```sql
select created_at, name, email, organisation, emailed from public.contact_messages
order by created_at desc limit 10;
```

should show the row with `emailed = true`. If `emailed` is `false`, the message
was saved but Resend rejected it — `supabase functions logs send-enquiry` says
why.

### Spam handling

A hidden honeypot field is dropped silently, and the function accepts at most
five messages an hour from one IP (stored only as a salted hash, never the
address itself).
