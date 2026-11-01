# Nexus Smart Proctoring Browser
**Enterprise Anti-Cheat Desktop Assessment Environment | National Hackathon MVP**  
*WUElev8 Innovation Services Pvt. Ltd.*

---

## 1. Executive Summary & Architecture

The **Smart Proctoring Browser** is a secure, high-integrity desktop assessment platform designed to deliver controlled online multiple-choice examinations while upholding fairness, transparency, and candidate privacy.

### High-Level Architecture
```
┌────────────────────────────────────────────────────────────────────────┐
│                        ELECTRON DESKTOP SHELL                          │
│  - Context Isolation: ON | Node Integration: OFF | Strict Preload IPC  │
│  - Window Focus & Blur Monitor | Fullscreen Enforcement | DevTools Lock│
│  - Blocked Hotkeys: F12, Ctrl+Shift+I, Alt+Tab, Ctrl+R, F5, Ctrl+W     │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌──────────────────────────────────────┐     ┌──────────────────────────────────┐
│         REACT FRONTEND (VITE)        │     │         EXPRESS BACKEND API      │
│ - Distraction-free UI & Dark Navy UX │     │ - Authoritative Server-side      │
│ - Pre-Assessment Hardware Check      │     │   Grading (No answer leakage)    │
│ - Real-Time BlazeFace CV Detector    │◄───►│ - SQLite with WAL Mode           │
│   (Face Presence, Gaze, Multi-Face)  │     │ - JWT Session & Role Security    │
│ - Question Palette & Autosave        │     │ - Configurable Violation Rules   │
│ - Comprehensive Solution Review      │     │ - Audit Timeline & CSV Exports   │
└──────────────────────────────────────┘     └──────────────────────────────────┘
```

---

## 2. Quick Demo Credentials

For hackathon judges and evaluators, the database is pre-seeded with verified test accounts:

| Role | Email | Password | Permissions & Features |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@wuelev8.com` | `Admin@123` | Full Console: Analytics, Student Timeline, Violation Auditing, Question Bank, Policy Config, CSV Export |
| **Student** | `student@wuelev8.com` | `Student@123` | Candidate Portal: System Check, Live AI Proctoring Assessment, Autosave, Official Scorecard & Solution Review |

> **Development Mode OTP:** When testing the OTP flow, enter code `884920` (or click the "Fill Code" button in the dialog).

---

## 3. Installation & Startup (Windows)

### Prerequisites
- Node.js (v18.0.0 or higher; tested on v22.16.0)
- npm (v9.0.0 or higher)

### Setup & Launch in 3 Simple Steps

```powershell
# 1. Install root, backend, and frontend dependencies
npm install
npm --prefix server install
npm --prefix client install

# 2. Seed SQLite database with demo accounts and 20 NGATA assessment questions
npm run seed

# 3. Launch the complete application stack (Backend + Vite Frontend + Electron Shell)
npm run dev
```

### Running Individual Services (Optional)
```powershell
# Run Express backend only (http://localhost:5000)
npm run dev:server

# Run React frontend only (http://localhost:5173)
npm run dev:client

# Launch Electron desktop shell against running dev server
npm run dev:electron

# Build production client bundle
npm run build

# Package standalone Windows executable (unpacked directory)
npm run package:dir

