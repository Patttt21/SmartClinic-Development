import type {
  ComplaintForecastSummary,
  ConsultationRecord,
  EvaluatorConsultationRecord,
  EvaluatorImportBatch,
  ForecastSeriesPoint,
  HorizonForecastResult,
  PredictiveAnalyticsOutput,
  StandardizedComplaintCategory,
} from '../types/clinic';
import { categorizeChiefComplaint } from './clinicalWorkflow';

export interface NormalizedHistoricalConsultation {
  internalId: string;
  patientKey: string;
  consultationDate: string; // YYYY-MM-DD
  appointmentType: 'Online' | 'Walk-in';
  standardizedComplaint: StandardizedComplaintCategory;
  provenance: 'demonstration' | 'operational';
}

const COMPLAINT_CATEGORIES: StandardizedComplaintCategory[] = [
  'Fever',
  'Cough',
  'Headache',
  'Stomach Pain',
  'Other Complaints',
];

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function normalizeDateToIso(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // Match YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d &&
      y >= 2000 &&
      y <= 2100
    ) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }

  // Match MM/DD/YYYY
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const m = Number(slashMatch[1]);
    const d = Number(slashMatch[2]);
    const y = Number(slashMatch[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d &&
      y >= 2000 &&
      y <= 2100
    ) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }

  return null;
}

/**
 * Parses and validates Admin-uploaded Evaluator CSV records strictly into the
 * isolated Demonstration dataset. Never creates real patients or operational visits.
 */
