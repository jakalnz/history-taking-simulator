# AudiologySim — Feature List

A web app for practising audiological history-taking with an AI-simulated patient. Two views: **Student** (practice sessions) and **Clinician** (case management).

## Student practice experience

- **AI-simulated patient conversations** — students converse in free text with an LLM roleplaying a patient case, built from a structured clinical history (reason for visit, hearing history, tinnitus, balance, ear health, ENT/general health, noise exposure, family history, etc).
- **Realistic patient behaviour, not a data dump**:
  - Patients only reveal information when asked, and answer with plain, non-clinical language matched to their configured medical knowledge level (they won't understand or use jargon like "tinnitus" or "otosclerosis" unless it's within their knowledge level).
  - Patients give brief, vague first answers and require follow-up questions to surface specifics (severity, frequency, triggers) — instead of reciting the full case in one turn.
  - Personality and chattiness sliders (anxious, stoic, defensive, chatty, etc.) shape how forthcoming and verbose each patient is.
- **Open vs. closed question awareness**:
  - Optional live "Q Balance" indicator in the chat toolbar shows a running open/closed question tally and bar, greyed out until there's a large enough sample to be meaningful.
  - After a genuinely long unbroken run of closed (yes/no) questions with no open question in between, the patient becomes noticeably briefer and stops volunteering detail — resets the moment an open question is asked. Tuned to tolerate normal closed-question drilling (a lot of real clinical screening is legitimately closed-question style) and only catch true interrogation-style runs.
  - A "Question style" breakdown (open vs. closed counts) also appears in the end-of-session report regardless of whether the live indicator was toggled on.
  - The hints panel (below) labels each example question **Open** or **Closed**, including at least one open "opener" per topic — modelling the open-then-closed funnel technique real clinicians use.
- **Professionalism modelling** — if a student is rude, dismissive, or inappropriate, the patient pushes back in character; on a repeat or severe instance, the patient asks to speak to a supervisor and the session automatically ends, taking the student to the report screen.
- **Speech-to-text input** — dictate questions via the browser's speech recognition instead of typing, with a spacebar shortcut to start/stop on desktop.
- **Text-to-speech patient replies** — patient responses can be read aloud, with selectable voice and adjustable playback speed.
- **Learning supports** (optional, tracked and shown in the report so use is transparent, not penalised):
  - **Hints panel** — example questions per history section, revealed on demand, each tagged Open or Closed.
  - **Guided question (MC) mode** — after each patient reply, the app suggests 4 AI-generated follow-up questions the student can pick from instead of typing freely.
- **Live coverage tracking** — a sidebar checklist shows which history-taking areas (and sub-areas) have been covered based on keyword detection in the student's own questions, with a running percentage. Automatically switches to a paediatric-specific set of areas for paediatric cases (see below).
- **Patient case selection**:
  - Search by name, occupation, or age.
  - Filter by difficulty (Beginner / Moderate / Advanced) and by case type (Adult / Paediatric), each shown as a badge on every case.
  - Import a case file shared by a teacher (JSON) directly into the student view.
