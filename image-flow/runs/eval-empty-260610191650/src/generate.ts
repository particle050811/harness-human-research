/**
 * 生成流程 — 同步模式（M1）。
 * 读取 Markdown → 解析参考图 → 提交 API → 下载图片。
 */

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { parseMarkdown, isContentEmpty } from './markdown';
import { submitGenerate, buildRequestBody, downloadImage } from './api';
import { getConfig, getApiKey, getModelInjection } from './config';
import type { ExtensionConfig, JobInfo } from './shared';
import { getImageExtension } from './utils';

/** 拼接最终提示词：注入句 + IMAGES.md + 替换后正文 */
function assemblePrompt(
  config: ExtensionConfig,
  body: string,
  workspaceRoot?: string,
): string {
  const parts: string[] = [];

  const injection = getModelInjection(config, config.model);
  if (injection.trim()) parts.push(injection.trim());

  if (workspaceRoot) {
    const imagesPath = path.join(workspaceRoot, 'IMAGES.md');
    try {
      const imagesContent = fs.readFileSync(imagesPath, 'utf-8').trim();
      if (imagesContent) parts.push(imagesContent);
    } catch { /* 不存在/无工作区静默跳过 */ }
  }

  if (body.trim()) parts.push(body.trim());

  return parts.join('\n\n');
}

// ─── 任务文件夹命名 ──────────────────────────────────

let taskSeqSec = '';
let taskSeqNum = 0;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function nextTaskFolderName(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const sec = `${yy}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  if (sec === taskSeqSec) {
    taskSeqNum++;
  } else {
    taskSeqSec = sec;
    taskSeqNum = 0;
  }
  return `task-${sec}-${taskSeqNum}`;
}

// ─── 主流程 ──────────────────────────────────────────

export async function generateImages(
  context: vscode.ExtensionContext,
  mdPath: string,
  sidebarProvider?: { postMessage(msg: object): void },
): Promise<void> {
  const config = getConfig(context);
  const apiKey = await getApiKey(context);

  if (!apiKey) {
    throw new Error('请先在设置页配置 API Key');
  }

  // 1. 读取 Markdown
  const content = fs.readFileSync(mdPath, 'utf-8');
  if (isContentEmpty(content)) {
    throw new Error('内容为空');
  }

  // 2. 解析参考图
  const mdDir = path.dirname(mdPath);
  const parseResult = parseMarkdown(content, mdDir);

  // 3. 拼接提示词
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mdPath));
  const workspaceRoot = workspaceFolder?.uri.fsPath;
  const finalPrompt = assemblePrompt(config, parseResult.body, workspaceRoot);

  // 4. 建任务文件夹
  const folderName = nextTaskFolderName();
  const taskDir = path.join(mdDir, folderName);
  fs.mkdirSync(taskDir, { recursive: true });

  const mdBaseName = path.basename(mdPath, '.md');
  const concurrency = Math.min(config.concurrency, 10);

  // 用于在多个 job 间接续图片编号
  let imageSeq = 1;
  const allImages: string[] = [];
  const allErrors: string[] = [];

  const jobs: JobInfo[] = [];
  for (let i = 0; i < concurrency; i++) {
    jobs.push({
      id: null,
      status: 'submitting',
      progress: 0,
      imagePaths: [],
      imageUris: [],
    });
  }

  // 通知侧栏任务开始
  sidebarProvider?.postMessage({
    type: 'statusMessage',
    text: `正在生成 ${folderName}…`,
    isError: false,
  });

  // 5. 并发提交并等待结果（同步模式 replyType: 'json'）
  const submitPromises = jobs.map(async (job) => {
    try {
      const body = buildRequestBody({
        model: config.model,
        prompt: finalPrompt,
        images: parseResult.refs.map(r => r.dataUri),
        aspectRatio: config.aspectRatio,
        imageSize: config.imageSize,
        replyType: 'json',
      });

      const resp = await submitGenerate(config.baseUrl, apiKey, body);

      if (resp.status === 'failed' || resp.status === 'violation') {
        job.status = resp.status;
        job.error = resp.error ?? resp.status;
        allErrors.push(job.error);
        return;
      }

      if (resp.status === 'succeeded' && resp.results) {
        job.status = 'succeeded';
        job.id = resp.id;
        // 6. 下载图片
        for (const r of resp.results) {
          const ext = getImageExtension(r.url);
          const fileName = `${mdBaseName}-${imageSeq}.${ext}`;
          const destPath = path.join(taskDir, fileName);
          await downloadImage(r.url, destPath);
          job.imagePaths.push(destPath);
          allImages.push(destPath);
          imageSeq++;
        }
      }
    } catch (err: unknown) {
      job.status = 'failed';
      job.error = String(err);
      allErrors.push(job.error);
    }
  });

  await Promise.all(submitPromises);

  // 7. 处理结果 — 全部失败则清理
  const allFailed = jobs.every(j => j.status !== 'succeeded');
  if (allFailed) {
    try { fs.rmdirSync(taskDir, { recursive: true }); } catch { /* ignore */ }
    const dedupedErrors = [...new Set(allErrors)].join('; ');
    vscode.window.showErrorMessage(`生成失败：${dedupedErrors}`);
    sidebarProvider?.postMessage({
      type: 'statusMessage',
      text: `生成失败：${dedupedErrors}`,
      isError: true,
    });
    return;
  }

  const failedJobs = jobs.filter(j => j.status !== 'succeeded');
  if (failedJobs.length > 0) {
    const dedupedErrors = [...new Set(failedJobs.map(j => j.error).filter(Boolean))].join('; ');
    vscode.window.showWarningMessage(`部分图片生成失败：${dedupedErrors}`);
  }

  sidebarProvider?.postMessage({
    type: 'statusMessage',
    text: `生成完成：${folderName}（${allImages.length} 张）`,
    isError: false,
  });
}