export function parseAndValidateEvaluatorCsv(params: {
  csvContent: string;
  fileName: string;
  importedByUid: string;
  importedByName: string;
  existingDemoRecords?: EvaluatorConsultationRecord[];
  nowIso?: string;
}): {
  ok: boolean;
  fatalError?: string;
  records: EvaluatorConsultationRecord[];
  batch: EvaluatorImportBatch;
} {
  const nowIso = params.nowIso || new Date().toISOString();
  const batchId = `BATCH-${Date.now().toString(36).toUpperCase()}`;

  const rawLines = params.csvContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (rawLines.length < 2) {
    return {
      ok: false,
      fatalError: 'CSV file must contain a header row and at least one consultation record.',
      records: [],
      batch: {
        id: batchId,
        fileName: params.fileName,
        totalRowsRead: 0,
        validCompletedImported: 0,
        skippedNonCompleted: 0,
        duplicateRowsSkipped: 0,
        invalidRowsRejected: 0,
        errorReport: ['Empty or header-only CSV file.'],
        dateRangeStart: '',
        dateRangeEnd: '',
        importedByUid: params.importedByUid,
        importedByName: params.importedByName,
        importedAt: nowIso,
      },
    };
  }

  const headers = parseCsvLine(rawLines[0]).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const findCol = (candidates: string[]) =>
    headers.findIndex((h) => candidates.includes(h));

  const idxDate = findCol(['consultationdate', 'visitdate', 'date']);
  const idxPatient = findCol(['patientid', 'patientcode', 'patientref']);
  const idxStatus = findCol(['consultationstatus', 'status', 'visitstatus']);
  const idxComplaint = findCol(['chiefcomplaint', 'complaint', 'primarycomplaint']);
  const idxType = findCol(['appointmenttype', 'visittype', 'type']);
  const idxDiagnosis = findCol(['doctorsdiagnosis', 'doctordiagnosis', 'diagnosis']);
  const idxVisitId = findCol(['consultationid', 'visitid', 'encounterid', 'recordid']);

  const missingCols: string[] = [];
  if (idxDate === -1) missingCols.push('Consultation Date');
  if (idxPatient === -1) missingCols.push('Patient ID');
  if (idxStatus === -1) missingCols.push('Consultation Status');
  if (idxComplaint === -1) missingCols.push('Chief Complaint');
  if (idxType === -1) missingCols.push('Appointment Type');
  if (idxDiagnosis === -1) missingCols.push("Doctor's Diagnosis");

  if (missingCols.length > 0) {
    return {
      ok: false,
      fatalError: `Missing required CSV columns: ${missingCols.join(', ')}`,
      records: [],
      batch: {
        id: batchId,
        fileName: params.fileName,
        totalRowsRead: rawLines.length - 1,
        validCompletedImported: 0,
        skippedNonCompleted: 0,
        duplicateRowsSkipped: 0,
        invalidRowsRejected: rawLines.length - 1,
        errorReport: [`Missing required columns: ${missingCols.join(', ')}`],
        dateRangeStart: '',
        dateRangeEnd: '',
        importedByUid: params.importedByUid,
        importedByName: params.importedByName,
        importedAt: nowIso,
      },
    };
  }

  const seenFingerprints = new Set<string>();
  for (const existing of params.existingDemoRecords || []) {
    const fp = `${existing.consultationDate}|${existing.sourceExternalPatientRef}|${existing.chiefComplaintRaw.toLowerCase()}`;
    seenFingerprints.add(fp);
  }

  const seenVisitIds = new Set<string>();
  const records: EvaluatorConsultationRecord[] = [];
  const errorReport: string[] = [];
  let skippedNonCompleted = 0;
  let duplicateRowsSkipped = 0;
  let invalidRowsRejected = 0;

  for (let rowIdx = 1; rowIdx < rawLines.length; rowIdx++) {
    const cols = parseCsvLine(rawLines[rowIdx]);
    const rowNum = rowIdx + 1;

    const rawDate = cols[idxDate] || '';
    const rawPatient = (cols[idxPatient] || '').trim();
    const rawStatus = (cols[idxStatus] || '').trim();
    const rawComplaint = (cols[idxComplaint] || '').trim();
    const rawType = (cols[idxType] || '').trim();
    const rawDiag = (cols[idxDiagnosis] || '').trim();
    const rawVisitId = idxVisitId >= 0 ? (cols[idxVisitId] || '').trim() : '';

    const isoDate = normalizeDateToIso(rawDate);
    if (!isoDate) {
      invalidRowsRejected++;
      if (errorReport.length < 25) {
        errorReport.push(`Row ${rowNum}: Invalid Consultation Date "${rawDate}".`);
      }
      continue;
    }

    if (!rawPatient) {
      invalidRowsRejected++;
      if (errorReport.length < 25) {
        errorReport.push(`Row ${rowNum}: Missing Patient ID.`);
      }
      continue;
    }

    const normTypeLower = rawType.toLowerCase().replace(/[^a-z]/g, '');
    let appointmentType: 'Online' | 'Walk-in' | null = null;
    if (normTypeLower === 'online' || normTypeLower === 'onlineappointment' || normTypeLower === 'scheduled') {
      appointmentType = 'Online';
    } else if (normTypeLower === 'walkin' || normTypeLower === 'walk') {
      appointmentType = 'Walk-in';
    }

    if (!appointmentType) {
      invalidRowsRejected++;
      if (errorReport.length < 25) {
        errorReport.push(`Row ${rowNum}: Invalid Appointment Type "${rawType}" (expected Online or Walk-in).`);
      }
      continue;
    }

    const statusLower = rawStatus.toLowerCase();
    const isCompleted =
      statusLower === 'completed' ||
      statusLower === 'finalized' ||
      statusLower === 'consultation completed' ||
      statusLower === 'checked out';

    if (!isCompleted) {
      skippedNonCompleted++;
      continue;
    }

    if (rawVisitId) {
      if (seenVisitIds.has(rawVisitId.toUpperCase())) {
        duplicateRowsSkipped++;
        continue;
      }
      seenVisitIds.add(rawVisitId.toUpperCase());
    }

    const safeExternalPatientRef = `EVAL-PT-${rawPatient.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}`;
    const fingerprint = `${isoDate}|${safeExternalPatientRef}|${rawComplaint.toLowerCase()}`;
    if (seenFingerprints.has(fingerprint)) {
      duplicateRowsSkipped++;
      continue;
    }
    seenFingerprints.add(fingerprint);

    records.push({
      id: `DEMO-${batchId}-${String(records.length + 1).padStart(4, '0')}`,
      importBatchId: batchId,
      sourceExternalPatientRef: safeExternalPatientRef,
      consultationDate: isoDate,
      consultationStatus: 'Completed',
      chiefComplaintRaw: rawComplaint || 'Unspecified',
      standardizedComplaint: categorizeChiefComplaint(rawComplaint),
      appointmentType,
      doctorDiagnosisRaw: rawDiag || 'Documented in evaluator dataset',
      datasetMode: 'demonstration',
      sourceFileName: params.fileName,
      importedByUid: params.importedByUid,
      importedAt: nowIso,
    });
  }

  const sortedDates = records.map((r) => r.consultationDate).sort();

  return {
    ok: true,
    records,
    batch: {
      id: batchId,
      fileName: params.fileName,
      totalRowsRead: rawLines.length - 1,
      validCompletedImported: records.length,
      skippedNonCompleted,
      duplicateRowsSkipped,
      invalidRowsRejected,
      errorReport,
      dateRangeStart: sortedDates[0] || '',
      dateRangeEnd: sortedDates[sortedDates.length - 1] || '',
      importedByUid: params.importedByUid,
      importedByName: params.importedByName,
      importedAt: nowIso,
    },
  };
}

function getMondayOfIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function addDaysUtc(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function addMonthsUtc(yyyyMm: string, months: number): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function computeMovingAverageSeries(values: number[], windowSize: number): (number | undefined)[] {
  const preds: (number | undefined)[] = [];
  for (let t = 0; t < values.length; t++) {
    if (t < windowSize) {
      preds.push(undefined);
    } else {
      let sum = 0;
      for (let k = t - windowSize; k < t; k++) {
        sum += values[k];
      }
      preds.push(Number((sum / windowSize).toFixed(2)));
    }
  }
  return preds;
}

export function computeSimpleExponentialSmoothing(
  values: number[],
  alpha: number
): { fitted: number[]; nextForecast: number } {
  if (values.length === 0) return { fitted: [], nextForecast: 0 };
  const fitted: number[] = [Number(values[0].toFixed(2))];
  let level = values[0];

  for (let t = 1; t < values.length; t++) {
    fitted.push(Number(level.toFixed(2)));
    level = alpha * values[t] + (1 - alpha) * level;
  }

  return {
    fitted,
    nextForecast: Number(level.toFixed(2)),
  };
}

function optimizeSesAlphaChronologically(trainValues: number[]): number {
  if (trainValues.length < 4) return 0.3;
  let bestAlpha = 0.3;
  let bestMae = Number.POSITIVE_INFINITY;

  for (const candidate of [0.15, 0.25, 0.35, 0.5, 0.65, 0.8]) {
    const { fitted } = computeSimpleExponentialSmoothing(trainValues, candidate);
    let errSum = 0;
    let count = 0;
    for (let i = 1; i < trainValues.length; i++) {
      errSum += Math.abs(trainValues[i] - fitted[i]);
      count++;
    }
    const mae = count > 0 ? errSum / count : Number.POSITIVE_INFINITY;
    if (mae < bestMae) {
      bestMae = mae;
      bestAlpha = candidate;
    }
  }

  return bestAlpha;
}

function evaluateHorizonForecast(params: {
  horizonType: 'daily' | 'weekly' | 'monthly';
  title: string;
  priorityBadge: string;
  periodKeys: string[];
  labels: string[];
  values: number[];
  futureKeysAndLabels: { periodKey: string; label: string }[];
  minObservationsRequired: number;
  maWindow: number;
}): HorizonForecastResult {
  const n = params.values.length;

  if (n < params.minObservationsRequired) {
    return {
      horizonType: params.horizonType,
      title: params.title,
      priorityBadge: params.priorityBadge,
      status: 'Insufficient Data',
      statusMessage: `Requires at least ${params.minObservationsRequired} chronological ${params.horizonType} periods (currently ${n}).`,
      observationsCount: n,
      trainingPeriod: n > 0 ? `${params.periodKeys[0]} to ${params.periodKeys[n - 1]}` : 'None',
      forecastHorizonCount: params.futureKeysAndLabels.length,
      selectedModel: 'Simple Exponential Smoothing',
      movingAverageWindow: params.maWindow,
      sesAlpha: 0.3,
      maeMovingAverage: null,
      maeSes: null,
      maeNaiveBaseline: null,
      nextPeriodForecast: null,
      uncertaintyRange: null,
      series: params.periodKeys.map((pk, idx) => ({
        periodKey: pk,
        label: params.labels[idx],
        actual: params.values[idx],
        isForecastHorizon: false,
      })),
    };
  }

  // Strict chronological validation split (first ~75% train, final ~25% holdout test, min 2 test points)
  const testLen = Math.max(2, Math.floor(n * 0.25));
  const splitIdx = Math.max(params.maWindow, n - testLen);
  const trainSlice = params.values.slice(0, splitIdx);
  const alpha = optimizeSesAlphaChronologically(trainSlice);

  const maFitted = computeMovingAverageSeries(params.values, params.maWindow);
  const sesRun = computeSimpleExponentialSmoothing(params.values, alpha);

  let maErrSum = 0;
  let maCount = 0;
  let sesErrSum = 0;
  let sesCount = 0;
  let naiveErrSum = 0;
  let naiveCount = 0;
  const residuals: number[] = [];

  for (let t = splitIdx; t < n; t++) {
    const actual = params.values[t];
    const maPred = maFitted[t];
    if (maPred !== undefined) {
      maErrSum += Math.abs(actual - maPred);
      maCount++;
    }
    const sesPred = sesRun.fitted[t];
    sesErrSum += Math.abs(actual - sesPred);
    sesCount++;
    residuals.push(actual - sesPred);

    if (t >= 1) {
      naiveErrSum += Math.abs(actual - params.values[t - 1]);
      naiveCount++;
    }
  }

  const maeMa = maCount >= 2 ? Number((maErrSum / maCount).toFixed(2)) : null;
  const maeSes = sesCount >= 2 ? Number((sesErrSum / sesCount).toFixed(2)) : null;
  const maeNaive = naiveCount >= 2 ? Number((naiveErrSum / naiveCount).toFixed(2)) : null;

  const selectedModel: 'Simple Exponential Smoothing' | 'Recent-Period Moving Average' =
    maeMa !== null && maeSes !== null && maeMa < maeSes
      ? 'Recent-Period Moving Average'
      : 'Simple Exponential Smoothing';

  // Future horizon projection
  const lastMaForecast = Number(
    (
      params.values.slice(-params.maWindow).reduce((acc, v) => acc + v, 0) /
      params.maWindow
    ).toFixed(2)
  );
  const sesNext = sesRun.nextForecast;
  const primaryPointForecast =
    selectedModel === 'Recent-Period Moving Average' ? lastMaForecast : sesNext;

  const residualVariance =
    residuals.length > 1
      ? residuals.reduce((acc, r) => acc + r * r, 0) / residuals.length
      : Math.max(1, primaryPointForecast * 0.25);
  const residualStd = Math.sqrt(residualVariance);

  const series: ForecastSeriesPoint[] = params.periodKeys.map((pk, idx) => ({
    periodKey: pk,
    label: params.labels[idx],
    actual: params.values[idx],
    movingAveragePred: maFitted[idx],
    sesPred: idx >= 1 ? sesRun.fitted[idx] : undefined,
    naiveBaselinePred: idx >= 1 ? params.values[idx - 1] : undefined,
    isForecastHorizon: false,
  }));

  // Iteratively roll Moving Average for multi-step horizon while SES projects flat level with widening interval
  const rollingValues = [...params.values];
  params.futureKeysAndLabels.forEach((fut, stepIdx) => {
    const rollingMa = Number(
      (
        rollingValues.slice(-params.maWindow).reduce((a, b) => a + b, 0) /
        params.maWindow
      ).toFixed(2)
    );
    const chosenVal =
      selectedModel === 'Recent-Period Moving Average' ? rollingMa : sesNext;
    rollingValues.push(chosenVal);

    const spread = 1.64 * residualStd * Math.sqrt(stepIdx + 1);
    const lower = Math.max(0, Number((chosenVal - spread).toFixed(1)));
    const upper = Number((chosenVal + spread).toFixed(1));

    series.push({
      periodKey: fut.periodKey,
      label: fut.label,
      movingAveragePred: rollingMa,
      sesPred: sesNext,
      naiveBaselinePred: params.values[n - 1],
      lowerBound: lower,
      upperBound: upper,
      isForecastHorizon: true,
    });
  });

  const firstSpread = 1.64 * residualStd;
  const uncertaintyRange: [number, number] = [
    Math.max(0, Number((primaryPointForecast - firstSpread).toFixed(1))),
    Number((primaryPointForecast + firstSpread).toFixed(1)),
  ];

  const isExploratoryMonthly = params.horizonType === 'monthly' && n < 12;

  return {
    horizonType: params.horizonType,
    title: params.title,
    priorityBadge: params.priorityBadge,
    status: isExploratoryMonthly ? 'Exploratory Low Sample' : 'Ready',
    statusMessage: isExploratoryMonthly
      ? `Exploratory monthly projection based on ${n} observed months (<12 months seasonal cycle). Prioritize Weekly Forecast for operational planning.`
      : `Chronologically validated across ${n} periods (Train: ${splitIdx}, Holdout Test: ${n - splitIdx}).`,
    observationsCount: n,
    trainingPeriod: `${params.periodKeys[0]} to ${params.periodKeys[splitIdx - 1]}`,
    forecastHorizonCount: params.futureKeysAndLabels.length,
    selectedModel,
    movingAverageWindow: params.maWindow,
    sesAlpha: alpha,
    maeMovingAverage: maeMa,
    maeSes: maeSes,
    maeNaiveBaseline: maeNaive,
    nextPeriodForecast: Math.round(primaryPointForecast * 10) / 10,
    uncertaintyRange,
    series,
  };
}

/**
 * Generates strictly separated Predictive Analytics output for either:
 * - 'demonstration' mode (using ONLY EvaluatorConsultationRecord[])
 * - 'operational' mode (using ONLY finalized SmartClinic ConsultationRecord[])
 * NEVER merges or cross-contaminates datasets.
 */
export function runPredictiveAnalytics(params: {
  mode: 'demonstration' | 'operational';
  demoRecords: EvaluatorConsultationRecord[];
  operationalConsultations: ConsultationRecord[];
  nowIso?: string;
}): PredictiveAnalyticsOutput {
  const generatedAt = params.nowIso || new Date().toISOString();

  const normalized: NormalizedHistoricalConsultation[] =
    params.mode === 'demonstration'
      ? params.demoRecords
          .filter((r) => r.datasetMode === 'demonstration' && r.consultationStatus === 'Completed')
          .map((r) => ({
            internalId: r.id,
            patientKey: r.sourceExternalPatientRef,
            consultationDate: r.consultationDate,
            appointmentType: r.appointmentType,
            standardizedComplaint: r.standardizedComplaint,
            provenance: 'demonstration' as const,
          }))
      : params.operationalConsultations
          .filter((c) => c.status === 'Finalized')
          .map((c) => ({
            internalId: c.visitId || c.id,
            patientKey: c.patientId,
            consultationDate: c.visitDate,
            appointmentType: c.appointmentType,
            standardizedComplaint:
              c.standardizedComplaint || categorizeChiefComplaint(c.chiefComplaint),
            provenance: 'operational' as const,
          }));

  // Deduplicate strictly by internal consultation/visit ID
  const dedupedMap = new Map<string, NormalizedHistoricalConsultation>();
  for (const item of normalized) {
    if (!dedupedMap.has(item.internalId) && normalizeDateToIso(item.consultationDate)) {
      dedupedMap.set(item.internalId, item);
    }
  }
  const cleanRecords = Array.from(dedupedMap.values()).sort((a, b) =>
    a.consultationDate.localeCompare(b.consultationDate)
  );

  const modeBannerText =
    params.mode === 'demonstration'
      ? 'DEMONSTRATION MODE — EVALUATOR TEST DATA — NOT VALIDATED FOR REAL CLINIC DEMAND'
      : 'OPERATIONAL MODE — VERIFIED SMARTCLINIC COMPLETED CONSULTATIONS';

  const uniquePatients = new Set(cleanRecords.map((r) => r.patientKey)).size;
  const onlineCount = cleanRecords.filter((r) => r.appointmentType === 'Online').length;
  const walkInCount = cleanRecords.filter((r) => r.appointmentType === 'Walk-in').length;
  const dateStart = cleanRecords[0]?.consultationDate || '';
  const dateEnd = cleanRecords[cleanRecords.length - 1]?.consultationDate || '';

  // Distinct weeks check
  const distinctWeeks = new Set(cleanRecords.map((r) => getMondayOfIsoDate(r.consultationDate)));

  if (cleanRecords.length < 15 || distinctWeeks.size < 4) {
    const emptyDaily = evaluateHorizonForecast({
      horizonType: 'daily',
      title: 'Daily Patient Visit Forecast',
      priorityBadge: 'Short-Term Daily',
      periodKeys: [],
      labels: [],
      values: [],
      futureKeysAndLabels: [],
      minObservationsRequired: 14,
      maWindow: 7,
    });
    const emptyWeekly = evaluateHorizonForecast({
      horizonType: 'weekly',
      title: 'Weekly Patient Visit Forecast — Primary',
      priorityBadge: 'Primary Horizon',
      periodKeys: [],
      labels: [],
      values: [],
      futureKeysAndLabels: [],
      minObservationsRequired: 6,
      maWindow: 3,
    });
    const emptyMonthly = evaluateHorizonForecast({
      horizonType: 'monthly',
      title: 'Monthly Patient Visit Forecast — Exploratory',
      priorityBadge: 'Exploratory',
      periodKeys: [],
      labels: [],
      values: [],
      futureKeysAndLabels: [],
      minObservationsRequired: 5,
      maWindow: 3,
    });

    const insufficientMsg =
      params.mode === 'operational'
        ? 'Insufficient Verified Historical Data for Operational Forecasting'
        : cleanRecords.length === 0
          ? 'No Evaluator Demonstration CSV Data Imported Yet'
          : `Insufficient Evaluator Records (${cleanRecords.length} completed consultations across ${distinctWeeks.size} weeks; need >= 15 completed consultations across >= 4 weeks).`;

    return {
      datasetMode: params.mode,
      modeBannerText,
      sufficientData: false,
      insufficientReason: insufficientMsg,
      totalCompletedConsultations: cleanRecords.length,
      uniquePatientsCount: uniquePatients,
      onlineCount,
      walkInCount,
      dateCoverageStart: dateStart,
      dateCoverageEnd: dateEnd,
      generatedAt,
      daily: emptyDaily,
      weekly: emptyWeekly,
      monthly: emptyMonthly,
      complaints: COMPLAINT_CATEGORIES.map((cat) => ({
        category: cat,
        totalHistoricalCount: cleanRecords.filter((r) => r.standardizedComplaint === cat).length,
        sharePct: 0,
        status: 'Historical Trend Only (Low Sample)',
        nextWeekPredicted: null,
        mae: null,
        recentWeeklyCounts: [],
      })),
      operationalInsights:
        params.mode === 'operational'
          ? [
              'Insufficient Verified Historical Data for Operational Forecasting. Continue completing real outpatient consultations to unlock validated operational forecasts.',
            ]
          : [
              'Import your evaluator consultation CSV file in Admin Predictive Analytics to inspect technical backtesting and demonstration forecasts.',
            ],
    };
  }

  // 1. Daily Aggregation (with zero-fill for missing days in the final 45 days for readable daily forecasting)
  const dailyCountsMap = new Map<string, number>();
  for (const r of cleanRecords) {
    dailyCountsMap.set(r.consultationDate, (dailyCountsMap.get(r.consultationDate) || 0) + 1);
  }
  const dailyWindowStart =
    addDaysUtc(dateEnd, -44) > dateStart ? addDaysUtc(dateEnd, -44) : dateStart;
  const dailyKeys: string[] = [];
  const dailyValues: number[] = [];
  for (let d = dailyWindowStart; d <= dateEnd; d = addDaysUtc(d, 1)) {
    dailyKeys.push(d);
    dailyValues.push(dailyCountsMap.get(d) || 0);
  }
  const dailyFuture = Array.from({ length: 7 }, (_, i) => {
    const fk = addDaysUtc(dateEnd, i + 1);
    return { periodKey: fk, label: fk.slice(5) };
  });

  const dailyResult = evaluateHorizonForecast({
    horizonType: 'daily',
    title: 'Daily Patient Visit Forecast',
    priorityBadge: '7-Day Horizon',
    periodKeys: dailyKeys,
    labels: dailyKeys.map((k) => k.slice(5)),
    values: dailyValues,
    futureKeysAndLabels: dailyFuture,
    minObservationsRequired: 14,
    maWindow: 7,
  });

  // 2. Weekly Aggregation (Primary — Continuous Monday-anchored weeks with zero-fill)
  const firstMonday = getMondayOfIsoDate(dateStart);
  const lastMonday = getMondayOfIsoDate(dateEnd);
  const weeklyCountsMap = new Map<string, number>();
  for (const r of cleanRecords) {
    const wk = getMondayOfIsoDate(r.consultationDate);
    weeklyCountsMap.set(wk, (weeklyCountsMap.get(wk) || 0) + 1);
  }
  const weeklyKeys: string[] = [];
  const weeklyValues: number[] = [];
  for (let wk = firstMonday; wk <= lastMonday; wk = addDaysUtc(wk, 7)) {
    weeklyKeys.push(wk);
    weeklyValues.push(weeklyCountsMap.get(wk) || 0);
  }
  const weeklyFuture = Array.from({ length: 4 }, (_, i) => {
    const fk = addDaysUtc(lastMonday, (i + 1) * 7);
    return { periodKey: fk, label: `Wk ${fk.slice(5)}` };
  });

  const weeklyResult = evaluateHorizonForecast({
    horizonType: 'weekly',
    title: 'Weekly Patient Visit Forecast — Primary',
    priorityBadge: 'Primary Model',
    periodKeys: weeklyKeys,
    labels: weeklyKeys.map((k) => `Wk ${k.slice(5)}`),
    values: weeklyValues,
    futureKeysAndLabels: weeklyFuture,
    minObservationsRequired: 6,
    maWindow: 3,
  });

  // 3. Monthly Aggregation (Exploratory — Continuous YYYY-MM with zero-fill)
  const firstMonth = dateStart.slice(0, 7);
  const lastMonth = dateEnd.slice(0, 7);
  const monthlyCountsMap = new Map<string, number>();
  for (const r of cleanRecords) {
    const ym = r.consultationDate.slice(0, 7);
    monthlyCountsMap.set(ym, (monthlyCountsMap.get(ym) || 0) + 1);
  }
  const monthlyKeys: string[] = [];
  const monthlyValues: number[] = [];
  for (let ym = firstMonth; ym <= lastMonth; ym = addMonthsUtc(ym, 1)) {
    monthlyKeys.push(ym);
    monthlyValues.push(monthlyCountsMap.get(ym) || 0);
  }
  const monthlyFuture = Array.from({ length: 2 }, (_, i) => {
    const fk = addMonthsUtc(lastMonth, i + 1);
    return { periodKey: fk, label: fk };
  });

  const monthlyResult = evaluateHorizonForecast({
    horizonType: 'monthly',
    title: 'Monthly Patient Visit Forecast — Exploratory',
    priorityBadge: 'Exploratory Horizon',
    periodKeys: monthlyKeys,
    labels: monthlyKeys,
    values: monthlyValues,
    futureKeysAndLabels: monthlyFuture,
    minObservationsRequired: 5,
    maWindow: 3,
  });

  // 4. Standardized Chief Complaint-Based Forecast
  const complaints: ComplaintForecastSummary[] = COMPLAINT_CATEGORIES.map((category) => {
    const catRecords = cleanRecords.filter((r) => r.standardizedComplaint === category);
    const totalCount = catRecords.length;
    const sharePct = Number(((totalCount / cleanRecords.length) * 100).toFixed(1));

    const catWeeklyMap = new Map<string, number>();
    for (const r of catRecords) {
      const wk = getMondayOfIsoDate(r.consultationDate);
      catWeeklyMap.set(wk, (catWeeklyMap.get(wk) || 0) + 1);
    }

    const catWeeklyValues = weeklyKeys.map((wk) => catWeeklyMap.get(wk) || 0);
    const recentWeeklyCounts = weeklyKeys.slice(-8).map((wk) => ({
      week: wk.slice(5),
      count: catWeeklyMap.get(wk) || 0,
    }));

    const nonZeroWeeks = catWeeklyValues.filter((v) => v > 0).length;
    if (totalCount >= 12 && nonZeroWeeks >= 5 && weeklyKeys.length >= 6) {
      const evalCat = evaluateHorizonForecast({
        horizonType: 'weekly',
        title: `${category} Weekly`,
        priorityBadge: 'Complaint',
        periodKeys: weeklyKeys,
        labels: weeklyKeys,
        values: catWeeklyValues,
        futureKeysAndLabels: [{ periodKey: addDaysUtc(lastMonday, 7), label: 'Next Wk' }],
        minObservationsRequired: 6,
        maWindow: 3,
      });
      return {
        category,
        totalHistoricalCount: totalCount,
        sharePct,
        status: 'Forecast Available',
        nextWeekPredicted: evalCat.nextPeriodForecast,
        mae:
          evalCat.selectedModel === 'Recent-Period Moving Average'
            ? evalCat.maeMovingAverage
            : evalCat.maeSes,
        recentWeeklyCounts,
      };
    }

    return {
      category,
      totalHistoricalCount: totalCount,
      sharePct,
      status: 'Historical Trend Only (Low Sample)',
      nextWeekPredicted: null,
      mae: null,
      recentWeeklyCounts,
    };
  });

  // 5. Cautious Healthcare Management Insights
  const insights: string[] = [];
  if (params.mode === 'demonstration') {
    insights.push(
      'Demonstration Dataset Notice: Forecasts below reflect imported evaluator test records for technical methodology demonstration only. Do not alter real clinical staffing solely from evaluator data.'
    );
  }
  if (weeklyResult.nextPeriodForecast !== null) {
    const avgWeekly =
      weeklyValues.reduce((acc, v) => acc + v, 0) / Math.max(1, weeklyValues.length);
    if (weeklyResult.nextPeriodForecast > avgWeekly * 1.15) {
      insights.push(
        `Review available Doctor capacity and Nurse intake coverage: projected next-week volume (${weeklyResult.nextPeriodForecast} visits) exceeds the historical weekly mean (${avgWeekly.toFixed(1)} visits).`
      );
    } else {
      insights.push(
        `Projected next-week demand (${weeklyResult.nextPeriodForecast} visits) aligns closely with historical weekly baseline (${avgWeekly.toFixed(1)} visits); current Doctor schedule blocks appear balanced.`
      );
    }
  }

  const walkInShare = Math.round((walkInCount / cleanRecords.length) * 100);
  if (walkInShare >= 45) {
    insights.push(
      `Walk-in visits represent ${walkInShare}% of completed consultations. Consider maintaining dedicated front-desk triage buffers and promoting online QR pre-booking to smooth morning queue peaks.`
    );
  } else {
    insights.push(
      `Online scheduled appointments account for ${100 - walkInShare}% of completed consultations. Continue monitoring appointment attendance against completed encounters.`
    );
  }

  const topComplaint = [...complaints].sort(
    (a, b) => b.totalHistoricalCount - a.totalHistoricalCount
  )[0];
  if (topComplaint && topComplaint.totalHistoricalCount > 0) {
    insights.push(
      `Monitor recurring "${topComplaint.category}" presentations (${topComplaint.sharePct}% of recorded primary complaints) so nursing assessment checklists and pharmacy stock remain prepared.`
    );
  }

  return {
    datasetMode: params.mode,
    modeBannerText,
    sufficientData: true,
    insufficientReason: '',
    totalCompletedConsultations: cleanRecords.length,
    uniquePatientsCount: uniquePatients,
    onlineCount,
    walkInCount,
    dateCoverageStart: dateStart,
    dateCoverageEnd: dateEnd,
    generatedAt,
    daily: dailyResult,
    weekly: weeklyResult,
    monthly: monthlyResult,
    complaints,
    operationalInsights: insights,
  };
}
