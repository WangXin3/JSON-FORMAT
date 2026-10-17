import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import {
  Braces, History, Settings2, ArrowUpRight, ArrowRight, WandSparkles, Eraser, Undo2,
  Copy, ChevronsDownUp, ChevronsUpDown, Check, CheckCircle2, CircleAlert, Clock3,
  Search, Trash2, X, Code2, Keyboard, ShieldCheck, FileJson2, LoaderCircle, Hash, AlignLeft,
} from 'lucide-react';
import { JsonEditor, type EditorHandle } from './components/JsonEditor';
import { Dialog } from './components/Dialog';
import { AUTO_PREVIEW_LIMIT, byteSize, MAX_INPUT_BYTES, processJson, type JsonProblem, type JsonResult } from './core/json';
import { JsonProcessor } from './core/processor';
import {
  addHistory, clearHistory, copyText, DEFAULT_SETTINGS, deleteHistory, getHistory,
  listHistory, loadSettings, saveSettings, type HistoryItem, type Settings,
} from './core/storage';

const SAMPLE = `{"project": "JSON FORMAT", "version": "1.0.0",
"description": "让 JSON 清晰有序",
"features": ["格式化", "去除转义", "历史记录"],
"settings": {"indent": 2, "lineNumbers": true},
"user": {"name": "张三", "roles": ["developer", "admin"]},
"ready": true, "message": "Hello, JSON!"}`;
const SAMPLE_RESULT = processJson(SAMPLE);
type Analysis = { source: string; indent: number; result: JsonResult };
type Toast = { text: string; error: boolean; serial: number };

