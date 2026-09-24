// Token-based session for the Google-SSO WebPortal.
//
// Flow: the student signs in on the official WebPortal with Google, then a bookmarklet
// (or console snippet) running on that page reads the session the portal already stored
// in its own localStorage and hands it to this app via the URL hash (#/connect?token=...).
// Nothing here talks to the SSO or token endpoints.

import { setUsername, removeUsername } from "@/components/scripts/cache";

export const WEBPORTAL_URL = "https://webportal.jiit.ac.in:6011/studentportal/#/";
export const SESSION_EXPIRED_EVENT = "jportal:session-expired";

const STORAGE_KEY = "jp_portal_session";
const INSTITUTE_62 = "11IN1902J000001";
const INSTITUTE_128 = "11IN1902J000003";

const isUsableId = (v) => v !== undefined && v !== null && String(v).trim().length > 1 && !["S", "Student"].includes(String(v).trim());

export function decodeJwt(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isTokenExpired(token, skewMs = 60_000) {
  const claims = decodeJwt(token);
  if (!claims) return true;
  if (!claims.exp) return false;
  return Date.now() >= claims.exp * 1000 - skewMs;
}

export function tokenExpiry(token) {
  const claims = decodeJwt(token);
  return claims?.exp ? new Date(claims.exp * 1000) : null;
}

// Accepts "token=...&enroll=...", a full URL containing those params (query or hash),
// JSON like {"token": "..."}, or a bare JWT.
export function parseHandoff(input) {
  const empty = { token: "", enroll: "", inst: "", memberid: "", clientid: "", name: "" };
  if (!input) return empty;
  const text = String(input).trim();
  const clean = (t) => String(t || "").replace(/^Bearer\s+/i, "").trim();

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const o = JSON.parse(text);
      return {
        token: clean(o.token || o.Token),
        enroll: String(o.enroll || o.enrollment || o.RegistrationNo || o.registrationno || "").trim(),
        inst: String(o.inst || o.instituteid || o.instituteId || "").trim(),
        memberid: String(o.mid || o.memberid || o.MemberId || o.studentid || "").trim(),
        clientid: String(o.cid || o.clientid || "").trim(),
        name: String(o.name || "").trim(),
      };
    } catch {
      return empty;
    }
  }

  if (text.includes("token=")) {
    const query = text.slice(text.indexOf("?") >= 0 && text.indexOf("?") < text.indexOf("token=") ? text.indexOf("?") + 1 : text.indexOf("token="));
    const p = new URLSearchParams(query);
    return {
      token: clean(p.get("token")),
      enroll: (p.get("enroll") || p.get("enrollment") || "").trim(),
      inst: (p.get("inst") || "").trim(),
      memberid: (p.get("mid") || "").trim(),
      clientid: (p.get("cid") || "").trim(),
      name: (p.get("name") || "").trim(),
    };
  }

  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(clean(text))) {
    return { ...empty, token: clean(text) };
  }
  return empty;
}

function guessInstitute(enroll) {
  return String(enroll || "").startsWith("99") ? INSTITUTE_128 : INSTITUTE_62;
}

// Normalises handoff data into what we persist and what WebPortalSession needs.
export function normaliseSessionData(data) {
  const claims = decodeJwt(data.token) || {};
  // `sub` is deliberately not used: on the SSO token it's opaque, not the studentid.
  const claimMember = [claims.MemberId, claims.memberid, claims.studentid].find(isUsableId);
  const claimEnroll = [claims.enrollmentno, claims.RegistrationNo, claims.registrationno, claims.username, claims.userName].find(isUsableId);
  const enroll = String(data.enroll || claimEnroll || "").trim().toUpperCase();
  return {
    token: data.token,
    enroll,
    inst: data.inst || claims.instituteid || guessInstitute(enroll),
    memberid: [data.memberid, claimMember].find(isUsableId) || enroll,
    clientid: data.clientid || claims.clientid || "JIIT",
    name: data.name || claims.name || enroll || "Student",
    memberidVerified: !!data.memberidVerified,
  };
}

export function buildSession(WebPortalSession, data) {
  const d = normaliseSessionData(data);
  return new WebPortalSession({
    regdata: {
      institutelist: [{ label: "JIIT", value: d.inst }],
      memberid: d.memberid,
      userid: d.enroll,
      token: d.token,
      clientid: d.clientid,
      membertype: "S",
      name: d.name,
      enrollmentno: d.enroll,
    },
  });
}

export function saveTokenSession(data) {
  const d = normaliseSessionData(data);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // storage unavailable: session lives only in memory
  }
  if (d.enroll) setUsername(d.enroll);
  return d;
}

export function loadTokenSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.token ? d : null;
  } catch {
    return null;
  }
}

export function clearTokenSession({ keepUsername = true } = {}) {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("password");
  } catch {
    // ignore
  }
  if (!keepUsername) removeUsername();
}

