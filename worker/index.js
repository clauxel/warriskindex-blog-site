const SITE_KEY = "warriskindex";
const SITE_DOMAIN = "warriskindex.blog";
const SOURCE_NAME = "GDELT DOC 2.0";
const CONFLICT_QUERY = "(war OR conflict OR military OR missile OR drone OR attack OR escalation OR ceasefire)";
const CACHE_TTL_MS = 15 * 60 * 1000;

const REGIONS = [
  { slug: "global", label: "Global composite", query: "war risk", wikiArticles: ["War", "World_War_III"], focus: "Broad global war-risk language across the open news graph." },
  { slug: "ukraine", label: "Ukraine", query: "Ukraine", wikiArticles: ["2022_Russian_invasion_of_Ukraine", "Russo-Ukrainian_War"], focus: "Russia-Ukraine war coverage and ceasefire or escalation signals." },
  { slug: "middle-east", label: "Middle East", query: "Middle East", wikiArticles: ["Middle_East_crisis_(2023-present)", "Israel-Hamas_war"], focus: "Regional conflict, missile, maritime, and escalation language." },
  { slug: "taiwan-strait", label: "Taiwan Strait", query: "Taiwan Strait", wikiArticles: ["Taiwan_Strait", "Cross-strait_relations"], focus: "Military drills, blockade language, and cross-strait escalation." },
  { slug: "red-sea", label: "Red Sea shipping", query: "Red Sea", wikiArticles: ["Red_Sea_crisis", "Red_Sea"], focus: "Maritime attacks, rerouting, and trade disruption coverage." },
  { slug: "korean-peninsula", label: "Korean Peninsula", query: "North Korea", wikiArticles: ["Korean_conflict", "North_Korea"], focus: "Missile tests, border incidents, and crisis signaling." },
  { slug: "south-china-sea", label: "South China Sea", query: "South China Sea", wikiArticles: ["South_China_Sea_disputes", "South_China_Sea"], focus: "Maritime standoffs, coast guard encounters, and military posture." },
  { slug: "sudan", label: "Sudan", query: "Sudan", wikiArticles: ["Sudanese_civil_war_(2023-present)", "Sudan"], focus: "Civil war coverage, displacement, and battlefield trend language." },
  { slug: "sahel", label: "Sahel", query: "Sahel", wikiArticles: ["Mali_War", "Sahel"], focus: "Insurgent violence and instability in Mali, Burkina Faso, and Niger." }
];

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function cleanText(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanEventName(value) {
  const name = cleanText(value, 80).toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "");
  return name || "event";
}

function cleanHost(value) {
  const raw = cleanText(value, 260).toLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch (_) {
    return raw.split("/")[0].split("?")[0].split("#")[0].replace(/:\d+$/, "").replace(/^www\./, "");
  }
}

function cleanPath(value) {
  const raw = cleanText(value, 500);
  if (!raw) return "/";
  try {
    const parsed = new URL(raw, `https://${SITE_DOMAIN}`);
    return `${parsed.pathname}${parsed.search}`.slice(0, 500) || "/";
  } catch (_) {
    return raw.startsWith("/") ? raw.slice(0, 500) : "/";
  }
}

function safeJson(value, max = 8000) {
  try {
    return JSON.stringify(value || {}).slice(0, max);
  } catch (_) {
    return "{}";
  }
}

async function requestJson(request) {
  try {
    return await request.clone().json();
  } catch (_) {
    return {};
  }
}

async function tableColumnNames(env, tableName) {
  const result = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set((result.results || []).map((column) => column.name));
}

async function ensureColumn(env, tableName, columnName, definition) {
  const columns = await tableColumnNames(env, tableName);
  if (columns.has(columnName)) return;
  await env.DB.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}

