import { jsPDF } from 'jspdf';
import type {
  Appointment,
  BillingRecord,
  ClinicalPatientRecord,
  ConsultationRecord,
  LaboratoryOrder,
  PrescriptionRecord,
} from '../types/clinic';

function addHeader(doc: jsPDF, title: string, docRef: string, issuedDate: string) {
  doc.setFillColor(29, 78, 216); // Blue-700
  doc.rect(0, 0, 210, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('SmartClinic Outpatient Healthcare Center', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Outpatient Clinical Management System  |  Document Verification Record', 14, 19);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(title, 14, 37);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Document ID: ${docRef}`, 14, 43);
  doc.text(`Date Issued: ${issuedDate}`, 130, 43);

  doc.setDrawColor(203, 213, 225);
  doc.line(14, 47, 196, 47);
}

function addWrappedSection(doc: jsPDF, y: number, label: string, body: string): number {
  let cursorY = y;
  if (cursorY > 255) {
    doc.addPage();
    cursorY = 20;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(label, 14, cursorY);
  cursorY += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  const lines = doc.splitTextToSize(body || 'None recorded', 180);
  doc.text(lines, 14, cursorY);
  return cursorY + lines.length * 4.8 + 5;
}

function addFooter(doc: jsPDF, signatoryLabel: string, statusLabel: string) {
  const y = 266;
  doc.setDrawColor(203, 213, 225);
  doc.line(14, y, 196, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Authorized Sign-off: ${signatoryLabel}`, 14, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Release Status: ${statusLabel}`, 14, y + 11);
  doc.text(
    'Generated electronically by SmartClinic. Contains no fabricated signatures or unverified external claims.',
    14,
    y + 16
  );
}

export function downloadConsultationPdf(
  consultation: ConsultationRecord,
  patient?: ClinicalPatientRecord | null
) {
  const doc = new jsPDF();
  addHeader(
    doc,
    'OUTPATIENT CONSULTATION SUMMARY',
    `DOC-CONS-${consultation.visitId}`,
    consultation.finalizedAt ? consultation.finalizedAt.slice(0, 10) : consultation.visitDate
  );

  let y = 55;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Patient Name: ${consultation.patientName}`, 14, y);
  doc.text(`Patient ID: ${consultation.patientId}`, 120, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(`Visit / Encounter ID: ${consultation.visitId}`, 14, y);
  doc.text(`Consultation Date: ${consultation.visitDate} (${consultation.appointmentType})`, 120, y);
  if (patient?.dateOfBirth) {
    y += 6;
    doc.text(`Date of Birth: ${patient.dateOfBirth}  |  Sex: ${patient.sex}`, 14, y);
  }
  y += 10;

  y = addWrappedSection(doc, y, 'Chief Complaint', consultation.chiefComplaint);
  y = addWrappedSection(doc, y, 'Clinical Findings', consultation.clinicalFindings);
  y = addWrappedSection(
    doc,
    y,
    `${consultation.diagnosisType}`,
    consultation.diagnosis
  );
  y = addWrappedSection(doc, y, 'Treatment Plan', consultation.treatmentPlan);
  y = addWrappedSection(
    doc,
    y,
    'Patient Care & Follow-up Instructions',
    consultation.patientInstructions
  );

  if (consultation.amendments && consultation.amendments.length > 0) {
    const amendText = consultation.amendments
      .map(
        (a) =>
          `[${a.amendedAt.slice(0, 16)}] Amended by ${a.amendedByName}: ${a.reason} (${a.summaryOfChanges})`
      )
      .join('\n');
    addWrappedSection(doc, y, 'Authorized Clinical Amendments', amendText);
  }

  addFooter(
    doc,
    `${consultation.doctorName}${consultation.doctorTitle ? ` (${consultation.doctorTitle})` : ''}`,
    `${consultation.status} Outpatient Consultation Record`
  );
  doc.save(`SmartClinic_Consultation_${consultation.visitId}.pdf`);
}

export function downloadLabResultPdf(lab: LaboratoryOrder) {
  const doc = new jsPDF();
  addHeader(
    doc,
    'OFFICIAL LABORATORY RESULT REPORT',
    lab.orderNumber,
    (lab.releasedAt || lab.verifiedAt || lab.updatedAt || '').slice(0, 10)
  );

  let y = 55;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`Patient Name: ${lab.patientName}`, 14, y);
  doc.text(`Patient ID: ${lab.patientId}`, 125, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(`Visit ID: ${lab.visitId}`, 14, y);
  doc.text(`Specimen ID: ${lab.sampleId || 'N/A'}`, 125, y);
  y += 6;
  doc.text(`Requesting Physician: ${lab.orderedByDoctorName}`, 14, y);
  doc.text(`Test Performed: ${lab.testName} (${lab.testCode})`, 125, y);
  y += 10;

  // Table header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y - 4, 182, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Parameter', 16, y + 1);
  doc.text('Result', 85, y + 1);
  doc.text('Unit', 120, y + 1);
  doc.text('Reference Range', 145, y + 1);
  doc.text('Flag', 180, y + 1);
  y += 8;

  doc.setFont('helvetica', 'normal');
  for (const item of lab.resultItems) {
    doc.text(item.parameter.slice(0, 35), 16, y);
    doc.text(String(item.value), 85, y);
    doc.text(item.unit || '-', 120, y);
    doc.text(item.referenceRange || '-', 145, y);
    doc.text(item.flag, 180, y);
    y += 6.5;
  }

  y += 6;
  addWrappedSection(doc, y, 'Laboratory Remarks', lab.technicianRemarks || 'No additional remarks.');

  addFooter(
    doc,
    `Entered by ${lab.enteredByName || 'Lab Staff'}  |  Verified by ${lab.verifiedByName || 'Verifier'}`,
    `Status: ${lab.status}`
  );
  doc.save(`SmartClinic_LabResult_${lab.orderNumber}.pdf`);
}

export function downloadPrescriptionPdf(rx: PrescriptionRecord) {
  const doc = new jsPDF();
  addHeader(
    doc,
    'OUTPATIENT MEDICAL PRESCRIPTION (Rx)',
    rx.prescriptionNumber,
    (rx.createdAt || '').slice(0, 10)
  );

  let y = 55;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`Patient Name: ${rx.patientName}`, 14, y);
  doc.text(`Patient ID: ${rx.patientId}`, 125, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(`Visit ID: ${rx.visitId}`, 14, y);
  doc.text(`Prescribing Physician: ${rx.doctorName}`, 125, y);
  y += 10;

  rx.items.forEach((item, index) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(
      `${index + 1}. ${item.medicineName} ${item.strength}  —  Qty: ${item.quantityPrescribed}`,
      14,
      y
    );
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Sig: ${item.dosage} | ${item.frequency} | Duration: ${item.duration} | Route: ${item.route || 'Oral'}`,
      18,
      y
    );
    y += 4.8;
    if (item.instructions) {
      doc.text(`Instructions: ${item.instructions}`, 18, y);
      y += 5;
    }
    y += 3;
  });

  if (rx.notes) {
    addWrappedSection(doc, y + 2, 'Additional Prescriber Notes', rx.notes);
  }

  addFooter(
    doc,
    `${rx.doctorName}${rx.doctorTitle ? ` (${rx.doctorTitle})` : ''}`,
    `Dispensing Status: ${rx.status}`
  );
  doc.save(`SmartClinic_Prescription_${rx.prescriptionNumber}.pdf`);
}

