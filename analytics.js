(() => {
  const config = window.ARUS_SUPABASE || {};
  const sessionKey = "arus-analytics-session-v1";
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

  let client = null;
  let sessionId = "";
  let queue = [];
  let flushTimer = null;
  let heartbeatTimer = null;
  let lastHeartbeat = Date.now();
  let stopped = false;
  let initialized = false;

  const clean = (value, limit = 300) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const path = () => clean(`${location.pathname}${location.hash}`, 300) || "/";
  const sectionFor = (element) => element?.closest?.("section[id]")?.id || "";

  function randomId() {
    return globalThis.crypto?.randomUUID?.() || "00000000-0000-4000-8000-000000000000".replace(/[08]/g, (digit) => (Number(digit) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(digit) / 4).toString(16));
  }

  function currentSession() {
    try {
      const saved = sessionStorage.getItem(sessionKey);
      if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
      const next = randomId();
      sessionStorage.setItem(sessionKey, next);
      return next;
    } catch {
      return randomId();
    }
  }

  function browserName() {
    const agent = navigator.userAgent;
    if (/Edg\//.test(agent)) return "Edge";
    if (/OPR\//.test(agent)) return "Opera";
    if (/Firefox\//.test(agent)) return "Firefox";
    if (/Chrome\//.test(agent)) return "Chrome";
    if (/Safari\//.test(agent)) return "Safari";
    return "Other";
  }

  function deviceClass() {
    const width = Math.max(screen.width || 0, window.innerWidth || 0);
    if (width < 640) return "Mobile";
    if (width < 1024) return "Tablet";
    return "Desktop";
  }

  function safeReferrer() {
    if (!document.referrer) return "";
    try {
      const url = new URL(document.referrer);
      return clean(`${url.origin}${url.pathname}`, 500);
    } catch {
      return "";
    }
  }

  function sourceContext() {
    const query = new URLSearchParams(location.search);
    return {
      referrer: safeReferrer(),
      utm_source: clean(query.get("utm_source"), 100),
      utm_medium: clean(query.get("utm_medium"), 100),
      utm_campaign: clean(query.get("utm_campaign"), 150),
      language: clean(navigator.language, 40),
      timezone: clean(Intl.DateTimeFormat().resolvedOptions().timeZone, 80),
      device: deviceClass(),
      browser: browserName(),
      platform: clean(navigator.userAgentData?.platform || navigator.platform, 80),
      screen_size: `${screen.width || 0}×${screen.height || 0}`,
      viewport_size: `${window.innerWidth || 0}×${window.innerHeight || 0}`
    };
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

  function enqueue(eventType, detail = {}) {
    if (stopped || !allowedEvents.has(eventType)) return;
    queue.push({
      session_id: sessionId,
      event_type: eventType,
      path: path(),
      section: clean(detail.section, 100),
      target: clean(detail.target, 500),
      label: clean(detail.label, 160),
      value: Number.isFinite(Number(detail.value)) ? Math.round(Number(detail.value)) : null,
      ...detail.context
    });
    if (queue.length >= 12) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 1800);
  }

  async function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (stopped || !queue.length) return;
    const batch = queue.splice(0, 20);
    try {
      const result = await client.rpc("log_analytics_events", { p_events: batch });
      if (!result.error) return;
      stopped = true;
      queue = [];
      console.warn("Anonymous site analytics are unavailable.", result.error.message);
    } catch (error) {
      stopped = true;
      queue = [];
      console.warn("Anonymous site analytics are unavailable.", error?.message || error);
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
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", () => {
      heartbeat();
      flush();
      clearInterval(heartbeatTimer);
    });
  }

  function init(site = {}) {
    if (initialized || site.analyticsEnabled === false) return;
    initialized = true;
    const privacySignals = [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack];
    const respectsPrivacySignal = navigator.globalPrivacyControl === true || privacySignals.some((value) => value === "1" || value === "yes");
    const canStore = config.url && config.publishableKey && window.supabase;
    const isPreview = location.protocol !== "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (respectsPrivacySignal || !canStore || isPreview) return;

    client = window.supabase.createClient(config.url, config.publishableKey);
    sessionId = currentSession();
    enqueue("session_start", { context: sourceContext() });
    enqueue("page_view", { label: document.title });
    trackSections();
    trackScrollDepth();
    trackClicks();
    trackEngagement();
  }

  window.ARUS_ANALYTICS = {
    init,
    track: enqueue
  };
})();
