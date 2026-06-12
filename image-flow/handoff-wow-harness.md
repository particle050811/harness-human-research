# wow-harness 变体测试交接文档（260612）

> 背景：leader 要求把 <https://github.com/NatureBlueee/wow-harness> 补充进评测。基础工作已完成（见下），
> 本文档交接给下一个评测员会话执行实际测试。通用流程以仓库 CLAUDE.md 为准，本文只写 wow-harness 特有事项。

## 一、已完成的基础工作

| 产物 | 路径 | 说明 |
|---|---|---|
| 固化变体 | `skill-variants/wow-harness/project/` | 上游 commit `5f80a2b`（2026-04-29）drop-in 档安装产物，setup 时整体拷入 RUN_DIR，无 home 层 |
| 剧本配置 | `image-flow/eval-config-manual-wow-harness.yml` | 11 轮，与 superpowers/empty 逐轮对应；前缀 /lead、/harness-dev、/harness-eng-test |
| 剧本文档 | `image-flow/agent-eval-manual-wow-harness.md` | 变体来源、前缀映射依据、轮次速览 |
| 脚本小修 | `image-flow/run-eval-manual-skill.sh` | setup 写 `.gitignore` 由覆写改为追加，保住变体自带的运行时目录忽略项 |

调研结论（详见剧本文档"变体来源与形态"节）：wow-harness 是常驻治理层，不是按需 skill——16 个 hook 注册在项目级 `.claude/settings.json`，8 门闸状态机 + 独立审查 agent + Stop hook 完成门禁。hooks 全部 Python3 stdlib + git，不调外部 LLM API，与 DeepSeek 后端无冲突。

## 二、待执行步骤

1. **冒烟轮（正式 run 前必做）**：`ROUND=<N> ./run-eval-manual-skill.sh setup wow-harness` 后只发第 1 轮（计划轮），验证下面"三、验证点"全部通过再决定是否继续。冒烟不达标就别烧后面 10 轮的 token。
2. **正式监工 run**：按 CLAUDE.md 监工模式流程逐轮驱动 11 轮（每轮：读总结 → 对照 spec 评估 → 拼下一轮提示词）。
3. **导出与验收**：`export` 导出 transcript；`./eval-test.sh <RUN_DIR>` 跑 F5 运行时检查；按 `agent-eval-rubric.md` 评分。
4. **报告**：写入 `image-flow/reports/round<N>-<序号>-<yyMMdd>-wow-harness-run.md`，注明驱动方式为监工模式、变体 tier=drop-in，索引登记到 `eval-report.md`。

## 三、冒烟轮验证点（逐项确认）

1. **hooks 是否真的触发**：本变体的 hooks 在*项目级* `.claude/settings.json`，而被测会话经 `--settings` + `CLAUDE_CONFIG_DIR` 隔离启动——项目级 settings 应当照常合并加载，但未实测。验证：轮后查 `$RUN_DIR/.towow/metrics/` 是否出现 jsonl 记录（tool-call-counter 每次工具调用都写）。若目录为空，hooks 没生效，测试无意义，先排查（重点怀疑 2.1.152 对 settings.json 中 `"if": "Bash(python *)"` 条件字段的支持）。
2. **项目根定位**：hooks 经 `scripts/hooks/find-project-root.sh` 以 `.wow-harness/MANIFEST.yaml` 为锚定位 RUN_DIR。确认 MANIFEST 已随变体拷入（setup 输出里有 `.wow-harness/`），否则其 fallback 会向上找 CLAUDE.md 越界到评测仓库。
3. **Stop hook 行为**：`stop-evaluator.py` 在有未提交改动时 exit 2 阻塞会话结束，注入"写 completion proposal + 请独立 agent 审查"流程（1 小时 TTL 防死循环）。在 `claude -p` 逐轮模式下这是首次实测——观察轮次是否被显著拉长、是否出现阻塞循环；轮后查 `$RUN_DIR/.towow/metrics/stop-events.jsonl`。这本身是该 harness 的核心机制，属于评测对象，如实记录即可，但若死循环超 TTL 仍不止则中止 run。
4. **与 path-guard 共存**：评测自带 path-guard 在 `.claude-home/settings.json`，与变体项目级 hooks 是合并关系。照常用 `grep -c '拒绝：' <会话jsonl>` 看越界拦截。

## 四、其他注意事项

- 变体根下有自带 `CLAUDE.md`（wow-harness 治理指南，含 TODO 占位）——这是变体本体的一部分，**不要**替它填写项目描述，原样让被测模型面对。
- 7 个 skill 含 `{{PROJECT_NAME}}` 占位符未替换，是 drop-in 档真实形态，不修；报告注明 tier。
- 安装器、HMAC key 与测试无关（产物已固化）；如需升级上游版本，重新走安装器固化并更新剧本文档里的 commit 号。
- 与 empty/superpowers 对比时驱动方式同为监工模式，可直接比；与 round1/round2 历史结果混比须注明驱动方式差异。
