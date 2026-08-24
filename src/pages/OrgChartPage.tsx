import { useState, useEffect, useCallback } from 'react';
import { supabase, Profile, UserRole, Baker, Kneader, Driver } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  Building2, User, UserX, Crown, Briefcase, Calculator,
  Users, Truck, Package, ShieldCheck, ChevronDown, Phone, Loader2,
  ChefHat, Flame, Car, ShieldAlert, Droplets, Sparkles, CloudOff
} from 'lucide-react';

interface OrgPerson {
  id: string;
  full_name: string;
  phone: string | null;
  source: 'profile' | 'baker' | 'kneader' | 'driver';
}

interface OrgNode {
  role: UserRole;
  title: string;
  department: string;
  icon: typeof Crown;
  color: string;
  bgColor: string;
  borderColor: string;
  vacant?: boolean;
  holders: OrgPerson[];
}

interface Department {
  name: string;
  icon: typeof Building2;
  color: string;
  roles: UserRole[];
}

const DEPARTMENTS: Department[] = [
  {
    name: 'Administration',
    icon: Crown,
    color: 'text-amber-700',
    roles: [5, 4, 3],
  },
  {
    name: 'Production',
    icon: ChefHat,
    color: 'text-orange-700',
    roles: [8, 9, 15],
  },
  {
    name: 'Commercialisation',
    icon: Users,
    color: 'text-blue-700',
    roles: [7, 1],
  },
  {
    name: 'Logistique',
    icon: Truck,
    color: 'text-slate-700',
    roles: [2, 16, 10, 11, 12, 13, 14],
  },
  {
    name: 'Gouvernance',
    icon: ShieldCheck,
    color: 'text-emerald-700',
    roles: [6],
  },
];

