import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseMedical,
  Calendar,
  CalendarOff,
  CreditCard,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  Settings,
  ShieldAlert,
  UserCog,
  Users,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import type { ClinicService, PatientGuideSectionItem, StaffRole } from '../types/clinic';
import { StaffShell } from './StaffShell';
import { AdminPredictiveAnalytics } from './AdminPredictiveAnalytics';
import { NotificationHistoryView } from './NotificationCenter';

interface StaffAdminProps {
  onNavigate: (path: string) => void;
}

const TARGET_STAFF_STRUCTURE: { role: StaffRole; label: string; defaultTarget: number }[] = [
  { role: 'doctor', label: 'Doctors', defaultTarget: 3 },
  { role: 'nurse', label: 'Nurses', defaultTarget: 2 },
  { role: 'receptionist', label: 'Receptionists', defaultTarget: 2 },
  { role: 'laboratory', label: 'Laboratory Technologists', defaultTarget: 1 },
  { role: 'pharmacist', label: 'Pharmacists', defaultTarget: 1 },
  { role: 'admin', label: 'Administrators', defaultTarget: 1 },
];

const WORKDAYS = [
  { idx: 1, label: 'Mon' },
  { idx: 2, label: 'Tue' },
  { idx: 3, label: 'Wed' },
  { idx: 4, label: 'Thu' },
  { idx: 5, label: 'Fri' },
  { idx: 6, label: 'Sat' },
  { idx: 0, label: 'Sun' },
];

