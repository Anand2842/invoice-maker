export const templates = Object.freeze([
  { id: 'classic', name: 'Classic', description: 'Traditional ruled invoice with a subtle brand accent.' },
  { id: 'modern', name: 'Modern', description: 'Bold brand header and shaded totals.' },
  { id: 'minimal', name: 'Minimal', description: 'Clean monochrome layout with light rules.' },
]);
export function templateStyle(id = 'classic', color = '#6040a0') {
  if (!templates.some(t => t.id === id)) throw new RangeError('Choose a valid PDF template.');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new RangeError('Choose a valid brand color.');
  const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  return { id, accent: id === 'minimal' ? '0.12 0.12 0.12' : channels.map(n => n.toFixed(3)).join(' '),
    tint: id === 'minimal' ? '0.97 0.97 0.97' : channels.map(n => (0.94 + n * 0.06).toFixed(3)).join(' '),
    foreground: channels.reduce((sum, n, i) => sum + n * [0.299, 0.587, 0.114][i], 0) > 0.65 ? '0.1 0.1 0.1' : '1 1 1' };
}
