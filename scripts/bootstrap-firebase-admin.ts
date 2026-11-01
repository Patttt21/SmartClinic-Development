/**
 * One-Time System Administrator Bootstrap & Verification CLI Script
 * Uses the trusted server-side Firebase Admin SDK against SmartClinic's
 * Firebase Authentication and named Cloud Firestore database.
 *
 * Usage (Run locally or in Cloud Shell — never paste credentials in chat):
 *   1. Export server credentials + your copied Firebase Auth UID:
 *      export GOOGLE_APPLICATION_CREDENTIALS="/secure/path/to/service-account.json"
 *      export FIREBASE_INITIAL_ADMIN_UID="<YOUR_COPIED_FIREBASE_UID>"
 *
 *   2. Execute the one-time bootstrap:
 *      npm run bootstrap:admin
 *      (Optional display name override: npm run bootstrap:admin -- --name "Your Full Name")
 *
 *   3. Re-verify anytime without modifying data:
 *      npm run bootstrap:admin:verify
 */

import dotenv from 'dotenv';
import {
  createFirebaseAdminBootstrapController,
  createLiveFirebaseAdminRepository,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  hasExplicitFirebaseAdminCredentials,
  isValidFirebaseUid,
} from '../src/utils/firebaseAdminBackend.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

interface CliOptions {
  uid: string;
  fullName?: string;
  verifyOnly: boolean;
}

function parseCliArgs(argv: string[]): CliOptions {
  let uid = (process.env.FIREBASE_INITIAL_ADMIN_UID || '').trim();
  let fullName: string | undefined;
  let verifyOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verify' || arg === '--check') {
      verifyOnly = true;
    } else if (arg === '--uid' && argv[i + 1]) {
      uid = argv[++i].trim();
    } else if (arg.startsWith('--uid=')) {
      uid = arg.slice('--uid='.length).trim();
    } else if (arg === '--name' && argv[i + 1]) {
      fullName = argv[++i].trim();
    } else if (arg.startsWith('--name=')) {
      fullName = arg.slice('--name='.length).trim();
    }
  }

  return { uid, fullName, verifyOnly };
}

function printMissingSetupGuide(missingUid: boolean, missingCreds: boolean) {
  console.error('\n[SmartClinic Bootstrap] Pre-flight check failed — no changes were made.\n');
  console.error(`Target Firebase Project ID : ${FIREBASE_PROJECT_ID}`);
  console.error(`Target Firestore Database  : ${FIRESTORE_DATABASE_ID}\n`);

  if (missingUid) {
    console.error('  [x] Missing target Firebase Auth UID.');
    console.error('      Supply FIREBASE_INITIAL_ADMIN_UID in your shell/.env.local or pass --uid <UID>.');
  }
  if (missingCreds) {
    console.error('  [x] Missing Firebase Admin SDK credentials.');
    console.error('      Provide ONE of the following in your private terminal environment:');
    console.error('        - GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"');
    console.error('        - FIREBASE_SERVICE_ACCOUNT_JSON=\'{...}\' (or FIREBASE_SERVICE_ACCOUNT_BASE64)');
    console.error('        - FIREBASE_USE_ADC="true" (after running `gcloud auth application-default login`)\n');
  }
  console.error('Security Reminder: Never commit service account files or paste private keys into chat.\n');
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const validUid = isValidFirebaseUid(opts.uid);
  const hasCreds = hasExplicitFirebaseAdminCredentials();

  if (!validUid || !hasCreds) {
    printMissingSetupGuide(!validUid, !hasCreds);
    process.exit(1);
  }

  const repo = createLiveFirebaseAdminRepository();
  const controller = createFirebaseAdminBootstrapController({
    repo,
    getDesignatedAdminUid: () => opts.uid,
  });

  if (opts.verifyOnly) {
    console.log(`\n[SmartClinic Verify] Inspecting Admin setup for UID: ${opts.uid}`);
    console.log(`  Project ID         : ${FIREBASE_PROJECT_ID}`);
    console.log(`  Firestore Database : ${FIRESTORE_DATABASE_ID}\n`);

    const checkRes = await controller.verifyAdminSetup(opts.uid);
    const body = checkRes.body as any;
    if (!body.ok) {
      console.error(`[FAIL] ${body.error}`);
      process.exit(1);
    }

    for (const [key, passed] of Object.entries(body.checks || {})) {
      console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${key}`);
    }

    if (body.active) {
      console.log(`\n[VERIFIED ACTIVE] System Administrator (${body.email}) is active.`);
      console.log(
        `  TOTP 2FA Enrolled  : ${body.mfaEnrolled ? 'Yes' : 'Pending first sign-in enrollment at /staff/login'}`
      );
      console.log('  Sign-In Route      : /staff/login (Sign In with Verified Staff Google Account)');
      console.log('  Redirect Target    : /staff/admin/dashboard\n');
      process.exit(0);
    } else {
      console.error('\n[NOT YET ACTIVE] Missing requirements:');
      for (const reason of body.missingReasons || []) {
        console.error(`  - ${reason}`);
      }
      process.exit(1);
    }
  }

  console.log(`\n[SmartClinic Bootstrap] Running one-time Firebase Admin SDK bootstrap...`);
  console.log(`  Project ID         : ${FIREBASE_PROJECT_ID}`);
  console.log(`  Firestore Database : ${FIRESTORE_DATABASE_ID}`);
  console.log(`  Target User UID    : ${opts.uid}\n`);

  const res = await controller.bootstrapFirstAdminByUid({
    targetUid: opts.uid,
    fullNameOverride: opts.fullName,
    source: 'cli-script',
  });

  if (res.status !== 200 || !res.body.ok) {
    console.error(`[ABORTED - HTTP ${res.status}] ${res.body.error}\n`);
    process.exit(1);
  }

  const verification = (res.body as any).verification;
  if (!verification?.active) {
    console.error('[ERROR] Bootstrap transaction ran, but post-write verification did not pass:');
    for (const reason of verification?.missingReasons || []) {
      console.error(`  - ${reason}`);
    }
    process.exit(1);
  }

  console.log('[SUCCESS] First System Administrator activated and verified:');
  console.log(`  Admin Email        : ${verification.email}`);
  console.log(`  Admin Full Name    : ${verification.fullName}`);
  console.log(`  Custom Claims      : { role: "admin", admin: true }`);
  console.log(`  Firestore Marker   : /admins/${opts.uid}`);
  console.log(`  Staff Profile      : /staff_accounts/${opts.uid} (role="admin", active=true)`);
  console.log(`  Bootstrap Lock     : /bootstrap_locks/initial_admin (permanently locked)`);
  console.log('\nNext Step:');
  console.log(
    '  Open /staff/login -> click "Sign In with Verified Staff Google Account" -> complete mandatory Authenticator-App TOTP 2FA -> automatic redirect to /staff/admin/dashboard.\n'
  );
}

main().catch((err: any) => {
  console.error('\n[SmartClinic Bootstrap Fatal Error]:', err?.message || err);
  process.exit(1);
});
