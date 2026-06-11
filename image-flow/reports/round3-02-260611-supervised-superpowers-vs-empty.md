# 报告：监工模式 superpowers 与 empty 对照（2026-06-11 晚间）

> 涉及运行：eval-manual-supervised-superpowers-260611192131（superpowers 变体）、eval-manual-supervised-empty-260611160043（empty 对照，详见 `round3-01-260611-supervised-empty-trial.md`）
> 统一条件：DeepSeek deepseek-v4-pro · Claude Code 2.1.152 · 同一 spec 全量 M1~M8 · bypassPermissions · 监工模式逐轮驱动，剧本逐轮对应（superpowers 各轮带 `/skill名` 前缀）
> 两 run 同为监工模式可直接对比；与 round1（自主）/round2（固定剧本）的历史结果**驱动方式不同，不可直接混比**，本文凡引用均已注明

## 主题一：运行概况

| 指标 | superpowers | empty |
|---|---|---|
| 逻辑轮次 | 11（1 计划 + 8 里程碑 + 1 验证 + 1 审查） | 11（同构剧本） |
| 各轮活跃时长合计 | 67.2 分钟（另有首次尝试约 35 分钟无产出，见主题五） | 51.5 分钟 |
| 会话墙钟跨度 | 154.6 分钟（含评测员逐轮验收间隔） | 61.7 分钟 |
| 工具调用 | 255 | 216 |
| 上下文压缩 | 1 次（M8 执行中） | 1 次（M7 执行中） |
| 实现代码 | 1939 行 / 19 个 ts·tsx 文件（单文件最大 317 行） | 2261 行 / 11 个文件（media/sidebar.tsx 单文件 658 行） |
| 测试 | 30 例 / 7 文件 / 283 行 | 41 例 / 2 文件 / 324 行 |
| 模型自发 git 提交 | 9 次（逐里程碑 + 审查修复） | 0 次 |
| 四检 | 全绿（评测员本地复跑确认：check-types/lint/build 通过，npm test 30 passing） | 全绿（41 例，round3-01 已复跑确认） |
| 监工缺漏反馈 | 2 次 | 3 次 |

## 主题二：代码质量对比

### 红线条目逐项核对（评测员读码确认，非模型自述）

| spec 红线 | superpowers | empty |
|---|---|---|
| apiKey 进 secrets（§4.2） | 符合（`context.secrets` 存取，config.ts） | 符合（config.ts） |
| 单定时器 + 轮询重入锁（§7.2） | 符合（taskManager.ts `pollTimer` + `polling` 标志） | 符合（generate.ts `_timer` + `_polling`） |
| 注入种子只补不覆盖（§4.3） | 符合（`if (!(model in injections))`） | 符合（同构写法） |
| 提交与预览共用拼装（§7.3/§9） | **部分符合**：共用 `assemblePrompt` 与 `getAspectRatioValue`，但请求参数 JSON 在 previewProvider.ts 内手工重拼，与 apiClient.ts 的提交体构造存在重复，有漂移风险 | 符合：预览直接调用提交同款 `buildRequestBody` 后剔除 prompt/images |
| 素材库深度/上限保护（§10.2） | 符合（`scanImages(path, 3, 500)`） | 符合（深度 ≤3、条目 ≤500） |
| 切换标签保留页内状态（§8） | 符合（App.tsx 三页常驻、`display` 控显隐；系第 4 轮监工反馈后修复） | **不符合**：Radix `Tabs.Content` 未加 `forceMount`，切页即卸载子组件，卡片展开态等局部状态丢失；监工与终轮自审均未发现 |
| 任务/历史合并倒序单列表（§8.4） | **不符合**：TasksTab.tsx 将进行中与历史渲染为两段（历史另起"历史记录"小节），未按文件夹名合并倒序 | 符合（后端合并为单一 `cards` 列表下发） |
| 进行中卡片标题（§8.4） | **偏差**：缺"提交中 x/N"态，提交期间即显示"生成中" | 符合（提交中/生成中两态齐全，round3-01 已逐字核对） |
| 完成瞬间防闪烁（§8.4） | 符合（任务移除与重扫历史在同一条 `pushTasks` 消息内原子下发） | 符合（round3-01 核对） |

小结：红线层面两边各有一处遗留违例——superpowers 漏"合并倒序列表"，empty 漏"标签页状态保留"；后者恰是监工在 superpowers 第 4 轮指出过的同一条款，说明该条是模型盲区，谁被监工点到谁修好。superpowers 另有两处轻度偏差（标题状态词、预览拼装部分重复）。

