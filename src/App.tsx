import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Archive,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Code2,
  FileArchive,
  FileCode2,
  FileText,
  Folder,
  HardDrive,
  Info,
  LockKeyhole,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';

type Mode = 'apk' | 'project';
type ProgressState = { label: string; percent: number } | null;
type EntryRecord = { key: string; path: string; file: JSZip.JSZipObject };
type Marker = { label: string; path: string; found: boolean; detail: string };

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 128 * 1024;

function normalizeArchivePath(raw: string): string | null {
  const replaced = raw.replace(/\\/g, '/');
  if (replaced.startsWith('/') || /^[a-zA-Z]:/.test(replaced)) return null;
  const pieces = replaced.split('/');
  const safe: string[] = [];
  for (const piece of pieces) {
    if (!piece || piece === '.') continue;
    if (piece === '..') return null;
    safe.push(piece);
  }
  return safe.join('/') + (raw.endsWith('/') && safe.length ? '/' : '');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFilename(name: string, fallback: string): string {
  return name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function canPreview(path: string, size: number): boolean {
  if (size > MAX_PREVIEW_BYTES) return false;
  const extension = path.split('.').pop()?.toLowerCase() || '';
  return ['txt', 'xml', 'md', 'gradle', 'kts', 'properties', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'csv'].includes(extension);
}

function entrySize(entry: JSZip.JSZipObject): number {
  return (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
}

function Home() {
  const [mode, setMode] = useState<Mode>('apk');
  const [file, setFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [directoryPaths, setDirectoryPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ProgressState>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<JSZip | null>(null);

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    const path = entry.path.toLowerCase();
    const matchesQuery = path.includes(query.trim().toLowerCase());
    const matchesFilter = filter === 'all'
      || (filter === 'dex' && /(^|\/)classes\d*\.dex$/i.test(path))
      || (filter === 'resource' && (path.endsWith('resources.arsc') || path.startsWith('res/')))
      || (filter === 'asset' && path.startsWith('assets/'))
      || (filter === 'other' && !/(^|\/)classes\d*\.dex$/i.test(path) && !path.endsWith('resources.arsc') && !path.startsWith('res/') && !path.startsWith('assets/'));
    return matchesQuery && matchesFilter;
  }), [entries, filter, query]);

  const apkStats = useMemo(() => {
    const paths = [...entries.map(({ path }) => path), ...directoryPaths].map((path) => path.toLowerCase());
    return {
      manifest: paths.some((path) => path === 'androidmanifest.xml' || path.endsWith('/androidmanifest.xml')),
      dex: paths.some((path) => /(^|\/)classes\d*\.dex$/.test(path)),
      resources: paths.some((path) => path.endsWith('resources.arsc')),
      assetOrRes: paths.some((path) => path.startsWith('assets/') || path.includes('/assets/') || path.startsWith('res/') || path.includes('/res/')),
    };
  }, [directoryPaths, entries]);

  const projectMarkers = useMemo<Marker[]>(() => {
    const paths = [...entries.map(({ path }) => path), ...directoryPaths].map((path) => path.toLowerCase());
    const hasFile = (pattern: RegExp) => paths.some((path) => pattern.test(path));
    const hasDirectory = (pattern: RegExp) => paths.some((path) => pattern.test(path));
    return [
      { label: 'Tệp settings của Gradle', path: 'settings.gradle / settings.gradle.kts', found: hasFile(/(^|\/)settings\.gradle(\.kts)?$/), detail: 'Khai báo cấu trúc dự án' },
      { label: 'Tập lệnh biên dịch', path: 'build.gradle / build.gradle.kts', found: hasFile(/(^|\/)build\.gradle(\.kts)?$/), detail: 'Cấu hình Gradle của dự án' },
      { label: 'Gradle Wrapper', path: 'gradlew', found: hasFile(/(^|\/)gradlew$/), detail: 'Bộ khởi chạy Gradle đi kèm dự án' },
      { label: 'Manifest ứng dụng', path: 'app/src/main/AndroidManifest.xml', found: hasFile(/(^|\/)app\/src\/main\/androidmanifest\.xml$/), detail: 'Siêu dữ liệu điểm vào ứng dụng Android' },
      { label: 'Thư mục mã nguồn', path: 'app/src/main/java or kotlin', found: hasDirectory(/(^|\/)app\/src\/main\/(java|kotlin)(\/|$)/), detail: 'Cây mã nguồn Java hoặc Kotlin' },
      { label: 'Thư mục tài nguyên', path: 'app/src/main/res', found: hasDirectory(/(^|\/)app\/src\/main\/res(\/|$)/), detail: 'Tài nguyên của ứng dụng Android' },
    ];
  }, [directoryPaths, entries]);
  const readiness = projectMarkers.filter((marker) => marker.found).length;

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  const clearWorkspace = () => {
    setFile(null);
    setEntries([]);
    setDirectoryPaths([]);
    setSelected([]);
    setError('');
    setProgress(null);
    setQuery('');
    setFilter('all');
    setPreview(null);
    zipRef.current = null;
    if (inputRef.current) inputRef.current.value = '';
  };

  const processFile = async (nextFile?: File) => {
    if (!nextFile) return;
    setError('');
    setPreview(null);
    if (nextFile.size > MAX_FILE_BYTES) {
      setError('Tệp lưu trữ vượt quá giới hạn 200 MB. Hãy chọn tệp nhỏ hơn.');
      return;
    }
    const expectedExtension = mode === 'apk' ? /\.apk$/i : /\.zip$/i;
    if (!expectedExtension.test(nextFile.name)) {
      setError(mode === 'apk' ? 'Hãy chọn tệp lưu trữ .apk.' : 'Hãy chọn tệp .zip của dự án Android.');
      return;
    }
    clearWorkspace();
    setProgress({ label: 'Đang đọc tệp lưu trữ trên trình duyệt này', percent: 0 });
    try {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (event) => {
          if (event.lengthComputable) setProgress({ label: 'Đang đọc tệp lưu trữ trên trình duyệt này', percent: Math.round((event.loaded / event.total) * 65) });
        };
        reader.onerror = () => reject(new Error('Không thể đọc tệp.'));
        reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Không thể đọc tệp.'));
        reader.readAsArrayBuffer(nextFile);
      });
      setProgress({ label: 'Đang xác thực cấu trúc tệp lưu trữ', percent: 72 });
      const zip = await JSZip.loadAsync(buffer);
      setProgress({ label: 'Đang lập danh sách đường dẫn an toàn', percent: 94 });
      const safeEntries: EntryRecord[] = [];
      const safeDirectories: string[] = [];
      Object.entries(zip.files).forEach(([key, archiveFile]) => {
        const normalized = normalizeArchivePath(archiveFile.name);
        if (!normalized) return;
        if (archiveFile.dir) {
          safeDirectories.push(normalized);
          return;
        }
        safeEntries.push({ key, path: normalized, file: archiveFile });
      });
      if (safeEntries.length === 0) throw new Error('Không tìm thấy tệp nào có đường dẫn an toàn trong tệp lưu trữ này.');
      zipRef.current = zip;
      setFile(nextFile);
      setEntries(safeEntries.sort((a, b) => a.path.localeCompare(b.path)));
      setDirectoryPaths(safeDirectories);
      setSelected([]);
      setProgress(null);
    } catch (cause) {
      zipRef.current = null;
      setFile(null);
      setEntries([]);
      setProgress(null);
      setError(cause instanceof Error && /Không tìm thấy/.test(cause.message)
        ? cause.message
        : 'Không thể đọc tệp này dưới dạng ZIP hợp lệ. Hãy kiểm tra tệp rồi thử lại.');
    }
  };

  const toggleEntry = (key: string) => {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const downloadZip = async (all: boolean) => {
    const source = zipRef.current;
    if (!source || !file) return;
    const chosen = all ? entries : entries.filter((entry) => selected.includes(entry.key));
    if (!chosen.length) return;
    setError('');
    setProgress({ label: 'Đang chuẩn bị ZIP mới trong bộ nhớ', percent: 0 });
    try {
      const output = new JSZip();
      for (const entry of chosen) {
        const normalized = normalizeArchivePath(entry.path);
        if (normalized) output.file(normalized, entry.file.async('uint8array'));
      }
      const blob = await output.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } }, (metadata) => {
        setProgress({ label: 'Đang tạo tệp tải xuống', percent: Math.round(metadata.percent) });
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(file.name.replace(/\.(apk|zip)$/i, ''), 'luu-tru')}-${all ? 'noi-dung' : 'da-chon'}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setProgress(null);
    } catch {
      setProgress(null);
      setError('Không thể đóng gói các mục đã chọn. Hãy thử chọn ít mục hơn.');
    }
  };

  const openPreview = async (entry: EntryRecord) => {
    if (!canPreview(entry.path, entrySize(entry.file))) {
      setError('Chỉ có thể xem trước tệp cấu hình và tài liệu dạng văn bản thuần có dung lượng nhỏ.');
      return;
    }
    try {
      const text = await entry.file.async('text');
      setPreview({ path: entry.path, text: text.slice(0, MAX_PREVIEW_BYTES) });
      setError('');
    } catch {
      setError('Không thể giải mã mục này thành văn bản.');
    }
  };

  const downloadReport = () => {
    if (!file) return;
    const lines = [
      'ANDROID TOOLKIT — BÁO CÁO KIỂM TRA ZIP DỰ ÁN',
      `Tệp lưu trữ: ${file.name}`,
      `Dung lượng: ${formatBytes(file.size)}`,
      `Dấu hiệu sẵn sàng: ${readiness}/${projectMarkers.length}`,
      '',
      'DANH SÁCH KIỂM TRA',
      ...projectMarkers.map((marker) => `${marker.found ? '[TÌM THẤY]' : '[CÒN THIẾU]'} ${marker.label}: ${marker.path}`),
      '',
      'CÁC BƯỚC TIẾP THEO',
      '1. Giải nén ZIP dự án bằng một tiện ích lưu trữ cục bộ đáng tin cậy.',
      '2. Xem lại các tệp dự án và cấu hình Gradle cục bộ trước khi biên dịch.',
      '3. Tại thư mục gốc của dự án, dùng Gradle Wrapper nếu có:',
      '   macOS / Linux: ./gradlew assembleDebug',
      '   Windows:       gradlew.bat assembleDebug',
      '4. Nếu thiếu wrapper, hãy cài phiên bản Gradle tương thích và xem lại dự án trước.',
      '',
      'Android Toolkit chỉ kiểm tra đường dẫn trong tệp lưu trữ. Công cụ không chạy Gradle, không biên dịch APK,',
      'không dịch ngược DEX thành mã nguồn và không tải dữ liệu lên máy chủ. Các dấu hiệu sẵn sàng không bảo đảm biên dịch thành công.',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(file.name.replace(/\.zip$/i, ''), 'du-an-android')}-bao-cao-kiem-tra.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void processFile(event.dataTransfer.files[0]);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" data-testid="text-brand">
          <span className="brand-mark"><Code2 size={19} strokeWidth={2.4} /></span>
          <span>android<span style={{ color: '#328166' }}>/</span>toolkit</span>
        </div>
        <div className="top-note" data-testid="status-local-processing"><i /> <span>KHÔNG GIAN LÀM VIỆC CỤC BỘ</span></div>
      </header>

      <main className="main-wrap">
        <section className="hero">
          <div>
            <div className="eyebrow">Tiện ích gọn nhẹ dành cho Android</div>
            <h1>Xem bên trong.<br />Giữ tệp ở đây.</h1>
            <p>Kiểm tra tệp APK được phép sử dụng và ZIP dự án Android. Tệp luôn ở trong trình duyệt này, từ lúc đọc đến khi tải xuống.</p>
          </div>
          <div className="privacy-badge"><LockKeyhole size={15} /> Tệp không rời khỏi thiết bị này</div>
        </section>

        <div className="workspace">
          <section className="main-panel" aria-label="Không gian kiểm tra tệp lưu trữ">
            <div className="tabs" role="tablist" aria-label="Chọn chế độ kiểm tra tệp lưu trữ">
              <button className={`tab ${mode === 'apk' ? 'active' : ''}`} type="button" role="tab" aria-selected={mode === 'apk'} onClick={() => { if (mode !== 'apk') clearWorkspace(); setMode('apk'); }} data-testid="tab-apk">
                <FileArchive size={16} /> Kiểm tra APK <span className="tab-num">01</span>
              </button>
              <button className={`tab ${mode === 'project' ? 'active' : ''}`} type="button" role="tab" aria-selected={mode === 'project'} onClick={() => { if (mode !== 'project') clearWorkspace(); setMode('project'); }} data-testid="tab-project">
                <Folder size={16} /> ZIP dự án <span className="tab-num">02</span>
              </button>
            </div>

            <div className="panel-content">
              <div
                className={`dropzone ${dragging ? 'dragging' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
                onDrop={handleDrop}
                data-testid="dropzone-archive"
              >
                <input ref={inputRef} className="hidden-input" type="file" accept={mode === 'apk' ? '.apk' : '.zip'} onChange={(event) => void processFile(event.target.files?.[0])} data-testid="input-archive-file" aria-label={mode === 'apk' ? 'Chọn tệp APK' : 'Chọn ZIP dự án Android'} />
                <span className="drop-icon"><Upload size={20} /></span>
                <h2>{mode === 'apk' ? 'Thả APK vào đây để kiểm tra nội dung' : 'Thả ZIP dự án Android vào đây'}</h2>
                <p>{mode === 'apk' ? 'Duyệt tệp và nhận diện các thành phần thường có trong gói Android.' : 'Kiểm tra các dấu hiệu dự án và nhận hướng dẫn biên dịch thiết thực.'}</p>
                <button type="button" className="select-button" onClick={() => inputRef.current?.click()} data-testid="button-browse-archive">
                  <Folder size={14} /> Chọn {mode === 'apk' ? 'APK' : 'ZIP'}
                </button>
                <span className="file-limit">Tương thích ZIP · tối đa 200 MB · xử lý trong bộ nhớ</span>
              </div>

              <div className="notice" data-testid="text-scope-warning">
                <Info size={15} />
                <span>Công cụ chỉ kiểm tra và trích xuất nội dung tệp lưu trữ. Công cụ không dịch ngược DEX thành mã nguồn Java/Kotlin, không chạy tệp đã tải lên, không thực thi Gradle và không tạo APK đã biên dịch.</span>
              </div>

              {error && <div className="error-box" role="alert" data-testid="status-error">{error}</div>}
              {progress && (
                <div className="progress-wrap" role="status" aria-live="polite" data-testid="status-progress">
                  <div className="progress-head"><span>{progress.label}</span><span>{progress.percent}%</span></div>
                  <div className="progress-track"><div className="progress-value" style={{ width: `${Math.max(3, progress.percent)}%` }} /></div>
                </div>
              )}

              {file && entries.length > 0 && mode === 'apk' && (
                <div className="results">
                  <div className="results-heading">
                    <div className="file-meta">
                      <span className="file-symbol"><Archive size={19} /></span>
                      <div className="file-title">
                        <strong title={file.name} data-testid="text-loaded-filename">{file.name}</strong>
                        <span>{entries.length.toLocaleString()} tệp · {formatBytes(file.size)} · cấu trúc ZIP hợp lệ</span>
                      </div>
                    </div>
                    <div className="results-actions">
                      <button type="button" className="secondary-button" onClick={() => void downloadZip(true)} disabled={!!progress} data-testid="button-download-all"><ArrowDownToLine size={14} /> Tất cả mục</button>
                      <button type="button" className="primary-button" onClick={() => void downloadZip(false)} disabled={!selected.length || !!progress} data-testid="button-download-selected"><ArrowDownToLine size={14} /> Đã chọn ({selected.length})</button>
                    </div>
                  </div>

                  <div className="summary-grid" data-testid="data-apk-summary">
                    <div className="summary-chip"><span>Tệp kê khai</span><strong className={apkStats.manifest ? 'present' : ''}>{apkStats.manifest ? 'Tìm thấy' : 'Không thấy'}</strong></div>
                    <div className="summary-chip"><span>Tệp DEX</span><strong className={apkStats.dex ? 'present' : ''}>{apkStats.dex ? 'Có' : 'Không thấy'}</strong></div>
                    <div className="summary-chip"><span>resources.arsc</span><strong className={apkStats.resources ? 'present' : ''}>{apkStats.resources ? 'Tìm thấy' : 'Không thấy'}</strong></div>
                    <div className="summary-chip"><span>Tài nguyên (assets / res)</span><strong className={apkStats.assetOrRes ? 'present' : ''}>{apkStats.assetOrRes ? 'Có' : 'Không thấy'}</strong></div>
                  </div>

                  <div className="list-tools">
                    <div className="search-wrap"><Search size={15} /><input className="search-input" type="search" placeholder="Tìm đường dẫn trong tệp lưu trữ" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-search-entries" /></div>
                    <label className="sr-only" htmlFor="entry-filter">Lọc các mục</label>
                    <select id="entry-filter" className="filter-select" value={filter} onChange={(event) => setFilter(event.target.value)} data-testid="select-entry-filter">
                      <option value="all">Tất cả mục</option><option value="dex">Tệp DEX</option><option value="resource">Tài nguyên</option><option value="asset">Thư mục assets</option><option value="other">Khác</option>
                    </select>
                    <span className="list-count" data-testid="text-entry-count">Đang hiển thị {filteredEntries.length}</span>
                  </div>
                  <div className="entry-list" role="list" aria-label="Các mục trong tệp lưu trữ" data-testid="list-archive-entries">
                    {filteredEntries.length ? filteredEntries.map((entry) => {
                      const size = entrySize(entry.file);
                      const previewable = canPreview(entry.path, size);
                      return (
                        <div className="entry-row" role="listitem" key={entry.key} data-testid={`row-entry-${safeFilename(entry.key, 'entry')}`}>
                          <input className="entry-check" type="checkbox" aria-label={`Chọn ${entry.path}`} checked={selected.includes(entry.key)} onChange={() => toggleEntry(entry.key)} data-testid={`checkbox-entry-${safeFilename(entry.key, 'entry')}`} />
                          {entry.path.toLowerCase().endsWith('.dex') ? <Code2 size={15} className="entry-icon" /> : entry.path.toLowerCase().endsWith('.xml') ? <FileCode2 size={15} className="entry-icon" /> : <FileText size={15} className="entry-icon" />}
                          <span className="entry-path" title={entry.path}>{entry.path}</span>
                          <span className="entry-size">{formatBytes(size)}</span>
                          {previewable && <button type="button" className="preview-button" aria-label={`Xem trước ${entry.path}`} title="Xem trước tệp văn bản nhỏ" onClick={() => void openPreview(entry)} data-testid={`button-preview-${safeFilename(entry.key, 'entry')}`}><CircleHelp size={15} /></button>}
                        </div>
                      );
                    }) : <div className="empty-list" data-testid="empty-filter-results">Không có mục phù hợp. Hãy thử từ khóa hoặc bộ lọc khác.</div>}
                  </div>
                  <div className="selection-bar">
                    <span>Đã chọn {selected.length} mục · tải xuống dưới dạng ZIP mới</span>
                    <div>
                      <button type="button" className="quiet-button" onClick={() => setSelected(filteredEntries.map((entry) => entry.key))} data-testid="button-select-visible">Chọn mục đang hiển thị</button>
                      <button type="button" className="quiet-button" onClick={() => setSelected([])} data-testid="button-clear-selection">Bỏ chọn</button>
                    </div>
                  </div>
                </div>
              )}

              {file && entries.length > 0 && mode === 'project' && (
                <div className="project-results">
                  <div className="project-results-head">
                    <div className="file-meta">
                      <span className="file-symbol"><HardDrive size={19} /></span>
                      <div className="file-title"><strong title={file.name} data-testid="text-loaded-filename">{file.name}</strong><span>{entries.length.toLocaleString()} tệp · {formatBytes(file.size)} · đã kiểm tra đường dẫn</span></div>
                    </div>
                    <button type="button" className="primary-button" onClick={downloadReport} data-testid="button-download-report"><ArrowDownToLine size={14} /> Báo cáo TXT</button>
                  </div>
                  <div className="project-checks" data-testid="data-project-checklist">
                    {projectMarkers.map((marker) => (
                      <div className="project-check" key={marker.label} data-testid={`check-project-${safeFilename(marker.label, 'marker')}`}>
                        {marker.found ? <CheckCircle2 className="check-yes" size={16} /> : <CircleHelp className="check-no" size={16} />}
                        <div><strong>{marker.label}</strong><span>{marker.found ? marker.path : `Còn thiếu · ${marker.path}`}</span></div>
                      </div>
                    ))}
                  </div>
                  <div className="notice" data-testid="text-project-guidance"><Info size={15} /><span>Danh sách này chỉ nhận diện nhanh dựa trên đường dẫn, không xác thực quá trình biên dịch. Báo cáo TXT có lệnh dùng Gradle Wrapper cục bộ; công cụ không chạy các lệnh đó.</span></div>
                </div>
              )}
              {file && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 13 }}><button type="button" className="quiet-button" onClick={clearWorkspace} data-testid="button-clear-workspace"><X size={13} /> Xóa phiên làm việc</button></div>}
            </div>
          </section>

          <aside className="side-column" aria-label="Thông tin về công cụ">
            <section className="side-card">
              <div className="side-kicker">Hướng dẫn nhanh</div>
              <h3>{mode === 'apk' ? 'Dấu hiệu trong APK' : 'Kiểm tra mức độ sẵn sàng'}</h3>
              {mode === 'apk' ? (
                <div className="check-list">
                  <div className="check-item"><span className={`check-dot ${file && apkStats.manifest ? 'done' : ''}`}>{file && apkStats.manifest ? <Check size={12} /> : <ChevronDown size={13} />}</span><div><strong>AndroidManifest.xml</strong>Tệp kê khai của ứng dụng</div></div>
                  <div className="check-item"><span className={`check-dot ${file && apkStats.dex ? 'done' : ''}`}>{file && apkStats.dex ? <Check size={12} /> : <ChevronDown size={13} />}</span><div><strong>classes*.dex</strong>Tệp bytecode Dalvik</div></div>
                  <div className="check-item"><span className={`check-dot ${file && apkStats.resources ? 'done' : ''}`}>{file && apkStats.resources ? <Check size={12} /> : <ChevronDown size={13} />}</span><div><strong>resources.arsc</strong>Bảng tài nguyên đã biên dịch</div></div>
                  <div className="check-item"><span className={`check-dot ${file && apkStats.assetOrRes ? 'done' : ''}`}>{file && apkStats.assetOrRes ? <Check size={12} /> : <ChevronDown size={13} />}</span><div><strong>assets / res</strong>Thư mục tài nguyên và nội dung</div></div>
                </div>
              ) : (
                <div className="check-list">
                  <div className="check-item"><span className="check-dot"><FileCode2 size={12} /></span><div><strong>Cấu trúc dự án</strong>Tệp thiết lập, tập lệnh, wrapper</div></div>
                  <div className="check-item"><span className="check-dot"><Folder size={12} /></span><div><strong>Mô-đun ứng dụng</strong>Tệp kê khai, mã nguồn, tài nguyên</div></div>
                  <div className="check-item"><span className="check-dot"><ArrowDownToLine size={12} /></span><div><strong>Báo cáo hữu ích</strong>Dấu hiệu và lệnh biên dịch</div></div>
                </div>
              )}
              <div className="side-foot">{mode === 'apk' ? 'APK là tệp lưu trữ định dạng ZIP. DEX vẫn là bytecode; công cụ không dịch ngược thành mã nguồn.' : 'Wrapper là một dấu hiệu hữu ích nếu có. Công cụ không tự chạy hoặc mặc nhiên tin cậy tệp này.'}</div>
            </section>
            <section className="privacy-panel" data-testid="text-privacy-assurance">
              <ShieldCheck size={19} />
              <div><strong>Riêng tư theo thiết kế</strong><p>Dữ liệu tệp lưu trữ được xử lý trong bộ nhớ trên thiết bị này. Không tải tệp lên và không gọi máy chủ.</p></div>
            </section>
            <section className="side-card">
              <div className="side-kicker">Giới hạn công cụ</div>
              <h3>Kiểm tra, không thực thi.</h3>
              <div className="check-list">
                <div className="check-item"><span className="check-dot done"><Check size={12} /></span><div><strong>Duyệt và lọc</strong>Chỉ xem đường dẫn đã chuẩn hóa</div></div>
                <div className="check-item"><span className="check-dot done"><Check size={12} /></span><div><strong>Xuất tệp đã chọn</strong>Đóng gói thành ZIP mới trong bộ nhớ</div></div>
                <div className="check-item"><span className="check-dot"><X size={12} /></span><div><strong>Không dịch ngược mã nguồn</strong>Không tạo mã Java/Kotlin từ DEX</div></div>
              </div>
            </section>
          </aside>
        </div>
        <div className="footer-note">Dành cho việc kiểm tra cục bộ các tệp được phép sử dụng. Chỉ xem trước mục văn bản nhỏ; HTML và JavaScript không bao giờ được hiển thị hay thực thi.</div>
      </main>

      {preview && (
        <div className="preview-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <section className="preview-modal" role="dialog" aria-modal="true" aria-label={`Xem trước văn bản: ${preview.path}`} data-testid="dialog-text-preview">
            <div className="preview-head"><strong title={preview.path}>{preview.path}</strong><button type="button" className="preview-close" onClick={() => setPreview(null)} aria-label="Đóng phần xem trước" data-testid="button-close-preview"><X size={17} /></button></div>
            <pre className="preview-content" data-testid="text-entry-preview">{preview.text}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <WouterRouter hook={useHashLocation}>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </WouterRouter>
  );
}

export default App;
