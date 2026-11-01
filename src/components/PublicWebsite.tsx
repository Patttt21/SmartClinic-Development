import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarCheck2,
  Clock,
  FileSpreadsheet,
  HeartPulse,
  Mail,
  MapPin,
  Menu,
  Phone,
  QrCode,
  ShieldCheck,
  Stethoscope,
  TestTube2,
  UserCheck,
  X,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import { PatientGuideView } from './PatientGuideView';

interface PublicWebsiteProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

const PUBLIC_NAV_ITEMS = [
  { label: 'Home', path: '/' },
  { label: 'About Us', path: '/about' },
  { label: 'Clinic Services', path: '/services' },
  { label: 'Our Doctors', path: '/doctors' },
  { label: 'Patient Guide', path: '/patient-guide' },
  { label: 'Contact Us', path: '/contact' },
];

const WORKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const PublicWebsite: React.FC<PublicWebsiteProps> = ({ currentPath, onNavigate }) => {
  const { services, doctorSchedules, patientGuides, patientAccount, staffAccount, mfaSessionVerified } =
    useClinic();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [inquirySubmitted, setInquirySubmitted] = useState(false);
  const [inquiryName, setInquiryName] = useState('');
  const [inquiryEmail, setInquiryEmail] = useState('');
  const [inquiryMessage, setInquiryMessage] = useState('');

  const activeDoctors = doctorSchedules.filter((d) => d.active);
  const activeServices = services.filter((s) => s.active);

  const handlePortalShortcut = () => {
    if (patientAccount) {
      onNavigate('/patient/dashboard');
    } else if (staffAccount && mfaSessionVerified) {
      const rolePath =
        staffAccount.role === 'pharmacist' ? 'pharmacy' : staffAccount.role;
      onNavigate(`/staff/${rolePath}/dashboard`);
    } else {
      onNavigate('/patient/login');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Public Top Navigation — ZERO Staff Login links */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          {/* Zone 1: Brand Mark */}
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="flex items-center gap-2.5 text-left shrink-0"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-700 text-white">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <span className="block font-display text-lg font-bold tracking-tight text-slate-900 leading-none">
                SmartClinic
              </span>
              <span className="block text-[11px] font-medium text-slate-500 mt-0.5 whitespace-nowrap">
                Outpatient Healthcare Center
              </span>
            </div>
          </button>

          {/* Zone 2: Public Navigation Links */}
          <nav aria-label="Public Website Navigation" className="hidden lg:flex items-center gap-1">
            {PUBLIC_NAV_ITEMS.map((item) => {
              const isActive = currentPath === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  className={`whitespace-nowrap shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Patient Portal Actions */}
          <div className="hidden sm:flex items-center gap-2.5 shrink-0">
            {patientAccount ? (
              <button
                type="button"
                onClick={handlePortalShortcut}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
              >
                Open Patient Portal
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate('/patient/login')}
                  className="whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Patient Login
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/patient/register')}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
                >
                  Book Appointment
                  <ArrowRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {/* Mobile Drawer Trigger */}
          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="inline-flex lg:hidden h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile Menu Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2">
            {PUBLIC_NAV_ITEMS.map((item) => (
              <button
                key={item.path}
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate(item.path);
                }}
                className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                  currentPath === item.path
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            ))}
            <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('/patient/login');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-700"
              >
                Patient Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('/patient/register');
                }}
                className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-center text-sm font-semibold text-white"
              >
                Create Patient Account
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        {currentPath === '/' && (
          <div>
            {/* Hero Section */}
            <section className="border-b border-slate-200 bg-white">
              <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
                <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
                  <div className="lg:col-span-7 space-y-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                      Coordinated Outpatient Medical Care
                    </p>
                    <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl sm:leading-[1.12]">
                      Scheduled consultations, walk-in care, and verified digital records in one clinic.
                    </h1>
                    <p className="max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
                      SmartClinic connects real-time doctor scheduling, QR-assisted front-desk check-in,
                      nursing triage, outpatient consultations, laboratory diagnostics, and pharmacy
                      dispensing—so every visit stays organized and transparent.
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate(patientAccount ? '/patient/book' : '/patient/register')
                        }
                        className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl bg-blue-700 px-6 py-3.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-800"
                      >
                        Book Outpatient Consultation
                        <ArrowRight className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate('/patient-guide')}
                        className="whitespace-nowrap shrink-0 rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        HMO, PhilHealth & Clinic Guide
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-xs text-slate-500">
                      <span>Real-time Doctor Slot Calculation</span>
                      <span>·</span>
                      <span>Privacy-Safe QR Check-In</span>
                      <span>·</span>
                      <span>Walk-In Patients Welcome</span>
                    </div>
                  </div>

                  {/* Right Clinical Journey Preview Card */}
                  <div className="lg:col-span-5">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-xs space-y-5">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                            Outpatient Visit Flow
                          </p>
                          <h2 className="mt-0.5 font-display text-lg font-bold text-slate-900">
                            How Your Clinic Visit Works
                          </h2>
                        </div>
                        <QrCode className="h-7 w-7 text-blue-700 shrink-0" />
                      </div>

                      <ol className="space-y-4">
                        {[
                          {
                            step: '01',
                            title: 'Book Online or Arrive as a Walk-In',
                            desc: 'Choose a specific physician or Any Available Doctor based on live schedule slots, or register directly at Reception.',
                          },
                          {
                            step: '02',
                            title: 'QR Check-In & Nursing Assessment',
                            desc: 'Present your privacy-safe QR pass at Reception, followed by structured vital signs and chief complaint triage.',
                          },
                          {
                            step: '03',
                            title: 'Physician Consultation & Diagnostics',
                            desc: 'Your doctor reviews nursing vitals seamlessly and orders laboratory tests or prescriptions only when clinically indicated.',
                          },
                          {
                            step: '04',
                            title: 'Released Digital Records & Clear Billing',
                            desc: 'Download finalized consultation summaries, verified lab reports, prescriptions, and itemized payment acknowledgments.',
                          },
                        ].map((item) => (
                          <li
                            key={item.step}
                            className="flex items-start gap-3.5 rounded-xl border border-slate-200 bg-white p-3.5"
                          >
                            <span className="font-mono text-xs font-bold text-blue-700 tabular-nums mt-0.5">
                              {item.step}
                            </span>
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                                {item.desc}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Core Clinic Capabilities */}
            <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 space-y-10">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                  Integrated Outpatient Care
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                  Designed Around Patient Safety & Clear Communication
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <CalendarCheck2 className="h-6 w-6 text-blue-700" />
                  <h3 className="mt-4 font-display text-base font-semibold text-slate-900">
                    Accurate Real-Time Scheduling
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Appointment slots are calculated directly from verified doctor workdays, consultation
                    durations, break periods, and approved leaves to prevent double-booking.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <TestTube2 className="h-6 w-6 text-blue-700" />
                  <h3 className="mt-4 font-display text-base font-semibold text-slate-900">
                    Verified Diagnostics & Pharmacy
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Laboratory results undergo formal verification before release to your portal, and
                    pharmacists review every prescription with direct physician clarification support.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <ShieldCheck className="h-6 w-6 text-blue-700" />
                  <h3 className="mt-4 font-display text-base font-semibold text-slate-900">
                    Strict Clinical Confidentiality
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Sensitive diagnoses and clinical notes remain restricted to authorized care
                    clinicians and the patient. QR check-in passes contain zero medical details.
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {currentPath === '/about' && (
          <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 space-y-8">
            <div className="border-b border-slate-200 pb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                About SmartClinic
              </p>
              <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
                Dedicated Single-Site Outpatient Healthcare Management
              </h1>
              <p className="mt-3 text-base leading-relaxed text-slate-600">
                SmartClinic is an outpatient medical center focused on timely primary consultations,
                follow-up care, basic clinical laboratory testing, and outpatient pharmacy dispensing.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
                <HeartPulse className="h-6 w-6 text-blue-700" />
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Outpatient Scope of Care
                </h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  We provide non-emergency outpatient consultations, vital signs assessment, diagnostic
                  laboratory tests ordered by clinic physicians, and outpatient prescription dispensing.
                  Patients presenting with life-threatening emergencies are immediately referred to an
                  acute hospital Emergency Department.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
                <UserCheck className="h-6 w-6 text-blue-700" />
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Walk-In & Online Continuity
                </h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  Patients do not need an online account to receive care at SmartClinic. Walk-in
                  patients receive a permanent clinical record at Reception and may optionally link
                  their past visits to a Patient Portal account later through staff verification.
                </p>
              </div>
            </div>
          </section>
        )}

        {currentPath === '/services' && (
          <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8 space-y-8">
            <div className="border-b border-slate-200 pb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                  Outpatient Clinical Catalog
                </p>
                <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
                  Clinic Services & Fee Transparency
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-600">
                  General and Follow-up Consultations can be booked online. Laboratory tests are ordered
                  by your attending SmartClinic physician during consultation when medically appropriate.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(patientAccount ? '/patient/book' : '/patient/login')}
                className="whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Schedule Consultation
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {activeServices.map((srv) => (
                <div
                  key={srv.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-blue-700">{srv.category}</span>
                      <span className="font-mono tabular-nums">{srv.code}</span>
                    </div>
                    <h2 className="mt-2 font-display text-lg font-semibold text-slate-900">
                      {srv.name}
                    </h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                      {srv.description}
                    </p>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-600 tabular-nums">
                    <span>
                      Standard Fee:{' '}
                      <strong className="text-slate-900">PHP {srv.baseFeePhp.toFixed(2)}</strong> ·{' '}
                      {srv.durationMinutes} mins
                    </span>
                    <span className="font-medium text-slate-700">
                      {srv.directlyBookable ? 'Online & Walk-In' : 'Doctor-Ordered'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentPath === '/doctors' && (
          <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8 space-y-8">
            <div className="border-b border-slate-200 pb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                Medical Roster & Schedules
              </p>
              <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
                Our Outpatient Physicians
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                SmartClinic publishes only verified active physicians and their configured clinic
                consultation hours. We never display placeholder or fabricated clinician credentials.
              </p>
            </div>

            {activeDoctors.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
                <Activity className="mx-auto h-8 w-8 text-blue-700" />
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Physician Schedules Pending Onboarding
                </h2>
                <p className="mx-auto max-w-lg text-sm text-slate-600">
                  No active physician schedules have been published yet. Once Clinic Administration
                  enrolls attending physicians and configures their weekly consultation hours, real-time
                  slot availability will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {activeDoctors.map((docItem) => (
                  <div
                    key={docItem.doctorUid}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6"
                  >
                    <div>
                      <p className="text-xs font-semibold text-blue-700">
                        {docItem.specialty || 'General Outpatient Medicine'}
                      </p>
                      <h2 className="mt-1 font-display text-lg font-bold text-slate-900">
                        {docItem.doctorName}
                      </h2>
                      <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
                        <p className="flex items-center justify-between">
                          <span className="text-slate-500">Consultation Days:</span>
                          <span className="font-medium text-slate-900">
                            {docItem.workdays.map((d) => WORKDAY_NAMES[d]).join(', ')}
                          </span>
                        </p>
                        <p className="flex items-center justify-between tabular-nums">
                          <span className="text-slate-500">Clinic Hours:</span>
                          <span className="font-medium text-slate-900">
                            {docItem.startTime} – {docItem.endTime}
                          </span>
                        </p>
                        <p className="flex items-center justify-between tabular-nums">
                          <span className="text-slate-500">Slot Duration:</span>
                          <span className="font-medium text-slate-900">
                            {docItem.consultationDurationMinutes} minutes
                          </span>
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onNavigate(patientAccount ? '/patient/book' : '/patient/login')}
                      className="mt-6 w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                    >
                      Book with {docItem.doctorName}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {currentPath === '/patient-guide' && (
          <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
            <PatientGuideView guides={patientGuides} />
          </section>
        )}

        {currentPath === '/contact' && (
          <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 space-y-8">
            <div className="border-b border-slate-200 pb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                Outpatient Clinic Desk
              </p>
              <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
                Contact & Clinic Hours
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Reach our outpatient reception desk for general scheduling questions, HMO LOA preparation,
                or walk-in clinic hours.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              <div className="lg:col-span-5 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 text-sm">
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
                    <div>
                      <h2 className="font-semibold text-slate-900">Standard Outpatient Hours</h2>
                      <p className="mt-1 text-slate-600 tabular-nums">
                        Monday – Saturday: 08:00 – 17:00 (Asia/Manila)
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Walk-in registration closes 30 minutes prior to end of clinic hours.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 border-t border-slate-100 pt-4">
                    <MapPin className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
                    <div>
                      <h2 className="font-semibold text-slate-900">Single-Site Clinic Location</h2>
                      <p className="mt-1 text-slate-600">
                        SmartClinic Outpatient Medical Center, Metro Manila, Philippines
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 border-t border-slate-100 pt-4">
                    <Phone className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
                    <div>
                      <h2 className="font-semibold text-slate-900">Reception & Patient Assistance</h2>
                      <p className="mt-1 text-slate-600 tabular-nums">(02) 8555-0190</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 border-t border-slate-100 pt-4">
                    <Mail className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
                    <div>
                      <h2 className="font-semibold text-slate-900">General Inquiries</h2>
                      <p className="mt-1 text-slate-600">frontdesk@smartclinic.ph</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!inquiryName.trim() || !inquiryEmail.trim() || !inquiryMessage.trim()) return;
                    setInquirySubmitted(true);
                  }}
                  className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
                >
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Send a Non-Urgent Outpatient Inquiry
                  </h2>
                  <p className="text-xs text-slate-500">
                    Please do not include confidential medical history in general inquiries. For acute
                    medical emergencies, proceed directly to the nearest hospital Emergency Department.
                  </p>

                  {inquirySubmitted ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                      Thank you, {inquiryName}. Your non-urgent inquiry has been logged for Front Desk
                      follow-up during clinic hours.
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="contact-name"
                            className="block text-xs font-semibold text-slate-700"
                          >
                            Full Name
                          </label>
                          <input
                            id="contact-name"
                            type="text"
                            required
                            value={inquiryName}
                            onChange={(e) => setInquiryName(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="contact-email"
                            className="block text-xs font-semibold text-slate-700"
                          >
                            Email Address
                          </label>
                          <input
                            id="contact-email"
                            type="email"
                            required
                            value={inquiryEmail}
                            onChange={(e) => setInquiryEmail(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          htmlFor="contact-message"
                          className="block text-xs font-semibold text-slate-700"
                        >
                          Question or Scheduling Inquiry
                        </label>
                        <textarea
                          id="contact-message"
                          rows={4}
                          required
                          value={inquiryMessage}
                          onChange={(e) => setInquiryMessage(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                        />
                      </div>
                      <button
                        type="submit"
                        className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
                      >
                        Submit Inquiry
                      </button>
                    </>
                  )}
                </form>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Clean Public Footer — ZERO Staff Login links */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-blue-700" />
            <span className="font-semibold text-slate-800">SmartClinic</span>
            <span>·</span>
            <span>Single-Site Outpatient Healthcare Center</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate('/services')}
              className="hover:text-slate-900 whitespace-nowrap"
            >
              Services
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/patient-guide')}
              className="hover:text-slate-900 whitespace-nowrap"
            >
              Patient Guide & Privacy
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/patient/login')}
              className="hover:text-slate-900 whitespace-nowrap"
            >
              Patient Portal
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
