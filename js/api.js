// Cloudflare Worker proxy — holds the Anthropic API key server-side

const SESSION_TOKEN_KEY = 'audiology-sim-session-token';
const PROXY_URL_KEY = 'audiology-sim-proxy-url';
const DEFAULT_PROXY_URL = 'https://audiology-sim.mpsanders.workers.dev';

export function getSessionToken() {
  return sessionStorage.getItem(SESSION_TOKEN_KEY) || '';
}

export function setSessionToken(token) {
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function getProxyUrl() {
  return localStorage.getItem(PROXY_URL_KEY) || DEFAULT_PROXY_URL;
}

export function setProxyUrl(url) {
  localStorage.setItem(PROXY_URL_KEY, url);
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

/**
 * Send a chat message to the patient AI via the Cloudflare Worker proxy.
 * @param {string} systemPrompt - The patient system prompt
 * @param {Array} messages - [{role, content}] conversation history
 * @returns {Promise<string>} - The patient's reply
 */
export async function sendMessage(systemPrompt, messages) {
  const proxyUrl = getProxyUrl();
  const sessionToken = getSessionToken();

  if (!proxyUrl) throw new Error('Proxy URL not configured. Please set it in settings.');
  if (!sessionToken) throw new Error('No session token. Please enter your session password.');

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': sessionToken
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages
    })
  });

  if (response.status === 401) throw new Error('Invalid session token. Ask your teacher for the correct password.');
  if (response.status === 429) throw new Error('Too many requests. Please wait a moment.');
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Server error (${response.status})${text ? ': ' + text : ''}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

/**
 * Request an AI review of a completed history-taking session.
 * @param {string} patientName
 * @param {Array} conversation - [{role, content}]
 * @param {Array} covered - section keys covered
 * @param {Array} missed - section keys missed
 * @returns {Promise<string>}
 */
export async function getAiReview(patientName, conversation, covered, missed) {
  const transcript = conversation
    .map(m => `${m.role === 'user' ? 'STUDENT' : 'PATIENT'}: ${m.content}`)
    .join('\n\n');

  const system = `You are a clinical educator reviewing an audiology student's history-taking practice session.
Provide concise, constructive feedback. Be specific and reference actual exchanges from the transcript where possible.
Format your response with exactly these four sections using these exact headings:
**Strengths**
**Areas to Improve**
**Questioning Technique**
**Tips for Next Time**
Keep each section to 2-4 bullet points. Be encouraging but honest.`;

  const prompt = `The student just completed a history-taking session with a simulated patient called ${patientName}.

History areas covered (${covered.length}): ${covered.join(', ') || 'none'}
History areas missed (${missed.length}): ${missed.join(', ') || 'none'}

TRANSCRIPT:
${transcript}

Please review this session and provide feedback.`;

  const proxyUrl = getProxyUrl();
  const sessionToken = getSessionToken();

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Review request failed (${response.status})`);
  const data = await response.json();
  return data.content?.[0]?.text || '';
}

/**
 * Generate 4 suggested follow-up questions for the student based on recent conversation.
 * @param {Array} conversation - [{role, content}]
 * @returns {Promise<string[]>} - Array of 4 question strings
 */
export async function getSuggestedQuestions(conversation) {
  const proxyUrl = getProxyUrl();
  const sessionToken = getSessionToken();

  const recent = conversation.slice(-6)
    .map(m => `${m.role === 'user' ? 'Student' : 'Patient'}: ${m.content}`)
    .join('\n\n');

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: 'You are helping an audiology student practise history taking. Suggest exactly 4 short, natural follow-up questions the student could ask next. Vary the topics — do not all ask about the same thing. Return ONLY a valid JSON array of exactly 4 strings. No explanation, no markdown, just the JSON array.',
      messages: [{ role: 'user', content: `Recent conversation:\n\n${recent}\n\nSuggest 4 follow-up questions.` }]
    })
  });

  if (!response.ok) throw new Error(`Suggestions failed (${response.status})`);
  const data = await response.json();
  let text = (data.content?.[0]?.text || '[]').trim();
  // Strip markdown code fences and any leading/trailing prose around the array
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) text = arrayMatch[0];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Unexpected response format');
  return parsed.slice(0, 4);
}

/**
 * Test the proxy connection with a minimal request.
 */
export async function testConnection() {
  await sendMessage(
    'You are a test patient. Respond with exactly: "Connection successful."',
    [{ role: 'user', content: 'Hello' }]
  );
}