async function ensureTables(env) {
  if (!env?.DB?.prepare) return false;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      site_key TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '${SITE_DOMAIN}',
      hostname TEXT,
      event_name TEXT NOT NULL,
      path TEXT NOT NULL,
      route_path TEXT,
      session_id TEXT,
      visitor_id TEXT,
      referrer TEXT,
      referrer_host TEXT,
      source TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      user_agent TEXT,
      country TEXT,
      occurred_at TEXT,
      created_at TEXT NOT NULL
    )
  `).run();
  await ensureColumn(env, "analytics_events", "domain", `TEXT NOT NULL DEFAULT '${SITE_DOMAIN}'`);
  await ensureColumn(env, "analytics_events", "hostname", "TEXT");
  await ensureColumn(env, "analytics_events", "route_path", "TEXT");
  await ensureColumn(env, "analytics_events", "session_id", "TEXT");
  await ensureColumn(env, "analytics_events", "visitor_id", "TEXT");
  await ensureColumn(env, "analytics_events", "referrer_host", "TEXT");
  await ensureColumn(env, "analytics_events", "utm_source", "TEXT");
  await ensureColumn(env, "analytics_events", "utm_medium", "TEXT");
  await ensureColumn(env, "analytics_events", "utm_campaign", "TEXT");
  await ensureColumn(env, "analytics_events", "occurred_at", "TEXT");
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS analytics_events_site_created_idx ON analytics_events(site_key, created_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS analytics_events_domain_created_idx ON analytics_events(domain, created_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS analytics_events_event_created_idx ON analytics_events(event_name, created_at)").run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS risk_snapshots (
      id TEXT PRIMARY KEY,
      site_key TEXT NOT NULL,
      region_slug TEXT NOT NULL,
      region_label TEXT NOT NULL,
      score INTEGER NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      query TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS risk_snapshots_region_created_idx ON risk_snapshots(region_slug, created_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS risk_snapshots_site_created_idx ON risk_snapshots(site_key, created_at)").run();
  return true;
}

async function recordAnalyticsEvent(request, env, eventName, payload = {}) {
  const stored = await ensureTables(env);
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const url = new URL(request.url);
  const hostname = cleanHost(request.headers.get("Host") || url.hostname) || SITE_DOMAIN;
  const path = cleanPath(payload.path || `${url.pathname}${url.search}`);
  const referrer = cleanText(payload.referrer || request.headers.get("Referer") || "", 500);
  const referrerHost = cleanHost(payload.referrerHost || payload.referrer_host || referrer);
  const utmSource = cleanText(payload.utmSource || payload.utm_source || url.searchParams.get("utm_source") || "", 120);
  const utmMedium = cleanText(payload.utmMedium || payload.utm_medium || url.searchParams.get("utm_medium") || "", 120);
  const utmCampaign = cleanText(payload.utmCampaign || payload.utm_campaign || url.searchParams.get("utm_campaign") || "", 160);
  const source = cleanText(payload.source || utmSource || referrerHost || "", 120);
  const sessionId = cleanText(payload.sessionId || payload.session_id || payload.sid || id, 120);
  const visitorId = cleanText(payload.visitorId || payload.visitor_id || payload.vid || sessionId, 120);
  const metadata = {
    ...(typeof payload.metadata === "object" && payload.metadata ? payload.metadata : {}),
    viewport: typeof payload.viewport === "object" ? payload.viewport : undefined
  };
  const createdAt = new Date().toISOString();
  if (stored) {
    await env.DB.prepare(`
      INSERT INTO analytics_events (
        id, site_key, domain, hostname, event_name, path, route_path, session_id, visitor_id,
        referrer, referrer_host, source, utm_source, utm_medium, utm_campaign,
        metadata_json, user_agent, country, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      SITE_KEY,
      SITE_DOMAIN,
      hostname,
      cleanEventName(eventName),
      path,
      path,
      sessionId,
      visitorId,
      referrer,
      referrerHost,
      source,
      utmSource,
      utmMedium,
      utmCampaign,
      safeJson(metadata),
      cleanText(request.headers.get("User-Agent") || "", 500),
      cleanText(request.cf?.country || "", 12),
      createdAt,
      createdAt
    ).run();
  }
  return { id, stored, createdAt };
}

async function handleAnalytics(request, env) {
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  const body = await requestJson(request);
  const event = await recordAnalyticsEvent(request, env, body.eventName || body.event || body.name, body);
  return jsonResponse({ ok: true, eventId: event.id, stored: event.stored, createdAt: event.createdAt });
}

function levelForScore(score) {
  if (score >= 81) return "Critical";
  if (score >= 61) return "High";
  if (score >= 41) return "Warning";
  if (score >= 21) return "Watch";
  return "Calm";
}

