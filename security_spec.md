# SmartClinic Firestore Security Specification (Phase 0 Security TDD)

## 1. Master Sources of Truth & Data Invariants

1. **Default-Deny Zero Trust**: All paths default to `allow read, write: if false;`. Every active collection in `firebase-blueprint.json` has an explicit, hardened `match` block.
2. **Server-Only Initial Administrator Bootstrap & Role Source of Truth**:
   - No client token custom claims are trusted inside `firestore.rules`.
   - Nobody is ever assigned `admin` automatically by being the first user to log in or via client-side self-registration.
   - The FIRST System Administrator is provisioned exclusively in a trusted server/CLI environment via the **Firebase Admin SDK** (`scripts/bootstrap-firebase-admin.ts` or `/api/firebase/bootstrap-admin` matching `FIREBASE_INITIAL_ADMIN_UID`), which atomically writes `/bootstrap_locks/initial_admin`, `/admins/{uid}`, `/staff_accounts/{uid}` (`role == 'admin'`, `active == true`), and `/clinic_roster/current`.
   - `/bootstrap_locks/{lockId}` denies ALL client writes (`allow list, create, update, delete: if false;`).
   - `isAdmin()` requires `request.auth.token.email_verified == true`, `exists(/admins/$(request.auth.uid))`, AND `/staff_accounts/$(request.auth.uid)` having `role == 'admin' && active == true`.
   - The primary `bootstrappedAdminUid` recorded in `/bootstrap_locks/initial_admin` cannot be deleted from `/admins` or demoted/deactivated in `/staff_accounts`.
   - Additional staff roles (`receptionist`, `nurse`, `doctor`, `laboratory`, `pharmacist`, `admin`) require `/bootstrap_locks/initial_admin` to exist and either an existing `isAdmin()` or a matching `'Pending Enrollment'` `/staff_invitations/{inviteId}` document.
3. **Confidential Clinical Note Isolation (Admin & Receptionist Exclusion)**:
   - `/consultations/{visitId}` and `/nursing_assessments/{visitId}` restrict `get` and `list` strictly to `doctor` and `nurse` UIDs (plus the owning patient on finalized `consultations` where `patientVisible == true && portalUserId == request.auth.uid`). `isAdmin()` does NOT grant read access to confidential medical notes.
4. **Unverified Lab Result Isolation**:
   - Patients can read `/lab_orders/{orderId}` ONLY when `resource.data.patientVisible == true && resource.data.status == 'Released' && resource.data.portalUserId == request.auth.uid`.
5. **PII Split & Zero-Get List Enforcement**:
   - `/patient_accounts/{userId}` forbids `list` altogether and restricts `get` strictly to `request.auth.uid == userId || isAdmin()`.
   - Every `allow list` block across all collections evaluates `resource.data` directly (zero `get()` or `exists()` calls inside `list` blocks) using `resource.data.portalUserId == request.auth.uid`, `resource.data.recipientUid == request.auth.uid`, `request.auth.uid in resource.data.authorizedViewerUids`, or public flags (`active == true` / `published == true`).
6. **Temporal & Immutable Field Integrity**:
   - Every write enforces `createdAt == request.time` on `create`, `createdAt == resource.data.createdAt` (immutable) on `update`, and `updatedAt == request.time` on both `create` and `update`.
   - Audit logs (`/audit_logs/{logId}`) forbid `update` and `delete`.
7. **Strict Demonstration vs Operational Analytics Separation**:
   - `/evaluator_records/{recordId}` and `/evaluator_imports/{batchId}` require `datasetMode == 'demonstration'` and are readable/writable strictly by Admin.

---

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return `PERMISSION_DENIED`)

1. **Payload 1 — First-Login Client Self-Promotion to Admin (`/admins/attacker_uid` or `/bootstrap_locks/initial_admin`)**: Authenticated user logs in first on a fresh database and attempts `create` on `/admins/attacker_uid` or `/bootstrap_locks/initial_admin`. Rejected (`allow create: if false` on `bootstrap_locks`; `/admins` requires `exists(/bootstrap_locks/initial_admin)` and existing `isAdmin()` or Admin-issued invitation).
2. **Payload 2 — Unverified Email Spoofing Staff Invitation**: Attacker presents an invited email with `email_verified == false`. Rejected by `isVerifiedUser()` gate (`request.auth.token.email_verified == true`).
3. **Payload 3 — Self-Assigned Doctor or Admin Role (`/staff_accounts/attacker_uid`)**: Patient attempts to create `/staff_accounts/attacker_uid` with `role: "admin"` or `role: "doctor"` without an Admin-issued `/staff_invitations` record, or attempts `update` to change `role` to `"admin"`. Rejected (`incoming().role == existing().role` for self-updates).
4. **Payload 4 — Shadow Field Injection on Patient Account (`/patient_accounts/u1`)**: Patient creates `/patient_accounts/u1` including an undeclared field `"isAdmin": true`. Rejected by `data.keys().hasOnly(...)`.
5. **Payload 5 — Cross-Patient PII Read (`/patient_accounts/victim_uid`)**: Authenticated `attacker_uid` attempts `get` or `list` on `/patient_accounts/victim_uid`. Rejected by strict owner check and disabled `list`.
6. **Payload 6 — Admin Snooping Confidential Consultation Notes (`/consultations/VST-100`)**: Authenticated Admin attempts `get` on `/consultations/VST-100`. Rejected because `consultations` read rules exclude `admin` and `receptionist` roles.
7. **Payload 7 — Receptionist Modifying Signed Prescription (`/prescriptions/RX-100`)**: Receptionist attempts `update` on `/prescriptions/RX-100`. Rejected because only `doctor` or `pharmacist` roles may update prescriptions.
8. **Payload 8 — Patient Reading Unverified Lab Result (`/lab_orders/LAB-100`)**: Patient attempts `get` on `/lab_orders/LAB-100` while `status == "For Verification"` and `patientVisible == false`. Rejected.
9. **Payload 9 — Blanket Appointment Scraping (`list /appointments`)**: Authenticated patient executes unfiltered `getDocs(collection(db, 'appointments'))`. Rejected because `allow list` requires `resource.data.portalUserId == request.auth.uid` or membership in `resource.data.authorizedViewerUids`.
10. **Payload 10 — Forged Client Timestamp (`createdAt` Spoofing)**: Authenticated user submits `createdAt: Timestamp.fromMillis(946684800000)` instead of `serverTimestamp()`. Rejected by `incoming().createdAt == request.time`.
11. **Payload 11 — ID Poisoning / Resource Exhaustion**: Attacker targets document ID with 500-byte or slash-injected ID or 2MB `reasonForVisit` string. Rejected by `isValidId(id)` (`size() <= 128`, regex `^[a-zA-Z0-9_\-]+$`) and `.size() <= 500`.
12. **Payload 12 — Tampering Immutable Audit Log (`/audit_logs/LOG-1`)**: Admin or staff attempts `update` or `delete` on an existing `/audit_logs/LOG-1` entry. Rejected (`allow update, delete: if false;`).
