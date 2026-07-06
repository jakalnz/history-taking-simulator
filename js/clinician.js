import { getCases, saveCase, deleteCase, exportCase, exportAllCases, importCasesFromFile, loadBundledCases, newCaseTemplate, cloneCase, newPaediatricHistoryTemplate, isPaediatricCase } from './cases.js';
import { getProxyUrl, setProxyUrl } from './api.js';

// ── Beta placeholder gate ──
// Not real security — just keeps casual visitors out during beta testing.
const CLINICIAN_PASSWORD = '1234';
if (sessionStorage.getItem('clinicianAuthed') !== 'true') {
  let entered = null;
  while (entered !== CLINICIAN_PASSWORD) {
    entered = window.prompt('Clinician mode is in beta. Enter the access password:');
    if (entered === null) {
      window.location.href = 'index.html';
      throw new Error('Clinician access cancelled');
    }
  }
  sessionStorage.setItem('clinicianAuthed', 'true');
}

// ── Toast ──
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── State ──
let currentCase = null;
let currentTab = 'library';

const CATEGORY_OPTIONS = ['NIHL','Presbycusis','Otosclerosis',"Meniere's",'Conductive/Otitis media','Sudden SNHL','Ototoxicity','Tinnitus-predominant','Vestibular','Congenital/Genetic','Traumatic','Undifferentiated'];
const DIFFICULTY_LABELS = { beginner: 'Beginner', moderate: 'Moderate', advanced: 'Advanced' };

// Legacy/imported cases may predate the meta field — backfill a safe default.
function ensureMeta(c) {
  if (!c.meta) c.meta = { category: [], difficulty: 'moderate', clinicianNotes: '' };
  if (!Array.isArray(c.meta.category)) c.meta.category = [];
  if (!c.meta.difficulty) c.meta.difficulty = 'moderate';
  if (typeof c.meta.clinicianNotes !== 'string') c.meta.clinicianNotes = '';
  return c;
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Proxy URL
  const proxyInput = document.getElementById('proxyUrl');
  if (proxyInput) {
    proxyInput.value = getProxyUrl();
    proxyInput.addEventListener('change', () => setProxyUrl(proxyInput.value.trim()));
  }

  // Tab switching
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Library actions
  document.getElementById('btnNewCase')?.addEventListener('click', openNewCase);
  document.getElementById('btnImport')?.addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile')?.addEventListener('change', handleImport);
  document.getElementById('btnExportAll')?.addEventListener('click', handleExportAll);
  document.getElementById('btnLoadBundled')?.addEventListener('click', handleLoadBundled);
  document.getElementById('filterCategory')?.addEventListener('change', renderLibrary);
  document.getElementById('filterDifficulty')?.addEventListener('change', renderLibrary);
  document.getElementById('filterCaseType')?.addEventListener('change', renderLibrary);

  // Builder actions
  document.getElementById('btnSaveCase')?.addEventListener('click', handleSave);
  document.getElementById('btnCancelEdit')?.addEventListener('click', () => switchTab('library'));
  document.getElementById('btnExportCase')?.addEventListener('click', handleExportCurrent);

  // Conditional sub-fields
  setupConditionals();

  renderLibrary();
});

// ── Tabs ──
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('[data-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.panel !== tab);
  });
  if (tab === 'library') renderLibrary();
}

// ── Library ──
function populateCategoryFilter() {
  const sel = document.getElementById('filterCategory');
  if (!sel || sel.dataset.populated) return;
  sel.dataset.populated = '1';
  CATEGORY_OPTIONS.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    sel.appendChild(opt);
  });
}

