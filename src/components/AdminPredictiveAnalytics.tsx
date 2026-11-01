import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import { runPredictiveAnalytics } from '../utils/forecasting';
import type { ConsultationRecord, EvaluatorImportBatch } from '../types/clinic';

export const AdminPredictiveAnalytics: React.FC = () => {
  const {
    evaluatorRecords,
    evaluatorImports,
    operationalAnalyticsEvents,
    consultations,
    importEvaluatorCsvAction,
    clearEvaluatorDatasetAction,
  } = useClinic();

  const [datasetMode, setDatasetMode] = useState<'operational' | 'demonstration'>('operational');
  const [activeHorizonTab, setActiveHorizonTab] = useState<'weekly' | 'daily' | 'monthly'>('weekly');
  const [importBusy, setImportBusy] = useState(false);
  const [lastImportBatch, setLastImportBatch] = useState<EvaluatorImportBatch | null>(null);
  const [importError, setImportError] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Build de-identified operational consultation records without exposing clinical notes
  const verifiedOperationalConsultations: ConsultationRecord[] = useMemo(() => {
    const map = new Map<string, ConsultationRecord>();
    for (const ev of operationalAnalyticsEvents) {
      map.set(ev.visitId, {
        id: ev.visitId,
        visitId: ev.visitId,
        patientId: ev.patientId,
        portalUserId: '',
        patientName: '',
        visitDate: ev.consultationDate,
        appointmentType: ev.appointmentType,
        doctorUid: '',
        doctorName: '',
        doctorTitle: '',
        chiefComplaint: ev.standardizedComplaint,
        standardizedComplaint: ev.standardizedComplaint,
        clinicalFindings: '',
        diagnosis: '',
        diagnosisType: 'Final Diagnosis',
        treatmentPlan: '',
        patientInstructions: '',
        status: 'Finalized',
        finalizedAt: '',
        amendments: [],
        patientVisible: false,
        authorizedViewerUids: [],
        createdAt: '',
        updatedAt: '',
      });
    }
    for (const c of consultations) {
      if (c.status === 'Finalized' && !map.has(c.visitId)) {
        map.set(c.visitId, c);
      }
    }
    return Array.from(map.values());
  }, [operationalAnalyticsEvents, consultations]);

  const analyticsOutput = useMemo(
    () =>
      runPredictiveAnalytics({
        mode: datasetMode,
        demoRecords: evaluatorRecords,
        operationalConsultations: verifiedOperationalConsultations,
      }),
    [datasetMode, evaluatorRecords, verifiedOperationalConsultations]
  );

  const selectedHorizon =
    activeHorizonTab === 'weekly'
      ? analyticsOutput.weekly
      : activeHorizonTab === 'daily'
      ? analyticsOutput.daily
      : analyticsOutput.monthly;

  const handleCsvFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportBusy(true);
    try {
      const content = await file.text();
      const res = await importEvaluatorCsvAction({
        csvContent: content,
        fileName: file.name,
      });
      if (!res.ok) {
        setImportError(res.error || 'CSV validation failed.');
      } else if (res.batch) {
        setLastImportBatch(res.batch);
        setDatasetMode('demonstration');
      }
    } catch (err: any) {
      setImportError(err?.message || 'Error reading CSV file.');
    } finally {
      setImportBusy(false);
      e.target.value = '';
    }
  };

  const handleDownloadHeaderTemplate = () => {
    const headerOnly =
      'Consultation Date,Patient ID,Consultation Status,Chief Complaint,Appointment Type,Doctor\'s Diagnosis\n';
    const blob = new Blob([headerOnly], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SmartClinic_Evaluator_Template_HeadersOnly.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header & Strict Dataset Mode Switcher */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            Outpatient Statistical Forecasting Engine
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
            Predictive Analytics &amp; Demand Forecasting
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Powered by chronological Moving Average and Simple Exponential Smoothing with holdout
            backtesting (MAE). Operational clinic records and Evaluator Demonstration CSV data are
            strictly isolated and never merged.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Analytics Dataset Mode"
          className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={datasetMode === 'operational'}
            onClick={() => setDatasetMode('operational')}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              datasetMode === 'operational'
                ? 'bg-blue-700 text-white'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Operational Mode ({verifiedOperationalConsultations.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={datasetMode === 'demonstration'}
            onClick={() => setDatasetMode('demonstration')}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              datasetMode === 'demonstration'
                ? 'bg-amber-600 text-white'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Demonstration Mode ({evaluatorRecords.length})
          </button>
        </div>
      </div>

      {/* Mandatory Mode Provenance Banner */}
      <div
        data-testid="analytics-mode-banner"
        className={`rounded-xl border p-4 text-xs font-semibold tracking-wide ${
          datasetMode === 'demonstration'
            ? 'border-amber-300 bg-amber-50 text-amber-950'
            : 'border-blue-200 bg-blue-50/70 text-blue-950'
        }`}
      >
        <div className="flex items-center gap-2">
          {datasetMode === 'demonstration' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
          ) : (
            <Database className="h-4 w-4 shrink-0 text-blue-700" />
          )}
          <span>{analyticsOutput.modeBannerText}</span>
        </div>
      </div>

      {/* Evaluator CSV Import Panel (Shown in Demonstration Mode) */}
      {datasetMode === 'demonstration' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Evaluator Historical CSV Importer (Demonstration Dataset Only)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Required columns: <code>Consultation Date</code>, <code>Patient ID</code>,{' '}
                <code>Consultation Status</code>, <code>Chief Complaint</code>,{' '}
                <code>Appointment Type</code>, <code>Doctor&apos;s Diagnosis</code>. Imported rows
                never create real Patients or operational clinical visits.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadHeaderTemplate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download Empty CSV Header Template
              </button>

              <label className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer">
                <FileUp className="h-3.5 w-3.5" />
                <span>{importBusy ? 'Validating CSV...' : 'Import Evaluator CSV'}</span>
                <input
                  type="file"
                  aria-label="Upload Evaluator CSV file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileSelect}
                  className="hidden"
                />
              </label>

              {evaluatorRecords.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear Demo Data
                </button>
              )}
            </div>
          </div>

          {confirmClearOpen && (
            <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              <span>Remove all imported Evaluator Demonstration records?</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await clearEvaluatorDatasetAction();
                    setLastImportBatch(null);
                    setConfirmClearOpen(false);
                  }}
                  className="rounded-md bg-rose-700 px-3 py-1 font-semibold text-white"
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {importError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              {importError}
            </div>
          )}

          {lastImportBatch && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950 space-y-1 tabular-nums">
              <p className="font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                CSV Validation Summary ({lastImportBatch.fileName})
              </p>
              <p>
                Total Rows Read: <strong>{lastImportBatch.totalRowsRead}</strong> · Valid Completed
                Consultations Imported: <strong>{lastImportBatch.validCompletedImported}</strong> ·
                Non-Completed Skipped: <strong>{lastImportBatch.skippedNonCompleted}</strong> ·
                Duplicates Skipped: <strong>{lastImportBatch.duplicateRowsSkipped}</strong> ·
                Invalid Rows Rejected: <strong>{lastImportBatch.invalidRowsRejected}</strong>
              </p>
            </div>
          )}

          {evaluatorImports.length > 0 && (
            <div className="text-xs text-slate-500 tabular-nums">
              Import Batches Logged: {evaluatorImports.length} · Latest Range:{' '}
              {analyticsOutput.dateCoverageStart || 'N/A'} to{' '}
              {analyticsOutput.dateCoverageEnd || 'N/A'}
            </div>
          )}
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Completed Consultations</p>
          <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {analyticsOutput.totalCompletedConsultations}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {analyticsOutput.uniquePatientsCount} unique patient keys
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Online vs Walk-In Split</p>
          <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {analyticsOutput.onlineCount} / {analyticsOutput.walkInCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Online Scheduled · Walk-In Encounters
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">
            Next-Week Forecast (Primary)
          </p>
          <p className="mt-2 font-display text-2xl font-bold text-blue-700 tabular-nums">
            {analyticsOutput.weekly.nextPeriodForecast !== null
              ? `${analyticsOutput.weekly.nextPeriodForecast} visits`
              : 'Insufficient Data'}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {analyticsOutput.weekly.uncertaintyRange
              ? `90% Band: ${analyticsOutput.weekly.uncertaintyRange[0]} – ${analyticsOutput.weekly.uncertaintyRange[1]}`
              : 'Requires >= 4 chronological weeks'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Primary Holdout MAE</p>
          <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {analyticsOutput.weekly.maeSes !== null ||
            analyticsOutput.weekly.maeMovingAverage !== null
              ? `${
                  analyticsOutput.weekly.selectedModel === 'Recent-Period Moving Average'
                    ? analyticsOutput.weekly.maeMovingAverage
                    : analyticsOutput.weekly.maeSes
                } visits`
              : 'Not Yet Computed'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {analyticsOutput.weekly.selectedModel}
          </p>
        </div>
      </div>

      {/* Honest Insufficient Historical Data State vs Validated Forecast Charts */}
      {!analyticsOutput.sufficientData ? (
        <div
          data-testid="insufficient-forecast-state"
          className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-3"
        >
          <BarChart3 className="mx-auto h-9 w-9 text-blue-700" />
          <h2 className="font-display text-xl font-bold text-slate-900">
            {analyticsOutput.insufficientReason}
          </h2>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-slate-600">
            {datasetMode === 'operational'
              ? 'SmartClinic never fabricates historical consultations or fake forecast accuracy on a fresh clinic database. Operational forecasting activates automatically once your clinicians finalize at least 15 real consultations spanning 4 or more calendar weeks.'
              : 'No evaluator historical records meet the minimum multi-week threshold yet. Use the Import Evaluator CSV button above to load your historical consultation test dataset into Demonstration Mode.'}
          </p>
        </div>
      ) : (
        <>
          {/* Horizon Selector & Actual vs Predicted Recharts Visualization */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  {selectedHorizon.title}
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  {selectedHorizon.statusMessage} · Selected Model:{' '}
                  <strong>{selectedHorizon.selectedModel}</strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                {(
                  [
                    { id: 'weekly', label: 'Weekly Forecast (Primary)' },
                    { id: 'daily', label: 'Daily Forecast (7-Day)' },
                    { id: 'monthly', label: 'Monthly (Exploratory)' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveHorizonTab(tab.id)}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      activeHorizonTab === tab.id
                        ? 'bg-blue-700 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedHorizon.status === 'Insufficient Data' ? (
              <div className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-600">
                {selectedHorizon.statusMessage}
              </div>
            ) : (
              <div className="h-80 w-full" data-testid="forecast-chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={selectedHorizon.series}
                    margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="actual"
                      name="Actual Completed Visits"
                      fill="#1D4ED8"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={34}
                    />
                    <Line
                      type="monotone"
                      dataKey="sesPred"
                      name="Simple Exponential Smoothing"
                      stroke="#0F766E"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="movingAveragePred"
                      name={`Moving Average (${selectedHorizon.movingAverageWindow}-period)`}
                      stroke="#D97706"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Chronological Backtesting Model Comparison Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 font-semibold text-slate-700">
                  <tr>
                    <th className="px-4 py-2.5">Forecast Horizon</th>
                    <th className="px-4 py-2.5">Observations</th>
                    <th className="px-4 py-2.5">Training Window</th>
                    <th className="px-4 py-2.5 text-right">Moving Avg MAE</th>
                    <th className="px-4 py-2.5 text-right">Exp. Smoothing MAE</th>
                    <th className="px-4 py-2.5 text-right">Naive Baseline MAE</th>
                    <th className="px-4 py-2.5 text-right">Next-Period Projection</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {[analyticsOutput.weekly, analyticsOutput.daily, analyticsOutput.monthly].map(
                    (h) => (
                      <tr key={h.horizonType}>
                        <td className="px-4 py-2.5 font-semibold text-slate-900">
                          {h.title} ({h.status})
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{h.observationsCount}</td>
                        <td className="px-4 py-2.5 text-slate-600">{h.trainingPeriod}</td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {h.maeMovingAverage !== null ? h.maeMovingAverage.toFixed(2) : 'N/A'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {h.maeSes !== null ? h.maeSes.toFixed(2) : 'N/A'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                          {h.maeNaiveBaseline !== null ? h.maeNaiveBaseline.toFixed(2) : 'N/A'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-blue-700">
                          {h.nextPeriodForecast !== null ? `${h.nextPeriodForecast} visits` : 'N/A'}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Standardized Chief Complaint Forecast & Cautious Insights */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Standardized Chief Complaint Demand Breakdown
                </h2>
                <p className="text-xs text-slate-500">
                  Categories with sparse weekly volume report historical trend only rather than
                  unstable point predictions.
                </p>
              </div>

              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analyticsOutput.complaints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} allowDecimals={false} />
                    <Tooltip />
                    <Bar
                      dataKey="totalHistoricalCount"
                      name="Historical Consultations"
                      fill="#1D4ED8"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 font-semibold text-slate-700">
                    <tr>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2 text-right">Volume (Share)</th>
                      <th className="px-3 py-2">Model Eligibility</th>
                      <th className="px-3 py-2 text-right">Next Week Est.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {analyticsOutput.complaints.map((c) => (
                      <tr key={c.category}>
                        <td className="px-3 py-2 font-semibold text-slate-900">{c.category}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {c.totalHistoricalCount} ({c.sharePct}%)
                        </td>
                        <td className="px-3 py-2 text-slate-600">{c.status}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-blue-700">
                          {c.nextWeekPredicted !== null ? `${c.nextWeekPredicted}` : 'Trend Only'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-700" />
                <h2 className="font-display text-base font-bold text-slate-900">
                  Cautious Operational Planning Insights
                </h2>
              </div>
              <p className="text-xs text-slate-500">
                Derived directly from calculated statistical outputs to support outpatient doctor
                scheduling, nursing triage readiness, and pharmacy inventory review.
              </p>
              <ul className="space-y-3">
                {analyticsOutput.operationalInsights.map((insight, idx) => (
                  <li
                    key={idx}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700"
                  >
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
