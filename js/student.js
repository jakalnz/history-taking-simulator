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
let shouldRestartRecognition = false; // user still wants mic on; we auto-restart after each pause
let speechBaseline = '';   // text already in box when mic started
let speechFinals = '';     // accumulated final transcripts this recognition burst

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.style.display = 'flex';

  recognition = new SpeechRecognition();
  // continuous=false avoids Android/Samsung bug where previous finals are
  // replayed on internal restart, producing duplicated text like "Hi hi Dave Dave".
  // Instead we restart manually in onend while the user still wants the mic on.
  recognition.continuous = false;
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
    if (shouldRestartRecognition) {
      // Roll committed finals into baseline before restarting so they
      // can't be replayed or duplicated in the next recognition session.
      speechBaseline = [speechBaseline, speechFinals].filter(Boolean).join(' ').trim();
      speechFinals = '';
      try { recognition.start(); } catch (_) {}
    } else {
      micBtn?.classList.remove('recording');
      const input = document.getElementById('chatInput');
      if (input) {
        input.placeholder = 'Type your question… (Enter to send, Shift+Enter for new line)';
        input.focus();
      }
    }
  };

  recognition.onerror = e => {
    if (e.error === 'no-speech') return; // harmless — onend will restart if needed
    if (e.error === 'aborted') return;
    shouldRestartRecognition = false;
    isRecording = false;
    micBtn?.classList.remove('recording');
    toast(`Microphone error: ${e.error}`, 'error');
    const input = document.getElementById('chatInput');
    if (input) input.placeholder = 'Type your question… (Enter to send, Shift+Enter for new line)';
  };

  micBtn?.addEventListener('click', () => {
    if (isRecording || shouldRestartRecognition) {
      shouldRestartRecognition = false;
      recognition.stop();
    } else {
      const input = document.getElementById('chatInput');
      speechBaseline = input?.value?.trim() || '';
      speechFinals = '';
      shouldRestartRecognition = true;
      recognition.start();
    }
  });
}

function stopRecordingIfActive() {
  if ((isRecording || shouldRestartRecognition) && recognition) {
    shouldRestartRecognition = false;
    recognition.stop();
  }
}

// ── State ──
let activeCase = null;
let systemPrompt = '';
let conversation = []; // [{role, content}]
let isWaiting = false;

