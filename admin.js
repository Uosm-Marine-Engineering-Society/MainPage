(() => {
  const defaults = window.ARUS_CONTENT || {};
  const config = window.ARUS_SUPABASE || {};
  const storageKey = "arus-content-v2";
  const legacyStorageKey = "arus-content-v1";
  const localSessionKey = "arus-admin-local-session-v1";
  const siteKeys = ["projectName", "clubName", "navProposalLabel", "university", "contactEmail", "proposalUrl", "footerText", "instagram", "linkedin", "animations", "analyticsEnabled", "updatedAt"];
  const configured = Boolean(config.url && config.publishableKey && window.supabase);
  const client = configured ? window.supabase.createClient(config.url, config.publishableKey) : null;
  let remoteMode = false;
  let state;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const slug = (value = "file") => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "file";
  const newId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function siteSettings(saved = {}) {
    const next = { ...(defaults.site || {}) };
    siteKeys.forEach((key) => {
      if (saved[key] !== undefined && saved[key] !== null) {
        next[key] = key === "contactEmail" && saved[key] === "replace-with-team-email@example.com" ? "" : saved[key];
      }
    });
    return next;
  }

  function migrateLegacy(legacy) {
    if (!legacy) return null;
    return {
      site: siteSettings(legacy.site),
      people: [
        ...(legacy.members || []).map((person) => ({ ...person, kind: "team", profile_url: person.profile_url || person.linkedin_url || "", image_path: person.image_path || "" })),
        ...(legacy.advisors || []).map((person) => ({ ...person, kind: "advisor", department: person.department || "", bio: person.bio || "", image_url: person.image_url || "", image_path: person.image_path || "", profile_url: person.profile_url || person.linkedin_url || "" }))
      ],
      project_updates: legacy.project_updates || legacy.announcements || [],
      partners: legacy.partners || []
    };
  }

  function normalise(value) {
    const base = clone(defaults);
    const content = value || base;
    return {
      site: siteSettings(content.site),
      people: content.people || base.people || [],
      project_updates: content.project_updates || content.announcements || base.project_updates || [],
      partners: content.partners || base.partners || []
    };
  }

  function loadLocal() {
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (current) return normalise(current);
      return normalise(migrateLegacy(JSON.parse(localStorage.getItem(legacyStorageKey) || "null")));
    } catch {
      return normalise(null);
    }
  }

  function saveLocal() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function toast(message, error = false) {
    const element = $("#toast");
    element.textContent = message;
    element.className = `toast show${error ? " error" : ""}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { element.className = "toast"; }, 3200);
  }

  async function loadRemote() {
    const [people, projectUpdates, partners, settings] = await Promise.all([
      client.from("people").select("*").order("display_order"),
      client.from("project_updates").select("*").order("published_at", { ascending: false }),
      client.from("partners").select("*").order("display_order"),
      client.from("site_settings").select("content").eq("id", "main").maybeSingle()
    ]);
    const error = [people, projectUpdates, partners, settings].map((response) => response.error).find(Boolean);
    if (error) throw error;
    state = normalise({ site: settings.data?.content || {}, people: people.data || [], project_updates: projectUpdates.data || [], partners: partners.data || [] });
  }

  async function hasAdminAccess() {
    const result = await client.rpc("is_admin");
    if (result.error) throw result.error;
    return result.data === true;
  }

  function showLogin(message = "") {
    $("#portalView").classList.add("hidden");
    $("#loginView").classList.remove("hidden");
    $("#signOutButton").classList.add("hidden");
    const identity = $("#loginIdentity");
    const label = $("#loginIdentityLabel");
    const note = $("#loginNote");
    const description = $("#loginDescription");
    identity.value = "";
    $("#loginPassword").value = "";
    if (configured) {
      label.textContent = "Admin email";
      identity.type = "email";
      identity.placeholder = "you@example.com";
      description.textContent = "Sign in with an approved Supabase administrator account.";
      note.textContent = "Live changes are protected by the project’s administrator policy.";
    } else {
      label.textContent = "Username";
      identity.type = "text";
      identity.placeholder = "admin";
      description.textContent = "Use the local preview credentials to edit this browser’s preview.";
      note.innerHTML = "Local preview only · username <strong>admin</strong> · password <strong>admin</strong>";
    }
    const messageElement = $("#loginMessage");
    messageElement.textContent = message;
    messageElement.classList.toggle("hidden", !message);
  }

  function showPortal() {
    $("#loginView").classList.add("hidden");
    $("#portalView").classList.remove("hidden");
    $("#signOutButton").classList.remove("hidden");
    renderAll();
  }

  function thumbnail(url, name) {
    return url ? `<img src="${esc(url)}" alt="">` : esc(initials(name));
  }

  function listRows(items, render, emptyText) {
    return items.length ? items.map(render).join("") : `<div class="empty">${esc(emptyText)}</div>`;
  }

  function renderPeople() {
    const rows = [...state.people].sort((a, b) => (a.kind || "team").localeCompare(b.kind || "team") || (Number(a.display_order) || 999) - (Number(b.display_order) || 999));
    $("#personAdminList").innerHTML = listRows(rows, (person) => `<article class="admin-item"><div class="admin-thumb">${thumbnail(person.image_url, person.name)}</div><div><h3>${esc(person.name)}</h3><p>${esc(person.role)}</p><span class="item-meta">${person.kind === "advisor" ? "Academic advisor" : "Team member"} · ${person.active === false ? "Hidden" : "Visible"} · order ${esc(person.display_order)}</span></div><div class="item-actions"><button type="button" data-edit-person="${esc(person.id)}">Edit</button><button class="delete" type="button" data-delete-table="people" data-delete-id="${esc(person.id)}">Delete</button></div></article>`, "No people yet.");
  }

  function renderUpdates() {
    const rows = [...state.project_updates].sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    $("#updateAdminList").innerHTML = listRows(rows, (item) => `<article class="admin-item"><div class="admin-thumb">NEWS</div><div><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p><span class="item-meta">${esc(item.published_at)} · ${item.active === false ? "Hidden" : "Visible"}</span></div><div class="item-actions"><button type="button" data-edit-update="${esc(item.id)}">Edit</button><button class="delete" type="button" data-delete-table="project_updates" data-delete-id="${esc(item.id)}">Delete</button></div></article>`, "No project updates yet.");
  }

  function renderPartners() {
    const rows = [...state.partners].sort((a, b) => (Number(a.display_order) || 999) - (Number(b.display_order) || 999));
    $("#partnerAdminList").innerHTML = listRows(rows, (partner) => `<article class="admin-item"><div class="admin-thumb">${thumbnail(partner.logo_url, partner.name)}</div><div><h3>${esc(partner.name)}</h3><p>${esc(partner.description || "")}</p><span class="item-meta">${esc(partner.tier)} · ${partner.active === false ? "Hidden" : "Visible"} · order ${esc(partner.display_order)}</span></div><div class="item-actions"><button type="button" data-edit-partner="${esc(partner.id)}">Edit</button><button class="delete" type="button" data-delete-table="partners" data-delete-id="${esc(partner.id)}">Delete</button></div></article>`, "No partners yet.");
  }

  let analytics = { sessions: [], events: new Map(), outreach: [], loaded: false };
  const expandedVisits = new Set();

  const analyticsDays = () => Number($("#analyticsRange").value) || 30;
  const hidesBots = () => $("#analyticsHideBots").checked;

  function analyticsDuration(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }

  function shortTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function sinceNow(value) {
    if (!value) return "—";
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
  }

  const daysSince = (value) => (value ? Math.floor((Date.now() - new Date(value).getTime()) / 86400000) : null);

  function flagFor(code) {
    const value = String(code || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(value)) return "";
    return String.fromCodePoint(...[...value].map((letter) => 127397 + letter.charCodeAt(0)));
  }

  function siteLinkFor(code) {
    const base = location.href.replace(/admin\.html.*$/, "").replace(/[?#].*$/, "");
    return `${base}?s=${encodeURIComponent(code)}`;
  }

  function placeOf(session) {
    const parts = [session.city, session.region, session.country].map((part) => (part || "").trim()).filter(Boolean);
    const unique = parts.filter((part, index) => parts.indexOf(part) === index);
    if (!unique.length) return session.edge_country ? `${flagFor(session.edge_country)} ${session.edge_country}`.trim() : "Location unknown";
    return `${flagFor(session.country_code || session.edge_country)} ${unique.join(", ")}`.trim();
  }

  function networkOf(session) {
    const name = (session.org || session.isp || "").trim();
    if (!name) return "Network unknown";
    return session.asn && !name.includes(session.asn) ? `${name} · ${session.asn}` : name;
  }

  function arrivalOf(session) {
    if (session.sponsor_code) {
      const contact = analytics.outreach.find((row) => row.code === session.sponsor_code);
      return `Sponsor link · ${contact ? contact.organisation : session.sponsor_code}`;
    }
    if (session.utm_source) return `${session.utm_source}${session.utm_medium ? ` · ${session.utm_medium}` : ""}`;
    if (session.referrer_host) return session.referrer_host;
    return "Direct / typed in";
  }

  function eventName(type) {
    return ({
      session_start: "Visit started",
      page_view: "Page viewed",
      section_view: "Read section",
      link_click: "Clicked link",
      control_click: "Used control",
      proposal_open: "Opened proposal",
      email_copy: "Copied email address",
      scroll_depth: "Scrolled",
      engagement: "Reading"
    })[type] || type;
  }

  function visibleSessions() {
    return analytics.sessions.filter((session) => !(hidesBots() && session.is_bot));
  }

  function rankBy(rows, selector) {
    const counts = new Map();
    rows.forEach((row) => {
      const label = (selector(row) || "").trim();
      if (!label) return;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  // Ranked magnitude: one measure, one colour, value always printed beside the bar
  // so the number never depends on reading the bar length or a hover.
  function renderRankedList(target, rows, emptyText = "Nothing recorded in this period.") {
    const top = rows.slice(0, 8);
    const max = Math.max(1, ...top.map(([, count]) => count));
    $(target).innerHTML = top.length
      ? top.map(([label, count]) => `<div class="rank-row"><span class="rank-label" title="${esc(label)}">${esc(label)}</span><span class="rank-track"><span class="rank-bar" style="inline-size:${Math.round(count / max * 100)}%"></span></span><strong class="rank-value">${count.toLocaleString()}</strong></div>`).join("")
      : `<div class="empty">${esc(emptyText)}</div>`;
  }

  function sponsorSummary(code) {
    const all = analytics.sessions.filter((session) => session.sponsor_code === code);
    const human = all.filter((session) => !session.is_bot);
    const automated = all.filter((session) => session.is_bot);
    const ordered = [...human].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    return {
      visits: human.length,
      automated: automated.length,
      firstOpen: ordered[0]?.started_at || null,
      lastSeen: ordered.length ? ordered[ordered.length - 1].last_seen_at : null,
      engaged: human.reduce((sum, session) => sum + (Number(session.engaged_seconds) || 0), 0),
      proposals: human.reduce((sum, session) => sum + (Number(session.proposal_opens) || 0), 0),
      visitors: new Set(human.map((session) => session.visitor_id)).size
    };
  }

  // Status is always an icon plus words: the colour repeats the meaning, never carries it.
  function outreachVerdict(contact, summary) {
    const waiting = daysSince(contact.emailed_at);
    if (summary.visits > 0) return { tone: "good", icon: "✓", text: summary.visitors > 1 ? `Opened · ${summary.visitors} people` : "Opened", note: `First open ${shortTime(summary.firstOpen)}` };
    if (contact.status === "draft" || !contact.emailed_at) return { tone: "idle", icon: "○", text: "Not emailed yet", note: "Send the tracking link to start measuring." };
    if (summary.automated > 0) return { tone: "serious", icon: "◑", text: "Delivered, not read", note: "Only their mail security scanner followed the link, so the message arrived but nobody has opened it." };
    if (waiting !== null && waiting >= 7) return { tone: "critical", icon: "✕", text: `Nothing after ${waiting} days`, note: "No visit and no scanner hit. Likely filtered to spam or never delivered — try another address or channel." };
    return { tone: "warning", icon: "!", text: waiting ? `Quiet for ${waiting} days` : "Sent today", note: "No opens yet. Give it a few days before treating it as undelivered." };
  }

  function renderSponsors() {
    // Sponsors actually waiting on a reply come first, newest email at the top;
    // ones that have not been sent yet sit below them.
    const rows = [...analytics.outreach].sort((a, b) => {
      if (Boolean(a.emailed_at) !== Boolean(b.emailed_at)) return a.emailed_at ? -1 : 1;
      return new Date(b.emailed_at || b.created_at) - new Date(a.emailed_at || a.created_at);
    });
    $("#sponsorRows").innerHTML = rows.length ? rows.map((contact) => {
      const summary = sponsorSummary(contact.code);
      const verdict = outreachVerdict(contact, summary);
      const who = `${esc(contact.organisation)}${contact.contact_name ? `<small>${esc(contact.contact_name)}${contact.contact_email ? ` · ${esc(contact.contact_email)}` : ""}</small>` : ""}`;
      return `<tr>
        <td class="cell-primary">${who}</td>
        <td><span class="badge badge-${verdict.tone}" title="${esc(verdict.note)}"><span aria-hidden="true">${verdict.icon}</span>${esc(verdict.text)}</span>${summary.automated && summary.visits ? `<small>+${summary.automated} scanner hit${summary.automated === 1 ? "" : "s"}</small>` : ""}</td>
        <td>${contact.emailed_at ? esc(new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(contact.emailed_at))) : "—"}</td>
        <td class="cell-number">${summary.visits.toLocaleString()}</td>
        <td>${summary.firstOpen ? esc(shortTime(summary.firstOpen)) : "—"}</td>
        <td>${summary.lastSeen ? esc(sinceNow(summary.lastSeen)) : "—"}</td>
        <td class="cell-number">${esc(analyticsDuration(summary.engaged))}</td>
        <td class="cell-number">${summary.proposals ? `${summary.proposals}×` : "—"}</td>
        <td><button class="link-button" type="button" data-copy-link="${esc(contact.code)}">Copy link</button></td>
        <td class="cell-actions"><button type="button" data-edit-outreach="${esc(contact.id)}">Edit</button><button class="delete" type="button" data-delete-outreach="${esc(contact.id)}">Delete</button></td>
      </tr>`;
    }).join("") : `<tr><td colspan="10"><div class="empty">No sponsors tracked yet. Add one above, then email that sponsor their link.</div></td></tr>`;
  }

  function visitDetail(session) {
    const events = (analytics.events.get(session.session_id) || []).slice().sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
    const facts = [
      ["Visit started", shortTime(session.started_at)],
      ["Last activity", `${shortTime(session.last_seen_at)} (${sinceNow(session.last_seen_at)})`],
      ["Reading time", analyticsDuration(session.engaged_seconds)],
      ["Scroll depth", `${session.max_scroll || 0}%`],
      ["Arrived via", arrivalOf(session)],
      ["Landing page", `${session.entry_path || "/"}${session.landing_query ? `?${session.landing_query}` : ""}`],
      ["Referrer", session.referrer || "None"],
      ["Campaign", [session.utm_source, session.utm_medium, session.utm_campaign, session.utm_content, session.utm_term].filter(Boolean).join(" · ") || "None"],
      ["IP address", session.ip_address || "Not captured"],
      ["Location", placeOf(session)],
      ["Postcode", session.postal || "—"],
      ["Coordinates", session.latitude && session.longitude ? `${Number(session.latitude).toFixed(3)}, ${Number(session.longitude).toFixed(3)}` : "—"],
      ["Network", networkOf(session)],
      ["Edge country", session.edge_country || "—"],
      ["Location source", session.geo_source || "Not resolved"],
      ["Device", `${session.device || "Unknown"}${session.touch_points ? ` · ${session.touch_points} touch points` : ""}`],
      ["Browser", `${session.browser || "Unknown"} ${session.browser_version || ""}`.trim()],
      ["System", `${session.os || "Unknown"} ${session.os_version || ""}`.trim()],
      ["Platform", session.platform || "—"],
      ["Screen", `${session.screen_size || "—"}${session.pixel_ratio ? ` @${session.pixel_ratio}×` : ""}${session.color_depth ? ` · ${session.color_depth}-bit` : ""}`],
      ["Viewport", session.viewport_size || "—"],
      ["Hardware", [session.cpu_cores ? `${session.cpu_cores} cores` : "", session.device_memory ? `${session.device_memory} GB` : ""].filter(Boolean).join(" · ") || "—"],
      ["Connection", session.connection || "—"],
      ["Timezone", session.timezone || "—"],
      ["Language", session.languages || session.language || "—"],
      ["Appearance", [session.prefers_dark === true ? "Dark mode" : session.prefers_dark === false ? "Light mode" : "", session.prefers_reduced_motion ? "Reduced motion" : ""].filter(Boolean).join(" · ") || "—"],
      ["Page load", session.load_ms ? `${session.load_ms} ms` : "—"],
      ["Visitor", `${session.is_returning ? "Returning" : "First time"} · visit ${session.visit_number} · ${String(session.visitor_id).slice(0, 8)}`],
      ["Automated", session.is_bot ? "Yes — matched a scanner or bot signature" : "No"],
      ["User agent", session.user_agent || "—"]
    ];
    const timeline = events.map((event) => {
      const detail = event.label || event.target || event.path || "";
      const value = event.event_type === "engagement" ? analyticsDuration(event.value) : event.event_type === "scroll_depth" ? `${event.value}%` : "";
      return `<li><time>${esc(new Intl.DateTimeFormat("en-GB", { timeStyle: "medium" }).format(new Date(event.occurred_at)))}</time><span>${esc(eventName(event.event_type))}</span><em title="${esc(event.target || "")}">${esc(detail)}</em><strong>${esc(value)}</strong></li>`;
    }).join("");
    return `<div class="visit-detail">
      <dl class="visit-facts">${facts.map(([term, value]) => `<div><dt>${esc(term)}</dt><dd title="${esc(value)}">${esc(value)}</dd></div>`).join("")}</dl>
      <div class="visit-timeline"><h4>What they did</h4><ol>${timeline || "<li>No individual events recorded.</li>"}</ol></div>
    </div>`;
  }

  function renderVisits() {
    const filter = $("#visitsFilter").value;
    const rows = visibleSessions().filter((session) => {
      if (filter === "sponsor") return Boolean(session.sponsor_code);
      if (filter === "engaged") return (Number(session.engaged_seconds) || 0) >= 15;
      if (filter === "proposal") return (Number(session.proposal_opens) || 0) > 0;
      return true;
    });

    $("#visitRows").innerHTML = rows.length ? rows.map((session) => {
      const open = expandedVisits.has(session.session_id);
      const contact = session.sponsor_code ? analytics.outreach.find((row) => row.code === session.sponsor_code) : null;
      const sponsorCell = session.sponsor_code
        ? `<span class="tag">${esc(contact ? contact.organisation : session.sponsor_code)}</span>`
        : `<span class="muted">${esc(arrivalOf(session))}</span>`;
      return `<tr class="visit-row${open ? " is-open" : ""}" data-visit="${esc(session.session_id)}" tabindex="0" role="button" aria-expanded="${open}">
        <td><span class="cell-primary">${esc(sinceNow(session.started_at))}</span><small>${esc(shortTime(session.started_at))}</small></td>
        <td><span class="cell-primary">${esc(placeOf(session))}</span><small>${session.is_returning ? `Returning visitor · visit ${esc(session.visit_number)}` : "First visit"}${session.is_bot ? " · automated" : ""}</small></td>
        <td title="${esc(networkOf(session))}">${esc(networkOf(session))}</td>
        <td>${sponsorCell}</td>
        <td class="cell-number">${esc(analyticsDuration(session.engaged_seconds))}</td>
        <td class="cell-number">${session.max_scroll || 0}%</td>
        <td class="cell-number">${(session.sections_viewed || []).length}</td>
        <td><span class="cell-primary">${esc(session.device || "—")}</span><small>${esc(`${session.browser || ""} ${session.browser_version || ""} · ${session.os || ""}`.trim())}</small></td>
      </tr>${open ? `<tr class="visit-detail-row"><td colspan="8">${visitDetail(session)}</td></tr>` : ""}`;
    }).join("") : `<tr><td colspan="8"><div class="empty">No visits match this filter.</div></td></tr>`;
  }

  // Visits over time: one measure, so one colour and no legend. Every bar is
  // focusable and its value is also in the data table beneath the chart.
  function renderChart(sessions) {
    const days = analyticsDays();
    const weekly = days > 90;
    const bucketMs = weekly ? 7 * 86400000 : 86400000;
    const buckets = new Map();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const count = weekly ? Math.ceil(days / 7) : days;
    for (let index = count - 1; index >= 0; index -= 1) {
      const stamp = start.getTime() - index * bucketMs;
      buckets.set(stamp, { visits: 0, sponsored: 0 });
    }
    const keys = [...buckets.keys()];
    sessions.forEach((session) => {
      const time = new Date(session.started_at).getTime();
      if (!Number.isFinite(time)) return;
      // Anything older than the first bucket is folded into it, so the bars always
      // add up to the visit count in the tiles above.
      const slot = Math.min(keys.length - 1, Math.max(0, Math.floor((time - keys[0]) / bucketMs)));
      const bucket = buckets.get(keys[slot]);
      bucket.visits += 1;
      if (session.sponsor_code) bucket.sponsored += 1;
    });

    const entries = [...buckets.entries()];
    const max = Math.max(1, ...entries.map(([, bucket]) => bucket.visits));
    const peak = entries.reduce((best, entry) => (entry[1].visits > best[1].visits ? entry : best), entries[0]);
    const dayLabel = (stamp) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(stamp));

    $("#chartCaption").textContent = weekly
      ? `Each bar is one week. Peak ${peak[1].visits} visit${peak[1].visits === 1 ? "" : "s"} in the week of ${dayLabel(peak[0])}.`
      : `Each bar is one day. Peak ${peak[1].visits} visit${peak[1].visits === 1 ? "" : "s"} on ${dayLabel(peak[0])}.`;

    $("#visitsChart").innerHTML = `
      <div class="chart-plot" style="--chart-max:${max}">
        <span class="chart-gridline"><i>${max}</i></span>
        <div class="chart-bars">
          ${entries.map(([stamp, bucket]) => {
            const label = `${dayLabel(stamp)}: ${bucket.visits} visit${bucket.visits === 1 ? "" : "s"}${bucket.sponsored ? `, ${bucket.sponsored} from a sponsor link` : ""}`;
            return `<button class="chart-bar" type="button" aria-label="${esc(label)}"><span class="chart-fill" style="block-size:${Math.round(bucket.visits / max * 100)}%"></span><span class="chart-tip">${esc(label)}</span></button>`;
          }).join("")}
        </div>
        <div class="chart-axis"><span>${esc(dayLabel(entries[0][0]))}</span><span>${esc(dayLabel(entries[entries.length - 1][0]))}</span></div>
      </div>`;

    $("#chartTable").innerHTML = entries.map(([stamp, bucket]) => `<tr><td>${esc(dayLabel(stamp))}</td><td>${bucket.visits}</td><td>${bucket.sponsored}</td></tr>`).join("");
  }

  function renderOverview() {
    const sessions = visibleSessions();
    const engaged = sessions.map((session) => Number(session.engaged_seconds) || 0).sort((a, b) => a - b);
    const median = engaged.length ? engaged[Math.floor(engaged.length / 2)] : 0;
    const sponsored = sessions.filter((session) => session.sponsor_code);
    const tagged = new Set(sponsored.map((session) => session.sponsor_code));

    $("#analyticsVisits").textContent = sessions.length.toLocaleString();
    $("#analyticsVisitorsNote").textContent = `${new Set(sessions.map((session) => session.visitor_id)).size.toLocaleString()} distinct visitors`;
    $("#analyticsTime").textContent = analyticsDuration(median);
    $("#analyticsSponsorVisits").textContent = sponsored.length.toLocaleString();
    $("#analyticsSponsorNote").textContent = `from ${tagged.size} tagged link${tagged.size === 1 ? "" : "s"}`;
    $("#analyticsProposals").textContent = sessions.reduce((sum, session) => sum + (Number(session.proposal_opens) || 0), 0).toLocaleString();
    $("#analyticsCopies").textContent = sessions.reduce((sum, session) => sum + (Number(session.email_copies) || 0), 0).toLocaleString();
    $("#analyticsScrolls").textContent = sessions.filter((session) => (Number(session.max_scroll) || 0) >= 75).length.toLocaleString();

    renderChart(sessions);
    renderRankedList("#analyticsCountries", rankBy(sessions, (session) => (session.country ? `${flagFor(session.country_code)} ${session.country}`.trim() : "")));
    renderRankedList("#analyticsCities", rankBy(sessions, (session) => (session.city ? `${session.city}${session.region && session.region !== session.city ? `, ${session.region}` : ""}` : "")));
    renderRankedList("#analyticsOrgs", rankBy(sessions, (session) => session.org || session.isp));
    renderRankedList("#analyticsSources", rankBy(sessions, arrivalOf));
    renderRankedList("#analyticsDevices", rankBy(sessions, (session) => session.device));
    renderRankedList("#analyticsBrowsers", rankBy(sessions, (session) => `${session.browser || "Unknown"} on ${session.os || "unknown system"}`));

    const shown = new Set(sessions.map((session) => session.session_id));
    const events = [...analytics.events.entries()]
      .filter(([sessionId]) => !hidesBots() || shown.has(sessionId))
      .flatMap(([, list]) => list);
    renderRankedList("#analyticsSections", rankBy(events.filter((event) => event.event_type === "section_view"), (event) => event.label || event.section));
    renderRankedList("#analyticsLinks", rankBy(events.filter((event) => event.event_type === "link_click"), (event) => event.label || event.target));
  }

  function renderAnalytics() {
    if (!analytics.loaded) return;
    renderSponsors();
    renderVisits();
    renderOverview();
  }

  async function loadAnalytics() {
    const status = $("#analyticsStatus");
    status.classList.remove("is-error");
    $("#analyticsPanel").classList.toggle("is-empty", !remoteMode);
    if (!remoteMode) {
      status.textContent = "Analytics need the Supabase connection. Local preview activity is intentionally not tracked.";
      return;
    }

    const days = analyticsDays();
    const since = new Date(Date.now() - days * 86400000).toISOString();
    status.textContent = "Loading analytics…";
    try {
      const [sessions, events, outreach] = await Promise.all([
        client.from("analytics_sessions").select("*").gte("started_at", since).order("started_at", { ascending: false }).limit(5000),
        client.from("analytics_events").select("occurred_at,session_id,event_type,path,section,target,label,value").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(20000),
        client.from("outreach_contacts").select("*").order("created_at", { ascending: false })
      ]);
      const failure = [sessions, events, outreach].map((response) => response.error).find(Boolean);
      if (failure) throw failure;

      const grouped = new Map();
      (events.data || []).forEach((event) => {
        if (!grouped.has(event.session_id)) grouped.set(event.session_id, []);
        grouped.get(event.session_id).push(event);
      });
      analytics = { sessions: sessions.data || [], events: grouped, outreach: outreach.data || [], loaded: true };
      renderAnalytics();

      const automated = analytics.sessions.filter((session) => session.is_bot).length;
      // A full page means the database cut the result short, so the totals below
      // would be understated without saying so.
      const truncated = analytics.sessions.length >= 5000 || (events.data || []).length >= 20000;
      status.textContent = `${analytics.sessions.length.toLocaleString()} visits in the last ${days} days${automated ? ` · ${automated} automated hit${automated === 1 ? "" : "s"}${hidesBots() ? " hidden" : ""}` : ""}.${truncated ? " Display limit reached — choose a shorter period for exact totals." : ""}`;
    } catch (error) {
      const missing = /analytics_sessions|outreach_contacts|log_visit/.test(error?.message || "");
      status.textContent = missing
        ? "Visitor tracking tables are missing. Run the latest schema.sql in the Supabase SQL editor, then refresh."
        : `Could not load analytics: ${error?.message || "Unknown error"}`;
      status.classList.add("is-error");
      $("#analyticsPanel").classList.add("is-empty");
    }
  }

  function fillOutreachLink(code) {
    const preview = $("#outreachLinkPreview");
    const valid = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(code || "");
    preview.hidden = !valid;
    if (valid) $("#outreachLinkValue").textContent = siteLinkFor(code);
  }

  async function copyText(value, message) {
    try {
      await navigator.clipboard.writeText(value);
      toast(message);
    } catch {
      toast("Copy the link manually — the browser blocked clipboard access.", true);
    }
  }

  function fillSettings() {
    const form = $("#settingsForm");
    siteKeys.filter((key) => key !== "updatedAt").forEach((key) => {
      const field = form.elements[key];
      if (!field) return;
      if (field.type === "checkbox") field.checked = state.site[key] !== false;
      else field.value = state.site[key] || "";
    });
  }

  function renderAll() {
    renderPeople();
    renderUpdates();
    renderPartners();
    fillSettings();
  }

  function resetForm(id) {
    const form = document.getElementById(id);
    form.reset();
    if (form.elements.id) form.elements.id.value = "";
    if (form.elements.image_path) form.elements.image_path.value = "";
    if (form.elements.logo_path) form.elements.logo_path.value = "";
    if (form.elements.display_order) form.elements.display_order.value = 10;
    if (form.elements.active) form.elements.active.checked = true;
    if (id === "updateForm") form.elements.published_at.value = new Date().toISOString().slice(0, 10);
    const preview = id === "personForm" ? $("#personPreview") : id === "partnerForm" ? $("#partnerPreview") : null;
    if (preview) { preview.innerHTML = ""; preview.classList.add("hidden"); }
    if (id === "personForm") $("#personFormTitle").textContent = "Add person";
    if (id === "partnerForm") $("#partnerFormTitle").textContent = "Add partner";
    if (id === "updateForm") $("#updateFormTitle").textContent = "Add project update";
    if (id === "outreachForm") {
      $("#outreachFormTitle").textContent = "Add sponsor to track";
      $("#outreachLinkPreview").hidden = true;
      form.elements.emailed_at.value = new Date().toISOString().slice(0, 10);
      form.elements.status.value = "emailed";
    }
  }

  function previewMedia(target, url, name = "Selected image") {
    if (!url) { target.innerHTML = ""; target.classList.add("hidden"); return; }
    target.innerHTML = `<img src="${esc(url)}" alt=""><span>${esc(name)}</span>`;
    target.classList.remove("hidden");
  }

  function fillForm(formId, data) {
    const form = $(formId);
    Object.entries(data).forEach(([key, value]) => {
      const field = form.elements[key];
      if (!field || field.type === "file") return;
      if (field.type === "checkbox") field.checked = value !== false;
      else field.value = value ?? "";
    });
    if (formId === "#personForm") { $("#personFormTitle").textContent = "Edit person"; previewMedia($("#personPreview"), data.image_url, data.name); }
    if (formId === "#partnerForm") { $("#partnerFormTitle").textContent = "Edit partner"; previewMedia($("#partnerPreview"), data.logo_url, data.name); }
    if (formId === "#updateForm") $("#updateFormTitle").textContent = "Edit project update";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function dataFromForm(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function removeStorage(path) {
    if (!remoteMode || !path) return;
    const result = await client.storage.from("media").remove([path]);
    if (result.error) console.warn("Old media could not be removed.", result.error);
  }

  async function resolveMedia(fileInput, url, oldUrl, oldPath, folder, id) {
    const file = fileInput?.files?.[0];
    const requestedUrl = url.trim();
    if (!file) {
      if (!requestedUrl) return { url: "", path: "", oldPath: oldPath || "" };
      if (requestedUrl === (oldUrl || "").trim()) return { url: requestedUrl, path: oldPath || "", oldPath: "" };
      return { url: requestedUrl, path: "", oldPath: oldPath || "" };
    }
    if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
    const limit = remoteMode ? 5_000_000 : 1_500_000;
    if (file.size > limit) throw new Error(`Use an image smaller than ${remoteMode ? "5 MB" : "1.5 MB"}.`);
    if (!remoteMode) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      return { url: dataUrl, path: "", oldPath: oldPath || "" };
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${folder}/${id}/${Date.now()}-${slug(file.name.replace(/\.[^.]+$/, ""))}.${extension}`;
    const result = await client.storage.from("media").upload(path, file, { upsert: false, contentType: file.type });
    if (result.error) throw result.error;
    return { url: client.storage.from("media").getPublicUrl(path).data.publicUrl, path, oldPath: oldPath || "" };
  }

  async function saveSite(site) {
    const next = siteSettings(site);
    if (remoteMode) {
      const result = await client.from("site_settings").upsert({ id: "main", content: next }, { onConflict: "id" });
      if (result.error) throw result.error;
    }
    state.site = next;
    if (!remoteMode) saveLocal();
  }

  async function saveRow(table, row) {
    if (remoteMode) {
      const result = await client.from(table).upsert(row, { onConflict: "id" }).select().single();
      if (result.error) throw result.error;
      row = result.data;
    }
    const rows = state[table];
    const index = rows.findIndex((item) => item.id === row.id);
    if (index >= 0) rows[index] = row;
    else rows.push(row);
    if (!remoteMode) saveLocal();
    return row;
  }

  async function deleteRow(table, id) {
    const row = state[table].find((item) => item.id === id);
    if (remoteMode) {
      const result = await client.from(table).delete().eq("id", id);
      if (result.error) throw result.error;
    }
    state[table] = state[table].filter((item) => item.id !== id);
    if (!remoteMode) saveLocal();
    await removeStorage(table === "people" ? row?.image_path : table === "partners" ? row?.logo_path : "");
  }

  function bindTabs() {
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
      $$(".tab").forEach((item) => { item.classList.remove("active"); item.setAttribute("aria-selected", "false"); });
      $$(".panel").forEach((panel) => panel.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      document.getElementById(tab.dataset.panel).classList.add("active");
      if (tab.dataset.panel === "analyticsPanel") loadAnalytics();
    }));
  }

  function bindFilePreview(formId, inputName, previewId) {
    const input = $(formId).elements[inputName];
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) previewMedia($(previewId), URL.createObjectURL(file), file.name);
    });
  }

  async function signIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const identity = form.elements.identity.value.trim();
    const password = form.elements.password.value;
    try {
      if (!configured) {
        if (identity !== "admin" || password !== "admin") throw new Error("Incorrect username or password.");
        sessionStorage.setItem(localSessionKey, "true");
        remoteMode = false;
        state = loadLocal();
        showPortal();
        return;
      }
      const result = await client.auth.signInWithPassword({ email: identity, password });
      if (result.error) throw result.error;
      if (!(await hasAdminAccess())) {
        await client.auth.signOut();
        throw new Error("This account is not approved to manage website content.");
      }
      remoteMode = true;
      await loadRemote();
      showPortal();
    } catch (error) {
      const message = error?.message || "Could not sign in.";
      $("#loginMessage").textContent = message;
      $("#loginMessage").classList.remove("hidden");
    }
  }

  async function signOut() {
    if (remoteMode) await client.auth.signOut();
    sessionStorage.removeItem(localSessionKey);
    remoteMode = false;
    state = loadLocal();
    showLogin();
  }

  $("#loginForm").addEventListener("submit", signIn);
  $("#signOutButton").addEventListener("click", signOut);

  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = dataFromForm(form);
    // Text fields only. Checkboxes are read from .checked below: an unchecked box is
    // absent from FormData entirely, and a checked one yields the string "on".
    const text = Object.fromEntries(
      Object.entries(data)
        .filter(([key]) => siteKeys.includes(key) && form.elements[key]?.type !== "checkbox")
        .map(([key, value]) => [key, String(value).trim()])
    );
    const next = {
      ...state.site,
      ...text,
      animations: form.elements.animations.checked,
      analyticsEnabled: form.elements.analyticsEnabled.checked,
      updatedAt: new Date().toISOString()
    };
    try {
      await saveSite(next);
      fillSettings();
      toast("Site settings saved.");
    } catch (error) {
      toast(error?.message || "Could not save site settings.", true);
    }
  });

  $("#updateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = dataFromForm(form);
    const row = { id: data.id || newId(), title: data.title.trim(), summary: data.summary.trim(), published_at: data.published_at, link_url: data.link_url.trim(), active: form.elements.active.checked };
    try {
      await saveRow("project_updates", row);
      resetForm("updateForm");
      renderUpdates();
      toast("Project update saved.");
    } catch (error) {
      toast(error?.message || "Could not save project update.", true);
    }
  });

  $("#personForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = dataFromForm(form);
    const id = data.id || newId();
    const previous = state.people.find((person) => person.id === id);
    try {
      const media = await resolveMedia(form.elements.image_file, data.image_url || "", previous?.image_url || "", previous?.image_path || data.image_path, "people", id);
      const row = { id, kind: data.kind, name: data.name.trim(), role: data.role.trim(), department: data.department.trim(), bio: data.bio.trim(), image_url: media.url, image_path: media.path, profile_url: data.profile_url.trim(), display_order: Number(data.display_order) || 10, active: form.elements.active.checked };
      await saveRow("people", row);
      if (media.oldPath && media.oldPath !== media.path) await removeStorage(media.oldPath);
      resetForm("personForm");
      renderPeople();
      toast("Person saved.");
    } catch (error) {
      toast(error?.message || "Could not save person.", true);
    }
  });

  $("#partnerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = dataFromForm(form);
    const id = data.id || newId();
    const previous = state.partners.find((partner) => partner.id === id);
    try {
      const media = await resolveMedia(form.elements.logo_file, data.logo_url || "", previous?.logo_url || "", previous?.logo_path || data.logo_path, "partners", id);
      const row = { id, name: data.name.trim(), tier: data.tier, description: data.description.trim(), logo_url: media.url, logo_path: media.path, website_url: data.website_url.trim(), display_order: Number(data.display_order) || 10, active: form.elements.active.checked };
      await saveRow("partners", row);
      if (media.oldPath && media.oldPath !== media.path) await removeStorage(media.oldPath);
      resetForm("partnerForm");
      renderPartners();
      toast("Partner saved.");
    } catch (error) {
      toast(error?.message || "Could not save partner.", true);
    }
  });

  $("#outreachForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = dataFromForm(form);
    const code = slug(data.code || data.organisation);
    if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(code)) {
      toast("Use a tracking code of at least two letters or numbers.", true);
      return;
    }
    if (!remoteMode) {
      toast("Sponsor tracking needs the Supabase connection.", true);
      return;
    }
    const row = {
      code,
      organisation: data.organisation.trim(),
      contact_name: data.contact_name.trim(),
      contact_email: data.contact_email.trim(),
      notes: data.notes.trim(),
      emailed_at: data.emailed_at || null,
      status: data.status
    };
    if (data.id) row.id = data.id;
    try {
      const result = await client.from("outreach_contacts").upsert(row, { onConflict: "id" }).select().single();
      if (result.error) throw result.error;
      const index = analytics.outreach.findIndex((item) => item.id === result.data.id);
      if (index >= 0) analytics.outreach[index] = result.data;
      else analytics.outreach.unshift(result.data);
      resetForm("outreachForm");
      renderSponsors();
      await copyText(siteLinkFor(code), `Saved. The link for ${row.organisation} is on your clipboard.`);
    } catch (error) {
      const duplicate = /duplicate|unique/i.test(error?.message || "");
      toast(duplicate ? "That tracking code is already used by another sponsor." : error?.message || "Could not save the sponsor.", true);
    }
  });

  $("#outreachForm").elements.organisation.addEventListener("input", (event) => {
    const codeField = $("#outreachForm").elements.code;
    if (codeField.dataset.touched === "true" || $("#outreachForm").elements.id.value) return;
    codeField.value = slug(event.target.value);
    fillOutreachLink(codeField.value);
  });

  $("#outreachForm").elements.code.addEventListener("input", (event) => {
    event.target.dataset.touched = "true";
    event.target.value = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    fillOutreachLink(event.target.value);
  });

  $("#outreachLinkCopy").addEventListener("click", () => copyText($("#outreachLinkValue").textContent, "Link copied."));

  $$(".view-tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".view-tab").forEach((item) => { item.classList.remove("active"); item.setAttribute("aria-selected", "false"); });
    $$(".analytics-view").forEach((view) => view.classList.remove("active"));
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    document.getElementById(tab.dataset.view).classList.add("active");
  }));

  $("#chartTableToggle").addEventListener("click", (event) => {
    const wrap = $("#chartTableWrap");
    wrap.hidden = !wrap.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!wrap.hidden));
    event.currentTarget.textContent = wrap.hidden ? "Show data table" : "Hide data table";
  });

  $("#visitsFilter").addEventListener("change", renderVisits);
  $("#analyticsHideBots").addEventListener("change", renderAnalytics);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest?.(".visit-row");
    if (!row) return;
    event.preventDefault();
    row.click();
  });

  document.addEventListener("click", async (event) => {
    const reset = event.target.closest("[data-reset]");
    if (reset) { resetForm(reset.dataset.reset); return; }
    const copyLink = event.target.closest("[data-copy-link]");
    if (copyLink) { await copyText(siteLinkFor(copyLink.dataset.copyLink), "Sponsor link copied."); return; }
    const editOutreach = event.target.closest("[data-edit-outreach]");
    if (editOutreach) {
      const row = analytics.outreach.find((item) => item.id === editOutreach.dataset.editOutreach);
      if (!row) return;
      fillForm("#outreachForm", { ...row, emailed_at: row.emailed_at || "" });
      $("#outreachFormTitle").textContent = `Edit ${row.organisation}`;
      $("#outreachForm").elements.code.dataset.touched = "true";
      fillOutreachLink(row.code);
      return;
    }
    const deleteOutreach = event.target.closest("[data-delete-outreach]");
    if (deleteOutreach) {
      if (!confirm("Stop tracking this sponsor? Visits already recorded stay in the visit log.")) return;
      try {
        const result = await client.from("outreach_contacts").delete().eq("id", deleteOutreach.dataset.deleteOutreach);
        if (result.error) throw result.error;
        analytics.outreach = analytics.outreach.filter((item) => item.id !== deleteOutreach.dataset.deleteOutreach);
        renderSponsors();
        toast("Sponsor removed from tracking.");
      } catch (error) {
        toast(error?.message || "Could not remove the sponsor.", true);
      }
      return;
    }
    const visitRow = event.target.closest(".visit-row");
    if (visitRow) {
      const id = visitRow.dataset.visit;
      if (expandedVisits.has(id)) expandedVisits.delete(id);
      else expandedVisits.add(id);
      renderVisits();
      return;
    }
    const editPerson = event.target.closest("[data-edit-person]");
    if (editPerson) { const row = state.people.find((person) => person.id === editPerson.dataset.editPerson); if (row) fillForm("#personForm", row); return; }
    const editUpdate = event.target.closest("[data-edit-update]");
    if (editUpdate) { const row = state.project_updates.find((item) => item.id === editUpdate.dataset.editUpdate); if (row) fillForm("#updateForm", row); return; }
    const editPartner = event.target.closest("[data-edit-partner]");
    if (editPartner) { const row = state.partners.find((partner) => partner.id === editPartner.dataset.editPartner); if (row) fillForm("#partnerForm", row); return; }
    const clearMedia = event.target.closest("[data-clear-media]");
    if (clearMedia) {
      const person = clearMedia.dataset.clearMedia === "person";
      const form = person ? $("#personForm") : $("#partnerForm");
      form.elements[person ? "image_url" : "logo_url"].value = "";
      form.elements[person ? "image_file" : "logo_file"].value = "";
      previewMedia(person ? $("#personPreview") : $("#partnerPreview"), "");
      return;
    }
    const remove = event.target.closest("[data-delete-table]");
    if (!remove) return;
    if (!confirm("Delete this item? This cannot be undone.")) return;
    try {
      await deleteRow(remove.dataset.deleteTable, remove.dataset.deleteId);
      renderAll();
      toast("Item deleted.");
    } catch (error) {
      toast(error?.message || "Could not delete item.", true);
    }
  });

  bindTabs();
  $("#analyticsRefresh").addEventListener("click", loadAnalytics);
  $("#analyticsRange").addEventListener("change", loadAnalytics);
  bindFilePreview("#personForm", "image_file", "#personPreview");
  bindFilePreview("#partnerForm", "logo_file", "#partnerPreview");
  resetForm("updateForm");
  resetForm("personForm");
  resetForm("partnerForm");
  resetForm("outreachForm");

  async function init() {
    state = loadLocal();
    if (!configured) {
      if (sessionStorage.getItem(localSessionKey) === "true") showPortal();
      else showLogin();
      return;
    }
    try {
      const session = await client.auth.getSession();
      if (session.data.session && await hasAdminAccess()) {
        remoteMode = true;
        await loadRemote();
        showPortal();
      } else {
        if (session.data.session) await client.auth.signOut();
        showLogin();
      }
    } catch (error) {
      console.warn("Could not restore the administrator session.", error);
      showLogin("Live admin access is unavailable. Check the Supabase setup.");
    }
  }

  init();
})();
