import { getCases, loadBundledCases, saveCase, buildSystemPrompt, isPaediatricCase } from './cases.js';
import { sendMessage, getAiReview, getSuggestedQuestions, getSessionToken, setSessionToken, getProxyUrl, setProxyUrl } from './api.js';

// Matches the mobile breakpoint in css/styles.css (@media max-width: 768px).
function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

// ── Closed-question streak tracking ──
// Heuristic only — good enough to nudge behaviour, not a precise classifier.
// A large share of real history-taking questions are fragments/confirmations
// ("Any ringing?", "Worse on the phone?", "So it's mainly the left?") that
// don't start with an aux verb — treat anything phrased as a question that
// isn't recognisably open as closed, rather than letting it fall through
// uncounted. Only genuine non-question statements return 'other'.
function classifyQuestion(text) {
  let t = (text || '').trim().toLowerCase();
  // Strip leading filler/conjunctions (possibly chained, e.g. "Okay, and how long…")
  // so the real question word underneath still gets read as open.
  let stripped;
  do {
    stripped = t.replace(/^(and|so|ok|okay|alright|right|now|well|um)[\s,]+/, '');
    if (stripped === t) break;
    t = stripped;
  } while (true);
  // Note: "which" is deliberately excluded here — "Which ear…"/"Which relatives…"
  // are grammatically wh-questions but functionally closed/limited-choice; they
  // fall through to the "ends in ?" rule below and land as closed, correctly.
  if (/^(what|how|why|when|where|who)\b/.test(t)) return 'open';
  if (/^(tell me|describe|walk me through|talk me through|can you tell me|could you tell me|can you describe|could you describe|can you explain|could you explain)\b/.test(t)) return 'open';
  if (/\?\s*$/.test(t)) return 'closed';
  if (/^(do|does|did|have|has|had|is|are|was|were|can|could|will|would|should|any)\b/.test(t)) return 'closed';
  return 'other';
}

// Counts consecutive closed questions since the last open question, scanning
// backwards from the most recent student turn. Non-question statements are
// skipped (neither reset nor extend the streak).
function closedQuestionStreak(conversation) {
  let streak = 0;
  let scanned = 0;
  for (let i = conversation.length - 1; i >= 0 && scanned < 12; i--) {
    const m = conversation[i];
    if (m.role !== 'user') continue;
    scanned++;
    const cls = classifyQuestion(m.content);
    if (cls === 'closed') streak++;
    else if (cls === 'open') break;
  }
  return streak;
}

// Tally open vs closed questions across the whole conversation so far.
// Non-question statements ('other') are excluded from the count entirely —
// they're not part of the open/closed picture either way.
function computeQuestionBalance(conversation) {
  let open = 0, closed = 0;
  for (const m of conversation) {
    if (m.role !== 'user') continue;
    const cls = classifyQuestion(m.content);
    if (cls === 'open') open++;
    else if (cls === 'closed') closed++;
  }
  return { open, closed, total: open + closed };
}

