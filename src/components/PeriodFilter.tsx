import { useState, useEffect, useMemo } from 'react';
import { Calendar } from 'lucide-react';

export type PeriodPreset = 'today' | 'week' | 'month' | 'year' | 'custom';

export interface PeriodRange {
  startISO: string;
  endISO: string;
  label: string;
}

function toISODate(d: Date) { return d.toISOString().slice(0, 10); }

function computeRange(
  preset: PeriodPreset,
  singleDay: string,
  monthValue: string,
  customFrom: string,
  customTo: string,
): PeriodRange {
  const now = new Date();
  if (preset === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { startISO: s.toISOString(), endISO: e.toISOString(), label: `Aujourd'hui (${toISODate(now)})` };
  }
  if (preset === 'week') {
    const s = new Date(now); s.setDate(now.getDate() - 6); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { startISO: s.toISOString(), endISO: e.toISOString(), label: '7 derniers jours' };
  }
  if (preset === 'month') {
    const [y, m] = monthValue.split('-').map(Number);
    const s = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const e = new Date(y, m, 0, 23, 59, 59, 999);
    return { startISO: s.toISOString(), endISO: e.toISOString(), label: s.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
  }
  if (preset === 'year') {
    const s = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { startISO: s.toISOString(), endISO: e.toISOString(), label: `Année ${now.getFullYear()}` };
  }
  const s = new Date(customFrom + 'T00:00:00');
  const e = new Date(customTo + 'T23:59:59.999');
  return { startISO: s.toISOString(), endISO: e.toISOString(), label: `${customFrom} → ${customTo}` };
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Un jour',
  week: '7 jours',
  month: 'Un mois',
  year: 'Cette année',
  custom: 'Période personnalisée',
};

const PRESETS: PeriodPreset[] = ['today', 'week', 'month', 'year', 'custom'];

interface PeriodFilterProps {
  onRangeChange: (range: PeriodRange) => void;
  defaultPreset?: PeriodPreset;
}

export default function PeriodFilter({ onRangeChange, defaultPreset = 'week' }: PeriodFilterProps) {
  const [preset, setPreset] = useState<PeriodPreset>(defaultPreset);
  const [singleDay, setSingleDay] = useState(toISODate(new Date()));
  const [monthValue, setMonthValue] = useState(toISODate(new Date()).slice(0, 7));
  const [customFrom, setCustomFrom] = useState(toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customTo, setCustomTo] = useState(toISODate(new Date()));

  const range = useMemo(
    () => computeRange(preset, singleDay, monthValue, customFrom, customTo),
    [preset, singleDay, monthValue, customFrom, customTo],
  );

  useEffect(() => { onRangeChange(range); /* eslint-disable-next-line */ }, [range]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => setPreset(p)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${preset === p ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>
            {PRESET_LABELS[p]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          <Calendar className="w-4 h-4" />
          <span>{range.label}</span>
        </div>
      </div>

      {preset === 'today' && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Date :</label>
          <input type="date" value={singleDay} onChange={(e) => setSingleDay(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      )}
      {preset === 'month' && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Mois :</label>
          <input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      )}
      {preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-600">Du :</label>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <label className="text-sm text-gray-600">Au :</label>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      )}
    </div>
  );
}