function normalizeDate(value) {
  const text = String(value || "");
  if (/^\d{8}T\d{6}Z$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{10}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text.slice(0, 10);
}

function extractTimeline(payload) {
  const timeline = payload.timeline || payload.timelinevol || payload.timelinevolraw || payload.data || [];
  const rows = Array.isArray(timeline?.[0]?.data) ? timeline[0].data : Array.isArray(timeline) ? timeline : [];
  return rows.map((row) => ({
    date: normalizeDate(row.date || row.datetime || row.time || row.timestamp),
    value: Number(row.value ?? row.count ?? row.Volume ?? row.Articles ?? row.raw ?? 0),
    norm: Number(row.norm ?? row.Norm ?? row.normalized ?? 0)
  })).filter((row) => row.date && Number.isFinite(row.value));
}

function articleDomain(article) {
  const direct = cleanHost(article.domain || article.sourceCommonName || article.source || "");
  if (direct) return direct;
  try {
    return new URL(article.url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function normalizeArticles(payload) {
  const rows = Array.isArray(payload.articles) ? payload.articles : Array.isArray(payload.results) ? payload.results : [];
  return rows.slice(0, 8).map((article) => ({
    title: cleanText(article.title || article.seendate || "Source article", 180),
    url: cleanText(article.url || "", 500),
    domain: articleDomain(article),
    seenDate: cleanText(article.seendate || article.seenDate || article.date || "", 40)
  })).filter((article) => article.url && article.title);
}

function computeScore({ region, query, timeline, articles }) {
  const values = timeline.map((row) => Number(row.value || 0)).filter((value) => Number.isFinite(value));
  const totalArticles = values.reduce((sum, value) => sum + value, 0);
  const last7 = values.slice(-7).reduce((sum, value) => sum + value, 0);
  const previous7 = values.slice(-14, -7).reduce((sum, value) => sum + value, 0);
  const momentumPct = previous7 > 0 ? ((last7 - previous7) / previous7) * 100 : last7 > 0 ? 100 : 0;
  const average = values.length ? totalArticles / values.length : 0;
  const latest = values.length ? values[values.length - 1] : 0;
  const sourceCount = new Set(articles.map((article) => article.domain).filter(Boolean)).size;
  const intensityLens = Math.min(100, Math.log1p(totalArticles) * 17);
  const accelerationLens = Math.max(0, Math.min(100, 50 + momentumPct));
  const breadthLens = Math.min(100, sourceCount * 14);
  const recencyLens = average > 0 ? Math.min(100, (latest / average) * 42) : 0;
  const score = Math.round(Math.max(0, Math.min(100,
    intensityLens * 0.50 +
    accelerationLens * 0.25 +
    breadthLens * 0.15 +
    recencyLens * 0.10
  )));
  const level = levelForScore(score);
  const direction = momentumPct > 12 ? "rising" : momentumPct < -12 ? "cooling" : "steady";
  return {
    slug: region.slug,
    label: region.label,
    query,
    focus: region.focus,
    score,
    level,
    totalArticles: Math.round(totalArticles),
    momentumPct,
    sourceCount,
    window: "30d",
    direction,
    summary: `${region.label} is in ${level.toLowerCase()} band with ${direction} 7-day coverage pressure across ${sourceCount} source domains.`,
    lenses: {
      intensity: Math.round(intensityLens),
      acceleration: Math.round(accelerationLens),
      breadth: Math.round(breadthLens),
      recency: Math.round(recencyLens)
    },
    timeline,
    articles
  };
}

function gdeltUrl(query, mode, maxrecords = 8) {
  const params = new URLSearchParams({
    query,
    mode,
    format: "json",
    timespan: "30d"
  });
  if (mode === "artlist") {
    params.set("maxrecords", String(maxrecords));
    params.set("sort", "hybridrel");
  }
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

function yyyymmdd(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function wikiWindow() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    start: `${yyyymmdd(start)}00`,
    end: `${yyyymmdd(end)}00`
  };
}

function wikimediaUrl(articleTitle) {
  const { start, end } = wikiWindow();
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(articleTitle)}/daily/${start}/${end}`;
}

async function fetchJsonUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("source_timeout"), 6000);
  const response = await Promise.race([
    fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "WarRiskIndex/1.0" },
      signal: controller.signal
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("source_timeout")), 6500))
  ]).finally(() => clearTimeout(timeout));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GDELT ${response.status}`);
  return payload;
}

function computeFallbackScore({ region, articleTitle, payload, upstreamError }) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const timeline = items.map((item) => ({
    date: normalizeDate(item.timestamp),
    value: Number(item.views || 0),
    norm: 0
  })).filter((row) => row.date && Number.isFinite(row.value));
  if (!timeline.length) throw new Error("wikimedia_empty_timeline");
  const articles = [{
    title: articleTitle.replace(/_/g, " "),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle).replace(/%2F/g, "/")}`,
    domain: "en.wikipedia.org",
    seenDate: timeline[timeline.length - 1].date
  }];
  const result = computeScore({
    region,
    query: `Wikimedia pageviews: ${articleTitle}`,
    timeline,
    articles
  });
  return {
    ...result,
    source: "Wikimedia Pageviews fallback",
    fallback: true,
    upstreamError: cleanText(upstreamError, 120),
    summary: `${region.label} is in ${result.level.toLowerCase()} band using public-attention fallback after GDELT was unavailable.`
  };
}

async function buildFallbackRegion(region, env, upstreamError) {
  const titles = region.wikiArticles?.length ? region.wikiArticles : ["War"];
  const errors = [];
  for (const title of titles) {
    try {
      const payload = await fetchJsonUrl(wikimediaUrl(title));
      const result = computeFallbackScore({ region, articleTitle: title, payload, upstreamError });
      await storeSnapshot(env, result);
      return { ...result, cached: false };
    } catch (error) {
      errors.push(`${title}:${error.message}`);
    }
  }
  throw new Error(`fallback_unavailable ${errors.join(" | ")}`);
}

async function buildStaticFallbackRegion(region, env, upstreamError) {
  if (!env?.ASSETS?.fetch) throw new Error("static_fallback_assets_unavailable");
  const response = await env.ASSETS.fetch(new Request(`https://${SITE_DOMAIN}/data/fallback-snapshot.json`));
  const payload = await response.json().catch(() => ({}));
  const snapshot = payload.snapshots?.[region.slug];
  if (!snapshot) throw new Error("static_fallback_snapshot_missing");
  const result = {
    ...snapshot,
    cached: false,
    staticFallback: true,
    upstreamError: cleanText(upstreamError, 120),
    snapshotGeneratedAt: payload.generatedAt || ""
  };
  await storeSnapshot(env, result);
  return result;
}

async function latestSnapshot(env, slug) {
  if (!env?.DB?.prepare) return null;
  await ensureTables(env);
  const row = await env.DB.prepare(`
    SELECT payload_json, created_at
    FROM risk_snapshots
    WHERE site_key = ? AND region_slug = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(SITE_KEY, slug).first();
  if (!row?.payload_json) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    payload.snapshotCreatedAt = row.created_at;
    payload.snapshotAgeMs = Date.now() - Date.parse(row.created_at);
    return payload;
  } catch (_) {
    return null;
  }
}

async function storeSnapshot(env, region) {
  if (!env?.DB?.prepare) return false;
  await ensureTables(env);
  await env.DB.prepare(`
    INSERT INTO risk_snapshots (
      id, site_key, region_slug, region_label, score, level, source, query, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    SITE_KEY,
    region.slug,
    region.label,
    region.score,
    region.level,
    region.source || SOURCE_NAME,
    region.query,
    safeJson(region),
    new Date().toISOString()
  ).run();
  return true;
}

async function buildRegion(region, env, force = false, options = {}) {
  const cached = await latestSnapshot(env, region.slug);
  if (!force && cached && Number(cached.snapshotAgeMs || 0) < CACHE_TTL_MS) {
    return { ...cached, cached: true };
  }
  if (!force && !cached && options.staticFirst !== false) {
    try {
      return await buildStaticFallbackRegion(region, env, "cold_start_static_fallback");
    } catch (_) {
      // Continue to live sources when the bundled snapshot is missing.
    }
  }
  const query = `${region.query} ${CONFLICT_QUERY}`;
  try {
    const [timelinePayload, articlePayload] = await Promise.all([
      fetchJsonUrl(gdeltUrl(query, "timelinevolraw")),
      fetchJsonUrl(gdeltUrl(query, "artlist", 8))
    ]);
    const timeline = extractTimeline(timelinePayload);
    if (!timeline.length) throw new Error("gdelt_empty_timeline");
    const result = computeScore({
      region,
      query,
      timeline,
      articles: normalizeArticles(articlePayload)
    });
    await storeSnapshot(env, result);
    return { ...result, cached: false };
  } catch (error) {
    try {
      return await buildFallbackRegion(region, env, error.message);
    } catch (fallbackError) {
      if (cached) return { ...cached, cached: true, upstreamError: cleanText(error.message, 120) };
      try {
        return await buildStaticFallbackRegion(region, env, `${error.message}; ${fallbackError.message}`);
      } catch (_) {
        // Keep the original source failure visible unless a stored snapshot exists.
      }
    }
    throw error;
  }
}

function customRegion(url) {
  const rawQuery = cleanText(url.searchParams.get("query") || "", 80);
  if (!rawQuery) return null;
  return {
    slug: `custom-${rawQuery.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "signal"}`,
    label: cleanText(url.searchParams.get("label") || rawQuery, 60),
    query: rawQuery,
    focus: "Custom open-news war risk signal."
  };
}

async function handleRisk(request, env) {
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";
  if (url.searchParams.get("all") === "1") {
    const regions = await Promise.all(REGIONS.map(async (region) => {
      try {
        return await buildRegion(region, env, force);
      } catch (error) {
        return {
          slug: region.slug,
          label: region.label,
          focus: region.focus,
          score: 0,
          level: "Unavailable",
          totalArticles: 0,
          momentumPct: 0,
          sourceCount: 0,
          window: "30d",
          summary: `No live source signal is available for ${region.label}: ${cleanText(error.message, 100)}`,
          articles: [],
          cached: false,
          error: cleanText(error.message, 120)
        };
      }
    }));
    return jsonResponse({
      ok: true,
      source: "GDELT DOC 2.0 with Wikimedia fallback",
      generatedAt: new Date().toISOString(),
      cached: regions.every((region) => region.cached),
      regions: regions.map(({ timeline, ...region }) => region)
    }, 200, { "Cache-Control": "public, max-age=300" });
  }
  const region = customRegion(url) || REGIONS.find((item) => item.slug === cleanText(url.searchParams.get("slug") || "global", 80)) || REGIONS[0];
  const result = await buildRegion(region, env, force);
  return jsonResponse({
    ok: true,
    source: result.source || SOURCE_NAME,
    generatedAt: new Date().toISOString(),
    cached: result.cached,
    region: result
  }, 200, { "Cache-Control": "public, max-age=300" });
}

async function handleHealth(request, env) {
  const stored = await ensureTables(env);
  return jsonResponse({
    ok: true,
    domain: SITE_DOMAIN,
    siteKey: SITE_KEY,
    source: SOURCE_NAME,
    analyticsConfigured: stored,
    d1Configured: stored,
    pricingEnabled: false,
    deploymentRegion: "us"
  });
}

function hasFileExtension(pathname) {
  const lastSegment = pathname.split("/").pop() || "";
  return lastSegment.includes(".");
}

async function fetchAsset(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
}

async function serveStatic(request, env) {
  const url = new URL(request.url);
  let pathname = url.pathname;
  let htmlPath = false;
  if (!hasFileExtension(pathname)) {
    if (!pathname.endsWith("/")) {
      return Response.redirect(`${url.origin}${pathname}/${url.search}`, 301);
    }
    htmlPath = true;
  }
  const response = await fetchAsset(request, env, pathname);
  if (response.status !== 404) {
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    if (htmlPath || pathname.endsWith(".html")) headers.set("Cache-Control", "public, max-age=120");
    return new Response(response.body, { status: response.status, headers });
  }
  return fetchAsset(request, env, "/404.html");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === `www.${SITE_DOMAIN}`) {
      return Response.redirect(`https://${SITE_DOMAIN}${url.pathname}${url.search}`, 301);
    }
    if (url.pathname === "/api/health") return handleHealth(request, env);
    if (url.pathname === "/api/analytics") return handleAnalytics(request, env);
    if (url.pathname === "/api/risk") return handleRisk(request, env);
    return serveStatic(request, env);
  }
};
