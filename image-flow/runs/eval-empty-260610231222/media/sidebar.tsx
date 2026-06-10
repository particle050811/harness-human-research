// image-flow 侧栏 Webview — React 19 + Radix UI

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tabs from '@radix-ui/react-tabs';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as Progress from '@radix-ui/react-progress';

// ---- VS Code API ----
interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode: VsCodeApi = acquireVsCodeApi();

// ---- 共享类型（与 src/shared.ts 保持一致） ----

interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
  concurrency: number;
  workbenchCols: number;
  tasksCols: number;
  modelInjections: Record<string, string>;
}

interface ActiveMdInfo {
  filePath: string;
  fileName: string;
}

interface TaskJob {
  index: number;
  status: 'submitting' | 'running' | 'succeeded' | 'failed' | 'violation';
  id?: string;
  progress: number;
  error?: string;
  results?: string[];
}

interface TaskInfo {
  folderName: string;
  folderPath: string;
  model: string;
  mdFileName: string;
  mdFilePath: string;
  jobs: TaskJob[];
  submittedAt: number;
  startedAt: number;
}

interface HistoryItem {
  folderName: string;
  folderPath: string;
  images: string[];
  imageCount: number;
}

interface MediaFolder {
  name: string;
  path: string;
  images: string[];
}

type ExtToWv =
  | { type: 'initResponse'; config: AppConfig; activeMd: ActiveMdInfo | null; tasks: TaskInfo[]; history: HistoryItem[]; mediaFolders: MediaFolder[]; autoMediaFolders: MediaFolder[] }
  | { type: 'configUpdate'; key: string; value: unknown }
  | { type: 'taskUpdate'; tasks: TaskInfo[] }
  | { type: 'taskCompleted'; taskInfo: TaskInfo }
  | { type: 'historyUpdate'; history: HistoryItem[] }
  | { type: 'mediaFoldersUpdate'; folders: MediaFolder[] }
  | { type: 'autoMediaFoldersUpdate'; folders: MediaFolder[] }
  | { type: 'activeMdChanged'; activeMd: ActiveMdInfo | null }
  | { type: 'statusMessage'; message: string; isError: boolean }
  | { type: 'switchTab'; tab: string };

