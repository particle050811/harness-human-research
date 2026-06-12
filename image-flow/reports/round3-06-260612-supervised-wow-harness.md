# 报告：监工模式 wow-harness 首跑（2026-06-12 晚间）

> 涉及运行：eval-manual-supervised-wow-harness-260612165749
> 统一条件：DeepSeek deepseek-v4-pro · Claude Code 2.1.152 · 同一 spec 全量 M1~M8 · bypassPermissions · 监工模式逐轮驱动，path-guard 全程生效
> 变体形态：上游 commit `5f80a2b` drop-in 档固化产物（tier=drop-in），16 个 hook 注册在项目级 `.claude/settings.json`，8 门闸状态机 + Stop hook 门禁；7 个 skill 含未替换的 `{{PROJECT_NAME}}` 占位符，变体自带 CLAUDE.md 含 TODO 占位，均按交接文档要求原样受测。剧本前缀 /lead（计划、审查）、/harness-dev（M1~M8）、/harness-eng-test（验证）。

## 主题一：运行概况

| 指标 | wow-harness 首跑 |
|---|---|
| 逻辑轮次 | 12（1 计划 + 8 里程碑 + 1 验证 + 1 审查 + 1 补充红线修复轮 R12） |
| 各轮时长（发题→收尾，分钟） | 计划 4.4 / M1 9.0 / M2 6.5 / M3 5.8 / M4 14.0 / M5 2.4 / M6 144.4 / M7 5.0 / M8 6.6 / 验证 0.8 / 审查 4.0 / R12 8.1，合计 ≈211；M6 轮含 142.7 分钟零响应间隙（见主题四），扣除后有效合计 ≈68 |
| 会话墙钟跨度 | 约 3 小时 36 分（16:58~20:34 本地），扣除 M6 间隙有效约 73 分钟 |
| 模型调用 | 766 |
| 上下文压缩 | 2 次（M4 轮、M8 轮，均轮内续接完成） |
| 实现代码 | src 1621 行（9 个 ts 文件）+ 前端 1230 行（sidebar.tsx + sidebar.css） |
| 测试 | 57 例 / 4 套件 / 510 行（mocha + ts-node，未用 @vscode/test-cli，纯函数测试功能等价） |
| 模型自发 git 提交 | 11 次（M1~M8 各 1 + 计划文档 + 审查修复 + R12；其中计划文档与 M4 两次为监工反馈后补提交，非全自发） |
| 四检 | 全绿（评测员复跑确认：check-types / lint 0 error、test 57/57、compile 通过） |
| 监工缺漏反馈 | git 卫生类 3 次（R2 前计划文档未提交、R3 前构建产物悬空、R6 前 M4 整轮未提交）+ 红线缺陷类 1 次（R12 标签页状态丢失） |
| path-guard 拦截 | 0（全程无绝对路径越界尝试；但 R12 出现裸 git 命令上溯评测仓库事件，见主题四） |
| token | 输出 0.71M / 新输入 5.07M / 缓存读 75.6M，总输入处理 80.6M |

注：F5 运行时验收窗口已由 `eval-test.sh` 拉起，运行时结论由人工测试报告记录，评分前须以其为准。R12 为剧本外补充轮（评测员红线核对滞后所致，见改进二），与其它 run 的"11 轮"口径对比时须注明。

## 主题二：红线条目逐项核对（评测员读码确认，非模型自述）

| # | spec 红线 | 结果 | 备注 |
|---|---|---|---|
| 1 | apiKey 进 secrets（§4.2） | 符合 | `config.ts` 全程经 `context.secrets` 存取，globalState 写入前显式 `delete apiKey` |
| 2 | 切换标签保留页内状态（§8.1） | **补充轮反馈后修复** | M2~M11 期间三个 `Tabs.Content` 均无 `forceMount`，非活动标签卸载重建，子组件 useState 全部丢失；R12 反馈现象+出处后修复（forceMount + inactive CSS），修复经读码与四检确认。历次模型共同盲区再次命中 |
| 3 | 单定时器轮询（§7.2） | 符合 | 全任务共享单 `setInterval`，无 running 即停 |
| 4 | 任务内接续编号（§7.2） | 符合 | 编号取全任务 `downloadedImages` 累计 +1；为内存计数口径（重启后从持久化恢复），非扫盘取最大序号，持久化丢失场景存在理论覆盖风险 |
| 5 | 素材库深度/条目上限（§10.2） | 符合 | 深度 ≤3 / 条目 ≤500，递归与单层双处截断 |
| 6 | 提交与预览共用拼装（§7.3/§9） | 符合 | preview 直接 import `buildRequestBody` / `assembleFinalPrompt` |
| 7 | 注入种子只补不覆盖（§4.3） | 符合（自发） | `in` 操作符判键存在，用户清空的空串不被覆盖——该条历史上 gstack 首版违例，本 run 一次做对 |
| 8 | 任务/历史合并倒序单列表（§8.4） | 符合（自发） | `scanHistory` 以 activeTaskDirs 排除进行中，前端按时间倒序合并 |
| 9 | 进行中卡片标题逐字计数（§8.4） | 符合（自发） | 「提交中 x/N」「生成中 done/N · 失败 n」逐字在位，并附逐秒计时 |
| 10 | 聚合进度条 running 取远端进度（§8.4） | 符合（自发） | `computeAggregatedProgress` 按 §8.4 公式均摊，轮询回写 `job.progress`，且抽为纯函数有 8 例单测 |
| 11 | 完成瞬间防闪烁（§8.4） | 符合（自发） | `pushFullTaskUpdate` 单条消息原子携带任务+历史，完成任务移出与历史纳入无时序空窗 |
| 12 | 轮询重入锁（§7.2） | 符合 | `polling` 标志 + try/finally，M3 即在位 |

