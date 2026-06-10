import React from 'react';
import { AppCtx } from './App';

const API_KEY_URL = 'https://grsai.ai/zh/dashboard/api-keys';

export default function Settings(): React.ReactElement {
  const { vscode, state } = React.useContext(AppCtx);
  const { config } = state;

  const [apiKeyInput, setApiKeyInput] = React.useState('');
  const [injectionModel, setInjectionModel] = React.useState(config.model);
  const [injectionText, setInjectionText] = React.useState('');

  // 同步注入文本当选中模型变化时
  React.useEffect(() => {
    setInjectionText(config.modelInjections[injectionModel] ?? '');
  }, [injectionModel, config.modelInjections]);

  const handleSaveApiKey = () => {
    vscode.postMessage({ type: 'setApiKey', value: apiKeyInput });
    setApiKeyInput('');
  };

  const handleSaveInjection = () => {
    vscode.postMessage({
      type: 'setModelInjection',
      model: injectionModel,
      injection: injectionText,
    });
  };

  const handleOpenApiKeyUrl = () => {
    vscode.postMessage({ type: 'openUrl', url: API_KEY_URL });
  };

  return (
    <div className="settings-page">
      {/* API Key */}
      <div className="setting-group">
        <label className="setting-label">
          API Key
          <a
            href="#"
            className="link-small"
            onClick={(e) => { e.preventDefault(); handleOpenApiKeyUrl(); }}
          >
            获取 API Key →
          </a>
        </label>
        <div className="setting-row">
          <input
            type="password"
            className="text-input"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={config.apiKey ? '已设置 (••••••••)' : '请输入 API Key'}
          />
          <button className="btn btn-small" onClick={handleSaveApiKey}>
            保存
          </button>
        </div>
        {config.apiKey && (
          <div className="setting-hint success">API Key 已配置</div>
        )}
      </div>

      {/* 节点 */}
      <div className="setting-group">
        <label className="setting-label">节点</label>
        <select
          className="select-full"
          value={config.baseUrl}
          onChange={(e) =>
            vscode.postMessage({ type: 'setConfig', key: 'baseUrl', value: e.target.value })
          }
        >
          <option value="https://grsai.dakka.com.cn">国内节点 (grsai.dakka.com.cn)</option>
          <option value="https://grsaiapi.com">全球节点 (grsaiapi.com)</option>
        </select>
      </div>

      {/* 工作台每行张数 */}
      <div className="setting-group">
        <label className="setting-label">工作台素材缩略图每行张数</label>
        <input
          type="number"
          min={1}
          max={8}
          value={config.workbenchCols}
          onChange={(e) => {
            const v = Math.max(1, Math.min(8, parseInt(e.target.value) || 4));
            vscode.postMessage({ type: 'setConfig', key: 'workbenchCols', value: v });
          }}
          className="stepper"
        />
      </div>

      {/* 任务每行张数 */}
      <div className="setting-group">
        <label className="setting-label">任务页缩略图每行张数</label>
        <input
          type="number"
          min={1}
          max={8}
          value={config.tasksCols}
          onChange={(e) => {
            const v = Math.max(1, Math.min(8, parseInt(e.target.value) || 2));
            vscode.postMessage({ type: 'setConfig', key: 'tasksCols', value: v });
          }}
          className="stepper"
        />
      </div>

      {/* 模型注入提示词 */}
      <div className="setting-group">
        <label className="setting-label">模型注入提示词</label>
        <select
          className="select-full"
          value={injectionModel}
          onChange={(e) => setInjectionModel(e.target.value)}
        >
          <option value="nano-banana-2">nano-banana-2</option>
          <option value="nano-banana-pro">nano-banana-pro</option>
          <option value="gpt-image-2">gpt-image-2</option>
          <option value="gpt-image-2-vip">gpt-image-2-vip</option>
        </select>
        <textarea
          className="text-area"
          rows={3}
          value={injectionText}
          onChange={(e) => setInjectionText(e.target.value)}
          placeholder="输入该模型的注入提示词（留空表示不注入）"
        />
        <button className="btn btn-small" onClick={handleSaveInjection}>
          保存注入提示词
        </button>
      </div>
    </div>
  );
}
