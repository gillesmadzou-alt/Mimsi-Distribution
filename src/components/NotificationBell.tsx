import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { supabase, AppNotification } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';
import { Bell, Info, AlertTriangle, AlertCircle, CheckCircle2, CheckCheck, ArrowUpCircle, ArrowDownCircle, MinusCircle, Archive } from 'lucide-react';
import { PageId } from '@/components/AppShell';

const TYPE_ICONS = {
  info: Info, warning: AlertTriangle, error: AlertCircle, success: CheckCircle2,
};

const TYPE_STYLES = {
  info: 'text-blue-500', warning: 'text-amber-500', error: 'text-red-500', success: 'text-emerald-500',
};

const PRIORITY_FILTER = {
  haute: { label: 'Haute', Icon: ArrowUpCircle, activeStyle: 'bg-red-500 text-white border-red-500', countStyle: 'bg-red-100 text-red-700' },
  moyenne: { label: 'Moyenne', Icon: MinusCircle, activeStyle: 'bg-amber-500 text-white border-amber-500', countStyle: 'bg-amber-100 text-amber-700' },
  basse: { label: 'Basse', Icon: ArrowDownCircle, activeStyle: 'bg-gray-500 text-white border-gray-500', countStyle: 'bg-gray-100 text-gray-700' },
} as const;

const PRIORITY_RANK: Record<AppNotification['priority'], number> = { haute: 0, moyenne: 1, basse: 2 };

const PRIORITY_BADGE: Record<AppNotification['priority'], string> = {
  haute: 'bg-red-50 text-red-700 border-red-200',
  moyenne: 'bg-amber-50 text-amber-700 border-amber-200',
  basse: 'bg-gray-50 text-gray-600 border-gray-200',
};

const PRIORITY_LABEL: Record<AppNotification['priority'], string> = {
  haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse',
};

type PriorityFilter = 'all' | AppNotification['priority'];

export default function NotificationBell({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { profile } = useAuth();
  const { confirmDialog } = useConfirm();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [archivingAll, setArchivingAll] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('app_notifications')
      .select('*')
      .eq('user_id', profile.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications(data ?? []);
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [profile, loadNotifications]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const sorted = useMemo(
    () => [...notifications].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]),
    [notifications],
  );

  const counts = useMemo(() => ({
    haute: notifications.filter((n) => n.priority === 'haute').length,
    moyenne: notifications.filter((n) => n.priority === 'moyenne').length,
    basse: notifications.filter((n) => n.priority === 'basse').length,
  }), [notifications]);

  const filtered = priorityFilter === 'all' ? sorted : sorted.filter((n) => n.priority === priorityFilter);
  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const highUnread = notifications.filter((n) => !n.is_read && n.priority === 'haute').length;

  const markRead = async (id: string) => {
    await supabase.from('app_notifications').update({ is_read: true }).eq('id', id);
    loadNotifications();
  };

  const markAllRead = async () => {
    if (!profile || unreadCount === 0 || markingAllRead) return;
    setMarkingAllRead(true);
    const { error } = await supabase
      .from('app_notifications')
      .update({ is_read: true })
      .eq('user_id', profile.id)
      .eq('is_read', false)
      .is('archived_at', null);
    if (error) {
      toast('Impossible de marquer toutes les notifications comme lues.', 'error');
    } else {
      setNotifications((items) => items.map((item) => ({ ...item, is_read: true })));
      toast('Toutes les notifications ont été marquées comme lues.', 'success');
    }
    setMarkingAllRead(false);
  };

  const archiveNotification = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    await supabase.from('app_notifications').update({ archived_at: new Date().toISOString(), is_read: true }).eq('id', id);
    loadNotifications();
  };

  const archiveAllNotifications = async () => {
    if (!profile || notifications.length === 0 || archivingAll) return;
    const confirmed = await confirmDialog({
      title: 'Archiver toutes les notifications',
      message: `Les ${notifications.length} notifications actives seront déplacées vers les archives. Vous pourrez les restaurer depuis la page Archives.`,
      confirmLabel: 'Tout archiver',
      cancelLabel: 'Annuler',
    });
    if (!confirmed) return;

    setArchivingAll(true);
    const archivedAt = new Date().toISOString();
    const { error } = await supabase
      .from('app_notifications')
      .update({ archived_at: archivedAt, is_read: true })
      .eq('user_id', profile.id)
      .is('archived_at', null);

    if (error) {
      toast('Impossible d’archiver toutes les notifications.', 'error');
    } else {
      setNotifications([]);
      setPriorityFilter('all');
      toast('Toutes les notifications ont été archivées.', 'success');
    }
    setArchivingAll(false);
  };

  const handleClick = (n: AppNotification) => {
    markRead(n.id);
    if (n.link_page) {
      onNavigate(n.link_page as PageId);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        aria-label="Ouvrir les notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${highUnread > 0 ? 'bg-red-500' : 'bg-amber-500'}`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-3 top-16 bottom-3 z-50 flex w-auto flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-h-[32rem]"
        >
          <div className="shrink-0 space-y-2 px-4 py-3 border-b border-gray-100 bg-white">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
              <button
                onClick={() => { onNavigate('notification-archive'); setOpen(false); }}
                className="text-xs text-gray-500 hover:text-amber-700 font-medium"
              >
                Voir les archives
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={markAllRead}
                disabled={unreadCount === 0 || markingAllRead}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <CheckCheck className="w-4 h-4" />
                {markingAllRead ? 'Traitement…' : 'Tout marquer comme lu'}
              </button>
              <button
                type="button"
                onClick={archiveAllNotifications}
                disabled={notifications.length === 0 || archivingAll}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Archive className="w-4 h-4" />
                {archivingAll ? 'Archivage…' : 'Tout archiver'}
              </button>
            </div>
          </div>

          {/* Priority filter bar */}
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 py-2 border-b border-gray-100 bg-white [scrollbar-width:thin]">
            <button onClick={() => setPriorityFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${priorityFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              Toutes ({notifications.length})
            </button>
            {(['haute', 'moyenne', 'basse'] as const).map((p) => {
              const cfg = PRIORITY_FILTER[p];
              const active = priorityFilter === p;
              return (
                <button key={p} onClick={() => setPriorityFilter(p)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all flex items-center gap-1 ${active ? cfg.activeStyle : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  <cfg.Icon className="w-3 h-3" />
                  {cfg.label}
                  <span className={`px-1 rounded ${active ? 'bg-white/20' : cfg.countStyle}`}>{counts[p]}</span>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">Aucune notification</div>
          ) : (
            <div className="min-h-0 flex-1 divide-y divide-gray-50 overflow-y-auto overscroll-contain">
              {filtered.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Info;
                return (
                  <div key={n.id}
                    className={`px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-gray-50 transition-colors ${!n.is_read ? 'bg-amber-50/50' : ''}`}
                    onClick={() => handleClick(n)}>
                    <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${TYPE_STYLES[n.type]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-sm font-medium text-gray-900">{n.title}</p>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${PRIORITY_BADGE[n.priority]}`}>
                          {PRIORITY_LABEL[n.priority]}
                        </span>
                      </div>
                      <p className="break-words text-xs text-gray-500 mt-0.5">{n.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at).toLocaleString('fr-FR')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => archiveNotification(event, n.id)}
                      className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                      title="Archiver la notification"
                      aria-label="Archiver la notification"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1.5" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
