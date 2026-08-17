import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { formatFCFA } from '@/lib/supabase';

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
  doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, pageWidth - 14, 20, { align: 'right' });

  let startY = subtitle ? 34 : 27;

  if (summary && summary.length > 0) {
    autoTable(doc, {
      startY,
      head: [['Indicateur', 'Valeur']],
      body: summary.map((s) => [s.label, s.value]),
      theme: 'grid',
      headStyles: { fillColor: [251, 146, 60], textColor: 255 },
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: 14, right: 14 },
    });
    startY = (doc as any).lastAutoTable.finalY + 10;
  }

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
  sheetData.push([`Généré le ${new Date().toLocaleString('fr-FR')}`]);
  sheetData.push([]);

  if (summary && summary.length > 0) {
    summary.forEach((s) => sheetData.push([s.label, s.value]));
    sheetData.push([]);
  }

  sheetData.push(columns.map((c) => c.header));
  rows.forEach((r) => sheetData.push(columns.map((c) => r[c.key] ?? '')));

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }));

  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), (fileName ?? title) + '.xlsx');
}

export function downloadMultiPdfReport(reports: PdfOptions[], fileName: string) {
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
    doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, pageWidth - 14, 20, { align: 'right' });

    let startY = report.subtitle ? 34 : 27;

    if (report.summary && report.summary.length > 0) {
      autoTable(doc, {
        startY,
        head: [['Indicateur', 'Valeur']],
        body: report.summary.map((s) => [s.label, s.value]),
        theme: 'grid',
        headStyles: { fillColor: [251, 146, 60], textColor: 255 },
        styles: { fontSize: 9, cellPadding: 3 },
        margin: { left: 14, right: 14 },
      });
      startY = (doc as any).lastAutoTable.finalY + 10;
    }

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
  });

  const blob = doc.output('blob');
  saveAs(blob, fileName + '.pdf');
}

export function downloadMultiExcelReport(reports: ExcelOptions[], fileName: string) {
  const wb = XLSX.utils.book_new();

  reports.forEach((report) => {
    const sheetData: (string | number)[][] = [];
    sheetData.push([report.title]);
    sheetData.push([`Généré le ${new Date().toLocaleString('fr-FR')}`]);
    sheetData.push([]);

    if (report.summary && report.summary.length > 0) {
      report.summary.forEach((s) => sheetData.push([s.label, s.value]));
      sheetData.push([]);
    }

    sheetData.push(report.columns.map((c) => c.header));
    report.rows.forEach((r) => sheetData.push(report.columns.map((c) => r[c.key] ?? '')));

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = report.columns.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }));

    const sheetName = report.title.slice(0, 31).replace(/[\\/?*[\]:]/g, '-');
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName + '.xlsx');
}

export { formatFCFA };
