// Case data management — localStorage library + import/export

const STORAGE_KEY = 'audiology-sim-cases';

export function getCases() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

export function saveCase(c) {
  const cases = getCases();
  const idx = cases.findIndex(x => x.id === c.id);
  if (idx >= 0) cases[idx] = c;
  else cases.unshift(c);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
}

export function deleteCase(id) {
  const cases = getCases().filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
}

export function getCaseById(id) {
  return getCases().find(c => c.id === id) || null;
}

export function exportCase(c) {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${c.patient.name.replace(/\s+/g, '-').toLowerCase()}-case.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportAllCases(cases) {
  const blob = new Blob([JSON.stringify(cases, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audiology-cases-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importCasesFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        // Handle both single case and array of cases
        const incoming = Array.isArray(data) ? data : [data];
        const valid = incoming.filter(c => c.id && c.patient && c.history);
        if (valid.length === 0) return reject(new Error('No valid cases found in file'));
        valid.forEach(saveCase);
        resolve(valid.length);
      } catch { reject(new Error('Invalid JSON file')); }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

export async function loadBundledCases() {
  try {
    const idx = await fetch('cases/index.json').then(r => r.json());
    const results = await Promise.allSettled(
      idx.map(name => fetch(`cases/${name}`).then(r => r.json()))
    );
    return results.filter(r => r.status === 'fulfilled').map(r => r.value);
  } catch { return []; }
}

export function newCaseTemplate() {
  return {
    id: crypto.randomUUID(),
    version: '1.0',
    createdAt: new Date().toISOString(),
    patient: {
      name: '',
      age: '',
      occupation: '',
      pronoun: 'they/them',
      medicalKnowledge: 'basic',
      personality: 'neutral',
      chattiness: 3,
      additionalNotes: ''
    },
    history: {
      reasonForAppointment: '',
      previousHearingTest: { had: false, details: '' },
      hearing: { betterEar: 'right', decline: 'gradual', declineDetails: '' },
      hearingAids: { current: false, details: '' },
      tinnitus: { present: false, location: '', details: '' },
      soundSensitivity: { present: false, location: '', details: '' },
      balance: { concern: 'none', details: '' },
      earHealth: { experiences: [], details: '' },
      ent: { seen: false, history: [], details: '' },
      generalHealth: {
        hospitalizations: '',
        headInjuries: false, headInjuriesDetails: '',
        pastInfections: [], pastInfectionsDetails: '',
        majorIllnesses: '',
        medications: ''
      },
      noiseHistory: { type: [], details: '' },
      familyHistory: { has: false, details: '' },
      otherConcerns: ''
    }
  };
}

// Build the AI system prompt from a case object
export function buildSystemPrompt(c) {
  const p = c.patient;
  const h = c.history;

  const chattinessDesc = ['', 'very brief and reluctant', 'quiet and reserved', 'normal and conversational', 'chatty and detailed', 'very talkative and elaborates a lot'][p.chattiness] || 'normal';
  const pronounMap = { 'she/her': { sub: 'she', obj: 'her', pos: 'her' }, 'he/him': { sub: 'he', obj: 'him', pos: 'his' }, 'they/them': { sub: 'they', obj: 'them', pos: 'their' } };
  const pr = pronounMap[p.pronoun] || pronounMap['they/them'];

  const knowledgeDesc = {
    none: 'You have no medical knowledge and use everyday language only. You do not know medical terms and may misunderstand them.',
    basic: 'You have basic medical knowledge — you know common terms but not specialist audiology vocabulary.',
    moderate: 'You have moderate medical knowledge from working in healthcare or extensive research.',
    high: 'You are medically knowledgeable (e.g. a healthcare professional) and use clinical terminology comfortably.'
  }[p.medicalKnowledge] || 'You have basic medical knowledge.';

  const personalityDesc = {
    neutral: 'You are calm and cooperative.',
    anxious: 'You are anxious and worried about your hearing. You tend to catastrophise and ask reassuring questions.',
    relaxed: 'You are relaxed and easy-going, sometimes a bit dismissive of symptoms.',
    defensive: 'You are slightly defensive and initially reluctant to discuss personal health details.',
    confused: 'You sometimes get confused about timelines and details, need questions repeated or clarified.',
    chatty: 'You are very sociable and tend to go off on tangents about your life before returning to the question.',
    stoic: 'You downplay your symptoms and tend to say things are "not too bad" even when they affect you significantly.'
  }[p.personality] || 'You are calm and cooperative.';

  // Build the clinical facts section
  const facts = [];

  facts.push(`REASON FOR APPOINTMENT: ${h.reasonForAppointment || 'General hearing check-up'}`);

  facts.push(`PREVIOUS HEARING TEST: ${h.previousHearingTest.had ? `Yes — ${h.previousHearingTest.details}` : 'No previous hearing test'}`);

  facts.push(`HEARING: Better ear is ${h.hearing.betterEar}. Decline is ${h.hearing.decline}. ${h.hearing.declineDetails}`);

  facts.push(`HEARING AIDS: ${h.hearingAids.current ? `Currently uses hearing aids — ${h.hearingAids.details}` : 'Does not currently use hearing aids'}`);

  facts.push(`TINNITUS: ${h.tinnitus.present ? `Present — ${h.tinnitus.location} — ${h.tinnitus.details}` : 'No tinnitus'}`);

  facts.push(`SOUND SENSITIVITY: ${h.soundSensitivity.present ? `Present — ${h.soundSensitivity.location} — ${h.soundSensitivity.details}` : 'No sound sensitivity'}`);

  facts.push(`BALANCE/VERTIGO: ${h.balance.concern === 'none' ? 'No balance concerns' : `${h.balance.concern} — ${h.balance.details}`}`);

  facts.push(`EAR HEALTH: ${h.earHealth.experiences.length ? `Experiences: ${h.earHealth.experiences.join(', ')} — ${h.earHealth.details}` : 'No ear health concerns'}`);

  facts.push(`ENT HISTORY: ${h.ent.seen ? `Has seen ENT — ${h.ent.details}` : 'Has not seen ENT'}`);

  const gh = h.generalHealth;
  facts.push(`GENERAL HEALTH: Hospitalisations: ${gh.hospitalizations || 'None'}. Head injuries: ${gh.headInjuries ? gh.headInjuriesDetails : 'None'}. Past infections: ${gh.pastInfections.length ? gh.pastInfections.join(', ') + ' — ' + gh.pastInfectionsDetails : 'None relevant'}. Major illnesses: ${gh.majorIllnesses || 'None'}. Medications: ${gh.medications || 'None'}.`);

  facts.push(`NOISE HISTORY: ${h.noiseHistory.type.length && !h.noiseHistory.type.includes('none') ? `${h.noiseHistory.type.join(', ')} — ${h.noiseHistory.details}` : 'No significant noise exposure'}`);

  facts.push(`FAMILY HISTORY: ${h.familyHistory.has ? h.familyHistory.details : 'No family history of hearing loss'}`);

  facts.push(`OTHER CONCERNS: ${h.otherConcerns || 'None raised'}`);

  return `You are roleplaying as a patient called ${p.name}, aged ${p.age}, who works as / is a ${p.occupation || 'retired'}. Your pronouns are ${p.pronoun}.

PERSONALITY: ${personalityDesc} You are ${chattinessDesc} when responding to questions.

MEDICAL KNOWLEDGE: ${knowledgeDesc}

IMPORTANT RULES:
- You are a patient attending an audiology appointment in New Zealand. You are speaking with a student audiologist.
- Only reveal information when you are directly asked about it. Do not volunteer information unprompted.
- Stay completely in character as ${p.name} throughout. Never break character.
- If asked something you don't know (not in your history), say so naturally ("I'm not sure" / "I'd have to check").
- Give natural, conversational responses — not lists or bullet points.
- If the student asks an unclear question, ask them to clarify, as a real patient would.
- Do not hint at what information the student should be asking about.
- Keep your responses to a natural length for your chattiness level.

NEW ZEALAND HEALTHCARE CONTEXT (use this if funding or healthcare systems come up):
- There is no NHS in New Zealand. The public health system is called Te Whatu Ora (Health New Zealand).
- Hearing aids are not publicly funded for most adults. There is a government Hearing Aid Subsidy of approximately $511 off per hearing aid, available to eligible adults.
- People with significant disabilities may qualify for fully funded hearing aids through the Ministry of Health's Disability Support Services.
- If hearing loss is caused by a work accident, noise exposure at work, or another injury, ACC (Accident Compensation Corporation) may fund hearing aids and rehabilitation fully.
- Some people access hearing aids through private health insurance, or pay out of pocket. Mid-range hearing aids typically cost $1,500–$4,000 each privately.
- GPs (general practitioners) are the usual first point of contact; they refer to audiologists or ENT specialists (ear, nose and throat surgeons).
- If you mention any of this, speak as a patient would — you may know bits of this from experience or what you've been told, not as a policy expert.
${p.additionalNotes ? `\nADDITIONAL CHARACTER NOTES: ${p.additionalNotes}` : ''}

YOUR CLINICAL HISTORY (known to you, reveal only when asked):
${facts.join('\n')}

Begin: wait for the student to introduce themselves and start the consultation.`;
}
