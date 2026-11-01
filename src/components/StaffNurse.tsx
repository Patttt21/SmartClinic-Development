import React, { useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  CheckCircle2,
  ClipboardList,
  FileText,
  HeartPulse,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import { getManilaDateIso } from '../utils/scheduling';
import { sortUnifiedQueue } from '../utils/clinicalWorkflow';
import type { ClinicalPriority } from '../types/clinic';
import { StaffShell } from './StaffShell';
import { NotificationHistoryView } from './NotificationCenter';

interface StaffNurseProps {
  onNavigate: (path: string) => void;
}

export const StaffNurse: React.FC<StaffNurseProps> = ({ onNavigate }) => {
  const {
    visits,
    patients,
    nursingAssessments,
    consultations,
    notifications,
    saveNursingAssessmentAction,
    updateVisitQueueStatusAction,
    markNotificationReadAction,
  } = useClinic();

  const [activeTab, setActiveTab] = useState('triage');
  const [selectedVisitId, setSelectedVisitId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Structured Vital Signs & Triage Assessment State
  const [bp, setBp] = useState('120/80');
  const [tempC, setTempC] = useState('36.8');
  const [pulse, setPulse] = useState('76');
  const [respRate, setRespRate] = useState('16');
  const [spo2, setSpo2] = useState('98');
  const [weightKg, setWeightKg] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [additionalSymptoms, setAdditionalSymptoms] = useState('');
  const [symptomOnset, setSymptomOnset] = useState('');
  const [nursingObservations, setNursingObservations] = useState('');
  const [priority, setPriority] = useState<ClinicalPriority>('Routine');

  const todayManila = getManilaDateIso();

  const activeQueue = useMemo(
    () =>
      sortUnifiedQueue(
        visits.filter(
          (v) => v.visitDate === todayManila && v.queueStatus !== 'Checked Out'
        )
      ),
    [visits, todayManila]
  );

  const selectedVisit = useMemo(
    () => visits.find((v) => v.visitId === selectedVisitId) || activeQueue[0] || null,
    [visits, selectedVisitId, activeQueue]
  );

  const selectedPatient = useMemo(
    () => patients.find((p) => p.patientId === selectedVisit?.patientId) || null,
    [patients, selectedVisit]
  );

  const pastConsultations = useMemo(
    () =>
      consultations.filter(
        (c) => c.patientId === selectedVisit?.patientId && c.status === 'Finalized'
      ),
    [consultations, selectedVisit]
  );

  const loadExistingAssessment = (visitId: string) => {
    setSelectedVisitId(visitId);
    const existing = nursingAssessments.find((n) => n.visitId === visitId);
    if (existing) {
      setBp(existing.bloodPressure);
      setTempC(existing.bodyTemperatureC);
      setPulse(existing.pulseRateBpm);
      setRespRate(existing.respiratoryRateCpm);
      setSpo2(existing.oxygenSaturationPct);
      setWeightKg(existing.weightKg);
      setHeightCm(existing.heightCm);
      setChiefComplaint(existing.chiefComplaint);
      setAdditionalSymptoms(existing.additionalSymptoms);
      setSymptomOnset(existing.symptomOnset);
      setNursingObservations(existing.nursingObservations);
      setPriority(existing.clinicalPriority);
    } else {
      const v = visits.find((x) => x.visitId === visitId);
      setBp('120/80');
      setTempC('36.8');
      setPulse('76');
      setRespRate('16');
      setSpo2('98');
      setWeightKg('');
      setHeightCm('');
      setChiefComplaint('');
      setAdditionalSymptoms('');
      setSymptomOnset('');
      setNursingObservations('');
      setPriority(v?.clinicalPriority || 'Routine');
    }
  };

  const navItems = [
    {
      id: 'triage',
      label: 'Patient Queue & Vitals',
      icon: HeartPulse,
      badgeCount: activeQueue.filter(
        (v) => v.queueStatus === 'Waiting for Nurse' || v.queueStatus === 'Checked In'
      ).length,
    },
    {
      id: 'completed',
      label: 'Completed Assessments',
      icon: ClipboardList,
      badgeCount: nursingAssessments.length,
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badgeCount: notifications.filter((n) => !n.read).length,
    },
  ];

  return (
    <StaffShell
      roleLabel="Outpatient Triage Nurse"
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

      {activeTab === 'triage' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Unified Triage Queue */}
          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                Unified Triage Queue
              </h1>
              <p className="text-xs text-slate-500">
                Sorted by Clinical Priority, then arrival order.
              </p>
            </div>

            {activeQueue.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                No active encounters waiting in today&apos;s queue.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {activeQueue.map((v) => {
                  const isSelected = selectedVisit?.visitId === v.visitId;
                  return (
                    <button
                      key={v.visitId}
                      type="button"
                      onClick={() => {
                        loadExistingAssessment(v.visitId);
                        if (v.queueStatus === 'Waiting for Nurse' || v.queueStatus === 'Checked In') {
                          updateVisitQueueStatusAction(v.visitId, 'In Assessment');
                        }
                      }}
                      className={`w-full p-3.5 text-left text-xs transition-colors ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                          {v.queueNumber} · {v.patientName}
                        </span>
                        <span className="font-semibold text-blue-700">{v.clinicalPriority}</span>
                      </div>
                      <p className="mt-1 text-slate-500">
                        {v.appointmentType} · {v.doctorName} · <strong>{v.queueStatus}</strong>
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Structured Vital Signs & Initial Assessment Form */}
          <div className="lg:col-span-8 space-y-5">
            {!selectedVisit ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Select a checked-in patient from the queue to record vital signs and initial
                nursing assessment.
              </div>
            ) : (
              <>
                {/* Patient Summary & Medical History Card */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-display text-lg font-bold text-slate-900">
                        {selectedVisit.patientName} ({selectedVisit.patientId})
                      </h2>
                      <p className="text-xs text-slate-600 tabular-nums">
                        Encounter {selectedVisit.visitId} · Assigned Physician:{' '}
                        <strong>{selectedVisit.doctorName}</strong>
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-blue-700">
                      Status: {selectedVisit.queueStatus}
                    </span>
                  </div>

                  {selectedPatient && (
                    <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-3">
                      <p className="tabular-nums">
                        <strong>DOB / Sex:</strong> {selectedPatient.dateOfBirth} ·{' '}
                        {selectedPatient.sex}
                      </p>
                      <p>
                        <strong>Allergies:</strong> {selectedPatient.allergies || 'None reported'}
                      </p>
                      <p>
                        <strong>Chronic Conditions:</strong>{' '}
                        {selectedPatient.chronicConditions || 'None reported'}
                      </p>
                    </div>
                  )}

                  {pastConsultations.length > 0 && (
                    <div className="text-xs text-slate-600 border-t border-slate-100 pt-2">
                      <strong>Previous Consultations ({pastConsultations.length}):</strong>{' '}
                      {pastConsultations
                        .slice(0, 2)
                        .map((c) => `${c.visitDate} (${c.diagnosis})`)
                        .join(' · ')}
                    </div>
                  )}
                </div>

                {/* Vitals & Triage Form */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const res = await saveNursingAssessmentAction({
                      visitId: selectedVisit.visitId,
                      bloodPressure: bp,
                      bodyTemperatureC: tempC,
                      pulseRateBpm: pulse,
                      respiratoryRateCpm: respRate,
                      oxygenSaturationPct: spo2,
                      weightKg,
                      heightCm,
                      chiefComplaint,
                      additionalSymptoms,
                      symptomOnset,
                      nursingObservations,
                      clinicalPriority: priority,
                      markReadyForDoctor: true,
                    });
                    if (!res.ok) {
                      setFeedback({ type: 'err', text: res.error || 'Could not save assessment.' });
                    } else {
                      setFeedback({
                        type: 'ok',
                        text: `Vital signs & assessment saved. ${selectedVisit.patientName} is now Ready for Doctor (${selectedVisit.doctorName}).`,
                      });
                    }
                  }}
                  className="rounded-xl border border-slate-200 bg-white p-6 space-y-5"
                >
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Activity className="h-5 w-5 text-blue-700" />
                    <h3 className="font-display text-base font-bold text-slate-900">
                      Structured Vital Signs & Triage Assessment
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <label htmlFor="v-bp" className="block text-xs font-semibold text-slate-700">
                        Blood Pressure (mmHg)
                      </label>
                      <input
                        id="v-bp"
                        type="text"
                        required
                        placeholder="120/80"
                        value={bp}
                        onChange={(e) => setBp(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="v-temp" className="block text-xs font-semibold text-slate-700">
                        Temperature (°C)
                      </label>
                      <input
                        id="v-temp"
                        type="number"
                        step="0.1"
                        required
                        value={tempC}
                        onChange={(e) => setTempC(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="v-pulse" className="block text-xs font-semibold text-slate-700">
                        Pulse Rate (bpm)
                      </label>
                      <input
                        id="v-pulse"
                        type="number"
                        required
                        value={pulse}
                        onChange={(e) => setPulse(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="v-rr" className="block text-xs font-semibold text-slate-700">
                        Resp. Rate (cpm)
                      </label>
                      <input
                        id="v-rr"
                        type="number"
                        required
                        value={respRate}
                        onChange={(e) => setRespRate(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="v-spo2" className="block text-xs font-semibold text-slate-700">
                        Oxygen Sat. SpO2 (%)
                      </label>
                      <input
                        id="v-spo2"
                        type="number"
                        required
                        value={spo2}
                        onChange={(e) => setSpo2(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="v-wt" className="block text-xs font-semibold text-slate-700">
                        Weight (kg)
                      </label>
                      <input
                        id="v-wt"
                        type="number"
                        step="0.1"
                        placeholder="Optional"
                        value={weightKg}
                        onChange={(e) => setWeightKg(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="v-ht" className="block text-xs font-semibold text-slate-700">
                        Height (cm)
                      </label>
                      <input
                        id="v-ht"
                        type="number"
                        step="0.1"
                        placeholder="Optional"
                        value={heightCm}
                        onChange={(e) => setHeightCm(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="v-prio" className="block text-xs font-semibold text-slate-700">
                        Clinical Priority
                      </label>
                      <select
                        id="v-prio"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as ClinicalPriority)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium"
                      >
                        <option value="Routine">Routine</option>
                        <option value="Priority">Priority</option>
                        <option value="Urgent Referral">Urgent Hospital Referral</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="v-cc" className="block text-xs font-semibold text-slate-700">
                        Primary Chief Complaint
                      </label>
                      <input
                        id="v-cc"
                        type="text"
                        required
                        placeholder="e.g., Fever and cough for 2 days"
                        value={chiefComplaint}
                        onChange={(e) => setChiefComplaint(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="v-onset" className="block text-xs font-semibold text-slate-700">
                        Symptom Duration / Onset
                      </label>
                      <input
                        id="v-onset"
                        type="text"
                        placeholder="e.g., Started 48 hours ago"
                        value={symptomOnset}
                        onChange={(e) => setSymptomOnset(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="v-symp" className="block text-xs font-semibold text-slate-700">
                      Additional Associated Symptoms
                    </label>
                    <input
                      id="v-symp"
                      type="text"
                      placeholder="e.g., Mild sore throat, body malaise, no dyspnea"
                      value={additionalSymptoms}
                      onChange={(e) => setAdditionalSymptoms(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="v-obs" className="block text-xs font-semibold text-slate-700">
                      Nursing Clinical Observations / Referral Note
                    </label>
                    <textarea
                      id="v-obs"
                      rows={3}
                      placeholder="Alert, ambulatory, oriented. No acute respiratory distress."
                      value={nursingObservations}
                      onChange={(e) => setNursingObservations(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-800"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Complete Assessment &amp; Mark Ready for Doctor
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'completed' && (
        <div className="space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Completed Nursing Assessments ({nursingAssessments.length})
          </h1>
          {nursingAssessments.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No nursing assessments completed yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {nursingAssessments.map((na) => (
                <div key={na.visitId} className="p-4 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      Visit {na.visitId} · Patient {na.patientId}
                    </span>
                    <span className="font-semibold text-blue-700">{na.clinicalPriority}</span>
                  </div>
                  <p className="text-slate-700 tabular-nums">
                    BP {na.bloodPressure} mmHg · Temp {na.bodyTemperatureC} °C · HR{' '}
                    {na.pulseRateBpm} bpm · RR {na.respiratoryRateCpm} cpm · SpO2{' '}
                    {na.oxygenSaturationPct}%
                  </p>
                  <p className="text-slate-600">
                    Chief Complaint: <strong>{na.chiefComplaint}</strong> ({na.standardizedComplaint})
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
