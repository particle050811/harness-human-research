// 异步任务管理：提交、轮询、持久化、重启续拉
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Task, HistoryEntry } from './shared';
import { submitGenerate, queryResult } from './api';
import { formatTimestamp, getExtFromUrl, dedupErrors, isTransientHttpError, isTransientError, VIP_PIXEL_TABLE, isGptImage2Vip, isNanoBananaModel } from './utils';

const TASKS_KEY = 'image-flow.tasks';
const POLL_INTERVAL = 4_000; // 4s
const TASK_TIMEOUT = 10 * 60 * 1000; // 10 分钟

/** 事件发射器，用于通知 UI 变更 */
export const taskEvents = new vscode.EventEmitter<void>();

export class TaskManager {
  private context: vscode.ExtensionContext;
  private tasks: Task[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false; // 重入锁
  private downloading = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** 加载持久化任务并恢复轮询 */
  async resume(): Promise<void> {
    const stored = this.context.globalState.get<Task[]>(TASKS_KEY) ?? [];
    this.tasks = stored;

    // 处理提交中途被关闭的 job（submitting 态无 id → 直接判失败）
    for (const task of this.tasks) {
      for (const job of task.jobs) {
        if (job.status === 'submitting' && !job.jobId) {
          job.status = 'failed';
          job.error = '提交未完成';
        }
      }
      // 重置超时计时（本次会话起算）
      task.startedAt = new Date().toISOString();
      this.checkTaskFinished(task);
    }

    await this.persist();

    if (this.hasRunningJobs()) {
      this.startPolling();
      // 立即拉一次
      this.pollOnce();
    }

    taskEvents.fire();
  }

  /** 获取当前所有任务 */
  getTasks(): Task[] {
    return this.tasks;
  }

  /** 是否有 running 状态的 job */
  hasRunningJobs(): boolean {
    return this.tasks.some(t => t.jobs.some(j => j.status === 'running' || j.status === 'submitting'));
  }

  /** 通过 Markdown 路径查找生效 MD 的历史记录 */
  getHistory(mdPath: string): HistoryEntry[] {
    if (!mdPath) { return []; }
    const mdDir = path.dirname(mdPath);
    const activeTaskFolders = new Set(this.tasks.map(t => t.folderPath));

    const entries: HistoryEntry[] = [];
    try {
      const dirs = fs.readdirSync(mdDir, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory() || !d.name.startsWith('task-')) { continue; }
        const dirPath = path.join(mdDir, d.name);
        // 排除进行中任务的文件夹
        if (activeTaskFolders.has(dirPath)) { continue; }

        const images = this.scanImagesInDir(dirPath);
        if (images.length === 0) { continue; }

        entries.push({
          folder: d.name,
          folderPath: dirPath,
          imageCount: images.length,
          images,
        });
      }
    } catch {
      // 目录不存在等，返回空
    }

    // 倒序（新的在前）
    entries.sort((a, b) => b.folder.localeCompare(a.folder));
    return entries;
  }

