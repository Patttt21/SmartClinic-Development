-- ============================================================================
-- SmartClinic Outpatient Healthcare Management System
-- Migration 001: Complete Relational PostgreSQL Schema (Supabase Ready)
-- Scope: Single-Site Outpatient Clinic + Statistical Predictive Analytics
-- Exclusions Enforced: Zero clinic branches, zero emergency contacts,
-- zero SMS OTP tables, strict separation between operational & demo datasets.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Roles & User Profiles
CREATE TABLE IF NOT EXISTS roles (
  id SMALLSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL CHECK (code IN ('patient', 'receptionist', 'nurse', 'doctor', 'laboratory', 'pharmacist', 'admin')),
  display_name TEXT NOT NULL
);

INSERT INTO roles (code, display_name) VALUES
  ('patient', 'Patient'),
  ('receptionist', 'Receptionist'),
  ('nurse', 'Nurse'),
  ('doctor', 'Doctor'),
  ('laboratory', 'Laboratory Staff'),
  ('pharmacist', 'Pharmacist'),
  ('admin', 'Administrator')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL REFERENCES roles(code),
  assigned_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_code)
);

CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL CHECK (role_code IN ('receptionist', 'nurse', 'doctor', 'laboratory', 'pharmacist', 'admin')),
  department TEXT NOT NULL DEFAULT 'Outpatient Operations',
  title_display TEXT NOT NULL DEFAULT '',
  mfa_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_encrypted_secret TEXT DEFAULT '',
  mfa_recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Clinical Patient Records & Walk-In Portal Account Linking