export const StaffAdmin: React.FC<StaffAdminProps> = ({ onNavigate }) => {
  const {
    staffAccounts,
    staffInvitations,
    doctorSchedules,
    leaveRequests,
    services,
    appointments,
    visits,
    patients,
    billings,
    coverageSettings,
    patientGuides,
    auditLogs,
    notifications,
    operationalAnalyticsEvents,
    inviteStaffMemberAction,
    toggleStaffActiveStatusAction,
    updateStaffAccountRoleAction,
    syncStaffRosterAccessAction,
    upsertDoctorScheduleAction,
    reviewLeaveRequestAction,
    upsertClinicServiceAction,
    upsertPatientGuideAction,
    updateCoverageSettingsAction,
    markNotificationReadAction,
  } = useClinic();

  const [activeTab, setActiveTab] = useState('overview');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Staff Invitation Form
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invRole, setInvRole] = useState<StaffRole>('doctor');
  const [invDept, setInvDept] = useState('Outpatient Medicine');
  const [invSpec, setInvSpec] = useState('Internal Medicine');
  const [invTitle, setInvTitle] = useState('Attending Physician');

  // Doctor Schedule Configuration Form
  const doctorStaffList = useMemo(
    () => staffAccounts.filter((s) => s.role === 'doctor'),
    [staffAccounts]
  );
  const [schedDocUid, setSchedDocUid] = useState(
    doctorSchedules[0]?.doctorUid || doctorStaffList[0]?.uid || ''
  );
  const [schedWorkdays, setSchedWorkdays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [schedStart, setSchedStart] = useState('08:00');
  const [schedEnd, setSchedEnd] = useState('17:00');
  const [schedBreakStart, setSchedBreakStart] = useState('12:00');
  const [schedBreakEnd, setSchedBreakEnd] = useState('13:00');
  const [schedDuration, setSchedDuration] = useState('30');

  // Clinic Service Editor State
  const [srvCode, setSrvCode] = useState('');
  const [srvName, setSrvName] = useState('');
  const [srvCat, setSrvCat] = useState<ClinicService['category']>('Consultation');
  const [srvFee, setSrvFee] = useState('600');
  const [srvDur, setSrvDur] = useState('30');
  const [srvDesc, setSrvDesc] = useState('');

  // Patient Guide CMS State
  const [guideSection, setGuideSection] =
    useState<PatientGuideSectionItem['sectionKey']>('clinic_guides');
  const [guideTitle, setGuideTitle] = useState('');
  const [guideSummary, setGuideSummary] = useState('');
  const [guideBullets, setGuideBullets] = useState('');
  const [guideNotice, setGuideNotice] = useState('');

  // Coverage Settings Form State
  const [hmoListText, setHmoListText] = useState(
    coverageSettings.hmoProvidersAcceptedForManualVerification.join(', ')
  );
  const [philHealthNote, setPhilHealthNote] = useState(coverageSettings.philHealthAdvisoryNote);

  const pendingLeavesCount = leaveRequests.filter((l) => l.status === 'Pending').length;

  const navItems = [
    { id: 'overview', label: 'Clinic Overview', icon: LayoutDashboard },
    { id: 'analytics', label: 'Predictive Analytics', icon: BarChart3 },
    { id: 'staff', label: 'Staff & User Management', icon: UserCog },
    { id: 'permissions', label: 'Role Permissions Matrix', icon: Lock },
    { id: 'schedules', label: 'Doctor Schedules', icon: Calendar },
    {
      id: 'leaves',
      label: 'Leave Management',
      icon: CalendarOff,
      badgeCount: pendingLeavesCount,
    },
    { id: 'services', label: 'Clinic Services', icon: BriefcaseMedical },
    { id: 'appointments', label: 'Appointment Monitoring', icon: FileSpreadsheet },
    { id: 'patients_admin', label: 'Patient Admin Records', icon: Users },
    { id: 'billing_reports', label: 'Billing & Coverage', icon: CreditCard },
    { id: 'guide_cms', label: 'Patient Guide CMS', icon: BookOpen },
    { id: 'audit', label: 'Security & Audit Logs', icon: ShieldAlert },
    { id: 'system', label: 'System Settings', icon: Settings },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badgeCount: notifications.filter((n) => !n.read).length,
    },
  ];

  const totalCollectedPhp = useMemo(
    () => billings.reduce((acc, b) => acc + b.amountPaidPhp, 0),
    [billings]
  );

  return (
    <StaffShell
      roleLabel="Clinic Administrator"
      navItems={navItems}
      activeTab={activeTab}
      onSelectTab={(id) => {
        setFeedback(null);
        setActiveTab(id);
      }}
      onNavigate={onNavigate}
    >
      {feedback && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 1. OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Clinic Administration &amp; Governance
              </h1>
              <p className="text-sm text-slate-600">
                Operational metrics, staffing targets, schedule governance, and non-clinical
                oversight. Confidential patient diagnoses remain restricted to clinicians.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className="rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800"
            >
              Open Predictive Analytics
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Active Clinic Staff</p>
              <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {staffAccounts.filter((s) => s.active).length} / 10 Target
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {doctorSchedules.filter((d) => d.active).length} active doctor schedules
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Registered Patients</p>
              <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {patients.length}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Online &amp; Walk-In permanent IDs
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Completed Consultations</p>
              <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {operationalAnalyticsEvents.length ||
                  visits.filter((v) => v.queueStatus === 'Consultation Completed' || v.queueStatus === 'Checked Out').length}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                De-identified operational count
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Payments Collected</p>
              <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                PHP {totalCollectedPhp.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Across {billings.length} billing statements
              </p>
            </div>
          </div>

          {/* Configurable Target Outpatient Staffing Structure */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">
              Configurable Outpatient Staffing Structure
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {TARGET_STAFF_STRUCTURE.map((t) => {
                const activeCount = staffAccounts.filter(
                  (s) => s.role === t.role && s.active
                ).length;
                return (
                  <div
                    key={t.role}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs"
                  >
                    <p className="font-semibold text-slate-700">{t.label}</p>
                    <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                      {activeCount} / {t.defaultTarget}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 2. PREDICTIVE ANALYTICS */}
      {activeTab === 'analytics' && <AdminPredictiveAnalytics />}

      {/* 3. STAFF & USER MANAGEMENT */}
      {activeTab === 'staff' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await inviteStaffMemberAction({
                email: invEmail,
                fullName: invName,
                role: invRole,
                department: invDept,
                specialty: invRole === 'doctor' ? invSpec : '',
                titleDisplay: invTitle,
              });
              if (res.ok) {
                const targetDash =
                  invRole === 'pharmacist'
                    ? '/staff/pharmacy/dashboard'
                    : `/staff/${invRole}/dashboard`;
                setFeedback({
                  type: 'ok',
                  text: `Staff invitation recorded for ${invEmail} (${invRole.toUpperCase()}). Have them sign in at /staff/login, claim their invitation, and enroll TOTP 2FA to auto-route to ${targetDash}.`,
                });
                setInvEmail('');
                setInvName('');
              } else {
                setFeedback({ type: 'err', text: res.error || 'Could not create invitation.' });
              }
            }}
            className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-3.5 text-xs"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              Authorize &amp; Invite Clinic Staff Member
            </h2>
            <p className="text-slate-500">
              Staff accounts are never self-assigned. Authorized staff sign in at{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">
                /staff/login
              </code>
              , claim their invitation, enroll mandatory Authenticator-App TOTP 2FA, and are
              redirected to their role dashboard automatically.
            </p>
            <div>
              <label htmlFor="st-email" className="block font-semibold text-slate-700">
                Staff Work Email (Google or Email Account)
              </label>
              <input
                id="st-email"
                type="email"
                required
                placeholder="e.g. doctor@clinic.ph"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="st-name" className="block font-semibold text-slate-700">
                Full Name
              </label>
              <input
                id="st-name"
                type="text"
                required
                placeholder="e.g. Dr. Elena Reyes"
                value={invName}
                onChange={(e) => setInvName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="st-role" className="block font-semibold text-slate-700">
                  Assigned Staff Role
                </label>
                <select
                  id="st-role"
                  value={invRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as StaffRole;
                    setInvRole(nextRole);
                    const defaults: Record<StaffRole, { dept: string; title: string; spec: string }> = {
                      doctor: {
                        dept: 'Outpatient Medicine',
                        title: 'Attending Physician',
                        spec: 'Internal Medicine',
                      },
                      nurse: {
                        dept: 'Outpatient Nursing & Triage',
                        title: 'Registered Triage Nurse',
                        spec: '',
                      },
                      receptionist: {
                        dept: 'Front Desk & Patient Relations',
                        title: 'Clinic Receptionist',
                        spec: '',
                      },
                      laboratory: {
                        dept: 'Clinical Laboratory',
                        title: 'Registered Medical Technologist',
                        spec: '',
                      },
                      pharmacist: {
                        dept: 'Outpatient Pharmacy',
                        title: 'Licensed Clinic Pharmacist',
                        spec: '',
                      },
                      admin: {
                        dept: 'Clinic Administration',
                        title: 'Clinic Administrator',
                        spec: '',
                      },
                    };
                    setInvDept(defaults[nextRole].dept);
                    setInvTitle(defaults[nextRole].title);
                    setInvSpec(defaults[nextRole].spec);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2"
                >
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="receptionist">Receptionist</option>
                  <option value="laboratory">Laboratory Technician</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="admin">Administrator</option>
                </select>
                <p className="mt-1 font-mono text-[11px] text-blue-700">
                  Auto-routes to{' '}
                  {invRole === 'pharmacist'
                    ? '/staff/pharmacy/dashboard'
                    : `/staff/${invRole}/dashboard`}
                </p>
              </div>
              <div>
                <label htmlFor="st-title" className="block font-semibold text-slate-700">
                  Professional Title
                </label>
                <input
                  id="st-title"
                  type="text"
                  required
                  value={invTitle}
                  onChange={(e) => setInvTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label htmlFor="st-dept" className="block font-semibold text-slate-700">
                Clinic Department
              </label>
              <input
                id="st-dept"
                type="text"
                required
                value={invDept}
                onChange={(e) => setInvDept(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            {invRole === 'doctor' && (
              <div>
                <label htmlFor="st-spec" className="block font-semibold text-slate-700">
                  Clinical Specialty
                </label>
                <input
                  id="st-spec"
                  type="text"
                  value={invSpec}
                  onChange={(e) => setInvSpec(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            )}
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800"
            >
              Create Authorized Staff Invitation
            </button>
          </form>

          <div className="lg:col-span-7 space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base font-bold text-slate-900">
                  Active &amp; Enrolled Staff Accounts ({staffAccounts.length})
                </h2>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await syncStaffRosterAccessAction();
                    if (res.ok) {
                      setFeedback({
                        type: 'ok',
                        text: `Synchronized active staff roster permissions across ${res.syncedCount ?? 0} clinic records.`,
                      });
                    } else {
                      setFeedback({ type: 'err', text: res.error || 'Could not sync roster access.' });
                    }
                  }}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                >
                  Sync Roster Access to Clinic Records
                </button>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {staffAccounts.map((sa) => (
                  <div
                    key={sa.uid}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-bold text-slate-900">
                        {sa.fullName} · <span className="uppercase text-blue-700">{sa.role}</span>
                      </p>
                      <p className="text-slate-500">
                        {sa.email} · {sa.department || 'Outpatient'} · 2FA:{' '}
                        {sa.mfaEnrolled ? 'Enrolled' : 'Pending'} ·{' '}
                        {sa.active ? 'Active' : 'Suspended'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Change role for ${sa.fullName}`}
                        value={sa.role}
                        onChange={async (e) => {
                          const nextRole = e.target.value as StaffRole;
                          const res = await updateStaffAccountRoleAction({
                            staffUid: sa.uid,
                            role: nextRole,
                            department: sa.department,
                            specialty: sa.specialty,
                            titleDisplay: sa.titleDisplay,
                            active: sa.active,
                          });
                          if (!res.ok) {
                            setFeedback({ type: 'err', text: res.error || 'Role update failed.' });
                          } else {
                            await syncStaffRosterAccessAction();
                            setFeedback({
                              type: 'ok',
                              text: `Updated ${sa.fullName} to ${nextRole.toUpperCase()}.`,
                            });
                          }
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700"
                      >
                        <option value="doctor">Doctor</option>
                        <option value="nurse">Nurse</option>
                        <option value="receptionist">Receptionist</option>
                        <option value="laboratory">Laboratory</option>
                        <option value="pharmacist">Pharmacist</option>
                        <option value="admin">Administrator</option>
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await toggleStaffActiveStatusAction(sa.uid, !sa.active);
                          if (!res.ok) {
                            setFeedback({ type: 'err', text: res.error || 'Status update failed.' });
                          } else {
                            await syncStaffRosterAccessAction();
                          }
                        }}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {sa.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {staffInvitations.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 text-xs">
                <h3 className="font-bold text-slate-900">
                  Staff Invitations ({staffInvitations.length})
                </h3>
                <div className="divide-y divide-slate-100">
                  {staffInvitations.map((inv) => {
                    const roleSlug = inv.role === 'pharmacist' ? 'pharmacy' : inv.role;
                    return (
                      <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div>
                          <p className="font-semibold text-slate-900">
                            {inv.fullName} ({inv.email})
                          </p>
                          <p className="text-slate-500">
                            Role: <strong className="uppercase">{inv.role}</strong> &rarr;{' '}
                            <code>/staff/{roleSlug}/dashboard</code>
                          </p>
                        </div>
                        <span
                          className={`rounded-md px-2 py-0.5 font-semibold ${
                            inv.status === 'Claimed'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {inv.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. ROLE PERMISSIONS MATRIX */}
      {activeTab === 'permissions' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Role-Based Access Control (RBAC) &amp; Clinical Privacy Matrix
          </h1>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Mandatory 2FA</th>
                  <th className="px-4 py-2.5">Confidential Clinical Notes</th>
                  <th className="px-4 py-2.5">Authorized Responsibilities</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-4 py-2.5 font-semibold">Patient</td>
                  <td className="px-4 py-2.5">Optional TOTP</td>
                  <td className="px-4 py-2.5">Own Released Records Only</td>
                  <td className="px-4 py-2.5">Book/reschedule, QR pass, view/PDF released docs</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-semibold">Receptionist</td>
                  <td className="px-4 py-2.5">Mandatory TOTP</td>
                  <td className="px-4 py-2.5 text-rose-700 font-semibold">Restricted (No Access)</td>
                  <td className="px-4 py-2.5">QR check-in, Walk-in intake, Queue, Billing &amp; Check-out</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-semibold">Nurse</td>
                  <td className="px-4 py-2.5">Mandatory TOTP</td>
                  <td className="px-4 py-2.5 text-emerald-700 font-semibold">Authorized Care Team</td>
                  <td className="px-4 py-2.5">Vital signs, Triage assessment, Priority handoff</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-semibold">Doctor</td>
                  <td className="px-4 py-2.5">Mandatory TOTP</td>
                  <td className="px-4 py-2.5 text-emerald-700 font-semibold">Primary Author &amp; Viewer</td>
                  <td className="px-4 py-2.5">Consultation, Diagnosis, Lab orders, Signed Rx, Amendments</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-semibold">Laboratory Staff</td>
                  <td className="px-4 py-2.5">Mandatory TOTP</td>
                  <td className="px-4 py-2.5">Lab Indications &amp; Results Only</td>
                  <td className="px-4 py-2.5">Specimen tracking, Result entry, Verification &amp; Release</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-semibold">Pharmacist</td>
                  <td className="px-4 py-2.5">Mandatory TOTP</td>
                  <td className="px-4 py-2.5">Signed Prescriptions Only</td>
                  <td className="px-4 py-2.5">Rx review, Doctor clarification, Dispensing &amp; Inventory</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-semibold">Administrator</td>
                  <td className="px-4 py-2.5">Mandatory TOTP</td>
                  <td className="px-4 py-2.5 text-rose-700 font-semibold">Restricted (De-identified Only)</td>
                  <td className="px-4 py-2.5">Staffing, Schedules, Leaves, CMS, Audit Logs, Predictive Analytics</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. DOCTOR SCHEDULE MANAGEMENT */}
      {activeTab === 'schedules' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const docAcc = staffAccounts.find((s) => s.uid === schedDocUid);
              const existing = doctorSchedules.find((d) => d.doctorUid === schedDocUid);
              const name = docAcc?.fullName || existing?.doctorName;
              if (!schedDocUid || !name) {
                setFeedback({ type: 'err', text: 'Select an enrolled Doctor account first.' });
                return;
              }
              const res = await upsertDoctorScheduleAction({
                id: schedDocUid,
                doctorUid: schedDocUid,
                doctorName: name,
                specialty: docAcc?.specialty || existing?.specialty || 'General Medicine',
                workdays: schedWorkdays,
                startTime: schedStart,
                endTime: schedEnd,
                breakStart: schedBreakStart,
                breakEnd: schedBreakEnd,
                consultationDurationMinutes: Number(schedDuration) || 30,
                slotCapacity: 1,
                qualifiedServiceIds: services
                  .filter((s) => s.directlyBookable)
                  .map((s) => s.id),
                active: true,
              });
              if (res.ok) {
                setFeedback({ type: 'ok', text: `Published real-time schedule for ${name}.` });
              }
            }}
            className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4 text-xs"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              Configure Physician Working Hours
            </h2>
            <div>
              <label htmlFor="sch-doc" className="block font-semibold text-slate-700">
                Select Enrolled Physician
              </label>
              <select
                id="sch-doc"
                required
                value={schedDocUid}
                onChange={(e) => setSchedDocUid(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Choose Doctor</option>
                {doctorStaffList.map((d) => (
                  <option key={d.uid} value={d.uid}>
                    {d.fullName} ({d.specialty || 'Physician'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block font-semibold text-slate-700 mb-1.5">Active Workdays</span>
              <div className="flex flex-wrap gap-1.5">
                {WORKDAYS.map((w) => {
                  const checked = schedWorkdays.includes(w.idx);
                  return (
                    <button
                      key={w.idx}
                      type="button"
                      onClick={() =>
                        setSchedWorkdays((prev) =>
                          prev.includes(w.idx)
                            ? prev.filter((d) => d !== w.idx)
                            : [...prev, w.idx]
                        )
                      }
                      className={`rounded-md px-2.5 py-1 font-semibold ${
                        checked
                          ? 'bg-blue-700 text-white'
                          : 'border border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sch-st" className="block font-semibold text-slate-700">
                  Start Time
                </label>
                <input
                  id="sch-st"
                  type="time"
                  value={schedStart}
                  onChange={(e) => setSchedStart(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="sch-et" className="block font-semibold text-slate-700">
                  End Time
                </label>
                <input
                  id="sch-et"
                  type="time"
                  value={schedEnd}
                  onChange={(e) => setSchedEnd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="sch-bs" className="block font-semibold text-slate-700">
                  Break Start
                </label>
                <input
                  id="sch-bs"
                  type="time"
                  value={schedBreakStart}
                  onChange={(e) => setSchedBreakStart(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="sch-be" className="block font-semibold text-slate-700">
                  Break End
                </label>
                <input
                  id="sch-be"
                  type="time"
                  value={schedBreakEnd}
                  onChange={(e) => setSchedBreakEnd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sch-dur" className="block font-semibold text-slate-700">
                Consultation Slot Duration (minutes)
              </label>
              <select
                id="sch-dur"
                value={schedDuration}
                onChange={(e) => setSchedDuration(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
              >
                <option value="20">20 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800"
            >
              Publish Doctor Schedule
            </button>
          </form>

          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h2 className="font-display text-base font-bold text-slate-900">
              Published Doctor Schedules ({doctorSchedules.length})
            </h2>
            <div className="divide-y divide-slate-100 text-xs">
              {doctorSchedules.map((d) => (
                <div key={d.doctorUid} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">
                      {d.doctorName} ({d.specialty})
                    </p>
                    <p className="text-slate-600 tabular-nums">
                      {d.startTime} – {d.endTime} (Break {d.breakStart} – {d.breakEnd}) ·{' '}
                      {d.consultationDurationMinutes}m slots
                    </p>
                  </div>
                  <span className="font-semibold text-emerald-700">
                    {d.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. LEAVE MANAGEMENT */}
      {activeTab === 'leaves' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Physician Leave Requests &amp; Affected Appointment Protection
          </h1>
          <p className="text-xs text-slate-600">
            Approving a physician leave automatically blocks future bookings on those dates and
            flags affected appointments for penalty-free clinic rescheduling.
          </p>

          {leaveRequests.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No leave requests submitted.</p>
          ) : (
            <div className="divide-y divide-slate-200 text-xs">
              {leaveRequests.map((lv) => (
                <div
                  key={lv.id}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-slate-900">
                      {lv.doctorName} · {lv.startDate} to {lv.endDate}
                    </p>
                    <p className="text-slate-600">
                      Reason: {lv.reason} · Status: <strong>{lv.status}</strong>
                    </p>
                  </div>
                  {lv.status === 'Pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await reviewLeaveRequestAction({
                            leaveId: lv.id,
                            decision: 'Approved',
                            reviewNotes: 'Approved by Clinic Admin',
                          });
                          if (res.ok) {
                            setFeedback({
                              type: 'ok',
                              text: `Leave approved. ${res.affectedCount || 0} affected appointments flagged for clinic-assisted rescheduling without date penalty.`,
                            });
                          }
                        }}
                        className="rounded-lg bg-blue-700 px-3.5 py-1.5 font-semibold text-white"
                      >
                        Approve Leave
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          reviewLeaveRequestAction({
                            leaveId: lv.id,
                            decision: 'Rejected',
                            reviewNotes: 'Clinic coverage required',
                          })
                        }
                        className="rounded-lg border border-rose-200 px-3.5 py-1.5 font-semibold text-rose-700"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 7. CLINIC SERVICES MANAGEMENT */}
      {activeTab === 'services' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const id = `srv-${srvCode.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-3)}`;
              const res = await upsertClinicServiceAction({
                id,
                code: srvCode.toUpperCase(),
                name: srvName,
                category: srvCat,
                description: srvDesc,
                durationMinutes: Number(srvDur) || 30,
                baseFeePhp: Number(srvFee) || 500,
                directlyBookable: srvCat !== 'Laboratory',
                active: true,
              });
              if (res.ok) {
                setFeedback({ type: 'ok', text: 'Clinic service saved.' });
                setSrvCode('');
                setSrvName('');
                setSrvDesc('');
              }
            }}
            className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              Add Outpatient Service
            </h2>
            <input
              type="text"
              aria-label="Service code"
              required
              placeholder="Code (e.g., CONS-SPEC)"
              value={srvCode}
              onChange={(e) => setSrvCode(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
            />
            <input
              type="text"
              aria-label="Service name"
              required
              placeholder="Service Name"
              value={srvName}
              onChange={(e) => setSrvName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <select
              aria-label="Service category"
              value={srvCat}
              onChange={(e) => setSrvCat(e.target.value as ClinicService['category'])}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="Consultation">Consultation (Directly Bookable)</option>
              <option value="Follow-up">Follow-up (Directly Bookable)</option>
              <option value="Laboratory">Laboratory (Doctor-Ordered)</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                aria-label="Base fee PHP"
                required
                placeholder="Fee PHP"
                value={srvFee}
                onChange={(e) => setSrvFee(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
              />
              <input
                type="number"
                aria-label="Duration minutes"
                required
                placeholder="Mins"
                value={srvDur}
                onChange={(e) => setSrvDur(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
              />
            </div>
            <textarea
              rows={2}
              aria-label="Service description"
              required
              placeholder="Description"
              value={srvDesc}
              onChange={(e) => setSrvDesc(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
            >
              Save Clinic Service
            </button>
          </form>

          <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="font-display text-base font-bold text-slate-900">
              Active Services ({services.length})
            </h2>
            <div className="divide-y divide-slate-100 text-xs">
              {services.map((s) => (
                <div key={s.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">
                      {s.name} ({s.code})
                    </p>
                    <p className="text-slate-600 tabular-nums">
                      {s.category} · PHP {s.baseFeePhp.toFixed(2)} · {s.durationMinutes} mins
                    </p>
                  </div>
                  <span className="text-slate-500">
                    {s.directlyBookable ? 'Online Bookable' : 'Doctor Ordered'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 8. APPOINTMENT MONITORING */}
      {activeTab === 'appointments' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Administrative Appointment Monitoring ({appointments.length})
          </h1>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="px-3 py-2.5">Reference</th>
                  <th className="px-3 py-2.5">Patient</th>
                  <th className="px-3 py-2.5">Doctor &amp; Service</th>
                  <th className="px-3 py-2.5">Date &amp; Time</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-900">
                      {a.referenceNumber}
                    </td>
                    <td className="px-3 py-2.5">{a.patientName} ({a.patientId})</td>
                    <td className="px-3 py-2.5">
                      {a.doctorName} · {a.serviceName}
                    </td>
                    <td className="px-3 py-2.5">
                      {a.appointmentDate} {a.appointmentTime}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-blue-700">{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 9. PATIENT ADMINISTRATIVE RECORDS (Strictly non-clinical!) */}
      {activeTab === 'patients_admin' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">
              Patient Administrative Registry ({patients.length})
            </h1>
            <p className="text-xs text-slate-500">
              Privacy Enforcement: Administrators view administrative identifiers and registration
              metadata only. Confidential diagnoses and clinical notes are never exposed here.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="px-3 py-2.5">Patient ID</th>
                  <th className="px-3 py-2.5">Full Name</th>
                  <th className="px-3 py-2.5">DOB / Sex</th>
                  <th className="px-3 py-2.5">Registration Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {patients.map((p) => (
                  <tr key={p.patientId}>
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-900">
                      {p.patientId}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">{p.fullName}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {p.dateOfBirth} · {p.sex}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{p.registrationSource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 10. BILLING REPORTS & COVERAGE SETTINGS */}
      {activeTab === 'billing_reports' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await updateCoverageSettingsAction({
                ...coverageSettings,
                hmoProvidersAcceptedForManualVerification: hmoListText
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
                philHealthAdvisoryNote: philHealthNote,
                updatedAt: new Date().toISOString(),
              });
              if (res.ok) setFeedback({ type: 'ok', text: 'Coverage settings updated.' });
            }}
            className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-3 text-xs"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              HMO &amp; PhilHealth Manual Verification Settings
            </h2>
            <div>
              <label htmlFor="adm-hmo" className="block font-semibold text-slate-700">
                Accepted HMO Partners (Comma-separated, Manual LOA Verification)
              </label>
              <textarea
                id="adm-hmo"
                rows={3}
                value={hmoListText}
                onChange={(e) => setHmoListText(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="adm-ph" className="block font-semibold text-slate-700">
                PhilHealth Outpatient Advisory Note
              </label>
              <textarea
                id="adm-ph"
                rows={3}
                value={philHealthNote}
                onChange={(e) => setPhilHealthNote(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
            >
              Save Coverage Settings
            </button>
          </form>

          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-3 text-xs">
            <h2 className="font-display text-base font-bold text-slate-900">
              Billing Ledger ({billings.length} Statements)
            </h2>
            <div className="divide-y divide-slate-100 tabular-nums">
              {billings.map((b) => (
                <div key={b.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">
                      {b.invoiceRef} · {b.patientName}
                    </p>
                    <p className="text-slate-500">
                      {b.visitDate} · {b.coverageSource} · {b.paymentStatus}
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <p className="font-bold text-slate-900">Paid PHP {b.amountPaidPhp.toFixed(2)}</p>
                    <p className="text-slate-500">Bal PHP {b.remainingBalancePhp.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 11. PATIENT GUIDE CMS */}
      {activeTab === 'guide_cms' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const sectionTitles: Record<PatientGuideSectionItem['sectionKey'], string> = {
                hmo: 'HMO / Health Card Guidelines',
                philhealth: 'PhilHealth Guidelines',
                privacy: 'Privacy & Transparency',
                clinic_guides: 'Clinic Patient Guides',
              };
              const res = await upsertPatientGuideAction({
                id: `guide-${Date.now()}`,
                sectionKey: guideSection,
                sectionTitle: sectionTitles[guideSection],
                topicTitle: guideTitle,
                summary: guideSummary,
                bulletPoints: guideBullets
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
                importantNotice: guideNotice,
                lastUpdated: new Date().toISOString().slice(0, 10),
                updatedByName: 'Clinic Administration',
                published: true,
                sortOrder: patientGuides.length + 1,
              });
              if (res.ok) {
                setFeedback({ type: 'ok', text: 'Patient Guide article published.' });
                setGuideTitle('');
                setGuideSummary('');
                setGuideBullets('');
                setGuideNotice('');
              }
            }}
            className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-3 text-xs"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              Publish Patient Guide Article
            </h2>
            <select
              aria-label="Guide section"
              value={guideSection}
              onChange={(e) =>
                setGuideSection(e.target.value as PatientGuideSectionItem['sectionKey'])
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="hmo">HMO / Health Card Guidelines</option>
              <option value="philhealth">PhilHealth Guidelines</option>
              <option value="privacy">Privacy &amp; Transparency</option>
              <option value="clinic_guides">Clinic Patient Guides</option>
            </select>
            <input
              type="text"
              aria-label="Topic title"
              required
              placeholder="Topic Title"
              value={guideTitle}
              onChange={(e) => setGuideTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <textarea
              rows={2}
              aria-label="Summary"
              required
              placeholder="Plain-language summary"
              value={guideSummary}
              onChange={(e) => setGuideSummary(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <textarea
              rows={3}
              aria-label="Bullet points"
              placeholder="Checklist items (one per line)"
              value={guideBullets}
              onChange={(e) => setGuideBullets(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              type="text"
              aria-label="Important notice"
              placeholder="Optional important boundary notice"
              value={guideNotice}
              onChange={(e) => setGuideNotice(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
            >
              Publish to Public &amp; Portal Guide
            </button>
          </form>

          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-3 text-xs">
            <h2 className="font-display text-base font-bold text-slate-900">
              Published Guide Articles ({patientGuides.length})
            </h2>
            <div className="divide-y divide-slate-100">
              {patientGuides.map((g) => (
                <div key={g.id} className="py-3">
                  <p className="font-bold text-slate-900">
                    {g.topicTitle} · <span className="text-blue-700">{g.sectionTitle}</span>
                  </p>
                  <p className="text-slate-500 tabular-nums">Last updated: {g.lastUpdated}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 12. SECURITY & AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Security &amp; Administrative Audit Trail ({auditLogs.length})
          </h1>
          <div className="divide-y divide-slate-100 text-xs tabular-nums">
            {auditLogs.length === 0 ? (
              <p className="py-6 text-center text-slate-500">No audit events recorded yet.</p>
            ) : (
              auditLogs.slice(0, 50).map((log) => (
                <div key={log.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">
                      [{log.category}] {log.action} — {log.summary}
                    </p>
                    <p className="text-slate-500">
                      Actor: {log.actorEmail} ({log.actorRole}) · Target: {log.targetType}/{log.targetId}
                    </p>
                  </div>
                  <span className="text-slate-400 font-mono">
                    {log.createdAt.slice(0, 19).replace('T', ' ')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 13. SYSTEM SETTINGS & ARCHITECTURE TRANSPARENCY */}
      {activeTab === 'system' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 text-xs">
          <h1 className="font-display text-xl font-bold text-slate-900">
            System Architecture &amp; Deployment Transparency
          </h1>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5">
              <p className="font-bold text-slate-900">Active Runtime Persistence &amp; Auth</p>
              <p className="text-slate-600">
                Provisioned Cloud Firestore (`firestore.rules` RBAC enforced) + Firebase
                Authentication + Express Server-Side TOTP &amp; HMAC QR Verification (`/api/*`).
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5">
              <p className="font-bold text-slate-900">Clinic Timezone &amp; Notifications</p>
              <p className="text-slate-600">
                Timezone: <code>Asia/Manila</code> · Database-backed in-app notifications &amp;
                24-hour reminders active · Zero SMS / Zero paid push services configured.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 md:col-span-2">
              <p className="font-bold text-slate-900">
                External GitHub &amp; Supabase PostgreSQL Migration Readiness
              </p>
              <p className="text-slate-600">
                Full relational PostgreSQL schema (`supabase/migrations/001_smartclinic_schema.sql`),
                Row Level Security policies (`supabase/migrations/002_rls_policies.sql`),
                `.env.example`, and `vercel.json` are included in the repository for external
                Supabase/Vercel deployment.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 14. NOTIFICATIONS */}
      {activeTab === 'notifications' && (
        <NotificationHistoryView
          notifications={notifications}
          onMarkRead={markNotificationReadAction}
          onNavigate={onNavigate}
        />
      )}
    </StaffShell>
  );
};
