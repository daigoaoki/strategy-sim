// Vercel serverless function: proxy Yahoo Finance chart API (avoids browser CORS).
// Usage: /api/quote?url=<encoded yahoo chart url>
// Only Yahoo finance hosts are allowed.
export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).json({ error: 'missing url' });
    return;
  }
  let u;
  try { u = new URL(target); } catch (e) {
    res.status(400).json({ error: 'bad url' });
    return;
  }
  if (!/(^|\.)finance\.yahoo\.com$/.test(u.hostname)) {
    res.status(403).json({ error: 'host not allowed' });
    return;
  }
  try {
    const r = await fetch(u.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sim-proxy/1.0)' },
    });
    const body = await r.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
