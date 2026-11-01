import React, { useMemo, useState } from 'react';
import { Bell, Check, ExternalLink, X } from 'lucide-react';
import type { ClinicNotification } from '../types/clinic';

interface NotificationBellProps {
  notifications: ClinicNotification[];
  onMarkRead: (id: string) => Promise<void>;
  onNavigate: (path: string) => void;
  onOpenFullCenter?: () => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  notifications,
  onMarkRead,
  onNavigate,
  onOpenFullCenter,
}) => {
  const [open, setOpen] = useState(false);
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications (${unreadCount} unread)`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-700 px-1 text-[10px] font-bold text-white tabular-nums">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Recent Notifications"
            className="absolute right-0 z-40 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">In-App Notifications</h3>
                <p className="text-xs text-slate-500 tabular-nums">
                  {unreadCount} unread · {notifications.length} total
                </p>
              </div>
              <button
                type="button"
                aria-label="Close notifications menu"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-500">
                  No notifications yet. Appointment confirmations, 24-hour reminders, and released
                  clinical documents will appear here.
                </div>
              ) : (
                notifications.slice(0, 8).map((n) => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 transition-colors ${
                      n.read ? 'bg-white' : 'bg-blue-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                      <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                        {n.createdAt ? n.createdAt.slice(0, 16).replace('T', ' ') : ''}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{n.safeSummary}</p>
                    <div className="mt-2 flex items-center gap-3">
                      {n.viewPath && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!n.read) await onMarkRead(n.id);
                            setOpen(false);
                            onNavigate(n.viewPath);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
                        >
                          View Details
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}
                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => onMarkRead(n.id)}
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 whitespace-nowrap shrink-0"
                        >
                          <Check className="h-3 w-3" />
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {onOpenFullCenter && (
              <div className="border-t border-slate-100 px-4 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenFullCenter();
                  }}
                  className="text-xs font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap"
                >
                  Open Notification History
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

interface NotificationToastStackProps {
  notifications: ClinicNotification[];
  onDismissPopup: (id: string) => Promise<void>;
  onMarkRead: (id: string) => Promise<void>;
  onNavigate: (path: string) => void;
}

export const NotificationToastStack: React.FC<NotificationToastStackProps> = ({
  notifications,
  onDismissPopup,
  onMarkRead,
  onNavigate,
}) => {
  const activePopups = useMemo(
    () =>
      notifications
        .filter((n) => n.importantPopup && !n.popupDismissed && !n.read)
        .slice(0, 2),
    [notifications]
  );

  if (activePopups.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="no-print pointer-events-none fixed top-20 right-4 z-40 flex w-full max-w-sm flex-col gap-2.5"
    >
      {activePopups.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-blue-700">Clinic Update</p>
              <h4 className="mt-0.5 text-sm font-semibold text-slate-900">{item.title}</h4>
            </div>
            <button
              type="button"
              aria-label={`Dismiss ${item.title}`}
              onClick={() => onDismissPopup(item.id)}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{item.safeSummary}</p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onDismissPopup(item.id)}
              className="whitespace-nowrap shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Dismiss
            </button>
            {item.viewPath && (
              <button
                type="button"
                onClick={async () => {
                  await onDismissPopup(item.id);
                  await onMarkRead(item.id);
                  onNavigate(item.viewPath);
                }}
                className="whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
              >
                View Details
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

interface NotificationHistoryViewProps {
  notifications: ClinicNotification[];
  onMarkRead: (id: string) => Promise<void>;
  onNavigate: (path: string) => void;
}

export const NotificationHistoryView: React.FC<NotificationHistoryViewProps> = ({
  notifications,
  onMarkRead,
  onNavigate,
}) => {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const filtered = useMemo(
    () => (filter === 'unread' ? notifications.filter((n) => !n.read) : notifications),
    [notifications, filter]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">Notification Center</h2>
          <p className="text-sm text-slate-600">
            Database-backed clinic alerts, 24-hour appointment reminders, and document release updates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`whitespace-nowrap shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === 'all'
                ? 'bg-blue-700 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('unread')}
            className={`whitespace-nowrap shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === 'unread'
                ? 'bg-blue-700 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Unread ({notifications.filter((n) => !n.read).length})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No notifications match the current filter.
        </div>
      ) : (
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {filtered.map((n) => (
            <div
              key={n.id}
              className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between ${
                n.read ? 'bg-white' : 'bg-blue-50/30'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className={n.read ? 'text-slate-500' : 'font-semibold text-blue-700'}>
                    {n.read ? 'Read' : 'Unread'}
                  </span>
                  <span>·</span>
                  <span>{n.relatedRecordType || 'System Notice'}</span>
                  <span>·</span>
                  <span className="tabular-nums">
                    {n.createdAt ? n.createdAt.slice(0, 16).replace('T', ' ') : ''}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-900">{n.title}</h3>
                <p className="text-sm text-slate-600">{n.safeSummary}</p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-center">
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => onMarkRead(n.id)}
                    className="whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Mark as Read
                  </button>
                )}
                {n.viewPath && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!n.read) await onMarkRead(n.id);
                      onNavigate(n.viewPath);
                    }}
                    className="whitespace-nowrap shrink-0 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
                  >
                    Open Record
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
