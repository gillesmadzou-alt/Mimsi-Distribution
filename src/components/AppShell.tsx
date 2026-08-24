import { ReactNode, useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSync } from '@/contexts/SyncContext';
import { ROLE_LABELS, UserRole, getRoleAccessLevel } from '@/lib/supabase';
import {
  LayoutDashboard, Users, MapPin, Package, Route, Undo2,
  LogOut, Truck, ChevronDown, ChevronRight, ArrowLeft,
  BarChart2, ScrollText, Wallet, ShieldCheck, Recycle,
  RefreshCw, CalendarOff, Trophy, History, ChefHat, CalendarDays, FlaskConical, FileText, BookOpen,
  Activity, Sparkles,
  Bell, Map, Network, Barcode, UserCog, Menu, X, WifiOff, Wifi, CloudOff,
  ClipboardList, Receipt, UserCheck, DownloadCloud, DatabaseBackup, Loader2, CheckCircle2,
  Camera, KeyRound,
} from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import InstallBanner from '@/components/InstallBanner';
import SyncIndicator from '@/components/SyncIndicator';
import UserManualModal from '@/components/UserManualModal';
import { backupAllDataProgress, BACKUP_TABLE_COUNT } from '@/lib/backupUtils';
import { precacheAllData } from '@/lib/precache';
import { clearPageCache } from '@/lib/readCache';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';

export type PageId =
  | 'dashboard' | 'drivers' | 'sales-points' | 'stock' | 'batches' | 'returns'
  | 'statistics' | 'journal' | 'analytics' | 'opportunistic'
  | 'receivables' | 'compliance'
  | 'consignments' | 'restock' | 'leave'
  | 'leaderboard' | 'audit' | 'production' | 'map' | 'org-chart'
  | 'barcodes' | 'users' | 'approvals' | 'scheduling' | 'ingredients' | 'reports'
  | 'observations' | 'expenses' | 'attendance' | 'notification-archive';

