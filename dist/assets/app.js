const SITE_DOMAIN = "warriskindex.blog";
const API_TIMEOUT_MS = 18000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function text(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "0";
}

function regionTemplate(region) {
  const score = clamp(Number(region.score || 0), 0, 100);
  const width = `${score}%`;
  return `
    <article class="region-card" data-region-card="${region.slug}">
      <div class="region-top">
        <div>
          <h3>${region.label}</h3>
          <span class="label">${region.level || "Pending"}</span>
        </div>
        <div class="region-score">${score}</div>
      </div>
      <div class="bar" aria-hidden="true"><span style="width:${width}"></span></div>
      <p>${region.summary || region.focus || "Open-news signal pending."}</p>
    </article>
  `;
}

function articleTemplate(article) {
  const title = article.title || "Source article";
  const url = article.url || "#";
  const domain = article.domain || "";
  const date = article.seenDate || article.seendate || "";
  return `
    <li>
      <a href="${url}" target="_blank" rel="noopener">
        ${title}
        <small>${[domain, date].filter(Boolean).join(" - ")}</small>
      </a>
    </li>
  `;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function setSelected(slug) {
  $$("[data-region]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.region === slug));
  });
}

function renderActive(region) {
  if (!region) return;
  setSelected(region.slug);
  text("#active-region", region.label || "Global composite");
  text("#active-score", String(clamp(Number(region.score || 0), 0, 100)));
  text("#active-level", region.level || "Pending");
  text("#active-summary", region.summary || region.focus || "Open-news signal pending.");
  text("#active-volume", formatNumber(region.totalArticles));
  text("#active-momentum", `${Number(region.momentumPct || 0).toFixed(1)}%`);
  text("#active-sources", formatNumber(region.sourceCount));
  text("#active-window", region.window || "30d");
  const articles = Array.isArray(region.articles) ? region.articles.slice(0, 5) : [];
  const list = $("#source-articles");
  if (list) {
    list.innerHTML = articles.length
      ? articles.map(articleTemplate).join("")
      : "<li><span class=\"status-note\">No article list returned for this signal window.</span></li>";
  }
}

function renderAll(payload) {
  const regions = Array.isArray(payload.regions) ? payload.regions : [];
  const grid = $("#region-grid");
  if (grid) grid.innerHTML = regions.map(regionTemplate).join("");
  const active = regions.find((region) => region.slug === "global") || regions[0];
  renderActive(active);
  text("#source-state", payload.source || "GDELT DOC 2.0");
  text("#updated-at", payload.generatedAt ? new Date(payload.generatedAt).toLocaleString("en-US", { timeZoneName: "short" }) : "Live source pending");
  text("#api-state", payload.cached ? "Cached open-news signal" : "Live open-news signal");
}

async function loadDashboard() {
  const status = $("#dashboard-status");
  if (status) status.textContent = "Loading live open-news signal...";
  try {
    const payload = await fetchJson("/api/risk?all=1");
    renderAll(payload);
    if (status) status.textContent = payload.cached ? "Serving the latest stored snapshot." : "Live signal refreshed.";
  } catch (error) {
    if (status) status.textContent = `Live source unavailable: ${error.message}`;
  }
}

async function loadRegion(slug) {
  const status = $("#dashboard-status");
  if (status) status.textContent = "Refreshing selected region...";
  try {
    const payload = await fetchJson(`/api/risk?slug=${encodeURIComponent(slug)}`);
    renderActive(payload.region);
    if (status) status.textContent = payload.cached ? "Stored snapshot loaded." : "Live region signal refreshed.";
  } catch (error) {
    if (status) status.textContent = `Region signal unavailable: ${error.message}`;
  }
}

async function loadCustom(query) {
  const status = $("#dashboard-status");
  if (status) status.textContent = "Reading custom open-news signal...";
  try {
    const payload = await fetchJson(`/api/risk?query=${encodeURIComponent(query)}&label=${encodeURIComponent(query)}`);
    renderActive(payload.region);
    if (status) status.textContent = "Custom signal refreshed.";
  } catch (error) {
    if (status) status.textContent = `Custom signal unavailable: ${error.message}`;
  }
}

function visitorId() {
  const key = "wri_visitor_id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function sessionId() {
  const key = "wri_session_id";
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(key, value);
  }
  return value;
}

function postAnalytics(eventName, metadata = {}) {
  fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventName,
      path: location.pathname,
      visitorId: visitorId(),
      sessionId: sessionId(),
      referrer: document.referrer,
      referrerHost: document.referrer ? new URL(document.referrer).hostname : "",
      utmSource: new URLSearchParams(location.search).get("utm_source") || "",
      utmMedium: new URLSearchParams(location.search).get("utm_medium") || "",
      utmCampaign: new URLSearchParams(location.search).get("utm_campaign") || "",
      metadata: {
        ...metadata,
        domain: SITE_DOMAIN,
        viewport: { width: innerWidth, height: innerHeight }
      }
    })
  }).catch(() => {});
}

function bindDashboard() {
  $$("[data-region]").forEach((button) => {
    button.addEventListener("click", () => {
      const slug = button.dataset.region;
      postAnalytics("region_selected", { slug });
      loadRegion(slug);
    });
  });

  const form = $("#custom-signal-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = String(new FormData(form).get("query") || "").trim();
      if (!query) return;
      postAnalytics("custom_signal_submitted", { query });
      loadCustom(query);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindDashboard();
  postAnalytics("page_view");
  if ($("#region-grid") || $("#active-score")) loadDashboard();
});
