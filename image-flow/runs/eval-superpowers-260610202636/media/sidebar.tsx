// image-flow 侧栏 Webview React 应用
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import type { ImageFlowConfig, Task, HistoryEntry, AssetFolder, FrontendMessage, BackendMessage, Job } from '../src/shared';

// ============ vscode API ============
const vscode = acquireVsCodeApi();
const prevState = vscode.getState() as { activeTab?: string } | undefined;

function postMsg(msg: FrontendMessage): void {
  vscode.postMessage(msg);
}

// ============ App Hook ============

interface AppState {
  config: ImageFlowConfig;
  activeMdPath: string;
  tasks: Task[];
  history: HistoryEntry[];
  assetFolders: AssetFolder[];
  statusMessage: string;
  statusLevel: 'info' | 'error' | 'warning';
  activeTab: string;
}

function useAppState() {
  const [state, setState] = useState<AppState>({
    config: {
      apiKey: '',
      baseUrl: 'https://grsai.dakka.com.cn',
      model: 'nano-banana-2',
      aspectRatio: '3:4',
      imageSize: '1K',
      concurrency: 1,
      workbenchCols: 4,
      tasksCols: 2,
      modelInjections: {},
    },
    activeMdPath: '',
    tasks: [],
    history: [],
    assetFolders: [],
    statusMessage: '',
    statusLevel: 'info',
    activeTab: prevState?.activeTab ?? 'workbench',
  });

  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const handler = (ev: MessageEvent<BackendMessage>) => {
      const msg = ev.data;
      switch (msg.type) {
        case 'initResponse':
          setState(s => ({ ...s, config: msg.config, activeMdPath: msg.activeMdPath, tasks: msg.tasks, history: msg.history, assetFolders: msg.assetFolders }));
          break;
        case 'configUpdated':
          setState(s => ({ ...s, config: msg.config }));
          break;
        case 'tasksUpdated':
          setState(s => ({ ...s, tasks: msg.tasks }));
          checkGenerating(msg.tasks);
          break;
        case 'historyUpdated':
          setState(s => ({ ...s, history: msg.history }));
          break;
        case 'assetFoldersUpdated':
          setState(s => ({ ...s, assetFolders: msg.assetFolders }));
          break;
        case 'activeMdChanged':
          setState(s => ({ ...s, activeMdPath: msg.mdPath }));
          break;
        case 'statusMessage':
          setState(s => ({ ...s, statusMessage: msg.message, statusLevel: msg.level }));
          if (msg.level !== 'info') {
            setTimeout(() => setState(s => ({ ...s, statusMessage: '' })), 5000);
          }
          break;
        case 'error':
          setState(s => ({ ...s, statusMessage: msg.message, statusLevel: 'warning' }));
          break;
      }
    };
    window.addEventListener('message', handler);
    postMsg({ type: 'init' });
    return () => window.removeEventListener('message', handler);
  }, []);

  function checkGenerating(tasks: Task[]) {
    const hasActive = tasks.some(t => !t.finished);
    setGenerating(hasActive);
  }

  const setTab = useCallback((tab: string) => {
    setState(s => ({ ...s, activeTab: tab }));
    vscode.setState({ activeTab: tab });
  }, []);

  return { state, setState, generating, setGenerating, setTab };
}

// ============ Utils ============

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function calcProgress(jobs: Job[]): number {
  if (jobs.length === 0) { return 0; }
  let total = 0;
  for (const j of jobs) {
    if (j.status === 'succeeded' || j.status === 'failed' || j.status === 'violation') {
      total += 100;
    } else if (j.status === 'running') {
      total += j.progress;
    }
    // submitting → 0
  }
  return Math.round(total / jobs.length);
}

function getMdFileName(mdPath: string): string {
  if (!mdPath) { return '未打开 Markdown 文件'; }
  const parts = mdPath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || mdPath;
}

// ============ Tab Button (simple, no Radix tabs needed) ============

const TabButton: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({ active, label, onClick }) => (
  <button className={`tab-btn ${active ? 'active' : ''}`} onClick={onClick}>
    {label}
  </button>
);

// ============ Workbench Tab ============

