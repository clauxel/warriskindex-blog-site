#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const SITE_DOMAIN = "warriskindex.blog";
const SOURCE = "Wikimedia Pageviews build-time fallback";
const wikiMap = {
  global: ["War", "World_War_III"],
  ukraine: ["2022_Russian_invasion_of_Ukraine", "Russo-Ukrainian_War"],
  "middle-east": ["Middle_East_crisis_(2023-present)", "Israel-Hamas_war"],
  "taiwan-strait": ["Taiwan_Strait", "Cross-strait_relations"],
  "red-sea": ["Red_Sea_crisis", "Red_Sea"],
  "korean-peninsula": ["Korean_conflict", "North_Korea"],
  "south-china-sea": ["South_China_Sea_disputes", "South_China_Sea"],
  sudan: ["Sudanese_civil_war_(2023-present)", "Sudan"],
  sahel: ["Mali_War", "Sahel"]
};

function yyyymmdd(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeDate(value) {
  const text = String(value || "");
  if (/^\d{10}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text.slice(0, 10);
}

function wikiWindow() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start: `${yyyymmdd(start)}00`, end: `${yyyymmdd(end)}00` };
}

function wikimediaUrl(articleTitle) {
  const { start, end } = wikiWindow();
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(articleTitle)}/daily/${start}/${end}`;
}

function levelForScore(score) {
  if (score >= 81) return "Critical";
  if (score >= 61) return "High";
  if (score >= 41) return "Warning";
  if (score >= 21) return "Watch";
  return "Calm";
}

function compute(region, articleTitle, items) {
  const timeline = items.map((item) => ({
    date: normalizeDate(item.timestamp),
    value: Number(item.views || 0),
    norm: 0
  })).filter((row) => row.date && Number.isFinite(row.value));
  const values = timeline.map((row) => row.value);
  const totalArticles = values.reduce((sum, value) => sum + value, 0);
  const last7 = values.slice(-7).reduce((sum, value) => sum + value, 0);
  const previous7 = values.slice(-14, -7).reduce((sum, value) => sum + value, 0);
  const momentumPct = previous7 > 0 ? ((last7 - previous7) / previous7) * 100 : last7 > 0 ? 100 : 0;
  const average = values.length ? totalArticles / values.length : 0;
  const latest = values.length ? values[values.length - 1] : 0;
  const intensityLens = Math.min(100, Math.log1p(totalArticles) * 17);
  const accelerationLens = Math.max(0, Math.min(100, 50 + momentumPct));
  const breadthLens = 14;
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
    query: `Wikimedia pageviews: ${articleTitle}`,
    focus: region.focus,
    score,
    level,
    totalArticles: Math.round(totalArticles),
    momentumPct,
    sourceCount: 1,
    window: "30d",
    direction,
    source: SOURCE,
    fallback: true,
    buildTimeSnapshot: true,
    summary: `${region.label} is in ${level.toLowerCase()} band using a dated public-attention fallback snapshot.`,
    lenses: {
      intensity: Math.round(intensityLens),
      acceleration: Math.round(accelerationLens),
      breadth: Math.round(breadthLens),
      recency: Math.round(recencyLens)
    },
    timeline,
    articles: [{
      title: articleTitle.replace(/_/g, " "),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle).replace(/%2F/g, "/")}`,
      domain: "en.wikipedia.org",
      seenDate: timeline[timeline.length - 1]?.date || ""
    }]
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("source_timeout"), 10000);
  const response = await Promise.race([
    fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `WarRiskIndexFallback/1.0 (${SITE_DOMAIN})`
      },
      signal: controller.signal
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("source_timeout")), 10500))
  ]).finally(() => clearTimeout(timeout));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return payload;
}

async function main() {
  const config = JSON.parse(await readFile("public/data/regions.json", "utf8"));
  const snapshots = {};
  const errors = [];
  for (const region of config.regions) {
    if (region.slug === "global") continue;
    const titles = wikiMap[region.slug] || ["War"];
    let saved = false;
    for (const title of titles) {
      try {
        const payload = await fetchJson(wikimediaUrl(title));
        if (!Array.isArray(payload.items) || !payload.items.length) throw new Error("empty_items");
        snapshots[region.slug] = compute(region, title, payload.items);
        saved = true;
        break;
      } catch (error) {
        errors.push({ region: region.slug, title, error: error.message });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!saved) snapshots[region.slug] = {
      slug: region.slug,
      label: region.label,
      query: "static fallback unavailable",
      focus: region.focus,
      score: 0,
      level: "Unavailable",
      totalArticles: 0,
      momentumPct: 0,
      sourceCount: 0,
      window: "30d",
      source: SOURCE,
      fallback: true,
      buildTimeSnapshot: true,
      summary: `No build-time fallback was available for ${region.label}.`,
      articles: []
    };
  }
  const globalRegion = config.regions.find((region) => region.slug === "global");
  const scored = Object.values(snapshots).filter((snapshot) => Number(snapshot.score || 0) > 0);
  const globalScore = scored.length ? Math.round(scored.reduce((sum, snapshot) => sum + snapshot.score, 0) / scored.length) : 0;
  const globalTotal = scored.reduce((sum, snapshot) => sum + Number(snapshot.totalArticles || 0), 0);
  snapshots.global = {
    slug: "global",
    label: "Global composite",
    query: "Wikimedia pageviews regional composite",
    focus: globalRegion?.focus || "Broad global war-risk language across the public attention graph.",
    score: globalScore,
    level: levelForScore(globalScore),
    totalArticles: globalTotal,
    momentumPct: scored.length ? scored.reduce((sum, snapshot) => sum + Number(snapshot.momentumPct || 0), 0) / scored.length : 0,
    sourceCount: scored.length,
    window: "30d",
    direction: "composite",
    source: SOURCE,
    fallback: true,
    buildTimeSnapshot: true,
    summary: `Global composite is in ${levelForScore(globalScore).toLowerCase()} band using dated public-attention fallback snapshots across ${scored.length} tracked regions.`,
    lenses: {
      intensity: scored.length ? Math.round(scored.reduce((sum, snapshot) => sum + Number(snapshot.lenses?.intensity || 0), 0) / scored.length) : 0,
      acceleration: scored.length ? Math.round(scored.reduce((sum, snapshot) => sum + Number(snapshot.lenses?.acceleration || 0), 0) / scored.length) : 0,
      breadth: Math.min(100, scored.length * 12),
      recency: scored.length ? Math.round(scored.reduce((sum, snapshot) => sum + Number(snapshot.lenses?.recency || 0), 0) / scored.length) : 0
    },
    timeline: [],
    articles: scored
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .flatMap((snapshot) => snapshot.articles || [])
      .slice(0, 6)
  };
  const result = {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    sourceUrl: "https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html",
    window: wikiWindow(),
    note: "Used only when live GDELT and live Wikimedia requests are unavailable. It is a public-attention snapshot, not conflict event intensity.",
    snapshots,
    errors
  };
  await writeFile("public/data/fallback-snapshot.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "pass", regions: Object.keys(snapshots).length, errors: errors.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
