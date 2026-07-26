(() => {
  const fallback = window.ARUS_CONTENT || {};
  const config = window.ARUS_SUPABASE || {};
  const storageKey = "arus-content-v2";
  const legacyStorageKey = "arus-content-v1";
  const siteKeys = ["projectName", "clubName", "navProposalLabel", "university", "proposalUrl", "contactEmail", "instagram", "linkedin", "footerText", "animations", "analyticsEnabled", "updatedAt"];
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const formatDate = (value) => {
    const date = new Date(`${value || ""}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "Project update" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  };

  function siteSettings(saved = {}) {
    const next = { ...(fallback.site || {}) };
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

  function renderUpdates(updates) {
    const rows = sortedActive(updates).sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).slice(0, 3);
    $("#updateList").innerHTML = rows.length ? rows.map((item) => {
      const link = item.link_url ? `<a href="${esc(item.link_url)}" target="_blank" rel="noreferrer">Read update</a>` : "";
      return `<article class="update-item"><time datetime="${esc(item.published_at)}">${esc(formatDate(item.published_at))}</time><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p>${link}</article>`;
    }).join("") : `<p class="empty-state">Project updates will appear here.</p>`;
  }

  function personDepartment(person) {
    const value = String(person.department || "").toLowerCase();
    if (value.includes("electrical")) return "Electrical";
    if (value.includes("mechanical")) return "Mechanical";
    if (value.includes("leadership") || value.includes("operations") || value.includes("technical")) return "Executive Team";
    return person.department || "Team";
  }

  function personCard(person) {
    const photo = person.image_url ? `<img src="${esc(person.image_url)}" alt="${esc(person.name)}">` : esc(initials(person.name));
    const bio = person.bio ? `<p class="person-bio">${esc(person.bio)}</p>` : "";
    const profile = person.profile_url ? `<a class="person-link" href="${esc(person.profile_url)}" target="_blank" rel="noreferrer">Profile</a>` : "";
    return `<article class="person-card"><div class="person-photo">${photo}</div><div class="person-body"><h3>${esc(person.name)}</h3><p class="person-role">${esc(person.role)}</p>${bio}${profile}</div></article>`;
  }

  function renderPeople(people) {
    const team = sortedActive(people.filter((person) => person.kind !== "advisor"));
    const advisors = sortedActive(people.filter((person) => person.kind === "advisor"));
    const groupOrder = ["Executive Team", "Electrical", "Mechanical"];
    const groups = new Map();
    team.forEach((person) => {
      const department = personDepartment(person);
      if (!groups.has(department)) groups.set(department, []);
      groups.get(department).push(person);
    });
    const names = [...groupOrder.filter((name) => groups.has(name)), ...[...groups.keys()].filter((name) => !groupOrder.includes(name))];
    $("#teamList").innerHTML = names.length
      ? names.map((department) => `<section class="team-group"><h3>${esc(department)}</h3><div class="people-grid">${groups.get(department).map(personCard).join("")}</div></section>`).join("")
      : `<p class="empty-state">Team profiles will appear here.</p>`;
    $("#advisorWrap").hidden = !advisors.length;
    $("#advisorList").innerHTML = advisors.map((person) => `<article class="advisor-card"><h3>${esc(person.name)}</h3><p>${esc(person.role || "Academic Advisor")}</p></article>`).join("");
  }

  function renderPartners(partners) {
    const rows = sortedActive(partners);
    $("#partnerList").innerHTML = rows.length ? rows.map((partner) => {
      const logo = partner.logo_url ? `<img src="${esc(partner.logo_url)}" alt="${esc(partner.name)} logo">` : esc(initials(partner.name));
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

  function applySite(site) {
    $$("[data-site-text]").forEach((element) => {
      const key = element.dataset.siteText;
      if (site[key]) element.textContent = site[key];
    });
    $("#navProposalLabel").textContent = site.navProposalLabel || "View proposal";
    $("#footerText").textContent = site.footerText || "";
    document.title = `${site.clubName || "Marine Engineering Society"} | ${site.projectName || "UoSM ARUS I"}`;
    const proposalUrl = site.proposalUrl || fallback.site?.proposalUrl;
    $$("[data-proposal-link]").forEach((link) => { link.href = proposalUrl; });

    const configuredEmail = String(site.contactEmail || "").trim();
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail);
    const email = hasEmail ? configuredEmail : String(fallback.site?.contactEmail || "uosmmes@gmail.com");
    $$(".email-only").forEach((element) => { element.hidden = !hasEmail; });
    $("#contactFallback").hidden = hasEmail;
    setupEmailCopy(email);

    // content.js stores a date only; the admin writes a full ISO string. Slice to
    // the date part so formatDate's `${value}T00:00:00` never yields Invalid Date.
    const updated = String(site.updatedAt || "").slice(0, 10);
    $("#siteUpdated").textContent = /^\d{4}-\d{2}-\d{2}$/.test(updated) ? `Site content updated ${formatDate(updated)}` : "";

    $("#footerLinks").innerHTML = [
      site.instagram ? `<a href="${esc(site.instagram)}" target="_blank" rel="noreferrer">Instagram</a>` : "",
      site.linkedin ? `<a href="${esc(site.linkedin)}" target="_blank" rel="noreferrer">LinkedIn</a>` : ""
    ].join("");
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

  function setupMotion(enabled) {
    // The admin setting can only ever disable motion; the OS preference below is
    // checked independently so a site setting can never override it.
    if (enabled === false) {
      document.documentElement.classList.add("no-motion");
      return;
    }
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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
    window.ARUS_ANALYTICS?.init(site);
    renderUpdates(content.project_updates || fallback.project_updates || []);
    renderPeople(content.people || fallback.people || []);
    renderPartners(content.partners || fallback.partners || []);
    $("#year").textContent = new Date().getFullYear();

    setupNavigation();
    setupMotion(site.animations !== false);
  }

  init();
})();
