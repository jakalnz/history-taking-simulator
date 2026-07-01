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
- **Professionalism modelling** — if a student is rude, dismissive, or inappropriate, the patient pushes back in character; on a repeat or severe instance, the patient asks to speak to a supervisor and the session automatically ends, taking the student to the report screen.
- **Speech-to-text input** — dictate questions via the browser's speech recognition instead of typing, with a spacebar shortcut to start/stop on desktop.
- **Text-to-speech patient replies** — patient responses can be read aloud, with selectable voice and adjustable playback speed.
- **Learning supports** (optional, tracked and shown in the report so use is transparent, not penalised):
  - **Hints panel** — example questions per history section, revealed on demand.
  - **Guided question (MC) mode** — after each patient reply, the app suggests 4 AI-generated follow-up questions the student can pick from instead of typing freely.
- **Live coverage tracking** — a sidebar checklist shows which history-taking areas (and sub-areas) have been covered based on keyword detection in the student's own questions, with a running percentage.
- **Patient case selection**:
  - Search by name, occupation, or age.
  - Filter by difficulty (Beginner / Moderate / Advanced), shown as a colour-coded badge on each case.
  - Import a case file shared by a teacher (JSON) directly into the student view.
- **End-of-session report**:
  - Coverage score and breakdown of areas covered vs. missed (with sub-items).
  - Question style (open/closed) breakdown.
  - Learning supports used (hints viewed, guided-question usage) — framed as normal, not a penalty.
  - **AI-generated feedback** on questioning technique, referencing the actual transcript, with strengths / areas to improve / questioning technique / tips sections.
- **Mobile-friendly** — responsive layout, and the on-screen keyboard is kept from popping up unnecessarily (e.g. after each patient reply) so students can read responses without the keyboard covering the chat.

## Clinician / educator tools (Case Manager)

- **Case library** — grid view of all saved patient cases with quick actions: edit, clone, export, delete.
- **Case builder** — structured form covering:
  - Patient profile: name, age, occupation, pronouns, medical knowledge level, personality, chattiness, free-text character notes.
  - Full clinical history: reason for appointment, previous hearing tests, hearing details, hearing aids, tinnitus, sound sensitivity/hyperacusis, balance/vertigo, ear health, ENT history, general health (hospitalisations, head injuries, past infections, illnesses, medications), noise history, family history, other concerns.
- **Case metadata** (clinician-facing only, never shown to students or fed to the AI patient):
  - **Primary presentation tags** (NIHL, presbycusis, otosclerosis, Ménière's, conductive/otitis media, sudden SNHL, ototoxicity, tinnitus-predominant, vestibular, congenital/genetic, traumatic, undifferentiated, etc.) — filterable in the library.
  - **Difficulty rating** (Beginner / Moderate / Advanced) — filterable in the library and student-facing case selector.
  - **Clinician notes** — a hidden field for learning objectives and common student pitfalls, for internal reference only.
- **Case cloning** — duplicate an existing case as a starting point for a new one, rather than building from scratch.
- **Import/export** — import case JSON files (single or bulk), export a single case or the entire library, for sharing between teachers or backing up.
- **Bundled sample cases** — one-click load of a growing library of ready-made practice cases spanning a wide range of pathology and difficulty (currently 20), including:
  - Presbycusis, NIHL, conductive loss/otitis media, cerumen impaction, otitis externa (beginner-friendly).
  - Ototoxicity, traumatic TM perforation, auditory processing difficulty, vestibular migraine (moderate).
  - Sudden idiopathic SNHL (urgent red-flag case), suspected acoustic neuroma, chronic cholesteatoma, otosclerosis, undiagnosed Ménière's disease, suspected Pendred syndrome, progressive genetic loss with hidden vision clues, presbycusis with a collateral historian/cognitive-decline angle, and a **functional (non-organic) hearing loss** case designed to be probed with sensitivity rather than confrontation (advanced).
  - Cases are written so clinically relevant clues are only revealed on specific, sensitive questioning — rewarding thorough history-taking rather than surface-level questions.

## Under the hood

- **Cloudflare Worker proxy** — holds the Anthropic API key server-side; students/clinicians only need a shared session password, never the API key itself.
- **No backend database** — cases are stored in the browser (localStorage) and shared via JSON export/import or the bundled sample-case set; easy to version-control and share as files.
- **New Zealand healthcare context baked into the AI patient prompt** — funding pathways (Hearing Aid Subsidy, ACC, Ministry of Health Disability Support Services), realistic cost expectations, and referral pathways, so students get locally-relevant context if patients raise funding/cost questions.
