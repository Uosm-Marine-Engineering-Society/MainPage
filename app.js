(() => {
  const fallback = window.ARUS_CONTENT || {};
  const config = window.ARUS_SUPABASE || {};
  const storageKey = "arus-content-v2";
  const legacyStorageKey = "arus-content-v1";
  const siteKeys = ["projectName", "clubName", "navProposalLabel", "university", "proposalUrl", "contactEmail", "instagram", "linkedin", "footerText", "updatedAt"];
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
    const target = $("#updateList");
    const rows = sortedActive(updates).sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).slice(0, 3);
    target.innerHTML = rows.length ? rows.map((item) => {
      const link = item.link_url ? `<a href="${esc(item.link_url)}" target="_blank" rel="noreferrer">Read update <span aria-hidden="true">↗</span></a>` : "";
      return `<article class="update-item"><time datetime="${esc(item.published_at)}">${esc(formatDate(item.published_at))}</time><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p>${link}</article>`;
    }).join("") : `<p class="empty-state">Project updates will appear here.</p>`;
  }

  function personDepartment(person) {
    const value = String(person.department || "").toLowerCase();
    if (value.includes("electrical")) return "Electrical";
    if (value.includes("mechanical")) return "Mechanical";
    if (value.includes("leadership") || value.includes("operations") || value.includes("technical")) return "Leadership";
    return person.department || "Team";
  }

  function personCard(person, department) {
    const photo = person.image_url ? `<img src="${esc(person.image_url)}" alt="${esc(person.name)}">` : esc(initials(person.name));
    const bio = person.bio ? `<p class="person-bio">${esc(person.bio)}</p>` : "";
    const profile = person.profile_url ? `<a class="person-link" href="${esc(person.profile_url)}" target="_blank" rel="noreferrer">Profile <span aria-hidden="true">↗</span></a>` : "";
    return `<article class="person-card"><div class="person-photo">${photo}</div><div class="person-body"><span class="person-department">${esc(department)}</span><h3>${esc(person.name)}</h3><p class="person-role">${esc(person.role)}</p>${bio}${profile}</div></article>`;
  }

  function renderPeople(people) {
    const team = sortedActive(people.filter((person) => person.kind !== "advisor"));
    const advisors = sortedActive(people.filter((person) => person.kind === "advisor"));
    const groupOrder = ["Leadership", "Electrical", "Mechanical"];
    const groups = new Map();
    team.forEach((person) => {
      const department = personDepartment(person);
      if (!groups.has(department)) groups.set(department, []);
      groups.get(department).push(person);
    });
    const names = [...groupOrder.filter((name) => groups.has(name)), ...[...groups.keys()].filter((name) => !groupOrder.includes(name))];
    $("#teamList").innerHTML = names.length ? names.map((department) => `<section class="team-group"><h3>${esc(department)}</h3><div class="people-grid">${groups.get(department).map((person) => personCard(person, department)).join("")}</div></section>`).join("") : `<p class="empty-state">Team profiles will appear here.</p>`;
    $("#advisorWrap").hidden = !advisors.length;
    $("#advisorList").innerHTML = advisors.map((person) => `<article class="advisor-card"><h3>${esc(person.name)}</h3><p>${esc(person.role || "Academic Advisor")}</p></article>`).join("");
  }

  function renderPartners(partners) {
    const target = $("#partnerList");
    const rows = sortedActive(partners);
    target.innerHTML = rows.length ? rows.map((partner) => {
      const logo = partner.logo_url ? `<img src="${esc(partner.logo_url)}" alt="${esc(partner.name)} logo">` : esc(initials(partner.name));
      const name = partner.website_url ? `<a href="${esc(partner.website_url)}" target="_blank" rel="noreferrer">${esc(partner.name)}</a>` : esc(partner.name);
      return `<article class="partner-item"><div class="partner-logo">${logo}</div><div><span class="partner-tier">${esc(partner.tier || "Project partner")}</span><h3>${name}</h3><p>${esc(partner.description || "")}</p></div></article>`;
    }).join("") : `<p class="empty-state">Partner recognition will appear here as agreements are confirmed.</p>`;
  }

  function applySite(site) {
    $$("[data-site-text]").forEach((element) => {
      const key = element.dataset.siteText;
      if (site[key]) element.textContent = site[key];
    });
    $("#navProposalLabel").textContent = site.navProposalLabel || "View proposal";
    $("#footerText").textContent = site.footerText || "";
    document.title = `${site.projectName || "UoSM ARUS I"} | Electric competition boat`;
    const proposalUrl = site.proposalUrl || fallback.site?.proposalUrl;
    $$("[data-proposal-link]").forEach((link) => { link.href = proposalUrl; });

    const email = String(site.contactEmail || "").trim();
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    $$(".email-only").forEach((element) => { element.hidden = !hasEmail; });
    if (hasEmail) {
      const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("UoSM ARUS I enquiry")}`;
      $$("[data-email-link]").forEach((link) => { link.href = mailto; });
      $("#contactEmail").textContent = email;
    }

    $("#footerLinks").innerHTML = [
      site.instagram ? `<a href="${esc(site.instagram)}" target="_blank" rel="noreferrer">Instagram</a>` : "",
      site.linkedin ? `<a href="${esc(site.linkedin)}" target="_blank" rel="noreferrer">LinkedIn</a>` : ""
    ].join("");
  }

  function setupNavigation() {
    const header = $("#siteHeader");
    const nav = $("#siteNav");
    const toggle = $("#menuToggle");
    const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 8);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    nav.addEventListener("click", (event) => {
      if (!event.target.closest("a")) return;
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
    });
  }

  async function init() {
    const remote = await remoteContent();
    const saved = localContent();
    const content = remote || saved || clone(fallback);
    const site = siteSettings(content.site || {});
    applySite(site);
    renderUpdates(content.project_updates || fallback.project_updates || []);
    renderPeople(content.people || fallback.people || []);
    renderPartners(content.partners || fallback.partners || []);
    $("#year").textContent = new Date().getFullYear();
    setupNavigation();
  }

  init();
})();
