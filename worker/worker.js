/**
 * Audiology Simulator — Cloudflare Worker
 *
 * Proxies requests to the Anthropic API.
 * Requires environment variables:
 *   ANTHROPIC_API_KEY  — your Anthropic API key
 *   SESSION_TOKEN      — password students enter to use the app
 *
 * Optional:
 *   ALLOWED_ORIGIN     — your GitHub Pages URL (e.g. https://your-org.github.io)
 *                        Leave empty to allow all origins (fine for internal use)
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    if (request.method !== 'POST') {
      return corsResponse('Method not allowed', 405, env);
    }

    // Validate session token
    const token = request.headers.get('X-Session-Token');
    if (!token || token !== env.SESSION_TOKEN) {
      return corsResponse('Unauthorised', 401, env);
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse('Invalid JSON body', 400, env);
    }

    // Forward to Anthropic
    let anthropicResponse;
    try {
      anthropicResponse = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return corsResponse('Upstream error: ' + err.message, 502, env);
    }

    const data = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      return corsResponse(
        JSON.stringify(data),
        anthropicResponse.status,
        env,
        'application/json'
      );
    }

    return corsResponse(JSON.stringify(data), 200, env, 'application/json');
  }
};

function getAllowedOrigin(env) {
  return env.ALLOWED_ORIGIN || '*';
}

function corsResponse(body, status, env, contentType = 'text/plain') {
  const headers = {
    'Access-Control-Allow-Origin': getAllowedOrigin(env),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
    'Content-Type': contentType,
  };
  return new Response(body, { status, headers });
}
