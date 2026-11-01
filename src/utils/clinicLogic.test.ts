import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  encryptTotpSecret,
  decryptTotpSecret,
  signAppointmentQrToken,
  verifyAppointmentQrTokenSignature,
  signMfaAssuranceToken,
  verifyMfaAssuranceToken,
} from './totp';
import {
  calculateAvailableSlots,
  assignDoctorForAnyAvailable,
  validateReplacementDateRule,
} from './scheduling';
import {
  buildVisitBillingItems,
  calculateBillingSummary,
  computeDueAppointmentReminders,
  canTransitionQueueStatus,
} from './clinicalWorkflow';
import {
  parseAndValidateEvaluatorCsv,
  runPredictiveAnalytics,
} from './forecasting';
import type { Appointment, DoctorSchedule, LeaveRequest } from '../types/clinic';

test('TOTP MFA secret encryption, 6-digit RFC 6238 verification, and AAL2 token validation', () => {
  const serverKey = 'unit-test-32-byte-secret-smartclinic-key';
  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret, serverKey);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptTotpSecret(encrypted, serverKey), secret);

  const fixedNow = 1_762_000_000_000;
  const validCode = generateTotpCode(secret, fixedNow);
  assert.equal(validCode.length, 6);
  assert.equal(verifyTotpCode(secret, validCode, fixedNow), true);
  assert.equal(verifyTotpCode(secret, '000000', fixedNow) && validCode !== '000000', false);

  const aal2 = signMfaAssuranceToken(
    {
      uid: 'staff-doc-1',
      role: 'doctor',
      verifiedAtMs: fixedNow,
      expiresAtMs: fixedNow + 1800_000,
    },
    serverKey
  );
  assert.ok(verifyMfaAssuranceToken(aal2, 'staff-doc-1', serverKey, fixedNow + 60_000));
  assert.equal(verifyMfaAssuranceToken(aal2, 'wrong-uid', serverKey, fixedNow + 60_000), null);
  assert.equal(verifyMfaAssuranceToken(aal2, 'staff-doc-1', serverKey, fixedNow + 1900_000), null);
});

test('Appointment QR token contains no medical PII and verifies HMAC integrity', () => {
  const serverKey = 'qr-signing-secret-test';
  const token = signAppointmentQrToken(
    {
      appointmentId: 'apt-101',
      referenceNumber: 'SC-APT-101',
      appointmentDate: '2026-11-05',
    },
    serverKey
  );
  assert.equal(token.includes('Fever'), false);
  const verified = verifyAppointmentQrTokenSignature(token, serverKey);
  assert.equal(verified.valid, true);
  assert.equal(verified.appointmentId, 'apt-101');

  const tampered = `${token.slice(0, -2)}XX`;
  assert.equal(verifyAppointmentQrTokenSignature(tampered, serverKey).valid, false);
});

