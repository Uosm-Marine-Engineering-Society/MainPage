(() => {
  const fallback = window.ARUS_CONTENT;
  const config = window.ARUS_SUPABASE || {};
  const storageKey = "arus-content-v1";
  const $ = (selector) => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join("").toUpperCase();
  const activeSorted = (rows = []) => rows.filter(row => row.active !== false).sort((a,b) => (a.display_order ?? 999) - (b.display_order ?? 999));
  const formatDate = (value) => {
    if (!value) return "Update";
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  };

  function localContent() {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.warn("Could not read local content", error);
      return null;
    }
  }

  async function remoteContent() {
    if (!config.url || !config.publishableKey || !window.supabase) return null;
    try {
      const client = window.supabase.createClient(config.url, config.publishableKey);
      const [members, advisors, partners, announcements, settings] = await Promise.all([
        client.from("members").select("*").order("display_order"),
        client.from("advisors").select("*").order("display_order"),
        client.from("partners").select("*").order("display_order"),
        client.from("announcements").select("*").order("published_at", { ascending: false }),
        client.from("site_settings").select("content").eq("id", "main").maybeSingle()
      ]);
      const errors = [members, advisors, partners, announcements, settings].map(x => x.error).filter(Boolean);
      if (errors.length) throw errors[0];
      return {
        site: settings.data?.content || fallback.site,
        members: members.data || [],
        advisors: advisors.data || fallback.advisors,
        partners: partners.data || [],
        announcements: announcements.data || []
      };
    } catch (error) {
      console.warn("Supabase content unavailable. Using bundled content.", error);
      return null;
    }
  }

  function renderMetrics(site) {
    $("#metricGrid").innerHTML = [
      [site.campaignTarget, "Campaign target"],
      [site.engineeringBudget, "Costed engineering scope"],
      [site.qualifier, "Asia-Pacific qualifier"],
      [site.final, "World final, after qualification"]
    ].map(([value,label]) => `<article class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></article>`).join("");
  }

  function renderTeam(members) {
    const rows = activeSorted(members);
    $("#teamGrid").innerHTML = rows.length ? rows.map(member => {
      const photo = member.image_url
        ? `<img src="${esc(member.image_url)}" alt="${esc(member.name)}" loading="lazy">`
        : `<span class="member-initials">${esc(initials(member.name))}</span>`;
      const link = member.linkedin_url ? `<a class="member-link" href="${esc(member.linkedin_url)}" target="_blank" rel="noreferrer">View profile</a>` : "";
      return `<article class="member-card reveal"><div class="member-photo">${photo}</div><div class="member-body"><div class="member-dept">${esc(member.department)}</div><h3>${esc(member.name)}</h3><div class="member-role">${esc(member.role)}</div><p class="member-bio">${esc(member.bio)}</p>${link}</div></article>`;
    }).join("") : `<div class="partner-empty">Team profiles will be published here.</div>`;
  }

  function renderAdvisors(advisors) {
    $("#advisorGrid").innerHTML = activeSorted(advisors).map(advisor => `<article class="advisor"><strong>${esc(advisor.name)}</strong><span>${esc(advisor.role)}</span></article>`).join("");
  }

  function renderPartners(partners) {
    const rows = activeSorted(partners);
    $("#partnerList").innerHTML = rows.length ? rows.map(partner => {
      const logo = partner.logo_url ? `<img src="${esc(partner.logo_url)}" alt="${esc(partner.name)} logo" loading="lazy">` : esc(initials(partner.name));
      const link = partner.website_url ? `<a href="${esc(partner.website_url)}" target="_blank" rel="noreferrer">Visit partner</a>` : "";
      return `<article class="partner-card reveal"><div class="partner-logo">${logo}</div><div><h3>${esc(partner.name)}</h3><span class="partner-tier">${esc(partner.tier)}</span><p>${esc(partner.description)}</p></div>${link}</article>`;
    }).join("") : `<div class="partner-empty">Partner announcements will appear here.</div>`;
  }

  function renderNews(announcements) {
    const rows = announcements.filter(row => row.active !== false).sort((a,b) => new Date(b.published_at) - new Date(a.published_at));
    $("#newsGrid").innerHTML = rows.length ? rows.map(item => {
      const link = item.link_url ? `<a href="${esc(item.link_url)}" target="_blank" rel="noreferrer">Read more</a>` : `<a href="#contact">Discuss this update</a>`;
      return `<article class="news-card reveal"><time datetime="${esc(item.published_at)}">${esc(formatDate(item.published_at))}</time><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p>${link}</article>`;
    }).join("") : `<div class="partner-empty">No announcements have been published yet.</div>`;
  }

  function setupInteractions(site) {
    const header = $("#siteHeader");
    const nav = $("#siteNav");
    const toggle = $("#menuToggle");
    const email = site.contactEmail || fallback.site.contactEmail;
    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("UoSM ARUS I enquiry")}`;
    $("#emailButton").href = mailto;
    $("#footerEmail").href = mailto;
    $("#footerEmail").textContent = email;
    $("#year").textContent = new Date().getFullYear();

    const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 20);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      document.body.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
      nav.classList.remove("open");
      document.body.classList.remove("menu-open");
      toggle.setAttribute("aria-expanded", "false");
    }));
  }

  function setupReveal() {
    const elements = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach(el => el.classList.add("visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .12 });
    elements.forEach(el => observer.observe(el));
  }

  async function init() {
    const remote = await remoteContent();
    const content = remote || localContent() || fallback;
    renderMetrics(content.site);
    renderTeam(content.members || []);
    renderAdvisors(content.advisors || []);
    renderPartners(content.partners || []);
    renderNews(content.announcements || []);
    setupInteractions(content.site);
    requestAnimationFrame(setupReveal);
  }

  init();
})();
