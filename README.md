# SAHAARA — Personnel Wellbeing & Support Platform

**Smart India Hackathon (SIH) 2026 project**  
**Problem Statement ID:** 26186  
**Problem Statement:** AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces  
**Category:** Software

SAHAARA is a privacy-conscious wellbeing check-in concept for uniformed personnel. It helps people notice patterns around sleep, fatigue, workload, mood, recovery, and support, then offers optional next steps. Personnel control their own records and decide whether to share selected history with a registered clinician.

> **Prototype notice:** SAHAARA is a hackathon demonstration, not a clinical service or validated mental-health prediction system. Its personal signal is a transparent reflection of self-reported answers. It must not be used for diagnosis, duty fitness decisions, ranking, discipline, or personnel selection.

---

## Project Details

| | |
| --- | --- |
| **Project name** | SAHAARA |
| **Problem Statement ID** | 26186 |
| **Problem statement** | AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces |
| **Theme** | Wellbeing, AI, and secure data management |
| **Category** | Software |
| **Team** | _Eastnewbies_ |

---

## The Challenge

Uniformed personnel may face irregular or night shifts, disrupted sleep, sustained workload, physical strain, exposure to difficult experiences, separation from family and peers, and barriers to seeking support. These pressures differ from person to person, and a useful support system must respect that difference.

People also need confidence that sensitive wellbeing information will not automatically become an operational or employment decision. SAHAARA is designed around private self-reflection, clear consent, and limited access.

## Our Approach

SAHAARA offers a private place for personnel to record brief check-ins and review their own history. A simple, explainable score reflects the answers they choose to provide. Optional AI can suggest supportive next steps from de-identified check-in factors when the person explicitly opts in.

The prototype does not infer wellbeing from rank, assignment, unit, face, or operational information. It does not ask for unit or mission details.

---

## Key Features

- **Personnel wellbeing dashboard** with a personalized greeting and latest self-reported signal.
- **Structured check-ins** covering perceived stress, fatigue, workload, mood, available support, sleep quality and duration, shift pattern, recovery, optional difficult-experience impact, and physical strain.
- **Personal history and export** so personnel can review and download their own saved check-ins.
- **Consent-based clinician access:** a person can grant access to a registered clinician account and revoke it later.
- **Optional AI reflection:** after separate consent, Mistral can suggest low-risk support ideas using up to seven de-identified numeric check-ins. Names, emails, and free-text notes are excluded.
- **Anonymous administrator trends:** the admin view contains aggregate trends only when at least 10 distinct people contribute; it does not provide individual record search.
- **Support pathways** including a brief breathing reset, trusted-peer reminder, and clinician sharing controls.
- **Responsive interface** designed for desktop and mobile screens.
- **Encrypted prototype storage** with PostgreSQL/Aiven support for an encrypted application payload.

---

## How It Works

1. Personnel create an account and sign in.
2. They complete a short check-in using self-reported information.
3. SAHAARA calculates a transparent personal reflection score and stores the check-in in the person's history.
4. The person can review or export their history at any time.
5. They may explicitly grant a clinician access to their selected history and can revoke access later.
6. They may separately consent to a one-time, de-identified Mistral reflection.
7. Administrative views show only aggregate patterns after the minimum group-size threshold is met.

---

## Personal Signal and AI

The personal signal is a weighted, rule-based score from 0–100 based on self-reported check-in factors. It is included to make the prototype understandable and demonstrable; it is **not an ML prediction**, diagnosis, clinical assessment, or operational risk score.

For a future predictive model to be responsible, the project would need an explicitly defined outcome and prediction horizon, representative and consented data, independent clinical validation, calibration and subgroup-bias evaluation, human oversight, and continuous monitoring. The student wellbeing model supplied separately was not used because its inputs and population do not represent uniformed personnel.

Mistral is optional and only produces supportive language. It does not calculate the score or diagnose. AI calls require explicit consent for that request, and the request excludes identifiers and notes.

---

## Privacy and Access Model

- Personnel can access their own check-ins and exports.
- Clinicians can view a member's history only after that member grants access to the clinician's registered account.
- Members can revoke clinician access.
- Administrators receive aggregate trends only, subject to a 10-person minimum; they cannot search individual records.
- AI suggestions and clinician AI summaries have separate consent controls.
- Check-in prompts discourage entering unit, location, mission, or other operational details.

