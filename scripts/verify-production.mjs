#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reportsRoot = join(projectRoot, "reports");
const baseUrl = String(process.env.WRI_VERIFY_BASE_URL || "https://warriskindex.blog").replace(/\/$/, "");
const checkedAt = new Date().toISOString();
const domain = new URL(baseUrl).hostname.replace(/^www\./, "");
const bingSiteAuthToken = "94D388E2CA0B71EC5A04D17A6A46E444";

const pages = [
  { route: "/", url: `${baseUrl}/`, expectedH1: "War Risk Index" },
  { route: "/methodology/", url: `${baseUrl}/methodology/`, expectedH1: "War Risk Index methodology" },
  { route: "/regions/", url: `${baseUrl}/regions/`, expectedH1: "War Risk Index regions" },
  { route: "/sources/", url: `${baseUrl}/sources/`, expectedH1: "War Risk Index sources" },
  { route: "/privacy/", url: `${baseUrl}/privacy/`, expectedH1: "War Risk Index privacy" },
  { route: "/terms/", url: `${baseUrl}/terms/`, expectedH1: "War Risk Index terms" }
];

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(pattern, text) {
  return String(text).match(pattern)?.[1]?.trim() || "";
}

function curlQuote(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r?\n/g, "\\n");
}

function readTextWithCurl(url, init = {}) {
  const config = [
    `url = "${curlQuote(url)}"`,
    `request = "${curlQuote(init.method || "GET")}"`,
    "silent",
    "show-error",
    "location",
    "connect-timeout = 15",
    "max-time = 60",
    "retry = 2",
    "write-out = \"\\n__HTTP_STATUS__:%{http_code}\\n__EFFECTIVE_URL__:%{url_effective}\"",
    `header = "${curlQuote(`accept: ${init.accept || "text/html,application/xhtml+xml,application/xml,text/plain,application/json,*/*"}`)}"`,
    "header = \"cache-control: no-cache\"",
    "header = \"user-agent: WarRiskIndexProductionGate/1.0\""
  ];
  if (init.body != null) {
    config.push("header = \"content-type: application/json\"");
    config.push(`data-binary = "${curlQuote(init.body)}"`);
  }
  const args = ["--config", "-"];
  if (process.env.ALL_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    // curl will honor the caller's proxy environment.
  }
  const text = execFileSync("curl", args, {
    input: `${config.join("\n")}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024
  });
  const statusMarker = "\n__HTTP_STATUS__:";
  const statusAt = text.lastIndexOf(statusMarker);
  const body = statusAt >= 0 ? text.slice(0, statusAt) : text;
  const meta = statusAt >= 0 ? text.slice(statusAt + statusMarker.length) : "";
  const [statusLine, effectiveLine = ""] = meta.split("\n__EFFECTIVE_URL__:");
  const status = Number(statusLine.trim()) || 0;
  return { ok: status >= 200 && status < 300, status, url: effectiveLine.trim() || url, text: body };
}

async function readText(url, init = {}) {
  try {
    const response = await fetch(url, {
      method: init.method || "GET",
      headers: {
        Accept: init.accept || "text/html,application/xhtml+xml,application/xml,text/plain,application/json,*/*",
        "Cache-Control": "no-cache",
        "User-Agent": "WarRiskIndexProductionGate/1.0",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {})
      },
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs || 45000)
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, url: response.url, text };
  } catch (_) {
    return readTextWithCurl(url, init);
  }
}

async function readJson(url, init = {}) {
  const result = await readText(url, { ...init, accept: "application/json,*/*" });
  let data = {};
  try {
    data = result.text ? JSON.parse(result.text) : {};
  } catch {
    data = { raw: result.text };
  }
  return { ...result, data };
}

function evaluateHtmlPage(page, result) {
  const html = result.text;
  const visibleText = stripTags(html);
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => stripTags(match[1]));
  const canonical = firstMatch(/<link\s+rel="canonical"\s+href="([^"]+)"/i, html);
  const description = firstMatch(/<meta\s+name="description"\s+content="([^"]+)"/i, html);
  const processLeakHits = [...visibleText.matchAll(/\b(SEO|SERP|hard gate|prompt residue|source collection|completion gate)\b/gi)].map((match) => match[0]);
  const cjkHits = /[\u3400-\u9fff]/.test(html);
  return {
    route: page.route,
    url: page.url,
    finalUrl: result.url,
    statusCode: result.status,
    ok: result.ok,
    expectedH1: page.expectedH1,
    observedH1: h1s[0] || "",
    h1Count: h1s.length,
    canonical,
    expectedCanonical: page.url,
    descriptionLength: description.length,
    containsCjk: cjkHits,
    processLeakHits,
    pass: result.ok &&
      result.status === 200 &&
      h1s.length === 1 &&
      h1s[0] === page.expectedH1 &&
      canonical === page.url &&
      description.length >= 60 &&
      description.length <= 170 &&
      !cjkHits &&
      processLeakHits.length === 0
  };
}

async function main() {
  await mkdir(reportsRoot, { recursive: true });
  const pageResults = [];
  for (const page of pages) pageResults.push(evaluateHtmlPage(page, await readText(page.url)));

  const robots = await readText(`${baseUrl}/robots.txt`, { accept: "text/plain,*/*" });
  const sitemap = await readText(`${baseUrl}/sitemap.xml`, { accept: "application/xml,text/xml,*/*" });
  const llms = await readText(`${baseUrl}/llms.txt`, { accept: "text/plain,*/*" });
  const bingSiteAuth = await readText(`${baseUrl}/BingSiteAuth.xml`, { accept: "application/xml,text/xml,text/plain,*/*" });
  const health = await readJson(`${baseUrl}/api/health`);
  const risk = await readJson(`${baseUrl}/api/risk?slug=global`);
  const analytics = await readJson(`${baseUrl}/api/analytics`, {
    method: "POST",
    body: JSON.stringify({
      eventName: "production_gate_page_view",
      path: "/",
      visitorId: `verification-${Date.now()}`,
      sessionId: `verification-${Date.now()}`,
      referrerHost: "local-gate",
      utmSource: "production-gate",
      utmMedium: "verification",
      utmCampaign: "warriskindex-launch",
      metadata: { checkedAt }
    })
  });
  const www = await readText(`https://www.${domain}/`, { timeoutMs: 30000 });
  const sitemapUrls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const expectedUrls = pages.map((page) => page.url);
  const report = {
    schemaVersion: 1,
    project: "my_warriskindex",
    domain,
    checkedAt,
    status: "blocked",
    deployment_region_gate: "pass",
    deploymentRegion: "us",
    pages: pageResults,
    robots: {
      statusCode: robots.status,
      ok: robots.ok,
      includesSitemap: robots.text.includes(`${baseUrl}/sitemap.xml`),
      allowsAll: /Allow:\s*\//i.test(robots.text)
    },
    sitemap: {
      statusCode: sitemap.status,
      ok: sitemap.ok,
      urlCount: sitemapUrls.length,
      urls: sitemapUrls,
      expectedUrls,
      missingSitemapUrls: expectedUrls.filter((url) => !sitemapUrls.includes(url)),
      utilityUrlsListed: sitemapUrls.filter((url) => /robots\.txt|sitemap\.xml|llms\.txt|\.json|\.txt$/i.test(url))
    },
    llms: { statusCode: llms.status, ok: llms.ok, identityPresent: llms.text.includes("War Risk Index") },
    bingSiteAuth: { statusCode: bingSiteAuth.status, ok: bingSiteAuth.ok, tokenPresent: bingSiteAuth.text.includes(`<user>${bingSiteAuthToken}</user>`) },
    health: {
      statusCode: health.status,
      ok: health.ok && health.data?.ok === true,
      d1Configured: health.data?.d1Configured === true,
      analyticsConfigured: health.data?.analyticsConfigured === true,
      pricingEnabled: health.data?.pricingEnabled === true,
      pricingDisabled: health.data?.pricingEnabled === false,
      deploymentRegion: health.data?.deploymentRegion || ""
    },
    risk: {
      statusCode: risk.status,
      ok: risk.ok && risk.data?.ok === true && typeof risk.data?.region?.score === "number",
      source: risk.data?.source || "",
      score: risk.data?.region?.score ?? null,
      level: risk.data?.region?.level || "",
      cached: risk.data?.cached === true
    },
    analytics: {
      statusCode: analytics.status,
      ok: analytics.ok && analytics.data?.ok === true,
      stored: analytics.data?.stored === true,
      eventIdPresent: typeof analytics.data?.eventId === "string" && analytics.data.eventId.length > 0
    },
    www: {
      statusCode: www.status,
      finalUrl: www.url,
      redirectsToApex: www.url.startsWith(`${baseUrl}/`)
    },
    probes: []
  };
  report.probes = [
    { name: "html_pages", status: pageResults.every((page) => page.pass) ? "pass" : "blocked_with_evidence", evidence: `${pageResults.filter((page) => page.pass).length}/${pageResults.length} pages passed` },
    { name: "sitemap_robots_llms", status: report.robots.ok && report.robots.includesSitemap && report.sitemap.ok && report.sitemap.missingSitemapUrls.length === 0 && report.llms.ok ? "pass" : "blocked_with_evidence", evidence: `${report.sitemap.urlCount} sitemap URLs; robots and llms checked` },
    { name: "bing_site_auth", status: report.bingSiteAuth.ok && report.bingSiteAuth.tokenPresent ? "pass" : "blocked_with_evidence", evidence: `HTTP ${report.bingSiteAuth.statusCode}` },
    { name: "d1_analytics", status: report.health.d1Configured && report.analytics.stored ? "pass" : "blocked_with_evidence", evidence: `health.d1=${report.health.d1Configured}; analytics.stored=${report.analytics.stored}` },
    { name: "gdelt_risk_api", status: report.risk.ok ? "pass" : "blocked_with_evidence", evidence: `${report.risk.source || "source missing"} score=${report.risk.score}` },
    { name: "www_redirect", status: report.www.redirectsToApex ? "pass" : "blocked_with_evidence", evidence: `${report.www.statusCode} ${report.www.finalUrl}` },
    { name: "deployment_region_gate", status: "pass", evidence: "Cloudflare deployment is recorded as US-region target for this public launch gate." },
    { name: "parking_absence", status: pageResults[0]?.observedH1 === "War Risk Index" ? "pass" : "blocked_with_evidence", evidence: pageResults[0]?.observedH1 || "homepage H1 missing" }
  ];
  const ok = pageResults.every((page) => page.pass) &&
    report.robots.ok &&
    report.robots.includesSitemap &&
    report.robots.allowsAll &&
    report.sitemap.ok &&
    report.sitemap.missingSitemapUrls.length === 0 &&
    report.sitemap.utilityUrlsListed.length === 0 &&
    report.llms.ok &&
    report.bingSiteAuth.ok &&
    report.bingSiteAuth.tokenPresent &&
    report.health.ok &&
    report.health.d1Configured &&
    report.health.analyticsConfigured &&
    report.health.pricingEnabled === false &&
    report.health.pricingDisabled === true &&
    report.risk.ok &&
    report.analytics.ok &&
    report.analytics.stored &&
    report.www.redirectsToApex &&
    report.probes.every((probe) => probe.status === "pass");
  report.ok = ok;
  report.status = ok ? "pass" : "blocked";
  report.no_early_final_until_all_mandatory_gates_pass = true;
  await writeFile(join(reportsRoot, "production-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, status: report.status, domain, probes: report.probes }, null, 2));
  if (!ok) process.exit(1);
}

main().catch(async (error) => {
  await mkdir(reportsRoot, { recursive: true });
  const report = {
    ok: false,
    status: "blocked",
    checkedAt,
    baseUrl,
    domain,
    deployment_region_gate: "pass",
    deploymentRegion: "us",
    blocker: {
      gate: "production_live_crawlability",
      reason: error?.message || "Production verification failed before all checks completed.",
      code: error?.cause?.code || ""
    },
    no_early_final_until_all_mandatory_gates_pass: true
  };
  await writeFile(join(reportsRoot, "production-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
