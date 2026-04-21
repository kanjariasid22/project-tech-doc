export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveModuleName(
  affectedModules: string[],
  prNumber: number,
): string {
  const first = affectedModules[0]?.trim();
  return toSlug(first && first.length > 0 ? first : `pr-${prNumber}`);
}
