import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constantTimeUidEqual,
  createFirebaseAdminBootstrapController,
  createInMemoryFirebaseAdminRepository,
  isValidFirebaseUid,
} from './firebaseAdminBackend';

const CHOSEN_GOOGLE_ADMIN_UID = 'gAuthUid_FirstAdmin_998877';
const RANDOM_FIRST_VISITOR_UID = 'gAuthUid_RandomVisitor_112233';

test('Firebase UID validator and constant-time comparison reject malformed or mismatched UIDs', () => {
  assert.equal(isValidFirebaseUid(CHOSEN_GOOGLE_ADMIN_UID), true);
  assert.equal(isValidFirebaseUid(''), false);
  assert.equal(isValidFirebaseUid('short'), false);
  assert.equal(isValidFirebaseUid('bad/slash/uid'), false);

  assert.equal(constantTimeUidEqual(CHOSEN_GOOGLE_ADMIN_UID, CHOSEN_GOOGLE_ADMIN_UID), true);
  assert.equal(constantTimeUidEqual(RANDOM_FIRST_VISITOR_UID, CHOSEN_GOOGLE_ADMIN_UID), false);
  assert.equal(
    constantTimeUidEqual(CHOSEN_GOOGLE_ADMIN_UID.slice(0, 14), CHOSEN_GOOGLE_ADMIN_UID),
    false
  );
});

test('Never assigns Admin to the first person who logs in unless their verified UID matches FIREBASE_INITIAL_ADMIN_UID', async () => {
  const repo = createInMemoryFirebaseAdminRepository([
    {
      uid: RANDOM_FIRST_VISITOR_UID,
      email: 'someone.else@gmail.com',
      emailVerified: true,
      displayName: 'Random First Visitor',
      disabled: false,
      providers: ['google.com'],
      customClaims: {},
      idToken: 'idtok-random-visitor',
    },
    {
      uid: CHOSEN_GOOGLE_ADMIN_UID,
      email: 'cervitopatrick0@gmail.com',
      emailVerified: true,
      displayName: 'Patrick Cervito',
      disabled: false,
      providers: ['google.com'],
      customClaims: {},
      idToken: 'idtok-chosen-admin',
    },
  ]);

  const controller = createFirebaseAdminBootstrapController({
    repo,
    getDesignatedAdminUid: () => CHOSEN_GOOGLE_ADMIN_UID,
  });

  // 1. Random first user signs in first — session status MUST show canBootstrapCurrentUser = false
  const randomSession = await controller.getStaffSessionStatus('idtok-random-visitor');
  assert.equal(randomSession.status, 200);
  assert.equal(randomSession.body.canBootstrapCurrentUser, false);

  // 2. Random first user attempts POST /api/firebase/bootstrap-admin — MUST be rejected (403)
  const randomAttempt = await controller.bootstrapFirstAdminFromHttp({
    idToken: 'idtok-random-visitor',
    fullName: 'Attacker',
  });
  assert.equal(randomAttempt.status, 403);

  // 3. Non-existent Firebase UID via CLI — MUST return 404 without creating a new Firebase account
  const missingUidAttempt = await controller.bootstrapFirstAdminByUid({
    targetUid: 'nonExistentFirebaseUid_0001',
    source: 'cli-script',
  });
  assert.equal(missingUidAttempt.status, 404);

  // 4. Before running bootstrap, verification reports active = false
  const preVerify = await controller.verifyAdminSetup(CHOSEN_GOOGLE_ADMIN_UID);
  assert.equal(preVerify.status, 412);
  assert.equal(preVerify.body.active, false);

  // 5. Chosen Google account UID runs one-time bootstrap — succeeds (200), sets custom claims & Firestore profile
  const okBootstrap = await controller.bootstrapFirstAdminFromHttp({
    idToken: 'idtok-chosen-admin',
    fullName: 'Patrick Cervito',
  });
  assert.equal(okBootstrap.status, 200);
  assert.equal(okBootstrap.body.ok, true);
  assert.equal((okBootstrap.body as any).staffAccount.uid, CHOSEN_GOOGLE_ADMIN_UID);
  assert.equal((okBootstrap.body as any).staffAccount.role, 'admin');
  assert.equal((okBootstrap.body as any).staffAccount.active, true);

  // 6. Post-bootstrap verification passes all checks (Auth + Google provider + Custom Claims + Firestore + Lock)
  const postVerify = await controller.verifyAdminSetup(CHOSEN_GOOGLE_ADMIN_UID);
  assert.equal(postVerify.status, 200);
  assert.equal(postVerify.body.active, true);
  if ('checks' in postVerify.body) {
    assert.equal(postVerify.body.checks.customClaimAdmin, true);
    assert.equal(postVerify.body.checks.adminMarkerExists, true);
    assert.equal(postVerify.body.checks.staffProfileAdminActive, true);
    assert.equal(postVerify.body.checks.rosterIncludesAdmin, true);
    assert.equal(postVerify.body.checks.bootstrapLockActive, true);
  }

  // 7. Second bootstrap attempt is permanently rejected with 409 Conflict
  const secondAttemptHttp = await controller.bootstrapFirstAdminFromHttp({
    idToken: 'idtok-chosen-admin',
  });
  assert.equal(secondAttemptHttp.status, 409);

  const secondAttemptCli = await controller.bootstrapFirstAdminByUid({
    targetUid: CHOSEN_GOOGLE_ADMIN_UID,
    source: 'cli-script',
  });
  assert.equal(secondAttemptCli.status, 409);
});

test('Updating an existing Firestore staff profile during first-admin bootstrap preserves enrolled TOTP MFA state', async () => {
  const repo = createInMemoryFirebaseAdminRepository(
    [
      {
        uid: CHOSEN_GOOGLE_ADMIN_UID,
        email: 'cervitopatrick0@gmail.com',
        emailVerified: true,
        displayName: 'Patrick Cervito',
        disabled: false,
        providers: ['google.com'],
        customClaims: {},
      },
    ],
    [
      {
        uid: CHOSEN_GOOGLE_ADMIN_UID,
        email: 'cervitopatrick0@gmail.com',
        fullName: 'Patrick Cervito',
        role: 'receptionist',
        department: 'Front Desk',
        specialty: '',
        titleDisplay: 'Staff',
        active: true,
        mfaEnrolled: true,
        mfaEncryptedSecret: 'enc-totp-secret-v1',
        mfaRecoveryHashes: ['hash1', 'hash2'],
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ]
  );

  const controller = createFirebaseAdminBootstrapController({
    repo,
    getDesignatedAdminUid: () => CHOSEN_GOOGLE_ADMIN_UID,
  });

  const res = await controller.bootstrapFirstAdminByUid({
    targetUid: CHOSEN_GOOGLE_ADMIN_UID,
    source: 'cli-script',
  });
  assert.equal(res.status, 200);
  const staff = (res.body as any).staffAccount;
  assert.equal(staff.role, 'admin');
  assert.equal(staff.active, true);
  assert.equal(staff.mfaEnrolled, true);
  assert.equal(staff.mfaEncryptedSecret, 'enc-totp-secret-v1');
});
