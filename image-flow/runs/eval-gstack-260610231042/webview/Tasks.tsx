import React, { useState } from 'react';
import { AppCtx } from './App';
import { useInterval, formatDuration, calcProgress } from './hooks';
import type { TaskState, JobState } from '../src/shared';

export default function Tasks(): React.ReactElement {
  const { vscode, state } = React.useContext(AppCtx);
  const { tasks, history, config } = state;
  const [now, setNow] = useState(Date.now());

  // 每秒自增计时
  useInterval(() => setNow(Date.now()), tasks.length > 0 ? 1000 : null);

  const handleOpenImage = (p: string) => {
    vscode.postMessage({ type: 'openImage', imagePath: p });
  };

  // 合并列表：进行中任务 + 历史，按文件夹名倒序
  const allItems: Array<
    { kind: 'running'; task: TaskState } | { kind: 'history'; folder: (typeof history)[0] }
  > = [];

  for (const task of tasks) {
    allItems.push({ kind: 'running', task });
  }
  for (const folder of history) {
    allItems.push({ kind: 'history', folder });
  }

  // 按文件夹名（含时间戳）倒序
  allItems.sort((a, b) => {
    const na = a.kind === 'running' ? a.task.folderName : a.folder.folderName;
    const nb = b.kind === 'running' ? b.task.folderName : b.folder.folderName;
    return nb.localeCompare(na);
  });

  if (allItems.length === 0) {
    return <div className="empty-state">暂无任务</div>;
  }

  return (
    <div className="tasks-page">
      {allItems.map((item, i) => {
        if (item.kind === 'running') {
          const task = item.task;
          const progress = calcProgress(task.jobs);
          const done = task.jobs.filter((j: JobState) => j.status === 'succeeded').length;
          const total = task.jobs.length;
          const failed = task.jobs.filter((j: JobState) => j.status === 'failed').length;
          const elapsed = now - task.startedAt;

          // 收集所有已下载图片
          const allImages: { jobIdx: number; img: string }[] = [];
          for (let ji = 0; ji < task.jobs.length; ji++) {
            for (const img of task.jobs[ji].downloadedImages) {
              allImages.push({ jobIdx: ji, img });
            }
          }

          // 用 activeMdPath 拼接任务文件夹路径，后端会转为 webview URI
          const taskDirBase = state.activeMdPath
            ? state.activeMdPath.replace(/[^/\\]*$/, '') + task.folderName + '/'
            : '';

          return (
            <details key={`running-${i}`} className="task-card running" open>
              <summary className="task-summary">
                <span className="task-title">
                  {task.folderName}（{task.model}）·
                  生成中 {done}/{total}
                  {failed > 0 && <> · 失败 {failed}</>}·
                  {formatDuration(elapsed)}
                </span>
              </summary>

              <div className="task-body">
                {/* 进度条 */}
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                  <span className="progress-text">{progress}%</span>
                </div>

                {/* 缩略图 */}
                {allImages.length > 0 && (
                  <div
                    className="image-grid"
                    style={{ gridTemplateColumns: `repeat(${config.tasksCols}, 1fr)` }}
                  >
                    {allImages.map((img, ii) => (
                      <div
                        key={ii}
                        className="thumbnail"
                        onClick={() => handleOpenImage(taskDirBase + img.img)}
                        title={img.img}
                      >
                        <img
                          src={toWebviewUri(taskDirBase + img.img)}
                          alt=""
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* 提示信息 */}
                {task.jobs.some((j: JobState) => j.status === 'submitting') && (
                  <div className="task-info">
                    正在提交 {task.jobs.filter((j: JobState) => j.status === 'submitting').length} 个请求…
                  </div>
                )}
                {task.jobs.some((j: JobState) => j.status === 'running') && (
                  <div className="task-info">
                    还有 {task.jobs.filter((j: JobState) => j.status === 'running').length} 张正在生成…
                  </div>
                )}

                {/* 错误列表 */}
                {task.jobs.filter((j: JobState) => j.error).map((j: JobState, ji: number) => (
                  <div key={ji} className="task-error">Job {ji + 1}: {j.error}</div>
                ))}
              </div>
            </details>
          );
        }

        // 历史卡片
        const folder = item.folder;
        const imgPaths = folder.images.map(f => folder.path + '/' + f);

        return (
          <details key={`hist-${i}`} className="task-card history">
            <summary className="task-summary">
              {folder.folderName}（{folder.images.length} 张）
            </summary>
            <div
              className="image-grid"
              style={{ gridTemplateColumns: `repeat(${config.tasksCols}, 1fr)` }}
            >
              {imgPaths.map((p, ii) => (
                <div
                  key={ii}
                  className="thumbnail"
                  onClick={() => handleOpenImage(p)}
                  title={folder.images[ii]}
                >
                  <img src={toWebviewUri(p)} alt="" loading="lazy" />
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function toWebviewUri(absPath: string): string {
  return absPath;
}
