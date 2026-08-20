import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase, PotType, Barcode as BarcodeType, Baker, formatFCFA, generateBakerCode } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import { Barcode, Download, Printer, Plus, Trash2, Loader2, Package, CheckCircle2, RotateCcw, AlertTriangle, ArrowRight, WifiOff, CloudOff } from 'lucide-react';
import { cacheBarcodes, getCachedBarcodes, addCachedBarcode, removeCachedBarcode, clearCachedBarcodes } from '@/lib/barcodeCache';
import { getCachedPageData, cachePageData } from '@/lib/readCache';
import { useSync } from '@/contexts/SyncContext';
import { enqueueJob, buildSteps, isOnline } from '@/lib/offlineQueue';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

function drawBarcodeOnCanvas(canvas: HTMLCanvasElement, text: string): void {
  try {
    JsBarcode(canvas, text, {
      format: 'CODE128',
      displayValue: true,
      fontSize: 14,
      height: 80,
      width: 2,
      margin: 10,
    });
  } catch {
    // ignore rendering errors for unsupported characters
  }
}

function generateCode(index: number, baker1Code?: string, baker2Code?: string): string {
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const p1 = baker1Code ?? '';
  const p2 = baker2Code ?? '';
  const prefix = (p1 || p2) ? `${p1}${p2 ? '-' + p2 : ''}-` : '';
  return `${prefix}POT-${random}-${String(index).padStart(3, '0')}`;
}

