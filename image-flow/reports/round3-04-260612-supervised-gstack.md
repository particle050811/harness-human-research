# 报告：监工模式 gstack 首跑（2026-06-12 上午）

> 涉及运行：eval-manual-supervised-gstack-260612093851（gstack 变体，run 前完成 round1-02 改进二的变体布局提平：53 个子 skill 从 `skills/gstack/<sub>/` 提到 `skills/<sub>/`，run 中 54 个 skill 全部可被发现）
> 统一条件：DeepSeek deepseek-v4-pro · Claude Code 2.1.152 · 同一 spec 全量 M1~M8 · bypassPermissions · 监工模式逐轮驱动，path-guard 全程生效
> 剧本映射（`eval-config-manual-gstack.yml` 新增于本轮）：R1 `/spec`（gstack 的规划入口）、R2~R10 无前缀（gstack 无执行/四检类 skill，沿用 openspec 先例）、R11 `/review`
> 已知局限：gstack 工具链脚本硬编码 `~/.claude/skills/gstack/bin/` 路径，在隔离 CLAUDE_CONFIG_DIR 下不可解析（preamble 逐条 `|| true` 兜底降级）——本 run 实际评测的是 gstack 的 **SKILL.md 文本指导**，而非其 browser/QA/telemetry 工具链全功能

## 主题一：运行概况

| 指标 | gstack |
|---|---|
| 逻辑轮次 | 11（1 计划 + 8 里程碑 + 1 验证 + 1 审查），R9（M8）轮并入进度条缺陷返工 |
| 各轮活跃时长 | 计划 2.0 / M1 10.3 / M2 5.8 / M3 9.3 / M4 4.0 / M5 2.2 / M6 1.5 / M7 4.6 / M8 5.6 / 验证 0.4 / 审查 3.6，合计 49.2 分钟 |
| 会话墙钟跨度 | 57.9 分钟（评测员验收自动化，轮间几乎无间隔） |
| 工具调用 | 330 |
| 上下文压缩 | 2 次（M3 执行中、M8 执行中，均轮内续接完成） |
| 实现代码 | 2681 行 / 27 个 ts·tsx 文件（单文件最大 taskManager.ts 391 行） |
| 测试 | 41 例 / 5 文件 / 290 行 |
| 模型自发 git 提交 | 11 次（R1 未提交计划文件，经监工一次提醒后 R2 起每轮提交，含规范的 feat/fix/chore 前缀） |
| 四检 | 全绿（评测员第 10 轮收尾自行复跑确认） |
| 监工缺漏反馈 | 1 次（M7 聚合进度条 running 记 0，对照 spec §8.4 反馈后 R9 修复） |
| path-guard 拦截 | 1 处（M3 轮 Bash 引用上级 `image-flow/` 路径，提醒后未再越界） |
| token | 输入 4.12M / 输出 0.65M / 缓存读 69.2M，总输入处理 73.3M |

注：F5 运行时验收（`eval-test.sh`）需 GUI 环境，本报告撰写时尚未执行，评分前须补做——round1-01 已证明"四检全绿不等于可用"。

## 主题二：红线条目逐项核对（评测员读码确认，非模型自述）

| spec 红线 | gstack | 备注 |
|---|---|---|
| apiKey 进 secrets（§4.2） | 符合 | configuration.ts 经 `context.secrets` 存取，不进 globalState |
| 单定时器 + 轮询重入锁（§7.2） | 符合 | PollTimer 全任务共享，`_isPolling` 防重叠 |
| 注入种子只补不覆盖（§4.3） | 符合 | 含空串不覆盖；M2 轮自测 5/5 |
| 提交与预览共用拼装（§7.3/§9） | 符合 | previewProvider 直接调 `buildGenerateBody` + `assemblePrompt` 三处统一 |
| 素材库深度/上限保护（§10.2） | 符合 | 深度 3 / 条目 500 |
| 切换标签保留页内状态（§8） | **不符合（遗留）** | Radix `Tabs.Content` 未 `forceMount`，切页即卸载；本 run 监工未反馈（见主题四，跨变体对照见 round3-00 主题二） |
| 任务/历史合并倒序单列表（§8.4） | 符合 | 按文件夹名倒序，自发做对 |
| 进行中卡片标题（§8.4） | **偏差（遗留）** | 标题缺 `提交中 x/N / 生成中 done/N · 失败 n` 计数（仅"进行中"徽章 + 计时），计数移到了展开体内，监工未反馈 |
| 聚合进度条 running 取远端进度（§8.4） | 符合 | 系监工 1 次反馈后修复：M7 初版 running 记 0，进行中不动、终结一次跳满 |
| 完成瞬间防闪烁（§8.4） | 符合 | 审查轮自查修复 `taskUpdate`/`historyUpdate` 顺序（未做运行时观察，待 F5 复核） |