The prototype supports role-based behavior but does **not** verify clinician credentials or organizational affiliation. Do not enter real, identifiable personnel wellbeing information into this hackathon deployment.

---

## Technology

| Area | Technology |
| --- | --- |
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js built-in HTTP server |
| Database | PostgreSQL (`pg` driver); Aiven-compatible TLS verification |
| AI | Optional Mistral API integration |
| Deployment | Render-compatible Node web service |
| Security concepts | Scrypt password hashing, HTTP-only session cookie, AES-256-GCM encrypted data payload, consent checks, aggregate minimum threshold |

SAHAARA does not currently implement a blockchain, face recognition, or biometric authentication. The audit trail and access controls are application-level prototype features, not an immutable distributed ledger.

---

## Run Locally

Requires Node.js 20 or later.

```bash
npm install
npm start
```

Open https://uniformed-force-mental-health-2.onrender.com  Local configuration can be provided in a private `.env` file. Use fresh secrets; never commit `.env` or share credentials in source code.

### Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Yes for real deployment | Secret used to sign session tokens; keep stable |
| `DATA_ENCRYPTION_KEY` | Yes for real deployment | Secret used to derive the AES-256-GCM storage key; keep stable or stored data cannot be decrypted |
| `ADMIN_INVITE_CODE` | For admin account creation | Private invitation code for the admin registration flow |
| `DATABASE_URL` | Optional | PostgreSQL connection URI |
| `DATABASE_CA_CERT` | Required with `DATABASE_URL` on Render | Aiven CA certificate PEM contents; TLS certificate verification is enforced |
| `DATABASE_CA_CERT_PATH` | Optional for local deployments | Filesystem path to the CA certificate |
| `MISTRAL_API_KEY` | Optional | Enables the consent-based AI reflection endpoints |
| `MISTRAL_MODEL` | Optional | Mistral model; defaults to `mistral-small-2603` |
| `PORT` | Supplied by host | HTTP port; defaults to `3010` locally |

The Aiven URI and Mistral key previously pasted into chat should be revoked/rotated before use. Set replacement credentials only in your deployment environment, never in this README.

---

## Deploy on Render

Create a **Web Service** from the repository containing this project and set:

- **Runtime:** Node
- **Build command:** `npm install`
- **Start command:** `npm start`
- **Health check path:** `/`

Add the following in **Render → service → Environment**:

```text
NODE_ENV=production
SESSION_SECRET=<generate a unique random secret of at least 32 random bytes>
DATA_ENCRYPTION_KEY=<generate a different unique random secret of at least 32 random bytes>
ADMIN_INVITE_CODE=<generate a long private invitation code>
DATABASE_URL=<newly rotated PostgreSQL connection URI>
DATABASE_CA_CERT=<Aiven CA certificate PEM contents>
MISTRAL_API_KEY=<optional newly rotated Mistral key>
MISTRAL_MODEL=mistral-small-2603
```

Keep `SESSION_SECRET` and `DATA_ENCRYPTION_KEY` private and stable. Without PostgreSQL, Render's ephemeral filesystem can lose the local encrypted data file during restarts or redeploys. If PostgreSQL is enabled, keep the encryption key backed up securely; the database stores an encrypted payload and cannot restore it without that key.

---

## Limitations and Future Work

This project is an educational SIH concept prototype. It does not yet include clinician identity verification, rate limiting, account recovery, a validated predictive model, crisis response workflow, formal security review, jurisdiction-specific privacy assessment, or production operations monitoring. It should not be used to make clinical or service decisions.

Potential next steps:

- Co-design privacy and support workflows with uniformed personnel and qualified clinicians.
- Evaluate the check-in and consent experience with representative users.
- Define safe data retention, deletion, incident response, and governance policies.
- Add verified clinician onboarding, MFA/passkeys, rate limiting, and security monitoring.
- Build a consented and clinically validated prediction research pathway with bias review and human oversight before considering predictive use.
- Add interoperable exports and accessible mobile-first support resources.

---

## Team

Developed for **Smart India Hackathon 2026**, Problem Statement **26186 — AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces**.

**Team name:** Add your team name here  
**Demo:** Add your deployed Render URL here  
**Demo video:** Add your presentation video link here

---

## License

Created as an educational hackathon prototype for SIH 2026. Add the team's chosen license before redistributing the source code.
