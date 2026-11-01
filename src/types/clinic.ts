/**
 * SmartClinic Domain Data Models
 * Covers all 7 roles, separated Patient Portal vs Clinical Patient Records,
 * real-time scheduling, unified clinical queue, lab/pharmacy/billing,
 * in-app notifications, and strictly separated Predictive Analytics datasets.
 */

export type UserRole =
  | 'patient'
  | 'receptionist'
  | 'nurse'
  | 'doctor'
  | 'laboratory'
  | 'pharmacist'
  | 'admin';

export type StaffRole = Exclude<UserRole, 'patient'>;

export type QueueStatus =
  | 'Checked In'
  | 'Waiting for Nurse'
  | 'In Assessment'
  | 'Ready for Doctor'
  | 'In Consultation'
  | 'Consultation Completed'
  | 'Checked Out';

export type ClinicalPriority = 'Routine' | 'Priority' | 'Urgent Referral';

export type AppointmentStatus =
  | 'Confirmed'
  | 'Checked In'
  | 'Completed'
  | 'Cancelled'
  | 'Rescheduled'
  | 'Needs Clinic Reschedule'
  | 'No Show';

export type LabOrderStatus =
  | 'Requested'
  | 'Sample Collected'
  | 'Processing'
  | 'For Verification'
  | 'Verified'
  | 'Released';

export type PrescriptionStatus =
  | 'Received'
  | 'Under Review'
  | 'Needs Clarification'
  | 'Ready for Dispensing'
  | 'Partially Dispensed'
  | 'Dispensed'
  | 'Not Available';

export type PaymentStatus =
  | 'Unpaid'
  | 'Partially Paid'
  | 'Paid'
  | 'Adjusted / Refunded';

export type CoverageSource = 'Self-Pay' | 'HMO / Health Card' | 'PhilHealth';

export type StandardizedComplaintCategory =
  | 'Fever'
  | 'Cough'
  | 'Headache'
  | 'Stomach Pain'
  | 'Other Complaints';

