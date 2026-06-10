/**
 * 侧栏 Webview React 应用 — 工作台 / 任务 / 设置 三个标签页。
 */

import { createRoot } from 'react-dom/client';
import { useState, useEffect } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Select from '@radix-ui/react-select';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as Progress from '@radix-ui/react-progress';
import type { ExtensionConfig, ExtensionMessage, WebviewMessage, TaskInfo, HistoryInfo } from '../src/shared';

/* ─── VS Code API ──────────────────────────────────── */

const vs = acquireVsCodeApi();
const savedState = vs.getState() as { tab?: string } | undefined;

/* ─── 默认配置 ──────────────────────────────────────── */

const DEFAULT_CONFIG: ExtensionConfig = {
  baseUrl: 'https://grsai.dakka.com.cn',
  model: 'nano-banana-2',
  aspectRatio: '3:4',
  imageSize: '1K',
  concurrency: 1,
  workbenchCols: 4,
  tasksCols: 2,
  modelInjections: {},
  hasApiKey: false,
};

/* ─── App 根组件 ────────────────────────────────────── */

function App() {
  const [tab, setTab] = useState(savedState?.tab ?? 'workbench');
  const [config, setConfig] = useState<ExtensionConfig>(DEFAULT_CONFIG);
  const [activeMd, setActiveMd] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError: boolean }>({ text: '', isError: false });
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [history, setHistory] = useState<HistoryInfo[]>([]);

  // 持久化当前 tab
  useEffect(() => { vs.setState({ ...(vs.getState() ?? {}), tab }); }, [tab]);

  // 消息监听
  useEffect(() => {
    const handler = (e: MessageEvent<ExtensionMessage>): void => {
      const msg = e.data;
      switch (msg.type) {
        case 'config':
          setConfig(msg.data);
          break;
        case 'activeMd':
          setActiveMd(msg.path);
          break;
        case 'statusMessage':
          setStatusMsg({ text: msg.text, isError: msg.isError });
          break;
        case 'tasks':
          setTasks(msg.data);
          break;
        case 'history':
          setHistory(msg.data);
          break;
        case 'taskUpdate':
          setTasks(prev => prev.map(t => t.taskId === msg.data.taskId ? msg.data : t));
          break;
        case 'taskDone':
          setTasks(prev => prev.filter(t => t.taskId !== msg.taskId));
          break;
      }
    };
    window.addEventListener('message', handler);
    // 初始化握手
    postMsg({ type: 'init' });
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <Tabs.Root className="app" value={tab} onValueChange={setTab}>
      <Tabs.List className="tab-list">
        <Tabs.Trigger className="tab-trigger" value="workbench">工作台</Tabs.Trigger>
        <Tabs.Trigger className="tab-trigger" value="tasks">任务</Tabs.Trigger>
        <Tabs.Trigger className="tab-trigger" value="settings">设置</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content className="tab-content" value="workbench">
        <Workbench config={config} activeMd={activeMd} statusMsg={statusMsg} />
      </Tabs.Content>

      <Tabs.Content className="tab-content" value="tasks">
        <TasksTab tasks={tasks} history={history} tasksCols={config.tasksCols} />
      </Tabs.Content>

      <Tabs.Content className="tab-content" value="settings">
        <SettingsTab config={config} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

/* ─── 工作台 ────────────────────────────────────────── */

function Workbench({ config, activeMd, statusMsg }: {
  config: ExtensionConfig;
  activeMd: string;
  statusMsg: { text: string; isError: boolean };
}) {
  const [generating, setGenerating] = useState(false);

  const mdDisplay = activeMd
    ? activeMd.split(/[/\\]/).pop() ?? activeMd
    : '未打开 Markdown 文件';

  const handleGenerate = (): void => {
    if (!activeMd) return;
    setGenerating(true);
    postMsg({ type: 'generate' });
    setTimeout(() => setGenerating(false), 2000);
  };

  return (
    <div className="workbench">
      <div className="section">
        <h3 className="section-title">当前路径素材库</h3>
        <p className="muted">无素材库目录</p>
      </div>

      <div className="dock">
        <div className="control-row">
          <label className="control-label">模型</label>
          <ModelSelect value={config.model} onChange={v => updateField('model', v)} />
        </div>
        <div className="control-row">
          <label className="control-label">分辨率</label>
          <SelectBox
            value={config.imageSize}
            options={['1K', '2K', '4K']}
            onChange={v => updateField('imageSize', v)}
          />
        </div>
        <div className="control-row">
          <label className="control-label">比例</label>
          <SelectBox
            value={config.aspectRatio}
            options={['1:1', '3:4', '4:3', '16:9', '9:16']}
            onChange={v => updateField('aspectRatio', v)}
          />
        </div>
        <div className="control-row">
          <label className="control-label">并发</label>
          <Stepper
            value={config.concurrency}
            min={1}
            max={10}
            onChange={v => updateField('concurrency', v)}
          />
        </div>

        <div className="action-row">
          <span className="md-name">{mdDisplay}</span>
          <button className="btn btn-secondary" onClick={() => postMsg({ type: 'previewRequest' })} disabled={!activeMd}>
            预览请求
          </button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={!activeMd || generating}>
            {generating ? '生成中…' : '生成'}
          </button>
        </div>

        {statusMsg.text && (
          <div className={`status-line ${statusMsg.isError ? 'error' : ''}`}>
            {statusMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── 任务页 ────────────────────────────────────────── */

function TasksTab({ tasks, history, tasksCols }: {
  tasks: TaskInfo[];
  history: HistoryInfo[];
  tasksCols: number;
}) {
  return (
    <div className="tasks-tab">
      {tasks.length === 0 && history.length === 0 && (
        <p className="muted">暂无任务</p>
      )}

      {tasks.map(t => (
        <TaskCard key={t.taskId} task={t} />
      ))}

      {history.map(h => (
        <HistoryCard key={h.folderName} info={h} cols={tasksCols} />
      ))}
    </div>
  );
}

function TaskCard({ task }: { task: TaskInfo }) {
  const [open, setOpen] = useState(true);
  const doneCount = task.jobs.filter(j => j.status === 'succeeded').length;
  const failCount = task.jobs.filter(j => j.status === 'failed' || j.status === 'violation').length;
  const total = task.jobs.length;
  const aggProgress = total > 0
    ? Math.round(task.jobs.reduce((sum, j) => {
      if (j.status === 'succeeded') return sum + 100;
      if (j.status === 'running') return sum + j.progress;
      return sum;
    }, 0) / total)
    : 0;
  const submitting = task.jobs.filter(j => j.status === 'submitting').length;
  const stillRunning = task.jobs.filter(j => j.status === 'running').length;

  const title = `${task.folderName}（${task.model}）· ${
    submitting > 0 ? `提交中 ${doneCount}/${total}` : `生成中 ${doneCount}/${total}`
  }${failCount > 0 ? ` · 失败 ${failCount}` : ''}`;

  return (
    <Collapsible.Root className="task-card" open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="task-card-header">
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="task-card-body">
        <Progress.Root className="progress-root" value={aggProgress}>
          <Progress.Indicator className="progress-indicator" style={{ width: `${aggProgress}%` }} />
        </Progress.Root>
        <p className="progress-text">{aggProgress}%</p>
        {submitting > 0 && <p>正在提交 {submitting} 个请求…</p>}
        {stillRunning > 0 && <p>还有 {stillRunning} 张正在生成…</p>}
        {task.jobs.filter(j => j.error).map(j => (
          <p key={j.id ?? j.status} className="error">{(j.id ? `[${j.id}] ` : '') + j.error}</p>
        ))}
        <div className="thumb-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(80px, 1fr))` }}>
          {task.jobs.flatMap(j => j.imageUris.map((uri, i) => (
            <img key={`${j.id ?? 'local'}-${i}`} className="thumb" src={uri}
              onClick={() => postMsg({ type: 'openFile', path: j.imagePaths[i] })} />
          )))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function HistoryCard({ info, cols }: { info: HistoryInfo; cols: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root className="history-card" open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="history-card-header">
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span>{info.folderName}（{info.imageCount} 张）</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="task-card-body">
        <div className="thumb-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {info.imageUris.map((uri, i) => (
            <img key={i} className="thumb" src={uri}
              onClick={() => postMsg({ type: 'openFile', path: info.imagePaths[i] })} />
          ))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/* ─── 设置页 ────────────────────────────────────────── */

function SettingsTab({ config }: { config: ExtensionConfig }) {
  const [apiKeyValue, setApiKeyValue] = useState(config.hasApiKey ? '••••••••' : '');
  const [injectionModel, setInjectionModel] = useState(config.model);
  const [injectionText, setInjectionText] = useState(
    config.modelInjections[injectionModel] ?? '',
  );

  // 首次拿到真实 apiKey 状态设置初始值
  useEffect(() => {
    if (!config.hasApiKey) setApiKeyValue('');
  }, [config.hasApiKey]);

  const handleApiKey = (): void => {
    const newVal = apiKeyValue;
    if (newVal && newVal !== '••••••••') {
      postMsg({ type: 'setApiKey', value: newVal });
    }
  };

  const handleInjectionSave = (): void => {
    const updated = { ...config.modelInjections, [injectionModel]: injectionText };
    postMsg({ type: 'updateConfig', data: { modelInjections: updated } });
  };

  return (
    <div className="settings-tab">
      <div className="setting-group">
        <label className="setting-label">API Key</label>
        <div className="setting-row">
          <input type="password" className="input" value={apiKeyValue}
            onChange={e => setApiKeyValue(e.target.value)}
            onBlur={handleApiKey}
            placeholder="sk-…" />
          <button className="btn btn-link" onClick={() =>
            postMsg({ type: 'openExternal', url: 'https://grsai.ai/zh/dashboard/api-keys' })
          }>获取 API Key →</button>
        </div>
      </div>

      <div className="setting-group">
        <label className="setting-label">节点</label>
        <SelectBox
          value={config.baseUrl}
          options={[
            { label: '国内', value: 'https://grsai.dakka.com.cn' },
            { label: '全球', value: 'https://grsaiapi.com' },
          ]}
          onChange={v => updateField('baseUrl', v)}
        />
      </div>

      <div className="setting-group">
        <label className="setting-label">工作台每行张数</label>
        <Stepper value={config.workbenchCols} min={1} max={8}
          onChange={v => updateField('workbenchCols', v)} />
      </div>

      <div className="setting-group">
        <label className="setting-label">任务栏每行张数</label>
        <Stepper value={config.tasksCols} min={1} max={8}
          onChange={v => updateField('tasksCols', v)} />
      </div>

      <div className="setting-group">
        <label className="setting-label">模型注入提示词</label>
        <ModelSelect value={injectionModel}
          onChange={v => {
            setInjectionModel(v);
            setInjectionText(config.modelInjections[v] ?? '');
          }} />
        <textarea className="textarea" rows={4} value={injectionText}
          onChange={e => setInjectionText(e.target.value)}
          onBlur={handleInjectionSave}
          placeholder="该模型无注入句…" />
      </div>
    </div>
  );
}

/* ─── 通用组件 ──────────────────────────────────────── */

function ModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <SelectBox
      value={value}
      options={[
        { label: 'nano-banana-2', value: 'nano-banana-2' },
        { label: 'nano-banana-pro', value: 'nano-banana-pro' },
        { label: 'gpt-image-2', value: 'gpt-image-2' },
        { label: 'gpt-image-2-vip', value: 'gpt-image-2-vip' },
      ]}
      onChange={onChange}
    />
  );
}

function SelectBox({ value, options, onChange }: {
  value: string;
  options: string[] | Array<{ label: string; value: string }>;
  onChange: (v: string) => void;
}) {
  const items: Array<{ label: string; value: string }> = typeof options[0] === 'string'
    ? (options as string[]).map(o => ({ label: o, value: o }))
    : options as Array<{ label: string; value: string }>;

  const currentLabel = items.find(o => o.value === value)?.label ?? value;

  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className="select-trigger">
        <Select.Value>{currentLabel}</Select.Value>
        <Select.Icon className="select-icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-content" position="popper" side="bottom" align="start"
          style={{ zIndex: 9999 }}>
          <Select.Viewport>
            {items.map(item => (
              <Select.Item key={item.value} value={item.value} className="select-item">
                <Select.ItemText>{item.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function Stepper({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div className="stepper">
      <button className="stepper-btn" disabled={value <= min}
        onClick={() => onChange(value - 1)}>−</button>
      <span className="stepper-value">{value}</span>
      <button className="stepper-btn" disabled={value >= max}
        onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

/* ─── 工具 ──────────────────────────────────────────── */

function postMsg(msg: WebviewMessage): void {
  vs.postMessage(msg);
}

function updateField<K extends keyof ExtensionConfig>(key: K, value: ExtensionConfig[K]): void {
  postMsg({ type: 'updateConfig', data: { [key]: value } });
}

/* ─── 挂载 ──────────────────────────────────────────── */

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