CREATE TABLE IF NOT EXISTS patients (
  patient_id TEXT PRIMARY KEY,
  portal_user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('Female', 'Male', 'Other', 'Prefer not to say')),
  phone TEXT NOT NULL DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  allergies TEXT DEFAULT 'None reported',
  chronic_conditions TEXT DEFAULT 'None reported',
  registration_source TEXT NOT NULL CHECK (registration_source IN ('Online Portal', 'Walk-in Front Desk')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_name_dob ON patients (LOWER(full_name), date_of_birth);

CREATE TABLE IF NOT EXISTS patient_account_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_full_name TEXT NOT NULL,
  requested_dob DATE NOT NULL,
  requested_phone TEXT NOT NULL,
  known_patient_id_hint TEXT DEFAULT '',
  last_visit_date_hint DATE,
  candidate_patient_id TEXT REFERENCES patients(patient_id),
  status TEXT NOT NULL CHECK (status IN ('Pending Staff Verification', 'Approved & Linked', 'Rejected')),
  verification_notes TEXT DEFAULT '',
  reviewed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Outpatient Services, Doctors, Schedules & Leave Requests
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Consultation', 'Follow-up', 'Laboratory')),
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  base_fee_php NUMERIC(10, 2) NOT NULL CHECK (base_fee_php >= 0),
  directly_bookable BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctors (
  doctor_uid UUID PRIMARY KEY REFERENCES staff_profiles(user_id) ON DELETE CASCADE,
  doctor_name TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT 'Outpatient Medicine',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_schedules (
  doctor_uid UUID PRIMARY KEY REFERENCES doctors(doctor_uid) ON DELETE CASCADE,
  workdays SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  start_time TIME NOT NULL DEFAULT '08:00',
  end_time TIME NOT NULL DEFAULT '17:00',
  break_start TIME DEFAULT '12:00',
  break_end TIME DEFAULT '13:00',
  consultation_duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (consultation_duration_minutes >= 10),
  slot_capacity INTEGER NOT NULL DEFAULT 1 CHECK (slot_capacity >= 1),
  qualified_service_ids TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_uid UUID NOT NULL REFERENCES doctors(doctor_uid) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  review_notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Appointments, Status History, QR Tokens & 24-Hour Reminders
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number TEXT UNIQUE NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  portal_user_id UUID REFERENCES profiles(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  booking_mode TEXT NOT NULL CHECK (booking_mode IN ('Specific Doctor', 'Any Available Doctor')),
  doctor_uid UUID NOT NULL REFERENCES doctors(doctor_uid),
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Confirmed', 'Checked In', 'Completed', 'Cancelled', 'Rescheduled', 'Needs Clinic Reschedule', 'No Show')),
  change_initiator TEXT CHECK (change_initiator IN ('patient', 'clinic')),
  blocked_replacement_dates DATE[] NOT NULL DEFAULT '{}',
  min_replacement_date DATE,
  previous_appointment_id UUID REFERENCES appointments(id),
  reason_for_visit TEXT DEFAULT '',
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent double-booking of active consultation slots for the same doctor
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_doctor_slot
  ON appointments (doctor_uid, appointment_date, appointment_time)
  WHERE status IN ('Confirmed', 'Checked In');

CREATE TABLE IF NOT EXISTS appointment_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by_role TEXT NOT NULL,
  reason TEXT DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_qr_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID UNIQUE NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  signed_token TEXT UNIQUE NOT NULL,
  qr_status TEXT NOT NULL CHECK (qr_status IN ('Active', 'Used', 'Invalidated', 'Replaced')),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  portal_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Scheduled', 'Materialized', 'Invalidated')),
  dedupe_key TEXT UNIQUE NOT NULL,
  materialized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Visits, Unified Queue, Nursing Triage & Consultations
CREATE TABLE IF NOT EXISTS visits (
  visit_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  appointment_id UUID REFERENCES appointments(id),
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('Online', 'Walk-in')),
  doctor_uid UUID NOT NULL REFERENCES doctors(doctor_uid),
  service_name TEXT NOT NULL,
  visit_date DATE NOT NULL,
  arrival_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue_entries (
  visit_id TEXT PRIMARY KEY REFERENCES visits(visit_id) ON DELETE CASCADE,
  queue_number TEXT NOT NULL,
  queue_status TEXT NOT NULL CHECK (queue_status IN (
    'Checked In',
    'Waiting for Nurse',
    'In Assessment',
    'Ready for Doctor',
    'In Consultation',
    'Consultation Completed',
    'Checked Out'
  )),
  clinical_priority TEXT NOT NULL CHECK (clinical_priority IN ('Routine', 'Priority', 'Urgent Referral')),
  triage_referral_note TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vital_signs (
  visit_id TEXT PRIMARY KEY REFERENCES visits(visit_id) ON DELETE CASCADE,
  blood_pressure TEXT NOT NULL,
  body_temperature_c NUMERIC(4, 1) NOT NULL,
  pulse_rate_bpm INTEGER NOT NULL,
  respiratory_rate_cpm INTEGER NOT NULL,
  oxygen_saturation_pct INTEGER NOT NULL,
  weight_kg NUMERIC(5, 2),
  height_cm NUMERIC(5, 2),
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nursing_assessments (
  visit_id TEXT PRIMARY KEY REFERENCES visits(visit_id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  chief_complaint TEXT NOT NULL,
  standardized_complaint TEXT NOT NULL CHECK (standardized_complaint IN ('Fever', 'Cough', 'Headache', 'Stomach Pain', 'Other Complaints')),
  additional_symptoms TEXT DEFAULT '',
  symptom_onset TEXT DEFAULT '',
  nursing_observations TEXT DEFAULT '',
  clinical_priority TEXT NOT NULL CHECK (clinical_priority IN ('Routine', 'Priority', 'Urgent Referral')),
  nurse_uid UUID NOT NULL REFERENCES profiles(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultations (
  visit_id TEXT PRIMARY KEY REFERENCES visits(visit_id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  doctor_uid UUID NOT NULL REFERENCES doctors(doctor_uid),
  visit_date DATE NOT NULL,
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('Online', 'Walk-in')),
  chief_complaint TEXT NOT NULL,
  standardized_complaint TEXT NOT NULL CHECK (standardized_complaint IN ('Fever', 'Cough', 'Headache', 'Stomach Pain', 'Other Complaints')),
  clinical_findings TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Draft', 'Finalized')),
  patient_visible BOOLEAN NOT NULL DEFAULT FALSE,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id TEXT NOT NULL REFERENCES consultations(visit_id) ON DELETE CASCADE,
  diagnosis_type TEXT NOT NULL CHECK (diagnosis_type IN ('Final Diagnosis', 'Provisional Diagnosis')),
  diagnosis_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS treatment_plans (
  visit_id TEXT PRIMARY KEY REFERENCES consultations(visit_id) ON DELETE CASCADE,
  plan_details TEXT NOT NULL,
  patient_instructions TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultation_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id TEXT NOT NULL REFERENCES consultations(visit_id) ON DELETE CASCADE,
  amended_by UUID NOT NULL REFERENCES doctors(doctor_uid),
  reason TEXT NOT NULL,
  previous_diagnosis TEXT NOT NULL,
  new_diagnosis TEXT NOT NULL,
  summary_of_changes TEXT NOT NULL,
  amended_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Laboratory Diagnostic Workflow
CREATE TABLE IF NOT EXISTS lab_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  visit_id TEXT NOT NULL REFERENCES visits(visit_id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  ordered_by_doctor_uid UUID NOT NULL REFERENCES doctors(doctor_uid),
  service_id TEXT NOT NULL REFERENCES services(id),
  clinical_indication TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('Routine', 'Stat')),
  status TEXT NOT NULL CHECK (status IN ('Requested', 'Sample Collected', 'Processing', 'For Verification', 'Verified', 'Released')),
  patient_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_samples (
  lab_order_id UUID PRIMARY KEY REFERENCES lab_orders(id) ON DELETE CASCADE,
  sample_barcode TEXT UNIQUE NOT NULL,
  collected_by UUID NOT NULL REFERENCES profiles(id),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id UUID NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  parameter_name TEXT NOT NULL,
  result_value TEXT NOT NULL,
  unit TEXT DEFAULT '',
  reference_range TEXT DEFAULT '',
  interpretation_flag TEXT NOT NULL CHECK (interpretation_flag IN ('Normal', 'Low', 'High', 'Abnormal')),
  entered_by UUID NOT NULL REFERENCES profiles(id),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_verifications (
  lab_order_id UUID PRIMARY KEY REFERENCES lab_orders(id) ON DELETE CASCADE,
  technician_remarks TEXT DEFAULT '',
  verified_by UUID NOT NULL REFERENCES profiles(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

-- 7. Outpatient Pharmacy & Medicine Inventory
CREATE TABLE IF NOT EXISTS medicines (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  generic_name TEXT NOT NULL,
  brand_name TEXT DEFAULT '',
  dosage_form TEXT NOT NULL,
  strength TEXT NOT NULL,
  unit_price_php NUMERIC(10, 2) NOT NULL CHECK (unit_price_php >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medicine_inventory (
  medicine_id TEXT PRIMARY KEY REFERENCES medicines(id) ON DELETE CASCADE,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 20,
  batch_number TEXT DEFAULT '',
  expiry_date DATE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_number TEXT UNIQUE NOT NULL,
  visit_id TEXT NOT NULL REFERENCES visits(visit_id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  doctor_uid UUID NOT NULL REFERENCES doctors(doctor_uid),
  notes TEXT DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Received', 'Under Review', 'Needs Clarification', 'Ready for Dispensing', 'Partially Dispensed', 'Dispensed', 'Not Available')),
  patient_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id TEXT REFERENCES medicines(id),
  medicine_name TEXT NOT NULL,
  strength TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT NOT NULL,
  route TEXT DEFAULT 'Oral',
  quantity_prescribed INTEGER NOT NULL CHECK (quantity_prescribed > 0),
  quantity_dispensed INTEGER NOT NULL DEFAULT 0 CHECK (quantity_dispensed >= 0),
  unit_price_php NUMERIC(10, 2) NOT NULL DEFAULT 0,
  instructions TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pharmacy_clarifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  pharmacist_uid UUID NOT NULL REFERENCES profiles(id),
  question TEXT NOT NULL,
  doctor_response TEXT DEFAULT '',
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispensing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  pharmacist_uid UUID NOT NULL REFERENCES profiles(id),
  dispensed_status TEXT NOT NULL,
  dispensed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Billing, Manual Coverage Verifications & Payments
CREATE TABLE IF NOT EXISTS billing_records (
  visit_id TEXT PRIMARY KEY REFERENCES visits(visit_id) ON DELETE CASCADE,
  invoice_ref TEXT UNIQUE NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  total_amount_php NUMERIC(10, 2) NOT NULL DEFAULT 0,
  approved_coverage_amount_php NUMERIC(10, 2) NOT NULL DEFAULT 0,
  adjustment_amount_php NUMERIC(10, 2) NOT NULL DEFAULT 0,
  amount_paid_php NUMERIC(10, 2) NOT NULL DEFAULT 0,
  remaining_balance_php NUMERIC(10, 2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('Unpaid', 'Partially Paid', 'Paid', 'Adjusted / Refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id TEXT NOT NULL REFERENCES billing_records(visit_id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('Consultation', 'Laboratory', 'Pharmacy', 'Procedure')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_php NUMERIC(10, 2) NOT NULL,
  subtotal_php NUMERIC(10, 2) NOT NULL,
  source_record_id TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS coverage_verifications (
  visit_id TEXT PRIMARY KEY REFERENCES billing_records(visit_id) ON DELETE CASCADE,
  coverage_source TEXT NOT NULL CHECK (coverage_source IN ('Self-Pay', 'HMO / Health Card', 'PhilHealth')),
  provider_name TEXT DEFAULT '',
  member_number TEXT DEFAULT '',
  loa_or_mdr_reference TEXT DEFAULT '',
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id TEXT NOT NULL REFERENCES billing_records(visit_id) ON DELETE CASCADE,
  receipt_number TEXT UNIQUE NOT NULL,
  amount_php NUMERIC(10, 2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Card', 'GCash / E-Wallet', 'Bank Transfer', 'Adjustment / Refund')),
  reference_code TEXT DEFAULT '',
  recorded_by UUID REFERENCES profiles(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT DEFAULT ''
);

-- 9. Follow-Up Care, In-App Notifications, Patient Guide & Audit Logs
CREATE TABLE IF NOT EXISTS follow_up_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id TEXT NOT NULL REFERENCES visits(visit_id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  doctor_uid UUID NOT NULL REFERENCES doctors(doctor_uid),
  recommended_date DATE NOT NULL,
  interval_label TEXT DEFAULT '',
  reason TEXT NOT NULL,
  instructions TEXT DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Recommended', 'Booked', 'Completed')),
  booked_appointment_id UUID REFERENCES appointments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_uid UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_role TEXT NOT NULL,
  title TEXT NOT NULL,
  safe_summary TEXT NOT NULL,
  related_record_type TEXT DEFAULT '',
  related_record_id TEXT DEFAULT '',
  view_path TEXT DEFAULT '',
  dedupe_key TEXT UNIQUE,
  important_popup BOOLEAN NOT NULL DEFAULT FALSE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  popup_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_guide_sections (
  id TEXT PRIMARY KEY,
  section_key TEXT NOT NULL CHECK (section_key IN ('hmo', 'philhealth', 'privacy', 'clinic_guides')),
  section_title TEXT NOT NULL,
  topic_title TEXT NOT NULL,
  summary TEXT NOT NULL,
  bullet_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  important_notice TEXT DEFAULT '',
  last_updated DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_by_name TEXT DEFAULT 'Clinic Administration',
  published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid UUID REFERENCES profiles(id),
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Authentication', 'Clinical', 'Administrative', 'Security', 'Analytics')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Strictly Separated Predictive Analytics Tables
CREATE TABLE IF NOT EXISTS analytics_import_batches (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  total_rows_read INTEGER NOT NULL,
  valid_completed_imported INTEGER NOT NULL,
  skipped_non_completed INTEGER NOT NULL,
  duplicate_rows_skipped INTEGER NOT NULL,
  invalid_rows_rejected INTEGER NOT NULL,
  date_range_start DATE,
  date_range_end DATE,
  imported_by UUID NOT NULL REFERENCES profiles(id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evaluator_consultation_records (
  id TEXT PRIMARY KEY,
  import_batch_id TEXT NOT NULL REFERENCES analytics_import_batches(id) ON DELETE CASCADE,
  source_external_patient_ref TEXT NOT NULL,
  consultation_date DATE NOT NULL,
  consultation_status TEXT NOT NULL CHECK (consultation_status = 'Completed'),
  chief_complaint_raw TEXT NOT NULL,
  standardized_complaint TEXT NOT NULL CHECK (standardized_complaint IN ('Fever', 'Cough', 'Headache', 'Stomach Pain', 'Other Complaints')),
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('Online', 'Walk-in')),
  doctor_diagnosis_raw TEXT DEFAULT '',
  dataset_mode TEXT NOT NULL DEFAULT 'demonstration' CHECK (dataset_mode = 'demonstration'),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_mode TEXT NOT NULL CHECK (dataset_mode IN ('demonstration', 'operational')),
  total_completed_consultations INTEGER NOT NULL,
  sufficient_data BOOLEAN NOT NULL,
  generated_by UUID REFERENCES profiles(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forecast_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analytics_run_id UUID NOT NULL REFERENCES analytics_runs(id) ON DELETE CASCADE,
  horizon_type TEXT NOT NULL CHECK (horizon_type IN ('daily', 'weekly', 'monthly', 'complaint')),
  selected_model TEXT NOT NULL,
  mae_moving_average NUMERIC(10, 2),
  mae_ses NUMERIC(10, 2),
  mae_naive_baseline NUMERIC(10, 2),
  next_period_forecast NUMERIC(10, 2),
  series_payload JSONB NOT NULL DEFAULT '[]'::jsonb
);
