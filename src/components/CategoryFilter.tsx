export type PersonnelCategory = 'all' | 'commercial' | 'fournier' | 'petrisseur';

const OPTIONS: { id: PersonnelCategory; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'commercial', label: 'Commerciaux' },
  { id: 'fournier', label: 'Fourniers' },
  { id: 'petrisseur', label: 'Pétrisseurs' },
];

interface CategoryFilterProps {
  value: PersonnelCategory;
  onChange: (value: PersonnelCategory) => void;
  label?: string;
}

export default function CategoryFilter({ value, onChange, label = 'Catégorie' }: CategoryFilterProps) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => (
          <button key={opt.id} onClick={() => onChange(opt.id)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${value === opt.id ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
