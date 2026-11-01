import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  DEFAULT_CLINIC_SERVICES,
  DEFAULT_COVERAGE_SETTINGS,
  DEFAULT_MEDICINE_INVENTORY,
  DEFAULT_PATIENT_GUIDES,
} from '../data/defaultCatalog';
import {
  addDaysToIsoDate,
  assignDoctorForAnyAvailable,
  calculateAvailableSlots,
  getManilaDateIso,
  getManilaTimeHhMm,
  validateReplacementDateRule,
} from '../utils/scheduling';
import {
  buildVisitBillingItems,
  calculateBillingSummary,
  categorizeChiefComplaint,
  computeDueAppointmentReminders,
  findCandidateWalkInRecordForLink,
  hasDuplicateActiveVisit,
} from '../utils/clinicalWorkflow';
import type {
  Appointment,
  AppointmentReminder,
  AuditLogEntry,
  BillingRecord,
  ClinicalPatientRecord,
  ClinicalPriority,
  ClinicNotification,
  ClinicService,
  ConsultationAmendment,
  ConsultationRecord,
  CoverageSettings,
  CoverageSource,
  DoctorSchedule,
  EvaluatorConsultationRecord,
  EvaluatorImportBatch,
  FollowUpRecommendation,
  LaboratoryOrder,
  LabOrderStatus,
  LabTestResultItem,
  LeaveRequest,
  MedicineInventoryItem,
  NursingAssessment,
  PatientGuideSectionItem,
  PatientPortalAccount,
  PaymentEntry,
  PrescriptionItem,
  PrescriptionRecord,
  PrescriptionStatus,
  QueueStatus,
  RecordLinkRequest,
  StaffAccount,
  StaffInvitation,
  StaffRole,
  UserRole,
  VisitEncounter,
} from '../types/clinic';

interface ClinicRosterDoc {
  bootstrappedAdminUid: string;
  adminUids: string[];
  doctorUids: string[];
  nurseUids: string[];
  receptionistUids: string[];
  labUids: string[];
  pharmacistUids: string[];
  allStaffUids: string[];
}

export interface OperationalAnalyticsEvent {
  id: string;
  visitId: string;
  patientId: string;
  consultationDate: string;
  appointmentType: 'Online' | 'Walk-in';
  standardizedComplaint: ConsultationRecord['standardizedComplaint'];
}

export const DESIGNATED_BOOTSTRAP_ADMIN_EMAIL = 'cervitopatrick0@gmail.com';

export function emailToInviteId(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/@/g, '_at_')
    .replace(/[^a-z0-9_-]/g, '_');
}

