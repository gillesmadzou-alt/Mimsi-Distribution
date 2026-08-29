import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase, PotType, Barcode as BarcodeType, Baker, ProductionRecord, formatFCFA, generateBakerCode } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import { Barcode, Download, Plus, Trash2, Loader2, Package, CheckCircle2, RotateCcw, AlertTriangle, ArrowRight, WifiOff } from 'lucide-react';
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

async function loadLogoAsDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Impossible de charger le logo (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return await new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 600;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Préparation du logo impossible.'));
        return;
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        image.naturalWidth * 0.2,
        image.naturalHeight * 0.27,
        image.naturalWidth * 0.6,
        image.naturalHeight * 0.4,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Lecture du logo impossible.'));
    };
    image.src = objectUrl;
  });
}

function fitFontSize(doc: jsPDF, text: string, maxWidth: number, initialSize: number, minimumSize: number): number {
  let size = initialSize;
  doc.setFontSize(size);
  while (size > minimumSize && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

function generateCode(index: number, baker1Code?: string, baker2Code?: string): string {
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const p1 = baker1Code ?? '';
  const p2 = baker2Code ?? '';
  const prefix = (p1 || p2) ? `${p1}${p2 ? '-' + p2 : ''}-` : '';
  return `${prefix}POT-${random}-${String(index).padStart(3, '0')}`;
}

function generateLotCode(record: ProductionRecord): string {
  return `LOT-${record.production_date.split('-').join('')}-${record.id.slice(0, 8).toUpperCase()}`;
}

export default function BarcodesPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { offlineMode, manualOffline } = useAuth();
  const { isOnline: online } = useSync();
  const isOffline = offlineMode || manualOffline || !navigator.onLine;
  const [potTypes, setPotTypes] = useState<PotType[]>([]);
  const [bakers, setBakers] = useState<Baker[]>([]);
  const [productionRecords, setProductionRecords] = useState<ProductionRecord[]>([]);
  const [barcodes, setBarcodes] = useState<BarcodeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ potTypeId: '', quantity: 1, notes: '', baker1Id: '', baker2Id: '', productionRecordId: '' });
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

    const [potRes, barRes, bakerRes, productionRes] = await Promise.all([
      supabase.from('pot_types').select('*').order('name'),
      supabase.from('barcodes').select('*, pot_type:pot_types(*), baker:bakers!baker_id(*), baker2:bakers!baker2_id(*), production_record:production_records(*, baker:bakers(*)), deposit_barcodes(id, scanned_at, deposit:deposits(id, deposited_at, sales_point:sales_points(id, name), batch:delivery_batches(id, batch_code, driver:drivers(id, full_name))))').order('created_at', { ascending: false }),
      supabase.from('bakers').select('*').eq('status', 'actif').order('full_name'),
      supabase.from('production_records').select('*, baker:bakers(*), pot_type:pot_types(*)').order('production_date', { ascending: false }),
    ]);
    setPotTypes(potRes.data ?? []);
    setBarcodes(barRes.data ?? []);
    setBakers(bakerRes.data ?? []);
    setProductionRecords(productionRes.data ?? []);
    setLoading(false);
    try { await cachePageData('barcodes-page', { potTypes: potRes.data ?? [], bakers: bakerRes.data ?? [] }); } catch { /* ignore */ }

    // Update cache with fresh available barcodes
    const available = (barRes.data ?? []).filter((b) => !b.is_used);
    try { await cacheBarcodes(available); } catch { /* ignore */ }
  }, [isOffline]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useRealtimeSubscription('barcodes-page', ['barcodes', 'pot_types', 'bakers', 'deposit_barcodes'], loadAll);

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
    const productionRecord = productionRecords.find((record) => record.id === form.productionRecordId);
    const baker1 = productionRecord?.baker ?? bakers.find((b) => b.id === form.baker1Id);
    const baker2 = bakers.find((b) => b.id === form.baker2Id);
    const baker1Code = baker1 ? generateBakerCode(baker1.full_name) : null;
    const baker2Code = baker2 ? generateBakerCode(baker2.full_name) : null;

    const rows = Array.from({ length: productionRecord ? 1 : form.quantity }, (_, i) => ({
      code: productionRecord ? generateLotCode(productionRecord) : generateCode(i + 1, baker1Code ?? undefined, baker2Code ?? undefined),
      pot_type_id: productionRecord?.pot_type_id ?? form.potTypeId,
      quantity: productionRecord?.quantity ?? 1,
      notes: form.notes || null,
      is_used: false,
      baker_id: form.baker1Id || null,
      baker_code: baker1Code,
      baker2_id: form.baker2Id || null,
      baker2_code: baker2Code,
      production_record_id: productionRecord?.id ?? null,
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
      setForm({ potTypeId: '', quantity: 1, notes: '', baker1Id: '', baker2Id: '', productionRecordId: '' });
      setGenerating(false);
      return;
    }

    const { data, error } = await supabase.from('barcodes').insert(rows).select('*, pot_type:pot_types(*), baker:bakers!baker_id(*), baker2:bakers!baker2_id(*), production_record:production_records(*, baker:bakers(*))');
    if (error) {
      console.error('barcode insert failed:', error);
      setGenerating(false);
      return;
    }
    if (data) {
      setBarcodes((prev) => [...data, ...prev]);
      for (const b of data) { try { await addCachedBarcode(b); } catch { /* ignore */ } }
    }
    setForm({ potTypeId: '', quantity: 1, notes: '', baker1Id: '', baker2Id: '', productionRecordId: '' });
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

  const exportPDF = async () => {
    const available = barcodes.filter((b) => !b.is_used);
    if (available.length === 0) return;

    setExportingPdf(true);
    setPdfError(null);

    try {
      const logoDataUrl = await loadLogoAsDataUrl('/WhatsApp_Image_2026-07-31_at_19.28.27.jpeg');

      const today = new Date().toISOString().slice(0, 10);

      const counterKey = `barcode_pdf_counter_${today}`;
      const current = parseInt(localStorage.getItem(counterKey) ?? '0', 10) || 0;
      const nextNum = current + 1;
      localStorage.setItem(counterKey, String(nextNum));

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const margin = 10;
      const labelWidth = 85;
      const labelHeight = 60;
      const gapX = 5;
      const gapY = 5;
      const cols = 2;
      const rowsPerPage = 4;

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

        const x = margin + col * (labelWidth + gapX);
        const y = margin + 10 + row * (labelHeight + gapY);

        doc.setDrawColor(245, 124, 22);
        doc.setLineWidth(0.35);
        doc.roundedRect(x, y, labelWidth, labelHeight, 2, 2, 'S');

        const logoWidth = 36;
        const logoHeight = 20;
        doc.addImage(logoDataUrl, 'PNG', x + (labelWidth - logoWidth) / 2, y + 1.5, logoWidth, logoHeight);

        const potName = (b.pot_type?.name ?? '—').toUpperCase();
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(45, 52, 54);
        fitFontSize(doc, potName, labelWidth - 10, 12, 8);
        doc.text(potName, x + labelWidth / 2, y + 26, { align: 'center' });

        const barcodeCanvas = document.createElement('canvas');
        JsBarcode(barcodeCanvas, b.code, {
          format: 'CODE128',
          displayValue: false,
          height: 60,
          width: 2,
          margin: 12,
          background: '#ffffff',
          lineColor: '#000000',
        });
        const barcodeData = barcodeCanvas.toDataURL('image/png');
        // The space between the pot name and the barcode is intentionally
        // preserved for an optional lot number when that field is introduced.
        doc.addImage(barcodeData, 'PNG', x + 5, y + 31, labelWidth - 10, 14);

        doc.setFont('courier', 'normal');
        doc.setTextColor(45, 52, 54);
        fitFontSize(doc, b.code, labelWidth - 10, 8, 6);
        doc.text(b.code, x + labelWidth / 2, y + 53, { align: 'center' });

        col++;
        if (col >= cols) { col = 0; row++; }
      });

      doc.save(`code-barres-${today}-${String(nextNum).padStart(2, '0')}.pdf`);
    } catch (error) {
      console.error('barcode PDF export failed:', error);
      setPdfError('Impossible de générer le PDF. Vérifiez que le logo est disponible puis réessayez.');
    } finally {
      setExportingPdf(false);
    }
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
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Production à tracer (optionnel)</label>
            <select value={form.productionRecordId} onChange={(e) => {
              const record = productionRecords.find((item) => item.id === e.target.value);
              setForm({ ...form, productionRecordId: e.target.value, potTypeId: record?.pot_type_id ?? form.potTypeId, baker1Id: record?.baker_id ?? form.baker1Id, quantity: record?.quantity ?? form.quantity });
            }} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none">
              <option value="">— Code par pot (mode existant) —</option>
              {productionRecords.map((record) => <option key={record.id} value={record.id}>{new Date(record.production_date).toLocaleDateString('fr-FR')} · {record.pot_type?.name ?? 'Pot'} · {record.baker?.full_name ?? 'Pétrisseur'} · {record.quantity} pots</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400">Un code de lot unique est créé pour une production sélectionnée.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de pot</label>
            <select
              value={form.potTypeId}
              onChange={(e) => setForm({ ...form, potTypeId: e.target.value, productionRecordId: '' })}
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
              required disabled={Boolean(form.productionRecordId)}
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
              onClick={() => { void exportPDF(); }}
              disabled={exportingPdf}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
            >
              {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exportingPdf ? 'Génération du PDF…' : `Exporter PDF (${available.length})`}
            </button>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Réinitialiser disponibles
            </button>
          </div>
          {pdfError && <p className="w-full text-sm text-red-600">{pdfError}</p>}
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
                {b.production_record && <div className="text-xs text-emerald-700 text-center">Lot · {b.production_record.baker?.full_name ?? 'Pétrisseur'}</div>}
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
            {used.map((b) => {
              const trace = b.deposit_barcodes?.[0];
              return (
                <div key={b.id} className="border border-gray-200 rounded-xl p-3 flex flex-col items-center gap-2 opacity-60">
                  <canvas ref={(el) => { canvasRefs.current[b.id] = el; }} className="w-full" />
                  <div className="text-xs text-gray-500 font-mono text-center break-all">{b.code}</div>
                  <div className="text-xs text-gray-400">{b.pot_type?.name ?? '—'}</div>
                  {trace ? (
                    <div className="w-full rounded-lg bg-emerald-50 px-2 py-1.5 text-[10px] leading-4 text-emerald-800">
                      <p>Lot : {trace.deposit?.batch?.batch_code ?? '—'}</p>
                      <p>PDV : {trace.deposit?.sales_point?.name ?? '—'}</p>
                      <p>Commercial : {trace.deposit?.batch?.driver?.full_name ?? '—'}</p>
                      <p>{new Date(trace.scanned_at).toLocaleString('fr-FR')}</p>
                    </div>
                  ) : b.used_at ? (
                    <div className="text-[10px] text-gray-400">Utilisé le {new Date(b.used_at).toLocaleDateString('fr-FR')}</div>
                  ) : null}
                </div>
              );
            })}
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