// Sections we track for coverage — mirrors the history template.
// Each section has top-level keywords (any hit marks the parent covered) and
// optional subs (shown once the parent is touched, each individually tracked).
const COVERAGE_SECTIONS = [
  {
    key: 'reasonForAppointment',
    label: 'Reason for appointment',
    keywords: ['reason','why','today','appointment','come in','referred','concern','problem','issue','brought you'],
    subs: []
  },
  {
    key: 'previousHearingTest',
    label: 'Previous hearing test',
    keywords: ['previous','before','test','tested','audiogram','checked','prior','past test','hearing test'],
    subs: [
      { key: 'prev_when',     label: 'When / results',   keywords: ['when','result','outcome','say','show','find','told','score','threshold'] },
      { key: 'prev_followup', label: 'Follow-up care',   keywords: ['follow','follow-up','refer','next','recommend','care','action','after'] },
    ]
  },
  {
    key: 'hearingDetails',
    label: 'Hearing details',
    keywords: ['hear','hearing','worse','better','ear','decline','gradual','sudden','when did','quiet','side'],
    subs: [
      { key: 'hear_betterEar', label: 'Better / worse ear',     keywords: ['better ear','worse ear','which ear','one side','left ear','right ear','both ear','both sides'] },
      { key: 'hear_decline',   label: 'Gradual or sudden',      keywords: ['gradual','sudden','overnight','quickly','slow','over time','decline','came on'] },
      { key: 'hear_onset',     label: 'When first noticed',     keywords: ['when','how long','first notice','start','began','ago','years','months'] },
    ]
  },
  {
    key: 'hearingAids',
    label: 'Hearing aid use',
    keywords: ['aid','aids','hearing aid','device','amplif','wear','wearing'],
    subs: [
      { key: 'aid_type',         label: 'Type / age of aids',  keywords: ['type','style','behind','in the ear','bte','ite','old','how long','model','make'] },
      { key: 'aid_satisfaction', label: 'Satisfaction / benefit', keywords: ['like','happy','work','help','benefit','dislike','trouble','problem','useful','satisfied'] },
    ]
  },
  {
    key: 'tinnitus',
    label: 'Tinnitus',
    keywords: ['tinnitus','ringing','buzzing','hissing','noise in','sound in','ear noise','noises in','hear a noise','any noise','sounds in your ear','sound in your ear','noise in your ear','noises in your ear','clicking','roaring','whooshing','hear anything'],
    subs: [
      { key: 'tin_location',    label: 'Location (ear / head)',    keywords: ['which ear','left','right','both','head','where','location'] },
      { key: 'tin_description', label: 'Description / pattern',    keywords: ['sound like','describe','constant','intermittent','come and go','pulsating','pulse','beat','always','sometimes'] },
      { key: 'tin_annoyance',   label: 'Level of annoyance',       keywords: ['bother','annoy','affect','distress','impact','sleep','concentrate','worry','upset','disturb'] },
      { key: 'tin_onset',       label: 'Onset',                    keywords: ['when','how long','start','began','ago','first','started'] },
    ]
  },
  {
    key: 'soundSensitivity',
    label: 'Sound sensitivity',
    keywords: ['sensitiv','hyperacusis','uncomfortable','tolerate','sound bother','bothered by','sounds too loud','painful sounds','startle','loud sounds'],
    subs: [
      { key: 'ss_everyday',  label: 'Everyday sounds',     keywords: ['door','cutlery','traffic','everyday','normal sound','ordinary','dishes','voices','television','tv'] },
      { key: 'ss_annoyance', label: 'Level of annoyance',  keywords: ['bother','annoy','affect','distress','impact','avoid','cope','manage'] },
    ]
  },
  {
    key: 'balance',
    label: 'Balance / vertigo',
    keywords: ['balance','dizzy','dizziness','vertigo','spinning','fall','unstead','imbalance'],
    subs: [
      { key: 'bal_type',     label: 'Vertigo vs imbalance',   keywords: ['spinning','room spin','vertigo','imbalance','unstead','off balance','lightheaded','woozy'] },
      { key: 'bal_triggers', label: 'Triggers / duration',    keywords: ['trigger','cause','when','how long','last','movement','lie down','roll over','turn head','get up'] },
      { key: 'bal_gp',       label: 'Seen GP / diagnosed',    keywords: ['gp','doctor','diagnos','told','seen anyone','referr','treat','investigated'] },
    ]
  },
  {
    key: 'earHealth',
    label: 'Ear health',
    keywords: ['ear health','pressure','pain','ache','drainage','discharge','infection','wax','itchy','blocked','ears feel'],
    subs: [
      { key: 'ear_pressure',   label: 'Pressure / fullness',  keywords: ['pressure','full','blocked','plugged','stuffy','muffled'] },
      { key: 'ear_pain',       label: 'Pain',                  keywords: ['pain','ache','hurt','sore','throb'] },
      { key: 'ear_discharge',  label: 'Drainage / discharge',  keywords: ['drain','discharg','fluid','leak','wet','weep','ooze'] },
      { key: 'ear_infection',  label: 'Ear infections',        keywords: ['infection','infect','otitis','grommets','tubes','glue ear','perforat'] },
      { key: 'ear_wax',        label: 'Wax',                   keywords: ['wax','cerumen','syringe','micro','clean','remov','build up'] },
    ]
  },
  {
    key: 'entHistory',
    label: 'ENT history',
    keywords: ['ent','ear nose','specialist','surgeon','surgery','operation','scans','referr'],
    subs: [
      { key: 'ent_surgery', label: 'Surgery / treatment',      keywords: ['surgery','operation','operat','procedure','treat','myringoplasty','grommets','stapedectomy','repair'] },
      { key: 'ent_scans',   label: 'Scans / investigations',   keywords: ['scan','mri','ct','xray','x-ray','imag','investig','test','audiolog'] },
    ]
  },
  {
    key: 'generalHealth',
    label: 'General health',
    keywords: ['general health','hospital','hospitalised','admitted','health condition','overall health','health generally'],
    subs: [
      { key: 'gh_hosp',     label: 'Hospitalisations',    keywords: ['hospital','admitted','admission','stay','ward','inpatient','operation','surgery'] },
      { key: 'gh_illness',  label: 'Major illnesses',      keywords: ['illness','condition','disease','chronic','ongoing','health problem','diagnosis','diagnosed'] },
    ]
  },
  {
    key: 'headInjuries',
    label: 'Head injuries',
    keywords: ['head injur','head trauma','concussion','hit your head','knock','accident','bump'],
    subs: [
      { key: 'hi_details', label: 'When / cause',              keywords: ['when','what happen','cause','how','accident','sport','fall','ago','years'] },
      { key: 'hi_hearing', label: 'Change in hearing after',   keywords: ['hearing change','after','since','follow','affect hearing','worse after','notice after'] },
    ]
  },
  {
    key: 'pastInfections',
    label: 'Past infections / illnesses',
    keywords: ['meningitis','measles','mumps','chicken pox','chickenpox','diabetes','cancer','cardiovascular','heart disease','past infection','childhood illness'],
    subs: [
      { key: 'pi_childhood', label: 'Childhood infections',    keywords: ['measles','mumps','chicken pox','chickenpox','rubella','meningitis','childhood'] },
      { key: 'pi_systemic',  label: 'Systemic conditions',     keywords: ['diabetes','cancer','cardiovascular','heart','kidney','autoimmune','thyroid','stroke'] },
    ]
  },
  {
    key: 'medications',
    label: 'Medications',
    keywords: ['medication','medicine','tablets','drugs','prescription','taking','pills','on anything'],
    subs: [
      { key: 'med_current',   label: 'Current medications',         keywords: ['current','taking','on','prescribed','regular','any medication','what medication'] },
      { key: 'med_ototoxic',  label: 'Ototoxic / chemotherapy',     keywords: ['chemo','chemotherapy','cisplatin','aminoglycoside','aspirin','quinine','furosemide','ototoxic','antibiotic','gentamicin'] },
    ]
  },
  {
    key: 'noiseHistory',
    label: 'Noise history',
    keywords: ['noise','loud work','factory','machinery','concert','music','headphone','earphone','occupational','recreational','noise exposure'],
    subs: [
      { key: 'noise_occ',        label: 'Occupational noise',    keywords: ['work','occupational','job','factory','machinery','construction','military','farm','workshop','workplace','industrial'] },
      { key: 'noise_rec',        label: 'Recreational noise',    keywords: ['concert','music','headphone','earphone','sport','hunting','shooting','band','club','gig','recreational','leisure','hobby'] },
      { key: 'noise_protection', label: 'Hearing protection',    keywords: ['protect','earmuff','earplug','plug','muff','ppe','prevention','hearing protection'] },
    ]
  },
  {
    key: 'familyHistory',
    label: 'Family history',
    keywords: ['family','parent','mother','father','sibling','relative','hereditary','inherited','genetic','family history'],
    subs: [
      { key: 'fam_who',  label: 'Which relative',       keywords: ['who','which','parent','mother','father','sibling','brother','sister','grandparent','relative','aunt','uncle','children','kids'] },
      { key: 'fam_aids', label: 'Wears hearing aids',   keywords: ['hearing aid','aid','amplif','wear','device','fitted','trial'] },
    ]
  },
  {
    key: 'otherConcerns',
    label: 'Other concerns',
    keywords: ['anything else','other concern','other question','anything further','is there anything','what else','any other','missed anything','cover everything'],
    subs: []
  },
];

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

  // Sidebar toggle (mobile)
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  function closeSidebar() {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('visible');
    sidebarToggle?.classList.remove('active');
  }
  sidebarToggle?.addEventListener('click', () => {
    const isOpen = sidebar?.classList.toggle('open');
    backdrop?.classList.toggle('visible', isOpen);
    sidebarToggle?.classList.toggle('active', isOpen);
  });
  backdrop?.addEventListener('click', closeSidebar);

  // Spacebar shortcut to toggle TTS (when not typing in input)
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    const ttsBtn = document.getElementById('ttsToggle');
    if (ttsBtn && ttsBtn.style.display !== 'none') {
      e.preventDefault();
      ttsBtn.click();
    }
  });
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

  // Stop microphone before sending so it doesn't pick up the patient response
  stopRecordingIfActive();

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
  COVERAGE_SECTIONS.forEach(section => {
    if (!coveredSections.has(section.key) && section.keywords.some(kw => lower.includes(kw))) {
      coveredSections.add(section.key);
    }
    section.subs.forEach(sub => {
      if (!coveredSections.has(sub.key) && sub.keywords.some(kw => lower.includes(kw))) {
        coveredSections.add(sub.key);
        // Parent section is also touched if a sub is hit
        coveredSections.add(section.key);
      }
    });
  });
  renderCoverage();
}

