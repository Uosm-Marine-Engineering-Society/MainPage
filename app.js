(() => {
  const fallback = window.ARUS_CONTENT || {};
  const config = window.ARUS_SUPABASE || {};
  const storageKey = "arus-content-v2";
  const legacyStorageKey = "arus-content-v1";
  const consentKey = "arus-privacy-consent-v1";
  const consentMaxAge = 365 * 24 * 60 * 60 * 1000;
  const siteKeys = ["projectName", "clubName", "navProposalLabel", "university", "contactEmail", "instagram", "linkedin", "footerText", "sections", "updatesVisible", "animations", "analyticsEnabled", "privacyNoticeEnabled", "updatedAt"];
  const DEFAULT_SECTIONS = ["Executive Team", "Electrical", "Mechanical"];
  // Department values written before sections were configurable. Matched as
  // substrings, which is what the original grouping did, so nobody moves.
  const SECTION_ALIASES = [["electrical", "Electrical"], ["mechanical", "Mechanical"], ["leadership", "Executive Team"], ["operations", "Executive Team"], ["technical", "Executive Team"]];
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const instagramMark = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.6" cy="6.6" r="1" class="social-dot"/></svg>';
  const linkedinMark = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4"/><path d="M8 10.9v5.6"/><path d="M12.5 16.5v-5.6"/><path d="M12.5 13.5a2.35 2.35 0 0 1 4.7 0v3"/><circle cx="8" cy="7.9" r=".95" class="social-dot"/></svg>';

  // "https://www.instagram.com/uosm_mes/" -> "@uosm_mes". Anything that is not a
  // plain single-segment profile path falls back to the platform name.
  const socialHandle = (url) => {
    try {
      const segments = new URL(url).pathname.split("/").filter(Boolean);
      const name = segments.length === 1 ? segments[0] : "";
      return /^[A-Za-z0-9._]+$/.test(name) ? `@${name}` : "";
    } catch {
      return "";
    }
  };

  // The bundled value in content.js stands in while the field is blank in the
  // database, which is how the footer link has always behaved.
  function socialAccounts(site) {
    return [
      { url: site.instagram || fallback.site?.instagram || "", mark: instagramMark, name: "Instagram" },
      { url: site.linkedin || fallback.site?.linkedin || "", mark: linkedinMark, name: "LinkedIn" }
    ].filter((account) => account.url).map((account) => ({ ...account, label: socialHandle(account.url) || account.name }));
  }
  const formatDate = (value) => {
    const date = new Date(`${value || ""}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "Project update" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  };

  // Values left in the stored settings blob by an earlier version of a feature.
  // Treating them as unset lets the bundled default win, so a stale database row
  // does not have to be migrated by hand before a deploy is correct.
  // The nav label has now described two superseded actions: "View proposal" for
  // a PDF download that no longer exists, then "Request proposal" for a button
  // that had not yet become general contact. Each is listed so a database still
  // holding one falls through to the current default.
  const staleSettings = {
    contactEmail: ["replace-with-team-email@example.com"],
    navProposalLabel: ["View proposal", "Download proposal", "Request proposal"]
  };

  function siteSettings(saved = {}) {
    const next = { ...(fallback.site || {}) };
    siteKeys.forEach((key) => {
      if (saved[key] !== undefined && saved[key] !== null) {
        next[key] = (staleSettings[key] || []).includes(saved[key]) ? "" : saved[key];
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

  function localContent() {
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (current) return current;
      return migrateLegacy(JSON.parse(localStorage.getItem(legacyStorageKey) || "null"));
    } catch {
      return null;
    }
  }

  async function remoteContent() {
    if (!config.url || !config.publishableKey || !window.supabase) return null;
    try {
      const client = window.supabase.createClient(config.url, config.publishableKey);
      const [people, projectUpdates, partners, settings] = await Promise.all([
        client.from("people").select("*").order("display_order"),
        client.from("project_updates").select("*").order("published_at", { ascending: false }),
        client.from("partners").select("*").order("display_order"),
        client.from("site_settings").select("content").eq("id", "main").maybeSingle()
      ]);
      const error = [people, projectUpdates, partners, settings].map((response) => response.error).find(Boolean);
      if (error) throw error;
      return { site: settings.data?.content || {}, people: people.data || [], project_updates: projectUpdates.data || [], partners: partners.data || [] };
    } catch (error) {
      console.warn("Live project content unavailable; using bundled or browser content.", error);
      return null;
    }
  }

  function sortedActive(items = []) {
    return items.filter((item) => item.active !== false).sort((a, b) => (Number(a.display_order) || 999) - (Number(b.display_order) || 999));
  }

  // Manual order first, publication date second. Where display_order is absent
  // or still on its shared default every row ties, so the date decides and the
  // ordering is identical to before the column existed.
  function renderUpdates(updates, site) {
    const rows = (updates || [])
      .filter((item) => item.active !== false)
      .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0)
        || new Date(b.published_at) - new Date(a.published_at));

    const configured = Number(site?.updatesVisible);
    const visible = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 3;
    const toggle = $("#updateToggle");

    if (!rows.length) {
      $("#updateList").innerHTML = `<p class="empty-state">Project updates will appear here.</p>`;
      toggle.hidden = true;
      return;
    }

    // Everything is rendered; the overflow carries `hidden`, which keeps it out
    // of the tab order and away from screen readers until it is asked for.
    $("#updateList").innerHTML = rows.map((item, index) => {
      const link = item.link_url ? `<a href="${esc(item.link_url)}" target="_blank" rel="noreferrer">Read update</a>` : "";
      const category = item.category ? `<span class="update-tag">${esc(item.category)}</span>` : "";
      const extra = index >= visible;
      return `<article class="update-item"${extra ? ` data-update-extra hidden` : ""}>
        <p class="update-meta"><time datetime="${esc(item.published_at)}">${esc(formatDate(item.published_at))}</time>${category}</p>
        <h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p>${link}</article>`;
    }).join("");

    const hiddenCount = Math.max(0, rows.length - visible);
    toggle.hidden = hiddenCount === 0;
    if (hiddenCount) {
      toggle.dataset.count = String(rows.length);
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = `Show all ${rows.length} updates`;
    }
  }

  function setupUpdateToggle() {
    const toggle = $("#updateToggle");
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      $$("[data-update-extra]").forEach((item) => { item.hidden = open; });
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.textContent = open ? `Show all ${toggle.dataset.count} updates` : "Show fewer";
      // Collapsing from far down the list would otherwise leave the reader
      // stranded below the section that just shrank.
      if (open) $("#updates").scrollIntoView({ behavior: motionAllowed(true) ? "smooth" : "auto", block: "start" });
    });
  }

  const siteSections = (site) => {
    const configured = Array.isArray(site?.sections) ? site.sections.map((name) => String(name).trim()).filter(Boolean) : [];
    return configured.length ? configured : DEFAULT_SECTIONS;
  };

  // An exact match against a configured section wins; otherwise the legacy
  // aliases apply; otherwise the department stands on its own so a person is
  // never dropped just because their section was renamed or removed.
  function personDepartment(person, sections) {
    const raw = String(person.department || "").trim();
    if (!raw) return sections[0] || "Team";
    const exact = sections.find((name) => name.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const lower = raw.toLowerCase();
    const alias = SECTION_ALIASES.find(([needle]) => lower.includes(needle));
    return alias ? alias[1] : raw;
  }

  function personCard(person) {
    const photo = person.image_url ? `<img src="${esc(person.image_url)}" alt="${esc(person.name)}">` : esc(initials(person.name));
    const bio = person.bio ? `<p class="person-bio">${esc(person.bio)}</p>` : "";
    const profile = person.profile_url ? `<a class="person-link" href="${esc(person.profile_url)}" target="_blank" rel="noreferrer">Profile</a>` : "";
    return `<article class="person-card"><div class="person-photo">${photo}</div><div class="person-body"><h3>${esc(person.name)}</h3><p class="person-role">${esc(person.role)}</p>${bio}${profile}</div></article>`;
  }

  function renderPeople(people, site) {
    const sections = siteSections(site);
    const team = sortedActive(people.filter((person) => person.kind !== "advisor"));
    const advisors = sortedActive(people.filter((person) => person.kind === "advisor"));
    const groups = new Map();
    team.forEach((person) => {
      const department = personDepartment(person, sections);
      if (!groups.has(department)) groups.set(department, []);
      groups.get(department).push(person);
    });
    const names = [...sections.filter((name) => groups.has(name)), ...[...groups.keys()].filter((name) => !sections.includes(name))];
    $("#teamList").innerHTML = names.length
      ? names.map((department) => `<section class="team-group"><h3>${esc(department)}</h3><div class="people-grid">${groups.get(department).map(personCard).join("")}</div></section>`).join("")
      : `<p class="empty-state">Team profiles will appear here.</p>`;
    $("#advisorWrap").hidden = !advisors.length;
    $("#advisorList").innerHTML = advisors.map((person) => {
      const name = person.profile_url
        ? `<a class="advisor-name" href="${esc(person.profile_url)}" target="_blank" rel="noreferrer">${esc(person.name)}</a>`
        : esc(person.name);
      return `<article class="advisor-card"><h3>${name}</h3><p>${esc(person.role || "Academic Advisor")}</p></article>`;
    }).join("");
  }

  function partnerLogoUrl(partner) {
    const logoUrl = String(partner.logo_url || "").trim();
    if (logoUrl) return logoUrl;
    return String(partner.name || "").trim().toLowerCase() === "hydrocomp" ? "assets/hydrocomp-logo.png" : "";
  }

  function renderPartners(partners) {
    const rows = sortedActive(partners);
    $("#partnerList").innerHTML = rows.length ? rows.map((partner) => {
      const logoUrl = partnerLogoUrl(partner);
      const logo = logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(partner.name)} logo">` : esc(initials(partner.name));
      const name = partner.website_url ? `<a href="${esc(partner.website_url)}" target="_blank" rel="noreferrer">${esc(partner.name)}</a>` : esc(partner.name);
      return `<article class="partner-item"><div class="partner-logo">${logo}</div><div><span class="partner-tier">${esc(partner.tier || "Project partner")}</span><h3>${name}</h3><p>${esc(partner.description || "")}</p></div></article>`;
    }).join("") : `<p class="empty-state">Partner recognition will appear here as agreements are confirmed.</p>`;
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Fall through to the legacy clipboard path when access is denied.
      }
    }

    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch { copied = false; }
    input.remove();
    return copied;
  }

  function setupEmailCopy(email) {
    $$('[data-email-copy]').forEach((button) => {
      button.textContent = email;
      button.addEventListener("click", async () => {
        const copied = await copyText(email);
        button.classList.toggle("is-copied", copied);
        button.setAttribute("aria-label", copied ? "Email address copied" : "Copy email address");
        if (copied) document.dispatchEvent(new CustomEvent("arus:email-copied", { detail: { email, element: button } }));
        clearTimeout(button.copyTimer);
        if (copied) {
          button.copyTimer = setTimeout(() => {
            button.classList.remove("is-copied");
            button.setAttribute("aria-label", "Copy email address");
          }, 1800);
        }
      });
    });
  }

  // "your name and a message" rather than "your name, a message".
  const listify = (items) => items.length < 2 ? (items[0] || "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

  // Opens the enquiry dialog from any [data-proposal-request] trigger and posts
  // it to the send-enquiry edge function. Every trigger keeps its mailto: href
  // and this only preventDefault()s once the dialog is known to work, so a
  // browser without <dialog> falls through to the mail app as before.
  function setupEnquiry(email) {
    const dialog = $("#enquiryDialog");
    const form = $("#enquiryForm");
    if (!dialog || !form || typeof dialog.showModal !== "function") return;

    const status = $("#enquiryStatus");
    const submit = $("#enquirySubmit");
    const endpoint = `${String(config.url || "").replace(/\/+$/, "")}/functions/v1/send-enquiry`;
    let opener = null;

    const setStatus = (text, tone = "") => {
      status.textContent = text;
      status.classList.toggle("is-error", tone === "error");
      status.classList.toggle("is-ok", tone === "ok");
    };
    // Focus has to land back on the control that opened the dialog, or a
    // keyboard visitor is dropped at the top of the document. Done here rather
    // than only from the close event: Escape closes natively without passing
    // through close(), so both routes call this and whichever runs first wins —
    // clearing `opener` makes the second a no-op.
    const restoreFocus = () => { opener?.focus(); opener = null; };
    const close = () => {
      if (dialog.open) dialog.close();
      restoreFocus();
    };
    const bindClosers = (root) => $$("[data-enquiry-close]", root).forEach((button) => button.addEventListener("click", close));

    $$("[data-proposal-request]").forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        // Let a modified click through: someone deliberately opening the mailto
        // in a new tab should still get it.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        opener = trigger;
        setStatus("");
        dialog.showModal();
        form.elements.name?.focus();
      });
    });

    bindClosers(document);
    // A click on the ::backdrop reports the dialog itself as its target. The
    // panel has no padding of its own — the form fills it — so nothing inside
    // can be mistaken for the backdrop.
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener("close", restoreFocus);

    const value = (name) => String(form.elements[name]?.value || "").trim();

    // Flags fields only on a failed submit. Validating while someone is still
    // typing their email marks it wrong for every character before the "@".
    const validate = () => {
      const problems = [];
      const check = (field, ok, label) => {
        field?.setAttribute("aria-invalid", ok ? "false" : "true");
        if (!ok) problems.push(label);
      };
      check(form.elements.name, value("name").length > 1, "your name");
      check(form.elements.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("email")), "a valid email address");
      check(form.elements.message, value("message").length > 9, "a message");
      return problems;
    };

    const showSent = (to) => {
      form.innerHTML = `<div class="enquiry-done">
        <p class="brief-title">Sent</p>
        <h2>Thanks — we have your request.</h2>
        <p>We will reply to <strong>${esc(to)}</strong>, usually within a day.</p>
        <button class="button button-primary" type="button" data-enquiry-close>Close</button>
      </div>`;
      bindClosers(form);
      form.querySelector("[data-enquiry-close]")?.focus();
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const problems = validate();
      if (problems.length) {
        setStatus(`Please add ${listify(problems)}.`, "error");
        form.querySelector('[aria-invalid="true"]')?.focus();
        return;
      }
      if (!config.url || !config.publishableKey) {
        setStatus(`This form is not connected yet — please email ${email} instead.`, "error");
        return;
      }

      const label = submit.textContent;
      submit.disabled = true;
      submit.textContent = "Sending…";
      setStatus("");
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: config.publishableKey,
            Authorization: `Bearer ${config.publishableKey}`
          },
          body: JSON.stringify({
            name: value("name"),
            email: value("email"),
            organisation: value("organisation"),
            subject: value("subject"),
            message: value("message"),
            // Left for the function to judge. Keeping the decision server-side
            // means a bot cannot learn what tripped it from the response.
            website: value("website"),
            source_path: `${location.pathname}${location.hash}`
          })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.ok !== true) throw new Error(body.error || `HTTP ${response.status}`);
        showSent(value("email"));
      } catch {
        submit.disabled = false;
        submit.textContent = label;
        setStatus(`Sorry — that did not send. Please email ${email} instead.`, "error");
      }
    });
  }

  function applySite(site) {
    $$("[data-site-text]").forEach((element) => {
      const key = element.dataset.siteText;
      if (site[key]) element.textContent = site[key];
    });
    $("#navProposalLabel").textContent = site.navProposalLabel || "Contact Us";
    $("#footerText").textContent = site.footerText || "";
    document.title = `${site.clubName || "Marine Engineering Society"} | ${site.projectName || "UoSM ARUS I"}`;

    const configuredEmail = String(site.contactEmail || "").trim();
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail);
    const email = hasEmail ? configuredEmail : String(fallback.site?.contactEmail || "uosmmes@gmail.com");
    $$(".email-only").forEach((element) => { element.hidden = !hasEmail; });
    $("#contactFallback").hidden = hasEmail;
    $("#contactFallbackBottom").hidden = hasEmail;
    setupEmailCopy(email);

    // Each proposal CTA opens the enquiry dialog. The mailto stays on the href
    // as the fallback for a browser without <dialog> or a failed script, so it
    // still points at the configured contact address.
    const subject = encodeURIComponent(`${site.projectName || "UoSM ARUS I"} sponsorship proposal`);
    $$("[data-proposal-request]").forEach((link) => { link.href = `mailto:${email}?subject=${subject}`; });
    setupEnquiry(email);

    // content.js stores a date only; the admin writes a full ISO string. Slice to
    // the date part so formatDate's `${value}T00:00:00` never yields Invalid Date.
    const updated = String(site.updatedAt || "").slice(0, 10);
    $("#siteUpdated").textContent = /^\d{4}-\d{2}-\d{2}$/.test(updated) ? `Site content updated ${formatDate(updated)}` : "";

    const accounts = socialAccounts(site);

    // Beside the "Latest" heading: named, since there is room for the handle.
    const social = $("#updateSocial");
    social.hidden = !accounts.length;
    social.innerHTML = accounts.map((account) =>
      `<a class="social-link" href="${esc(account.url)}" target="_blank" rel="noreferrer">${account.mark}<span>${esc(account.label)}</span></a>`).join("");

    // In the footer: marks only, with the name carried for assistive tech.
    $("#footerLinks").innerHTML = accounts.map((account) =>
      `<a class="footer-social" href="${esc(account.url)}" target="_blank" rel="noreferrer" aria-label="${esc(account.name)}" title="${esc(account.name)}">${account.mark}<span class="visually-hidden">${esc(account.name)}</span></a>`).join("");
  }

  function setupNavigation() {
    const header = $("#siteHeader");
    const nav = $("#siteNav");
    const toggle = $("#menuToggle");

    const closeMenu = () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
    };

    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    nav.addEventListener("click", (event) => { if (event.target.closest("a")) closeMenu(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });

    // Highlight the section currently under the header.
    const links = $$(".nav-links a");
    const sections = links.map((link) => $(link.getAttribute("href"))).filter(Boolean);
    let queued = false;

    const update = () => {
      queued = false;
      header.classList.toggle("scrolled", window.scrollY > 8);

      const line = window.scrollY + header.offsetHeight + 24;
      let current = -1;
      sections.forEach((section, index) => { if (section.offsetTop <= line) current = index; });
      // Snap to the last section once the page bottom is reached.
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 2) current = sections.length - 1;
      links.forEach((link, index) => link.classList.toggle("active", index === current));
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }

  // The cost table ships expanded so it is complete without JS and when printed;
  // this collapses it on load and wires the department toggles.
  function setupCostTable() {
    $$(".row-toggle").forEach((button) => {
      const panel = document.getElementById(button.getAttribute("aria-controls"));
      if (!panel) return;
      const set = (open) => {
        button.setAttribute("aria-expanded", String(open));
        panel.hidden = !open;
      };
      set(false);
      button.addEventListener("click", () => set(button.getAttribute("aria-expanded") !== "true"));
    });
  }

  // Positions the schedule bars along the programme span and wires the
  // list/timeline toggle. The toggle is hidden in markup and revealed here, so
  // without JS the page keeps a plain readable list.
  function setupSchedule() {
    const root = $("#schedule");
    const toggle = $("#scheduleToggle");
    if (!root || !toggle) return;

    const t0 = Date.parse(root.dataset.start);
    const span = Date.parse(root.dataset.end) - t0;
    if (!Number.isFinite(span) || span <= 0) return;
    const at = (value) => (Date.parse(value) - t0) / span;

    [...root.querySelectorAll(".sched-bar")].forEach((bar, index) => {
      bar.style.setProperty("--s", at(bar.dataset.start).toFixed(4));
      bar.style.setProperty("--e", at(bar.dataset.end).toFixed(4));
      bar.style.setProperty("--i", index);
    });

    // Quarter and year gridlines, drawn as stacked gradient layers so every row
    // shares one background and stays aligned.
    const firstYear = new Date(t0).getUTCFullYear();
    const lastYear = new Date(t0 + span).getUTCFullYear();
    const layers = [];
    const rule = (fraction, colour, width) => {
      const pct = (fraction * 100).toFixed(3);
      return `linear-gradient(90deg, transparent calc(${pct}% - ${width}px), ${colour} calc(${pct}% - ${width}px), ${colour} calc(${pct}% + ${width}px), transparent calc(${pct}% + ${width}px))`;
    };

    for (let year = firstYear; year <= lastYear; year += 1) {
      for (let month = 0; month < 12; month += 3) {
        const fraction = at(`${year}-${String(month + 1).padStart(2, "0")}-01`);
        if (fraction <= 0.002 || fraction >= 0.998) continue;
        layers.push(rule(fraction, month === 0 ? "rgba(9,60,80,.18)" : "rgba(9,60,80,.07)", 0.5));
      }
    }

    const now = (Date.now() - t0) / span;
    if (now > 0 && now < 1) layers.push(rule(now, "rgba(7,133,154,.5)", 1));
    root.style.setProperty("--sched-grid", layers.join(","));

    const axis = $("#schedAxis");
    if (axis) {
      const labels = [];
      for (let year = firstYear; year <= lastYear; year += 1) {
        const fraction = Math.max(0, at(`${year}-01-01`));
        if (fraction < 0.97) labels.push(`<span class="sched-axis-label" style="--p:${fraction.toFixed(4)}">${year}</span>`);
      }
      axis.innerHTML = labels.join("");
    }

    const extras = [...root.querySelectorAll("[data-extra]")];
    const buttons = [...toggle.querySelectorAll("[data-view-btn]")];
    const setView = (view) => {
      root.dataset.view = view;
      buttons.forEach((button) => {
        const on = button.dataset.viewBtn === view;
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-pressed", String(on));
      });
      // Rows collapsed to zero height are still read out otherwise.
      extras.forEach((row) => { row.setAttribute("aria-hidden", String(view !== "chart")); });
    };

    buttons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewBtn)));
    setView("list");
    toggle.hidden = false;
  }

  // The admin setting can only ever disable motion; the OS preference is
  // checked independently so a site setting can never override it.
  const motionAllowed = (enabled) => enabled !== false && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The hero video is deliberately opted into with JS. That leaves its poster
  // in place for no-JS, reduced-motion and phone-sized views, and prevents a
  // multi-megabyte background from being fetched when it will not be shown.
  function setupHeroVideo(enabled) {
    const video = $("#heroVideo");
    if (!video) return;

    const desktop = window.matchMedia("(min-width: 761px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const shouldPlay = enabled !== false
        && desktop.matches
        && !reducedMotion.matches
        && document.visibilityState !== "hidden";

      if (!shouldPlay) {
        video.pause();
        return;
      }

      if (video.preload === "none") {
        video.preload = "auto";
        video.load();
      }
      video.playbackRate = .82;
      video.play().catch(() => {
        // A still poster is the intentional fallback when autoplay is blocked.
      });
    };

    sync();
    desktop.addEventListener?.("change", sync);
    reducedMotion.addEventListener?.("change", sync);
    document.addEventListener("visibilitychange", sync);
  }

  // Each photographic backdrop is laid out taller than the band it fills and drifts
  // within that overhang as the band crosses the viewport. The travel is a few
  // percent of the image height — enough to read as depth behind the type,
  // short of anything you would catch yourself watching. This writes the
  // `translate` property rather than `transform`, which the water-drift
  // keyframes own; the two compose instead of overwriting each other.
  function setupParallax() {
    const layers = $$(".section-media [data-parallax]");
    if (!layers.length) return;
    document.documentElement.classList.add("parallax");
    let queued = false;

    const update = () => {
      queued = false;
      const viewport = window.innerHeight;
      layers.forEach((layer) => {
        const band = layer.parentElement.getBoundingClientRect();
        if (band.bottom < 0 || band.top > viewport) return;
        // -1 while the band is still below the fold, 0 as its centre passes the
        // centre of the screen, +1 once it has left over the top.
        const progress = 1 - (2 * band.bottom) / (viewport + band.height);
        const shift = Math.max(-1, Math.min(1, progress)) * Number(layer.dataset.parallax);
        layer.style.translate = `0 ${shift.toFixed(2)}%`;
      });
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }

  // Consent is stored with the date it was given so it can go stale rather than
  // stand forever: after a year the visitor is asked again instead of being held
  // to one old click.
  function storedConsent() {
    try {
      const saved = JSON.parse(localStorage.getItem(consentKey) || "null");
      if (saved?.choice !== "granted" && saved?.choice !== "denied") return null;
      return Date.now() - Number(saved.at) > consentMaxAge ? null : saved.choice;
    } catch {
      return null;
    }
  }

  // The analytics keep a first-party id and have a third party resolve the
  // visitor's IP to a rough location. Neither is strictly necessary to serve the
  // page, so under GDPR both need consent up front — analytics.js is not started
  // anywhere else, and declining also wipes anything an earlier visit left.
  function setupPrivacy(site) {
    const notice = $("#privacyNotice");
    const reopen = $("#privacyReopen");
    if (!notice) return;

    // Off from the admin: skip straight to analytics, same as before this notice
    // existed. The notice and the footer reopen link stay out of view — both
    // start `hidden` in index.html and nothing here reveals them. Compared
    // against true so an absent setting means off, matching how the site
    // behaved before the toggle existed.
    if (site.privacyNoticeEnabled !== true) {
      window.ARUS_ANALYTICS?.init(site);
      return;
    }

    // Nothing to ask about: the admin has analytics off, or the visitor has
    // already answered in their browser via Global Privacy Control.
    if (site.analyticsEnabled === false || navigator.globalPrivacyControl === true) {
      notice.remove();
      return;
    }

    const show = (focus) => {
      notice.hidden = false;
      requestAnimationFrame(() => notice.classList.add("is-in"));
      if (focus) notice.querySelector("[data-privacy-accept]").focus();
    };

    const decide = (choice) => {
      try { localStorage.setItem(consentKey, JSON.stringify({ choice, at: Date.now() })); } catch { /* private mode */ }
      notice.classList.remove("is-in");
      notice.hidden = true;
      if (choice === "granted") window.ARUS_ANALYTICS?.init(site);
      else window.ARUS_ANALYTICS?.forget();
      if (reopen) reopen.hidden = false;
    };

    notice.querySelector("[data-privacy-accept]").addEventListener("click", () => decide("granted"));
    notice.querySelector("[data-privacy-decline]").addEventListener("click", () => decide("denied"));

    // Withdrawing has to be as easy as agreeing, so the choice stays reachable
    // from the footer for the whole visit.
    const choice = storedConsent();
    if (reopen) {
      reopen.hidden = !choice;
      reopen.addEventListener("click", () => show(true));
    }

    if (choice === "granted") window.ARUS_ANALYTICS?.init(site);
    else if (!choice) show(false);
  }

  function setupMotion(enabled) {
    if (enabled === false) {
      document.documentElement.classList.add("no-motion");
      return;
    }
    if (!("IntersectionObserver" in window)) return;
    if (!motionAllowed(enabled)) return;

    const items = $$(".reveal");
    if (!items.length) return;
    document.documentElement.classList.add("motion");

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -60px 0px" });

    // Wait a frame so the opacity transition actually plays, then reveal
    // anything already on screen outright and observe the rest. Showing
    // in-view items immediately keeps tall viewports and print/screenshot
    // renderers from capturing the page with content still hidden.
    requestAnimationFrame(() => {
      items.forEach((element) => {
        if (element.getBoundingClientRect().top < window.innerHeight) {
          element.classList.add("in");
        } else {
          observer.observe(element);
        }
      });
    });
  }

  async function init() {
    // Runs before the await so the table never flashes fully expanded while
    // remote content is in flight.
    setupCostTable();
    setupSchedule();

    const remote = await remoteContent();
    const saved = localContent();
    const content = remote || saved || clone(fallback);
    const site = siteSettings(content.site || {});

    applySite(site);
    setupPrivacy(site);
    renderUpdates(content.project_updates || fallback.project_updates || [], site);
    renderPeople(content.people || fallback.people || [], site);
    renderPartners(content.partners || fallback.partners || []);
    $("#year").textContent = new Date().getFullYear();

    setupNavigation();
    setupUpdateToggle();
    setupMotion(site.animations !== false);
    setupHeroVideo(site.animations !== false);
    if (motionAllowed(site.animations !== false)) setupParallax();
  }

  init();
})();