function uidShort(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${ts}${rand}`;
}

export function isLocalhostTestFixture(): boolean {
  if (typeof window === 'undefined') return false;
  const isLocal =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocal) return false;
  return new URLSearchParams(window.location.search).get('testFixture') === '1';
}

export interface ClinicContextValue {
  authReady: boolean;
  isTestFixture: boolean;
  firebaseUser: { uid: string; email: string; emailVerified: boolean; displayName: string } | null;
  patientAccount: PatientPortalAccount | null;
  staffAccount: StaffAccount | null;
  mfaSessionVerified: boolean;
  mfaAssuranceToken: string;
  mfaExpiresAtMs: number;
  roster: ClinicRosterDoc;

  services: ClinicService[];
  doctorSchedules: DoctorSchedule[];
  patientGuides: PatientGuideSectionItem[];
  coverageSettings: CoverageSettings;
  patients: ClinicalPatientRecord[];
  bookedSlots: { doctorUid: string; appointmentDate: string; appointmentTime: string; endTime: string; durationMinutes: number; appointmentId: string; active: boolean }[];
  appointments: Appointment[];
  visits: VisitEncounter[];
  nursingAssessments: NursingAssessment[];
  consultations: ConsultationRecord[];
  labOrders: LaboratoryOrder[];
  prescriptions: PrescriptionRecord[];
  inventory: MedicineInventoryItem[];
  billings: BillingRecord[];
  followUps: FollowUpRecommendation[];
  linkRequests: RecordLinkRequest[];
  leaveRequests: LeaveRequest[];
  approvedLeaves: LeaveRequest[];
  notifications: ClinicNotification[];
  reminders: AppointmentReminder[];
  staffAccounts: StaffAccount[];
  staffInvitations: StaffInvitation[];
  evaluatorImports: EvaluatorImportBatch[];
  evaluatorRecords: EvaluatorConsultationRecord[];
  operationalAnalyticsEvents: OperationalAnalyticsEvent[];
  auditLogs: AuditLogEntry[];

  // Auth Actions
  signInWithGoogleAction: () => Promise<{ ok: boolean; error?: string }>;
  signInWithEmailAction: (email: string, password: string) => Promise<{ ok: boolean; error?: string; code?: string }>;
  registerPatientEmailAction: (params: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    dateOfBirth: string;
    sex: PatientPortalAccount['sex'];
  }) => Promise<{ ok: boolean; error?: string; code?: string; requiresVerification?: boolean }>;
  completePatientProfileSetup: (params: {
    fullName: string;
    phone: string;
    dateOfBirth: string;
    sex: PatientPortalAccount['sex'];
    createFreshClinicalRecord: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  resendEmailVerificationAction: () => Promise<{ ok: boolean; error?: string }>;
  refreshEmailVerificationStatus: () => Promise<boolean>;
  registerInvitedStaffEmailAction: (params: {
    email: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string; requiresVerification?: boolean }>;
  bootstrapInitialAdminAction: (fullName: string) => Promise<{ ok: boolean; error?: string }>;
  claimStaffInvitationAction: () => Promise<{ ok: boolean; error?: string; claimedRole?: StaffRole }>;
  completeStaffMfaEnrollment: (params: {
    encryptedSecret: string;
    recoveryHashes: string[];
    assuranceToken: string;
    expiresAtMs: number;
  }) => Promise<{ ok: boolean; error?: string }>;
  setStaffMfaVerifiedSession: (params: {
    assuranceToken: string;
    expiresAtMs: number;
    usedRecoveryHash?: string;
  }) => Promise<void>;
  logoutAction: () => Promise<void>;
  switchFixturePersona?: (role: UserRole) => void;

  // Patient & Booking Actions
  bookAppointmentAction: (params: {
    patientId: string;
    portalUserId: string;
    patientName: string;
    serviceId: string;
    doctorUid: string | 'any';
    appointmentDate: string;
    appointmentTime: string;
    reasonForVisit: string;
    followUpRecommendationId?: string;
    rescheduleFromAppointment?: Appointment;
    rescheduleInitiator?: 'patient' | 'clinic';
  }) => Promise<{ ok: boolean; error?: string; appointment?: Appointment }>;
  cancelAppointmentAction: (
    appointmentId: string,
    initiator: 'patient' | 'clinic',
    reason: string
  ) => Promise<{ ok: boolean; error?: string }>;
  submitRecordLinkRequestAction: (params: {
    requestedFullName: string;
    requestedDob: string;
    requestedPhone: string;
    knownPatientIdHint: string;
    lastVisitDateHint: string;
  }) => Promise<{ ok: boolean; message: string }>;
  reviewRecordLinkRequestAction: (params: {
    requestId: string;
    approve: boolean;
    targetPatientId: string;
    verificationNotes: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  updatePatientDemographicsAction: (params: {
    phone: string;
    address: string;
    allergies: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  updatePatientOptionalMfaAction: (params: {
    enabled: boolean;
    encryptedSecret: string;
  }) => Promise<void>;

  // Receptionist & Queue Actions
  checkInAppointmentByQrOrRefAction: (params: {
    qrTokenOrRef: string;
    verifiedIdentityConfirmed: boolean;
  }) => Promise<{ ok: boolean; error?: string; visit?: VisitEncounter }>;
  registerWalkInVisitAction: (params: {
    existingPatientId?: string;
    fullName: string;
    dateOfBirth: string;
    sex: ClinicalPatientRecord['sex'];
    phone: string;
    address: string;
    allergies: string;
    chronicConditions: string;
    serviceName: string;
    doctorUid: string;
    clinicalPriority: ClinicalPriority;
  }) => Promise<{ ok: boolean; error?: string; visit?: VisitEncounter }>;
  updateVisitQueueStatusAction: (
    visitId: string,
    nextStatus: QueueStatus,
    priority?: ClinicalPriority,
    triageNote?: string
  ) => Promise<{ ok: boolean; error?: string }>;

  // Nurse Actions
  saveNursingAssessmentAction: (params: {
    visitId: string;
    bloodPressure: string;
    bodyTemperatureC: string;
    pulseRateBpm: string;
    respiratoryRateCpm: string;
    oxygenSaturationPct: string;
    weightKg: string;
    heightCm: string;
    chiefComplaint: string;
    additionalSymptoms: string;
    symptomOnset: string;
    nursingObservations: string;
    clinicalPriority: ClinicalPriority;
    markReadyForDoctor: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;

  // Doctor Actions
  saveConsultationAction: (params: {
    visitId: string;
    chiefComplaint: string;
    clinicalFindings: string;
    diagnosis: string;
    diagnosisType: ConsultationRecord['diagnosisType'];
    treatmentPlan: string;
    patientInstructions: string;
    finalize: boolean;
    amendmentReason?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  createLabOrderAction: (params: {
    visitId: string;
    testServiceId: string;
    clinicalIndication: string;
    priority: 'Routine' | 'Stat';
  }) => Promise<{ ok: boolean; error?: string }>;
  createPrescriptionAction: (params: {
    visitId: string;
    items: PrescriptionItem[];
    notes: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  respondPrescriptionClarificationAction: (params: {
    prescriptionId: string;
    clarificationResponse: string;
    updatedItems: PrescriptionItem[];
    updatedNotes: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  createFollowUpRecommendationAction: (params: {
    visitId: string;
    recommendedDate: string;
    intervalLabel: string;
    reason: string;
    instructions: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  submitDoctorLeaveRequestAction: (params: {
    startDate: string;
    endDate: string;
    reason: string;
  }) => Promise<{ ok: boolean; error?: string }>;

  // Laboratory Actions
  advanceLabOrderAction: (params: {
    orderId: string;
    nextStatus: LabOrderStatus;
    sampleId?: string;
    resultItems?: LabTestResultItem[];
    technicianRemarks?: string;
  }) => Promise<{ ok: boolean; error?: string }>;

  // Pharmacy Actions
  updatePrescriptionPharmacyAction: (params: {
    prescriptionId: string;
    nextStatus: PrescriptionStatus;
    dispensedQuantities?: Record<string, number>;
    clarificationQuestion?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  upsertMedicineInventoryAction: (params: {
    id?: string;
    sku: string;
    genericName: string;
    brandName: string;
    dosageForm: string;
    strength: string;
    stockQuantity: number;
    reorderLevel: number;
    unitPricePhp: number;
    batchNumber: string;
    expiryDate: string;
  }) => Promise<{ ok: boolean; error?: string }>;

  // Billing & Check-out Actions
  syncOrUpdateBillingAction: (params: {
    visitId: string;
    coverageSource?: CoverageSource;
    coverageProviderName?: string;
    coverageMemberNumber?: string;
    loaOrMdrReference?: string;
    approvedCoverageAmountPhp?: number;
    adjustmentAmountPhp?: number;
    newPayment?: {
      amountPhp: number;
      method: PaymentEntry['method'];
      referenceCode: string;
      notes: string;
    };
  }) => Promise<{ ok: boolean; error?: string }>;

  // Notifications Actions
  markNotificationReadAction: (notifId: string) => Promise<void>;
  dismissNotificationPopupAction: (notifId: string) => Promise<void>;

  // Admin Actions
  inviteStaffMemberAction: (params: {
    email: string;
    fullName: string;
    role: StaffRole;
    department: string;
    specialty: string;
    titleDisplay: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  toggleStaffActiveStatusAction: (staffUid: string, active: boolean) => Promise<{ ok: boolean; error?: string }>;
  updateStaffAccountRoleAction: (params: {
    staffUid: string;
    role: StaffRole;
    department: string;
    specialty: string;
    titleDisplay: string;
    active: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  syncStaffRosterAccessAction: () => Promise<{ ok: boolean; syncedCount?: number; error?: string }>;
  upsertDoctorScheduleAction: (schedule: Omit<DoctorSchedule, 'updatedAt'>) => Promise<{ ok: boolean; error?: string }>;
  reviewLeaveRequestAction: (params: {
    leaveId: string;
    decision: 'Approved' | 'Rejected';
    reviewNotes: string;
  }) => Promise<{ ok: boolean; error?: string; affectedCount?: number }>;
  upsertClinicServiceAction: (service: ClinicService) => Promise<{ ok: boolean; error?: string }>;
  upsertPatientGuideAction: (guide: PatientGuideSectionItem) => Promise<{ ok: boolean; error?: string }>;
  updateCoverageSettingsAction: (settings: CoverageSettings) => Promise<{ ok: boolean; error?: string }>;
  importEvaluatorCsvAction: (params: {
    csvContent: string;
    fileName: string;
  }) => Promise<{ ok: boolean; error?: string; batch?: EvaluatorImportBatch }>;
  clearEvaluatorDatasetAction: () => Promise<{ ok: boolean; error?: string }>;
}

const ClinicContext = createContext<ClinicContextValue | null>(null);

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error('useClinic must be used inside ClinicProvider');
  return ctx;
}

const EMPTY_ROSTER: ClinicRosterDoc = {
  bootstrappedAdminUid: '',
  adminUids: [],
  doctorUids: [],
  nurseUids: [],
  receptionistUids: [],
  labUids: [],
  pharmacistUids: [],
  allStaffUids: [],
};

export function ClinicProvider({
  children,
  currentPath = '/',
}: {
  children: React.ReactNode;
  currentPath?: string;
}) {
  const isTestFixture = useMemo(() => isLocalhostTestFixture(), []);

  const [authReady, setAuthReady] = useState(isTestFixture);
  const [firebaseUser, setFirebaseUser] = useState<ClinicContextValue['firebaseUser']>(null);
  const [patientAccount, setPatientAccount] = useState<PatientPortalAccount | null>(null);
  const [staffAccount, setStaffAccount] = useState<StaffAccount | null>(null);
  const [mfaSessionVerified, setMfaSessionVerified] = useState(false);
  const [mfaAssuranceToken, setMfaAssuranceToken] = useState('');
  const [mfaExpiresAtMs, setMfaExpiresAtMs] = useState(0);

  const [roster, setRoster] = useState<ClinicRosterDoc>(EMPTY_ROSTER);
  const [services, setServices] = useState<ClinicService[]>(DEFAULT_CLINIC_SERVICES);
  const [doctorSchedules, setDoctorSchedules] = useState<DoctorSchedule[]>([]);
  const [patientGuides, setPatientGuides] = useState<PatientGuideSectionItem[]>(DEFAULT_PATIENT_GUIDES);
  const [coverageSettings, setCoverageSettings] = useState<CoverageSettings>(DEFAULT_COVERAGE_SETTINGS);
  const [patients, setPatients] = useState<ClinicalPatientRecord[]>([]);
  const [bookedSlots, setBookedSlots] = useState<ClinicContextValue['bookedSlots']>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [visits, setVisits] = useState<VisitEncounter[]>([]);
  const [nursingAssessments, setNursingAssessments] = useState<NursingAssessment[]>([]);
  const [consultations, setConsultations] = useState<ConsultationRecord[]>([]);
  const [labOrders, setLabOrders] = useState<LaboratoryOrder[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [inventory, setInventory] = useState<MedicineInventoryItem[]>([]);
  const [billings, setBillings] = useState<BillingRecord[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpRecommendation[]>([]);
  const [linkRequests, setLinkRequests] = useState<RecordLinkRequest[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<ClinicNotification[]>([]);
  const [reminders, setReminders] = useState<AppointmentReminder[]>([]);
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);
  const [staffInvitations, setStaffInvitations] = useState<StaffInvitation[]>([]);
  const [evaluatorImports, setEvaluatorImports] = useState<EvaluatorImportBatch[]>([]);
  const [evaluatorRecords, setEvaluatorRecords] = useState<EvaluatorConsultationRecord[]>([]);
  const [operationalAnalyticsEvents, setOperationalAnalyticsEvents] = useState<OperationalAnalyticsEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const pendingRegProfileRef = useRef<{
    fullName: string;
    phone: string;
    dateOfBirth: string;
    sex: PatientPortalAccount['sex'];
  } | null>(null);

  // Setup isolated localhost software test fixture ONLY when ?testFixture=1 is passed on localhost
  const fixtureInitializedRef = useRef(false);
  useEffect(() => {
    if (!isTestFixture || fixtureInitializedRef.current) return;
    fixtureInitializedRef.current = true;

    const fixtureRoster: ClinicRosterDoc = {
      bootstrappedAdminUid: 'fix-admin-1',
      adminUids: ['fix-admin-1'],
      doctorUids: ['fix-doc-1', 'fix-doc-2'],
      nurseUids: ['fix-nurse-1'],
      receptionistUids: ['fix-rec-1'],
      labUids: ['fix-lab-1'],
      pharmacistUids: ['fix-pharm-1'],
      allStaffUids: ['fix-admin-1', 'fix-doc-1', 'fix-doc-2', 'fix-nurse-1', 'fix-rec-1', 'fix-lab-1', 'fix-pharm-1'],
    };
    setRoster(fixtureRoster);

    const fixtureStaff: StaffAccount[] = [
      {
        uid: 'fix-admin-1',
        email: 'admin.fixture@smartclinic.local',
        fullName: 'Clinic Administrator (Test Fixture)',
        role: 'admin',
        department: 'Administration',
        specialty: '',
        titleDisplay: 'Operations Administrator',
        active: true,
        mfaEnrolled: true,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        uid: 'fix-doc-1',
        email: 'doctor1.fixture@smartclinic.local',
        fullName: 'Dr. Elena Santos (Test Fixture)',
        role: 'doctor',
        department: 'Outpatient Medicine',
        specialty: 'Internal Medicine',
        titleDisplay: 'Attending Physician',
        active: true,
        mfaEnrolled: true,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        uid: 'fix-doc-2',
        email: 'doctor2.fixture@smartclinic.local',
        fullName: 'Dr. Marco Reyes (Test Fixture)',
        role: 'doctor',
        department: 'Outpatient Medicine',
        specialty: 'Family & Community Medicine',
        titleDisplay: 'Attending Physician',
        active: true,
        mfaEnrolled: true,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        uid: 'fix-nurse-1',
        email: 'nurse1.fixture@smartclinic.local',
        fullName: 'Nurse Camille Cruz (Test Fixture)',
        role: 'nurse',
        department: 'Outpatient Triage',
        specialty: 'Clinical Nursing',
        titleDisplay: 'Outpatient Triage Nurse',
        active: true,
        mfaEnrolled: true,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        uid: 'fix-rec-1',
        email: 'reception.fixture@smartclinic.local',
        fullName: 'Paolo Mendoza (Test Fixture)',
        role: 'receptionist',
        department: 'Front Desk & Billing',
        specialty: '',
        titleDisplay: 'Patient Services Coordinator',
        active: true,
        mfaEnrolled: true,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        uid: 'fix-lab-1',
        email: 'lab.fixture@smartclinic.local',
        fullName: 'Andrea Lim (Test Fixture)',
        role: 'laboratory',
        department: 'Clinical Laboratory',
        specialty: 'Clinical Microscopy & Hematology',
        titleDisplay: 'Laboratory Technologist',
        active: true,
        mfaEnrolled: true,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        uid: 'fix-pharm-1',
        email: 'pharmacy.fixture@smartclinic.local',
        fullName: 'Rafael Aquino (Test Fixture)',
        role: 'pharmacist',
        department: 'Outpatient Pharmacy',
        specialty: 'Clinical Dispensing',
        titleDisplay: 'Clinic Pharmacist',
        active: true,
        mfaEnrolled: true,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ];
    setStaffAccounts(fixtureStaff);

    setDoctorSchedules([
      {
        id: 'fix-doc-1',
        doctorUid: 'fix-doc-1',
        doctorName: 'Dr. Elena Santos (Test Fixture)',
        specialty: 'Internal Medicine',
        workdays: [0, 1, 2, 3, 4, 5, 6],
        startTime: '08:00',
        endTime: '17:00',
        breakStart: '12:00',
        breakEnd: '13:00',
        consultationDurationMinutes: 30,
        slotCapacity: 1,
        qualifiedServiceIds: ['srv-general-consult', 'srv-followup-consult'],
        active: true,
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'fix-doc-2',
        doctorUid: 'fix-doc-2',
        doctorName: 'Dr. Marco Reyes (Test Fixture)',
        specialty: 'Family & Community Medicine',
        workdays: [0, 1, 2, 3, 4, 5, 6],
        startTime: '09:00',
        endTime: '17:00',
        breakStart: '12:00',
        breakEnd: '13:00',
        consultationDurationMinutes: 30,
        slotCapacity: 1,
        qualifiedServiceIds: ['srv-general-consult', 'srv-followup-consult'],
        active: true,
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ]);

    setInventory([
      {
        id: 'med-para-500',
        sku: 'MED-001',
        genericName: 'Paracetamol',
        brandName: 'Generic Paracetamol',
        dosageForm: 'Tablet',
        strength: '500mg',
        stockQuantity: 250,
        reorderLevel: 50,
        unitPricePhp: 6,
        batchNumber: 'BCH-2601',
        expiryDate: '2027-08-30',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'med-cet-10',
        sku: 'MED-002',
        genericName: 'Cetirizine',
        brandName: 'Generic Cetirizine',
        dosageForm: 'Tablet',
        strength: '10mg',
        stockQuantity: 18,
        reorderLevel: 25,
        unitPricePhp: 12,
        batchNumber: 'BCH-2602',
        expiryDate: '2026-12-10',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ]);
  }, [isTestFixture]);

  const switchFixturePersona = useCallback(
    (role: UserRole) => {
      if (!isTestFixture) return;
      if (role === 'patient') {
        const pUid = 'fix-patient-1';
        const ptId = 'PT-FIX-1001';
        setFirebaseUser({
          uid: pUid,
          email: 'patient.fixture@smartclinic.local',
          emailVerified: true,
          displayName: 'Maria Clara (Test Fixture)',
        });
        setStaffAccount(null);
        setMfaSessionVerified(false);
        setPatientAccount({
          uid: pUid,
          email: 'patient.fixture@smartclinic.local',
          fullName: 'Maria Clara (Test Fixture)',
          phone: '09170001122',
          dateOfBirth: '1996-05-14',
          sex: 'Female',
          linkedPatientId: ptId,
          optionalMfaEnabled: false,
          optionalMfaEncryptedSecret: '',
          createdAt: '2026-11-01T00:00:00Z',
          updatedAt: '2026-11-01T00:00:00Z',
        });
        setPatients((prev) =>
          prev.some((p) => p.patientId === ptId)
            ? prev
            : [
                ...prev,
                {
                  patientId: ptId,
                  portalUserId: pUid,
                  fullName: 'Maria Clara (Test Fixture)',
                  dateOfBirth: '1996-05-14',
                  sex: 'Female',
                  phone: '09170001122',
                  email: 'patient.fixture@smartclinic.local',
                  address: 'Manila',
                  allergies: 'None known',
                  chronicConditions: 'None',
                  registrationSource: 'Online Portal',
                  authorizedViewerUids: roster.allStaffUids,
                  createdAt: '2026-11-01T00:00:00Z',
                  updatedAt: '2026-11-01T00:00:00Z',
                },
              ]
        );
      } else {
        const matched = staffAccounts.find((s) => s.role === role);
        if (!matched) return;
        setFirebaseUser({
          uid: matched.uid,
          email: matched.email,
          emailVerified: true,
          displayName: matched.fullName,
        });
        setPatientAccount(null);
        setStaffAccount(matched);
        setMfaSessionVerified(true);
        setMfaAssuranceToken('fixture-aal2-token');
        setMfaExpiresAtMs(Date.now() + 1800_000);
      }
    },
    [isTestFixture, roster.allStaffUids, staffAccounts]
  );

  // Expose isolated fixture switcher ONLY on localhost testFixture=1 for Playwright run-code scripts
  useEffect(() => {
    if (isTestFixture && typeof window !== 'undefined') {
      (window as any).__smartClinicSwitchFixtureRole = switchFixturePersona;
    }
  }, [isTestFixture, switchFixturePersona]);

  // ---------------------------------------------------------------------------
  // Real Firebase Auth + Public Firestore Catalog Subscriptions
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isTestFixture) return;

    const unsubServices = onSnapshot(
      query(collection(db, 'clinic_services'), where('active', '==', true)),
      (snap) => {
        if (!snap.empty) {
          const loaded = snap.docs.map((d) => d.data() as ClinicService);
          setServices(loaded);
        } else {
          setServices(DEFAULT_CLINIC_SERVICES);
        }
      },
      (err) => {
        console.warn('Public services listener fallback:', err.message);
      }
    );

    const unsubDoctors = onSnapshot(
      query(collection(db, 'public_doctors'), where('active', '==', true)),
      (snap) => {
        const docs = snap.docs.map((d) => {
          const data = d.data();
          return {
            ...data,
            updatedAt: data.updatedIso || '',
          } as DoctorSchedule;
        });
        setDoctorSchedules(docs);
      },
      (err) => {
        console.warn('Public doctors listener fallback:', err.message);
      }
    );

    const unsubGuides = onSnapshot(
      query(collection(db, 'patient_guides'), where('published', '==', true)),
      (snap) => {
        if (!snap.empty) {
          const loaded = snap.docs
            .map((d) => d.data() as PatientGuideSectionItem)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          setPatientGuides(loaded);
        } else {
          setPatientGuides(DEFAULT_PATIENT_GUIDES);
        }
      },
      (err) => {
        console.warn('Public guides listener fallback:', err.message);
      }
    );

    return () => {
      unsubServices();
      unsubDoctors();
      unsubGuides();
    };
  }, [isTestFixture]);

  // Session MFA timeout watcher (30 minutes)
  useEffect(() => {
    if (!mfaSessionVerified || !mfaExpiresAtMs) return;
    const delay = mfaExpiresAtMs - Date.now();
    if (delay <= 0) {
      setMfaSessionVerified(false);
      setMfaAssuranceToken('');
      return;
    }
    const timer = window.setTimeout(() => {
      setMfaSessionVerified(false);
      setMfaAssuranceToken('');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [mfaSessionVerified, mfaExpiresAtMs]);

  // Real Firebase Auth Listener
  useEffect(() => {
    if (isTestFixture) return;

    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        setFirebaseUser(null);
        setPatientAccount(null);
        setStaffAccount(null);
        setMfaSessionVerified(false);
        setMfaAssuranceToken('');
        setAuthReady(true);
        return;
      }

      setFirebaseUser({
        uid: user.uid,
        email: user.email || '',
        emailVerified: user.emailVerified,
        displayName: user.displayName || '',
      });

      try {
        // Load clinic roster if available
        const rosterSnap = await getDoc(doc(db, 'clinic_roster', 'current'));
        if (rosterSnap.exists()) {
          setRoster(rosterSnap.data() as ClinicRosterDoc);
        } else {
          setRoster(EMPTY_ROSTER);
        }

        // Load Coverage Settings if available
        const covSnap = await getDoc(doc(db, 'coverage_settings', 'current'));
        if (covSnap.exists()) {
          setCoverageSettings(covSnap.data() as CoverageSettings);
        }

        // Check if user is a Staff member (without wiping any co-existing Patient Portal account!)
        const staffSnap = await getDoc(doc(db, 'staff_accounts', user.uid));
        if (staffSnap.exists()) {
          const staffData = staffSnap.data();
          setStaffAccount({
            ...(staffData as StaffAccount),
            createdAt: staffData.createdIso || '',
            updatedAt: staffData.createdIso || '',
          });
        } else {
          setStaffAccount(null);
        }

        // Independently check if user also has a Patient Portal account so /patient/dashboard stays intact
        const patAcctSnap = await getDoc(doc(db, 'patient_accounts', user.uid));
        if (patAcctSnap.exists()) {
          const pData = patAcctSnap.data();
          setPatientAccount({
            ...(pData as PatientPortalAccount),
            createdAt: pData.createdIso || '',
            updatedAt: pData.createdIso || '',
          });
        } else if (!staffSnap.exists() && user.emailVerified && pendingRegProfileRef.current) {
          // Finalize queued profile creation once verified
          const p = pendingRegProfileRef.current;
          pendingRegProfileRef.current = null;
          const nowIso = new Date().toISOString();
          const newPtId = uidShort('PT-2026');
          const rSnap = await getDoc(doc(db, 'clinic_roster', 'current'));
          const viewers = rSnap.exists() ? ((rSnap.data() as ClinicRosterDoc).allStaffUids || []).slice(0, 30) : [];

          await setDoc(doc(db, 'patient_accounts', user.uid), {
            uid: user.uid,
            email: user.email || '',
            fullName: p.fullName,
            phone: p.phone,
            dateOfBirth: p.dateOfBirth,
            sex: p.sex,
            linkedPatientId: newPtId,
            optionalMfaEnabled: false,
            optionalMfaEncryptedSecret: '',
            createdIso: nowIso,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, 'patients', newPtId), {
            patientId: newPtId,
            portalUserId: user.uid,
            fullName: p.fullName,
            dateOfBirth: p.dateOfBirth,
            sex: p.sex,
            phone: p.phone,
            email: user.email || '',
            address: '',
            allergies: 'None reported',
            chronicConditions: 'None reported',
            registrationSource: 'Online Portal',
            authorizedViewerUids: viewers,
            createdIso: nowIso,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          setPatientAccount(null);
        }
      } catch (err) {
        console.warn('Initial profile lookup warning:', err);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, [isTestFixture]);

  // Role-Scoped Real-time Firestore Listeners
  useEffect(() => {
    if (isTestFixture || !authReady || !firebaseUser) return;

    const uid = firebaseUser.uid;
    const unsubs: (() => void)[] = [];

    // Common: Booked slots & Approved leaves for real-time availability
    unsubs.push(
      onSnapshot(
        query(collection(db, 'booked_slots'), where('active', '==', true)),
        (snap) => setBookedSlots(snap.docs.map((d) => d.data() as any)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'booked_slots')
      )
    );
    unsubs.push(
      onSnapshot(
        query(collection(db, 'approved_leaves'), where('active', '==', true)),
        (snap) =>
          setApprovedLeaves(
            snap.docs.map((d) => ({
              id: d.id,
              doctorUid: d.data().doctorUid,
              doctorName: '',
              startDate: d.data().startDate,
              endDate: d.data().endDate,
              reason: '',
              status: 'Approved',
              reviewedByUid: '',
              reviewNotes: '',
              affectedAppointmentIds: [],
              authorizedViewerUids: [],
              createdAt: '',
              updatedAt: '',
            }))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'approved_leaves')
      )
    );

    // Common: Own Notifications
    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('recipientUid', '==', uid)),
        (snap) => {
          const list = snap.docs
            .map((d) => {
              const x = d.data();
              return { ...(x as ClinicNotification), createdAt: x.createdIso || '' };
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setNotifications(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    const isViewingStaffRoute = currentPath.startsWith('/staff');

    // Patient Portal Subscriptions (Active whenever user has a Patient Portal account and is not inside a Staff Dashboard)
    if (patientAccount && !(isViewingStaffRoute && staffAccount && mfaSessionVerified)) {
      unsubs.push(
        onSnapshot(
          doc(db, 'patient_accounts', uid),
          (snap) => {
            if (snap.exists()) {
              const x = snap.data();
              setPatientAccount({ ...(x as PatientPortalAccount), createdAt: x.createdIso || '', updatedAt: x.createdIso || '' });
            }
          },
          (err) => handleFirestoreError(err, OperationType.GET, `patient_accounts/${uid}`)
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'patients'), where('portalUserId', '==', uid)),
          (snap) => setPatients(snap.docs.map((d) => ({ ...(d.data() as ClinicalPatientRecord), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'patients')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'appointments'), where('portalUserId', '==', uid)),
          (snap) => setAppointments(snap.docs.map((d) => ({ ...(d.data() as Appointment), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'appointments')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'visits'), where('portalUserId', '==', uid)),
          (snap) => setVisits(snap.docs.map((d) => ({ ...(d.data() as VisitEncounter), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'visits')
        )
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'consultations'),
            where('portalUserId', '==', uid),
            where('patientVisible', '==', true)
          ),
          (snap) => setConsultations(snap.docs.map((d) => ({ ...(d.data() as ConsultationRecord), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'consultations')
        )
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'lab_orders'),
            where('portalUserId', '==', uid),
            where('patientVisible', '==', true),
            where('status', '==', 'Released')
          ),
          (snap) => setLabOrders(snap.docs.map((d) => ({ ...(d.data() as LaboratoryOrder), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'lab_orders')
        )
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'prescriptions'),
            where('portalUserId', '==', uid),
            where('patientVisible', '==', true)
          ),
          (snap) => setPrescriptions(snap.docs.map((d) => ({ ...(d.data() as PrescriptionRecord), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'prescriptions')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'billings'), where('portalUserId', '==', uid)),
          (snap) => setBillings(snap.docs.map((d) => ({ ...(d.data() as BillingRecord), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'billings')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'follow_ups'), where('portalUserId', '==', uid)),
          (snap) => setFollowUps(snap.docs.map((d) => ({ ...(d.data() as FollowUpRecommendation), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'follow_ups')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'link_requests'), where('portalUserId', '==', uid)),
          (snap) => setLinkRequests(snap.docs.map((d) => ({ ...(d.data() as RecordLinkRequest), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'link_requests')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'appointment_reminders'), where('portalUserId', '==', uid)),
          (snap) => setReminders(snap.docs.map((d) => d.data() as AppointmentReminder)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'appointment_reminders')
        )
      );
    }

    // Staff Portal Subscriptions (Active ONLY after mandatory TOTP MFA session is verified!)
    if (staffAccount && mfaSessionVerified && (isViewingStaffRoute || !patientAccount)) {
      const role = staffAccount.role;

      unsubs.push(
        onSnapshot(
          doc(db, 'clinic_roster', 'current'),
          (snap) => {
            if (snap.exists()) setRoster(snap.data() as ClinicRosterDoc);
          },
          (err) => handleFirestoreError(err, OperationType.GET, 'clinic_roster/current')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'patients'), where('authorizedViewerUids', 'array-contains', uid)),
          (snap) => setPatients(snap.docs.map((d) => ({ ...(d.data() as ClinicalPatientRecord), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'patients')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'appointments'), where('authorizedViewerUids', 'array-contains', uid)),
          (snap) => setAppointments(snap.docs.map((d) => ({ ...(d.data() as Appointment), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'appointments')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'visits'), where('authorizedViewerUids', 'array-contains', uid)),
          (snap) => setVisits(snap.docs.map((d) => ({ ...(d.data() as VisitEncounter), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'visits')
        )
      );

      if (role === 'nurse' || role === 'doctor') {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'nursing_assessments'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setNursingAssessments(snap.docs.map((d) => d.data() as NursingAssessment)),
            (err) => handleFirestoreError(err, OperationType.LIST, 'nursing_assessments')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'consultations'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setConsultations(snap.docs.map((d) => ({ ...(d.data() as ConsultationRecord), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'consultations')
          )
        );
      }

      if (role === 'doctor' || role === 'nurse' || role === 'laboratory' || role === 'receptionist') {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'lab_orders'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setLabOrders(snap.docs.map((d) => ({ ...(d.data() as LaboratoryOrder), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'lab_orders')
          )
        );
      }

      if (role === 'doctor' || role === 'nurse' || role === 'pharmacist' || role === 'receptionist') {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'prescriptions'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setPrescriptions(snap.docs.map((d) => ({ ...(d.data() as PrescriptionRecord), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'prescriptions')
          )
        );
      }

      if (role === 'pharmacist' || role === 'doctor' || role === 'admin') {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'medicine_inventory'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setInventory(snap.docs.map((d) => ({ ...(d.data() as MedicineInventoryItem), updatedAt: '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'medicine_inventory')
          )
        );
      }

      if (role === 'receptionist' || role === 'admin') {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'billings'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setBillings(snap.docs.map((d) => ({ ...(d.data() as BillingRecord), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'billings')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'link_requests'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setLinkRequests(snap.docs.map((d) => ({ ...(d.data() as RecordLinkRequest), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'link_requests')
          )
        );
      }

      if (role === 'doctor' || role === 'receptionist' || role === 'nurse') {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'follow_ups'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setFollowUps(snap.docs.map((d) => ({ ...(d.data() as FollowUpRecommendation), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'follow_ups')
          )
        );
      }

      if (role === 'doctor') {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'leave_requests'), where('doctorUid', '==', uid)),
            (snap) => setLeaveRequests(snap.docs.map((d) => ({ ...(d.data() as LeaveRequest), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
          )
        );
      }

      if (role === 'admin') {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'staff_accounts'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setStaffAccounts(snap.docs.map((d) => ({ ...(d.data() as StaffAccount), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'staff_accounts')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'staff_invitations'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setStaffInvitations(snap.docs.map((d) => ({ ...(d.data() as StaffInvitation), createdAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'staff_invitations')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'leave_requests'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setLeaveRequests(snap.docs.map((d) => ({ ...(d.data() as LeaveRequest), createdAt: d.data().createdIso || '', updatedAt: d.data().createdIso || '' }))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'evaluator_imports'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setEvaluatorImports(snap.docs.map((d) => d.data() as EvaluatorImportBatch)),
            (err) => handleFirestoreError(err, OperationType.LIST, 'evaluator_imports')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'evaluator_records'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setEvaluatorRecords(snap.docs.map((d) => d.data() as EvaluatorConsultationRecord)),
            (err) => handleFirestoreError(err, OperationType.LIST, 'evaluator_records')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'operational_analytics_events'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) => setOperationalAnalyticsEvents(snap.docs.map((d) => d.data() as OperationalAnalyticsEvent)),
            (err) => handleFirestoreError(err, OperationType.LIST, 'operational_analytics_events')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'audit_logs'), where('authorizedViewerUids', 'array-contains', uid)),
            (snap) =>
              setAuditLogs(
                snap.docs
                  .map((d) => ({ ...(d.data() as AuditLogEntry), createdAt: d.data().createdIso || '' }))
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              ),
            (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs')
          )
        );
      }
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [isTestFixture, authReady, firebaseUser, patientAccount, staffAccount, mfaSessionVerified, currentPath]);

  // Helper: Emit Notification + Audit Log safely
  const emitNotification = useCallback(
    async (params: {
      recipientUid: string;
      recipientRole: UserRole;
      title: string;
      safeSummary: string;
      relatedRecordType: string;
      relatedRecordId: string;
      viewPath: string;
      dedupeKey: string;
      importantPopup?: boolean;
    }) => {
      if (!params.recipientUid) return;
      const nowIso = new Date().toISOString();
      const id = params.dedupeKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110) || uidShort('NTF');

      if (isTestFixture) {
        setNotifications((prev) =>
          prev.some((n) => n.dedupeKey === params.dedupeKey && n.recipientUid === params.recipientUid)
            ? prev
            : [
                {
                  id,
                  title: params.title,
                  safeSummary: params.safeSummary,
                  recipientUid: params.recipientUid,
                  recipientRole: params.recipientRole,
                  relatedRecordType: params.relatedRecordType,
                  relatedRecordId: params.relatedRecordId,
                  viewPath: params.viewPath,
                  dedupeKey: params.dedupeKey,
                  importantPopup: params.importantPopup ?? true,
                  read: false,
                  popupDismissed: false,
                  createdAt: nowIso,
                },
                ...prev,
              ]
        );
        return;
      }

      try {
        await setDoc(doc(db, 'notifications', id), {
          id,
          title: params.title.slice(0, 160),
          safeSummary: params.safeSummary.slice(0, 600),
          recipientUid: params.recipientUid,
          recipientRole: params.recipientRole,
          relatedRecordType: params.relatedRecordType.slice(0, 60),
          relatedRecordId: params.relatedRecordId.slice(0, 128),
          viewPath: params.viewPath.slice(0, 200),
          dedupeKey: params.dedupeKey.slice(0, 160),
          importantPopup: params.importantPopup ?? true,
          read: false,
          popupDismissed: false,
          createdIso: nowIso,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Notification write warning:', err);
      }
    },
    [isTestFixture]
  );

  const recordAudit = useCallback(
    async (params: {
      action: string;
      category: AuditLogEntry['category'];
      targetType: string;
      targetId: string;
      summary: string;
    }) => {
      if (!firebaseUser) return;
      const nowIso = new Date().toISOString();
      const id = uidShort('AUD');
      const actorRole: UserRole = staffAccount?.role || 'patient';

      if (isTestFixture) {
        setAuditLogs((prev) => [
          {
            id,
            actorUid: firebaseUser.uid,
            actorEmail: firebaseUser.email,
            actorRole,
            action: params.action,
            category: params.category,
            targetType: params.targetType,
            targetId: params.targetId,
            summary: params.summary,
            createdAt: nowIso,
          },
          ...prev,
        ]);
        return;
      }

      try {
        await setDoc(doc(db, 'audit_logs', id), {
          id,
          actorUid: firebaseUser.uid,
          actorEmail: firebaseUser.email.slice(0, 160),
          actorRole,
          action: params.action.slice(0, 120),
          category: params.category,
          targetType: params.targetType.slice(0, 60),
          targetId: params.targetId.slice(0, 128),
          summary: params.summary.slice(0, 600),
          authorizedViewerUids: roster.adminUids.slice(0, 30),
          createdIso: nowIso,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Audit log write warning:', err);
      }
    },
    [firebaseUser, staffAccount, isTestFixture, roster.adminUids]
  );

  // Materialize due 24-hour Asia/Manila in-app appointment reminders on Patient Portal access
  const materializedSessionRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!patientAccount || appointments.length === 0) return;

    const { dueAppointments } = computeDueAppointmentReminders({
      appointments,
      existingReminders: reminders,
    });

    for (const appt of dueAppointments) {
      if (materializedSessionRef.current.has(appt.id)) continue;
      materializedSessionRef.current.add(appt.id);

      const remId = `REM-${appt.id}`;
      const nowIso = new Date().toISOString();
      emitNotification({
        recipientUid: appt.portalUserId,
        recipientRole: 'patient',
        title: 'Upcoming Appointment Reminder (Within 24 Hours)',
        safeSummary: `Reminder: Your ${appt.serviceName} with ${appt.doctorName} is scheduled on ${appt.appointmentDate} at ${appt.appointmentTime} (Asia/Manila). Bring your QR Pass.`,
        relatedRecordType: 'appointment',
        relatedRecordId: appt.id,
        viewPath: '/patient/qr',
        dedupeKey: `rem-24h-${appt.id}-${appt.appointmentDate}-${appt.appointmentTime}`,
        importantPopup: true,
      });

      if (isTestFixture) {
        setReminders((prev) => [
          ...prev.filter((r) => r.id !== remId),
          {
            id: remId,
            appointmentId: appt.id,
            portalUserId: appt.portalUserId,
            appointmentDate: appt.appointmentDate,
            appointmentTime: appt.appointmentTime,
            dueAtIso: nowIso,
            status: 'Materialized',
            materializedAt: nowIso,
            dedupeKey: `rem-${appt.id}`,
          },
        ]);
      } else {
        setDoc(doc(db, 'appointment_reminders', remId), {
          id: remId,
          appointmentId: appt.id,
          portalUserId: appt.portalUserId,
          appointmentDate: appt.appointmentDate,
          appointmentTime: appt.appointmentTime,
          dueAtIso: nowIso,
          status: 'Materialized',
          materializedAt: nowIso,
          dedupeKey: `rem-${appt.id}`,
          authorizedViewerUids: roster.allStaffUids.slice(0, 30),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }
  }, [patientAccount, appointments, reminders, emitNotification, isTestFixture, roster.allStaffUids]);

  // ---------------------------------------------------------------------------
  // Authentication & Onboarding Handlers
  // ---------------------------------------------------------------------------
  const signInWithGoogleAction = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Google sign-in was cancelled or failed.' };
    }
  };

  const signInWithEmailAction = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        code: err?.code || '',
        error: err?.message || 'Unable to sign in with email and password.',
      };
    }
  };

  const registerPatientEmailAction: ClinicContextValue['registerPatientEmailAction'] = async (params) => {
    try {
      pendingRegProfileRef.current = {
        fullName: params.fullName.trim(),
        phone: params.phone.trim(),
        dateOfBirth: params.dateOfBirth,
        sex: params.sex,
      };
      const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
      await sendEmailVerification(cred.user);
      return { ok: true, requiresVerification: !cred.user.emailVerified };
    } catch (err: any) {
      pendingRegProfileRef.current = null;
      return {
        ok: false,
        code: err?.code || '',
        error: err?.message || 'Account registration failed.',
      };
    }
  };

  const completePatientProfileSetup: ClinicContextValue['completePatientProfileSetup'] = async (params) => {
    if (!firebaseUser) return { ok: false, error: 'Not signed in.' };
    if (!firebaseUser.emailVerified) {
      return { ok: false, error: 'Please verify your email address first before completing portal setup.' };
    }

    const nowIso = new Date().toISOString();
    const newPtId = params.createFreshClinicalRecord ? uidShort('PT-2026') : '';

    if (isTestFixture) {
      setPatientAccount({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        fullName: params.fullName.trim(),
        phone: params.phone.trim(),
        dateOfBirth: params.dateOfBirth,
        sex: params.sex,
        linkedPatientId: newPtId,
        optionalMfaEnabled: false,
        optionalMfaEncryptedSecret: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      if (newPtId) {
        setPatients((prev) => [
          ...prev,
          {
            patientId: newPtId,
            portalUserId: firebaseUser.uid,
            fullName: params.fullName.trim(),
            dateOfBirth: params.dateOfBirth,
            sex: params.sex,
            phone: params.phone.trim(),
            email: firebaseUser.email,
            address: '',
            allergies: 'None reported',
            chronicConditions: 'None reported',
            registrationSource: 'Online Portal',
            authorizedViewerUids: roster.allStaffUids,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ]);
      }
      return { ok: true };
    }

    try {
      await setDoc(doc(db, 'patient_accounts', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        fullName: params.fullName.trim(),
        phone: params.phone.trim(),
        dateOfBirth: params.dateOfBirth,
        sex: params.sex,
        linkedPatientId: newPtId,
        optionalMfaEnabled: false,
        optionalMfaEncryptedSecret: '',
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (newPtId) {
        await setDoc(doc(db, 'patients', newPtId), {
          patientId: newPtId,
          portalUserId: firebaseUser.uid,
          fullName: params.fullName.trim(),
          dateOfBirth: params.dateOfBirth,
          sex: params.sex,
          phone: params.phone.trim(),
          email: firebaseUser.email,
          address: '',
          allergies: 'None reported',
          chronicConditions: 'None reported',
          registrationSource: 'Online Portal',
          authorizedViewerUids: roster.allStaffUids.slice(0, 30),
          createdIso: nowIso,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setPatientAccount({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        fullName: params.fullName.trim(),
        phone: params.phone.trim(),
        dateOfBirth: params.dateOfBirth,
        sex: params.sex,
        linkedPatientId: newPtId,
        optionalMfaEnabled: false,
        optionalMfaEncryptedSecret: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      return { ok: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `patient_accounts/${firebaseUser.uid}`);
    }
  };

  const resendEmailVerificationAction = async () => {
    try {
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Unable to send verification email.' };
    }
  };

  const refreshEmailVerificationStatus = async () => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const verified = auth.currentUser.emailVerified;
    setFirebaseUser((prev) => (prev ? { ...prev, emailVerified: verified } : null));
    return verified;
  };

  const registerInvitedStaffEmailAction: ClinicContextValue['registerInvitedStaffEmailAction'] = async (
    params
  ) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
      await sendEmailVerification(cred.user);
      return { ok: true, requiresVerification: !cred.user.emailVerified };
    } catch (err: any) {
      return {
        ok: false,
        error:
          err?.code === 'auth/operation-not-allowed'
            ? 'Email/Password Sign-In is not enabled in Firebase Console yet. Use "Sign In with Verified Staff Google Account" or enable Email/Password under Firebase Console -> Authentication -> Sign-in method.'
            : err?.message || 'Unable to create staff login credentials.',
      };
    }
  };

  const bootstrapInitialAdminAction = async (fullName: string) => {
    if (!firebaseUser || !firebaseUser.emailVerified) {
      return { ok: false, error: 'Verified account required to initialize Administrator.' };
    }
    if (firebaseUser.email.trim().toLowerCase() !== DESIGNATED_BOOTSTRAP_ADMIN_EMAIL) {
      return {
        ok: false,
        error: `Initial Administrator bootstrap is restricted to the designated project owner (${DESIGNATED_BOOTSTRAP_ADMIN_EMAIL}). Unrestricted public administrator registration is disabled.`,
      };
    }
    const nowIso = new Date().toISOString();

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'admins', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email: firebaseUser.email.trim().toLowerCase(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const nextRoster: ClinicRosterDoc = {
        bootstrappedAdminUid: firebaseUser.uid,
        adminUids: [firebaseUser.uid],
        doctorUids: [],
        nurseUids: [],
        receptionistUids: [],
        labUids: [],
        pharmacistUids: [],
        allStaffUids: [firebaseUser.uid],
      };

      batch.set(doc(db, 'clinic_roster', 'current'), {
        ...nextRoster,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'staff_accounts', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email: firebaseUser.email.trim().toLowerCase(),
        fullName: fullName.trim() || firebaseUser.displayName || 'Clinic Administrator',
        role: 'admin',
        department: 'Clinic Administration',
        specialty: '',
        titleDisplay: 'System Administrator',
        active: true,
        mfaEnrolled: false,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        authorizedViewerUids: [firebaseUser.uid],
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Seed default services, patient guides, coverage settings, and clinic medicine formulary
      for (const srv of DEFAULT_CLINIC_SERVICES) {
        batch.set(doc(db, 'clinic_services', srv.id), {
          ...srv,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      for (const guide of DEFAULT_PATIENT_GUIDES) {
        batch.set(doc(db, 'patient_guides', guide.id), {
          ...guide,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      for (const med of DEFAULT_MEDICINE_INVENTORY) {
        batch.set(doc(db, 'medicine_inventory', med.id), {
          ...med,
          authorizedViewerUids: [firebaseUser.uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      batch.set(doc(db, 'coverage_settings', 'current'), {
        id: 'current',
        hmoProvidersAcceptedForManualVerification: DEFAULT_COVERAGE_SETTINGS.hmoProvidersAcceptedForManualVerification,
        philHealthAdvisoryNote: DEFAULT_COVERAGE_SETTINGS.philHealthAdvisoryNote,
        requireLoaReferenceForHmo: DEFAULT_COVERAGE_SETTINGS.requireLoaReferenceForHmo,
        defaultGeneralConsultationFeePhp: DEFAULT_COVERAGE_SETTINGS.defaultGeneralConsultationFeePhp,
        defaultFollowUpConsultationFeePhp: DEFAULT_COVERAGE_SETTINGS.defaultFollowUpConsultationFeePhp,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      setRoster(nextRoster);
      setStaffAccount({
        uid: firebaseUser.uid,
        email: firebaseUser.email.trim().toLowerCase(),
        fullName: fullName.trim() || firebaseUser.displayName || 'Clinic Administrator',
        role: 'admin',
        department: 'Clinic Administration',
        specialty: '',
        titleDisplay: 'System Administrator',
        active: true,
        mfaEnrolled: false,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to bootstrap initial Administrator.' };
    }
  };

  const claimStaffInvitationAction = async () => {
    if (!firebaseUser || !firebaseUser.emailVerified) {
      return { ok: false, error: 'Verified email required to claim staff assignment.' };
    }
    const inviteId = emailToInviteId(firebaseUser.email);
    try {
      const invSnap = await getDoc(doc(db, 'staff_invitations', inviteId));
      if (!invSnap.exists() || invSnap.data().status !== 'Pending Enrollment') {
        return {
          ok: false,
          error: 'No pending staff authorization found for this email address. Contact the Clinic Administrator.',
        };
      }
      const inv = invSnap.data() as StaffInvitation;
      const rSnap = await getDoc(doc(db, 'clinic_roster', 'current'));
      const curRoster: ClinicRosterDoc = rSnap.exists()
        ? (rSnap.data() as ClinicRosterDoc)
        : EMPTY_ROSTER;

      const addUnique = (arr: string[], item: string) =>
        Array.from(new Set([...(arr || []), item])).slice(0, 30);

      const updatedRoster: ClinicRosterDoc = {
        bootstrappedAdminUid: curRoster.bootstrappedAdminUid,
        adminUids: inv.role === 'admin' ? addUnique(curRoster.adminUids, firebaseUser.uid) : curRoster.adminUids,
        doctorUids: inv.role === 'doctor' ? addUnique(curRoster.doctorUids, firebaseUser.uid) : curRoster.doctorUids,
        nurseUids: inv.role === 'nurse' ? addUnique(curRoster.nurseUids, firebaseUser.uid) : curRoster.nurseUids,
        receptionistUids:
          inv.role === 'receptionist'
            ? addUnique(curRoster.receptionistUids, firebaseUser.uid)
            : curRoster.receptionistUids,
        labUids: inv.role === 'laboratory' ? addUnique(curRoster.labUids, firebaseUser.uid) : curRoster.labUids,
        pharmacistUids:
          inv.role === 'pharmacist'
            ? addUnique(curRoster.pharmacistUids, firebaseUser.uid)
            : curRoster.pharmacistUids,
        allStaffUids: addUnique(curRoster.allStaffUids, firebaseUser.uid),
      };

      const nowIso = new Date().toISOString();
      await setDoc(doc(db, 'staff_accounts', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email: firebaseUser.email.trim().toLowerCase(),
        fullName: inv.fullName,
        role: inv.role,
        department: inv.department,
        specialty: inv.specialty,
        titleDisplay: inv.titleDisplay,
        active: true,
        mfaEnrolled: false,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        authorizedViewerUids: addUnique(updatedRoster.adminUids, firebaseUser.uid),
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (inv.role === 'admin') {
        await setDoc(doc(db, 'admins', firebaseUser.uid), {
          uid: firebaseUser.uid,
          email: firebaseUser.email.trim().toLowerCase(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await updateDoc(doc(db, 'staff_invitations', inviteId), {
        status: 'Claimed',
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'clinic_roster', 'current'), {
        adminUids: updatedRoster.adminUids,
        doctorUids: updatedRoster.doctorUids,
        nurseUids: updatedRoster.nurseUids,
        receptionistUids: updatedRoster.receptionistUids,
        labUids: updatedRoster.labUids,
        pharmacistUids: updatedRoster.pharmacistUids,
        allStaffUids: updatedRoster.allStaffUids,
        updatedAt: serverTimestamp(),
      });

      if (inv.role === 'doctor') {
        await setDoc(doc(db, 'public_doctors', firebaseUser.uid), {
          id: firebaseUser.uid,
          doctorUid: firebaseUser.uid,
          doctorName: inv.fullName,
          specialty: inv.specialty || 'General Medicine',
          workdays: [1, 2, 3, 4, 5],
          startTime: '08:00',
          endTime: '17:00',
          breakStart: '12:00',
          breakEnd: '13:00',
          consultationDurationMinutes: 30,
          slotCapacity: 1,
          qualifiedServiceIds: ['srv-general-consult', 'srv-followup-consult'],
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setRoster(updatedRoster);
      setStaffAccount({
        uid: firebaseUser.uid,
        email: firebaseUser.email.trim().toLowerCase(),
        fullName: inv.fullName,
        role: inv.role,
        department: inv.department,
        specialty: inv.specialty,
        titleDisplay: inv.titleDisplay,
        active: true,
        mfaEnrolled: false,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      return { ok: true, claimedRole: inv.role };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to claim staff assignment.' };
    }
  };

  const completeStaffMfaEnrollment: ClinicContextValue['completeStaffMfaEnrollment'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'No active staff account.' };

    if (!isTestFixture) {
      try {
        await updateDoc(doc(db, 'staff_accounts', firebaseUser.uid), {
          mfaEnrolled: true,
          mfaEncryptedSecret: params.encryptedSecret,
          mfaRecoveryHashes: params.recoveryHashes.slice(0, 10),
          fullName: staffAccount.fullName,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `staff_accounts/${firebaseUser.uid}`);
      }
    }

    setStaffAccount((prev) =>
      prev
        ? {
            ...prev,
            mfaEnrolled: true,
            mfaEncryptedSecret: params.encryptedSecret,
            mfaRecoveryHashes: params.recoveryHashes,
          }
        : null
    );
    setMfaAssuranceToken(params.assuranceToken);
    setMfaExpiresAtMs(params.expiresAtMs);
    setMfaSessionVerified(true);

    await recordAudit({
      action: 'STAFF_TOTP_MFA_ENROLLED',
      category: 'Security',
      targetType: 'staff_account',
      targetId: firebaseUser.uid,
      summary: `Completed mandatory Authenticator-App TOTP enrollment for ${staffAccount.role}.`,
    });

    return { ok: true };
  };

  const setStaffMfaVerifiedSession: ClinicContextValue['setStaffMfaVerifiedSession'] = async (params) => {
    if (params.usedRecoveryHash && staffAccount && firebaseUser && !isTestFixture) {
      const remaining = staffAccount.mfaRecoveryHashes.filter((h) => h !== params.usedRecoveryHash);
      await updateDoc(doc(db, 'staff_accounts', firebaseUser.uid), {
        mfaEnrolled: staffAccount.mfaEnrolled,
        mfaEncryptedSecret: staffAccount.mfaEncryptedSecret,
        mfaRecoveryHashes: remaining,
        fullName: staffAccount.fullName,
        updatedAt: serverTimestamp(),
      });
      setStaffAccount((prev) => (prev ? { ...prev, mfaRecoveryHashes: remaining } : null));
    }
    setMfaAssuranceToken(params.assuranceToken);
    setMfaExpiresAtMs(params.expiresAtMs);
    setMfaSessionVerified(true);

    await recordAudit({
      action: 'STAFF_TOTP_MFA_VERIFIED',
      category: 'Authentication',
      targetType: 'staff_account',
      targetId: firebaseUser?.uid || '',
      summary: `Verified mandatory TOTP 2FA session assurance.`,
    });
  };

  const logoutAction = async () => {
    setMfaSessionVerified(false);
    setMfaAssuranceToken('');
    setMfaExpiresAtMs(0);
    if (isTestFixture) {
      setFirebaseUser(null);
      setPatientAccount(null);
      setStaffAccount(null);
      return;
    }
    await signOut(auth);
  };

  // ---------------------------------------------------------------------------
  // Online Appointment Booking, Rescheduling & Cancellation
  // ---------------------------------------------------------------------------
  const bookAppointmentAction: ClinicContextValue['bookAppointmentAction'] = async (params) => {
    const srv = services.find((s) => s.id === params.serviceId);
    if (!srv || !srv.directlyBookable) {
      return { ok: false, error: 'Selected service cannot be booked directly without a Doctor order.' };
    }

    const todayIso = getManilaDateIso();
    const currentHhMm = getManilaTimeHhMm();

    // Represent active bookedSlots as Appointment-compatible objects for availability validation
    const slotBackedAppointments: Appointment[] = bookedSlots
      .filter((bs) => bs.active)
      .map((bs) => ({
        id: bs.appointmentId,
        doctorUid: bs.doctorUid,
        appointmentDate: bs.appointmentDate,
        appointmentTime: bs.appointmentTime,
        endTime: bs.endTime,
        durationMinutes: bs.durationMinutes,
        status: 'Confirmed',
      } as Appointment));

    const replacementContext = params.rescheduleFromAppointment
      ? {
          originalAppointment: params.rescheduleFromAppointment,
          initiator: params.rescheduleInitiator || ('patient' as const),
        }
      : undefined;

    // Revalidate on backend Express route
    let assignedDoctorUid = params.doctorUid;
    let assignedDoctorName = '';
    let slotEndTime = '';

    try {
      const resp = await fetch('/api/appointments/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedules: doctorSchedules,
          doctorUid: params.doctorUid,
          serviceId: params.serviceId,
          serviceDurationMinutes: srv.durationMinutes,
          appointmentDate: params.appointmentDate,
          appointmentTime: params.appointmentTime,
          leaves: approvedLeaves,
          existingAppointments: slotBackedAppointments,
          excludeAppointmentId: params.rescheduleFromAppointment?.id,
          replacementContext,
        }),
      });
      const vData = await resp.json();
      if (!resp.ok || !vData.ok) {
        return { ok: false, error: vData.error || 'Selected time slot is unavailable.' };
      }
      assignedDoctorUid = vData.assignedDoctorUid;
      assignedDoctorName = vData.assignedDoctorName;
      slotEndTime = vData.endTime;
    } catch {
      // Fallback local deterministic validation if offline
      if (replacementContext) {
        const rc = validateReplacementDateRule({
          originalAppointment: replacementContext.originalAppointment,
          proposedDate: params.appointmentDate,
          initiator: replacementContext.initiator,
          todayIsoDate: todayIso,
        });
        if (!rc.allowed) return { ok: false, error: rc.reason };
      }
      const openSlots = calculateAvailableSlots({
        schedules: doctorSchedules,
        doctorUid: params.doctorUid,
        serviceId: params.serviceId,
        serviceDurationMinutes: srv.durationMinutes,
        isoDate: params.appointmentDate,
        todayIsoDate: todayIso,
        currentHhMm,
        leaves: approvedLeaves,
        existingAppointments: slotBackedAppointments,
        excludeAppointmentId: params.rescheduleFromAppointment?.id,
      });
      const found = openSlots.find((s) => s.startTime === params.appointmentTime);
      if (!found) return { ok: false, error: 'Selected time slot is no longer available.' };
      slotEndTime = found.endTime;
      if (params.doctorUid === 'any') {
        const docChoice = assignDoctorForAnyAvailable({
          candidateDoctorUids: found.availableDoctorUids,
          schedules: doctorSchedules,
          isoDate: params.appointmentDate,
          existingAppointments: slotBackedAppointments,
        });
        if (!docChoice) return { ok: false, error: 'No available Doctor found.' };
        assignedDoctorUid = docChoice.doctorUid;
        assignedDoctorName = docChoice.doctorName;
      } else {
        assignedDoctorName =
          doctorSchedules.find((d) => d.doctorUid === params.doctorUid)?.doctorName || '';
      }
    }

    const newApptId = uidShort('APT');
    const refNumber = uidShort('SC-APT');
    const nowIso = new Date().toISOString();

    // Sign QR token on backend (zero medical PII inside QR)
    let qrToken = `SC1.${newApptId}.${refNumber}.${params.appointmentDate}.LOCAL.SIG`;
    try {
      const qrResp = await fetch('/api/qr/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: newApptId,
          referenceNumber: refNumber,
          appointmentDate: params.appointmentDate,
        }),
      });
      if (qrResp.ok) {
        const qrJson = await qrResp.json();
        qrToken = qrJson.qrToken;
      }
    } catch {
      // keep fallback token
    }

    const prevBlocked = params.rescheduleFromAppointment
      ? params.rescheduleInitiator === 'clinic'
        ? params.rescheduleFromAppointment.blockedReplacementDates || []
        : Array.from(
            new Set([
              ...(params.rescheduleFromAppointment.blockedReplacementDates || []),
              params.rescheduleFromAppointment.appointmentDate,
            ])
          ).slice(0, 20)
      : [];

    const minReplacementDate =
      params.rescheduleFromAppointment && params.rescheduleInitiator !== 'clinic'
        ? addDaysToIsoDate(params.rescheduleFromAppointment.appointmentDate, 1)
        : '';

    const viewers = Array.from(
      new Set([...roster.receptionistUids, ...roster.nurseUids, ...roster.adminUids, assignedDoctorUid])
    )
      .filter(Boolean)
      .slice(0, 30);

    const newAppt: Appointment = {
      id: newApptId,
      referenceNumber: refNumber,
      patientId: params.patientId,
      portalUserId: params.portalUserId,
      patientName: params.patientName,
      serviceId: srv.id,
      serviceName: srv.name,
      bookingMode: params.doctorUid === 'any' ? 'Any Available Doctor' : 'Specific Doctor',
      doctorUid: assignedDoctorUid,
      doctorName: assignedDoctorName,
      appointmentDate: params.appointmentDate,
      appointmentTime: params.appointmentTime,
      endTime: slotEndTime,
      durationMinutes: srv.durationMinutes,
      status: 'Confirmed',
      qrToken,
      qrStatus: 'Active',
      blockedReplacementDates: prevBlocked,
      minReplacementDate,
      previousAppointmentId: params.rescheduleFromAppointment?.id || '',
      followUpRecommendationId: params.followUpRecommendationId || '',
      reasonForVisit: params.reasonForVisit.trim().slice(0, 500),
      checkedInAt: '',
      visitId: '',
      statusHistory: [
        {
          status: 'Confirmed',
          changedAt: nowIso,
          changedByRole: staffAccount?.role || 'patient',
          reason: params.rescheduleFromAppointment
            ? `Rescheduled from ${params.rescheduleFromAppointment.referenceNumber}`
            : 'Online booking confirmed',
        },
      ],
      authorizedViewerUids: viewers,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const slotDocId = `${assignedDoctorUid}_${params.appointmentDate}_${params.appointmentTime.replace(':', '')}`;

    if (isTestFixture) {
      if (bookedSlots.some((s) => s.doctorUid === assignedDoctorUid && s.appointmentDate === params.appointmentDate && s.appointmentTime === params.appointmentTime && s.active)) {
        return { ok: false, error: 'Double-booking prevented: Slot already reserved.' };
      }
      setBookedSlots((prev) => [
        ...prev.map((s) =>
          params.rescheduleFromAppointment && s.appointmentId === params.rescheduleFromAppointment.id
            ? { ...s, active: false }
            : s
        ),
        {
          doctorUid: assignedDoctorUid,
          appointmentDate: params.appointmentDate,
          appointmentTime: params.appointmentTime,
          endTime: slotEndTime,
          durationMinutes: srv.durationMinutes,
          appointmentId: newApptId,
          active: true,
        },
      ]);
      setAppointments((prev) => [
        ...prev.map((a) =>
          params.rescheduleFromAppointment && a.id === params.rescheduleFromAppointment.id
            ? {
                ...a,
                status: 'Rescheduled' as const,
                qrStatus: 'Replaced' as const,
                blockedReplacementDates: prevBlocked,
                minReplacementDate,
              }
            : a
        ),
        newAppt,
      ]);
      if (params.followUpRecommendationId) {
        setFollowUps((prev) =>
          prev.map((f) =>
            f.id === params.followUpRecommendationId
              ? { ...f, status: 'Booked', bookedAppointmentId: newApptId }
              : f
          )
        );
      }
    } else {
      try {
        await runTransaction(db, async (tx) => {
          const slotRef = doc(db, 'booked_slots', slotDocId);
          const slotSnap = await tx.get(slotRef);
          if (slotSnap.exists() && slotSnap.data().active === true) {
            throw new Error('DOUBLE_BOOKING_CONFLICT');
          }

          if (params.rescheduleFromAppointment) {
            const oldSlotId = `${params.rescheduleFromAppointment.doctorUid}_${params.rescheduleFromAppointment.appointmentDate}_${params.rescheduleFromAppointment.appointmentTime.replace(':', '')}`;
            const oldSlotRef = doc(db, 'booked_slots', oldSlotId);
            const oldSlotSnap = await tx.get(oldSlotRef);
            if (oldSlotSnap.exists()) {
              tx.update(oldSlotRef, {
                active: false,
                appointmentId: params.rescheduleFromAppointment.id,
                updatedAt: serverTimestamp(),
              });
            }

            const oldApptRef = doc(db, 'appointments', params.rescheduleFromAppointment.id);
            tx.update(oldApptRef, {
              status: 'Rescheduled',
              qrStatus: 'Replaced',
              qrToken: params.rescheduleFromAppointment.qrToken,
              appointmentDate: params.rescheduleFromAppointment.appointmentDate,
              appointmentTime: params.rescheduleFromAppointment.appointmentTime,
              endTime: params.rescheduleFromAppointment.endTime,
              doctorUid: params.rescheduleFromAppointment.doctorUid,
              doctorName: params.rescheduleFromAppointment.doctorName,
              bookingMode: params.rescheduleFromAppointment.bookingMode,
              blockedReplacementDates: prevBlocked,
              minReplacementDate,
              statusHistory: [
                ...(params.rescheduleFromAppointment.statusHistory || []),
                {
                  status: 'Rescheduled',
                  changedAt: nowIso,
                  changedByRole: staffAccount?.role || 'patient',
                  reason: `Replaced by ${refNumber}`,
                },
              ].slice(-25),
              updatedAt: serverTimestamp(),
            });
          }

          tx.set(slotRef, {
            id: slotDocId,
            doctorUid: assignedDoctorUid,
            appointmentDate: params.appointmentDate,
            appointmentTime: params.appointmentTime,
            endTime: slotEndTime,
            durationMinutes: srv.durationMinutes,
            appointmentId: newApptId,
            portalUserId: params.portalUserId || firebaseUser?.uid || '',
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          const { createdAt: _c, updatedAt: _u, changeInitiator: _ci, ...apptRest } = newAppt;
          tx.set(doc(db, 'appointments', newApptId), {
            ...apptRest,
            createdIso: nowIso,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          if (params.followUpRecommendationId) {
            tx.update(doc(db, 'follow_ups', params.followUpRecommendationId), {
              status: 'Booked',
              bookedAppointmentId: newApptId,
              updatedAt: serverTimestamp(),
            });
          }
        });
      } catch (err: any) {
        if (err?.message === 'DOUBLE_BOOKING_CONFLICT') {
          return {
            ok: false,
            error: 'That slot was just reserved by another patient. Please pick another open time.',
          };
        }
        handleFirestoreError(err, OperationType.WRITE, `appointments/${newApptId}`);
      }
    }

    if (params.portalUserId) {
      await emitNotification({
        recipientUid: params.portalUserId,
        recipientRole: 'patient',
        title: params.rescheduleFromAppointment ? 'Appointment Rescheduled' : 'Appointment Confirmed',
        safeSummary: `${srv.name} with ${assignedDoctorName} confirmed for ${params.appointmentDate} at ${params.appointmentTime}. Ref: ${refNumber}.`,
        relatedRecordType: 'appointment',
        relatedRecordId: newApptId,
        viewPath: '/patient/qr',
        dedupeKey: `appt-conf-${newApptId}`,
        importantPopup: true,
      });
    }

    if (assignedDoctorUid) {
      await emitNotification({
        recipientUid: assignedDoctorUid,
        recipientRole: 'doctor',
        title: params.rescheduleFromAppointment ? 'Patient Rescheduled Appointment' : 'New Scheduled Appointment',
        safeSummary: `${params.patientName} booked ${srv.name} on ${params.appointmentDate} at ${params.appointmentTime} (${refNumber}).`,
        relatedRecordType: 'appointment',
        relatedRecordId: newApptId,
        viewPath: '/staff/doctor/dashboard',
        dedupeKey: `doc-appt-${newApptId}`,
        importantPopup: false,
      });
    }

    return { ok: true, appointment: newAppt };
  };

  const cancelAppointmentAction: ClinicContextValue['cancelAppointmentAction'] = async (
    appointmentId,
    initiator,
    reason
  ) => {
    const target = appointments.find((a) => a.id === appointmentId);
    if (!target) return { ok: false, error: 'Appointment not found.' };

    const nowIso = new Date().toISOString();
    const blockedDates =
      initiator === 'patient'
        ? Array.from(new Set([...(target.blockedReplacementDates || []), target.appointmentDate])).slice(0, 20)
        : target.blockedReplacementDates || [];
    const minDate =
      initiator === 'patient' ? addDaysToIsoDate(target.appointmentDate, 1) : target.minReplacementDate;

    if (isTestFixture) {
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === appointmentId
            ? {
                ...a,
                status: 'Cancelled',
                qrStatus: 'Invalidated',
                blockedReplacementDates: blockedDates,
                minReplacementDate: minDate,
              }
            : a
        )
      );
      setBookedSlots((prev) =>
        prev.map((s) => (s.appointmentId === appointmentId ? { ...s, active: false } : s))
      );
    } else {
      try {
        const slotId = `${target.doctorUid}_${target.appointmentDate}_${target.appointmentTime.replace(':', '')}`;
        await updateDoc(doc(db, 'appointments', appointmentId), {
          status: 'Cancelled',
          qrStatus: 'Invalidated',
          qrToken: target.qrToken,
          appointmentDate: target.appointmentDate,
          appointmentTime: target.appointmentTime,
          endTime: target.endTime,
          doctorUid: target.doctorUid,
          doctorName: target.doctorName,
          bookingMode: target.bookingMode,
          blockedReplacementDates: blockedDates,
          minReplacementDate: minDate,
          statusHistory: [
            ...(target.statusHistory || []),
            {
              status: 'Cancelled',
              changedAt: nowIso,
              changedByRole: staffAccount?.role || 'patient',
              reason: reason || 'Cancelled',
            },
          ].slice(-25),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'booked_slots', slotId), {
          active: false,
          appointmentId,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `appointments/${appointmentId}`);
      }
    }

    if (target.portalUserId) {
      await emitNotification({
        recipientUid: target.portalUserId,
        recipientRole: 'patient',
        title: 'Appointment Cancelled',
        safeSummary: `Appointment ${target.referenceNumber} (${target.appointmentDate} ${target.appointmentTime}) was cancelled. Note: Voluntary replacement bookings must select ${minDate || 'a later open date'}.`,
        relatedRecordType: 'appointment',
        relatedRecordId: appointmentId,
        viewPath: '/patient/appointments',
        dedupeKey: `appt-canc-${appointmentId}`,
      });
    }

    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Existing Walk-in Record Linking
  // ---------------------------------------------------------------------------
  const submitRecordLinkRequestAction: ClinicContextValue['submitRecordLinkRequestAction'] = async (params) => {
    if (!firebaseUser) return { ok: false, message: 'Please sign in first.' };
    const reqId = uidShort('LNK');
    const nowIso = new Date().toISOString();
    const viewers = Array.from(new Set([...roster.receptionistUids, ...roster.adminUids])).slice(0, 30);

    const match = findCandidateWalkInRecordForLink({
      requestedFullName: params.requestedFullName,
      requestedDob: params.requestedDob,
      knownPatientIdHint: params.knownPatientIdHint,
      clinicalRecords: patients,
    });

    const newReq: RecordLinkRequest = {
      id: reqId,
      portalUserId: firebaseUser.uid,
      portalEmail: firebaseUser.email,
      requestedFullName: params.requestedFullName.trim(),
      requestedDob: params.requestedDob,
      requestedPhone: params.requestedPhone.trim(),
      knownPatientIdHint: params.knownPatientIdHint.trim(),
      lastVisitDateHint: params.lastVisitDateHint,
      candidatePatientId: match.candidatePatientId,
      status: 'Pending Staff Verification',
      verificationNotes: '',
      reviewedByUid: '',
      authorizedViewerUids: viewers,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setLinkRequests((prev) => [newReq, ...prev]);
    } else {
      const { createdAt: _c, updatedAt: _u, ...rest } = newReq;
      await setDoc(doc(db, 'link_requests', reqId), {
        ...rest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const rUid of roster.receptionistUids) {
      await emitNotification({
        recipientUid: rUid,
        recipientRole: 'receptionist',
        title: 'Patient Record Linking Request',
        safeSummary: `${params.requestedFullName} requested verification to link a previous walk-in record.`,
        relatedRecordType: 'link_request',
        relatedRecordId: reqId,
        viewPath: '/staff/receptionist/dashboard',
        dedupeKey: `lnk-${reqId}-${rUid}`,
      });
    }

    return {
      ok: true,
      message:
        'Record linking request submitted for authorized staff identity verification. Confidential records remain protected until verified.',
    };
  };

  const reviewRecordLinkRequestAction: ClinicContextValue['reviewRecordLinkRequestAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    const reqItem = linkRequests.find((r) => r.id === params.requestId);
    if (!reqItem) return { ok: false, error: 'Link request not found.' };

    const targetPt = patients.find((p) => p.patientId === params.targetPatientId);
    if (params.approve && !targetPt) {
      return { ok: false, error: 'Valid permanent Patient ID is required to approve linkage.' };
    }
    if (params.approve && targetPt?.portalUserId && targetPt.portalUserId !== reqItem.portalUserId) {
      return { ok: false, error: 'That clinical record is already linked to another portal account.' };
    }

    const nextStatus = params.approve ? 'Approved & Linked' : 'Rejected';

    if (isTestFixture) {
      setLinkRequests((prev) =>
        prev.map((r) =>
          r.id === params.requestId
            ? {
                ...r,
                candidatePatientId: params.targetPatientId,
                status: nextStatus,
                verificationNotes: params.verificationNotes,
                reviewedByUid: firebaseUser.uid,
              }
            : r
        )
      );
      if (params.approve && targetPt) {
        setPatients((prev) =>
          prev.map((p) =>
            p.patientId === targetPt.patientId ? { ...p, portalUserId: reqItem.portalUserId } : p
          )
        );
        setConsultations((prev) =>
          prev.map((c) =>
            c.patientId === targetPt.patientId ? { ...c, portalUserId: reqItem.portalUserId } : c
          )
        );
      }
    } else {
      await updateDoc(doc(db, 'link_requests', params.requestId), {
        candidatePatientId: params.targetPatientId,
        status: nextStatus,
        verificationNotes: params.verificationNotes.slice(0, 600),
        reviewedByUid: firebaseUser.uid,
        updatedAt: serverTimestamp(),
      });

      if (params.approve && targetPt) {
        const { createdAt: _c, updatedAt: _u, ...ptRest } = targetPt;
        await setDoc(
          doc(db, 'patients', targetPt.patientId),
          {
            ...ptRest,
            portalUserId: reqItem.portalUserId,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    await emitNotification({
      recipientUid: reqItem.portalUserId,
      recipientRole: 'patient',
      title: params.approve ? 'Clinical Record Linked' : 'Record Link Request Reviewed',
      safeSummary: params.approve
        ? `Your permanent Patient ID (${params.targetPatientId}) has been verified and linked to your portal.`
        : `Your record linking request could not be verified: ${params.verificationNotes || 'Contact Reception.'}`,
      relatedRecordType: 'link_request',
      relatedRecordId: params.requestId,
      viewPath: '/patient/profile',
      dedupeKey: `lnk-res-${params.requestId}`,
    });

    return { ok: true };
  };

  const updatePatientDemographicsAction: ClinicContextValue['updatePatientDemographicsAction'] = async (params) => {
    if (!firebaseUser || !patientAccount) return { ok: false, error: 'Not signed in.' };

    if (isTestFixture) {
      setPatientAccount((prev) => (prev ? { ...prev, phone: params.phone } : null));
      setPatients((prev) =>
        prev.map((p) =>
          p.portalUserId === firebaseUser.uid
            ? { ...p, phone: params.phone, address: params.address, allergies: params.allergies }
            : p
        )
      );
      return { ok: true };
    }

    await updateDoc(doc(db, 'patient_accounts', firebaseUser.uid), {
      fullName: patientAccount.fullName,
      phone: params.phone.slice(0, 40),
      dateOfBirth: patientAccount.dateOfBirth,
      sex: patientAccount.sex,
      linkedPatientId: patientAccount.linkedPatientId,
      optionalMfaEnabled: patientAccount.optionalMfaEnabled,
      optionalMfaEncryptedSecret: patientAccount.optionalMfaEncryptedSecret || '',
      updatedAt: serverTimestamp(),
    });

    const linkedRec = patients.find((p) => p.portalUserId === firebaseUser.uid);
    if (linkedRec) {
      await updateDoc(doc(db, 'patients', linkedRec.patientId), {
        phone: params.phone.slice(0, 40),
        address: params.address.slice(0, 300),
        allergies: params.allergies.slice(0, 500),
        updatedAt: serverTimestamp(),
      });
    }
    return { ok: true };
  };

  const updatePatientOptionalMfaAction: ClinicContextValue['updatePatientOptionalMfaAction'] = async (params) => {
    if (!firebaseUser || !patientAccount) return;
    if (isTestFixture) {
      setPatientAccount((prev) =>
        prev
          ? {
              ...prev,
              optionalMfaEnabled: params.enabled,
              optionalMfaEncryptedSecret: params.encryptedSecret,
            }
          : null
      );
      return;
    }
    await updateDoc(doc(db, 'patient_accounts', firebaseUser.uid), {
      fullName: patientAccount.fullName,
      phone: patientAccount.phone,
      dateOfBirth: patientAccount.dateOfBirth,
      sex: patientAccount.sex,
      linkedPatientId: patientAccount.linkedPatientId,
      optionalMfaEnabled: params.enabled,
      optionalMfaEncryptedSecret: params.encryptedSecret,
      updatedAt: serverTimestamp(),
    });
  };

  // ---------------------------------------------------------------------------
  // Receptionist QR Check-in & Walk-in Registration + Unified Queue
  // ---------------------------------------------------------------------------
  const checkInAppointmentByQrOrRefAction: ClinicContextValue['checkInAppointmentByQrOrRefAction'] = async (params) => {
    const raw = params.qrTokenOrRef.trim();
    if (!raw) return { ok: false, error: 'Scan a QR code or enter a Reference Number.' };
    if (!params.verifiedIdentityConfirmed) {
      return { ok: false, error: 'Please confirm patient identity verification before completing check-in.' };
    }

    let matchedAppt: Appointment | undefined;

    if (raw.startsWith('SC1.')) {
      try {
        const resp = await fetch('/api/qr/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: mfaAssuranceToken ? `Bearer ${mfaAssuranceToken}` : '',
            'X-Staff-Uid': firebaseUser?.uid || '',
            ...(isTestFixture ? { 'X-Test-Fixture': '1' } : {}),
          },
          body: JSON.stringify({ qrToken: raw }),
        });
        const vJson = await resp.json();
        if (!resp.ok || !vJson.valid) {
          return { ok: false, error: vJson.error || 'Invalid or forged QR token.' };
        }
        matchedAppt = appointments.find((a) => a.id === vJson.appointmentId);
      } catch {
        matchedAppt = appointments.find((a) => a.qrToken === raw);
      }
    } else {
      matchedAppt = appointments.find(
        (a) => a.referenceNumber.toUpperCase() === raw.toUpperCase() || a.qrToken === raw
      );
    }

    if (!matchedAppt) {
      return { ok: false, error: 'No matching appointment record found for this QR code or reference.' };
    }
    if (matchedAppt.qrStatus !== 'Active' || matchedAppt.status !== 'Confirmed') {
      return {
        ok: false,
        error: `Check-in rejected: Appointment status is "${matchedAppt.status}" and QR token status is "${matchedAppt.qrStatus}".`,
      };
    }

    const manilaToday = getManilaDateIso();
    if (hasDuplicateActiveVisit(matchedAppt.patientId, manilaToday, visits)) {
      return {
        ok: false,
        error: 'Patient already has an active encounter in today’s clinical queue.',
      };
    }

    const visitId = uidShort('VST');
    const queueSeq = visits.filter((v) => v.visitDate === manilaToday).length + 1;
    const queueNumber = `A-${String(queueSeq).padStart(3, '0')}`;
    const nowIso = new Date().toISOString();
    const viewers = Array.from(
      new Set([
        ...roster.receptionistUids,
        ...roster.nurseUids,
        ...roster.doctorUids,
        ...roster.adminUids,
        matchedAppt.doctorUid,
      ])
    )
      .filter(Boolean)
      .slice(0, 30);

    const newVisit: VisitEncounter = {
      id: visitId,
      visitId,
      queueNumber,
      patientId: matchedAppt.patientId,
      portalUserId: matchedAppt.portalUserId,
      patientName: matchedAppt.patientName,
      appointmentId: matchedAppt.id,
      appointmentType: 'Online',
      serviceName: matchedAppt.serviceName,
      doctorUid: matchedAppt.doctorUid,
      doctorName: matchedAppt.doctorName,
      scheduledTime: matchedAppt.appointmentTime,
      arrivalTime: nowIso,
      visitDate: manilaToday,
      queueStatus: 'Waiting for Nurse',
      clinicalPriority: 'Routine',
      triageReferralNote: '',
      checkedOutAt: '',
      authorizedViewerUids: viewers,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === matchedAppt!.id
            ? { ...a, status: 'Checked In', qrStatus: 'Used', checkedInAt: nowIso, visitId }
            : a
        )
      );
      setVisits((prev) => [...prev, newVisit]);
    } else {
      const { createdAt: _c, updatedAt: _u, ...vRest } = newVisit;
      await setDoc(doc(db, 'visits', visitId), {
        ...vRest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const { createdAt: _ac, updatedAt: _au, changeInitiator: _ci, ...apptFull } = matchedAppt;
      await setDoc(doc(db, 'appointments', matchedAppt.id), {
        ...apptFull,
        status: 'Checked In',
        qrStatus: 'Used',
        checkedInAt: nowIso,
        visitId,
        statusHistory: [
          ...(matchedAppt.statusHistory || []),
          {
            status: 'Checked In',
            changedAt: nowIso,
            changedByRole: staffAccount?.role || 'receptionist',
            reason: 'QR / Front-desk verified check-in',
          },
        ].slice(-25),
        createdIso: matchedAppt.createdAt || nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const nurseUid of roster.nurseUids) {
      await emitNotification({
        recipientUid: nurseUid,
        recipientRole: 'nurse',
        title: `Patient Checked In (${queueNumber})`,
        safeSummary: `${matchedAppt.patientName} checked in for ${matchedAppt.serviceName} with ${matchedAppt.doctorName} and is waiting for Nursing Assessment.`,
        relatedRecordType: 'visit',
        relatedRecordId: visitId,
        viewPath: '/staff/nurse/dashboard',
        dedupeKey: `checkin-nurse-${visitId}-${nurseUid}`,
      });
    }

    return { ok: true, visit: newVisit };
  };

  const registerWalkInVisitAction: ClinicContextValue['registerWalkInVisitAction'] = async (params) => {
    const manilaToday = getManilaDateIso();
    const nowIso = new Date().toISOString();

    let patientId = params.existingPatientId?.trim() || '';
    let portalUserId = '';
    let patientName = params.fullName.trim();

    if (patientId) {
      const existing = patients.find((p) => p.patientId === patientId);
      if (!existing) return { ok: false, error: 'Returning Patient ID not found.' };
      portalUserId = existing.portalUserId;
      patientName = existing.fullName;
    } else {
      if (!patientName || !params.dateOfBirth) {
        return { ok: false, error: 'Full name and Date of Birth are required for first-time walk-in registration.' };
      }
      patientId = uidShort('PT-2026');
      const newPt: ClinicalPatientRecord = {
        patientId,
        portalUserId: '',
        fullName: patientName,
        dateOfBirth: params.dateOfBirth,
        sex: params.sex,
        phone: params.phone.trim(),
        email: '',
        address: params.address.trim(),
        allergies: params.allergies.trim() || 'None reported',
        chronicConditions: params.chronicConditions.trim() || 'None reported',
        registrationSource: 'Walk-in Front Desk',
        authorizedViewerUids: roster.allStaffUids.slice(0, 30),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      if (isTestFixture) {
        setPatients((prev) => [...prev, newPt]);
      } else {
        const { createdAt: _c, updatedAt: _u, ...ptRest } = newPt;
        await setDoc(doc(db, 'patients', patientId), {
          ...ptRest,
          createdIso: nowIso,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (hasDuplicateActiveVisit(patientId, manilaToday, visits)) {
      return { ok: false, error: 'This patient already has an active visit in today’s queue.' };
    }

    const docSched = doctorSchedules.find((d) => d.doctorUid === params.doctorUid) || doctorSchedules[0];
    if (!docSched) {
      return { ok: false, error: 'Please configure at least one active Doctor before assigning walk-in visits.' };
    }

    const visitId = uidShort('VST');
    const queueSeq = visits.filter((v) => v.visitDate === manilaToday).length + 1;
    const queueNumber = `W-${String(queueSeq).padStart(3, '0')}`;
    const viewers = Array.from(
      new Set([...roster.receptionistUids, ...roster.nurseUids, ...roster.doctorUids, ...roster.adminUids, docSched.doctorUid])
    )
      .filter(Boolean)
      .slice(0, 30);

    const newVisit: VisitEncounter = {
      id: visitId,
      visitId,
      queueNumber,
      patientId,
      portalUserId,
      patientName,
      appointmentId: '',
      appointmentType: 'Walk-in',
      serviceName: params.serviceName || 'General Consultation',
      doctorUid: docSched.doctorUid,
      doctorName: docSched.doctorName,
      scheduledTime: '',
      arrivalTime: nowIso,
      visitDate: manilaToday,
      queueStatus: 'Waiting for Nurse',
      clinicalPriority: params.clinicalPriority,
      triageReferralNote: '',
      checkedOutAt: '',
      authorizedViewerUids: viewers,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setVisits((prev) => [...prev, newVisit]);
    } else {
      const { createdAt: _c, updatedAt: _u, ...vRest } = newVisit;
      await setDoc(doc(db, 'visits', visitId), {
        ...vRest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const nurseUid of roster.nurseUids) {
      await emitNotification({
        recipientUid: nurseUid,
        recipientRole: 'nurse',
        title: `Walk-in Registered (${queueNumber})`,
        safeSummary: `${patientName} (${patientId}) entered the Nurse Queue for ${docSched.doctorName}.`,
        relatedRecordType: 'visit',
        relatedRecordId: visitId,
        viewPath: '/staff/nurse/dashboard',
        dedupeKey: `walkin-nurse-${visitId}-${nurseUid}`,
      });
    }

    return { ok: true, visit: newVisit };
  };

  const updateVisitQueueStatusAction: ClinicContextValue['updateVisitQueueStatusAction'] = async (
    visitId,
    nextStatus,
    priority,
    triageNote
  ) => {
    const visit = visits.find((v) => v.visitId === visitId || v.id === visitId);
    if (!visit) return { ok: false, error: 'Visit encounter not found.' };
    const nowIso = new Date().toISOString();
    const checkedOutAt = nextStatus === 'Checked Out' ? nowIso : visit.checkedOutAt;

    if (isTestFixture) {
      setVisits((prev) =>
        prev.map((v) =>
          v.visitId === visitId
            ? {
                ...v,
                queueStatus: nextStatus,
                clinicalPriority: priority || v.clinicalPriority,
                triageReferralNote: triageNote ?? v.triageReferralNote,
                checkedOutAt,
              }
            : v
        )
      );
      if (nextStatus === 'Checked Out' && visit.appointmentId) {
        setAppointments((prev) =>
          prev.map((a) => (a.id === visit.appointmentId ? { ...a, status: 'Completed' } : a))
        );
      }
      return { ok: true };
    }

    await updateDoc(doc(db, 'visits', visit.id), {
      queueStatus: nextStatus,
      clinicalPriority: priority || visit.clinicalPriority,
      triageReferralNote: (triageNote ?? visit.triageReferralNote).slice(0, 500),
      doctorUid: visit.doctorUid,
      doctorName: visit.doctorName,
      checkedOutAt,
      authorizedViewerUids: visit.authorizedViewerUids,
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Nurse Vital Signs & Initial Assessment -> Ready for Doctor Handoff
  // ---------------------------------------------------------------------------
  const saveNursingAssessmentAction: ClinicContextValue['saveNursingAssessmentAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    const visit = visits.find((v) => v.visitId === params.visitId);
    if (!visit) return { ok: false, error: 'Visit not found.' };

    const nowIso = new Date().toISOString();
    const stdComplaint = categorizeChiefComplaint(params.chiefComplaint);
    // Confidential clinical viewers: Strictly Nurses + Doctors (NEVER Admin or Receptionist)
    const clinicalViewers = Array.from(
      new Set([...roster.nurseUids, ...roster.doctorUids, firebaseUser.uid, visit.doctorUid])
    )
      .filter(Boolean)
      .slice(0, 30);

    const record: NursingAssessment = {
      id: visit.visitId,
      visitId: visit.visitId,
      patientId: visit.patientId,
      portalUserId: visit.portalUserId,
      bloodPressure: params.bloodPressure.trim(),
      bodyTemperatureC: params.bodyTemperatureC.trim(),
      pulseRateBpm: params.pulseRateBpm.trim(),
      respiratoryRateCpm: params.respiratoryRateCpm.trim(),
      oxygenSaturationPct: params.oxygenSaturationPct.trim(),
      weightKg: params.weightKg.trim(),
      heightCm: params.heightCm.trim(),
      chiefComplaint: params.chiefComplaint.trim(),
      standardizedComplaint: stdComplaint,
      additionalSymptoms: params.additionalSymptoms.trim(),
      symptomOnset: params.symptomOnset.trim(),
      nursingObservations: params.nursingObservations.trim(),
      clinicalPriority: params.clinicalPriority,
      nurseUid: firebaseUser.uid,
      nurseName: staffAccount.fullName,
      completedAt: nowIso,
      authorizedViewerUids: clinicalViewers,
    };

    const existing = nursingAssessments.find((n) => n.visitId === visit.visitId);

    if (isTestFixture) {
      setNursingAssessments((prev) => [
        ...prev.filter((n) => n.visitId !== visit.visitId),
        record,
      ]);
    } else if (existing) {
      await updateDoc(doc(db, 'nursing_assessments', visit.visitId), {
        bloodPressure: record.bloodPressure,
        bodyTemperatureC: record.bodyTemperatureC,
        pulseRateBpm: record.pulseRateBpm,
        respiratoryRateCpm: record.respiratoryRateCpm,
        oxygenSaturationPct: record.oxygenSaturationPct,
        weightKg: record.weightKg,
        heightCm: record.heightCm,
        chiefComplaint: record.chiefComplaint,
        standardizedComplaint: record.standardizedComplaint,
        additionalSymptoms: record.additionalSymptoms,
        symptomOnset: record.symptomOnset,
        nursingObservations: record.nursingObservations,
        clinicalPriority: record.clinicalPriority,
        completedAt: nowIso,
        authorizedViewerUids: clinicalViewers,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'nursing_assessments', visit.visitId), {
        ...record,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const nextQ: QueueStatus = params.markReadyForDoctor ? 'Ready for Doctor' : 'In Assessment';
    await updateVisitQueueStatusAction(visit.visitId, nextQ, params.clinicalPriority);

    if (params.markReadyForDoctor && visit.doctorUid) {
      await emitNotification({
        recipientUid: visit.doctorUid,
        recipientRole: 'doctor',
        title: `Ready for Consultation (${visit.queueNumber})`,
        safeSummary: `Nursing assessment completed for ${visit.patientName}. Vitals & intake ready for review.`,
        relatedRecordType: 'visit',
        relatedRecordId: visit.visitId,
        viewPath: '/staff/doctor/dashboard',
        dedupeKey: `handoff-doc-${visit.visitId}`,
      });
    }

    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Doctor Consultation, Amendments, Lab Orders, Prescriptions & Follow-ups
  // ---------------------------------------------------------------------------
  const saveConsultationAction: ClinicContextValue['saveConsultationAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    const visit = visits.find((v) => v.visitId === params.visitId);
    if (!visit) return { ok: false, error: 'Visit not found.' };

    const nowIso = new Date().toISOString();
    const stdComplaint = categorizeChiefComplaint(params.chiefComplaint);
    const clinicalViewers = Array.from(
      new Set([...roster.doctorUids, ...roster.nurseUids, firebaseUser.uid])
    )
      .filter(Boolean)
      .slice(0, 30);

    const existing = consultations.find((c) => c.visitId === visit.visitId);
    const isAlreadyFinalized = existing?.status === 'Finalized';

    if (isAlreadyFinalized) {
      if (!params.amendmentReason?.trim()) {
        return {
          ok: false,
          error: 'Finalized consultations cannot be silently edited. Provide an authorized Amendment Reason.',
        };
      }
      const newAmendment: ConsultationAmendment = {
        amendedAt: nowIso,
        amendedByUid: firebaseUser.uid,
        amendedByName: staffAccount.fullName,
        reason: params.amendmentReason.trim(),
        previousDiagnosis: existing.diagnosis,
        newDiagnosis: params.diagnosis.trim(),
        summaryOfChanges: `Updated diagnosis/plan (${params.amendmentReason.trim()})`,
      };
      const nextAmendments = [...(existing.amendments || []), newAmendment].slice(-20);

      if (isTestFixture) {
        setConsultations((prev) =>
          prev.map((c) =>
            c.visitId === visit.visitId
              ? {
                  ...c,
                  diagnosis: params.diagnosis.trim(),
                  diagnosisType: params.diagnosisType,
                  treatmentPlan: params.treatmentPlan.trim(),
                  patientInstructions: params.patientInstructions.trim(),
                  amendments: nextAmendments,
                  updatedAt: nowIso,
                }
              : c
          )
        );
      } else {
        await updateDoc(doc(db, 'consultations', visit.visitId), {
          diagnosis: params.diagnosis.trim().slice(0, 600),
          diagnosisType: params.diagnosisType,
          treatmentPlan: params.treatmentPlan.trim().slice(0, 2000),
          patientInstructions: params.patientInstructions.trim().slice(0, 1500),
          amendments: nextAmendments,
          updatedAt: serverTimestamp(),
        });
      }

      await recordAudit({
        action: 'CONSULTATION_AMENDED',
        category: 'Clinical',
        targetType: 'consultation',
        targetId: visit.visitId,
        summary: `Authorized amendment recorded on finalized consultation ${visit.visitId}: ${params.amendmentReason.trim()}`,
      });
      return { ok: true };
    }

    const nextStatus = params.finalize ? 'Finalized' : 'Draft';
    const record: ConsultationRecord = {
      id: visit.visitId,
      visitId: visit.visitId,
      patientId: visit.patientId,
      portalUserId: visit.portalUserId,
      patientName: visit.patientName,
      visitDate: visit.visitDate,
      appointmentType: visit.appointmentType,
      doctorUid: firebaseUser.uid,
      doctorName: staffAccount.fullName,
      doctorTitle: staffAccount.titleDisplay || 'Attending Physician',
      chiefComplaint: params.chiefComplaint.trim().slice(0, 500),
      standardizedComplaint: stdComplaint,
      clinicalFindings: params.clinicalFindings.trim().slice(0, 2500),
      diagnosis: params.diagnosis.trim().slice(0, 600),
      diagnosisType: params.diagnosisType,
      treatmentPlan: params.treatmentPlan.trim().slice(0, 2000),
      patientInstructions: params.patientInstructions.trim().slice(0, 1500),
      status: nextStatus,
      finalizedAt: params.finalize ? nowIso : '',
      amendments: [],
      patientVisible: params.finalize,
      authorizedViewerUids: clinicalViewers,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setConsultations((prev) => [...prev.filter((c) => c.visitId !== visit.visitId), record]);
      if (params.finalize) {
        setOperationalAnalyticsEvents((prev) => [
          ...prev.filter((e) => e.visitId !== visit.visitId),
          {
            id: visit.visitId,
            visitId: visit.visitId,
            patientId: visit.patientId,
            consultationDate: visit.visitDate,
            appointmentType: visit.appointmentType,
            standardizedComplaint: stdComplaint,
          },
        ]);
      }
    } else if (existing) {
      await updateDoc(doc(db, 'consultations', visit.visitId), {
        chiefComplaint: record.chiefComplaint,
        standardizedComplaint: record.standardizedComplaint,
        clinicalFindings: record.clinicalFindings,
        diagnosis: record.diagnosis,
        diagnosisType: record.diagnosisType,
        treatmentPlan: record.treatmentPlan,
        patientInstructions: record.patientInstructions,
        status: record.status,
        finalizedAt: record.finalizedAt,
        patientVisible: record.patientVisible,
        authorizedViewerUids: clinicalViewers,
        updatedAt: serverTimestamp(),
      });
      if (params.finalize) {
        await setDoc(doc(db, 'operational_analytics_events', visit.visitId), {
          id: visit.visitId,
          visitId: visit.visitId,
          patientId: visit.patientId,
          consultationDate: visit.visitDate,
          appointmentType: visit.appointmentType,
          standardizedComplaint: stdComplaint,
          authorizedViewerUids: roster.adminUids.slice(0, 30),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    } else {
      const { createdAt: _c, updatedAt: _u, ...cRest } = record;
      await setDoc(doc(db, 'consultations', visit.visitId), {
        ...cRest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (params.finalize) {
        await setDoc(doc(db, 'operational_analytics_events', visit.visitId), {
          id: visit.visitId,
          visitId: visit.visitId,
          patientId: visit.patientId,
          consultationDate: visit.visitDate,
          appointmentType: visit.appointmentType,
          standardizedComplaint: stdComplaint,
          authorizedViewerUids: roster.adminUids.slice(0, 30),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }

    if (params.finalize) {
      await updateVisitQueueStatusAction(visit.visitId, 'Consultation Completed');
      await syncOrUpdateBillingAction({ visitId: visit.visitId });

      if (visit.portalUserId) {
        await emitNotification({
          recipientUid: visit.portalUserId,
          recipientRole: 'patient',
          title: 'Consultation Summary Available',
          safeSummary: `Your Consultation Summary with ${staffAccount.fullName} (${visit.visitDate}) has been finalized and is ready to view or download.`,
          relatedRecordType: 'consultation',
          relatedRecordId: visit.visitId,
          viewPath: '/patient/medical-records',
          dedupeKey: `cons-rel-${visit.visitId}`,
        });
      }
    } else if (visit.queueStatus === 'Ready for Doctor') {
      await updateVisitQueueStatusAction(visit.visitId, 'In Consultation');
    }

    return { ok: true };
  };

  const createLabOrderAction: ClinicContextValue['createLabOrderAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    const visit = visits.find((v) => v.visitId === params.visitId);
    const srv = services.find((s) => s.id === params.testServiceId);
    if (!visit || !srv) return { ok: false, error: 'Invalid visit or diagnostic test.' };

    const id = uidShort('LAB');
    const nowIso = new Date().toISOString();
    const viewers = Array.from(
      new Set([...roster.labUids, ...roster.doctorUids, ...roster.nurseUids, ...roster.receptionistUids, firebaseUser.uid])
    ).slice(0, 30);

    const order: LaboratoryOrder = {
      id,
      orderNumber: id,
      visitId: visit.visitId,
      patientId: visit.patientId,
      portalUserId: visit.portalUserId,
      patientName: visit.patientName,
      orderedByDoctorUid: firebaseUser.uid,
      orderedByDoctorName: staffAccount.fullName,
      testCode: srv.code,
      testName: srv.name,
      clinicalIndication: params.clinicalIndication.trim().slice(0, 500),
      priority: params.priority,
      status: 'Requested',
      sampleId: '',
      sampleCollectedAt: '',
      sampleCollectedBy: '',
      processedAt: '',
      resultItems: [],
      technicianRemarks: '',
      enteredByUid: '',
      enteredByName: '',
      verifiedByUid: '',
      verifiedByName: '',
      verifiedAt: '',
      releasedAt: '',
      feePhp: srv.baseFeePhp,
      patientVisible: false, // Strictly hidden from patient until Released!
      authorizedViewerUids: viewers,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setLabOrders((prev) => [order, ...prev]);
    } else {
      const { createdAt: _c, updatedAt: _u, ...lRest } = order;
      await setDoc(doc(db, 'lab_orders', id), {
        ...lRest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const labUid of roster.labUids) {
      await emitNotification({
        recipientUid: labUid,
        recipientRole: 'laboratory',
        title: `New Lab Request (${srv.code})`,
        safeSummary: `${staffAccount.fullName} ordered ${srv.name} (${params.priority}) for ${visit.patientName}.`,
        relatedRecordType: 'lab_order',
        relatedRecordId: id,
        viewPath: '/staff/laboratory/dashboard',
        dedupeKey: `lab-req-${id}-${labUid}`,
      });
    }

    return { ok: true };
  };

  const createPrescriptionAction: ClinicContextValue['createPrescriptionAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    const visit = visits.find((v) => v.visitId === params.visitId);
    if (!visit || params.items.length === 0) {
      return { ok: false, error: 'Add at least one medication item.' };
    }

    const id = uidShort('RX');
    const nowIso = new Date().toISOString();
    const viewers = Array.from(
      new Set([...roster.pharmacistUids, ...roster.doctorUids, ...roster.nurseUids, ...roster.receptionistUids, firebaseUser.uid])
    ).slice(0, 30);

    const rx: PrescriptionRecord = {
      id,
      prescriptionNumber: id,
      visitId: visit.visitId,
      patientId: visit.patientId,
      portalUserId: visit.portalUserId,
      patientName: visit.patientName,
      doctorUid: firebaseUser.uid,
      doctorName: staffAccount.fullName,
      doctorTitle: staffAccount.titleDisplay || 'Attending Physician',
      items: params.items.map((it) => ({ ...it, quantityDispensed: 0 })),
      notes: params.notes.trim().slice(0, 1000),
      status: 'Received',
      clarificationQuestion: '',
      clarificationResponse: '',
      reviewedByPharmacistUid: '',
      reviewedByPharmacistName: '',
      dispensedAt: '',
      patientVisible: true,
      authorizedViewerUids: viewers,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setPrescriptions((prev) => [rx, ...prev]);
    } else {
      const { createdAt: _c, updatedAt: _u, ...rRest } = rx;
      await setDoc(doc(db, 'prescriptions', id), {
        ...rRest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const pharmUid of roster.pharmacistUids) {
      await emitNotification({
        recipientUid: pharmUid,
        recipientRole: 'pharmacist',
        title: `New Signed Prescription (${id})`,
        safeSummary: `${staffAccount.fullName} finalized prescription ${id} for ${visit.patientName}.`,
        relatedRecordType: 'prescription',
        relatedRecordId: id,
        viewPath: '/staff/pharmacy/dashboard',
        dedupeKey: `rx-new-${id}-${pharmUid}`,
      });
    }

    if (visit.portalUserId) {
      await emitNotification({
        recipientUid: visit.portalUserId,
        recipientRole: 'patient',
        title: 'Prescription Finalized',
        safeSummary: `Prescription ${id} from ${staffAccount.fullName} is now available in your portal.`,
        relatedRecordType: 'prescription',
        relatedRecordId: id,
        viewPath: '/patient/prescriptions',
        dedupeKey: `rx-pat-${id}`,
      });
    }

    return { ok: true };
  };

  const respondPrescriptionClarificationAction: ClinicContextValue['respondPrescriptionClarificationAction'] = async (params) => {
    const rx = prescriptions.find((r) => r.id === params.prescriptionId);
    if (!rx) return { ok: false, error: 'Prescription not found.' };

    if (isTestFixture) {
      setPrescriptions((prev) =>
        prev.map((r) =>
          r.id === rx.id
            ? {
                ...r,
                items: params.updatedItems,
                notes: params.updatedNotes,
                clarificationResponse: params.clarificationResponse,
                status: 'Ready for Dispensing',
              }
            : r
        )
      );
    } else {
      await updateDoc(doc(db, 'prescriptions', rx.id), {
        items: params.updatedItems,
        notes: params.updatedNotes.slice(0, 1000),
        status: 'Ready for Dispensing',
        clarificationResponse: params.clarificationResponse.slice(0, 600),
        patientVisible: true,
        updatedAt: serverTimestamp(),
      });
    }

    for (const pharmUid of roster.pharmacistUids) {
      await emitNotification({
        recipientUid: pharmUid,
        recipientRole: 'pharmacist',
        title: `Clarification Answered (${rx.prescriptionNumber})`,
        safeSummary: `${rx.doctorName} responded to clarification on ${rx.prescriptionNumber}.`,
        relatedRecordType: 'prescription',
        relatedRecordId: rx.id,
        viewPath: '/staff/pharmacy/dashboard',
        dedupeKey: `rx-ans-${rx.id}-${Date.now()}`,
      });
    }

    return { ok: true };
  };

  const createFollowUpRecommendationAction: ClinicContextValue['createFollowUpRecommendationAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    const visit = visits.find((v) => v.visitId === params.visitId);
    if (!visit) return { ok: false, error: 'Visit not found.' };

    const id = uidShort('FUP');
    const nowIso = new Date().toISOString();
    const viewers = Array.from(
      new Set([...roster.doctorUids, ...roster.receptionistUids, ...roster.nurseUids, firebaseUser.uid])
    ).slice(0, 30);

    const rec: FollowUpRecommendation = {
      id,
      visitId: visit.visitId,
      patientId: visit.patientId,
      portalUserId: visit.portalUserId,
      patientName: visit.patientName,
      doctorUid: firebaseUser.uid,
      doctorName: staffAccount.fullName,
      recommendedDate: params.recommendedDate,
      intervalLabel: params.intervalLabel.trim(),
      instructions: params.instructions.trim().slice(0, 1000),
      reason: params.reason.trim().slice(0, 500),
      status: 'Recommended',
      bookedAppointmentId: '',
      authorizedViewerUids: viewers,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setFollowUps((prev) => [rec, ...prev]);
    } else {
      const { createdAt: _c, updatedAt: _u, ...fRest } = rec;
      await setDoc(doc(db, 'follow_ups', id), {
        ...fRest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (visit.portalUserId) {
      await emitNotification({
        recipientUid: visit.portalUserId,
        recipientRole: 'patient',
        title: 'New Follow-up Care Recommendation',
        safeSummary: `${staffAccount.fullName} recommended a follow-up visit around ${params.recommendedDate} (${params.intervalLabel}). Please select an available slot to confirm.`,
        relatedRecordType: 'follow_up',
        relatedRecordId: id,
        viewPath: '/patient/follow-up',
        dedupeKey: `fup-${id}`,
      });
    }

    return { ok: true };
  };

  const submitDoctorLeaveRequestAction: ClinicContextValue['submitDoctorLeaveRequestAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    if (!params.startDate || !params.endDate || params.endDate < params.startDate) {
      return { ok: false, error: 'Provide a valid leave start and end date.' };
    }

    const id = uidShort('LVE');
    const nowIso = new Date().toISOString();
    const viewers = Array.from(new Set([...roster.adminUids, firebaseUser.uid])).slice(0, 30);

    const leave: LeaveRequest = {
      id,
      doctorUid: firebaseUser.uid,
      doctorName: staffAccount.fullName,
      startDate: params.startDate,
      endDate: params.endDate,
      reason: params.reason.trim().slice(0, 600),
      status: 'Pending',
      reviewedByUid: '',
      reviewNotes: '',
      affectedAppointmentIds: [],
      authorizedViewerUids: viewers,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setLeaveRequests((prev) => [leave, ...prev]);
    } else {
      const { createdAt: _c, updatedAt: _u, ...lvRest } = leave;
      await setDoc(doc(db, 'leave_requests', id), {
        ...lvRest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const admUid of roster.adminUids) {
      await emitNotification({
        recipientUid: admUid,
        recipientRole: 'admin',
        title: 'Doctor Leave Request Pending Review',
        safeSummary: `${staffAccount.fullName} submitted a leave request (${params.startDate} to ${params.endDate}).`,
        relatedRecordType: 'leave_request',
        relatedRecordId: id,
        viewPath: '/staff/admin/dashboard',
        dedupeKey: `lve-req-${id}-${admUid}`,
      });
    }

    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Laboratory Order Workflow
  // ---------------------------------------------------------------------------
  const advanceLabOrderAction: ClinicContextValue['advanceLabOrderAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    const order = labOrders.find((o) => o.id === params.orderId);
    if (!order) return { ok: false, error: 'Lab order not found.' };

    const nowIso = new Date().toISOString();
    const sampleId =
      params.sampleId?.trim() ||
      order.sampleId ||
      (params.nextStatus === 'Sample Collected' ? uidShort('SPEC') : '');

    const resultItems = params.resultItems ?? order.resultItems;
    if (
      (params.nextStatus === 'For Verification' ||
        params.nextStatus === 'Verified' ||
        params.nextStatus === 'Released') &&
      resultItems.length === 0
    ) {
      return { ok: false, error: 'Enter structured test parameters before verification or release.' };
    }

    const updated: LaboratoryOrder = {
      ...order,
      status: params.nextStatus,
      sampleId,
      sampleCollectedAt:
        params.nextStatus === 'Sample Collected' ? nowIso : order.sampleCollectedAt,
      sampleCollectedBy:
        params.nextStatus === 'Sample Collected' ? staffAccount.fullName : order.sampleCollectedBy,
      processedAt: params.nextStatus === 'Processing' ? nowIso : order.processedAt,
      resultItems,
      technicianRemarks: params.technicianRemarks ?? order.technicianRemarks,
      enteredByUid:
        params.nextStatus === 'For Verification' ? firebaseUser.uid : order.enteredByUid,
      enteredByName:
        params.nextStatus === 'For Verification' ? staffAccount.fullName : order.enteredByName,
      verifiedByUid:
        params.nextStatus === 'Verified' || params.nextStatus === 'Released'
          ? order.verifiedByUid || firebaseUser.uid
          : order.verifiedByUid,
      verifiedByName:
        params.nextStatus === 'Verified' || params.nextStatus === 'Released'
          ? order.verifiedByName || staffAccount.fullName
          : order.verifiedByName,
      verifiedAt:
        params.nextStatus === 'Verified' ? nowIso : order.verifiedAt || (params.nextStatus === 'Released' ? nowIso : ''),
      releasedAt: params.nextStatus === 'Released' ? nowIso : order.releasedAt,
      patientVisible: params.nextStatus === 'Released',
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setLabOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    } else {
      await updateDoc(doc(db, 'lab_orders', order.id), {
        status: updated.status,
        sampleId: updated.sampleId,
        sampleCollectedAt: updated.sampleCollectedAt,
        sampleCollectedBy: updated.sampleCollectedBy,
        processedAt: updated.processedAt,
        resultItems: updated.resultItems,
        technicianRemarks: updated.technicianRemarks.slice(0, 1000),
        enteredByUid: updated.enteredByUid,
        enteredByName: updated.enteredByName,
        verifiedByUid: updated.verifiedByUid,
        verifiedByName: updated.verifiedByName,
        verifiedAt: updated.verifiedAt,
        releasedAt: updated.releasedAt,
        patientVisible: updated.patientVisible,
        authorizedViewerUids: updated.authorizedViewerUids,
        updatedAt: serverTimestamp(),
      });
    }

    if (params.nextStatus === 'Released') {
      if (order.orderedByDoctorUid) {
        await emitNotification({
          recipientUid: order.orderedByDoctorUid,
          recipientRole: 'doctor',
          title: `Lab Result Released (${order.orderNumber})`,
          safeSummary: `Verified ${order.testName} results for ${order.patientName} have been released.`,
          relatedRecordType: 'lab_order',
          relatedRecordId: order.id,
          viewPath: '/staff/doctor/dashboard',
          dedupeKey: `lab-rel-doc-${order.id}`,
        });
      }
      if (order.portalUserId) {
        await emitNotification({
          recipientUid: order.portalUserId,
          recipientRole: 'patient',
          title: 'Laboratory Result Released',
          safeSummary: `Your verified ${order.testName} report (${order.orderNumber}) is now available to view and download.`,
          relatedRecordType: 'lab_order',
          relatedRecordId: order.id,
          viewPath: '/patient/laboratory',
          dedupeKey: `lab-rel-pat-${order.id}`,
        });
      }
      await syncOrUpdateBillingAction({ visitId: order.visitId });
    }

    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Pharmacy Dispensing & Inventory Management
  // ---------------------------------------------------------------------------
  const updatePrescriptionPharmacyAction: ClinicContextValue['updatePrescriptionPharmacyAction'] = async (params) => {
    if (!firebaseUser || !staffAccount) return { ok: false, error: 'Unauthorized.' };
    const rx = prescriptions.find((r) => r.id === params.prescriptionId);
    if (!rx) return { ok: false, error: 'Prescription not found.' };

    const nowIso = new Date().toISOString();
    const nextItems = rx.items.map((item) => {
      const disp =
        params.dispensedQuantities && params.dispensedQuantities[item.medicineId] !== undefined
          ? Math.max(0, Math.min(item.quantityPrescribed, params.dispensedQuantities[item.medicineId]))
          : item.quantityDispensed;
      return { ...item, quantityDispensed: disp };
    });

    if (isTestFixture) {
      setPrescriptions((prev) =>
        prev.map((r) =>
          r.id === rx.id
            ? {
                ...r,
                status: params.nextStatus,
                items: nextItems,
                clarificationQuestion: params.clarificationQuestion ?? r.clarificationQuestion,
                reviewedByPharmacistUid: firebaseUser.uid,
                reviewedByPharmacistName: staffAccount.fullName,
                dispensedAt:
                  params.nextStatus === 'Dispensed' || params.nextStatus === 'Partially Dispensed'
                    ? nowIso
                    : r.dispensedAt,
              }
            : r
        )
      );
      if (params.nextStatus === 'Dispensed' || params.nextStatus === 'Partially Dispensed') {
        setInventory((prev) =>
          prev.map((invItem) => {
            const delta =
              (params.dispensedQuantities?.[invItem.id] || 0) -
              (rx.items.find((i) => i.medicineId === invItem.id)?.quantityDispensed || 0);
            return delta > 0
              ? { ...invItem, stockQuantity: Math.max(0, invItem.stockQuantity - delta) }
              : invItem;
          })
        );
      }
    } else {
      await updateDoc(doc(db, 'prescriptions', rx.id), {
        status: params.nextStatus,
        items: nextItems,
        clarificationQuestion: (params.clarificationQuestion ?? rx.clarificationQuestion).slice(0, 600),
        reviewedByPharmacistUid: firebaseUser.uid,
        reviewedByPharmacistName: staffAccount.fullName,
        dispensedAt:
          params.nextStatus === 'Dispensed' || params.nextStatus === 'Partially Dispensed'
            ? nowIso
            : rx.dispensedAt,
        updatedAt: serverTimestamp(),
      });

      if (params.nextStatus === 'Dispensed' || params.nextStatus === 'Partially Dispensed') {
        for (const medItem of nextItems) {
          const prevDisp = rx.items.find((i) => i.medicineId === medItem.medicineId)?.quantityDispensed || 0;
          const newlyDispensed = medItem.quantityDispensed - prevDisp;
          const stockItem = inventory.find((m) => m.id === medItem.medicineId);
          if (newlyDispensed > 0 && stockItem) {
            await updateDoc(doc(db, 'medicine_inventory', stockItem.id), {
              sku: stockItem.sku,
              genericName: stockItem.genericName,
              brandName: stockItem.brandName,
              dosageForm: stockItem.dosageForm,
              strength: stockItem.strength,
              stockQuantity: Math.max(0, stockItem.stockQuantity - newlyDispensed),
              reorderLevel: stockItem.reorderLevel,
              unitPricePhp: stockItem.unitPricePhp,
              batchNumber: stockItem.batchNumber,
              expiryDate: stockItem.expiryDate,
              authorizedViewerUids: Array.from(new Set([...roster.pharmacistUids, ...roster.doctorUids, ...roster.adminUids])).slice(0, 30),
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
        }
      }
    }

    if (params.nextStatus === 'Needs Clarification' && rx.doctorUid) {
      await emitNotification({
        recipientUid: rx.doctorUid,
        recipientRole: 'doctor',
        title: `Prescription Clarification Needed (${rx.prescriptionNumber})`,
        safeSummary: `Pharmacist ${staffAccount.fullName} requested clarification on ${rx.prescriptionNumber}: "${params.clarificationQuestion || ''}"`,
        relatedRecordType: 'prescription',
        relatedRecordId: rx.id,
        viewPath: '/staff/doctor/dashboard',
        dedupeKey: `rx-clar-${rx.id}-${Date.now()}`,
      });
    }

    if (params.nextStatus === 'Dispensed' || params.nextStatus === 'Partially Dispensed') {
      await syncOrUpdateBillingAction({ visitId: rx.visitId });
    }

    return { ok: true };
  };

  const upsertMedicineInventoryAction: ClinicContextValue['upsertMedicineInventoryAction'] = async (params) => {
    const id = params.id || uidShort('MED');
    const viewers = Array.from(
      new Set([...roster.pharmacistUids, ...roster.doctorUids, ...roster.adminUids, firebaseUser?.uid || ''])
    )
      .filter(Boolean)
      .slice(0, 30);

    const item: MedicineInventoryItem = {
      id,
      sku: params.sku.trim(),
      genericName: params.genericName.trim(),
      brandName: params.brandName.trim(),
      dosageForm: params.dosageForm.trim(),
      strength: params.strength.trim(),
      stockQuantity: Number(params.stockQuantity),
      reorderLevel: Number(params.reorderLevel),
      unitPricePhp: Number(params.unitPricePhp),
      batchNumber: params.batchNumber.trim(),
      expiryDate: params.expiryDate,
      updatedAt: new Date().toISOString(),
    };

    const existing = inventory.find((m) => m.id === id);
    if (isTestFixture) {
      setInventory((prev) => [...prev.filter((m) => m.id !== id), item]);
      return { ok: true };
    }

    if (existing) {
      await updateDoc(doc(db, 'medicine_inventory', id), {
        sku: item.sku,
        genericName: item.genericName,
        brandName: item.brandName,
        dosageForm: item.dosageForm,
        strength: item.strength,
        stockQuantity: item.stockQuantity,
        reorderLevel: item.reorderLevel,
        unitPricePhp: item.unitPricePhp,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
        authorizedViewerUids: viewers,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'medicine_inventory', id), {
        id: item.id,
        sku: item.sku,
        genericName: item.genericName,
        brandName: item.brandName,
        dosageForm: item.dosageForm,
        strength: item.strength,
        stockQuantity: item.stockQuantity,
        reorderLevel: item.reorderLevel,
        unitPricePhp: item.unitPricePhp,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
        authorizedViewerUids: viewers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Billing, Manual Coverage Verification & Payments
  // ---------------------------------------------------------------------------
  const syncOrUpdateBillingAction: ClinicContextValue['syncOrUpdateBillingAction'] = async (params) => {
    const visit = visits.find((v) => v.visitId === params.visitId);
    if (!visit) return { ok: false, error: 'Visit not found.' };

    const srv = services.find((s) => s.name === visit.serviceName) || DEFAULT_CLINIC_SERVICES[0];
    const consultCompleted =
      visit.queueStatus === 'Consultation Completed' ||
      visit.queueStatus === 'Checked Out' ||
      consultations.some((c) => c.visitId === visit.visitId && c.status === 'Finalized');

    const lineItems = buildVisitBillingItems({
      consultationCompleted: consultCompleted,
      consultationServiceName: visit.serviceName,
      consultationFeePhp: srv?.baseFeePhp ?? 600,
      visitId: visit.visitId,
      labOrders,
      prescriptions,
    });

    const existing = billings.find((b) => b.visitId === visit.visitId);
    const nowIso = new Date().toISOString();

    const payments: PaymentEntry[] = [...(existing?.payments || [])];
    if (params.newPayment && params.newPayment.amountPhp > 0) {
      payments.push({
        id: uidShort('PAY'),
        receiptNumber: uidShort('RCP'),
        amountPhp: Number(params.newPayment.amountPhp),
        method: params.newPayment.method,
        referenceCode: params.newPayment.referenceCode.trim(),
        recordedByName: staffAccount?.fullName || 'Receptionist',
        recordedAt: nowIso,
        notes: params.newPayment.notes.trim(),
      });
    }

    const approvedCoverage =
      params.approvedCoverageAmountPhp !== undefined
        ? Number(params.approvedCoverageAmountPhp)
        : existing?.approvedCoverageAmountPhp || 0;
    const adjustment =
      params.adjustmentAmountPhp !== undefined
        ? Number(params.adjustmentAmountPhp)
        : existing?.adjustmentAmountPhp || 0;

    const calc = calculateBillingSummary({
      items: lineItems,
      approvedCoverageAmountPhp: approvedCoverage,
      adjustmentAmountPhp: adjustment,
      payments,
    });

    const viewers = Array.from(
      new Set([...roster.receptionistUids, ...roster.adminUids, firebaseUser?.uid || ''])
    )
      .filter(Boolean)
      .slice(0, 30);

    const record: BillingRecord = {
      id: visit.visitId,
      invoiceRef: existing?.invoiceRef || uidShort('BILL'),
      visitId: visit.visitId,
      patientId: visit.patientId,
      portalUserId: visit.portalUserId,
      patientName: visit.patientName,
      visitDate: visit.visitDate,
      items: lineItems,
      totalAmountPhp: calc.totalAmountPhp,
      coverageSource: params.coverageSource ?? existing?.coverageSource ?? 'Self-Pay',
      coverageProviderName:
        params.coverageProviderName ?? existing?.coverageProviderName ?? '',
      coverageMemberNumber:
        params.coverageMemberNumber ?? existing?.coverageMemberNumber ?? '',
      loaOrMdrReference: params.loaOrMdrReference ?? existing?.loaOrMdrReference ?? '',
      coverageVerifiedByName:
        params.coverageSource || params.approvedCoverageAmountPhp !== undefined
          ? staffAccount?.fullName || existing?.coverageVerifiedByName || ''
          : existing?.coverageVerifiedByName || '',
      approvedCoverageAmountPhp: approvedCoverage,
      adjustmentAmountPhp: adjustment,
      amountPaidPhp: calc.amountPaidPhp,
      remainingBalancePhp: calc.remainingBalancePhp,
      paymentStatus: calc.paymentStatus,
      payments: payments.slice(-25),
      authorizedViewerUids: viewers,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    if (isTestFixture) {
      setBillings((prev) => [...prev.filter((b) => b.visitId !== visit.visitId), record]);
    } else if (existing) {
      await updateDoc(doc(db, 'billings', visit.visitId), {
        items: record.items,
        totalAmountPhp: record.totalAmountPhp,
        coverageSource: record.coverageSource,
        coverageProviderName: record.coverageProviderName.slice(0, 120),
        coverageMemberNumber: record.coverageMemberNumber.slice(0, 80),
        loaOrMdrReference: record.loaOrMdrReference.slice(0, 80),
        coverageVerifiedByName: record.coverageVerifiedByName.slice(0, 120),
        approvedCoverageAmountPhp: record.approvedCoverageAmountPhp,
        adjustmentAmountPhp: record.adjustmentAmountPhp,
        amountPaidPhp: record.amountPaidPhp,
        remainingBalancePhp: record.remainingBalancePhp,
        paymentStatus: record.paymentStatus,
        payments: record.payments,
        authorizedViewerUids: viewers,
        updatedAt: serverTimestamp(),
      });
    } else {
      const { createdAt: _c, updatedAt: _u, ...bRest } = record;
      await setDoc(doc(db, 'billings', visit.visitId), {
        ...bRest,
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (params.newPayment && visit.portalUserId) {
      await emitNotification({
        recipientUid: visit.portalUserId,
        recipientRole: 'patient',
        title: 'Payment Acknowledgment Receipt Available',
        safeSummary: `Payment of PHP ${params.newPayment.amountPhp.toFixed(2)} recorded for ${record.invoiceRef}. Remaining balance: PHP ${record.remainingBalancePhp.toFixed(2)}.`,
        relatedRecordType: 'billing',
        relatedRecordId: visit.visitId,
        viewPath: '/patient/billing',
        dedupeKey: `rcp-${visit.visitId}-${payments.length}`,
      });
    }

    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Notifications Read & Popup Dismiss (Never Deletes History)
  // ---------------------------------------------------------------------------
  const markNotificationReadAction = async (notifId: string) => {
    const target = notifications.find((n) => n.id === notifId);
    if (!target) return;
    if (isTestFixture) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, read: true, popupDismissed: true } : n))
      );
      return;
    }
    await updateDoc(doc(db, 'notifications', notifId), {
      read: true,
      popupDismissed: true,
      updatedAt: serverTimestamp(),
    });
  };

  const dismissNotificationPopupAction = async (notifId: string) => {
    const target = notifications.find((n) => n.id === notifId);
    if (!target) return;
    if (isTestFixture) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, popupDismissed: true } : n))
      );
      return;
    }
    await updateDoc(doc(db, 'notifications', notifId), {
      read: target.read,
      popupDismissed: true,
      updatedAt: serverTimestamp(),
    });
  };

  // ---------------------------------------------------------------------------
  // Admin Operational & Predictive Analytics Actions
  // ---------------------------------------------------------------------------
  const inviteStaffMemberAction: ClinicContextValue['inviteStaffMemberAction'] = async (params) => {
    if (!firebaseUser) return { ok: false, error: 'Unauthorized.' };
    const cleanEmail = params.email.trim().toLowerCase();
    if (!cleanEmail || !params.fullName.trim()) {
      return { ok: false, error: 'Staff full name and valid email address are required.' };
    }
    const id = emailToInviteId(cleanEmail);
    const nowIso = new Date().toISOString();

    const inv: StaffInvitation = {
      id,
      email: cleanEmail,
      fullName: params.fullName.trim(),
      role: params.role,
      department: params.department.trim(),
      specialty: params.specialty.trim(),
      titleDisplay: params.titleDisplay.trim(),
      status: 'Pending Enrollment',
      invitedByUid: firebaseUser.uid,
      createdAt: nowIso,
    };

    if (isTestFixture) {
      setStaffInvitations((prev) => [...prev.filter((i) => i.id !== id), inv]);
    } else {
      await setDoc(doc(db, 'staff_invitations', id), {
        id: inv.id,
        email: inv.email,
        fullName: inv.fullName,
        role: inv.role,
        department: inv.department,
        specialty: inv.specialty,
        titleDisplay: inv.titleDisplay,
        status: inv.status,
        invitedByUid: inv.invitedByUid,
        authorizedViewerUids: roster.adminUids.slice(0, 30),
        createdIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await recordAudit({
      action: 'STAFF_INVITATION_CREATED',
      category: 'Administrative',
      targetType: 'staff_invitation',
      targetId: id,
      summary: `Authorized ${cleanEmail} for staff role "${params.role}".`,
    });
    return { ok: true };
  };

  const syncStaffRosterAccessAction: ClinicContextValue['syncStaffRosterAccessAction'] = async () => {
    if (!firebaseUser || staffAccount?.role !== 'admin') {
      return { ok: false, error: 'Only Administrators can synchronize clinic roster permissions.' };
    }
    if (isTestFixture) {
      return { ok: true, syncedCount: patients.length + appointments.length + visits.length };
    }

    try {
      const activeStaff = staffAccounts.filter((s) => s.active);
      const nextRoster: ClinicRosterDoc = {
        bootstrappedAdminUid: roster.bootstrappedAdminUid || firebaseUser.uid,
        adminUids: Array.from(new Set([firebaseUser.uid, ...activeStaff.filter((s) => s.role === 'admin').map((s) => s.uid)])).slice(0, 30),
        doctorUids: activeStaff.filter((s) => s.role === 'doctor').map((s) => s.uid).slice(0, 30),
        nurseUids: activeStaff.filter((s) => s.role === 'nurse').map((s) => s.uid).slice(0, 30),
        receptionistUids: activeStaff.filter((s) => s.role === 'receptionist').map((s) => s.uid).slice(0, 30),
        labUids: activeStaff.filter((s) => s.role === 'laboratory').map((s) => s.uid).slice(0, 30),
        pharmacistUids: activeStaff.filter((s) => s.role === 'pharmacist').map((s) => s.uid).slice(0, 30),
        allStaffUids: Array.from(new Set([firebaseUser.uid, ...activeStaff.map((s) => s.uid)])).slice(0, 30),
      };

      await updateDoc(doc(db, 'clinic_roster', 'current'), {
        adminUids: nextRoster.adminUids,
        doctorUids: nextRoster.doctorUids,
        nurseUids: nextRoster.nurseUids,
        receptionistUids: nextRoster.receptionistUids,
        labUids: nextRoster.labUids,
        pharmacistUids: nextRoster.pharmacistUids,
        allStaffUids: nextRoster.allStaffUids,
        updatedAt: serverTimestamp(),
      });
      setRoster(nextRoster);

      let syncedCount = 0;
      const wb = writeBatch(db);
      const cap = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).slice(0, 30);

      for (const pt of patients.slice(0, 80)) {
        wb.update(doc(db, 'patients', pt.patientId), {
          authorizedViewerUids: cap([...(pt.authorizedViewerUids || []), ...nextRoster.allStaffUids]),
          updatedAt: serverTimestamp(),
        });
        syncedCount++;
      }

      for (const appt of appointments.slice(0, 80)) {
        wb.update(doc(db, 'appointments', appt.id), {
          authorizedViewerUids: cap([...(appt.authorizedViewerUids || []), ...nextRoster.allStaffUids]),
          updatedAt: serverTimestamp(),
        });
        syncedCount++;
      }

      for (const vst of visits.slice(0, 80)) {
        wb.update(doc(db, 'visits', vst.id), {
          authorizedViewerUids: cap([
            ...(vst.authorizedViewerUids || []),
            ...nextRoster.receptionistUids,
            ...nextRoster.nurseUids,
            ...nextRoster.doctorUids,
            ...nextRoster.adminUids,
          ]),
          updatedAt: serverTimestamp(),
        });
        syncedCount++;
      }

      const medViewers = cap([
        ...nextRoster.pharmacistUids,
        ...nextRoster.doctorUids,
        ...nextRoster.adminUids,
      ]);
      for (const med of inventory.slice(0, 50)) {
        wb.update(doc(db, 'medicine_inventory', med.id), {
          authorizedViewerUids: cap([...(med.authorizedViewerUids || []), ...medViewers]),
          updatedAt: serverTimestamp(),
        });
        syncedCount++;
      }

      const billViewers = cap([...nextRoster.receptionistUids, ...nextRoster.adminUids]);
      for (const bl of billings.slice(0, 50)) {
        wb.update(doc(db, 'billings', bl.id), {
          authorizedViewerUids: cap([...(bl.authorizedViewerUids || []), ...billViewers]),
          updatedAt: serverTimestamp(),
        });
        syncedCount++;
      }

      await wb.commit();
      return { ok: true, syncedCount };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Roster access sync failed.' };
    }
  };

  const updateStaffAccountRoleAction: ClinicContextValue['updateStaffAccountRoleAction'] = async (
    params
  ) => {
    const target = staffAccounts.find((s) => s.uid === params.staffUid);
    if (!target) return { ok: false, error: 'Staff member not found.' };
    if (
      target.email.toLowerCase() === DESIGNATED_BOOTSTRAP_ADMIN_EMAIL &&
      (!params.active || params.role !== 'admin')
    ) {
      return {
        ok: false,
        error: 'The primary bootstrapped Clinic Administrator account cannot be deactivated or demoted.',
      };
    }

    const updatedStaff: StaffAccount = {
      ...target,
      role: params.role,
      department: params.department.trim(),
      specialty: params.role === 'doctor' ? params.specialty.trim() : '',
      titleDisplay: params.titleDisplay.trim(),
      active: params.active,
    };

    if (isTestFixture) {
      setStaffAccounts((prev) =>
        prev.map((s) => (s.uid === params.staffUid ? updatedStaff : s))
      );
      return { ok: true };
    }

    const { createdAt: _c, updatedAt: _u, ...rest } = updatedStaff;
    await setDoc(
      doc(db, 'staff_accounts', params.staffUid),
      {
        ...rest,
        authorizedViewerUids: Array.from(new Set([...roster.adminUids, params.staffUid])).slice(0, 30),
        createdIso: target.createdAt || new Date().toISOString(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (params.role === 'admin' && params.active) {
      await setDoc(doc(db, 'admins', params.staffUid), {
        uid: params.staffUid,
        email: target.email.toLowerCase(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (target.role === 'admin' && (params.role !== 'admin' || !params.active)) {
      await deleteDoc(doc(db, 'admins', params.staffUid)).catch(() => {});
    }

    if (params.role === 'doctor' && params.active) {
      const existingDoc = doctorSchedules.find((d) => d.doctorUid === params.staffUid);
      if (!existingDoc) {
        await setDoc(doc(db, 'public_doctors', params.staffUid), {
          id: params.staffUid,
          doctorUid: params.staffUid,
          doctorName: updatedStaff.fullName,
          specialty: updatedStaff.specialty || 'General Medicine',
          workdays: [1, 2, 3, 4, 5],
          startTime: '08:00',
          endTime: '17:00',
          breakStart: '12:00',
          breakEnd: '13:00',
          consultationDurationMinutes: 30,
          slotCapacity: 1,
          qualifiedServiceIds: ['srv-general-consult', 'srv-followup-consult'],
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } else if (target.role === 'doctor' && (params.role !== 'doctor' || !params.active)) {
      const existingDoc = doctorSchedules.find((d) => d.doctorUid === params.staffUid);
      if (existingDoc) {
        await setDoc(
          doc(db, 'public_doctors', params.staffUid),
          { ...existingDoc, id: params.staffUid, active: false, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
    }

    await recordAudit({
      action: 'STAFF_ROLE_OR_STATUS_UPDATED',
      category: 'Administrative',
      targetType: 'staff_account',
      targetId: params.staffUid,
      summary: `Updated ${target.email} role="${params.role}", active=${params.active}.`,
    });

    return { ok: true };
  };

  const toggleStaffActiveStatusAction: ClinicContextValue['toggleStaffActiveStatusAction'] = async (
    staffUid,
    active
  ) => {
    const target = staffAccounts.find((s) => s.uid === staffUid);
    if (!target) return { ok: false, error: 'Staff member not found.' };
    return updateStaffAccountRoleAction({
      staffUid,
      role: target.role,
      department: target.department,
      specialty: target.specialty,
      titleDisplay: target.titleDisplay,
      active,
    });
  };

  const upsertDoctorScheduleAction: ClinicContextValue['upsertDoctorScheduleAction'] = async (schedule) => {
    const existing = doctorSchedules.find((d) => d.doctorUid === schedule.doctorUid);
    const nowIso = new Date().toISOString();

    if (isTestFixture) {
      setDoctorSchedules((prev) => [
        ...prev.filter((d) => d.doctorUid !== schedule.doctorUid),
        { ...schedule, updatedAt: nowIso },
      ]);
      return { ok: true };
    }

    if (existing) {
      await setDoc(
        doc(db, 'public_doctors', schedule.doctorUid),
        {
          ...schedule,
          id: schedule.doctorUid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      await setDoc(doc(db, 'public_doctors', schedule.doctorUid), {
        ...schedule,
        id: schedule.doctorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return { ok: true };
  };

  const reviewLeaveRequestAction: ClinicContextValue['reviewLeaveRequestAction'] = async (params) => {
    if (!firebaseUser) return { ok: false, error: 'Unauthorized.' };
    const lv = leaveRequests.find((l) => l.id === params.leaveId);
    if (!lv) return { ok: false, error: 'Leave request not found.' };

    const affected =
      params.decision === 'Approved'
        ? appointments.filter(
            (a) =>
              a.doctorUid === lv.doctorUid &&
              a.status === 'Confirmed' &&
              a.appointmentDate >= lv.startDate &&
              a.appointmentDate <= lv.endDate
          )
        : [];
    const affectedIds = affected.map((a) => a.id);

    if (isTestFixture) {
      setLeaveRequests((prev) =>
        prev.map((l) =>
          l.id === lv.id
            ? {
                ...l,
                status: params.decision,
                reviewedByUid: firebaseUser.uid,
                reviewNotes: params.reviewNotes,
                affectedAppointmentIds: affectedIds,
              }
            : l
        )
      );
      if (params.decision === 'Approved') {
        setApprovedLeaves((prev) => [...prev, { ...lv, status: 'Approved' }]);
        setAppointments((prev) =>
          prev.map((a) =>
            affectedIds.includes(a.id)
              ? { ...a, status: 'Needs Clinic Reschedule', changeInitiator: 'clinic' }
              : a
          )
        );
      }
    } else {
      await updateDoc(doc(db, 'leave_requests', lv.id), {
        status: params.decision,
        reviewedByUid: firebaseUser.uid,
        reviewNotes: params.reviewNotes.slice(0, 600),
        affectedAppointmentIds: affectedIds.slice(0, 50),
        updatedAt: serverTimestamp(),
      });

      if (params.decision === 'Approved') {
        await setDoc(doc(db, 'approved_leaves', lv.id), {
          id: lv.id,
          doctorUid: lv.doctorUid,
          startDate: lv.startDate,
          endDate: lv.endDate,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        for (const appt of affected) {
          const { createdAt: _c, updatedAt: _u, changeInitiator: _ci, ...aRest } = appt;
          await setDoc(
            doc(db, 'appointments', appt.id),
            {
              ...aRest,
              status: 'Needs Clinic Reschedule',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    }

    for (const appt of affected) {
      if (appt.portalUserId) {
        await emitNotification({
          recipientUid: appt.portalUserId,
          recipientRole: 'patient',
          title: 'Action Needed: Doctor Schedule Update',
          safeSummary: `${appt.doctorName} has an approved leave on ${appt.appointmentDate}. You may select an alternative qualified Doctor on the SAME date or choose another date without penalty.`,
          relatedRecordType: 'appointment',
          relatedRecordId: appt.id,
          viewPath: '/patient/appointments',
          dedupeKey: `leave-aff-${lv.id}-${appt.id}`,
        });
      }
    }

    await emitNotification({
      recipientUid: lv.doctorUid,
      recipientRole: 'doctor',
      title: `Leave Request ${params.decision}`,
      safeSummary: `Your leave request (${lv.startDate} to ${lv.endDate}) was ${params.decision.toLowerCase()}.`,
      relatedRecordType: 'leave_request',
      relatedRecordId: lv.id,
      viewPath: '/staff/doctor/dashboard',
      dedupeKey: `leave-dec-${lv.id}`,
    });

    return { ok: true, affectedCount: affected.length };
  };

  const upsertClinicServiceAction: ClinicContextValue['upsertClinicServiceAction'] = async (service) => {
    const exists = services.some((s) => s.id === service.id);
    if (isTestFixture) {
      setServices((prev) => [...prev.filter((s) => s.id !== service.id), service]);
      return { ok: true };
    }
    if (exists) {
      await updateDoc(doc(db, 'clinic_services', service.id), {
        code: service.code,
        name: service.name,
        category: service.category,
        description: service.description,
        durationMinutes: service.durationMinutes,
        baseFeePhp: service.baseFeePhp,
        directlyBookable: service.directlyBookable,
        active: service.active,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'clinic_services', service.id), {
        ...service,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return { ok: true };
  };

  const upsertPatientGuideAction: ClinicContextValue['upsertPatientGuideAction'] = async (guide) => {
    const updatedGuide: PatientGuideSectionItem = {
      ...guide,
      lastUpdated: getManilaDateIso(),
      updatedByName: staffAccount?.fullName || 'Clinic Administrator',
    };
    const exists = patientGuides.some((g) => g.id === guide.id);
    if (isTestFixture) {
      setPatientGuides((prev) =>
        [...prev.filter((g) => g.id !== guide.id), updatedGuide].sort(
          (a, b) => a.sortOrder - b.sortOrder
        )
      );
      return { ok: true };
    }
    if (exists) {
      await updateDoc(doc(db, 'patient_guides', guide.id), {
        sectionKey: updatedGuide.sectionKey,
        sectionTitle: updatedGuide.sectionTitle,
        topicTitle: updatedGuide.topicTitle,
        summary: updatedGuide.summary,
        bulletPoints: updatedGuide.bulletPoints.slice(0, 20),
        importantNotice: updatedGuide.importantNotice,
        lastUpdated: updatedGuide.lastUpdated,
        updatedByName: updatedGuide.updatedByName,
        published: updatedGuide.published,
        sortOrder: updatedGuide.sortOrder,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'patient_guides', guide.id), {
        ...updatedGuide,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return { ok: true };
  };

  const updateCoverageSettingsAction: ClinicContextValue['updateCoverageSettingsAction'] = async (settings) => {
    const next = { ...settings, updatedAt: getManilaDateIso() };
    setCoverageSettings(next);
    if (isTestFixture) return { ok: true };

    await updateDoc(doc(db, 'coverage_settings', 'current'), {
      hmoProvidersAcceptedForManualVerification: next.hmoProvidersAcceptedForManualVerification.slice(0, 30),
      philHealthAdvisoryNote: next.philHealthAdvisoryNote.slice(0, 1000),
      requireLoaReferenceForHmo: next.requireLoaReferenceForHmo,
      defaultGeneralConsultationFeePhp: next.defaultGeneralConsultationFeePhp,
      defaultFollowUpConsultationFeePhp: next.defaultFollowUpConsultationFeePhp,
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  };

  const importEvaluatorCsvAction: ClinicContextValue['importEvaluatorCsvAction'] = async (params) => {
    if (!firebaseUser || staffAccount?.role !== 'admin') {
      return { ok: false, error: 'Only authorized Administrators can import evaluator CSV datasets.' };
    }

    const resp = await fetch('/api/analytics/import-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: mfaAssuranceToken ? `Bearer ${mfaAssuranceToken}` : '',
        'X-Staff-Uid': firebaseUser.uid,
        ...(isTestFixture ? { 'X-Test-Fixture': '1' } : {}),
      },
      body: JSON.stringify({
        csvContent: params.csvContent,
        fileName: params.fileName,
        importedByUid: firebaseUser.uid,
        importedByName: staffAccount.fullName,
        existingDemoRecords: evaluatorRecords,
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || 'CSV validation failed.', batch: data.batch };
    }

    const importedRecords: EvaluatorConsultationRecord[] = data.records;
    const batchMeta: EvaluatorImportBatch = data.batch;
    const adminViewers = Array.from(new Set([...roster.adminUids, firebaseUser.uid])).slice(0, 30);

    if (isTestFixture) {
      setEvaluatorImports((prev) => [batchMeta, ...prev]);
      setEvaluatorRecords((prev) => [...prev, ...importedRecords]);
    } else {
      // Commit in safe Firestore batches of 400
      const allRecords = importedRecords;
      await setDoc(doc(db, 'evaluator_imports', batchMeta.id), {
        ...batchMeta,
        errorReport: batchMeta.errorReport.slice(0, 30),
        authorizedViewerUids: adminViewers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (let i = 0; i < allRecords.length; i += 350) {
        const chunk = allRecords.slice(i, i + 350);
        const wb = writeBatch(db);
        for (const rec of chunk) {
          wb.set(doc(db, 'evaluator_records', rec.id), {
            ...rec,
            authorizedViewerUids: adminViewers,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await wb.commit();
      }
    }

    await recordAudit({
      action: 'EVALUATOR_CSV_IMPORTED',
      category: 'Analytics',
      targetType: 'evaluator_import',
      targetId: batchMeta.id,
      summary: `Imported ${batchMeta.validCompletedImported} completed evaluator test records from ${params.fileName} into isolated Demonstration dataset.`,
    });

    return { ok: true, batch: batchMeta };
  };

  const clearEvaluatorDatasetAction = async () => {
    if (!firebaseUser || staffAccount?.role !== 'admin') {
      return { ok: false, error: 'Unauthorized.' };
    }
    if (isTestFixture) {
      setEvaluatorImports([]);
      setEvaluatorRecords([]);
      return { ok: true };
    }
    const recSnap = await getDocs(
      query(collection(db, 'evaluator_records'), where('authorizedViewerUids', 'array-contains', firebaseUser.uid))
    );
    for (let i = 0; i < recSnap.docs.length; i += 350) {
      const wb = writeBatch(db);
      for (const d of recSnap.docs.slice(i, i + 350)) {
        wb.delete(d.ref);
      }
      await wb.commit();
    }
    const batchSnap = await getDocs(
      query(collection(db, 'evaluator_imports'), where('authorizedViewerUids', 'array-contains', firebaseUser.uid))
    );
    const wb2 = writeBatch(db);
    batchSnap.docs.forEach((d) => wb2.delete(d.ref));
    await wb2.commit();
    return { ok: true };
  };

  const scopedNotifications = useMemo(
    () => notifications.filter((n) => Boolean(firebaseUser && n.recipientUid === firebaseUser.uid)),
    [notifications, firebaseUser]
  );

  const value: ClinicContextValue = {
    authReady,
    isTestFixture,
    firebaseUser,
    patientAccount,
    staffAccount,
    mfaSessionVerified,
    mfaAssuranceToken,
    mfaExpiresAtMs,
    roster,
    services,
    doctorSchedules,
    patientGuides,
    coverageSettings,
    patients,
    bookedSlots,
    appointments,
    visits,
    nursingAssessments,
    consultations,
    labOrders,
    prescriptions,
    inventory,
    billings,
    followUps,
    linkRequests,
    leaveRequests,
    approvedLeaves,
    notifications: scopedNotifications,
    reminders,
    staffAccounts,
    staffInvitations,
    evaluatorImports,
    evaluatorRecords,
    operationalAnalyticsEvents,
    auditLogs,
    signInWithGoogleAction,
    signInWithEmailAction,
    registerPatientEmailAction,
    completePatientProfileSetup,
    resendEmailVerificationAction,
    refreshEmailVerificationStatus,
    registerInvitedStaffEmailAction,
    bootstrapInitialAdminAction,
    claimStaffInvitationAction,
    completeStaffMfaEnrollment,
    setStaffMfaVerifiedSession,
    logoutAction,
    switchFixturePersona: isTestFixture ? switchFixturePersona : undefined,
    bookAppointmentAction,
    cancelAppointmentAction,
    submitRecordLinkRequestAction,
    reviewRecordLinkRequestAction,
    updatePatientDemographicsAction,
    updatePatientOptionalMfaAction,
    checkInAppointmentByQrOrRefAction,
    registerWalkInVisitAction,
    updateVisitQueueStatusAction,
    saveNursingAssessmentAction,
    saveConsultationAction,
    createLabOrderAction,
    createPrescriptionAction,
    respondPrescriptionClarificationAction,
    createFollowUpRecommendationAction,
    submitDoctorLeaveRequestAction,
    advanceLabOrderAction,
    updatePrescriptionPharmacyAction,
    upsertMedicineInventoryAction,
    syncOrUpdateBillingAction,
    markNotificationReadAction,
    dismissNotificationPopupAction,
    inviteStaffMemberAction,
    toggleStaffActiveStatusAction,
    updateStaffAccountRoleAction,
    syncStaffRosterAccessAction,
    upsertDoctorScheduleAction,
    reviewLeaveRequestAction,
    upsertClinicServiceAction,
    upsertPatientGuideAction,
    updateCoverageSettingsAction,
    importEvaluatorCsvAction,
    clearEvaluatorDatasetAction,
  };

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}
