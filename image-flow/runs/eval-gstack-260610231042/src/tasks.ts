import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  TaskState,
  JobState,
  HistoryFolder,
  isImageFile,
  extFromUrl,
} from './shared';
import {
  submitGenerate,
  queryResult,
  downloadImage,
  isTransientError,
  buildGenerateBody,
} from './api';
import { timestampPrefix, findTaskFolder } from './utils';

const POLL_INTERVAL = 4000; // 4 秒
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

/**
 * 任务管理器：负责异步提交、轮询、持久化、历史扫描。
 * 扩展激活时创建单例。
 */
export class TaskManager {
  private context: vscode.ExtensionContext;
  private tasks: TaskState[] = [];
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private onUpdate: (() => void) | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** 注册 UI 更新回调 */
  setOnUpdate(cb: () => void): void {
    this.onUpdate = cb;
  }

  /** 获取当前所有进行中任务（只读） */
  getTasks(): ReadonlyArray<TaskState> {
    return this.tasks;
  }

  /** 持久化到 globalState */
  private save(): void {
    this.context.globalState.update('image-flow.tasks', this.tasks);
  }

  /** 从 globalState 恢复 */
  resume(): void {
    const stored = this.context.globalState.get<TaskState[]>('image-flow.tasks');
    if (stored && Array.isArray(stored)) {
      // 恢复时：submitting 且无 id 的 job 判失败
      const now = Date.now();
      this.tasks = stored.map(task => ({
        ...task,
        resumeStartedAt: now, // 本次会话起算
        jobs: task.jobs.map(job => {
          if (job.status === 'submitting' && !job.id) {
            return { ...job, status: 'failed' as const, error: '提交未完成（扩展已关闭）' };
          }
          return job;
        }),
      }));
      this.save();
    }
    if (this.tasks.length > 0) {
      this.notifyUpdate();
      this.startPolling();
    }
  }

  private notifyUpdate(): void {
    this.onUpdate?.();
  }

  /** 创建新任务 */
  async createTask(
    mdPath: string,
    prompt: string,
    images: string[],
    model: string,
    concurrency: number,
    baseUrl: string,
    apiKey: string,
    aspectRatio: string,
    imageSize: string,
  ): Promise<TaskState> {
    const mdDir = path.dirname(mdPath);
    const ts = timestampPrefix();
    const taskDir = findTaskFolder(mdDir, ts);
    const folderName = path.basename(taskDir);

    // 立即创建文件夹
    fs.mkdirSync(taskDir, { recursive: true });

    const task: TaskState = {
      folderName,
      model,
      mdPath,
      jobs: Array.from({ length: concurrency }, () => ({
        id: '',
        status: 'submitting' as const,
        progress: 0,
        downloadedImages: [],
      })),
      startedAt: Date.now(),
      resumeStartedAt: Date.now(),
      doneImages: 0,
    };

    this.tasks.unshift(task);
    this.save();
    this.notifyUpdate();

    // 后台提交
    const config = { baseUrl, aspectRatio, imageSize };
    const params = { model, prompt, images, config };

    // 并发提交所有 job
    const submitPromises = task.jobs.map(async (job, _idx) => {
      try {
        const jobId = await submitGenerate(params, apiKey);
        job.id = jobId;
        job.status = 'running';
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        job.status = 'failed';
        job.error = msg;
        if (isTransientError(err)) {
          // 瞬时错误：保持 running 等下轮重试
          job.status = 'running';
          job.error = '瞬时错误，将重试';
        }
      }
      this.save();
      this.notifyUpdate();
    });

    // 不等待提交，但需要处理全失败的情况
    Promise.allSettled(submitPromises).then(() => {
      const allFailed = task.jobs.every(j => j.status === 'failed');
      if (allFailed) {
        this.failTask(task);
      } else {
        this.startPolling();
      }
    });

    return task;
  }

  /** 全部提交失败：移除任务、删空文件夹、弹通知 */
  private failTask(task: TaskState): void {
    const errors = task.jobs
      .map(j => j.error)
      .filter((e): e is string => !!e);
    const uniqueErrors = [...new Set(errors)];

    // 删除空文件夹
    const mdDir = path.dirname(task.mdPath);
    const taskDir = path.join(mdDir, task.folderName);
    try {
      const files = fs.readdirSync(taskDir);
      if (files.length === 0) fs.rmdirSync(taskDir);
    } catch { /* ignore */ }

    // 从列表移除
    this.tasks = this.tasks.filter(t => t !== task);
    this.save();
    this.notifyUpdate();

    vscode.window.showErrorMessage(`生成失败: ${uniqueErrors.join(' / ')}`);
    this.checkStopPolling();
  }