12 条中 11 条剧本轮内符合（含 4 条 UI 逐字条款自发做对），1 条违例（#2）在补充轮修复后零遗留。

## 主题三：wow-harness 治理层生效观察

- **hooks 在隔离启动下完整生效**：项目级 `.claude/settings.json` 与 `--settings` + `CLAUDE_CONFIG_DIR` 隔离配置正常合并，交接文档最担心的此项风险未发生。`.towow/metrics/` 全程产生 6 类记录；PostToolUse 的 fragment 注入实际发生（R1 写 ADR 时注入 artifact-linkage 片段 626 字节）。
- **Gate 状态机被模型真实采用**：R1 /lead 按 Gate 0→1→3 推进并产出 ADR-001（9 项架构决策）+ PLAN（8 WP + 接缝矩阵 + golden journeys）；Gate 2/4 因 TeamCreate 独立审查机制缺失自行跳过。/harness-dev 各轮收尾固定输出 change propagation checklist / implementation closure / test closure 三段结构——治理模板对汇报格式的约束全程稳定。
- **Stop hook 门禁实测强度有限**：全程 24 条事件。progress.json 无人维护，每轮先 `mechanical_skip(no_progress_json)`；"未提交改动阻塞"仅触发 1 次（M4 轮 `stop_block`），但 1 分钟后即以 `stop_hook_active_guard`（防死循环闸）放行，模型未提交即结束本轮，最终靠监工下轮反馈补提交——门禁未形成实质强制。untracked 新文件不计入"未提交改动"（R1 两份计划文档 untracked 却 `stop_pass(all_committed)`）。无死循环，轮次无显著拉长。
- **独立审查机制在 drop-in 档不可用**：M4 轮 Stop hook 注入的 completion proposal 流程要求调用 `review-readonly` agent，该 agent 定义不存在，模型按规定降级为自检并显式声明。8 门闸中依赖 TeamCreate/独立 agent 的环节（G2/G4/G8 外审）在本形态下全部降级。
- **git 卫生与其门禁定位形成反差**：harness 以 git 门禁为核心机制，但本 run git 卫生类监工反馈 3 次，为 round3 各 run 中最多；其中两次（计划文档、M4）恰是 Stop hook 放行或闸放行的场景。
- **质量信号**：红线 #7/#9/#10/#11 四条历史盲区条款自发做对，M8 自发抽纯函数并为进度公式补单测，终轮审查自查出 P1 重复定义并收敛——是否归因于治理层模板（checklist 强制自报契约一致性）无法与模型随机性分离，留待横向汇总对照。

## 主题四：异常事件

- **M6 轮 142 分钟零响应间隙**：17:43:55 发题附件落盘后至 20:06:38 首条 assistant 输出之间无任何 jsonl 活动，随后轮次正常完成（输出量与耗时均为全场最低档）。期间评测员无任何操作（无重发、无 kill），排除 round3-05 所记的评测员侧误干预类型；原因未定位，疑为后端长时间无响应或排队。该轮时长指标不可比。
- **R12 补充轮 git 链路事件（评测 infra 缺陷）**：评测员在 export（收纳 `.git` 为 `run-git`）之后补发 R12，被测会话发现工作目录无 git 仓库，`git rev-parse --show-toplevel` 上溯到评测仓库——path-guard 仅识别 Bash 命令中的绝对路径，裸 git 命令的隐式上溯不在拦截面（已知局限首次实证）。评测仓库 `.gitignore` 的 `runs/**` 规则挡住了 `git add`（exit 1），模型随后在 run 目录自行 `git init` 并把全部产物连同 R12 修复做成 root-commit 自救，评测仓库零污染。R12 历史在 `.claude-home/run-git-r12`，主历史在 `.claude-home/run-git`。
- **评测员侧小失误**：R12 首次发起时工作目录漂移导致脚本路径解析失败（exit 127），未触达被测会话，重发无影响。

## 对应改进

### 改进一：export 后补轮的 git 链路断裂

**问题**：主题四所记，export 子命令收纳 `.git` 后若再补发轮次，被测会话处于"无仓库"状态——git 操作上溯评测仓库（越界风险仅靠外层 .gitignore 兜底），模型被迫 git init 自救，run 的 git 历史割裂为两个仓库。

**方案**：`run-eval-manual-skill.sh` 的 round 子命令在发起前检测 `$RUN_DIR/.git` 缺失且 `.claude-home/run-git` 存在时，先把 run-git 恢复为 `.git` 再启动；export 保持现行收纳行为不变。

**预期效果**：补充轮与正式轮的 git 链路一致，消除裸 git 命令上溯评测仓库的暴露面，run 历史保持单仓库连续。

### 改进二：红线读码核对的执行时点滞后

**问题**：rubric 已固化"每轮验收含已实现红线读码回归"，但本 run 评测员在 11 轮全部结束后才补做读码核对，红线 #2 违例自 M2 轮起带病通过 9 轮验收，靠剧本外补充轮（R12）修复——轮次口径与其它 run 不再一致，且若违例涉及架构性返工，晚发现的修复成本会远高于轮内反馈。

**方案**：把 rubric 红线表的"首次可核"列并入监工逐轮循环的固定动作：每轮验收第二步（对照 spec 评估）时，先读码核对当轮新增可核条目，再回归既往条目中受本轮改动文件影响的部分；UI 逐字条款（#2、#9）一律读前端代码确认，不采信模型收尾汇报。

**预期效果**：违例在引入轮的下一轮即获反馈与返工机会，恢复"监工缺漏反馈次数"与轮次数的跨 run 可比口径。
