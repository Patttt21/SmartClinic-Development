import type {
  Appointment,
  AppointmentReminder,
  BillingLineItem,
  ClinicalPatientRecord,
  ClinicalPriority,
  LaboratoryOrder,
  PaymentEntry,
  PaymentStatus,
  PrescriptionRecord,
  QueueStatus,
  StandardizedComplaintCategory,
  VisitEncounter,
} from '../types/clinic';

export function categorizeChiefComplaint(rawComplaint: string): StandardizedComplaintCategory {
  const text = (rawComplaint || '').toLowerCase().trim();
  if (!text) return 'Other Complaints';

  if (/\b(fever|febrile|pyrexia|chills|high temp|mainit|lagnat)\b/.test(text)) {
    return 'Fever';
  }
  if (/\b(cough|ubo|colds|phlegm|sore throat|congestion|runny nose)\b/.test(text)) {
    return 'Cough';
  }
  if (/\b(headache|migraine|head pain|dizziness|sakit ng ulo|cephalalgia)\b/.test(text)) {
    return 'Headache';
  }
  if (
    /\b(stomach|abdominal|epigastric|diarrhea|vomiting|nausea|gastritis|dyspepsia|tiyan|stomachache)\b/.test(
      text
    )
  ) {
    return 'Stomach Pain';
  }
  return 'Other Complaints';
}

const VALID_QUEUE_TRANSITIONS: Record<QueueStatus, QueueStatus[]> = {
  'Checked In': ['Waiting for Nurse', 'In Assessment', 'Checked Out'],
  'Waiting for Nurse': ['In Assessment', 'Ready for Doctor', 'Checked Out'],
  'In Assessment': ['Ready for Doctor', 'Checked Out'],
  'Ready for Doctor': ['In Consultation', 'In Assessment', 'Checked Out'],
  'In Consultation': ['Consultation Completed'],
  'Consultation Completed': ['Checked Out', 'In Consultation'],
  'Checked Out': [],
};

