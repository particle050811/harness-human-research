# CLAUDE.md

harness 跨模型 skill 评测项目：用同一份 spec（`image-flow/agent-eval-spec.md`，VS Code 扩展 image-flow 从零开发）评测不同 skill 变体对 AI Agent 产出质量的影响。被测模型经 `~/.claude/settings-deepseek.json` 走 DeepSeek 后端，Claude Code 固定 2.1.152（`~/.claude-2.1.152/`）。

- 运行产物在 `image-flow/runs/round<实验轮次>/`，按轮次分组（round1 自主模式 / round2 固定剧本 / round3 监工模式 / …）；除各 run 顶层 transcript.md/html 进 git 外其余只留本地。新建 run 须以 `ROUND=<N>` 环境变量指定轮次
- 分析报告在 `image-flow/reports/`，命名 `round<实验轮次>-<yyMMdd>-<主题简称>.md`，按时间段拆文件、按主题分节，索引在 `image-flow/eval-report.md`；报告中"对应改进"一节固定写法：问题 → 方案 → 预期效果
- skill 变体源在 `image-flow/skill-variants/<变体>/`（project/ 装进测试目录，home/ 装进隔离的 CLAUDE_CONFIG_DIR）

## 评测驱动方式

**正式评测统一用监工模式**（模拟用户实际使用场景）：所有变体（含 empty 对照组）都由 Claude（评测员会话，即你）逐轮驱动被测会话，流程见下节。empty 的剧本配置在 `eval-config-manual-empty.yml`，与 superpowers 剧本逐轮对应、仅不带 `/skill名` 前缀，用于隔离 skill 的净效果。
早期的全自主模式（`run-eval.sh`，单条 prompt 跑完）与固定剧本模式（`run-eval-manual-skill.sh [变体]` 不带子命令）保留可用，但其历史结果与监工模式结果不可直接混比，报告中须注明驱动方式。

## 监工模式操作流程（评测员会话执行）

```bash
cd image-flow
# 1. 准备：建 run 目录（runs/round<N>/ 下，自动带 eval-manual-supervised- 前缀）、装 skill 变体、隔离配置
ROUND=<实验轮次号> ./run-eval-manual-skill.sh setup <变体>    # empty / superpowers / ...
#    输出 RUN_DIR；剧本各轮参考文本在 $RUN_DIR/.claude-home/rounds/，调用参数在 $RUN_DIR/.claude-home/eval-env
#    （剧本与参数藏在 .claude-home 内、run 目录自带隔离 git 仓库——防止被测会话读到剧本或沿工作树上溯到评测仓库）

# 2. 逐轮循环：把本轮提示词写入文件，后台跑一轮（自动判断是否 --continue 续接会话）
./run-eval-manual-skill.sh round <RUN_DIR> <提示词文件>   # 用后台 Bash 发起，结束会收到通知

# 3. 全部轮次结束后导出对话记录
./run-eval-manual-skill.sh export <RUN_DIR>
```

每轮结束后必须做三件事再发下一轮：

1. **读模型的本轮总结**：round 的 stdout 就是被测模型这一轮的收尾汇报（后台任务输出文件里）；必要时辅以 `git -C $RUN_DIR log --oneline` 和改动文件确认它说的是否属实。
2. **对照 spec 评估**：本轮里程碑对应的 spec 章节逐项核对，发现缺漏记下来（评测员自己要清楚缺什么）。
3. **拼下一轮提示词**：剧本对应轮次的文本（`$RUN_DIR/.claude-home/rounds/NN.txt`，skill 变体自带 `/skill名` 前缀）+ 基于上一轮总结的**大方向指导**。

**指导尺度（关键约束）**：监工只根据模型的轮次总结给方向性反馈，模拟真实用户——可以指出现象和需求出处（如"侧栏进度条在任务进行中不会动，对照 spec §8.4 自查"、"上一轮你说完成了 X，但提交记录里没有对应改动"），**不给代码级细节**（不点名函数、不说在哪个文件加什么调用、不贴代码）。缺陷怎么修由被测模型自己定位。

背景：260611 根因分析（`image-flow/reports/round2-260611-manual-superpowers-vs-baseline.md` 主题四）表明固定剧本下 spec 在执行期离场、上下文压缩后计划只剩切片，导致长尾需求丢失——监工模式的核心是每轮像真实用户一样验收并把方向性反馈送回被测会话，而不是替它写代码。

## 验收

评分前先 `./image-flow/eval-test.sh <变体|RUN_DIR>` 拉起扩展开发宿主做 F5 侧栏运行时检查——"四检全绿"（compile/check-types/lint/test）不等于可用，配置缝隙类缺陷只有运行时能暴露。评分标准在 `image-flow/agent-eval-rubric.md`（评测者自留，不发给被测 Agent）。
