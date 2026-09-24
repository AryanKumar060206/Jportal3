// Shared same-origin proxy to the JIIT WebPortal API.
// Used by the Vercel functions in /api and by the Vite dev server (vite.config.js),
// so local development exercises exactly the same code path as production.

const BACKEND_BASE = "https://webportal.jiit.ac.in:6011";
const MAX_BATCH_CALLS = 25;

const FORWARDED_HEADERS = [
  "authorization",
  "localname",
  "content-type",
  "accept",
  "user-agent",
  "accept-language",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "dnt",
];

const PASSTHROUGH_RESPONSE_HEADERS = ["content-type", "content-disposition"];

// Only data endpoints under StudentPortalAPI are proxied. Login/token endpoints are
// deliberately blocked: authentication happens on the official portal via Google SSO.
export function sanitizePath(rawPath) {
  const p = String(rawPath || "").replace(/^\/+/, "");
  if (!p.startsWith("StudentPortalAPI/")) return null;
  if (!/^[A-Za-z0-9_\-./]+$/.test(p)) return null;
  if (p.includes("..") || p.includes("//")) return null;
  if (/^StudentPortalAPI\/token\//i.test(p)) return null;
  return p;
}

function buildBackendHeaders(source) {
  const get = (k) => {
    if (!source) return undefined;
    if (typeof source.get === "function") return source.get(k);
    const hit = Object.keys(source).find((key) => key.toLowerCase() === k);
    return hit !== undefined ? source[hit] : undefined;
  };
  const headers = new Headers();
  for (const k of FORWARDED_HEADERS) {
    const v = get(k);
    if (v !== undefined && v !== null && v !== "") headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  headers.set("Origin", BACKEND_BASE);
  headers.set("Referer", `${BACKEND_BASE}/`);
  return headers;
}

export async function proxyRequest({ method, path, search = "", headers, body }) {
  const safePath = sanitizePath(path);
  if (!safePath) {
    return jsonResult(400, { error: "Path not allowed" });
  }
  const upperMethod = (method || "GET").toUpperCase();
  const outHeaders = buildBackendHeaders(headers);
  const init = { method: upperMethod, headers: outHeaders, redirect: "manual" };
  if (upperMethod !== "GET" && upperMethod !== "HEAD" && body !== undefined && body !== null && body.length !== 0) {
    init.body = body;
  }
  const resp = await fetch(`${BACKEND_BASE}/${safePath}${search || ""}`, init);
  const outResponseHeaders = {};
  for (const k of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = resp.headers.get(k);
    if (v) outResponseHeaders[k] = v;
  }
  if (!outResponseHeaders["content-type"]) outResponseHeaders["content-type"] = "application/json";
  const buf = Buffer.from(await resp.arrayBuffer());
  return { status: resp.status, headers: outResponseHeaders, body: buf };
}

// Runs several attendance calls in parallel and returns them in one response.
// Request: { calls: [{ path, method, body, key, headers }] }
export async function batchAttendance({ body, headers }) {
  let parsed;
  try {
    parsed = JSON.parse(body ? body.toString("utf8") : "{}");
  } catch {
    return jsonResult(400, { error: "Invalid JSON" });
  }
  const calls = Array.isArray(parsed.calls) ? parsed.calls.slice(0, MAX_BATCH_CALLS) : [];

  const responses = await Promise.all(
    calls.map(async (call) => {
      try {
        const callHeaders = { ...lowerKeys(headers), ...lowerKeys(call.headers) };
        const callBody = call.body === undefined || call.body === null ? null : JSON.stringify(call.body);
        if (callBody !== null && !callHeaders["content-type"]) callHeaders["content-type"] = "application/json";
        const res = await proxyRequest({
          method: call.method || "POST",
          path: call.path,
          headers: callHeaders,
          body: callBody,
        });
        const text = res.body.toString("utf8");
        let parsedBody;
        try { parsedBody = JSON.parse(text); } catch { parsedBody = text; }
        return { ok: res.status >= 200 && res.status < 300, status: res.status, body: parsedBody, key: call.key };
      } catch (err) {
        return { ok: false, status: 502, statusText: "call_failed", key: call.key, body: { error: String(err?.message || err) } };
      }
    }),
  );

  return jsonResult(200, { responses });
}

function lowerKeys(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v;
  return out;
}

function jsonResult(status, obj) {
  return { status, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(obj)) };
}

// ---- Node (req, res) adapters shared by Vercel functions and the Vite dev middleware ----

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

function send(res, result) {
  res.statusCode = result.status;
  for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v);
  res.setHeader("cache-control", "no-store");
  res.end(result.body);
}

function sendError(res, err) {
  send(res, jsonResult(502, { error: "Proxy error", details: String(err?.message || err) }));
}

// Only this app's own pages may use the proxy. Browsers mark cross-site requests with
// Sec-Fetch-Site and Origin, and other sites can't forge those, so this stops other
// websites from relaying through us. (Non-browser clients can still fake headers, but
// they need a valid JIIT token of their own to get anything back.)
export function isSameOriginRequest(req) {
  const get = (k) => {
    const v = req.headers?.[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const fetchSite = get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = get("origin");
  if (origin) {
    const host = String(get("x-forwarded-host") || get("host") || "").split(",")[0].trim().toLowerCase();
    try {
      if (new URL(origin).host.toLowerCase() !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function rejectCrossOrigin(res) {
  send(res, jsonResult(403, { error: "Cross-origin requests are not allowed" }));
}

export async function handleProxy(req, res) {
  if (!isSameOriginRequest(req)) return rejectCrossOrigin(res);
  try {
    const url = new URL(req.url, "http://localhost");
    let path;
    const prefix = "/api/StudentPortalAPI/";
    if (url.pathname.startsWith(prefix)) {
      path = "StudentPortalAPI/" + url.pathname.slice(prefix.length);
    } else {
      path = "StudentPortalAPI/" + (url.searchParams.get("path") || "");
    }
    url.searchParams.delete("path");
    const search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
    const body = req.method === "GET" || req.method === "HEAD" ? null : await readRawBody(req);
    send(res, await proxyRequest({ method: req.method, path, search, headers: req.headers, body }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBatchAttendance(req, res) {
  if (!isSameOriginRequest(req)) return rejectCrossOrigin(res);
  try {
    if (req.method !== "POST") {
      send(res, jsonResult(405, { error: "Method not allowed" }));
      return;
    }
    const body = await readRawBody(req);
    send(res, await batchAttendance({ body, headers: req.headers }));
  } catch (err) {
    sendError(res, err);
  }
}