export function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function App() {
  const [text, setText] = useState(SAMPLE);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>({ source: SAMPLE, indent: 2, result: SAMPLE_RESULT });
  const [problem, setProblem] = useState<JsonProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [panel, setPanel] = useState<'history' | 'settings' | null>(null);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [split, setSplit] = useState(50);
  const [copied, setCopied] = useState<'formatted' | 'compressed' | null>(null);
  const inputRef = useRef<EditorHandle>(null);
  const outputRef = useRef<EditorHandle>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const processor = useRef<JsonProcessor | null>(null);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ text, settings, ready });
  current.current = { text, settings, ready };
  const latestAnalysis = useRef(analysis);
  latestAnalysis.current = analysis;

  const notify = useCallback((message: string, error = false) => setToast({ text: message, error, serial: Date.now() }), []);

  useEffect(() => {
    processor.current = new JsonProcessor();
    let active = true;
    loadSettings().then((value) => { if (active) setSettings(value); }).catch(() => {
      if (active) notify('本地设置读取失败，暂时使用默认设置', true);
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; revision.current++; processor.current?.destroy(); processor.current = null; };
  }, [notify]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(timeout);
  }, [copied]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try { setItems(await listHistory()); }
    catch { notify('历史记录读取失败，请检查本地存储是否可用', true); }
    finally { setHistoryLoading(false); }
  }, [notify]);

  const changeInput = useCallback((value: string) => {
    if (value === current.current.text) return;
    revision.current++;
    current.current.text = value;
    setText(value);
    setProblem(null);
    setCopied(null);
  }, []);

  const analyze = useCallback(async (source: string, save = false, unescape = false) => {
    clearTimeout(timer.current);
    if (!processor.current) return;
    const request = ++revision.current;
    const options = { ...current.current.settings };
    setBusy(true);
    setManual(false);
    setProblem(null);
    try {
      const response = await processor.current.run(source, options.indent, unescape);
      if (request !== revision.current) return;
      if (response.problem) {
        setProblem(response.problem);
        if (unescape) notify(response.problem.message, true);
        return;
      }
      if (!response.result || response.source === undefined) return;
      const processed: Analysis = { source: response.source, indent: options.indent, result: response.result };
      latestAnalysis.current = processed;
      setAnalysis(processed);
      if (unescape) {
        current.current.text = response.source;
        setText(response.source);
        notify('已去除一层转义，可撤销恢复原始内容');
      }
      if (save && options.historyEnabled) {
        try {
          await addHistory(response.source, unescape ? 'unescape' : 'format');
          if (request === revision.current && !unescape) notify('格式化完成，已保存到历史记录');
        } catch { notify('格式化成功，但历史记录保存失败', true); }
      } else if (save && !unescape) notify('格式化完成');
    } catch (error) {
      if (request === revision.current) notify(error instanceof Error ? error.message : '处理失败，请重试', true);
    } finally { if (request === revision.current) setBusy(false); }
  }, [notify]);

  useEffect(() => {
    if (!ready) return;
    if (!text.trim()) {
      setAnalysis(null); setProblem(null); setBusy(false); setManual(false);
      return;
    }
    if (latestAnalysis.current?.source === text && latestAnalysis.current.indent === settings.indent) {
      setBusy(false); setManual(false);
      return;
    }
    if (byteSize(text) > MAX_INPUT_BYTES) {
      setBusy(false); setManual(false);
      setProblem({ message: '内容超过 10 MB，请缩小后再处理', line: 1, column: 1, offset: 0 });
      return;
    }
    if (byteSize(text) > AUTO_PREVIEW_LIMIT) {
      setBusy(false); setManual(true); setProblem(null);
      return;
    }
    setBusy(true);
    timer.current = setTimeout(() => { void analyze(text); }, 300);
    return () => { clearTimeout(timer.current); };
  }, [text, settings.indent, ready, analyze]);

  const valid = analysis?.source === text && analysis.indent === settings.indent && !problem && !busy;
  const result = valid ? analysis.result : null;
  const inputBytes = byteSize(text);

  const copy = useCallback(async (mode: 'formatted' | 'compressed') => {
    const latest = latestAnalysis.current;
    if (!latest || latest.source !== current.current.text || latest.indent !== current.current.settings.indent) return;
    try {
      await copyText(latest.result[mode]);
      setCopied(mode);
      notify(mode === 'formatted' ? '已复制完整的格式化 JSON' : '已复制压缩 JSON');
    } catch { notify('复制失败，请检查剪贴板权限后重试', true); }
  }, [notify]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !panel) {
        event.preventDefault();
        if (current.current.ready && current.current.text.trim()) void analyze(current.current.text, true);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [analyze, panel]);

  function updateSettings(patch: Partial<Settings>) {
    const next = { ...current.current.settings, ...patch };
    if (next.indent !== current.current.settings.indent) { revision.current++; setProblem(null); }
    current.current.settings = next;
    setSettings(next);
    void saveSettings(next).catch(() => notify('设置保存失败，重启后可能恢复默认值', true));
  }

  function openHistory() {
    setPanel('history'); setSearch(''); setConfirmClear(false);
    void refreshHistory();
  }

  async function restore(item: HistoryItem) {
    try {
      const record = await getHistory(item.id);
      if (!record) { notify('这条历史记录已被删除', true); return; }
      setPanel(null);
      changeInput(record.source);
      void analyze(record.source);
      notify('已恢复历史记录');
    } catch { notify('历史记录恢复失败', true); }
  }

  const filteredItems = items.filter((item) => item.preview.toLowerCase().includes(search.toLowerCase()));

  return <div className="app-shell">
    <aside className="rail" aria-label="导航">
      <div className="brand-mark" title="JSON FORMAT"><Braces size={25} strokeWidth={2.1} /></div>
      <div className="rail-tools">
        <button className="rail-button active" aria-label="JSON 编辑器" title="JSON 编辑器" onClick={() => { setPanel(null); inputRef.current?.focus(); }}><Code2 size={22} /></button>
        <button className={`rail-button ${panel === 'history' ? 'selected' : ''}`} aria-label="历史记录" title="历史记录" onClick={openHistory}><History size={21} /></button>
      </div>
      <div className="rail-bottom">
        <button className="rail-button" aria-label="偏好设置" title="偏好设置" onClick={() => setPanel('settings')}><Settings2 size={21} /></button>
        <div className="rail-version">v0.1</div>
      </div>
    </aside>

    <div className="app-main">
      <header className="topbar">
        <div className="header-brand">
          <div className="wordmark">JSON <span>FORMAT</span><span className="desktop-badge">DESKTOP</span></div>
          <div className="header-heading"><h1>让 JSON，<span>清晰有序。</span></h1><span className="header-description">格式化、检查与整理</span></div>
        </div>
        <div className="topbar-right"><span className="header-privacy"><ShieldCheck size={15} />数据只留在本机</span><span className="local-badge"><span /> 本地运行</span></div>
      </header>

      <main className="main-content">
        <div className="workspace-topline">
          <div className="workspace-title"><span className="workspace-dot" />编辑工作区<span className="workspace-subtitle">JSON WORKSPACE</span></div>
          <button className="line-toggle" aria-pressed={settings.lineNumbers} disabled={!ready} onClick={() => updateSettings({ lineNumbers: !settings.lineNumbers })}>
            <Hash size={14} /><span>显示行号</span><span className={`toggle ${settings.lineNumbers ? 'on' : ''}`}><span /></span>
          </button>
        </div>

        <div className="workspace" ref={workspaceRef} style={{ '--split': `${split}%` } as CSSProperties}>
          <section className="editor-panel input-panel" aria-label="原始 JSON 面板">
            <div className="panel-heading"><div className="panel-title"><div className="panel-icon"><AlignLeft size={17} /></div><h2>原始 JSON</h2><span className="panel-tag">INPUT</span></div>
              <button className="text-button sample-button" onClick={() => { changeInput(SAMPLE); void analyze(SAMPLE); }} title="用示例替换当前输入">载入示例<ArrowUpRight size={13} /></button>
            </div>
            <div className="panel-toolbar">
              <button className="button primary" disabled={!ready || busy || !text.trim() || inputBytes > MAX_INPUT_BYTES} onClick={() => void analyze(text, true)}>
                {busy ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />}格式化<span className="shortcut">Ctrl ↵</span>
              </button>
              <button className="button secondary" disabled={!ready || busy || !text.trim() || inputBytes > MAX_INPUT_BYTES} onClick={() => void analyze(text, true, true)}><Braces size={14} />去除转义</button>
              <div className="toolbar-spacer" />
              <button className="icon-button" title="撤销输入修改 (Ctrl+Z)" aria-label="撤销输入修改" onClick={() => { inputRef.current?.undo(); inputRef.current?.focus(); }}><Undo2 size={15} /></button>
              <button className="icon-button" disabled={!text} title="清空输入" aria-label="清空输入" onClick={() => { changeInput(''); inputRef.current?.focus(); }}><Eraser size={16} /></button>
            </div>
            <div className="editor-body"><JsonEditor ref={inputRef} value={text} onChange={changeInput} showLineNumbers={settings.lineNumbers} label="原始 JSON 编辑器" /></div>
            <div className="panel-footer"><span><span className="footer-dot" />可编辑</span><span>{text.length.toLocaleString()} 字符<span className="footer-separator">·</span>{formatBytes(inputBytes)}</span></div>
          </section>

          <div className="splitter" role="separator" aria-label="调整左右面板宽度" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(split)} tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSplit((v) => Math.min(70, Math.max(30, v + (event.key === 'ArrowLeft' ? -2 : 2)))); }
              if (event.key === 'Home') setSplit(50);
            }}
            onDoubleClick={() => setSplit(50)}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId) || !workspaceRef.current) return;
              const bounds = workspaceRef.current.getBoundingClientRect();
              setSplit(Math.max(30, Math.min(70, (event.clientX - bounds.left) / bounds.width * 100)));
            }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}><span /></div>

          <section className="editor-panel output-panel" aria-label="格式化结果面板">
            <div className="panel-heading"><div className="panel-title"><div className="panel-icon output"><Braces size={17} /></div><h2>格式化结果</h2><span className="panel-tag">OUTPUT</span></div>
              <div className="indent-control"><label htmlFor="indent">缩进</label><select id="indent" aria-label="缩进空格数" value={settings.indent} disabled={!ready} onChange={(event) => updateSettings({ indent: Number(event.target.value) as 2 | 4 })}><option value={2}>2 空格</option><option value={4}>4 空格</option></select></div>
            </div>
            <div className="panel-toolbar output-toolbar">
              <button className="fold-button" disabled={!result} title="展开所有对象与数组" onClick={() => outputRef.current?.expand()}><ChevronsUpDown size={15} /><span>全部展开</span></button>
              <button className="fold-button" disabled={!result} title="收起所有对象与数组" onClick={() => outputRef.current?.collapse()}><ChevronsDownUp size={15} /><span>全部收起</span></button>
              <div className="toolbar-spacer" />
              <button className="button secondary copy-button" disabled={!result} onClick={() => void copy('formatted')}>{copied === 'formatted' ? <Check size={14} /> : <Copy size={14} />}<span>复制格式化</span></button>
              <button className="button secondary copy-button" disabled={!result} onClick={() => void copy('compressed')}>{copied === 'compressed' ? <Check size={14} /> : <Code2 size={14} />}<span>复制压缩</span></button>
            </div>
            <div className="editor-body output-body">
              <JsonEditor ref={outputRef} value={result?.formatted ?? ''} folds={result?.folds} readOnly showLineNumbers={settings.lineNumbers} label="格式化 JSON 结果" />
              {!result && <div className={`editor-empty ${problem ? 'has-error' : ''}`}>
                <div className="empty-symbol">{problem ? <CircleAlert size={28} /> : busy ? <LoaderCircle size={28} className="spin" /> : <Braces size={30} />}</div>
                <h3>{problem ? 'JSON 需要一点调整' : busy ? '正在整理 JSON…' : manual ? '大文本已就绪' : '从一段 JSON 开始'}</h3>
                <p>{problem ? problem.message : manual ? '超过 512 KB 的内容请点击「格式化」处理' : busy ? '处理完成后，结果将在这里显示' : '在左侧输入内容，格式化结果会自动出现在这里'}</p>
                {problem && <button className="error-location" onClick={() => inputRef.current?.goTo(problem.offset)}>第 {problem.line} 行，第 {problem.column} 列<ArrowRight size={14} /></button>}
                {manual && <button className="button primary" disabled={inputBytes > MAX_INPUT_BYTES} onClick={() => void analyze(text, true)}>格式化 JSON<ArrowRight size={14} /></button>}
              </div>}
            </div>
            <div className="panel-footer"><span className={result ? 'success-text' : problem ? 'error-text' : ''}>{result ? <><CheckCircle2 size={13} />有效 JSON</> : problem ? <><CircleAlert size={13} />校验失败</> : busy ? '正在处理' : '等待格式化'}</span><span>{result ? <>{result.kind}<span className="footer-separator">·</span>{result.lines.toLocaleString()} 行</> : '只读预览'}</span></div>
          </section>
        </div>

        <div className="workspace-bottom"><div><Keyboard size={15} /><span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 格式化<span className="hint-divider" /> <kbd>Ctrl</kbd> + <kbd>F</kbd> 查找</span></div><span className="preview-note"><span />自动预览已开启</span></div>
        <div className="feature-strip"><span><ShieldCheck size={15} />完全本地处理</span><i /><span><Braces size={15} />保留原始数据精度</span><i /><span><Clock3 size={15} />{settings.historyEnabled ? '自动保存格式化历史' : '历史记录已关闭'}</span><span className="feature-strip-end">A little order. A lot of clarity.</span></div>
      </main>
      <footer className="app-footer"><span>JSON FORMAT <span className="footer-separator">/</span> 为清晰而生</span><span>UTF-8<span className="footer-separator">·</span>v0.1.2</span></footer>
    </div>

    {toast && <div role="status" className={`toast ${toast.error ? 'toast-error' : ''}`}>{toast.error ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}<span>{toast.text}</span><button onClick={() => setToast(null)} aria-label="关闭提示"><X size={14} /></button></div>}

    {panel === 'history' && <Dialog title="历史记录" onClose={() => setPanel(null)} drawer>
      <p className="dialog-description">找回每一次整理过的数据。</p>
      <div className="history-search"><Search size={17} /><input autoFocus aria-label="搜索历史记录" placeholder="搜索内容摘要…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="清空搜索" onClick={() => setSearch('')}><X size={14} /></button>}</div>
      <div className="history-meta"><span>{items.length} / 100 条记录<span className="footer-separator">·</span>{formatBytes(items.reduce((sum, item) => sum + item.bytes, 0))} / 50 MB</span><button className="text-button danger" disabled={!items.length} onClick={() => setConfirmClear(true)}><Trash2 size={13} />清空历史</button></div>
      {confirmClear && <div className="clear-confirm"><span>确定清空全部历史记录？</span><div><button className="button secondary" onClick={() => setConfirmClear(false)}>取消</button><button className="button danger-button" onClick={async () => { try { await clearHistory(); setConfirmClear(false); await refreshHistory(); notify('历史记录已清空'); } catch { notify('清空历史记录失败', true); } }}>确定清空</button></div></div>}
      <div className="history-list">{historyLoading ? <div className="history-empty"><LoaderCircle className="spin" size={25} /><p>正在读取历史记录…</p></div> : filteredItems.length ? filteredItems.map((item) => <article className="history-item" key={item.id}>
        <button className="history-restore" title="恢复此记录" onClick={() => void restore(item)}><div className="history-item-top"><FileJson2 size={18} /><span>{new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(item.createdAt)}</span><span className="history-action">{item.action === 'unescape' ? '去除转义' : '格式化'}</span></div><p>{item.preview}</p><div className="history-item-bottom"><span>{formatBytes(item.bytes)}</span><span>恢复到编辑器<ArrowUpRight size={12} /></span></div></button>
        <button className="history-delete icon-button" title="删除此记录" aria-label={`删除 ${item.preview.slice(0, 20)}`} onClick={async () => { try { await deleteHistory(item.id); await refreshHistory(); } catch { notify('删除历史记录失败', true); } }}><Trash2 size={14} /></button>
      </article>) : <div className="history-empty"><History size={31} /><h3>{search ? '没有匹配的记录' : '还没有历史记录'}</h3><p>{search ? '试试其他关键词' : '点击「格式化」或「去除转义」后，成功处理的内容会保存在这里。'}</p></div>}</div>
      <div className="history-footnote"><ShieldCheck size={14} />仅保存在本机，达到上限后自动清理最早记录</div>
    </Dialog>}

    {panel === 'settings' && <Dialog title="偏好设置" onClose={() => setPanel(null)}>
      <p className="dialog-description">让工作区更符合你的习惯。</p>
      <div className="setting-row"><div><h3>显示行号</h3><p>同时控制原始内容与格式化结果</p></div><button className={`toggle standalone ${settings.lineNumbers ? 'on' : ''}`} role="switch" aria-checked={settings.lineNumbers} aria-label="设置显示行号" disabled={!ready} onClick={() => updateSettings({ lineNumbers: !settings.lineNumbers })}><span /></button></div>
      <div className="setting-row"><div><h3>默认缩进</h3><p>复制格式化 JSON 时使用此缩进</p></div><select aria-label="设置缩进" value={settings.indent} disabled={!ready} onChange={(event) => updateSettings({ indent: Number(event.target.value) as 2 | 4 })}><option value={2}>2 空格</option><option value={4}>4 空格</option></select></div>
      <div className="setting-row"><div><h3>记录历史</h3><p>保存成功处理的内容，最多 100 条 / 50 MB</p></div><button className={`toggle standalone ${settings.historyEnabled ? 'on' : ''}`} role="switch" aria-checked={settings.historyEnabled} aria-label="记录历史" disabled={!ready} onClick={() => updateSettings({ historyEnabled: !settings.historyEnabled })}><span /></button></div>
      <div className="settings-note"><ShieldCheck size={19} /><div><strong>你的数据，留在本地。</strong><p>JSON 的处理和历史存储均在本机完成。关闭记录历史后，已有记录仍可查看和删除。</p></div></div>
      <div className="dialog-actions"><button className="button primary" onClick={() => setPanel(null)}>完成<Check size={15} /></button></div>
    </Dialog>}
  </div>;
}