模型轮内自验与终轮审查对"UI 文案/交互逐字条款"依然失明：两处遗留违例（标签页状态、卡片标题）`/review` 轮均未发现——该盲区跨变体复现、属于 deepseek-v4-pro 模型本身的证据汇总见 round3-00 主题二。

## 主题三：skill 触发与净效果观察

- **前缀调用有效**：`/spec` 与 `/review` 的 preamble 均实际执行（会话内有逐条 telemetry/config 探测命令及本地 `~/.gstack/` 状态写入），与 round1 自主模式"可见但零调用"形成对比——监工模式 + 前缀剧本能稳定触发 gstack skill。
- **`/spec` 的实际作用形态**：该 skill 本为"产出 issue + 可选 spawn agent"设计，隔离环境无 GitHub remote，模型落地为本地 `implementation-plan.md`（501 行，八里程碑全覆盖、引用 spec 章节、每里程碑带验证清单）——形态退化但产物质量达标。
- **`/review` 有实质净收益**：审查轮自查出跨 job 图片序号冲突导致 `mdName-1.png` 被后写覆盖的 CRITICAL 缺陷（违反 §7.2 任务内接续编号）并修复（`950326b`），另自查修复防闪烁顺序问题、列出 2 项 LOW 待关注。这是 R2~R10 九轮无 skill 参与后，skill 前缀轮直接捕获红线级缺陷的明确证据。
- **工具链降级的实际表现**：preamble 数十条 `~/.claude/skills/gstack/bin/*` 调用全部静默失败（`|| true`），模型未被卡住、未尝试修复工具链，直接进入主流程；每轮为此消耗一段固定的探测开销。gstack 的 browser QA、checkpoint、learnings 等核心卖点在本装法下完全未参与。

## 主题四：异常事件

- **监工验收尺度不一致（评测员侧缺陷)**：openspec run 中监工对照过"标签页状态保留""卡片标题逐字"两条红线并反馈返工，本 run 逐轮验收只抽查了当轮里程碑主线，两条 UI 红线直到报告期读码才发现，已无轮次可反馈——跨 run 的"监工反馈次数"指标因此不可直接比较（gstack 1 次 vs openspec 3 次，部分差异来自监工而非模型）。
- R11 首次发起时评测员脚本路径写错（exit 127），未触达被测会话，重发后正常；不计入被测模型轮次。
- path-guard 拦截 1 处（M3 轮），stderr 回灌后模型当轮即改用项目内路径，后续七轮无再犯。

## 对应改进

### 改进一：监工验收固化为红线清单逐轮核对

**问题**：主题四所述，监工逐轮验收无固定清单，凭当轮里程碑主线抽查，导致两条 UI 红线（§8 标签页状态、§8.4 卡片标题）漏报至报告期，且使"监工缺漏反馈次数"指标在 run 间不可比。

**方案**：把主题二的红线表沉淀为固定核对清单（放 `agent-eval-rubric.md` 或监工流程文档），每轮验收按"当轮里程碑条款 + 已实现红线全量回归"两段执行；反馈仍按监工尺度只给现象与出处。

**预期效果**：红线违例在对应里程碑轮内即被反馈，模型获得同等返工机会；"监工缺漏反馈次数"恢复跨 run 可比性。

### 改进二：gstack 工具链在隔离环境不可用

**问题**：题头局限所述，gstack 脚本硬编码 `~/.claude/skills/gstack/bin/`，CLAUDE_CONFIG_DIR 隔离只重定向配置目录不重定向 `~`，工具链全程降级，评测覆盖不到 gstack 的工具能力。

**方案**：后续轮次试验对被测会话同时重定向 `HOME`（指向 `$RUN_DIR/.home`，内置 `.claude -> .claude-home` 软链），使 `~/.claude/skills/gstack/` 可解析；先用单轮冒烟确认 HOME 重定向不破坏 node/git/claude 自身。

**预期效果**：gstack 以全功能形态受测，与"纯文本指导"形态的本 run 对照，可分离出工具链本身的增量价值。
