import React, { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, CreditCard, FileCheck2, ShieldCheck } from 'lucide-react';
import type { PatientGuideSectionItem } from '../types/clinic';

interface PatientGuideViewProps {
  guides: PatientGuideSectionItem[];
  compactHeader?: boolean;
}

const SECTION_META: Record<
  PatientGuideSectionItem['sectionKey'],
  { label: string; subtitle: string; icon: React.ComponentType<{ className?: string }> }
> = {
  hmo: {
    label: 'HMO / Health Card Guidelines',
    subtitle: 'Accepted verification steps, required LOA documents, and outpatient coverage boundaries',
    icon: CreditCard,
  },
  philhealth: {
    label: 'PhilHealth Guidelines',
    subtitle: 'Outpatient membership verification, MDR preparation, and benefit scope transparency',
    icon: FileCheck2,
  },
  privacy: {
    label: 'Privacy & Transparency',
    subtitle: 'Role-based clinical confidentiality, QR privacy safeguards, and patient data rights',
    icon: ShieldCheck,
  },
  clinic_guides: {
    label: 'Clinic Patient Guides',
    subtitle: 'Step-by-step arrival, online booking, rescheduling policies, and lab/pharmacy pickup',
    icon: BookOpen,
  },
};

export const PatientGuideView: React.FC<PatientGuideViewProps> = ({
  guides,
  compactHeader = false,
}) => {
  const [activeSection, setActiveSection] = useState<'all' | PatientGuideSectionItem['sectionKey']>('all');

  const publishedGuides = useMemo(
    () => guides.filter((g) => g.published).sort((a, b) => a.sortOrder - b.sortOrder),
    [guides]
  );

  const visibleGuides = useMemo(() => {
    if (activeSection === 'all') return publishedGuides;
    return publishedGuides.filter((g) => g.sectionKey === activeSection);
  }, [publishedGuides, activeSection]);

  return (
    <div className="space-y-6">
      {!compactHeader && (
        <div className="border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            Outpatient Information & Transparency Center
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Patient Guide Center
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            Clear, plain-language guidance on HMO and PhilHealth manual verification, outpatient clinic
            preparation, rescheduling rules, and how SmartClinic protects your medical records.
          </p>
        </div>
      )}

      {/* Section Filter Tabs */}
      <div
        role="tablist"
        aria-label="Patient Guide Categories"
        className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'all'}
          onClick={() => setActiveSection('all')}
          className={`whitespace-nowrap shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
            activeSection === 'all'
              ? 'bg-blue-700 text-white'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          All Sections ({publishedGuides.length})
        </button>
        {(Object.keys(SECTION_META) as PatientGuideSectionItem['sectionKey'][]).map((key) => {
          const meta = SECTION_META[key];
          const count = publishedGuides.filter((g) => g.sectionKey === key).length;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeSection === key}
              onClick={() => setActiveSection(key)}
              className={`whitespace-nowrap shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                activeSection === key
                  ? 'bg-blue-700 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {meta.label} ({count})
            </button>
          );
        })}
      </div>

      {visibleGuides.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-900">No published guides in this section yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Clinic Administration can publish and update Patient Guide articles at any time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {visibleGuides.map((guide) => {
            const meta = SECTION_META[guide.sectionKey];
            const Icon = meta.icon;
            return (
              <article
                key={guide.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-xs"
              >
                <div>
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-blue-700">
                      <Icon className="h-4 w-4 shrink-0" />
                      {guide.sectionTitle}
                    </span>
                    <span className="tabular-nums">Last updated {guide.lastUpdated}</span>
                  </div>

                  <h2 className="mt-3 font-display text-lg font-semibold text-slate-900">
                    {guide.topicTitle}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{guide.summary}</p>

                  {guide.bulletPoints.length > 0 && (
                    <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                      {guide.bulletPoints.map((pt, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-sm text-slate-700">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {guide.importantNotice && (
                  <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium text-slate-800">
                      Important Note: <span className="font-normal text-slate-600">{guide.importantNotice}</span>
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
