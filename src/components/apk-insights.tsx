import { Fingerprint, ShieldAlert, ShieldCheck } from 'lucide-react';
import { categoryLabel, isSensitive, sdkLabel, type CatKey, type Hashes, type ManifestInfo, type Signing } from '@/lib/apk';

export type CatStat = { key: CatKey; count: number; size: number; packed: number };

export const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

export function HashCard({ hashes }: { hashes: Hashes | null }) {
  if (!hashes) return null;
  const rows: [string, string | undefined][] = [['SHA-256', hashes.sha256], ['SHA-1', hashes.sha1], ['MD5', hashes.md5]];
  return (
    <div className="insight-card" data-testid="card-hashes">
      <h4><Fingerprint size={14} /> Mã băm toàn tệp {hashes.sha256 ? '' : `· đang tính ${hashes.progress}%`}</h4>
      {rows.map(([k, v]) => (
        <div className="kv" key={k}><span>{k}</span><code title="Bấm để chọn" onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>{v ?? '…'}</code></div>
      ))}
    </div>
  );
}

export function ApkInsights({ manifest: m, signing, cats, abis, hashes }: { manifest: ManifestInfo | null; signing: Signing | null; cats: CatStat[]; abis: string[]; hashes: Hashes | null }) {
  const total = cats.reduce((s, c) => s + c.size, 0) || 1;
  const sensitive = m?.permissions.filter(isSensitive) ?? [];
  const exported = m?.components.filter((c) => c.exported.startsWith('true')) ?? [];
  const launcher = m?.components.find((c) => c.launcher);
  return (
    <div className="insights" data-testid="section-apk-insights">
      {m && (
        <div className="insight-card">
          <h4>Thông tin ứng dụng (giải mã từ AndroidManifest nhị phân)</h4>
          <div className="kv"><span>Package</span><code>{m.pkg || '—'}</code></div>
          <div className="kv"><span>Phiên bản</span><code>{m.versionName || '—'} ({m.versionCode || '—'})</code></div>
          <div className="kv"><span>minSdk</span><code>{sdkLabel(m.minSdk)}</code></div>
          <div className="kv"><span>targetSdk</span><code>{sdkLabel(m.targetSdk)}</code></div>
          {m.compileSdk && <div className="kv"><span>compileSdk</span><code>{sdkLabel(m.compileSdk)}</code></div>}
          {launcher && <div className="kv"><span>Màn hình chính</span><code>{launcher.name}</code></div>}
          <div className="tags">
            {m.debuggable && <span className="tag warn">debuggable = true</span>}
            {m.cleartext && <span className="tag warn">cho phép HTTP không mã hóa</span>}
            {m.allowBackup && <span className="tag">allowBackup</span>}
            <span className="tag">{m.components.length} thành phần · {exported.length} exported</span>
          </div>
        </div>
      )}

      {signing && (
        <div className="insight-card" data-testid="card-signing">
          <h4>{signing.v1 || signing.v2 || signing.v3 ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />} Chữ ký</h4>
          <div className="tags">
            {([['v1 (JAR)', signing.v1], ['v2', signing.v2], ['v3', signing.v3], ['v3.1', signing.v31], ['Source stamp', signing.stamp]] as const).map(([k, on]) => (
              <span key={k} className={`tag ${on ? 'ok' : 'off'}`}>{k}: {on ? 'có' : 'không'}</span>
            ))}
          </div>
          <p className="hint">Chỉ phát hiện lược đồ ký; công cụ không xác minh chứng chỉ có hợp lệ hay không.</p>
        </div>
      )}

      <div className="insight-card" data-testid="card-size-breakdown">
        <h4>Dung lượng theo nhóm (giải nén)</h4>
        {cats.map((c) => (
          <div className="bar-row" key={c.key} title={`Nén: ${fmt(c.packed)}`}>
            <span>{categoryLabel(c.key)}</span>
            <div className="bar"><i style={{ width: `${Math.max(2, (c.size / total) * 100)}%` }} /></div>
            <em>{fmt(c.size)} · {c.count}</em>
          </div>
        ))}
        {abis.length > 0 && <div className="tags"><span className="tag off">ABI:</span>{abis.map((a) => <span className="tag" key={a}>{a}</span>)}</div>}
      </div>

      {m && m.permissions.length > 0 && (
        <details className="insight-card" data-testid="card-permissions">
          <summary>Quyền ({m.permissions.length}) · {sensitive.length} nhạy cảm</summary>
          <div className="perm-list">
            {[...m.permissions].sort((a, b) => +isSensitive(b) - +isSensitive(a)).map((p) => (
              <code key={p} className={isSensitive(p) ? 'sens' : ''}>{p.replace('android.permission.', '')}</code>
            ))}
          </div>
        </details>
      )}

      {m && m.components.length > 0 && (
        <details className="insight-card" data-testid="card-components">
          <summary>Thành phần ({m.components.length}) · {exported.length} exported</summary>
          <div className="perm-list">
            {m.components.map((c, i) => <code key={i} className={c.exported.startsWith('true') ? 'sens' : ''}>{c.kind}: {c.name}{c.exported.startsWith('true') ? ' · exported' : ''}</code>)}
          </div>
        </details>
      )}

      <HashCard hashes={hashes} />
    </div>
  );
}