// Real history-taking legitimately runs several closed screening questions
// in a row within one topic (most of the hint bank is "Have you…"/"Do you…"
// style) — that's appropriate drilling, not interrogation, and shouldn't
// trip this. Only a genuinely long, unbroken run should. Chatty patients
// get an even longer leash since reining them in takes more closed questions.
function buildDynamicDirective(conversation, patient) {
  const streak = closedQuestionStreak(conversation);
  const threshold = (patient?.chattiness >= 4) ? 8 : 7;
  if (streak < threshold) return '';
  return `\n\nCURRENT CONVERSATION DYNAMIC: The student has now asked ${streak} closed (yes/no style) questions in a row without a single open question giving you room to elaborate. Real patients start to feel interrogated by a run this long and shut down a little. For your NEXT reply only: answer more briefly than usual and hold back detail you'd normally volunteer — but you don't need to go fully monosyllabic, a short, slightly clipped answer is enough. This resets back to your normal chattiness the moment they ask an open-ended question (a "what"/"how"/"why"/"tell me about" style question).`;
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
        // Skip on mobile: handleSend() stops the mic via stopRecordingIfActive(),
        // which fires this onend — re-focusing here reopens the keyboard right
        // as the patient's reply is coming in.
        if (!isMobileViewport()) input.focus();
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
const ADULT_SECTION_HINTS = {
  reasonForAppointment: [
    'What brings you in to see us today?',
    'Can you tell me in your own words what\'s been concerning you?',
    'Have you been referred here, or did you make this appointment yourself?',
  ],
  previousHearingTest: [
    'What can you tell me about any hearing tests you\'ve had before?',
    'Have you had your hearing tested before?',
    'When was your last hearing test, and where did you have it done?',
    'Do you remember what the results showed, or were you given any follow-up advice?',
  ],
  hearingDetails: [
    'Tell me about how your hearing has been.',
    'Which ear do you feel you hear better from?',
    'Has your hearing changed gradually over time, or did it happen more suddenly?',
    'When did you first notice your hearing wasn\'t quite right?',
  ],
  hearingAids: [
    'Tell me about your experience with hearing aids, if you\'ve used them.',
    'Do you currently use any hearing aids?',
    'How long have you been wearing hearing aids, and what style are they?',
    'How are you finding your hearing aids — are they helping?',
  ],
  tinnitus: [
    'What\'s the noise in your ears like, if you notice any?',
    'Do you notice any ringing, buzzing, or other sounds in your ears when it\'s quiet?',
    'Have you been aware of any noises in your ears that other people can\'t hear?',
    'Does the sound seem to be in one ear, both ears, or more in your head?',
  ],
  soundSensitivity: [
    'How do loud or everyday sounds affect you?',
    'Do you find that certain sounds are uncomfortably loud for you?',
    'Are there everyday sounds — like cutlery or voices — that bother you more than they used to?',
    'Do loud sounds ever cause you pain or discomfort?',
  ],
  balance: [
    'Tell me about any balance or dizziness problems you\'ve had.',
    'Have you had any problems with your balance or dizziness?',
    'Do you ever feel like the room is spinning, or that you\'re unsteady on your feet?',
    'What seems to trigger your dizziness, and how long do episodes usually last?',
  ],
  earHealth: [
    'Tell me about any pain, pressure, or discharge you\'ve had with your ears.',
    'Have you had any pain, pressure, or a feeling of fullness in your ears?',
    'Have you ever had discharge or fluid coming from your ears?',
    'Have you had any ear infections, or has anyone suggested a build-up of wax?',
  ],
  entHistory: [
    'What\'s your history been with ear, nose and throat specialists, if any?',
    'Have you ever seen an ear, nose and throat specialist?',
    'Have you had any surgery or procedures on your ears?',
    'Have you had any scans or investigations related to your ears?',
  ],
  generalHealth: [
    'Tell me about your general health and any hospital visits.',
    'Have you ever been hospitalised, and was there any change in your hearing around that time?',
    'Do you have any ongoing health conditions I should know about?',
    'Are there any major illnesses in your history that might be relevant?',
  ],
  headInjuries: [
    'Tell me about any head injuries you\'ve had.',
    'Have you ever had a significant head injury or concussion?',
    'Did you notice any change in your hearing after the injury?',
    'Did you receive medical treatment for the head injury?',
  ],
  pastInfections: [
    'Tell me about your childhood illnesses and any ongoing health conditions.',
    'Have you had any childhood illnesses like measles, mumps, or meningitis?',
    'Do you have any ongoing conditions such as diabetes or cardiovascular disease?',
    'Have you had any serious infections in the past that you can recall?',
  ],
  medications: [
    'What medications are you currently taking, if any?',
    'Are you currently taking any medications, either prescribed or over the counter?',
    'Have you ever been on long-term antibiotics or had chemotherapy?',
    'Are there any medications you think might have affected your hearing?',
  ],
  noiseHistory: [
    'Tell me about your exposure to loud noise, at work or in your free time.',
    'Have you worked in a noisy environment — like a factory, construction, or farming?',
    'Do you have recreational noise exposure, such as concerts, loud music, or shooting?',
    'Have you worn hearing protection when exposed to loud noise?',
  ],
  familyHistory: [
    'Tell me about any hearing problems that run in your family.',
    'Is there any history of hearing loss in your family?',
    'Which relatives have had hearing difficulties — parents, siblings, or grandparents?',
    'Do any family members wear hearing aids?',
  ],
  otherConcerns: [
    'What else would you like to share about your hearing or ear health?',
    'Is there anything else about your hearing or ear health you\'d like to mention?',
    'Have we covered everything you wanted to discuss today?',
    'Is there anything you were hoping I\'d ask about that we haven\'t touched on?',
  ],
};

// Hint bank for paediatric sessions — keyed to PAEDIATRIC_COVERAGE_SECTIONS
// keys, questions phrased to the caregiver. Drawn from
// docs/paediatric_audiology_history_questionnaire.md.
const PAEDIATRIC_SECTION_HINTS = {
  presenting_concern: [
    'What brings you and your child in today?',
    'Why has your child been referred?',
    'Is the difficulty constant or does it come and go?',
  ],
  caregiver_concern: [
    'Tell me about what you\'ve noticed with your child\'s hearing.',
    'Do you personally think your child has a hearing problem?',
    'Does it seem to affect one ear more than the other, or both equally?',
  ],
  onset_course: [
    'Tell me about when you first noticed a concern, and whether it\'s changed over time.',
    'When did you first notice a concern?',
    'Has it stayed the same, or has it changed since you first noticed it?',
  ],
  previous_tests: [
    'What can you tell me about any hearing tests your child has had before?',
    'Has your child had any previous hearing tests?',
    'Do you know what the results were?',
  ],
  newborn_screening: [
    'Tell me about your child\'s newborn hearing screening.',
    'Was your child\'s hearing tested at birth?',
    'Do you know the result — pass or refer — and which ear(s)?',
  ],
  b4_school_check: [
    'Tell me about your child\'s B4 School Check.',
    'Did your child have the B4 School Check?',
    'What was the hearing result?',
  ],
  birth_history: [
    'Tell me about the pregnancy and your child\'s birth.',
    'How many weeks was your child when they were born?',
    'Were there any complications during the pregnancy?',
  ],
  perinatal_risk: [
    'Tell me about the first few days after your child was born.',
    'Was your child admitted to the neonatal intensive care unit (NICU)?',
    'Did your child have jaundice that required treatment?',
  ],
  ear_health: [
    'Tell me about any ear infections or ear problems your child has had.',
    'Has your child had frequent ear infections or been told they have fluid in the ears?',
    'Has your child had any ear surgery, like grommets?',
  ],
  speech_language: [
    'Tell me about how your child\'s speech and language have developed.',
    'When did your child say their first word?',
    'How clearly does your child speak — can people outside the family understand them?',
  ],
  milestones: [
    'Tell me about your child\'s general development.',
    'Did your child reach their motor milestones around the expected time?',
    'Has your child received any early intervention services?',
  ],
  school_function: [
    'Tell me how your child is getting on at preschool or school.',
    'Are teachers raising any concerns?',
    'Does your child follow instructions well in the classroom?',
  ],
  home_function: [
    'Tell me how the hearing concern affects your child at home.',
    'Do they turn the TV up, or miss things said from another room?',
    'Do they respond better when you\'re face-to-face with them?',
  ],
  family_history: [
    'Tell me about any hearing problems that run in your family.',
    'Is there any family history of hearing loss in childhood?',
    'Are the child\'s parents related to each other?',
  ],
  noise_exposure: [
    'Tell me about your child\'s exposure to loud noise.',
    'Has your child been exposed to any loud noise, recreational or otherwise?',
    'Does your child use headphones?',
  ],
  other_concerns: [
    'Is there anything else you\'d like to share or ask about?',
    'Is any support currently in place at school?',
    'What are you hoping happens as a result of today\'s appointment?',
  ],
};

// Active hint bank for the current session — swapped alongside
// COVERAGE_SECTIONS in startSession().
let SECTION_HINTS = ADULT_SECTION_HINTS;

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
const ADULT_COVERAGE_SECTIONS = [
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

// Paediatric coverage areas — used instead of ADULT_COVERAGE_SECTIONS when
// the active case has a paediatricHistory block. See docs/paediatric_extension_spec.md §3.
const PAEDIATRIC_COVERAGE_SECTIONS = [
  { key: 'presenting_concern', label: 'Presenting concern', keywords: ['hear','concern','today','appointment','refer','why'], subs: [] },
  { key: 'caregiver_concern',  label: "Caregiver's view of hearing", keywords: ['think','notice','worry','problem','hear','behave'], subs: [] },
  { key: 'onset_course',       label: 'Onset and time course', keywords: ['when','start','sudden','gradual','always','worse','better'], subs: [] },
  { key: 'previous_tests',     label: 'Previous hearing tests', keywords: ['test','before','result','audiology','screen'], subs: [] },
  { key: 'newborn_screening',  label: 'Newborn hearing screening', keywords: ['newborn','birth','hospital','aabr','oae','screen','pass','refer'], subs: [] },
  { key: 'b4_school_check',    label: 'B4 School Check', keywords: ['b4','school check','plunket','4 year','preschool check'], subs: [] },
  { key: 'birth_history',      label: 'Pregnancy and birth history', keywords: ['born','birth','pregnan','week','premature','nicu','weight','labour'], subs: [] },
  { key: 'perinatal_risk',     label: 'Perinatal risk factors', keywords: ['nicu','intensive care','jaundice','oxygen','transfusion','antibiotic','infection'], subs: [] },
  { key: 'ear_health',         label: 'Ear health and infections', keywords: ['ear','infection','glue','otitis','grommets','fluid','pain','discharge'], subs: [] },
  { key: 'speech_language',    label: 'Speech and language development', keywords: ['speak','word','sentence','babble','talk','say','speech','language','communicate'], subs: [] },
  { key: 'milestones',         label: 'Developmental milestones', keywords: ['walk','sit','develop','milestone','motor','crawl','grow'], subs: [] },
  { key: 'school_function',    label: 'Preschool or school function', keywords: ['school','preschool','teacher','classroom','group','instruction','learn'], subs: [] },
  { key: 'home_function',      label: 'Listening at home', keywords: ['home','tv','distance','room','respond','name','call'], subs: [] },
  { key: 'family_history',     label: 'Family history of hearing loss', keywords: ['family','relative','parent','sibling','grandpar','uncle','aunt','cousin','genetic'], subs: [] },
  { key: 'noise_exposure',     label: 'Noise exposure', keywords: ['noise','loud','concert','headphone','protect'], subs: [] },
  { key: 'other_concerns',     label: 'Other concerns', keywords: ['worry','question','aids','support','future','what happens'], subs: [] },
];

// Active set for the current session — swapped between the two arrays above
// in startSession() based on whether the case is paediatric. Kept as a `let`
// so every function below (trackCoverage, renderCoverage, endSession,
// handleAiReview) that reads COVERAGE_SECTIONS picks up the live value.
let COVERAGE_SECTIONS = ADULT_COVERAGE_SECTIONS;

let coveredSections = new Set();

// ── Hint panel ──
// Rebuilds the hint accordion from the CURRENT COVERAGE_SECTIONS/SECTION_HINTS.
// Must be called again whenever those are swapped (e.g. in startSession for a
// paediatric case) — it was previously only ever built once at page load,
// which meant a paediatric session would silently keep showing adult hints.
function renderHintPanel() {
  const body = document.getElementById('hintPanelBody');
  if (!body) return;

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
          ${hints.map(h => {
            const style = classifyQuestion(h);
            const badge = style === 'open' ? '<span class="hint-tag hint-tag-open">Open</span>' : style === 'closed' ? '<span class="hint-tag hint-tag-closed">Closed</span>' : '';
            return `<div class="hint-q">${badge}<span>${esc(h)}</span></div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  // Accordion toggle — re-attached each render since innerHTML was rebuilt.
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
}

function initHintPanel() {
  const btn = document.getElementById('btnHints');
  const panel = document.getElementById('hintPanel');
  const body = document.getElementById('hintPanelBody');
  if (!btn || !panel || !body) return;

  renderHintPanel();

  btn.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    panel.classList.toggle('hidden', !open);
    btn.classList.toggle('active', open);
  });
}

// ── Question balance (open vs closed) live indicator ──
let qBalanceEnabled = false;

function initQBalance() {
  const btn = document.getElementById('btnQBalance');
  const pill = document.getElementById('qBalancePill');
  if (!btn || !pill) return;
  btn.addEventListener('click', () => {
    qBalanceEnabled = !qBalanceEnabled;
    btn.classList.toggle('active', qBalanceEnabled);
    pill.classList.toggle('hidden', !qBalanceEnabled);
    if (qBalanceEnabled) updateQBalancePill();
    toast(qBalanceEnabled ? 'Question balance on — a live open vs. closed tally will show above the chat' : 'Question balance off', '');
  });
}

function updateQBalancePill() {
  if (!qBalanceEnabled) return;
  const pill = document.getElementById('qBalancePill');
  const barOpen = document.getElementById('qBalanceBarOpen');
  const counts = document.getElementById('qBalanceCounts');
  if (!pill || !barOpen || !counts) return;

  const { open, closed, total } = computeQuestionBalance(conversation);
  // Stay neutral/greyed out on a tiny sample — an early 1/1 split isn't meaningful.
  const warmedUp = total >= 3;
  pill.classList.toggle('qbalance-empty', !warmedUp);
  barOpen.style.width = total ? `${Math.round((open / total) * 100)}%` : '50%';
  counts.textContent = warmedUp ? `${open} open · ${closed} closed` : 'Ask a few more questions to see your balance';
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
  initQBalance();

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

  const DIFFICULTY_LABELS = { beginner: 'Beginner', moderate: 'Moderate', advanced: 'Advanced' };

  function renderCaseItems(filtered) {
    list.innerHTML = filtered.length ? filtered.map(c => {
      const initial = (c.patient.name || '?')[0].toUpperCase();
      const paediatric = isPaediatricCase(c);
      const metaParts = paediatric
        ? [c.patient.age || '', c.patient.caregiverName ? `caregiver: ${c.patient.caregiverName}` : '']
        : [c.patient.age ? c.patient.age + ' yrs' : '', c.patient.occupation || ''];
      const meta = metaParts.filter(Boolean).map(esc).join(' · ');
      const difficulty = DIFFICULTY_LABELS[c.meta?.difficulty] || 'Moderate';
      return `
        <div class="case-select-item" data-id="${c.id}">
          <div class="csi-avatar">${esc(initial)}</div>
          <div class="csi-info">
            <div class="csi-name">${esc(c.patient.name) || 'Unnamed Patient'}</div>
            ${meta ? `<div class="csi-meta">${meta}</div>` : ''}
          </div>
          ${paediatric ? '<span class="csi-paediatric" title="Paediatric case — respondent is a caregiver">🧒 Paediatric</span>' : ''}
          <span class="csi-difficulty csi-difficulty-${esc(c.meta?.difficulty || 'moderate')}">${esc(difficulty)}</span>
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

  // Search + difficulty + case-type filters (combined)
  const searchInput = document.getElementById('caseSearch');
  const difficultyFilter = document.getElementById('caseDifficultyFilter');
  const typeFilter = document.getElementById('caseTypeFilter');
  if (searchInput) searchInput.value = '';
  if (difficultyFilter) difficultyFilter.value = '';
  if (typeFilter) typeFilter.value = '';

  function applyFilters() {
    const q = (searchInput?.value || '').toLowerCase().trim();
    const difficulty = difficultyFilter?.value || '';
    const type = typeFilter?.value || '';
    const filtered = cases.filter(c => {
      const matchesQuery = !q ||
        (c.patient.name || '').toLowerCase().includes(q) ||
        (c.patient.occupation || '').toLowerCase().includes(q) ||
        String(c.patient.age || '').includes(q);
      const matchesDifficulty = !difficulty || (c.meta?.difficulty || 'moderate') === difficulty;
      const matchesType = !type || (type === 'paediatric' ? isPaediatricCase(c) : !isPaediatricCase(c));
      return matchesQuery && matchesDifficulty && matchesType;
    });
    renderCaseItems(filtered);
    // Deselect if the active case is filtered out
    if (activeCase && !filtered.find(c => c.id === activeCase.id)) {
      activeCase = null;
      document.getElementById('btnStartSession').disabled = true;
    }
  }

  searchInput?.addEventListener('input', applyFilters);
  difficultyFilter?.addEventListener('change', applyFilters);
  typeFilter?.addEventListener('change', applyFilters);

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

  const isPaediatric = isPaediatricCase(activeCase);

  systemPrompt = buildSystemPrompt(activeCase);
  conversation = [];
  coveredSections = new Set();
  hintsViewed = new Set();
  mcTurns = 0;
  freeTurns = 0;
  clearMcOptions();
  updateQBalancePill();

  // Swap the active coverage areas + hint bank for this session, and
  // re-render the hint panel accordion so it reflects the new set —
  // it's only ever built on demand here, not left over from a previous session.
  COVERAGE_SECTIONS = isPaediatric ? PAEDIATRIC_COVERAGE_SECTIONS : ADULT_COVERAGE_SECTIONS;
  SECTION_HINTS = isPaediatric ? PAEDIATRIC_SECTION_HINTS : ADULT_SECTION_HINTS;
  renderHintPanel();

  const coveragePanelTitle = document.getElementById('coveragePanelTitle');
  if (coveragePanelTitle) coveragePanelTitle.textContent = isPaediatric ? 'Paediatric History Coverage' : 'History Coverage';

  // Show chat UI
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('sessionScreen').classList.remove('hidden');

  // Fill patient header
  const p = activeCase.patient;
  if (isPaediatric) {
    document.getElementById('chatPatientName').textContent = p.name || 'Patient';
    const caregiverLabel = p.caregiverName ? `responding as caregiver (${p.caregiverName})` : 'responding as caregiver';
    document.getElementById('chatPatientMeta').textContent =
      [p.age ? `${p.age}` : '', caregiverLabel].filter(Boolean).join(' — ');
  } else {
    document.getElementById('chatPatientName').textContent = p.name || 'Patient';
    document.getElementById('chatPatientMeta').textContent =
      [p.age ? p.age + ' yrs' : '', p.occupation].filter(Boolean).join(' · ');
  }
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
  updateQBalancePill();

  // Track coverage
  trackCoverage(text);

  // Show typing
  showTyping(true);
  isWaiting = true;
  document.getElementById('sendBtn').disabled = true;
  // On mobile, drop focus so the on-screen keyboard closes while the
  // patient's reply comes in. Must happen AFTER disabling sendBtn — disabling
  // the element the user just tapped can otherwise bounce focus back onto
  // chatInput (a mobile browser quirk), reopening the keyboard immediately.
  if (isMobileViewport()) document.activeElement?.blur();

  try {
    const dynamicDirective = buildDynamicDirective(conversation, activeCase?.patient);
    let reply = await sendMessage(systemPrompt + dynamicDirective, conversation);

    const endMarker = '[[END_SESSION:UNPROFESSIONAL]]';
    const endedForUnprofessional = reply.includes(endMarker);
    if (endedForUnprofessional) reply = reply.replace(endMarker, '').trim();

    conversation.push({ role: 'assistant', content: reply });
    appendMessage('patient', reply);
    speakPatient(reply);

    if (endedForUnprofessional) {
      toast('The patient asked to speak with a supervisor and ended the session.', 'error');
      endSession();
      return;
    }

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

  // Question balance section — open vs closed questions across the session
  const qBalanceEl = document.getElementById('questionBalanceSection');
  if (qBalanceEl) {
    const { open, closed, total } = computeQuestionBalance(conversation);
    if (total >= 3) {
      const openPct = Math.round((open / total) * 100);
      qBalanceEl.innerHTML = `
        <div class="supports-card">
          <div class="supports-title">Question style</div>
          <div class="qbalance-bar" style="max-width:none;height:8px;margin-bottom:.4rem">
            <div class="qbalance-bar-open" style="width:${openPct}%"></div>
          </div>
          <div class="supports-item">${open} open question${open !== 1 ? 's' : ''} · ${closed} closed question${closed !== 1 ? 's' : ''}</div>
          <p class="supports-note">Open questions ("what", "how", "tell me about…") invite the patient to elaborate in their own words. Closed questions are great for confirming a specific detail once you have a lead — the skill is knowing which to reach for at each point in the conversation, not avoiding either one.</p>
        </div>`;
      qBalanceEl.classList.remove('hidden');
    } else {
      qBalanceEl.classList.add('hidden');
      qBalanceEl.innerHTML = '';
    }
  }

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
