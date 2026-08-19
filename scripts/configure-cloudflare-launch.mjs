#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reportsRoot = join(projectRoot, "reports");
const domain = "warriskindex.blog";
const canonicalHost = domain;
const wwwHost = `www.${domain}`;
const workerName = "warriskindex-blog-site";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "615b05ce6668dd8e0e2431077fc29c82";
const statusOnly = process.argv.includes("--status-only");
const activationCheckOnly = process.argv.includes("--activation-check");
const checkedAt = new Date().toISOString();

function keychain(service, account = "") {
  const args = ["find-generic-password", "-s", service, "-w"];
  if (account) args.splice(1, 0, "-a", account);
  try {
    return execFileSync("/usr/bin/security", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function envOrKey(name, alternatives = []) {
  const candidates = [name, ...alternatives];
  for (const candidate of candidates) {
    const envName = Array.isArray(candidate) ? candidate[0] : candidate;
    const value = String(process.env[envName] || "").trim();
    if (value) return value;
  }
  for (const candidate of candidates) {
    const value = Array.isArray(candidate) ? keychain(candidate[0], candidate[1]) : keychain(candidate);
    if (value) return value;
  }
  return "";
}

function wranglerOAuthToken() {
  const configPath = join(process.env.HOME || "", "Library/Preferences/.wrangler/config/default.toml");
  if (!existsSync(configPath)) return "";
  const text = readFileSync(configPath, "utf8");
  return text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1] || "";
}

function curlQuote(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r?\n/g, "\\n");
}

function curlJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const config = [
    `url = "${curlQuote(url)}"`,
    `request = "${curlQuote(method)}"`,
    "silent",
    "show-error",
    "location",
    "connect-timeout = 15",
    "max-time = 90",
    "retry = 2",
    "write-out = \"\\n__HTTP_STATUS__:%{http_code}\"",
    ...Object.entries(headers).map(([key, value]) => `header = "${curlQuote(`${key}: ${value}`)}"`)
  ];
  if (body != null) config.push(`data-binary = "${curlQuote(body)}"`);
  const text = execFileSync("curl", ["--config", "-"], {
    input: `${config.join("\n")}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024
  });
  const marker = "\n__HTTP_STATUS__:";
  const splitAt = text.lastIndexOf(marker);
  const rawBody = splitAt >= 0 ? text.slice(0, splitAt) : text;
  const status = splitAt >= 0 ? Number(text.slice(splitAt + marker.length).trim()) : 0;
  let data = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = { raw: rawBody };
  }
  return { ok: status >= 200 && status < 300, status, data };
}

function cloudflareCredentialCandidates() {
  const candidates = [];
  const legacyKey = envOrKey("CLOUDFLARE_API_KEY", [["CLOUDFLARE_API_KEY", "codex-env"], "CF_API_KEY", ["CF_API_KEY", "codex-env"]]);
  const email = envOrKey("CLOUDFLARE_EMAIL", ["CLOUDFLARE_API_EMAIL", ["CLOUDFLARE_EMAIL", "codex-env"]]);
  if (legacyKey && email) candidates.push({ label: "legacy-api-key", headers: { "X-Auth-Key": legacyKey, "X-Auth-Email": email } });
  for (const name of ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "CLOUDFLARE_TOKEN"]) {
    const value = envOrKey(name, [[name, "codex-env"]]);
    if (value) candidates.push({ label: `bearer:${name}`, headers: { Authorization: `Bearer ${value}` } });
  }
  const wranglerToken = wranglerOAuthToken();
  if (wranglerToken) candidates.push({ label: "wrangler-oauth-token", headers: { Authorization: `Bearer ${wranglerToken}` } });
  return candidates;
}

async function cloudflare(endpoint, init = {}) {
  const candidates = cloudflareCredentialCandidates();
  if (!candidates.length) throw new Error("Cloudflare credential unavailable");
  const failures = [];
  for (const candidate of candidates) {
    const response = curlJson(`https://api.cloudflare.com/client/v4${endpoint}`, {
      method: init.method || "GET",
      headers: {
        ...candidate.headers,
        "Content-Type": "application/json",
        ...(init.headers || {})
      },
      body: init.body ?? null
    });
    const payload = response.data;
    if (response.ok && payload.success !== false) return { result: payload.result, credentialMode: candidate.label };
    const message = payload.errors?.map((error) => error.message || error.code).join("; ") || payload.raw || `HTTP ${response.status}`;
    failures.push(`${candidate.label}:${response.status}:${message}`);
  }
  throw new Error(`Cloudflare API access failed: ${failures.join(" | ")}`);
}

