# Paediatric History-Taking Extension
## Specification for Claude Code

This document specifies the changes needed to extend the Audiology History-Taking Simulator to support paediatric patient cases. Read the full specification before making any changes.

---

## Overview

The simulator currently handles adult audiological history taking. Paediatric cases are structurally different in three key ways:

1. **The respondent is a caregiver**, not the patient — the AI must speak as the parent/caregiver, not as the child.
2. **The history domains are different** — prenatal/perinatal history, developmental milestones, speech and language, screening history (newborn + B4 School Check), and JCIH risk factors replace adult-specific domains (e.g. occupational noise, self-reported tinnitus severity).
3. **Coverage tracking must reflect paediatric domains** — the keyword/area coverage system needs new area definitions for paediatric sessions.

---

## 1. Case JSON Schema Extension

Paediatric cases include a top-level `paediatricHistory` object in addition to all existing fields. The presence of this object signals that the case is paediatric.

### Detection logic

```js
const isPaediatric = Boolean(caseData.paediatricHistory);
```

When `isPaediatric` is true, apply all paediatric-specific behaviour described in this document.

### New top-level fields

```jsonc
{
  // All existing fields remain unchanged (name, age, personality, etc.)
  // New field:
  "paediatricHistory": {
    "prenatalAndPerinatal": {
      "gestationalAge": "string",
      "birthWeight": "string",
      "nicuAdmission": "boolean",
      "perinatalInfections": "string",
      "perinatalHypoxia": "boolean",
      "jaundice": "boolean",
      "ototoxicAntibiotics": "boolean",
      "congenitalAnomalies": "string"
    },
    "hearingScreening": {
      "newbornScreening": {
        "result": "string",      // e.g. "Pass bilateral", "Refer right ear"
        "technology": "string",  // "AABR" | "TEOAE" | "AABR + TEOAE" | "unknown"
        "notes": "string"
      },
      "b4SchoolCheck": {
        "result": "string",
        "notes": "string"
      },
      "currentDevices": "string"
    },
    "speechAndLanguage": {
      "firstBabble": "string",
      "firstWord": "string",
      "twoWordCombinations": "string",
      "currentVocabulary": "string",
      "intelligibility": "string",
      "receptiveExpressiveNotes": "string",
      "languages": "string",
      "speechLanguageTherapy": "string"
    },
    "generalDevelopment": {
      "grossMotor": "string",
      "fineMotor": "string",
      "cognitive": "string",
      "social": "string",
      "earlyIntervention": "string",
      "schoolProgress": "string",
      "developmentalDiagnoses": "string"
    },
    "functionalImpact": {
      "homeImpact": "string",
      "schoolImpact": "string",
      "socialParticipation": "string",
      "listeningFatigue": "string",
      "noiseExposure": "string",
      "existingSupport": "string"
    },
    "jcihRiskFactors": ["string"]  // list of risk factors present in this case
  }
}
```

---

## 2. System Prompt Changes

When `isPaediatric` is true, the AI system prompt must be modified. Replace the standard patient persona section with the following structure:

### Standard (adult) patient prompt pattern
```
You are [name], a [age] patient attending an audiology clinic...
```

### Paediatric replacement pattern
```
You are [caregiver name and relationship] attending an audiology appointment for your child [child name], who is [age] old. You are responding to the student audiologist on behalf of your child.

[Caregiver personality and character notes from the case]

Speak in first person as the caregiver throughout. Never switch to speaking as the child. If asked directly about the child's behaviour or reactions, describe what you have observed.

Your child's complete history is provided below. Answer questions accurately based on this history, but only disclose information when asked — do not volunteer it proactively unless your personality type makes this natural.
```

The caregiver name should be drawn from `patient.characterNotes` if specified there, or default to "the parent/caregiver". Consider adding an optional `caregiverName` field to the patient object for cleaner extraction (see section 6).

### History data injection

Paediatric cases should inject the full `paediatricHistory` object into the system prompt alongside the existing fields. Format it clearly for the AI:

```
--- PAEDIATRIC HISTORY ---
PRENATAL & BIRTH: [prenatalAndPerinatal fields]
HEARING SCREENING: [hearingScreening fields]
SPEECH & LANGUAGE: [speechAndLanguage fields]
DEVELOPMENT: [generalDevelopment fields]
FUNCTIONAL IMPACT: [functionalImpact fields]
JCIH RISK FACTORS PRESENT: [jcihRiskFactors list]
```

---

## 3. Coverage Tracking: Paediatric History Areas

The student coverage tracker currently shows 16 areas for adult cases. Paediatric cases use a different set of areas.

### Paediatric coverage areas (replace adult areas when isPaediatric)

| Area ID | Display label | Example trigger keywords |
|---|---|---|
| `presenting_concern` | Presenting concern | hear, concern, today, appointment, refer, why |
| `caregiver_concern` | Caregiver's view of hearing | think, notice, worry, problem, hear, behave |
| `onset_course` | Onset and time course | when, start, sudden, gradual, always, worse, better |
| `previous_tests` | Previous hearing tests | test, before, result, audiology, screen |
| `newborn_screening` | Newborn hearing screening | newborn, birth, hospital, AABR, OAE, screen, pass, refer |
| `b4_school_check` | B4 School Check | b4, school check, plunket, 4 year, preschool check |
| `birth_history` | Pregnancy and birth history | born, birth, pregnan, week, premature, NICU, weight, labour |
| `perinatal_risk` | Perinatal risk factors | NICU, intensive care, jaundice, oxygen, transfusion, antibiotic, infection |
| `ear_health` | Ear health and infections | ear, infection, glue, otitis, grommets, fluid, pain, discharge |
| `speech_language` | Speech and language development | speak, word, sentence, babble, talk, say, speech, language, communicate |
| `milestones` | Developmental milestones | walk, sit, develop, milestone, motor, crawl, grow |
| `school_function` | Preschool or school function | school, preschool, teacher, classroom, group, instruction, learn |
| `home_function` | Listening at home | home, TV, distance, room, respond, name, call |
| `family_history` | Family history of hearing loss | family, relative, parent, sibling, grandpar, uncle, aunt, cousin, genetic |
| `noise_exposure` | Noise exposure | noise, loud, concert, headphone, protect |
| `other_concerns` | Other concerns | worry, question, aids, support, future, what happens |

