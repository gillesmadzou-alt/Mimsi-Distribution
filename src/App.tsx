import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { TrackingProvider, useTracking } from '@/contexts/TrackingContext';
import { SyncProvider } from '@/contexts/SyncContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import AuthPage from '@/pages/AuthPage';
import AppShell, { PageId, NAV_SECTIONS } from '@/components/AppShell';
import { UserRole, getRoleAccessLevel } from '@/lib/supabase';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import MandatoryLocationGate from '@/components/MandatoryLocationGate';
import DashboardPage from '@/pages/DashboardPage';
import DriversPage from '@/pages/DriversPage';
import SalesPointsPage from '@/pages/SalesPointsPage';
import StockPage from '@/pages/StockPage';
import BatchesPage from '@/pages/BatchesPage';
import ReturnsPage from '@/pages/ReturnsPage';
import StatisticsPage from '@/pages/StatisticsPage';
import JournalPage from '@/pages/JournalPage';
import ReceivablesPage from '@/pages/ReceivablesPage';
import ContributionsPage from '@/pages/ContributionsPage';
import CompliancePage from '@/pages/CompliancePage';
import ConsignmentsPage from '@/pages/ConsignmentsPage';
import RestockPage from '@/pages/RestockPage';
import LeavePage from '@/pages/LeavePage';
import LeaderboardPage from '@/pages/LeaderboardPage';
import AuditLogPage from '@/pages/AuditLogPage';
import ProductionPage from '@/pages/ProductionPage';
import MapPage from '@/pages/MapPage';
import OrgChartPage from '@/pages/OrgChartPage';
import BarcodesPage from '@/pages/BarcodesPage';
import UsersPage from '@/pages/UsersPage';
import ApprovalsPage from '@/pages/ApprovalsPage';
import SchedulingPage from '@/pages/SchedulingPage';
import IngredientsPage from '@/pages/IngredientsPage';
import ReportsPage from '@/pages/ReportsPage';
import ObservationsPage from '@/pages/ObservationsPage';
import ExpensesPage from '@/pages/ExpensesPage';
import AttendancePage from '@/pages/AttendancePage';
import NotificationArchivePage from '@/pages/NotificationArchivePage';

import AnalyticsPage from '@/pages/AnalyticsPage';
import OpportunisticSalesPage from '@/pages/OpportunisticSalesPage';
import { Loader2 } from 'lucide-react';
import KioskCheckIn from '@/pages/KioskCheckIn';

function DriverApp() {
  const { isBlocked } = useTracking();
  if (isBlocked) return <MandatoryLocationGate />;
  return <OfficeApp />;
}

function OfficeApp() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [history, setHistory] = useState<PageId[]>([]);
  const { profile } = useAuth();

  useEffect(() => {
    if (profile?.role === 1) setPage('batches');
    else setPage('dashboard');
    setHistory([]);
  }, [profile?.id]);

  const nav = useCallback((p: PageId) => {
    setPage((prev) => {
      setHistory((h) => [...h, prev]);
      return p;
    });
  }, []);
  const navFromPage = useCallback((p: string) => nav(p as PageId), [nav]);

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setPage(prev);
      return h.slice(0, -1);
    });
  }, []);
  const pages: Record<PageId, React.ReactNode> = {
    dashboard: <DashboardPage onNavigate={navFromPage} />,
    drivers: <DriversPage onNavigate={navFromPage} />,
    'sales-points': <SalesPointsPage onNavigate={navFromPage} />,
    stock: <StockPage onNavigate={navFromPage} />,
    batches: <BatchesPage />,
    returns: <ReturnsPage onNavigate={navFromPage} />,
    statistics: <StatisticsPage onNavigate={navFromPage} />,
    journal: <JournalPage onNavigate={navFromPage} />,
    receivables: <ReceivablesPage onNavigate={navFromPage} />,
    contributions: <ContributionsPage />,
    compliance: <CompliancePage onNavigate={navFromPage} />,
    consignments: <ConsignmentsPage onNavigate={navFromPage} />,
    restock: <RestockPage onNavigate={navFromPage} />,
    leave: <LeavePage onNavigate={navFromPage} />,
    leaderboard: <LeaderboardPage onNavigate={navFromPage} />,
    audit: <AuditLogPage onNavigate={navFromPage} />,
    production: <ProductionPage onNavigate={navFromPage} />,
    map: <MapPage onNavigate={navFromPage} />,
    'org-chart': <OrgChartPage onNavigate={navFromPage} />,
    barcodes: <BarcodesPage onNavigate={navFromPage} />,
    users: <UsersPage />,
    approvals: <ApprovalsPage onNavigate={navFromPage} />,
    scheduling: <SchedulingPage onNavigate={navFromPage} />,
    ingredients: <IngredientsPage onNavigate={navFromPage} />,
    reports: <ReportsPage />,
    observations: <ObservationsPage onNavigate={navFromPage} />,
    expenses: <ExpensesPage onNavigate={navFromPage} />,
    attendance: <AttendancePage onNavigate={navFromPage} />,
    'notification-archive': <NotificationArchivePage />,
    analytics: <AnalyticsPage onNavigate={navFromPage} />,
    opportunistic: <OpportunisticSalesPage />,
  };

  const role = (profile?.role ?? 1) as UserRole;
  const navItem = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.id === page);
  const hasAccess = !navItem || (getRoleAccessLevel(role) >= navItem.minRole && (!navItem.allowedRoles || navItem.allowedRoles.includes(role)));

  useEffect(() => {
    if (!hasAccess) {
      const timer = setTimeout(() => nav('dashboard'), 3000);
      return () => clearTimeout(timer);
    }
  }, [hasAccess]);

  if (!hasAccess) {
    return (
      <AppShell current={page} onNavigate={nav} onBack={goBack} canGoBack={history.length > 0}>
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
            <ShieldAlert className="w-8 h-8 text-amber-500" />
          </div>
          <p className="text-base font-medium text-gray-700 max-w-md mb-1">
            {profile?.full_name ?? 'Utilisateur'}, vous n'avez pas accès à cette page merci.
          </p>
          <p className="text-sm text-gray-400 mb-6">Redirection automatique vers le tableau de bord…</p>
          <button
            onClick={() => nav('dashboard')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour au tableau de bord
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell current={page} onNavigate={nav} onBack={goBack} canGoBack={history.length > 0}>
      {pages[page]}
    </AppShell>
  );
}

function AppContent() {
  const { user, profile, loading, kioskMode } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (kioskMode) {
    return <KioskCheckIn />;
  }

  if (!user || !profile) {
    return <AuthPage />;
  }

  if (profile.role === 1) {
    return (
      <TrackingProvider>
        <DriverApp />
      </TrackingProvider>
    );
  }

  return <OfficeApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <SyncProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AppContent />
          </ConfirmProvider>
        </ToastProvider>
      </SyncProvider>
    </AuthProvider>
  );
}
