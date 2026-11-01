import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp as initializeAdminApp,
  type App as AdminApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import {
  FieldValue,
  getFirestore as getAdminFirestore,
} from 'firebase-admin/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import {
  DEFAULT_CLINIC_SERVICES,
  DEFAULT_COVERAGE_SETTINGS,
  DEFAULT_MEDICINE_INVENTORY,
  DEFAULT_PATIENT_GUIDES,
} from '../data/defaultCatalog';
import type { StaffAccount, StaffRole } from '../types/clinic';

export const FIREBASE_PROJECT_ID = firebaseAppletConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseAppletConfig.firestoreDatabaseId;

const FIREBASE_UID_REGEX = /^[a-zA-Z0-9_-]{6,128}$/;

export function isValidFirebaseUid(uid: string): boolean {
  return FIREBASE_UID_REGEX.test((uid || '').trim());
}

/**
 * Constant-time string equality check using SHA-256 digests so length differences
 * never leak timing information and partial UID prefixes can never match.
 */
export function constantTimeUidEqual(candidateUid: string, expectedUid: string): boolean {
  const cleanCandidate = (candidateUid || '').trim();
  const cleanExpected = (expectedUid || '').trim();
  if (!isValidFirebaseUid(cleanCandidate) || !isValidFirebaseUid(cleanExpected)) {
    return false;
  }
  const digestA = crypto.createHash('sha256').update(cleanCandidate, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(cleanExpected, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export interface FirebaseAuthUserSummary {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  disabled: boolean;
  providers: string[];
  customClaims: Record<string, unknown>;
}

export interface DecodedFirebaseCallerToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  signInProvider: string;
  customClaims: Record<string, unknown>;
}

export interface AdminSetupVerificationReport {
  ok: boolean;
  active: boolean;
  uid: string;
  projectId: string;
  firestoreDatabaseId: string;
  email: string;
  fullName: string;
  mfaEnrolled: boolean;
  checks: {
    authUserExists: boolean;
    authUserEnabled: boolean;
    emailVerified: boolean;
    hasGoogleProvider: boolean;
    customClaimAdmin: boolean;
    adminMarkerExists: boolean;
    staffProfileAdminActive: boolean;
    rosterIncludesAdmin: boolean;
    bootstrapLockActive: boolean;
  };
  missingReasons: string[];
}

export interface FirebaseAdminRepository {
  verifyIdToken(idToken: string): Promise<DecodedFirebaseCallerToken | null>;
  getAuthUserByUid(uid: string): Promise<FirebaseAuthUserSummary | null>;
  setAdminCustomClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
  isBootstrapLockedOrHasAdmin(): Promise<{
    locked: boolean;
    bootstrappedAdminUid: string;
  }>;
  getStaffAccountByUid(uid: string): Promise<(StaffAccount & { role: StaffRole }) | null>;
  runAtomicFirstAdminBootstrap(params: {
    uid: string;
    email: string;
    fullName: string;
    source: 'cli-script' | 'server-endpoint';
  }): Promise<
    | { ok: true; staffAccount: StaffAccount }
    | { ok: false; conflict: boolean; error: string }
  >;
  inspectAdminSetup(uid: string): Promise<AdminSetupVerificationReport>;
}

function parseServiceAccountFromEnv(): ServiceAccount | null {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed as ServiceAccount;
  }

  const rawB64 = (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
  if (rawB64) {
    const decoded = Buffer.from(rawB64, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed as ServiceAccount;
  }

  const gacPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (gacPath && fs.existsSync(gacPath)) {
    const fileText = fs.readFileSync(gacPath, 'utf8');
    const parsed = JSON.parse(fileText);
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed as ServiceAccount;
  }

  return null;
}

export function hasExplicitFirebaseAdminCredentials(): boolean {
  if ((process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim()) return true;
  if ((process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim()) return true;
  const gacPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (gacPath && fs.existsSync(gacPath)) return true;
  if ((process.env.FIREBASE_USE_ADC || '').trim() === 'true') return true;
  return false;
}

let cachedAdminApp: AdminApp | null = null;

export function getOrInitFirebaseAdminApp(): AdminApp {
  if (cachedAdminApp) return cachedAdminApp;
  const existing = getApps().find((a) => a.name === 'smartclinic-firebase-admin');
  if (existing) {
    cachedAdminApp = existing;
    return existing;
  }

  const serviceAccount = parseServiceAccountFromEnv();
  if (serviceAccount) {
    const saProjectId = (serviceAccount as any).project_id || serviceAccount.projectId;
    if (saProjectId && saProjectId !== FIREBASE_PROJECT_ID) {
      throw new Error(
        `Service account project_id ("${saProjectId}") does not match SmartClinic Firebase projectId ("${FIREBASE_PROJECT_ID}").`
      );
    }
    cachedAdminApp = initializeAdminApp(
      {
        credential: cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID,
      },
      'smartclinic-firebase-admin'
    );
    return cachedAdminApp;
  }

  cachedAdminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: FIREBASE_PROJECT_ID,
    },
    'smartclinic-firebase-admin'
  );
  return cachedAdminApp;
}

export function createLiveFirebaseAdminRepository(): FirebaseAdminRepository {
  const adminApp = getOrInitFirebaseAdminApp();
  const adminAuth = getAdminAuth(adminApp);
  // CRITICAL: Target the applet's named Firestore database, NOT '(default)'
  const adminDb = getAdminFirestore(adminApp, FIRESTORE_DATABASE_ID);

  return {
    async verifyIdToken(idToken: string): Promise<DecodedFirebaseCallerToken | null> {
      if (!idToken || typeof idToken !== 'string') return null;
      try {
        const decoded = await adminAuth.verifyIdToken(idToken, true);
        return {
          uid: decoded.uid,
          email: (decoded.email || '').trim().toLowerCase(),
          emailVerified: Boolean(decoded.email_verified),
          signInProvider: String(decoded.firebase?.sign_in_provider || ''),
          customClaims: decoded as Record<string, unknown>,
        };
      } catch {
        return null;
      }
    },

    async getAuthUserByUid(uid: string): Promise<FirebaseAuthUserSummary | null> {
      try {
        const userRecord = await adminAuth.getUser(uid);
        return {
          uid: userRecord.uid,
          email: (userRecord.email || '').trim().toLowerCase(),
          emailVerified: Boolean(userRecord.emailVerified),
          displayName: userRecord.displayName || '',
          disabled: Boolean(userRecord.disabled),
          providers: (userRecord.providerData || []).map((p) => p.providerId),
          customClaims: (userRecord.customClaims || {}) as Record<string, unknown>,
        };
      } catch (err: any) {
        if (err?.code === 'auth/user-not-found') {
          return null;
        }
        throw err;
      }
    },

    async setAdminCustomClaims(uid: string, claims: Record<string, unknown>): Promise<void> {
      const existing = await adminAuth.getUser(uid);
      await adminAuth.setCustomUserClaims(uid, {
        ...(existing.customClaims || {}),
        ...claims,
      });
    },

    async isBootstrapLockedOrHasAdmin() {
      const [lockSnap, rosterSnap, adminsSnap] = await Promise.all([
        adminDb.collection('bootstrap_locks').doc('initial_admin').get(),
        adminDb.collection('clinic_roster').doc('current').get(),
        adminDb.collection('admins').limit(1).get(),
      ]);

      const lockData = lockSnap.exists ? lockSnap.data() : null;
      const rosterData = rosterSnap.exists ? rosterSnap.data() : null;
      const bootstrappedUid = String(
        lockData?.bootstrappedAdminUid ||
          rosterData?.bootstrappedAdminUid ||
          (!adminsSnap.empty ? adminsSnap.docs[0].id : '')
      );

      return {
        locked: Boolean(
          (lockSnap.exists && lockData?.locked === true) ||
            rosterData?.bootstrappedAdminUid ||
            !adminsSnap.empty
        ),
        bootstrappedAdminUid: bootstrappedUid,
      };
    },

    async getStaffAccountByUid(uid: string) {
      const snap = await adminDb.collection('staff_accounts').doc(uid).get();
      if (!snap.exists) return null;
      const d = snap.data() || {};
      return {
        uid: String(d.uid || uid),
        email: String(d.email || ''),
        fullName: String(d.fullName || ''),
        role: d.role as StaffRole,
        department: String(d.department || ''),
        specialty: String(d.specialty || ''),
        titleDisplay: String(d.titleDisplay || ''),
        active: Boolean(d.active),
        mfaEnrolled: Boolean(d.mfaEnrolled),
        mfaEncryptedSecret: String(d.mfaEncryptedSecret || ''),
        mfaRecoveryHashes: Array.isArray(d.mfaRecoveryHashes) ? d.mfaRecoveryHashes : [],
        createdAt: String(d.createdIso || ''),
        updatedAt: String(d.createdIso || ''),
      };
    },

    async runAtomicFirstAdminBootstrap(params) {
      const nowIso = new Date().toISOString();
      const lockRef = adminDb.collection('bootstrap_locks').doc('initial_admin');
      const rosterRef = adminDb.collection('clinic_roster').doc('current');
      const adminRef = adminDb.collection('admins').doc(params.uid);
      const staffRef = adminDb.collection('staff_accounts').doc(params.uid);
      const coverageRef = adminDb.collection('coverage_settings').doc('current');

      let outStaffAccount: StaffAccount | null = null;

      try {
        await adminDb.runTransaction(async (tx) => {
          const [lockSnap, rosterSnap, existingAdminsSnap, existingStaffSnap, covSnap] =
            await Promise.all([
              tx.get(lockRef),
              tx.get(rosterRef),
              tx.get(adminDb.collection('admins').limit(1)),
              tx.get(staffRef),
              tx.get(coverageRef),
            ]);

          const alreadyLocked =
            (lockSnap.exists && lockSnap.data()?.locked === true) ||
            Boolean(rosterSnap.exists && rosterSnap.data()?.bootstrappedAdminUid) ||
            !existingAdminsSnap.empty;

          if (alreadyLocked) {
            throw new Error('BOOTSTRAP_ALREADY_LOCKED');
          }

          const existingStaff = existingStaffSnap.exists ? existingStaffSnap.data() || {} : null;
          const preservedMfaEnrolled = Boolean(existingStaff?.mfaEnrolled);
          const preservedMfaSecret = String(existingStaff?.mfaEncryptedSecret || '');
          const preservedRecoveryHashes = Array.isArray(existingStaff?.mfaRecoveryHashes)
            ? existingStaff.mfaRecoveryHashes.slice(0, 10)
            : [];
          const createdIso = String(existingStaff?.createdIso || nowIso);

          const rosterDoc = rosterSnap.exists ? rosterSnap.data() || {} : {};
          const addUnique = (arr: unknown, uid: string) =>
            Array.from(new Set([...(Array.isArray(arr) ? arr.map(String) : []), uid])).slice(0, 30);

          const adminUids = addUnique(rosterDoc.adminUids, params.uid);
          const allStaffUids = addUnique(rosterDoc.allStaffUids, params.uid);

          // 1. Write permanent one-time server bootstrap lock
          tx.set(lockRef, {
            id: 'initial_admin',
            bootstrappedAdminUid: params.uid,
            bootstrappedAdminEmail: params.email,
            locked: true,
            source: params.source,
            createdIso: nowIso,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // 2. Write trusted Admin RBAC marker (/admins/{uid})
          tx.set(adminRef, {
            uid: params.uid,
            email: params.email,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // 3. Create or update Admin staff profile (/staff_accounts/{uid})
          tx.set(staffRef, {
            uid: params.uid,
            email: params.email,
            fullName: params.fullName,
            role: 'admin',
            department: String(existingStaff?.department || 'Clinic Administration').slice(0, 80),
            specialty: String(existingStaff?.specialty || '').slice(0, 100),
            titleDisplay: String(existingStaff?.titleDisplay || 'System Administrator').slice(
              0,
              100
            ),
            active: true,
            mfaEnrolled: preservedMfaEnrolled,
            mfaEncryptedSecret: preservedMfaSecret,
            mfaRecoveryHashes: preservedRecoveryHashes,
            authorizedViewerUids: adminUids,
            createdIso,
            createdAt: existingStaff?.createdAt || FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // 4. Create or update clinic roster (/clinic_roster/current)
          tx.set(rosterRef, {
            bootstrappedAdminUid: params.uid,
            adminUids,
            doctorUids: Array.isArray(rosterDoc.doctorUids) ? rosterDoc.doctorUids : [],
            nurseUids: Array.isArray(rosterDoc.nurseUids) ? rosterDoc.nurseUids : [],
            receptionistUids: Array.isArray(rosterDoc.receptionistUids)
              ? rosterDoc.receptionistUids
              : [],
            labUids: Array.isArray(rosterDoc.labUids) ? rosterDoc.labUids : [],
            pharmacistUids: Array.isArray(rosterDoc.pharmacistUids)
              ? rosterDoc.pharmacistUids
              : [],
            allStaffUids,
            createdAt: rosterSnap.exists
              ? rosterDoc.createdAt || FieldValue.serverTimestamp()
              : FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // 5. Seed default coverage settings if not yet initialized
          if (!covSnap.exists) {
            tx.set(coverageRef, {
              id: 'current',
              hmoProvidersAcceptedForManualVerification:
                DEFAULT_COVERAGE_SETTINGS.hmoProvidersAcceptedForManualVerification,
              philHealthAdvisoryNote: DEFAULT_COVERAGE_SETTINGS.philHealthAdvisoryNote,
              requireLoaReferenceForHmo: DEFAULT_COVERAGE_SETTINGS.requireLoaReferenceForHmo,
              defaultGeneralConsultationFeePhp:
                DEFAULT_COVERAGE_SETTINGS.defaultGeneralConsultationFeePhp,
              defaultFollowUpConsultationFeePhp:
                DEFAULT_COVERAGE_SETTINGS.defaultFollowUpConsultationFeePhp,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          // 6. Record immutable security audit trail entry
          const auditId = `AUD-BOOT-${Date.now().toString(36).toUpperCase()}`;
          tx.set(adminDb.collection('audit_logs').doc(auditId), {
            id: auditId,
            actorUid: params.uid,
            actorEmail: params.email.slice(0, 160),
            actorRole: 'admin',
            action: 'INITIAL_ADMIN_BOOTSTRAPPED',
            category: 'Security',
            targetType: 'staff_accounts',
            targetId: params.uid,
            summary: `Activated first System Administrator via Firebase Admin SDK (${params.source}) and permanently locked initial bootstrap.`,
            authorizedViewerUids: adminUids,
            createdIso: nowIso,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          outStaffAccount = {
            uid: params.uid,
            email: params.email,
            fullName: params.fullName,
            role: 'admin',
            department: String(existingStaff?.department || 'Clinic Administration'),
            specialty: String(existingStaff?.specialty || ''),
            titleDisplay: String(existingStaff?.titleDisplay || 'System Administrator'),
            active: true,
            mfaEnrolled: preservedMfaEnrolled,
            mfaEncryptedSecret: preservedMfaSecret,
            mfaRecoveryHashes: preservedRecoveryHashes,
            createdAt: createdIso,
            updatedAt: nowIso,
          };
        });
      } catch (err: any) {
        if (err?.message === 'BOOTSTRAP_ALREADY_LOCKED') {
          return {
            ok: false,
            conflict: true,
            error:
              'One-time System Administrator bootstrap has already been completed and is permanently locked.',
          };
        }
        throw err;
      }

      // Seed default services, guides, and medicine formulary idempotently outside the lock tx
      const [srvCheck, guideCheck, medCheck] = await Promise.all([
        adminDb.collection('clinic_services').limit(1).get(),
        adminDb.collection('patient_guides').limit(1).get(),
        adminDb.collection('medicine_inventory').limit(1).get(),
      ]);

      const seedBatch = adminDb.batch();
      let hasSeedOps = false;
      if (srvCheck.empty) {
        for (const srv of DEFAULT_CLINIC_SERVICES) {
          seedBatch.set(adminDb.collection('clinic_services').doc(srv.id), {
            ...srv,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          hasSeedOps = true;
        }
      }
      if (guideCheck.empty) {
        for (const guide of DEFAULT_PATIENT_GUIDES) {
          seedBatch.set(adminDb.collection('patient_guides').doc(guide.id), {
            ...guide,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          hasSeedOps = true;
        }
      }
      if (medCheck.empty) {
        for (const med of DEFAULT_MEDICINE_INVENTORY) {
          seedBatch.set(adminDb.collection('medicine_inventory').doc(med.id), {
            ...med,
            authorizedViewerUids: [params.uid],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          hasSeedOps = true;
        }
      }
      if (hasSeedOps) {
        await seedBatch.commit();
      }

      return { ok: true, staffAccount: outStaffAccount! };
    },

    async inspectAdminSetup(uid: string): Promise<AdminSetupVerificationReport> {
      const [authUser, adminSnap, staffSnap, rosterSnap, lockSnap] = await Promise.all([
        this.getAuthUserByUid(uid),
        adminDb.collection('admins').doc(uid).get(),
        adminDb.collection('staff_accounts').doc(uid).get(),
        adminDb.collection('clinic_roster').doc('current').get(),
        adminDb.collection('bootstrap_locks').doc('initial_admin').get(),
      ]);

      const staffData = staffSnap.exists ? staffSnap.data() || {} : null;
      const rosterData = rosterSnap.exists ? rosterSnap.data() || {} : null;
      const lockData = lockSnap.exists ? lockSnap.data() || {} : null;

      const checks = {
        authUserExists: Boolean(authUser),
        authUserEnabled: Boolean(authUser && !authUser.disabled),
        emailVerified: Boolean(authUser?.emailVerified),
        hasGoogleProvider: Boolean(authUser?.providers.includes('google.com')),
        customClaimAdmin: Boolean(
          authUser?.customClaims?.role === 'admin' || authUser?.customClaims?.admin === true
        ),
        adminMarkerExists: adminSnap.exists,
        staffProfileAdminActive: Boolean(
          staffData && staffData.role === 'admin' && staffData.active === true
        ),
        rosterIncludesAdmin: Boolean(
          rosterData &&
            Array.isArray(rosterData.adminUids) &&
            rosterData.adminUids.includes(uid)
        ),
        bootstrapLockActive: Boolean(lockSnap.exists && lockData?.locked === true),
      };

      const missingReasons: string[] = [];
      if (!checks.authUserExists) {
        missingReasons.push('UID does not exist in Firebase Authentication.');
      } else {
        if (!checks.authUserEnabled) missingReasons.push('Firebase Auth account is disabled.');
        if (!checks.emailVerified) missingReasons.push('Firebase Auth email is not verified.');
        if (!checks.hasGoogleProvider) {
          missingReasons.push(
            'Google provider (google.com) is not linked on this Firebase Auth account.'
          );
        }
      }
      if (!checks.customClaimAdmin) {
        missingReasons.push('Firebase Auth custom claim (role: "admin") is not set yet.');
      }
      if (!checks.adminMarkerExists) {
        missingReasons.push(`Firestore document /admins/${uid} does not exist.`);
      }
      if (!checks.staffProfileAdminActive) {
        missingReasons.push(
          `Firestore document /staff_accounts/${uid} is missing or not an active admin.`
        );
      }
      if (!checks.rosterIncludesAdmin) {
        missingReasons.push('Firestore /clinic_roster/current does not list this UID in adminUids.');
      }
      if (!checks.bootstrapLockActive) {
        missingReasons.push('Firestore /bootstrap_locks/initial_admin lock is not active.');
      }

      const active =
        checks.authUserExists &&
        checks.authUserEnabled &&
        checks.emailVerified &&
        checks.customClaimAdmin &&
        checks.adminMarkerExists &&
        checks.staffProfileAdminActive &&
        checks.rosterIncludesAdmin &&
        checks.bootstrapLockActive;

      return {
        ok: true,
        active,
        uid,
        projectId: FIREBASE_PROJECT_ID,
        firestoreDatabaseId: FIRESTORE_DATABASE_ID,
        email: authUser?.email || String(staffData?.email || ''),
        fullName: String(staffData?.fullName || authUser?.displayName || ''),
        mfaEnrolled: Boolean(staffData?.mfaEnrolled),
        checks,
        missingReasons,
      };
    },
  };
}

/**
 * Deterministic in-memory repository for fast unit testing via `node:test`.
 */
export function createInMemoryFirebaseAdminRepository(
  seedUsers: Array<FirebaseAuthUserSummary & { idToken?: string }>,
  existingStaffProfiles: StaffAccount[] = []
): FirebaseAdminRepository {
  const usersByUid = new Map<string, FirebaseAuthUserSummary>();
  const uidByToken = new Map<string, string>();
  for (const u of seedUsers) {
    const copy: FirebaseAuthUserSummary = {
      uid: u.uid,
      email: u.email.toLowerCase(),
      emailVerified: u.emailVerified,
      displayName: u.displayName,
      disabled: u.disabled,
      providers: [...u.providers],
      customClaims: { ...u.customClaims },
    };
    usersByUid.set(u.uid, copy);
    if (u.idToken) {
      uidByToken.set(u.idToken, u.uid);
    }
  }

  const adminsCol = new Map<string, { uid: string; email: string }>();
  const staffCol = new Map<string, StaffAccount>();
  for (const s of existingStaffProfiles) {
    staffCol.set(s.uid, { ...s });
  }
  let bootstrapLock: { bootstrappedAdminUid: string; locked: boolean } | null = null;
  let rosterDoc: { bootstrappedAdminUid: string; adminUids: string[]; allStaffUids: string[] } | null =
    null;

  return {
    async verifyIdToken(idToken: string) {
      const uid = uidByToken.get(idToken);
      if (!uid) return null;
      const u = usersByUid.get(uid);
      if (!u || u.disabled) return null;
      return {
        uid: u.uid,
        email: u.email,
        emailVerified: u.emailVerified,
        signInProvider: u.providers.includes('google.com') ? 'google.com' : u.providers[0] || '',
        customClaims: { ...u.customClaims },
      };
    },

    async getAuthUserByUid(uid: string) {
      const u = usersByUid.get(uid);
      return u ? { ...u, providers: [...u.providers], customClaims: { ...u.customClaims } } : null;
    },

    async setAdminCustomClaims(uid: string, claims: Record<string, unknown>) {
      const u = usersByUid.get(uid);
      if (!u) throw new Error('auth/user-not-found');
      u.customClaims = { ...u.customClaims, ...claims };
    },

    async isBootstrapLockedOrHasAdmin() {
      const locked = Boolean(
        bootstrapLock?.locked || rosterDoc?.bootstrappedAdminUid || adminsCol.size > 0
      );
      const bootstrappedAdminUid =
        bootstrapLock?.bootstrappedAdminUid ||
        rosterDoc?.bootstrappedAdminUid ||
        Array.from(adminsCol.keys())[0] ||
        '';
      return { locked, bootstrappedAdminUid };
    },

    async getStaffAccountByUid(uid: string) {
      const s = staffCol.get(uid);
      return s ? { ...s } : null;
    },

    async runAtomicFirstAdminBootstrap(params) {
      const lockCheck = await this.isBootstrapLockedOrHasAdmin();
      if (lockCheck.locked) {
        return {
          ok: false,
          conflict: true,
          error:
            'One-time System Administrator bootstrap has already been completed and is permanently locked.',
        };
      }

      const existing = staffCol.get(params.uid);
      const nowIso = new Date().toISOString();
      const updatedStaff: StaffAccount = {
        uid: params.uid,
        email: params.email,
        fullName: params.fullName,
        role: 'admin',
        department: existing?.department || 'Clinic Administration',
        specialty: existing?.specialty || '',
        titleDisplay: existing?.titleDisplay || 'System Administrator',
        active: true,
        mfaEnrolled: existing?.mfaEnrolled ?? false,
        mfaEncryptedSecret: existing?.mfaEncryptedSecret ?? '',
        mfaRecoveryHashes: existing?.mfaRecoveryHashes ? [...existing.mfaRecoveryHashes] : [],
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      bootstrapLock = { bootstrappedAdminUid: params.uid, locked: true };
      adminsCol.set(params.uid, { uid: params.uid, email: params.email });
      staffCol.set(params.uid, updatedStaff);
      rosterDoc = {
        bootstrappedAdminUid: params.uid,
        adminUids: [params.uid],
        allStaffUids: [params.uid],
      };

      return { ok: true, staffAccount: updatedStaff };
    },

    async inspectAdminSetup(uid: string) {
      const u = usersByUid.get(uid) || null;
      const staff = staffCol.get(uid) || null;
      const checks = {
        authUserExists: Boolean(u),
        authUserEnabled: Boolean(u && !u.disabled),
        emailVerified: Boolean(u?.emailVerified),
        hasGoogleProvider: Boolean(u?.providers.includes('google.com')),
        customClaimAdmin: Boolean(u?.customClaims?.role === 'admin' || u?.customClaims?.admin === true),
        adminMarkerExists: adminsCol.has(uid),
        staffProfileAdminActive: Boolean(staff && staff.role === 'admin' && staff.active),
        rosterIncludesAdmin: Boolean(rosterDoc?.adminUids.includes(uid)),
        bootstrapLockActive: Boolean(bootstrapLock?.locked),
      };
      const missingReasons: string[] = [];
      if (!checks.authUserExists) missingReasons.push('UID does not exist in Firebase Authentication.');
      if (!checks.customClaimAdmin) missingReasons.push('Custom claim role=admin missing.');
      if (!checks.adminMarkerExists) missingReasons.push('Admin marker missing.');
      if (!checks.staffProfileAdminActive) missingReasons.push('Staff profile missing or inactive.');
      if (!checks.rosterIncludesAdmin) missingReasons.push('Clinic roster missing UID.');
      if (!checks.bootstrapLockActive) missingReasons.push('Bootstrap lock inactive.');

      return {
        ok: true,
        active:
          checks.authUserExists &&
          checks.authUserEnabled &&
          checks.emailVerified &&
          checks.customClaimAdmin &&
          checks.adminMarkerExists &&
          checks.staffProfileAdminActive &&
          checks.rosterIncludesAdmin &&
          checks.bootstrapLockActive,
        uid,
        projectId: FIREBASE_PROJECT_ID,
        firestoreDatabaseId: FIRESTORE_DATABASE_ID,
        email: u?.email || staff?.email || '',
        fullName: staff?.fullName || u?.displayName || '',
        mfaEnrolled: Boolean(staff?.mfaEnrolled),
        checks,
        missingReasons,
      };
    },
  };
}

export function createFirebaseAdminBootstrapController(deps: {
  repo: FirebaseAdminRepository;
  getDesignatedAdminUid: () => string;
}) {
  const { repo, getDesignatedAdminUid } = deps;

  return {
    async getStaffSessionStatus(idToken: string) {
      const decoded = await repo.verifyIdToken(idToken);
      if (!decoded) {
        return {
          status: 401,
          body: { ok: false, error: 'Valid Firebase Authentication ID token is required.' },
        };
      }

      const [lockState, staffAccount] = await Promise.all([
        repo.isBootstrapLockedOrHasAdmin(),
        repo.getStaffAccountByUid(decoded.uid),
      ]);

      const designatedUid = (getDesignatedAdminUid() || '').trim();
      const bootstrapArmed = isValidFirebaseUid(designatedUid);
      const canBootstrapCurrentUser =
        !lockState.locked &&
        bootstrapArmed &&
        decoded.emailVerified &&
        constantTimeUidEqual(decoded.uid, designatedUid);

      return {
        status: 200,
        body: {
          ok: true,
          uid: decoded.uid,
          email: decoded.email,
          emailVerified: decoded.emailVerified,
          signInProvider: decoded.signInProvider,
          bootstrapLocked: lockState.locked,
          bootstrapArmed,
          canBootstrapCurrentUser,
          staffAccount,
        },
      };
    },

    /**
     * Trusted server-side endpoint handler: verifies caller's Firebase ID token,
     * enforces exact constant-time match against FIREBASE_INITIAL_ADMIN_UID,
     * never creates a new Firebase user, and runs the atomic one-time Admin bootstrap.
     */
    async bootstrapFirstAdminFromHttp(params: { idToken: string; fullName?: string }) {
      const decoded = await repo.verifyIdToken(params.idToken);
      if (!decoded) {
        return {
          status: 401,
          body: { ok: false, error: 'Valid Firebase Authentication ID token is required.' },
        };
      }
      if (!decoded.emailVerified) {
        return {
          status: 403,
          body: { ok: false, error: 'Firebase account email must be verified before bootstrap.' },
        };
      }

      const lockState = await repo.isBootstrapLockedOrHasAdmin();
      if (lockState.locked) {
        return {
          status: 409,
          body: {
            ok: false,
            bootstrapLocked: true,
            error:
              'One-time System Administrator bootstrap has already been completed and is permanently disabled.',
          },
        };
      }

      const designatedUid = (getDesignatedAdminUid() || '').trim();
      if (!isValidFirebaseUid(designatedUid)) {
        return {
          status: 403,
          body: {
            ok: false,
            error:
              'Server bootstrap is not armed. Set FIREBASE_INITIAL_ADMIN_UID in server secrets or run the one-time CLI bootstrap script.',
          },
        };
      }

      // CRITICAL: Never assign Admin simply because someone is first to log in!
      if (!constantTimeUidEqual(decoded.uid, designatedUid)) {
        return {
          status: 403,
          body: {
            ok: false,
            error:
              'Forbidden: Authenticated Firebase UID does not match the designated FIREBASE_INITIAL_ADMIN_UID.',
          },
        };
      }

      return this.bootstrapFirstAdminByUid({
        targetUid: decoded.uid,
        fullNameOverride: params.fullName,
        source: 'server-endpoint',
      });
    },

    /**
     * Trusted CLI / server-side execution by explicit Firebase Auth UID.
     * Verifies the existing Firebase Auth account without creating a new user,
     * sets custom claims, creates/updates the Firestore Admin staff profile,
     * and permanently locks initial bootstrap.
     */
    async bootstrapFirstAdminByUid(params: {
      targetUid: string;
      fullNameOverride?: string;
      source: 'cli-script' | 'server-endpoint';
    }) {
      const cleanUid = (params.targetUid || '').trim();
      if (!isValidFirebaseUid(cleanUid)) {
        return {
          status: 400,
          body: {
            ok: false,
            error:
              'Invalid Firebase Auth UID format. Expected 6-128 alphanumeric, hyphen, or underscore characters.',
          },
        };
      }

      const preLock = await repo.isBootstrapLockedOrHasAdmin();
      if (preLock.locked) {
        return {
          status: 409,
          body: {
            ok: false,
            bootstrapLocked: true,
            error:
              'One-time System Administrator bootstrap has already been completed and is permanently locked.',
          },
        };
      }

      // Must already exist in Firebase Authentication — NEVER create a new Firebase account!
      const authUser = await repo.getAuthUserByUid(cleanUid);
      if (!authUser) {
        return {
          status: 404,
          body: {
            ok: false,
            error: `No existing Firebase Authentication user found for UID "${cleanUid}". Confirm the copied UID in Firebase Console -> Authentication -> Users.`,
          },
        };
      }
      if (authUser.disabled) {
        return {
          status: 403,
          body: {
            ok: false,
            error: `Firebase Authentication user "${cleanUid}" is currently disabled.`,
          },
        };
      }
      if (!authUser.email || !authUser.emailVerified) {
        return {
          status: 403,
          body: {
            ok: false,
            error: `Firebase Authentication user "${cleanUid}" must have a verified email address (Google Sign-In accounts are verified automatically).`,
          },
        };
      }

      const resolvedName = (
        params.fullNameOverride?.trim() ||
        authUser.displayName?.trim() ||
        'System Administrator'
      ).slice(0, 120);

      const txResult = await repo.runAtomicFirstAdminBootstrap({
        uid: authUser.uid,
        email: authUser.email,
        fullName: resolvedName,
        source: params.source,
      });

      if (!txResult.ok) {
        return {
          status: txResult.conflict ? 409 : 400,
          body: {
            ok: false,
            bootstrapLocked: txResult.conflict,
            error: txResult.error,
          },
        };
      }

      // Assign Firebase Admin custom claims for backend authorization verification
      await repo.setAdminCustomClaims(authUser.uid, {
        role: 'admin',
        admin: true,
      });

      const verification = await repo.inspectAdminSetup(authUser.uid);

      return {
        status: 200,
        body: {
          ok: true,
          bootstrapLocked: true,
          staffAccount: txResult.staffAccount,
          verification,
        },
      };
    },

    async verifyAdminSetup(targetUid: string) {
      const cleanUid = (targetUid || '').trim();
      if (!isValidFirebaseUid(cleanUid)) {
        return {
          status: 400,
          body: {
            ok: false,
            active: false,
            error: 'Invalid Firebase Auth UID format.',
          },
        };
      }
      const report = await repo.inspectAdminSetup(cleanUid);
      return {
        status: report.active ? 200 : 412,
        body: report,
      };
    },
  };
}
