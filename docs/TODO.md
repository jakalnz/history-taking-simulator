# Audiology Sim — Feature To-Do List

---

## Student Experience

- [ ] **Session self-rating** — After a session, student rates their own confidence (1–5 stars) and adds a short reflection note. Saved with the session log.
- [x] **Suggested questions panel** — Collapsible hint panel showing example questions for each history section, toggled by the student if they get stuck. *Now also tags each hint Open/Closed.*
- [ ] **Question history log** — Collapsible list of all questions the student asked this session, so they can review their own line of questioning. (Currently only visible inline in the chat scrollback, not as a separate summary list.)
- [x] **Adaptive multiple-choice mode** — Guided question (MC) mode: after each reply, the app suggests 4 AI-generated follow-up questions the student can pick from instead of typing freely.
- [ ] **Session replay** — After ending, student can scroll through the full transcript with timestamps and the coverage checklist showing when each area was first hit.
- [x] **Keyboard shortcut to send** — Enter to send, with a visible reminder in the input placeholder ("Enter to send, Shift+Enter for new line"). Spacebar also toggles speech-to-text on desktop.
- [x] **Mobile layout improvements** — Sidebar show/hide toggle, mobile keyboard no longer pops up unnecessarily after replies/sends, filter rows wrap on small screens.

---

## Assessment & Feedback

- [ ] **Student self-rating** — Star rating + free-text reflection box in the end-of-session report ("How did you feel this went?").
- [ ] **Downloadable session report (PDF)** — Export the full report (coverage checklist + AI feedback + transcript) as a PDF for portfolio evidence or submission.
- [ ] **Shareable report link** — Generate a summary that can be copied/emailed to a supervisor without needing them to access the app.
- [x] **Questioning style analysis** — Live "Q Balance" indicator + end-of-session "Question style" breakdown (open vs. closed counts, neutral presentation) plus a closed-question-fatigue mechanic where the patient gets noticeably briefer after a long unbroken closed-question run. Not yet folded into the free-text AI feedback narrative itself ("you used 3 closed questions in a row here") — that's still open.
- [ ] **Missed follow-up detection** — AI identifies moments where the patient signalled something important but the student didn't follow up (e.g. patient mentioned dizziness but student moved on).
- [ ] **Benchmark comparison** — Show how this session's coverage % compares to the student's own previous sessions (stored locally).
- [ ] **Supervisor review mode** — Clinician can load a saved transcript and add inline comments for debrief.

---

## Case Builder (Clinician)