interface NavSection {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  id: PageId;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  minRole: UserRole;
  allowedRoles?: UserRole[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Pilotage',
    items: [
      { id: 'dashboard', label: 'Tableau de bord', description: 'Vue d\'ensemble des indicateurs clés de l\'activité', icon: LayoutDashboard, minRole: 1 },
      { id: 'batches', label: 'Tournées du jour', description: 'Lots de livraison en cours par commercial', icon: Route, minRole: 1 },
      { id: 'map', label: 'Carte interactive', description: 'Localisation des points de vente sur la carte', icon: Map, minRole: 1 },
      { id: 'returns', label: 'Retours & Invendus', description: 'Pots et madeleines ramenés par les commerciaux', icon: Undo2, minRole: 2 },
      { id: 'barcodes', label: 'Codes à barres', description: 'Étiquetage et suivi des pots par code à barres', icon: Barcode, minRole: 2 },
    ],
  },
  {
    label: 'Reporting',
    items: [
      { id: 'statistics', label: 'Statistiques', description: 'Graphiques et tendances des ventes et retours', icon: BarChart2, minRole: 2 },
      { id: 'analytics', label: 'Analytique', description: 'Graphiques avancés: ventes, trésorerie, créances, production', icon: Activity, minRole: 2 },
      { id: 'opportunistic', label: 'Ventes opportunes', description: 'Ventes opportunes et commandes de pots pour mariages par les commerciaux', icon: Sparkles, minRole: 1 },
      { id: 'journal', label: 'Journal de livraison', description: 'Historique détaillé des dépôts et retours', icon: ScrollText, minRole: 1 },
      { id: 'reports', label: 'Rapports', description: 'Génération de rapports en PDF ou Excel selon votre rôle', icon: FileText, minRole: 4 },
    ],
  },
  {
    label: 'Finance',
    items: [
      { id: 'receivables', label: 'Créances', description: 'Montants dus par les points de vente et paiements reçus', icon: Wallet, minRole: 3 },
      { id: 'expenses', label: 'Dépenses livraison', description: 'Toutes les dépenses de tournée (carburant, papiers, crédits, etc.)', icon: Receipt, minRole: 1 },
      { id: 'compliance', label: 'Conformité', description: 'Contrôles qualité et écarts constatés sur le terrain', icon: ShieldCheck, minRole: 3 },
    ],
  },
  {
    label: 'Logistique',
    items: [
      { id: 'consignments', label: 'Consignes', description: 'Suivi des contenants déposés chez les points de vente', icon: Recycle, minRole: 2 },
      { id: 'restock', label: 'Réapprovisionnement', description: 'Demandes de réapprovisionnement des commerciaux', icon: RefreshCw, minRole: 2 },
      { id: 'leave', label: 'Congés & Absences', description: 'Demandes et validations de congés du personnel', icon: CalendarOff, minRole: 4 },
      { id: 'attendance', label: 'Liste de présence', description: 'Heures d\'arrivée et de départ, photos de pointage du personnel', icon: UserCheck, minRole: 4 },
    ],
  },
  {
    label: 'Ressources',
    items: [
      { id: 'drivers', label: 'Commerciaux', description: 'Fiches des commerciaux, véhicules et zones', icon: Users, minRole: 4 },
      { id: 'sales-points', label: 'Points de vente', description: 'Commerces desservis, quotas et coordonnées', icon: MapPin, minRole: 1, allowedRoles: [1, 2, 3, 4, 5, 6] },
      { id: 'stock', label: 'Stock', description: 'Inventaire des pots, madeleines et contenants', icon: Package, minRole: 2 },
      { id: 'production', label: 'Pétrisseurs & Production', description: 'Production quotidienne de madeleines par pétrisseur', icon: ChefHat, minRole: 2 },
      { id: 'scheduling', label: 'Programmation', description: 'Planning des tournées et des équipes', icon: CalendarDays, minRole: 2 },
      { id: 'ingredients', label: 'Intrants & Coûts pâte', description: 'Stock des matières premières et calcul des coûts de pâte', icon: FlaskConical, minRole: 2 },
    ],
  },
  {
    label: 'Gouvernance',
    items: [
      { id: 'leaderboard', label: 'Classement', description: 'Performance comparative des commerciaux', icon: Trophy, minRole: 2 },
      { id: 'audit', label: 'Journal des actions', description: 'Trace de toutes les actions effectuées dans l\'application', icon: History, minRole: 4 },
      { id: 'org-chart', label: 'Organigramme', description: 'Structure hiérarchique du personnel', icon: Network, minRole: 1 },
      { id: 'observations', label: 'Observations', description: 'Notes et remarques du terrain partagées par tout le personnel', icon: ClipboardList, minRole: 1 },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'users', label: 'Utilisateurs', description: 'Création et gestion des comptes utilisateurs', icon: UserCog, minRole: 6 },
      { id: 'approvals', label: 'Approbations personnel', description: 'Validation des demandes de modification du personnel', icon: ShieldCheck, minRole: 4 },
    ],
  },
];

interface AppShellProps {
  current: PageId;
  onNavigate: (page: PageId) => void;
  onBack: () => void;
  canGoBack: boolean;
  children: ReactNode;
}

