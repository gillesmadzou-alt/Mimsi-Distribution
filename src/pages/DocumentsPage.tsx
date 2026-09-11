import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  supabase, formatFCFA, getRoleAccessLevel, DOCUMENT_CATEGORY_LABELS,
  type AppDocument, type DocumentCategory, type AccountingEntry,
} from '@/lib/supabase';
import { uploadDocument, getDocumentSignedUrl, deleteDocument } from '@/lib/documents';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { PageId } from '@/components/AppShell';
import {
  FolderOpen, Upload, X, Loader2, FileText, Trash2, Search,
  Link2, Unlink, CloudOff,
} from 'lucide-react';

const ACCOUNT_TYPE_LABELS: Record<AccountingEntry['account_type'], string> = {
  cash: 'Caisse', bank: 'Banque', client: 'Client', supplier: 'Fournisseur',
};

type CategoryFilter = 'all' | DocumentCategory;

export default function DocumentsPage({ onNavigate }: { onNavigate?: (page: PageId) => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const { fetchWithCache, isOffline } = useOfflineFetch();
  const accessLevel = getRoleAccessLevel(profile?.role ?? 1, profile?.access_level);

  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('documents_page', async () => {
      const [docsRes, entriesRes] = await Promise.all([
        supabase.from('documents').select('*').order('created_at', { ascending: false }),
        supabase.from('accounting_entries').select('*').order('entry_date', { ascending: false }).limit(500),
      ]);
      if (docsRes.error) throw docsRes.error;
      return {
        documents: (docsRes.data as AppDocument[]) ?? [],
        entries: (entriesRes.data as AccountingEntry[]) ?? [],
      };
    });
    if (result.data) {
      setDocuments(result.data.documents);
      setEntries(result.data.entries);
    }
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (isOffline) return;
    const channel = supabase
      .channel('documents_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData, isOffline]);

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((doc) => {
      if (categoryFilter !== 'all' && doc.category !== categoryFilter) return false;
      if (!q) return true;
      return doc.title.toLowerCase().includes(q) || doc.file_name.toLowerCase().includes(q) || (doc.notes ?? '').toLowerCase().includes(q);
    });
  }, [documents, categoryFilter, search]);

  const counts = useMemo(() => {
    const map = new Map<DocumentCategory, number>();
    documents.forEach((doc) => map.set(doc.category, (map.get(doc.category) ?? 0) + 1));
    return map;
  }, [documents]);

  const view = async (doc: AppDocument) => {
    const url = await getDocumentSignedUrl(doc.file_path);
    if (url) window.open(url, '_blank', 'noopener');
    else toast('Impossible d’ouvrir ce document.', 'error');
  };

  const remove = async (doc: AppDocument) => {
    const confirmed = await confirmDialog({
      title: 'Supprimer le document',
      message: `Supprimer « ${doc.title} » ? Cette action est définitive.`,
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
    });
    if (!confirmed) return;
    const { error } = await deleteDocument(doc);
    if (error) toast(error, 'error');
    else { toast('Document supprimé.', 'success'); loadData(); }
  };

  const canDelete = (doc: AppDocument) => accessLevel >= 5 || doc.uploaded_by === profile?.id;

  const entryLabel = (entry: AccountingEntry) =>
    `${ACCOUNT_TYPE_LABELS[entry.account_type]} · ${entry.label}${entry.client_name ? ` (${entry.client_name})` : ''} · ${formatFCFA(entry.amount_fcfa)} · ${new Date(entry.entry_date).toLocaleDateString('fr-FR')}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-blue-500" />
          Pièces justificatives
        </h2>
        <button
          onClick={() => setUploadOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Ajouter un document
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Factures, reçus, devis pro forma et reconnaissances de dette (PDF, toujours importés depuis cet appareil) —
        chacun peut être lié à n'importe quelle écriture de la Tenue de compte (caisse, banque, clients, fournisseurs)
        pour apparaître dans le journal correspondant et être joint en annexe des rapports.
      </p>

      {isOffline && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm font-semibold">Liste indisponible pour modification hors ligne — dernière synchronisation affichée.</p>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${categoryFilter === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Tous ({documents.length})
          </button>
          {(Object.entries(DOCUMENT_CATEGORY_LABELS) as [DocumentCategory, string][]).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setCategoryFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${categoryFilter === value ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {label} ({counts.get(value) ?? 0})
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par titre, fichier ou note…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          {documents.length === 0 ? 'Aucun document enregistré.' : 'Aucun document ne correspond à la recherche.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((doc) => {
            const entry = doc.accounting_entry_id ? entryById.get(doc.accounting_entry_id) : undefined;
            return (
              <div key={doc.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => view(doc)} className="text-sm font-semibold text-gray-900 hover:text-blue-600 hover:underline text-left">
                      {doc.title}
                    </button>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                      {DOCUMENT_CATEGORY_LABELS[doc.category]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{doc.file_name}</p>
                  {entry ? (
                    <button
                      onClick={() => onNavigate?.('account-keeping')}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <Link2 className="w-3 h-3" />
                      {entryLabel(entry)}
                    </button>
                  ) : (
                    <span className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400">
                      <Unlink className="w-3 h-3" />
                      Non lié à une écriture
                    </span>
                  )}
                  {doc.notes && <p className="text-xs text-gray-400 mt-1">{doc.notes}</p>}
                  <p className="text-[11px] text-gray-400 mt-1">Ajouté le {new Date(doc.created_at).toLocaleDateString('fr-FR')}</p>
                </div>
                {canDelete(doc) && (
                  <button onClick={() => remove(doc)} className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50" aria-label="Supprimer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {uploadOpen && (
        <UploadModal
          entries={entries}
          onClose={() => setUploadOpen(false)}
          onDone={() => { setUploadOpen(false); loadData(); }}
        />
      )}
    </div>
  );
}

function UploadModal({ entries, onClose, onDone }: { entries: AccountingEntry[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [category, setCategory] = useState<DocumentCategory>('facture');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [entrySearch, setEntrySearch] = useState('');
  const [entryId, setEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matchingEntries = useMemo(() => {
    const q = entrySearch.trim().toLowerCase();
    if (!q) return entries.slice(0, 20);
    return entries.filter((e) =>
      e.label.toLowerCase().includes(q) || (e.client_name ?? '').toLowerCase().includes(q) || (e.reference ?? '').toLowerCase().includes(q)
    ).slice(0, 20);
  }, [entries, entrySearch]);

  const selectedEntry = entries.find((e) => e.id === entryId);

  const submit = async () => {
    if (!file) return;
    if (!title.trim()) { toast('Le titre est obligatoire.', 'error'); return; }
    setBusy(true);
    const { error } = await uploadDocument({ file, category, title: title.trim(), accountingEntryId: entryId, notes });
    setBusy(false);
    if (error) { toast(error, 'error'); return; }
    toast('Document ajouté.', 'success');
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">Ajouter un document</h3>
          <button onClick={onClose} aria-label="Fermer"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Type de document</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              {(Object.entries(DOCUMENT_CATEGORY_LABELS) as [DocumentCategory, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Titre</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Facture fournisseur farine — septembre"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Fichier PDF</label>
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-xs" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Note (facultatif)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Lier à une écriture de la Tenue de compte (facultatif)</label>
            {selectedEntry ? (
              <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <span className="truncate">{selectedEntry.label} · {formatFCFA(selectedEntry.amount_fcfa)}</span>
                <button onClick={() => setEntryId(null)} className="shrink-0 ml-2 text-blue-600 hover:text-blue-800"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <>
                <input
                  value={entrySearch}
                  onChange={(e) => setEntrySearch(e.target.value)}
                  placeholder="Rechercher par libellé, client ou référence…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                {entrySearch && (
                  <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
                    {matchingEntries.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-gray-400">Aucune écriture trouvée.</p>
                    ) : matchingEntries.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => { setEntryId(e.id); setEntrySearch(''); }}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-700">{e.label}</span>
                        <span className="text-gray-400"> · {formatFCFA(e.amount_fcfa)} · {new Date(e.entry_date).toLocaleDateString('fr-FR')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <button
            disabled={busy || !file}
            onClick={submit}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {busy ? 'Envoi…' : 'Ajouter le document'}
          </button>
        </div>
      </div>
    </div>
  );
}
