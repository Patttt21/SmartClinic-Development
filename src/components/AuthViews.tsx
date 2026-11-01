import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  MailCheck,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import type { PatientPortalAccount } from '../types/clinic';

interface PatientAuthViewProps {
  mode: 'login' | 'register';
  onNavigate: (path: string) => void;
}

export const PatientAuthView: React.FC<PatientAuthViewProps> = ({ mode, onNavigate }) => {
  const {
    firebaseUser,
    patientAccount,
    staffAccount,
    signInWithGoogleAction,
    signInWithEmailAction,
    registerPatientEmailAction,
    completePatientProfileSetup,
    resendEmailVerificationAction,
    refreshEmailVerificationStatus,
    logoutAction,
  } = useClinic();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState<PatientPortalAccount['sex']>('Female');
  const [createFreshRecord, setCreateFreshRecord] = useState(true);
  const [patientMfaCode, setPatientMfaCode] = useState('');
  const [patientMfaPassed, setPatientMfaPassed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [emailProviderDisabledHint, setEmailProviderDisabledHint] = useState(false);

  // Redirect once fully authenticated, verified, profile ready, and optional MFA passed
  useEffect(() => {
    if (firebaseUser?.emailVerified && patientAccount) {
      if (!patientAccount.optionalMfaEnabled || patientMfaPassed) {
        onNavigate('/patient/dashboard');
      }
    }
  }, [firebaseUser, patientAccount, patientMfaPassed, onNavigate]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setBusy(true);
    const res = await signInWithEmailAction(email, password);
    setBusy(false);
    if (!res.ok) {
      if (res.code === 'auth/operation-not-allowed') {
        setEmailProviderDisabledHint(true);
      }
      setErrorMsg(res.error || 'Unable to sign in.');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    setBusy(true);
    const res = await registerPatientEmailAction({
      email,
      password,
      fullName,
      phone,
      dateOfBirth,
      sex,
    });
    setBusy(false);
    if (!res.ok) {
      if (res.code === 'auth/operation-not-allowed') {
        setEmailProviderDisabledHint(true);
      }
      setErrorMsg(res.error || 'Registration failed.');
      return;
    }
    setInfoMsg(
      'Account created. Please check your inbox and verify your email address before accessing your Patient Portal.'
    );
  };

  const handleGoogle = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setBusy(true);
    const res = await signInWithGoogleAction();
    setBusy(false);
    if (!res.ok && res.error) {
      setErrorMsg(res.error);
    }
  };

  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setBusy(true);
    const res = await completePatientProfileSetup({
      fullName: fullName || firebaseUser?.displayName || '',
      phone,
      dateOfBirth,
      sex,
      createFreshClinicalRecord: createFreshRecord,
    });
    setBusy(false);
    if (!res.ok) {
      setErrorMsg(res.error || 'Could not save patient profile.');
    }
  };

  const handleVerifyOptionalMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientAccount?.optionalMfaEncryptedSecret || !firebaseUser) return;
    setErrorMsg('');
    setBusy(true);
    try {
      const resp = await fetch('/api/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          role: 'patient',
          encryptedSecret: patientAccount.optionalMfaEncryptedSecret,
          code: patientMfaCode,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.verified) {
        setErrorMsg(data.error || 'Invalid 6-digit authenticator code.');
      } else {
        setPatientMfaPassed(true);
        onNavigate('/patient/dashboard');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Authenticator verification failed.');
    } finally {
      setBusy(false);
    }
  };

  // Case 1: Logged in with a Staff Account on Patient Portal login page
  if (firebaseUser && staffAccount && !patientAccount) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xs space-y-5">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Staff Account Signed In
          </h1>
          <p className="text-sm text-slate-600">
            You are currently signed in as clinic staff ({firebaseUser.email}). To access the Staff
            Portal, continue to the unified Staff Login gate, or sign out to switch to a personal
            Patient Portal account.
          </p>
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('/staff/login')}
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Continue to Staff Portal
            </button>
            <button
              type="button"
              onClick={() => logoutAction()}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Case 2: Signed in, waiting for Email Verification
  if (firebaseUser && !firebaseUser.emailVerified) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xs space-y-5">
          <MailCheck className="h-8 w-8 text-blue-700" />
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">
              Verify Your Email Address
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              SmartClinic requires a verified email before granting access to patient scheduling and
              clinical documents. A verification link was sent to{' '}
              <strong className="text-slate-900">{firebaseUser.email}</strong>.
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              {infoMsg}
            </div>
          )}

          <div className="space-y-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const verified = await refreshEmailVerificationStatus();
                setBusy(false);
                if (!verified) {
                  setErrorMsg('Email is not marked verified yet. Click the link in your email first.');
                }
              }}
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              I Have Verified My Email
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await resendEmailVerificationAction();
                setBusy(false);
                if (res.ok) setInfoMsg('Verification email resent.');
                else setErrorMsg(res.error || 'Could not resend email.');
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Resend Verification Link
            </button>
            <button
              type="button"
              onClick={() => logoutAction()}
              className="w-full text-xs font-medium text-slate-500 hover:text-slate-800 pt-1"
            >
              Sign out and use a different account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Case 3: Verified Firebase User who needs to complete Patient Portal Demographics
  if (firebaseUser?.emailVerified && !patientAccount) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <form
          onSubmit={handleCompleteProfile}
          className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-xs space-y-5"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
              Patient Portal Onboarding
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
              Complete Your Patient Profile
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Signed in as <strong>{firebaseUser.email}</strong>. Provide your basic outpatient
              identification details to enable appointment booking.
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="setup-fullname" className="block text-xs font-semibold text-slate-700">
                Legal Full Name
              </label>
              <input
                id="setup-fullname"
                type="text"
                required
                value={fullName || firebaseUser.displayName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="setup-dob" className="block text-xs font-semibold text-slate-700">
                  Date of Birth
                </label>
                <input
                  id="setup-dob"
                  type="date"
                  required
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="setup-sex" className="block text-xs font-semibold text-slate-700">
                  Sex
                </label>
                <select
                  id="setup-sex"
                  value={sex}
                  onChange={(e) => setSex(e.target.value as PatientPortalAccount['sex'])}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="setup-phone" className="block text-xs font-semibold text-slate-700">
                Mobile / Contact Number
              </label>
              <input
                id="setup-phone"
                type="tel"
                required
                placeholder="09171234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-900">Have you visited SmartClinic as a Walk-In before?</p>
              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="recordMode"
                  checked={createFreshRecord}
                  onChange={() => setCreateFreshRecord(true)}
                  className="mt-0.5"
                />
                <span>
                  <strong>I am a new patient</strong> — Create my new outpatient Patient ID immediately.
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="recordMode"
                  checked={!createFreshRecord}
                  onChange={() => setCreateFreshRecord(false)}
                  className="mt-0.5"
                />
                <span>
                  <strong>I have an existing Walk-In record</strong> — Let me request staff-verified
                  record linking inside My Profile without creating a duplicate chart.
                </span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => logoutAction()}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Sign Out
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {busy ? 'Saving Profile...' : 'Continue to Patient Portal'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Case 4: Optional Patient Authenticator MFA Challenge
  if (firebaseUser?.emailVerified && patientAccount?.optionalMfaEnabled && !patientMfaPassed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <form
          onSubmit={handleVerifyOptionalMfa}
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xs space-y-5"
        >
          <KeyRound className="h-8 w-8 text-blue-700" />
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">
              Two-Factor Verification
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Enter the 6-digit code from your Authenticator App to unlock your Patient Portal.
            </p>
          </div>
          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}
          <div>
            <label htmlFor="patient-totp" className="block text-xs font-semibold text-slate-700">
              6-Digit Authenticator Code
            </label>
            <input
              id="patient-totp"
              type="text"
              inputMode="numeric"
              required
              maxLength={6}
              value={patientMfaCode}
              onChange={(e) => setPatientMfaCode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-center text-lg tracking-widest tabular-nums"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Verify & Enter Portal
          </button>
        </form>
      </div>
    );
  }

  // Standard Patient Login / Registration Screen
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Public Website
          </button>
          <span className="text-xs font-medium text-slate-500">Patient Portal</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-7 sm:p-8 shadow-xs space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-white">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">
                {mode === 'login' ? 'Patient Portal Sign In' : 'Create Patient Portal Account'}
              </h1>
              <p className="text-xs text-slate-500">
                {mode === 'login'
                  ? 'Access appointments, QR passes, and released records'
                  : 'Register with a verified email for online outpatient booking'}
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1">
              <p className="font-semibold">{errorMsg}</p>
              {emailProviderDisabledHint && (
                <p className="text-rose-700">
                  Admin Setup Note: To use Email/Password alongside Google Sign-In, enable the{' '}
                  <strong>Email/Password</strong> provider in Firebase Console &rarr; Authentication
                  &rarr; Sign-in method. You can sign in immediately below with Google.
                </p>
              )}
            </div>
          )}

          {infoMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              {infoMsg}
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={handleGoogle}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4 text-blue-700" />
            Continue with Verified Google Account
          </button>

          <div className="relative flex items-center py-1">
            <div className="grow border-t border-slate-200" />
            <span className="mx-3 shrink-0 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Or with Email & Password
            </span>
            <div className="grow border-t border-slate-200" />
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label htmlFor="pat-email" className="block text-xs font-semibold text-slate-700">
                  Email Address
                </label>
                <input
                  id="pat-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="pat-password" className="block text-xs font-semibold text-slate-700">
                  Password
                </label>
                <input
                  id="pat-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {busy ? 'Signing In...' : 'Sign In to Patient Portal'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label htmlFor="reg-name" className="block text-xs font-semibold text-slate-700">
                  Legal Full Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-dob" className="block text-xs font-semibold text-slate-700">
                    Date of Birth
                  </label>
                  <input
                    id="reg-dob"
                    type="date"
                    required
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="reg-sex" className="block text-xs font-semibold text-slate-700">
                    Sex
                  </label>
                  <select
                    id="reg-sex"
                    value={sex}
                    onChange={(e) => setSex(e.target.value as PatientPortalAccount['sex'])}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="reg-phone" className="block text-xs font-semibold text-slate-700">
                  Contact Number
                </label>
                <input
                  id="reg-phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-700">
                  Email Address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="reg-pass" className="block text-xs font-semibold text-slate-700">
                  Password (minimum 8 characters)
                </label>
                <input
                  id="reg-pass"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {busy ? 'Creating Account...' : 'Register Patient Account'}
              </button>
            </form>
          )}

          <div className="border-t border-slate-100 pt-4 text-center text-xs text-slate-600">
            {mode === 'login' ? (
              <p>
                New to SmartClinic Online Booking?{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('/patient/register')}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  Create a Patient Account
                </button>
              </p>
            ) : (
              <p>
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('/patient/login')}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  Sign In
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Unified Staff Portal Login & Mandatory TOTP 2FA Gate (/staff/login)
// ============================================================================
interface StaffLoginViewProps {
  onNavigate: (path: string) => void;
}

export const StaffLoginView: React.FC<StaffLoginViewProps> = ({ onNavigate }) => {
  const {
    authProviderMode,
    supabaseAccessToken,
    supabaseBootstrapLocked,
    supabaseBootstrapArmed,
    supabaseCanBootstrapCurrentUser,
    firebaseBootstrapStatus,
    firebaseUser,
    patientAccount,
    staffAccount,
    mfaSessionVerified,
    roster,
    signInWithGoogleAction,
    signInWithEmailAction,
    registerInvitedStaffEmailAction,
    resendEmailVerificationAction,
    refreshEmailVerificationStatus,
    bootstrapInitialAdminAction,
    claimStaffInvitationAction,
    completeStaffMfaEnrollment,
    setStaffMfaVerifiedSession,
    logoutAction,
  } = useClinic();

  const [staffCredMode, setStaffCredMode] = useState<'signin' | 'invited_register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  // TOTP Enrollment State
  const [enrollData, setEnrollData] = useState<{
    manualSecretKey: string;
    encryptedSecret: string;
    recoveryCodes: string[];
    recoveryHashes: string[];
    qrDataUrl: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [useRecoveryMode, setUseRecoveryMode] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');

  // Automatically route to role-specific dashboard once Staff Account + Mandatory MFA are verified!
  useEffect(() => {
    if (staffAccount && staffAccount.active && staffAccount.mfaEnrolled && mfaSessionVerified) {
      const roleSlug =
        staffAccount.role === 'pharmacist' ? 'pharmacy' : staffAccount.role;
      onNavigate(`/staff/${roleSlug}/dashboard`);
    }
  }, [staffAccount, mfaSessionVerified, onNavigate]);

  // Prepare TOTP QR enrollment when staff member is not yet enrolled
  useEffect(() => {
    let active = true;
    if (firebaseUser && staffAccount && !staffAccount.mfaEnrolled && !enrollData) {
      (async () => {
        try {
          const resp =
            authProviderMode === 'supabase'
              ? await fetch('/api/supabase/mfa/setup', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${supabaseAccessToken}`,
                  },
                })
              : await fetch('/api/mfa/setup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ uid: firebaseUser.uid, email: firebaseUser.email }),
                });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'MFA setup error');
          if (active) {
            setEnrollData({
              manualSecretKey: data.manualSecretKey,
              encryptedSecret: data.encryptedSecret,
              recoveryCodes: data.recoveryCodes || [],
              recoveryHashes: data.recoveryHashes || [],
              qrDataUrl: data.qrDataUrl,
            });
          }
        } catch (err: any) {
          if (active) setErrorMsg(err?.message || 'Unable to generate Authenticator setup.');
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [firebaseUser, staffAccount, enrollData, authProviderMode, supabaseAccessToken]);

  const handleStaffEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setBusy(true);
    if (authProviderMode !== 'supabase' && staffCredMode === 'invited_register') {
      const res = await registerInvitedStaffEmailAction({ email, password });
      setBusy(false);
      if (!res.ok) {
        setErrorMsg(res.error || 'Staff credential setup failed.');
      } else if (res.requiresVerification) {
        setInfoMsg(
          'Verification email sent! Please click the verification link in your inbox, then click "I Verified My Email" below to claim your Admin-assigned staff role.'
        );
      }
      return;
    }
    const res = await signInWithEmailAction(email, password);
    setBusy(false);
    if (!res.ok) {
      setErrorMsg(
        res.code === 'auth/operation-not-allowed'
          ? 'Email/Password Sign-In is currently disabled in Firebase Console, and external Supabase secrets (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) are not configured yet in AI Studio Secrets.'
          : res.error || 'Authentication failed.'
      );
    }
  };

  const handleBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setBusy(true);
    const res = await bootstrapInitialAdminAction(
      adminFullName || firebaseUser?.displayName || 'System Administrator'
    );
    setBusy(false);
    if (!res.ok) setErrorMsg(res.error || 'Initial Administrator setup failed.');
  };

  const handleClaimInvitation = async () => {
    setErrorMsg('');
    setBusy(true);
    const res = await claimStaffInvitationAction();
    setBusy(false);
    if (!res.ok) setErrorMsg(res.error || 'No pending staff invitation found for this email.');
  };

  const handleCompleteTotpEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollData || !firebaseUser || !staffAccount) return;
    setErrorMsg('');
    setBusy(true);
    try {
      if (authProviderMode === 'supabase') {
        const resp = await fetch('/api/supabase/mfa/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supabaseAccessToken}`,
          },
          body: JSON.stringify({
            encryptedSecret: enrollData.encryptedSecret,
            recoveryHashes: enrollData.recoveryHashes,
            code: totpCode,
          }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.verified) {
          setErrorMsg(data.error || 'Invalid 6-digit code. Scan the QR code and try again.');
          setBusy(false);
          return;
        }
        await completeStaffMfaEnrollment({
          encryptedSecret: '',
          recoveryHashes: [],
          assuranceToken: data.assuranceToken,
          expiresAtMs: data.expiresAtMs,
          alreadyPersistedOnServer: true,
        });
        return;
      }

      const resp = await fetch('/api/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          role: staffAccount.role,
          encryptedSecret: enrollData.encryptedSecret,
          code: totpCode,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.verified) {
        setErrorMsg(data.error || 'Invalid 6-digit code. Scan the QR code and try again.');
        setBusy(false);
        return;
      }

      const saveRes = await completeStaffMfaEnrollment({
        encryptedSecret: enrollData.encryptedSecret,
        recoveryHashes: enrollData.recoveryHashes,
        assuranceToken: data.assuranceToken,
        expiresAtMs: data.expiresAtMs,
      });
      if (!saveRes.ok) {
        setErrorMsg(saveRes.error || 'Could not persist MFA enrollment.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'MFA enrollment error.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyStaffMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !staffAccount) return;
    setErrorMsg('');
    setBusy(true);
    try {
      const resp =
        authProviderMode === 'supabase'
          ? await fetch('/api/supabase/mfa/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${supabaseAccessToken}`,
              },
              body: JSON.stringify({
                code: useRecoveryMode ? undefined : totpCode,
                recoveryCode: useRecoveryMode ? recoveryInput : undefined,
              }),
            })
          : await fetch('/api/mfa/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                uid: firebaseUser.uid,
                role: staffAccount.role,
                encryptedSecret: staffAccount.mfaEncryptedSecret,
                code: useRecoveryMode ? undefined : totpCode,
                recoveryCode: useRecoveryMode ? recoveryInput : undefined,
                recoveryHashes: staffAccount.mfaRecoveryHashes,
              }),
            });
      const data = await resp.json();
      if (!resp.ok || !data.verified) {
        setErrorMsg(data.error || 'Invalid verification code.');
      } else {
        await setStaffMfaVerifiedSession({
          assuranceToken: data.assuranceToken,
          expiresAtMs: data.expiresAtMs,
          usedRecoveryHash: data.usedRecoveryHash,
        });
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'MFA verification failed.');
    } finally {
      setBusy(false);
    }
  };

  // CRITICAL: Never allow client-side or first-login auto-admin promotion!
  // Only true when verified on the backend via Firebase Admin SDK / Supabase service role against the exact designated UID.
  const canRunBootstrap =
    authProviderMode === 'supabase'
      ? supabaseCanBootstrapCurrentUser
      : firebaseBootstrapStatus.canBootstrapCurrentUser;

  const isBootstrapAlreadyLocked =
    authProviderMode === 'supabase'
      ? supabaseBootstrapLocked
      : Boolean(firebaseBootstrapStatus.bootstrapLocked || roster.bootstrappedAdminUid);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span className="font-mono uppercase tracking-wider font-semibold text-slate-700">
            SmartClinic · Internal Staff Access
          </span>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="hover:text-slate-900 font-medium"
          >
            Return to Public Site
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-7 sm:p-8 shadow-xs space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">
                Unified Staff Portal Sign In
              </h1>
              <p className="text-xs text-slate-500">
                Role is determined automatically from verified clinic staff records. Mandatory
                Authenticator-App TOTP 2FA enforced.
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {infoMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-blue-700" />
              <span>{infoMsg}</span>
            </div>
          )}

          {/* Step 1: Not yet signed in */}
          {!firebaseUser && (
            <div className="space-y-5">
              {authProviderMode !== 'supabase' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setErrorMsg('');
                      setInfoMsg('');
                      setBusy(true);
                      const res = await signInWithGoogleAction();
                      setBusy(false);
                      if (!res.ok && res.error) setErrorMsg(res.error);
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <ShieldCheck className="h-4 w-4 text-blue-700" />
                    Sign In with Verified Staff Google Account
                  </button>

                  <div className="relative flex items-center">
                    <div className="grow border-t border-slate-200" />
                    <span className="mx-3 shrink-0 text-[11px] uppercase tracking-wider text-slate-400">
                      Or Staff Email &amp; Password
                    </span>
                    <div className="grow border-t border-slate-200" />
                  </div>

                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setStaffCredMode('signin');
                      }}
                      className={`rounded-md py-1.5 font-semibold transition-colors ${
                        staffCredMode === 'signin'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Existing Staff Login
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setStaffCredMode('invited_register');
                      }}
                      className={`rounded-md py-1.5 font-semibold transition-colors ${
                        staffCredMode === 'invited_register'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Invited Staff Set Password
                    </button>
                  </div>
                </>
              )}

              <form onSubmit={handleStaffEmailSubmit} className="space-y-4">
                <div>
                  <label htmlFor="staff-email" className="block text-xs font-semibold text-slate-700">
                    Authorized Work Email Address
                  </label>
                  <input
                    id="staff-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="staff-pass" className="block text-xs font-semibold text-slate-700">
                    {authProviderMode !== 'supabase' && staffCredMode === 'invited_register'
                      ? 'Create Staff Password (min 8 characters)'
                      : 'Password'}
                  </label>
                  <input
                    id="staff-pass"
                    type="password"
                    required
                    minLength={
                      authProviderMode !== 'supabase' && staffCredMode === 'invited_register'
                        ? 8
                        : undefined
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  {busy
                    ? 'Processing...'
                    : authProviderMode !== 'supabase' && staffCredMode === 'invited_register'
                    ? 'Create Staff Credentials & Verify Email'
                    : 'Sign In & Proceed to 2FA'}
                </button>
              </form>
            </div>
          )}

          {/* Step 1B: Signed in with unverified email */}
          {firebaseUser && !firebaseUser.emailVerified && !staffAccount && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-950 space-y-1.5">
                <p className="font-semibold">
                  Verify Your Staff Email ({firebaseUser.email})
                </p>
                <p>
                  {authProviderMode === 'supabase'
                    ? 'Confirm this user email in your Supabase Dashboard (Authentication -> Users) before completing one-time Administrator bootstrap or enrolling Authenticator 2FA.'
                    : 'For clinical security, SmartClinic requires a verified email address before activating an Admin-issued staff invitation or enrolling Authenticator 2FA.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => logoutAction()}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600"
                >
                  Sign Out
                </button>
                {authProviderMode !== 'supabase' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await resendEmailVerificationAction();
                        if (res.ok) setInfoMsg('Verification email re-sent.');
                        else setErrorMsg(res.error || 'Could not resend verification email.');
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700"
                    >
                      Resend Link
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await refreshEmailVerificationStatus();
                        if (!ok) setErrorMsg('Email is not verified yet. Check your inbox first.');
                      }}
                      className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                    >
                      I Verified My Email
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2A: Trusted One-Time Server-Side Initial Administrator Setup */}
          {firebaseUser &&
            firebaseUser.emailVerified &&
            !staffAccount &&
            canRunBootstrap && (
              <form onSubmit={handleBootstrapAdmin} className="space-y-4">
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs text-slate-700 space-y-1.5">
                  <p className="font-semibold text-blue-900">
                    One-Time First System Administrator Bootstrap Verified
                  </p>
                  <p>
                    {authProviderMode === 'supabase' ? (
                      <>
                        Your Supabase Auth session (<strong>{firebaseUser.email}</strong>, UID{' '}
                        <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">
                          {firebaseUser.uid}
                        </code>
                        ) matches the server&apos;s designated{' '}
                        <code>SUPABASE_INITIAL_ADMIN_USER_ID</code>. Submitting below assigns your
                        System Administrator role on the backend, permanently disables bootstrap, and
                        proceeds to mandatory Authenticator-App TOTP 2FA enrollment.
                      </>
                    ) : (
                      <>
                        Your Google / Firebase Auth session (<strong>{firebaseUser.email}</strong>, UID{' '}
                        <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">
                          {firebaseUser.uid}
                        </code>
                        ) matches the server&apos;s designated{' '}
                        <code>FIREBASE_INITIAL_ADMIN_UID</code>. Submitting below executes the
                        one-time Firebase Admin SDK assignment on the backend, permanently locks
                        bootstrap, and proceeds to mandatory Authenticator-App TOTP 2FA before
                        entering <code>/staff/admin/dashboard</code>.
                      </>
                    )}
                  </p>
                  {patientAccount && (
                    <p className="text-emerald-800 font-medium">
                      Note: Your existing Patient Portal profile on <code>/patient/dashboard</code>{' '}
                      will remain intact and accessible.
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="admin-init-name"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Administrator Full Name
                  </label>
                  <input
                    id="admin-init-name"
                    type="text"
                    required
                    placeholder="e.g. Patrick Cervito"
                    value={adminFullName || firebaseUser.displayName}
                    onChange={(e) => setAdminFullName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => logoutAction()}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
                  >
                    Sign Out
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    {busy ? 'Bootstrapping...' : 'Complete One-Time Admin Bootstrap'}
                  </button>
                </div>
              </form>
            )}

          {/* Step 2A-NonOwner: Prevent unrestricted public Admin registration when Admin not yet initialized */}
          {firebaseUser &&
            firebaseUser.emailVerified &&
            !staffAccount &&
            !isBootstrapAlreadyLocked &&
            !canRunBootstrap && (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950 space-y-2">
                  <p className="font-semibold">
                    Initial System Administrator Not Yet Activated
                  </p>
                  {authProviderMode === 'supabase' ? (
                    <p>
                      {!supabaseBootstrapArmed
                        ? `Signed in as ${firebaseUser.email}. Server bootstrap is not armed yet: set SUPABASE_INITIAL_ADMIN_USER_ID in AI Studio Secrets to your exact Supabase Auth User ID (${firebaseUser.uid}) and restart.`
                        : `Signed in as ${firebaseUser.email} (UID ${firebaseUser.uid}). Public administrator registration is disabled—only the exact Supabase Auth User ID configured in SUPABASE_INITIAL_ADMIN_USER_ID may execute the one-time bootstrap.`}
                    </p>
                  ) : (
                    <>
                      <p>
                        Signed in via Firebase Auth as <strong>{firebaseUser.email}</strong> (UID:{' '}
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-900 select-all">
                          {firebaseUser.uid}
                        </code>
                        ).
                      </p>
                      <p>
                        Unrestricted public Admin registration and automatic first-login Admin
                        promotion are disabled. Activate the first System Administrator using the
                        trusted server-side Firebase Admin SDK one-time script (
                        <code>npm run bootstrap:admin</code>) or configure{' '}
                        <code>FIREBASE_INITIAL_ADMIN_UID</code> +{' '}
                        <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> in server secrets, then sign in
                        again here to proceed to <code>/staff/admin/dashboard</code>.
                      </p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => logoutAction()}
                  className="w-full rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Sign Out &amp; Switch Account
                </button>
              </div>
            )}

          {/* Step 2B: Signed in & Verified, no Staff Account yet, Bootstrap already permanently locked */}
          {firebaseUser &&
            firebaseUser.emailVerified &&
            !staffAccount &&
            isBootstrapAlreadyLocked && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-1.5">
                  <p className="font-semibold text-slate-900">
                    Signed in as {firebaseUser.email}
                  </p>
                  <p>
                    {authProviderMode === 'supabase'
                      ? 'One-time initial Administrator bootstrap is permanently disabled. Staff roles cannot be self-registered—contact the System Administrator to create your authorized clinic staff account from /staff/admin/dashboard.'
                      : 'Staff roles cannot be self-registered. If the Clinic Administrator has created a staff invitation for your email address, activate it below to proceed to mandatory Authenticator 2FA enrollment.'}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => logoutAction()}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
                  >
                    Sign Out
                  </button>
                  {authProviderMode !== 'supabase' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleClaimInvitation}
                      className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                      {busy ? 'Checking Invitation...' : 'Claim Staff Invitation'}
                    </button>
                  )}
                </div>
              </div>
            )}

          {/* Step 3: Deactivated Staff Account */}
          {staffAccount && !staffAccount.active && (
            <div className="space-y-4">
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
                Your staff account ({staffAccount.email}) has been deactivated by Clinic
                Administration. Access to clinical modules is suspended.
              </div>
              <button
                type="button"
                onClick={() => logoutAction()}
                className="w-full rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Sign Out
              </button>
            </div>
          )}

          {/* Step 4: Mandatory Authenticator-App TOTP Enrollment */}
          {staffAccount && staffAccount.active && !staffAccount.mfaEnrolled && (
            <form onSubmit={handleCompleteTotpEnrollment} className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                  Mandatory Staff Security Step · Detected Role: {staffAccount.role.toUpperCase()}
                </p>
                <h2 className="mt-1 font-display text-lg font-bold text-slate-900">
                  Enroll Authenticator-App 2FA (TOTP)
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  Scan this QR code with Google Authenticator, Microsoft Authenticator, Authy, or
                  1Password, save your offline recovery codes, and enter the 6-digit code to activate
                  staff portal access.
                </p>
              </div>

              {enrollData ? (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row">
                    <img
                      src={enrollData.qrDataUrl}
                      alt="TOTP Authenticator QR Code"
                      className="h-40 w-40 rounded-lg border border-slate-200 bg-white p-2 shrink-0"
                    />
                    <div className="space-y-2 text-xs">
                      <p className="font-semibold text-slate-900">Manual Setup Key (Base32):</p>
                      <code className="block break-all rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800">
                        {enrollData.manualSecretKey}
                      </code>
                      <p className="text-slate-500">
                        Time-based 6-digit SHA-1 code · 30-second window · Zero SMS required.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
                    <p className="text-xs font-semibold text-amber-900">
                      Save Your Single-Use Backup Recovery Codes
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {enrollData.recoveryCodes.map((rc) => (
                        <code
                          key={rc}
                          className="rounded-md bg-white px-2 py-1 text-center font-mono text-xs font-semibold text-slate-800 border border-amber-200 tabular-nums"
                        >
                          {rc}
                        </code>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="enroll-totp-code"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Confirm 6-Digit Authenticator Code
                    </label>
                    <input
                      id="enroll-totp-code"
                      type="text"
                      inputMode="numeric"
                      required
                      maxLength={6}
                      placeholder="000000"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-lg tracking-widest tabular-nums"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => logoutAction()}
                      className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600"
                    >
                      Cancel & Sign Out
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {busy ? 'Verifying...' : 'Complete 2FA Enrollment'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Generating secure TOTP secret...</p>
              )}
            </form>
          )}

          {/* Step 5: Mandatory Per-Session TOTP Challenge */}
          {staffAccount && staffAccount.active && staffAccount.mfaEnrolled && !mfaSessionVerified && (
            <form onSubmit={handleVerifyStaffMfa} className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <p className="font-semibold text-slate-900">
                  {staffAccount.fullName} · {staffAccount.titleDisplay || staffAccount.role}
                </p>
                <p className="text-slate-500 mt-0.5">
                  Automatic Role Routing: <strong className="uppercase">{staffAccount.role}</strong>{' '}
                  Dashboard (unlocks after 2FA verification)
                </p>
              </div>

              {!useRecoveryMode ? (
                <div>
                  <label
                    htmlFor="verify-staff-totp"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    6-Digit Authenticator App Code
                  </label>
                  <input
                    id="verify-staff-totp"
                    type="text"
                    inputMode="numeric"
                    required
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-lg tracking-widest tabular-nums"
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="verify-staff-recovery"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Single-Use Backup Recovery Code
                  </label>
                  <input
                    id="verify-staff-recovery"
                    type="text"
                    required
                    placeholder="XXXX-XXXX"
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-base uppercase tracking-wider"
                  />
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => setUseRecoveryMode((prev) => !prev)}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {useRecoveryMode
                    ? 'Use 6-digit Authenticator code instead'
                    : 'Use a backup recovery code'}
                </button>
                <button
                  type="button"
                  onClick={() => logoutAction()}
                  className="text-slate-500 hover:text-slate-800"
                >
                  Sign Out
                </button>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
              >
                {busy ? 'Verifying Session...' : 'Verify 2FA & Enter Staff Dashboard'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