function renderLibrary() {
  populateCategoryFilter();
  const grid = document.getElementById('caseGrid');
  let cases = getCases().map(ensureMeta);

  const catFilter = document.getElementById('filterCategory')?.value || '';
  const diffFilter = document.getElementById('filterDifficulty')?.value || '';
  const typeFilter = document.getElementById('filterCaseType')?.value || '';
  if (catFilter) cases = cases.filter(c => c.meta.category.includes(catFilter));
  if (diffFilter) cases = cases.filter(c => c.meta.difficulty === diffFilter);
  if (typeFilter) cases = cases.filter(c => typeFilter === 'paediatric' ? isPaediatricCase(c) : !isPaediatricCase(c));

  if (cases.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🗂️</div>
      <p>${getCases().length === 0 ? 'No cases yet. Create a new case or import from a JSON file.' : 'No cases match the selected filters.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = cases.map(c => {
    const tags = buildTags(c);
    const paediatric = isPaediatricCase(c);
    return `<div class="case-card" data-id="${c.id}">
      <div class="case-card-name">${esc(c.patient.name) || 'Unnamed Patient'}</div>
      <div class="case-card-meta">${esc(c.patient.age) ? c.patient.age + ' yrs' : ''}${c.patient.occupation ? ' · ' + esc(c.patient.occupation) : ''}</div>
      <div class="case-card-tags">
        ${paediatric ? '<span class="tag" style="background:#ede9fe;color:#6d28d9">🧒 Paediatric</span>' : ''}
        <span class="tag navy">${esc(DIFFICULTY_LABELS[c.meta.difficulty] || 'Moderate')}</span>
        ${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
      </div>
      <div class="case-card-actions">
        <button class="btn btn-sm btn-secondary btn-edit" data-id="${c.id}">Edit</button>
        <button class="btn btn-sm btn-secondary btn-clone" data-id="${c.id}">Clone</button>
        <button class="btn btn-sm btn-secondary btn-export" data-id="${c.id}">Export</button>
        <button class="btn btn-sm btn-danger btn-delete" data-id="${c.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openCase(btn.dataset.id); });
  });
  grid.querySelectorAll('.btn-clone').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const source = getCases().find(c => c.id === btn.dataset.id);
      if (!source) return;
      currentCase = cloneCase(source);
      saveCase(currentCase);
      renderLibrary();
      toast('Case cloned — edit it below', 'success');
      openCase(currentCase.id);
    });
  });
  grid.querySelectorAll('.btn-export').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); exportCase(getCases().find(c => c.id === btn.dataset.id)); });
  });
  grid.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm('Delete this case? This cannot be undone.')) {
        deleteCase(btn.dataset.id);
        renderLibrary();
        toast('Case deleted');
      }
    });
  });
}

function buildTags(c) {
  const tags = [];
  tags.push(...c.meta.category);
  if (c.history.tinnitus?.present) tags.push('Tinnitus');
  if (c.history.balance?.concern !== 'none') tags.push('Balance');
  if (c.history.hearingAids?.current) tags.push('HA user');
  if (c.history.soundSensitivity?.present) tags.push('Hyperacusis');
  if (c.patient.personality) tags.push(c.patient.personality);
  return tags.slice(0, 6);
}

// ── Case Builder ──
function openNewCase() {
  currentCase = newCaseTemplate();
  populateForm(currentCase);
  switchTab('builder');
  document.getElementById('builderTitle').textContent = 'New Patient Case';
}

function openCase(id) {
  currentCase = getCases().find(c => c.id === id);
  if (!currentCase) return;
  ensureMeta(currentCase);
  populateForm(currentCase);
  switchTab('builder');
  document.getElementById('builderTitle').textContent = 'Edit Patient Case';
}

function handleSave() {
  if (!currentCase) return;
  collectForm(currentCase);
  if (!currentCase.patient.name.trim()) {
    toast('Please enter a patient name', 'error');
    return;
  }
  saveCase(currentCase);
  toast('Case saved', 'success');
  switchTab('library');
}

function handleExportCurrent() {
  if (!currentCase) return;
  collectForm(currentCase);
  exportCase(currentCase);
}

function handleExportAll() {
  const cases = getCases();
  if (cases.length === 0) { toast('No cases to export', 'error'); return; }
  exportAllCases(cases);
}

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const count = await importCasesFromFile(file);
    toast(`Imported ${count} case${count !== 1 ? 's' : ''}`, 'success');
    renderLibrary();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleLoadBundled() {
  const btn = document.getElementById('btnLoadBundled');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const cases = await loadBundledCases();
    if (cases.length === 0) { toast('No bundled cases found', 'error'); return; }
    cases.forEach(saveCase);
    toast(`Loaded ${cases.length} bundled case${cases.length !== 1 ? 's' : ''}`, 'success');
    renderLibrary();
  } catch {
    toast('Failed to load bundled cases', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load Sample Cases';
  }
}

// ── Form population ──
function populateForm(c) {
  const p = c.patient;
  const h = c.history;

  setVal('patientName', p.name);
  setVal('patientAge', p.age);
  setVal('patientOccupation', p.occupation);
  setVal('patientPronoun', p.pronoun);
  setVal('patientKnowledge', p.medicalKnowledge);
  setVal('patientPersonality', p.personality);
  setVal('patientChattiness', p.chattiness);
  setVal('patientNotes', p.additionalNotes);

  const meta = c.meta || { category: [], difficulty: 'moderate', clinicianNotes: '' };
  document.querySelectorAll('.cat-check').forEach(el => { el.checked = meta.category.includes(el.value); });
  setVal('patientDifficulty', meta.difficulty);
  setVal('clinicianNotes', meta.clinicianNotes);

  setVal('reasonForAppointment', h.reasonForAppointment);
  setCheck('prevTestYes', h.previousHearingTest.had);
  setCheck('prevTestNo', !h.previousHearingTest.had);
  setVal('prevTestDetails', h.previousHearingTest.details);

  setRadio('betterEar', h.hearing.betterEar);
  setRadio('hearingDecline', h.hearing.decline);
  setVal('hearingDeclineDetails', h.hearing.declineDetails);

  setCheck('hearingAidYes', h.hearingAids.current);
  setCheck('hearingAidNo', !h.hearingAids.current);
  setVal('hearingAidDetails', h.hearingAids.details);

  setCheck('tinnitusPresent', h.tinnitus.present);
  setRadio('tinnitusLocation', h.tinnitus.location);
  setVal('tinnitusDetails', h.tinnitus.details);

  setCheck('sensitivityPresent', h.soundSensitivity.present);
  setRadio('sensitivityLocation', h.soundSensitivity.location);
  setVal('sensitivityDetails', h.soundSensitivity.details);

  setRadio('balanceConcern', h.balance.concern);
  setVal('balanceDetails', h.balance.details);

  const expMap = { 'auralPressure': 'Aural pressure', 'auralPain': 'Aural pain', 'auralDrainage': 'Aural drainage', 'earInfections': 'History of ear infections', 'earWax': 'Ear wax removal', 'noConcerns': 'No concerns' };
  Object.keys(expMap).forEach(key => {
    const el = document.getElementById(`earExp_${key}`);
    if (el) el.checked = h.earHealth.experiences.includes(key);
  });
  setVal('earHealthDetails', h.earHealth.details);

  setCheck('entYes', h.ent.seen);
  setCheck('entNo', !h.ent.seen);
  const entHistItems = ['surgery', 'treatment', 'scans', 'noneRelated'];
  entHistItems.forEach(k => {
    const el = document.getElementById(`entHist_${k}`);
    if (el) el.checked = h.ent.history.includes(k);
  });
  setVal('entDetails', h.ent.details);

  const gh = h.generalHealth;
  setVal('hospitalisations', gh.hospitalizations);
  setCheck('headInjuryYes', gh.headInjuries);
  setCheck('headInjuryNo', !gh.headInjuries);
  setVal('headInjuryDetails', gh.headInjuriesDetails);

  const infectionKeys = ['measles','mumps','chickenPox','meningitis','diabetes','cancer','cardiovascular','other'];
  infectionKeys.forEach(k => {
    const el = document.getElementById(`infection_${k}`);
    if (el) el.checked = gh.pastInfections.includes(k);
  });
  setVal('infectionDetails', gh.pastInfectionsDetails);
  setVal('majorIllnesses', gh.majorIllnesses);
  setVal('medications', gh.medications);

  const noiseTypes = ['occupational','recreational','none'];
  noiseTypes.forEach(k => {
    const el = document.getElementById(`noise_${k}`);
    if (el) el.checked = h.noiseHistory.type.includes(k);
  });
  setVal('noiseDetails', h.noiseHistory.details);

  setCheck('familyHistYes', h.familyHistory.has);
  setCheck('familyHistNo', !h.familyHistory.has);
  setVal('familyHistDetails', h.familyHistory.details);

  setVal('otherConcerns', h.otherConcerns);

  // Paediatric section
  const paed = isPaediatricCase(c);
  setCheck('paedToggle', paed);
  const ph = c.paediatricHistory || newPaediatricHistoryTemplate();
  setVal('caregiverName', p.caregiverName);
  setVal('caregiverRelationship', p.caregiverRelationship);

  const pn = ph.prenatalAndPerinatal;
  setVal('paedGestationalAge', pn.gestationalAge);
  setVal('paedBirthWeight', pn.birthWeight);
  setCheck('paedNicuYes', pn.nicuAdmission);
  setCheck('paedNicuNo', !pn.nicuAdmission);
  setCheck('paedHypoxiaYes', pn.perinatalHypoxia);
  setCheck('paedHypoxiaNo', !pn.perinatalHypoxia);
  setCheck('paedJaundiceYes', pn.jaundice);
  setCheck('paedJaundiceNo', !pn.jaundice);
  setCheck('paedOtotoxicYes', pn.ototoxicAntibiotics);
  setCheck('paedOtotoxicNo', !pn.ototoxicAntibiotics);
  setVal('paedPerinatalInfections', pn.perinatalInfections);
  setVal('paedCongenitalAnomalies', pn.congenitalAnomalies);

  const hs = ph.hearingScreening;
  setVal('paedNewbornResult', hs.newbornScreening.result);
  setVal('paedNewbornTechnology', hs.newbornScreening.technology);
  setVal('paedNewbornNotes', hs.newbornScreening.notes);
  setVal('paedB4Result', hs.b4SchoolCheck.result);
  setVal('paedB4Notes', hs.b4SchoolCheck.notes);
  setVal('paedCurrentDevices', hs.currentDevices);

  const sl = ph.speechAndLanguage;
  setVal('paedFirstBabble', sl.firstBabble);
  setVal('paedFirstWord', sl.firstWord);
  setVal('paedTwoWordCombos', sl.twoWordCombinations);
  setVal('paedCurrentVocabulary', sl.currentVocabulary);
  setVal('paedIntelligibility', sl.intelligibility);
  setVal('paedReceptiveExpressiveNotes', sl.receptiveExpressiveNotes);
  setVal('paedLanguages', sl.languages);
  setVal('paedSLT', sl.speechLanguageTherapy);

  const gd = ph.generalDevelopment;
  setVal('paedGrossMotor', gd.grossMotor);
  setVal('paedFineMotor', gd.fineMotor);
  setVal('paedCognitive', gd.cognitive);
  setVal('paedSocial', gd.social);
  setVal('paedEarlyIntervention', gd.earlyIntervention);
  setVal('paedSchoolProgress', gd.schoolProgress);
  setVal('paedDevelopmentalDiagnoses', gd.developmentalDiagnoses);

  const fi = ph.functionalImpact;
  setVal('paedHomeImpact', fi.homeImpact);
  setVal('paedSchoolImpact', fi.schoolImpact);
  setVal('paedSocialParticipation', fi.socialParticipation);
  setVal('paedListeningFatigue', fi.listeningFatigue);
  setVal('paedNoiseExposure', fi.noiseExposure);
  setVal('paedExistingSupport', fi.existingSupport);

  document.querySelectorAll('.jcih-check').forEach(el => { el.checked = (ph.jcihRiskFactors || []).includes(el.value); });

  // Update range display
  const r = document.getElementById('patientChattiness');
  if (r) updateRangeDisplay(r);

  // Update conditional visibility (including paediatric section + character notes label)
  updateAllConditionals();
  updatePaediatricVisibility();
}

// ── Form collection ──
function collectForm(c) {
  const p = c.patient;
  const h = c.history;

  p.name = getVal('patientName');
  p.age = getVal('patientAge');
  p.occupation = getVal('patientOccupation');
  p.pronoun = getVal('patientPronoun');
  p.medicalKnowledge = getVal('patientKnowledge');
  p.personality = getVal('patientPersonality');
  p.chattiness = parseInt(getVal('patientChattiness')) || 3;
  p.additionalNotes = getVal('patientNotes');

  if (!c.meta) c.meta = { category: [], difficulty: 'moderate', clinicianNotes: '' };
  c.meta.category = Array.from(document.querySelectorAll('.cat-check:checked')).map(el => el.value);
  c.meta.difficulty = getVal('patientDifficulty') || 'moderate';
  c.meta.clinicianNotes = getVal('clinicianNotes');

  h.reasonForAppointment = getVal('reasonForAppointment');
  h.previousHearingTest.had = isChecked('prevTestYes');
  h.previousHearingTest.details = getVal('prevTestDetails');

  h.hearing.betterEar = getRadio('betterEar');
  h.hearing.decline = getRadio('hearingDecline');
  h.hearing.declineDetails = getVal('hearingDeclineDetails');

  h.hearingAids.current = isChecked('hearingAidYes');
  h.hearingAids.details = getVal('hearingAidDetails');

  h.tinnitus.present = isChecked('tinnitusPresent');
  h.tinnitus.location = getRadio('tinnitusLocation');
  h.tinnitus.details = getVal('tinnitusDetails');

  h.soundSensitivity.present = isChecked('sensitivityPresent');
  h.soundSensitivity.location = getRadio('sensitivityLocation');
  h.soundSensitivity.details = getVal('sensitivityDetails');

  h.balance.concern = getRadio('balanceConcern');
  h.balance.details = getVal('balanceDetails');

  const expKeys = ['auralPressure','auralPain','auralDrainage','earInfections','earWax','noConcerns'];
  h.earHealth.experiences = expKeys.filter(k => isChecked(`earExp_${k}`));
  h.earHealth.details = getVal('earHealthDetails');

  h.ent.seen = isChecked('entYes');
  const entHistKeys = ['surgery','treatment','scans','noneRelated'];
  h.ent.history = entHistKeys.filter(k => isChecked(`entHist_${k}`));
  h.ent.details = getVal('entDetails');

  const gh = h.generalHealth;
  gh.hospitalizations = getVal('hospitalisations');
  gh.headInjuries = isChecked('headInjuryYes');
  gh.headInjuriesDetails = getVal('headInjuryDetails');
  const infKeys = ['measles','mumps','chickenPox','meningitis','diabetes','cancer','cardiovascular','other'];
  gh.pastInfections = infKeys.filter(k => isChecked(`infection_${k}`));
  gh.pastInfectionsDetails = getVal('infectionDetails');
  gh.majorIllnesses = getVal('majorIllnesses');
  gh.medications = getVal('medications');

  const noiseKeys = ['occupational','recreational','none'];
  h.noiseHistory.type = noiseKeys.filter(k => isChecked(`noise_${k}`));
  h.noiseHistory.details = getVal('noiseDetails');

  h.familyHistory.has = isChecked('familyHistYes');
  h.familyHistory.details = getVal('familyHistDetails');

  h.otherConcerns = getVal('otherConcerns');

  // Paediatric section — only attach paediatricHistory (the sole source of
  // truth for "is this case paediatric") when the toggle is actually checked.
  if (isChecked('paedToggle')) {
    p.caregiverName = getVal('caregiverName');
    p.caregiverRelationship = getVal('caregiverRelationship');

    const ph = c.paediatricHistory || newPaediatricHistoryTemplate();
    ph.prenatalAndPerinatal = {
      gestationalAge: getVal('paedGestationalAge'),
      birthWeight: getVal('paedBirthWeight'),
      nicuAdmission: isChecked('paedNicuYes'),
      perinatalInfections: getVal('paedPerinatalInfections'),
      perinatalHypoxia: isChecked('paedHypoxiaYes'),
      jaundice: isChecked('paedJaundiceYes'),
      ototoxicAntibiotics: isChecked('paedOtotoxicYes'),
      congenitalAnomalies: getVal('paedCongenitalAnomalies')
    };
    ph.hearingScreening = {
      newbornScreening: {
        result: getVal('paedNewbornResult'),
        technology: getVal('paedNewbornTechnology'),
        notes: getVal('paedNewbornNotes')
      },
      b4SchoolCheck: { result: getVal('paedB4Result'), notes: getVal('paedB4Notes') },
      currentDevices: getVal('paedCurrentDevices')
    };
    ph.speechAndLanguage = {
      firstBabble: getVal('paedFirstBabble'),
      firstWord: getVal('paedFirstWord'),
      twoWordCombinations: getVal('paedTwoWordCombos'),
      currentVocabulary: getVal('paedCurrentVocabulary'),
      intelligibility: getVal('paedIntelligibility'),
      receptiveExpressiveNotes: getVal('paedReceptiveExpressiveNotes'),
      languages: getVal('paedLanguages'),
      speechLanguageTherapy: getVal('paedSLT')
    };
    ph.generalDevelopment = {
      grossMotor: getVal('paedGrossMotor'),
      fineMotor: getVal('paedFineMotor'),
      cognitive: getVal('paedCognitive'),
      social: getVal('paedSocial'),
      earlyIntervention: getVal('paedEarlyIntervention'),
      schoolProgress: getVal('paedSchoolProgress'),
      developmentalDiagnoses: getVal('paedDevelopmentalDiagnoses')
    };
    ph.functionalImpact = {
      homeImpact: getVal('paedHomeImpact'),
      schoolImpact: getVal('paedSchoolImpact'),
      socialParticipation: getVal('paedSocialParticipation'),
      listeningFatigue: getVal('paedListeningFatigue'),
      noiseExposure: getVal('paedNoiseExposure'),
      existingSupport: getVal('paedExistingSupport')
    };
    ph.jcihRiskFactors = Array.from(document.querySelectorAll('.jcih-check:checked')).map(el => el.value);
    c.paediatricHistory = ph;
  } else {
    delete c.paediatricHistory;
    p.caregiverName = '';
    p.caregiverRelationship = '';
  }

  c.updatedAt = new Date().toISOString();
}

// ── Conditionals ──
function setupConditionals() {
  const rules = [
    { trigger: 'prevTestYes',        target: 'subPrevTestDetails' },
    { trigger: 'hearingAidYes',      target: 'subHearingAidDetails' },
    { trigger: 'tinnitusPresent',    target: 'subTinnitusDetails' },
    { trigger: 'sensitivityPresent', target: 'subSensitivityDetails' },
    { trigger: 'entYes',             target: 'subEntDetails' },
    { trigger: 'headInjuryYes',      target: 'subHeadInjuryDetails' },
    { trigger: 'familyHistYes',      target: 'subFamilyHistDetails' },
  ];
  const balanceNone = ['balanceConcernNone'];

  rules.forEach(({ trigger, target }) => {
    const input = document.getElementById(trigger);
    const sub = document.getElementById(target);
    if (input && sub) {
      input.addEventListener('change', () => sub.classList.toggle('hidden', !input.checked));
    }
  });

  // Balance — show details unless "No concerns" selected
  document.querySelectorAll('input[name="balanceConcern"]').forEach(r => {
    r.addEventListener('change', () => {
      const sub = document.getElementById('subBalanceDetails');
      if (sub) sub.classList.toggle('hidden', r.value === 'none' && r.checked);
    });
  });

  // Range display
  const range = document.getElementById('patientChattiness');
  if (range) {
    range.addEventListener('input', () => updateRangeDisplay(range));
  }

  // Paediatric toggle
  document.getElementById('paedToggle')?.addEventListener('change', updatePaediatricVisibility);
}

// Shows/hides the Paediatric History cards and swaps the character-notes
// label/placeholder to prompt for the caregiver rather than the patient.
function updatePaediatricVisibility() {
  const toggle = document.getElementById('paedToggle');
  const section = document.getElementById('paediatricSection');
  const label = document.getElementById('patientNotesLabel');
  const notes = document.getElementById('patientNotes');
  if (!toggle || !section) return;

  const isPaed = toggle.checked;
  section.classList.toggle('hidden', !isPaed);
  if (label) {
    label.textContent = isPaed
      ? 'Caregiver Character Notes'
      : 'Additional Character Notes (optional)';
  }
  if (notes) {
    notes.placeholder = isPaed
      ? "Describe the caregiver attending today (personality, communication style, emotional state, cultural background). The AI plays this person throughout the session, not the child. e.g. Lena is a warm but visibly stressed mother in her late 20s who feels guilty it took this long to get a referral."
      : 'e.g. Tends to mention her garden. Refers to husband who also has hearing loss. Gets frustrated if asked to repeat herself.';
  }
}

function updateAllConditionals() {
  const rules = [
    { trigger: 'prevTestYes',        target: 'subPrevTestDetails' },
    { trigger: 'hearingAidYes',      target: 'subHearingAidDetails' },
    { trigger: 'tinnitusPresent',    target: 'subTinnitusDetails' },
    { trigger: 'sensitivityPresent', target: 'subSensitivityDetails' },
    { trigger: 'entYes',             target: 'subEntDetails' },
    { trigger: 'headInjuryYes',      target: 'subHeadInjuryDetails' },
    { trigger: 'familyHistYes',      target: 'subFamilyHistDetails' },
  ];
  rules.forEach(({ trigger, target }) => {
    const input = document.getElementById(trigger);
    const sub = document.getElementById(target);
    if (input && sub) sub.classList.toggle('hidden', !input.checked);
  });

  const balanceSub = document.getElementById('subBalanceDetails');
  const balanceNoneEl = document.getElementById('balanceConcernNone');
  if (balanceSub && balanceNoneEl) {
    balanceSub.classList.toggle('hidden', balanceNoneEl.checked);
  }
}

function updateRangeDisplay(range) {
  const labels = ['', 'Very quiet', 'Reserved', 'Normal', 'Chatty', 'Very talkative'];
  const display = document.getElementById('chattinessLabel');
  if (display) display.textContent = labels[range.value] || '';
}

// ── Helpers ──
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function getVal(id) { return document.getElementById(id)?.value?.trim() || ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function isChecked(id) { return document.getElementById(id)?.checked || false; }
function setCheck(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
function getRadio(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : '';
}
function setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}
