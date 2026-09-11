import { supabase, type AppDocument, type DocumentCategory } from './supabase';

const BUCKET = 'documents';

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function uploadDocument(params: {
  file: File;
  category: DocumentCategory;
  title: string;
  accountingEntryId?: string | null;
  notes?: string | null;
}): Promise<{ data?: AppDocument; error?: string }> {
  if (params.file.type !== 'application/pdf') {
    return { error: 'Seuls les fichiers PDF sont acceptés.' };
  }
  const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${params.category}/${genId()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, params.file, {
    contentType: 'application/pdf',
  });
  if (uploadError) return { error: "Échec de l'envoi du fichier." };

  const { data, error } = await supabase
    .from('documents')
    .insert({
      category: params.category,
      title: params.title,
      file_path: path,
      file_name: params.file.name,
      file_size: params.file.size,
      accounting_entry_id: params.accountingEntryId ?? null,
      notes: params.notes?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: "Échec de l'enregistrement du document." };
  }
  return { data: data as AppDocument };
}

export async function getDocumentSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  return error ? null : data.signedUrl;
}

export async function deleteDocument(doc: Pick<AppDocument, 'id' | 'file_path'>): Promise<{ error?: string }> {
  const { error } = await supabase.from('documents').delete().eq('id', doc.id);
  if (error) return { error: 'Suppression impossible.' };
  await supabase.storage.from(BUCKET).remove([doc.file_path]);
  return {};
}

/** Pièces jointes pour un ensemble d'écritures de la Tenue de compte — utilisé
 * pour afficher le lien dans le journal de caisse / comptes clients / banque,
 * et pour construire les annexes des rapports. */
export async function fetchDocumentsForEntries(entryIds: string[]): Promise<AppDocument[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await supabase.from('documents').select('*').in('accounting_entry_id', entryIds);
  if (error) return [];
  return (data as AppDocument[]) ?? [];
}

export function groupDocumentsByEntry(docs: AppDocument[]): Map<string, AppDocument[]> {
  const map = new Map<string, AppDocument[]>();
  for (const doc of docs) {
    if (!doc.accounting_entry_id) continue;
    const list = map.get(doc.accounting_entry_id) ?? [];
    list.push(doc);
    map.set(doc.accounting_entry_id, list);
  }
  return map;
}

/** Télécharge les octets d'un document (pour le fondre en annexe d'un PDF de
 * rapport) via une URL signée de courte durée. */
export async function downloadDocumentBytes(doc: AppDocument): Promise<ArrayBuffer | null> {
  const url = await getDocumentSignedUrl(doc.file_path);
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}
