import { handleBatchAttendance } from "./_lib/portalProxy.js";

// POST /api/batch/attendance is rewritten here by vercel.json.
export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  return handleBatchAttendance(req, res);
}