### Implementation note

Store both `adultAreas` and `paediatricAreas` arrays. Select the appropriate array on session start based on `isPaediatric`. The coverage tracking mechanism (keyword matching in student questions) does not need to change — only the area definitions differ.

---

## 4. UI Changes

### Case library / case selector

Add a visual indicator to distinguish paediatric cases in the case list. Suggested: a small badge or icon (e.g. 🧒 or a "Paediatric" pill label) next to the case name when `paediatricHistory` is present.

Filter option: add "Paediatric" as a filter option alongside the existing presentation type filters.

### Session header

When a paediatric session is active, display the child's name and age alongside a note that the respondent is the caregiver:

```
Patient: Sarah Taufa (4 years) — responding as caregiver (Lena Taufa)
```

### Coverage panel label

Change the heading from "History Coverage" to "Paediatric History Coverage" for paediatric sessions.

### Opening prompt

Replace the default opening prompt ("Introduce yourself and begin the consultation...") with a paediatric-appropriate one:

```
Introduce yourself and begin the paediatric audiological history. Remember you are speaking with the child's caregiver, not the patient directly. Start by finding out why they have come in today.
```

---

## 5. Case Builder (Clinician Mode) Changes

Add a "Paediatric Case" toggle in the Case Builder. When enabled:

- Show a new **Paediatric History** section with fields matching the schema in section 1
- Fields to include (all text areas unless noted):
  - **Birth history**: gestational age, birth weight, NICU admission (yes/no toggle), perinatal infections, perinatal hypoxia (yes/no), jaundice (yes/no), ototoxic antibiotics (yes/no), congenital anomalies
  - **Hearing screening**: newborn screening result, technology used (AABR / TEOAE / both / not done), B4 School Check result, current devices
  - **Speech and language**: age of first babble, age of first word, age of two-word combinations, current vocabulary estimate, intelligibility, receptive vs expressive notes, languages spoken at home, speech-language therapy history
  - **Development**: gross motor, fine motor, cognitive, social/play, early intervention, school/preschool progress, developmental diagnoses
  - **Functional impact**: home, school, social, listening fatigue, noise exposure, existing support
  - **JCIH risk factors**: multi-select checklist of the 10 JCIH 2019 risk factors (pre-populate based on other entered data where possible)

- The existing patient personality and character notes field should explicitly prompt the clinician to specify the **caregiver's** name, relationship, and personality — not the child's — since the AI plays the caregiver.

Suggested character notes prompt text:
```
Describe the caregiver attending today (name, relationship to child, personality, communication style, emotional state, cultural background). The AI will speak as this caregiver throughout the session.
```

---

## 6. Suggested Minor Schema Additions

These are optional but will make prompt construction cleaner:

```jsonc
{
  "patient": {
    // existing fields...
    "caregiverName": "Lena Taufa",        // caregiver's full name (paediatric only)
    "caregiverRelationship": "mother",     // relationship to child (paediatric only)
    "childName": "Sarah Taufa"             // child's name (paediatric only; patient.name stays as the display name)
  }
}
```

If these fields are absent, fall back to extracting from `characterNotes` or using generic labels ("the caregiver", "your child").

---

## 7. Sample Case File

A complete sample case file (`paediatric_case_lena_taufa.json`) is provided alongside this specification. It implements the full schema above and represents a moderate-difficulty case with:

- **Child**: Sarah Taufa, 4 years, Māngere, Auckland
- **Caregiver**: Lena Taufa (mother), anxious personality
- **Clinical picture**: Recurrent OME right ear with mild-moderate conductive loss; borderline left ear on B4 School Check; speech delay (on waiting list for SLT); possible family history of SNHL (maternal uncle)
- **Key learning objectives**: Students must explore both conductive (OME) and sensorineural angles; explore newborn screening history (pass but borderline); take a full developmental and speech milestone history; identify JCIH risk factors; and not anchor prematurely on OME

---

## 8. What Does NOT Change

- The Cloudflare Worker proxy architecture
- The AI model used
- The adult case schema (all existing cases remain valid)
- The PDF session report format (extend to include paediatric areas if isPaediatric)
- Local storage case management
- Import/export JSON functionality (paediatric cases import/export exactly like adult cases)

---

## Implementation Order

Suggested sequencing to keep the app functional throughout:

1. **Schema detection** — add `isPaediatric` detection; no UI changes yet
2. **System prompt** — modify prompt builder to use caregiver persona and inject paediatricHistory when isPaediatric
3. **Coverage areas** — add paediatricAreas array and switch on session start
4. **UI labels** — update session header, opening prompt, coverage panel heading
5. **Case library** — add paediatric badge and filter
6. **Case builder** — add paediatric toggle and form fields
7. **Test with sample case** — load `paediatric_case_lena_taufa.json` and run a complete session
