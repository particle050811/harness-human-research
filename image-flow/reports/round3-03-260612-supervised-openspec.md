# 报告：监工模式 openspec 跑通（2026-06-12 凌晨）

> 涉及运行：eval-manual-supervised-openspec-260611231038（openspec 变体）
> 统一条件：DeepSeek deepseek-v4-pro · Claude Code 2.1.152 · 同一 spec 全量 M1~M8 · bypassPermissions · 监工模式逐轮驱动，剧本逐轮对应（openspec 剧本新增于本轮：R1 `/opsx:propose`、R2~9 `/opsx:apply`、R10~11 与 empty 同样无前缀，见 `eval-config-manual-openspec.yml`）
> 与 empty/superpowers/gstack 的横向对比统一见 `round3-00-260612-supervised-variants-comparison.md`，本文只记本 run 事实；引用 round1/round2 历史结果处均已注明驱动方式
> 本轮新增依赖：openspec CLI 1.4.1 全局安装（`@fission-ai/openspec`，与变体 skills 生成版本一致），path-guard 全程生效

## 主题一：运行概况

| 指标 | openspec |
|---|---|
| 逻辑轮次 | 11（1 计划 + 8 里程碑 + 1 验证 + 1 审查），另有 M5 一次零产出重发（见主题五） |
| 各轮活跃时长合计 | 60.4 分钟（含零产出轮 1.8 分钟） |
| 会话墙钟跨度 | 60.5 分钟（评测员验收自动化，轮间几乎无间隔） |
| 工具调用 | 333 |
| 上下文压缩 | 2 次（M4 执行中、验证轮与审查轮之间） |
| 实现代码 | 2063 行 / 16 个 ts·tsx 文件（单文件最大 task-manager.ts 448 行） |
| 测试 | 42 例 / 1 文件 / 316 行（审查轮自发新增 10 例） |
| 模型自发 git 提交 | 0 次 |
| 四检 | 全绿（评测员逐轮及收尾复跑确认，42 passing） |
| 监工缺漏反馈 | 3 次（其中 2 次为同一条款返工） |
| path-guard 拦截 | 1 处（首轮两次读上级 spec，提醒后未再越界） |

注：F5 运行时验收（`eval-test.sh`）需 GUI 环境，本报告撰写时尚未执行，评分前须补做——round1-01 已证明"四检全绿不等于可用"。

## 主题二：红线条目逐项核对（评测员读码确认，非模型自述）

| spec 红线 | 结果 | 备注 |
|---|---|---|
| apiKey 进 secrets（§4.2） | 符合 | config.ts，secrets 存取 |
| 单定时器 + 轮询重入锁（§7.2） | 符合 | task-manager.ts `pollTimer` + `isPolling`，try/finally 释放 |
| 注入种子只补不覆盖（§4.3） | 符合 | `!(model in injections)`，含空串不覆盖，侧栏注册前完成 |
| 提交与预览共用拼装（§7.3/§9） | 符合 | 预览直接调用 api.ts 的 `buildRequestBody`（提交同款，api.ts:139/preview.ts:26），`assemblePrompt` 三处统一 |
| 素材库深度/上限保护（§10.2） | 符合 | 深度 3 / 条目 500 |
| 切换标签保留页内状态（§8） | 符合 | 系第 4 轮监工反馈后修复：第 3 轮总结声称"display:none 保留状态"，读码实为 `Tabs.Content` 未 `forceMount`，切页即卸载 |
| 任务/历史合并倒序单列表（§8.4） | 符合 | 前端合并为单列表按文件夹名倒序，自发做对 |
| 进行中卡片标题（§8.4） | 符合 | 经两次监工反馈：首修缺"提交中 x/N"，二修自创"提交+生成中"混合态，第三版才逐字符合 |
| 完成瞬间防闪烁（§8.4） | 符合 | `onTaskCompleted` 在移除卡片的同条 `taskUpdate` 内携带新历史；未做运行时观察，待 F5 验收复核 |

小结：**本 run 红线零遗留违例**。代价是 UI 文案条款上消耗了 3 次监工反馈中的 2 次，且两条 UI 缺陷（标签页、标题）模型自己的轮内验证和终轮审查都没发现，仍靠监工逐字对照才暴露——"文案逐字符合"类条款的盲区跨变体复现，证据汇总见 round3-00 主题二。

### 工程结构与可维护性