const WorkbenchTab: React.FC<{
  config: ImageFlowConfig;
  activeMdPath: string;
  assetFolders: AssetFolder[];
  generating: boolean;
  statusMessage: string;
  statusLevel: string;
  onSetConfig: (key: string, value: unknown) => void;
  onGenerate: () => void;
  onPreview: () => void;
  onInsertRef: (imagePath: string) => void;
  onOpenImage: (imagePath: string) => void;
}> = ({ config, activeMdPath, assetFolders, generating, statusMessage, statusLevel, onSetConfig, onGenerate, onPreview, onInsertRef, onOpenImage }) => {
  const [assetContextMenu, setAssetContextMenu] = useState<{ x: number; y: number; imagePath: string } | null>(null);

  const handleAssetContextMenu = (e: React.MouseEvent, imagePath: string) => {
    e.preventDefault();
    setAssetContextMenu({ x: e.clientX, y: e.clientY, imagePath });
  };

  useEffect(() => {
    const close = () => setAssetContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  return (
    <div className="tab-content workbench-tab">
      {/* 素材库区 */}
      <div className="asset-section">
        {assetFolders.map((folder, fi) => (
          <div key={fi} className="asset-folder">
            <div className="asset-folder-header">
              <span className="asset-folder-name">{folder.name}</span>
              <span className="asset-folder-count">{folder.images.length} 张</span>
              {!folder.auto && (
                <button className="icon-btn" onClick={() => postMsg({ type: 'removeAssetFolder', folderPath: folder.path })} title="移除">×</button>
              )}
            </div>
            <div className="asset-grid" style={{ gridTemplateColumns: `repeat(${config.workbenchCols}, 1fr)` }}>
              {folder.images.slice(0, 50).map((img, ii) => (
                <div
                  key={ii}
                  className="asset-thumb"
                  onClick={() => onOpenImage(img)}
                  onContextMenu={(e) => handleAssetContextMenu(e, img)}
                >
                  <img src={img} alt="" />
                </div>
              ))}
            </div>
          </div>
        ))}
        <button className="add-folder-btn" onClick={() => postMsg({ type: 'addAssetFolder' })}>+ 添加素材库</button>
      </div>

      {/* 底部停靠区 */}
      <div className="workbench-controls">
        <div className="controls-row">
          <div className="control-item">
            <label>模型</label>
            <select value={config.model} onChange={e => onSetConfig('model', e.target.value)}>
              <option value="nano-banana-2">nano-banana-2</option>
              <option value="nano-banana-pro">nano-banana-pro</option>
              <option value="gpt-image-2">gpt-image-2</option>
              <option value="gpt-image-2-vip">gpt-image-2-vip</option>
            </select>
          </div>
          <div className="control-item">
            <label>分辨率</label>
            <select value={config.imageSize} onChange={e => onSetConfig('imageSize', e.target.value)}>
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </div>
          <div className="control-item">
            <label>比例</label>
            <select value={config.aspectRatio} onChange={e => onSetConfig('aspectRatio', e.target.value)}>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>
          <div className="control-item">
            <label>并发</label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.concurrency}
              onChange={e => onSetConfig('concurrency', Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
              className="number-input"
            />
          </div>
        </div>

        <div className="generate-row">
          <span className="md-filename" title={activeMdPath}>{getMdFileName(activeMdPath)}</span>
          <button className="btn btn-secondary" onClick={onPreview}>预览请求</button>
          <button className="btn btn-primary" onClick={onGenerate} disabled={generating || !activeMdPath}>
            {generating ? '生成中…' : '生成'}
          </button>
        </div>

        <div className={`status-line ${statusLevel === 'error' ? 'error' : statusLevel === 'warning' ? 'warning' : ''}`}>
          {statusMessage}
        </div>
      </div>

      {/* 右键菜单 */}
      {assetContextMenu && (
        <div className="context-menu" style={{ left: assetContextMenu.x, top: assetContextMenu.y }}>
          <button onClick={() => { onInsertRef(assetContextMenu.imagePath); setAssetContextMenu(null); }}>
            插入引用到生效 MD
          </button>
        </div>
      )}
    </div>
  );
};

// ============ Tasks Tab ============

const TasksTab: React.FC<{
  tasks: Task[];
  history: HistoryEntry[];
  tasksCols: number;
  onOpenImage: (imagePath: string) => void;
}> = ({ tasks, history, tasksCols, onOpenImage }) => {
  // 合并列表：进行中在前，历史在后
  const merged = useMemo(() => {
    const activeCards = tasks.filter(t => !t.finished).map(t => ({ type: 'active' as const, task: t }));
    const historyCards = history.map(h => ({ type: 'history' as const, entry: h }));
    return [...activeCards, ...historyCards];
  }, [tasks, history]);

  if (merged.length === 0) {
    return <div className="tab-content tasks-tab"><p className="empty-hint">暂无任务</p></div>;
  }

  return (
    <div className="tab-content tasks-tab">
      {merged.map((item) => {
        if (item.type === 'active') {
          return <ActiveTaskCard key={`task-${item.task.folder}`} task={item.task} tasksCols={tasksCols} onOpenImage={onOpenImage} />;
        }
        return <HistoryCard key={`hist-${item.entry.folder}`} entry={item.entry} tasksCols={tasksCols} onOpenImage={onOpenImage} />;
      })}
    </div>
  );
};

const ActiveTaskCard: React.FC<{ task: Task; tasksCols: number; onOpenImage: (path: string) => void }> = ({ task, tasksCols, onOpenImage }) => {
  const [expanded, setExpanded] = useState(true);
  const [elapsed, setElapsed] = useState('');

  const doneJobs = task.jobs.filter(j => j.status === 'succeeded' || j.status === 'failed' || j.status === 'violation').length;
  const runningCount = task.jobs.filter(j => j.status === 'running').length;
  const submittingCount = task.jobs.filter(j => j.status === 'submitting').length;
  const failedCount = task.jobs.filter(j => j.status === 'failed' || j.status === 'violation').length;

  const progress = calcProgress(task.jobs);

  useEffect(() => {
    const update = () => {
      const ms = Date.now() - new Date(task.startedAt).getTime();
      setElapsed(formatDuration(ms));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [task.startedAt]);

  let statusText: string;
  if (submittingCount > 0) {
    statusText = `提交中 ${doneJobs}/${task.jobs.length}`;
  } else {
    statusText = `生成中 ${doneJobs}/${task.jobs.length}`;
  }
  if (failedCount > 0) {
    statusText += ` · 失败 ${failedCount}`;
  }
  statusText += ` · ${elapsed}`;

  const allImages = task.jobs.flatMap(j => j.downloadedImages);
  const errors = task.jobs.filter(j => j.error).map(j => j.error);

  return (
    <div className={`task-card active`}>
      <div className="task-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="collapse-icon">{expanded ? '▼' : '▶'}</span>
        <span className="task-title">{task.folder}（{task.model}）· {statusText}</span>
      </div>
      {expanded && (
        <div className="task-card-body">
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
            <span className="progress-text">{progress}%</span>
          </div>
          {submittingCount > 0 && (
            <p className="task-hint">正在提交 {submittingCount} 个请求…</p>
          )}
          {runningCount > 0 && (
            <p className="task-hint">还有 {runningCount} 张正在生成…</p>
          )}
          {errors.length > 0 && (
            <div className="task-errors">
              {[...new Set(errors)].map((e, i) => <p key={i} className="error-text">{e}</p>)}
            </div>
          )}
          {allImages.length > 0 && (
            <div className="task-images-grid" style={{ gridTemplateColumns: `repeat(${tasksCols}, 1fr)` }}>
              {allImages.map((img, i) => (
                <div key={i} className="task-thumb" onClick={() => onOpenImage(img)}>
                  <img src={img} alt="" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const HistoryCard: React.FC<{ entry: HistoryEntry; tasksCols: number; onOpenImage: (path: string) => void }> = ({ entry, tasksCols, onOpenImage }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="task-card history">
      <div className="task-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="collapse-icon">{expanded ? '▼' : '▶'}</span>
        <span className="task-title">{entry.folder}（{entry.imageCount} 张）</span>
      </div>
      {expanded && (
        <div className="task-card-body">
          <div className="task-images-grid" style={{ gridTemplateColumns: `repeat(${tasksCols}, 1fr)` }}>
            {entry.images.map((img, i) => (
              <div key={i} className="task-thumb" onClick={() => onOpenImage(img)}>
                <img src={img} alt="" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============ Settings Tab ============

const SettingsTab: React.FC<{
  config: ImageFlowConfig;
  onSetConfig: (key: string, value: unknown) => void;
  onSetApiKey: (key: string) => void;
  onSetModelInjection: (model: string, injection: string) => void;
}> = ({ config, onSetConfig, onSetApiKey, onSetModelInjection }) => {
  const [injectionModel, setInjectionModel] = useState(config.model);

  const openApiKeyUrl = () => {
    postMsg({ type: 'openUrl', url: 'https://grsai.ai/zh/dashboard/api-keys' } as unknown as FrontendMessage);
  };

  return (
    <div className="tab-content settings-tab">
      <div className="setting-item">
        <label>API Key</label>
        <div className="setting-row">
          <input
            type="password"
            value={config.apiKey}
            onChange={e => onSetApiKey(e.target.value)}
            placeholder="sk-..."
            className="text-input"
          />
          <button className="btn btn-link" onClick={openApiKeyUrl}>获取 API Key →</button>
        </div>
      </div>

      <div className="setting-item">
        <label>节点</label>
        <select value={config.baseUrl} onChange={e => onSetConfig('baseUrl', e.target.value)}>
          <option value="https://grsai.dakka.com.cn">国内节点</option>
          <option value="https://grsaiapi.com">全球节点</option>
        </select>
      </div>

      <div className="setting-item">
        <label>工作台每行张数</label>
        <input
          type="number"
          min={1}
          max={8}
          value={config.workbenchCols}
          onChange={e => onSetConfig('workbenchCols', Math.min(8, Math.max(1, parseInt(e.target.value) || 1)))}
          className="number-input"
        />
      </div>

      <div className="setting-item">
        <label>任务栏每行张数</label>
        <input
          type="number"
          min={1}
          max={8}
          value={config.tasksCols}
          onChange={e => onSetConfig('tasksCols', Math.min(8, Math.max(1, parseInt(e.target.value) || 1)))}
          className="number-input"
        />
      </div>

      <div className="setting-item">
        <label>模型注入提示词</label>
        <select value={injectionModel} onChange={e => setInjectionModel(e.target.value)} className="mb-small">
          <option value="nano-banana-2">nano-banana-2</option>
          <option value="nano-banana-pro">nano-banana-pro</option>
          <option value="gpt-image-2">gpt-image-2</option>
          <option value="gpt-image-2-vip">gpt-image-2-vip</option>
        </select>
        <textarea
          value={config.modelInjections[injectionModel] ?? ''}
          onChange={e => onSetModelInjection(injectionModel, e.target.value)}
          rows={3}
          placeholder="该模型的注入提示词（留空为不注入）"
          className="text-input"
        />
      </div>
    </div>
  );
};

// ============ App Root ============

const App: React.FC = () => {
  const { state, generating, setTab } = useAppState();
  const { config, activeMdPath, tasks, history, assetFolders, statusMessage, statusLevel, activeTab } = state;

  const handleSetConfig = useCallback((key: string, value: unknown) => {
    postMsg({ type: 'setConfig', key, value });
  }, []);

  const handleSetApiKey = useCallback((apiKey: string) => {
    postMsg({ type: 'setApiKey', apiKey });
  }, []);

  const handleGenerate = useCallback(() => {
    if (!activeMdPath) { return; }
    postMsg({ type: 'generate', mdPath: activeMdPath });
  }, [activeMdPath]);

  const handlePreview = useCallback(() => {
    if (!activeMdPath) { return; }
    postMsg({ type: 'previewRequest', mdPath: activeMdPath });
  }, [activeMdPath]);

  const handleInsertRef = useCallback((imagePath: string) => {
    postMsg({ type: 'insertAssetRef', imagePath });
  }, []);

  const handleOpenImage = useCallback((imagePath: string) => {
    postMsg({ type: 'openImage', imagePath });
  }, []);

  const handleSetModelInjection = useCallback((model: string, injection: string) => {
    postMsg({ type: 'setModelInjection', model, injection });
  }, []);

  return (
    <div className="app">
      <div className="tab-bar">
        <TabButton active={activeTab === 'workbench'} label="工作台" onClick={() => setTab('workbench')} />
        <TabButton active={activeTab === 'tasks'} label="任务" onClick={() => setTab('tasks')} />
        <TabButton active={activeTab === 'settings'} label="设置" onClick={() => setTab('settings')} />
      </div>

      {activeTab === 'workbench' && (
        <WorkbenchTab
          config={config}
          activeMdPath={activeMdPath}
          assetFolders={assetFolders}
          generating={generating}
          statusMessage={statusMessage}
          statusLevel={statusLevel}
          onSetConfig={handleSetConfig}
          onGenerate={handleGenerate}
          onPreview={handlePreview}
          onInsertRef={handleInsertRef}
          onOpenImage={handleOpenImage}
        />
      )}

      {activeTab === 'tasks' && (
        <TasksTab
          tasks={tasks}
          history={history}
          tasksCols={config.tasksCols}
          onOpenImage={handleOpenImage}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsTab
          config={config}
          onSetConfig={handleSetConfig}
          onSetApiKey={handleSetApiKey}
          onSetModelInjection={handleSetModelInjection}
        />
      )}
    </div>
  );
};

// Mount
const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
