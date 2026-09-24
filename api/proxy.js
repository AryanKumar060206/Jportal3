import { handleProxy } from "./_lib/portalProxy.js";

// /api/StudentPortalAPI/* is rewritten here by vercel.json.
export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  return handleProxy(req, res);
}