export function downloadBillingReceiptPdf(billing: BillingRecord) {
  const doc = new jsPDF();
  addHeader(
    doc,
    'OUTPATIENT BILLING STATEMENT & PAYMENT ACKNOWLEDGMENT',
    billing.invoiceRef,
    billing.visitDate
  );

  let y = 55;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`Patient Name: ${billing.patientName}`, 14, y);
  doc.text(`Patient ID: ${billing.patientId}`, 125, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(`Visit ID: ${billing.visitId}`, 14, y);
  doc.text(`Coverage Source: ${billing.coverageSource}`, 125, y);
  y += 10;

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y - 4, 182, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Service / Dispensed Item', 16, y + 1);
  doc.text('Category', 110, y + 1);
  doc.text('Qty', 142, y + 1);
  doc.text('Subtotal (PHP)', 162, y + 1);
  y += 8;

  doc.setFont('helvetica', 'normal');
  for (const item of billing.items) {
    doc.text(item.description.slice(0, 48), 16, y);
    doc.text(item.category, 110, y);
    doc.text(String(item.quantity), 144, y);
    doc.text(item.subtotalPhp.toFixed(2), 165, y);
    y += 6.5;
  }

  y += 5;
  doc.line(115, y, 196, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text(`Gross Total: PHP ${billing.totalAmountPhp.toFixed(2)}`, 125, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.text(`Approved Manual Coverage: PHP ${billing.approvedCoverageAmountPhp.toFixed(2)}`, 125, y);
  y += 5.5;
  doc.text(`Authorized Adjustment: PHP ${billing.adjustmentAmountPhp.toFixed(2)}`, 125, y);
  y += 5.5;
  doc.text(`Total Payments Recorded: PHP ${billing.amountPaidPhp.toFixed(2)}`, 125, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text(`Remaining Balance: PHP ${billing.remainingBalancePhp.toFixed(2)}`, 125, y);

  addFooter(
    doc,
    billing.coverageVerifiedByName || 'SmartClinic Front Desk Billing',
    `${billing.paymentStatus} — Payment Acknowledgment Receipt (Not an Official Tax Invoice)`
  );
  doc.save(`SmartClinic_Statement_${billing.invoiceRef}.pdf`);
}

export function downloadAppointmentPassPdf(appt: Appointment, qrDataUrl?: string) {
  const doc = new jsPDF();
  addHeader(doc, 'APPOINTMENT CONFIRMATION & QR CHECK-IN PASS', appt.referenceNumber, appt.appointmentDate);

  let y = 58;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Reference Number: ${appt.referenceNumber}`, 14, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Patient Name: ${appt.patientName} (${appt.patientId})`, 14, y);
  y += 7;
  doc.text(`Service: ${appt.serviceName}`, 14, y);
  y += 7;
  doc.text(`Assigned Doctor: ${appt.doctorName}`, 14, y);
  y += 7;
  doc.text(`Scheduled Date & Time: ${appt.appointmentDate} at ${appt.appointmentTime} - ${appt.endTime}`, 14, y);
  y += 7;
  doc.text(`Booking Status: ${appt.status}`, 14, y);

  if (qrDataUrl && qrDataUrl.startsWith('data:image/')) {
    doc.addImage(qrDataUrl, 'PNG', 135, 55, 52, 52);
  }

  addFooter(
    doc,
    'SmartClinic Online Scheduling',
    'Present this QR Pass at Reception upon arrival. Contains zero sensitive clinical data.'
  );
  doc.save(`SmartClinic_Appointment_${appt.referenceNumber}.pdf`);
}
