import { getCases, loadBundledCases, saveCase, buildSystemPrompt } from './cases.js';
import { sendMessage, getAiReview, getSessionToken, setSessionToken, getProxyUrl, setProxyUrl } from './api.js';

// ── Session timer ──
let timerInterval = null;
let timerSeconds = 0;

function startTimer() {
  timerSeconds = 0;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSeconds++;
    const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    const el = document.getElementById('sessionTimer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ── Text to speech ──
let ttsEnabled = false;
let ttsVoice = null;
let ttsRate = 0.95;
const TTS_VOICE_KEY = 'audiology-sim-tts-voice';
const TTS_RATE_KEY  = 'audiology-sim-tts-rate';

function initTTS() {
  if (!window.speechSynthesis) return;

  const btn = document.getElementById('ttsToggle');
  if (btn) btn.style.display = 'flex';

  function getVoices() { return speechSynthesis.getVoices().filter(v => v.lang.startsWith('en')); }

  function pickDefaultVoice(voices) {
    const preferred = [
      v => v.name.includes('Karen'),
      v => v.name.includes('Samantha'),
      v => v.lang === 'en-AU' && !v.name.includes('Google'),
      v => v.lang === 'en-GB' && !v.name.includes('Google'),
      v => v.lang.startsWith('en-AU'),
      v => v.lang.startsWith('en-GB'),
    ];
    for (const match of preferred) {
      const found = voices.find(match);
      if (found) return found;
    }
    return voices[0];
  }

  function applyVoice(voices) {
    const saved = localStorage.getItem(TTS_VOICE_KEY);
    ttsVoice = (saved && voices.find(v => v.name === saved)) || pickDefaultVoice(voices);
    populateVoiceDropdown(voices);
  }

  function populateVoiceDropdown(voices) {
    const select = document.getElementById('voiceSelect');
    const field = document.getElementById('voiceSelectorField');
    if (!select || !voices.length) return;
    field.style.display = 'block';

    select.innerHTML = voices.map(v =>
      `<option value="${esc(v.name)}" ${ttsVoice?.name === v.name ? 'selected' : ''}>
        ${esc(v.name)} (${v.lang})
       </option>`
    ).join('');

    select.onchange = () => {
      const chosen = voices.find(v => v.name === select.value);
      if (chosen) {
        ttsVoice = chosen;
        localStorage.setItem(TTS_VOICE_KEY, chosen.name);
        // Preview the selected voice
        speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance('Hello, I am your patient today.');
        utter.voice = chosen;
        utter.rate = 0.95;
        speechSynthesis.speak(utter);
      }
    };
  }

  // Restore saved rate
  const savedRate = parseFloat(localStorage.getItem(TTS_RATE_KEY));
  if (savedRate) ttsRate = savedRate;

  // Speed slider
  const speedSlider = document.getElementById('ttsSpeed');
  const speedValue  = document.getElementById('speedValue');
  if (speedSlider) {
    speedSlider.value = ttsRate;
    if (speedValue) speedValue.textContent = ttsRate.toFixed(1).replace('.0','') + '×';
    speedSlider.addEventListener('input', () => {
      ttsRate = parseFloat(speedSlider.value);
      localStorage.setItem(TTS_RATE_KEY, ttsRate);
      if (speedValue) speedValue.textContent = ttsRate.toFixed(1).replace('.0','') + '×';
    });
  }

  const voices = getVoices();
  if (voices.length) applyVoice(voices);
  speechSynthesis.onvoiceschanged = () => applyVoice(getVoices());

  btn?.addEventListener('click', () => {
    ttsEnabled = !ttsEnabled;
    btn.classList.toggle('active', ttsEnabled);
    btn.title = ttsEnabled ? 'Patient voice on — click to mute' : 'Toggle patient voice';
    const speedControl = document.getElementById('speedControl');
    if (speedControl) speedControl.style.display = ttsEnabled ? 'flex' : 'none';
    if (!ttsEnabled) speechSynthesis.cancel();
  });
}

function speakPatient(text) {
  if (!ttsEnabled || !window.speechSynthesis) return;
  // Strip stage directions like *fidgets with hands* before speaking
  const clean = text.replace(/\*[^*]*\*/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(clean);
  if (ttsVoice) utter.voice = ttsVoice;
  utter.rate = ttsRate;
  utter.pitch = 1.05;
  speechSynthesis.speak(utter);
}

function stopSpeaking() {
  if (window.speechSynthesis) speechSynthesis.cancel();
}

// ── Speech recognition ──
let recognition = null;
let isRecording = false;
let speechBaseline = '';   // text already in box when mic started
let speechFinals = '';     // accumulated final transcripts this session

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.style.display = 'flex';

  recognition = new SpeechRecognition();
  recognition.continuous = true;      // don't stop on natural pauses
  recognition.interimResults = true;
  recognition.lang = 'en-AU';

  recognition.onstart = () => {
    isRecording = true;
    micBtn?.classList.add('recording');
    const input = document.getElementById('chatInput');
    if (input) input.placeholder = 'Listening…';
  };

  recognition.onresult = e => {
    let interim = '';
    // Only look at results since the last final we've already committed
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        speechFinals += (speechFinals && !speechFinals.endsWith(' ') ? ' ' : '') + t.trim();
      } else {
        interim = t;
      }
    }
    const input = document.getElementById('chatInput');
    if (input) {
      const combined = [speechBaseline, speechFinals, interim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      input.value = combined;
      autoResize();
    }
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn?.classList.remove('recording');
    const input = document.getElementById('chatInput');
    if (input) {
      input.placeholder = 'Type your question… (Enter to send, Shift+Enter for new line)';
      input.focus();
    }
  };

  recognition.onerror = e => {
    isRecording = false;
    micBtn?.classList.remove('recording');
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      toast(`Microphone error: ${e.error}`, 'error');
    }
    const input = document.getElementById('chatInput');
    if (input) input.placeholder = 'Type your question… (Enter to send, Shift+Enter for new line)';
  };

  micBtn?.addEventListener('click', () => {
    if (isRecording) {
      recognition.stop();
    } else {
      // Capture whatever is already in the box so we append to it
      const input = document.getElementById('chatInput');
      speechBaseline = input?.value?.trim() || '';
      speechFinals = '';
      recognition.start();
    }
  });
}

