# 报告：管线冒烟与变体修复（2026-06-10 日间）

> 涉及运行：eval-empty-260610191650（冒烟）、eval-superpowers-260610195157（作废）

## 主题一：评测管线冒烟验证

**运行条件**：empty 变体（无 skill）· DeepSeek（deepseek-v4-pro，effort max）· Claude Code 2.1.152 · 范围限定 M1~M2 · headless `-p` 模式 · 耗时约 14 分钟。

**结果概览**：Agent 自行完成 M1+M2 并正常退出。产物含双 esbuild 构建、三套 tsconfig、React 19 + Radix 侧栏、17 条单元测试；`npm run compile`（check-types + lint + 双构建）经评测者实测全部通过。对话记录已自动导出 `transcript.html`。

## 主题二：构建全绿但侧栏白屏（运行时崩溃）

**症状**：F5 启动扩展开发宿主后，「AI 绘图」侧栏面板空白。Webview 控制台报
`Uncaught ReferenceError: React is not defined`（sidebar.js）。

**根因链**（已通过无头浏览器复现与修复验证）：

1. `media/sidebar.tsx` 按 `react-jsx` 自动运行时风格编写，未 `import React`；
2. `tsconfig.webview.json` 配置了 `"jsx": "react-jsx"` → **tsc 类型检查通过**；
3. 但项目无根 `tsconfig.json`（只有 main/webview/test 分式三份），esbuild 只自动读根 tsconfig，且 `esbuild.webview.mjs` 未显式传 `jsx`/`tsconfig` 选项 → esbuild 回退默认 classic 转换，bundle 生成 20 处 `React.createElement(...)`；
4. classic 调用引用全局 `React`（实际只是 bundle 内部变量）→ ReferenceError → React 挂载代码未执行 → 白屏。

**修复**（一行）：`esbuild.webview.mjs` 增加 `tsconfig: 'tsconfig.webview.json'`，使 esbuild 与 tsc 同用自动运行时。重建后 `React.createElement` 残留 0 处，无头浏览器验证 UI 正常渲染。

**启示**：

1. **「测试全绿」≠「可用」**：本缺陷属于 tsc 与 esbuild 配置不一致的缝隙，compile / check-types / lint / 单元测试全部无法捕获。正式评测验收时，除跑测试外**必须做一次 F5 打开侧栏的运行时人工检查**（rubric 中 M2 侧栏可用性项应据此打分）。
2. **配置缝隙类缺陷可能是变体间的区分点**：不同 skill 变体（如带 verification-before-completion 的 superpowers）是否会主动做运行时验证、能否避免此类缺陷，值得正式评测时重点对比。
3. **样本污染声明**：本 run 产物已被评测者修改两处——补 `.vscode/launch.json`（当时 spec 尚无此要求，现已加入 §2）、修复 `esbuild.webview.mjs`。**此 run 不可再作为纯净评分样本**，仅作管线冒烟验证与问题分析用。
4. spec 已因本次发现追加一条（§2）：要求产物提供 `extensionHost` 类型的 `.vscode/launch.json`，保证 F5 可直接调试。

## 主题三：superpowers 变体缺 SessionStart hook（run 作废）

首次 superpowers 正式运行（eval-superpowers-260610195157）发现：skills 对模型可见（会话中出现 231 次）但 **Skill 工具调用 0 次**——纯 skills 安装缺少官方插件的 SessionStart hook（启动/compact 后注入 using-superpowers 指令），模型不会主动用。已将官方 hook 移植进变体（`home/hooks/` + `home/settings.json`），端到端实测注入生效。**本 run 不能代表 superpowers 真实效果，作废；变体修复后需重跑。**

## 主题四：对应改进

### 改进一：运行时验收纳入评分流程

**问题**：主题二的白屏缺陷属于 tsc 与 esbuild 配置不一致的缝隙，compile / check-types / lint / 单元测试全部无法捕获；若验收只看"四检全绿"，此类缺陷会带着满分进入评分。

**方案**：三步落地。① spec §2 追加 launch.json 要求（`extensionHost` 类型、`outFiles` 指向 `dist/`），保证每个产物 F5 可直接启动调试；② 写一键验收脚本 `eval-test.sh`，按变体名或 run 目录定位产物、补装依赖与构建、拉起扩展开发宿主（WSL 下自动改走 Windows 侧 VS Code）；③ 验收流程规定每个正式 run 评分前先跑该脚本做一次侧栏运行时检查。①②已落地，③待下一次正式评分时执行。

**预期效果**：运行时缺陷在评分前必然暴露，rubric 的 M2 侧栏可用性项按实际运行表现打分；同时"哪些变体能自行避免配置缝隙类缺陷"成为可观测的区分点。

### 改进二：superpowers 变体补齐 SessionStart hook

**问题**：主题三所述，纯 skills 目录安装缺少官方插件的 SessionStart hook，模型开场看不到 using-superpowers 指令，Skill 调用为 0，首次正式 run 作废。

**方案**：将官方 hook 移植进变体（`home/hooks/` + `home/settings.json`），启动与 compact 后自动注入 using-superpowers 指令；端到端实测注入生效。

**预期效果**：消除"装了但开场不可见"这一环境因素，使后续 run 的调用率数据反映模型行为本身。修复后变体已用于当晚重跑，结果（调用率仅 0→1）见 round1-02-260610-skill-adoption.md。