export default function AppShell({ current, onNavigate, onBack, canGoBack, children }: AppShellProps) {
  const { profile, signOut, changePassword, manualOffline, setManualOffline } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mobileOpen, setMobileOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [preCaching, setPreCaching] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'latest'>('idle');
  const [showManual, setShowManual] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirmation: '' });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [progress, setProgress] = useState<{ active: boolean; label: string; value: number } | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const showProgress = (label: string) => {
    setDoneMessage(null);
    setProgress({ active: true, label, value: 0 });
  };
  const updateProgress = (value: number) => setProgress((p) => p ? { ...p, value } : p);
  const finishProgress = (msg: string) => {
    setProgress(null);
    setDoneMessage(msg);
  };
  const closeDone = () => setDoneMessage(null);

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (passwordForm.next !== passwordForm.confirmation) {
      setPasswordError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setChangingPassword(true);
    const result = await changePassword(passwordForm.current, passwordForm.next);
    setChangingPassword(false);
    if (result.error) {
      setPasswordError(result.error);
      return;
    }
    setPasswordForm({ current: '', next: '', confirmation: '' });
    setShowPasswordModal(false);
    toast('Mot de passe modifié avec succès.', 'success');
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [current]);

  const handleUpdateApp = async () => {
    setUpdating(true);
    showProgress('Vérification des mises à jour…');
    try {
      updateProgress(30);
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        updateProgress(100);
        setUpdating(false);
        finishProgress('Application déjà à jour');
        return;
      }
      await reg.update();
      updateProgress(60);
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        updateProgress(100);
        setUpdating(false);
        finishProgress('Mise à jour terminée');
        setTimeout(() => window.location.reload(), 500);
      } else {
        updateProgress(100);
        setUpdating(false);
        finishProgress('Application déjà à jour');
      }
    } catch {
      updateProgress(100);
      setUpdating(false);
      finishProgress('Application déjà à jour');
    }
  };

  const handleToggleOffline = async () => {
    if (manualOffline) {
      setManualOffline(false);
      toast('Mode en ligne réactivé. Les saisies en attente vont être synchronisées.', 'success');
      return;
    }
    setPreCaching(true);
    showProgress('Téléchargement des données pour le mode hors ligne…');
    try {
      // Never mix a new cache format with entries written by an older app version.
      await clearPageCache();
      await precacheAllData((progress) => {
        updateProgress(Math.round((progress.done / progress.total) * 100));
      }, profile ? { id: profile.id, role: profile.role } : undefined);
      setManualOffline(true);
      finishProgress('Mode hors ligne activé — données disponibles localement.');
    } catch {
      setProgress(null);
      toast('Le téléchargement des données a échoué. Réessayez avec une connexion stable.', 'error');
    } finally {
      setPreCaching(false);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    showProgress('Sauvegarde des données en ligne…');
    try {
      const total = BACKUP_TABLE_COUNT;
      let done = 0;
      const payload = await backupAllDataProgress(
        (tableDone) => {
          done = tableDone;
          updateProgress(Math.round((done / total) * 50));
        },
        (pcDone, pcTotal) => {
          updateProgress(50 + Math.round((pcDone / pcTotal) * 50));
        },
      );
      updateProgress(100);
      if (payload.errors && payload.errors.length > 0) {
        finishProgress(`Sauvegarde partielle (${payload.errors.length} tables en échec).`);
      } else {
        finishProgress('Sauvegarde complète.');
      }
    } catch (err) {
      console.error(err);
      setProgress(null);
      toast('Erreur lors de la sauvegarde. Veuillez reessayer.', 'error');
    }
    setBackingUp(false);
  };

  if (!profile) return null;
  const role = Number(profile.role) as UserRole;
  if (isNaN(role) || role < 1 || role > 16 || role === 15) return null;

  const toggleSection = (label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => getRoleAccessLevel(role) >= item.minRole && (!item.allowedRoles || item.allowedRoles.includes(role))),
  })).filter((section) => section.items.length > 0);

  const currentItem = visibleSections.flatMap((s) => s.items).find((i) => i.id === current);

  const sidebarContent = (
    <>
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shrink-0">
            <Truck className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-gray-900 text-sm truncate">Suivi Distribution</h1>
            <p className="text-xs text-gray-500">Madeleines</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 overflow-y-auto">
        {visibleSections.map((section) => {
          const isCollapsed = collapsed.has(section.label);
          return (
            <div key={section.label} className="mb-1">
              <button
                onClick={() => toggleSection(section.label)}
                className="w-full flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors"
              >
                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {section.label}
              </button>
              {!isCollapsed && (
                <div className="space-y-0.5 mt-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = current === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onNavigate(item.id)}
                        title={item.description}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                          active
                            ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div className="space-y-1.5 mt-3 pt-3 border-t border-gray-100">
          <button
            onClick={handleUpdateApp}
            disabled={updating}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-amber-50 hover:text-amber-700 transition-colors disabled:opacity-50"
          >
            {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4 shrink-0" />}
            <span>{updateStatus === 'latest' ? 'App deja a jour' : 'Mettre a jour l\'app'}</span>
          </button>
          <button
            onClick={() => setShowManual(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-amber-50 hover:text-amber-700 transition-colors"
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>Manuel d'utilisation</span>
          </button>
          <button
            onClick={handleToggleOffline}
            disabled={preCaching}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${manualOffline ? 'bg-amber-50 text-amber-700' : 'text-gray-600 hover:bg-amber-50 hover:text-amber-700'}`}
          >
            {preCaching ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : manualOffline ? <WifiOff className="w-4 h-4 shrink-0" /> : <Wifi className="w-4 h-4 shrink-0" />}
            <span>{preCaching ? 'Téléchargement…' : manualOffline ? 'Mode hors-ligne actif' : 'Activer le mode hors-ligne'}</span>
          </button>
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50"
          >
            {backingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <DatabaseBackup className="w-4 h-4 shrink-0" />}
            <span>Sauvegarder les donnees</span>
          </button>
        </div>
      </nav>

      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm shrink-0">
{(profile.full_name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{profile.full_name}</p>
            <p className="text-xs text-gray-500 truncate">{ROLE_LABELS[role]}</p>
          </div>
          <button
            onClick={() => { setPasswordError(null); setShowPasswordModal(true); }}
            className="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors shrink-0"
            title="Changer mon mot de passe"
          >
            <KeyRound className="w-4 h-4" />
          </button>
          <button
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Déconnexion',
                message: 'Souhaitez-vous être déconnecté ?',
                confirmLabel: 'Oui',
                cancelLabel: 'Non',
                danger: true,
              });
              if (ok) signOut();
            }}
            className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            title="Déconnexion"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-gray-200 flex-col fixed h-screen z-30">
        {sidebarContent}
      </aside>

      {/* Mobile overlay + drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-white flex flex-col shadow-2xl animate-in slide-in-from-left">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="lg:ml-64">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 sticky top-0 z-20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {canGoBack && (
              <button
                onClick={onBack}
                className="p-2 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
                title="Retour"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
              {currentItem?.label ?? 'Tableau de bord'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <SyncIndicator />
            <NotificationBell onNavigate={onNavigate} />
          </div>
        </header>
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <InstallBanner />
      <UserManualModal open={showManual} onClose={() => setShowManual(false)} />

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowPasswordModal(false)}>
          <form onSubmit={handleChangePassword} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100"><KeyRound className="w-5 h-5 text-amber-700" /></div>
              <div><h3 className="font-bold text-gray-900">Changer mon mot de passe</h3><p className="text-xs text-gray-500">Au moins 8 caractères · connexion Internet requise</p></div>
            </div>
            <div className="space-y-3">
              <input required type="password" value={passwordForm.current} onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })} placeholder="Mot de passe actuel" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500" />
              <input required minLength={8} type="password" value={passwordForm.next} onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })} placeholder="Nouveau mot de passe" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500" />
              <input required minLength={8} type="password" value={passwordForm.confirmation} onChange={(event) => setPasswordForm({ ...passwordForm, confirmation: event.target.value })} placeholder="Confirmer le nouveau mot de passe" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500" />
              {passwordError && <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{passwordError}</p>}
            </div>
            <div className="mt-5 flex gap-3"><button type="button" onClick={() => setShowPasswordModal(false)} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700">Annuler</button><button disabled={changingPassword} className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-2.5 text-sm font-medium text-white disabled:opacity-50">{changingPassword ? 'Modification…' : 'Enregistrer'}</button></div>
          </form>
        </div>
      )}

      {(progress || doneMessage) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in" onClick={progress ? undefined : closeDone}>
          <div
            className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 w-96 max-w-[calc(100vw-2rem)] animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {progress && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{progress.label}</p>
                    <p className="text-xs text-gray-500">Veuillez patienter…</p>
                  </div>
                  <span className="text-lg font-bold text-gray-900 tabular-nums">{progress.value}%</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress.value}%` }}
                  />
                </div>
              </>
            )}
            {doneMessage && !progress && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Terminé</p>
                    <p className="text-sm text-gray-600">{doneMessage}</p>
                  </div>
                </div>
                <button
                  onClick={closeDone}
                  className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
                >
                  Fermer
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
