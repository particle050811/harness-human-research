// 异步任务管理器：提交、轮询、下载、持久化、重启续拉

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { submitGenerate, queryResult, downloadImage } from './api';
import { getConfig } from './config';
import {
  TaskInfo,
  TaskJob,
  isTransientError,
  extFromUrl,
  isImageExt,
  taskFolderName,
} from './shared';

const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟
const POLL_INTERVAL_MS = 4_000;
const TASKS_KEY = 'activeTasks';

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
let tasks: TaskInfo[] = [];
let globalState: vscode.Memento;
let secrets: vscode.SecretStorage;
let onUpdate: (() => void) | null = null;
let onTaskCompleted: ((task: TaskInfo) => void) | null = null;
let sessionStartTime = 0;

export function initTaskManager(
  ctx: vscode.ExtensionContext,
  updateCb: () => void,
  completedCb: (task: TaskInfo) => void,
): void {
  globalState = ctx.globalState;
  secrets = ctx.secrets;
  onUpdate = updateCb;
  onTaskCompleted = completedCb;
  sessionStartTime = Date.now();
  resume();
}

export function disposeTaskManager(): void {
  stopPolling();
}

export function getTasks(): TaskInfo[] {
  return tasks;
}

/** 创建新任务 */
export async function createTask(
  mdFilePath: string,
  model: string,
  concurrency: number,
): Promise<TaskInfo> {
  const config = await getConfig(secrets, globalState);
  if (!config.apiKey) {
    throw new Error('请先配置 API Key（前往设置页填写）');
  }

  const mdDir = path.dirname(mdFilePath);
  const mdFileName = path.basename(mdFilePath, '.md');
  const folderName = taskFolderName();
  const folderPath = path.join(mdDir, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  const now = Date.now();
  const task: TaskInfo = {
    folderName,
    folderPath,
    model,
    mdFileName,
    mdFilePath,
    jobs: [],
    submittedAt: now,
    startedAt: now,
  };

  for (let i = 0; i < concurrency; i++) {
    task.jobs.push({
      index: i,
      status: 'submitting',
      progress: 0,
    });
  }

  tasks.unshift(task);
  persist();

  return task;
}

/** 更新单个 job 状态 */
export function updateJob(taskFolder: string, jobIndex: number, update: Partial<TaskJob>): void {
  const task = tasks.find(t => t.folderName === taskFolder);
  if (!task) return;
  const job = task.jobs.find(j => j.index === jobIndex);
  if (!job) return;
  Object.assign(job, update);
  persist();
}

/** 后台提交所有 job */
export async function submitAllJobs(
  task: TaskInfo,
  prompt: string,
  images: string[],
  aspectRatio: string,
  imageSize: string,
): Promise<void> {
  const config = await getConfig(secrets, globalState);

  const submitOne = async (job: TaskJob) => {
    try {
      const resp = await submitGenerate(
        config.baseUrl,
        config.apiKey,
        task.model,
        prompt,
        images,
        aspectRatio,
        imageSize,
      );
      updateJob(task.folderName, job.index, {
        status: 'running',
        id: resp.id,
        progress: resp.progress ?? 0,
      });
    } catch (err) {
      updateJob(task.folderName, job.index, {
        status: 'failed',
        error: String(err),
        progress: 0,
      });
    }
  };

  // 并发提交全部 job
  await Promise.all(task.jobs.map(j => submitOne(j)));

  const allFailed = task.jobs.every(j => j.status === 'failed' || j.status === 'violation');
  const t = tasks.find(tt => tt.folderName === task.folderName);
  if (allFailed && t) {
    const errors = [...new Set(t.jobs.map(j => j.error).filter(Boolean))];
    tasks = tasks.filter(tt => tt.folderName !== task.folderName);
    // 删除空文件夹
    try { fs.rmdirSync(task.folderPath); } catch { /* 忽略 */ }
    persist();
    onUpdate?.();
    throw new Error(`全部提交失败：\n${errors.join('\n')}`);
  }

  // 启动轮询
  startPolling();
  persist();
  onUpdate?.();
}

/** 启动全局轮询定时器 */
function startPolling(): void {
  if (pollingTimer) return;
  pollingTimer = setInterval(pollAllTasks, POLL_INTERVAL_MS);
  // 立即拉一次
  pollAllTasks();
}

function stopPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

let globalImageCounter = 0;

/** 轮询所有进行中的 job */
async function pollAllTasks(): Promise<void> {
  if (polling) return; // 重入锁
  polling = true;

  try {
    const config = await getConfig(secrets, globalState);
    let hasRunning = false;

    for (const task of tasks) {
      for (const job of task.jobs) {
        if (job.status !== 'running' || !job.id) continue;
        hasRunning = true;

        try {
          const result = await queryResult(config.baseUrl, config.apiKey, job.id);
          if (result.status === 'succeeded' && result.results) {
            // 下载图片
            const downloaded: string[] = [];
            for (const r of result.results) {
              globalImageCounter++;
              const ext = extFromUrl(r.url);
              const safeExt = isImageExt(ext) ? ext : 'png';
              const fileName = `${task.mdFileName}-${globalImageCounter}.${safeExt}`;
              const destPath = path.join(task.folderPath, fileName);
              await downloadImage(r.url, destPath);
              downloaded.push(destPath);
            }
            updateJob(task.folderName, job.index, {
              status: 'succeeded',
              progress: 100,
              results: downloaded,
            });
          } else if (result.status === 'failed' || result.status === 'violation') {
            updateJob(task.folderName, job.index, {
              status: result.status,
              progress: 0,
              error: result.error ?? result.status,
            });
          } else if (result.status === 'running') {
            updateJob(task.folderName, job.index, {
              progress: result.progress ?? job.progress,
            });
          }
        } catch (err) {
          if (isTransientError(err)) {
            // 瞬时错误，保持 running，下轮重试
            continue;
          }
          updateJob(task.folderName, job.index, {
            status: 'failed',
            progress: 0,
            error: String(err),
          });
        }
      }

      // 超时兜底
      const elapsed = Date.now() - Math.max(task.startedAt, sessionStartTime);
      if (elapsed > TASK_TIMEOUT_MS) {
        for (const job of task.jobs) {
          if (job.status === 'running' || job.status === 'submitting') {
            updateJob(task.folderName, job.index, {
              status: 'failed',
              error: '任务超时（10 分钟）',
              progress: 0,
            });
          }
        }
      }

      // 检查任务是否全部终结
      checkTaskDone(task);
    }

    if (!hasRunning) {
      stopPolling();
    }
  } finally {
    polling = false;
    onUpdate?.();
  }
}

/** 检查任务是否全部终结并处理 */
function checkTaskDone(task: TaskInfo): void {
  const allDone = task.jobs.every(
    j => j.status === 'succeeded' || j.status === 'failed' || j.status === 'violation',
  );
  if (!allDone) return;

  const successCount = task.jobs.filter(j => j.status === 'succeeded').length;
  const failCount = task.jobs.filter(j => j.status === 'failed' || j.status === 'violation').length;
  const totalImages = task.jobs.reduce((acc, j) => acc + (j.results?.length ?? 0), 0);

  // 通知前端任务完成（先把完成图并入历史）
  onTaskCompleted?.(task);

  // 从列表移除
  tasks = tasks.filter(t => t.folderName !== task.folderName);

  // 无成图则删空文件夹
  if (totalImages === 0) {
    try { fs.rmdirSync(task.folderPath); } catch { /* 忽略 */ }
  }

  persist();

  // 弹通知
  if (failCount > 0) {
    const errors = [...new Set(task.jobs.filter(j => j.error).map(j => j.error))];
    const errMsg = errors.join('\n');
    if (totalImages > 0) {
      vscode.window.showWarningMessage(`任务 ${task.folderName} 部分失败（${successCount}/${task.jobs.length} 成功）：${errMsg}`);
    } else {
      vscode.window.showErrorMessage(`任务 ${task.folderName} 全部失败：${errMsg}`);
    }
  }
}

/** 持久化到 globalState */
function persist(): void {
  globalState.update(TASKS_KEY, tasks);
}

/** 重启续拉 */
function resume(): void {
  const saved = globalState.get<TaskInfo[]>(TASKS_KEY);
  if (!saved || saved.length === 0) return;

  tasks = saved;

  // submitting 态无 id 的直接判失败
  for (const task of tasks) {
    for (const job of task.jobs) {
      if (job.status === 'submitting' && !job.id) {
        job.status = 'failed';
        job.error = '提交未完成';
      }
      // 重置 progress 为 0 防止陈旧值
      if (job.status === 'running') {
        job.progress = 0;
      }
    }
    // 检查已完成
    checkTaskDone(task);
  }

  persist();

  // 如果有 running 的 job，启动轮询
  const hasRunning = tasks.some(t => t.jobs.some(j => j.status === 'running' && j.id));
  if (hasRunning) {
    startPolling();
  }

  onUpdate?.();
}
