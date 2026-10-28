import { createMD5, createSHA1, createSHA256 } from 'hash-wasm';
import type { XNode } from './axml';

export type Hashes = { md5?: string; sha1?: string; sha256?: string; progress: number };
export type Component = { kind: string; name: string; exported: string; launcher: boolean };
export type ManifestInfo = {
  pkg: string; versionName: string; versionCode: string;
  minSdk: string; targetSdk: string; compileSdk: string;
  permissions: string[]; features: string[]; components: Component[];
  debuggable: boolean; allowBackup: boolean; cleartext: boolean;
};
export type Signing = { v1: boolean; v2: boolean; v3: boolean; v31: boolean; stamp: boolean };

const ANDROID: Record<number, string> = { 21: '5.0', 22: '5.1', 23: '6', 24: '7', 25: '7.1', 26: '8', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16' };
export const sdkLabel = (n?: string) => (n ? `API ${n}${ANDROID[+n] ? ` · Android ${ANDROID[+n]}` : ''}` : '—');

const SENSITIVE = new Set(['CAMERA', 'RECORD_AUDIO', 'READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'CALL_PHONE', 'READ_CALL_LOG', 'WRITE_CALL_LOG', 'SEND_SMS', 'RECEIVE_SMS', 'READ_SMS', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'MANAGE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'POST_NOTIFICATIONS', 'BODY_SENSORS', 'READ_CALENDAR', 'WRITE_CALENDAR', 'ACTIVITY_RECOGNITION', 'BLUETOOTH_CONNECT', 'BLUETOOTH_SCAN', 'NEARBY_WIFI_DEVICES', 'SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES', 'QUERY_ALL_PACKAGES', 'BIND_ACCESSIBILITY_SERVICE']);
export const isSensitive = (perm: string) => perm.startsWith('android.permission.') && SENSITIVE.has(perm.split('.').pop()!);

const CATS = { dex: 'Mã DEX', lib: 'Thư viện native (.so)', arsc: 'resources.arsc', res: 'Tài nguyên res/', assets: 'assets/', meta: 'META-INF (chữ ký)', other: 'Khác' } as const;
export type CatKey = keyof typeof CATS;
export function category(path: string): CatKey {
  const p = path.toLowerCase();
  if (/(^|\/)classes\d*\.dex$/.test(p)) return 'dex';
  if (p.startsWith('lib/')) return 'lib';
  if (p === 'resources.arsc') return 'arsc';
  if (p.startsWith('res/')) return 'res';
  if (p.startsWith('assets/')) return 'assets';
  if (p.startsWith('meta-inf/')) return 'meta';
  return 'other';
}
export const categoryLabel = (k: CatKey) => CATS[k];

const attr = (n: XNode, key: string) => Object.entries(n.attrs).find(([k]) => k === key || k.endsWith(`:${key}`))?.[1] ?? '';
const walk = (n: XNode, fn: (x: XNode) => void) => { fn(n); n.children.forEach((c) => walk(c, fn)); };

export function summarize(root: XNode): ManifestInfo {
  const info: ManifestInfo = {
    pkg: attr(root, 'package'), versionName: attr(root, 'versionName'), versionCode: attr(root, 'versionCode'),
    minSdk: '', targetSdk: '', compileSdk: attr(root, 'compileSdkVersion'),
    permissions: [], features: [], components: [], debuggable: false, allowBackup: true, cleartext: false,
  };
  for (const c of root.children) {
    if (c.tag === 'uses-sdk') { info.minSdk = attr(c, 'minSdkVersion'); info.targetSdk = attr(c, 'targetSdkVersion'); }
    else if (c.tag.startsWith('uses-permission')) { const n = attr(c, 'name'); if (n && !info.permissions.includes(n)) info.permissions.push(n); }
    else if (c.tag === 'uses-feature') info.features.push(attr(c, 'name') || attr(c, 'glEsVersion'));
    else if (c.tag === 'application') {
      info.debuggable = attr(c, 'debuggable') === 'true';
      info.allowBackup = attr(c, 'allowBackup') !== 'false';
      info.cleartext = attr(c, 'usesCleartextTraffic') === 'true';
      for (const k of c.children) {
        if (!['activity', 'activity-alias', 'service', 'receiver', 'provider'].includes(k.tag)) continue;
        let main = false; let launcher = false; let filter = false;
        walk(k, (x) => {
          if (x.tag === 'intent-filter') filter = true;
          if (x.tag === 'action' && attr(x, 'name') === 'android.intent.action.MAIN') main = true;
          if (x.tag === 'category' && attr(x, 'name') === 'android.intent.category.LAUNCHER') launcher = true;
        });
        const exp = attr(k, 'exported');
        info.components.push({ kind: k.tag, name: attr(k, 'name'), exported: exp || (filter ? 'true (ngầm định)' : 'false'), launcher: main && launcher });
      }
    }
  }
  return info;
}

// Phát hiện chữ ký v2/v3/v3.1 bằng cách đọc APK Signing Block ngay trước Central Directory (chỉ đọc vài KB cuối tệp).
export async function readSigning(file: Blob, hasV1: boolean): Promise<Signing> {
  const out: Signing = { v1: hasV1, v2: false, v3: false, v31: false, stamp: false };
  try {
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
    const dv = new DataView(tail.buffer);
    let e = tail.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) return out;
    const cd = dv.getUint32(e + 16, true);
    if (cd === NONE32 || cd < 32) return out;
    const foot = new Uint8Array(await file.slice(cd - 24, cd).arrayBuffer());
    if (new TextDecoder().decode(foot.subarray(8)) !== 'APK Sig Block 42') return out;
    const blockSize = Number(new DataView(foot.buffer).getBigUint64(0, true));
    if (blockSize > 32 * 1024 * 1024 || blockSize + 8 > cd) return out;
    const body = new Uint8Array(await file.slice(cd - blockSize, cd - 24).arrayBuffer());
    const bv = new DataView(body.buffer);
    for (let o = 0; o + 12 <= body.length;) {
      const len = Number(bv.getBigUint64(o, true));
      const id = bv.getUint32(o + 8, true);
      if (id === 0x7109871a) out.v2 = true; else if (id === 0xf05368c0) out.v3 = true;
      else if (id === 0x1b93ad61) out.v31 = true; else if (id === 0x6dff800d) out.stamp = true;
      if (len < 4) break;
      o += 8 + len;
    }
  } catch { /* tệp không phải APK có signing block */ }
  return out;
}
const NONE32 = 0xffffffff;

// Băm toàn tệp theo từng khúc 8 MB — tệp bao nhiêu GB cũng không nạp hết vào RAM.
export async function hashFile(file: Blob, onProgress: (percent: number) => void): Promise<Omit<Hashes, 'progress'>> {
  const [md5, sha1, sha256] = await Promise.all([createMD5(), createSHA1(), createSHA256()]);
  const CHUNK = 8 * 1024 * 1024;
  for (let o = 0; o < file.size; o += CHUNK) {
    const part = new Uint8Array(await file.slice(o, o + CHUNK).arrayBuffer());
    md5.update(part); sha1.update(part); sha256.update(part);
    onProgress(Math.min(99, Math.round(((o + CHUNK) / file.size) * 100)));
  }
  return { md5: md5.digest(), sha1: sha1.digest(), sha256: sha256.digest() };
}