# Build production Windows NSIS installer (.exe)
npm run build:installer
# Output: release/WUElev8 Smart Proctoring Browser Setup 1.0.0.exe
```

---

## 4. End-to-End Demonstration Walkthrough

Follow this 15-step sequence during the live hackathon demonstration:

1. **Launch App**: Run `npm run dev`. The desktop window opens to the WUElev8 login screen.
2. **Student Login**: Click the blue **"Student Demo"** card (auto-fills `student@wuelev8.com` / `Student@123`) and click **"Authenticate & Enter"**.
3. **Student Dashboard**: View the candidate profile and the active **"National Graduate Aptitude & Technical Assessment (NGATA 2026)"** card (20 questions, 25 minutes, pass mark 40%).
4. **Pre-Assessment Checklist**: Click **"Start Assessment"**. The interactive pre-check screen runs:
   - Live camera preview with face targeting ring.
   - Live microphone volume meter responding in real-time.
   - Network connectivity ping test (e.g., 2ms latency).
   - Fullscreen lock verification.
5. **Accept Rules**: Check the code of conduct acknowledgement and click **"All Checks Passed — Begin Assessment"**.
6. **MCQ Assessment Interface**:
   - The countdown timer begins running in the top bar.
   - Solve questions across Quantitative Aptitude, Algorithms, OS, DBMS, and Cybersecurity.
   - Click an option: the green autosave indicator immediately confirms backend persistence.
   - Click **"Mark for Review"** to flag questions with purple badge indicators in the Question Palette.
7. **Face Presence Monitoring**:
   - Cover the webcam or step out of frame for ~6 seconds: The live badge switches to `Face Missing` and an auditable violation alert appears.
8. **Focus-Loss Monitoring**:
   - Press `Alt+Tab` or click on another application window: The Electron main process records the exact millisecond timestamps.
   - Return to the assessment window: An auditable warning dialog displays the exact focus-loss duration (e.g., `Window focus lost for 4.2s`).
9. **Final Submission**:
   - Click **"Submit Assessment"** in the header.
   - Review answered vs unanswered count in the confirmation modal, then click **"Confirm Submission"**.
10. **Authoritative Scorecard & Solution Review**:
    - The server calculates final score and percentage (never calculated on client).
    - Confetti fires if passing.
    - Click **"View Technical Explanation"** on any question to view the complete solution breakdown.
11. **Sign Out**: Click the exit icon in the top navbar to return to the login screen.
12. **Admin Login**: Click **"Admin Demo"** (`admin@wuelev8.com` / `Admin@123`) and click **"Authenticate & Enter"**.
13. **Real Analytics**: View real-time metrics (Total Attempts, Completed Sessions, Average Score, Flagged Count, Violations breakdown by type and severity).
14. **Individual Candidate Audit Timeline**:
    - Navigate to **"Proctoring Attempts & Audit"** tab.
    - Click **"Review Timeline"** on Alex Chen's attempt.
    - View chronological incidents (`face_missing`, `focus_loss`) with exact durations and detection sources.
    - Click **"Mark Reviewed"** or **"Confirm Violation"** with instant backend persistence.
15. **Export Data**: Click **"Export Scores (CSV)"** and **"Export Events (CSV)"** in the top right to download audit files.

---

## 5. Security Architecture & Threat Model

### Electron Hardening
- `contextIsolation: true` prevents renderer scripts from accessing Electron or Node.js runtime internals.
- `nodeIntegration: false` ensures no native Node APIs can be injected or executed by malicious scripts.
- `webPreferences.sandbox: false` with strict `preload.js` exposing only tightly scoped `window.electronAPI`.
- `webContents.setWindowOpenHandler({ action: 'deny' })` blocks all popups and untrusted windows.
- `webContents.on('will-navigate')` intercepts and cancels any attempt to redirect away from localhost.
- Hotkey Interception blocks `F12`, `Ctrl+Shift+I`, `F5`, `Ctrl+R`, `Ctrl+W`, `Ctrl+P`, and logs unauthorized key combos.

### Authoritative Backend Security
- **No Client-Side Scoring**: The frontend never receives correct answers or solution keys while an assessment is active (`correctAnswer` and `explanation` are explicitly filtered out by the backend SQL query).
- **Authoritative Grading**: Final score is calculated strictly inside a database transaction on the server.
- **Answer Lock**: Once an attempt transitions to `submitted` or `timed_out`, all subsequent answer writes are rejected with HTTP 400.
- **SQL Injection Prevention**: All queries use parameterized statements via `better-sqlite3`.
- **Brute Force Protection**: Rate limiting middleware active on authentication endpoints.

---

## 6. Fairness, Privacy, and Explainable Proctoring

1. **No Weaponized AI**: Face absence or focus loss is treated as **evidence for human review**, not automated grounds for immediate disqualification.
2. **Zero Footage Retention**: Temporary webcam frames are processed locally in browser RAM using WebAssembly / TensorFlow.js and discarded immediately. No continuous video feed is uploaded or stored by default.
3. **Explicit Consent**: Transparent privacy notice and rules checklist before testing begins.
4. **Honest Limitations**:
   - Software cannot prove the absence of physical cheat sheets or secondary monitors connected via hardware splitters.
   - Software cannot read private OS memory or keystrokes entered into external virtual machines.
   - Network interruptions or webcam driver glitches are auditable and reviewable by human proctors.

---

## 7. API Reference

| Endpoint | Method | Auth | Description |
| :--- | :---: | :---: | :--- |
| `/api/auth/register` | `POST` | Public | Register new candidate |
| `/api/auth/login` | `POST` | Public | Authenticate and obtain JWT token |
| `/api/auth/otp/request` | `POST` | Public | Request verification OTP (returns devOtp) |
| `/api/auth/otp/verify` | `POST` | Public | Verify OTP code and issue JWT |
| `/api/auth/me` | `GET` | Bearer | Fetch current user profile |
| `/api/assessments` | `GET` | Bearer | List assessments (filtered by role) |
| `/api/assessments/:id` | `GET` | Bearer | Get assessment metadata and policies |
| `/api/assessments/:id` | `PUT` | Admin | Update duration and violation thresholds |
| `/api/assessments/:id/questions` | `GET` | Bearer | Fetch questions (secure: no answers for students) |
| `/api/assessments/:id/questions` | `POST` | Admin | Add new MCQ question |
| `/api/questions/:questionId` | `DELETE` | Admin | Delete question from assessment |
| `/api/attempts` | `POST` | Student | Start or resume assessment attempt |
| `/api/attempts/:id` | `GET` | Bearer | Get attempt status, saved answers, and events |
| `/api/attempts/:id/answers` | `POST` | Student | Autosave answer selection |
| `/api/attempts/:id/submit` | `POST` | Student | Authoritative submission and server grading |
| `/api/attempts/:id/events` | `POST` | Student | Log proctoring violation event |
| `/api/attempts/:id/events` | `GET` | Bearer | Retrieve attempt audit event trail |
| `/api/proctoring-events/:id/review`| `PATCH` | Admin | Mark event as reviewed / violation confirmed |
| `/api/admin/analytics` | `GET` | Admin | Fetch aggregate operational statistics |
| `/api/admin/attempts` | `GET` | Admin | Filter attempts by status and violations |
| `/api/admin/export` | `GET` | Admin | Export results or event logs as CSV |

---

## 8. Feature Implementation Checklist

| Category | Requirement | Status | Notes |
| :--- | :--- | :---: | :--- |
| **Desktop Shell** | Electron 35+ with secure contextIsolation | **Implemented** | `nodeIntegration: false`, preload IPC bridge |
| **Desktop Shell** | Kiosk / Fullscreen Lock & Exit Detection | **Implemented** | Intercepts leave-fullscreen events |
| **Desktop Shell** | Window Focus / Blur Duration Logging | **Implemented** | Tracks exact blur start and focus return ms |
| **Desktop Shell** | Intercept DevTools & System Hotkeys | **Implemented** | Blocks F12, Ctrl+Shift+I, Ctrl+R, Alt+Tab |
| **Authentication** | Email & Password with Bcrypt Hashing | **Implemented** | Secure session with JWT |
| **Authentication** | Demo Quick Fill & OTP Verification Flow | **Implemented** | Static demo OTP `884920` with helper button |
| **Assessment** | Pre-Flight System Check (Webcam, Mic, Ping, FS) | **Implemented** | Real Web Audio meter and ping latency |
| **Assessment** | 20 Realistic Sample Questions across 5 CS Fields | **Implemented** | Aptitude, DSA, OS, DBMS, Cybersecurity |
| **Assessment** | Question Palette & Answer States | **Implemented** | Answered, Unanswered, Marked for Review |
| **Assessment** | Authoritative Server-Side Scoring | **Implemented** | Client never computes final marks |
| **Proctoring AI** | Real-Time Face Presence Detection | **Implemented** | BlazeFace neural model + optical canvas fallback |
| **Proctoring AI** | Multiple Faces Detection | **Implemented** | Logs critical event when >1 face detected |
| **Proctoring AI** | Basic Head-Pose / Gaze Estimation | **Implemented** | Landmark ratio between nose and eye midline |
| **Admin Console** | Real-Time Operations Analytics | **Implemented** | Dynamic metrics from SQLite |
| **Admin Console** | Student Assessment Event Timeline | **Implemented** | Severity tags, timestamps, durations |
| **Admin Console** | Mark Event as Reviewed / Confirmed | **Implemented** | Real database mutation with reviewer note |
| **Admin Console** | Question Bank Editor (Add / Delete) | **Implemented** | Dynamic question management |
| **Admin Console** | Policy Configurator | **Implemented** | Adjust duration, timeout, and max violations |
| **Admin Console** | Assessment Security Settings Section | **Implemented** | Configure AI Usage, Prompt Audit, Tab Policy, Permitted Sites, Action |
| **Assessment Policy** | Scenario A: Prompt Engineering Interview | **Implemented** | AI Allowed, Prompts Monitored, No Violations on AI usage |
| **Assessment Policy** | Scenario B: Strict Coding / DSA Assessment | **Implemented** | AI Prohibited, Tabs Restricted, Termination on limit |
| **Admin Console** | CSV Export for Scores & Events | **Implemented** | Standard RFC 4180 CSV downloadable endpoints |

---

## 9. Assessment Security Settings & Dual-Scenario Architecture

The WUElev8 Smart Proctoring platform gives administrators granular, per-assessment control over AI tool usage and external application policies:

| Security Setting | Options | Behavior |
| :--- | :--- | :--- |
| **1. AI Usage** | `Allowed` \| `Prohibited` | Determines whether candidates can access supported AI tools (ChatGPT, Claude, Gemini, etc.). In `Allowed` mode, AI tool access is permitted. In `Prohibited` mode, attempts to visit AI tools trigger violations. |
| **2. AI Prompt Monitoring** | `Enabled` \| `Disabled` | When enabled, prompts submitted by candidates and assistant responses are captured by the browser companion and displayed in the Admin Dashboard audit stream. When disabled, prompt interception is silenced. |
| **3. Tab Switching Policy** | `Allowed` \| `Warn` \| `Restrict` | `Allowed`: tab switches recorded as low-severity telemetry without warnings. `Warn`: candidate receives alert warnings to return to the exam window. `Restrict`: tab switches are logged as high-severity violations. |
| **4. External Resource Access** | `Allowed` \| `Restricted` | `Allowed`: open web access. `Restricted`: candidates are constrained to institutional origins and explicitly configured `permittedWebsites` (e.g. `docs.python.org`). |
| **5. Violation Handling** | `Record Only` \| `Warn Candidate` \| `Terminate Assessment` | `Record Only`: logs telemetry silently for proctor review. `Warn`: displays violation modals to candidates. `Terminate`: auto-submits and flags the exam when violation threshold is reached. |

---

## 10. Automated Testing

Run the automated Vitest test suite covering authentication, question security, attempt scoring, proctoring events, and the new Assessment Security Settings:

```powershell
npm test
```

**Test Results:**
- 26 / 26 integration & unit tests passing (100% pass rate).
- Full end-to-end verification of Scenario A (AI-allowed) and Scenario B (AI-prohibited) isolation and policy enforcement.
- Execution time: ~1.1s on local SQLite WAL.