// Reads a #/connect?token=... handoff from the current URL, saves it, and scrubs the
// token from the address bar and history. Returns the saved data or null.
export function consumeHandoffFromLocation() {
  try {
    const hash = window.location.hash || "";
    if (!hash.startsWith("#/connect") || !hash.includes("token=")) return null;
    const data = parseHandoff(hash);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
    if (!data.token) return null;
    return { ...data, expired: isTokenExpired(data.token) };
  } catch {
    return null;
  }
}

// The SSO token's `sub` is an opaque value, not the portal's studentid. Attendance
// endpoints don't need a studentid but every attendance row carries it, so read it from
// the latest (then previous) semester's attendance.
async function findStudentIdFromAttendance(w) {
  const meta = await w.get_attendance_meta();
  const header = meta.latest_header();
  for (const sem of meta.semesters.slice(0, 2)) {
    try {
      const att = await w.get_attendance(header, sem);
      const row = (att?.studentattendancelist || []).find((r) => isUsableId(r?.studentid));
      if (row) return String(row.studentid);
    } catch {
      // no attendance for this semester yet; try the previous one
    }
  }
  return null;
}

// Fill in the real studentid (memberid), name and enrollment once connected. The result
// is persisted, so later restores skip the lookup.
export async function repairFromProfile(w) {
  if (!w?.session) return null;
  const s = w.session;
  const stored = loadTokenSession();
  const info = await w.get_personal_info();
  const g = info?.generalinformation || {};
  const enroll = [g.registrationno, g.enrollmentno].find(isUsableId);
  const name = g.studentname || g.name;
  if (enroll) s.enrollmentno = enroll;
  if (name) s.name = name;

  let verified = false;
  if (stored?.memberidVerified && isUsableId(stored.memberid)) {
    s.memberid = stored.memberid;
    verified = true;
  } else {
    const memberid = [g.studentid, g.memberid].find(isUsableId) || (await findStudentIdFromAttendance(w).catch(() => null));
    if (memberid) {
      s.memberid = memberid;
      verified = true;
    } else {
      console.warn("Could not determine studentid; grades overview and fee pages may not load.");
    }
  }

  if (stored && stored.token === s.token) {
    saveTokenSession({
      ...stored,
      memberid: s.memberid,
      memberidVerified: verified,
      enroll: s.enrollmentno || stored.enroll,
      name: s.name,
    });
  }
  return info;
}

// Dispatches SESSION_EXPIRED_EVENT when the portal rejects the token (HTTP 401) on any
// request made through our proxy. jsjiit wraps 401s into a generic APIError, so we watch
// the responses directly.
let watcherInstalled = false;
export function installSessionWatcher(proxyBase) {
  if (watcherInstalled || typeof window === "undefined" || !window.fetch) return;
  watcherInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (response.status === 401 && url.startsWith(proxyBase)) {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
    } catch {
      // ignore
    }
    return response;
  };
}

// Code that runs on the WebPortal page. It only reads what the portal already stored for
// the signed-in student; the result is handed to this app (redirect) or copied (snippet).
function portalReaderSource(finish) {
  return (
    "(function(){try{" +
    "var t=localStorage.getItem('Token');" +
    "if(!t||t.length<20){alert('Sign in to WebPortal with Google first, then run this again.');return;}" +
    "t=t.replace(/^Bearer\\s+/i,'').replace(/^\"|\"$/g,'');" +
    "var u={};try{u=JSON.parse(localStorage.getItem('User')||'{}')||{};}catch(x){}" +
    "var pick=function(){for(var i=0;i<arguments.length;i++){var v=arguments[i];if(v!==undefined&&v!==null&&String(v).length>1&&v!=='Student')return String(v);}return '';};" +
    "var e=pick(u.RegistrationNo,u.registrationno,u.EnrollmentNo,u.enrollmentno,localStorage.getItem('enrollmentno'),u.userName);" +
    "var i=pick(localStorage.getItem('instituteid'),u.instituteid,u.InstituteId);" +
    "var m=pick(u.MemberId,u.memberid,u.studentid,u.StudentId);" +
    "var c=pick(u.clientid,u.ClientId,localStorage.getItem('clientid'));" +
    "var n=pick(u.name,u.Name,u.studentname);" +
    "var q='token='+encodeURIComponent(t);" +
    "if(e)q+='&enroll='+encodeURIComponent(e);if(i)q+='&inst='+encodeURIComponent(i);" +
    "if(m)q+='&mid='+encodeURIComponent(m);if(c)q+='&cid='+encodeURIComponent(c);if(n)q+='&name='+encodeURIComponent(n);" +
    finish +
    "}catch(err){alert('Jportal3 sync error: '+err.message);}})()"
  );
}

export function getBookmarkletHref(appOrigin) {
  const target = `${String(appOrigin).replace(/\/$/, "")}/#/connect?`;
  return "javascript:" + portalReaderSource(`location.href=${JSON.stringify(target)}+q;`);
}

export function getConsoleSnippet() {
  return portalReaderSource("copy(q);console.log('Jportal3: sync text copied to clipboard. Paste it into Jportal3.');");
}
