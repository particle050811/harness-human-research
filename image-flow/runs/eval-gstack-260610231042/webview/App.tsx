import React from 'react';
import { VSCodeApi, useVSCodeApi } from './hooks';
import { InitPayload, ExtensionEvent } from '../src/shared';
import Workbench from './Workbench';
import Tasks from './Tasks';
import Settings from './Settings';

// ========== 全局状态形状 ==========

export interface AppState {
  // 配置（不含 apiKey 值）
  config: InitPayload['config'];
  activeMdPath: string;
  activeMdName: string;
  tasks: InitPayload['tasks'];
  history: InitPayload['history'];
  materials: InitPayload['materials'];
  autoMaterials: InitPayload['autoMaterials'];
  statusText: string;
  statusError: boolean;
  activeTab: string;
}

// ========== Context 用于跨组件通信 ==========

export interface AppContext {
  vscode: VSCodeApi;
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}

export const AppCtx = React.createContext<AppContext>(null!);

// ========== App 组件 ==========

export default function App(): React.ReactElement {
  const vscode = useVSCodeApi();

  const [state, setState] = React.useState<AppState>({
    config: {
      baseUrl: 'https://grsai.dakka.com.cn',
      model: 'nano-banana-2',
      aspectRatio: '3:4',
      imageSize: '1K',
      concurrency: 1,
      workbenchCols: 4,
      tasksCols: 2,
      modelInjections: {},
      apiKey: false,
    },
    activeMdPath: '',
    activeMdName: '',
    tasks: [],
    history: [],
    materials: [],
    autoMaterials: [],
    statusText: '',
    statusError: false,
    activeTab: 'workbench',
  });

  // 监听来自扩展的消息
  React.useEffect(() => {
    const handler = (e: MessageEvent<ExtensionEvent>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'init':
          setState(prev => ({
            ...prev,
            config: msg.payload.config,
            activeMdPath: msg.payload.activeMdPath,
            activeMdName: msg.payload.activeMdName,
            tasks: msg.payload.tasks,
            history: msg.payload.history,
            materials: msg.payload.materials,
            autoMaterials: msg.payload.autoMaterials,
          }));
          break;
        case 'configUpdate':
          setState(prev => ({
            ...prev,
            config: { ...prev.config, [msg.key]: msg.value },
          }));
          break;
        case 'taskUpdate':
          setState(prev => ({
            ...prev,
            tasks: msg.tasks,
            history: msg.history,
          }));
          break;
        case 'materialUpdate':
          setState(prev => ({
            ...prev,
            materials: msg.materials,
            autoMaterials: msg.autoMaterials,
          }));
          break;
        case 'activeMdUpdate':
          setState(prev => ({
            ...prev,
            activeMdPath: msg.path,
            activeMdName: msg.name,
          }));
          break;
        case 'statusMessage':
          setState(prev => ({
            ...prev,
            statusText: msg.text,
            statusError: msg.isError,
          }));
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // 初始化时发 init 消息
  React.useEffect(() => {
    vscode.postMessage({ type: 'init' });
  }, [vscode]);

  const ctx: AppContext = { vscode, state, setState };

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <nav className="tab-bar">
          <button
            className={`tab-btn ${state.activeTab === 'workbench' ? 'active' : ''}`}
            onClick={() => setState(prev => ({ ...prev, activeTab: 'workbench' }))}
          >
            工作台
          </button>
          <button
            className={`tab-btn ${state.activeTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setState(prev => ({ ...prev, activeTab: 'tasks' }))}
          >
            任务
          </button>
          <button
            className={`tab-btn ${state.activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setState(prev => ({ ...prev, activeTab: 'settings' }))}
          >
            设置
          </button>
        </nav>

        <div className="tab-content" style={{ display: state.activeTab === 'workbench' ? 'block' : 'none' }}>
          <Workbench />
        </div>
        <div className="tab-content" style={{ display: state.activeTab === 'tasks' ? 'block' : 'none' }}>
          <Tasks />
        </div>
        <div className="tab-content" style={{ display: state.activeTab === 'settings' ? 'block' : 'none' }}>
          <Settings />
        </div>
      </div>
    </AppCtx.Provider>
  );
}
