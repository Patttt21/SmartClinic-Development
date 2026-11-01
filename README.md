# SmartClinic — Outpatient Healthcare Management & Predictive Analytics

SmartClinic is a full-stack, role-based outpatient clinic management web application integrating real-time physician scheduling, privacy-safe QR front-desk check-in, nursing vital signs triage, outpatient consultations, laboratory diagnostics, pharmacy dispensing, itemized billing, and statistical predictive analytics.

## Key Architectural Principles

1. **Three Strictly Separated Interfaces**:
   - **Public Website** (`/`, `/about`, `/services`, `/doctors`, `/patient-guide`, `/contact`): Patient education, transparent fees, published physician hours, and Patient Portal entry. Public navigation never exposes internal staff login links.
   - **Patient Portal** (`/patient/*`): Online real-time slot booking, custom rescheduling/cancellation date enforcement, QR check-in passes, released medical records, verified laboratory reports, prescriptions, itemized billing acknowledgments, follow-up recommendations, and staff-verified walk-in record linking.
   - **Unified Staff Portal** (`/staff/login` &rarr; `/staff/<role>/dashboard`): Single unified login for all 6 staff roles (`Receptionist`, `Nurse`, `Doctor`, `Laboratory Staff`, `Pharmacist`, `Administrator`). Role routing is determined automatically from verified staff records, gated behind mandatory Authenticator-App TOTP 2FA (zero SMS dependencies).

2. **Clinical Confidentiality & Scope**:
   - Single-site outpatient clinic scope (no multi-branch routing, no emergency contact fields, no inpatient/ER modules).
   - Confidential clinical notes (`consultations`, `nursing_assessments`) are restricted to authorized care clinicians (`Doctor`, `Nurse`) and the patient (once finalized). `Administrator` and `Receptionist` accounts are restricted from reading clinical notes.
   - Appointment QR codes encode only an HMAC-signed opaque token (`SCQR.v1...`) and contain zero medical PII.

3. **Honest Statistical Predictive Analytics**:
   - **Operational Mode**: Uses only real finalized SmartClinic consultations. Displays an explicit `Insufficient Verified Historical Data for Operational Forecasting` notice until at least 15 verified consultations across 4+ calendar weeks exist.
   - **Demonstration Mode**: Populated exclusively via Admin CSV upload (`Consultation Date`, `Patient ID`, `Consultation Status`, `Chief Complaint`, `Appointment Type`, `Doctor's Diagnosis`), isolated from operational `patients` and `consultations`, and labeled `DEMONSTRATION MODE — EVALUATOR TEST DATA — NOT VALIDATED FOR REAL CLINIC DEMAND`.
   - Implements Moving Average, Simple Exponential Smoothing, Naive Baseline comparison, and chronological holdout Mean Absolute Error (MAE) across Weekly (Primary), Daily, Monthly (Exploratory), and Standardized Chief Complaint categories.

## Local Development & Verification

1. Copy `.env.example` to `.env` and configure `SMARTCLINIC_SERVER_SECRET` and `APP_URL`:
   ```bash
   cp .env.example .env
   npm install
   ```
2. Run deterministic logic & security-rule unit tests:
   ```bash
   npm test
   ```
3. Start the full-stack Express + Vite server on port `3000`:
   ```bash
   npm run dev
   ```
4. Build production bundle:
   ```bash
   npm run build
   ```

## Cloud Persistence & External Supabase / Vercel Deployment

- **Provisioned Runtime**: Configured out of the box with Firebase Authentication, Cloud Firestore (`firestore.rules` audited and deployed), and Express server-side TOTP/QR/Analytics endpoints (`server.ts`).
- **PostgreSQL / Supabase Migration Scripts**: Complete relational DDL and Row Level Security policies are provided in:
  - `supabase/migrations/001_smartclinic_schema.sql`
  - `supabase/migrations/002_rls_policies.sql`