### 工程结构与可维护性

- **模块划分**：superpowers 按计划文档的文件结构落地为 19 个文件、职责单一（parser/apiClient/taskManager/config/preview 分离），单文件最大 317 行；empty 集中在 11 个文件，前端 658 行单文件、generate.ts 399 行混合提交/轮询/持久化。
- **检查覆盖缝隙**：empty 的 `lint` 脚本只跑 `eslint src/`，**前端 media/sidebar.tsx 不在 lint 范围内**；`compile` 也未串联类型检查。superpowers 的 lint 覆盖 `src/ webview-src/`，compile 串联 check-types && lint && build。即两边"四检全绿"的含金量不同。
- **测试**：empty 多 11 例（41 vs 30），两边都是纯函数测试（解析、尺寸字段、瞬时错误判定、进度均摊等），均真实通过（评测员复跑）。superpowers 按主题拆 5 个 suite 文件，empty 单文件。
- **git 粒度**：superpowers 逐里程碑 9 次提交，信息为 `feat: M<n> <主题>` 式且与实际改动相符（评测员 `--stat` 核对，如 M3 提交同时注明捎带的标签页修复）；empty 全程零自发提交，版本史只有评测员的初始材料提交。提交行为差异系 skill 流程驱动（executing-plans 每任务要求 commit），与 round3-01 观察五一致。

## 主题三：token 消耗对比

会话 JSONL 全量统计（assistant 消息 `message.usage` 累加；superpowers 首次尝试的会话文件已删，其约 35 分钟消耗**未计入**，下表为不完全统计）：

| 指标 | superpowers | empty | 比值 |
|---|---|---|---|
| input_tokens（未命中缓存） | 369.7 万 | 148.7 万 | 2.49× |
| output_tokens | 48.9 万 | 58.0 万 | 0.84× |
| cache_read_input_tokens | 5054.5 万 | 4589.2 万 | 1.10× |
| 输入总处理量（input + cache_read） | 5424 万 | 4738 万 | 1.14× |
| cache_creation | 0 | 0 | — |

分轮分布的关键差异：

1. **计划轮开销悬殊**。superpowers 的 /writing-plans 轮耗时 17.9 分钟、输出 16.6 万 token（占全程输出 34%），产出 3576 行 / 108KB 的计划文档；empty 的计划轮 2.2 分钟、输出 1.5 万 token（计划以会话内文本形式存在）。
2. **执行轮的未缓存输入持续偏高**。superpowers 各执行轮 input_tokens 稳定在 30.9 万~45.9 万；empty 执行轮在 0.8 万~29.3 万间且多数轮低于 10 万。可解释因素（按确定性排序）：每轮 `/executing-plans` 重新注入 skill 正文、SessionStart hook 注入 using-superpowers、模型每轮回读巨型计划文档；自第 2 轮起的 path-guard PreToolUse hook 是否影响缓存命中未单独验证。
3. **输出端 superpowers 反而更省**。扣除计划轮后 superpowers 执行期输出仅 32.2 万，低于 empty 的 56.5 万——有计划在手，执行轮的试错与重写少；但省下的输出远不抵多花的输入。

**流程开销换来了什么**：以未缓存输入 +221 万（2.49×）、活跃时长 +15.7 分钟（+30%，另有 35 分钟废轮）为代价，可量化的收益是——逐里程碑提交的完整版本史（9 vs 0）、更细的模块拆分（19 vs 11 文件、最大单文件 317 vs 658 行）、lint/类型检查的全覆盖、监工反馈少 1 次（2 vs 3）。而在 spec 覆盖正确性这一核心维度上两边打平：各 1 处红线违例 + superpowers 另 2 处轻度偏差，测试数 empty 还多 11 例。监工模式下 skill 的净收益主要体现在工程过程质量，而非功能正确性。

## 主题四：过程行为差异