const ROLE_META: Record<number, { title: string; icon: typeof Crown; color: string; bgColor: string; borderColor: string }> = {
  1: { title: 'Commercial', icon: Truck, color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
  2: { title: 'Gestionnaire de stock', icon: Package, color: 'text-cyan-700', bgColor: 'bg-cyan-50', borderColor: 'border-cyan-200' },
  3: { title: 'Comptable', icon: Calculator, color: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200' },
  4: { title: 'Directeur général adjoint', icon: Briefcase, color: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' },
  5: { title: 'Directrice générale', icon: Crown, color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200' },
  6: { title: 'Administrateur', icon: ShieldCheck, color: 'text-rose-700', bgColor: 'bg-rose-50', borderColor: 'border-rose-200' },
  7: { title: 'Directrice Commerciale', icon: Users, color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
  8: { title: 'Responsable de production', icon: ChefHat, color: 'text-orange-700', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' },
  9: { title: 'Fournier', icon: Flame, color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200' },
  10: { title: 'commercial', icon: Car, color: 'text-slate-700', bgColor: 'bg-slate-50', borderColor: 'border-slate-200' },
  11: { title: 'commercial externe', icon: Car, color: 'text-slate-600', bgColor: 'bg-slate-50', borderColor: 'border-slate-300' },
  12: { title: 'Agent de sécurité', icon: ShieldAlert, color: 'text-indigo-700', bgColor: 'bg-indigo-50', borderColor: 'border-indigo-200' },
  13: { title: 'Plongeuse', icon: Droplets, color: 'text-sky-700', bgColor: 'bg-sky-50', borderColor: 'border-sky-200' },
  14: { title: 'Femme de ménage', icon: Sparkles, color: 'text-teal-700', bgColor: 'bg-teal-50', borderColor: 'border-teal-200' },
  15: { title: 'Pétrisseur', icon: Droplets, color: 'text-amber-800', bgColor: 'bg-amber-50', borderColor: 'border-amber-300' },
  16: { title: 'Assistant en gestion de stock', icon: Package, color: 'text-cyan-700', bgColor: 'bg-cyan-50', borderColor: 'border-cyan-200' },
};

interface OrgChartData {
  profiles: Profile[];
  bakers: Baker[];
  kneaders: Kneader[];
  drivers: Driver[];
}

export default function OrgChartPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [data, setData] = useState<OrgChartData>({ profiles: [], bakers: [], kneaders: [], drivers: [] });
  const [loading, setLoading] = useState(true);
  const [expandedDept, setExpandedDept] = useState<string>('Administration');
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadData = useCallback(async () => {
    const result = await fetchWithCache<OrgChartData>('org_chart_page', async () => {
      const [profilesRes, bakersRes, kneadersRes, driversRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('is_active', true).order('role', { ascending: false }),
        supabase.from('bakers').select('*').eq('status', 'actif').order('full_name'),
        supabase.from('kneaders').select('*').eq('status', 'actif').order('full_name'),
        supabase.from('drivers').select('*').eq('status', 'actif').order('full_name'),
      ]);
      return {
        profiles: profilesRes.data ?? [],
        bakers: bakersRes.data ?? [],
        kneaders: kneadersRes.data ?? [],
        drivers: driversRes.data ?? [],
      };
    });
    if (result.data) setData(result.data);
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadData(); }, [loadData]);

  useRealtimeSubscription('org-chart-page', isOffline ? [] : ['profiles', 'bakers', 'kneaders', 'drivers'], () => { loadData(); });

  const getHolders = (role: number): OrgPerson[] => {
    if (role === 9) {
      return data.bakers.map((b) => ({ id: b.id, full_name: b.full_name, phone: b.phone, source: 'baker' as const }));
    }
    if (role === 15) {
      return data.kneaders.map((k) => ({ id: k.id, full_name: k.full_name, phone: k.phone, source: 'kneader' as const }));
    }
    if (role === 1) {
      return data.drivers.map((d) => ({ id: d.id, full_name: d.full_name, phone: d.phone_primary, source: 'driver' as const }));
    }
    return data.profiles
      .filter((p) => p.role === role)
      .map((p) => ({ id: p.id, full_name: p.full_name, phone: p.phone, source: 'profile' as const }));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-amber-500" />
        <p>Chargement de l'organigramme…</p>
      </div>
    );
  }

  const allPersons = [
    ...data.profiles.map((p) => ({ id: p.id, full_name: p.full_name })),
    ...data.bakers.map((b) => ({ id: b.id, full_name: b.full_name })),
    ...data.kneaders.map((k) => ({ id: k.id, full_name: k.full_name })),
    ...data.drivers.map((d) => ({ id: d.id, full_name: d.full_name })),
  ];
  const totalStaff = allPersons.length;
  const vacantCount = DEPARTMENTS.flatMap((d) => d.roles).filter((r) => getHolders(r).length === 0).length;

  if (isOffline && totalStaff === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] text-gray-400">
        <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
        <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger l'organigramme.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-600 rounded-3xl p-4 sm:p-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Building2 className="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold break-words">MIMSI — Organigramme</h2>
            <p className="text-amber-50 text-sm mt-1">
              {totalStaff} employé{totalStaff > 1 ? 's' : ''} actif{totalStaff > 1 ? 's' : ''}
              {vacantCount > 0 && ` · ${vacantCount} poste${vacantCount > 1 ? 's' : ''} vacant${vacantCount > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Employés actifs', value: totalStaff, icon: Users, bg: 'bg-blue-50', color: 'text-blue-700' },
          { label: 'Postes vacants', value: vacantCount, icon: UserX, bg: 'bg-red-50', color: 'text-red-700' },
          { label: 'Départements', value: DEPARTMENTS.length, icon: Building2, bg: 'bg-amber-50', color: 'text-amber-700' },
          { label: 'Administration', value: getHolders(5).length + getHolders(4).length + getHolders(3).length, icon: Crown, bg: 'bg-emerald-50', color: 'text-emerald-700' },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={`${s.bg} rounded-2xl p-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-600">{s.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                </div>
                <Icon className={`w-8 h-8 ${s.color} opacity-30`} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Departments */}
      {DEPARTMENTS.map((dept) => {
        const DeptIcon = dept.icon;
        const isExpanded = expandedDept === dept.name;
        const deptMembers = dept.roles.flatMap((r) => getHolders(r));
        const deptVacant = dept.roles.filter((r) => getHolders(r).length === 0).length;

        return (
          <div key={dept.name} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Department header */}
            <button
              onClick={() => setExpandedDept(isExpanded ? '' : dept.name)}
              className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className={`w-10 h-10 rounded-xl ${dept.color} bg-gray-100 flex items-center justify-center`}>
                <DeptIcon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <h3 className="font-semibold text-gray-900">{dept.name}</h3>
                <p className="text-xs text-gray-500">
                  {deptMembers.length} membre{deptMembers.length > 1 ? 's' : ''}
                  {deptVacant > 0 && ` · ${deptVacant} vacant${deptVacant > 1 ? 's' : ''}`}
                </p>
              </div>
              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>

            {/* Department body — org tree */}
            {isExpanded && (
              <div className="px-3 sm:px-5 pb-6 pt-2">
                {dept.name === 'Administration' ? (
                  <AdminOrgTree holders={getHolders} onNavigate={onNavigate} />
                ) : dept.name === 'Commercialisation' ? (
                  <CommercialOrgTree holders={getHolders} onNavigate={onNavigate} />
                ) : dept.name === 'Production' ? (
                  <ProductionOrgTree holders={getHolders} onNavigate={onNavigate} />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                    {dept.roles.map((role) => {
                      return (
                        <RoleCard key={role} role={role} holders={getHolders(role)} onNavigate={onNavigate} />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProductionOrgTree({ holders, onNavigate }: { holders: (role: number) => OrgPerson[]; onNavigate?: (page: string) => void }) {
  const responsable = holders(8);
  const petrisseurs = holders(15);
  const forniers = holders(9);

  return (
    <div className="flex flex-col items-center pt-4">
      {/* Level 1 — Responsable de production */}
      <div className="flex flex-col items-center">
        <RoleCard role={8} holders={responsable} large onNavigate={onNavigate} />
      </div>

      {/* Connector */}
      <div className="w-px h-8 bg-gray-200" />

      {/* Level 2 — Pétrisseurs */}
      <div className="w-full">
        {petrisseurs.length === 0 ? (
          <div className="bg-amber-50 border-2 border-dashed border-amber-200 rounded-2xl p-5 text-center max-w-sm mx-auto">
            <UserX className="w-6 h-6 text-amber-400 mx-auto mb-2" />
            <p className="font-semibold text-amber-700">Aucun pétrisseur</p>
            <span className="inline-block mt-2 px-3 py-1 rounded-full bg-amber-100 text-amber-600 text-xs font-medium">
              Poste vacant
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full">
              {petrisseurs.map((person) => (
                <RoleCard key={person.id} role={15} holders={[person]} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Connector */}
      <div className="w-px h-8 bg-gray-200" />

      {/* Level 3 — Fournier(s) */}
      <div className="w-full">
        {forniers.length === 0 ? (
          <div className="bg-red-50 border-2 border-dashed border-red-200 rounded-2xl p-5 text-center max-w-sm mx-auto">
            <UserX className="w-6 h-6 text-red-400 mx-auto mb-2" />
            <p className="font-semibold text-red-700">Aucun fournier</p>
            <span className="inline-block mt-2 px-3 py-1 rounded-full bg-red-100 text-red-600 text-xs font-medium">
              Poste vacant
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {forniers.map((person) => (
              <RoleCard key={person.id} role={9} holders={[person]} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommercialOrgTree({ holders, onNavigate }: { holders: (role: number) => OrgPerson[]; onNavigate?: (page: string) => void }) {
  const directrice = holders(7);
  const commerciaux = holders(1);

  return (
    <div className="flex flex-col items-center pt-4">
      {/* Level 1 — Directrice Commerciale */}
      <div className="flex flex-col items-center">
        <RoleCard role={7} holders={directrice} large onNavigate={onNavigate} />
      </div>

      {/* Connector */}
      <div className="w-px h-8 bg-gray-200" />

      {/* Level 2 — Commerciaux */}
      <div className="w-full">
        {commerciaux.length === 0 ? (
          <div className="bg-blue-50 border-2 border-dashed border-blue-200 rounded-2xl p-5 text-center max-w-sm mx-auto">
            <UserX className="w-6 h-6 text-red-400 mx-auto mb-2" />
            <p className="font-semibold text-blue-700">Aucun commercial</p>
            <span className="inline-block mt-2 px-3 py-1 rounded-full bg-red-100 text-red-600 text-xs font-medium">
              Poste vacant
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {commerciaux.map((person) => (
              <RoleCard key={person.id} role={1} holders={[person]} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminOrgTree({ holders, onNavigate }: { holders: (role: number) => OrgPerson[]; onNavigate?: (page: string) => void }) {
  const directrice = holders(5);
  const adjoint = holders(4);
  const comptable = holders(3);

  return (
    <div className="flex flex-col items-center pt-4">
      {/* Level 1 — Directrice générale */}
      <div className="flex flex-col items-center">
        <RoleCard role={5} holders={directrice} large onNavigate={onNavigate} />
      </div>

      {/* Connector */}
      <div className="w-px h-8 bg-gray-200" />

      {/* Level 2 — Directeur général adjoint */}
      <div className="flex flex-col items-center">
        <RoleCard role={4} holders={adjoint} large onNavigate={onNavigate} />
      </div>

      {/* Connector */}
      <div className="w-px h-8 bg-gray-200" />

      {/* Level 3 — Comptable */}
      <div className="flex flex-col items-center">
        <RoleCard role={3} holders={comptable} large onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function RoleCard({ role, holders, large, onNavigate }: { role: number; holders: OrgPerson[]; large?: boolean; onNavigate?: (page: string) => void }) {
  const meta = ROLE_META[role] ?? { title: 'Inconnu', icon: User, color: 'text-gray-700', bgColor: 'bg-gray-50', borderColor: 'border-gray-200' };
  const Icon = meta.icon;
  const isVacant = holders.length === 0;
  const navTarget = role === 1 ? 'drivers' : (role === 8 || role === 9 || role === 15 || role === 10 || role === 11) ? 'production' : null;

  if (isVacant) {
    return (
      <div className={`relative w-full min-w-0 ${large ? 'max-w-sm' : ''} ${meta.bgColor} ${meta.borderColor} border-2 border-dashed rounded-2xl p-4 sm:p-5 text-center`}>
        <div className={`w-12 h-12 rounded-xl bg-white flex items-center justify-center mx-auto mb-3`}>
          <UserX className={`w-6 h-6 text-red-400`} />
        </div>
        <p className={`font-semibold ${meta.color}`}>{meta.title}</p>
        <span className="inline-block mt-2 px-3 py-1 rounded-full bg-red-100 text-red-600 text-xs font-medium">
          Poste vacant
        </span>
      </div>
    );
  }

  return (
    <div className={`w-full min-w-0 ${large ? 'max-w-sm' : ''} space-y-3`}>
      {holders.map((person) => (
        <div
          key={person.id}
          className={`${meta.bgColor} ${meta.borderColor} border-2 rounded-2xl p-4 sm:p-5 transition-all hover:shadow-md${navTarget ? ' cursor-pointer' : ''}`}
          onClick={navTarget ? () => onNavigate?.(navTarget) : undefined}
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
              <Icon className={`w-6 h-6 ${meta.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold ${meta.color} text-sm`}>{meta.title}</p>
              <p className="font-bold text-gray-900 mt-0.5 truncate">{person.full_name}</p>
              <div className="mt-2 space-y-1">
                {person.phone && (
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Phone className="w-3 h-3" />
                    {person.phone}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