// ---- App ----
function App() {
  const [tab, setTab] = useState('workbench');
  const [config, setConfig] = useState<AppConfig>({
    apiKey: '', baseUrl: 'https://grsai.dakka.com.cn', model: 'nano-banana-2',
    aspectRatio: '3:4', imageSize: '1K', concurrency: 1, workbenchCols: 4,
    tasksCols: 2, modelInjections: {},
  });
  const [activeMd, setActiveMd] = useState<ActiveMdInfo | null>(null);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [mediaFolders, setMediaFolders] = useState<MediaFolder[]>([]);
  const [autoMediaFolders, setAutoMediaFolders] = useState<MediaFolder[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as ExtToWv;
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'initResponse':
          setConfig(msg.config);
          setActiveMd(msg.activeMd);
          setTasks(msg.tasks);
          setHistory(msg.history);
          setMediaFolders(msg.mediaFolders);
          setAutoMediaFolders(msg.autoMediaFolders);
          break;
        case 'taskUpdate':
          setTasks(msg.tasks);
          setSubmitting(false);
          break;
        case 'taskCompleted':
          setTasks(prev => prev.filter(t => t.folderName !== msg.taskInfo.folderName));
          // 把任务图片加入历史
          setHistory(prev => {
            const allImages = msg.taskInfo.jobs
              .flatMap(j => j.results ?? [])
              .filter(Boolean);
            if (allImages.length === 0) return prev;
            const item: HistoryItem = {
              folderName: msg.taskInfo.folderName,
              folderPath: msg.taskInfo.folderPath,
              images: allImages,
              imageCount: allImages.length,
            };
            return [item, ...prev];
          });
          break;
        case 'historyUpdate':
          setHistory(msg.history);
          break;
        case 'mediaFoldersUpdate':
          setMediaFolders(msg.folders);
          break;
        case 'autoMediaFoldersUpdate':
          setAutoMediaFolders(msg.folders);
          break;
        case 'activeMdChanged':
          setActiveMd(msg.activeMd);
          break;
        case 'configUpdate':
          setConfig(prev => ({ ...prev, [msg.key]: msg.value }));
          break;
        case 'statusMessage':
          setStatusMessage(msg.message);
          setStatusIsError(msg.isError);
          break;
        case 'switchTab':
          setTab(msg.tab);
          break;
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'init' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const postGenerate = useCallback(() => {
    if (!activeMd) return;
    setSubmitting(true);
    setStatusMessage('');
    vscode.postMessage({ type: 'generate', filePath: activeMd.filePath });
  }, [activeMd]);

  const postPreview = useCallback(() => {
    if (!activeMd) return;
    vscode.postMessage({ type: 'previewRequest', filePath: activeMd.filePath });
  }, [activeMd]);

  return (
    <Tabs.Root value={tab} onValueChange={setTab} style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Tabs.List className="tab-bar">
        <Tabs.Trigger value="workbench" className={`tab-btn ${tab === 'workbench' ? 'active' : ''}`}>
          工作台
        </Tabs.Trigger>
        <Tabs.Trigger value="tasks" className={`tab-btn ${tab === 'tasks' ? 'active' : ''}`}>
          任务
        </Tabs.Trigger>
        <Tabs.Trigger value="settings" className={`tab-btn ${tab === 'settings' ? 'active' : ''}`}>
          设置
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="workbench" className="tab-content">
        <WorkbenchTab
          config={config}
          activeMd={activeMd}
          mediaFolders={mediaFolders}
          autoMediaFolders={autoMediaFolders}
          statusMessage={statusMessage}
          statusIsError={statusIsError}
          submitting={submitting}
          onGenerate={postGenerate}
          onPreview={postPreview}
          onConfigChange={(k, v) => vscode.postMessage({ type: 'updateConfig', key: k, value: v })}
        />
      </Tabs.Content>

      <Tabs.Content value="tasks" className="tab-content">
        <TasksTab config={config} tasks={tasks} history={history} />
      </Tabs.Content>

      <Tabs.Content value="settings" className="tab-content">
        <SettingsTab
          config={config}
          onConfigChange={(k, v) => vscode.postMessage({ type: 'updateConfig', key: k, value: v })}
          onAddMediaFolder={() => vscode.postMessage({ type: 'addMediaFolder' })}
          onRemoveMediaFolder={(p) => vscode.postMessage({ type: 'removeMediaFolder', path: p })}
          mediaFolders={mediaFolders}
          onOpenUrl={(url) => vscode.postMessage({ type: 'openUrl', url })}
        />
      </Tabs.Content>
    </Tabs.Root>
  );
}

// ---- 工作台标签页 ----

function WorkbenchTab({
  config, activeMd, mediaFolders, autoMediaFolders,
  statusMessage, statusIsError, submitting,
  onGenerate, onPreview, onConfigChange,
}: {
  config: AppConfig;
  activeMd: ActiveMdInfo | null;
  mediaFolders: MediaFolder[];
  autoMediaFolders: MediaFolder[];
  statusMessage: string;
  statusIsError: boolean;
  submitting: boolean;
  onGenerate: () => void;
  onPreview: () => void;
  onConfigChange: (key: string, value: unknown) => void;
}) {
  return (
    <div>
      {/* 素材库区 */}
      {autoMediaFolders.map(mf => (
        <MediaFolderSection
          key={`auto-${mf.path}`}
          folder={mf}
          cols={config.workbenchCols}
          showRemove={false}
        />
      ))}
      {mediaFolders.map(mf => (
        <MediaFolderSection
          key={`manual-${mf.path}`}
          folder={mf}
          cols={config.workbenchCols}
          showRemove={false}
        />
      ))}

      {/* 生成控件 */}
      <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <div className="workbench-controls">
          <label>
            模型
            <select value={config.model} onChange={e => onConfigChange('model', e.target.value)}>
              <option value="nano-banana-2">nano-banana-2</option>
              <option value="nano-banana-pro">nano-banana-pro</option>
              <option value="gpt-image-2">gpt-image-2</option>
              <option value="gpt-image-2-vip">gpt-image-2-vip</option>
            </select>
          </label>
          <label>
            分辨率
            <select value={config.imageSize} onChange={e => onConfigChange('imageSize', e.target.value)}>
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>
          <label>
            比例
            <select value={config.aspectRatio} onChange={e => onConfigChange('aspectRatio', e.target.value)}>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </label>
          <label>
            并发
            <div className="stepper">
              <button onClick={() => config.concurrency > 1 && onConfigChange('concurrency', config.concurrency - 1)}>-</button>
              <input type="text" readOnly value={config.concurrency} />
              <button onClick={() => config.concurrency < 10 && onConfigChange('concurrency', config.concurrency + 1)}>+</button>
            </div>
          </label>
        </div>

        <div className="generate-row">
          <span className="md-name">{activeMd ? activeMd.fileName : '未打开 Markdown 文件'}</span>
          <button className="secondary" onClick={onPreview} disabled={!activeMd}>
            预览请求
          </button>
          <button onClick={onGenerate} disabled={!activeMd || submitting}>
            {submitting ? '生成中…' : '生成'}
          </button>
        </div>

        <div className={`status-line ${statusIsError ? 'error' : 'ok'}`}>
          {statusMessage || ''}
        </div>
      </div>
    </div>
  );
}

// ---- 素材库展示 ----

function MediaFolderSection({ folder, cols, showRemove, onRemove }: {
  folder: MediaFolder;
  cols: number;
  showRemove: boolean;
  onRemove?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const gridClass = `media-grid cols-${Math.max(1, Math.min(8, cols))}`;

  return (
    <div className="media-section">
      <div className="media-folder-header">
        <span className="media-section-title" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
          {expanded ? '▼' : '▶'} {folder.name} ({folder.images.length})
        </span>
        {showRemove && onRemove && (
          <button className="danger" style={{ fontSize: 10, padding: '2px 6px' }} onClick={onRemove}>
            移除
          </button>
        )}
      </div>
      {expanded && (
        <div className={gridClass}>
          {folder.images.map(img => (
            <MediaThumb key={img} imagePath={img} />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaThumb({ imagePath }: { imagePath: string }) {
  const handleClick = () => vscode.postMessage({ type: 'openImage', imagePath });
  const handleContext = (e: React.MouseEvent) => {
    e.preventDefault();
    vscode.postMessage({ type: 'insertImageRef', imagePath });
  };

  return (
    <img
      className="media-thumb"
      src={imagePath}
      onClick={handleClick}
      onContextMenu={handleContext}
      title={imagePath}
    />
  );
}

// ---- 任务标签页 ----

function TasksTab({ config, tasks, history }: {
  config: AppConfig;
  tasks: TaskInfo[];
  history: HistoryItem[];
}) {
  return (
    <div>
      {/* 进行中任务 */}
      {tasks.map(task => (
        <ActiveTaskCard key={task.folderName} task={task} cols={config.tasksCols} />
      ))}

      {/* 历史任务 */}
      {history.map(item => (
        <HistoryCard key={item.folderName} item={item} cols={config.tasksCols} />
      ))}

      {tasks.length === 0 && history.length === 0 && (
        <div className="text-muted" style={{ textAlign: 'center', padding: 20 }}>
          暂无任务
        </div>
      )}
    </div>
  );
}

function ActiveTaskCard({ task, cols }: { task: TaskInfo; cols: number }) {
  const [open, setOpen] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const update = () => setElapsed(Date.now() - task.submittedAt);
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [task.submittedAt]);

  const doneCount = task.jobs.filter(j => j.status === 'succeeded').length;
  const failCount = task.jobs.filter(j => j.status === 'failed' || j.status === 'violation').length;
  const submittingCount = task.jobs.filter(j => j.status === 'submitting').length;
  const runningCount = task.jobs.filter(j => j.status === 'running').length;
  const allImages = task.jobs.flatMap(j => j.results ?? []);

  const progress = useMemo(() => {
    if (task.jobs.length === 0) return 0;
    let total = 0;
    for (const j of task.jobs) {
      switch (j.status) {
        case 'succeeded': case 'failed': case 'violation': total += 100; break;
        case 'running': total += j.progress; break;
        case 'submitting': total += 0; break;
      }
    }
    return Math.round(total / task.jobs.length);
  }, [task.jobs]);

  const elapsedStr = useMemo(() => {
    const sec = Math.floor(elapsed / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }, [elapsed]);

  const gridClass = `task-images cols-${Math.max(1, Math.min(8, cols))}`;

  const statusText = submittingCount > 0
    ? `提交中 ${doneCount}/${task.jobs.length}`
    : `生成中 ${doneCount}/${task.jobs.length}`;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="task-card">
      <Collapsible.Trigger className="task-card-header">
        <span>
          {task.folderName}（{task.model}）· {statusText}
          {failCount > 0 && ` · 失败 ${failCount}`} · {elapsedStr}
        </span>
        <span>{open ? '▲' : '▼'}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="task-card-body">
        <Progress.Root className="progress-bar" value={progress}>
          <Progress.Indicator className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </Progress.Root>
        <div className="task-status">进度 {progress}%</div>

        {submittingCount > 0 && (
          <div className="task-status">正在提交 {submittingCount} 个请求…</div>
        )}
        {runningCount > 0 && (
          <div className="task-status">还有 {runningCount} 张正在生成…</div>
        )}

        {task.jobs.filter(j => j.error).map(j => (
          <div key={j.index} className="task-error">{j.error}</div>
        ))}

        {allImages.length > 0 && (
          <div className={gridClass}>
            {allImages.map(img => (
              <img
                key={img}
                className="media-thumb"
                src={img}
                onClick={() => vscode.postMessage({ type: 'openImage', imagePath: img })}
              />
            ))}
          </div>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function HistoryCard({ item, cols }: { item: HistoryItem; cols: number }) {
  const [open, setOpen] = useState(false);
  const gridClass = `task-images cols-${Math.max(1, Math.min(8, cols))}`;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="task-card">
      <Collapsible.Trigger className="task-card-header">
        <span>{item.folderName}（{item.imageCount} 张）</span>
        <span>{open ? '▲' : '▼'}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="task-card-body">
        <div className={gridClass}>
          {item.images.map(img => (
            <img
              key={img}
              className="media-thumb"
              src={img}
              onClick={() => vscode.postMessage({ type: 'openImage', imagePath: img })}
            />
          ))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

// ---- 设置标签页 ----

function SettingsTab({
  config, onConfigChange, onAddMediaFolder, onRemoveMediaFolder,
  mediaFolders, onOpenUrl,
}: {
  config: AppConfig;
  onConfigChange: (key: string, value: unknown) => void;
  onAddMediaFolder: () => void;
  onRemoveMediaFolder: (path: string) => void;
  mediaFolders: MediaFolder[];
  onOpenUrl: (url: string) => void;
}) {
  const [injectionModel, setInjectionModel] = useState(config.model);

  return (
    <div>
      {/* API Key */}
      <div className="settings-section">
        <div className="settings-section-title">API 配置</div>
        <div className="settings-row">
          <label>
            API Key
            <div className="flex-row">
              <input
                type="password"
                value={config.apiKey}
                onChange={e => onConfigChange('apiKey', e.target.value)}
                placeholder="sk-..."
              />
              <span className="settings-link" onClick={() => onOpenUrl('https://grsai.ai/zh/dashboard/api-keys')}>
                获取 API Key →
              </span>
            </div>
          </label>
        </div>
        <div className="settings-row">
          <label>
            节点
            <select value={config.baseUrl} onChange={e => onConfigChange('baseUrl', e.target.value)}>
              <option value="https://grsai.dakka.com.cn">国内节点</option>
              <option value="https://grsaiapi.com">全球节点</option>
            </select>
          </label>
        </div>
      </div>

      {/* 显示设置 */}
      <div className="settings-section">
        <div className="settings-section-title">显示设置</div>
        <div className="settings-row">
          <label>
            工作台素材每行张数
            <div className="stepper">
              <button onClick={() => config.workbenchCols > 1 && onConfigChange('workbenchCols', config.workbenchCols - 1)}>-</button>
              <input type="text" readOnly value={config.workbenchCols} />
              <button onClick={() => config.workbenchCols < 8 && onConfigChange('workbenchCols', config.workbenchCols + 1)}>+</button>
            </div>
          </label>
        </div>
        <div className="settings-row">
          <label>
            任务栏每行张数
            <div className="stepper">
              <button onClick={() => config.tasksCols > 1 && onConfigChange('tasksCols', config.tasksCols - 1)}>-</button>
              <input type="text" readOnly value={config.tasksCols} />
              <button onClick={() => config.tasksCols < 8 && onConfigChange('tasksCols', config.tasksCols + 1)}>+</button>
            </div>
          </label>
        </div>
      </div>

      {/* 模型注入提示词 */}
      <div className="settings-section">
        <div className="settings-section-title">模型注入提示词</div>
        <div className="settings-row">
          <label>
            模型
            <select value={injectionModel} onChange={e => setInjectionModel(e.target.value)}>
              <option value="nano-banana-2">nano-banana-2</option>
              <option value="nano-banana-pro">nano-banana-pro</option>
              <option value="gpt-image-2">gpt-image-2</option>
              <option value="gpt-image-2-vip">gpt-image-2-vip</option>
            </select>
          </label>
        </div>
        <div className="settings-row">
          <label>
            注入句
            <textarea
              value={config.modelInjections[injectionModel] ?? ''}
              onChange={e => {
                const updated = { ...config.modelInjections, [injectionModel]: e.target.value };
                onConfigChange('modelInjections', updated);
              }}
              placeholder="输入该模型的注入提示词…"
            />
          </label>
        </div>
      </div>

      {/* 手动素材库 */}
      <div className="settings-section">
        <div className="settings-section-title">
          手动素材库
          <button onClick={onAddMediaFolder} style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px' }}>+ 添加</button>
        </div>
        {mediaFolders.map(mf => (
          <MediaFolderSection
            key={mf.path}
            folder={mf}
            cols={config.workbenchCols}
            showRemove={true}
            onRemove={() => onRemoveMediaFolder(mf.path)}
          />
        ))}
        {mediaFolders.length === 0 && (
          <div className="text-muted">尚未添加素材库</div>
        )}
      </div>
    </div>
  );
}

// ---- 入口 ----
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
