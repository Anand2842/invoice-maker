/* TrueType support for the local PDF writer. Glyph IDs are deliberately retained
 * in subsets: PDF Identity-H character codes can then be used as CID/GIDs. */
const align4 = n => (n + 3) & ~3;
const u16 = (bytes, pos) => (bytes[pos] << 8) | bytes[pos + 1];
const i16 = (bytes, pos) => (u16(bytes, pos) << 16) >> 16;
const u32 = (bytes, pos) => ((bytes[pos] * 0x1000000) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3]) >>> 0;
const put16 = (bytes, pos, value) => { bytes[pos] = value >>> 8; bytes[pos + 1] = value; };
const put32 = (bytes, pos, value) => { bytes[pos] = value >>> 24; bytes[pos + 1] = value >>> 16; bytes[pos + 2] = value >>> 8; bytes[pos + 3] = value; };
const tagAt = (bytes, pos) => String.fromCharCode(...bytes.subarray(pos, pos + 4));
const sum = bytes => { let result = 0; for (let i = 0; i < bytes.length; i += 4) result = (result + (((bytes[i] || 0) * 0x1000000 + ((bytes[i + 1] || 0) << 16) + ((bytes[i + 2] || 0) << 8) + (bytes[i + 3] || 0)) >>> 0)) >>> 0; return result; };
const hex = (value, digits = 4) => value.toString(16).toUpperCase().padStart(digits, '0');

