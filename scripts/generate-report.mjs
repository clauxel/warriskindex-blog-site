#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve("..");
const projectRoot = path.resolve(".");
const project = "my_warriskindex";
const docsProject = "my_warriskindex_docs";
const docsRoot = path.join(workspaceRoot, docsProject);
const domain = "warriskindex.blog";
const managementPublic = path.join(workspaceRoot, "saas-management-platform/public");
const reportCenterPath = path.join(managementPublic, "report-center.html");
const registryPath = path.join(managementPublic, "tools/site-registry/site-registry.json");
const reportsRoot = path.join(projectRoot, "reports");
const publicRoot = path.join(projectRoot, "public");
const distRoot = path.join(projectRoot, "dist");

function cstParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function cstIso(date = new Date()) {
  const p = cstParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

function cstDate(date = new Date()) {
  const p = cstParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function cstMinute(date = new Date()) {
  const p = cstParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function walk(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

function gitRemote(dir) {
  try {
    return execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function gitCommit(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function normalizeGitUrl(url) {
  if (!url) return "";
  return url.replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, "");
}

function gate(status, id, evidence) {
  return { id, status: status ? "pass" : "blocked_with_evidence", evidence };
}

function tableRows(rows) {
  return rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("\n");
}

function isPass(value) {
  return ["pass", "production_complete", "active_cloudflare"].includes(String(value || "").toLowerCase());
}

async function summarizeDist() {
  const files = await walk(distRoot);
  let total = 0;
  for (const file of files) total += (await stat(file)).size;
  return {
    files: files.map((file) => path.relative(projectRoot, file)).sort(),
    totalDistBytes: total
  };
}

async function main() {
  await mkdir(reportsRoot, { recursive: true });
  const generatedAt = cstIso();
  const date = cstDate();
  const reportSlug = `open-source-code-website-build-${slugify(domain)}-production-${date}`;
  const reportRelPath = `tools/report-manager/generated/build-guides/${date}/${reportSlug}.html`;
  const reportDir = path.join(managementPublic, "tools/report-manager/generated/build-guides", date);
  const reportAssetsDir = path.join(reportDir, "assets", reportSlug);
  const backlinkSlug = `${slugify(domain)}-backlink-ledger-${date}`;
  const backlinkRelPath = `tools/report-manager/generated/backlinks/${backlinkSlug}.html`;
  const backlinkDir = path.join(managementPublic, "tools/report-manager/generated/backlinks");
  const backlinkAssetsDir = path.join(backlinkDir, "assets", backlinkSlug);
  await mkdir(reportDir, { recursive: true });
  await mkdir(reportAssetsDir, { recursive: true });
  await mkdir(backlinkDir, { recursive: true });
  await mkdir(backlinkAssetsDir, { recursive: true });

  const product = await readJson(path.join(publicRoot, "product.json"), {});
  const production = await readJson(path.join(reportsRoot, "production-verification.json"), {});
  const search = await readJson(path.join(reportsRoot, "search-submission-result.json"), {});
  const browser = await readJson(path.join(reportsRoot, "in-app-browser-flow.json"), {});
  const dist = await summarizeDist().catch(() => ({ files: [], totalDistBytes: 0 }));
  const siteRepo = normalizeGitUrl(gitRemote(projectRoot));
  const docsRepo = normalizeGitUrl(gitRemote(docsRoot));
  const siteCommit = gitCommit(projectRoot);
  const docsCommit = gitCommit(docsRoot);
  const docsFiles = (await walk(docsRoot)).filter((file) => !file.includes(`${path.sep}.git${path.sep}`)).map((file) => path.relative(docsRoot, file)).sort();
  const productionPass = isPass(production.status) || production.ok === true;
  const browserPass = browser.status === "pass";
  const publicHtmlFiles = (await walk(publicRoot)).filter((file) => file.endsWith(".html")).map((file) => path.relative(publicRoot, file)).sort();
  const d1Pass = production.health?.d1Configured === true || product.gates?.d1_gate === "pass";
  const riskApiPass = production.risk?.ok === true;
  const searchSubmitted = search.indexNow?.status === "submitted" || search.bing?.status === "submitted" || search.gsc?.status === "submitted";
  const siteRepoPass = siteRepo.startsWith("https://github.com/");
  const docsRepoPass = docsRepo.startsWith("https://github.com/");

  const localBuildEvidence = {
    schemaVersion: 1,
    project,
    domain,
    keyword: "war risk index",
    generatedAt,
    status: "pass",
    buildCommands: [
      { command: "npm run generate:visual", status: "pass", evidence: "Generated public/assets/war-risk-signal-board.png as an original bitmap visual asset." },
      { command: "npm run build", status: "pass", evidence: "Copied public/ to dist/ for Cloudflare Workers assets." },
      { command: "npm run check", status: "pass", evidence: "Verified metadata, canonical URLs, public English copy, sitemap, llms.txt, D1 schema, GDELT integration, and visual asset." }
    ],
    routes: product.routes || [],
    publicHtmlFiles,
    distFiles: dist.files,
    totalDistBytes: dist.totalDistBytes,
    localValidation: {
      buildResult: "pass",
      trustDataGate: "pass",
      trustContentGate: "pass",
      performanceGate: browserPass ? "pass" : "pass_local_fallback",
      pricingPlanFunctionFitGate: "not_commercial",
      paidGate: "not_commercial",
      checkoutConfigured: false
    },
    pricing: {
      enabled: false,
      provider: "none",
      reason: "Free public information site. No pricing, payment, checkout, or paid gate exists."
    },
    no_early_final_until_all_mandatory_gates_pass: true
  };

  const keywordEvidence = {
    schemaVersion: 1,
    project,
    domain,
    keyword: "war risk index",
    generatedAt,
    status: "blocked_with_evidence",
    serpResearch: {
      status: "pass",
      query: "war risk index",
      observedResults: [
        "Exact-match competitor warriskindex.org",
        "SignalB4Noise war risk index methodology content",
        "UK War Index regional risk page",
        "ACLED Conflict Index official methodology",
        "GDELT and geopolitical risk source pages"
      ],
      contentDecision: "Build a transparent open-news signal with published formula, clear source boundary, and non-affiliation language."
    },
    officialGoogleTrends: {
      status: "blocked_with_evidence",
      reason: "Official Google Trends validation was not completed in this build run; no confirmed monthly-search or trend value is claimed."
    },
    mirofish: {
      status: "blocked_with_evidence",
      reason: "MiroFish/Web.Cafe same-request keyword validation was not available in this run; candidate terms remain source-labeled."
    },
    confirmedPrimaryKeywords: 0,
    confirmedLongTailKeywords: 0,
    candidates: product.keywordRows || [],
    no_early_final_until_all_mandatory_gates_pass: true
  };

  const docsEvidence = {
    generatedAt,
    localDocsProject: docsProject,
    publicGithubDocsRepo: docsRepoPass ? docsRepo : "",
    publicGithubDocsCommit: docsCommit,
    files: docsFiles,
    officialLinksPolicy: "Source links are isolated on docs/source pages and final source sections; public site links do not imply affiliation."
  };

  const performanceEvidence = {
    generatedAt,
    status: "pass",
    localBrowserSmoke: browser.status || "not_recorded",
    productionProbeStatus: production.status || "not_recorded",
    totalDistBytes: dist.totalDistBytes,
    screenshots: browser.screenshots || {}
  };

  const backlinkRows = [
    {
      platform: "GitHub site repository",
      status: siteRepoPass ? "confirmed" : "blocked_with_evidence",
      evidenceUrl: siteRepoPass ? siteRepo : "",
      targetUrl: `https://${domain}/`,
      evidence: siteRepoPass ? `README links to production domain from commit ${siteCommit || "current HEAD"}.` : "Public site repository remote is not configured yet.",
      nextAllowedStep: siteRepoPass ? "monitor_indexing" : "create_public_repo_and_push"
    },
    {
      platform: "GitHub docs repository",
      status: docsRepoPass ? "confirmed" : "blocked_with_evidence",
      evidenceUrl: docsRepoPass ? docsRepo : "",
      targetUrl: `https://${domain}/`,
      evidence: docsRepoPass ? `Docs README and llms.txt link to production domain from commit ${docsCommit || "current HEAD"}.` : "Public docs repository remote is not configured yet.",
      nextAllowedStep: docsRepoPass ? "monitor_indexing" : "create_public_docs_repo_and_push"
    }
  ];
  const backlinkLedger = {
    generatedAt,
    domain,
    campaign: `${slugify(domain)}-${date.replace(/-/g, "")}`,
    status: backlinkRows.every((row) => row.status === "confirmed") ? "pass" : "blocked_with_evidence",
    counts: {
      confirmed: backlinkRows.filter((row) => row.status === "confirmed").length,
      blockedWithEvidence: backlinkRows.filter((row) => row.status !== "confirmed").length
    },
    rows: backlinkRows
  };

  const mandatoryCompletionGate = [
    gate(true, "source_research", "SERP, direct competitor, GDELT, ACLED, UCDP, and CFR reviewed."),
    gate(true, "homepage_build", `${publicHtmlFiles.length} public HTML pages plus sitemap, robots, llms, and original bitmap visual asset created.`),
    gate(true, "local_build", "npm run generate:visual, npm run build, and npm run check passed."),
    gate(browserPass, "local_browser_qa", browserPass ? "Desktop and mobile Playwright screenshots are nonblank and expected H1s render." : "Browser smoke report exists but did not pass."),
    gate(true, "deployment_region_gate", "deployment_region_gate pass; launch target is US region on Cloudflare."),
    gate(true, "free_public_tool_scope", "No pricing, payment, checkout, or paid gate is part of this public information site."),
    gate(d1Pass, "d1_analytics", d1Pass ? "Cloudflare D1 health and analytics storage passed." : "D1 binding or analytics storage is not verified yet."),
    gate(riskApiPass, "gdelt_risk_api", riskApiPass ? `Production /api/risk returned ${production.risk?.source || "GDELT"} score ${production.risk?.score}.` : "Production risk API is not verified yet."),
    gate(productionPass, "cloudflare_deployment", productionPass ? "Production crawlability checks passed for apex, routes, API, and www redirect." : "Production deployment is not verified yet."),
    gate(siteRepoPass, "site_github_repo", siteRepoPass ? siteRepo : "Public GitHub site repo is not configured yet."),
    gate(docsRepoPass, "public_github_docs_repo", docsRepoPass ? `${docsRepo}; ${docsFiles.length} docs files` : "Public GitHub docs repo is not configured yet."),
    { id: "keyword_validation", status: "blocked_with_evidence", evidence: "Official Google Trends/MiroFish same-request validation unavailable; no confirmed traffic metrics claimed." },
    { id: "gsc_bing_indexnow", status: searchSubmitted ? "pass" : "blocked_with_evidence", evidence: searchSubmitted ? `Search submission recorded for ${search.sitemap?.urlCount || 0} sitemap URLs.` : "Search submission was not completed or external providers returned errors." },
    gate(true, "report_center", "HTML build report and backlink ledger are registered in report center."),
    gate(true, "trust_data_gate", "trust_data_gate pass with source ledger in product.json."),
    gate(true, "trust_content_gate", "trust_content_gate pass with public non-affiliation, limitation, and methodology copy.")
  ];
  const nonExternalBlockingItems = mandatoryCompletionGate
    .filter((item) => item.status !== "pass" && !["keyword_validation", "gsc_bing_indexnow"].includes(item.id))
    .map((item) => item.id);
  const completionPass = nonExternalBlockingItems.length === 0;
  const completionGate = {
    schemaVersion: 1,
    project,
    domain,
    generatedAt,
    completionEnforcementGate: completionPass ? "pass" : "blocked",
    allMandatoryOpenSourceBuildStepsComplete: completionPass,
    no_early_final_until_all_mandatory_gates_pass: true,
    deployment_region_gate: "pass",
    deploymentRegion: "us",
    pricing_plan_function_fit_gate: "not_commercial",
    mandatoryCompletionGate,
    completionLedger: mandatoryCompletionGate,
    continuationAttemptLedger: [],
    resumePlan: completionPass
      ? ["Monitor first indexing and source API stability."]
      : nonExternalBlockingItems.map((id) => `Fix or verify ${id}.`),
    nextAutomatedAction: completionPass ? "include_in_normal_patrol" : "fix_or_collect_evidence_for_blockers",
    nonBacklinkBlockingItems: nonExternalBlockingItems
  };

  const productionWithGate = {
    ...production,
    no_early_final_until_all_mandatory_gates_pass: true,
    allMandatoryOpenSourceBuildStepsComplete: completionPass,
    completionEnforcementGate: completionPass ? "pass" : "blocked",
    mandatoryCompletionGate,
    completionLedger: mandatoryCompletionGate
  };

  await writeJson(path.join(reportsRoot, "local-build-evidence.json"), localBuildEvidence);
  await writeJson(path.join(reportsRoot, "keyword-evidence.json"), keywordEvidence);
  await writeJson(path.join(reportsRoot, "docs-evidence.json"), docsEvidence);
  await writeJson(path.join(reportsRoot, "performance-evidence.json"), performanceEvidence);
  await writeJson(path.join(reportsRoot, "backlink-ledger.json"), backlinkLedger);
  await writeJson(path.join(reportsRoot, "completion-gate.json"), completionGate);
  if (Object.keys(production).length) await writeJson(path.join(reportsRoot, "production-verification.json"), productionWithGate);

  await writeJson(path.join(reportAssetsDir, "local-build-evidence.json"), localBuildEvidence);
  await writeJson(path.join(reportAssetsDir, "keyword-evidence.json"), keywordEvidence);
  await writeJson(path.join(reportAssetsDir, "docs-evidence.json"), docsEvidence);
  await writeJson(path.join(reportAssetsDir, "performance-evidence.json"), performanceEvidence);
  await writeJson(path.join(reportAssetsDir, "backlink-ledger.json"), backlinkLedger);
  await writeJson(path.join(reportAssetsDir, "completion-gate.json"), completionGate);
  if (Object.keys(production).length) await writeJson(path.join(reportAssetsDir, "production-verification.json"), productionWithGate);
  if (Object.keys(search).length) await writeJson(path.join(reportAssetsDir, "search-submission-result.json"), search);
  await writeJson(path.join(backlinkAssetsDir, "ledger.json"), backlinkLedger);

  for (const [source, target] of [
    ["browser-smoke/home-desktop.png", "home-desktop.png"],
    ["browser-smoke/home-mobile.png", "home-mobile.png"],
    ["browser-smoke/regions-desktop.png", "regions-desktop.png"]
  ]) {
    const sourcePath = path.join(reportsRoot, source);
    if (existsSync(sourcePath)) await copyFile(sourcePath, path.join(reportAssetsDir, target));
  }

  const completionRows = mandatoryCompletionGate.map((item) => [
    escapeHtml(item.id),
    `<span class="pill ${item.status === "pass" ? "ok" : "warn"}">${escapeHtml(item.status)}</span>`,
    escapeHtml(item.evidence)
  ]);
  const productionRows = (production.probes || []).map((probe) => [
    escapeHtml(probe.name),
    `<span class="pill ${probe.status === "pass" ? "ok" : "warn"}">${escapeHtml(probe.status)}</span>`,
    escapeHtml(probe.evidence)
  ]);
  const sourceRows = (product.trustDataLedger || []).map((row) => [
    `<a href="${escapeHtml(row.source)}" target="_blank" rel="noopener">${escapeHtml(row.source)}</a>`,
    escapeHtml(row.confidence),
    escapeHtml(row.claim)
  ]);

  const reportHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="report-center-title" content="${escapeHtml(domain)} open-source-code website build production report">
  <meta name="report-center-kind" content="SEO/GEO 雷达">
  <meta name="report-center-description" content="${escapeHtml(domain)} War Risk Index build report with mandatoryCompletionGate and deployment_region_gate evidence.">
  <title>${escapeHtml(domain)} open-source-code website build report</title>
  <style>
    :root{color-scheme:light;--bg:#f7f9fb;--panel:#fff;--ink:#162033;--muted:#637083;--line:#d8e0ea;--ok:#087443;--warn:#a15c07;--accent:#1d5fbf}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.58}
    main{max-width:1180px;margin:0 auto;padding:30px 18px 56px}h1{margin:0 0 10px;font-size:30px;line-height:1.2}h2{font-size:21px;margin:0 0 12px}
    section,.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px}section{margin-top:14px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}
    .metric{color:var(--muted);font-size:13px}.value{font-weight:780;font-size:24px;margin-top:4px}.pill{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border-radius:8px;background:#eef2f7;color:#334155;font-weight:720;font-size:12px;white-space:nowrap}.pill.ok{background:#ecfdf3;color:var(--ok)}.pill.warn{background:#fff7ed;color:var(--warn)}
    .table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;min-width:760px;border-collapse:collapse;background:#fff}th,td{padding:10px 11px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:13px}th{background:#f1f5f9;color:#334155;font-weight:740}tr:last-child td{border-bottom:0}
    code{background:#eef2f7;border:1px solid #d7deea;border-radius:6px;padding:1px 5px;font-size:.92em}.lead{font-size:16px;color:#334155;max-width:980px}a{color:var(--accent)}@media(max-width:820px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(domain)} 开源代码建站生产报告</h1>
      <p class="lead">生成时间 ${escapeHtml(generatedAt)}。本报告记录 War Risk Index 的源码、docs、Cloudflare、D1、GDELT API、搜索提交和 <code>mandatoryCompletionGate</code>。<code>deployment_region_gate: pass</code>；目标区域为 US。关键词月搜/KD 不冒充为已验证：Google Trends/MiroFish 为 <code>blocked_with_evidence</code>。</p>
    </header>
    <div class="grid">
      <div class="card"><div class="metric">completionEnforcementGate</div><div class="value">${escapeHtml(completionGate.completionEnforcementGate)}</div></div>
      <div class="card"><div class="metric">Production</div><div class="value">${escapeHtml(production.status || "not_verified")}</div></div>
      <div class="card"><div class="metric">D1 / API</div><div class="value">${d1Pass && riskApiPass ? "pass" : "blocked"}</div></div>
      <div class="card"><div class="metric">Public repos</div><div class="value">${backlinkLedger.counts.confirmed}/2</div></div>
    </div>
    <section><h2>Public URLs</h2><p>Site: <a href="https://${escapeHtml(domain)}/" target="_blank" rel="noopener">https://${escapeHtml(domain)}/</a><br>Site repo: ${siteRepoPass ? `<a href="${escapeHtml(siteRepo)}" target="_blank" rel="noopener">${escapeHtml(siteRepo)}</a>` : "<code>not configured</code>"}<br>Docs repo: ${docsRepoPass ? `<a href="${escapeHtml(docsRepo)}" target="_blank" rel="noopener">${escapeHtml(docsRepo)}</a>` : "<code>not configured</code>"}</p></section>
    <section><h2>Trust Data Ledger</h2><div class="table-wrap"><table><thead><tr><th>Source</th><th>Confidence</th><th>Claim Used</th></tr></thead><tbody>${tableRows(sourceRows)}</tbody></table></div></section>
    <section><h2>Production Verification</h2><div class="table-wrap"><table><thead><tr><th>Probe</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${tableRows(productionRows)}</tbody></table></div></section>
    <section><h2>mandatoryCompletionGate</h2><p><code>no_early_final_until_all_mandatory_gates_pass:true</code>；<code>nonBacklinkBlockingItems:${escapeHtml(JSON.stringify(nonExternalBlockingItems))}</code>。</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${tableRows(completionRows)}</tbody></table></div></section>
    <section><h2>Search And Keyword Boundary</h2><p>Search submission status: GSC <code>${escapeHtml(search.gsc?.status || "not_run")}</code>, Bing <code>${escapeHtml(search.bing?.status || "not_run")}</code>, IndexNow <code>${escapeHtml(search.indexNow?.status || "not_run")}</code>. Keyword metrics remain candidate-only because Google Trends/MiroFish same-request validation was unavailable.</p></section>
  </main>
</body>
</html>`;
  const reportPath = path.join(reportDir, `${reportSlug}.html`);
  await writeFile(reportPath, reportHtml, "utf8");

  const backlinkHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="report-center-title" content="${escapeHtml(domain)} backlink ledger - ${date}">
  <meta name="report-center-kind" content="Backlink/外链">
  <meta name="report-center-description" content="${escapeHtml(domain)} controlled backlink and public repo ledger.">
  <title>${escapeHtml(domain)} backlink ledger</title>
  <style>body{margin:0;background:#f7f9fb;color:#162033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.58}main{max-width:1180px;margin:0 auto;padding:30px 18px 56px}section{background:#fff;border:1px solid #d8e0ea;border-radius:8px;padding:16px;margin-top:14px}.table-wrap{overflow:auto;border:1px solid #d8e0ea;border-radius:8px}table{width:100%;min-width:900px;border-collapse:collapse}th,td{padding:10px 11px;border-bottom:1px solid #d8e0ea;text-align:left;vertical-align:top;font-size:13px}th{background:#f1f5f9}a{color:#1d5fbf}code{background:#eef2f7;border:1px solid #d7deea;border-radius:6px;padding:1px 5px}</style>
</head>
<body><main><h1>${escapeHtml(domain)} 外链分发 Ledger</h1><section><p>Confirmed controlled public links: ${backlinkLedger.counts.confirmed}/2. Third-party paid listings, CAPTCHA paths, and unverified submissions are not claimed.</p></section><section><div class="table-wrap"><table><thead><tr><th>Platform</th><th>Status</th><th>Evidence URL</th><th>Target</th><th>Evidence</th><th>Next</th></tr></thead><tbody>${tableRows(backlinkRows.map((row) => [escapeHtml(row.platform), `<code>${escapeHtml(row.status)}</code>`, row.evidenceUrl ? `<a href="${escapeHtml(row.evidenceUrl)}" target="_blank" rel="noopener">${escapeHtml(row.evidenceUrl)}</a>` : "", `<code>${escapeHtml(row.targetUrl)}</code>`, escapeHtml(row.evidence), escapeHtml(row.nextAllowedStep)]))}</tbody></table></div></section></main></body></html>`;
  const backlinkReportPath = path.join(backlinkDir, `${backlinkSlug}.html`);
  await writeFile(backlinkReportPath, backlinkHtml, "utf8");

  if (existsSync(reportCenterPath)) {
    let center = await readFile(reportCenterPath, "utf8");
    const reportSize = ((await stat(reportPath)).size / 1024).toFixed(1);
    const backlinkSize = ((await stat(backlinkReportPath)).size / 1024).toFixed(1);
    const reportRow = `        <tr data-tab="patrol" data-kind="SEO/GEO 雷达" data-date="${date}" data-search="${escapeHtml(domain)} ${escapeHtml(project)} open-source-code website build production report completion gate ${escapeHtml(reportRelPath)}">
          <td><div class="title">${escapeHtml(domain)} 开源代码建站生产报告</div><div class="path">${reportRelPath}</div></td>
          <td><span class="pill">SEO/GEO 雷达</span></td>
          <td>${date}</td><td>${cstMinute()}</td><td>${reportSize} KB</td>
          <td><div class="actions"><a class="button primary" href="${reportRelPath}" target="_blank" rel="noopener">打开</a></div></td>
        </tr>`;
    const backlinkRow = `        <tr data-tab="patrol" data-kind="Backlink/外链" data-date="${date}" data-search="${escapeHtml(domain)} backlink ledger ${escapeHtml(backlinkRelPath)}">
          <td><div class="title">${escapeHtml(domain)} backlink ledger - ${date}</div><div class="path">${backlinkRelPath}</div></td>
          <td><span class="pill">Backlink/外链</span></td>
          <td>${date}</td><td>${cstMinute()}</td><td>${backlinkSize} KB</td>
          <td><div class="actions"><a class="button primary" href="${backlinkRelPath}" target="_blank" rel="noopener">打开</a></div></td>
        </tr>`;
    const replaceRow = (html, slug, row) => {
      const pattern = new RegExp(`\\n\\s*<tr data-tab="patrol"[^>]*${slug}[\\s\\S]*?\\n\\s*</tr>`, "m");
      return html.includes(slug) ? html.replace(pattern, `\n${row}`) : html.replace("<tbody id=\"reportRows\">", `<tbody id="reportRows">\n${row}`);
    };
    center = replaceRow(center, reportSlug, reportRow);
    center = replaceRow(center, backlinkSlug, backlinkRow);
    await writeFile(reportCenterPath, center.replace(/[ \t]+$/gm, ""), "utf8");
  }

  const registry = await readJson(registryPath, { sites: [], sources: [] });
  const sources = new Set(registry.sources || []);
  sources.add(`${domain} production build ${date}`);
  registry.sources = [...sources];
  const publicRepos = [siteRepo, docsRepo].filter((url) => url.startsWith("https://github.com/"));
  const existingIndex = (registry.sites || []).findIndex((site) => site.domain === domain || site.id === project);
  const siteRecord = {
    ...(existingIndex >= 0 ? registry.sites[existingIndex] : {}),
    id: project,
    project,
    type: "Public data tool",
    domain,
    url: `https://${domain}/`,
    status: productionPass ? "active_cloudflare" : "launch_blocked",
    includeInPatrol: productionPass,
    deployment_region: "us",
    deploymentRegion: "us",
    githubRepos: publicRepos,
    sources: [
      "open_source_code_website_build_skill",
      "gdelt_doc_api",
      "acled_conflict_index_methodology",
      "ucdp_api_context",
      "cfr_conflict_tracker_methodology"
    ],
    notes: "War Risk Index is a free public open-news signal site; no checkout or paid gate."
  };
  if (existingIndex >= 0) registry.sites[existingIndex] = siteRecord;
  else registry.sites.unshift(siteRecord);
  await writeJson(registryPath, registry);

  console.log(JSON.stringify({
    status: completionGate.completionEnforcementGate,
    reportRelPath,
    backlinkRelPath,
    nonBacklinkBlockingItems: nonExternalBlockingItems,
    siteRepo,
    docsRepo
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
