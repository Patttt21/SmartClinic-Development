import type {
  Appointment,
  DoctorSchedule,
  LeaveRequest,
} from '../types/clinic';

export interface AvailableTimeSlot {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  availableDoctorUids: string[];
  availableDoctorNames: string[];
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function getDayOfWeekFromIsoDate(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function getManilaDateIso(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

export function getManilaTimeHhMm(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(now);
}

export function isDoctorOnApprovedLeave(
  doctorUid: string,
  isoDate: string,
  leaves: LeaveRequest[]
): boolean {
  return leaves.some(
    (leave) =>
      leave.doctorUid === doctorUid &&
      leave.status === 'Approved' &&
      isoDate >= leave.startDate &&
      isoDate <= leave.endDate
  );
}

export function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && endA > startB;
}

const ACTIVE_BOOKING_STATUSES = new Set([
  'Confirmed',
  'Checked In',
]);

/**
 * Calculates real-time available slots for a single doctor on a specific date.
 * Strictly respects workdays, working hours, break times, approved leave,
 * service qualification, consultation duration, doctor capacity, and past-time guard.
 */
export function calculateDoctorSlotsForDate(params: {
  schedule: DoctorSchedule;
  serviceId: string;
  serviceDurationMinutes?: number;
  isoDate: string;
  todayIsoDate: string;
  currentHhMm?: string;
  leaves: LeaveRequest[];
  existingAppointments: Appointment[];
  excludeAppointmentId?: string;
}): { startTime: string; endTime: string }[] {
  const {
    schedule,
    serviceId,
    serviceDurationMinutes,
    isoDate,
    todayIsoDate,
    currentHhMm,
    leaves,
    existingAppointments,
    excludeAppointmentId,
  } = params;

  if (!schedule.active) return [];
  if (isoDate < todayIsoDate) return [];
  if (!schedule.qualifiedServiceIds.includes(serviceId)) return [];

  const dayOfWeek = getDayOfWeekFromIsoDate(isoDate);
  if (!schedule.workdays.includes(dayOfWeek)) return [];

  if (isDoctorOnApprovedLeave(schedule.doctorUid, isoDate, leaves)) {
    return [];
  }

  const duration = Math.max(
    serviceDurationMinutes || schedule.consultationDurationMinutes,
    schedule.consultationDurationMinutes
  );
  const workStart = timeToMinutes(schedule.startTime);
  const workEnd = timeToMinutes(schedule.endTime);
  const breakStart = schedule.breakStart ? timeToMinutes(schedule.breakStart) : -1;
  const breakEnd = schedule.breakEnd ? timeToMinutes(schedule.breakEnd) : -1;
  const capacity = Math.max(1, schedule.slotCapacity || 1);

  const doctorActiveAppts = existingAppointments.filter(
    (appt) =>
      appt.doctorUid === schedule.doctorUid &&
      appt.appointmentDate === isoDate &&
      ACTIVE_BOOKING_STATUSES.has(appt.status) &&
      appt.id !== excludeAppointmentId
  );

  const nowMins = isoDate === todayIsoDate && currentHhMm ? timeToMinutes(currentHhMm) : -1;
  const slots: { startTime: string; endTime: string }[] = [];

  for (let cursor = workStart; cursor + duration <= workEnd; cursor += schedule.consultationDurationMinutes) {
    const slotEnd = cursor + duration;

    if (nowMins >= 0 && cursor <= nowMins + 15) {
      continue;
    }

    if (breakStart >= 0 && breakEnd > breakStart && rangesOverlap(cursor, slotEnd, breakStart, breakEnd)) {
      continue;
    }

    const overlappingCount = doctorActiveAppts.filter((appt) => {
      const aStart = timeToMinutes(appt.appointmentTime);
      const aEnd = appt.endTime ? timeToMinutes(appt.endTime) : aStart + appt.durationMinutes;
      return rangesOverlap(cursor, slotEnd, aStart, aEnd);
    }).length;

    if (overlappingCount < capacity) {
      slots.push({
        startTime: minutesToTime(cursor),
        endTime: minutesToTime(slotEnd),
      });
    }
  }

  return slots;
}

/**
 * Calculates aggregated available slots for either a Specific Doctor or Any Available Doctor.
 */
export function calculateAvailableSlots(params: {
  schedules: DoctorSchedule[];
  doctorUid: string | 'any';
  serviceId: string;
  serviceDurationMinutes?: number;
  isoDate: string;
  todayIsoDate: string;
  currentHhMm?: string;
  leaves: LeaveRequest[];
  existingAppointments: Appointment[];
  excludeAppointmentId?: string;
}): AvailableTimeSlot[] {
  const eligibleSchedules =
    params.doctorUid === 'any'
      ? params.schedules.filter((s) => s.active && s.qualifiedServiceIds.includes(params.serviceId))
      : params.schedules.filter((s) => s.doctorUid === params.doctorUid);

  const slotMap = new Map<string, AvailableTimeSlot>();

  for (const schedule of eligibleSchedules) {
    const docSlots = calculateDoctorSlotsForDate({
      schedule,
      serviceId: params.serviceId,
      serviceDurationMinutes: params.serviceDurationMinutes,
      isoDate: params.isoDate,
      todayIsoDate: params.todayIsoDate,
      currentHhMm: params.currentHhMm,
      leaves: params.leaves,
      existingAppointments: params.existingAppointments,
      excludeAppointmentId: params.excludeAppointmentId,
    });

    for (const s of docSlots) {
      const key = `${s.startTime}-${s.endTime}`;
      const existing = slotMap.get(key);
      if (existing) {
        existing.availableDoctorUids.push(schedule.doctorUid);
        existing.availableDoctorNames.push(schedule.doctorName);
      } else {
        slotMap.set(key, {
          startTime: s.startTime,
          endTime: s.endTime,
          availableDoctorUids: [schedule.doctorUid],
          availableDoctorNames: [schedule.doctorName],
        });
      }
    }
  }

  return Array.from(slotMap.values()).sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );
}

/**
 * Automatically selects the least-loaded available qualified doctor on that date
 * when the patient chooses "Any Available Doctor".
 */
export function assignDoctorForAnyAvailable(params: {
  candidateDoctorUids: string[];
  schedules: DoctorSchedule[];
  isoDate: string;
  existingAppointments: Appointment[];
}): DoctorSchedule | null {
  if (params.candidateDoctorUids.length === 0) return null;

  const candidates = params.schedules.filter((s) =>
    params.candidateDoctorUids.includes(s.doctorUid)
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const countA = params.existingAppointments.filter(
      (appt) =>
        appt.doctorUid === a.doctorUid &&
        appt.appointmentDate === params.isoDate &&
        ACTIVE_BOOKING_STATUSES.has(appt.status)
    ).length;
    const countB = params.existingAppointments.filter(
      (appt) =>
        appt.doctorUid === b.doctorUid &&
        appt.appointmentDate === params.isoDate &&
        ACTIVE_BOOKING_STATUSES.has(appt.status)
    ).length;
    if (countA !== countB) return countA - countB;
    return a.doctorName.localeCompare(b.doctorName);
  });