- **模块划分**：16 文件、parser/api/task-manager/config/materials/preview/prompt 职责分离；审查轮自发抽出 `parse-refs.ts`/`preview-format.ts` 纯函数并补测试。
- **检查覆盖**：lint 覆盖 `src/ media/`（前端在内），compile 串联 check-types && lint && build，"四检全绿"无覆盖缝隙。
- **git 粒度**：全程零自发提交。openspec 工作流的进度载体是 `tasks.md` checkbox（58 条逐项勾选）而非版本史，流程中无要求 commit 的环节。
- **审查轮自查力**：终轮自查出 8 项问题并修复，含 2 处真缺陷（插图未校验目标编辑器即生效 MD §10.3、apiKey 变更误发空 stateSync 清空前端状态 §8.1）——但同样漏掉了当时尚未修对的标题文案。

## 主题三：token 消耗

会话 JSONL 全量统计（assistant `message.usage` 累加；M5 零产出轮**已计入**）：

| 指标 | openspec |
|---|---|
| input_tokens（未命中缓存） | 257.8 万 |
| output_tokens | 62.0 万 |
| cache_read_input_tokens | 6772.7 万 |
| 输入总处理量（input + cache_read） | 7031 万 |

开销形态：每个 `/opsx:apply` 轮都要先跑 `openspec status`/`openspec instructions` 再重读 proposal/design/delta-spec/tasks 等工件，工件常驻换来的是每轮固定的重读开销，输入总处理量因此偏高；但工件结构稳定、缓存命中好，未缓存输入占比相对低。工具调用 333 次同源于每轮的 CLI 调用与工件读写。横向定量比较见 round3-00 主题三。

## 主题四：openspec 工作流的对症性观察

round2-01 的根因结论是：固定剧本下 spec 在执行期离场、上下文压缩后计划只剩切片，长尾需求丢失。openspec 的机制恰好对症：

- **spec 转译为项目内常驻工件**：propose 轮把 spec 全量转译成 proposal/design/8 个 capability delta-spec/58 条 checkbox 任务，落在 `openspec/changes/` 目录里；之后每轮 apply 都从磁盘重新加载，上下文压缩（本 run 发生 2 次）不影响需求完整性。长尾条款（扫描上限、种子不覆盖、`<>` 包裹、合并倒序）全部进了任务清单并逐条落实，本 run 红线零遗留。
- **进度自报口径漂移**：模型对任务总数的自述在 52/58 间漂移（propose 轮自称 52 条，apply 轮起按 58 计），不影响实际执行但提示其汇报数字不可尽信，验收仍须以 `tasks.md` 实勾与代码为准。
- **skill 调用形态**：`/opsx:*` 命令内嵌 `openspec` CLI 调用，模型每轮都实际执行（与 round1 自主模式下"skill 可见但零调用"形成对照）——监工模式 + 命令前缀的组合再次确认是 deepseek-v4-pro 用上 skill 的前提。

## 主题五：异常事件

1. **M5 首发零产出**：第 6 轮发出后模型只读了几个文件即 `end_turn`，无文本无改动（活跃 1.8 分钟）。监工以"上轮无产出"提醒重发后正常完成。系 DeepSeek 偶发提前收 turn，与变体无关（同类事件的跨 run 汇总见 round3-00 主题四）；该轮 token 已计入主题三。
2. **path-guard 首轮拦截**：propose 轮模型把 spec 猜成上级 `image-flow/agent-eval-spec.md` 两次被拦，stderr 提示后改用项目内副本，全程未再越界——守卫上线后首个完整 run 验证了"拦截 + 回灌提示"闭环有效。

## 对应改进

- **问题**：DeepSeek 偶发零产出轮（本 run M5 即一例），目前靠评测员肉眼识别。
  **方案**：`round` 子命令结束时检测本轮 stdout 为空且 run 目录无文件 mtime 变化，是则在输出尾部打印"疑似零产出轮"警示行。
  **预期效果**：零产出轮有统一识别口径，评测员不漏判，报告统计可直接引用。

- **问题**："UI 文案逐字符合"类条款（卡片标题、阶段提示）是 deepseek-v4-pro 稳定盲区（跨变体证据见 round3-00 主题二），自查不出，消耗监工反馈轮次。
  **方案**：在 M7 与验证轮的剧本文本中统一加一句"界面文案与 spec 给出的格式逐字对照"（四个变体剧本同步修改，保持对等）。
  **预期效果**：把文案核对从监工反馈前移到模型自查，减少返工轮次，监工反馈聚焦真缺陷。

- **问题**：本 run 的 F5 运行时验收尚未执行，红线表中"防闪烁"等运行时表现仅有读码结论。
  **方案**：在 GUI 环境跑 `./image-flow/eval-test.sh runs/round3/eval-manual-supervised-openspec-260611231038`，结果补记入本报告主题二。
  **预期效果**：评分依据完整，避免"四检全绿但侧栏白屏"类缺陷漏检（round1-01 前例）。
