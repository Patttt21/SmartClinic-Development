/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useCallback, useEffect, useState } from 'react';
import { ClinicProvider, useClinic } from './services/clinicStore';
import { PublicWebsite } from './components/PublicWebsite';
import { PatientAuthView, StaffLoginView } from './components/AuthViews';
import { PatientPortal } from './components/PatientPortal';
import { StaffReceptionist } from './components/StaffReceptionist';
import { StaffNurse } from './components/StaffNurse';
import { StaffDoctor } from './components/StaffDoctor';
import { StaffLaboratory } from './components/StaffLaboratory';
import { StaffPharmacy } from './components/StaffPharmacy';
import { StaffAdmin } from './components/StaffAdmin';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-6 space-y-3">
            <h1 className="font-display text-lg font-bold text-slate-900">
              SmartClinic Runtime Error
            </h1>
            <p className="text-xs text-slate-600 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white"
            >
              Return to Clinic Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function normalizePathname(rawPath: string): string {
  const clean = rawPath.split('?')[0].replace(/\/+$/, '');
  return clean || '/';
}

interface SmartClinicRouterProps {
  currentPath: string;
  navigate: (nextPath: string) => void;
}

const SmartClinicRouter: React.FC<SmartClinicRouterProps> = ({ currentPath, navigate }) => {
  const {
    authReady,
    isTestFixture,
    firebaseUser,
    patientAccount,
    staffAccount,
    mfaSessionVerified,
    switchFixturePersona,
  } = useClinic();

  // Auto-initialize matching localhost test fixture persona ONLY when ?testFixture=1 is passed (unless lockRole is set)
  useEffect(() => {
    if (!isTestFixture || !switchFixturePersona) return;
    const lockedRole =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('lockRole')
        : null;
    if (lockedRole) {
      const validRoles = ['patient', 'receptionist', 'nurse', 'doctor', 'laboratory', 'pharmacist', 'admin'];
      if (validRoles.includes(lockedRole)) {
        if (lockedRole === 'patient' && !patientAccount) {
          switchFixturePersona('patient');
        } else if (lockedRole !== 'patient' && staffAccount?.role !== lockedRole) {
          switchFixturePersona(lockedRole as any);
        }
      }
      return;
    }

    if (currentPath.startsWith('/patient/') && !patientAccount) {
      switchFixturePersona('patient');
    } else if (currentPath.startsWith('/staff/receptionist') && staffAccount?.role !== 'receptionist') {
      switchFixturePersona('receptionist');
    } else if (currentPath.startsWith('/staff/nurse') && staffAccount?.role !== 'nurse') {
      switchFixturePersona('nurse');
    } else if (currentPath.startsWith('/staff/doctor') && staffAccount?.role !== 'doctor') {
      switchFixturePersona('doctor');
    } else if (currentPath.startsWith('/staff/laboratory') && staffAccount?.role !== 'laboratory') {
      switchFixturePersona('laboratory');
    } else if (currentPath.startsWith('/staff/pharmacy') && staffAccount?.role !== 'pharmacist') {
      switchFixturePersona('pharmacist');
    } else if (currentPath.startsWith('/staff/admin') && staffAccount?.role !== 'admin') {
      switchFixturePersona('admin');
    }
  }, [isTestFixture, currentPath, patientAccount, staffAccount, switchFixturePersona]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-2">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-700" />
          <p className="text-xs font-medium text-slate-600">
            Initializing SmartClinic Security &amp; Real-Time Sync...
          </p>
        </div>
      </div>
    );
  }

  // 1. Unified Staff Portal Login & Mandatory 2FA Gate (/staff or /staff/login)
  if (currentPath === '/staff/login' || currentPath === '/staff') {
    return <StaffLoginView onNavigate={navigate} />;
  }

  // 2. Protected Staff Dashboards (Enforces verified Staff Account + Active Status + Mandatory TOTP Session)
  if (currentPath.startsWith('/staff/')) {
    if (!firebaseUser || !staffAccount || !staffAccount.active || !mfaSessionVerified) {
      return <StaffLoginView onNavigate={navigate} />;
    }

    const expectedPrefix =
      staffAccount.role === 'pharmacist'
        ? '/staff/pharmacy'
        : `/staff/${staffAccount.role}`;

    if (!currentPath.startsWith(expectedPrefix)) {
      // Strict RBAC route isolation: staff cannot access another role's clinical dashboard
      const target = `${expectedPrefix}/dashboard`;
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-4">
            <h1 className="font-display text-lg font-bold text-slate-900">
              Role-Restricted Clinical Module
            </h1>
            <p className="text-xs text-slate-600">
              Your authenticated role (<strong className="uppercase">{staffAccount.role}</strong>) is
              authorized only for its designated outpatient workspace.
            </p>
            <button
              type="button"
              onClick={() => navigate(target)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              Go to My Authorized Dashboard
            </button>
          </div>
        </div>
      );
    }

    switch (staffAccount.role) {
      case 'receptionist':
        return <StaffReceptionist onNavigate={navigate} />;
      case 'nurse':
        return <StaffNurse onNavigate={navigate} />;
      case 'doctor':
        return <StaffDoctor onNavigate={navigate} />;
      case 'laboratory':
        return <StaffLaboratory onNavigate={navigate} />;
      case 'pharmacist':
        return <StaffPharmacy onNavigate={navigate} />;
      case 'admin':
        return <StaffAdmin onNavigate={navigate} />;
    }
  }

  // 3. Patient Portal Login & Registration
  if (currentPath === '/patient/login') {
    return <PatientAuthView mode="login" onNavigate={navigate} />;
  }
  if (currentPath === '/patient/register') {
    return <PatientAuthView mode="register" onNavigate={navigate} />;
  }

  // 4. Protected Patient Portal Routes
  if (currentPath.startsWith('/patient/')) {
    if (!firebaseUser || !firebaseUser.emailVerified || !patientAccount) {
      return <PatientAuthView mode="login" onNavigate={navigate} />;
    }
    return <PatientPortal currentPath={currentPath} onNavigate={navigate} />;
  }

  // 5. Public Website Pages (/, /about, /services, /doctors, /patient-guide, /contact)
  const validPublicPaths = new Set([
    '/',
    '/about',
    '/services',
    '/doctors',
    '/patient-guide',
    '/contact',
  ]);
  const publicPath = validPublicPaths.has(currentPath) ? currentPath : '/';
  return <PublicWebsite currentPath={publicPath} onNavigate={navigate} />;
};

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    typeof window !== 'undefined' ? normalizePathname(window.location.pathname) : '/'
  );

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(normalizePathname(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    const normalized = normalizePathname(nextPath);
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const isFixture =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
      params?.get('testFixture') === '1';
    const lockRole = params?.get('lockRole');
    const searchSuffix = isFixture
      ? `?testFixture=1${lockRole ? `&lockRole=${encodeURIComponent(lockRole)}` : ''}`
      : '';
    window.history.pushState({}, '', `${normalized}${searchSuffix}`);
    setCurrentPath(normalized);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  return (
    <AppErrorBoundary>
      <ClinicProvider currentPath={currentPath}>
        <SmartClinicRouter currentPath={currentPath} navigate={navigate} />
      </ClinicProvider>
    </AppErrorBoundary>
  );
}

