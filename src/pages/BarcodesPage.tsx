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

// Formats de codes-barres linéaires uniquement (pas de QR) : certains points
// de vente/supermarchés partenaires scannent une série plutôt qu'une autre.
export const LINEAR_BARCODE_FORMATS = ['CODE128', 'EAN13', 'EAN8', 'CODE39', 'UPC'] as const;
export type LinearBarcodeFormat = (typeof LINEAR_BARCODE_FORMATS)[number];

function drawBarcodeOnCanvas(canvas: HTMLCanvasElement, text: string, format: LinearBarcodeFormat = 'CODE128'): void {
  try {
    JsBarcode(canvas, text, {
      format,
      displayValue: true,
      fontSize: 14,
      height: 80,
      width: 2,
      margin: 10,
    });
  } catch {
    // ignore rendering errors (format incompatible with this code's characters)
  }
}

async function loadLabelAssets(src: string): Promise<{ labelDataUrl: string; patternBandDataUrl: string; patternBandRatio: number }> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Impossible de charger l’image (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = image.naturalWidth;
      labelCanvas.height = image.naturalHeight;
      const labelContext = labelCanvas.getContext('2d');
      if (!labelContext) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Préparation de l’étiquette impossible.'));
        return;
      }
      labelContext.drawImage(image, 0, 0);

      // Reuse the complete original lower frieze so the extension keeps the
      // exact motif shapes, scale and stroke weight of the printed artwork.
      const cropX = 0;
      const cropY = Math.round(image.naturalHeight * 0.952);
      const cropWidth = image.naturalWidth;
      const cropHeight = image.naturalHeight - cropY;
      const patternBandCanvas = document.createElement('canvas');
      patternBandCanvas.width = cropWidth;
      patternBandCanvas.height = cropHeight;
      const patternBandContext = patternBandCanvas.getContext('2d');
      if (!patternBandContext) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Extraction de la frise impossible.'));
        return;
      }
      patternBandContext.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

      URL.revokeObjectURL(objectUrl);
      resolve({
        labelDataUrl: labelCanvas.toDataURL('image/png'),
        patternBandDataUrl: patternBandCanvas.toDataURL('image/png'),
        patternBandRatio: cropHeight / cropWidth,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Lecture de l’image impossible.'));
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

function drawVariablePanelPattern(doc: jsPDF, patternBandDataUrl: string, patternBandRatio: number, x: number, y: number, width: number, height: number): void {
  const bandHeight = width * patternBandRatio;
  const rows = Math.ceil(height / bandHeight);
  for (let row = 0; row < rows; row++) {
    doc.addImage(patternBandDataUrl, 'PNG', x, y + row * bandHeight, width, bandHeight, `madeleine-frieze-${row}`, 'FAST');
  }
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

// Codes EAN-13 pour les étiquettes destinées aux supermarchés/points de
// vente institutionnels — un vrai code numérique scannable, pas un simple
// alphanumérique interne. Préfixe 20-29 : plage GS1 réservée à la
// « circulation restreinte » (usage interne à une entreprise), donc valide
// sans avoir besoin d'un numéro d'entreprise GS1 enregistré.
function ean13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = digits12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

function generateEAN13(potIndex: number, sequence: number): string {
  const prefix = '20';
  const potCode = String(potIndex % 100).padStart(2, '0');
  const seq = String(sequence % 100000000).padStart(8, '0');
  const base12 = prefix + potCode + seq;
  return base12 + String(ean13CheckDigit(base12));
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
  const [labelWidthMm, setLabelWidthMm] = useState(85);
  const [barcodeFormat, setBarcodeFormat] = useState<LinearBarcodeFormat>('CODE128');
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ potTypeId: '', quantity: 1, notes: '', baker1Id: '', baker2Id: '', productionRecordId: '' });
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  // Sous-page « Supermarché » : étiquettes EAN-13 pour points de vente
  // institutionnels — générées à la volée, pas persistées en base (aucune
  // migration nécessaire).
  const [subPage, setSubPage] = useState<'classique' | 'supermarche'>('classique');
  const [smPotTypeId, setSmPotTypeId] = useState('');
  const [smQuantity, setSmQuantity] = useState(1);
  const [smStartSeq, setSmStartSeq] = useState(1);
  const [smLabelWidthMm, setSmLabelWidthMm] = useState(85);
  const [smCodes, setSmCodes] = useState<{ code: string; potTypeName: string }[]>([]);
  const [smExporting, setSmExporting] = useState(false);
  const [smError, setSmError] = useState<string | null>(null);
  const smCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  useEffect(() => {
    smCodes.forEach(({ code }) => {
      const canvas = smCanvasRefs.current[code];
      if (canvas) drawBarcodeOnCanvas(canvas, code, 'EAN13');
    });
  }, [smCodes]);

  const generateSupermarche = (e: React.FormEvent) => {
    e.preventDefault();
    if (!smPotTypeId || smQuantity < 1) return;
    const potIndex = potTypes.findIndex((p) => p.id === smPotTypeId) + 1;
    const potType = potTypes.find((p) => p.id === smPotTypeId);
    const codes = Array.from({ length: smQuantity }, (_, i) => ({
      code: generateEAN13(potIndex, smStartSeq + i),
      potTypeName: potType?.name ?? '—',
    }));
    setSmCodes(codes);
  };

  const exportSupermarchePDF = async () => {
    if (smCodes.length === 0) return;
    setSmExporting(true);
    setSmError(null);
    try {
      const { labelDataUrl: labelArtworkDataUrl, patternBandDataUrl, patternBandRatio } = await loadLabelAssets('/etiquette-madeleines-mimsi-sans-qr-hd.png');
      const today = new Date().toISOString().slice(0, 10);
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const margin = 10;
      const labelWidth = smLabelWidthMm;
      const artworkHeight = labelWidth;
      const variablePanelHeight = 22;
      const labelHeight = artworkHeight + variablePanelHeight;
      const gapX = 5;
      const gapY = 6;
      const headerOffset = 10;
      const cols = Math.max(1, Math.floor((210 - 2 * margin + gapX) / (labelWidth + gapX)));
      const rowsPerPage = Math.max(1, Math.floor((297 - margin - headerOffset - margin + gapY) / (labelHeight + gapY)));

      let col = 0;
      let row = 0;
      let pageIndex = 0;
      const drawPageHeader = (pg: number) => {
        doc.setFontSize(10);
        doc.setTextColor(120, 120, 120);
        doc.text(`Étiquettes supermarché (EAN-13) — page ${pg + 1}`, margin, 7);
      };
      drawPageHeader(pageIndex);

      smCodes.forEach(({ code, potTypeName }) => {
        if (row >= rowsPerPage) {
          doc.addPage();
          pageIndex++;
          row = 0;
          col = 0;
          drawPageHeader(pageIndex);
        }
        const x = margin + col * (labelWidth + gapX);
        const y = margin + 10 + row * (labelHeight + gapY);

        doc.setDrawColor(190, 22, 25);
        doc.setLineWidth(0.35);
        doc.roundedRect(x, y, labelWidth, labelHeight, 2, 2, 'S');
        doc.addImage(labelArtworkDataUrl, 'PNG', x, y, labelWidth, artworkHeight);
        doc.setFillColor(255, 255, 255);
        doc.rect(x + 0.35, y + artworkHeight, labelWidth - 0.7, variablePanelHeight - 0.35, 'F');
        drawVariablePanelPattern(doc, patternBandDataUrl, patternBandRatio, x, y + artworkHeight, labelWidth, variablePanelHeight);

        const panelTop = y + artworkHeight;
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x + 7, panelTop + 0.8, labelWidth - 14, 4.8, 0.8, 0.8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(190, 22, 25);
        const potNameUpper = potTypeName.toUpperCase();
        fitFontSize(doc, potNameUpper, labelWidth - 10, 10, 7);
        doc.text(potNameUpper, x + labelWidth / 2, panelTop + 4.5, { align: 'center' });

        const barcodeCanvas = document.createElement('canvas');
        JsBarcode(barcodeCanvas, code, {
          format: 'EAN13',
          displayValue: false,
          height: 60,
          width: 2,
          margin: 12,
          background: '#ffffff',
          lineColor: '#000000',
        });
        const barcodeData = barcodeCanvas.toDataURL('image/png');
        doc.addImage(barcodeData, 'PNG', x + 5, panelTop + 6, labelWidth - 10, 9);

        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x + 8, panelTop + 17.4, labelWidth - 16, 4.2, 0.8, 0.8, 'F');
        doc.setFont('courier', 'normal');
        doc.setTextColor(45, 52, 54);
        fitFontSize(doc, code, labelWidth - 10, 8, 6);
        doc.text(code, x + labelWidth / 2, panelTop + 20.5, { align: 'center' });

        col++;
        if (col >= cols) { col = 0; row++; }
      });

      doc.save(`code-barres-supermarche-${today}.pdf`);
    } catch (error) {
      console.error('supermarché barcode PDF export failed:', error);
      setSmError('Impossible de générer le PDF. Réessayez.');
    } finally {
      setSmExporting(false);
    }
  };

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
      if (canvas) drawBarcodeOnCanvas(canvas, b.code, barcodeFormat);
    });
  }, [barcodes, barcodeFormat]);

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
      const { labelDataUrl: labelArtworkDataUrl, patternBandDataUrl, patternBandRatio } = await loadLabelAssets('/etiquette-madeleines-mimsi-sans-qr-hd.png');

      const today = new Date().toISOString().slice(0, 10);

      const counterKey = `barcode_pdf_counter_${today}`;
      const current = parseInt(localStorage.getItem(counterKey) ?? '0', 10) || 0;
      const nextNum = current + 1;
      localStorage.setItem(counterKey, String(nextNum));

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const margin = 10;
      const labelWidth = labelWidthMm;
      // L'artwork de l'étiquette est carré à l'origine (85x85) : on garde ce
      // ratio 1:1 quelle que soit la largeur choisie pour ne pas le déformer.
      const artworkHeight = labelWidth;
      const variablePanelHeight = 22;
      const labelHeight = artworkHeight + variablePanelHeight;
      const gapX = 5;
      const gapY = 6;
      const headerOffset = 10;
      const cols = Math.max(1, Math.floor((210 - 2 * margin + gapX) / (labelWidth + gapX)));
      const rowsPerPage = Math.max(1, Math.floor((297 - margin - headerOffset - margin + gapY) / (labelHeight + gapY)));

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

        doc.setDrawColor(190, 22, 25);
        doc.setLineWidth(0.35);
        doc.roundedRect(x, y, labelWidth, labelHeight, 2, 2, 'S');

        doc.addImage(labelArtworkDataUrl, 'PNG', x, y, labelWidth, artworkHeight);
        doc.setFillColor(255, 255, 255);
        doc.rect(x + 0.35, y + artworkHeight, labelWidth - 0.7, variablePanelHeight - 0.35, 'F');
        drawVariablePanelPattern(doc, patternBandDataUrl, patternBandRatio, x, y + artworkHeight, labelWidth, variablePanelHeight);

        const potName = (b.pot_type?.name ?? '—').toUpperCase();
        const lotCode = b.production_record ? generateLotCode(b.production_record) : null;
        const panelTop = y + artworkHeight;
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x + 7, panelTop + 0.8, labelWidth - 14, lotCode ? 6.2 : 4.8, 0.8, 0.8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(190, 22, 25);
        fitFontSize(doc, potName, labelWidth - 10, 10, 7);
        doc.text(potName, x + labelWidth / 2, panelTop + (lotCode ? 3.5 : 4.5), { align: 'center' });

        if (lotCode) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(70, 70, 70);
          fitFontSize(doc, lotCode, labelWidth - 10, 6, 5);
          doc.text(lotCode, x + labelWidth / 2, panelTop + 6.5, { align: 'center' });
        }

        const barcodeCanvas = document.createElement('canvas');
        JsBarcode(barcodeCanvas, b.code, {
          format: barcodeFormat,
          displayValue: false,
          height: 60,
          width: 2,
          margin: 12,
          background: '#ffffff',
          lineColor: '#000000',
        });
        const barcodeData = barcodeCanvas.toDataURL('image/png');
        const barcodeY = panelTop + (lotCode ? 7.5 : 6);
        doc.addImage(barcodeData, 'PNG', x + 5, barcodeY, labelWidth - 10, 9);

        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x + 8, panelTop + 17.4, labelWidth - 16, 4.2, 0.8, 0.8, 'F');
        doc.setFont('courier', 'normal');
        doc.setTextColor(45, 52, 54);
        fitFontSize(doc, b.code, labelWidth - 10, 8, 6);
        doc.text(b.code, x + labelWidth / 2, panelTop + 20.5, { align: 'center' });

        col++;
        if (col >= cols) { col = 0; row++; }
      });

      doc.save(`code-barres-${today}-${String(nextNum).padStart(2, '0')}.pdf`);
    } catch (error) {
      console.error('barcode PDF export failed:', error);
      setPdfError('Impossible de générer le PDF. Vérifiez que la nouvelle étiquette est disponible puis réessayez.');
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
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSubPage('classique')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
            subPage === 'classique' ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Barcode className="w-4 h-4" /> Classique
        </button>
        <button
          onClick={() => setSubPage('supermarche')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
            subPage === 'supermarche' ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Package className="w-4 h-4" /> Supermarché
        </button>
      </div>

      {subPage === 'classique' && (
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

      {available.length > 0 && (() => {
        const artworkH = labelWidthMm;
        const labelH = artworkH + 22;
        const colsPreview = Math.max(1, Math.floor((210 - 2 * 10 + 5) / (labelWidthMm + 5)));
        const rowsPreview = Math.max(1, Math.floor((297 - 10 - 10 - 10 + 6) / (labelH + 6)));
        const perSheet = colsPreview * rowsPreview;
        const sheetsNeeded = Math.ceil(available.length / perSheet);
        return (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Largeur étiquette (mm)</label>
              <input
                type="number"
                min={30}
                max={100}
                value={labelWidthMm}
                onChange={(e) => setLabelWidthMm(Math.min(100, Math.max(30, parseInt(e.target.value) || 85)))}
                className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type de code à barres</label>
              <select
                value={barcodeFormat}
                onChange={(e) => setBarcodeFormat(e.target.value as LinearBarcodeFormat)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none bg-white"
              >
                {LINEAR_BARCODE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <span className="font-medium text-gray-900">{perSheet}</span> étiquette{perSheet > 1 ? 's' : ''} / feuille A4
              {' · '}
              <span className="font-medium text-gray-900">{available.length}</span> au total → <span className="font-medium text-gray-900">{sheetsNeeded}</span> feuille{sheetsNeeded > 1 ? 's' : ''}
            </div>
          </div>
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
        </div>
        );
      })()}

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
      )}

      {subPage === 'supermarche' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
                <Package className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-lg">Codes à barres pour supermarché</h3>
                <p className="text-sm text-gray-500">Codes EAN-13 institutionnels, générés à la volée — pas liés au stock/production</p>
              </div>
            </div>

            <form onSubmit={generateSupermarche} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de pot</label>
                <select
                  value={smPotTypeId}
                  onChange={(e) => setSmPotTypeId(e.target.value)}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Numéro de départ</label>
                <input
                  type="number"
                  min={1}
                  value={smStartSeq}
                  onChange={(e) => setSmStartSeq(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité</label>
                <input
                  type="number"
                  min={1}
                  value={smQuantity}
                  onChange={(e) => setSmQuantity(parseInt(e.target.value) || 1)}
                  required
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium shadow-md hover:shadow-lg transition-all"
              >
                <Plus className="w-5 h-5" /> Générer
              </button>
            </form>
            <p className="mt-3 text-xs text-gray-400">
              Format EAN-13, préfixe 20 (plage GS1 réservée à l'usage interne/institutionnel) — pas besoin d'enregistrement GS1. Ces codes ne sont pas enregistrés en base : ils servent uniquement à imprimer des étiquettes pour ce lot de supermarché.
            </p>
          </div>

          {smCodes.length > 0 && (() => {
            const artworkH = smLabelWidthMm;
            const labelH = artworkH + 22;
            const colsPreview = Math.max(1, Math.floor((210 - 2 * 10 + 5) / (smLabelWidthMm + 5)));
            const rowsPreview = Math.max(1, Math.floor((297 - 10 - 10 - 10 + 6) / (labelH + 6)));
            const perSheet = colsPreview * rowsPreview;
            const sheetsNeeded = Math.ceil(smCodes.length / perSheet);
            return (
              <div className="space-y-3">
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Largeur étiquette (mm)</label>
                    <input
                      type="number"
                      min={30}
                      max={100}
                      value={smLabelWidthMm}
                      onChange={(e) => setSmLabelWidthMm(Math.min(100, Math.max(30, parseInt(e.target.value) || 85)))}
                      className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none"
                    />
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="font-medium text-gray-900">{perSheet}</span> étiquette{perSheet > 1 ? 's' : ''} / feuille A4
                    {' · '}
                    <span className="font-medium text-gray-900">{smCodes.length}</span> au total → <span className="font-medium text-gray-900">{sheetsNeeded}</span> feuille{sheetsNeeded > 1 ? 's' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { void exportSupermarchePDF(); }}
                    disabled={smExporting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
                  >
                    {smExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {smExporting ? 'Génération du PDF…' : `Exporter PDF (${smCodes.length})`}
                  </button>
                  {smError && <p className="text-sm text-red-600">{smError}</p>}
                </div>
              </div>
            );
          })()}

          {smCodes.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-600" />
                Codes générés ({smCodes.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {smCodes.map(({ code, potTypeName }) => (
                  <div key={code} className="border border-gray-200 rounded-xl p-3 flex flex-col items-center gap-2">
                    <canvas ref={(el) => { smCanvasRefs.current[code] = el; }} className="w-full" />
                    <div className="text-xs text-gray-500 font-mono text-center break-all">{code}</div>
                    <div className="text-xs text-gray-400">{potTypeName}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
