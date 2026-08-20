import { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, AlertCircle, AlertTriangle, Bell, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { supabase, AppNotification } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

const TYPE_ICONS = {
  info: Info, warning: AlertTriangle, error: AlertCircle, success: CheckCircle2,
};

const TYPE_STYLES = {
  info: 'text-blue-500', warning: 'text-amber-500', error: 'text-red-500', success: 'text-emerald-500',
};

const PRIORITY_LABEL: Record<AppNotification['priority'], string> = {
  haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse',
};

export default function NotificationArchivePage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('app_notifications')
      .select('*')
      .eq('user_id', profile.id)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });
    if (error) toast('Impossible de charger les archives de notifications.', 'error');
    setNotifications((data as AppNotification[]) ?? []);
    setLoading(false);
  }, [profile, toast]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  const restore = async (id: string) => {
    setRestoringId(id);
    const { error } = await supabase.from('app_notifications').update({ archived_at: null }).eq('id', id);
    if (error) toast('La notification n’a pas pu être restaurée.', 'error');
    else {
      setNotifications((items) => items.filter((item) => item.id !== id));
      toast('Notification restaurée dans la cloche.', 'success');
    }
    setRestoringId(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Archive className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Archives des notifications</h1>
            <p className="text-sm text-gray-500 mt-1">Les notifications archivées sont conservées ici et peuvent être restaurées dans la cloche.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-amber-500 animate-spin" /></div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Bell className="w-8 h-8 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">Aucune notification archivée.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {notifications.map((notification) => {
              const Icon = TYPE_ICONS[notification.type] ?? Info;
              return (
                <div key={notification.id} className="p-4 flex items-start gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${TYPE_STYLES[notification.type]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{notification.title}</p>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">{PRIORITY_LABEL[notification.priority]}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                    <p className="text-xs text-gray-400 mt-2">Archivée le {notification.archived_at ? new Date(notification.archived_at).toLocaleString('fr-FR') : '—'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => restore(notification.id)}
                    disabled={restoringId === notification.id}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                  >
                    {restoringId === notification.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                    Restaurer
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
