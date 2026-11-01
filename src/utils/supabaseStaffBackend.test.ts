import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constantTimeUuidEqual,
  createInMemorySupabaseStaffRepository,
  createSupabaseStaffController,
  isValidUuid,
} from './supabaseStaffBackend';
import { generateTotpCode } from './totp';

const DESIGNATED_ADMIN_UID = 'b9f56c12-43d9-4f72-9e10-8a1c3f55d901';
const INTRUDER_UID = '11111111-2222-4333-8444-555555555555';
const UNVERIFIED_ADMIN_UID = 'b9f56c12-43d9-4f72-9e10-8a1c3f55d901';
const SERVER_SECRET = 'unit-test-supabase-server-secret-32bytes';

test('UUID validation and constant-time UUID comparison prevent partial or malformed matches', () => {
  assert.equal(isValidUuid(DESIGNATED_ADMIN_UID), true);
  assert.equal(isValidUuid('not-a-uuid'), false);
  assert.equal(
    constantTimeUuidEqual(DESIGNATED_ADMIN_UID, DESIGNATED_ADMIN_UID.toUpperCase()),
    true
  );
  assert.equal(constantTimeUuidEqual(DESIGNATED_ADMIN_UID, INTRUDER_UID), false);
});

test('Trusted one-time server-side bootstrap verifies exact Supabase Auth User ID, ignores spoofed metadata, and permanently disables itself after initial setup', async () => {
  const repo = createInMemorySupabaseStaffRepository([
    {
      token: 'tok-intruder',
      id: INTRUDER_UID,
      email: 'attacker@clinic.ph',
      emailVerified: true,
      spoofedUserMetadata: { role: 'admin', is_admin: true },
    },
    {
      token: 'tok-unverified-owner',
      id: UNVERIFIED_ADMIN_UID,
      email: 'owner@clinic.ph',
      emailVerified: false,
    },
    {
      token: 'tok-verified-owner',
      id: DESIGNATED_ADMIN_UID,
      email: 'owner@clinic.ph',
      emailVerified: true,
    },
  ]);

  const controller = createSupabaseStaffController({
    repo,
    getInitialAdminUid: () => DESIGNATED_ADMIN_UID,
    serverSecret: SERVER_SECRET,
  });

  // 1. Unauthenticated request is rejected (401)
  const unauthRes = await controller.bootstrapFirstAdmin({
    accessToken: 'invalid-jwt',
    fullName: 'Fake Admin',
  });
  assert.equal(unauthRes.status, 401);

  // 2. Spoofed user_metadata intruder with wrong Supabase Auth User ID is rejected (403)
  const intruderStatus = await controller.getSessionStatus('tok-intruder');
  assert.equal(intruderStatus.body.canBootstrapCurrentUser, false);

  const intruderBootstrap = await controller.bootstrapFirstAdmin({
    accessToken: 'tok-intruder',
    fullName: 'Intruder Admin',
  });
  assert.equal(intruderBootstrap.status, 403);

  // 3. Unverified email even for matching UID is rejected (403)
  const unverifiedBootstrap = await controller.bootstrapFirstAdmin({
    accessToken: 'tok-unverified-owner',
    fullName: 'Owner Unverified',
  });
  assert.equal(unverifiedBootstrap.status, 403);

  // 4. Verified designated Supabase Auth User ID succeeds ONCE
  const preStatus = await controller.getSessionStatus('tok-verified-owner');
  assert.equal(preStatus.body.canBootstrapCurrentUser, true);
  assert.equal(preStatus.body.bootstrapLocked, false);

  const validBootstrap = await controller.bootstrapFirstAdmin({
    accessToken: 'tok-verified-owner',
    fullName: 'Patrick Cervito',
  });
  assert.equal(validBootstrap.status, 200);
  assert.equal(validBootstrap.body.bootstrapLocked, true);
  assert.equal(validBootstrap.body.staffAccount?.role, 'admin');
  assert.equal(validBootstrap.body.staffAccount?.mfaEnrolled, false);

  // 5. Bootstrap mechanism is permanently disabled afterwards (even for the same UID)
  const postStatus = await controller.getSessionStatus('tok-verified-owner');
  assert.equal(postStatus.body.bootstrapLocked, true);
  assert.equal(postStatus.body.canBootstrapCurrentUser, false);

  const repeatBootstrap = await controller.bootstrapFirstAdmin({
    accessToken: 'tok-verified-owner',
    fullName: 'Patrick Cervito Again',
  });
  assert.equal(repeatBootstrap.status, 403);
  assert.equal(repeatBootstrap.body.bootstrapLocked, true);
});

