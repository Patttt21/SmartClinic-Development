import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import {
  DEFAULT_CLINIC_SERVICES,
  DEFAULT_MEDICINE_INVENTORY,
  DEFAULT_PATIENT_GUIDES,
} from '../data/defaultCatalog.ts';
import type {
  ClinicService,
  DoctorSchedule,
  PatientGuideSectionItem,
  StaffAccount,
  StaffRole,
} from '../types/clinic.ts';
import {
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  signMfaAssuranceToken,
  verifyMfaAssuranceToken,
  verifyTotpCode,
} from './totp.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STAFF_ROLES: StaffRole[] = [
  'admin',
  'doctor',
  'nurse',
  'receptionist',
  'laboratory',
  'pharmacist',
];

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

export function constantTimeUuidEqual(a: string, b: string): boolean {
  const cleanA = a.trim().toLowerCase();
  const cleanB = b.trim().toLowerCase();
  if (!isValidUuid(cleanA) || !isValidUuid(cleanB)) return false;
  const bufA = Buffer.from(cleanA, 'utf8');
  const bufB = Buffer.from(cleanB, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface VerifiedSupabaseUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface StoredStaffRecord extends StaffAccount {
  mfaEncryptedSecret: string;
  mfaRecoveryHashes: string[];
}

export interface BootstrapLockState {
  locked: boolean;
  bootstrappedAdminUid: string;
  bootstrappedAt: string;
}

export interface SupabaseStaffRepository {
  verifyAccessToken(accessToken: string): Promise<VerifiedSupabaseUser | null>;
  getBootstrapLock(): Promise<BootstrapLockState>;
  hasAnyAdmin(): Promise<boolean>;
  getStaffByUid(uid: string): Promise<StoredStaffRecord | null>;
  listAllStaff(): Promise<StoredStaffRecord[]>;
  claimInitialAdminBootstrap(params: {
    uid: string;
    email: string;
    fullName: string;
  }): Promise<{ ok: boolean; error?: string; staff?: StoredStaffRecord }>;
  saveStaffMfaSecret(params: {
    uid: string;
    encryptedSecret: string;
    recoveryHashes: string[];
  }): Promise<void>;
  consumeStaffRecoveryHash(params: {
    uid: string;
    remainingHashes: string[];
  }): Promise<void>;
  createStaffUserWithProfile(params: {
    email: string;
    password: string;
    fullName: string;
    role: StaffRole;
    department: string;
    specialty: string;
    titleDisplay: string;
    assignedByUid: string;
  }): Promise<{ ok: boolean; error?: string; staff?: StoredStaffRecord }>;
  updateStaffProfile(params: {
    targetUid: string;
    role: StaffRole;
    department: string;
    specialty: string;
    titleDisplay: string;
    active: boolean;
    resetMfa?: boolean;
  }): Promise<{ ok: boolean; error?: string; staff?: StoredStaffRecord }>;
  recordSecurityAudit(params: {
    actorUid: string | null;
    actorEmail: string;
    actorRole: string;
    category: 'Authentication' | 'Clinical' | 'Administrative' | 'Security' | 'Analytics';
    action: string;
    targetType: string;
    targetId: string;
    summary: string;
  }): Promise<void>;
  getPublicCatalog(): Promise<{
    services: ClinicService[];
    doctorSchedules: DoctorSchedule[];
    patientGuides: PatientGuideSectionItem[];
  }>;
}

export function sanitizeStaffForClient(record: StoredStaffRecord): StaffAccount {
  return {
    uid: record.uid,
    email: record.email,
    fullName: record.fullName,
    role: record.role,
    department: record.department,
    specialty: record.specialty,
    titleDisplay: record.titleDisplay,
    active: record.active,
    mfaEnrolled: record.mfaEnrolled,
    mfaEncryptedSecret: '',
    mfaRecoveryHashes: [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createLiveSupabaseStaffRepository(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseStaffRepository {
  const adminClient: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  async function ensureRolesSeeded() {
    const rows = [
      { code: 'patient', display_name: 'Patient' },
      { code: 'receptionist', display_name: 'Receptionist' },
      { code: 'nurse', display_name: 'Nurse' },
      { code: 'doctor', display_name: 'Doctor' },
      { code: 'laboratory', display_name: 'Laboratory Staff' },
      { code: 'pharmacist', display_name: 'Pharmacist' },
      { code: 'admin', display_name: 'Administrator' },
    ];
    await adminClient.from('roles').upsert(rows, { onConflict: 'code' });
  }

  async function seedDefaultCatalogIfEmpty() {
    const { data: existingSrv } = await adminClient.from('services').select('id').limit(1);
    if (!existingSrv || existingSrv.length === 0) {
      await adminClient.from('services').upsert(
        DEFAULT_CLINIC_SERVICES.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          category: s.category,
          description: s.description,
          duration_minutes: s.durationMinutes,
          base_fee_php: s.baseFeePhp,
          directly_bookable: s.directlyBookable,
          active: s.active,
        })),
        { onConflict: 'id' }
      );
    }

    const { data: existingGuides } = await adminClient
      .from('patient_guide_sections')
      .select('id')
      .limit(1);
    if (!existingGuides || existingGuides.length === 0) {
      await adminClient.from('patient_guide_sections').upsert(
        DEFAULT_PATIENT_GUIDES.map((g) => ({
          id: g.id,
          section_key: g.sectionKey,
          section_title: g.sectionTitle,
          topic_title: g.topicTitle,
          summary: g.summary,
          bullet_points: g.bulletPoints,
          important_notice: g.importantNotice,
          last_updated: g.lastUpdated,
          updated_by_name: g.updatedByName,
          published: g.published,
          sort_order: g.sortOrder,
        })),
        { onConflict: 'id' }
      );
    }

    const { data: existingMeds } = await adminClient.from('medicines').select('id').limit(1);
    if (!existingMeds || existingMeds.length === 0) {
      await adminClient.from('medicines').upsert(
        DEFAULT_MEDICINE_INVENTORY.map((m) => ({
          id: m.id,
          sku: m.sku,
          generic_name: m.genericName,
          brand_name: m.brandName,
          dosage_form: m.dosageForm,
          strength: m.strength,
          unit_price_php: m.unitPricePhp,
        })),
        { onConflict: 'id' }
      );
      await adminClient.from('medicine_inventory').upsert(
        DEFAULT_MEDICINE_INVENTORY.map((m) => ({
          medicine_id: m.id,
          stock_quantity: m.stockQuantity,
          reorder_level: m.reorderLevel,
          batch_number: m.batchNumber,
          expiry_date: m.expiryDate,
        })),
        { onConflict: 'medicine_id' }
      );
    }
  }

  function mapJoinedStaffRow(sp: any, profile?: any, doctorSpecialty?: string): StoredStaffRecord {
    return {
      uid: sp.user_id,
      email: profile?.email || sp.profiles?.email || '',
      fullName: profile?.full_name || sp.profiles?.full_name || '',
      role: sp.role_code as StaffRole,
      department: sp.department || 'Outpatient Operations',
      specialty: sp.specialty || doctorSpecialty || '',
      titleDisplay: sp.title_display || '',
      active: Boolean(sp.active && (profile ? profile.active : sp.profiles?.active ?? true)),
      mfaEnrolled: Boolean(sp.mfa_enrolled),
      mfaEncryptedSecret: sp.mfa_encrypted_secret || '',
      mfaRecoveryHashes: Array.isArray(sp.mfa_recovery_hashes) ? sp.mfa_recovery_hashes : [],
      createdAt: sp.created_at || new Date().toISOString(),
      updatedAt: sp.updated_at || new Date().toISOString(),
    };
  }

  return {
    async verifyAccessToken(accessToken: string) {
      if (!accessToken || typeof accessToken !== 'string') return null;
      const { data, error } = await adminClient.auth.getUser(accessToken);
      if (error || !data?.user || !data.user.email) return null;
      // Strictly use Supabase-verified user.id and email_confirmed_at; ignore user_metadata!
      return {
        id: data.user.id,
        email: data.user.email.trim().toLowerCase(),
        emailVerified: Boolean(data.user.email_confirmed_at),
      };
    },

    async getBootstrapLock() {
      const { data, error } = await adminClient
        .from('system_bootstrap_lock')
        .select('singleton_key, bootstrapped_admin_uid, bootstrapped_at, bootstrap_disabled')
        .eq('singleton_key', 'initial_admin')
        .maybeSingle();

      if (error) {
        if (error.message?.includes('does not exist') || error.code === '42P01') {
          throw new Error(
            'Supabase schema migration 003_admin_bootstrap_and_staff_mgmt.sql has not been applied yet. Please run migrations 001, 002, and 003 in your Supabase SQL Editor.'
          );
        }
        throw new Error('Failed to check system bootstrap lock state.', { cause: error });
      }
      if (!data) {
        return { locked: false, bootstrappedAdminUid: '', bootstrappedAt: '' };
      }
      return {
        locked: true,
        bootstrappedAdminUid: data.bootstrapped_admin_uid,
        bootstrappedAt: data.bootstrapped_at || '',
      };
    },

    async hasAnyAdmin() {
      const { data, error } = await adminClient
        .from('staff_profiles')
        .select('user_id')
        .eq('role_code', 'admin')
        .limit(1);
      if (error) {
        throw new Error('Failed to verify existing Administrator records.', { cause: error });
      }
      return Boolean(data && data.length > 0);
    },

    async getStaffByUid(uid: string) {
      const { data: sp, error } = await adminClient
        .from('staff_profiles')
        .select('*, profiles!inner(email, full_name, active)')
        .eq('user_id', uid)
        .maybeSingle();
      if (error || !sp) return null;

      let docSpec = '';
      if (sp.role_code === 'doctor') {
        const { data: dRow } = await adminClient
          .from('doctors')
          .select('specialty')
          .eq('doctor_uid', uid)
          .maybeSingle();
        docSpec = dRow?.specialty || '';
      }
      return mapJoinedStaffRow(sp, undefined, docSpec);
    },

    async listAllStaff() {
      const { data, error } = await adminClient
        .from('staff_profiles')
        .select('*, profiles!inner(email, full_name, active)')
        .order('created_at', { ascending: true });
      if (error || !data) return [];
      const { data: docRows } = await adminClient.from('doctors').select('doctor_uid, specialty');
      const specMap = new Map<string, string>(
        (docRows || []).map((d: any) => [d.doctor_uid, d.specialty || ''])
      );
      return data.map((sp: any) => mapJoinedStaffRow(sp, undefined, specMap.get(sp.user_id) || ''));
    },

    async claimInitialAdminBootstrap(params) {
      await ensureRolesSeeded();

      const { error: profErr } = await adminClient.from('profiles').upsert(
        {
          id: params.uid,
          email: params.email,
          full_name: params.fullName,
          email_verified: true,
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (profErr) {
        return { ok: false, error: 'Failed to create initial Administrator profile record.' };
      }

      // Atomic singleton insert: fails immediately on duplicate key if raced!
      const { error: lockErr } = await adminClient.from('system_bootstrap_lock').insert({
        singleton_key: 'initial_admin',
        bootstrapped_admin_uid: params.uid,
        bootstrapped_admin_email: params.email,
        bootstrap_disabled: true,
      });
      if (lockErr) {
        return {
          ok: false,
          error:
            'One-time initial Administrator bootstrap has already been completed and is permanently disabled.',
        };
      }

      const { error: roleErr } = await adminClient.from('user_roles').upsert(
        {
          user_id: params.uid,
          role_code: 'admin',
          assigned_by: params.uid,
        },
        { onConflict: 'user_id,role_code' }
      );
      if (roleErr) {
        return { ok: false, error: 'Failed to assign Administrator role in user_roles.' };
      }

      const staffPayload: Record<string, unknown> = {
        user_id: params.uid,
        role_code: 'admin',
        department: 'Clinic Administration',
        title_display: 'System Administrator',
        specialty: '',
        mfa_enrolled: false,
        mfa_encrypted_secret: '',
        mfa_recovery_hashes: [],
        active: true,
        updated_at: new Date().toISOString(),
      };
      const { error: spErr } = await adminClient
        .from('staff_profiles')
        .upsert(staffPayload, { onConflict: 'user_id' });
      if (spErr) {
        return { ok: false, error: 'Failed to initialize Administrator staff_profiles row.' };
      }

      // Also stamp non-user-editable app_metadata on Supabase Auth user for defense-in-depth
      await adminClient.auth.admin
        .updateUserById(params.uid, {
          app_metadata: { staff_role: 'admin', bootstrapped_initial_admin: true },
        })
        .catch(() => {});

      await seedDefaultCatalogIfEmpty().catch(() => {});

      const created = await this.getStaffByUid(params.uid);
      return { ok: true, staff: created || undefined };
    },

    async saveStaffMfaSecret(params) {
      const { error } = await adminClient
        .from('staff_profiles')
        .update({
          mfa_enrolled: true,
          mfa_encrypted_secret: params.encryptedSecret,
          mfa_recovery_hashes: params.recoveryHashes,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', params.uid);
      if (error) {
        throw new Error('Failed to persist Authenticator 2FA enrollment.', { cause: error });
      }
    },

    async consumeStaffRecoveryHash(params) {
      await adminClient
        .from('staff_profiles')
        .update({
          mfa_recovery_hashes: params.remainingHashes,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', params.uid);
    },

    async createStaffUserWithProfile(params) {
      await ensureRolesSeeded();

      const { data: createdAuth, error: createErr } = await adminClient.auth.admin.createUser({
        email: params.email,
        password: params.password,
        email_confirm: true,
        app_metadata: { staff_role: params.role },
      });

      if (createErr || !createdAuth?.user) {
        return {
          ok: false,
          error: createErr?.message || 'Supabase Auth could not create the staff user account.',
        };
      }

      const newUid = createdAuth.user.id;
      const nowIso = new Date().toISOString();

      const { error: pErr } = await adminClient.from('profiles').upsert(
        {
          id: newUid,
          email: params.email,
          full_name: params.fullName,
          email_verified: true,
          active: true,
          updated_at: nowIso,
        },
        { onConflict: 'id' }
      );
      if (pErr) {
        return { ok: false, error: 'Created Auth user, but failed to insert profiles row.' };
      }

      await adminClient.from('user_roles').upsert(
        {
          user_id: newUid,
          role_code: params.role,
          assigned_by: params.assignedByUid,
        },
        { onConflict: 'user_id,role_code' }
      );

      const { error: spErr } = await adminClient.from('staff_profiles').upsert(
        {
          user_id: newUid,
          role_code: params.role,
          department: params.department,
          title_display: params.titleDisplay,
          specialty: params.role === 'doctor' ? params.specialty : '',
          mfa_enrolled: false,
          mfa_encrypted_secret: '',
          mfa_recovery_hashes: [],
          active: true,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' }
      );
      if (spErr) {
        return { ok: false, error: 'Failed to create staff_profiles record in Supabase.' };
      }

      if (params.role === 'doctor') {
        await adminClient.from('doctors').upsert(
          {
            doctor_uid: newUid,
            doctor_name: params.fullName,
            specialty: params.specialty || 'Internal Medicine',
            active: true,
          },
          { onConflict: 'doctor_uid' }
        );
        await adminClient.from('doctor_schedules').upsert(
          {
            doctor_uid: newUid,
            workdays: [1, 2, 3, 4, 5],
            start_time: '08:00',
            end_time: '17:00',
            break_start: '12:00',
            break_end: '13:00',
            consultation_duration_minutes: 30,
            slot_capacity: 1,
            qualified_service_ids: ['srv-general-consult', 'srv-followup-consult'],
            active: true,
            updated_at: nowIso,
          },
          { onConflict: 'doctor_uid' }
        );
      }

      const staff = await this.getStaffByUid(newUid);
      return { ok: true, staff: staff || undefined };
    },

    async updateStaffProfile(params) {
      const nowIso = new Date().toISOString();

      await adminClient
        .from('profiles')
        .update({ active: params.active, updated_at: nowIso })
        .eq('id', params.targetUid);

      const updateFields: Record<string, unknown> = {
        role_code: params.role,
        department: params.department,
        title_display: params.titleDisplay,
        specialty: params.role === 'doctor' ? params.specialty : '',
        active: params.active,
        updated_at: nowIso,
      };
      if (params.resetMfa) {
        updateFields.mfa_enrolled = false;
        updateFields.mfa_encrypted_secret = '';
        updateFields.mfa_recovery_hashes = [];
      }

      const { error } = await adminClient
        .from('staff_profiles')
        .update(updateFields)
        .eq('user_id', params.targetUid);
      if (error) {
        return { ok: false, error: 'Failed to update staff profile in Supabase.' };
      }

      await adminClient.from('user_roles').delete().eq('user_id', params.targetUid);
      await adminClient.from('user_roles').insert({
        user_id: params.targetUid,
        role_code: params.role,
      });

      const currentStaff = await this.getStaffByUid(params.targetUid);
      if (params.role === 'doctor' && currentStaff) {
        await adminClient.from('doctors').upsert(
          {
            doctor_uid: params.targetUid,
            doctor_name: currentStaff.fullName,
            specialty: params.specialty || 'Internal Medicine',
            active: params.active,
          },
          { onConflict: 'doctor_uid' }
        );
        await adminClient.from('doctor_schedules').upsert(
          {
            doctor_uid: params.targetUid,
            workdays: [1, 2, 3, 4, 5],
            start_time: '08:00',
            end_time: '17:00',
            break_start: '12:00',
            break_end: '13:00',
            consultation_duration_minutes: 30,
            slot_capacity: 1,
            qualified_service_ids: ['srv-general-consult', 'srv-followup-consult'],
            active: params.active,
            updated_at: nowIso,
          },
          { onConflict: 'doctor_uid' }
        );
      } else {
        await adminClient
          .from('doctors')
          .update({ active: false })
          .eq('doctor_uid', params.targetUid);
        await adminClient
          .from('doctor_schedules')
          .update({ active: false, updated_at: nowIso })
          .eq('doctor_uid', params.targetUid);
      }

      await adminClient.auth.admin
        .updateUserById(params.targetUid, {
          ban_duration: params.active ? 'none' : '876000h',
          app_metadata: { staff_role: params.role },
        })
        .catch(() => {});

      const updated = await this.getStaffByUid(params.targetUid);
      return { ok: true, staff: updated || undefined };
    },

    async recordSecurityAudit(params) {
      try {
        await adminClient.from('audit_logs').insert({
          actor_uid: params.actorUid,
          actor_email: params.actorEmail,
          actor_role: params.actorRole,
          category: params.category,
          action: params.action,
          target_type: params.targetType,
          target_id: params.targetId,
          summary: params.summary,
        });
      } catch {
        // Non-fatal audit insert fallback
      }
    },

    async getPublicCatalog() {
      const [{ data: srvRows }, { data: docSchedRows }, { data: guideRows }] = await Promise.all([
        adminClient.from('services').select('*').eq('active', true),
        adminClient
          .from('doctor_schedules')
          .select('*, doctors!inner(doctor_name, specialty, active)')
          .eq('active', true),
        adminClient
          .from('patient_guide_sections')
          .select('*')
          .eq('published', true)
          .order('sort_order', { ascending: true }),
      ]);

      const services: ClinicService[] =
        srvRows && srvRows.length > 0
          ? srvRows.map((s: any) => ({
              id: s.id,
              code: s.code,
              name: s.name,
              category: s.category,
              description: s.description,
              durationMinutes: Number(s.duration_minutes),
              baseFeePhp: Number(s.base_fee_php),
              directlyBookable: Boolean(s.directly_bookable),
              active: Boolean(s.active),
            }))
          : DEFAULT_CLINIC_SERVICES;

      const doctorSchedules: DoctorSchedule[] = (docSchedRows || [])
        .filter((d: any) => d.doctors?.active !== false)
        .map((d: any) => ({
          id: d.doctor_uid,
          doctorUid: d.doctor_uid,
          doctorName: d.doctors?.doctor_name || 'Clinic Physician',
          specialty: d.doctors?.specialty || 'Outpatient Medicine',
          workdays: Array.isArray(d.workdays) ? d.workdays.map(Number) : [1, 2, 3, 4, 5],
          startTime: String(d.start_time || '08:00').slice(0, 5),
          endTime: String(d.end_time || '17:00').slice(0, 5),
          breakStart: String(d.break_start || '12:00').slice(0, 5),
          breakEnd: String(d.break_end || '13:00').slice(0, 5),
          consultationDurationMinutes: Number(d.consultation_duration_minutes || 30),
          slotCapacity: Number(d.slot_capacity || 1),
          qualifiedServiceIds: Array.isArray(d.qualified_service_ids)
            ? d.qualified_service_ids
            : ['srv-general-consult', 'srv-followup-consult'],
          active: Boolean(d.active),
          updatedAt: d.updated_at || '',
        }));

      const patientGuides: PatientGuideSectionItem[] =
        guideRows && guideRows.length > 0
          ? guideRows.map((g: any) => ({
              id: g.id,
              sectionKey: g.section_key,
              sectionTitle: g.section_title,
              topicTitle: g.topic_title,
              summary: g.summary,
              bulletPoints: Array.isArray(g.bullet_points) ? g.bullet_points : [],
              importantNotice: g.important_notice || '',
              lastUpdated: g.last_updated || '',
              updatedByName: g.updated_by_name || 'Clinic Administration',
              published: Boolean(g.published),
              sortOrder: Number(g.sort_order || 1),
            }))
          : DEFAULT_PATIENT_GUIDES;

      return { services, doctorSchedules, patientGuides };
    },
  };
}

// ============================================================================
// Pure In-Memory Repository for Deterministic Unit Tests
// ============================================================================
export function createInMemorySupabaseStaffRepository(initialAuthUsers?: {
  token: string;
  id: string;
  email: string;
  emailVerified: boolean;
  spoofedUserMetadata?: Record<string, unknown>;
}[]) {
  const tokenMap = new Map<string, VerifiedSupabaseUser>();
  for (const u of initialAuthUsers || []) {
    tokenMap.set(u.token, {
      id: u.id,
      email: u.email.trim().toLowerCase(),
      emailVerified: u.emailVerified,
    });
  }

  let bootstrapLock: BootstrapLockState = {
    locked: false,
    bootstrappedAdminUid: '',
    bootstrappedAt: '',
  };
  const staffMap = new Map<string, StoredStaffRecord>();
  const auditTrail: Array<{ action: string; actorUid: string | null; summary: string }> = [];

  const repo: SupabaseStaffRepository & {
    _registerTestToken: (token: string, user: VerifiedSupabaseUser) => void;
    _auditTrail: typeof auditTrail;
  } = {
    _registerTestToken(token, user) {
      tokenMap.set(token, user);
    },
    _auditTrail: auditTrail,

    async verifyAccessToken(accessToken) {
      return tokenMap.get(accessToken) || null;
    },

    async getBootstrapLock() {
      return { ...bootstrapLock };
    },

    async hasAnyAdmin() {
      return Array.from(staffMap.values()).some((s) => s.role === 'admin');
    },

    async getStaffByUid(uid) {
      const s = staffMap.get(uid);
      return s ? { ...s } : null;
    },

    async listAllStaff() {
      return Array.from(staffMap.values()).map((s) => ({ ...s }));
    },

    async claimInitialAdminBootstrap(params) {
      if (bootstrapLock.locked || (await this.hasAnyAdmin())) {
        return {
          ok: false,
          error:
            'One-time initial Administrator bootstrap has already been completed and is permanently disabled.',
        };
      }
      const nowIso = new Date().toISOString();
      bootstrapLock = {
        locked: true,
        bootstrappedAdminUid: params.uid,
        bootstrappedAt: nowIso,
      };
      const record: StoredStaffRecord = {
        uid: params.uid,
        email: params.email,
        fullName: params.fullName,
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
      };
      staffMap.set(params.uid, record);
      return { ok: true, staff: { ...record } };
    },

    async saveStaffMfaSecret(params) {
      const existing = staffMap.get(params.uid);
      if (!existing) throw new Error('Staff profile not found.');
      staffMap.set(params.uid, {
        ...existing,
        mfaEnrolled: true,
        mfaEncryptedSecret: params.encryptedSecret,
        mfaRecoveryHashes: [...params.recoveryHashes],
        updatedAt: new Date().toISOString(),
      });
    },

    async consumeStaffRecoveryHash(params) {
      const existing = staffMap.get(params.uid);
      if (!existing) return;
      staffMap.set(params.uid, {
        ...existing,
        mfaRecoveryHashes: [...params.remainingHashes],
      });
    },

    async createStaffUserWithProfile(params) {
      const dup = Array.from(staffMap.values()).some(
        (s) => s.email.toLowerCase() === params.email.toLowerCase()
      );
      if (dup) {
        return { ok: false, error: 'A staff account with this email address already exists.' };
      }
      const newUid = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const record: StoredStaffRecord = {
        uid: newUid,
        email: params.email.trim().toLowerCase(),
        fullName: params.fullName.trim(),
        role: params.role,
        department: params.department.trim(),
        specialty: params.role === 'doctor' ? params.specialty.trim() : '',
        titleDisplay: params.titleDisplay.trim(),
        active: true,
        mfaEnrolled: false,
        mfaEncryptedSecret: '',
        mfaRecoveryHashes: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      staffMap.set(newUid, record);
      tokenMap.set(`tok-${newUid}`, {
        id: newUid,
        email: record.email,
        emailVerified: true,
      });
      return { ok: true, staff: { ...record } };
    },

    async updateStaffProfile(params) {
      const existing = staffMap.get(params.targetUid);
      if (!existing) return { ok: false, error: 'Staff account not found.' };
      const updated: StoredStaffRecord = {
        ...existing,
        role: params.role,
        department: params.department.trim(),
        specialty: params.role === 'doctor' ? params.specialty.trim() : '',
        titleDisplay: params.titleDisplay.trim(),
        active: params.active,
        mfaEnrolled: params.resetMfa ? false : existing.mfaEnrolled,
        mfaEncryptedSecret: params.resetMfa ? '' : existing.mfaEncryptedSecret,
        mfaRecoveryHashes: params.resetMfa ? [] : existing.mfaRecoveryHashes,
        updatedAt: new Date().toISOString(),
      };
      staffMap.set(params.targetUid, updated);
      return { ok: true, staff: { ...updated } };
    },

    async recordSecurityAudit(params) {
      auditTrail.push({
        action: params.action,
        actorUid: params.actorUid,
        summary: params.summary,
      });
    },

    async getPublicCatalog() {
      const doctors: DoctorSchedule[] = Array.from(staffMap.values())
        .filter((s) => s.role === 'doctor' && s.active)
        .map((s) => ({
          id: s.uid,
          doctorUid: s.uid,
          doctorName: s.fullName,
          specialty: s.specialty || 'Internal Medicine',
          workdays: [1, 2, 3, 4, 5],
          startTime: '08:00',
          endTime: '17:00',
          breakStart: '12:00',
          breakEnd: '13:00',
          consultationDurationMinutes: 30,
          slotCapacity: 1,
          qualifiedServiceIds: ['srv-general-consult', 'srv-followup-consult'],
          active: true,
          updatedAt: s.updatedAt,
        }));
      return {
        services: DEFAULT_CLINIC_SERVICES,
        doctorSchedules: doctors,
        patientGuides: DEFAULT_PATIENT_GUIDES,
      };
    },
  };

  return repo;
}

// ============================================================================
// Server-Side Controller: Trusted One-Time Bootstrap + Mandatory TOTP + RBAC
// ============================================================================
export function createSupabaseStaffController(options: {
  repo: SupabaseStaffRepository;
  getInitialAdminUid: () => string;
  serverSecret: string;
}) {
  const { repo, getInitialAdminUid, serverSecret } = options;
  const attemptLimiter = new Map<string, { count: number; lockedUntilMs: number }>();

  async function authenticateAdminWithMfa(accessToken: string, mfaAssuranceToken: string) {
    const user = await repo.verifyAccessToken(accessToken);
    if (!user) {
      return { ok: false as const, status: 401, error: 'Invalid or expired Supabase Auth token.' };
    }
    if (!user.emailVerified) {
      return {
        ok: false as const,
        status: 403,
        error: 'Verified email address is required for Staff Portal access.',
      };
    }
    const staff = await repo.getStaffByUid(user.id);
    if (!staff || !staff.active) {
      return { ok: false as const, status: 403, error: 'Active clinic staff account not found.' };
    }
    if (staff.role !== 'admin') {
      return {
        ok: false as const,
        status: 403,
        error: 'Administrator privileges are required for Staff Management.',
      };
    }
    if (!staff.mfaEnrolled) {
      return {
        ok: false as const,
        status: 403,
        error: 'Mandatory Authenticator-App TOTP enrollment must be completed first.',
      };
    }
    const mfaPayload = verifyMfaAssuranceToken(mfaAssuranceToken, user.id, serverSecret);
    if (!mfaPayload || mfaPayload.role !== 'admin') {
      return {
        ok: false as const,
        status: 401,
        error: 'Valid Administrator Authenticator-App TOTP 2FA session is required.',
      };
    }
    return { ok: true as const, user, staff };
  }

  return {
    async getSessionStatus(accessToken: string) {
      const user = await repo.verifyAccessToken(accessToken);
      if (!user) {
        return {
          status: 401,
          body: { ok: false, error: 'Invalid or expired Supabase session token.' },
        };
      }

      const [lock, anyAdmin, staff] = await Promise.all([
        repo.getBootstrapLock(),
        repo.hasAnyAdmin(),
        repo.getStaffByUid(user.id),
      ]);

      const bootstrapLocked = lock.locked || anyAdmin;
      const configuredAdminUid = getInitialAdminUid().trim();
      const bootstrapArmed = isValidUuid(configuredAdminUid);
      const canBootstrapCurrentUser =
        !bootstrapLocked &&
        bootstrapArmed &&
        user.emailVerified &&
        constantTimeUuidEqual(user.id, configuredAdminUid);

      return {
        status: 200,
        body: {
          ok: true,
          uid: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
          staffAccount: staff ? sanitizeStaffForClient(staff) : null,
          bootstrapLocked,
          bootstrapArmed,
          canBootstrapCurrentUser,
        },
      };
    },

    async bootstrapFirstAdmin(params: { accessToken: string; fullName: string }) {
      const user = await repo.verifyAccessToken(params.accessToken);
      if (!user) {
        return {
          status: 401,
          body: { ok: false, error: 'Authentication required to execute initial Admin bootstrap.' },
        };
      }
      if (!user.emailVerified) {
        return {
          status: 403,
          body: {
            ok: false,
            error:
              'Your Supabase Auth user email must be confirmed before claiming initial Administrator setup.',
          },
        };
      }

      const [lock, anyAdmin] = await Promise.all([repo.getBootstrapLock(), repo.hasAnyAdmin()]);
      if (lock.locked || anyAdmin) {
        await repo.recordSecurityAudit({
          actorUid: user.id,
          actorEmail: user.email,
          actorRole: 'unassigned',
          category: 'Security',
          action: 'BOOTSTRAP_REJECTED_ALREADY_LOCKED',
          targetType: 'system_bootstrap_lock',
          targetId: 'initial_admin',
          summary: `Rejected repeat initial Admin bootstrap attempt after permanent lock.`,
        });
        return {
          status: 403,
          body: {
            ok: false,
            bootstrapLocked: true,
            error:
              'One-time initial Administrator bootstrap has already been completed and is permanently disabled.',
          },
        };
      }

      const configuredAdminUid = getInitialAdminUid().trim();
      if (!isValidUuid(configuredAdminUid)) {
        return {
          status: 403,
          body: {
            ok: false,
            error:
              'Server bootstrap is not armed: SUPABASE_INITIAL_ADMIN_USER_ID is missing or is not a valid UUID in environment settings.',
          },
        };
      }

      if (!constantTimeUuidEqual(user.id, configuredAdminUid)) {
        await repo.recordSecurityAudit({
          actorUid: null,
          actorEmail: user.email,
          actorRole: 'unassigned',
          category: 'Security',
          action: 'BOOTSTRAP_REJECTED_UID_MISMATCH',
          targetType: 'system_bootstrap_lock',
          targetId: 'initial_admin',
          summary: `Rejected initial Admin bootstrap from unauthorized Supabase User ID.`,
        });
        return {
          status: 403,
          body: {
            ok: false,
            error:
              'Authenticated Supabase Auth User ID does not match the designated SUPABASE_INITIAL_ADMIN_USER_ID.',
          },
        };
      }

      const cleanName = params.fullName.trim();
      if (cleanName.length < 2 || cleanName.length > 120) {
        return {
          status: 400,
          body: {
            ok: false,
            error: 'Please enter a valid Administrator full name (2-120 characters).',
          },
        };
      }

      const claimed = await repo.claimInitialAdminBootstrap({
        uid: user.id,
        email: user.email,
        fullName: cleanName,
      });

      if (!claimed.ok || !claimed.staff) {
        return {
          status: 403,
          body: {
            ok: false,
            error: claimed.error || 'Unable to complete one-time Administrator bootstrap.',
          },
        };
      }

      await repo.recordSecurityAudit({
        actorUid: user.id,
        actorEmail: user.email,
        actorRole: 'admin',
        category: 'Security',
        action: 'INITIAL_ADMIN_BOOTSTRAPPED_AND_LOCKED',
        targetType: 'staff_profiles',
        targetId: user.id,
        summary: `Completed one-time server-side initial System Administrator setup and permanently locked bootstrap.`,
      });

      return {
        status: 200,
        body: {
          ok: true,
          bootstrapLocked: true,
          staffAccount: sanitizeStaffForClient(claimed.staff),
        },
      };
    },

    async setupTotpEnrollment(params: { accessToken: string }) {
      const user = await repo.verifyAccessToken(params.accessToken);
      if (!user || !user.emailVerified) {
        return { status: 401, body: { ok: false, error: 'Verified Supabase session required.' } };
      }
      const staff = await repo.getStaffByUid(user.id);
      if (!staff || !staff.active) {
        return { status: 403, body: { ok: false, error: 'Authorized staff profile not found.' } };
      }

      const secret = generateTotpSecret(20);
      const otpauthUri = buildOtpAuthUri({
        secret,
        accountEmail: user.email,
        issuer: 'SmartClinic',
      });
      const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
        width: 240,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      const recoveryCodes = generateRecoveryCodes(6);
      const recoveryHashes = recoveryCodes.map((c) => hashRecoveryCode(c, serverSecret));
      const encryptedSecret = encryptTotpSecret(secret, serverSecret);

      return {
        status: 200,
        body: {
          ok: true,
          qrDataUrl,
          manualSecretKey: secret,
          encryptedSecret,
          recoveryCodes,
          recoveryHashes,
        },
      };
    },

    async confirmTotpEnrollment(params: {
      accessToken: string;
      encryptedSecret: string;
      recoveryHashes: string[];
      code: string;
      nowMs?: number;
    }) {
      const user = await repo.verifyAccessToken(params.accessToken);
      if (!user || !user.emailVerified) {
        return { status: 401, body: { ok: false, error: 'Verified Supabase session required.' } };
      }
      const staff = await repo.getStaffByUid(user.id);
      if (!staff || !staff.active) {
        return { status: 403, body: { ok: false, error: 'Authorized staff profile not found.' } };
      }
      if (!params.encryptedSecret || !params.code) {
        return {
          status: 400,
          body: { ok: false, error: 'Encrypted secret and 6-digit TOTP code are required.' },
        };
      }

      const nowMs = params.nowMs ?? Date.now();
      let valid = false;
      try {
        const rawSecret = decryptTotpSecret(params.encryptedSecret, serverSecret);
        valid = verifyTotpCode(rawSecret, String(params.code), nowMs, 1);
      } catch {
        valid = false;
      }

      if (!valid) {
        return {
          status: 401,
          body: {
            ok: false,
            error: 'Invalid 6-digit authenticator code. Scan the QR code and try again.',
          },
        };
      }

      await repo.saveStaffMfaSecret({
        uid: user.id,
        encryptedSecret: params.encryptedSecret,
        recoveryHashes: Array.isArray(params.recoveryHashes)
          ? params.recoveryHashes.slice(0, 10)
          : [],
      });

      const expiresAtMs = nowMs + 30 * 60 * 1000;
      const assuranceToken = signMfaAssuranceToken(
        {
          uid: user.id,
          role: staff.role,
          verifiedAtMs: nowMs,
          expiresAtMs,
        },
        serverSecret
      );

      await repo.recordSecurityAudit({
        actorUid: user.id,
        actorEmail: user.email,
        actorRole: staff.role,
        category: 'Security',
        action: 'STAFF_TOTP_ENROLLED',
        targetType: 'staff_profiles',
        targetId: user.id,
        summary: `Completed mandatory Authenticator-App TOTP 2FA enrollment for ${staff.role}.`,
      });

      const updated = await repo.getStaffByUid(user.id);
      return {
        status: 200,
        body: {
          ok: true,
          verified: true,
          assuranceToken,
          expiresAtMs,
          staffAccount: updated ? sanitizeStaffForClient(updated) : null,
        },
      };
    },

    async verifyTotpChallenge(params: {
      accessToken: string;
      code?: string;
      recoveryCode?: string;
      nowMs?: number;
    }) {
      const user = await repo.verifyAccessToken(params.accessToken);
      if (!user || !user.emailVerified) {
        return { status: 401, body: { ok: false, error: 'Verified Supabase session required.' } };
      }
      const staff = await repo.getStaffByUid(user.id);
      if (!staff || !staff.active) {
        return { status: 403, body: { ok: false, error: 'Authorized staff profile not found.' } };
      }
      if (!staff.mfaEnrolled || !staff.mfaEncryptedSecret) {
        return {
          status: 400,
          body: { ok: false, error: 'Authenticator-App TOTP is not enrolled yet for this account.' },
        };
      }

      const nowMs = params.nowMs ?? Date.now();
      const attempt = attemptLimiter.get(user.id) || { count: 0, lockedUntilMs: 0 };
      if (attempt.lockedUntilMs > nowMs) {
        const waitSec = Math.ceil((attempt.lockedUntilMs - nowMs) / 1000);
        return {
          status: 429,
          body: {
            ok: false,
            error: `Too many failed MFA attempts. Please wait ${waitSec} seconds before retrying.`,
          },
        };
      }

      let verified = false;
      if (params.recoveryCode) {
        const candidateHash = hashRecoveryCode(String(params.recoveryCode), serverSecret);
        if (staff.mfaRecoveryHashes.includes(candidateHash)) {
          verified = true;
          const remaining = staff.mfaRecoveryHashes.filter((h) => h !== candidateHash);
          await repo.consumeStaffRecoveryHash({ uid: user.id, remainingHashes: remaining });
        }
      } else if (params.code) {
        const rawSecret = decryptTotpSecret(staff.mfaEncryptedSecret, serverSecret);
        verified = verifyTotpCode(rawSecret, String(params.code), nowMs, 1);
      }

      if (!verified) {
        const nextCount = attempt.count + 1;
        const lockedUntilMs = nextCount >= 5 ? nowMs + 60_000 : 0;
        attemptLimiter.set(user.id, { count: nextCount >= 5 ? 0 : nextCount, lockedUntilMs });
        return {
          status: 401,
          body: {
            ok: false,
            error: 'Invalid 6-digit authenticator code or recovery code.',
            remainingAttempts: Math.max(0, 5 - nextCount),
          },
        };
      }

      attemptLimiter.delete(user.id);
      const expiresAtMs = nowMs + 30 * 60 * 1000;
      const assuranceToken = signMfaAssuranceToken(
        {
          uid: user.id,
          role: staff.role,
          verifiedAtMs: nowMs,
          expiresAtMs,
        },
        serverSecret
      );

      await repo.recordSecurityAudit({
        actorUid: user.id,
        actorEmail: user.email,
        actorRole: staff.role,
        category: 'Authentication',
        action: 'STAFF_TOTP_SESSION_VERIFIED',
        targetType: 'staff_profiles',
        targetId: user.id,
        summary: `Verified Authenticator-App TOTP session for ${staff.role}.`,
      });

      return {
        status: 200,
        body: {
          ok: true,
          verified: true,
          assuranceToken,
          expiresAtMs,
          staffAccount: sanitizeStaffForClient(staff),
        },
      };
    },

    async listStaffAccounts(params: { accessToken: string; mfaAssuranceToken: string }) {
      const authCheck = await authenticateAdminWithMfa(
        params.accessToken,
        params.mfaAssuranceToken
      );
      if (!authCheck.ok) {
        return { status: authCheck.status, body: { ok: false, error: authCheck.error } };
      }

      const [staffList, lock] = await Promise.all([
        repo.listAllStaff(),
        repo.getBootstrapLock(),
      ]);
      return {
        status: 200,
        body: {
          ok: true,
          bootstrappedAdminUid: lock.bootstrappedAdminUid,
          staffAccounts: staffList.map(sanitizeStaffForClient),
        },
      };
    },

    async createStaffAccount(params: {
      accessToken: string;
      mfaAssuranceToken: string;
      email: string;
      password: string;
      fullName: string;
      role: StaffRole;
      department: string;
      specialty: string;
      titleDisplay: string;
    }) {
      const authCheck = await authenticateAdminWithMfa(
        params.accessToken,
        params.mfaAssuranceToken
      );
      if (!authCheck.ok) {
        return { status: authCheck.status, body: { ok: false, error: authCheck.error } };
      }

      const cleanEmail = (params.email || '').trim().toLowerCase();
      const cleanName = (params.fullName || '').trim();
      const password = String(params.password || '');

      if (!cleanEmail || !cleanEmail.includes('@')) {
        return { status: 400, body: { ok: false, error: 'Valid staff email address is required.' } };
      }
      if (cleanName.length < 2 || cleanName.length > 120) {
        return { status: 400, body: { ok: false, error: 'Staff full name is required.' } };
      }
      if (!VALID_STAFF_ROLES.includes(params.role)) {
        return { status: 400, body: { ok: false, error: 'Invalid staff role specified.' } };
      }
      if (password.length < 10) {
        return {
          status: 400,
          body: {
            ok: false,
            error: 'Initial staff password must be at least 10 characters long.',
          },
        };
      }

      const created = await repo.createStaffUserWithProfile({
        email: cleanEmail,
        password,
        fullName: cleanName,
        role: params.role,
        department: (params.department || 'Outpatient Operations').trim(),
        specialty: (params.specialty || '').trim(),
        titleDisplay: (params.titleDisplay || '').trim(),
        assignedByUid: authCheck.user.id,
      });

      if (!created.ok || !created.staff) {
        return {
          status: 400,
          body: { ok: false, error: created.error || 'Could not create staff account.' },
        };
      }

      await repo.recordSecurityAudit({
        actorUid: authCheck.user.id,
        actorEmail: authCheck.user.email,
        actorRole: 'admin',
        category: 'Administrative',
        action: 'STAFF_ACCOUNT_CREATED',
        targetType: 'staff_profiles',
        targetId: created.staff.uid,
        summary: `Created ${params.role.toUpperCase()} account for ${cleanEmail} (mandatory TOTP 2FA required on first login).`,
      });

      return {
        status: 201,
        body: {
          ok: true,
          staffAccount: sanitizeStaffForClient(created.staff),
        },
      };
    },

    async updateStaffAccount(params: {
      accessToken: string;
      mfaAssuranceToken: string;
      targetUid: string;
      role: StaffRole;
      department: string;
      specialty: string;
      titleDisplay: string;
      active: boolean;
      resetMfa?: boolean;
    }) {
      const authCheck = await authenticateAdminWithMfa(
        params.accessToken,
        params.mfaAssuranceToken
      );
      if (!authCheck.ok) {
        return { status: authCheck.status, body: { ok: false, error: authCheck.error } };
      }

      if (!VALID_STAFF_ROLES.includes(params.role)) {
        return { status: 400, body: { ok: false, error: 'Invalid staff role specified.' } };
      }

      const lock = await repo.getBootstrapLock();
      if (
        lock.bootstrappedAdminUid &&
        params.targetUid === lock.bootstrappedAdminUid &&
        (!params.active || params.role !== 'admin')
      ) {
        return {
          status: 400,
          body: {
            ok: false,
            error:
              'The primary bootstrapped System Administrator account cannot be deactivated or demoted.',
          },
        };
      }

      const res = await repo.updateStaffProfile({
        targetUid: params.targetUid,
        role: params.role,
        department: (params.department || 'Outpatient Operations').trim(),
        specialty: (params.specialty || '').trim(),
        titleDisplay: (params.titleDisplay || '').trim(),
        active: Boolean(params.active),
        resetMfa: Boolean(params.resetMfa),
      });

      if (!res.ok || !res.staff) {
        return {
          status: 400,
          body: { ok: false, error: res.error || 'Could not update staff account.' },
        };
      }

      await repo.recordSecurityAudit({
        actorUid: authCheck.user.id,
        actorEmail: authCheck.user.email,
        actorRole: 'admin',
        category: 'Administrative',
        action: 'STAFF_ACCOUNT_UPDATED',
        targetType: 'staff_profiles',
        targetId: params.targetUid,
        summary: `Updated staff account ${res.staff.email} (role=${params.role}, active=${params.active}).`,
      });

      return {
        status: 200,
        body: {
          ok: true,
          staffAccount: sanitizeStaffForClient(res.staff),
        },
      };
    },
  };
}
