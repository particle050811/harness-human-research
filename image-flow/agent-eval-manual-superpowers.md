# image-flow superpowers 专属流程提示词文档（manual-skill 模式）

> 基于开发文档 `agent-eval-spec.md`（需求输入不变），把原来的单条流程提示词拆成多轮，
> 每轮提示词前面加 superpowers 的 `/skill名` 显式调用，模拟人工主动调用的场景。
> 配套：`eval-config-manual-superpowers.yml`（轮次提示词，脚本实际读取）、`run-eval-manual-skill.sh`（驱动脚本）。
> 其他变体（如 openspec）各写各的专属文档与 `eval-config-manual-<变体>.yml`，脚本按变体名自动取对应配置。

## 流程提示词（共 11 轮，逐轮发送同一会话）

| 轮 | 提示词（开头即 skill 调用） |
|---|---|
| 1 | `/writing-plans` 阅读 agent-eval-spec.md（API 文档在 docs/grsai-api.md），为 §13 的 M1~M8 制定实施计划，只计划不编码 |
| 2 | `/executing-plans` 实施 M1：脚手架 + 端到端生成（扩展骨架、右键 MD 触发、参考图解析、多模型尺寸字段区分） |
| 3 | `/executing-plans` 实施 M2：侧栏化与配置系统（Webview + React、globalState + secrets、三标签页、即时保存） |
| 4 | `/executing-plans` 实施 M3：异步任务机制（async 提交、单定时器轮询、持久化、重启续拉、并发互不干扰） |
| 5 | `/executing-plans` 实施 M4：素材库（手动库 + 当前路径库、右键缩略图插入相对引用、空格路径兼容） |
| 6 | `/executing-plans` 实施 M5：预览请求（与真实提交共用请求体构造，不调 API） |
| 7 | `/executing-plans` 实施 M6：提示词注入（modelInjections + 种子 + IMAGES.md，提交与预览两处生效） |
| 8 | `/executing-plans` 实施 M7：体验打磨（后台提交、进度条计时、MD 跟随编辑器、合并倒序列表） |
| 9 | `/executing-plans` 实施 M8：健壮性收尾（运行时校验、重试判定、空文件夹清理、重入锁、单元测试补齐） |
| 10 | `/verification-before-completion` 运行 compile / check-types / lint / test，全绿为止 |
| 11 | `/requesting-code-review` 对照 spec 全量审查，修复高优先级问题后重跑检查 |

每轮提示词全文以 `eval-config-manual-superpowers.yml` 的 `rounds:` 为准；每轮末尾统一带"完成后自行验证、全程不需要确认"。
若某轮中途出 bug，由人工补一轮 `/systematic-debugging`（不在固定剧本内）。

## 用法

```bash
ROUND=<N> ./run-eval-manual-skill.sh                # 默认 superpowers 变体
ROUND=<N> ./run-eval-manual-skill.sh <变体> [配置]   # 显式指定
```

第 1 轮 `claude -p` 新会话，之后每轮 `claude -p --continue` 续接；隔离机制、测试目录命名（`runs/round<实验轮次>/eval-manual-<变体>-<时间戳>`）、结束后导出 transcript 均与 run-eval.sh 一致。

注意：跑完第一轮先查 transcript 确认 `/skill名` 真的展开了 skill；若被当成普通文本发送，该 run 作废。