test('Bootstrapped Admin must complete Authenticator-App TOTP 2FA before accessing Staff Management and can create all 5 clinical/front-desk roles', async () => {
  const repo = createInMemorySupabaseStaffRepository([
    {
      token: 'tok-admin',
      id: DESIGNATED_ADMIN_UID,
      email: 'admin@smartclinic.ph',
      emailVerified: true,
    },
  ]);

  const controller = createSupabaseStaffController({
    repo,
    getInitialAdminUid: () => DESIGNATED_ADMIN_UID,
    serverSecret: SERVER_SECRET,
  });

  await controller.bootstrapFirstAdmin({
    accessToken: 'tok-admin',
    fullName: 'System Administrator',
  });

  // 1. Admin cannot list or create staff BEFORE enrolling and verifying TOTP 2FA
  const blockedList = await controller.listStaffAccounts({
    accessToken: 'tok-admin',
    mfaAssuranceToken: '',
  });
  assert.equal(blockedList.status, 403);

  // 2. Enroll Authenticator-App TOTP & verify 6-digit code
  const setupRes = await controller.setupTotpEnrollment({ accessToken: 'tok-admin' });
  assert.equal(setupRes.status, 200);
  assert.ok(setupRes.body.manualSecretKey);
  assert.ok(setupRes.body.qrDataUrl?.startsWith('data:image/png;base64,'));

  const fixedNow = Date.now();
  const validCode = generateTotpCode(setupRes.body.manualSecretKey!, fixedNow);

  const confirmRes = await controller.confirmTotpEnrollment({
    accessToken: 'tok-admin',
    encryptedSecret: setupRes.body.encryptedSecret!,
    recoveryHashes: setupRes.body.recoveryHashes!,
    code: validCode,
    nowMs: fixedNow,
  });
  assert.equal(confirmRes.status, 200);
  const adminMfaToken = confirmRes.body.assuranceToken!;
  assert.ok(adminMfaToken);

  // 3. Create accounts for Doctor, Nurse, Receptionist, Laboratory Technician, and Pharmacist
  const rolesToCreate = [
    {
      role: 'doctor' as const,
      email: 'doctor1@smartclinic.ph',
      fullName: 'Dr. Elena Santos',
      department: 'Outpatient Medicine',
      specialty: 'Internal Medicine',
      titleDisplay: 'Attending Physician',
    },
    {
      role: 'nurse' as const,
      email: 'nurse1@smartclinic.ph',
      fullName: 'Camille Cruz, RN',
      department: 'Outpatient Nursing & Triage',
      specialty: '',
      titleDisplay: 'Registered Triage Nurse',
    },
    {
      role: 'receptionist' as const,
      email: 'reception1@smartclinic.ph',
      fullName: 'Paolo Mendoza',
      department: 'Front Desk & Billing',
      specialty: '',
      titleDisplay: 'Clinic Receptionist',
    },
    {
      role: 'laboratory' as const,
      email: 'lab1@smartclinic.ph',
      fullName: 'Andrea Lim, RMT',
      department: 'Clinical Laboratory',
      specialty: '',
      titleDisplay: 'Registered Medical Technologist',
    },
    {
      role: 'pharmacist' as const,
      email: 'pharmacy1@smartclinic.ph',
      fullName: 'Rafael Aquino, RPh',
      department: 'Outpatient Pharmacy',
      specialty: '',
      titleDisplay: 'Licensed Clinic Pharmacist',
    },
  ];

  let createdDoctorUid = '';
  for (const item of rolesToCreate) {
    const createRes = await controller.createStaffAccount({
      accessToken: 'tok-admin',
      mfaAssuranceToken: adminMfaToken,
      email: item.email,
      password: 'TempClinicPass#2026',
      fullName: item.fullName,
      role: item.role,
      department: item.department,
      specialty: item.specialty,
      titleDisplay: item.titleDisplay,
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.staffAccount?.role, item.role);
    assert.equal(createRes.body.staffAccount?.mfaEnrolled, false);
    if (item.role === 'doctor') {
      createdDoctorUid = createRes.body.staffAccount!.uid;
    }
  }

  const listAfter = await controller.listStaffAccounts({
    accessToken: 'tok-admin',
    mfaAssuranceToken: adminMfaToken,
  });
  assert.equal(listAfter.status, 200);
  assert.equal(listAfter.body.staffAccounts?.length, 6); // 1 Admin + 5 created staff roles

  // 4. Verify non-admin staff (e.g. Doctor even after TOTP enrollment) is forbidden from Staff Management
  const docSetup = await controller.setupTotpEnrollment({
    accessToken: `tok-${createdDoctorUid}`,
  });
  const docCode = generateTotpCode(docSetup.body.manualSecretKey!, fixedNow);
  const docConfirm = await controller.confirmTotpEnrollment({
    accessToken: `tok-${createdDoctorUid}`,
    encryptedSecret: docSetup.body.encryptedSecret!,
    recoveryHashes: docSetup.body.recoveryHashes!,
    code: docCode,
    nowMs: fixedNow,
  });
  assert.equal(docConfirm.status, 200);

  const doctorAdminAttempt = await controller.listStaffAccounts({
    accessToken: `tok-${createdDoctorUid}`,
    mfaAssuranceToken: docConfirm.body.assuranceToken!,
  });
  assert.equal(doctorAdminAttempt.status, 403);

  // 5. Verify primary bootstrapped Admin cannot be deactivated or demoted
  const demotePrimary = await controller.updateStaffAccount({
    accessToken: 'tok-admin',
    mfaAssuranceToken: adminMfaToken,
    targetUid: DESIGNATED_ADMIN_UID,
    role: 'receptionist',
    department: 'Front Desk',
    specialty: '',
    titleDisplay: 'Receptionist',
    active: false,
  });
  assert.equal(demotePrimary.status, 400);
});
