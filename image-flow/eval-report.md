# image-flow Agent 评测报告索引

> 报告按时间段拆分存放于 `reports/`，每份报告内部按主题组织。命名规则：`reports/round<实验轮次>-<轮内序号>-<yyMMdd>-<主题简称>.md`（序号按报告产出先后递增，保证文件名排序即逻辑顺序），轮次与 `runs/round<N>/` 的 run 目录分组对应。
> 横向对比内容不散落在各 run 报告里，每个实验轮次集中为一份对比汇总报告，**轮内序号 00 固定保留给它**（round3 为 round3-00）；后续新增 harness 或重测时只往 00 号补数据，不改其它报告编号。各 run 报告只记单 run 事实。

| 轮次 | 时间段 | 报告 | 内容概要 |
|---|---|---|---|
| round1（自主模式） | 2026-06-10 日间 | [round1-01-260610-smoke-and-pipeline.md](reports/round1-01-260610-smoke-and-pipeline.md) | 管线冒烟（empty M1~M2）；"构建全绿但侧栏白屏"运行时缺陷分析；superpowers 变体缺 SessionStart hook（run 作废） |
| round1（自主模式） | 2026-06-10 晚间 | [round1-02-260610-skill-adoption.md](reports/round1-02-260610-skill-adoption.md) | 四变体 skill 调用率横向对比：skill 可见但几乎零调用，原因分析与 TODO；gstack 变体布局缺陷（run 作废） |
| round2（固定剧本） | 2026-06-11 上午 | [round2-01-260611-manual-superpowers-vs-baseline.md](reports/round2-01-260611-manual-superpowers-vs-baseline.md) | 固定剧本 superpowers 与自主基线对比；根因分析：spec 执行期离场、上下文压缩后计划只剩切片 |
| round3（监工模式） | 2026-06-11 下午 | [round3-01-260611-supervised-empty-trial.md](reports/round3-01-260611-supervised-empty-trial.md) | 监工模式 empty 对照组首跑记录；首个 run 越界写入评测仓库的取证与隔离修复 |
| round3（监工模式） | 2026-06-11 晚间 | [round3-02-260611-supervised-superpowers.md](reports/round3-02-260611-supervised-superpowers.md) | 监工模式 superpowers run：红线核对遗留"合并倒序列表"违例与 2 处偏差；/writing-plans 计划轮重开销与执行轮未缓存输入特征；首轮三次重跑等基础设施事件 |
| round3（监工模式） | 2026-06-12 凌晨 | [round3-03-260612-supervised-openspec.md](reports/round3-03-260612-supervised-openspec.md) | 监工模式 openspec 跑通：红线零遗留，spec 常驻工件对症"执行期离场"根因；每轮工件重读的输入开销形态；M5 零产出轮与 path-guard 首拦截 |
| round3（监工模式） | 2026-06-12 上午 | [round3-04-260612-supervised-gstack.md](reports/round3-04-260612-supervised-gstack.md) | 监工模式 gstack 首跑（变体布局提平后）：`/spec`、`/review` 稳定触发，审查轮自查出文件覆盖 CRITICAL；遗留 2 处 UI 红线违例暴露监工验收清单不一致问题；工具链硬编码路径在隔离下降级的局限与 HOME 重定向方案 |
| round3（监工模式） | 2026-06-12 下午 | [round3-05-260612-supervised-gstack-rerun.md](reports/round3-05-260612-supervised-gstack-rerun.md) | 监工模式 gstack 重跑（HOME 重定向 + 红线清单两改进落地）：红线零遗留，3 处违例均轮内反馈修复；bin 工具链可解析但 `~/.gstack` 状态层未启用；评测员侧通知双发/时钟回跳致前两轮指标失真的取证与纪律固化 |
| round3（监工模式） | 2026-06-12 下午 | [round3-00-260612-supervised-variants-comparison.md](reports/round3-00-260612-supervised-variants-comparison.md) | round3 四变体横向对比汇总（对比内容自 round3-01~05 抽出集中存放）：运行概况/红线逐项/token/过程行为四表对照，gstack 首跑 vs 重跑前后对照，可比性边界清单 |