export interface PatientPortalAccount {
  uid: string;
  email: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  sex: 'Female' | 'Male' | 'Other' | 'Prefer not to say';
  linkedPatientId: string; // Empty string if not yet linked to a clinical record or created fresh
  optionalMfaEnabled: boolean;
  optionalMfaEncryptedSecret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicalPatientRecord {
  patientId: string; // Permanent ID e.g. PT-2026-1001
  portalUserId: string; // Empty string for walk-in-only patients
  fullName: string;
  dateOfBirth: string;
  sex: 'Female' | 'Male' | 'Other' | 'Prefer not to say';
  phone: string;
  email: string;
  address: string;
  allergies: string;
  chronicConditions: string;
  registrationSource: 'Online Portal' | 'Walk-in Front Desk';
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordLinkRequest {
  id: string;
  portalUserId: string;
  portalEmail: string;
  requestedFullName: string;
  requestedDob: string;
  requestedPhone: string;
  knownPatientIdHint: string;
  lastVisitDateHint: string;
  candidatePatientId: string; // Populated by system/staff without leaking confidential notes
  status: 'Pending Staff Verification' | 'Approved & Linked' | 'Rejected';
  verificationNotes: string;
  reviewedByUid: string;
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StaffAccount {
  uid: string;
  email: string;
  fullName: string;
  role: StaffRole;
  department: string;
  specialty: string; // For doctors (no fabricated credentials)
  titleDisplay: string; // e.g., Attending Physician, Registered Nurse
  active: boolean;
  mfaEnrolled: boolean;
  mfaEncryptedSecret: string;
  mfaRecoveryHashes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StaffInvitation {
  id: string; // Normalized lowercase email slug or random ID
  email: string;
  fullName: string;
  role: StaffRole;
  department: string;
  specialty: string;
  titleDisplay: string;
  status: 'Pending Enrollment' | 'Claimed' | 'Revoked';
  invitedByUid: string;
  createdAt: string;
}

export interface DoctorSchedule {
  id: string; // doctorUid
  doctorUid: string;
  doctorName: string;
  specialty: string;
  workdays: number[]; // 0=Sun .. 6=Sat
  startTime: string; // "08:00"
  endTime: string; // "17:00"
  breakStart: string; // "12:00"
  breakEnd: string; // "13:00"
  consultationDurationMinutes: number; // e.g. 30
  slotCapacity: number; // 1 for strict non-overlapping 1-on-1 outpatient care
  qualifiedServiceIds: string[];
  active: boolean;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  doctorUid: string;
  doctorName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewedByUid: string;
  reviewNotes: string;
  affectedAppointmentIds: string[];
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClinicService {
  id: string;
  code: string;
  name: string;
  category: 'Consultation' | 'Follow-up' | 'Laboratory';
  description: string;
  durationMinutes: number;
  baseFeePhp: number;
  directlyBookable: boolean; // True for General Consultation & Follow-up Consultation; False for Lab orders
  active: boolean;
}

export interface AppointmentStatusHistoryEntry {
  status: AppointmentStatus;
  changedAt: string;
  changedByRole: UserRole | 'system';
  reason: string;
}

export interface Appointment {
  id: string;
  referenceNumber: string; // e.g. SC-APT-849201
  patientId: string;
  portalUserId: string;
  patientName: string;
  serviceId: string;
  serviceName: string;
  bookingMode: 'Specific Doctor' | 'Any Available Doctor';
  doctorUid: string;
  doctorName: string;
  appointmentDate: string; // YYYY-MM-DD
  appointmentTime: string; // HH:mm
  endTime: string; // HH:mm
  durationMinutes: number;
  status: AppointmentStatus;
  qrToken: string;
  qrStatus: 'Active' | 'Used' | 'Invalidated' | 'Replaced';
  changeInitiator?: 'patient' | 'clinic';
  blockedReplacementDates: string[]; // Enforces Section 7 patient-initiated cancellation/rescheduling rule
  minReplacementDate: string; // YYYY-MM-DD floor when voluntarily rescheduled/cancelled
  previousAppointmentId: string;
  followUpRecommendationId: string;
  reasonForVisit: string;
  checkedInAt: string;
  visitId: string;
  statusHistory: AppointmentStatusHistoryEntry[];
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VisitEncounter {
  id: string; // Visit ID e.g. VST-20261101-001
  visitId: string;
  queueNumber: string; // e.g. Q-001
  patientId: string;
  portalUserId: string;
  patientName: string;
  appointmentId: string; // Empty for pure walk-in
  appointmentType: 'Online' | 'Walk-in';
  serviceName: string;
  doctorUid: string;
  doctorName: string;
  scheduledTime: string; // Empty for walk-in
  arrivalTime: string;
  visitDate: string; // YYYY-MM-DD in Asia/Manila
  queueStatus: QueueStatus;
  clinicalPriority: ClinicalPriority;
  triageReferralNote: string;
  checkedOutAt: string;
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NursingAssessment {
  id: string; // Same as visitId
  visitId: string;
  patientId: string;
  portalUserId: string;
  bloodPressure: string; // e.g. "120/80"
  bodyTemperatureC: string; // e.g. "36.8"
  pulseRateBpm: string; // e.g. "74"
  respiratoryRateCpm: string; // e.g. "16"
  oxygenSaturationPct: string; // e.g. "98"
  weightKg: string;
  heightCm: string;
  chiefComplaint: string;
  standardizedComplaint: StandardizedComplaintCategory;
  additionalSymptoms: string;
  symptomOnset: string;
  nursingObservations: string;
  clinicalPriority: ClinicalPriority;
  nurseUid: string;
  nurseName: string;
  completedAt: string;
  authorizedViewerUids: string[]; // Strictly Nurse + Doctor (excludes Admin & Receptionist)
}

export interface ConsultationAmendment {
  amendedAt: string;
  amendedByUid: string;
  amendedByName: string;
  reason: string;
  previousDiagnosis: string;
  newDiagnosis: string;
  summaryOfChanges: string;
}

export interface ConsultationRecord {
  id: string; // Same as visitId
  visitId: string;
  patientId: string;
  portalUserId: string;
  patientName: string;
  visitDate: string; // YYYY-MM-DD
  appointmentType: 'Online' | 'Walk-in';
  doctorUid: string;
  doctorName: string;
  doctorTitle: string;
  chiefComplaint: string;
  standardizedComplaint: StandardizedComplaintCategory;
  clinicalFindings: string;
  diagnosis: string;
  diagnosisType: 'Final Diagnosis' | 'Provisional Diagnosis';
  treatmentPlan: string;
  patientInstructions: string;
  status: 'Draft' | 'Finalized';
  finalizedAt: string;
  amendments: ConsultationAmendment[];
  patientVisible: boolean;
  authorizedViewerUids: string[]; // Strictly Doctor + Nurse (excludes Admin & Receptionist)
  createdAt: string;
  updatedAt: string;
}

export interface LabTestResultItem {
  parameter: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag: 'Normal' | 'Low' | 'High' | 'Abnormal';
}

export interface LaboratoryOrder {
  id: string;
  orderNumber: string; // e.g. LAB-2026-001
  visitId: string;
  patientId: string;
  portalUserId: string;
  patientName: string;
  orderedByDoctorUid: string;
  orderedByDoctorName: string;
  testCode: string;
  testName: string;
  clinicalIndication: string;
  priority: 'Routine' | 'Stat';
  status: LabOrderStatus;
  sampleId: string;
  sampleCollectedAt: string;
  sampleCollectedBy: string;
  processedAt: string;
  resultItems: LabTestResultItem[];
  technicianRemarks: string;
  enteredByUid: string;
  enteredByName: string;
  verifiedByUid: string;
  verifiedByName: string;
  verifiedAt: string;
  releasedAt: string;
  feePhp: number;
  patientVisible: boolean; // True ONLY when status === 'Released'
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PrescriptionItem {
  medicineId: string;
  medicineName: string;
  strength: string;
  dosage: string;
  frequency: string;
  duration: string;
  route: string;
  quantityPrescribed: number;
  quantityDispensed: number;
  unitPricePhp: number;
  instructions: string;
}

export interface PrescriptionRecord {
  id: string;
  prescriptionNumber: string; // e.g. RX-2026-001
  visitId: string;
  patientId: string;
  portalUserId: string;
  patientName: string;
  doctorUid: string;
  doctorName: string;
  doctorTitle: string;
  items: PrescriptionItem[];
  notes: string;
  status: PrescriptionStatus;
  clarificationQuestion: string;
  clarificationResponse: string;
  reviewedByPharmacistUid: string;
  reviewedByPharmacistName: string;
  dispensedAt: string;
  patientVisible: boolean; // True once finalized by Doctor
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MedicineInventoryItem {
  id: string;
  sku: string;
  genericName: string;
  brandName: string;
  dosageForm: string;
  strength: string;
  stockQuantity: number;
  reorderLevel: number;
  unitPricePhp: number;
  batchNumber: string;
  expiryDate: string; // YYYY-MM-DD
  authorizedViewerUids?: string[];
  updatedAt: string;
}

export interface BillingLineItem {
  id: string;
  category: 'Consultation' | 'Laboratory' | 'Pharmacy' | 'Procedure';
  description: string;
  quantity: number;
  unitPricePhp: number;
  subtotalPhp: number;
  sourceRecordId: string;
}

export interface PaymentEntry {
  id: string;
  receiptNumber: string;
  amountPhp: number;
  method: 'Cash' | 'Card' | 'GCash / E-Wallet' | 'Bank Transfer' | 'Adjustment / Refund';
  referenceCode: string;
  recordedByName: string;
  recordedAt: string;
  notes: string;
}

export interface BillingRecord {
  id: string; // Same as visitId
  invoiceRef: string; // Statement / Acknowledgment Ref e.g. BILL-2026-001
  visitId: string;
  patientId: string;
  portalUserId: string;
  patientName: string;
  visitDate: string;
  items: BillingLineItem[];
  totalAmountPhp: number;
  coverageSource: CoverageSource;
  coverageProviderName: string; // e.g. HMO provider name or PhilHealth
  coverageMemberNumber: string;
  loaOrMdrReference: string;
  coverageVerifiedByName: string;
  approvedCoverageAmountPhp: number;
  adjustmentAmountPhp: number;
  amountPaidPhp: number;
  remainingBalancePhp: number;
  paymentStatus: PaymentStatus;
  payments: PaymentEntry[];
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpRecommendation {
  id: string;
  visitId: string;
  patientId: string;
  portalUserId: string;
  patientName: string;
  doctorUid: string;
  doctorName: string;
  recommendedDate: string; // YYYY-MM-DD
  intervalLabel: string; // e.g. "In 7 days"
  instructions: string;
  reason: string;
  status: 'Recommended' | 'Booked' | 'Completed';
  bookedAppointmentId: string;
  authorizedViewerUids: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClinicNotification {
  id: string;
  title: string;
  safeSummary: string;
  recipientUid: string;
  recipientRole: UserRole;
  relatedRecordType: string;
  relatedRecordId: string;
  viewPath: string;
  dedupeKey: string;
  importantPopup: boolean;
  read: boolean;
  popupDismissed: boolean;
  createdAt: string;
}

export interface AppointmentReminder {
  id: string;
  appointmentId: string;
  portalUserId: string;
  appointmentDate: string;
  appointmentTime: string;
  dueAtIso: string;
  status: 'Scheduled' | 'Materialized' | 'Invalidated';
  materializedAt: string;
  dedupeKey: string;
}

export interface PatientGuideSectionItem {
  id: string;
  sectionKey: 'hmo' | 'philhealth' | 'privacy' | 'clinic_guides';
  sectionTitle: string;
  topicTitle: string;
  summary: string;
  bulletPoints: string[];
  importantNotice: string;
  lastUpdated: string;
  updatedByName: string;
  published: boolean;
  sortOrder: number;
}

export interface EvaluatorConsultationRecord {
  id: string; // Safe internal demonstration ID e.g. DEMO-IMP-...
  importBatchId: string;
  sourceExternalPatientRef: string; // Masked/isolated from real Patients table
  consultationDate: string; // YYYY-MM-DD
  consultationStatus: string;
  chiefComplaintRaw: string;
  standardizedComplaint: StandardizedComplaintCategory;
  appointmentType: 'Online' | 'Walk-in';
  doctorDiagnosisRaw: string;
  datasetMode: 'demonstration';
  sourceFileName: string;
  importedByUid: string;
  importedAt: string;
}

export interface EvaluatorImportBatch {
  id: string;
  fileName: string;
  totalRowsRead: number;
  validCompletedImported: number;
  skippedNonCompleted: number;
  duplicateRowsSkipped: number;
  invalidRowsRejected: number;
  errorReport: string[];
  dateRangeStart: string;
  dateRangeEnd: string;
  importedByUid: string;
  importedByName: string;
  importedAt: string;
}

export interface TimeSeriesPoint {
  periodKey: string;
  label: string;
  totalVisits: number;
  uniquePatients: number;
  onlineVisits: number;
  walkInVisits: number;
}

export interface ForecastSeriesPoint {
  periodKey: string;
  label: string;
  actual?: number;
  movingAveragePred?: number;
  sesPred?: number;
  naiveBaselinePred?: number;
  lowerBound?: number;
  upperBound?: number;
  isForecastHorizon: boolean;
}

export interface HorizonForecastResult {
  horizonType: 'daily' | 'weekly' | 'monthly';
  title: string;
  priorityBadge: string;
  status: 'Ready' | 'Insufficient Data' | 'Exploratory Low Sample';
  statusMessage: string;
  observationsCount: number;
  trainingPeriod: string;
  forecastHorizonCount: number;
  selectedModel: 'Simple Exponential Smoothing' | 'Recent-Period Moving Average';
  movingAverageWindow: number;
  sesAlpha: number;
  maeMovingAverage: number | null;
  maeSes: number | null;
  maeNaiveBaseline: number | null;
  nextPeriodForecast: number | null;
  uncertaintyRange: [number, number] | null;
  series: ForecastSeriesPoint[];
}

export interface ComplaintForecastSummary {
  category: StandardizedComplaintCategory;
  totalHistoricalCount: number;
  sharePct: number;
  status: 'Forecast Available' | 'Historical Trend Only (Low Sample)';
  nextWeekPredicted: number | null;
  mae: number | null;
  recentWeeklyCounts: { week: string; count: number }[];
}

export interface PredictiveAnalyticsOutput {
  datasetMode: 'demonstration' | 'operational';
  modeBannerText: string;
  sufficientData: boolean;
  insufficientReason: string;
  totalCompletedConsultations: number;
  uniquePatientsCount: number;
  onlineCount: number;
  walkInCount: number;
  dateCoverageStart: string;
  dateCoverageEnd: string;
  generatedAt: string;
  daily: HorizonForecastResult;
  weekly: HorizonForecastResult;
  monthly: HorizonForecastResult;
  complaints: ComplaintForecastSummary[];
  operationalInsights: string[];
}

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: UserRole | 'system';
  action: string;
  category: 'Authentication' | 'Clinical' | 'Administrative' | 'Security' | 'Analytics';
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface CoverageSettings {
  hmoProvidersAcceptedForManualVerification: string[];
  philHealthAdvisoryNote: string;
  requireLoaReferenceForHmo: boolean;
  defaultGeneralConsultationFeePhp: number;
  defaultFollowUpConsultationFeePhp: number;
  updatedAt: string;
}