- **流程形态**：superpowers 按剧本走 /writing-plans → /executing-plans×8 → /verification-before-completion → /requesting-code-review；empty 同构剧本无前缀，模型直接做。两边各发生 1 次上下文压缩（superpowers 在 M8、empty 在 M7），压缩后均能续完。
- **监工反馈**：superpowers 2 次——第 2 轮工作目录纠偏（基础设施问题，见主题五）、第 4 轮标签页状态保留缺漏（spec 层缺陷，当轮修复并捎进 M3 提交）；empty 3 次（预览 JSON 剔除范围、M7 三连漏、另有作废 run 的计划纠偏，详见 round3-01）。仅计 spec 层缺陷则为 1 vs 2~3，superpowers 的逐轮缺漏略少，与"计划文档前置拆解长尾"的预期方向一致，但样本各 1 次不足以下定量结论。
- **终轮自审产出**：superpowers 的 /requesting-code-review 自查出 3 项（P0 webview URI 当文件路径用致插入/打开失效、P1 resume 后超时误判、P2 生成按钮未禁用），全部修复并提交（41be064，评测员核对改动属实）；empty 终轮自查出 6 项（3 高 2 中 1 低）修复 5 项。两边的自审都没抓到各自遗留的红线违例（合并列表 / 标签页状态），说明终轮自审对"行为细节类"条款的召回有限，仍需监工逐条对照 spec。
- **汇报可信度**：superpowers 各轮收尾汇报与 git 提交、文件改动逐一对得上，未发现虚报；审查轮明确记录了"P2 实际影响小、先跳过后补上"的取舍过程。

## 主题五：本 run 基础设施事件（不影响质量结论，影响数据解读）

1. **第 1 轮跑了三次**。第一次因 DeepSeek 后端工具调用丢参（连续 5 次空 Write）35 分钟无产出被终止，该会话 jsonl 已删，**其 token 消耗缺失**，主题三的 superpowers 数字系不完全统计。第二次会话发生路径越界：把评测仓库当项目根，将计划文档写到了 run 目录之外；评测员把文件移回 run 目录内（docs/superpowers/plans/），并在第 2 轮提示词中纠偏，该会话即此后存续的正式会话。
2. **自第 2 轮起加装 path-guard PreToolUse hook**（拦截项目外读写，settings.json 挂 `hooks/path-guard.py`），第 2~11 轮零拦截。empty 对照跑在先、当时无此 hook（其隔离靠 run 目录 git init，详见 round3-01 主题三）——两 run 的运行环境在此点不完全对等。
3. **监工方向性反馈共 2 次**（第 2 轮工作目录、第 4 轮标签页状态），均只给现象与 spec 出处，模型自行定位修复，符合监工协议尺度。
4. 运行时验收（`eval-test.sh` F5 侧栏实测）两 run 均尚未执行，四检全绿不等于侧栏可用（见 round1-01 白屏先例），评分前须补做。

## 主题六：对应改进

### 改进一：红线条目纳入监工逐轮验收清单

**问题**：两 run 各漏一条 §8 红线（合并倒序列表、标签页状态保留）直到收尾仍在，且终轮自审均未召回；监工凭模型汇报+抽查只拦到了其中一边的一条。

**方案**：把 rubric 中"行为细节类"红线整理成监工自用核对清单（约 9 条，即主题二表格），对应里程碑轮（M2/M7）结束时逐条读码核对，发现即按协议给现象级反馈。

**预期效果**：红线违例的发现时点从评分期提前到当轮，两组的遗留缺陷数趋零，组间对比聚焦到"修复所需反馈次数"这一更灵敏的指标。

### 改进二：剥离 skill 输入开销的构成

**问题**：superpowers 未缓存输入达 empty 的 2.49 倍，但 skill 正文注入、计划文档回读、path-guard hook 对缓存的影响三者占比未知，无法判断开销是否可优化。

**方案**：从 JSONL 按消息粒度拆解各轮 input_tokens 来源（skill 注入消息长度、Read 计划文档的工具结果长度），并跑一个带 path-guard 的 empty 对照轮验证 hook 对缓存命中的影响。

**预期效果**：定位 2.49× 输入开销的主要构成；若计划文档回读占大头，可在剧本中引导"按节读取计划"以压缩开销，使 skill 的性价比结论更扎实。

### 改进三：补齐两 run 的运行时验收

**问题**：两 run 均未做 F5 侧栏运行时检查，empty 的 lint 还不覆盖前端文件，"四检全绿"在两边含金量不同，现阶段质量结论缺运行时一环。

**方案**：按 CLAUDE.md 验收节对两个 run 目录各跑 `eval-test.sh`，重点核对侧栏渲染、标签页切换状态保留（empty 的已知违例可顺带运行时确认）、任务卡片交互。

**预期效果**：配置缝隙类缺陷在评分前暴露，rubric 侧栏可用性项按实测打分，且 empty 标签页缺陷的实际影响得到运行时佐证。
