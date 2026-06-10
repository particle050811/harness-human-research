# image-flow 人工主动调用 skill 模拟评测（manual-skill 模式）

> 配套文件：`eval-config-manual-skill.yml`（轮次剧本）、`run-eval-manual-skill.sh`（专属驱动脚本）。
> 需求输入仍为原开发文档 `agent-eval-spec.md`（本文档不替代它，只定义驱动方式）。

## 1. 背景与目的

晚间四 run 横向对比（见 `reports/260610-skill-adoption.md`）表明：skill 注入成功、对模型可见，但 deepseek-v4-pro 在单提示词长程自主任务中几乎不自发调用（superpowers 仅开场 1 次，其余 0 次）。

本模式不再考验"自发触发"，而是**模拟一个熟练人类用户的工作方式**：把 M1~M8 的开发流程拆成多轮对话，每轮提示词以 `/skill名` 开头显式调用对应 skill，逐轮驱动同一会话直至完成。由此测量的是：**在 skill 被强制进入工作流的前提下，它们对产物质量的真实增益**——与自主模式 run（eval-superpowers-260610202636 等）形成对照。

## 2. 与自主模式的差异

| | 自主模式（run-eval.sh） | manual-skill 模式（本文档） |
|---|---|---|
| 提示词 | 一条，覆盖 M1~M8 | 按剧本逐轮发送，共 11 轮 |
| skill 触发 | 依赖模型自发 | 每轮 `/skill名` 显式调用 |
| 会话形态 | 单轮长程 | 多轮 headless（`-p` + `--continue`） |
| 测量目标 | 自发使用率 + 产物质量 | skill 工作流的质量增益（排除触发率变量） |

## 3. 轮次剧本（默认 superpowers 变体）

剧本数据以 `eval-config-manual-skill.yml` 的 `rounds:` 为准，本表为人类可读说明：

| 轮 | 调用 skill | 任务 |
|---|---|---|
| 1 | `/writing-plans` | 阅读 spec，为 M1~M8 制定实施计划（只计划不编码） |
| 2 | `/executing-plans` | M1 脚手架 + 端到端生成 |
| 3 | `/executing-plans` | M2 侧栏化与配置系统 |
| 4 | `/executing-plans` | M3 异步任务机制 |
| 5 | `/executing-plans` | M4 素材库 |
| 6 | `/executing-plans` | M5 预览请求 |
| 7 | `/executing-plans` | M6 提示词注入 |
| 8 | `/executing-plans` | M7 体验打磨 |
| 9 | `/executing-plans` | M8 健壮性收尾 |
| 10 | `/verification-before-completion` | 四项命令全绿确认，未过则修复重验 |
| 11 | `/requesting-code-review` | 全量代码审查并修复高优先级问题 |

调试类 skill（`/systematic-debugging`）不进固定剧本：若某轮中途失败，由评测者人工补一轮（记录在案，视为剧本外干预）。

## 4. 使用方法

```bash
./run-eval-manual-skill.sh                # 默认 superpowers 变体
./run-eval-manual-skill.sh superpowers    # 显式指定
```

测试目录命名 `runs/eval-manual-<变体>-<时间戳>`，隔离机制（CLAUDE_CONFIG_DIR、变体安装、材料复制）与 run-eval.sh 一致；结束后同样导出 `transcript.html` / `transcript.md`。

## 5. 记录与评分要点

1. **逐轮核对 skill 是否真正生效**：转录中每轮应出现对应 skill 内容的注入/展开；若 `/skill名` 在 `-p` 模式未被识别（按普通文本发送），该 run 作废并记录原因。
2. **质量对比基线**：同变体自主模式 run + empty 基线 run，三方对比 rubric 得分；重点看 M2 侧栏可用性（历史白屏缺陷点）与 M8 测试质量。
3. **成本记录**：多轮模式 token 消耗预计高于单轮（每轮重读上下文），报告中需记录总耗时与 token，作为"skill 增益 / 成本"权衡数据。
