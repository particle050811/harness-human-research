# 报告：四变体 skill 调用率分析（2026-06-10 晚间）

> 涉及运行：eval-superpowers-260610202636、eval-empty-260610231222、eval-gstack-260610231042、eval-openspec-260610231253
> 统一条件：DeepSeek deepseek-v4-pro · Claude Code 2.1.152 · 同一 prompt 全量 M1~M8 · bypassPermissions

## 主题一：调用率数据

| Run | 注入方式 | skill 对模型可见 | Skill 工具调用 |
|---|---|---|---|
| eval-empty-260610231222 | 无（基线） | — | 0（符合预期） |
| eval-superpowers-260610202636 | home 级 14 个 skill + SessionStart hook | 是 | **1**（writing-plans） |
| eval-openspec-260610231253 | project 级 `.claude/skills` 5 个 skill | 是 | 0 |
| eval-gstack-260610231042 | home 级（布局有缺陷，见主题三） | 仅 1 个可见 | 0 |

**核心结论：不是"看不见"，是"不去用"。** run 后追问时，openspec 的 Agent 原话承认"可用的 skills 中也包含了 openspec-propose 等……但我全程没有调用它们"；gstack 的 Agent 也承认"直接手写了所有代码而没有使用任何 skill——这确实是个疏漏"。skill 列表确实进入了上下文，模型自己也能复述出来。

## 主题二：模型不调用的原因

1. **被测模型对 skill 触发指令遵循度弱**：skill 触发完全依赖模型自觉遵循 description 中的指令，deepseek-v4-pro 在此方面遵循度低。
2. **长程任务中 skill 列表只在开头出现一次**：superpowers 唯一一次调用发生在会话第 32 行（全文 463 行），即开场阶段；之后 200+ 轮自主编码循环再未回头。SessionStart hook（日间作废 run 后补入，见 260610-smoke-and-pipeline.md 主题三）只把调用率从 0 提到 1，**hook 解决"开场可见性"，解决不了"中途遗忘"**。
3. **prompt 引导太弱**：仅一句泛泛的"如果你有可用的 skills……请主动使用"，叠加"全程不需要确认直接完成"+ bypassPermissions，把模型推向埋头直接执行。

## 主题三：gstack 变体注入缺陷（run 作废）

整个 gstack 仓库被原样放进 `skills/gstack/`，而 Claude Code 只发现一层深度的 `skills/<名字>/SKILL.md`，故仅顶层 "gstack"（headless browser QA，与本任务无关）可见；嵌套的 review/qa/ship/design-html 等十余个子 SKILL.md 均不可发现。**eval-gstack-260610231042 不能代表 gstack 真实效果，作废；变体布局修复后需重跑。**

## 主题四：评测启示与 TODO

1. 在 deepseek 后端上，"装了 skill"与"用上 skill"之间存在巨大落差；若评测目的是对比 skill 变体优劣，当前结果区分度不足，需先提高调用率，否则各 "with-skills" 变体实际等价于 empty 基线。
2. 这个落差本身是有效结论：**非 Claude 主模型在长程自主任务中几乎不自发使用 skill**，可作为 harness 跨模型兼容性研究的核心数据点。
3. TODO：
   - ① 修复 gstack 变体布局（子 skill 提平为 `skills/<name>/SKILL.md`）并重跑；
   - ② 改用 manual-skill 模式（每轮提示词前加 `/skill名` 模拟人工主动调用，见 `agent-eval-manual-skill.md`）。
