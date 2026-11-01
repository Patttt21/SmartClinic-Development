import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Bell,
  BookOpen,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Download,
  Eye,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Pill,
  QrCode,
  RefreshCw,
  Stethoscope,
  TestTube2,
  User,
  X,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import {
  calculateAvailableDates,
  calculateAvailableSlots,
  getManilaDateIso,
  getManilaTimeHhMm,
  validateReplacementDateRule,
} from '../utils/scheduling';
import type { Appointment, FollowUpRecommendation } from '../types/clinic';
import { PatientGuideView } from './PatientGuideView';
import {
  NotificationBell,
  NotificationHistoryView,
  NotificationToastStack,
} from './NotificationCenter';
import { DocumentModalPayload, DocumentViewerModal } from './DocumentViewerModal';
import {
  downloadAppointmentPassPdf,
  downloadBillingReceiptPdf,
  downloadConsultationPdf,
  downloadLabResultPdf,
  downloadPrescriptionPdf,
} from '../utils/pdfGenerator';

interface PatientPortalProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

const PATIENT_NAV = [
  { label: 'Dashboard', path: '/patient/dashboard', icon: LayoutDashboard },
  { label: 'Book Appointment', path: '/patient/book', icon: CalendarPlus },
  { label: 'My Appointments', path: '/patient/appointments', icon: Calendar },
  { label: 'Appointment QR Code', path: '/patient/qr', icon: QrCode },
  { label: 'Medical Records', path: '/patient/medical-records', icon: FileText },
  { label: 'Laboratory Results', path: '/patient/laboratory', icon: TestTube2 },
  { label: 'Prescriptions', path: '/patient/prescriptions', icon: Pill },
  { label: 'Billing & Receipts', path: '/patient/billing', icon: CreditCard },
  { label: 'Follow-up Care', path: '/patient/follow-up', icon: RefreshCw },
  { label: 'Patient Guide', path: '/patient/guide', icon: BookOpen },
  { label: 'Notifications', path: '/patient/notifications', icon: Bell },
  { label: 'My Profile', path: '/patient/profile', icon: User },
];