function spaceshipCredentials() {
  return {
    key: envOrKey("SPACESHIP_API_KEY", [["SPACESHIP_API_KEY", "codex-env"]]),
    secret: envOrKey("SPACESHIP_API_SECRET", [["SPACESHIP_API_SECRET", "codex-env"]])
  };
}

async function spaceship(endpoint, init = {}) {
  const { key, secret } = spaceshipCredentials();
  if (!key || !secret) throw new Error("Spaceship credential unavailable");
  const response = curlJson(`https://spaceship.dev/api/v1${endpoint}`, {
    method: init.method || "GET",
    headers: {
      "X-API-Key": key,
      "X-API-Secret": secret,
      "Content-Type": "application/json",
      ...(init.headers || {})
    },
    body: init.body ?? null
  });
  const payload = response.data;
  if (!response.ok || payload.success === false) {
    const message = payload.errors?.map((error) => error.message || error.code).join("; ") || payload.message || payload.raw || `HTTP ${response.status}`;
    throw new Error(`Spaceship ${init.method || "GET"} ${response.status}: ${message}`);
  }
  return payload;
}

async function ensureZone() {
  const existing = await cloudflare(`/zones?name=${encodeURIComponent(domain)}&account.id=${encodeURIComponent(accountId)}&per_page=1`);
  if (existing.result?.[0]) return { zone: { ...existing.result[0], credentialMode: existing.credentialMode }, created: false };
  const created = await cloudflare("/zones", {
    method: "POST",
    body: JSON.stringify({
      account: { id: accountId },
      name: domain,
      type: "full",
      jump_start: false
    })
  });
  return { zone: { ...created.result, credentialMode: created.credentialMode }, created: true };
}