function readTables(bytes) {
  if (bytes.length < 12 || u32(bytes, 0) !== 0x00010000) throw new Error('Invalid TrueType font.');
  const count = u16(bytes, 4), tables = new Map();
  if (12 + count * 16 > bytes.length) throw new Error('Invalid TrueType table directory.');
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16, tag = tagAt(bytes, p), offset = u32(bytes, p + 8), length = u32(bytes, p + 12);
    if (offset + length > bytes.length) throw new Error('Invalid TrueType table bounds.');
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  for (const tag of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf', 'cmap']) if (!tables.has(tag)) throw new Error(`TrueType font lacks ${tag}.`);
  return tables;
}

function cmapLookup(cmap) {
  const candidates = [];
  for (let i = 0; i < u16(cmap, 2); i++) {
    const p = 4 + i * 8, platform = u16(cmap, p), encoding = u16(cmap, p + 2), offset = u32(cmap, p + 4);
    if (offset + 2 > cmap.length || !(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = u16(cmap, offset);
    if (format === 12 || format === 4) candidates.push({ offset, format });
  }
  candidates.sort((a, b) => b.format - a.format);
  if (!candidates.length) throw new Error('TrueType font lacks a Unicode character map.');
  return cp => {
    for (const { offset: o, format } of candidates) {
      if (format === 12) {
        let lo = 0, hi = u32(cmap, o + 12) - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1, p = o + 16 + mid * 12, start = u32(cmap, p), end = u32(cmap, p + 4);
          if (cp < start) hi = mid - 1; else if (cp > end) lo = mid + 1; else return u32(cmap, p + 8) + cp - start;
        }
      } else if (cp <= 0xffff) {
        const count = u16(cmap, o + 6) / 2, end = o + 14, start = end + 2 * count + 2, delta = start + 2 * count, range = delta + 2 * count;
        for (let i = 0; i < count; i++) {
          if (cp > u16(cmap, end + i * 2)) continue;
          if (cp < u16(cmap, start + i * 2)) break;
          const d = u16(cmap, delta + i * 2), ro = u16(cmap, range + i * 2);
          if (!ro) return (cp + d) & 0xffff;
          const address = range + i * 2 + ro + 2 * (cp - u16(cmap, start + i * 2));
          if (address + 2 > cmap.length) return 0;
          const gid = u16(cmap, address);
          return gid ? (gid + d) & 0xffff : 0;
        }
      }
    }
    return 0;
  };
}

function assemble(tables) {
  const tags = [...tables.keys()].sort(), count = tags.length, pow = 2 ** Math.floor(Math.log2(count));
  let offset = 12 + count * 16;
  for (const tag of tags) offset += align4(tables.get(tag).length);
  const output = new Uint8Array(offset);
  put32(output, 0, 0x00010000); put16(output, 4, count); put16(output, 6, pow * 16); put16(output, 8, Math.log2(pow)); put16(output, 10, count * 16 - pow * 16);
  offset = 12 + count * 16;
  let headOffset = 0;
  tags.forEach((tag, i) => {
    const data = tables.get(tag), record = 12 + i * 16;
    for (let j = 0; j < 4; j++) output[record + j] = tag.charCodeAt(j);
    put32(output, record + 4, sum(data)); put32(output, record + 8, offset); put32(output, record + 12, data.length);
    output.set(data, offset); if (tag === 'head') headOffset = offset;
    offset += align4(data.length);
  });
  put32(output, headOffset + 8, (0xb1b0afba - sum(output)) >>> 0);
  return output;
}

export function parseFont(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source), tables = readTables(bytes);
  const head = tables.get('head'), hhea = tables.get('hhea'), maxp = tables.get('maxp'), hmtx = tables.get('hmtx'), loca = tables.get('loca'), glyf = tables.get('glyf');
  const unitsPerEm = u16(head, 18), glyphCount = u16(maxp, 4), metricCount = u16(hhea, 34), lookup = cmapLookup(tables.get('cmap'));
  const offsets = Array.from({ length: glyphCount + 1 }, (_, i) => i16(head, 50) ? u32(loca, i * 4) : u16(loca, i * 2) * 2);
  const scaled = value => Math.round(value * 1000 / unitsPerEm);
  const glyph = cp => { const result = lookup(typeof cp === 'number' ? cp : cp.codePointAt(0)); return result < glyphCount ? result : 0; };
  const widthForGlyph = gid => scaled(u16(hmtx, Math.min(gid, metricCount - 1) * 4));
  const os2 = tables.get('OS/2'), post = tables.get('post');
  const descriptor = {
    flags: 32, bbox: [i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)].map(scaled),
    ascent: scaled(i16(hhea, 4)), descent: scaled(i16(hhea, 6)),
    capHeight: scaled(os2 && u16(os2, 0) >= 2 && os2.length >= 90 ? i16(os2, 88) : i16(hhea, 4)),
    italicAngle: post && post.length >= 8 ? (u32(post, 4) | 0) / 65536 : 0,
  };
  function subset(codePoints) {
    const used = new Set([0]);
    for (const cp of codePoints) { const gid = glyph(cp); if (gid) used.add(gid); }
    // Composite glyphs refer to other glyphs by ID, possibly recursively.
    const visit = gid => {
      const begin = offsets[gid], end = offsets[gid + 1];
      if (end <= begin || i16(glyf, begin) >= 0) return;
      let p = begin + 10, flags;
      do {
        if (p + 4 > end) throw new Error('Invalid composite glyph.');
        flags = u16(glyf, p); const component = u16(glyf, p + 2); p += 4;
        if (component >= glyphCount) throw new Error('Invalid composite glyph component.');
        if (!used.has(component)) { used.add(component); visit(component); }
        p += flags & 1 ? 4 : 2;
        if (flags & 8) p += 2; else if (flags & 64) p += 4; else if (flags & 128) p += 8;
      } while (flags & 32);
    };
    for (const gid of [...used]) visit(gid);
    let length = 0; const newOffsets = [];
    for (let gid = 0; gid < glyphCount; gid++) { newOffsets.push(length); if (used.has(gid)) length += align4(offsets[gid + 1] - offsets[gid]); }
    newOffsets.push(length);
    const newGlyf = new Uint8Array(length), newLoca = new Uint8Array((glyphCount + 1) * 4);
    for (let gid = 0; gid < glyphCount; gid++) {
      put32(newLoca, gid * 4, newOffsets[gid]);
      if (used.has(gid)) newGlyf.set(glyf.subarray(offsets[gid], offsets[gid + 1]), newOffsets[gid]);
    }
    put32(newLoca, glyphCount * 4, length);
    const newHead = head.slice(); put32(newHead, 8, 0); put16(newHead, 50, 1);
    // Version 3 post retains metrics but omits the very large glyph-name array.
    const newPost = new Uint8Array(32); if (post) newPost.set(post.subarray(0, 32)); put32(newPost, 0, 0x00030000);
    const selected = new Map();
    for (const tag of ['hhea', 'maxp', 'hmtx', 'cmap', 'name', 'OS/2', 'fpgm', 'prep', 'cvt ', 'gasp']) if (tables.has(tag)) selected.set(tag, tables.get(tag));
    selected.set('head', newHead); selected.set('loca', newLoca); selected.set('glyf', newGlyf); selected.set('post', newPost);
    return assemble(selected);
  }
  return { glyph, widthForGlyph, width: cp => widthForGlyph(glyph(cp)), unitsPerEm, descriptor, subset };
}

export function hexText(font, value) {
  return [...String(value)].map(character => hex(font.glyph(character.codePointAt(0)))).join('');
}

export function makeToUnicode(font, codePoints) {
  const entries = new Map();
  for (const character of codePoints) {
    const cp = typeof character === 'number' ? character : character.codePointAt(0), gid = font.glyph(cp);
    if (!gid || entries.has(gid)) continue;
    const utf16 = cp <= 0xffff ? hex(cp) : hex(0xd800 + ((cp - 0x10000) >> 10)) + hex(0xdc00 + ((cp - 0x10000) & 1023));
    entries.set(gid, utf16);
  }
  const lines = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def', '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
  const mappings = [...entries].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < mappings.length; i += 100) {
    const batch = mappings.slice(i, i + 100); lines.push(`${batch.length} beginbfchar`);
    for (const [gid, utf16] of batch) lines.push(`<${hex(gid)}> <${utf16}>`);
    lines.push('endbfchar');
  }
  return `${lines.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}
