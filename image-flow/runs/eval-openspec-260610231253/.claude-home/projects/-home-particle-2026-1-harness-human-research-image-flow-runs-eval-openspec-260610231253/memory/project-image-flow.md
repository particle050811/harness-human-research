---
name: project-image-flow
description: image-flow VS Code 扩展已完成全部 M1-M8 里程碑实现
metadata: 
  node_type: memory
  type: project
  originSessionId: 1b8f19a5-6896-47d0-9aba-e133cf32d1e0
---

image-flow VS Code 扩展已按 agent-eval-spec.md §13 的 M1-M8 里程碑顺序从空目录完成全部开发。

**技术栈**: TypeScript + esbuild (两产物: dist/extension.js CJS + media/sidebar.js IIFE) + React 19 + Radix UI

**已完成的关键功能**:
- M1: 扩展骨架、Markdown 参考图解析（含尖括号路径）、多模型尺寸字段区分
- M2: Webview 侧栏三标签页（工作台/任务/设置）、配置系统（secrets + globalState）
- M3: 异步任务（提交→轮询→下载）、持久化与重启续拉、并发任务
- M4: 手动素材库（递归扫描保护）+ 按 MD 路径逐层自动素材库、右键插入引用
- M5: 预览请求文档（四段格式）
- M6: modelInjections 配置、首次激活种入种子、IMAGES.md 注入
- M7: 后台提交、进度条+逐秒计时、活动 MD 跟随、任务/历史合并倒序列表
- M8: 运行时响应校验、瞬时错误重试、空文件夹清理、重入锁、39 个单元测试

**验证状态**: npm run compile（check-types + lint + esbuild）和 npm test（39/39）全部通过。
