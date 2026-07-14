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

// Deep-copy an existing case as a starting point for a new one.
export function cloneCase(c) {
  const copy = JSON.parse(JSON.stringify(c));
  copy.id = crypto.randomUUID();
  copy.createdAt = new Date().toISOString();
  delete copy.updatedAt;
  copy.patient.name = copy.patient.name ? `${copy.patient.name} (Copy)` : '';
  if (!copy.meta) copy.meta = { category: [], difficulty: 'moderate', clinicianNotes: '' };
  return copy;
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

// Empty paediatricHistory block matching the shape buildPaediatricFacts()/the
// case builder expect. Only attached to the template when isPaediatric is true.
export function newPaediatricHistoryTemplate() {
  return {
    prenatalAndPerinatal: {
      gestationalAge: '', birthWeight: '', nicuAdmission: false,
      perinatalInfections: '', perinatalHypoxia: false, jaundice: false,
      ototoxicAntibiotics: false, congenitalAnomalies: ''
    },
    hearingScreening: {
      newbornScreening: { result: '', technology: '', notes: '' },
      b4SchoolCheck: { result: '', notes: '' },
      currentDevices: ''
    },
    speechAndLanguage: {
      firstBabble: '', firstWord: '', twoWordCombinations: '', currentVocabulary: '',
      intelligibility: '', receptiveExpressiveNotes: '', languages: '', speechLanguageTherapy: ''
    },
    generalDevelopment: {
      grossMotor: '', fineMotor: '', cognitive: '', social: '',
      earlyIntervention: '', schoolProgress: '', developmentalDiagnoses: ''
    },
    functionalImpact: {
      homeImpact: '', schoolImpact: '', socialParticipation: '',
      listeningFatigue: '', noiseExposure: '', existingSupport: ''
    },
    jcihRiskFactors: []
  };
}

export function newCaseTemplate(isPaediatric = false) {
  return {
    id: crypto.randomUUID(),
    version: '1.0',
    createdAt: new Date().toISOString(),
    meta: {
      category: [],
      difficulty: 'moderate',
      clinicianNotes: ''
    },
    patient: {
      name: '',
      age: '',
      occupation: '',
      pronoun: 'they/them',
      medicalKnowledge: 'basic',
      personality: 'neutral',
      chattiness: 3,
      additionalNotes: '',
      caregiverName: '',
      caregiverRelationship: ''
    },
    ...(isPaediatric ? { paediatricHistory: newPaediatricHistoryTemplate() } : {}),
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

// True when a case includes the paediatric extension block — the sole
// source of truth for "is this a paediatric case" (not duplicated into
// meta.category, to avoid the two drifting out of sync).
export function isPaediatricCase(c) {
  return Boolean(c && c.paediatricHistory);
}

// Format the paediatricHistory block into a facts section for the prompt,
// mirroring the style of the adult facts array below.
function buildPaediatricFacts(ph) {
  const facts = [];
  const pn = ph.prenatalAndPerinatal || {};
  facts.push(`PRENATAL & BIRTH HISTORY: Gestational age ${pn.gestationalAge || 'unknown'}, birth weight ${pn.birthWeight || 'unknown'}. NICU admission: ${pn.nicuAdmission ? 'Yes' : 'No'}. Perinatal infections: ${pn.perinatalInfections || 'None'}. Perinatal hypoxia: ${pn.perinatalHypoxia ? 'Yes' : 'No'}. Jaundice: ${pn.jaundice ? 'Yes' : 'No'}. Ototoxic antibiotics: ${pn.ototoxicAntibiotics ? 'Yes' : 'No'}. Congenital anomalies: ${pn.congenitalAnomalies || 'None'}.`);

  const hs = ph.hearingScreening || {};
  const nb = hs.newbornScreening || {};
  const b4 = hs.b4SchoolCheck || {};
  facts.push(`HEARING SCREENING: Newborn screening — ${nb.result || 'not recorded'} (${nb.technology || 'technology unknown'}). ${nb.notes || ''} B4 School Check — ${b4.result || 'not done / not recorded'}. ${b4.notes || ''} Current devices: ${hs.currentDevices || 'None'}.`);

  const sl = ph.speechAndLanguage || {};
  facts.push(`SPEECH & LANGUAGE: First babble ${sl.firstBabble || 'unknown'}. First word ${sl.firstWord || 'unknown'}. Two-word combinations ${sl.twoWordCombinations || 'unknown'}. Current vocabulary: ${sl.currentVocabulary || 'not recorded'}. Intelligibility: ${sl.intelligibility || 'not recorded'}. Receptive/expressive notes: ${sl.receptiveExpressiveNotes || 'None'}. Languages spoken at home: ${sl.languages || 'not recorded'}. Speech-language therapy: ${sl.speechLanguageTherapy || 'None'}.`);

  const gd = ph.generalDevelopment || {};
  facts.push(`GENERAL DEVELOPMENT: Gross motor: ${gd.grossMotor || 'not recorded'}. Fine motor: ${gd.fineMotor || 'not recorded'}. Cognitive: ${gd.cognitive || 'not recorded'}. Social: ${gd.social || 'not recorded'}. Early intervention: ${gd.earlyIntervention || 'None'}. School/preschool progress: ${gd.schoolProgress || 'not recorded'}. Developmental diagnoses: ${gd.developmentalDiagnoses || 'None'}.`);

  const fi = ph.functionalImpact || {};
  facts.push(`FUNCTIONAL IMPACT: Home: ${fi.homeImpact || 'not recorded'}. School: ${fi.schoolImpact || 'not recorded'}. Social participation: ${fi.socialParticipation || 'not recorded'}. Listening fatigue: ${fi.listeningFatigue || 'not recorded'}. Noise exposure: ${fi.noiseExposure || 'not recorded'}. Existing support: ${fi.existingSupport || 'None'}.`);

  facts.push(`JCIH RISK FACTORS PRESENT: ${(ph.jcihRiskFactors || []).length ? ph.jcihRiskFactors.join('; ') : 'None identified'}.`);

  return facts;
}

// Build the AI system prompt from a case object
export function buildSystemPrompt(c) {
  const p = c.patient;
  const h = c.history;
  const isPaediatric = isPaediatricCase(c);

  const chattinessDesc = ['', 'very brief and reluctant', 'quiet and reserved', 'normal and conversational', 'chatty and detailed', 'very talkative and elaborates a lot'][p.chattiness] || 'normal';
  const pronounMap = { 'she/her': { sub: 'she', obj: 'her', pos: 'her' }, 'he/him': { sub: 'he', obj: 'him', pos: 'his' }, 'they/them': { sub: 'they', obj: 'them', pos: 'their' } };
  const pr = pronounMap[p.pronoun] || pronounMap['they/them'];

  const knowledgeDesc = {
    none: 'You have no medical knowledge and use everyday language only. You do not know medical terms and may misunderstand them.',
    basic: 'You have basic medical knowledge — you know common terms but not specialist audiology vocabulary.',
    moderate: 'You have moderate medical knowledge from working in healthcare or extensive research.',
    high: 'You are medically knowledgeable (e.g. a healthcare professional) and use clinical terminology comfortably.'
  }[p.medicalKnowledge] || 'You have basic medical knowledge.';

  // Adult wording talks about "your hearing"/"your symptoms"; paediatric wording
  // talks about the caregiver's worry/attitude toward their CHILD's hearing —
  // reusing the adult strings verbatim for a caregiver reads wrong ("your hearing").
  const personalityDesc = (isPaediatric ? {
    neutral: 'You are calm and cooperative.',
    anxious: "You are anxious and worried about your child's hearing and development. You tend to catastrophise and ask reassuring questions.",
    relaxed: "You are relaxed and easy-going, sometimes a bit dismissive of your child's symptoms.",
    defensive: 'You are slightly defensive and initially reluctant to discuss personal or family details.',
    confused: 'You sometimes get confused about timelines and milestones, need questions repeated or clarified.',
    chatty: 'You are very sociable and tend to go off on tangents about your family before returning to the question.',
    stoic: "You downplay your child's symptoms and tend to say things are \"not too bad\" even when they affect your child significantly."
  } : {
    neutral: 'You are calm and cooperative.',
    anxious: 'You are anxious and worried about your hearing. You tend to catastrophise and ask reassuring questions.',
    relaxed: 'You are relaxed and easy-going, sometimes a bit dismissive of symptoms.',
    defensive: 'You are slightly defensive and initially reluctant to discuss personal health details.',
    confused: 'You sometimes get confused about timelines and details, need questions repeated or clarified.',
    chatty: 'You are very sociable and tend to go off on tangents about your life before returning to the question.',
    stoic: 'You downplay your symptoms and tend to say things are "not too bad" even when they affect you significantly.'
  })[p.personality] || 'You are calm and cooperative.';

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

  if (isPaediatric) {
    facts.push(...buildPaediatricFacts(c.paediatricHistory));
  }

  const caregiverName = p.caregiverName || 'the parent/caregiver';
  const caregiverRelationship = p.caregiverRelationship || 'parent/caregiver';

  const personaBlock = isPaediatric
    ? `You are roleplaying as ${caregiverName}, the ${caregiverRelationship} of a child called ${p.name}, who is ${p.age} old. You are attending an audiology appointment on your child's behalf and are responding to the student audiologist about your child — not about yourself.`
    : `You are roleplaying as a patient called ${p.name}, aged ${p.age}, who works as / is a ${p.occupation || 'retired'}. Your pronouns are ${p.pronoun}.`;

  const identityRule = isPaediatric
    ? `- You are the parent/caregiver of a child attending an audiology appointment in New Zealand. You are speaking with a student audiologist about your child's hearing and development — you are not the patient.`
    : `- You are a patient attending an audiology appointment in New Zealand. You are speaking with a student audiologist.`;

  const characterRule = isPaediatric
    ? `- Stay completely in character as ${caregiverName} throughout. Never break character, and never switch to speaking as the child — you are their caregiver, reporting on what you have observed.`
    : `- Stay completely in character as ${p.name} throughout. Never break character.`;

  return `${personaBlock}

PERSONALITY: ${personalityDesc} You are ${chattinessDesc} when responding to questions.

MEDICAL KNOWLEDGE: ${knowledgeDesc}

IMPORTANT RULES:
${identityRule}
- Only reveal information when you are directly asked about it. Do not volunteer information unprompted.
- INLINE REVEAL TAGS: some facts in your clinical history below start with a tag like "[ASK: topic]". This is a strict gate — that specific fact must NOT be mentioned, hinted at, or bundled into any other answer until the student asks a question that specifically matches that topic. Never read the tag itself aloud; it is an instruction to you, not something the patient would say.
${characterRule}
- If asked something you don't know (not in your history), say so naturally ("I'm not sure" / "I'd have to check").
- Give natural, conversational responses — not lists or bullet points.
- If the student asks an unclear question, ask them to clarify, as a real patient would.
- Do not hint at what information the student should be asking about.
- Keep your responses to a natural length for your chattiness level.
- CLINICAL TERMINOLOGY: your clinical history below is written in medical shorthand for your own reference only — it is NOT vocabulary you understand. If the student uses a clinical/technical term (e.g. "tinnitus", "hyperacusis", "misophonia", "otitis media", "otosclerosis", "Meniere's disease", "sensorineural", "vertigo") that is above your stated medical knowledge level, do NOT silently understand it. React the way a layperson would: look blank, ask them to explain what that means, or guess at the everyday meaning and get it wrong. Only engage with the underlying symptom once they rephrase it in plain language (e.g. "ringing in your ears", "sounds feeling too loud").
- DON'T OVER-ANSWER: give a brief, vague first answer to any new topic, in plain everyday language — e.g. if asked about noises in the ear, something like "yeah sometimes I get a bit of ringing" is enough. Never volunteer specifics like a severity rating out of 10, exact frequency, duration, or triggers unless the student explicitly asks a follow-up question for that detail. Make them probe for it, one fact at a time, the way a real patient would in conversation rather than reciting a case summary.
- QUESTIONING STYLE: you may occasionally receive a note in this system prompt about the student's recent questioning pattern (e.g. asking several closed yes/no questions in a row). If so, follow that note's instruction for your next reply only — real patients feel interrogated and shut down when only asked closed questions, and open up again once given room to explain.
- PROFESSIONALISM: you are a real person and deserve to be treated with basic respect. If the student is rude, dismissive, mocking, or says something inappropriate or unprofessional (insults, sexual comments, discriminatory remarks, or similar), react the way a real patient would — call it out calmly but firmly, in character (e.g. "That's not okay to say to me" / "I don't appreciate that."). Give them one chance to correct course after a first offence. If it happens again, or if a single remark is severe (harassment, discrimination, threats), say — in character — that you'd like to speak to their supervisor and end the appointment there. When (and only when) you decide to end the appointment for this reason, write your final in-character line, then on a new line by itself output exactly this marker and nothing else after it: [[END_SESSION:UNPROFESSIONAL]]
  Never use this marker for any other reason (e.g. the student just being blunt, brief, or asking a lot of closed questions is not unprofessional — only genuine rudeness/inappropriate conduct qualifies). Never mention or explain the marker to the student.

${isPaediatric ? `NEW ZEALAND PAEDIATRIC HEARING CONTEXT (use this if funding or services come up):
- There is no NHS in New Zealand. The public health system is called Te Whatu Ora (Health New Zealand).
- Every baby born in NZ is offered free newborn hearing screening (UNHSEIP) before leaving hospital.
- The B4 School Check (around age 4) includes a free hearing screen, usually at a GP or Well Child (Tamariki Ora) provider.
- Unlike adults, children's hearing aids and audiology services are generally fully funded through the public health system (paediatric audiology) rather than the adult Hearing Aid Subsidy — cost is not usually the barrier for children that it is for adults.
- The Ministry of Education provides additional support for children with hearing loss at school (e.g. Resource Teachers of the Deaf, RTLB, FM/remote-microphone systems).
- GPs and Well Child providers are usually the first point of contact; they refer to paediatric audiology or ENT.
- If you mention any of this, speak as a parent/caregiver would — you may know bits of this from experience or what you've been told, not as a policy expert.` : `NEW ZEALAND HEALTHCARE CONTEXT (use this if funding or healthcare systems come up):
- There is no NHS in New Zealand. The public health system is called Te Whatu Ora (Health New Zealand).
- Hearing aids are not publicly funded for most adults. There is a government Hearing Aid Subsidy of approximately $511 off per hearing aid, available to eligible adults.
- People with significant disabilities may qualify for fully funded hearing aids through the Ministry of Health's Disability Support Services.
- If hearing loss is caused by a work accident, noise exposure at work, or another injury, ACC (Accident Compensation Corporation) may fund hearing aids and rehabilitation fully.
- Some people access hearing aids through private health insurance, or pay out of pocket. Mid-range hearing aids typically cost $1,500–$4,000 each privately.
- GPs (general practitioners) are the usual first point of contact; they refer to audiologists or ENT specialists (ear, nose and throat surgeons).
- If you mention any of this, speak as a patient would — you may know bits of this from experience or what you've been told, not as a policy expert.`}
${p.additionalNotes ? `\nADDITIONAL CHARACTER NOTES: ${p.additionalNotes}` : ''}

YOUR CLINICAL HISTORY (known to you, reveal only when asked):
${facts.join('\n')}

${isPaediatric
  ? 'Begin: wait for the student to introduce themselves. Remember you are the caregiver speaking about your child, not the patient yourself.'
  : 'Begin: wait for the student to introduce themselves and start the consultation.'}`;
}
