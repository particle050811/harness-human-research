# image-flow wow-harness 专属流程提示词文档（manual-skill 模式）

> 基于开发文档 `agent-eval-spec.md`（需求输入不变），轮次划分与 superpowers/empty 剧本一一对应，
> 每轮提示词前面加 wow-harness 的 `/skill名` 显式调用。
> 配套：`eval-config-manual-wow-harness.yml`（轮次提示词，脚本实际读取）、`run-eval-manual-skill.sh`（驱动脚本）。

## 变体来源与形态

- 上游：<https://github.com/NatureBlueee/wow-harness>，commit `5f80a2bbe9f9354876d234a8175c2dbf0f7879bd`（2026-04-29）
- 固化方式：在空白 git 项目上跑官方安装器 `phase2_auto.py --auto --tier drop-in --scope current`（需 `WOW_HARNESS_INSTALL_HMAC_KEY` 环境变量），把安装产物原样拷入 `skill-variants/wow-harness/project/`（剔除 `install-log.jsonl`）。**测试时不再跑安装器**，setup 直接拷贝固化产物，可复现且不依赖网络。
- 与其他变体的本质差别：wow-harness 不是"按需调用的 skill 集"，而是**常驻治理层**——16 个 hook 注册在项目级 `.claude/settings.json`（7 个生命周期阶段），配 8 门闸状态机（G0→G8，偶数门强制独立审查 agent）与 15 个验证器；`/skill` 前缀只是显式入口，hooks 无论是否调用 skill 都生效。
- drop-in 档不做项目定制，7 个 skill 中 `{{PROJECT_NAME}}`/`{{PROJECT_OWNER}}` 占位符原样保留——这是该 tier 的真实形态，评测按原样进行，报告中注明 tier=drop-in。

## 前缀映射依据

wow-harness skills 按 tier 分层（frontmatter `tier:` 字段）：`lead` 为 entry 层（流程统领/门闸状态机），`harness-dev` 为 execution 层（代码实现/调试/测试闭环），`harness-eng-test` 为测试验证专才。审查无独立 user-invocable skill（由 G8 终审门与独立 review agent 机制承担），故轮 11 回到 `/lead`。

## 流程提示词（共 11 轮，逐轮发送同一会话）

| 轮 | 提示词（开头即 skill 调用） |
|---|---|
| 1 | `/lead` 阅读 agent-eval-spec.md（API 文档在 docs/grsai-api.md），为 §13 的 M1~M8 制定实施计划，只计划不编码 |
| 2 | `/harness-dev` 实施 M1：脚手架 + 端到端生成（扩展骨架、右键 MD 触发、参考图解析、多模型尺寸字段区分） |
| 3 | `/harness-dev` 实施 M2：侧栏化与配置系统（Webview + React、globalState + secrets、三标签页、即时保存） |
| 4 | `/harness-dev` 实施 M3：异步任务机制（async 提交、单定时器轮询、持久化、重启续拉、并发互不干扰） |
| 5 | `/harness-dev` 实施 M4：素材库（手动库 + 当前路径库、右键插入相对引用、空格路径 <> 包裹） |
| 6 | `/harness-dev` 实施 M5：预览请求（与真实提交共用请求体构造，不调 API） |
| 7 | `/harness-dev` 实施 M6：提示词注入（modelInjections + 种子 + IMAGES.md，提交与预览两处生效） |
| 8 | `/harness-dev` 实施 M7：体验打磨（后台提交、进度条计时、生效 MD 跟随、合并倒序列表） |
| 9 | `/harness-dev` 实施 M8：健壮性收尾（运行时校验、重试判定、空文件夹清理、重入锁、单测补齐） |
| 10 | `/harness-eng-test` 逐项跑 compile/check-types/lint/test 至全绿 |
| 11 | `/lead` 对照 spec 完整代码审查，修复高优先级问题后重跑检查 |

完整提示词以 `eval-config-manual-wow-harness.yml` 的 rounds 为准。监工模式下 rounds 仅作剧本参考，实际提示词由评测员逐轮拼写（剧本文本 + 基于上一轮总结的大方向指导），流程见仓库 CLAUDE.md。
