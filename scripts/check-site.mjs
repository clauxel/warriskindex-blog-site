import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("public");
const domain = "https://warriskindex.blog";
const failures = [];
const allowedExternal = [
  "gdeltproject.org",
  "blog.gdeltproject.org",
  "acleddata.com",
  "ucdp.uu.se",
  "cfr.org",
  "www.cfr.org",
  "doc.wikimedia.org",
  "warriskindex.org"
];

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

function fail(id, detail) {
  failures.push({ id, detail });
}

function count(pattern, text) {
  return (text.match(pattern) || []).length;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function externalHosts(html) {
  return [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)]
    .map((match) => new URL(match[1]).hostname.replace(/^www\./, ""))
    .filter((host) => host !== "warriskindex.blog");
}

for (const file of await walk(root)) {
  if (!file.endsWith(".html")) continue;
  const html = await readFile(file, "utf8");
  const rel = path.relative(root, file);
  const visible = stripTags(html);
  if (count(/<h1[\s>]/gi, html) !== 1) fail("h1_count", `${rel} must have exactly one h1`);
  if (!/<link rel="canonical" href="https:\/\/warriskindex\.blog[^"]*"/.test(html)) fail("canonical", `${rel} missing canonical`);
  if (!/<meta property="og:url" content="https:\/\/warriskindex\.blog[^"]*"/.test(html)) fail("og_url", `${rel} missing og:url`);
  if (/[\u3400-\u9fff]/.test(html)) fail("cjk_copy", `${rel} contains CJK text`);
  if (/\b(SEO|SERP|hard gate|prompt residue|source collection|completion gate)\b/i.test(visible)) {
    fail("process_copy", `${rel} leaks internal build vocabulary`);
  }
  for (const host of externalHosts(html)) {
    if (!allowedExternal.includes(host)) fail("unexpected_external_link", `${rel} links to ${host}`);
  }
}

const index = await readFile(path.join(root, "index.html"), "utf8");
const css = await readFile(path.join(root, "assets/site.css"), "utf8");
const js = await readFile(path.join(root, "assets/app.js"), "utf8");
const worker = await readFile(path.join("worker", "index.js"), "utf8");
const product = JSON.parse(await readFile(path.join(root, "product.json"), "utf8"));
const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
const robots = await readFile(path.join(root, "robots.txt"), "utf8");
const llms = await readFile(path.join(root, "llms.txt"), "utf8");

if (!index.includes("<h1 id=\"home-title\">War Risk Index</h1>")) fail("homepage_h1", "Homepage H1 missing exact brand keyword");
if (!index.includes("/assets/war-risk-signal-board.png")) fail("visual_asset_reference", "Homepage missing bitmap visual asset reference");
if (!index.includes("/api/risk?all=1") && !js.includes("/api/risk?all=1")) fail("risk_api", "Client is not wired to the risk API");
if (!js.includes("/api/analytics")) fail("analytics_api", "Client is not wired to analytics");
if (css.includes("border-radius: 999px")) fail("pill_radius", "UI contains over-rounded pill radius");
if (/letter-spacing:\s*-/i.test(css)) fail("negative_letter_spacing", "CSS has negative letter spacing");
if (!product.trustDataLedger?.length || product.gates?.trust_data_gate !== "pass") fail("trust_data", "trustDataLedger or trust_data_gate missing");
if (product.pricing?.enabled !== false) fail("pricing_scope", "Free public site should have pricing.enabled=false");
for (const route of ["/", "/methodology/", "/regions/", "/sources/", "/privacy/", "/terms/"]) {
  if (!sitemap.includes(`<loc>${domain}${route === "/" ? "/" : route}</loc>`)) fail("sitemap_url", `${route} missing from sitemap`);
}
if (!robots.includes("Sitemap: https://warriskindex.blog/sitemap.xml")) fail("robots_sitemap", "robots.txt missing sitemap");
if (!llms.includes("War Risk Index")) fail("llms", "llms.txt missing product identity");
for (const token of ["domain TEXT", "hostname TEXT", "session_id TEXT", "visitor_id TEXT", "referrer_host TEXT", "utm_source TEXT", "analytics_events_domain_created_idx", "risk_snapshots"]) {
  if (!worker.includes(token)) fail("worker_schema", `Worker analytics/risk schema missing ${token}`);
}
if (!worker.includes("function ensureColumn") || !worker.includes("ALTER TABLE") || !worker.includes("ADD COLUMN")) {
  fail("worker_migration", "Worker must migrate patrol-compatible D1 columns");
}
if (!worker.includes("GDELT DOC 2.0") || !worker.includes("api.gdeltproject.org/api/v2/doc/doc")) {
  fail("gdelt_source", "Worker missing GDELT API integration");
}

const assetInfo = existsSync(path.join(root, "assets/war-risk-signal-board.png"))
  ? await stat(path.join(root, "assets/war-risk-signal-board.png"))
  : null;
if (!assetInfo || assetInfo.size < 10000) fail("bitmap_asset", "Generated bitmap visual asset missing or too small");

if (failures.length) {
  console.error(JSON.stringify({ status: "fail", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: "pass", checkedHtml: true, domain: "warriskindex.blog" }, null, 2));
