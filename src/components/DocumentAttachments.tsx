import { useState } from 'react';
import { Paperclip, Upload, X, Loader2, FileText, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getRoleAccessLevel, DOCUMENT_CATEGORY_LABELS, type AppDocument, type DocumentCategory } from '@/lib/supabase';
import { uploadDocument, getDocumentSignedUrl, deleteDocument } from '@/lib/documents';

/**
 * Petit badge trombone réutilisable pour rattacher une pièce justificative
 * PDF (facture, reçu, devis, reconnaissance de dette) à une écriture
 * précise de la Tenue de compte — journal de caisse, comptes clients,
 * fournisseurs ou banque (voir docs/AccountKeepingPage.tsx, ExpensesPage.tsx).
 * `entryId` est l'id de la ligne `accounting_entries` concernée ; passer
 * `null` permet quand même le dépôt d'un document, simplement non lié.
 */
export default function DocumentAttachments({
  entryId,
  documents,
  onChanged,
  defaultCategory = 'recu',
  defaultTitle = '',
}: {
  entryId: string | null | undefined;
  documents: AppDocument[];
  onChanged: () => void;
  defaultCategory?: DocumentCategory;
  defaultTitle?: string;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { confirmDialog } = useConfirm();
  const accessLevel = getRoleAccessLevel(profile?.role ?? 1, profile?.access_level);
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);
  const [title, setTitle] = useState(defaultTitle);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const canDelete = (doc: AppDocument) => accessLevel >= 5 || doc.uploaded_by === profile?.id;

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
    else {
      toast('Document supprimé.', 'success');
      onChanged();
    }
  };

  const submit = async () => {
    if (!file) return;
    if (!title.trim()) {
      toast('Le titre est obligatoire.', 'error');
      return;
    }
    setBusy(true);
    const { error } = await uploadDocument({ file, category, title: title.trim(), accountingEntryId: entryId ?? null });
    setBusy(false);
    if (error) {
      toast(error, 'error');
      return;
    }
    toast('Document ajouté.', 'success');
    setUploadOpen(false);
    setFile(null);
    setTitle(defaultTitle);
    onChanged();
  };

  return (
    <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      {documents.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
        >
          <Paperclip className="h-3 w-3" />
          {documents.length}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-gray-100"
        >
          <Paperclip className="h-3 w-3" />
          Justificatif
        </button>
      )}

      {open && documents.length > 0 && (
        <div className="absolute left-0 top-6 z-20 w-64 rounded-xl border border-gray-100 bg-white p-2 shadow-lg">
          <div className="space-y-1">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                <FileText className="h-4 w-4 shrink-0 text-red-500" />
                <button
                  type="button"
                  onClick={() => view(doc)}
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium text-gray-700 hover:text-blue-600"
                  title={doc.title}
                >
                  {doc.title}
                </button>
                {canDelete(doc) && (
                  <button type="button" onClick={() => remove(doc)} className="shrink-0 text-gray-300 hover:text-red-500" aria-label="Supprimer">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setUploadOpen(true);
            }}
            className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50"
          >
            <Upload className="h-3 w-3" />
            Ajouter
          </button>
        </div>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setUploadOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">Ajouter un justificatif</h3>
              <button type="button" onClick={() => setUploadOpen(false)} aria-label="Fermer">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
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
                  placeholder="Ex: Facture carburant du 12/09"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Fichier PDF</label>
                <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-xs" />
              </div>
              <button
                type="button"
                disabled={busy || !file}
                onClick={submit}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy ? 'Envoi…' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
