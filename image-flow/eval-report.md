# image-flow Agent 评测报告索引

> 报告按时间段拆分存放于 `reports/`，每份报告内部按主题组织。命名规则：`reports/round<实验轮次>-<yyMMdd>-<主题简称>.md`，轮次与 `runs/round<N>/` 的 run 目录分组对应。

| 轮次 | 时间段 | 报告 | 内容概要 |
|---|---|---|---|
| round1（自主模式） | 2026-06-10 日间 | [round1-260610-smoke-and-pipeline.md](reports/round1-260610-smoke-and-pipeline.md) | 管线冒烟（empty M1~M2）；"构建全绿但侧栏白屏"运行时缺陷分析；superpowers 变体缺 SessionStart hook（run 作废） |
| round1（自主模式） | 2026-06-10 晚间 | [round1-260610-skill-adoption.md](reports/round1-260610-skill-adoption.md) | 四变体 skill 调用率横向对比：skill 可见但几乎零调用，原因分析与 TODO；gstack 变体布局缺陷（run 作废） |
| round2（固定剧本） | 2026-06-11 上午 | [round2-260611-manual-superpowers-vs-baseline.md](reports/round2-260611-manual-superpowers-vs-baseline.md) | 固定剧本 superpowers 与自主基线对比；根因分析：spec 执行期离场、上下文压缩后计划只剩切片 |
| round3（监工模式） | 2026-06-11 下午 | [round3-260611-supervised-empty-trial.md](reports/round3-260611-supervised-empty-trial.md) | 监工模式 empty 对照组首跑记录；首个 run 越界写入评测仓库的取证与隔离修复 |
