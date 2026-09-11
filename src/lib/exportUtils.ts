import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { formatFCFA } from '@/lib/supabase';
import { formatBrazzavilleDateTime } from '@/lib/brazzavilleTime';

interface PdfColumn {
  header: string;
  key: string;
  align?: 'left' | 'right' | 'center';
}

interface PdfOptions {
  title: string;
  subtitle?: string;
  columns: PdfColumn[];
  rows: Record<string, string | number>[];
  summary?: { label: string; value: string }[];
  fileName?: string;
}

export function generatePdfReport({ title, subtitle, columns, rows, summary, fileName }: PdfOptions): Blob {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 20);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  if (subtitle) doc.text(subtitle, 14, 27);
  doc.text(`Généré le ${formatBrazzavilleDateTime(new Date())}`, pageWidth - 14, 20, { align: 'right' });

  const startY = subtitle ? 34 : 27;

  autoTable(doc, {
    startY,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => String(r[c.key] ?? ''))),
    theme: 'striped',
    headStyles: { fillColor: [55, 65, 81], textColor: 255 },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: columns.reduce((acc, c, i) => {
      if (c.align === 'right') acc[i] = { halign: 'right' };
      else if (c.align === 'center') acc[i] = { halign: 'center' };
      return acc;
    }, {} as Record<number, any>),
    margin: { left: 14, right: 14 },
  });

  if (summary && summary.length > 0) {
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['Totaux et indicateurs', 'Valeur']],
      body: summary.map((s) => [s.label, s.value]),
      theme: 'grid',
      headStyles: { fillColor: [251, 146, 60], textColor: 255 },
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: 14, right: 14 },
    });
  }

  return doc.output('blob');
}

export function downloadPdfReport(options: PdfOptions) {
  const blob = generatePdfReport(options);
  saveAs(blob, (options.fileName ?? options.title) + '.pdf');
}

export async function sharePdfReport(options: PdfOptions) {
  const blob = generatePdfReport(options);
  const file = new File([blob], (options.fileName ?? options.title) + '.pdf', { type: 'application/pdf' });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: options.title,
        text: options.subtitle ?? options.title,
      });
      return;
    } catch {
      // user cancelled or share failed — fall through to download
    }
  }
  saveAs(blob, (options.fileName ?? options.title) + '.pdf');
}

interface ExcelOptions {
  title: string;
  columns: { header: string; key: string }[];
  rows: Record<string, string | number>[];
  summary?: { label: string; value: string }[];
  fileName?: string;
}

export function downloadExcelReport({ title, columns, rows, summary, fileName }: ExcelOptions) {
  const wb = XLSX.utils.book_new();

  const sheetData: (string | number)[][] = [];
  sheetData.push([title]);
  sheetData.push([`Généré le ${formatBrazzavilleDateTime(new Date())}`]);
  sheetData.push([]);

  sheetData.push(columns.map((c) => c.header));
  rows.forEach((r) => sheetData.push(columns.map((c) => r[c.key] ?? '')));
  if (summary && summary.length > 0) {
    sheetData.push([]);
    sheetData.push(['Totaux et indicateurs', 'Valeur']);
    summary.forEach((s) => sheetData.push([s.label, s.value]));
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }));

  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), (fileName ?? title) + '.xlsx');
}