const CHECK_ICON = '<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>';
const CIRCLE_ICON = '<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" fill="none"/>';

function renderCoverage() {
  const list = document.getElementById('coverageList');
  const bar = document.getElementById('coverageBar');
  const pct = document.getElementById('coveragePct');
  if (!list) return;

  const total = COVERAGE_SECTIONS.length;
  const covered = COVERAGE_SECTIONS.filter(s => coveredSections.has(s.key)).length;
  const percent = Math.round((covered / total) * 100);

  if (bar) bar.style.width = percent + '%';
  if (pct) pct.textContent = `${covered}/${total} areas`;

  list.innerHTML = COVERAGE_SECTIONS.map(section => {
    const parentCovered = coveredSections.has(section.key);
    const subsHtml = (parentCovered && section.subs.length) ? section.subs.map(sub => {
      const subCovered = coveredSections.has(sub.key);
      return `
        <div class="coverage-item coverage-sub ${subCovered ? 'covered' : ''}">
          <svg class="ci-icon" viewBox="0 0 20 20" fill="currentColor">
            ${subCovered ? CHECK_ICON : CIRCLE_ICON}
          </svg>
          ${esc(sub.label)}
        </div>`;
    }).join('') : '';

    return `
      <div class="coverage-item ${parentCovered ? 'covered' : ''}">
        <svg class="ci-icon" viewBox="0 0 20 20" fill="currentColor">
          ${parentCovered ? CHECK_ICON : CIRCLE_ICON}
        </svg>
        ${esc(section.label)}
      </div>${subsHtml}`;
  }).join('');
}

// ── End session / report ──
function endSession() {
  stopSpeaking();
  stopTimer();
  const overlay = document.getElementById('reportOverlay');
  if (!overlay) return;

  const total = COVERAGE_SECTIONS.length;
  const covered = COVERAGE_SECTIONS.filter(s => coveredSections.has(s.key)).length;
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
    .map(s => {
      const coveredSubs = s.subs.filter(sub => coveredSections.has(sub.key));
      const subsHtml = coveredSubs.length
        ? `<div class="report-sub-list">${coveredSubs.map(sub => `<span class="report-sub">· ${esc(sub.label)}</span>`).join('')}</div>`
        : '';
      return `<div class="report-item hit">✓ ${esc(s.label)}${subsHtml}</div>`;
    })
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
