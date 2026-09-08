import { useState, useEffect, useCallback } from 'react';
import { supabase, Profile, ROLE_LABELS, UserRole, getRoleAccessLevel } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { UserPlus, Loader2, Trash2, ShieldCheck, Search, Mail, Lock, User as UserIcon, X, CloudOff } from 'lucide-react';

const EMAIL_DOMAIN = 'mimsidistribution.com';
const ACCESS_LEVEL_LABELS: Record<number, string> = {
  1: 'Niveau 1 — accès de base',
  2: 'Niveau 2 — opérations',
  3: 'Niveau 3 — comptabilité',
  4: 'Niveau 4 — supervision',
  5: 'Niveau 5 — direction',
  6: 'Niveau 6 — administration complète',
};

function emailFromFullName(fullName: string): string {
  const identifier = fullName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return identifier ? `${identifier}@${EMAIL_DOMAIN}` : '';
}

export default function UsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const [newUser, setNewUser] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 1 as UserRole,
    accessLevel: 1,
  });

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache<Profile[]>('users_page', async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    });
    if (result.data) setProfiles(result.data);
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  useRealtimeSubscription('users-page', isOffline ? [] : ['profiles'], () => { fetchProfiles(); });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setCreating(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session expirée, veuillez vous reconnecter.');
        setCreating(false);
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            email: emailFromFullName(newUser.fullName),
            password: newUser.password,
            fullName: newUser.fullName,
            role: newUser.role,
            phone: newUser.phone,
            accessLevel: newUser.accessLevel,
          }),
        }
      );

      const result = await response.json().catch(() => ({
        error: `La fonction de création a renvoyé une réponse invalide (${response.status}).`,
      }));
      if (!response.ok) {
        setError(result.error || 'Erreur lors de la création du compte.');
      } else {
        setSuccess(`Compte créé pour ${newUser.fullName} (${ROLE_LABELS[newUser.role]}, accès ${newUser.accessLevel}). Identifiant : ${emailFromFullName(newUser.fullName)}`);
        setNewUser({ fullName: '', email: '', phone: '', password: '', role: 1, accessLevel: 1 });
        setShowForm(false);
        fetchProfiles();
      }
    } catch (requestError) {
      console.error('create-user request failed:', requestError);
      setError('La fonction de création est inaccessible. Vérifiez la connexion et son déploiement Supabase.');
    }
    setCreating(false);
  };

  const handleToggleActive = async (profile: Profile) => {
    const { error } = await supabase.rpc('toggle_user_active', { p_target_uuid: profile.id });
    if (error) {
      console.error('toggle_user_active failed:', error);
      setError("Impossible de modifier l'état de ce compte.");
    } else {
      fetchProfiles();
    }
  };

  const filtered = profiles.filter((p) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query
      || p.full_name.toLowerCase().includes(query)
      || ROLE_LABELS[p.role].toLowerCase().includes(query)
      || (p.phone ?? '').includes(query);
    return matchesSearch && (roleFilter === 'all' || p.role === roleFilter);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Gestion du personnel</h2>
          <p className="text-sm text-gray-500 mt-1">
            Ajoutez tout le personnel au même endroit. Les fiches commerciales et de production sont créées automatiquement.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all"
        >
          <UserPlus className="w-4 h-4" />
          Ajouter un membre
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</div>
      )}
      {success && (
        <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-xl p-3">{success}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par nom, fonction ou téléphone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value === 'all' ? 'all' : Number(e.target.value) as UserRole)}
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
          aria-label="Filtrer le personnel par fonction"
        >
          <option value="all">Toutes les fonctions ({profiles.length})</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : isOffline && profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger le personnel.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rôle</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Accès</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Créé le</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm">
                        {p.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="block text-sm font-medium text-gray-900">{p.full_name}</span>
                        {p.phone && <span className="block text-xs text-gray-400">{p.phone}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 text-amber-700">
                      <ShieldCheck className="w-3 h-3" />
                      {ROLE_LABELS[p.role]}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-600">
                    Niveau {getRoleAccessLevel(p.role, p.access_level)}
                  </td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() => handleToggleActive(p)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        p.is_active
                          ? 'bg-green-50 text-green-700 hover:bg-green-100'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${p.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {p.is_active ? 'Actif' : 'Inactif'}
                    </button>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {new Date(p.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {p.role !== 6 && (
                      <button
                        onClick={() => handleToggleActive(p)}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title={p.is_active ? 'Désactiver' : 'Activer'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">Aucun membre du personnel trouvé.</div>
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-[scaleIn_180ms_ease-out]">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-900">Ajouter un membre du personnel</h3>
              <button
                onClick={() => setShowForm(false)}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom complet</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={newUser.fullName}
                    onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value, email: emailFromFullName(e.target.value) })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all"
                    placeholder="PAMBOU Estelle"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone (facultatif)</label>
                <input
                  type="tel"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all"
                  placeholder="Numéro de téléphone"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Identifiant e-mail généré</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={newUser.email}
                    readOnly
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 outline-none"
                    placeholder="nom.prenom@mimsidistribution.com"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Généré à partir du nom complet ; l’adresse administrateur n’est pas modifiée.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe temporaire</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all"
                    placeholder="Mot de passe initial"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">L'utilisateur pourra le changer après sa première connexion.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fonction</label>
                <select
                  value={newUser.role}
                  onChange={(e) => {
                    const role = Number(e.target.value) as UserRole;
                    setNewUser({ ...newUser, role, accessLevel: getRoleAccessLevel(role) });
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all"
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Niveau d’accès</label>
                <select
                  value={newUser.accessLevel}
                  onChange={(e) => setNewUser({ ...newUser, accessLevel: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all"
                >
                  {Object.entries(ACCESS_LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  La fonction et les droits sont indépendants. Un agent de sécurité reçoit le niveau 1 par défaut.
                </p>
              </div>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>
              )}
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {creating && <Loader2 className="w-5 h-5 animate-spin" />}
                Ajouter au personnel
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