  return candidates[0];
}

/**
 * Enforces Section 7 Custom Cancellation & Rescheduling Rule:
 * - For patient-initiated voluntary cancellation or rescheduling, the previous appointment date
 *   cannot be selected again, and replacement booking must be scheduled strictly after the
 *   original appointment date (e.g., Original Nov 2 -> Replacement no earlier than Nov 3).
 * - For clinic-initiated changes (e.g. approved Doctor leave), same-date replacement with an
 *   alternative qualified Doctor IS allowed.
 */
export function validateReplacementDateRule(params: {
  originalAppointment: Pick<
    Appointment,
    'appointmentDate' | 'blockedReplacementDates' | 'minReplacementDate' | 'status'
  >;
  proposedDate: string;
  initiator: 'patient' | 'clinic';
  todayIsoDate: string;
}): { allowed: boolean; reason?: string; earliestAllowedDate: string } {
  const { originalAppointment, proposedDate, initiator, todayIsoDate } = params;

  if (proposedDate < todayIsoDate) {
    return {
      allowed: false,
      reason: 'Cannot schedule an appointment on a past date.',
      earliestAllowedDate: todayIsoDate,
    };
  }

  if (initiator === 'clinic' || originalAppointment.status === 'Needs Clinic Reschedule') {
    return {
      allowed: true,
      earliestAllowedDate: todayIsoDate,
    };
  }

  const nextDayAfterOriginal = addDaysToIsoDate(originalAppointment.appointmentDate, 1);
  const priorMin = originalAppointment.minReplacementDate || nextDayAfterOriginal;
  const earliestAllowed = [todayIsoDate, nextDayAfterOriginal, priorMin].sort().pop()!;

  const blockedSet = new Set([
    originalAppointment.appointmentDate,
    ...(originalAppointment.blockedReplacementDates || []),
  ]);

  if (blockedSet.has(proposedDate) || proposedDate < earliestAllowed) {
    return {
      allowed: false,
      reason: `For patient-initiated cancellation or rescheduling, the previous appointment date (${originalAppointment.appointmentDate}) cannot be selected again. Please select a date on or after ${earliestAllowed}.`,
      earliestAllowedDate: earliestAllowed,
    };
  }

  return {
    allowed: true,
    earliestAllowedDate: earliestAllowed,
  };
}

/**
 * Scans future dates (e.g. next 30 days) and returns dates that have >=1 open slot
 * AND satisfy any active replacement-date restrictions.
 */
export function calculateAvailableDates(params: {
  schedules: DoctorSchedule[];
  doctorUid: string | 'any';
  serviceId: string;
  serviceDurationMinutes?: number;
  todayIsoDate: string;
  currentHhMm?: string;
  horizonDays?: number;
  leaves: LeaveRequest[];
  existingAppointments: Appointment[];
  excludeAppointmentId?: string;
  replacementContext?: {
    originalAppointment: Pick<
      Appointment,
      'appointmentDate' | 'blockedReplacementDates' | 'minReplacementDate' | 'status'
    >;
    initiator: 'patient' | 'clinic';
  };
}): { isoDate: string; openSlotCount: number }[] {
  const horizon = params.horizonDays ?? 30;
  const results: { isoDate: string; openSlotCount: number }[] = [];

  for (let offset = 0; offset <= horizon; offset++) {
    const isoDate = addDaysToIsoDate(params.todayIsoDate, offset);

    if (params.replacementContext) {
      const ruleCheck = validateReplacementDateRule({
        originalAppointment: params.replacementContext.originalAppointment,
        proposedDate: isoDate,
        initiator: params.replacementContext.initiator,
        todayIsoDate: params.todayIsoDate,
      });
      if (!ruleCheck.allowed) continue;
    }

    const slots = calculateAvailableSlots({
      schedules: params.schedules,
      doctorUid: params.doctorUid,
      serviceId: params.serviceId,
      serviceDurationMinutes: params.serviceDurationMinutes,
      isoDate,
      todayIsoDate: params.todayIsoDate,
      currentHhMm: params.currentHhMm,
      leaves: params.leaves,
      existingAppointments: params.existingAppointments,
      excludeAppointmentId: params.excludeAppointmentId,
    });

    if (slots.length > 0) {
      results.push({ isoDate, openSlotCount: slots.length });
    }
  }

  return results;
}
