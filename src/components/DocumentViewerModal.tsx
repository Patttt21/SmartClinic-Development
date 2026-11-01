import React from 'react';
import { Download, Printer, X } from 'lucide-react';
import type {
  Appointment,
  BillingRecord,
  ClinicalPatientRecord,
  ConsultationRecord,
  LaboratoryOrder,
  PrescriptionRecord,
} from '../types/clinic';
import {
  downloadAppointmentPassPdf,
  downloadBillingReceiptPdf,
  downloadConsultationPdf,
  downloadLabResultPdf,
  downloadPrescriptionPdf,
} from '../utils/pdfGenerator';

export type DocumentModalPayload =
  | { type: 'consultation'; record: ConsultationRecord; patient?: ClinicalPatientRecord | null }
  | { type: 'lab'; record: LaboratoryOrder }
  | { type: 'prescription'; record: PrescriptionRecord }
  | { type: 'billing'; record: BillingRecord }
  | { type: 'appointment'; record: Appointment; qrDataUrl?: string };

interface DocumentViewerModalProps {
  docPayload: DocumentModalPayload | null;
  onClose: () => void;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  docPayload,
  onClose,
}) => {
  if (!docPayload) return null;

  const handleDownloadPdf = () => {
    switch (docPayload.type) {
      case 'consultation':
        downloadConsultationPdf(docPayload.record, docPayload.patient);
        break;
      case 'lab':
        downloadLabResultPdf(docPayload.record);
        break;
      case 'prescription':
        downloadPrescriptionPdf(docPayload.record);
        break;
      case 'billing':
        downloadBillingReceiptPdf(docPayload.record);
        break;
      case 'appointment':
        downloadAppointmentPassPdf(docPayload.record, docPayload.qrDataUrl);
        break;
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clinical Document Viewer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
    >
      <div className="my-8 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Action Header (hidden when printing) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
              SmartClinic Official Document Preview
            </p>
            <h2 className="font-display text-base font-bold text-slate-900">
              {docPayload.type === 'consultation' && 'Outpatient Consultation Summary'}
              {docPayload.type === 'lab' && 'Verified & Released Laboratory Report'}
              {docPayload.type === 'prescription' && 'Signed Medical Prescription'}
              {docPayload.type === 'billing' && 'Billing Statement & Payment Acknowledgment'}
              {docPayload.type === 'appointment' && 'Appointment Confirmation & QR Pass'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </button>
            <button
              type="button"
              aria-label="Close document preview"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable Document Sheet */}
        <div className="p-6 sm:p-8 space-y-6 text-slate-800">
          <div className="flex flex-col justify-between gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg font-bold text-blue-700">
                SmartClinic Outpatient Healthcare Center
              </p>
              <p className="text-xs text-slate-500">
                Outpatient Clinical Management & Document Record
              </p>
            </div>
            <div className="text-xs text-slate-600 tabular-nums sm:text-right">
              {docPayload.type === 'consultation' && (
                <>
                  <p className="font-semibold text-slate-900">DOC-CONS-{docPayload.record.visitId}</p>
                  <p>Date: {docPayload.record.visitDate}</p>
                </>
              )}
              {docPayload.type === 'lab' && (
                <>
                  <p className="font-semibold text-slate-900">{docPayload.record.orderNumber}</p>
                  <p>Released: {(docPayload.record.releasedAt || '').slice(0, 10)}</p>
                </>
              )}
              {docPayload.type === 'prescription' && (
                <>
                  <p className="font-semibold text-slate-900">{docPayload.record.prescriptionNumber}</p>
                  <p>Issued: {(docPayload.record.createdAt || '').slice(0, 10)}</p>
                </>
              )}
              {docPayload.type === 'billing' && (
                <>
                  <p className="font-semibold text-slate-900">{docPayload.record.invoiceRef}</p>
                  <p>Visit Date: {docPayload.record.visitDate}</p>
                </>
              )}
              {docPayload.type === 'appointment' && (
                <>
                  <p className="font-semibold text-slate-900">{docPayload.record.referenceNumber}</p>
                  <p>Scheduled: {docPayload.record.appointmentDate}</p>
                </>
              )}
            </div>
          </div>

          {docPayload.type === 'consultation' && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-slate-900">Patient:</span>{' '}
                  {docPayload.record.patientName} ({docPayload.record.patientId})
                </p>
                <p className="tabular-nums">
                  <span className="font-semibold text-slate-900">Encounter ID:</span>{' '}
                  {docPayload.record.visitId}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Attending Physician:</span>{' '}
                  {docPayload.record.doctorName}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Record Status:</span>{' '}
                  {docPayload.record.status}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Chief Complaint
                </h4>
                <p className="mt-1 text-slate-800">{docPayload.record.chiefComplaint}</p>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Clinical Findings
                </h4>
                <p className="mt-1 whitespace-pre-line text-slate-800">
                  {docPayload.record.clinicalFindings}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {docPayload.record.diagnosisType}
                </h4>
                <p className="mt-1 font-medium text-slate-900">{docPayload.record.diagnosis}</p>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Treatment Plan & Care Instructions
                </h4>
                <p className="mt-1 whitespace-pre-line text-slate-800">
                  {docPayload.record.treatmentPlan}
                </p>
                {docPayload.record.patientInstructions && (
                  <p className="mt-2 whitespace-pre-line text-slate-700">
                    {docPayload.record.patientInstructions}
                  </p>
                )}
              </div>
              {docPayload.record.amendments.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs">
                  <p className="font-semibold text-amber-900">Authorized Amendment History</p>
                  {docPayload.record.amendments.map((am, idx) => (
                    <p key={idx} className="mt-1 text-amber-800">
                      {am.amendedAt.slice(0, 16).replace('T', ' ')} by {am.amendedByName}: {am.reason} (
                      {am.summaryOfChanges})
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {docPayload.type === 'lab' && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-slate-900">Patient:</span>{' '}
                  {docPayload.record.patientName} ({docPayload.record.patientId})
                </p>
                <p className="tabular-nums">
                  <span className="font-semibold text-slate-900">Specimen ID:</span>{' '}
                  {docPayload.record.sampleId || 'Recorded'}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Test:</span>{' '}
                  {docPayload.record.testName} ({docPayload.record.testCode})
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Verified By:</span>{' '}
                  {docPayload.record.verifiedByName || 'Laboratory Staff'}
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 font-semibold text-slate-700">
                    <tr>
                      <th className="px-4 py-2.5">Parameter</th>
                      <th className="px-4 py-2.5">Result</th>
                      <th className="px-4 py-2.5">Unit</th>
                      <th className="px-4 py-2.5">Reference Range</th>
                      <th className="px-4 py-2.5">Interpretation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docPayload.record.resultItems.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 font-medium text-slate-900">{item.parameter}</td>
                        <td className="px-4 py-2 font-mono font-semibold tabular-nums">{item.value}</td>
                        <td className="px-4 py-2 text-slate-600">{item.unit}</td>
                        <td className="px-4 py-2 text-slate-600 tabular-nums">{item.referenceRange}</td>
                        <td className="px-4 py-2 font-medium text-slate-800">{item.flag}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {docPayload.record.technicianRemarks && (
                <p className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">Remarks:</span>{' '}
                  {docPayload.record.technicianRemarks}
                </p>
              )}
            </div>
          )}

          {docPayload.type === 'prescription' && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-slate-900">Patient:</span>{' '}
                  {docPayload.record.patientName} ({docPayload.record.patientId})
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Prescriber:</span>{' '}
                  {docPayload.record.doctorName}
                </p>
                <p className="tabular-nums">
                  <span className="font-semibold text-slate-900">Visit ID:</span>{' '}
                  {docPayload.record.visitId}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Dispensing Status:</span>{' '}
                  {docPayload.record.status}
                </p>
              </div>
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                {docPayload.record.items.map((item, idx) => (
                  <div key={idx} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">
                        {idx + 1}. {item.medicineName} {item.strength}
                      </p>
                      <span className="text-xs font-semibold text-slate-700 tabular-nums">
                        Qty Prescribed: {item.quantityPrescribed} · Dispensed: {item.quantityDispensed}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Dosage: {item.dosage} · Frequency: {item.frequency} · Duration: {item.duration} ·
                      Route: {item.route || 'Oral'}
                    </p>
                    {item.instructions && (
                      <p className="mt-1 text-xs text-slate-700">Instructions: {item.instructions}</p>
                    )}
                  </div>
                ))}
              </div>
              {docPayload.record.notes && (
                <p className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">Prescriber Notes:</span>{' '}
                  {docPayload.record.notes}
                </p>
              )}
            </div>
          )}

          {docPayload.type === 'billing' && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-slate-900">Patient:</span>{' '}
                  {docPayload.record.patientName} ({docPayload.record.patientId})
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Coverage Source:</span>{' '}
                  {docPayload.record.coverageSource}
                </p>
                <p className="tabular-nums">
                  <span className="font-semibold text-slate-900">Visit ID:</span>{' '}
                  {docPayload.record.visitId}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Payment Status:</span>{' '}
                  {docPayload.record.paymentStatus}
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 font-semibold text-slate-700">
                    <tr>
                      <th className="px-4 py-2.5">Performed Service / Dispensed Item</th>
                      <th className="px-4 py-2.5">Category</th>
                      <th className="px-4 py-2.5 text-right">Qty</th>
                      <th className="px-4 py-2.5 text-right">Subtotal (PHP)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docPayload.record.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2 font-medium text-slate-900">{item.description}</td>
                        <td className="px-4 py-2 text-slate-600">{item.category}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{item.quantity}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {item.subtotalPhp.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto max-w-xs space-y-1 text-right text-xs tabular-nums">
                <p>Gross Total: PHP {docPayload.record.totalAmountPhp.toFixed(2)}</p>
                <p>
                  Manual Coverage Deduction: PHP {docPayload.record.approvedCoverageAmountPhp.toFixed(2)}
                </p>
                <p>Authorized Adjustment: PHP {docPayload.record.adjustmentAmountPhp.toFixed(2)}</p>
                <p>Payments Recorded: PHP {docPayload.record.amountPaidPhp.toFixed(2)}</p>
                <p className="border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900">
                  Remaining Balance: PHP {docPayload.record.remainingBalancePhp.toFixed(2)}
                </p>
              </div>
              <p className="text-[11px] text-slate-500">
                Notice: This statement serves as an outpatient Billing Summary and Payment Acknowledgment
                Receipt. It does not claim BIR-accredited electronic tax invoice status.
              </p>
            </div>
          )}

          {docPayload.type === 'appointment' && (
            <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-semibold text-slate-900">Reference Number:</span>{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {docPayload.record.referenceNumber}
                  </span>
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Patient:</span>{' '}
                  {docPayload.record.patientName} ({docPayload.record.patientId})
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Service:</span>{' '}
                  {docPayload.record.serviceName}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Assigned Doctor:</span>{' '}
                  {docPayload.record.doctorName}
                </p>
                <p className="tabular-nums">
                  <span className="font-semibold text-slate-900">Date & Time:</span>{' '}
                  {docPayload.record.appointmentDate} · {docPayload.record.appointmentTime} –{' '}
                  {docPayload.record.endTime}
                </p>
                <p className="text-xs text-slate-500 pt-2">
                  Privacy Note: This QR pass encodes only a signed opaque verification token. No
                  diagnosis, vital signs, or confidential medical notes are stored inside the QR code.
                </p>
              </div>
              {docPayload.qrDataUrl && (
                <div className="shrink-0 rounded-xl border border-slate-200 p-3 text-center">
                  <img
                    src={docPayload.qrDataUrl}
                    alt={`QR Code for ${docPayload.record.referenceNumber}`}
                    className="h-40 w-40"
                  />
                  <p className="mt-1 font-mono text-[11px] text-slate-600 tabular-nums">
                    {docPayload.record.referenceNumber}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
