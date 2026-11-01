import React, { useMemo, useState } from 'react';
import {
  Bell,
  CalendarOff,
  CheckCircle2,
  ClipboardList,
  Eye,
  FilePenLine,
  Pill,
  Plus,
  RefreshCw,
  Stethoscope,
  TestTube2,
  Trash2,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import { addDaysToIsoDate, getManilaDateIso } from '../utils/scheduling';
import { sortUnifiedQueue } from '../utils/clinicalWorkflow';
import type { ConsultationRecord, PrescriptionItem } from '../types/clinic';
import { StaffShell } from './StaffShell';
import { NotificationHistoryView } from './NotificationCenter';
import { DocumentModalPayload, DocumentViewerModal } from './DocumentViewerModal';

interface StaffDoctorProps {
  onNavigate: (path: string) => void;
}

export const StaffDoctor: React.FC<StaffDoctorProps> = ({ onNavigate }) => {
  const {
    staffAccount,
    visits,
    patients,
    nursingAssessments,
    consultations,
    services,
    labOrders,
    prescriptions,
    inventory,
    followUps,
    leaveRequests,
    doctorSchedules,
    notifications,
    updateVisitQueueStatusAction,
    saveConsultationAction,
    createLabOrderAction,
    createPrescriptionAction,
    respondPrescriptionClarificationAction,
    createFollowUpRecommendationAction,
    submitDoctorLeaveRequestAction,
    markNotificationReadAction,
  } = useClinic();

  const [activeTab, setActiveTab] = useState('consult');
  const [selectedVisitId, setSelectedVisitId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [docModal, setDocModal] = useState<DocumentModalPayload | null>(null);

  const todayManila = getManilaDateIso();

  // Consultation Form State
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [findings, setFindings] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [diagnosisType, setDiagnosisType] =
    useState<ConsultationRecord['diagnosisType']>('Final Diagnosis');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [patientInstructions, setPatientInstructions] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');

  // Optional Lab Order State
  const labServices = useMemo(
    () => services.filter((s) => s.active && s.category === 'Laboratory'),
    [services]
  );
  const [labServiceId, setLabServiceId] = useState(labServices[0]?.id || 'srv-lab-cbc');
  const [labIndication, setLabIndication] = useState('');
  const [labPriority, setLabPriority] = useState<'Routine' | 'Stat'>('Routine');

  // Optional Prescription Builder State
  const [rxItems, setRxItems] = useState<PrescriptionItem[]>([]);
  const [medName, setMedName] = useState('');
  const [medStrength, setMedStrength] = useState('500mg');
  const [medDosage, setMedDosage] = useState('1 tablet');
  const [medFreq, setMedFreq] = useState('Every 8 hours');
  const [medDuration, setMedDuration] = useState('5 days');
  const [medQty, setMedQty] = useState('15');
  const [medInst, setMedInst] = useState('Take after meals');
  const [rxNotes, setRxNotes] = useState('');

  // Clarification Response State
  const [clarifyReplyMap, setClarifyReplyMap] = useState<Record<string, string>>({});

  // Optional Follow-Up Recommendation State
  const [fuDate, setFuDate] = useState(addDaysToIsoDate(todayManila, 7));
  const [fuInterval, setFuInterval] = useState('In 7 days');
  const [fuReason, setFuReason] = useState('');
  const [fuInstructions, setFuInstructions] = useState('');

  // Doctor Leave Request State
  const [leaveStart, setLeaveStart] = useState(addDaysToIsoDate(todayManila, 3));
  const [leaveEnd, setLeaveEnd] = useState(addDaysToIsoDate(todayManila, 3));
  const [leaveReason, setLeaveReason] = useState('');

  const doctorVisits = useMemo(
    () =>
      sortUnifiedQueue(
        visits.filter(
          (v) =>
            v.visitDate === todayManila &&
            (!staffAccount || v.doctorUid === staffAccount.uid || visits.length > 0)
        )
      ),
    [visits, todayManila, staffAccount]
  );

  const selectedVisit = useMemo(
    () => visits.find((v) => v.visitId === selectedVisitId) || doctorVisits[0] || null,
    [visits, selectedVisitId, doctorVisits]
  );

  const selectedPatient = useMemo(
    () => patients.find((p) => p.patientId === selectedVisit?.patientId) || null,
    [patients, selectedVisit]
  );

  const activeNursing = useMemo(
    () => nursingAssessments.find((n) => n.visitId === selectedVisit?.visitId) || null,
    [nursingAssessments, selectedVisit]
  );

  const activeConsult = useMemo(
    () => consultations.find((c) => c.visitId === selectedVisit?.visitId) || null,
    [consultations, selectedVisit]
  );

  const visitLabs = useMemo(
    () => labOrders.filter((l) => l.visitId === selectedVisit?.visitId),
    [labOrders, selectedVisit]
  );

  const visitRx = useMemo(
    () => prescriptions.filter((r) => r.visitId === selectedVisit?.visitId),
    [prescriptions, selectedVisit]
  );

  const needsClarificationRx = useMemo(
    () => prescriptions.filter((r) => r.status === 'Needs Clarification'),
    [prescriptions]
  );

  const loadEncounterIntoForm = (visitId: string) => {
    setSelectedVisitId(visitId);
    const existing = consultations.find((c) => c.visitId === visitId);
    const na = nursingAssessments.find((n) => n.visitId === visitId);
    if (existing) {
      setChiefComplaint(existing.chiefComplaint);
      setFindings(existing.clinicalFindings);
      setDiagnosis(existing.diagnosis);
      setDiagnosisType(existing.diagnosisType);
      setTreatmentPlan(existing.treatmentPlan);
      setPatientInstructions(existing.patientInstructions);
      setAmendmentReason('');
    } else {
      setChiefComplaint(na?.chiefComplaint || '');
      setFindings('');
      setDiagnosis('');
      setDiagnosisType('Final Diagnosis');
      setTreatmentPlan('');
      setPatientInstructions('');
      setAmendmentReason('');
    }
  };

  const navItems = [
    {
      id: 'consult',
      label: 'Queue & Consultation',
      icon: Stethoscope,
      badgeCount: doctorVisits.filter(
        (v) => v.queueStatus === 'Ready for Doctor' || v.queueStatus === 'In Consultation'
      ).length,
    },
    {
      id: 'labs',
      label: 'Laboratory Results',
      icon: TestTube2,
      badgeCount: labOrders.filter((l) => l.status === 'Released').length,
    },
    {
      id: 'rx_clarify',
      label: 'Prescriptions & Pharmacy',
      icon: Pill,
      badgeCount: needsClarificationRx.length,
    },
    { id: 'records', label: 'Finalized Consultations', icon: ClipboardList },
    { id: 'schedule_leave', label: 'My Schedule & Leave', icon: CalendarOff },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badgeCount: notifications.filter((n) => !n.read).length,
    },
  ];

  const mySchedule = useMemo(
    () => doctorSchedules.find((d) => d.doctorUid === staffAccount?.uid) || null,
    [doctorSchedules, staffAccount]
  );

  return (
    <StaffShell
      roleLabel="Attending Physician"
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

      {/* 1. QUEUE & CLINICAL CONSULTATION WORKSPACE */}
      {activeTab === 'consult' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Today's Queue */}
          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                Today&apos;s Consultation Queue
              </h1>
              <p className="text-xs text-slate-500">
                Select a patient ready from Nursing Triage to start or amend consultation.
              </p>
            </div>

            {doctorVisits.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No outpatient visits assigned for today yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {doctorVisits.map((v) => {
                  const isSel = selectedVisit?.visitId === v.visitId;
                  return (
                    <button
                      key={v.visitId}
                      type="button"
                      onClick={() => {
                        loadEncounterIntoForm(v.visitId);
                        if (v.queueStatus === 'Ready for Doctor') {
                          updateVisitQueueStatusAction(v.visitId, 'In Consultation');
                        }
                      }}
                      className={`w-full p-3.5 text-left text-xs transition-colors ${
                        isSel ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                          {v.queueNumber} · {v.patientName}
                        </span>
                        <span className="font-semibold text-blue-700">{v.clinicalPriority}</span>
                      </div>
                      <p className="mt-1 text-slate-500">
                        {v.visitId} · <strong>{v.queueStatus}</strong>
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Consultation Clinical Record + Optional Orders */}
          <div className="lg:col-span-8 space-y-5">
            {!selectedVisit ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Select a patient from Today&apos;s Queue to review Nursing Vitals and document
                clinical findings.
              </div>
            ) : (
              <>
                {/* Patient & Pre-Populated Nurse Assessment Banner */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-display text-lg font-bold text-slate-900">
                        {selectedVisit.patientName} ({selectedVisit.patientId})
                      </h2>
                      <p className="text-xs text-slate-600 tabular-nums">
                        Encounter {selectedVisit.visitId} · {selectedVisit.appointmentType} · Queue{' '}
                        {selectedVisit.queueStatus}
                      </p>
                    </div>
                    {selectedVisit.queueStatus === 'Ready for Doctor' && (
                      <button
                        type="button"
                        onClick={() => {
                          loadEncounterIntoForm(selectedVisit.visitId);
                          updateVisitQueueStatusAction(selectedVisit.visitId, 'In Consultation');
                        }}
                        className="rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                      >
                        Start Consultation
                      </button>
                    )}
                  </div>

                  {activeNursing ? (
                    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3.5 text-xs space-y-1.5">
                      <p className="font-semibold text-blue-900">
                        Nursing Triage Vital Signs (Recorded by {activeNursing.nurseName})
                      </p>
                      <p className="font-mono text-slate-800 tabular-nums">
                        BP {activeNursing.bloodPressure} mmHg · Temp {activeNursing.bodyTemperatureC}{' '}
                        °C · HR {activeNursing.pulseRateBpm} bpm · RR{' '}
                        {activeNursing.respiratoryRateCpm} cpm · SpO2{' '}
                        {activeNursing.oxygenSaturationPct}%
                        {activeNursing.weightKg ? ` · Wt ${activeNursing.weightKg} kg` : ''}
                      </p>
                      <p className="text-slate-700">
                        <strong>Triage Chief Complaint:</strong> {activeNursing.chiefComplaint}{' '}
                        {activeNursing.symptomOnset ? `(${activeNursing.symptomOnset})` : ''} ·{' '}
                        <strong>Observations:</strong> {activeNursing.nursingObservations || 'None'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700">
                      Note: Nursing vital signs have not been submitted yet for this visit.
                    </p>
                  )}
                </div>

                {/* Consultation Documentation Form */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const res = await saveConsultationAction({
                      visitId: selectedVisit.visitId,
                      chiefComplaint: chiefComplaint || activeNursing?.chiefComplaint || '',
                      clinicalFindings: findings,
                      diagnosis,
                      diagnosisType,
                      treatmentPlan,
                      patientInstructions,
                      finalize: true,
                      amendmentReason:
                        activeConsult?.status === 'Finalized' ? amendmentReason : undefined,
                    });
                    if (!res.ok) {
                      setFeedback({ type: 'err', text: res.error || 'Failed to finalize.' });
                    } else {
                      setFeedback({
                        type: 'ok',
                        text:
                          activeConsult?.status === 'Finalized'
                            ? 'Authorized clinical amendment recorded with audit trail.'
                            : 'Consultation finalized and released to Patient Portal.',
                      });
                    }
                  }}
                  className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="font-display text-base font-bold text-slate-900">
                      {activeConsult?.status === 'Finalized'
                        ? 'Finalized Consultation Record (Authorized Amendment Mode)'
                        : 'Clinical Consultation Documentation'}
                    </h3>
                    {activeConsult && (
                      <span className="text-xs font-semibold text-blue-700">
                        Record Status: {activeConsult.status}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="doc-cc" className="block text-xs font-semibold text-slate-700">
                        Chief Complaint
                      </label>
                      <input
                        id="doc-cc"
                        type="text"
                        required
                        value={chiefComplaint || activeNursing?.chiefComplaint || ''}
                        onChange={(e) => setChiefComplaint(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="doc-diag-type"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Diagnosis Classification
                      </label>
                      <select
                        id="doc-diag-type"
                        value={diagnosisType}
                        onChange={(e) =>
                          setDiagnosisType(e.target.value as ConsultationRecord['diagnosisType'])
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      >
                        <option value="Final Diagnosis">Final Diagnosis</option>
                        <option value="Provisional Diagnosis">
                          Provisional Diagnosis (Pending Lab Confirmation)
                        </option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="doc-findings"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      History of Present Illness &amp; Physical Examination Findings
                    </label>
                    <textarea
                      id="doc-findings"
                      rows={3}
                      required
                      value={findings}
                      onChange={(e) => setFindings(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="doc-diagnosis"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Diagnosis / Clinical Impression
                    </label>
                    <input
                      id="doc-diagnosis"
                      type="text"
                      required
                      placeholder="e.g., Acute Upper Respiratory Tract Infection"
                      value={diagnosis}
                      onChange={(e) => setDiagnosis(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="doc-plan"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Treatment Plan
                      </label>
                      <textarea
                        id="doc-plan"
                        rows={3}
                        required
                        value={treatmentPlan}
                        onChange={(e) => setTreatmentPlan(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="doc-inst"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        Patient Home-Care Instructions
                      </label>
                      <textarea
                        id="doc-inst"
                        rows={3}
                        value={patientInstructions}
                        onChange={(e) => setPatientInstructions(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  {activeConsult?.status === 'Finalized' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <label
                        htmlFor="doc-amend-reason"
                        className="block text-xs font-semibold text-amber-900"
                      >
                        Required Reason for Post-Finalization Amendment
                      </label>
                      <input
                        id="doc-amend-reason"
                        type="text"
                        required
                        placeholder="e.g., Updated provisional diagnosis following released CBC report"
                        value={amendmentReason}
                        onChange={(e) => setAmendmentReason(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100 pt-3">
                    {activeConsult?.status !== 'Finalized' && (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await saveConsultationAction({
                            visitId: selectedVisit.visitId,
                            chiefComplaint: chiefComplaint || activeNursing?.chiefComplaint || '',
                            clinicalFindings: findings,
                            diagnosis,
                            diagnosisType,
                            treatmentPlan,
                            patientInstructions,
                            finalize: false,
                          });
                          if (res.ok) setFeedback({ type: 'ok', text: 'Consultation draft saved.' });
                        }}
                        className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Save Draft
                      </button>
                    )}
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                    >
                      {activeConsult?.status === 'Finalized' ? (
                        <>
                          <FilePenLine className="h-4 w-4" />
                          Record Authorized Amendment
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Finalize Consultation
                        </>
                      )}
                    </button>
                  </div>
                </form>

                {/* Optional Diagnostic Lab Request, Prescription & Follow-up Grid */}
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {/* Optional Lab Order */}
                  <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Optional Laboratory Test Order
                    </h3>
                    <div className="space-y-2.5 text-xs">
                      <select
                        aria-label="Select laboratory test"
                        value={labServiceId}
                        onChange={(e) => setLabServiceId(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                      >
                        {labServices.map((ls) => (
                          <option key={ls.id} value={ls.id}>
                            {ls.name} ({ls.code}) — PHP {ls.baseFeePhp}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        aria-label="Clinical indication for laboratory order"
                        placeholder="Clinical indication (e.g., Rule out bacterial infection)"
                        value={labIndication}
                        onChange={(e) => setLabIndication(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <select
                          aria-label="Lab priority"
                          value={labPriority}
                          onChange={(e) => setLabPriority(e.target.value as 'Routine' | 'Stat')}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                        >
                          <option value="Routine">Routine</option>
                          <option value="Stat">Stat</option>
                        </select>
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await createLabOrderAction({
                              visitId: selectedVisit.visitId,
                              testServiceId: labServiceId,
                              clinicalIndication: labIndication || diagnosis || 'Outpatient diagnostic evaluation',
                              priority: labPriority,
                            });
                            if (res.ok) {
                              setFeedback({ type: 'ok', text: 'Laboratory order sent to Lab Queue.' });
                              setLabIndication('');
                            }
                          }}
                          className="rounded-lg bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800"
                        >
                          Order Lab Test
                        </button>
                      </div>
                    </div>
                    {visitLabs.length > 0 && (
                      <div className="border-t border-slate-100 pt-2 text-xs space-y-1">
                        {visitLabs.map((l) => (
                          <p key={l.id} className="text-slate-600 tabular-nums">
                            {l.orderNumber} · {l.testName} · <strong>{l.status}</strong>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Optional Follow-Up Recommendation */}
                  <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Optional Follow-Up Recommendation
                    </h3>
                    <div className="space-y-2.5 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          aria-label="Recommended follow-up date"
                          value={fuDate}
                          onChange={(e) => setFuDate(e.target.value)}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                        />
                        <input
                          type="text"
                          aria-label="Follow-up interval label"
                          placeholder="e.g., In 7 days"
                          value={fuInterval}
                          onChange={(e) => setFuInterval(e.target.value)}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                        />
                      </div>
                      <input
                        type="text"
                        aria-label="Follow-up reason"
                        placeholder="Reason (e.g., Reassess symptom resolution & lab results)"
                        value={fuReason}
                        onChange={(e) => setFuReason(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!fuReason) return;
                          const res = await createFollowUpRecommendationAction({
                            visitId: selectedVisit.visitId,
                            recommendedDate: fuDate,
                            intervalLabel: fuInterval,
                            reason: fuReason,
                            instructions: fuInstructions || 'Schedule via Patient Portal or Reception.',
                          });
                          if (res.ok) {
                            setFeedback({
                              type: 'ok',
                              text: 'Follow-up recommendation issued to patient.',
                            });
                            setFuReason('');
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-1.5 font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Issue Follow-Up Recommendation
                      </button>
                    </div>
                  </div>
                </div>

                {/* Optional Prescription Builder */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Optional Outpatient Prescription (Rx)
                  </h3>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4 text-xs">
                    <input
                      type="text"
                      list="clinic-meds"
                      aria-label="Medicine generic or brand name"
                      placeholder="Medicine (e.g., Paracetamol)"
                      value={medName}
                      onChange={(e) => {
                        setMedName(e.target.value);
                        const found = inventory.find(
                          (m) => m.genericName.toLowerCase() === e.target.value.toLowerCase()
                        );
                        if (found) setMedStrength(found.strength);
                      }}
                      className="rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                    <datalist id="clinic-meds">
                      {inventory.map((m) => (
                        <option key={m.id} value={m.genericName}>
                          {m.strength} (Stock: {m.stockQuantity})
                        </option>
                      ))}
                    </datalist>
                    <input
                      type="text"
                      aria-label="Strength"
                      placeholder="Strength (500mg)"
                      value={medStrength}
                      onChange={(e) => setMedStrength(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                    <input
                      type="text"
                      aria-label="Dosage"
                      placeholder="Dosage (1 tablet)"
                      value={medDosage}
                      onChange={(e) => setMedDosage(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                    <input
                      type="text"
                      aria-label="Frequency"
                      placeholder="Frequency (Every 8 hrs)"
                      value={medFreq}
                      onChange={(e) => setMedFreq(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                    <input
                      type="text"
                      aria-label="Duration"
                      placeholder="Duration (5 days)"
                      value={medDuration}
                      onChange={(e) => setMedDuration(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                    <input
                      type="number"
                      aria-label="Quantity prescribed"
                      placeholder="Qty"
                      value={medQty}
                      onChange={(e) => setMedQty(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-2 tabular-nums"
                    />
                    <input
                      type="text"
                      aria-label="Special instructions"
                      placeholder="Instructions"
                      value={medInst}
                      onChange={(e) => setMedInst(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!medName.trim()) return;
                        const matched = inventory.find(
                          (m) => m.genericName.toLowerCase() === medName.trim().toLowerCase()
                        );
                        setRxItems((prev) => [
                          ...prev,
                          {
                            medicineId: matched?.id || `med-${Date.now()}`,
                            medicineName: medName.trim(),
                            strength: medStrength,
                            dosage: medDosage,
                            frequency: medFreq,
                            duration: medDuration,
                            route: 'Oral',
                            quantityPrescribed: Math.max(1, Number(medQty) || 1),
                            quantityDispensed: 0,
                            unitPricePhp: matched?.unitPricePhp || 10,
                            instructions: medInst,
                          },
                        ]);
                        setMedName('');
                      }}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Medication
                    </button>
                  </div>

                  {rxItems.length > 0 && (
                    <div className="space-y-2 border-t border-slate-100 pt-3 text-xs">
                      {rxItems.map((it, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                        >
                          <span>
                            <strong>
                              {it.medicineName} {it.strength}
                            </strong>{' '}
                            — {it.dosage}, {it.frequency} for {it.duration} (Qty{' '}
                            {it.quantityPrescribed})
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${it.medicineName}`}
                            onClick={() => setRxItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-rose-600 hover:text-rose-800"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}

                      <div className="flex items-center justify-between gap-2 pt-2">
                        <input
                          type="text"
                          aria-label="Additional prescription notes"
                          placeholder="Optional prescriber notes"
                          value={rxNotes}
                          onChange={(e) => setRxNotes(e.target.value)}
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await createPrescriptionAction({
                              visitId: selectedVisit.visitId,
                              items: rxItems,
                              notes: rxNotes,
                            });
                            if (res.ok) {
                              setFeedback({
                                type: 'ok',
                                text: 'Signed prescription transmitted to Outpatient Pharmacy.',
                              });
                              setRxItems([]);
                              setRxNotes('');
                            }
                          }}
                          className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
                        >
                          Sign &amp; Send Prescription
                        </button>
                      </div>
                    </div>
                  )}

                  {visitRx.length > 0 && (
                    <div className="border-t border-slate-100 pt-2 text-xs text-slate-600">
                      Issued Rx for this visit:{' '}
                      {visitRx.map((r) => `${r.prescriptionNumber} (${r.status})`).join(', ')}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 2. LAB RESULTS VIEW */}
      {activeTab === 'labs' && (
        <div className="space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Ordered &amp; Released Laboratory Diagnostics
          </h1>
          {labOrders.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No laboratory orders placed yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {labOrders.map((l) => (
                <div
                  key={l.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 text-xs"
                >
                  <div>
                    <p className="font-mono font-bold text-slate-900 tabular-nums">
                      {l.orderNumber} · {l.patientName} ({l.patientId})
                    </p>
                    <p className="text-slate-600">
                      {l.testName} · Status: <strong className="text-blue-700">{l.status}</strong>
                    </p>
                  </div>
                  {l.status === 'Released' && (
                    <button
                      type="button"
                      onClick={() => setDocModal({ type: 'lab', record: l })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Review Report
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. PHARMACY CLARIFICATION REQUESTS */}
      {activeTab === 'rx_clarify' && (
        <div className="space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Prescriptions &amp; Pharmacist Clarifications
          </h1>
          {prescriptions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No prescriptions issued yet.
            </div>
          ) : (
            <div className="space-y-4">
              {prescriptions.map((rx) => (
                <div key={rx.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {rx.prescriptionNumber} · {rx.patientName}
                    </span>
                    <span className="font-semibold text-blue-700">{rx.status}</span>
                  </div>
                  <p className="text-slate-700">
                    {rx.items
                      .map((i) => `${i.medicineName} ${i.strength} (${i.dosage}, ${i.frequency})`)
                      .join(' · ')}
                  </p>
                  {rx.status === 'Needs Clarification' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                      <p className="font-semibold text-amber-900">
                        Pharmacist Clarification Query: {rx.clarificationQuestion}
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          aria-label="Doctor clarification response"
                          placeholder="Provide authorized clinical clarification..."
                          value={clarifyReplyMap[rx.id] || ''}
                          onChange={(e) =>
                            setClarifyReplyMap((prev) => ({ ...prev, [rx.id]: e.target.value }))
                          }
                          className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const reply = clarifyReplyMap[rx.id];
                            if (!reply) return;
                            const res = await respondPrescriptionClarificationAction({
                              prescriptionId: rx.id,
                              clarificationResponse: reply,
                              updatedItems: rx.items,
                              updatedNotes: rx.notes,
                            });
                            if (res.ok) {
                              setFeedback({
                                type: 'ok',
                                text: 'Clarification sent back to Pharmacy.',
                              });
                            }
                          }}
                          className="rounded-lg bg-blue-700 px-3.5 py-1.5 font-semibold text-white"
                        >
                          Send Clarification
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. FINALIZED CONSULTATION RECORDS */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Finalized Consultation Records ({consultations.length})
          </h1>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {consultations.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-4 text-xs"
              >
                <div>
                  <p className="font-bold text-slate-900">
                    {c.patientName} ({c.patientId}) · {c.visitDate}
                  </p>
                  <p className="text-slate-600">
                    {c.diagnosisType}: {c.diagnosis} · Status: {c.status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDocModal({ type: 'consultation', record: c })}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Preview / PDF
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. PERSONAL SCHEDULE & LEAVE REQUEST */}
      {activeTab === 'schedule_leave' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3 text-xs">
            <h2 className="font-display text-base font-bold text-slate-900">
              My Configured Outpatient Schedule
            </h2>
            {mySchedule ? (
              <div className="space-y-1.5 text-slate-700 tabular-nums">
                <p>
                  <strong>Hours:</strong> {mySchedule.startTime} – {mySchedule.endTime} (Break{' '}
                  {mySchedule.breakStart} – {mySchedule.breakEnd})
                </p>
                <p>
                  <strong>Slot Duration:</strong> {mySchedule.consultationDurationMinutes} minutes
                </p>
              </div>
            ) : (
              <p className="text-slate-500">
                Schedule managed by Clinic Administration.
              </p>
            )}
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await submitDoctorLeaveRequestAction({
                startDate: leaveStart,
                endDate: leaveEnd,
                reason: leaveReason,
              });
              if (res.ok) {
                setFeedback({
                  type: 'ok',
                  text: 'Leave request submitted for Administrator review.',
                });
                setLeaveReason('');
              }
            }}
            className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 text-xs"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              Submit Physician Leave Request
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="lv-start" className="block font-semibold text-slate-700">
                  Start Date
                </label>
                <input
                  id="lv-start"
                  type="date"
                  required
                  value={leaveStart}
                  onChange={(e) => setLeaveStart(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="lv-end" className="block font-semibold text-slate-700">
                  End Date
                </label>
                <input
                  id="lv-end"
                  type="date"
                  required
                  value={leaveEnd}
                  onChange={(e) => setLeaveEnd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 tabular-nums"
                />
              </div>
            </div>
            <div>
              <label htmlFor="lv-reason" className="block font-semibold text-slate-700">
                Reason for Leave
              </label>
              <input
                id="lv-reason"
                type="text"
                required
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
            >
              Submit Leave Request
            </button>

            {leaveRequests.length > 0 && (
              <div className="border-t border-slate-100 pt-3 space-y-1">
                {leaveRequests.map((lr) => (
                  <p key={lr.id} className="text-slate-600 tabular-nums">
                    {lr.startDate} to {lr.endDate} · <strong>{lr.status}</strong>
                  </p>
                ))}
              </div>
            )}
          </form>
        </div>
      )}

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
