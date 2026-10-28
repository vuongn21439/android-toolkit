// Bộ giải mã Android Binary XML (AXML) — dùng cho AndroidManifest.xml và res/*.xml trong APK.
export type XNode = { tag: string; attrs: Record<string, string>; children: XNode[] };

const NONE = 0xffffffff;

export const isAxml = (b: Uint8Array) => b.length > 8 && b[0] === 0x03 && b[1] === 0x00 && b[2] === 0x08 && b[3] === 0x00;

export const toArrayBuffer = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function readPool(v: DataView, u8: Uint8Array, pos: number): string[] {
  const count = v.getUint32(pos + 8, true);
  const utf8 = (v.getUint32(pos + 16, true) & 0x100) !== 0;
  const base = pos + v.getUint32(pos + 20, true);
  const idx = pos + v.getUint16(pos + 2, true);
  const out: string[] = [];
  const u8dec = new TextDecoder('utf-8');
  const u16dec = new TextDecoder('utf-16le');
  for (let i = 0; i < count; i++) {
    let o = base + v.getUint32(idx + i * 4, true);
    if (utf8) {
      if (u8[o++] & 0x80) o++;
      let len = u8[o++];
      if (len & 0x80) len = ((len & 0x7f) << 8) | u8[o++];
      out.push(u8dec.decode(u8.subarray(o, o + len)));
    } else {
      let len = v.getUint16(o, true);
      o += 2;
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | v.getUint16(o, true); o += 2; }
      out.push(u16dec.decode(u8.subarray(o, o + len * 2)));
    }
  }
  return out;
}

function fmtValue(v: DataView, at: number, strings: string[]): string {
  const raw = v.getUint32(at + 8, true);
  if (raw !== NONE) return strings[raw] ?? '';
  const type = v.getUint8(at + 15);
  const data = v.getUint32(at + 16, true);
  switch (type) {
    case 0x03: return strings[data] ?? '';
    case 0x12: return data ? 'true' : 'false';
    case 0x10: return String(data | 0);
    case 0x01: return `@0x${data.toString(16)}`;
    case 0x02: return `?0x${data.toString(16)}`;
    case 0x04: return String(v.getFloat32(at + 16, true));
    case 0x1c: case 0x1d: case 0x1e: case 0x1f: return `#${data.toString(16).padStart(8, '0')}`;
    default: return `0x${data.toString(16)}`;
  }
}

export function parseAxml(buf: ArrayBuffer): XNode | null {
  try {
    const v = new DataView(buf);
    const u8 = new Uint8Array(buf);
    if (!isAxml(u8)) return null;
    let strings: string[] = [];
    const prefixes = new Map<string, string>();
    const pendingNs: [string, string][] = [];
    const top: XNode = { tag: '', attrs: {}, children: [] };
    const stack = [top];
    const end = Math.min(v.getUint32(4, true), buf.byteLength);
    let pos = v.getUint16(2, true);
    const s = (i: number) => (i === NONE ? '' : strings[i] ?? '');
    while (pos + 8 <= end) {
      const type = v.getUint16(pos, true);
      const size = v.getUint32(pos + 4, true);
      if (size < 8) break;
      if (type === 0x0001) strings = readPool(v, u8, pos);
      else if (type === 0x0100) {
        const prefix = s(v.getUint32(pos + 16, true));
        const uri = s(v.getUint32(pos + 20, true));
        prefixes.set(uri, prefix);
        pendingNs.push([prefix, uri]);
      } else if (type === 0x0102) {
        const node: XNode = { tag: s(v.getUint32(pos + 20, true)), attrs: {}, children: [] };
        const nsIdx = v.getUint32(pos + 16, true);
        if (nsIdx !== NONE && prefixes.get(s(nsIdx))) node.tag = `${prefixes.get(s(nsIdx))}:${node.tag}`;
        for (const [p, u] of pendingNs.splice(0)) node.attrs[`xmlns:${p}`] = u;
        const attrStart = pos + 16 + v.getUint16(pos + 24, true);
        const attrSize = v.getUint16(pos + 26, true) || 20;
        const attrCount = v.getUint16(pos + 28, true);
        for (let i = 0; i < attrCount; i++) {
          const at = attrStart + i * attrSize;
          const uri = v.getUint32(at, true);
          const prefix = uri !== NONE ? prefixes.get(s(uri)) : '';
          node.attrs[`${prefix ? prefix + ':' : ''}${s(v.getUint32(at + 4, true))}`] = fmtValue(v, at, strings);
        }
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      } else if (type === 0x0103 && stack.length > 1) stack.pop();
      pos += size;
    }
    return top.children[0] ?? null;
  } catch {
    return null;
  }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function toXml(n: XNode, depth = 0): string {
  const pad = '  '.repeat(depth);
  const attrs = Object.entries(n.attrs).map(([k, val]) => ` ${k}="${esc(val)}"`).join('');
  if (!n.children.length) return `${pad}<${n.tag}${attrs} />`;
  return `${pad}<${n.tag}${attrs}>\n${n.children.map((c) => toXml(c, depth + 1)).join('\n')}\n${pad}</${n.tag}>`;
}
