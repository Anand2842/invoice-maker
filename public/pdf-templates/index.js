export const templates = Object.freeze([
  { id: 'classic', name: 'Classic', description: 'Traditional ruled invoice with a subtle brand accent.' },
  { id: 'modern', name: 'Modern', description: 'Bold brand header and shaded totals.' },
  { id: 'elegant', name: 'Elegant', description: 'Serif headings and restrained accent rules.' },
  { id: 'compact', name: 'Compact', description: 'Dense item rows for longer invoices.' },
  { id: 'minimal', name: 'Minimal', description: 'Clean monochrome layout with light rules.' },
]);
// Businesses made before the teal rebrand have the old purple saved as their brand colour; print teal instead.
const LEGACY_BRAND_COLORS = new Set(['#3c136b', '#5b3fa8']);
export const brandColor = c => LEGACY_BRAND_COLORS.has(String(c || '').toLowerCase()) ? '#115e59' : c;
export function templateStyle(id = 'classic', color = '#115e59') {
  color = brandColor(color);
  if (!templates.some(t => t.id === id)) throw new RangeError('Choose a valid PDF template.');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new RangeError('Choose a valid brand color.');
  const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  return { id, accent: id === 'minimal' ? '0.12 0.12 0.12' : channels.map(n => n.toFixed(3)).join(' '),
    tint: id === 'minimal' ? '0.97 0.97 0.97' : channels.map(n => (0.94 + n * 0.06).toFixed(3)).join(' '),
    foreground: channels.reduce((sum, n, i) => sum + n * [0.299, 0.587, 0.114][i], 0) > 0.65 ? '0.1 0.1 0.1' : '1 1 1' };
}
