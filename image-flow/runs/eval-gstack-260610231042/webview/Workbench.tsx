import React from 'react';
import { AppCtx } from './App';

export default function Workbench(): React.ReactElement {
  const { vscode, state } = React.useContext(AppCtx);
  const {
    config,
    activeMdName,
    materials,
    autoMaterials,
    statusText,
    statusError,
  } = state;

  const [submitting, setSubmitting] = React.useState(false);

  const handleGenerate = () => {
    if (submitting) return;
    setSubmitting(true);
    vscode.postMessage({ type: 'generate' });
    // 提交后 5s 解禁
    setTimeout(() => setSubmitting(false), 5000);
  };

  const handlePreview = () => {
    vscode.postMessage({ type: 'preview' });
  };

  const handleInsertImage = (imagePath: string) => {
    vscode.postMessage({ type: 'insertImage', imagePath });
  };

  const handleOpenImage = (imagePath: string) => {
    vscode.postMessage({ type: 'openImage', imagePath });
  };

  const handleAddMaterial = () => {
    vscode.postMessage({ type: 'addMaterialFolder' });
  };

  const handleRemoveMaterial = (folderPath: string) => {
    vscode.postMessage({ type: 'removeMaterialFolder', path: folderPath });
  };

  // 图片点击打开原图
  const imgClick = (e: React.MouseEvent, p: string) => {
    e.preventDefault();
    handleOpenImage(p);
  };

  // 图片右键插入引用
  const imgContext = (e: React.MouseEvent, p: string) => {
    e.preventDefault();
    handleInsertImage(p);
  };

  const renderImageGrid = (images: string[], cols: number) => (
    <div className="image-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {images.map((img, i) => (
        <div
          key={i}
          className="thumbnail"
          onClick={(e) => imgClick(e, img)}
          onContextMenu={(e) => imgContext(e, img)}
          title={img.split('/').pop() ?? img}
        >
          <img src={toWebviewUri(img)} alt="" loading="lazy" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="workbench">
      {/* 素材库区 */}
      <div className="materials-section">
        {/* 自动素材库 */}
        {autoMaterials.length > 0 && (
          <div className="material-group">
            <div className="material-group-title">当前路径</div>
            {autoMaterials.map((m, i) => (
              <details key={i} className="material-folder">
                <summary>{m.name} ({m.images.length})</summary>
                {renderImageGrid(m.images, config.workbenchCols)}
              </details>
            ))}
          </div>
        )}

        {/* 手动素材库 */}
        <div className="material-group">
          <div className="material-group-title">
            手动素材库
            <button className="btn-small" onClick={handleAddMaterial}>+ 添加</button>
          </div>
          {materials.map((m, i) => (
            <details key={i} className="material-folder">
              <summary>
                {m.name} ({m.images.length})
                <button
                  className="btn-remove"
                  onClick={(e) => { e.preventDefault(); handleRemoveMaterial(m.path); }}
                >
                  ✕
                </button>
              </summary>
              {renderImageGrid(m.images, config.workbenchCols)}
            </details>
          ))}
        </div>
      </div>

      {/* 底部停靠区 */}
      <div className="workbench-dock">
        {/* 控件行 */}
        <div className="controls-row">
          <label>
            模型
            <select
              value={config.model}
              onChange={(e) => vscode.postMessage({ type: 'setConfig', key: 'model', value: e.target.value })}
            >
              <option value="nano-banana-2">nano-banana-2</option>
              <option value="nano-banana-pro">nano-banana-pro</option>
              <option value="gpt-image-2">gpt-image-2</option>
              <option value="gpt-image-2-vip">gpt-image-2-vip</option>
            </select>
          </label>
          <label>
            分辨率
            <select
              value={config.imageSize}
              onChange={(e) => vscode.postMessage({ type: 'setConfig', key: 'imageSize', value: e.target.value })}
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>
          <label>
            比例
            <select
              value={config.aspectRatio}
              onChange={(e) => vscode.postMessage({ type: 'setConfig', key: 'aspectRatio', value: e.target.value })}
            >
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </label>
          <label>
            并发数
            <input
              type="number"
              min={1}
              max={10}
              value={config.concurrency}
              onChange={(e) => {
                const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                vscode.postMessage({ type: 'setConfig', key: 'concurrency', value: v });
              }}
              className="stepper"
            />
          </label>
        </div>

        {/* 生成行 */}
        <div className="generate-row">
          <span className="active-md">
            {activeMdName || '未打开 Markdown 文件'}
          </span>
          <button className="btn" onClick={handlePreview}>预览请求</button>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={submitting || !activeMdName}
          >
            {submitting ? '生成中…' : '生成'}
          </button>
        </div>

        {/* 状态行 */}
        {statusText && (
          <div className={`status-line ${statusError ? 'error' : ''}`}>
            {statusText}
          </div>
        )}
      </div>
    </div>
  );
}

/** 将文件绝对路径转为 webview 可用的 URI */
function toWebviewUri(absPath: string): string {
  // 在后端会用 asWebviewUri 转换，但前端也需要能显示
  // 对于已经通过 localResourceRoots 授权的路径，使用 vscode-resource: 协议
  // 实际上需要通过 postMessage 获取转换后的 URI
  // 简化为：直接用原始路径，后端会在发送前转换
  return absPath;
}
