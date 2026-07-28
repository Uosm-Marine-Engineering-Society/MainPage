// Proposal enquiry handler for the public contact form.
//
// The message is stored first and emailed second, deliberately: if Resend is
// down, misconfigured or out of quota, the enquiry is still in the database and
// the visitor is not told to try again. Anything that fails after the insert is
// recoverable from the contact_messages table.
//
// Deploy:  supabase functions deploy send-enquiry
// Secrets: supabase secrets set RESEND_API_KEY=re_... [ENQUIRY_TO=...] [ENQUIRY_FROM=...]
import { createClient } from "jsr:@supabase/supabase-js@2";

const ENQUIRY_TO = Deno.env.get("ENQUIRY_TO") || "uosmmes@gmail.com";
// Resend only accepts a From on a domain you have verified. Until the society
// verifies one, its shared sender works and delivers to the address above.
const ENQUIRY_FROM = Deno.env.get("ENQUIRY_FROM") || "ARUS I website <onboarding@resend.dev>";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

// Per-IP ceiling. High enough that nobody sending a genuine enquiry, correcting
// it and sending again will ever reach it.
const MAX_PER_HOUR = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const clean = (value: unknown, limit: number) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

// Header injection guard: a newline in a header value can forge extra headers,
// and both of these are interpolated into Subject and Reply-To below.
const headerSafe = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  // Bot trap. Answering 200 keeps the response indistinguishable from a real
  // send, so a scripted submitter gets no signal about what gave it away.
  if (clean(payload.website, 200)) return json({ ok: true });

  const name = clean(payload.name, 120);
  const email = clean(payload.email, 160);
  const organisation = clean(payload.organisation, 160);
  const subject = clean(payload.subject, 160) || "Sponsorship proposal request";
  // Not run through `clean`: newlines are the message's own formatting.
  const message = String(payload.message ?? "").trim().slice(0, 4000);
  const sourcePath = clean(payload.source_path, 300) || "/";

  if (name.length < 2) return json({ ok: false, error: "Name is required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "A valid email is required" }, 400);
  if (message.length < 10) return json({ ok: false, error: "Message is required" }, 400);

  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  const ipHash = ip ? await sha256(`${ip}|arus-enquiry`) : "";

  // Service role: contact_messages denies anon entirely, so the table cannot be
  // read or written from a browser even with the publishable key.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  if (ipHash) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gt("created_at", since);
    if ((count ?? 0) >= MAX_PER_HOUR) {
      return json({ ok: false, error: "Too many messages from this connection. Please try again later." }, 429);
    }
  }

  const { data: row, error: insertError } = await supabase
    .from("contact_messages")
    .insert({
      name, email, organisation, subject, message,
      source_path: sourcePath,
      ip_hash: ipHash,
      user_agent: clean(request.headers.get("user-agent"), 400)
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("contact_messages insert failed:", insertError.message);
    return json({ ok: false, error: "Could not save the message" }, 500);
  }

  if (!RESEND_API_KEY) {
    // Saved but not sent. Reported as a failure so the visitor is pointed at the
    // mailbox directly rather than believing a message arrived that never did.
    console.error("RESEND_API_KEY is not set — enquiry stored but no email sent.");
    return json({ ok: false, error: "Email is not configured" }, 500);
  }

  const heading = organisation ? `${name} · ${organisation}` : name;
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: ENQUIRY_FROM,
      to: [ENQUIRY_TO],
      // Replying in the mail client goes straight back to the sender.
      reply_to: headerSafe(email),
      subject: headerSafe(`[Website] ${subject} — ${heading}`),
      text: [
        `From:         ${name}`,
        `Email:        ${email}`,
        `Organisation: ${organisation || "—"}`,
        `Subject:      ${subject}`,
        `Page:         ${sourcePath}`,
        "",
        message
      ].join("\n"),
      html: `<div style="font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#173746">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#067587">Website enquiry</p>
  <h2 style="margin:0 0 16px;color:#093c50;font-size:19px">${escapeHtml(subject)}</h2>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 18px;font-size:14px">
    <tr><td style="padding:2px 14px 2px 0;color:#5c7180">From</td><td>${escapeHtml(name)}</td></tr>
    <tr><td style="padding:2px 14px 2px 0;color:#5c7180">Email</td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
    <tr><td style="padding:2px 14px 2px 0;color:#5c7180">Organisation</td><td>${escapeHtml(organisation || "—")}</td></tr>
    <tr><td style="padding:2px 14px 2px 0;color:#5c7180">Page</td><td>${escapeHtml(sourcePath)}</td></tr>
  </table>
  <div style="padding:16px 18px;border-left:3px solid #067587;background:#eef6f8;white-space:pre-wrap">${escapeHtml(message)}</div>
</div>`
    })
  });

  if (!sent.ok) {
    console.error("Resend rejected the message:", sent.status, await sent.text());
    return json({ ok: false, error: "Could not send the email" }, 502);
  }

  await supabase.from("contact_messages").update({ emailed: true }).eq("id", row.id);
  return json({ ok: true });
});
