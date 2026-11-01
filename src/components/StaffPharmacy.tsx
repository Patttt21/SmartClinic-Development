import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  MessageSquareWarning,
  Pill,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import { addDaysToIsoDate, getManilaDateIso } from '../utils/scheduling';
import type { PrescriptionRecord } from '../types/clinic';
import { StaffShell } from './StaffShell';
import { NotificationHistoryView } from './NotificationCenter';
import { DocumentModalPayload, DocumentViewerModal } from './DocumentViewerModal';

interface StaffPharmacyProps {
  onNavigate: (path: string) => void;
}

export const StaffPharmacy: React.FC<StaffPharmacyProps> = ({ onNavigate }) => {
  const {
    prescriptions,
    inventory,
    notifications,
    updatePrescriptionPharmacyAction,
    upsertMedicineInventoryAction,
    markNotificationReadAction,
  } = useClinic();

  const [activeTab, setActiveTab] = useState('rx_queue');
  const [selectedRxId, setSelectedRxId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [docModal, setDocModal] = useState<DocumentModalPayload | null>(null);

  // Clarification & Dispense State
  const [clarificationText, setClarificationText] = useState('');
  const [dispenseQtyMap, setDispenseQtyMap] = useState<Record<string, number>>({});

  // Medicine Inventory Form State
  const [sku, setSku] = useState('');
  const [genericName, setGenericName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [dosageForm, setDosageForm] = useState('Tablet');
  const [strength, setStrength] = useState('500mg');
  const [stockQty, setStockQty] = useState('100');
  const [reorderLevel, setReorderLevel] = useState('25');
  const [unitPrice, setUnitPrice] = useState('8');
  const [batchNumber, setBatchNumber] = useState('BCH-2026');
  const [expiryDate, setExpiryDate] = useState('2027-12-31');

  const todayManila = getManilaDateIso();
  const nearExpiryCutoff = addDaysToIsoDate(todayManila, 60);

  const pendingRx = useMemo(
    () =>
      prescriptions.filter(
        (r) => r.status !== 'Dispensed' && r.status !== 'Not Available'
      ),
    [prescriptions]
  );

  const historyRx = useMemo(
    () =>
      prescriptions.filter(
        (r) => r.status === 'Dispensed' || r.status === 'Partially Dispensed' || r.status === 'Not Available'
      ),
    [prescriptions]
  );

  const selectedRx: PrescriptionRecord | null = useMemo(
    () => prescriptions.find((r) => r.id === selectedRxId) || pendingRx[0] || null,
    [prescriptions, selectedRxId, pendingRx]
  );

  const lowOrExpiringItems = useMemo(
    () =>
      inventory.filter(
        (m) => m.stockQuantity <= m.reorderLevel || m.expiryDate <= nearExpiryCutoff
      ),
    [inventory, nearExpiryCutoff]
  );

  const selectPrescription = (rx: PrescriptionRecord) => {
    setSelectedRxId(rx.id);
    const initialMap: Record<string, number> = {};
    rx.items.forEach((it) => {
      initialMap[it.medicineId] = it.quantityPrescribed;
    });
    setDispenseQtyMap(initialMap);
    setClarificationText('');
  };

  const navItems = [
    {
      id: 'rx_queue',
      label: 'Prescription Queue',
      icon: Pill,
      badgeCount: pendingRx.length,
    },
    {
      id: 'inventory',
      label: 'Medicine Inventory',
      icon: Boxes,
      badgeCount: inventory.length,
    },
    {
      id: 'alerts',
      label: 'Low-Stock & Expiry Alerts',
      icon: AlertTriangle,
      badgeCount: lowOrExpiringItems.length,
    },
    { id: 'history', label: 'Dispensing History', icon: ClipboardList },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badgeCount: notifications.filter((n) => !n.read).length,
    },
  ];

  return (
    <StaffShell
      roleLabel="Outpatient Pharmacy"
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

      {/* 1. PRESCRIPTION QUEUE & DISPENSING */}
      {activeTab === 'rx_queue' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                Active Prescription Queue
              </h1>
              <p className="text-xs text-slate-500">
                Pharmacists review signed prescriptions and never silently alter physician orders.
              </p>
            </div>

            {pendingRx.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No prescriptions awaiting review or dispensing.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {pendingRx.map((rx) => (
                  <button
                    key={rx.id}
                    type="button"
                    onClick={() => selectPrescription(rx)}
                    className={`w-full p-3.5 text-left text-xs transition-colors ${
                      selectedRx?.id === rx.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {rx.prescriptionNumber}
                      </span>
                      <span className="font-semibold text-blue-700">{rx.status}</span>
                    </div>
                    <p className="mt-0.5 font-semibold text-slate-800">{rx.patientName}</p>
                    <p className="text-slate-500">Dr. {rx.doctorName}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-8 space-y-5">
            {!selectedRx ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Select a prescription from the queue to review dosage, request clarification if
                needed, or dispense medications.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <p className="font-mono text-xs font-bold text-blue-700 tabular-nums">
                      {selectedRx.prescriptionNumber} · Visit {selectedRx.visitId}
                    </p>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      {selectedRx.patientName} ({selectedRx.patientId})
                    </h2>
                    <p className="text-xs text-slate-600">
                      Prescribed by {selectedRx.doctorName}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-slate-900">
                    Status: {selectedRx.status}
                  </span>
                </div>

                {selectedRx.clarificationResponse && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    <strong>Doctor Clarification Received:</strong>{' '}
                    {selectedRx.clarificationResponse}
                  </div>
                )}

                <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                  {selectedRx.items.map((item) => {
                    const invMatch = inventory.find(
                      (m) =>
                        m.id === item.medicineId ||
                        m.genericName.toLowerCase() === item.medicineName.toLowerCase()
                    );
                    const qtyVal =
                      dispenseQtyMap[item.medicineId] ?? item.quantityPrescribed;
                    return (
                      <div
                        key={item.medicineId}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-900">
                            {item.medicineName} {item.strength} — Prescribed Qty:{' '}
                            {item.quantityPrescribed}
                          </p>
                          <p className="text-slate-600">
                            {item.dosage} · {item.frequency} · {item.duration}
                          </p>
                          <p className="text-slate-500 mt-0.5 tabular-nums">
                            Clinic Stock:{' '}
                            <strong>{invMatch ? invMatch.stockQuantity : 'Unlisted'}</strong>
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`disp-${item.medicineId}`}
                            className="font-semibold text-slate-700"
                          >
                            Qty to Dispense:
                          </label>
                          <input
                            id={`disp-${item.medicineId}`}
                            type="number"
                            min={0}
                            max={item.quantityPrescribed}
                            value={qtyVal}
                            onChange={(e) =>
                              setDispenseQtyMap((prev) => ({
                                ...prev,
                                [item.medicineId]: Number(e.target.value),
                              }))
                            }
                            className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pharmacist Clarification Request */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
                  <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <MessageSquareWarning className="h-4 w-4 text-amber-600" />
                    Need Dose / Substitution Clarification from Prescribing Doctor?
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      aria-label="Pharmacist clarification question"
                      placeholder="Enter specific question for prescribing physician..."
                      value={clarificationText}
                      onChange={(e) => setClarificationText(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!clarificationText.trim()) return;
                        const res = await updatePrescriptionPharmacyAction({
                          prescriptionId: selectedRx.id,
                          nextStatus: 'Needs Clarification',
                          clarificationQuestion: clarificationText.trim(),
                        });
                        if (res.ok) {
                          setFeedback({
                            type: 'ok',
                            text: 'Clarification request sent to prescribing Doctor.',
                          });
                          setClarificationText('');
                        }
                      }}
                      className="rounded-lg border border-amber-300 bg-amber-100 px-3.5 py-1.5 font-semibold text-amber-900 hover:bg-amber-200"
                    >
                      Request Clarification
                    </button>
                  </div>
                </div>

                {/* Dispensing Actions */}
                <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100 pt-4 text-xs">
                  <button
                    type="button"
                    onClick={async () => {
                      await updatePrescriptionPharmacyAction({
                        prescriptionId: selectedRx.id,
                        nextStatus: 'Ready for Dispensing',
                      });
                      setFeedback({ type: 'ok', text: 'Marked Ready for Dispensing.' });
                    }}
                    className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Mark Ready for Pickup
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await updatePrescriptionPharmacyAction({
                        prescriptionId: selectedRx.id,
                        nextStatus: 'Not Available',
                      });
                      setFeedback({ type: 'ok', text: 'Marked Not Available at clinic pharmacy.' });
                    }}
                    className="rounded-lg border border-rose-200 px-3.5 py-2 font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    Out of Stock / External Fill
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const finalMap: Record<string, number> = {};
                      let allFull = true;
                      selectedRx.items.forEach((it) => {
                        const q = dispenseQtyMap[it.medicineId] ?? it.quantityPrescribed;
                        finalMap[it.medicineId] = q;
                        if (q < it.quantityPrescribed) allFull = false;
                      });
                      const res = await updatePrescriptionPharmacyAction({
                        prescriptionId: selectedRx.id,
                        nextStatus: allFull ? 'Dispensed' : 'Partially Dispensed',
                        dispensedQuantities: finalMap,
                      });
                      if (res.ok) {
                        setFeedback({
                          type: 'ok',
                          text: `Prescription ${selectedRx.prescriptionNumber} dispensed and stock updated.`,
                        });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-5 py-2 font-semibold text-white hover:bg-blue-800"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm Dispensing &amp; Deduct Stock
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. MEDICINE INVENTORY MANAGEMENT */}
      {activeTab === 'inventory' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await upsertMedicineInventoryAction({
                sku: sku || `MED-${Date.now().toString().slice(-4)}`,
                genericName,
                brandName: brandName || genericName,
                dosageForm,
                strength,
                stockQuantity: Number(stockQty) || 0,
                reorderLevel: Number(reorderLevel) || 20,
                unitPricePhp: Number(unitPrice) || 5,
                batchNumber,
                expiryDate,
              });
              if (res.ok) {
                setFeedback({ type: 'ok', text: 'Medicine inventory item saved.' });
                setGenericName('');
                setBrandName('');
                setSku('');
              }
            }}
            className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              Add / Update Medicine Stock
            </h2>
            <div>
              <label htmlFor="inv-gen" className="block font-semibold text-slate-700">
                Generic Name
              </label>
              <input
                id="inv-gen"
                type="text"
                required
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="inv-str" className="block font-semibold text-slate-700">
                  Strength
                </label>
                <input
                  id="inv-str"
                  type="text"
                  required
                  value={strength}
                  onChange={(e) => setStrength(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div>
                <label htmlFor="inv-form" className="block font-semibold text-slate-700">
                  Dosage Form
                </label>
                <input
                  id="inv-form"
                  type="text"
                  required
                  value={dosageForm}
                  onChange={(e) => setDosageForm(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="inv-qty" className="block font-semibold text-slate-700">
                  Stock Qty
                </label>
                <input
                  id="inv-qty"
                  type="number"
                  required
                  value={stockQty}
                  onChange={(e) => setStockQty(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="inv-reorder" className="block font-semibold text-slate-700">
                  Reorder At
                </label>
                <input
                  id="inv-reorder"
                  type="number"
                  required
                  value={reorderLevel}
                  onChange={(e) => setReorderLevel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="inv-price" className="block font-semibold text-slate-700">
                  Unit PHP
                </label>
                <input
                  id="inv-price"
                  type="number"
                  step="0.01"
                  required
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="inv-batch" className="block font-semibold text-slate-700">
                  Batch #
                </label>
                <input
                  id="inv-batch"
                  type="text"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label htmlFor="inv-exp" className="block font-semibold text-slate-700">
                  Expiry Date
                </label>
                <input
                  id="inv-exp"
                  type="date"
                  required
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 tabular-nums"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
            >
              Save Inventory Item
            </button>
          </form>

          <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-display text-base font-bold text-slate-900 mb-3">
              Outpatient Medicine Catalog ({inventory.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 font-semibold text-slate-700">
                  <tr>
                    <th className="px-3 py-2.5">SKU</th>
                    <th className="px-3 py-2.5">Generic / Strength</th>
                    <th className="px-3 py-2.5 text-right">Stock</th>
                    <th className="px-3 py-2.5 text-right">Unit PHP</th>
                    <th className="px-3 py-2.5">Batch / Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inventory.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2.5 font-mono text-slate-700 tabular-nums">{m.sku}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900">
                        {m.genericName} {m.strength} ({m.dosageForm})
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${
                          m.stockQuantity <= m.reorderLevel ? 'text-rose-700' : 'text-slate-900'
                        }`}
                      >
                        {m.stockQuantity}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {m.unitPricePhp.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                        {m.batchNumber} · {m.expiryDate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. LOW-STOCK & EXPIRY ALERTS */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Low-Stock &amp; Near-Expiry Inventory Alerts ({lowOrExpiringItems.length})
          </h1>
          {lowOrExpiringItems.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              All medicine inventory items are above reorder thresholds and outside the 60-day
              expiry window.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {lowOrExpiringItems.map((m) => (
                <div key={m.id} className="p-4 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-slate-900">
                      {m.genericName} {m.strength} ({m.sku})
                    </p>
                    <p className="text-slate-600 tabular-nums">
                      Stock: <strong className="text-rose-700">{m.stockQuantity}</strong> (Reorder
                      Level: {m.reorderLevel}) · Expiry: <strong>{m.expiryDate}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inventory')}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Restock
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. DISPENSING HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <h1 className="font-display text-xl font-bold text-slate-900">
            Dispensing History ({historyRx.length})
          </h1>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {historyRx.map((rx) => (
              <div key={rx.id} className="p-4 flex items-center justify-between text-xs">
                <div>
                  <p className="font-mono font-bold text-slate-900 tabular-nums">
                    {rx.prescriptionNumber} · {rx.patientName}
                  </p>
                  <p className="text-slate-600">
                    Status: <strong>{rx.status}</strong> · Reviewed by{' '}
                    {rx.reviewedByPharmacistName || 'Pharmacy'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDocModal({ type: 'prescription', record: rx })}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700"
                >
                  View Rx
                </button>
              </div>
            ))}
          </div>
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
