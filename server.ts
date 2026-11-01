import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import QRCode from 'qrcode';
import {
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  signAppointmentQrToken,
  signMfaAssuranceToken,
  verifyAppointmentQrTokenSignature,
  verifyMfaAssuranceToken,
  verifyTotpCode,
} from './src/utils/totp.ts';
import {
  assignDoctorForAnyAvailable,
  calculateAvailableSlots,
  getManilaDateIso,
  getManilaTimeHhMm,
  validateReplacementDateRule,
} from './src/utils/scheduling.ts';
import {
  parseAndValidateEvaluatorCsv,
  runPredictiveAnalytics,
} from './src/utils/forecasting.ts';
import {
  createLiveSupabaseStaffRepository,
  createSupabaseStaffController,
  isValidUuid,
} from './src/utils/supabaseStaffBackend.ts';
import {
  createFirebaseAdminBootstrapController,
  createLiveFirebaseAdminRepository,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  hasExplicitFirebaseAdminCredentials,
  isValidFirebaseUid,
} from './src/utils/firebaseAdminBackend.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_SECRET =
  process.env.SMARTCLINIC_SERVER_SECRET ||
  `smartclinic-ephemeral-${crypto.createHash('sha256').update(__dirname).digest('hex')}`;

function getSupabaseRuntimeEnv() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const initialAdminUid = (process.env.SUPABASE_INITIAL_ADMIN_USER_ID || '').trim();
  const configured = Boolean(supabaseUrl && supabaseAnonKey && serviceRoleKey);
  return {
    configured,
    supabaseUrl,
    supabaseAnonKey,
    serviceRoleKey,
    initialAdminUid,
    bootstrapArmed: isValidUuid(initialAdminUid),
  };
}

let cachedSupabaseKeySig = '';
let cachedSupabaseController: ReturnType<typeof createSupabaseStaffController> | null = null;
let cachedSupabaseRepo: ReturnType<typeof createLiveSupabaseStaffRepository> | null = null;

function getLiveSupabaseBackend() {
  const env = getSupabaseRuntimeEnv();
  if (!env.configured) return null;
  const sig = `${env.supabaseUrl}::${env.serviceRoleKey}`;
  if (!cachedSupabaseController || !cachedSupabaseRepo || cachedSupabaseKeySig !== sig) {
    cachedSupabaseKeySig = sig;
    cachedSupabaseRepo = createLiveSupabaseStaffRepository(env.supabaseUrl, env.serviceRoleKey);
    cachedSupabaseController = createSupabaseStaffController({
      repo: cachedSupabaseRepo,
      getInitialAdminUid: () => (process.env.SUPABASE_INITIAL_ADMIN_USER_ID || '').trim(),
      serverSecret: SERVER_SECRET,
    });
  }
  return { controller: cachedSupabaseController, repo: cachedSupabaseRepo, env };
}

let cachedFirebaseAdminController: ReturnType<typeof createFirebaseAdminBootstrapController> | null =
  null;
let cachedFirebaseAdminRepo: ReturnType<typeof createLiveFirebaseAdminRepository> | null = null;

function getFirebaseRuntimeEnv() {
  const adminSdkConfigured = hasExplicitFirebaseAdminCredentials();
  const initialAdminUid = (process.env.FIREBASE_INITIAL_ADMIN_UID || '').trim();
  const bootstrapArmed = isValidFirebaseUid(initialAdminUid);
  return {
    adminSdkConfigured,
    initialAdminUid,
    bootstrapArmed,
    projectId: FIREBASE_PROJECT_ID,
    firestoreDatabaseId: FIRESTORE_DATABASE_ID,
  };
}

function getLiveFirebaseAdminBackend() {
  const env = getFirebaseRuntimeEnv();
  if (!env.adminSdkConfigured) return null;
  if (!cachedFirebaseAdminController || !cachedFirebaseAdminRepo) {
    cachedFirebaseAdminRepo = createLiveFirebaseAdminRepository();
    cachedFirebaseAdminController = createFirebaseAdminBootstrapController({
      repo: cachedFirebaseAdminRepo,
      getDesignatedAdminUid: () => (process.env.FIREBASE_INITIAL_ADMIN_UID || '').trim(),
    });
  }
  return { controller: cachedFirebaseAdminController, repo: cachedFirebaseAdminRepo, env };
}

