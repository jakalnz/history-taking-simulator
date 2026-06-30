import { getCases, loadBundledCases, saveCase, buildSystemPrompt } from './cases.js';
import { sendMessage, getAiReview, getSuggestedQuestions, getSessionToken, setSessionToken, getProxyUrl, setProxyUrl } from './api.js';

// Matches the mobile breakpoint in css/styles.css (@media max-width: 768px).
function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

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
let shouldRestartRecognition = false;
let speechBaseline = ''; // text in box at the start of the current mic session (or burst restart)

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.style.display = 'flex';

  recognition = new SpeechRecognition();
  // continuous=false + manual restart avoids Android/Samsung's bug where
  // previous finals are replayed after an internal restart, causing duplicates.
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
    // Rebuild from scratch for this burst (iterate ALL results, not from resultIndex)
    // so Android replaying old results just produces the same string, not an appended one.
    let sessionFinals = '';
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) sessionFinals += (sessionFinals ? ' ' : '') + t;
      else interim = t;
    }

    // Strip any prefix that's already in speechBaseline (Android replay protection).
    // If Android replays "Hi Dave" at the start of a new burst where baseline="Hi Dave",
    // we detect the overlap and discard the repeated text.
    let extra = sessionFinals;
    if (speechBaseline && sessionFinals) {
      const bNorm = speechBaseline.replace(/\s+/g, ' ').toLowerCase().trim();
      const sNorm = sessionFinals.replace(/\s+/g, ' ').toLowerCase().trim();
      if (sNorm === bNorm || bNorm.endsWith(sNorm)) {
        extra = ''; // pure replay — ignore
      } else if (sNorm.startsWith(bNorm)) {
        extra = sessionFinals.slice(speechBaseline.length).trim(); // strip replayed prefix
      }
    }

    const input = document.getElementById('chatInput');
    if (input) {
      input.value = [speechBaseline, extra, interim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      autoResize();
    }
  };

  recognition.onend = () => {
    isRecording = false;
    if (shouldRestartRecognition) {
      // Use current input value as new baseline before restarting
      const input = document.getElementById('chatInput');
      speechBaseline = input?.value?.trim() || '';
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

// ── Hint question bank ──
const SECTION_HINTS = {
  reasonForAppointment: [
    'What brings you in to see us today?',
    'Can you tell me in your own words what\'s been concerning you?',
    'Have you been referred here, or did you make this appointment yourself?',
  ],
  previousHearingTest: [
    'Have you had your hearing tested before?',
    'When was your last hearing test, and where did you have it done?',
    'Do you remember what the results showed, or were you given any follow-up advice?',
  ],
  hearingDetails: [
    'Which ear do you feel you hear better from?',
    'Has your hearing changed gradually over time, or did it happen more suddenly?',
    'When did you first notice your hearing wasn\'t quite right?',
  ],
  hearingAids: [
    'Do you currently use any hearing aids?',
    'How long have you been wearing hearing aids, and what style are they?',
    'How are you finding your hearing aids — are they helping?',
  ],
  tinnitus: [
    'Do you notice any ringing, buzzing, or other sounds in your ears when it\'s quiet?',
    'Have you been aware of any noises in your ears that other people can\'t hear?',
    'Does the sound seem to be in one ear, both ears, or more in your head?',
  ],
  soundSensitivity: [
    'Do you find that certain sounds are uncomfortably loud for you?',
    'Are there everyday sounds — like cutlery or voices — that bother you more than they used to?',
    'Do loud sounds ever cause you pain or discomfort?',
  ],
  balance: [
    'Have you had any problems with your balance or dizziness?',
    'Do you ever feel like the room is spinning, or that you\'re unsteady on your feet?',
    'What seems to trigger your dizziness, and how long do episodes usually last?',
  ],
  earHealth: [
    'Have you had any pain, pressure, or a feeling of fullness in your ears?',
    'Have you ever had discharge or fluid coming from your ears?',
    'Have you had any ear infections, or has anyone suggested a build-up of wax?',
  ],
  entHistory: [
    'Have you ever seen an ear, nose and throat specialist?',
    'Have you had any surgery or procedures on your ears?',
    'Have you had any scans or investigations related to your ears?',
  ],
  generalHealth: [
    'Have you ever been hospitalised, and was there any change in your hearing around that time?',
    'Do you have any ongoing health conditions I should know about?',
    'Are there any major illnesses in your history that might be relevant?',
  ],
  headInjuries: [
    'Have you ever had a significant head injury or concussion?',
    'Did you notice any change in your hearing after the injury?',
    'Did you receive medical treatment for the head injury?',
  ],
  pastInfections: [
    'Have you had any childhood illnesses like measles, mumps, or meningitis?',
    'Do you have any ongoing conditions such as diabetes or cardiovascular disease?',
    'Have you had any serious infections in the past that you can recall?',
  ],
  medications: [
    'Are you currently taking any medications, either prescribed or over the counter?',
    'Have you ever been on long-term antibiotics or had chemotherapy?',
    'Are there any medications you think might have affected your hearing?',
  ],
  noiseHistory: [
    'Have you worked in a noisy environment — like a factory, construction, or farming?',
    'Do you have recreational noise exposure, such as concerts, loud music, or shooting?',
    'Have you worn hearing protection when exposed to loud noise?',
  ],
  familyHistory: [
    'Is there any history of hearing loss in your family?',
    'Which relatives have had hearing difficulties — parents, siblings, or grandparents?',
    'Do any family members wear hearing aids?',
  ],
  otherConcerns: [
    'Is there anything else about your hearing or ear health you\'d like to mention?',
    'Have we covered everything you wanted to discuss today?',
    'Is there anything you were hoping I\'d ask about that we haven\'t touched on?',
  ],
};

// ── Hint panel state ──
let hintsViewed = new Set(); // section keys where hints were opened

// ── Guided question (MC) mode state ──
let mcModeEnabled = false;
let mcTurns = 0;   // turns where student selected a guided option
let freeTurns = 0; // turns where student typed freely (while MC mode was on)

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

// ── Hint panel ──
function initHintPanel() {
  const btn = document.getElementById('btnHints');
  const panel = document.getElementById('hintPanel');
  const body = document.getElementById('hintPanelBody');
  if (!btn || !panel || !body) return;

  // Build accordion from COVERAGE_SECTIONS + SECTION_HINTS
  body.innerHTML = COVERAGE_SECTIONS.map(section => {
    const hints = SECTION_HINTS[section.key] || [];
    if (!hints.length) return '';
    return `
      <div class="hint-section">
        <button class="hint-section-hdr" data-key="${section.key}">
          <span>${esc(section.label)}</span>
          <svg class="hint-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="hint-section-body">
          ${hints.map(h => `<div class="hint-q">${esc(h)}</div>`).join('')}
        </div>
      </div>`;
  }).join('');

  // Accordion toggle
  body.querySelectorAll('.hint-section-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const isOpen = hdr.classList.contains('open');
      body.querySelectorAll('.hint-section-hdr').forEach(h => h.classList.remove('open'));
      if (!isOpen) {
        hdr.classList.add('open');
        hintsViewed.add(hdr.dataset.key);
      }
    });
  });

  btn.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    panel.classList.toggle('hidden', !open);
    btn.classList.toggle('active', open);
  });
}