  /** 启动轮询定时器 */
  private startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.pollAll(), POLL_INTERVAL);
  }

  /** 停止轮询（没有 running job 时） */
  private checkStopPolling(): void {
    const hasRunning = this.tasks.some(t =>
      t.jobs.some(j => j.status === 'running' || j.status === 'submitting')
    );
    if (!hasRunning && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 轮询所有未完成 job */
  private async pollAll(): Promise<void> {
    if (this.polling) return; // 重入锁
    this.polling = true;

    try {
      for (const task of this.tasks) {
        await this.pollTask(task);
      }
      this.save();
      this.notifyUpdate();
      this.checkStopPolling();
    } finally {
      this.polling = false;
    }
  }

  /** 轮询单个任务 */
  private async pollTask(task: TaskState): Promise<void> {
    const config = vscode.workspace.getConfiguration('image-flow');
    const baseUrl = config.get<string>('baseUrl') ?? 'https://grsai.dakka.com.cn';
    const apiKey = await this.getApiKey();
    const mdDir = path.dirname(task.mdPath);
    const taskDir = path.join(mdDir, task.folderName);

    // 超时兜底（从本次会话起算）
    if (Date.now() - task.resumeStartedAt > TASK_TIMEOUT_MS) {
      for (const job of task.jobs) {
        if (job.status === 'running') {
          job.status = 'failed';
          job.error = '任务超时';
        }
      }
      this.checkTaskDone(task);
      return;
    }

    for (const job of task.jobs) {
      if (job.status !== 'running') continue;

      try {
        const result = await queryResult(job.id, baseUrl, apiKey);

        job.progress = result.progress ?? job.progress;

        if (result.status === 'succeeded' && result.results) {
          // 下载所有结果图片
          const mdName = path.basename(task.mdPath, path.extname(task.mdPath));
          for (const r of result.results) {
            task.doneImages++;
            const ext = extFromUrl(r.url);
            const fileName = `${mdName}-${task.doneImages}.${ext}`;
            const dest = path.join(taskDir, fileName);
            await downloadImage(r.url, dest);
            job.downloadedImages.push(fileName);
          }
          job.status = 'succeeded';
        } else if (result.status === 'failed' || result.status === 'violation') {
          job.status = result.status as JobState['status'];
          job.error = result.error ?? '任务失败';
        }
        // running 保持，等下次轮询
      } catch (err: unknown) {
        if (isTransientError(err)) {
          // 瞬时错误，下轮重试
          continue;
        }
        // 非瞬时错误，判失败
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
      }
    }

    this.checkTaskDone(task);
  }

  /** 检查任务是否完全终结 */
  private checkTaskDone(task: TaskState): void {
    const allDone = task.jobs.every(
      j => j.status === 'succeeded' || j.status === 'failed'
    );
    if (!allDone) return;

    // 从进行中列表移除
    this.tasks = this.tasks.filter(t => t !== task);
    this.save();
    this.notifyUpdate();

    const successCount = task.jobs.filter(j => j.status === 'succeeded').length;
    const failCount = task.jobs.filter(j => j.status === 'failed').length;
    const hasImages = task.jobs.some(j => j.downloadedImages.length > 0);

    if (failCount > 0) {
      const errors = task.jobs
        .filter(j => j.status === 'failed')
        .map(j => j.error)
        .filter((e): e is string => !!e);
      const uniqueErrors = [...new Set(errors)];

      if (hasImages) {
        vscode.window.showWarningMessage(
          `任务 ${task.folderName} 部分失败 (${successCount}/${task.jobs.length}): ${uniqueErrors.join(' / ')}`
        );
      } else {
        vscode.window.showErrorMessage(
          `任务 ${task.folderName} 失败: ${uniqueErrors.join(' / ')}`
        );
        // 无成图，删除空文件夹
        try {
          const mdDir = path.dirname(task.mdPath);
          const taskDir = path.join(mdDir, task.folderName);
          const files = fs.readdirSync(taskDir);
          const imgFiles = files.filter(f => isImageFile(f));
          if (imgFiles.length === 0) {
            for (const f of files) fs.unlinkSync(path.join(taskDir, f));
            fs.rmdirSync(taskDir);
          }
        } catch { /* ignore */ }
      }
    }

    this.checkStopPolling();
  }

  private async getApiKey(): Promise<string> {
    return (await this.context.secrets.get('image-flow.apiKey')) ?? '';
  }

  /** 扫描生效 MD 同级的 task-* 图片文件夹（历史），排除进行中任务 */
  scanHistory(mdPath: string): HistoryFolder[] {
    const mdDir = path.dirname(mdPath);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(mdDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const runningFolderNames = new Set(
      this.tasks.map(t => t.folderName)
    );

    const result: HistoryFolder[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('task-')) continue;
      if (runningFolderNames.has(entry.name)) continue;

      const dirPath = path.join(mdDir, entry.name);
      let files: string[];
      try {
        files = fs.readdirSync(dirPath).filter(f => isImageFile(f));
      } catch {
        continue;
      }
      if (files.length === 0) continue;

      result.push({ folderName: entry.name, path: dirPath, images: files });
    }

    // 按文件夹名倒序
    result.sort((a, b) => b.folderName.localeCompare(a.folderName));
    return result;
  }

  /** 构建预览请求体（与真实提交一致） */
  buildPreviewRequest(
    prompt: string,
    images: string[],
    model: string,
  ): { url: string; body: Record<string, unknown> } {
    const config = vscode.workspace.getConfiguration('image-flow');
    const baseUrl = config.get<string>('baseUrl') ?? 'https://grsai.dakka.com.cn';
    const aspectRatio = config.get<string>('aspectRatio') ?? '3:4';
    const imageSize = config.get<string>('imageSize') ?? '1K';

    const body = buildGenerateBody({
      model,
      prompt,
      images,
      config: { baseUrl, aspectRatio, imageSize },
    });

    return { url: `POST ${baseUrl}/v1/api/generate`, body };
  }
}