test('Real-time slot availability prevents double booking, respects breaks and approved leave, and assigns least-loaded doctor', () => {
  const schedules: DoctorSchedule[] = [
    {
      id: 'doc-1',
      doctorUid: 'doc-1',
      doctorName: 'Dr. Rivera',
      specialty: 'Internal Medicine',
      workdays: [1, 2, 3, 4, 5], // Mon-Fri
      startTime: '09:00',
      endTime: '13:00',
      breakStart: '11:00',
      breakEnd: '12:00',
      consultationDurationMinutes: 60,
      slotCapacity: 1,
      qualifiedServiceIds: ['srv-gen'],
      active: true,
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'doc-2',
      doctorUid: 'doc-2',
      doctorName: 'Dr. Santos',
      specialty: 'Family Medicine',
      workdays: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '13:00',
      breakStart: '11:00',
      breakEnd: '12:00',
      consultationDurationMinutes: 60,
      slotCapacity: 1,
      qualifiedServiceIds: ['srv-gen'],
      active: true,
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  // 2026-11-02 is Monday
  const existingAppointments: Appointment[] = [
    {
      id: 'apt-existing',
      referenceNumber: 'SC-APT-001',
      patientId: 'PT-1',
      portalUserId: 'u-1',
      patientName: 'Test Patient',
      serviceId: 'srv-gen',
      serviceName: 'General Consultation',
      bookingMode: 'Specific Doctor',
      doctorUid: 'doc-1',
      doctorName: 'Dr. Rivera',
      appointmentDate: '2026-11-02',
      appointmentTime: '09:00',
      endTime: '10:00',
      durationMinutes: 60,
      status: 'Confirmed',
      qrToken: 'tok',
      qrStatus: 'Active',
      blockedReplacementDates: [],
      minReplacementDate: '',
      previousAppointmentId: '',
      followUpRecommendationId: '',
      reasonForVisit: 'Checkup',
      checkedInAt: '',
      visitId: '',
      statusHistory: [],
      authorizedViewerUids: [],
      createdAt: '',
      updatedAt: '',
    },
  ];

  const leaves: LeaveRequest[] = [];

  // Specific Doctor doc-1 on 2026-11-02: 09:00 booked, 11:00 break -> only 10:00 and 12:00 open
  const doc1Slots = calculateAvailableSlots({
    schedules,
    doctorUid: 'doc-1',
    serviceId: 'srv-gen',
    isoDate: '2026-11-02',
    todayIsoDate: '2026-11-01',
    leaves,
    existingAppointments,
  });
  assert.deepEqual(
    doc1Slots.map((s) => s.startTime),
    ['10:00', '12:00']
  );

  // Any Available Doctor at 10:00 should prefer doc-2 (0 bookings) over doc-1 (1 booking)
  const anySlots = calculateAvailableSlots({
    schedules,
    doctorUid: 'any',
    serviceId: 'srv-gen',
    isoDate: '2026-11-02',
    todayIsoDate: '2026-11-01',
    leaves,
    existingAppointments,
  });
  const tenAm = anySlots.find((s) => s.startTime === '10:00')!;
  const assigned = assignDoctorForAnyAvailable({
    candidateDoctorUids: tenAm.availableDoctorUids,
    schedules,
    isoDate: '2026-11-02',
    existingAppointments,
  });
  assert.equal(assigned?.doctorUid, 'doc-2');

  // Approved leave blocks doc-2 completely on 2026-11-03
  const leavesWithDoc2: LeaveRequest[] = [
    {
      id: 'lv-1',
      doctorUid: 'doc-2',
      doctorName: 'Dr. Santos',
      startDate: '2026-11-03',
      endDate: '2026-11-03',
      reason: 'Medical conference',
      status: 'Approved',
      reviewedByUid: 'admin-1',
      reviewNotes: 'Approved',
      affectedAppointmentIds: [],
      authorizedViewerUids: [],
      createdAt: '',
      updatedAt: '',
    },
  ];
  const doc2LeaveSlots = calculateAvailableSlots({
    schedules,
    doctorUid: 'doc-2',
    serviceId: 'srv-gen',
    isoDate: '2026-11-03',
    todayIsoDate: '2026-11-01',
    leaves: leavesWithDoc2,
    existingAppointments,
  });
  assert.equal(doc2LeaveSlots.length, 0);
});

test('Custom cancellation & rescheduling rule: patient-initiated blocks original date (Nov 2 -> >= Nov 3), clinic-initiated allows same date', () => {
  const original = {
    appointmentDate: '2026-11-02',
    blockedReplacementDates: [],
    minReplacementDate: '',
    status: 'Confirmed' as const,
  };

  const sameDayPatient = validateReplacementDateRule({
    originalAppointment: original,
    proposedDate: '2026-11-02',
    initiator: 'patient',
    todayIsoDate: '2026-11-01',
  });
  assert.equal(sameDayPatient.allowed, false);
  assert.equal(sameDayPatient.earliestAllowedDate, '2026-11-03');

  const nextDayPatient = validateReplacementDateRule({
    originalAppointment: original,
    proposedDate: '2026-11-03',
    initiator: 'patient',
    todayIsoDate: '2026-11-01',
  });
  assert.equal(nextDayPatient.allowed, true);

  const sameDayClinicLeave = validateReplacementDateRule({
    originalAppointment: { ...original, status: 'Needs Clinic Reschedule' },
    proposedDate: '2026-11-02',
    initiator: 'clinic',
    todayIsoDate: '2026-11-01',
  });
  assert.equal(sameDayClinicLeave.allowed, true);
});

test('Billing excludes unperformed lab tests and undispensed medicines; queue state transitions & 24h Manila reminders work accurately', () => {
  assert.equal(canTransitionQueueStatus('Waiting for Nurse', 'Ready for Doctor'), true);
  assert.equal(canTransitionQueueStatus('Checked Out', 'In Consultation'), false);

  const items = buildVisitBillingItems({
    consultationCompleted: true,
    consultationServiceName: 'General Consultation',
    consultationFeePhp: 500,
    visitId: 'VST-1',
    labOrders: [
      {
        id: 'l-unperformed',
        orderNumber: 'LAB-1',
        visitId: 'VST-1',
        status: 'Requested', // Unperformed -> MUST NOT be billed
        testName: 'CBC',
        feePhp: 350,
      } as any,
      {
        id: 'l-released',
        orderNumber: 'LAB-2',
        visitId: 'VST-1',
        status: 'Released', // Performed -> Billed
        testName: 'Urinalysis',
        feePhp: 250,
      } as any,
    ],
    prescriptions: [
      {
        id: 'rx-1',
        visitId: 'VST-1',
        status: 'Partially Dispensed',
        items: [
          {
            medicineId: 'm1',
            medicineName: 'Paracetamol',
            strength: '500mg',
            quantityPrescribed: 10,
            quantityDispensed: 6, // Only 6 dispensed -> bill 6 * 10 = 60
            unitPricePhp: 10,
          },
          {
            medicineId: 'm2',
            medicineName: 'Amoxicillin',
            strength: '500mg',
            quantityPrescribed: 14,
            quantityDispensed: 0, // Undispensed -> MUST NOT be billed
            unitPricePhp: 25,
          },
        ],
      } as any,
    ],
  });

  // 500 + 250 + 60 = 810
  const summary = calculateBillingSummary({
    items,
    approvedCoverageAmountPhp: 300,
    adjustmentAmountPhp: 0,
    payments: [
      {
        id: 'p1',
        receiptNumber: 'RCP-1',
        amountPhp: 200,
        method: 'Cash',
        referenceCode: '',
        recordedByName: 'Receptionist',
        recordedAt: '',
        notes: '',
      },
    ],
  });
  assert.equal(summary.totalAmountPhp, 810);
  assert.equal(summary.remainingBalancePhp, 310);
  assert.equal(summary.paymentStatus, 'Partially Paid');

  // 24h Manila reminder check
  const apptMs = Date.parse('2026-11-10T10:00:00+08:00');
  const twelveHoursBefore = apptMs - 12 * 3600 * 1000;
  const due = computeDueAppointmentReminders({
    appointments: [
      {
        id: 'apt-rem-1',
        status: 'Confirmed',
        portalUserId: 'pat-u1',
        appointmentDate: '2026-11-10',
        appointmentTime: '10:00',
      } as any,
    ],
    existingReminders: [],
    nowMs: twelveHoursBefore,
  });
  assert.equal(due.dueAppointments.length, 1);
});

test('Predictive Analytics Engine strictly separates Demonstration vs Operational datasets and computes real forecasts + MAE', () => {
  // Operational mode with 0 records MUST report Insufficient Verified Historical Data
  const emptyOp = runPredictiveAnalytics({
    mode: 'operational',
    demoRecords: [],
    operationalConsultations: [],
  });
  assert.equal(emptyOp.sufficientData, false);
  assert.equal(
    emptyOp.insufficientReason,
    'Insufficient Verified Historical Data for Operational Forecasting'
  );

  // Build 80 deterministic evaluator CSV rows spanning 8 months
  const csvRows = [
    'Consultation Date,Patient ID,Consultation Status,Chief Complaint,Appointment Type,Doctor\'s Diagnosis',
  ];
  const complaints = ['Fever and chills', 'Dry cough', 'Headache', 'Stomach pain', 'Fever'];
  let dayCursor = new Date(Date.UTC(2026, 1, 2)); // Feb 2, 2026
  for (let i = 0; i < 84; i++) {
    const iso = dayCursor.toISOString().slice(0, 10);
    const pt = `P-${(i % 35) + 100}`;
    const comp = complaints[i % complaints.length];
    const type = i % 3 === 0 ? 'Walk-in' : 'Online';
    csvRows.push(`${iso},${pt},Completed,${comp},${type},Viral URI`);
    if (i % 2 === 1) {
      dayCursor.setUTCDate(dayCursor.getUTCDate() + 4);
    } else {
      dayCursor.setUTCDate(dayCursor.getUTCDate() + 2);
    }
  }
  // Add 1 duplicate row and 1 cancelled row to test filtering & deduplication
  csvRows.push(csvRows[1]);
  csvRows.push('2026-03-15,P-999,Cancelled,Fever,Online,None');

  const parsed = parseAndValidateEvaluatorCsv({
    csvContent: csvRows.join('\n'),
    fileName: 'evaluator_records.csv',
    importedByUid: 'admin-1',
    importedByName: 'Clinic Admin',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.batch.validCompletedImported, 84);
  assert.equal(parsed.batch.duplicateRowsSkipped, 1);
  assert.equal(parsed.batch.skippedNonCompleted, 1);

  // Operational mode MUST STILL be insufficient even after importing Demonstration CSV!
  const stillEmptyOp = runPredictiveAnalytics({
    mode: 'operational',
    demoRecords: parsed.records,
    operationalConsultations: [],
  });
  assert.equal(stillEmptyOp.sufficientData, false);
  assert.equal(
    stillEmptyOp.insufficientReason,
    'Insufficient Verified Historical Data for Operational Forecasting'
  );

  // Demonstration mode produces real Moving Average & SES forecasts + MAE
  const demoOutput = runPredictiveAnalytics({
    mode: 'demonstration',
    demoRecords: parsed.records,
    operationalConsultations: [],
  });
  assert.equal(demoOutput.sufficientData, true);
  assert.equal(
    demoOutput.modeBannerText,
    'DEMONSTRATION MODE — EVALUATOR TEST DATA — NOT VALIDATED FOR REAL CLINIC DEMAND'
  );
  assert.equal(demoOutput.weekly.status, 'Ready');
  assert.ok(demoOutput.weekly.nextPeriodForecast !== null && demoOutput.weekly.nextPeriodForecast >= 0);
  assert.ok(demoOutput.weekly.maeSes !== null);
  assert.ok(demoOutput.weekly.maeMovingAverage !== null);
});
