import React, { useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FlaskConical,
  Plus,
  TestTube2,
  Trash2,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import type { LaboratoryOrder, LabTestResultItem } from '../types/clinic';
import { StaffShell } from './StaffShell';
import { NotificationHistoryView } from './NotificationCenter';
import { DocumentModalPayload, DocumentViewerModal } from './DocumentViewerModal';

interface StaffLaboratoryProps {
  onNavigate: (path: string) => void;
}

export const StaffLaboratory: React.FC<StaffLaboratoryProps> = ({ onNavigate }) => {
  const {
    labOrders,
    notifications,
    advanceLabOrderAction,
    markNotificationReadAction,
  } = useClinic();

  const [activeTab, setActiveTab] = useState('queue');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [docModal, setDocModal] = useState<DocumentModalPayload | null>(null);

  // Result Entry State
  const [sampleIdInput, setSampleIdInput] = useState('');
  const [resultRows, setResultRows] = useState<LabTestResultItem[]>([
    {
      parameter: 'Hemoglobin',
      value: '14.1',
      unit: 'g/dL',
      referenceRange: '12.0 - 16.0',
      flag: 'Normal',
    },
    {
      parameter: 'WBC Count',
      value: '7.4',
      unit: 'x10^9/L',
      referenceRange: '4.5 - 11.0',
      flag: 'Normal',
    },
  ]);
  const [paramName, setParamName] = useState('');
  const [paramVal, setParamVal] = useState('');
  const [paramUnit, setParamUnit] = useState('');
  const [paramRef, setParamRef] = useState('');
  const [paramFlag, setParamFlag] = useState<LabTestResultItem['flag']>('Normal');
  const [remarks, setRemarks] = useState('');

  const activeOrders = useMemo(
    () => labOrders.filter((l) => l.status !== 'Released'),
    [labOrders]
  );
  const releasedOrders = useMemo(
    () => labOrders.filter((l) => l.status === 'Released'),
    [labOrders]
  );

  const selectedOrder: LaboratoryOrder | null = useMemo(
    () =>
      labOrders.find((l) => l.id === selectedOrderId) ||
      activeOrders[0] ||
      null,
    [labOrders, selectedOrderId, activeOrders]
  );

  const selectOrder = (ord: LaboratoryOrder) => {
    setSelectedOrderId(ord.id);
    setSampleIdInput(ord.sampleId || `SMP-${ord.orderNumber.slice(-4)}`);
    if (ord.resultItems.length > 0) {
      setResultRows(ord.resultItems);
    }
    setRemarks(ord.technicianRemarks || '');
  };

  const navItems = [
    {
      id: 'queue',
      label: 'Active Lab Requests',
      icon: TestTube2,
      badgeCount: activeOrders.length,
    },
    {
      id: 'released',
      label: 'Released Reports & History',
      icon: ClipboardCheck,
      badgeCount: releasedOrders.length,
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
      roleLabel="Clinical Laboratory"
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

      {activeTab === 'queue' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Active Lab Orders Queue */}
          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                Laboratory Worklist
              </h1>
              <p className="text-xs text-slate-500">
                Requested &rarr; Sample Collected &rarr; Processing &rarr; Verified &rarr; Released
              </p>
            </div>

            {activeOrders.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No pending laboratory orders in the worklist.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {activeOrders.map((ord) => (
                  <button
                    key={ord.id}
                    type="button"
                    onClick={() => selectOrder(ord)}
                    className={`w-full p-3.5 text-left text-xs transition-colors ${
                      selectedOrder?.id === ord.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {ord.orderNumber}
                      </span>
                      <span className="font-semibold text-blue-700">{ord.priority}</span>
                    </div>
                    <p className="mt-0.5 font-semibold text-slate-800">
                      {ord.patientName} ({ord.patientId})
                    </p>
                    <p className="text-slate-500">
                      {ord.testName} · <strong>{ord.status}</strong>
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Specimen Tracking, Result Entry & Verification */}
          <div className="lg:col-span-8 space-y-5">
            {!selectedOrder ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Select a laboratory order from the worklist to log specimen collection, enter
                structured diagnostic values, verify, and release.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                  <div>
                    <p className="font-mono text-xs font-bold text-blue-700 tabular-nums">
                      {selectedOrder.orderNumber} · Visit {selectedOrder.visitId}
                    </p>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      {selectedOrder.testName} ({selectedOrder.testCode})
                    </h2>
                    <p className="text-xs text-slate-600">
                      Patient: <strong>{selectedOrder.patientName}</strong> ({selectedOrder.patientId})
                      · Ordered by {selectedOrder.orderedByDoctorName}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Indication: {selectedOrder.clinicalIndication}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-slate-900">
                    Stage: {selectedOrder.status}
                  </span>
                </div>

                {/* Stage 1 & 2: Specimen Collection & Processing */}
                {(selectedOrder.status === 'Requested' ||
                  selectedOrder.status === 'Sample Collected') && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
                    <p className="font-semibold text-slate-900">
                      Specimen Collection &amp; Analyzer Processing
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="text"
                        aria-label="Specimen Barcode / Sample ID"
                        placeholder="Specimen ID (e.g., SMP-2026-01)"
                        value={sampleIdInput}
                        onChange={(e) => setSampleIdInput(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono"
                      />
                      {selectedOrder.status === 'Requested' && (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await advanceLabOrderAction({
                              orderId: selectedOrder.id,
                              nextStatus: 'Sample Collected',
                              sampleId: sampleIdInput || `SMP-${Date.now().toString().slice(-5)}`,
                            });
                            if (res.ok) setFeedback({ type: 'ok', text: 'Specimen collection logged.' });
                          }}
                          className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
                        >
                          Log Sample Collected
                        </button>
                      )}
                      {selectedOrder.status === 'Sample Collected' && (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await advanceLabOrderAction({
                              orderId: selectedOrder.id,
                              nextStatus: 'Processing',
                            });
                            if (res.ok) setFeedback({ type: 'ok', text: 'Marked as Processing.' });
                          }}
                          className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
                        >
                          Start Analyzer Processing
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Structured Result Entry Table */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-blue-700" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Structured Quantitative / Qualitative Parameters
                    </h3>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                      <thead className="bg-slate-50 font-semibold text-slate-700">
                        <tr>
                          <th className="px-3 py-2">Parameter</th>
                          <th className="px-3 py-2">Result</th>
                          <th className="px-3 py-2">Unit</th>
                          <th className="px-3 py-2">Reference Range</th>
                          <th className="px-3 py-2">Flag</th>
                          <th className="px-3 py-2 text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {resultRows.map((row, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 font-medium text-slate-900">{row.parameter}</td>
                            <td className="px-3 py-2 font-mono font-semibold tabular-nums">
                              {row.value}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{row.unit}</td>
                            <td className="px-3 py-2 text-slate-600 tabular-nums">
                              {row.referenceRange}
                            </td>
                            <td className="px-3 py-2 font-semibold text-slate-800">{row.flag}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                aria-label={`Delete parameter ${row.parameter}`}
                                onClick={() =>
                                  setResultRows((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-rose-600 hover:text-rose-800"
                              >
                                <Trash2 className="h-3.5 w-3.5 inline" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Add Parameter Row */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-6 text-xs">
                    <input
                      type="text"
                      aria-label="Parameter name"
                      placeholder="Parameter"
                      value={paramName}
                      onChange={(e) => setParamName(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                    <input
                      type="text"
                      aria-label="Result value"
                      placeholder="Value"
                      value={paramVal}
                      onChange={(e) => setParamVal(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                    />
                    <input
                      type="text"
                      aria-label="Measurement unit"
                      placeholder="Unit"
                      value={paramUnit}
                      onChange={(e) => setParamUnit(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                    <input
                      type="text"
                      aria-label="Reference range"
                      placeholder="Ref Range"
                      value={paramRef}
                      onChange={(e) => setParamRef(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5"
                    />
                    <select
                      aria-label="Interpretation flag"
                      value={paramFlag}
                      onChange={(e) => setParamFlag(e.target.value as LabTestResultItem['flag'])}
                      className="rounded-lg border border-slate-300 px-2 py-1.5"
                    >
                      <option value="Normal">Normal</option>
                      <option value="High">High</option>
                      <option value="Low">Low</option>
                      <option value="Abnormal">Abnormal</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (!paramName.trim() || !paramVal.trim()) return;
                        setResultRows((prev) => [
                          ...prev,
                          {
                            parameter: paramName.trim(),
                            value: paramVal.trim(),
                            unit: paramUnit.trim(),
                            referenceRange: paramRef.trim(),
                            flag: paramFlag,
                          },
                        ]);
                        setParamName('');
                        setParamVal('');
                      }}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Row
                    </button>
                  </div>

                  <div>
                    <label htmlFor="lab-remarks" className="block text-xs font-semibold text-slate-700">
                      Technologist / Verifier Remarks
                    </label>
                    <input
                      id="lab-remarks"
                      type="text"
                      placeholder="Specimen integrity verified. Parameters within analytical linearity."
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>

                  {/* Verification & Release Actions */}
                  <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                    {selectedOrder.status !== 'Verified' && (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await advanceLabOrderAction({
                            orderId: selectedOrder.id,
                            nextStatus: 'Verified',
                            sampleId: sampleIdInput || selectedOrder.sampleId || 'SMP-VERIFIED',
                            resultItems: resultRows,
                            technicianRemarks: remarks,
                          });
                          if (res.ok) {
                            setFeedback({
                              type: 'ok',
                              text: 'Results saved and formally Verified. Ready for official Release.',
                            });
                          }
                        }}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        Save &amp; Verify Results
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={selectedOrder.status !== 'Verified'}
                      onClick={async () => {
                        const res = await advanceLabOrderAction({
                          orderId: selectedOrder.id,
                          nextStatus: 'Released',
                          resultItems: resultRows,
                          technicianRemarks: remarks,
                        });
                        if (res.ok) {
                          setFeedback({
                            type: 'ok',
                            text: `Lab Report ${selectedOrder.orderNumber} officially Released to Attending Doctor and Patient Portal.`,
                          });
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Release Official Lab Report
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'released' && (
        <div className="space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Released Laboratory Reports ({releasedOrders.length})
          </h1>
          {releasedOrders.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No laboratory reports released yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {releasedOrders.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between p-4 text-xs"
                >
                  <div>
                    <p className="font-mono font-bold text-slate-900 tabular-nums">
                      {l.orderNumber} · {l.patientName} ({l.patientId})
                    </p>
                    <p className="text-slate-600">
                      {l.testName} · Verified by {l.verifiedByName} · Released{' '}
                      {(l.releasedAt || '').slice(0, 10)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocModal({ type: 'lab', record: l })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview / PDF
                  </button>
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

      <DocumentViewerModal docPayload={docModal} onClose={() => setDocModal(null)} />
    </StaffShell>
  );
};