- [ ] **Case preview / test mode** — Let clinicians test a case as a student before publishing it, without it counting as a student session.
- [x] **Case difficulty rating** — Beginner / Moderate / Advanced, filterable in both the clinician library and student case selector.
- [x] **Case categories / tags** — Primary presentation tags (NIHL, presbycusis, otosclerosis, Ménière's, conductive/otitis media, sudden SNHL, ototoxicity, tinnitus-predominant, vestibular, congenital/genetic, traumatic, undifferentiated), filterable in the library.
- [x] **Duplicate case** — Clone button on each case card, duplicates as a starting point for a new one.
- [x] **Case notes for clinician** — Hidden `clinicianNotes` field for learning objectives and common student pitfalls, never shown to students or fed to the AI patient.
- [x] **Paediatric history template** — Full "This is a paediatric case" toggle in the builder: caregiver name/relationship, perinatal/birth history, hearing screening, speech & language, general development, functional impact, JCIH 2019 risk-factor checklist. AI plays the caregiver, not the child.
- [ ] **Case versioning** — Track edits to a case over time so clinicians can see what changed.
- [ ] **Bulk import from CSV** — JSON bulk import already exists (single file, array of cases); CSV-specific import still open.

---

## AI Patient Behaviour

- [ ] **Hybrid mode** — Toggle per-case between full AI (current) and scripted key facts with AI personality overlay, for more controlled assessment scenarios.
- [ ] **Emotion escalation** — Patient becomes more anxious or distressed if asked insensitively. (Related but distinct: patients now push back on rudeness/unprofessional conduct and can end the session and request a supervisor after repeated or severe instances — see Professionalism modelling in FEATURES.md.)
- [ ] **Red herring / distractor symptoms** — No dedicated toggle yet; some existing cases informally include non-diagnostic detail via `otherConcerns`, but it isn't a structured "distractor" mechanic.
- [ ] **Language/accent context** — No dedicated case field; several cases informally note ESL/regional language use in character notes (e.g. Mei-Lin Tan, Carla Alvarez, Lena Taufa) but it isn't a structured, filterable flag.
- [~] **Family member present** — Demonstrated informally in specific cases rather than as a general mechanic: Frank Wilson (adult) has his daughter Nicola present as a collateral historian who can be asked directly; every paediatric case has the caregiver as a second character by design. Not yet a per-case toggle for arbitrary cases.
- [~] **Patient asks questions back** — Cases already script patients/caregivers asking questions at the end (e.g. "will she need hearing aids?", "is this serious?") via `otherConcerns`, but it's static case content rather than a dynamic in-conversation behaviour that can occur at any point.

---

## Case Library

- [ ] **Online shared library** — Hosted `cases/index.json` on GitHub that clinicians anywhere can contribute cases to (via pull request). (Cases are already version-controlled in this repo, but there's no external contribution workflow yet.)
- [x] **Case search and filter** — Search by name/occupation/age, filter by difficulty, filter by presentation category (clinician view), filter by case type (Adult/Paediatric) in both student and clinician views.
- [ ] **Case usage stats** — Track how many times each case has been used (stored locally), so clinicians know which are most popular.
- [ ] **QR code for case sharing** — Generate a QR code linking directly to a specific case file so it can be shared in a lecture or printed on a handout.

---

## Technical / Infrastructure

- [ ] **GitHub Pages custom domain** — Set up a clean URL (e.g. `audsim.ac.nz`) instead of the default `jakalnz.github.io/...`.
- [ ] **Cloudflare rate limiting** — Add per-IP request limits to the Worker to prevent API key exhaustion if the session token leaks.
- [ ] **Usage dashboard** — Simple Worker analytics (Cloudflare provides this free) showing daily request counts so the team can monitor costs.
- [ ] **Multiple session tokens** — Support multiple tokens in the Worker (e.g. one per cohort) so access can be revoked per group without affecting others.
- [ ] **Offline support (PWA)** — Cache the app shell so it loads without internet; only the AI responses need connectivity.
- [ ] **Dark mode** — Respect `prefers-color-scheme` system setting.
- [ ] **Accessibility audit** — Screen reader labels for all icon buttons, sufficient colour contrast, keyboard navigation through case library.

---

## Nice to Have / Future

- [ ] **Structured marking rubric** — Clinician defines a marking rubric per case; AI feedback scores against it specifically.
- [ ] **Integrations** — LTI integration so the app can be embedded in Canvas/Moodle and grades passed back automatically.
- [ ] **Video avatar** — Lip-synced patient avatar using a service like D-ID or HeyGen for a more immersive experience.
- [ ] **Multi-language support** — UI translated to te reo Māori or other languages for diverse student cohorts.
- [ ] **Timed exam mode** — Set a time limit per session; student is warned at 5 minutes remaining, session auto-closes at the limit.

---

## Since last update — also shipped (not originally on this list)

- [x] **31 bundled practice cases** (up from 2) — 20 adult, 11 paediatric, spanning beginner to advanced, including deliberate "trap" cases (functional hearing loss, situational mutism, bilingual speech-delay misattribution) that reward not over-medicalising every referral.
- [x] **Open/Closed hint tagging** — every hint question is labelled, with at least one open "opener" added per topic to model the open-then-closed funnel technique.
- [x] **Professionalism modelling** — patient pushes back on rudeness in-character; repeated or severe unprofessional conduct ends the session automatically and routes to the report screen.

---

*Last updated: 2026-07-01*
