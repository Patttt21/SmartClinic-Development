import React, { useState } from 'react';
import { LogOut, Menu, ShieldCheck, Stethoscope, X } from 'lucide-react';
import { useClinic } from '../services/clinicStore';
import { NotificationBell, NotificationToastStack } from './NotificationCenter';

export interface StaffNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
}

interface StaffShellProps {
  roleLabel: string;
  navItems: StaffNavItem[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}

export const StaffShell: React.FC<StaffShellProps> = ({
  roleLabel,
  navItems,
  activeTab,
  onSelectTab,
  onNavigate,
  children,
}) => {
  const {
    staffAccount,
    notifications,
    markNotificationReadAction,
    dismissNotificationPopupAction,
    logoutAction,
  } = useClinic();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Stethoscope className="h-4 w-4" />
          </div>
          <div>
            <span className="block font-display text-base font-bold text-slate-900 leading-none">
              SmartClinic
            </span>
            <span className="block text-[11px] font-medium text-blue-700 mt-0.5">
              {roleLabel}
            </span>
          </div>
        </div>

        <nav aria-label={`${roleLabel} Navigation`} className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                  <span className="font-mono text-xs font-bold text-blue-700 tabular-nums">
                    {item.badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3 space-y-2">
          <div className="flex items-center gap-2 px-3 py-1 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span className="truncate">TOTP 2FA Session Active</span>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logoutAction();
              onNavigate('/staff/login');
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open staff menu"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden rounded-lg border border-slate-200 p-2 text-slate-700"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {staffAccount?.fullName || roleLabel}
              </p>
              <p className="text-xs text-slate-500">
                {staffAccount?.titleDisplay || roleLabel} · {staffAccount?.department || 'Outpatient Operations'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <NotificationBell
              notifications={notifications}
              onMarkRead={markNotificationReadAction}
              onNavigate={onNavigate}
              onOpenFullCenter={() => onSelectTab('notifications')}
            />
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-900/50"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <div className="relative z-50 flex w-72 flex-col bg-white p-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-display text-base font-bold text-slate-900">{roleLabel}</span>
                <button
                  type="button"
                  aria-label="Close staff menu"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg p-1.5 text-slate-500"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="mt-3 flex-1 overflow-y-auto space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setMobileOpen(false);
                        onSelectTab(item.id);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                        activeTab === item.id
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.label}</span>
                      </span>
                      {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                        <span className="font-mono text-xs font-bold text-blue-700 tabular-nums">
                          {item.badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
              <button
                type="button"
                onClick={async () => {
                  setMobileOpen(false);
                  await logoutAction();
                  onNavigate('/staff/login');
                }}
                className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-rose-700"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>
      </div>

      <NotificationToastStack
        notifications={notifications}
        onDismissPopup={dismissNotificationPopupAction}
        onMarkRead={markNotificationReadAction}
        onNavigate={onNavigate}
      />
    </div>
  );
};
