import { useCallback, useEffect, useState } from 'react';
import {
  supabase, SocialConnectionStatus, SocialPlatform,
  SOCIAL_PLATFORM_LABELS, SOCIAL_CONNECTION_STATE_LABELS,
} from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  CheckCircle2, AlertTriangle, Loader2, Link2, Unlink, ShieldCheck, RefreshCw,
} from 'lucide-react';

// Écran « Mes canaux » : l'état des comptes sociaux branchés, et le parcours
// pour en brancher un soi-même.
//
// Les données viennent de la vue `social_connection_status`, qui n'expose
// jamais de jeton — même chiffré. Tout l'échange OAuth se fait dans la fonction
// `connect-social` : le navigateur ne voit à aucun moment un jeton de Page.

type PageChoice = {
  id: string;
  name: string;
  instagram: { id: string; username: string | null } | null;
};

// Meta ne peut pas être branché depuis la borne : seules ces plateformes ont
// aujourd'hui un parcours de connexion en libre-service.
const CONNECTABLE: SocialPlatform[] = ['facebook', 'instagram'];

export function ChannelConnectionPanel({ platform }: { platform: SocialPlatform }) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const canManage = (profile?.access_level ?? 0) >= 5;

  const [connection, setConnection] = useState<SocialConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<PageChoice[] | null>(null);
  const [userToken, setUserToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('social_connection_status')
      .select('*')
      .eq('platform', platform)
      .maybeSingle();
    if (error) {
      console.error('Lecture des connexions impossible :', error.message);
    }
    setConnection((data as SocialConnectionStatus | null) ?? null);
    setLoading(false);
  }, [platform]);

  useEffect(() => { void load(); }, [load]);

  // Retour de Meta : l'URL porte ?code=...&state=<org>:<platform>. On échange
  // le code contre la liste des Pages, puis on nettoie l'URL pour qu'un
  // rechargement ne rejoue pas un code déjà consommé.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || !state.endsWith(`:${platform}`)) return;

    const exchange = async () => {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke('connect-social', {
        body: {
          action: 'exchange',
          platform,
          code,
          redirect_uri: `${window.location.origin}${window.location.pathname}`,
        },
      });
      window.history.replaceState({}, '', window.location.pathname);
      setBusy(false);

      if (error || data?.error) {
        toast(data?.error ?? "Connexion refusée par Meta.", 'error');
        return;
      }
      setUserToken(data.user_token as string);
      setPages(data.pages as PageChoice[]);
    };
    void exchange();
  }, [platform, toast]);

  const startConnect = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('connect-social', {
      body: {
        action: 'start',
        platform,
        redirect_uri: `${window.location.origin}${window.location.pathname}`,
      },
    });
    setBusy(false);
    if (error || data?.error) {
      toast(data?.error ?? "Impossible de démarrer la connexion.", 'error');
      return;
    }
    window.location.href = data.auth_url as string;
  };

  const selectPage = async (pageId: string) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('connect-social', {
      body: {
        action: 'select',
        platform,
        page_id: pageId,
        user_token: userToken,
        redirect_uri: `${window.location.origin}${window.location.pathname}`,
      },
    });
    setBusy(false);
    if (error || data?.error) {
      toast(data?.error ?? "Impossible d'enregistrer la connexion.", 'error');
      return;
    }
    setPages(null);
    setUserToken(null);
    toast(`${SOCIAL_PLATFORM_LABELS[platform]} connecté : ${data.display_name}`, 'success');
    void load();
  };

  const disconnect = async () => {
    if (!window.confirm(
      `Déconnecter ${SOCIAL_PLATFORM_LABELS[platform]} ? Les publications, le bot et les commandes entrantes s'arrêteront sur ce canal.`,
    )) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('connect-social', {
      body: {
        action: 'disconnect',
        platform,
        redirect_uri: `${window.location.origin}${window.location.pathname}`,
      },
    });
    setBusy(false);
    if (error || data?.error) {
      toast(data?.error ?? "Impossible de déconnecter le compte.", 'error');
      return;
    }
    toast(`${SOCIAL_PLATFORM_LABELS[platform]} déconnecté.`, 'success');
    void load();
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Vérification de la connexion…
      </div>
    );
  }

  // Choix de la Page, juste après le retour de Meta.
  if (pages) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Quelle page souhaitez-vous connecter ?
        </h3>
        {pages.length === 0 && (
          <p className="text-sm text-gray-500">
            Aucune page trouvée sur ce compte Facebook. Créez une page professionnelle, puis réessayez.
          </p>
        )}
        <div className="space-y-2">
          {pages.map((page) => {
            const igMissing = platform === 'instagram' && !page.instagram;
            return (
              <button
                key={page.id}
                type="button"
                disabled={busy || igMissing}
                onClick={() => void selectPage(page.id)}
                className="w-full flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:bg-white"
              >
                <span>
                  <span className="block text-sm font-medium text-gray-900">{page.name}</span>
                  {platform === 'instagram' && (
                    <span className="block text-xs text-gray-500">
                      {page.instagram
                        ? `Compte Instagram : @${page.instagram.username ?? page.instagram.id}`
                        : 'Aucun compte Instagram professionnel lié à cette page'}
                    </span>
                  )}
                </span>
                <Link2 className="w-4 h-4 text-gray-400 shrink-0" />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => { setPages(null); setUserToken(null); }}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Annuler
        </button>
      </div>
    );
  }

  // Compte connecté.
  if (connection) {
    const healthy = connection.status === 'active' && !connection.expires_soon;
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {healthy
              ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
            <div>
              <p className="text-sm font-medium text-gray-900">
                {connection.display_name ?? SOCIAL_PLATFORM_LABELS[platform]}
              </p>
              <p className="text-xs text-gray-500">
                {SOCIAL_CONNECTION_STATE_LABELS[connection.status]}
                {connection.expires_soon && connection.status === 'active' && ' — à renouveler bientôt'}
                {connection.last_used_at &&
                  ` · dernier envoi le ${new Date(connection.last_used_at).toLocaleDateString('fr-FR')}`}
              </p>
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-2 shrink-0">
              {!healthy && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startConnect()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reconnecter
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void disconnect()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <Unlink className="w-3.5 h-3.5" />
                Déconnecter
              </button>
            </div>
          )}
        </div>

        {connection.last_error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {connection.last_error}
          </p>
        )}

        <p className="flex items-start gap-2 text-xs text-gray-500 border-t border-gray-100 pt-3">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-px" />
          <span>
            Compte enregistré officiellement auprès de Meta. Contrairement aux outils qui se
            connectent par QR code, votre compte ne risque pas d'être suspendu pour usage d'un
            outil non autorisé.
          </span>
        </p>
      </div>
    );
  }

  // Aucun compte branché.
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">
        {SOCIAL_PLATFORM_LABELS[platform]} n'est pas encore connecté
      </h3>
      <p className="text-sm text-gray-600">
        {platform === 'instagram'
          ? "Connectez votre compte Instagram professionnel pour publier, recevoir les messages et activer le bot. Il doit être lié à une page Facebook que vous administrez."
          : "Connectez votre page Facebook pour publier, recevoir les messages et les commentaires, et activer le bot."}
      </p>
      {CONNECTABLE.includes(platform) && canManage && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startConnect()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          Connecter {SOCIAL_PLATFORM_LABELS[platform]}
        </button>
      )}
      {!canManage && (
        <p className="text-xs text-gray-500">
          La connexion d'un compte est réservée à la direction.
        </p>
      )}
    </div>
  );
}
