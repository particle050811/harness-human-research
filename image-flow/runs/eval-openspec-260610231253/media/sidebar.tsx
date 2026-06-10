import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ExtToWebview, WebviewToExt, ExtensionConfig,
  TaskInfo, HistoryEntry, MaterialLibrary,
} from '../src/shared';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// --- App ---
function App() {
  const [tab, setTab] = useState('workbench');
  const [config, setConfig] = useState<ExtensionConfig | null>(null);
  const _activeFilePath = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [autoLibs, setAutoLibs] = useState<MaterialLibrary[]>([]);
  const [manualLibs, setManualLibs] = useState<MaterialLibrary[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as ExtToWebview;
      switch (msg.type) {
        case 'config':
          setConfig(msg.config);
          break;
        case 'activeMd':
          _activeFilePath[1](msg.filePath);
          setActiveFileName(msg.fileName);
          break;
        case 'tasks':
          setTasks(msg.tasks);
          setHistory(msg.history);
          break;
        case 'materials':
          setAutoLibs(msg.auto);
          setManualLibs(msg.manual);
          break;
        case 'status':
          setStatusMsg(msg.message);
          setStatusError(msg.isError);
          setTimeout(() => { setStatusMsg(''); setStatusError(false); }, 5000);
          break;
      }
    };
    window.addEventListener('message', handler);
    // 发 init
    vscode.postMessage({ type: 'init' });
    return () => window.removeEventListener('message', handler);
  }, []);

  // 提交完成后恢复按钮
  useEffect(() => {
    const hasPending = tasks.some((t) =>
      t.jobs.some((j) => j.status === 'running' || j.status === 'submitting'),
    );
    setSubmitting(hasPending);
  }, [tasks]);

  const post = (msg: WebviewToExt) => vscode.postMessage(msg);

  if (!config) return <div style={{ padding: 8 }}>加载中…</div>;

  return (
    <div>
      <div className="tab-list">
        <button className="tab-trigger" data-state={tab === 'workbench' ? 'active' : ''} onClick={() => setTab('workbench')}>工作台</button>
        <button className="tab-trigger" data-state={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>任务</button>
        <button className="tab-trigger" data-state={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>设置</button>
      </div>

      <div className="tab-content">
        {tab === 'workbench' && (
          <WorkbenchTab
            config={config}
            activeFileName={activeFileName}
            autoLibs={autoLibs}
            manualLibs={manualLibs}
            statusMsg={statusMsg}
            statusError={statusError}
            submitting={submitting}
            post={post}
          />
        )}
        {tab === 'tasks' && (
          <TasksTab
            tasks={tasks}
            history={history}
            tasksCols={config.tasksCols}
            post={post}
          />
        )}
        {tab === 'settings' && (
          <SettingsTab config={config} post={post} />
        )}
      </div>
    </div>
  );
}

// --- 工作台 ---
function WorkbenchTab({
  config, activeFileName, autoLibs, manualLibs,
  statusMsg, statusError, submitting, post,
}: {
  config: ExtensionConfig;
  activeFileName: string | null;
  autoLibs: MaterialLibrary[];
  manualLibs: MaterialLibrary[];
  statusMsg: string;
  statusError: boolean;
  submitting: boolean;
  post: (msg: WebviewToExt) => void;
}) {
  return (
    <div>
      {/* 素材库区 */}
      <MaterialSection
        autoLibs={autoLibs}
        manualLibs={manualLibs}
        workbenchCols={config.workbenchCols}
        post={post}
      />

      {/* 底部停靠区 */}
      <div className="dock-bottom">
        {/* 控件行 */}
        <div className="row">
          <div className="grow">
            <label className="label">模型</label>
            <select value={config.model} onChange={(e) => post({ type: 'saveConfig', key: 'model', value: e.target.value })}>
              <option value="nano-banana-2">nano-banana-2</option>
              <option value="nano-banana-pro">nano-banana-pro</option>
              <option value="gpt-image-2">gpt-image-2</option>
              <option value="gpt-image-2-vip">gpt-image-2-vip</option>
            </select>
          </div>
          <div className="grow">
            <label className="label">分辨率</label>
            <select value={config.imageSize} onChange={(e) => post({ type: 'saveConfig', key: 'imageSize', value: e.target.value })}>
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </div>
          <div className="grow">
            <label className="label">比例</label>
            <select value={config.aspectRatio} onChange={(e) => post({ type: 'saveConfig', key: 'aspectRatio', value: e.target.value })}>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>
          <div>
            <label className="label">并发</label>
            <input type="number" min={1} max={10} value={config.concurrency}
              onChange={(e) => {
                const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                post({ type: 'saveConfig', key: 'concurrency', value: v });
              }}
            />
          </div>
        </div>

        {/* 生成行 */}
        <div className="row">
          <span style={{ fontSize: 12, flex: 1 }}>
            {activeFileName || '未打开 Markdown 文件'}
          </span>
          <button className="secondary small" onClick={() => post({ type: 'preview' })}>预览请求</button>
          <button className="small" disabled={submitting || !activeFileName} onClick={() => post({ type: 'generate' })}>
            {submitting ? '生成中…' : '生成'}
          </button>
        </div>

        {/* 状态行 */}
        {statusMsg && (
          <div className={`status-msg ${statusError ? 'error' : 'success'}`}>{statusMsg}</div>
        )}
      </div>
    </div>
  );
}

// --- 素材库区 ---
function MaterialSection({
  autoLibs, manualLibs, workbenchCols, post,
}: {
  autoLibs: MaterialLibrary[];
  manualLibs: MaterialLibrary[];
  workbenchCols: number;
  post: (msg: WebviewToExt) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div>
      <div className="section-title">当前路径</div>
      {autoLibs.map((lib) => (
        <MaterialLib
          key={lib.name}
          lib={lib}
          cols={workbenchCols}
          expanded={expanded[lib.name] !== false}
          onToggle={() => toggleExpand(lib.name)}
          post={post}
        />
      ))}

      <div className="section-title">手动素材库</div>
      {manualLibs.map((lib) => (
        <MaterialLib
          key={lib.path}
          lib={lib}
          cols={workbenchCols}
          expanded={expanded[lib.path] !== false}
          onToggle={() => toggleExpand(lib.path)}
          post={post}
          removable
        />
      ))}
      <button className="small secondary" style={{ marginTop: 4 }}
        onClick={() => post({ type: 'addMaterialDir' })}>
        + 添加
      </button>
    </div>
  );
}

function MaterialLib({
  lib, cols, expanded, onToggle, post, removable,
}: {
  lib: MaterialLibrary;
  cols: number;
  expanded: boolean;
  onToggle: () => void;
  post: (msg: WebviewToExt) => void;
  removable?: boolean;
}) {
  return (
    <div className="mat-lib">
      <div className="mat-lib-header" onClick={onToggle}>
        <span>{lib.name} ({lib.images.length})</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {expanded ? '▾' : '▸'}
          {removable && (
            <button className="small danger" onClick={(e) => {
              e.stopPropagation();
              post({ type: 'removeMaterialDir', dir: lib.path });
            }}>×</button>
          )}
        </span>
      </div>
      {expanded && lib.images.length > 0 && (
        <div className="mat-lib-body">
          <div className="mat-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {lib.images.map((img) => (
              <img
                key={img.path}
                className="mat-thumb"
                src={img.webviewUri}
                title={img.name}
                onClick={() => post({ type: 'openImage', imagePath: img.path })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  post({ type: 'insertImage', imagePath: img.path });
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- 任务页 ---
function TasksTab({
  tasks, history, tasksCols, post,
}: {
  tasks: TaskInfo[];
  history: HistoryEntry[];
  tasksCols: number;
  post: (msg: WebviewToExt) => void;
}) {
  return (
    <div>
      {/* 进行中任务与历史合并倒序：进行中在前 */}
      {tasks.map((task) => (
        <InProgressCard key={task.id} task={task} cols={tasksCols} post={post} />
      ))}
      {tasks.length === 0 && history.length === 0 && (
        <div style={{ fontSize: 12, color: '#888', padding: 16, textAlign: 'center' }}>
          暂无任务
        </div>
      )}
      {history.map((entry) => (
        <HistoryCard key={entry.folderName} entry={entry} cols={tasksCols} post={post} />
      ))}
    </div>
  );
}

function InProgressCard({ task, cols, post }: { task: TaskInfo; cols: number; post: (msg: WebviewToExt) => void }) {
  const [expanded, setExpanded] = useState(true);
  const [elapsed, setElapsed] = useState('');

  const totalJobs = task.jobs.length;
  const doneJobs = task.jobs.filter((j) => j.status === 'succeeded' || j.status === 'failed' || j.status === 'violation').length;
  const runningJobs = task.jobs.filter((j) => j.status === 'running').length;
  const submittingJobs = task.jobs.filter((j) => j.status === 'submitting').length;
  const failedJobs = task.jobs.filter((j) => j.status === 'failed' || j.status === 'violation').length;

  // 聚合进度
  const progress = task.jobs.reduce((sum, j) => {
    if (j.status === 'succeeded' || j.status === 'failed' || j.status === 'violation') return sum + 100;
    if (j.status === 'running') return sum + (j.progress || 0);
    return sum;
  }, 0) / totalJobs;

  const allImages = task.jobs.flatMap((j) => j.images);
  const errors = task.jobs.filter((j) => j.error).map((j) => j.error!);

  // 计时器
  useEffect(() => {
    const timer = setInterval(() => {
      const delta = Math.floor((Date.now() - task.startedAt) / 1000);
      const h = Math.floor(delta / 3600);
      const m = Math.floor((delta % 3600) / 60);
      const s = delta % 60;
      if (h > 0) {
        setElapsed(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      } else {
        setElapsed(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [task.startedAt]);

  return (
    <div className="task-card">
      <div className="task-card-header" onClick={() => setExpanded(!expanded)}>
        <span>
          {task.folderName}（{task.model}）·
          {submittingJobs > 0 ? ` 提交中 ${doneJobs}/${totalJobs}` : ` 生成中 ${doneJobs}/${totalJobs}`}
          {failedJobs > 0 ? ` · 失败 ${failedJobs}` : ''} · {elapsed}
        </span>
        <span>{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="task-card-body">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${Math.round(progress)}%` }} />
          </div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{Math.round(progress)}%</div>

          {submittingJobs > 0 && <div style={{ fontSize: 11 }}>正在提交 {submittingJobs} 个请求…</div>}
          {runningJobs > 0 && <div style={{ fontSize: 11 }}>还有 {runningJobs} 张正在生成…</div>}

          {allImages.length > 0 && (
            <div className="mat-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, marginTop: 6 }}>
              {allImages.map((img, i) => (
                <img key={i} className="mat-thumb"
                  src={postImgUri(task.folderPath, img)}
                  onClick={() => post({ type: 'openImage', imagePath: `${task.folderPath}/${img}` })}
                />
              ))}
            </div>
          )}

          {errors.length > 0 && (
            <div className="error-list">
              {errors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryCard({ entry, cols, post }: { entry: HistoryEntry; cols: number; post: (msg: WebviewToExt) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="task-card">
      <div className="task-card-header" onClick={() => setExpanded(!expanded)}>
        <span>{entry.folderName}（{entry.imageCount} 张）</span>
        <span>{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="task-card-body">
          <div className="mat-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {entry.images.map((img, i) => (
              <img key={i} className="mat-thumb"
                src={postImgUri(entry.folderPath, img)}
                onClick={() => post({ type: 'openImage', imagePath: `${entry.folderPath}/${img}` })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// helper: 构建图片 URI（webview 内需要通过 vscode URI scheme 显示本地图片）
function postImgUri(folderPath: string, fileName: string): string {
  // 在侧栏中，图片 URI 需要经扩展转换；这里传原始路径，由扩展先转换再传回
  // 但任务卡片中图片已通过 getHistory 返回的 images 只是文件名
  // 实际需要通过 postMessage 转换
  return `vscode-webview-resource:${folderPath}/${fileName}`;
}

// --- 设置页 ---
function SettingsTab({ config, post }: { config: ExtensionConfig; post: (msg: WebviewToExt) => void }) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [injectionModel, setInjectionModel] = useState(config.model);
  const showApiKey = config.apiKey === '***';

  const currentInjection = config.modelInjections[injectionModel] || '';

  return (
    <div>
      {/* API Key */}
      <div className="setting-row">
        <label>API Key {showApiKey ? '(已保存)' : ''}</label>
        <div className="api-key-row">
          <input
            type="password"
            placeholder={showApiKey ? '已保存' : '输入 API Key'}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
          />
          <button className="small" onClick={() => {
            if (apiKeyInput.trim()) {
              post({ type: 'setApiKey', value: apiKeyInput.trim() });
              setApiKeyInput('');
            }
          }}>保存</button>
        </div>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); post({ type: 'openUrl', url: 'https://grsai.ai/zh/dashboard/api-keys' }); }}
          style={{ fontSize: 11, color: 'var(--accent)' }}
        >
          获取 API Key →
        </a>
      </div>

      {/* 节点 */}
      <div className="setting-row">
        <label>API 节点</label>
        <select value={config.baseUrl} onChange={(e) => post({ type: 'saveConfig', key: 'baseUrl', value: e.target.value })}>
          <option value="https://grsai.dakka.com.cn">国内节点</option>
          <option value="https://grsaiapi.com">全球节点</option>
        </select>
      </div>

      {/* 每行张数 */}
      <div className="row">
        <div className="grow">
          <label className="label">工作台每行</label>
          <input type="number" min={1} max={8} value={config.workbenchCols}
            onChange={(e) => post({ type: 'saveConfig', key: 'workbenchCols', value: Math.max(1, Math.min(8, parseInt(e.target.value) || 1)) })}
          />
        </div>
        <div className="grow">
          <label className="label">任务栏每行</label>
          <input type="number" min={1} max={8} value={config.tasksCols}
            onChange={(e) => post({ type: 'saveConfig', key: 'tasksCols', value: Math.max(1, Math.min(8, parseInt(e.target.value) || 1)) })}
          />
        </div>
      </div>

      {/* 模型注入提示词 */}
      <div className="injection-editor">
        <label className="label">模型注入提示词</label>
        <select value={injectionModel} onChange={(e) => setInjectionModel(e.target.value)}>
          <option value="nano-banana-2">nano-banana-2</option>
          <option value="nano-banana-pro">nano-banana-pro</option>
          <option value="gpt-image-2">gpt-image-2</option>
          <option value="gpt-image-2-vip">gpt-image-2-vip</option>
        </select>
        <textarea
          value={currentInjection}
          onChange={(e) => {
            const newInjections = { ...config.modelInjections, [injectionModel]: e.target.value };
            post({ type: 'saveConfig', key: 'modelInjections', value: newInjections });
          }}
          placeholder="输入注入提示词…"
        />
      </div>
    </div>
  );
}

// --- 启动 ---
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
