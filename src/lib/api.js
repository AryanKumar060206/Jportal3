// Same-origin proxy (Vercel functions in /api, Vite dev middleware locally).
export const proxy_url = `${typeof window !== "undefined" ? window.location.origin : ""}/api/StudentPortalAPI`;