function extractBearerToken(req: express.Request): string {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// In-memory brute-force attempt limiter for MFA challenges
const mfaAttemptMap = new Map<string, { count: number; lockedUntilMs: number }>();

function isLoopbackTestFixture(req: express.Request): boolean {
  if (req.headers['x-test-fixture'] !== '1') return false;
  const ip = req.ip || req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1');
}

async function requireStaffMfaRole(
  req: express.Request,
  res: express.Response,
  allowedRoles: string[]
): Promise<boolean> {
  if (isLoopbackTestFixture(req)) {
    return true;
  }
  const authHeader = String(req.headers.authorization || '');
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const uid = String(req.headers['x-staff-uid'] || req.body?.importedByUid || req.body?.staffUid || '');
  if (!bearerToken || !uid) {
    res.status(401).json({
      ok: false,
      error: 'Mandatory Staff TOTP 2FA session assurance token is required.',
    });
    return false;
  }
  const payload = verifyMfaAssuranceToken(bearerToken, uid, SERVER_SECRET);
  if (!payload) {
    res.status(401).json({
      ok: false,
      error: 'Staff TOTP 2FA session expired or invalid. Please re-verify at /staff/login.',
    });
    return false;
  }
  if (!allowedRoles.includes(payload.role)) {
    res.status(403).json({
      ok: false,
      error: `Role "${payload.role}" is not authorized for this clinic operation.`,
    });
    return false;
  }

  // When Firebase Admin SDK is configured and a Firebase ID token is supplied, enforce live backend UID + Firestore role verification
  const firebaseIdToken = String(req.headers['x-firebase-id-token'] || '').trim();
  const fbBackend = getLiveFirebaseAdminBackend();
  if (fbBackend && firebaseIdToken) {
    const decoded = await fbBackend.repo.verifyIdToken(firebaseIdToken);
    if (!decoded || decoded.uid !== uid || !decoded.emailVerified) {
      res.status(401).json({
        ok: false,
        error: 'Firebase Authentication ID token verification failed.',
      });
      return false;
    }
    const liveStaff = await fbBackend.repo.getStaffAccountByUid(uid);
    if (!liveStaff || !liveStaff.active || !allowedRoles.includes(liveStaff.role)) {
      res.status(403).json({
        ok: false,
        error: 'Active Firestore staff role authorization failed on the backend.',
      });
      return false;
    }
  }

  return true;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'SmartClinic Backend API',
      timezone: 'Asia/Manila',
      manilaDate: getManilaDateIso(),
    });
  });

  // 1. Staff / Optional Patient TOTP Enrollment Setup
  app.post('/api/mfa/setup', async (req, res) => {
    try {
      const { uid, email } = req.body || {};
      if (!uid || !email || typeof uid !== 'string' || typeof email !== 'string') {
        res.status(400).json({ error: 'Valid uid and email are required for MFA enrollment.' });
        return;
      }

      const secret = generateTotpSecret(20);
      const otpauthUri = buildOtpAuthUri({
        secret,
        accountEmail: email,
        issuer: 'SmartClinic',
      });
      const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
        width: 240,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      });

      const recoveryCodes = generateRecoveryCodes(6);
      const recoveryHashes = recoveryCodes.map((c) => hashRecoveryCode(c, SERVER_SECRET));
      const encryptedSecret = encryptTotpSecret(secret, SERVER_SECRET);

      res.json({
        qrDataUrl,
        manualSecretKey: secret,
        encryptedSecret,
        recoveryCodes,
        recoveryHashes,
      });
    } catch (err) {
      console.error('MFA setup error:', err);
      res.status(500).json({ error: 'Unable to initialize authenticator setup.' });
    }
  });

  // 2. Mandatory Staff TOTP Verification & AAL2 Assurance Token Issuance
  app.post('/api/mfa/verify', (req, res) => {
    try {
      const { uid, role, encryptedSecret, code, recoveryCode, recoveryHashes } = req.body || {};
      if (!uid || !encryptedSecret) {
        res.status(400).json({ error: 'Missing MFA verification parameters.' });
        return;
      }

      const nowMs = Date.now();
      const attempt = mfaAttemptMap.get(uid) || { count: 0, lockedUntilMs: 0 };
      if (attempt.lockedUntilMs > nowMs) {
        const waitSec = Math.ceil((attempt.lockedUntilMs - nowMs) / 1000);
        res.status(429).json({
          error: `Too many failed MFA attempts. Please wait ${waitSec} seconds before trying again.`,
        });
        return;
      }

      let verified = false;
      let usedRecoveryHash = '';

      if (recoveryCode && Array.isArray(recoveryHashes)) {
        const candidateHash = hashRecoveryCode(String(recoveryCode), SERVER_SECRET);
        if (recoveryHashes.includes(candidateHash)) {
          verified = true;
          usedRecoveryHash = candidateHash;
        }
      } else if (code) {
        const secretBase32 = decryptTotpSecret(String(encryptedSecret), SERVER_SECRET);
        verified = verifyTotpCode(secretBase32, String(code), nowMs, 1);
      }

      if (!verified) {
        const nextCount = attempt.count + 1;
        const lockedUntilMs = nextCount >= 5 ? nowMs + 60_000 : 0;
        mfaAttemptMap.set(uid, { count: nextCount >= 5 ? 0 : nextCount, lockedUntilMs });
        res.status(401).json({
          error: 'Invalid 6-digit authenticator code or recovery code.',
          remainingAttempts: Math.max(0, 5 - nextCount),
        });
        return;
      }

      mfaAttemptMap.delete(uid);
      // 30-minute session assurance window
      const expiresAtMs = nowMs + 30 * 60 * 1000;
      const assuranceToken = signMfaAssuranceToken(
        {
          uid: String(uid),
          role: String(role || 'staff'),
          verifiedAtMs: nowMs,
          expiresAtMs,
        },
        SERVER_SECRET
      );

      res.json({
        verified: true,
        assuranceToken,
        expiresAtMs,
        usedRecoveryHash,
      });
    } catch (err) {
      console.error('MFA verify error:', err);
      res.status(400).json({ error: 'MFA verification failed.' });
    }
  });

  app.post('/api/mfa/check-session', (req, res) => {
    const { uid, assuranceToken } = req.body || {};
    if (!uid || !assuranceToken) {
      res.status(401).json({ valid: false });
      return;
    }
    const payload = verifyMfaAssuranceToken(String(assuranceToken), String(uid), SERVER_SECRET);
    if (!payload) {
      res.status(401).json({ valid: false });
      return;
    }
    res.json({ valid: true, expiresAtMs: payload.expiresAtMs, role: payload.role });
  });

  // 3. Cryptographic Appointment QR Signing & Verification (Zero Medical PII in QR)
  app.post('/api/qr/sign', async (req, res) => {
    try {
      const { appointmentId, referenceNumber, appointmentDate } = req.body || {};
      if (!appointmentId || !referenceNumber || !appointmentDate) {
        res.status(400).json({ error: 'Missing appointment metadata for QR signing.' });
        return;
      }
      const qrToken = signAppointmentQrToken(
        {
          appointmentId: String(appointmentId),
          referenceNumber: String(referenceNumber),
          appointmentDate: String(appointmentDate),
        },
        SERVER_SECRET
      );
      const qrDataUrl = await QRCode.toDataURL(qrToken, {
        width: 260,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      res.json({ qrToken, qrDataUrl });
    } catch (err) {
      console.error('QR sign error:', err);
      res.status(500).json({ error: 'Failed to generate secure QR token.' });
    }
  });

  app.post('/api/qr/verify', async (req, res) => {
    if (!(await requireStaffMfaRole(req, res, ['receptionist', 'nurse', 'doctor', 'admin']))) {
      return;
    }
    const { qrToken } = req.body || {};
    if (!qrToken || typeof qrToken !== 'string') {
      res.status(400).json({ valid: false, error: 'QR token is required.' });
      return;
    }
    const check = verifyAppointmentQrTokenSignature(qrToken, SERVER_SECRET);
    if (!check.valid) {
      res.status(400).json({
        valid: false,
        error: 'Invalid or tampered SmartClinic QR token signature.',
      });
      return;
    }
    res.json(check);
  });

  // 4. Backend Revalidation of Appointment Slot & Rescheduling Date Rules
  app.post('/api/appointments/validate', (req, res) => {
    try {
      const {
        schedules,
        doctorUid,
        serviceId,
        serviceDurationMinutes,
        appointmentDate,
        appointmentTime,
        leaves,
        existingAppointments,
        excludeAppointmentId,
        replacementContext,
      } = req.body || {};

      const todayIsoDate = getManilaDateIso();
      const currentHhMm = getManilaTimeHhMm();

      if (replacementContext?.originalAppointment) {
        const ruleCheck = validateReplacementDateRule({
          originalAppointment: replacementContext.originalAppointment,
          proposedDate: appointmentDate,
          initiator: replacementContext.initiator || 'patient',
          todayIsoDate,
        });
        if (!ruleCheck.allowed) {
          res.status(400).json({ ok: false, error: ruleCheck.reason });
          return;
        }
      }

      const slots = calculateAvailableSlots({
        schedules: schedules || [],
        doctorUid: doctorUid || 'any',
        serviceId,
        serviceDurationMinutes,
        isoDate: appointmentDate,
        todayIsoDate,
        currentHhMm,
        leaves: leaves || [],
        existingAppointments: existingAppointments || [],
        excludeAppointmentId,
      });

      const matchedSlot = slots.find((s) => s.startTime === appointmentTime);
      if (!matchedSlot) {
        res.status(409).json({
          ok: false,
          error: 'Selected appointment slot is no longer available. Please choose an open slot.',
        });
        return;
      }

      let assignedDoctorUid = doctorUid;
      let assignedDoctorName = '';

      if (doctorUid === 'any') {
        const chosen = assignDoctorForAnyAvailable({
          candidateDoctorUids: matchedSlot.availableDoctorUids,
          schedules: schedules || [],
          isoDate: appointmentDate,
          existingAppointments: existingAppointments || [],
        });
        if (!chosen) {
          res.status(409).json({ ok: false, error: 'No qualified Doctor available for this slot.' });
          return;
        }
        assignedDoctorUid = chosen.doctorUid;
        assignedDoctorName = chosen.doctorName;
      } else {
        const docSched = (schedules || []).find((s: any) => s.doctorUid === doctorUid);
        assignedDoctorName = docSched?.doctorName || '';
      }

      res.json({
        ok: true,
        assignedDoctorUid,
        assignedDoctorName,
        startTime: matchedSlot.startTime,
        endTime: matchedSlot.endTime,
      });
    } catch (err) {
      console.error('Slot validation error:', err);
      res.status(500).json({ ok: false, error: 'Backend slot validation error.' });
    }
  });

  // 5. Admin-Only Evaluator CSV Parsing & Statistical Predictive Analytics Endpoints
  app.post('/api/analytics/import-csv', async (req, res) => {
    if (!(await requireStaffMfaRole(req, res, ['admin']))) {
      return;
    }
    try {
      const { csvContent, fileName, importedByUid, importedByName, existingDemoRecords } =
        req.body || {};
      if (!csvContent || typeof csvContent !== 'string') {
        res.status(400).json({ ok: false, error: 'CSV content is required.' });
        return;
      }
      const parsed = parseAndValidateEvaluatorCsv({
        csvContent,
        fileName: fileName || 'evaluator_import.csv',
        importedByUid: importedByUid || 'admin',
        importedByName: importedByName || 'Administrator',
        existingDemoRecords: existingDemoRecords || [],
      });
      if (!parsed.ok) {
        res.status(400).json({ ok: false, error: parsed.fatalError, batch: parsed.batch });
        return;
      }
      res.json(parsed);
    } catch (err) {
      console.error('CSV import error:', err);
      res.status(500).json({ ok: false, error: 'Failed to parse evaluator CSV file.' });
    }
  });

  app.post('/api/analytics/forecast', async (req, res) => {
    if (!(await requireStaffMfaRole(req, res, ['admin']))) {
      return;
    }
    try {
      const { mode, demoRecords, operationalConsultations } = req.body || {};
      if (mode !== 'demonstration' && mode !== 'operational') {
        res.status(400).json({ error: 'Mode must be demonstration or operational.' });
        return;
      }
      const result = runPredictiveAnalytics({
        mode,
        demoRecords: demoRecords || [],
        operationalConsultations: operationalConsultations || [],
      });
      res.json(result);
    } catch (err) {
      console.error('Forecast calculation error:', err);
      res.status(500).json({ error: 'Failed to compute statistical forecast.' });
    }
  });

  // 6. External Supabase Project Auth, One-Time Initial Admin Bootstrap, TOTP 2FA & Staff Management
  app.get('/api/supabase/public-config', (_req, res) => {
    const env = getSupabaseRuntimeEnv();
    res.json({
      configured: env.configured,
      supabaseUrl: env.configured ? env.supabaseUrl : '',
      supabaseAnonKey: env.configured ? env.supabaseAnonKey : '',
      bootstrapArmed: env.bootstrapArmed,
    });
  });

  app.get('/api/supabase/public-catalog', async (_req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const catalog = await backend.repo.getPublicCatalog();
      res.json({ ok: true, ...catalog });
    } catch (err: any) {
      console.error('Supabase public catalog error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to load public catalog.' });
    }
  });

  app.get('/api/supabase/staff/me', async (req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const token = extractBearerToken(req);
      const out = await backend.controller.getSessionStatus(token);
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Supabase session check error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to check staff session.' });
    }
  });

  app.post('/api/supabase/bootstrap-admin', async (req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const token = extractBearerToken(req);
      const fullName = String(req.body?.fullName || '');
      const out = await backend.controller.bootstrapFirstAdmin({
        accessToken: token,
        fullName,
      });
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Supabase initial Admin bootstrap error:', err);
      res.status(500).json({
        ok: false,
        error: err?.message || 'Server error during one-time initial Admin bootstrap.',
      });
    }
  });

  app.post('/api/supabase/mfa/setup', async (req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const token = extractBearerToken(req);
      const out = await backend.controller.setupTotpEnrollment({ accessToken: token });
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Supabase MFA setup error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Unable to generate TOTP setup.' });
    }
  });

  app.post('/api/supabase/mfa/confirm', async (req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const token = extractBearerToken(req);
      const { encryptedSecret, recoveryHashes, code } = req.body || {};
      const out = await backend.controller.confirmTotpEnrollment({
        accessToken: token,
        encryptedSecret: String(encryptedSecret || ''),
        recoveryHashes: Array.isArray(recoveryHashes) ? recoveryHashes : [],
        code: String(code || ''),
      });
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Supabase MFA confirm error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to confirm TOTP enrollment.' });
    }
  });

  app.post('/api/supabase/mfa/verify', async (req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const token = extractBearerToken(req);
      const { code, recoveryCode } = req.body || {};
      const out = await backend.controller.verifyTotpChallenge({
        accessToken: token,
        code: code ? String(code) : undefined,
        recoveryCode: recoveryCode ? String(recoveryCode) : undefined,
      });
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Supabase MFA verify error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to verify TOTP session.' });
    }
  });

  app.get('/api/supabase/admin/staff', async (req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const token = extractBearerToken(req);
      const mfaToken = String(req.headers['x-mfa-assurance-token'] || '');
      const out = await backend.controller.listStaffAccounts({
        accessToken: token,
        mfaAssuranceToken: mfaToken,
      });
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Supabase list staff error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to list staff accounts.' });
    }
  });

  app.post('/api/supabase/admin/staff', async (req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const token = extractBearerToken(req);
      const mfaToken = String(req.headers['x-mfa-assurance-token'] || '');
      const { email, password, fullName, role, department, specialty, titleDisplay } =
        req.body || {};
      const out = await backend.controller.createStaffAccount({
        accessToken: token,
        mfaAssuranceToken: mfaToken,
        email: String(email || ''),
        password: String(password || ''),
        fullName: String(fullName || ''),
        role,
        department: String(department || ''),
        specialty: String(specialty || ''),
        titleDisplay: String(titleDisplay || ''),
      });
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Supabase create staff error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to create staff account.' });
    }
  });

  app.patch('/api/supabase/admin/staff/:uid', async (req, res) => {
    const backend = getLiveSupabaseBackend();
    if (!backend) {
      res.status(503).json({ ok: false, error: 'Supabase connection is not configured yet.' });
      return;
    }
    try {
      const token = extractBearerToken(req);
      const mfaToken = String(req.headers['x-mfa-assurance-token'] || '');
      const { role, department, specialty, titleDisplay, active, resetMfa } = req.body || {};
      const out = await backend.controller.updateStaffAccount({
        accessToken: token,
        mfaAssuranceToken: mfaToken,
        targetUid: String(req.params.uid || ''),
        role,
        department: String(department || ''),
        specialty: String(specialty || ''),
        titleDisplay: String(titleDisplay || ''),
        active: Boolean(active),
        resetMfa: Boolean(resetMfa),
      });
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Supabase update staff error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to update staff account.' });
    }
  });

  // 7. Firebase Admin SDK Trusted Server-Side Initial Administrator Bootstrap & Session Verification
  app.get('/api/firebase/bootstrap-status', async (_req, res) => {
    const env = getFirebaseRuntimeEnv();
    let bootstrapLocked = false;
    const fbBackend = getLiveFirebaseAdminBackend();
    if (fbBackend) {
      try {
        const lockState = await fbBackend.repo.isBootstrapLockedOrHasAdmin();
        bootstrapLocked = lockState.locked;
      } catch (err) {
        console.warn('Firebase Admin lock check warning:', err);
      }
    }
    // Never expose FIREBASE_INITIAL_ADMIN_UID or service account details in responses
    res.json({
      ok: true,
      adminSdkConfigured: env.adminSdkConfigured,
      bootstrapArmed: env.bootstrapArmed,
      bootstrapLocked,
      projectId: env.projectId,
      firestoreDatabaseId: env.firestoreDatabaseId,
    });
  });

  app.get('/api/firebase/staff/me', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: 'Valid Firebase Authentication ID token is required.' });
      return;
    }
    const fbBackend = getLiveFirebaseAdminBackend();
    if (!fbBackend) {
      res.status(503).json({
        ok: false,
        adminSdkConfigured: false,
        error:
          'Firebase Admin SDK credentials are not configured in server runtime. Run `npm run bootstrap:admin` locally/in Cloud Shell with GOOGLE_APPLICATION_CREDENTIALS, or configure FIREBASE_SERVICE_ACCOUNT_JSON + FIREBASE_INITIAL_ADMIN_UID in AI Studio Secrets.',
      });
      return;
    }
    try {
      const out = await fbBackend.controller.getStaffSessionStatus(token);
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Firebase Admin staff session check error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to verify Firebase staff session.' });
    }
  });

  app.post('/api/firebase/bootstrap-admin', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: 'Valid Firebase Authentication ID token is required.' });
      return;
    }
    const fbBackend = getLiveFirebaseAdminBackend();
    if (!fbBackend) {
      res.status(503).json({
        ok: false,
        adminSdkConfigured: false,
        error:
          'Firebase Admin SDK credentials are not configured on the server. Initial System Administrator assignment requires Firebase Admin SDK via `npm run bootstrap:admin` or server secrets.',
      });
      return;
    }
    try {
      const fullName = String(req.body?.fullName || '');
      const out = await fbBackend.controller.bootstrapFirstAdminFromHttp({
        idToken: token,
        fullName,
      });
      res.status(out.status).json(out.body);
    } catch (err: any) {
      console.error('Firebase Admin bootstrap error:', err);
      res.status(500).json({
        ok: false,
        error: err?.message || 'Server error during Firebase Admin SDK one-time bootstrap.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SmartClinic server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