export const PatientPortal: React.FC<PatientPortalProps> = ({ currentPath, onNavigate }) => {
  const {
    firebaseUser,
    patientAccount,
    patients,
    services,
    doctorSchedules,
    bookedSlots,
    approvedLeaves,
    appointments,
    consultations,
    labOrders,
    prescriptions,
    billings,
    followUps,
    linkRequests,
    patientGuides,
    notifications,
    bookAppointmentAction,
    cancelAppointmentAction,
    submitRecordLinkRequestAction,
    updatePatientDemographicsAction,
    updatePatientOptionalMfaAction,
    markNotificationReadAction,
    dismissNotificationPopupAction,
    logoutAction,
  } = useClinic();

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [docModal, setDocModal] = useState<DocumentModalPayload | null>(null);

  // Booking & Rescheduling State
  const bookableServices = useMemo(
    () => services.filter((s) => s.active && s.directlyBookable),
    [services]
  );
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    bookableServices[0]?.id || 'srv-general-consult'
  );
  const [selectedDoctorUid, setSelectedDoctorUid] = useState<string>('any');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [reasonForVisit, setReasonForVisit] = useState<string>('');
  const [activeRescheduleAppt, setActiveRescheduleAppt] = useState<Appointment | null>(null);
  const [activeFollowUpRec, setActiveFollowUpRec] = useState<FollowUpRecommendation | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingFeedback, setBookingFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Cancel Inline Modal State
  const [cancellingAppt, setCancellingAppt] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('Schedule conflict');
  const [cancelBusy, setCancelBusy] = useState(false);

  // QR Pass Rendering
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  // Profile & Walk-in Record Link State
  const ownClinicalRecord = useMemo(
    () =>
      patients.find(
        (p) =>
          p.patientId === patientAccount?.linkedPatientId ||
          (firebaseUser && p.portalUserId === firebaseUser.uid)
      ) || null,
    [patients, patientAccount, firebaseUser]
  );

  const [profilePhone, setProfilePhone] = useState(patientAccount?.phone || '');
  const [profileAddress, setProfileAddress] = useState(ownClinicalRecord?.address || '');
  const [profileAllergies, setProfileAllergies] = useState(ownClinicalRecord?.allergies || '');
  const [profileMsg, setProfileMsg] = useState('');

  const [linkKnownPtId, setLinkKnownPtId] = useState('');
  const [linkLastVisitDate, setLinkLastVisitDate] = useState('');
  const [linkMsg, setLinkMsg] = useState('');

  // Optional Patient TOTP Setup State
  const [optMfaSetup, setOptMfaSetup] = useState<{
    secretBase32: string;
    encryptedSecret: string;
    qrDataUrl: string;
  } | null>(null);
  const [optMfaCode, setOptMfaCode] = useState('');
  const [optMfaMsg, setOptMfaMsg] = useState('');

  useEffect(() => {
    if (patientAccount) {
      setProfilePhone(patientAccount.phone);
    }
    if (ownClinicalRecord) {
      setProfileAddress(ownClinicalRecord.address);
      setProfileAllergies(ownClinicalRecord.allergies);
    }
  }, [patientAccount, ownClinicalRecord]);

  // Own Appointments, Records, Released Labs, Prescriptions, Billings
  const myAppointments = useMemo(
    () =>
      appointments
        .filter(
          (a) =>
            a.portalUserId === firebaseUser?.uid ||
            (patientAccount?.linkedPatientId && a.patientId === patientAccount.linkedPatientId)
        )
        .sort((a, b) => `${b.appointmentDate}${b.appointmentTime}`.localeCompare(`${a.appointmentDate}${a.appointmentTime}`)),
    [appointments, firebaseUser, patientAccount]
  );

  const upcomingAppointments = useMemo(
    () =>
      myAppointments
        .filter((a) => a.status === 'Confirmed' || a.status === 'Checked In' || a.status === 'Needs Clinic Reschedule')
        .sort((a, b) => `${a.appointmentDate}${a.appointmentTime}`.localeCompare(`${b.appointmentDate}${b.appointmentTime}`)),
    [myAppointments]
  );

  // Check if patient has a recent patient-initiated cancelled appointment whose date must remain blocked
  const mostRecentPatientCancelled = useMemo(
    () =>
      myAppointments.find(
        (a) => a.status === 'Cancelled' && a.changeInitiator === 'patient'
      ) || null,
    [myAppointments]
  );

  // Merge bookedSlots + appointments for accurate non-overlapping slot calculation
  const occupiedAppointmentsForSlotCalc = useMemo(() => {
    const byId = new Map<string, Appointment>();
    for (const a of appointments) {
      byId.set(a.id, a);
    }
    for (const s of bookedSlots) {
      if (!s.active || byId.has(s.appointmentId)) continue;
      byId.set(s.appointmentId, {
        id: s.appointmentId,
        referenceNumber: '',
        patientId: '',
        portalUserId: '',
        patientName: '',
        serviceId: '',
        serviceName: '',
        bookingMode: 'Specific Doctor',
        doctorUid: s.doctorUid,
        doctorName: '',
        appointmentDate: s.appointmentDate,
        appointmentTime: s.appointmentTime,
        endTime: s.endTime,
        durationMinutes: s.durationMinutes,
        status: 'Confirmed',
        qrToken: '',
        qrStatus: 'Active',
        blockedReplacementDates: [],
        minReplacementDate: '',
        previousAppointmentId: '',
        followUpRecommendationId: '',
        reasonForVisit: '',
        checkedInAt: '',
        visitId: '',
        statusHistory: [],
        authorizedViewerUids: [],
        createdAt: '',
        updatedAt: '',
      });
    }
    return Array.from(byId.values());
  }, [appointments, bookedSlots]);

  const todayManila = getManilaDateIso();
  const nowHhMmManila = getManilaTimeHhMm();

  const activeReplacementSource = activeRescheduleAppt || mostRecentPatientCancelled;
  const activeReplacementInitiator: 'patient' | 'clinic' =
    activeRescheduleAppt?.status === 'Needs Clinic Reschedule' ? 'clinic' : 'patient';

  const selectedServiceObj = useMemo(
    () => bookableServices.find((s) => s.id === selectedServiceId) || bookableServices[0],
    [bookableServices, selectedServiceId]
  );

  const availableDates = useMemo(() => {
    if (!selectedServiceObj) return [];
    return calculateAvailableDates({
      schedules: doctorSchedules,
      doctorUid: selectedDoctorUid === 'any' ? 'any' : selectedDoctorUid,
      serviceId: selectedServiceObj.id,
      serviceDurationMinutes: selectedServiceObj.durationMinutes,
      todayIsoDate: todayManila,
      currentHhMm: nowHhMmManila,
      horizonDays: 30,
      leaves: approvedLeaves,
      existingAppointments: occupiedAppointmentsForSlotCalc,
      excludeAppointmentId: activeRescheduleAppt?.id,
      replacementContext: activeReplacementSource
        ? {
            originalAppointment: activeReplacementSource,
            initiator: activeReplacementInitiator,
          }
        : undefined,
    });
  }, [
    selectedServiceObj,
    doctorSchedules,
    selectedDoctorUid,
    todayManila,
    nowHhMmManila,
    approvedLeaves,
    occupiedAppointmentsForSlotCalc,
    activeRescheduleAppt,
    activeReplacementSource,
    activeReplacementInitiator,
  ]);

  const availableTimeSlots = useMemo(() => {
    if (!selectedServiceObj || !selectedDate) return [];
    if (activeReplacementSource) {
      const check = validateReplacementDateRule({
        originalAppointment: activeReplacementSource,
        proposedDate: selectedDate,
        initiator: activeReplacementInitiator,
        todayIsoDate: todayManila,
      });
      if (!check.allowed) return [];
    }
    return calculateAvailableSlots({
      schedules: doctorSchedules,
      doctorUid: selectedDoctorUid === 'any' ? 'any' : selectedDoctorUid,
      serviceId: selectedServiceObj.id,
      serviceDurationMinutes: selectedServiceObj.durationMinutes,
      isoDate: selectedDate,
      todayIsoDate: todayManila,
      currentHhMm: nowHhMmManila,
      leaves: approvedLeaves,
      existingAppointments: occupiedAppointmentsForSlotCalc,
      excludeAppointmentId: activeRescheduleAppt?.id,
    });
  }, [
    selectedServiceObj,
    selectedDate,
    activeReplacementSource,
    activeReplacementInitiator,
    todayManila,
    doctorSchedules,
    selectedDoctorUid,
    nowHhMmManila,
    approvedLeaves,
    occupiedAppointmentsForSlotCalc,
    activeRescheduleAppt,
  ]);

  // Generate QR Data URLs for active appointments
  useEffect(() => {
    let active = true;
    (async () => {
      const nextMap: Record<string, string> = {};
      for (const appt of myAppointments) {
        if (appt.qrToken) {
          try {
            nextMap[appt.id] = await QRCode.toDataURL(appt.qrToken, { margin: 1, width: 220 });
          } catch {
            // ignore QR generation fallback
          }
        }
      }
      if (active) setQrMap(nextMap);
    })();
    return () => {
      active = false;
    };
  }, [myAppointments]);

  const myFinalizedConsultations = useMemo(
    () => consultations.filter((c) => c.patientVisible && c.status === 'Finalized'),
    [consultations]
  );

  const myReleasedLabs = useMemo(
    () => labOrders.filter((l) => l.patientVisible && l.status === 'Released'),
    [labOrders]
  );

  const myReleasedPrescriptions = useMemo(
    () => prescriptions.filter((p) => p.patientVisible),
    [prescriptions]
  );

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingFeedback(null);
    if (!patientAccount || !firebaseUser) return;

    if (!patientAccount.linkedPatientId) {
      setBookingFeedback({
        type: 'error',
        text: 'Please link your walk-in record or create a clinical Patient ID inside My Profile first.',
      });
      return;
    }

    if (!selectedDate || !selectedTime || !selectedServiceObj) {
      setBookingFeedback({
        type: 'error',
        text: 'Please choose a service, an available date, and an open time slot.',
      });
      return;
    }

    // Validate replacement-date blocking rule explicitly before submission
    if (activeReplacementSource) {
      const check = validateReplacementDateRule({
        originalAppointment: activeReplacementSource,
        proposedDate: selectedDate,
        initiator: activeReplacementInitiator,
        todayIsoDate: todayManila,
      });
      if (!check.allowed) {
        setBookingFeedback({
          type: 'error',
          text: check.reason || 'Selected replacement date is restricted.',
        });
        return;
      }
    }

    setBookingBusy(true);
    const res = await bookAppointmentAction({
      patientId: patientAccount.linkedPatientId,
      portalUserId: firebaseUser.uid,
      patientName: patientAccount.fullName,
      serviceId: selectedServiceObj.id,
      doctorUid: selectedDoctorUid === 'any' ? 'any' : selectedDoctorUid,
      appointmentDate: selectedDate,
      appointmentTime: selectedTime,
      reasonForVisit: reasonForVisit || selectedServiceObj.name,
      followUpRecommendationId: activeFollowUpRec?.id,
      rescheduleFromAppointment: activeRescheduleAppt || mostRecentPatientCancelled || undefined,
      rescheduleInitiator: activeReplacementInitiator,
    });
    setBookingBusy(false);

    if (!res.ok || !res.appointment) {
      setBookingFeedback({
        type: 'error',
        text: res.error || 'Could not book appointment.',
      });
      return;
    }

    setBookingFeedback({
      type: 'success',
      text: `Appointment confirmed! Reference ${res.appointment.referenceNumber} on ${res.appointment.appointmentDate} at ${res.appointment.appointmentTime} with ${res.appointment.doctorName}.`,
    });
    setActiveRescheduleAppt(null);
    setActiveFollowUpRec(null);
    setSelectedTime('');
    setReasonForVisit('');
  };

  const startRescheduleFlow = (appt: Appointment) => {
    setActiveRescheduleAppt(appt);
    setSelectedServiceId(appt.serviceId);
    setSelectedDoctorUid(appt.status === 'Needs Clinic Reschedule' ? 'any' : appt.doctorUid);
    setSelectedDate('');
    setSelectedTime('');
    setBookingFeedback(null);
    onNavigate('/patient/book');
  };

  const startFollowUpBooking = (rec: FollowUpRecommendation) => {
    const followService =
      bookableServices.find((s) => s.category === 'Follow-up') || bookableServices[0];
    setActiveFollowUpRec(rec);
    if (followService) setSelectedServiceId(followService.id);
    setSelectedDoctorUid(rec.doctorUid || 'any');
    setSelectedDate(rec.recommendedDate >= todayManila ? rec.recommendedDate : '');
    setReasonForVisit(`Follow-up: ${rec.reason}`);
    setBookingFeedback(null);
    onNavigate('/patient/book');
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-white">
            <Stethoscope className="h-4 w-4" />
          </div>
          <div>
            <span className="block font-display text-base font-bold text-slate-900 leading-none">
              SmartClinic
            </span>
            <span className="block text-[11px] text-slate-500 mt-0.5">Patient Portal</span>
          </div>
        </div>

        <nav aria-label="Patient Portal Navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {PATIENT_NAV.map((item) => {
            const Icon = item.icon;
            const active = currentPath === item.path;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => onNavigate(item.path)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={async () => {
              await logoutAction();
              onNavigate('/');
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex flex-1 flex-col lg:pl-64">
        {/* Top Header */}
        <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open patient navigation menu"
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden rounded-lg border border-slate-200 p-2 text-slate-700"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {patientAccount?.fullName || firebaseUser?.email}
              </p>
              <p className="text-xs text-slate-500 tabular-nums">
                Patient ID: {patientAccount?.linkedPatientId || 'Pending Record Link'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="hidden sm:inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
            >
              Public Clinic Site
            </button>
            <NotificationBell
              notifications={notifications}
              onMarkRead={markNotificationReadAction}
              onNavigate={onNavigate}
              onOpenFullCenter={() => onNavigate('/patient/notifications')}
            />
          </div>
        </header>

        {/* Mobile Sidebar Drawer */}
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-900/50"
              onClick={() => setMobileDrawerOpen(false)}
              aria-hidden="true"
            />
            <div className="relative z-50 flex w-72 flex-col bg-white p-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-display text-base font-bold text-slate-900">
                  Patient Portal
                </span>
                <button
                  type="button"
                  aria-label="Close patient navigation menu"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="rounded-lg p-1.5 text-slate-500"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="mt-3 flex-1 overflow-y-auto space-y-1">
                {PATIENT_NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => {
                        setMobileDrawerOpen(false);
                        onNavigate(item.path);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                        currentPath === item.path
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
              <button
                type="button"
                onClick={async () => {
                  setMobileDrawerOpen(false);
                  await logoutAction();
                  onNavigate('/');
                }}
                className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-rose-700"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        )}

        {/* Active View Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
          {/* 1. DASHBOARD */}
          {currentPath === '/patient/dashboard' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-900">
                    Patient Health Overview
                  </h1>
                  <p className="text-sm text-slate-600">
                    Manage upcoming outpatient visits, QR check-in passes, and released clinical
                    documents.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('/patient/book')}
                  className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  <CalendarPlus className="h-4 w-4" />
                  Book New Appointment
                </button>
              </div>

              {/* Top Summary Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-medium text-slate-500">Upcoming Appointment</p>
                  <p className="mt-2 font-display text-xl font-bold text-slate-900 tabular-nums">
                    {upcomingAppointments[0]
                      ? `${upcomingAppointments[0].appointmentDate} · ${upcomingAppointments[0].appointmentTime}`
                      : 'None Scheduled'}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {upcomingAppointments[0]
                      ? `${upcomingAppointments[0].doctorName} · ${upcomingAppointments[0].status}`
                      : 'Book online based on live doctor hours'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-medium text-slate-500">Released Medical Records</p>
                  <p className="mt-2 font-display text-xl font-bold text-slate-900 tabular-nums">
                    {myFinalizedConsultations.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Finalized consultation summaries
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-medium text-slate-500">Released Lab & Rx</p>
                  <p className="mt-2 font-display text-xl font-bold text-slate-900 tabular-nums">
                    {myReleasedLabs.length} Labs · {myReleasedPrescriptions.length} Rx
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Verified diagnostics & signed prescriptions
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-medium text-slate-500">Follow-up Care</p>
                  <p className="mt-2 font-display text-xl font-bold text-slate-900 tabular-nums">
                    {followUps.filter((f) => f.status === 'Recommended').length} Active
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Doctor-recommended return visits
                  </p>
                </div>
              </div>

              {/* Next Appointment + QR Quick Card & Recent Documents */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Active Check-In Pass
                    </h2>
                    <button
                      type="button"
                      onClick={() => onNavigate('/patient/qr')}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      Open QR Pass
                    </button>
                  </div>
                  {upcomingAppointments[0] ? (
                    <div className="flex flex-col sm:flex-row items-center gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      {qrMap[upcomingAppointments[0].id] && (
                        <img
                          src={qrMap[upcomingAppointments[0].id]}
                          alt="Appointment QR Code"
                          className="h-28 w-28 rounded-lg border border-slate-200 bg-white p-1.5 shrink-0"
                        />
                      )}
                      <div className="space-y-1 text-xs">
                        <p className="font-mono font-bold text-slate-900 tabular-nums">
                          {upcomingAppointments[0].referenceNumber}
                        </p>
                        <p className="font-semibold text-slate-800">
                          {upcomingAppointments[0].serviceName}
                        </p>
                        <p className="text-slate-600">{upcomingAppointments[0].doctorName}</p>
                        <p className="text-slate-600 tabular-nums">
                          {upcomingAppointments[0].appointmentDate} ·{' '}
                          {upcomingAppointments[0].appointmentTime}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      No upcoming confirmed appointment. Once you schedule a consultation, your
                      QR check-in code will appear here automatically.
                    </p>
                  )}
                </div>

                <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Recent Released Documents
                    </h2>
                    <button
                      type="button"
                      onClick={() => onNavigate('/patient/medical-records')}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      View All Records
                    </button>
                  </div>

                  {myFinalizedConsultations.length === 0 &&
                  myReleasedLabs.length === 0 &&
                  myReleasedPrescriptions.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No clinical documents released yet. Finalized consultation summaries,
                      verified lab reports, and prescriptions appear here immediately after clinician
                      release.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 text-xs">
                      {myFinalizedConsultations.slice(0, 2).map((c) => (
                        <div key={c.id} className="flex items-center justify-between py-2.5">
                          <div>
                            <p className="font-semibold text-slate-900">
                              Consultation Summary · {c.visitDate}
                            </p>
                            <p className="text-slate-500">{c.doctorName}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDocModal({
                                type: 'consultation',
                                record: c,
                                patient: ownClinicalRecord,
                              })
                            }
                            className="font-semibold text-blue-700 hover:underline"
                          >
                            View / PDF
                          </button>
                        </div>
                      ))}
                      {myReleasedLabs.slice(0, 2).map((l) => (
                        <div key={l.id} className="flex items-center justify-between py-2.5">
                          <div>
                            <p className="font-semibold text-slate-900">
                              Lab Result: {l.testName}
                            </p>
                            <p className="text-slate-500 tabular-nums">{l.orderNumber}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDocModal({ type: 'lab', record: l })}
                            className="font-semibold text-blue-700 hover:underline"
                          >
                            View / PDF
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. BOOK APPOINTMENT */}
          {currentPath === '/patient/book' && (
            <div className="space-y-6">
              <div className="border-b border-slate-200 pb-4">
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  {activeRescheduleAppt
                    ? `Reschedule Appointment (${activeRescheduleAppt.referenceNumber})`
                    : 'Book Outpatient Appointment'}
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Slots are calculated live from verified physician workdays, consultation
                  durations, break windows, approved leaves, and existing bookings.
                </p>
              </div>

              {activeReplacementSource && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 space-y-1">
                  <p className="font-semibold">
                    {activeReplacementInitiator === 'clinic'
                      ? 'Clinic-Initiated Rescheduling (No Date Penalty)'
                      : 'Voluntary Cancellation / Rescheduling Date Policy Active'}
                  </p>
                  <p>
                    {activeReplacementInitiator === 'clinic'
                      ? `Because your original appointment on ${activeReplacementSource.appointmentDate} was affected by a clinic schedule change, you may select the same date with an alternative available doctor or choose any future open date.`
                      : `Per SmartClinic scheduling policy, your previous appointment date (${activeReplacementSource.appointmentDate}) cannot be selected again. Available dates shown below begin strictly after ${activeReplacementSource.appointmentDate}.`}
                  </p>
                  {activeRescheduleAppt && (
                    <button
                      type="button"
                      onClick={() => setActiveRescheduleAppt(null)}
                      className="mt-1 font-semibold underline"
                    >
                      Exit Reschedule Mode
                    </button>
                  )}
                </div>
              )}

              {bookingFeedback && (
                <div
                  className={`rounded-xl border p-4 text-sm ${
                    bookingFeedback.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-rose-200 bg-rose-50 text-rose-900'
                  }`}
                >
                  {bookingFeedback.text}
                </div>
              )}

              {doctorSchedules.filter((d) => d.active).length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-2">
                  <p className="font-semibold text-slate-900">
                    No Active Doctor Schedules Configured Yet
                  </p>
                  <p className="text-xs text-slate-500 max-w-lg mx-auto">
                    Online booking slots appear automatically once Clinic Administration configures
                    active physician workdays and working hours. Walk-in consultation remains
                    available during clinic hours.
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={handleConfirmBooking}
                  className="rounded-xl border border-slate-200 bg-white p-6 space-y-6"
                >
                  {/* Step 1 & 2: Service & Doctor Selection */}
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor="book-service"
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                      >
                        1. Outpatient Service
                      </label>
                      <select
                        id="book-service"
                        value={selectedServiceId}
                        onChange={(e) => {
                          setSelectedServiceId(e.target.value);
                          setSelectedDate('');
                          setSelectedTime('');
                        }}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-medium"
                      >
                        {bookableServices.map((srv) => (
                          <option key={srv.id} value={srv.id}>
                            {srv.name} — PHP {srv.baseFeePhp.toFixed(0)} ({srv.durationMinutes} mins)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="book-doctor"
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                      >
                        2. Physician Preference
                      </label>
                      <select
                        id="book-doctor"
                        value={selectedDoctorUid}
                        onChange={(e) => {
                          setSelectedDoctorUid(e.target.value);
                          setSelectedDate('');
                          setSelectedTime('');
                        }}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-medium"
                      >
                        <option value="any">
                          Any Available Doctor (Auto-assigns least-loaded available physician)
                        </option>
                        {doctorSchedules
                          .filter(
                            (d) =>
                              d.active &&
                              (!selectedServiceObj ||
                                d.qualifiedServiceIds.includes(selectedServiceObj.id))
                          )
                          .map((docItem) => (
                            <option key={docItem.doctorUid} value={docItem.doctorUid}>
                              {docItem.doctorName} ({docItem.specialty || 'Outpatient Medicine'})
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Step 3: Available Date Picker */}
                  <div>
                    <label
                      htmlFor="book-date-input"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                    >
                      3. Select Available Date
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <input
                        id="book-date-input"
                        type="date"
                        min={todayManila}
                        value={selectedDate}
                        onChange={(e) => {
                          setSelectedDate(e.target.value);
                          setSelectedTime('');
                        }}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                      />
                      <span className="text-xs text-slate-500">
                        Or pick from next open clinic dates:
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
                      {availableDates.slice(0, 12).map((d) => (
                        <button
                          key={d.isoDate}
                          type="button"
                          onClick={() => {
                            setSelectedDate(d.isoDate);
                            setSelectedTime('');
                          }}
                          className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors tabular-nums ${
                            selectedDate === d.isoDate
                              ? 'border-blue-700 bg-blue-700 text-white font-semibold'
                              : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
                          }`}
                        >
                          <span className="block font-semibold">{d.isoDate}</span>
                          <span
                            className={`block text-[11px] ${
                              selectedDate === d.isoDate ? 'text-blue-100' : 'text-slate-500'
                            }`}
                          >
                            {d.openSlotCount} slots open
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Step 4: Available Time Slots */}
                  {selectedDate && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        4. Select Available Time Slot on {selectedDate}
                      </p>
                      {activeReplacementSource &&
                        !validateReplacementDateRule({
                          originalAppointment: activeReplacementSource,
                          proposedDate: selectedDate,
                          initiator: activeReplacementInitiator,
                          todayIsoDate: todayManila,
                        }).allowed && (
                          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                            {
                              validateReplacementDateRule({
                                originalAppointment: activeReplacementSource,
                                proposedDate: selectedDate,
                                initiator: activeReplacementInitiator,
                                todayIsoDate: todayManila,
                              }).reason
                            }
                          </div>
                        )}

                      {availableTimeSlots.length === 0 ? (
                        <p className="mt-2 text-xs text-slate-500">
                          No open time slots available for this date. Please choose another date
                          above.
                        </p>
                      ) : (
                        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
                          {availableTimeSlots.map((slot) => (
                            <button
                              key={slot.startTime}
                              type="button"
                              onClick={() => setSelectedTime(slot.startTime)}
                              className={`rounded-lg border px-3 py-2 text-center text-xs font-medium tabular-nums transition-colors ${
                                selectedTime === slot.startTime
                                  ? 'border-blue-700 bg-blue-700 text-white font-semibold'
                                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                              }`}
                            >
                              {slot.startTime} – {slot.endTime}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 5: Reason for Visit & Review */}
                  <div>
                    <label
                      htmlFor="book-reason"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                    >
                      5. Brief Chief Complaint / Reason for Visit
                    </label>
                    <input
                      id="book-reason"
                      type="text"
                      required
                      placeholder="e.g., Persistent cough for 3 days, Blood pressure follow-up"
                      value={reasonForVisit}
                      onChange={(e) => setReasonForVisit(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
                    <div className="text-xs text-slate-600 tabular-nums">
                      {selectedDate && selectedTime ? (
                        <span>
                          Selected: <strong className="text-slate-900">{selectedDate}</strong> at{' '}
                          <strong className="text-slate-900">{selectedTime}</strong> ·{' '}
                          {selectedServiceObj?.name}
                        </span>
                      ) : (
                        <span>Select a date and time slot to enable confirmation.</span>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={bookingBusy || !selectedDate || !selectedTime}
                      className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {bookingBusy
                        ? 'Confirming Slot...'
                        : activeRescheduleAppt
                        ? 'Confirm Rescheduled Appointment'
                        : 'Confirm Appointment'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* 3. MY APPOINTMENTS */}
          {currentPath === '/patient/appointments' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-slate-900">
                    My Appointments
                  </h1>
                  <p className="text-sm text-slate-600">
                    View scheduled visits, reschedule, or cancel with full audit history.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('/patient/book')}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  New Booking
                </button>
              </div>

              {cancellingAppt && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-5 space-y-3">
                  <h2 className="text-sm font-bold text-rose-900">
                    Confirm Voluntary Cancellation — {cancellingAppt.referenceNumber}
                  </h2>
                  <p className="text-xs text-rose-800">
                    Important Policy Notice: If you voluntarily cancel your{' '}
                    <strong>{cancellingAppt.appointmentDate}</strong> appointment,{' '}
                    <strong>{cancellingAppt.appointmentDate}</strong> cannot be selected again for a
                    replacement booking (earliest allowed replacement date will be after{' '}
                    {cancellingAppt.appointmentDate}).
                  </p>
                  <div>
                    <label htmlFor="cancel-reason-input" className="block text-xs font-semibold text-rose-900">
                      Cancellation Reason
                    </label>
                    <input
                      id="cancel-reason-input"
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="mt-1 w-full max-w-md rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={cancelBusy}
                      onClick={async () => {
                        setCancelBusy(true);
                        await cancelAppointmentAction(
                          cancellingAppt.id,
                          'patient',
                          cancelReason || 'Patient cancelled via portal'
                        );
                        setCancelBusy(false);
                        setCancellingAppt(null);
                      }}
                      className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800"
                    >
                      {cancelBusy ? 'Cancelling...' : 'Confirm Cancellation'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancellingAppt(null)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                    >
                      Keep Appointment
                    </button>
                  </div>
                </div>
              )}

              {myAppointments.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  You have no scheduled or past online appointments yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {myAppointments.map((appt) => (
                    <div
                      key={appt.id}
                      className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                          <span className="font-mono font-bold text-slate-900">
                            {appt.referenceNumber}
                          </span>
                          <span>·</span>
                          <span className="font-semibold text-blue-700">{appt.status}</span>
                          <span>·</span>
                          <span>
                            {appt.appointmentDate} at {appt.appointmentTime} – {appt.endTime}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {appt.serviceName} with {appt.doctorName}
                        </h3>
                        <p className="text-xs text-slate-600">
                          Reason: {appt.reasonForVisit || 'Outpatient consultation'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(appt.status === 'Confirmed' ||
                          appt.status === 'Needs Clinic Reschedule') && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setDocModal({
                                  type: 'appointment',
                                  record: appt,
                                  qrDataUrl: qrMap[appt.id],
                                })
                              }
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              QR Pass
                            </button>
                            <button
                              type="button"
                              onClick={() => startRescheduleFlow(appt)}
                              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              Reschedule
                            </button>
                            {appt.status === 'Confirmed' && (
                              <button
                                type="button"
                                onClick={() => setCancellingAppt(appt)}
                                className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                              >
                                Cancel
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. APPOINTMENT QR CODE */}
          {currentPath === '/patient/qr' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Appointment QR Check-In Passes
                </h1>
                <p className="text-sm text-slate-600">
                  Present your active QR code at Front Desk Reception. Each QR contains only a
                  signed opaque token—never diagnoses or medical notes.
                </p>
              </div>

              {upcomingAppointments.filter((a) => a.status === 'Confirmed').length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No active confirmed appointment QR pass at the moment.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {upcomingAppointments
                    .filter((a) => a.status === 'Confirmed')
                    .map((appt) => (
                      <div
                        key={appt.id}
                        className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-mono text-xs font-bold text-blue-700 tabular-nums">
                              {appt.referenceNumber}
                            </p>
                            <h2 className="mt-0.5 font-display text-lg font-bold text-slate-900">
                              {appt.serviceName}
                            </h2>
                            <p className="text-xs text-slate-600">{appt.doctorName}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-800 tabular-nums">
                              {appt.appointmentDate} · {appt.appointmentTime} – {appt.endTime}
                            </p>
                          </div>
                          {qrMap[appt.id] && (
                            <img
                              src={qrMap[appt.id]}
                              alt={`QR pass ${appt.referenceNumber}`}
                              className="h-32 w-32 rounded-xl border border-slate-200 p-2"
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
                          <button
                            type="button"
                            onClick={() =>
                              setDocModal({
                                type: 'appointment',
                                record: appt,
                                qrDataUrl: qrMap[appt.id],
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View & Print Pass
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadAppointmentPassPdf(appt, qrMap[appt.id])}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download PDF
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* 5. MEDICAL RECORDS */}
          {currentPath === '/patient/medical-records' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Outpatient Medical Records
                </h1>
                <p className="text-sm text-slate-600">
                  Finalized physician consultation summaries with view, print, and PDF download.
                </p>
              </div>

              {myFinalizedConsultations.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No finalized consultation summaries have been released to your portal yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {myFinalizedConsultations.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                          <span className="font-mono font-semibold text-slate-800">{c.visitId}</span>
                          <span>·</span>
                          <span>{c.visitDate}</span>
                          <span>·</span>
                          <span>{c.doctorName}</span>
                        </div>
                        <h2 className="text-base font-bold text-slate-900">
                          {c.diagnosisType}: {c.diagnosis}
                        </h2>
                        <p className="text-xs text-slate-600">
                          Chief Complaint: {c.chiefComplaint}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setDocModal({
                              type: 'consultation',
                              record: c,
                              patient: ownClinicalRecord,
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View / Print
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadConsultationPdf(c, ownClinicalRecord)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 6. LABORATORY RESULTS */}
          {currentPath === '/patient/laboratory' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Verified Laboratory Results
                </h1>
                <p className="text-sm text-slate-600">
                  Only laboratory reports formally verified and released by Clinical Laboratory
                  staff appear here.
                </p>
              </div>

              {myReleasedLabs.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No verified laboratory reports released yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {myReleasedLabs.map((lab) => (
                    <div
                      key={lab.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                          <span className="font-mono font-semibold text-slate-800">
                            {lab.orderNumber}
                          </span>
                          <span>·</span>
                          <span>Released {(lab.releasedAt || '').slice(0, 10)}</span>
                          <span>·</span>
                          <span>Ordered by {lab.orderedByDoctorName}</span>
                        </div>
                        <h2 className="text-base font-bold text-slate-900">
                          {lab.testName} ({lab.testCode})
                        </h2>
                        <p className="text-xs text-slate-600">
                          Verified by {lab.verifiedByName || 'Clinical Laboratory'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDocModal({ type: 'lab', record: lab })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View / Print
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadLabResultPdf(lab)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 7. PRESCRIPTIONS */}
          {currentPath === '/patient/prescriptions' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Signed Prescriptions
                </h1>
                <p className="text-sm text-slate-600">
                  Physician-signed outpatient medication orders and pharmacy dispensing status.
                </p>
              </div>

              {myReleasedPrescriptions.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No prescriptions issued yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {myReleasedPrescriptions.map((rx) => (
                    <div
                      key={rx.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                          <span className="font-mono font-semibold text-slate-800">
                            {rx.prescriptionNumber}
                          </span>
                          <span>·</span>
                          <span className="font-semibold text-blue-700">{rx.status}</span>
                          <span>·</span>
                          <span>{rx.doctorName}</span>
                        </div>
                        <h2 className="text-sm font-bold text-slate-900">
                          {rx.items.map((i) => `${i.medicineName} ${i.strength}`).join(', ')}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDocModal({ type: 'prescription', record: rx })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View / Print
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadPrescriptionPdf(rx)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 8. BILLING & RECEIPTS */}
          {currentPath === '/patient/billing' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Billing Summaries & Payment Acknowledgments
                </h1>
                <p className="text-sm text-slate-600">
                  Itemized statements reflect only performed services and dispensed pharmacy items.
                </p>
              </div>

              {billings.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No billing statements recorded yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {billings.map((bill) => (
                    <div
                      key={bill.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                          <span className="font-mono font-semibold text-slate-800">
                            {bill.invoiceRef}
                          </span>
                          <span>·</span>
                          <span>{bill.visitDate}</span>
                          <span>·</span>
                          <span className="font-semibold text-blue-700">{bill.paymentStatus}</span>
                        </div>
                        <h2 className="text-base font-bold text-slate-900 tabular-nums">
                          Total PHP {bill.totalAmountPhp.toFixed(2)} · Balance PHP{' '}
                          {bill.remainingBalancePhp.toFixed(2)}
                        </h2>
                        <p className="text-xs text-slate-600">
                          Coverage Source: {bill.coverageSource}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDocModal({ type: 'billing', record: bill })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View / Print
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadBillingReceiptPdf(bill)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 9. FOLLOW-UP CARE */}
          {currentPath === '/patient/follow-up' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Follow-up Care Recommendations
                </h1>
                <p className="text-sm text-slate-600">
                  Physician-recommended return consultations. Follow-up appointments are never
                  auto-booked without your confirmation.
                </p>
              </div>

              {followUps.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No follow-up recommendations recorded yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {followUps.map((rec) => (
                    <div
                      key={rec.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                          <span className="font-semibold text-blue-700">{rec.status}</span>
                          <span>·</span>
                          <span>Recommended Date: {rec.recommendedDate}</span>
                          <span>·</span>
                          <span>{rec.doctorName}</span>
                        </div>
                        <h2 className="text-sm font-bold text-slate-900">{rec.reason}</h2>
                        <p className="text-xs text-slate-600">{rec.instructions}</p>
                      </div>
                      {rec.status === 'Recommended' && (
                        <button
                          type="button"
                          onClick={() => startFollowUpBooking(rec)}
                          className="whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          Book Follow-up
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 10. PATIENT GUIDE */}
          {currentPath === '/patient/guide' && (
            <PatientGuideView guides={patientGuides} />
          )}

          {/* 11. NOTIFICATIONS */}
          {currentPath === '/patient/notifications' && (
            <NotificationHistoryView
              notifications={notifications}
              onMarkRead={markNotificationReadAction}
              onNavigate={onNavigate}
            />
          )}

          {/* 12. MY PROFILE & WALK-IN LINKING */}
          {currentPath === '/patient/profile' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  My Profile, Walk-In Record Linking & Security
                </h1>
                <p className="text-sm text-slate-600">
                  Update contact demographics, request staff-verified linking to an existing Walk-In
                  clinical record, or enable optional Authenticator-App 2FA.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Demographics Form */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const res = await updatePatientDemographicsAction({
                      phone: profilePhone,
                      address: profileAddress,
                      allergies: profileAllergies,
                    });
                    setProfileMsg(res.ok ? 'Profile updated.' : res.error || 'Error saving.');
                  }}
                  className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
                >
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Outpatient Demographics
                  </h2>
                  {profileMsg && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800">
                      {profileMsg}
                    </div>
                  )}
                  <div className="text-xs text-slate-600 space-y-1">
                    <p>
                      <strong>Full Name:</strong> {patientAccount?.fullName}
                    </p>
                    <p className="tabular-nums">
                      <strong>Permanent Patient ID:</strong>{' '}
                      {patientAccount?.linkedPatientId || 'Not yet linked'}
                    </p>
                    <p className="tabular-nums">
                      <strong>Date of Birth:</strong> {patientAccount?.dateOfBirth} ·{' '}
                      <strong>Sex:</strong> {patientAccount?.sex}
                    </p>
                  </div>

                  <div>
                    <label htmlFor="prof-phone" className="block text-xs font-semibold text-slate-700">
                      Contact Number
                    </label>
                    <input
                      id="prof-phone"
                      type="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="prof-addr" className="block text-xs font-semibold text-slate-700">
                      Residential City / Address
                    </label>
                    <input
                      id="prof-addr"
                      type="text"
                      value={profileAddress}
                      onChange={(e) => setProfileAddress(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="prof-allergy" className="block text-xs font-semibold text-slate-700">
                      Self-Reported Allergies
                    </label>
                    <input
                      id="prof-allergy"
                      type="text"
                      value={profileAllergies}
                      onChange={(e) => setProfileAllergies(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <button
                    type="submit"
                    className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                  >
                    Save Profile Updates
                  </button>
                </form>

                {/* Walk-In Clinical Record Linking */}
                <div className="space-y-6">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!patientAccount) return;
                      const res = await submitRecordLinkRequestAction({
                        requestedFullName: patientAccount.fullName,
                        requestedDob: patientAccount.dateOfBirth,
                        requestedPhone: profilePhone || patientAccount.phone,
                        knownPatientIdHint: linkKnownPtId,
                        lastVisitDateHint: linkLastVisitDate,
                      });
                      setLinkMsg(res.message);
                    }}
                    className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
                  >
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Link Existing Walk-In Clinic Record
                    </h2>
                    <p className="text-xs text-slate-600">
                      Visited SmartClinic previously as a Walk-In patient? Submit a verification
                      request so Reception or Clinic Admin can safely link your historical Patient
                      ID without auto-exposing records.
                    </p>
                    {linkMsg && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                        {linkMsg}
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="link-ptid" className="block text-xs font-semibold text-slate-700">
                          Printed Patient ID (if known)
                        </label>
                        <input
                          id="link-ptid"
                          type="text"
                          placeholder="PT-2026-..."
                          value={linkKnownPtId}
                          onChange={(e) => setLinkKnownPtId(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label htmlFor="link-date" className="block text-xs font-semibold text-slate-700">
                          Approximate Last Visit Date
                        </label>
                        <input
                          id="link-date"
                          type="date"
                          value={linkLastVisitDate}
                          onChange={(e) => setLinkLastVisitDate(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs tabular-nums"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Submit Staff Verification Request
                    </button>

                    {linkRequests.length > 0 && (
                      <div className="border-t border-slate-100 pt-3 space-y-1.5">
                        <p className="text-xs font-semibold text-slate-700">Your Link Requests:</p>
                        {linkRequests.map((lr) => (
                          <p key={lr.id} className="text-xs text-slate-600 tabular-nums">
                            {lr.createdAt.slice(0, 10)} · Status:{' '}
                            <strong className="text-slate-900">{lr.status}</strong>
                          </p>
                        ))}
                      </div>
                    )}
                  </form>

                  {/* Optional Patient Authenticator App 2FA */}
                  <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Optional Authenticator-App 2FA
                    </h2>
                    <p className="text-xs text-slate-600">
                      Status:{' '}
                      <strong className="text-slate-900">
                        {patientAccount?.optionalMfaEnabled ? 'Enabled' : 'Not Enabled'}
                      </strong>{' '}
                      (Uses standard TOTP Authenticator App—never SMS).
                    </p>
                    {optMfaMsg && (
                      <p className="text-xs font-medium text-blue-700">{optMfaMsg}</p>
                    )}
                    {!patientAccount?.optionalMfaEnabled ? (
                      !optMfaSetup ? (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!firebaseUser) return;
                            const resp = await fetch('/api/mfa/setup', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                uid: firebaseUser.uid,
                                email: firebaseUser.email,
                              }),
                            });
                            const data = await resp.json();
                            if (resp.ok) {
                              setOptMfaSetup({
                                secretBase32: data.manualSecretKey,
                                encryptedSecret: data.encryptedSecret,
                                qrDataUrl: data.qrDataUrl,
                              });
                            }
                          }}
                          className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Set Up Optional 2FA
                        </button>
                      ) : (
                        <div className="space-y-3 pt-2">
                          <img
                            src={optMfaSetup.qrDataUrl}
                            alt="Optional Patient TOTP QR"
                            className="h-32 w-32 rounded-lg border border-slate-200 p-1.5"
                          />
                          <code className="block text-[11px] font-mono text-slate-700">
                            {optMfaSetup.secretBase32}
                          </code>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              aria-label="6-digit verification code"
                              maxLength={6}
                              placeholder="6-digit code"
                              value={optMfaCode}
                              onChange={(e) => setOptMfaCode(e.target.value)}
                              className="w-36 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs tabular-nums"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                if (!firebaseUser) return;
                                const resp = await fetch('/api/mfa/verify', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    uid: firebaseUser.uid,
                                    role: 'patient',
                                    encryptedSecret: optMfaSetup.encryptedSecret,
                                    code: optMfaCode,
                                  }),
                                });
                                const data = await resp.json();
                                if (resp.ok && data.verified) {
                                  await updatePatientOptionalMfaAction({
                                    enabled: true,
                                    encryptedSecret: optMfaSetup.encryptedSecret,
                                  });
                                  setOptMfaSetup(null);
                                  setOptMfaMsg('Optional Authenticator 2FA enabled.');
                                } else {
                                  setOptMfaMsg('Invalid 6-digit code.');
                                }
                              }}
                              className="rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white"
                            >
                              Activate
                            </button>
                          </div>
                        </div>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          await updatePatientOptionalMfaAction({
                            enabled: false,
                            encryptedSecret: '',
                          });
                          setOptMfaMsg('Optional 2FA turned off.');
                        }}
                        className="rounded-lg border border-rose-200 px-3.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Disable Optional 2FA
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Non-intrusive Toast Pop-ups */}
      <NotificationToastStack
        notifications={notifications}
        onDismissPopup={dismissNotificationPopupAction}
        onMarkRead={markNotificationReadAction}
        onNavigate={onNavigate}
      />

      {/* View / Print / Download PDF Modal */}
      <DocumentViewerModal docPayload={docModal} onClose={() => setDocModal(null)} />
    </div>
  );
};
