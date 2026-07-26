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

  function updateModeBadge() {
    const badge = $("#modeBadge");
    badge.innerHTML = remoteMode ? "Live publishing<span>Supabase database connected</span>" : "Local preview<span>Changes stay in this browser</span>";
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
    updateModeBadge();
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

  function analyticsDuration(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }

  function analyticsSource(event) {
    if (event.utm_source) return `${event.utm_source}${event.utm_medium ? ` · ${event.utm_medium}` : ""}`;
    if (!event.referrer) return "Direct / unknown";
    try { return new URL(event.referrer).hostname.replace(/^www\./, "") || "Direct / unknown"; }
    catch { return event.referrer; }
  }

  function analyticsEventName(type) {
    return ({
      session_start: "Visit started",
      page_view: "Page viewed",
      section_view: "Section viewed",
      link_click: "Link clicked",
      control_click: "Control used",
      proposal_open: "Proposal opened",
      email_copy: "Email copied",
      scroll_depth: "Scroll depth",
      engagement: "Engaged time"
    })[type] || type;
  }

  function analyticsCount(events, selector) {
    const counts = new Map();
    events.forEach((event) => {
      const label = selector(event);
      if (!label) return;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function renderAnalyticsList(target, rows) {
    $(target).innerHTML = rows.length
      ? rows.slice(0, 8).map(([label, count]) => `<div class="analytics-list-row"><span title="${esc(label)}">${esc(label)}</span><strong>${esc(count)}</strong></div>`).join("")
      : `<div class="empty">No data in this period.</div>`;
  }

  function renderAnalytics(events) {
    const sessions = new Set(events.map((event) => event.session_id).filter(Boolean));
    const engagement = events.filter((event) => event.event_type === "engagement").reduce((sum, event) => sum + (Number(event.value) || 0), 0);
    const clicks = events.filter((event) => event.event_type === "link_click").length;
    const proposals = events.filter((event) => event.event_type === "proposal_open").length;
    const copies = events.filter((event) => event.event_type === "email_copy").length;
    const deepScrolls = new Set(events.filter((event) => event.event_type === "scroll_depth" && Number(event.value) >= 75).map((event) => event.session_id)).size;

    $("#analyticsVisits").textContent = sessions.size.toLocaleString();
    $("#analyticsTime").textContent = analyticsDuration(sessions.size ? engagement / sessions.size : 0);
    $("#analyticsClicks").textContent = clicks.toLocaleString();
    $("#analyticsProposals").textContent = proposals.toLocaleString();
    $("#analyticsCopies").textContent = copies.toLocaleString();
    $("#analyticsScrolls").textContent = deepScrolls.toLocaleString();

    const starts = events.filter((event) => event.event_type === "session_start");
    renderAnalyticsList("#analyticsSources", analyticsCount(starts, analyticsSource));
    renderAnalyticsList("#analyticsDevices", analyticsCount(starts, (event) => `${event.device || "Unknown device"} · ${event.browser || "Unknown browser"}`));
    renderAnalyticsList("#analyticsSections", analyticsCount(events.filter((event) => event.event_type === "section_view"), (event) => event.label || event.section));
    renderAnalyticsList("#analyticsLinks", analyticsCount(events.filter((event) => event.event_type === "link_click"), (event) => event.label || event.target));
    renderAnalyticsList("#analyticsCampaigns", analyticsCount(starts, (event) => event.utm_campaign || ""));
    renderAnalyticsList("#analyticsContexts", analyticsCount(starts, (event) => `${event.timezone || "Unknown timezone"} · ${event.language || "Unknown language"}`));

    $("#analyticsRecent").innerHTML = events.slice(0, 60).map((event) => {
      const detail = event.event_type === "session_start"
        ? `${analyticsSource(event)} · ${event.device || "Unknown device"} · ${event.browser || "Unknown browser"} · ${event.timezone || "Unknown timezone"}`
        : event.label || event.target || event.path || "—";
      const value = event.event_type === "engagement" ? analyticsDuration(event.value) : event.event_type === "scroll_depth" ? `${event.value}%` : "—";
      const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.occurred_at));
      return `<tr><td>${esc(time)}</td><td>${esc(analyticsEventName(event.event_type))}</td><td>${esc(event.section || "—")}</td><td title="${esc(event.target || "")}">${esc(detail)}</td><td>${esc(value)}</td></tr>`;
    }).join("") || `<tr><td colspan="5">No activity in this period.</td></tr>`;

    $("#analyticsStats").hidden = false;
    $("#analyticsBreakdowns").hidden = false;
    $("#analyticsRecentWrap").hidden = false;
  }

  async function loadAnalytics() {
    const status = $("#analyticsStatus");
    status.classList.remove("is-error");
    if (!remoteMode) {
      status.textContent = "Analytics require the Supabase connection. Local preview activity is intentionally not tracked.";
      $("#analyticsStats").hidden = true;
      $("#analyticsBreakdowns").hidden = true;
      $("#analyticsRecentWrap").hidden = true;
      return;
    }

    const days = Number($("#analyticsRange").value) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    status.textContent = "Loading analytics…";
    try {
      const result = await client
        .from("analytics_events")
        .select("occurred_at,session_id,event_type,path,section,target,label,value,referrer,utm_source,utm_medium,utm_campaign,language,timezone,device,browser,platform,screen_size,viewport_size")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(10000);
      if (result.error) throw result.error;
      renderAnalytics(result.data || []);
      status.textContent = `Loaded ${(result.data || []).length.toLocaleString()} events from the last ${days} days${result.data?.length === 10000 ? " (display limit reached)" : ""}.`;
    } catch (error) {
      status.textContent = error?.message?.includes("analytics_events")
        ? "Analytics storage is not ready. Run the latest schema.sql in Supabase, then refresh."
        : `Could not load analytics: ${error?.message || "Unknown error"}`;
      status.classList.add("is-error");
      $("#analyticsStats").hidden = true;
      $("#analyticsBreakdowns").hidden = true;
      $("#analyticsRecentWrap").hidden = true;
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
    updateModeBadge();
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

  document.addEventListener("click", async (event) => {
    const reset = event.target.closest("[data-reset]");
    if (reset) { resetForm(reset.dataset.reset); return; }
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