async function putZoneSetting(zoneId, id, value) {
  await cloudflare(`/zones/${zoneId}/settings/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ value })
  });
}

async function ensureDnsRecord(zoneId, host) {
  const records = await cloudflare(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(host)}&per_page=100`);
  const blocking = (records.result || []).filter((record) => (
    ["A", "AAAA", "CNAME"].includes(record.type) &&
    !(record.type === "A" && record.content === "192.0.2.1")
  ));
  if (blocking.length) throw new Error(`DNS conflict for ${host}: ${blocking.map((record) => record.type).join(", ")} record already exists`);
  const compatible = (records.result || []).find((record) => record.type === "A" && record.content === "192.0.2.1");
  const body = { type: "A", name: host, content: "192.0.2.1", ttl: 1, proxied: true };
  if (compatible) {
    if (!compatible.proxied) {
      await cloudflare(`/zones/${zoneId}/dns_records/${compatible.id}`, { method: "PATCH", body: JSON.stringify(body) });
      return { host, action: "proxied-existing" };
    }
    return { host, action: "existing" };
  }
  await cloudflare(`/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify(body) });
  return { host, action: "created" };
}

async function ensureWorkerRoute(zoneId, pattern) {
  const routes = await cloudflare(`/zones/${zoneId}/workers/routes?per_page=100`);
  const existing = (routes.result || []).find((route) => route.pattern === pattern);
  const body = JSON.stringify({ pattern, script: workerName });
  if (existing) {
    if (existing.script === workerName) return { pattern, action: "existing" };
    await cloudflare(`/zones/${zoneId}/workers/routes/${existing.id}`, { method: "PUT", body });
    return { pattern, action: "updated" };
  }
  await cloudflare(`/zones/${zoneId}/workers/routes`, { method: "POST", body });
  return { pattern, action: "created" };
}

async function updateRegistrarNameservers(zone) {
  const targetHosts = zone.name_servers || [];
  if (targetHosts.length < 2) return { action: "skipped", reason: "Cloudflare nameservers are not available yet" };
  let current;
  try {
    current = await spaceship(`/domains/${domain}`);
  } catch (error) {
    return { action: "blocked", reason: `Domain lookup failed: ${error.message}` };
  }
  const nameserverPayload = current.nameservers || current.result?.nameservers || [];
  const currentHosts = Array.isArray(nameserverPayload) ? nameserverPayload : nameserverPayload.hosts || [];
  const normalizedCurrent = currentHosts.map((item) => String(item).toLowerCase()).sort();
  const normalizedTarget = targetHosts.map((item) => String(item).toLowerCase()).sort();
  if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedTarget)) {
    return { action: "existing", hosts: targetHosts, previousHosts: currentHosts };
  }
  await spaceship(`/domains/${domain}/nameservers`, {
    method: "PUT",
    body: JSON.stringify({ provider: "custom", hosts: targetHosts })
  });
  return { action: "updated", hosts: targetHosts, previousHosts: currentHosts };
}

async function status(zone, created) {
  const zoneId = zone.id;
  const [dnsRows, routes, ssl, alwaysHttps, automaticHttpsRewrites, universalSsl, certificatePacks, sslVerification] = await Promise.all([
    cloudflare(`/zones/${zoneId}/dns_records?per_page=100`),
    cloudflare(`/zones/${zoneId}/workers/routes?per_page=100`),
    cloudflare(`/zones/${zoneId}/settings/ssl`),
    cloudflare(`/zones/${zoneId}/settings/always_use_https`),
    cloudflare(`/zones/${zoneId}/settings/automatic_https_rewrites`),
    cloudflare(`/zones/${zoneId}/ssl/universal/settings`).catch((error) => ({ result: { error: error.message } })),
    cloudflare(`/zones/${zoneId}/ssl/certificate_packs?per_page=100`).catch((error) => ({ result: [{ status: "unavailable", error: error.message }] })),
    cloudflare(`/zones/${zoneId}/ssl/verification`).catch((error) => ({ result: [{ certificate_status: "unavailable", error: error.message }] }))
  ]);
  return {
    checkedAt,
    domain,
    workerName,
    zoneCreated: created,
    zoneStatus: zone.status,
    cloudflareCredentialMode: zone.credentialMode,
    nameservers: zone.name_servers || [],
    ssl: ssl.result?.value || "",
    alwaysUseHttps: alwaysHttps.result?.value || "",
    automaticHttpsRewrites: automaticHttpsRewrites.result?.value || "",
    universalSsl: universalSsl.result || {},
    certificatePacks: (Array.isArray(certificatePacks.result) ? certificatePacks.result : []).map((pack) => ({
      id: pack.id || "",
      type: pack.type || "",
      status: pack.status || "",
      validationMethod: pack.validation_method || "",
      hosts: pack.hosts || [],
      error: pack.error || ""
    })),
    sslVerification: (Array.isArray(sslVerification.result) ? sslVerification.result : []).map((entry) => ({
      certificateStatus: entry.certificate_status || "",
      validationMethod: entry.validation_method || "",
      verificationStatus: entry.verification_status ?? null,
      brandCheck: entry.brand_check ?? null,
      certPackUuid: entry.cert_pack_uuid || "",
      error: entry.error || ""
    })),
    dns: (dnsRows.result || []).filter((record) => [canonicalHost, wwwHost].includes(record.name)).map((record) => ({
      name: record.name,
      type: record.type,
      content: record.content,
      proxied: record.proxied
    })),
    routes: (routes.result || []).filter((route) => route.pattern.includes(domain)).map((route) => ({
      pattern: route.pattern,
      script: route.script
    }))
  };
}

async function triggerActivationCheck(zone) {
  const activation = await cloudflare(`/zones/${zone.id}/activation_check`, { method: "PUT" });
  const report = {
    ...(await status(zone, false)),
    activationCheck: {
      status: "triggered",
      resultId: activation.result?.id || "",
      credentialMode: activation.credentialMode,
      note: "Cloudflare activation check can be retriggered every hour on free zones."
    }
  };
  await writeFile(join(reportsRoot, "cloudflare-launch.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  await mkdir(reportsRoot, { recursive: true });
  const { zone, created } = await ensureZone();
  if (activationCheckOnly) {
    await triggerActivationCheck(zone);
    return;
  }
  if (statusOnly) {
    const report = await status(zone, created);
    await writeFile(join(reportsRoot, "cloudflare-launch.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const zoneId = zone.id;
  await Promise.all([
    putZoneSetting(zoneId, "ssl", "full"),
    putZoneSetting(zoneId, "always_use_https", "on"),
    putZoneSetting(zoneId, "automatic_https_rewrites", "on")
  ]);
  const dnsActions = [
    await ensureDnsRecord(zoneId, canonicalHost),
    await ensureDnsRecord(zoneId, wwwHost)
  ];
  const routeActions = [
    await ensureWorkerRoute(zoneId, `${canonicalHost}/*`),
    await ensureWorkerRoute(zoneId, `${wwwHost}/*`)
  ];
  const registrar = await updateRegistrarNameservers(zone);
  const report = {
    ...(await status(zone, created)),
    dnsActions,
    routeActions,
    registrar
  };
  await writeFile(join(reportsRoot, "cloudflare-launch.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
