/**
 * Stable administrative reference data used by operational filters.
 * Filters must not become incomplete simply because no sale has yet been
 * recorded in a particular arrondissement.
 */
export const BRAZZAVILLE_ARRONDISSEMENTS = [
  'Makélékélé',
  'Bacongo',
  'Poto-Poto',
  'Moungali',
  'Ouenzé',
  'Talangaï',
  'Mfilou',
  'Madibou',
  'Djiri',
] as const;

export function normaliseLocation(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function getBrazzavilleArrondissementOptions(values: Array<string | null | undefined>): string[] {
  const canonical = new Map(BRAZZAVILLE_ARRONDISSEMENTS.map((name) => [normaliseLocation(name), name]));
  const result = new Set<string>(BRAZZAVILLE_ARRONDISSEMENTS);

  values.filter((value): value is string => Boolean(value?.trim())).forEach((value) => {
    result.add(canonical.get(normaliseLocation(value)) ?? value.trim());
  });

  return [...result];
}

export function sameArrondissement(left: string | null | undefined, right: string | null | undefined): boolean {
  return normaliseLocation(left) === normaliseLocation(right);
}
