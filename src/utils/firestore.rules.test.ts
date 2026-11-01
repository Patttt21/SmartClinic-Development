import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const draftPath = path.resolve(process.cwd(), 'DRAFT_firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

function loadRulesText(): string {
  if (fs.existsSync(rulesPath)) return fs.readFileSync(rulesPath, 'utf8');
  return fs.readFileSync(draftPath, 'utf8');
}

test('Firestore rules cover every collection in firebase-blueprint.json and enforce Global Default-Deny', () => {
  const rules = loadRulesText();
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  assert.match(rules, /rules_version\s*=\s*'2';/);
  assert.match(rules, /match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);

  const collectionPaths = Object.keys(blueprint.firestore || {});
  assert.ok(collectionPaths.length >= 25);

  for (const colPath of collectionPaths) {
    const collectionName = colPath.split('/')[1];
    assert.ok(
      rules.includes(`match /${collectionName}/`),
      `Expected match block for collection /${collectionName}/ in firestore.rules`
    );
  }
});

test('Dirty Dozen Red Team Audit: Zero get()/exists() in allow list blocks, no blanket reads, strict PII & clinical isolation', () => {
  const rules = loadRulesText();

  // Extract all allow list lines
  const listLines = rules
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('allow list:'));

  assert.ok(listLines.length >= 20);
  for (const line of listLines) {
    // Pillar 8 Cost-Optimization & Query Enforcer
    assert.equal(line.includes('get('), false, `Forbidden get() in allow list: ${line}`);
    assert.equal(line.includes('exists('), false, `Forbidden exists() in allow list: ${line}`);
    assert.notEqual(
      line,
      'allow list: if isSignedIn();',
      `Forbidden blanket list rule: ${line}`
    );
  }

  // Dirty Dozen #2: Email spoofing guard requires email_verified == true
  assert.match(rules, /request\.auth\.token\.email_verified\s*==\s*true/);

  // Dirty Dozen #5: patient_accounts forbids list completely
  const patientAcctBlock = rules.split('match /patient_accounts/{userId}')[1].split('match /patients/')[0];
  assert.match(patientAcctBlock, /allow list:\s*if false;/);

  // Dirty Dozen #6: Admin is NOT granted get access on confidential consultations or nursing_assessments
  const consultBlock = rules.split('match /consultations/{visitId}')[1].split('match /lab_orders/')[0];
  assert.equal(consultBlock.includes('isAdmin()'), false, 'Admin must not have automatic read access to confidential consultation notes');

  const nurseBlock = rules.split('match /nursing_assessments/{visitId}')[1].split('match /consultations/')[0];
  assert.equal(nurseBlock.includes('isAdmin()'), false, 'Admin must not have automatic read access to confidential nursing assessments');

  // Dirty Dozen #8: Patient lab_orders read strictly checks Released status & patientVisible
  const labBlock = rules.split('match /lab_orders/{orderId}')[1].split('match /prescriptions/')[0];
  assert.match(labBlock, /existing\(\)\.status\s*==\s*'Released'/);

  // Dirty Dozen #10 & #12: Temporal integrity & immutable audit_logs
  assert.match(rules, /incoming\(\)\.createdAt\s*==\s*request\.time/);
  assert.match(rules, /incoming\(\)\.updatedAt\s*==\s*request\.time/);
  const auditBlock = rules.split('match /audit_logs/{logId}')[1];
  assert.match(auditBlock, /allow update:\s*if false;/);
  assert.match(auditBlock, /allow delete:\s*if false;/);

  // Staff Portal RBAC Hardening: Initial Administrator bootstrap strictly requires isBootstrapOwner()
  const adminsBlock = rules.split('match /admins/{adminUid}')[1].split('match /clinic_roster/')[0];
  assert.match(adminsBlock, /isBootstrapOwner\(\)\s*&&\s*!exists\(\/databases\/\$\(database\)\/documents\/clinic_roster\/current\)/);

  const rosterBlock = rules.split('match /clinic_roster/{docId}')[1].split('match /staff_accounts/')[0];
  assert.match(rosterBlock, /isBootstrapOwner\(\)\s*&&\s*!exists\(\/databases\/\$\(database\)\/documents\/clinic_roster\/current\)/);

  const staffAcctBlock = rules.split('match /staff_accounts/{staffUid}')[1].split('match /staff_invitations/')[0];
  assert.match(staffAcctBlock, /isBootstrapOwner\(\)\s*&&\s*!exists\(\/databases\/\$\(database\)\/documents\/clinic_roster\/current\)/);

  // Staff Invitation RE2-safe emailToInviteId helper (must not use unescaped '.' regex)
  assert.match(rules, /function emailToInviteId\(email\)/);
  assert.equal(rules.includes(".replace('.', '_')"), false, 'Must not use unescaped RE2 wildcard dot in Firestore rules');
});

