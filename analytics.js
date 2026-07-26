(() => {
  const config = window.ARUS_SUPABASE || {};
  const sessionKey = "arus-analytics-session-v1";
  const visitorKey = "arus-visitor-v1";
  const sponsorKey = "arus-sponsor-v1";
  const geoKey = "arus-geo-v1";
  const geoMaxAge = 6 * 60 * 60 * 1000;
  const sponsorMaxAge = 90 * 24 * 60 * 60 * 1000;
  const allowedEvents = new Set([
    "session_start",
    "page_view",
    "section_view",
    "link_click",
    "control_click",
    "proposal_open",
    "email_copy",
    "scroll_depth",
    "engagement"
  ]);

  let visit = null;
  let queue = [];
  let flushTimer = null;
  let heartbeatTimer = null;
  let lastHeartbeat = Date.now();
  let stopped = false;
  let initialized = false;

  const clean = (value, limit = 300) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  const path = () => clean(`${location.pathname}${location.hash}`, 300) || "/";
  const sectionFor = (element) => element?.closest?.("section[id]")?.id || "";
  const numeric = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

  function randomId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");

  function readStore(store, key) {
    try { return store.getItem(key); } catch { return null; }
  }

  function writeStore(store, key, value) {
    try { store.setItem(key, value); } catch { /* private mode */ }
  }

  function currentSession() {
    const saved = readStore(sessionStorage, sessionKey);
    if (isUuid(saved)) return saved;
    const next = randomId();
    writeStore(sessionStorage, sessionKey, next);
    return next;
  }

  // A first-party identifier so returning visits can be recognised. It never
  // leaves this site and carries no personal detail.
  function currentVisitor() {
    let record = null;
    try { record = JSON.parse(readStore(localStorage, visitorKey) || "null"); } catch { record = null; }
    const known = record && isUuid(record.id);
    const next = {
      id: known ? record.id : randomId(),
      visits: known ? Math.min(9999, (Number(record.visits) || 1) + 1) : 1,
      firstSeen: known ? record.firstSeen : new Date().toISOString()
    };
    writeStore(localStorage, visitorKey, JSON.stringify(next));
    return { id: next.id, visitNumber: next.visits, returning: known === true };
  }

  // Tagged outreach links (?s=code) attribute a visit to one emailed sponsor. The
  // code is remembered so a later direct visit from the same person still counts.
  function sponsorCode(query) {
    const valid = (value) => (/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "");
    const fromLink = valid(query.get("s")) || valid(query.get("sponsor")) || valid(query.get("ref"));
    if (fromLink) {
      writeStore(localStorage, sponsorKey, JSON.stringify({ code: fromLink, at: Date.now() }));
      return fromLink;
    }
    try {
      const saved = JSON.parse(readStore(localStorage, sponsorKey) || "null");
      if (saved && Date.now() - Number(saved.at) < sponsorMaxAge) return valid(saved.code);
    } catch { /* ignore */ }
    return "";
  }

  function browserDetail() {
    const agent = navigator.userAgent;
    const match = (pattern) => agent.match(pattern)?.[1] || "";
    if (/Edg\//.test(agent)) return { name: "Edge", version: match(/Edg\/([\d.]+)/) };
    if (/OPR\/|Opera/.test(agent)) return { name: "Opera", version: match(/OPR\/([\d.]+)/) };
    if (/SamsungBrowser\//.test(agent)) return { name: "Samsung Internet", version: match(/SamsungBrowser\/([\d.]+)/) };
    if (/Firefox\//.test(agent)) return { name: "Firefox", version: match(/Firefox\/([\d.]+)/) };
    if (/CriOS\//.test(agent)) return { name: "Chrome", version: match(/CriOS\/([\d.]+)/) };
    if (/Chrome\//.test(agent)) return { name: "Chrome", version: match(/Chrome\/([\d.]+)/) };
    if (/Safari\//.test(agent)) return { name: "Safari", version: match(/Version\/([\d.]+)/) };
    return { name: "Other", version: "" };
  }

  function osDetail() {
    const agent = navigator.userAgent;
    const match = (pattern) => (agent.match(pattern)?.[1] || "").replace(/_/g, ".");
    if (/Windows NT/.test(agent)) {
      const build = match(/Windows NT ([\d.]+)/);
      return { name: "Windows", version: ({ "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" })[build] || build };
    }
    if (/iPhone|iPad|iPod/.test(agent)) return { name: "iOS", version: match(/OS ([\d_]+)/) };
    if (/Android/.test(agent)) return { name: "Android", version: match(/Android ([\d.]+)/) };
    if (/Mac OS X/.test(agent)) return { name: "macOS", version: match(/Mac OS X ([\d_.]+)/) };
    if (/CrOS/.test(agent)) return { name: "ChromeOS", version: "" };
    if (/Linux/.test(agent)) return { name: "Linux", version: "" };
    return { name: "Other", version: "" };
  }

  function deviceClass() {
    if (/iPad|Tablet/.test(navigator.userAgent)) return "Tablet";
    if (/Mobi|iPhone|Android.*Mobile/.test(navigator.userAgent)) return "Mobile";
    const width = Math.max(screen.width || 0, window.innerWidth || 0);
    if (width < 640) return "Mobile";
    if (width < 1024) return "Tablet";
    return "Desktop";
  }

  // Mailbox security scanners follow every link in an email before the recipient
  // ever sees it. Flagging them keeps those hits out of the real-visitor counts.
  function looksAutomated() {
    const agent = navigator.userAgent || "";
    if (navigator.webdriver === true) return true;
    if (!agent) return true;
    return /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|scrapy|curl|wget|preview|scanner|monitor|pingdom|lighthouse|gtmetrix|facebookexternalhit|whatsapp|telegram|skype|slackbot|discord|bingpreview|proofpoint|barracuda|mimecast|safelinks/i.test(agent);
  }

  function safeReferrer() {
    if (!document.referrer) return { full: "", host: "" };
    try {
      const url = new URL(document.referrer);
      if (url.host === location.host) return { full: "", host: "" };
      return { full: clean(`${url.origin}${url.pathname}`, 500), host: clean(url.host.replace(/^www\./, ""), 160) };
    } catch {
      return { full: "", host: "" };
    }
  }

  function buildVisit() {
    const query = new URLSearchParams(location.search);
    const visitor = currentVisitor();
    const referrer = safeReferrer();
    const browser = browserDetail();
    const os = osDetail();
    const connection = navigator.connection || {};
    const navigation = performance.getEntriesByType?.("navigation")?.[0];
    const media = (rule) => (window.matchMedia ? window.matchMedia(rule).matches : null);

    return {
      session_id: currentSession(),
      visitor_id: visitor.id,
      visit_number: visitor.visitNumber,
      is_returning: visitor.returning,
      sponsor_code: sponsorCode(query),
      entry_path: path(),
      landing_query: clean(location.search.replace(/^\?/, ""), 500),
      referrer: referrer.full,
      referrer_host: referrer.host,
      utm_source: clean(query.get("utm_source"), 100),
      utm_medium: clean(query.get("utm_medium"), 100),
      utm_campaign: clean(query.get("utm_campaign"), 150),
      utm_content: clean(query.get("utm_content"), 150),
      utm_term: clean(query.get("utm_term"), 150),
      timezone: clean(Intl.DateTimeFormat().resolvedOptions().timeZone, 80),
      language: clean(navigator.language, 40),
      languages: clean((navigator.languages || []).join(", "), 160),
      device: deviceClass(),
      browser: browser.name,
      browser_version: clean(browser.version, 20),
      os: os.name,
      os_version: clean(os.version, 20),
      platform: clean(navigator.userAgentData?.platform || navigator.platform, 80),
      screen_size: `${screen.width || 0}×${screen.height || 0}`,
      viewport_size: `${window.innerWidth || 0}×${window.innerHeight || 0}`,
      pixel_ratio: numeric(window.devicePixelRatio),
      color_depth: numeric(screen.colorDepth),
      touch_points: numeric(navigator.maxTouchPoints),
      cpu_cores: numeric(navigator.hardwareConcurrency),
      device_memory: numeric(navigator.deviceMemory),
      connection: clean([connection.effectiveType, connection.downlink ? `${connection.downlink}Mbps` : ""].filter(Boolean).join(" · "), 60),
      prefers_dark: media("(prefers-color-scheme: dark)"),
      prefers_reduced_motion: media("(prefers-reduced-motion: reduce)"),
      user_agent: clean(navigator.userAgent, 400),
      is_bot: looksAutomated(),
      load_ms: navigation ? Math.max(0, Math.round(navigation.duration)) : null,
      country: "",
      country_code: "",
      region: "",
      city: "",
      postal: "",
      latitude: null,
      longitude: null,
      org: "",
      isp: "",
      asn: "",
      geo_source: ""
    };
  }

  async function fetchJson(url, timeout = 4500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, mode: "cors", credentials: "omit", cache: "no-store" });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Approximate location, network operator and organisation come from a public IP
  // lookup. The organisation name is what identifies a visit from a company network.
  async function lookupGeo() {
    try {
      const cached = JSON.parse(readStore(localStorage, geoKey) || "null");
      if (cached && Date.now() - Number(cached.at) < geoMaxAge && cached.geo?.country_code) return cached.geo;
    } catch { /* ignore */ }

    let geo = null;
    const primary = await fetchJson("https://ipwho.is/");
    if (primary && primary.success !== false && primary.country_code) {
      geo = {
        country: clean(primary.country, 80),
        country_code: clean(primary.country_code, 2),
        region: clean(primary.region, 100),
        city: clean(primary.city, 100),
        postal: clean(primary.postal, 20),
        latitude: numeric(primary.latitude),
        longitude: numeric(primary.longitude),
        org: clean(primary.connection?.org || primary.connection?.domain, 160),
        isp: clean(primary.connection?.isp, 160),
        asn: primary.connection?.asn ? clean(`AS${primary.connection.asn}`, 40) : "",
        geo_source: "ipwho.is"
      };
    } else {
      const fallback = await fetchJson("https://get.geojs.io/v1/ip/geo.json");
      if (fallback?.country_code) {
        geo = {
          country: clean(fallback.country, 80),
          country_code: clean(fallback.country_code, 2),
          region: clean(fallback.region, 100),
          city: clean(fallback.city, 100),
          postal: "",
          latitude: numeric(fallback.latitude),
          longitude: numeric(fallback.longitude),
          org: clean(fallback.organization_name, 160),
          isp: clean(fallback.organization_name, 160),
          asn: fallback.asn ? clean(`AS${fallback.asn}`, 40) : "",
          geo_source: "geojs.io"
        };
      }
    }

    if (geo) writeStore(localStorage, geoKey, JSON.stringify({ at: Date.now(), geo }));
    return geo;
  }

  function enqueue(eventType, detail = {}) {
    if (stopped || !visit || !allowedEvents.has(eventType)) return;
    queue.push({
      session_id: visit.session_id,
      event_type: eventType,
      path: path(),
      section: clean(detail.section, 100),
      target: clean(detail.target, 500),
      label: clean(detail.label, 160),
      value: Number.isFinite(Number(detail.value)) ? Math.round(Number(detail.value)) : null
    });
    if (queue.length >= 12) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 1800);
  }

  async function send(events, keepalive = false) {
    const response = await fetch(`${config.url}/rest/v1/rpc/log_visit`, {
      method: "POST",
      keepalive,
      mode: "cors",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ p_session: visit, p_events: events })
    });
    if (!response.ok) throw new Error(`Analytics request failed (${response.status}).`);
  }

  async function flush(keepalive = false) {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (stopped || !visit) return;
    const batch = queue.splice(0, 20);
    try {
      await send(batch, keepalive);
    } catch (error) {
      stopped = true;
      queue = [];
      console.warn("Site analytics are unavailable.", error?.message || error);
    }
  }

  function trackSections() {
    if (!("IntersectionObserver" in window)) return;
    const seen = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || seen.has(entry.target.id)) return;
        seen.add(entry.target.id);
        const heading = entry.target.querySelector("h1, h2");
        enqueue("section_view", { section: entry.target.id, label: heading?.textContent || entry.target.id });
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.45 });
    document.querySelectorAll("main section[id]").forEach((section) => observer.observe(section));
  }

  function trackScrollDepth() {
    const sent = new Set();
    const check = () => {
      const available = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const depth = Math.min(100, Math.round(window.scrollY / available * 100));
      [25, 50, 75, 100].forEach((mark) => {
        if (depth < mark || sent.has(mark)) return;
        sent.add(mark);
        enqueue("scroll_depth", { value: mark });
      });
    };
    window.addEventListener("scroll", check, { passive: true });
    check();
  }

  function targetFor(link) {
    try {
      const url = new URL(link.href, location.href);
      const safePath = `${url.pathname}${url.hash}`;
      return clean(url.origin === location.origin ? safePath : `${url.origin}${safePath}`, 500);
    } catch {
      return clean(link.getAttribute("href"), 500);
    }
  }

  function trackClicks() {
    document.addEventListener("click", (event) => {
      const element = event.target.closest("a, button");
      if (!element || element.matches("[data-email-copy]")) return;
      const section = sectionFor(element);
      const label = clean(element.textContent || element.getAttribute("aria-label"), 160);
      if (element.matches("a")) {
        const target = targetFor(element);
        enqueue("link_click", { section, label, target });
        if (element.matches("[data-proposal-link]")) enqueue("proposal_open", { section, label, target });
        return;
      }
      enqueue("control_click", {
        section,
        label,
        target: clean(element.id || element.dataset.viewBtn || element.dataset.panel || element.className, 160)
      });
    }, { capture: true });

    document.addEventListener("arus:email-copied", (event) => {
      enqueue("email_copy", {
        section: sectionFor(event.detail?.element),
        label: "Email address copied",
        target: clean(event.detail?.email, 160)
      });
    });
  }

  function trackEngagement() {
    const heartbeat = () => {
      const now = Date.now();
      if (document.visibilityState === "visible") {
        const seconds = Math.min(30, Math.max(0, Math.round((now - lastHeartbeat) / 1000)));
        if (seconds) enqueue("engagement", { value: seconds });
      }
      lastHeartbeat = now;
    };
    heartbeatTimer = setInterval(heartbeat, 15000);
    document.addEventListener("visibilitychange", () => {
      heartbeat();
      if (document.visibilityState === "hidden") flush(true);
    });
    window.addEventListener("pagehide", () => {
      heartbeat();
      flush(true);
      clearInterval(heartbeatTimer);
    });
  }

  function init(site = {}) {
    if (initialized || site.analyticsEnabled === false) return;
    initialized = true;
    // Global Privacy Control is a legally recognised opt-out and is honoured.
    if (navigator.globalPrivacyControl === true) return;
    if (!config.url || !config.publishableKey) return;
    const isPreview = location.protocol !== "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (isPreview) return;

    visit = buildVisit();
    enqueue("session_start", { label: document.title });
    enqueue("page_view", { label: document.title });
    trackSections();
    trackScrollDepth();
    trackClicks();
    trackEngagement();
    flush();

    lookupGeo().then((geo) => {
      if (!geo || stopped || !visit) return;
      Object.assign(visit, geo);
      flush();
    });
  }

  window.ARUS_ANALYTICS = {
    init,
    track: enqueue
  };
})();