// ── Guided question (MC) mode ──
function initMcMode() {
  const btn = document.getElementById('btnMcMode');
  if (!btn) return;
  btn.addEventListener('click', () => {
    mcModeEnabled = !mcModeEnabled;
    btn.classList.toggle('active', mcModeEnabled);
    if (!mcModeEnabled) clearMcOptions();
    toast(mcModeEnabled ? 'Guided mode on — question options will appear after each response' : 'Guided mode off', '');
  });
}

function clearMcOptions() {
  const el = document.getElementById('mcOptions');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

async function showMcOptions() {
  if (!mcModeEnabled || conversation.length === 0) return;
  const container = document.getElementById('mcOptions');
  if (!container) return;

  container.innerHTML = `<div class="mc-loading"><div class="ai-review-spinner"></div>Suggesting questions…</div>`;
  container.classList.remove('hidden');

  try {
    const questions = await getSuggestedQuestions(conversation);
    if (!mcModeEnabled) { clearMcOptions(); return; } // mode toggled off while loading
    const labels = ['A', 'B', 'C', 'D'];
    container.innerHTML = questions.map((q, i) => `
      <button class="mc-option" data-q="${esc(q)}">
        <span class="mc-label">${labels[i] || i + 1}</span>
        <span>${esc(q)}</span>
      </button>`).join('');

    container.querySelectorAll('.mc-option').forEach(optBtn => {
      optBtn.addEventListener('click', () => {
        const q = optBtn.dataset.q;
        const input = document.getElementById('chatInput');
        if (input) { input.value = q; autoResize(); }
        handleSend(true);
      });
    });
  } catch (err) {
    console.error('Failed to load suggested questions:', err);
    clearMcOptions(); // fall back to free text on error
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // Auth
  checkAuth();
  initTTS();
  initSpeech();
  initHintPanel();
  initMcMode();

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

  // Spacebar shortcut to toggle the microphone/STT (when not typing in input)
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    const micBtn = document.getElementById('micBtn');
    if (micBtn && micBtn.style.display !== 'none') {
      e.preventDefault();
      micBtn.click();
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
    list.innerHTML = `<p class="text-muted text-sm" style="padding:.75rem">No cases available. Ask your teacher to share a case file, or load sample cases.</p>`;
    return;
  }

  function renderCaseItems(filtered) {
    list.innerHTML = filtered.length ? filtered.map(c => {
      const initial = (c.patient.name || '?')[0].toUpperCase();
      const meta = [c.patient.age ? c.patient.age + ' yrs' : '', esc(c.patient.occupation || '')].filter(Boolean).join(' · ');
      return `
        <div class="case-select-item" data-id="${c.id}">
          <div class="csi-avatar">${esc(initial)}</div>
          <div class="csi-info">
            <div class="csi-name">${esc(c.patient.name) || 'Unnamed Patient'}</div>
            ${meta ? `<div class="csi-meta">${meta}</div>` : ''}
          </div>
          <svg class="csi-tick" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
        </div>`;
    }).join('') : `<p class="text-muted text-sm" style="padding:.75rem">No patients match your search.</p>`;

    list.querySelectorAll('.case-select-item').forEach(item => {
      item.addEventListener('click', () => {
        list.querySelectorAll('.case-select-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        document.getElementById('btnStartSession').disabled = false;
        activeCase = getCases().find(c => c.id === item.dataset.id);
      });
    });
  }

  renderCaseItems(cases);

  // Search filter
  const searchInput = document.getElementById('caseSearch');
  if (searchInput) {
    searchInput.value = '';
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const filtered = q
        ? cases.filter(c =>
            (c.patient.name || '').toLowerCase().includes(q) ||
            (c.patient.occupation || '').toLowerCase().includes(q) ||
            String(c.patient.age || '').includes(q)
          )
        : cases;
      renderCaseItems(filtered);
      // Deselect if the active case is filtered out
      if (activeCase && !filtered.find(c => c.id === activeCase.id)) {
        activeCase = null;
        document.getElementById('btnStartSession').disabled = true;
      }
    });
  }

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
  hintsViewed = new Set();
  mcTurns = 0;
  freeTurns = 0;
  clearMcOptions();

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

  // Focus input (skip on mobile so the keyboard doesn't cover the chat)
  if (!isMobileViewport()) document.getElementById('chatInput')?.focus();
}

function showSetup() {
  document.getElementById('setupScreen').classList.remove('hidden');
  document.getElementById('sessionScreen').classList.add('hidden');
  activeCase = null;
  systemPrompt = '';
  conversation = [];
}

// ── Messaging ──
async function handleSend(fromMc = false) {
  const input = document.getElementById('chatInput');
  const text = input?.value?.trim();
  if (!text || isWaiting) return;

  // Track MC vs free-text turns (only when MC mode is active)
  if (mcModeEnabled) {
    if (fromMc) mcTurns++; else freeTurns++;
  }

  // Stop microphone and clear MC options before sending
  stopRecordingIfActive();
  clearMcOptions();

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
    // Show MC options after patient responds (async, non-blocking)
    showMcOptions();
  } catch (err) {
    appendMessage('system', `Error: ${err.message}`);
  } finally {
    showTyping(false);
    isWaiting = false;
    document.getElementById('sendBtn').disabled = false;
    // Don't auto-focus on mobile — it pops the keyboard over the patient's
    // reply right as the student wants to read it. Desktop keeps the focus
    // so typing/Enter still works without an extra click.
    if (!isMobileViewport()) document.getElementById('chatInput')?.focus();
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

  // Learning supports section (only shown if either feature was used)
  const supportsEl = document.getElementById('learningSupportsSection');
  if (supportsEl) {
    const hintCount = hintsViewed.size;
    const usedMc = mcTurns > 0;
    if (hintCount > 0 || usedMc) {
      const hintLabels = COVERAGE_SECTIONS
        .filter(s => hintsViewed.has(s.key))
        .map(s => s.label);
      const parts = [];
      if (hintCount > 0) parts.push(`<div class="supports-item">💡 Hints viewed for: <em>${hintLabels.join(', ')}</em></div>`);
      if (usedMc) {
        const totalMcTurns = mcTurns + freeTurns;
        parts.push(`<div class="supports-item">⊞ Guided questions used for ${mcTurns} of ${totalMcTurns} turn${totalMcTurns !== 1 ? 's' : ''}</div>`);
      }
      supportsEl.innerHTML = `
        <div class="supports-card">
          <div class="supports-title">Learning supports used</div>
          ${parts.join('')}
          <p class="supports-note">Using available tools is a normal part of building clinical vocabulary — they help you internalise the questions over time.</p>
        </div>`;
      supportsEl.classList.remove('hidden');
    } else {
      supportsEl.classList.add('hidden');
      supportsEl.innerHTML = '';
    }
  }

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