export default function BarcodesPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile, offlineMode, manualOffline } = useAuth();
  const { isOnline: online } = useSync();
  const isOffline = offlineMode || manualOffline || !navigator.onLine;
  const [potTypes, setPotTypes] = useState<PotType[]>([]);
  const [bakers, setBakers] = useState<Baker[]>([]);
  const [barcodes, setBarcodes] = useState<BarcodeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ potTypeId: '', quantity: 1, notes: '', baker1Id: '', baker2Id: '' });
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  const loadAll = useCallback(async () => {
    // Show cached barcodes immediately (offline-first)
    try {
      const cached = await getCachedBarcodes();
      if (cached.length > 0) {
        setBarcodes(cached.sort((a, b) => b.created_at.localeCompare(a.created_at)));
      }
    } catch { /* ignore cache errors */ }

    if (isOffline || !isOnline()) {
      const cached = await getCachedPageData<{potTypes: PotType[]; bakers: Baker[]}>('barcodes-page');
      if (cached) {
        setPotTypes(cached.data.potTypes ?? []);
        setBakers(cached.data.bakers ?? []);
      }
      setLoading(false);
      return;
    }

    const [potRes, barRes, bakerRes] = await Promise.all([
      supabase.from('pot_types').select('*').order('name'),
      supabase.from('barcodes').select('*, pot_type:pot_types(*), baker:bakers!baker_id(*), baker2:bakers!baker2_id(*)').order('created_at', { ascending: false }),
      supabase.from('bakers').select('*').eq('status', 'actif').order('full_name'),
    ]);
    setPotTypes(potRes.data ?? []);
    setBarcodes(barRes.data ?? []);
    setBakers(bakerRes.data ?? []);
    setLoading(false);
    try { await cachePageData('barcodes-page', { potTypes: potRes.data ?? [], bakers: bakerRes.data ?? [] }); } catch { /* ignore */ }

    // Update cache with fresh available barcodes
    const available = (barRes.data ?? []).filter((b) => !b.is_used);
    try { await cacheBarcodes(available); } catch { /* ignore */ }
  }, [isOffline]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useRealtimeSubscription('barcodes-page', ['barcodes', 'pot_types', 'bakers'], loadAll);

  useEffect(() => {
    barcodes.forEach((b) => {
      const canvas = canvasRefs.current[b.id];
      if (canvas) drawBarcodeOnCanvas(canvas, b.code);
    });
  }, [barcodes]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.potTypeId || form.quantity < 1) return;

    setGenerating(true);
    const baker1 = bakers.find((b) => b.id === form.baker1Id);
    const baker2 = bakers.find((b) => b.id === form.baker2Id);
    const baker1Code = baker1 ? generateBakerCode(baker1.full_name) : null;
    const baker2Code = baker2 ? generateBakerCode(baker2.full_name) : null;

    const rows = Array.from({ length: form.quantity }, (_, i) => ({
      code: generateCode(i + 1, baker1Code ?? undefined, baker2Code ?? undefined),
      pot_type_id: form.potTypeId,
      quantity: 1,
      notes: form.notes || null,
      is_used: false,
      baker_id: form.baker1Id || null,
      baker_code: baker1Code,
      baker2_id: form.baker2Id || null,
      baker2_code: baker2Code,
    }));

    if (!isOnline()) {
      // Offline: queue insert + cache locally with temp IDs
      try {
        const steps = buildSteps().insert('barcodes', rows).getSteps();
        await enqueueJob('Génération codes à barres', 'barcodes', steps);

        const potType = potTypes.find((p) => p.id === form.potTypeId);
        const tempBarcodes: BarcodeType[] = rows.map((r, i) => ({
          ...r,
          id: `temp-${Date.now()}-${i}`,
          used_at: null,
          created_by: '',
          created_at: new Date().toISOString(),
          pot_type: potType,
          baker: baker1 ?? undefined,
          baker2: baker2 ?? undefined,
        } as BarcodeType));
        setBarcodes((prev) => [...tempBarcodes, ...prev]);
        for (const tb of tempBarcodes) { try { await addCachedBarcode(tb); } catch { /* ignore */ } }
      } catch (err) {
        console.error('offline barcode queue failed:', err);
      }
      setForm({ potTypeId: '', quantity: 1, notes: '', baker1Id: '', baker2Id: '' });
      setGenerating(false);
      return;
    }

    const { data, error } = await supabase.from('barcodes').insert(rows).select('*, pot_type:pot_types(*), baker:bakers!baker_id(*), baker2:bakers!baker2_id(*)');
    if (error) {
      console.error('barcode insert failed:', error);
      setGenerating(false);
      return;
    }
    if (data) {
      setBarcodes((prev) => [...data, ...prev]);
      for (const b of data) { try { await addCachedBarcode(b); } catch { /* ignore */ } }
    }
    setForm({ potTypeId: '', quantity: 1, notes: '', baker1Id: '', baker2Id: '' });
    setGenerating(false);
  };

  const deleteBarcode = async (id: string) => {
    if (!isOnline() || id.startsWith('temp-')) {
      if (id.startsWith('temp-')) {
        setBarcodes((prev) => prev.filter((b) => b.id !== id));
        try { await removeCachedBarcode(id); } catch { /* ignore */ }
        return;
      }
      try {
        await enqueueJob('Suppression code à barres', 'barcodes', buildSteps().delete('barcodes', { column: 'id', value: id }).getSteps());
        setBarcodes((prev) => prev.filter((b) => b.id !== id));
        try { await removeCachedBarcode(id); } catch { /* ignore */ }
      } catch (err) {
        console.error('offline delete queue failed:', err);
      }
      return;
    }
    const { error } = await supabase.from('barcodes').delete().eq('id', id);
    if (!error) {
      setBarcodes((prev) => prev.filter((b) => b.id !== id));
      try { await removeCachedBarcode(id); } catch { /* ignore */ }
    }
  };

  const resetAvailable = async () => {
    setResetting(true);

    if (!isOnline()) {
      try {
        await enqueueJob('Réinitialisation codes disponibles', 'barcodes', buildSteps().delete('barcodes', { column: 'is_used', value: false }).getSteps());
        setBarcodes((prev) => prev.filter((b) => b.is_used));
        try { await clearCachedBarcodes(); } catch { /* ignore */ }
      } catch (err) {
        console.error('offline reset queue failed:', err);
      }
      setResetting(false);
      setShowResetConfirm(false);
      return;
    }

    const { error } = await supabase.from('barcodes').delete().eq('is_used', false);
    if (!error) {
      setBarcodes((prev) => prev.filter((b) => b.is_used));
      try { await clearCachedBarcodes(); } catch { /* ignore */ }
    }
    setResetting(false);
    setShowResetConfirm(false);
  };

  const exportPDF = () => {
    const available = barcodes.filter((b) => !b.is_used);
    if (available.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);

    const counterKey = `barcode_pdf_counter_${today}`;
    const current = parseInt(localStorage.getItem(counterKey) ?? '0', 10) || 0;
    const nextNum = current + 1;
    localStorage.setItem(counterKey, String(nextNum));

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margin = 10;
    const labelWidth = 85;
    const labelHeight = 50;
    const gapX = 5;
    const gapY = 5;
    const cols = 2;
    const rowsPerPage = 5;

    let col = 0;
    let row = 0;
    let pageIndex = 0;

    const drawPageHeader = (pg: number) => {
      doc.setFontSize(10);
      doc.setTextColor(120, 120, 120);
      doc.text(`Étiquettes codes à barres — page ${pg + 1}`, margin, 7);
    };

    drawPageHeader(pageIndex);

    available.forEach((b) => {
      if (row >= rowsPerPage) {
        doc.addPage();
        pageIndex++;
        row = 0;
        col = 0;
        drawPageHeader(pageIndex);
      }

      const canvas = canvasRefs.current[b.id];
      if (!canvas) return;

      const x = margin + col * (labelWidth + gapX);
      const y = margin + 10 + row * (labelHeight + gapY);

      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, y, labelWidth, labelHeight, 2, 2, 'S');

      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);
      doc.text(b.pot_type?.name ?? '—', x + 3, y + 6);

      if (b.baker_code) {
        doc.setFontSize(7);
        doc.setTextColor(180, 100, 20);
        doc.text(b.baker_code, x + 3, y + 10);
      }
      if (b.baker2_code) {
        doc.setFontSize(7);
        doc.setTextColor(20, 130, 120);
        doc.text(b.baker2_code, x + labelWidth - 3, y + 10, { align: 'right' });
      }

      const imgData = canvas.toDataURL('image/png');
      const imgWidth = labelWidth - 8;
      const imgHeight = (canvas.height / canvas.width) * imgWidth;
      doc.addImage(imgData, 'PNG', x + 4, y + 8, imgWidth, Math.min(imgHeight, labelHeight - 12));

      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(b.code, x + labelWidth / 2, y + labelHeight - 3, { align: 'center' });

      col++;
      if (col >= cols) { col = 0; row++; }
    });

    doc.save(`code-barres-${today}-${String(nextNum).padStart(2, '0')}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const available = barcodes.filter((b) => !b.is_used);
  const used = barcodes.filter((b) => b.is_used);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
            <Barcode className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-lg">Générateur de codes à barres</h3>
            <p className="text-sm text-gray-500">Codes à usage unique — créez, exportez en PDF et étiquetez vos pots</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!online && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">
                <WifiOff className="w-4 h-4" /> Hors ligne — sauvegarde locale
              </span>
            )}
            <button onClick={() => onNavigate?.('production')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors">
              <ArrowRight className="w-4 h-4" /> Voir production
            </button>
          </div>
        </div>

        <form onSubmit={handleGenerate} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de pot</label>
            <select
              value={form.potTypeId}
              onChange={(e) => setForm({ ...form, potTypeId: e.target.value })}
              required
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
            >
              <option value="">— Choisir —</option>
              {potTypes.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({formatFCFA(p.unit_price_fcfa)})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Boulanger 1</label>
            <select
              value={form.baker1Id}
              onChange={(e) => setForm({ ...form, baker1Id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
            >
              <option value="">— Aucun —</option>
              {bakers.map((b) => (
                <option key={b.id} value={b.id}>{b.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Boulanger 2</label>
            <select
              value={form.baker2Id}
              onChange={(e) => setForm({ ...form, baker2Id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
            >
              <option value="">— Aucun —</option>
              {bakers.map((b) => (
                <option key={b.id} value={b.id}>{b.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantité</label>
            <input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })}
              required
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={generating}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            {generating ? 'Génération…' : 'Générer'}
          </button>
        </form>
      </div>

      {available.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={exportPDF}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Exporter PDF ({available.length})
            </button>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Réinitialiser disponibles
            </button>
          </div>
        </div>
      )}

      {available.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-600" />
            Codes disponibles ({available.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {available.map((b) => (
              <div key={b.id} className="border border-gray-200 rounded-xl p-3 flex flex-col items-center gap-2 hover:shadow-md transition-shadow">
                <canvas ref={(el) => { canvasRefs.current[b.id] = el; }} className="w-full" />
                <div className="text-xs text-gray-500 font-mono text-center break-all">{b.code}</div>
                <div className="text-xs text-gray-400">{b.pot_type?.name ?? '—'}</div>
                <button
                  onClick={() => deleteBarcode(b.id)}
                  className="text-red-400 hover:text-red-600 text-xs flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Supprimer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {used.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            Codes utilisés ({used.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {used.map((b) => (
              <div key={b.id} className="border border-gray-200 rounded-xl p-3 flex flex-col items-center gap-2 opacity-60">
                <canvas ref={(el) => { canvasRefs.current[b.id] = el; }} className="w-full" />
                <div className="text-xs text-gray-500 font-mono text-center break-all">{b.code}</div>
                <div className="text-xs text-gray-400">{b.pot_type?.name ?? '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {barcodes.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <Barcode className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Aucun code à barres généré pour le moment.</p>
        </div>
      )}

      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full animate-[scaleIn_180ms_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <h3 className="font-bold text-gray-900">Confirmer la réinitialisation</h3>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Cela supprimera tous les codes à barres non utilisés ({available.length} code(s)). Cette action est irréversible.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={resetAvailable}
                disabled={resetting}
                className="flex-1 px-4 py-2 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 disabled:opacity-50"
              >
                {resetting ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