export function canTransitionQueueStatus(from: QueueStatus, to: QueueStatus): boolean {
  if (from === to) return true;
  return VALID_QUEUE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function sortUnifiedQueue(visits: VisitEncounter[]): VisitEncounter[] {
  const priorityWeight: Record<ClinicalPriority, number> = {
    'Urgent Referral': 0,
    Priority: 1,
    Routine: 2,
  };

  return [...visits].sort((a, b) => {
    const pDiff = priorityWeight[a.clinicalPriority] - priorityWeight[b.clinicalPriority];
    if (pDiff !== 0) return pDiff;

    // Online scheduled appointments that arrived around their scheduled window precede later arrivals
    if (a.appointmentType !== b.appointmentType) {
      if (a.appointmentType === 'Online' && a.scheduledTime && b.scheduledTime === '') {
        return a.arrivalTime.localeCompare(b.arrivalTime) <= 0 ? -1 : 0;
      }
    }
    return a.arrivalTime.localeCompare(b.arrivalTime);
  });
}

export function hasDuplicateActiveVisit(
  patientId: string,
  visitDate: string,
  visits: VisitEncounter[]
): boolean {
  return visits.some(
    (v) =>
      v.patientId === patientId &&
      v.visitDate === visitDate &&
      v.queueStatus !== 'Checked Out'
  );
}

/**
 * Computes itemized visit billing strictly from performed clinical services:
 * - Completed consultation fee
 * - ONLY Verified/Released or Processed laboratory tests (never unperformed 'Requested' orders)
 * - ONLY actually dispensed medicine quantities (never undispensed items)
 */
export function buildVisitBillingItems(params: {
  consultationCompleted: boolean;
  consultationServiceName: string;
  consultationFeePhp: number;
  visitId: string;
  labOrders: LaboratoryOrder[];
  prescriptions: PrescriptionRecord[];
}): BillingLineItem[] {
  const items: BillingLineItem[] = [];

  if (params.consultationCompleted && params.consultationFeePhp > 0) {
    items.push({
      id: `chg-cons-${params.visitId}`,
      category: 'Consultation',
      description: params.consultationServiceName || 'Outpatient Consultation',
      quantity: 1,
      unitPricePhp: params.consultationFeePhp,
      subtotalPhp: params.consultationFeePhp,
      sourceRecordId: params.visitId,
    });
  }

  const performedLabStatuses = new Set(['Processing', 'For Verification', 'Verified', 'Released']);
  for (const lab of params.labOrders) {
    if (lab.visitId === params.visitId && performedLabStatuses.has(lab.status) && lab.feePhp > 0) {
      items.push({
        id: `chg-lab-${lab.id}`,
        category: 'Laboratory',
        description: `Laboratory: ${lab.testName} (${lab.orderNumber})`,
        quantity: 1,
        unitPricePhp: lab.feePhp,
        subtotalPhp: lab.feePhp,
        sourceRecordId: lab.id,
      });
    }
  }

  for (const rx of params.prescriptions) {
    if (rx.visitId !== params.visitId) continue;
    if (rx.status !== 'Dispensed' && rx.status !== 'Partially Dispensed') continue;
    for (const med of rx.items) {
      if (med.quantityDispensed > 0 && med.unitPricePhp > 0) {
        const sub = Number((med.quantityDispensed * med.unitPricePhp).toFixed(2));
        items.push({
          id: `chg-med-${rx.id}-${med.medicineId}`,
          category: 'Pharmacy',
          description: `Medicine: ${med.medicineName} ${med.strength} x${med.quantityDispensed}`,
          quantity: med.quantityDispensed,
          unitPricePhp: med.unitPricePhp,
          subtotalPhp: sub,
          sourceRecordId: rx.id,
        });
      }
    }
  }

  return items;
}

export function calculateBillingSummary(params: {
  items: BillingLineItem[];
  approvedCoverageAmountPhp: number;
  adjustmentAmountPhp: number;
  payments: PaymentEntry[];
}): {
  totalAmountPhp: number;
  amountPaidPhp: number;
  remainingBalancePhp: number;
  paymentStatus: PaymentStatus;
} {
  const totalAmountPhp = Number(
    params.items.reduce((sum, item) => sum + item.subtotalPhp, 0).toFixed(2)
  );
  const coverage = Math.max(0, Math.min(totalAmountPhp, params.approvedCoverageAmountPhp || 0));
  const adjustment = params.adjustmentAmountPhp || 0;

  const netPayable = Math.max(0, Number((totalAmountPhp - coverage - adjustment).toFixed(2)));
  const amountPaidPhp = Number(
    params.payments.reduce((sum, p) => sum + p.amountPhp, 0).toFixed(2)
  );
  const remainingBalancePhp = Math.max(0, Number((netPayable - amountPaidPhp).toFixed(2)));

  let paymentStatus: PaymentStatus = 'Unpaid';
  if (adjustment > 0 && netPayable === 0) {
    paymentStatus = 'Adjusted / Refunded';
  } else if (remainingBalancePhp === 0 && (totalAmountPhp > 0 || coverage > 0)) {
    paymentStatus = 'Paid';
  } else if (amountPaidPhp > 0 && remainingBalancePhp > 0) {
    paymentStatus = 'Partially Paid';
  }

  return {
    totalAmountPhp,
    amountPaidPhp,
    remainingBalancePhp,
    paymentStatus,
  };
}

/**
 * Computes Asia/Manila appointment timestamp and determines whether the 24-hour
 * in-app reminder is currently due (or immediately due if booked <24h ahead).
 */
export function parseManilaAppointmentUtcMs(appointmentDate: string, appointmentTime: string): number {
  const hhmm = appointmentTime || '09:00';
  return Date.parse(`${appointmentDate}T${hhmm}:00+08:00`);
}

export function computeDueAppointmentReminders(params: {
  appointments: Appointment[];
  existingReminders: AppointmentReminder[];
  nowMs?: number;
}): {
  dueAppointments: Appointment[];
  reminderDueAtIsoMap: Record<string, string>;
} {
  const now = params.nowMs ?? Date.now();
  const materializedIds = new Set(
    params.existingReminders
      .filter((r) => r.status === 'Materialized')
      .map((r) => r.appointmentId)
  );

  const dueAppointments: Appointment[] = [];
  const reminderDueAtIsoMap: Record<string, string> = {};

  for (const appt of params.appointments) {
    if (appt.status !== 'Confirmed' || !appt.portalUserId) continue;
    if (materializedIds.has(appt.id)) continue;

    const apptUtcMs = parseManilaAppointmentUtcMs(appt.appointmentDate, appt.appointmentTime);
    if (Number.isNaN(apptUtcMs) || apptUtcMs <= now) continue;

    const twentyFourHoursBefore = apptUtcMs - 24 * 60 * 60 * 1000;
    reminderDueAtIsoMap[appt.id] = new Date(twentyFourHoursBefore).toISOString();

    if (now >= twentyFourHoursBefore) {
      dueAppointments.push(appt);
    }
  }

  return { dueAppointments, reminderDueAtIsoMap };
}

/**
 * Privacy-safe candidate matcher for former walk-in patients requesting portal linkage.
 * Never exposes confidential medical notes; returns masked match confidence for staff review.
 */
export function findCandidateWalkInRecordForLink(params: {
  requestedFullName: string;
  requestedDob: string;
  knownPatientIdHint?: string;
  clinicalRecords: ClinicalPatientRecord[];
}): { matched: boolean; candidatePatientId: string; maskedLabel: string } {
  const normName = params.requestedFullName.trim().toLowerCase().replace(/\s+/g, ' ');
  const dob = params.requestedDob.trim();
  const hint = (params.knownPatientIdHint || '').trim().toUpperCase();

  for (const rec of params.clinicalRecords) {
    if (rec.portalUserId) continue; // Already linked to an account
    const recName = rec.fullName.trim().toLowerCase().replace(/\s+/g, ' ');
    const idMatches = hint && rec.patientId.toUpperCase() === hint;

    if ((recName === normName && rec.dateOfBirth === dob) || (idMatches && rec.dateOfBirth === dob)) {
      const maskedPhone = rec.phone
        ? `${rec.phone.slice(0, 3)}****${rec.phone.slice(-2)}`
        : 'On file';
      return {
        matched: true,
        candidatePatientId: rec.patientId,
        maskedLabel: `Record ${rec.patientId} (${maskedPhone}) — Pending Staff Identity Verification`,
      };
    }
  }

  return {
    matched: false,
    candidatePatientId: '',
    maskedLabel: 'No unlinked exact match found automatically — queued for manual front-desk verification',
  };
}
