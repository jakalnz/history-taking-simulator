# Audiology Sim — Feature To-Do List

---

## Student Experience

- [ ] **Session self-rating** — After a session, student rates their own confidence (1–5 stars) and adds a short reflection note. Saved with the session log.
- [ ] **Suggested questions panel** — Collapsible hint panel showing example questions for each history section, toggled by the student if they get stuck.
- [ ] **Question history log** — Collapsible list of all questions the student asked this session, so they can review their own line of questioning.
- [ ] **Adaptive multiple-choice mode** — Alternative to free-text: present 3–4 question options at each turn for less confident students or earlier-year learners.
- [ ] **Session replay** — After ending, student can scroll through the full transcript with timestamps and the coverage checklist showing when each area was first hit.
- [ ] **Keyboard shortcut to send** — Already Enter to send, but add a visible reminder in the UI for new users.
- [ ] **Mobile layout improvements** — Show/hide sidebar on mobile with a toggle button; improve chat input sizing on small screens.

---

## Assessment & Feedback

- [ ] **Student self-rating** — Star rating + free-text reflection box in the end-of-session report ("How did you feel this went?").
- [ ] **Downloadable session report (PDF)** — Export the full report (coverage checklist + AI feedback + transcript) as a PDF for portfolio evidence or submission.
- [ ] **Shareable report link** — Generate a summary that can be copied/emailed to a supervisor without needing them to access the app.
- [ ] **Questioning style analysis** — AI feedback flags specific open vs. closed questions used, e.g. "You used 3 closed questions in a row here — try opening with 'Tell me about…'".
- [ ] **Missed follow-up detection** — AI identifies moments where the patient signalled something important but the student didn't follow up (e.g. patient mentioned dizziness but student moved on).
- [ ] **Benchmark comparison** — Show how this session's coverage % compares to the student's own previous sessions (stored locally).
- [ ] **Supervisor review mode** — Clinician can load a saved transcript and add inline comments for debrief.

---

## Case Builder (Clinician)

- [ ] **Case preview / test mode** — Let clinicians test a case as a student before publishing it, without it counting as a student session.
- [ ] **Case difficulty rating** — Tag cases as Beginner / Intermediate / Advanced so students can filter by level.
- [ ] **Case categories / tags** — Tag cases by primary presentation (e.g. NIHL, presbyacusis, tinnitus, Ménière's, sudden loss) for filtering.
- [ ] **Duplicate case** — Clone an existing case as a starting point for a new variation.
- [ ] **Case notes for clinician** — Hidden field for the clinician to record learning objectives, common student mistakes to watch for, and debrief points.
- [ ] **Paediatric history template** — Separate case type with child-specific fields (parental concerns, developmental milestones, school performance, birth history).
- [ ] **Case versioning** — Track edits to a case over time so clinicians can see what changed.
- [ ] **Bulk import from CSV** — Let clinicians import multiple cases from a spreadsheet template.

---

## AI Patient Behaviour

- [ ] **Hybrid mode** — Toggle per-case between full AI (current) and scripted key facts with AI personality overlay, for more controlled assessment scenarios.
- [ ] **Emotion escalation** — Patient becomes more anxious or distressed if asked insensitively (e.g. blunt questions about job loss or prognosis).
- [ ] **Red herring / distractor symptoms** — Option to include symptoms the patient volunteers that are not audiologically significant, to test student filtering.
- [ ] **Language/accent context** — Flag cases where the patient uses non-technical regional expressions or has English as a second language.
- [ ] **Family member present** — Option for a second character (e.g. spouse) who interjects or answers on the patient's behalf.
- [ ] **Patient asks questions back** — Occasionally the patient asks the student a question (e.g. "Is this serious?"), requiring the student to respond professionally without giving clinical advice prematurely.

---

## Case Library

- [ ] **Online shared library** — Hosted `cases/index.json` on GitHub that clinicians anywhere can contribute cases to (via pull request).
- [ ] **Case search and filter** — Search by name, tag, difficulty, or presentation type in the library view.
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

*Last updated: 2026-06-30*