- **End-of-session report**:
  - Coverage score and breakdown of areas covered vs. missed (with sub-items).
  - Question style (open/closed) breakdown.
  - Learning supports used (hints viewed, guided-question usage) — framed as normal, not a penalty.
  - **AI-generated feedback** on questioning technique, referencing the actual transcript, with five sections: strengths / areas to improve / questioning technique / **missed follow-ups** (specific moments the patient signalled something significant that wasn't picked up on, quoted directly) / tips for next time.
  - Collapsible full transcript, and a **one-click PDF export** (score, coverage, question style, AI feedback, and the full transcript in a single downloadable file) for portfolio evidence or submission.
- **Mobile-friendly** — responsive layout, and the on-screen keyboard is kept from popping up unnecessarily (e.g. after each patient reply) so students can read responses without the keyboard covering the chat.

## Paediatric case support

- **Caregiver-respondent roleplay** — for paediatric cases, the AI plays the child's parent/caregiver reporting on the child's behalf, not the child itself. Everything that makes the adult patients realistic (no jargon beyond the caregiver's knowledge level, brief answers requiring follow-up, personality/chattiness, professionalism escalation, closed-question fatigue) carries over unchanged — it's the same behavioural engine, just retargeted.
- **Paediatric-specific clinical history** — prenatal & perinatal history, newborn hearing screening and B4 School Check results, speech & language milestones, general development, functional impact at home/preschool/school, and JCIH 2019 risk factors, alongside the standard ear/hearing history fields.
- **New Zealand paediatric funding & screening context** baked into the prompt — free newborn hearing screening (UNHSEIP), the B4 School Check, and the fact that children's hearing services/aids are generally fully funded (unlike the adult subsidy scheme) — so caregiver questions about cost and next steps get realistic answers.
- **Dedicated paediatric coverage tracking** — a full parallel set of 16 history areas (with expandable sub-areas, matching the depth of the adult set) and matching hint bank, phrased for questioning a caregiver rather than a patient directly.
- **Session UI adapts automatically** — header shows the child's name/age and "responding as caregiver (Name)"; the coverage panel heading switches to "Paediatric History Coverage"; a 🧒 badge marks paediatric cases in both the student case selector and the clinician library.

## Clinician / educator tools (Case Manager)

- **Case library** — grid view of all saved patient cases with quick actions: edit, clone, export, delete.
- **Case builder** — structured form covering:
  - Patient profile: name, age, occupation, pronouns, medical knowledge level, personality, chattiness, free-text character notes.
  - Full clinical history: reason for appointment, previous hearing tests, hearing details, hearing aids, tinnitus, sound sensitivity/hyperacusis, balance/vertigo, ear health, ENT history, general health (hospitalisations, head injuries, past infections, illnesses, medications), noise history, family history, other concerns.
  - **"This is a paediatric case" toggle** — switches on a full extra section: caregiver name/relationship, perinatal & birth history, hearing screening (newborn + B4 School Check), speech & language, general development, functional impact, and a JCIH 2019 risk-factor checklist. The character-notes field automatically prompts for the caregiver's personality/communication style instead of the child's.
- **Case metadata** (clinician-facing only, never shown to students or fed to the AI patient):
  - **Primary presentation tags** (NIHL, presbycusis, otosclerosis, Ménière's, conductive/otitis media, sudden SNHL, ototoxicity, tinnitus-predominant, vestibular, congenital/genetic, traumatic, undifferentiated, etc.) — filterable in the library.
  - **Difficulty rating** (Beginner / Moderate / Advanced) and **case type** (Adult / Paediatric) — both filterable in the library and the student-facing case selector.
  - **Clinician notes** — a hidden field for learning objectives and common student pitfalls, for internal reference only.
- **Case cloning** — duplicate an existing case as a starting point for a new one, rather than building from scratch.
- **Import/export** — import case JSON files (single or bulk), export a single case or the entire library, for sharing between teachers or backing up.
- **Bundled sample cases** — one-click load of the full 31-case library (see below) spanning a wide range of pathology, difficulty, and age.

## 31 bundled practice cases (20 adult, 11 paediatric)

- **Adult cases** span presbycusis, NIHL, conductive loss/otitis media, cerumen impaction, otitis externa (beginner); ototoxicity, traumatic TM perforation, auditory processing difficulty, vestibular migraine (moderate); and sudden idiopathic SNHL, suspected acoustic neuroma, chronic cholesteatoma, otosclerosis, undiagnosed Ménière's, suspected Pendred syndrome, progressive genetic loss, presbycusis with a collateral historian, and a **functional (non-organic) hearing loss** case designed to be probed with sensitivity, not confrontation (advanced).
- **Paediatric cases** span VRA age (6–12 months) and play age (3–6 years), including: congenital bilateral SNHL already diagnosed via newborn screening; an ex-premature NICU graduate with multiple risk factors; a "passed newborn screening" trap case where later-onset loss is still possible; recurrent otitis media; congenital aural atresia/microtia; a Down syndrome case with concurrent conductive and possible sensorineural loss; a bilingual household where "speech delay" turns out to be normal cross-language development; progressive genetic loss missed for two years after an unfollowed screening referral; sudden acquired unilateral loss after a viral illness; and **two deliberate "trap" cases where hearing is actually normal** (situational mutism mistaken for non-response; bilingual vocabulary split misread as delay) — training students not to over-medicalise every referral.
- Cases are written so clinically relevant clues are only revealed on specific, sensitive questioning — rewarding thorough history-taking rather than surface-level questions.

## Under the hood

- **Cloudflare Worker proxy** — holds the Anthropic API key server-side; students/clinicians only need a shared session password, never the API key itself.
- **No backend database** — cases are stored in the browser (localStorage) and shared via JSON export/import or the bundled sample-case set; easy to version-control and share as files.
- **New Zealand healthcare context baked into the AI patient prompt** — funding pathways (Hearing Aid Subsidy, ACC, Ministry of Health Disability Support Services), realistic cost expectations, and referral pathways, so students get locally-relevant context if patients raise funding/cost questions.