  /** 扫描目录下所有图片文件 */
  private scanImagesInDir(dirPath: string): string[] {
    const images: string[] = [];
    try {
      const files = fs.readdirSync(dirPath);
      for (const f of files) {
        const fp = path.join(dirPath, f);
        try {
          const stat = fs.statSync(fp);
          if (stat.isFile()) {
            const ext = path.extname(f).slice(1).toLowerCase();
            if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
              images.push(fp);
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return images;
  }

  /** 创建新任务并返回（立即建卡，不等网络） */
  async createTask(
    mdPath: string,
    model: string,
    aspectRatio: string,
    imageSize: string,
    concurrency: number,
    baseUrl: string,
    apiKey: string,
    prompt: string,
    referenceImages: string[], // data URI 数组
  ): Promise<Task> {
    const mdDir = path.dirname(mdPath);
    const mdName = path.basename(mdPath, '.md');

    // 生成唯一任务文件夹名
    const ts = formatTimestamp();
    const folder = this.makeUniqueFolder(mdDir, ts);

    const folderPath = path.join(mdDir, folder);
    fs.mkdirSync(folderPath, { recursive: true });

    const task: Task = {
      folder,
      mdName,
      folderPath,
      model,
      jobs: [],
      startedAt: new Date().toISOString(),
      finished: false,
      nextImageSeq: 1,
    };

    // 创建 N 个 submitting 态的 job
    for (let i = 0; i < concurrency; i++) {
      task.jobs.push({
        index: i + 1,
        status: 'submitting',
        jobId: '',
        progress: 0,
        error: '',
        downloadedImages: [],
      });
    }

    this.tasks.unshift(task);
    await this.persist();
    taskEvents.fire();

    // 后台发出生成请求
    this.submitJobs(task, baseUrl, apiKey, prompt, referenceImages, aspectRatio, imageSize);

    return task;
  }

  /** 生成唯一文件夹名 */
  private makeUniqueFolder(mdDir: string, ts: string): string {
    const base = `task-${ts}`;
    let seq = 1;
    let name = `${base}-${seq}`;
    while (fs.existsSync(path.join(mdDir, name))) {
      seq++;
      name = `${base}-${seq}`;
    }
    return name;
  }

  /** 后台提交 N 个 generate 请求 */
  private async submitJobs(
    task: Task,
    baseUrl: string,
    apiKey: string,
    prompt: string,
    referenceImages: string[],
    aspectRatio: string,
    imageSize: string,
  ): Promise<void> {
    await Promise.allSettled(
      task.jobs.map(async (job) => {
        try {
          // 构建请求尺寸字段
          let reqAspectRatio: string | undefined;
          let reqImageSize: string | undefined;

          if (isNanoBananaModel(task.model)) {
            reqAspectRatio = aspectRatio;
            reqImageSize = imageSize;
          } else if (isGptImage2Vip(task.model)) {
            reqAspectRatio = VIP_PIXEL_TABLE[aspectRatio]?.[imageSize] ?? aspectRatio;
          } else {
            // gpt-image-2（非 vip）
            reqAspectRatio = aspectRatio;
          }

          const resp = await submitGenerate({
            baseUrl,
            apiKey,
            model: task.model,
            prompt,
            images: referenceImages.map(r => r),
            aspectRatio: reqAspectRatio,
            imageSize: reqImageSize,
            replyType: 'async',
          });

          if (resp.status === 'failed' || resp.status === 'violation') {
            job.status = resp.status;
            job.error = resp.error ?? '提交失败';
          } else if (resp.id) {
            job.jobId = resp.id;
            job.status = 'running';
          } else {
            job.status = 'failed';
            job.error = '提交返回无 id';
          }
        } catch (err) {
          job.status = 'failed';
          job.error = err instanceof Error ? err.message : String(err);
        }
      }),
    );

    await this.persist();
    taskEvents.fire();

    // 全部提交都失败 → 整任务作废
    const allFailed = task.jobs.every(j => j.status === 'failed' || j.status === 'violation');
    if (allFailed) {
      await this.cancelTask(task, '全部生成请求提交失败:\n' + dedupErrors(task.jobs.map(j => j.error)));
      return;
    }

    // 有 running job 就开启轮询
    if (this.hasRunningJobs() && !this.pollTimer) {
      this.startPolling();
    }
  }

  /** 作废任务：移除、删空文件夹、通知 */
  private async cancelTask(task: Task, errorMsg: string): Promise<void> {
    this.tasks = this.tasks.filter(t => t !== task);
    try {
      // 删除空文件夹
      const files = fs.readdirSync(task.folderPath);
      if (files.length === 0) {
        fs.rmdirSync(task.folderPath);
      }
    } catch { /* ignore */ }
    await this.persist();
    taskEvents.fire();
    vscode.window.showErrorMessage(errorMsg);
  }

  /** 开始轮询 */
  private startPolling(): void {
    if (this.pollTimer) { return; }
    this.pollTimer = setInterval(() => this.pollOnce(), POLL_INTERVAL);
  }

  /** 停止轮询 */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 单次轮询（有重入锁） */
  private async pollOnce(): Promise<void> {
    if (this.polling) { return; }
    this.polling = true;

    try {
      const config = await this.loadConfig();
      const activeTasks = this.tasks.filter(t => !t.finished);

      for (const task of activeTasks) {
        // 超时检查
        const elapsed = Date.now() - new Date(task.startedAt).getTime();
        if (elapsed > TASK_TIMEOUT) {
          for (const job of task.jobs) {
            if (job.status === 'running' || job.status === 'submitting') {
              job.status = 'failed';
              job.error = '任务超时';
            }
          }
          this.checkTaskFinished(task);
          continue;
        }

        for (const job of task.jobs) {
          if (job.status !== 'running') { continue; }

          try {
            const resp = await queryResult({
              baseUrl: config.baseUrl,
              apiKey: config.apiKey,
              jobId: job.jobId,
            });

            if (resp.progress !== undefined) {
              job.progress = resp.progress;
            }

            if (resp.status === 'succeeded') {
              // 下载图片
              if (resp.results && resp.results.length > 0) {
                for (const r of resp.results) {
                  const ext = getExtFromUrl(r.url);
                  const fileName = `${task.mdName}-${String(task.nextImageSeq).padStart(2, '0')}.${ext}`;
                  task.nextImageSeq++;
                  const filePath = path.join(task.folderPath, fileName);
                  await this.downloadImage(r.url, filePath);
                  job.downloadedImages.push(filePath);
                }
              }
              job.status = 'succeeded';
            } else if (resp.status === 'failed' || resp.status === 'violation') {
              job.status = resp.status;
              job.error = resp.error ?? '生成失败';
            } else if (resp.status === 'running') {
              // 保持 running，更新进度
            }
          } catch (err) {
            if (isTransientHttpError(parseInt((err as Error).message.match(/HTTP (\d+)/)?.[1] ?? '0', 10)) || isTransientError(err)) {
              // 瞬时错误，保持 running 下轮重试
              continue;
            }
            // 非瞬时错误，判失败
            job.status = 'failed';
            job.error = err instanceof Error ? err.message : String(err);
          }
        }

        this.checkTaskFinished(task);
      }
    } finally {
      this.polling = false;
    }

    // 无 running job 则停定时器
    if (!this.hasRunningJobs()) {
      this.stopPolling();
    }

    await this.persist();
    taskEvents.fire();
  }

  /** 下载图片到本地 */
  private async downloadImage(url: string, filePath: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`下载失败 HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 检查任务是否全部终结 */
  private checkTaskFinished(task: Task): void {
    const allDone = task.jobs.every(j =>
      j.status === 'succeeded' || j.status === 'failed' || j.status === 'violation',
    );
    if (!allDone) { return; }

    task.finished = true;

    // 统计失败
    const failedJobs = task.jobs.filter(j => j.status === 'failed' || j.status === 'violation');
    const hasImages = task.jobs.some(j => j.downloadedImages.length > 0);

    // 从持久化列表移除
    this.tasks = this.tasks.filter(t => t !== task);

    // 无任何成图 → 删除空文件夹
    if (!hasImages) {
      try {
        const files = fs.readdirSync(task.folderPath);
        if (files.length === 0) {
          fs.rmdirSync(task.folderPath);
        }
      } catch { /* ignore */ }
    }

    if (failedJobs.length > 0) {
      const errors = dedupErrors(failedJobs.map(j => j.error));
      const msg = `任务 ${task.folder} 部分失败:\n${errors}`;
      if (hasImages) {
        vscode.window.showWarningMessage(msg);
      } else {
        vscode.window.showErrorMessage(msg);
      }
    }

    // 通知 UI（任务完成，刷新历史）
    taskEvents.fire();
  }

  /** 持久化进行中任务 */
  private async persist(): Promise<void> {
    const active = this.tasks.filter(t => !t.finished);
    await this.context.globalState.update(TASKS_KEY, active);
  }

  /** 获取配置 */
  private async loadConfig(): Promise<{ baseUrl: string; apiKey: string }> {
    const config = this.context.globalState.get<Record<string, unknown>>('image-flow.config') ?? {};
    const apiKey = (await this.context.secrets.get('image-flow.apiKey')) ?? '';
    return {
      baseUrl: (config.baseUrl as string) ?? 'https://grsai.dakka.com.cn',
      apiKey,
    };
  }

  dispose(): void {
    this.stopPolling();
    taskEvents.dispose();
  }
}