// ── State ──
let activeCase = null;
let systemPrompt = '';
let conversation = []; // [{role, content}]
let isWaiting = false;

// Sections we track for coverage — mirrors the history template
const COVERAGE_SECTIONS = [
  { key: 'reasonForAppointment', label: 'Reason for appointment' },
  { key: 'previousHearingTest',  label: 'Previous hearing test' },
  { key: 'hearingDetails',       label: 'Hearing details & decline' },
  { key: 'hearingAids',          label: 'Hearing aid use' },
  { key: 'tinnitus',             label: 'Tinnitus' },
  { key: 'soundSensitivity',     label: 'Sound sensitivity' },
  { key: 'balance',              label: 'Balance / vertigo' },
  { key: 'earHealth',            label: 'Ear health' },
  { key: 'entHistory',           label: 'ENT history' },
  { key: 'generalHealth',        label: 'General health & hospitalisations' },
  { key: 'headInjuries',         label: 'Head injuries' },
  { key: 'pastInfections',       label: 'Past infections / medical conditions' },
  { key: 'medications',          label: 'Medications' },
  { key: 'noiseHistory',         label: 'Noise history' },
  { key: 'familyHistory',        label: 'Family history of hearing loss' },
  { key: 'otherConcerns',        label: 'Other concerns' },
];

