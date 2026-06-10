import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { submitGenerate, queryResult, buildRequestBody, isTransientError, fetchWithTimeout } from './api';
import { isImageExt, extFromUrl, type JobState, type TaskInfo, type HistoryEntry } from './shared';
import type { ConfigManager } from './config';
import { getPrompt } from './prompt';
import { parseMarkdown } from './parser';

const POLL_INTERVAL = 4_000;
const TASK_TIMEOUT_MS = 10 * 60 * 1_000;

export class TaskManager {
  private tasks: TaskInfo[] = [];
  private configManager: ConfigManager;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private onUpdate: () => void;

  constructor(configManager: ConfigManager, onUpdate: () => void) {
    this.configManager = configManager;
    this.onUpdate = onUpdate;
  }

  getTasks(): TaskInfo[] {
    return this.tasks;
  }

  /** 提交新任务 */
  async submit(
    mdPath: string,
    model: string,
    aspectRatio: string,
    imageSize: string,
    concurrency: number,
  ): Promise<string | null> {
    const config = await this.configManager.getConfig();
    if (!config.apiKey) {
      vscode.window.showErrorMessage('请先在设置中配置 API Key');
      return null;
    }

    const mdDir = path.dirname(mdPath);
    const mdFileName = path.basename(mdPath, '.md');
    const mdContent = fs.readFileSync(mdPath, 'utf-8');

    if (!mdContent.trim()) {
      vscode.window.showErrorMessage('内容为空');
      return null;
    }

    // 解析参考图
    let parseResult;
    try {
      parseResult = parseMarkdown(mdContent, mdDir);
    } catch (e: any) {
      if (e.message?.startsWith('REF_FAIL:')) {
        const paths = e.message.replace('REF_FAIL:', '').split('\n').filter(Boolean);
        vscode.window.showErrorMessage(`参考图读取失败：\n${paths.join('\n')}`);
        return null;
      }
      throw e;
    }

    // 组装最终 prompt
    const finalPrompt = getPrompt(mdPath, model, parseResult.body, this.configManager);

    // 创建任务文件夹
    const now = new Date();
    const ts = `${String(now.getFullYear()).slice(2)}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    let seq = 1;
    let folderName = `task-${ts}-${seq}`;
    while (fs.existsSync(path.join(mdDir, folderName))) {
      seq++;
      folderName = `task-${ts}-${seq}`;
    }
    const folderPath = path.join(mdDir, folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    const taskId = folderName;

    // 创建 N 个 job（全部置 submitting 态，立即建卡返回）
    const jobs: JobState[] = [];
    for (let i = 0; i < concurrency; i++) {
      jobs.push({ index: i + 1, id: null, status: 'submitting', progress: 0, error: null, images: [] });
    }

    const task: TaskInfo = {
      id: taskId,
      folderName,
      folderPath,
      mdFileName,
      model,
      jobs,
      startedAt: Date.now(),
      sessionStart: Date.now(),
    };

    this.tasks.unshift(task);
    this.persist();
    this.onUpdate();

    // 后台并发发出 N 个 generate 请求
    const refUris = parseResult.refImages.map((r: { dataUri: string }) => r.dataUri);
    this.submitJobs(task, config.baseUrl, config.apiKey, finalPrompt, refUris, model, aspectRatio, imageSize);

    return taskId;
  }

  private async submitJobs(
    task: TaskInfo,
    baseUrl: string,
    apiKey: string,
    prompt: string,
    images: string[],
    model: string,
    aspectRatio: string,
    imageSize: string,
  ) {
    const errors: string[] = [];

    const promises = task.jobs.map(async (job) => {
      try {
        const body = buildRequestBody(model, prompt, images, aspectRatio, imageSize);
        const result = await submitGenerate(baseUrl, apiKey, body);
        if (result.id) {
          job.id = result.id;
          job.status = 'running';
        } else {
          job.status = result.status === 'violation' ? 'violation' : 'failed';
          job.error = result.error || '提交失败';
          errors.push(job.error);
        }
      } catch (e: any) {
        job.status = 'failed';
        job.error = e.message || '提交异常';
        if (job.error) errors.push(job.error);
      }
      this.persist();
      this.onUpdate();
    });

    await Promise.all(promises);

    // 全部提交失败：整任务作废
    const allFailed = task.jobs.every((j) => j.status !== 'running');
    if (allFailed) {
      this.tasks = this.tasks.filter((t) => t.id !== task.id);
      try { fs.rmdirSync(task.folderPath); } catch { /* empty */ }
      this.persist();
      this.onUpdate();
      const uniqueErrors = [...new Set(errors.filter(Boolean))];
      vscode.window.showErrorMessage(`全部提交失败：${uniqueErrors.join('; ')}`);
      return;
    }

    this.ensurePolling();
    this.onUpdate();
  }

  /** 恢复未完成任务 */
  async resume() {
    const stored = this.configManager.get<TaskInfo[]>('pendingTasks', []);
    if (stored.length === 0) return;

    for (const task of stored) {
      // submitting 态无 id 的直接判失败
      for (const job of task.jobs) {
        if (job.status === 'submitting' && !job.id) {
          job.status = 'failed';
          job.error = '提交未完成';
        }
      }
      // 重置超时计时（按本次会话起算）
      task.sessionStart = Date.now();
    }

    this.tasks = stored;

    // 终结没有可用 job 的任务
    const deadTasks = this.tasks.filter((t) => t.jobs.every((j) => j.status !== 'running'));
    for (const task of deadTasks) {
      await this.finalizeTask(task);
    }

    const hasRunning = this.tasks.some((t) => t.jobs.some((j) => j.status === 'running'));
    if (hasRunning) {
      await this.pollAll();
      this.ensurePolling();
    }
    this.onUpdate();
  }

  /** 确保轮询定时器运转（仅当存在 running job） */
  private ensurePolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.pollAll(), POLL_INTERVAL);
  }

  /** 停止轮询 */
  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 重入锁保护的轮询 */
  private async pollAll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const config = await this.configManager.getConfig();
      const apiKey = config.apiKey;
      const baseUrl = config.baseUrl;
      let hasRunning = false;

      for (const task of this.tasks) {
        // 超时兜底（按本次会话起算）
        if (Date.now() - task.sessionStart > TASK_TIMEOUT_MS) {
          for (const job of task.jobs) {
            if (job.status === 'running' || job.status === 'submitting') {
              job.status = 'failed';
              job.error = '任务超时';
            }
          }
          continue;
        }

        for (const job of task.jobs) {
          if (job.status !== 'running') continue;
          hasRunning = true;

          try {
            const result = await queryResult(baseUrl, apiKey, job.id!);
            if (result.status === 'succeeded') {
              job.status = 'succeeded';
              job.progress = 100;
              if (result.results) {
                let imgIndex = this.getNextImageIndex(task);
                for (const r of result.results) {
                  try {
                    const ext = extFromUrl(r.url);
                    const validExt = isImageExt(ext) ? ext : 'png';
                    const fileName = `${task.mdFileName}-${imgIndex}.${validExt}`;
                    const filePath = path.join(task.folderPath, fileName);
                    await this.downloadFile(r.url, filePath);
                    job.images.push(fileName);
                    imgIndex++;
                  } catch (e: any) {
                    job.error = (job.error ? job.error + '; ' : '') + `下载失败: ${e.message}`;
                  }
                }
              }
            } else if (result.status === 'failed' || result.status === 'violation') {
              job.status = result.status;
              job.error = result.error || result.status;
            } else if (result.status === 'running') {
              job.progress = result.progress || 0;
            }
          } catch (e: any) {
            const errMsg = e.message || '轮询异常';
            if (isTransientError(errMsg)) {
              hasRunning = true;
            } else {
              job.status = 'failed';
              job.error = errMsg;
            }
          }
        }
      }

      this.persist();
      this.onUpdate();

      // 终结任务处理
      const finished = this.tasks.filter((t) =>
        t.jobs.every((j) => j.status !== 'running' && j.status !== 'submitting'),
      );
      for (const task of finished) {
        await this.finalizeTask(task);
      }

      if (!hasRunning && this.tasks.length === 0) {
        this.stopPolling();
      }
    } finally {
      this.polling = false;
    }
  }

  /** 任务终结处理 */
  private async finalizeTask(task: TaskInfo) {
    this.tasks = this.tasks.filter((t) => t.id !== task.id);

    const allImages = task.jobs.flatMap((j) => j.images);
    const failedJobs = task.jobs.filter((j) => j.status === 'failed' || j.status === 'violation');
    const errors = [...new Set(failedJobs.map((j) => j.error).filter(Boolean))];

    if (allImages.length === 0) {
      try { fs.rmdirSync(task.folderPath); } catch { /* empty */ }
      if (errors.length > 0) {
        vscode.window.showErrorMessage(`生成失败：${errors.join('; ')}`);
      }
    } else if (errors.length > 0) {
      vscode.window.showWarningMessage(`部分生成失败：${errors.join('; ')}`);
    }

    this.persist();
  }

  /** 下载文件 */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const resp = await fetchWithTimeout(url, {});
    if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
  }

  private getNextImageIndex(task: TaskInfo): number {
    let maxIdx = 0;
    for (const job of task.jobs) {
      for (const img of job.images) {
        const match = img.match(/-(\d+)\.\w+$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxIdx) maxIdx = n;
        }
      }
    }
    return maxIdx + 1;
  }

  /** 持久化进行中任务 */
  private persist() {
    this.configManager.set('pendingTasks', this.tasks).catch(() => {});
  }

  /** 获取历史任务（扫描 task-* 文件夹） */
  getHistory(mdPath: string): HistoryEntry[] {
    if (!mdPath) return [];
    const mdDir = path.dirname(mdPath);
    if (!fs.existsSync(mdDir)) return [];

    const taskFolders: HistoryEntry[] = [];
    const pendingFolders = new Set(this.tasks.map((t) => t.folderName));

    try {
      const entries = fs.readdirSync(mdDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('task-')) continue;
        if (pendingFolders.has(entry.name)) continue;

        const folderPath = path.join(mdDir, entry.name);
        const files = fs.readdirSync(folderPath).filter((f) => {
          const ext = path.extname(f).toLowerCase().replace('.', '');
          return isImageExt(ext);
        });

        if (files.length === 0) continue;

        taskFolders.push({
          folderName: entry.name,
          folderPath,
          imageCount: files.length,
          images: files.sort(),
        });
      }
    } catch { /* ignore */ }

    taskFolders.sort((a, b) => b.folderName.localeCompare(a.folderName));
    return taskFolders;
  }

  dispose() {
    this.stopPolling();
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