export function generateMultiPdfReport(reports: PdfOptions[]): Blob {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();

  reports.forEach((report, idx) => {
    if (idx > 0) doc.addPage();

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(55, 65, 81);
    doc.text(report.title, 14, 20);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    if (report.subtitle) doc.text(report.subtitle, 14, 27);
    doc.text(`Généré le ${formatBrazzavilleDateTime(new Date())}`, pageWidth - 14, 20, { align: 'right' });

    const startY = report.subtitle ? 34 : 27;

    if (report.rows.length > 0) {
      autoTable(doc, {
        startY,
        head: [report.columns.map((c) => c.header)],
        body: report.rows.map((r) => report.columns.map((c) => String(r[c.key] ?? ''))),
        theme: 'striped',
        headStyles: { fillColor: [55, 65, 81], textColor: 255 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: report.columns.reduce((acc, c, i) => {
          if (c.align === 'right') acc[i] = { halign: 'right' };
          else if (c.align === 'center') acc[i] = { halign: 'center' };
          return acc;
        }, {} as Record<number, any>),
        margin: { left: 14, right: 14 },
      });
    }

    if (report.summary && report.summary.length > 0) {
      autoTable(doc, {
        startY: report.rows.length > 0 ? (doc as any).lastAutoTable.finalY + 10 : startY,
        head: [['Totaux et indicateurs', 'Valeur']],
        body: report.summary.map((s) => [s.label, s.value]),
        theme: 'grid',
        headStyles: { fillColor: [251, 146, 60], textColor: 255 },
        styles: { fontSize: 9, cellPadding: 3 },
        margin: { left: 14, right: 14 },
      });
    }
  });

  return doc.output('blob');
}

export function downloadMultiPdfReport(reports: PdfOptions[], fileName: string) {
  const blob = generateMultiPdfReport(reports);
  saveAs(blob, fileName + '.pdf');
}

export function downloadMultiExcelReport(reports: ExcelOptions[], fileName: string) {
  const wb = XLSX.utils.book_new();

  reports.forEach((report) => {
    const sheetData: (string | number)[][] = [];
    sheetData.push([report.title]);
    sheetData.push([`Généré le ${formatBrazzavilleDateTime(new Date())}`]);
    sheetData.push([]);

    sheetData.push(report.columns.map((c) => c.header));
    report.rows.forEach((r) => sheetData.push(report.columns.map((c) => r[c.key] ?? '')));
    if (report.summary && report.summary.length > 0) {
      sheetData.push([]);
      sheetData.push(['Totaux et indicateurs', 'Valeur']);
      report.summary.forEach((s) => sheetData.push([s.label, s.value]));
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = report.columns.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }));

    const sheetName = report.title.slice(0, 31).replace(/[\\/?*[\]:]/g, '-');
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName + '.xlsx');
}

/**
 * Fusionne un rapport PDF déjà généré avec des pièces justificatives PDF
 * jointes en annexe (factures, reçus, devis, reconnaissances de dette —
 * voir src/lib/documents.ts). Ajoute une page de garde "Annexes" listant
 * chaque pièce avant ses pages. Une annexe qu'on n'arrive pas à lire
 * (fichier corrompu, etc.) est ignorée plutôt que de faire échouer tout
 * l'export — le rapport principal reste toujours généré.
 */
export async function appendPdfAnnexes(
  mainBlob: Blob,
  annexes: { title: string; bytes: ArrayBuffer }[],
): Promise<Blob> {
  if (annexes.length === 0) return mainBlob;

  // Chargé à la demande : pdf-lib ne doit alourdir le bundle que pour les
  // exports qui joignent réellement des annexes, pas tous les rapports.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const mainBytes = await mainBlob.arrayBuffer();
  const merged = await PDFDocument.load(mainBytes);

  const usable: { title: string; doc: Awaited<ReturnType<typeof PDFDocument.load>> }[] = [];
  for (const annex of annexes) {
    try {
      const doc = await PDFDocument.load(annex.bytes);
      usable.push({ title: annex.title, doc });
    } catch {
      // Pièce jointe illisible comme PDF — on l'ignore silencieusement.
    }
  }
  if (usable.length === 0) return mainBlob;

  const font = await merged.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await merged.embedFont(StandardFonts.Helvetica);
  const coverPage = merged.addPage();
  const { width, height } = coverPage.getSize();
  coverPage.drawText('ANNEXES', { x: 40, y: height - 60, size: 22, font, color: rgb(0.2, 0.25, 0.32) });
  coverPage.drawText('Pièces justificatives jointes à ce rapport :', { x: 40, y: height - 90, size: 11, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
  usable.forEach((annex, index) => {
    const y = height - 120 - index * 20;
    if (y < 40) return;
    coverPage.drawText(`${index + 1}. ${annex.title}`, { x: 40, y, size: 10, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
  });

  for (const annex of usable) {
    const pages = await merged.copyPages(annex.doc, annex.doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  const mergedBytes = await merged.save();
  return new Blob([mergedBytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}

export { formatFCFA };
