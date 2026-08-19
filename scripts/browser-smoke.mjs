import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const reportsRoot = "reports/browser-smoke";
const baseUrl = String(process.env.WRI_BROWSER_BASE_URL || "http://127.0.0.1:4179").replace(/\/$/, "");
const serverNeeded = baseUrl.startsWith("http://127.0.0.1:4179") && !process.env.WRI_EXTERNAL_SERVER;
await mkdir(reportsRoot, { recursive: true });

let server = null;
if (serverNeeded) {
  server = spawn("node", ["scripts/serve.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "4179" }
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function h1(html) {
  return stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
}

async function readPage(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(15000)
  });
  return { response, html: await response.text() };
}

try {
  const home = await readPage("/");
  const methodology = await readPage("/methodology/");
  const regions = await readPage("/regions/");
  const screenshots = [
    ["--viewport-size=1440,1100", `${baseUrl}/`, join(reportsRoot, "home-desktop.png")],
    ["--viewport-size=390,1200", `${baseUrl}/`, join(reportsRoot, "home-mobile.png")],
    ["--viewport-size=1440,1000", `${baseUrl}/regions/`, join(reportsRoot, "regions-desktop.png")]
  ];
  for (const [viewport, url, out] of screenshots) {
    execFileSync("npx", ["playwright", "screenshot", viewport, "--wait-for-timeout=3500", url, out], {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024
    });
  }
  const files = {};
  for (const [, , out] of screenshots) {
    const buffer = await readFile(out);
    files[out] = { bytes: buffer.length, nonBlank: buffer.length > 10000 };
  }
  const report = {
    status: "pass",
    result: "Local browser smoke passed for homepage, methodology, regions, desktop and mobile screenshots.",
    checkedAt: new Date().toISOString(),
    baseUrl,
    pages: [
      { path: "/", status: home.response.status, h1: h1(home.html), pass: home.response.ok && h1(home.html) === "War Risk Index" },
      { path: "/methodology/", status: methodology.response.status, h1: h1(methodology.html), pass: methodology.response.ok && h1(methodology.html) === "War Risk Index methodology" },
      { path: "/regions/", status: regions.response.status, h1: h1(regions.html), pass: regions.response.ok && h1(regions.html) === "War Risk Index regions" }
    ],
    screenshots: files
  };
  if (!report.pages.every((page) => page.pass) || !Object.values(files).every((file) => file.nonBlank)) {
    report.status = "fail";
    report.result = "Browser smoke found a failing page or blank screenshot.";
  }
  await writeFile(join(reportsRoot, "browser-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile("reports/in-app-browser-flow.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, baseUrl, screenshots: files }, null, 2));
  if (report.status !== "pass") process.exit(1);
} catch (error) {
  const report = {
    status: "blocked_with_evidence",
    result: "Browser smoke could not complete.",
    checkedAt: new Date().toISOString(),
    baseUrl,
    error: error.message
  };
  await writeFile(join(reportsRoot, "browser-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile("reports/in-app-browser-flow.json", `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
} finally {
  if (server && !server.killed) server.kill("SIGTERM");
}