// Simple keyword matching to detect which sections a student message touches
const SECTION_KEYWORDS = {
  reasonForAppointment: ['reason','why','today','appointment','come in','referred','concern','problem','issue','brought you'],
  previousHearingTest:  ['previous','before','test','tested','audiogram','checked','prior','past test','hearing test'],
  hearingDetails:       ['hear','hearing','worse','better','ear','decline','gradual','sudden','when did','loud','quiet','side','both'],
  hearingAids:          ['aid','aids','hearing aid','device','amplif','wear','wearing'],
  tinnitus:             ['tinnitus','ringing','buzzing','hissing','noise in','sound in','ear noise'],
  soundSensitivity:     ['sensitiv','loud','painful','hyperacusis','uncomfortable','tolerate','sound bother'],
  balance:              ['balance','dizzy','dizziness','vertigo','spinning','fall','unstead','imbalance'],
  earHealth:            ['ear health','pressure','pain','ache','drainage','discharge','infection','wax','itchy','blocked'],
  entHistory:           ['ent','ear nose','specialist','surgeon','surgery','operation','scans','referr'],
  generalHealth:        ['general health','hospital','hospitalised','admitted','health condition','overall health'],
  headInjuries:         ['head injur','head trauma','concussion','knock','accident'],
  pastInfections:       ['meningitis','measles','mumps','chicken pox','diabetes','cancer','cardiovascular','heart','infection'],
  medications:          ['medication','medicine','tablets','drugs','prescription','taking','pills'],
  noiseHistory:         ['noise','loud work','factory','machinery','concert','music','headphone','earphone','occupational','recreational'],
  familyHistory:        ['family','parent','mother','father','sibling','relative','hereditary','inherited','genetic'],
  otherConcerns:        ['anything else','other concern','other question','anything further','is there','what else'],
};

let coveredSections = new Set();

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // Auth
  checkAuth();
  initTTS();
  initSpeech();

  // Load cases for selection
  await populateCaseList();

  // UI events
  document.getElementById('btnStartSession')?.addEventListener('click', startSession);
  document.getElementById('sendBtn')?.addEventListener('click', handleSend);
  document.getElementById('chatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  document.getElementById('chatInput')?.addEventListener('input', autoResize);
  document.getElementById('btnEndSession')?.addEventListener('click', endSession);
  document.getElementById('btnCloseReport')?.addEventListener('click', () => {
    document.getElementById('reportOverlay').classList.remove('visible');
  });
  document.getElementById('btnNewSession')?.addEventListener('click', () => {
    document.getElementById('reportOverlay').classList.remove('visible');
    showSetup();
  });
  document.getElementById('btnAiReview')?.addEventListener('click', handleAiReview);
  document.getElementById('btnSaveToken')?.addEventListener('click', saveSettings);
  document.getElementById('settingsModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('settingsModal') && getSessionToken()) {
      e.target.style.display = 'none';
    }
  });
});

// ── Auth check ──
function checkAuth() {
  const token = getSessionToken();
  const proxy = getProxyUrl();
  if (!token || !proxy) showSettingsModal();
}

function showSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    document.getElementById('settingsProxyUrl').value = getProxyUrl();
    document.getElementById('settingsToken').value = getSessionToken();
    modal.style.display = 'flex';
  }
}

function saveSettings() {
  const proxy = document.getElementById('settingsProxyUrl')?.value?.trim();
  const token = document.getElementById('settingsToken')?.value?.trim();
  if (!proxy) { toast('Please enter the proxy URL', 'error'); return; }
  if (!token) { toast('Please enter your session password', 'error'); return; }
  setProxyUrl(proxy);
  setSessionToken(token);
  document.getElementById('settingsModal').style.display = 'none';
  toast('Settings saved', 'success');
}

