// Same-origin proxy (Vercel functions in /api, Vite dev middleware locally).
// Must be absolute: Attendance.jsx derives the batch endpoint from its origin.
export const proxy_url = `${typeof window !== "undefined" ? window.location.origin : ""}/api/StudentPortalAPI`;
