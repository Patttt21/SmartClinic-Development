import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Bell,
  Calendar,
  CalendarPlus,
  Camera,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Eye,
  LogIn,
  QrCode,
  Search,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import {
  calculateAvailableDates,
  calculateAvailableSlots,
  getManilaDateIso,
  getManilaTimeHhMm,
} from '../utils/scheduling';
import { sortUnifiedQueue } from '../utils/clinicalWorkflow';
import type {
  ClinicalPatientRecord,
  ClinicalPriority,
  CoverageSource,
  PaymentEntry,
} from '../types/clinic';
import { StaffShell } from './StaffShell';
import { NotificationHistoryView } from './NotificationCenter';
import { DocumentModalPayload, DocumentViewerModal } from './DocumentViewerModal';

interface StaffReceptionistProps {
  onNavigate: (path: string) => void;
}

export const StaffReceptionist: React.FC<StaffReceptionistProps> = ({ onNavigate }) => {
  const {
    patients,
    appointments,
    visits,
    services,
    doctorSchedules,
    approvedLeaves,
    billings,
    linkRequests,
    coverageSettings,
    notifications,
    checkInAppointmentByQrOrRefAction,
    registerWalkInVisitAction,
    updateVisitQueueStatusAction,
    bookAppointmentAction,
    cancelAppointmentAction,
    reviewRecordLinkRequestAction,
    syncOrUpdateBillingAction,
    markNotificationReadAction,
  } = useClinic();

  const [activeTab, setActiveTab] = useState('queue');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [docModal, setDocModal] = useState<DocumentModalPayload | null>(null);

  const todayManila = getManilaDateIso();
  const nowHhMm = getManilaTimeHhMm();

  // QR Scanner & Manual Check-In State
  const [qrInput, setQrInput] = useState('');
  const [identityVerified, setIdentityVerified] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stop camera stream cleanly when leaving QR tab or unmounting
  useEffect(() => {
    if (!cameraActive) return;
    let stream: MediaStream | null = null;
    let animId = 0;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const scanFrame = () => {
          if (videoRef.current && canvasRef.current && videoRef.current.readyState === 4) {
            const v = videoRef.current;
            const c = canvasRef.current;
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.drawImage(v, 0, 0, c.width, c.height);
              const img = ctx.getImageData(0, 0, c.width, c.height);
              const code = jsQR(img.data, img.width, img.height);
              if (code?.data) {
                setQrInput(code.data);
                setCameraActive(false);
                return;
              }
            }
          }
          animId = requestAnimationFrame(scanFrame);
        };
        animId = requestAnimationFrame(scanFrame);
      } catch (err: any) {
        setFeedback({
          type: 'err',
          text: 'Camera access unavailable in this browser frame. Upload a QR image or use Manual Reference Lookup below.',
        });
        setCameraActive(false);
      }
    })();

    return () => {
      cancelAnimationFrame(animId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [cameraActive]);

  const handleQrImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        if (decoded?.data) {
          setQrInput(decoded.data);
          setFeedback({ type: 'ok', text: 'QR pass decoded. Verify patient identity and confirm check-in.' });
        } else {
          setFeedback({ type: 'err', text: 'No valid QR code detected in uploaded image.' });
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Walk-In Registration State (Zero Emergency Contact fields!)
  const [walkInSearch, setWalkInSearch] = useState('');
  const [selectedExistingPt, setSelectedExistingPt] = useState<ClinicalPatientRecord | null>(null);
  const [wiName, setWiName] = useState('');
  const [wiDob, setWiDob] = useState('');
  const [wiSex, setWiSex] = useState<ClinicalPatientRecord['sex']>('Female');
  const [wiPhone, setWiPhone] = useState('');
  const [wiAddress, setWiAddress] = useState('');
  const [wiAllergies, setWiAllergies] = useState('None reported');
  const [wiChronic, setWiChronic] = useState('None reported');
  const [wiService, setWiService] = useState('General Consultation');
  const [wiDoctorUid, setWiDoctorUid] = useState(doctorSchedules[0]?.doctorUid || '');
  const [wiPriority, setWiPriority] = useState<ClinicalPriority>('Routine');

  // Patient Lookup State
  const [lookupQuery, setLookupQuery] = useState('');

  // Assisted Booking State (for patients without online accounts)
  const [assistPtId, setAssistPtId] = useState('');
  const [assistServiceId, setAssistServiceId] = useState('srv-general-consult');
  const [assistDoctorUid, setAssistDoctorUid] = useState<string>('any');
  const [assistDate, setAssistDate] = useState('');
  const [assistTime, setAssistTime] = useState('');
  const [assistReason, setAssistReason] = useState('');

  // Billing & Payment State
  const [selectedBillingVisitId, setSelectedBillingVisitId] = useState('');
  const [covSource, setCovSource] = useState<CoverageSource>('Self-Pay');
  const [covProvider, setCovProvider] = useState('');
  const [covMemberNo, setCovMemberNo] = useState('');
  const [covLoaRef, setCovLoaRef] = useState('');
  const [covApprovedPhp, setCovApprovedPhp] = useState('0');
  const [adjPhp, setAdjPhp] = useState('0');
  const [payAmountPhp, setPayAmountPhp] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentEntry['method']>('Cash');
  const [payRef, setPayRef] = useState('');

  const activeDoctors = useMemo(() => doctorSchedules.filter((d) => d.active), [doctorSchedules]);
  useEffect(() => {
    if (!wiDoctorUid && activeDoctors[0]) setWiDoctorUid(activeDoctors[0].doctorUid);
  }, [activeDoctors, wiDoctorUid]);

  const todaysAppointments = useMemo(
    () =>
      appointments
        .filter((a) => a.appointmentDate === todayManila)
        .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime)),
    [appointments, todayManila]
  );

  const todaysVisits = useMemo(
    () => sortUnifiedQueue(visits.filter((v) => v.visitDate === todayManila)),
    [visits, todayManila]
  );

  const pendingLinkRequests = useMemo(
    () => linkRequests.filter((r) => r.status === 'Pending Staff Verification'),
    [linkRequests]
  );

  const matchingPatients = useMemo(() => {
    const q = walkInSearch.trim().toLowerCase();
    if (!q) return [];
    return patients
      .filter(
        (p) =>
          p.fullName.toLowerCase().includes(q) ||
          p.patientId.toLowerCase().includes(q) ||
          p.phone.includes(q)
      )
      .slice(0, 6);
  }, [patients, walkInSearch]);

  const assistDates = useMemo(
    () =>
      calculateAvailableDates({
        schedules: doctorSchedules,
        doctorUid: assistDoctorUid === 'any' ? 'any' : assistDoctorUid,
        serviceId: assistServiceId,
        todayIsoDate: todayManila,
        currentHhMm: nowHhMm,
        horizonDays: 21,
        leaves: approvedLeaves,
        existingAppointments: appointments,
      }),
    [doctorSchedules, assistDoctorUid, assistServiceId, todayManila, nowHhMm, approvedLeaves, appointments]
  );

  const assistSlots = useMemo(
    () =>
      assistDate
        ? calculateAvailableSlots({
            schedules: doctorSchedules,
            doctorUid: assistDoctorUid === 'any' ? 'any' : assistDoctorUid,
            serviceId: assistServiceId,
            isoDate: assistDate,
            todayIsoDate: todayManila,
            currentHhMm: nowHhMm,
            leaves: approvedLeaves,
            existingAppointments: appointments,
          })
        : [],
    [assistDate, doctorSchedules, assistDoctorUid, assistServiceId, todayManila, nowHhMm, approvedLeaves, appointments]
  );

  const navItems = [
    {
      id: 'queue',
      label: 'Unified Queue & Check-Out',
      icon: ClipboardList,
      badgeCount: todaysVisits.filter((v) => v.queueStatus !== 'Checked Out').length,
    },
    {
      id: 'today_appts',
      label: "Today's Appointments",
      icon: Calendar,
      badgeCount: todaysAppointments.filter((a) => a.status === 'Confirmed').length,
    },
    { id: 'qr_checkin', label: 'QR & Ref Check-In', icon: QrCode },
    { id: 'walkin', label: 'Walk-In Registration', icon: UserPlus },
    {
      id: 'patients',
      label: 'Patient Lookup & Linking',
      icon: Users,
      badgeCount: pendingLinkRequests.length,
    },
    { id: 'assist_book', label: 'Appointment Assistance', icon: CalendarPlus },
    { id: 'billing', label: 'Billing & Payments', icon: CreditCard },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badgeCount: notifications.filter((n) => !n.read).length,
    },
  ];

  const selectedBilling = useMemo(
    () => billings.find((b) => b.visitId === selectedBillingVisitId) || null,
    [billings, selectedBillingVisitId]
  );

  return (
    <StaffShell
      roleLabel="Receptionist & Front Desk"
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

      {/* 1. UNIFIED QUEUE & CHECK-OUT */}
      {activeTab === 'queue' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Today&apos;s Unified Outpatient Queue ({todayManila})
              </h1>
              <p className="text-sm text-slate-600">
                Coordinates both Online Appointments and Walk-In Visits in real time.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('qr_checkin')}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Scan QR Check-In
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('walkin')}
                className="rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Register Walk-In Patient
              </button>
            </div>
          </div>

          {todaysVisits.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No patients checked in today yet. Use QR Check-In for scheduled appointments or
              Walk-In Registration for unscheduled arrivals.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 font-semibold text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Queue #</th>
                    <th className="px-4 py-3">Patient & ID</th>
                    <th className="px-4 py-3">Type / Doctor</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Current Status</th>
                    <th className="px-4 py-3 text-right">Front Desk Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {todaysVisits.map((v) => (
                    <tr key={v.visitId}>
                      <td className="px-4 py-3 font-mono font-bold text-slate-900 tabular-nums">
                        {v.queueNumber}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{v.patientName}</p>
                        <p className="text-slate-500 font-mono tabular-nums">
                          {v.patientId} · {v.visitId}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{v.appointmentType}</p>
                        <p className="text-slate-500">{v.doctorName}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {v.clinicalPriority}
                      </td>
                      <td className="px-4 py-3 font-semibold text-blue-700">{v.queueStatus}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        {v.queueStatus === 'Checked In' && (
                          <button
                            type="button"
                            onClick={() =>
                              updateVisitQueueStatusAction(v.visitId, 'Waiting for Nurse')
                            }
                            className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Send to Nurse
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            await syncOrUpdateBillingAction({ visitId: v.visitId });
                            setSelectedBillingVisitId(v.visitId);
                            setActiveTab('billing');
                          }}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Billing
                        </button>
                        {v.queueStatus === 'Consultation Completed' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await syncOrUpdateBillingAction({ visitId: v.visitId });
                              const res = await updateVisitQueueStatusAction(
                                v.visitId,
                                'Checked Out'
                              );
                              if (res.ok) {
                                setFeedback({
                                  type: 'ok',
                                  text: `${v.patientName} (${v.visitId}) checked out.`,
                                });
                              }
                            }}
                            className="rounded-lg bg-emerald-700 px-2.5 py-1.5 font-semibold text-white hover:bg-emerald-800"
                          >
                            Check Out
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 2. TODAY'S SCHEDULED APPOINTMENTS */}
      {activeTab === 'today_appts' && (
        <div className="space-y-5">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">
              Today&apos;s Scheduled Appointments ({todayManila})
            </h1>
            <p className="text-sm text-slate-600">
              Review expected arrivals, check in verified patients, or mark clinic-assisted changes.
            </p>
          </div>

          {todaysAppointments.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No online or staff-assisted appointments scheduled for today.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {todaysAppointments.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="text-xs text-slate-500 tabular-nums">
                      <strong className="font-mono text-slate-900">{a.referenceNumber}</strong> ·{' '}
                      {a.appointmentTime} – {a.endTime} ·{' '}
                      <span className="font-semibold text-blue-700">{a.status}</span>
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-slate-900">
                      {a.patientName} ({a.patientId})
                    </p>
                    <p className="text-xs text-slate-600">
                      {a.serviceName} · {a.doctorName}
                    </p>
                  </div>
                  {a.status === 'Confirmed' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setQrInput(a.referenceNumber);
                          setActiveTab('qr_checkin');
                        }}
                        className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                      >
                        Verify & Check In
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          cancelAppointmentAction(
                            a.id,
                            'clinic',
                            'Clinic schedule adjustment at Front Desk'
                          )
                        }
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Clinic Reschedule Flag
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. QR SCANNER & MANUAL REFERENCE CHECK-IN */}
      {activeTab === 'qr_checkin' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h1 className="font-display text-xl font-bold text-slate-900">
              QR Pass Scanner & Manual Fallback
            </h1>
            <p className="text-xs text-slate-600">
              Scan the patient&apos;s QR code via camera, upload a QR image screenshot, or enter
              their Appointment Reference Number (`SC-APT-...`).
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCameraActive((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <Camera className="h-4 w-4 text-blue-700" />
                {cameraActive ? 'Stop Camera' : 'Start Camera Scanner'}
              </button>

              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer">
                <Upload className="h-4 w-4 text-blue-700" />
                <span>Upload QR Pass Image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleQrImageUpload}
                  className="hidden"
                />
              </label>
            </div>

            {cameraActive && (
              <div className="rounded-xl border border-slate-200 bg-slate-900 p-2">
                <video ref={videoRef} className="w-full rounded-lg" muted playsInline />
                <canvas ref={canvasRef} className="hidden" />
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await checkInAppointmentByQrOrRefAction({
                  qrTokenOrRef: qrInput,
                  verifiedIdentityConfirmed: identityVerified,
                });
                if (!res.ok) {
                  setFeedback({ type: 'err', text: res.error || 'Check-in rejected.' });
                } else {
                  setFeedback({
                    type: 'ok',
                    text: `Checked in ${res.visit?.patientName}! Assigned Queue ${res.visit?.queueNumber} (${res.visit?.visitId}).`,
                  });
                  setQrInput('');
                  setIdentityVerified(false);
                }
              }}
              className="space-y-4 border-t border-slate-100 pt-4"
            >
              <div>
                <label htmlFor="qr-ref-input" className="block text-xs font-semibold text-slate-700">
                  Signed QR Token or Reference Number
                </label>
                <input
                  id="qr-ref-input"
                  type="text"
                  required
                  placeholder="Paste QR token or enter SC-APT-XXXXXX"
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                />
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={identityVerified}
                  onChange={(e) => setIdentityVerified(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong>Patient Identity Verified:</strong> I have verified the patient&apos;s
                  full name and date of birth against their appointment record.
                </span>
              </label>

              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
              >
                <LogIn className="h-4 w-4" />
                Complete Check-In & Place in Queue
              </button>
            </form>
          </div>

          <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h2 className="font-display text-base font-bold text-slate-900">
              Check-In Safeguards Enforced
            </h2>
            <ul className="space-y-2 text-xs text-slate-600">
              <li>1. Rejects cancelled, already-used, replaced, or tampered QR tokens.</li>
              <li>2. Prevents duplicate active encounters for the same patient on the same day.</li>
              <li>3. Automatically routes checked-in patients to Nursing Triage (`Waiting for Nurse`).</li>
            </ul>
          </div>
        </div>
      )}

      {/* 4. WALK-IN REGISTRATION (No Emergency Contact fields!) */}
      {activeTab === 'walkin' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">
              Step 1: Search Returning Walk-In / Portal Patient
            </h2>
            <p className="text-xs text-slate-600">
              Always check if the patient already has a permanent Patient ID before creating a new
              record. Returning patients keep their permanent `Patient ID` and receive a new `Visit
              ID`.
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                aria-label="Search existing patient by name, Patient ID, or phone"
                placeholder="Search Name, PT-2026-..., or Phone"
                value={walkInSearch}
                onChange={(e) => setWalkInSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs"
              />
            </div>

            {matchingPatients.length > 0 && (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {matchingPatients.map((p) => (
                  <div
                    key={p.patientId}
                    className="flex items-center justify-between p-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{p.fullName}</p>
                      <p className="text-slate-500 font-mono tabular-nums">
                        {p.patientId} · DOB {p.dateOfBirth}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedExistingPt(p);
                        setWiName(p.fullName);
                        setWiDob(p.dateOfBirth);
                        setWiSex(p.sex);
                        setWiPhone(p.phone);
                        setWiAddress(p.address);
                        setWiAllergies(p.allergies);
                        setWiChronic(p.chronicConditions);
                      }}
                      className="rounded-md bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Use Record
                    </button>
                  </div>
                ))}
              </div>
            )}

            {selectedExistingPt && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 flex items-center justify-between">
                <span>
                  Returning Patient Selected: <strong>{selectedExistingPt.patientId}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedExistingPt(null);
                    setWiName('');
                    setWiDob('');
                    setWiPhone('');
                  }}
                  className="underline font-semibold"
                >
                  Clear (New Patient)
                </button>
              </div>
            )}
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!wiDoctorUid) {
                setFeedback({
                  type: 'err',
                  text: 'Please assign an active physician for this walk-in visit.',
                });
                return;
              }
              const res = await registerWalkInVisitAction({
                existingPatientId: selectedExistingPt?.patientId,
                fullName: wiName,
                dateOfBirth: wiDob,
                sex: wiSex,
                phone: wiPhone,
                address: wiAddress,
                allergies: wiAllergies,
                chronicConditions: wiChronic,
                serviceName: wiService,
                doctorUid: wiDoctorUid,
                clinicalPriority: wiPriority,
              });
              if (!res.ok) {
                setFeedback({ type: 'err', text: res.error || 'Could not register walk-in.' });
              } else {
                setFeedback({
                  type: 'ok',
                  text: `Walk-In registered! Patient ID: ${res.visit?.patientId} · Visit ID: ${res.visit?.visitId} · Queue: ${res.visit?.queueNumber}.`,
                });
                setSelectedExistingPt(null);
                setWiName('');
                setWiDob('');
                setWiPhone('');
                setActiveTab('queue');
              }
            }}
            className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              Step 2: Walk-In Intake & Queue Placement
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wi-name" className="block text-xs font-semibold text-slate-700">
                  Patient Full Name
                </label>
                <input
                  id="wi-name"
                  type="text"
                  required
                  value={wiName}
                  onChange={(e) => setWiName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="wi-dob" className="block text-xs font-semibold text-slate-700">
                  Date of Birth
                </label>
                <input
                  id="wi-dob"
                  type="date"
                  required
                  value={wiDob}
                  onChange={(e) => setWiDob(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="wi-sex" className="block text-xs font-semibold text-slate-700">
                  Sex
                </label>
                <select
                  id="wi-sex"
                  value={wiSex}
                  onChange={(e) => setWiSex(e.target.value as ClinicalPatientRecord['sex'])}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="wi-phone" className="block text-xs font-semibold text-slate-700">
                  Contact Number
                </label>
                <input
                  id="wi-phone"
                  type="tel"
                  required
                  value={wiPhone}
                  onChange={(e) => setWiPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs tabular-nums"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="wi-addr" className="block text-xs font-semibold text-slate-700">
                  Address / City
                </label>
                <input
                  id="wi-addr"
                  type="text"
                  value={wiAddress}
                  onChange={(e) => setWiAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="wi-doc" className="block text-xs font-semibold text-slate-700">
                  Assigned Physician
                </label>
                <select
                  id="wi-doc"
                  required
                  value={wiDoctorUid}
                  onChange={(e) => setWiDoctorUid(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  <option value="">Select Active Doctor</option>
                  {activeDoctors.map((d) => (
                    <option key={d.doctorUid} value={d.doctorUid}>
                      {d.doctorName} ({d.specialty})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="wi-prio" className="block text-xs font-semibold text-slate-700">
                  Initial Intake Priority
                </label>
                <select
                  id="wi-prio"
                  value={wiPriority}
                  onChange={(e) => setWiPriority(e.target.value as ClinicalPriority)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  <option value="Routine">Routine</option>
                  <option value="Priority">Priority (Elderly / PWD / Pregnant / High Fever)</option>
                  <option value="Urgent Referral">Urgent Referral Assessment</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-800"
            >
              Register Walk-In & Send to Nursing Queue
            </button>
          </form>
        </div>
      )}

      {/* 5. PATIENT LOOKUP & WALK-IN RECORD LINKING VERIFICATION */}
      {activeTab === 'patients' && (
        <div className="space-y-6">
          {pendingLinkRequests.length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-white p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-slate-900">
                Pending Portal-to-Walk-In Record Link Requests ({pendingLinkRequests.length})
              </h2>
              <div className="divide-y divide-slate-200">
                {pendingLinkRequests.map((req) => (
                  <div key={req.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {req.requestedFullName} ({req.portalEmail})
                      </p>
                      <p className="text-slate-600 tabular-nums">
                        DOB: {req.requestedDob} · Phone: {req.requestedPhone} · Candidate Patient ID:{' '}
                        <strong>{req.candidatePatientId || req.knownPatientIdHint || 'Manual Match Needed'}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {req.candidatePatientId && (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await reviewRecordLinkRequestAction({
                              requestId: req.id,
                              approve: true,
                              targetPatientId: req.candidatePatientId,
                              verificationNotes: 'Identity verified by Receptionist',
                            });
                            if (res.ok) setFeedback({ type: 'ok', text: 'Patient record linked.' });
                          }}
                          className="rounded-lg bg-blue-700 px-3 py-1.5 font-semibold text-white"
                        >
                          Approve Link ({req.candidatePatientId})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          reviewRecordLinkRequestAction({
                            requestId: req.id,
                            approve: false,
                            targetPatientId: '',
                            verificationNotes: 'Insufficient matching identifiers',
                          })
                        }
                        className="rounded-lg border border-rose-200 px-3 py-1.5 font-semibold text-rose-700"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Administrative Patient Directory
                </h2>
                <p className="text-xs text-slate-500">
                  Receptionists view administrative identifiers and contact details only—never
                  confidential clinical notes.
                </p>
              </div>
              <input
                type="text"
                aria-label="Filter patient directory"
                placeholder="Search Patient ID or Name"
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 font-semibold text-slate-700">
                  <tr>
                    <th className="px-4 py-2.5">Permanent Patient ID</th>
                    <th className="px-4 py-2.5">Full Name</th>
                    <th className="px-4 py-2.5">DOB / Sex</th>
                    <th className="px-4 py-2.5">Phone</th>
                    <th className="px-4 py-2.5">Source / Portal Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {patients
                    .filter(
                      (p) =>
                        !lookupQuery ||
                        p.fullName.toLowerCase().includes(lookupQuery.toLowerCase()) ||
                        p.patientId.toLowerCase().includes(lookupQuery.toLowerCase())
                    )
                    .map((p) => (
                      <tr key={p.patientId}>
                        <td className="px-4 py-2.5 font-mono font-bold text-slate-900 tabular-nums">
                          {p.patientId}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{p.fullName}</td>
                        <td className="px-4 py-2.5 text-slate-600 tabular-nums">
                          {p.dateOfBirth} · {p.sex}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 tabular-nums">{p.phone}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {p.registrationSource} · {p.portalUserId ? 'Portal Linked' : 'Walk-In Only'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 6. APPOINTMENT ASSISTANCE (For Walk-in/Phone Patients Without Online Accounts) */}
      {activeTab === 'assist_book' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const pt = patients.find((p) => p.patientId === assistPtId);
            if (!pt || !assistDate || !assistTime) {
              setFeedback({ type: 'err', text: 'Select a patient, date, and open slot.' });
              return;
            }
            const res = await bookAppointmentAction({
              patientId: pt.patientId,
              portalUserId: pt.portalUserId || '',
              patientName: pt.fullName,
              serviceId: assistServiceId,
              doctorUid: assistDoctorUid === 'any' ? 'any' : assistDoctorUid,
              appointmentDate: assistDate,
              appointmentTime: assistTime,
              reasonForVisit: assistReason || 'Staff-assisted booking',
            });
            if (res.ok && res.appointment) {
              setFeedback({
                type: 'ok',
                text: `Assisted appointment booked! Reference ${res.appointment.referenceNumber} on ${res.appointment.appointmentDate} at ${res.appointment.appointmentTime}.`,
              });
              setAssistTime('');
            } else {
              setFeedback({ type: 'err', text: res.error || 'Booking failed.' });
            }
          }}
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 max-w-3xl"
        >
          <h1 className="font-display text-xl font-bold text-slate-900">
            Staff-Assisted Appointment Scheduling
          </h1>
          <p className="text-xs text-slate-600">
            Schedule future appointments or follow-up visits on behalf of patients without online
            accounts.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="assist-pt" className="block text-xs font-semibold text-slate-700">
                Registered Patient
              </label>
              <select
                id="assist-pt"
                required
                value={assistPtId}
                onChange={(e) => setAssistPtId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                <option value="">Choose Patient Record</option>
                {patients.map((p) => (
                  <option key={p.patientId} value={p.patientId}>
                    {p.fullName} ({p.patientId})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="assist-srv" className="block text-xs font-semibold text-slate-700">
                Service
              </label>
              <select
                id="assist-srv"
                value={assistServiceId}
                onChange={(e) => setAssistServiceId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                {services
                  .filter((s) => s.directlyBookable)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="assist-doc" className="block text-xs font-semibold text-slate-700">
                Doctor
              </label>
              <select
                id="assist-doc"
                value={assistDoctorUid}
                onChange={(e) => setAssistDoctorUid(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                <option value="any">Any Available Doctor</option>
                {activeDoctors.map((d) => (
                  <option key={d.doctorUid} value={d.doctorUid}>
                    {d.doctorName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="assist-date" className="block text-xs font-semibold text-slate-700">
                Open Date
              </label>
              <select
                id="assist-date"
                required
                value={assistDate}
                onChange={(e) => {
                  setAssistDate(e.target.value);
                  setAssistTime('');
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs tabular-nums"
              >
                <option value="">Select Open Date</option>
                {assistDates.map((d) => (
                  <option key={d.isoDate} value={d.isoDate}>
                    {d.isoDate} ({d.openSlotCount} slots)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="assist-time" className="block text-xs font-semibold text-slate-700">
                Open Time Slot
              </label>
              <select
                id="assist-time"
                required
                value={assistTime}
                onChange={(e) => setAssistTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs tabular-nums"
              >
                <option value="">Select Time</option>
                {assistSlots.map((s) => (
                  <option key={s.startTime} value={s.startTime}>
                    {s.startTime} – {s.endTime}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="assist-reason" className="block text-xs font-semibold text-slate-700">
                Reason / Notes
              </label>
              <input
                id="assist-reason"
                type="text"
                value={assistReason}
                onChange={(e) => setAssistReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-800"
          >
            Confirm Assisted Appointment
          </button>
        </form>
      )}

      {/* 7. BILLING, MANUAL COVERAGE VERIFICATION & PAYMENTS */}
      {activeTab === 'billing' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">
              Select Encounter for Itemized Billing
            </h2>
            <p className="text-xs text-slate-600">
              Billing auto-calculates strictly from performed consultations, verified/performed
              labs, and dispensed pharmacy quantities.
            </p>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
              {visits.map((v) => {
                const bill = billings.find((b) => b.visitId === v.visitId);
                return (
                  <button
                    key={v.visitId}
                    type="button"
                    onClick={async () => {
                      await syncOrUpdateBillingAction({ visitId: v.visitId });
                      setSelectedBillingVisitId(v.visitId);
                    }}
                    className={`w-full p-3 text-left text-xs transition-colors ${
                      selectedBillingVisitId === v.visitId
                        ? 'bg-blue-50 font-semibold'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-slate-900">{v.patientName}</span>
                      <span className="font-mono text-slate-600 tabular-nums">{v.visitId}</span>
                    </div>
                    <p className="text-slate-500 mt-0.5 tabular-nums">
                      {v.visitDate} · {v.queueStatus} ·{' '}
                      {bill ? `${bill.paymentStatus} (Bal PHP ${bill.remainingBalancePhp.toFixed(0)})` : 'Generate Bill'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            {!selectedBilling ? (
              <p className="text-sm text-slate-500">
                Select a visit on the left to review performed line items, record manual HMO /
                PhilHealth verification, and log payments.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      {selectedBilling.patientName} · {selectedBilling.invoiceRef}
                    </h2>
                    <p className="text-xs text-slate-500 tabular-nums">
                      Status: <strong className="text-blue-700">{selectedBilling.paymentStatus}</strong> ·
                      Gross PHP {selectedBilling.totalAmountPhp.toFixed(2)} · Remaining Balance{' '}
                      <strong className="text-slate-900">
                        PHP {selectedBilling.remainingBalancePhp.toFixed(2)}
                      </strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocModal({ type: 'billing', record: selectedBilling })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview / PDF Receipt
                  </button>
                </div>

                {/* Performed Items Table */}
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 font-semibold text-slate-700">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedBilling.items.map((it) => (
                        <tr key={it.id}>
                          <td className="px-3 py-2 font-medium text-slate-900">{it.description}</td>
                          <td className="px-3 py-2 text-slate-600">{it.category}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            PHP {it.subtotalPhp.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Manual Coverage & Payment Form */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const res = await syncOrUpdateBillingAction({
                      visitId: selectedBilling.visitId,
                      coverageSource: covSource,
                      coverageProviderName: covProvider,
                      coverageMemberNumber: covMemberNo,
                      loaOrMdrReference: covLoaRef,
                      approvedCoverageAmountPhp: Number(covApprovedPhp) || 0,
                      adjustmentAmountPhp: Number(adjPhp) || 0,
                      newPayment:
                        Number(payAmountPhp) > 0
                          ? {
                              amountPhp: Number(payAmountPhp),
                              method: payMethod,
                              referenceCode: payRef,
                              notes: 'Front Desk Payment',
                            }
                          : undefined,
                    });
                    if (res.ok) {
                      setFeedback({ type: 'ok', text: 'Billing & payment record updated.' });
                      setPayAmountPhp('');
                      setPayRef('');
                    }
                  }}
                  className="space-y-4 border-t border-slate-100 pt-4 text-xs"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor="cov-src" className="block font-semibold text-slate-700">
                        Coverage Source (Manual)
                      </label>
                      <select
                        id="cov-src"
                        value={covSource}
                        onChange={(e) => setCovSource(e.target.value as CoverageSource)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2"
                      >
                        <option value="Self-Pay">Self-Pay</option>
                        <option value="HMO / Health Card">HMO / Health Card (Manual LOA)</option>
                        <option value="PhilHealth">PhilHealth (Manual MDR)</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="cov-prov" className="block font-semibold text-slate-700">
                        Provider / Card Name
                      </label>
                      <input
                        id="cov-prov"
                        type="text"
                        list="hmo-list"
                        value={covProvider}
                        onChange={(e) => setCovProvider(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2"
                      />
                      <datalist id="hmo-list">
                        {coverageSettings.hmoProvidersAcceptedForManualVerification.map((h) => (
                          <option key={h} value={h} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label htmlFor="cov-loa" className="block font-semibold text-slate-700">
                        LOA / PhilHealth MDR Ref
                      </label>
                      <input
                        id="cov-loa"
                        type="text"
                        value={covLoaRef}
                        onChange={(e) => setCovLoaRef(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div>
                      <label htmlFor="cov-amt" className="block font-semibold text-slate-700">
                        Approved Coverage (PHP)
                      </label>
                      <input
                        id="cov-amt"
                        type="number"
                        min="0"
                        value={covApprovedPhp}
                        onChange={(e) => setCovApprovedPhp(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="pay-amt" className="block font-semibold text-slate-700">
                        Record Payment (PHP)
                      </label>
                      <input
                        id="pay-amt"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={payAmountPhp}
                        onChange={(e) => setPayAmountPhp(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="pay-method" className="block font-semibold text-slate-700">
                        Payment Method
                      </label>
                      <select
                        id="pay-method"
                        value={payMethod}
                        onChange={(e) => setPayMethod(e.target.value as PaymentEntry['method'])}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2"
                      >
                        <option value="Cash">Cash</option>
                        <option value="Card">Card</option>
                        <option value="GCash / E-Wallet">GCash / E-Wallet</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="pay-ref" className="block font-semibold text-slate-700">
                        Transaction Ref
                      </label>
                      <input
                        id="pay-ref"
                        type="text"
                        value={payRef}
                        onChange={(e) => setPayRef(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Save Coverage & Record Payment
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* 8. NOTIFICATIONS */}
      {activeTab === 'notifications' && (
        <NotificationHistoryView
          notifications={notifications}
          onMarkRead={markNotificationReadAction}
          onNavigate={onNavigate}
        />
      )}

      <DocumentViewerModal docPayload={docModal} onClose={() => setDocModal(null)} />
    </StaffShell>
  );
};