// ── Case selection ──
async function populateCaseList() {
  const list = document.getElementById('caseSelectList');
  if (!list) return;

  let cases = getCases();

  // Try loading bundled cases if none exist
  if (cases.length === 0) {
    const bundled = await loadBundledCases();
    bundled.forEach(saveCase);
    cases = getCases();
  }

  if (cases.length === 0) {
    list.innerHTML = `<p class="text-muted text-sm">No cases available. Ask your teacher to share a case file, or load sample cases.</p>`;
    return;
  }

  list.innerHTML = cases.map(c => `
    <div class="case-select-item" data-id="${c.id}">
      <div>
        <div class="csi-name">${esc(c.patient.name) || 'Unnamed Patient'}</div>
        <div class="csi-meta">${c.patient.age ? c.patient.age + ' yrs' : ''}${c.patient.occupation ? ' · ' + esc(c.patient.occupation) : ''}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.case-select-item').forEach(item => {
    item.addEventListener('click', () => {
      list.querySelectorAll('.case-select-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      document.getElementById('btnStartSession').disabled = false;
      activeCase = getCases().find(c => c.id === item.dataset.id);
    });
  });

  // Import a case file
  document.getElementById('btnImportCase')?.addEventListener('click', () => {
    document.getElementById('importCaseFile').click();
  });
  document.getElementById('importCaseFile')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const { importCasesFromFile } = await import('./cases.js');
    try {
      await importCasesFromFile(file);
      await populateCaseList();
      toast('Case imported', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ── Session start ──
function startSession() {
  if (!activeCase) return;

  systemPrompt = buildSystemPrompt(activeCase);
  conversation = [];
  coveredSections = new Set();

  // Show chat UI
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('sessionScreen').classList.remove('hidden');

  // Fill patient header
  const p = activeCase.patient;
  document.getElementById('chatPatientName').textContent = p.name || 'Patient';
  document.getElementById('chatPatientMeta').textContent =
    [p.age ? p.age + ' yrs' : '', p.occupation].filter(Boolean).join(' · ');
  document.getElementById('patientInitial').textContent = (p.name || 'P')[0].toUpperCase();

  // Clear messages
  document.getElementById('messages').innerHTML = '';

  renderCoverage();
  startTimer();

  // Focus input
  document.getElementById('chatInput')?.focus();
}

function showSetup() {
  document.getElementById('setupScreen').classList.remove('hidden');
  document.getElementById('sessionScreen').classList.add('hidden');
  activeCase = null;
  systemPrompt = '';
  conversation = [];
}

// ── Messaging ──
async function handleSend() {
  const input = document.getElementById('chatInput');
  const text = input?.value?.trim();
  if (!text || isWaiting) return;

  input.value = '';
  input.style.height = '';

  appendMessage('student', text);
  conversation.push({ role: 'user', content: text });

  // Track coverage
  trackCoverage(text);

  // Show typing
  showTyping(true);
  isWaiting = true;
  document.getElementById('sendBtn').disabled = true;

  try {
    const reply = await sendMessage(systemPrompt, conversation);
    conversation.push({ role: 'assistant', content: reply });
    appendMessage('patient', reply);
    speakPatient(reply);
  } catch (err) {
    appendMessage('system', `Error: ${err.message}`);
  } finally {
    showTyping(false);
    isWaiting = false;
    document.getElementById('sendBtn').disabled = false;
    document.getElementById('chatInput')?.focus();
  }
}

function appendMessage(role, text) {
  const messages = document.getElementById('messages');
  const div = document.createElement('div');

  if (role === 'system') {
    div.className = 'message';
    div.innerHTML = `<div style="font-size:.8rem;color:var(--red-500);text-align:center;width:100%;padding:.5rem">${esc(text)}</div>`;
  } else {
    div.className = `message ${role}`;
    const initials = role === 'patient'
      ? (activeCase?.patient?.name?.[0] || 'P').toUpperCase()
      : 'Me';
    div.innerHTML = `
      <div class="message-avatar">${esc(initials)}</div>
      <div class="message-bubble">${formatText(text)}</div>
    `;
  }

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function showTyping(show) {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.classList.toggle('visible', show);
  const messages = document.getElementById('messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function autoResize() {
  const el = document.getElementById('chatInput');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Coverage tracking ──
function trackCoverage(text) {
  const lower = text.toLowerCase();
  Object.entries(SECTION_KEYWORDS).forEach(([key, keywords]) => {
    if (!coveredSections.has(key) && keywords.some(kw => lower.includes(kw))) {
      coveredSections.add(key);
    }
  });
  renderCoverage();
}

function renderCoverage() {
  const list = document.getElementById('coverageList');
  const bar = document.getElementById('coverageBar');
  const pct = document.getElementById('coveragePct');
  if (!list) return;

  const total = COVERAGE_SECTIONS.length;
  const covered = coveredSections.size;
  const percent = Math.round((covered / total) * 100);

  if (bar) bar.style.width = percent + '%';
  if (pct) pct.textContent = `${covered}/${total} areas`;

  list.innerHTML = COVERAGE_SECTIONS.map(s => `
    <div class="coverage-item ${coveredSections.has(s.key) ? 'covered' : ''}">
      <svg class="ci-icon" viewBox="0 0 20 20" fill="currentColor">
        ${coveredSections.has(s.key)
          ? '<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>'
          : '<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" fill="none"/>'}
      </svg>
      ${esc(s.label)}
    </div>
  `).join('');
}

// ── End session / report ──
function endSession() {
  stopSpeaking();
  stopTimer();
  const overlay = document.getElementById('reportOverlay');
  if (!overlay) return;

  const total = COVERAGE_SECTIONS.length;
  const covered = coveredSections.size;
  const percent = Math.round((covered / total) * 100);

  const mins = Math.floor(timerSeconds / 60);
  const secs = String(timerSeconds % 60).padStart(2, '0');
  const duration = mins > 0 ? `${mins}m ${secs}s` : `${timerSeconds}s`;

  document.getElementById('reportPatientName').textContent = activeCase?.patient?.name || 'Patient';
  document.getElementById('reportScore').textContent = `${percent}%`;
  document.getElementById('reportSubtitle').textContent = `${covered} of ${total} areas explored · ${duration}`;

  const hitList = document.getElementById('reportHits');
  const missList = document.getElementById('reportMisses');

  hitList.innerHTML = COVERAGE_SECTIONS
    .filter(s => coveredSections.has(s.key))
    .map(s => `<div class="report-item hit">✓ ${esc(s.label)}</div>`)
    .join('') || '<div class="report-item hit">None yet</div>';

  missList.innerHTML = COVERAGE_SECTIONS
    .filter(s => !coveredSections.has(s.key))
    .map(s => `<div class="report-item miss">○ ${esc(s.label)}</div>`)
    .join('') || '<div class="report-item miss">All areas covered!</div>';

  // Reset AI review panel
  const reviewBtn = document.getElementById('btnAiReview');
  const reviewResult = document.getElementById('aiReviewResult');
  if (reviewBtn) { reviewBtn.style.display = ''; reviewBtn.disabled = false; reviewBtn.textContent = '✦ Get AI Feedback on my technique'; }
  if (reviewResult) { reviewResult.classList.add('hidden'); reviewResult.innerHTML = ''; }

  overlay.classList.add('visible');
}

// ── AI Review ──
async function handleAiReview() {
  const btn = document.getElementById('btnAiReview');
  const result = document.getElementById('aiReviewResult');
  if (!btn || !result) return;

  btn.disabled = true;
  btn.textContent = 'Generating feedback…';
  result.classList.remove('hidden');
  result.innerHTML = `<div class="ai-review-loading"><div class="ai-review-spinner"></div>Analysing your session…</div>`;

  const coveredLabels = COVERAGE_SECTIONS.filter(s => coveredSections.has(s.key)).map(s => s.label);
  const missedLabels  = COVERAGE_SECTIONS.filter(s => !coveredSections.has(s.key)).map(s => s.label);

  try {
    const text = await getAiReview(
      activeCase?.patient?.name || 'the patient',
      conversation,
      coveredLabels,
      missedLabels
    );
    result.innerHTML = `<div class="ai-review">${renderReviewMarkdown(text)}</div>`;
    btn.style.display = 'none';
  } catch (err) {
    result.innerHTML = `<p class="text-sm" style="color:var(--red-500)">Could not generate feedback: ${esc(err.message)}</p>`;
    btn.disabled = false;
    btn.textContent = '✦ Try again';
  }
}

function renderReviewMarkdown(text) {
  // Render **headings** as <h4> and bullet points as <ul><li>
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<h4>$1</h4>')
    .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '\n');
}

// ── Helpers ──
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatText(text) {
  // Preserve line breaks, escape HTML
  return esc(text).replace(/\n/g, '<br>');
}

function toast(msg, type = '') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
