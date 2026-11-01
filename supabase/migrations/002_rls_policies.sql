-- ============================================================================
-- SmartClinic Outpatient Healthcare Management System
-- Migration 002: Row Level Security (RLS) & Mandatory Staff MFA Policies
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vital_signs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nursing_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicine_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_guide_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluator_consultation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper: Check active staff role + AAL2 (TOTP MFA) session assurance
CREATE OR REPLACE FUNCTION public.has_staff_role_aal2(target_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles sp
    WHERE sp.user_id = auth.uid()
      AND sp.active = TRUE
      AND sp.mfa_enrolled = TRUE
      AND sp.role_code = ANY(target_roles)
      AND COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
  );
$$;

-- Public read policies for Services and Published Patient Guides
CREATE POLICY "Public read active services"
  ON services FOR SELECT
  USING (active = TRUE);

CREATE POLICY "Public read published guides"
  ON patient_guide_sections FOR SELECT
  USING (published = TRUE);

-- Patient Portal Isolation: Patients only see their own linked records & released documents
CREATE POLICY "Patients view own patient record"
  ON patients FOR SELECT
  USING (
    portal_user_id = auth.uid()
    OR public.has_staff_role_aal2(ARRAY['receptionist', 'nurse', 'doctor', 'laboratory', 'pharmacist', 'admin'])
  );

CREATE POLICY "Patients view own appointments"
  ON appointments FOR SELECT
  USING (
    portal_user_id = auth.uid()
    OR public.has_staff_role_aal2(ARRAY['receptionist', 'nurse', 'doctor', 'admin'])
  );

-- Confidential Clinical Consultations: Restricted to Patient (when finalized) + Doctor + Nurse ONLY!
-- Receptionists and Administrators are strictly excluded from reading confidential clinical findings.
CREATE POLICY "Confidential consultations restricted to clinicians and owner patient"
  ON consultations FOR SELECT
  USING (
    (
      patient_visible = TRUE
      AND EXISTS (
        SELECT 1 FROM patients p
        WHERE p.patient_id = consultations.patient_id
          AND p.portal_user_id = auth.uid()
      )
    )
    OR public.has_staff_role_aal2(ARRAY['doctor', 'nurse'])
  );

CREATE POLICY "Only doctors author consultations"
  ON consultations FOR ALL
  USING (public.has_staff_role_aal2(ARRAY['doctor']))
  WITH CHECK (public.has_staff_role_aal2(ARRAY['doctor']));

-- Laboratory Results: Patient sees ONLY when Released; Doctor, Nurse, Lab Staff see worklist
CREATE POLICY "Lab orders visibility"
  ON lab_orders FOR SELECT
  USING (
    (
      status = 'Released'
      AND patient_visible = TRUE
      AND EXISTS (
        SELECT 1 FROM patients p
        WHERE p.patient_id = lab_orders.patient_id
          AND p.portal_user_id = auth.uid()
      )
    )
    OR public.has_staff_role_aal2(ARRAY['doctor', 'nurse', 'laboratory', 'receptionist'])
  );

-- Notifications: Recipient only
CREATE POLICY "Recipient reads own notifications"
  ON notifications FOR SELECT
  USING (recipient_uid = auth.uid());

-- Evaluator Demonstration Data & Audit Logs: Administrator with AAL2 only
CREATE POLICY "Admin manages evaluator CSV records"
  ON evaluator_consultation_records FOR ALL
  USING (public.has_staff_role_aal2(ARRAY['admin']))
  WITH CHECK (public.has_staff_role_aal2(ARRAY['admin']));

CREATE POLICY "Admin reads audit logs"
  ON audit_logs FOR SELECT
  USING (public.has_staff_role_aal2(ARRAY['admin']));
