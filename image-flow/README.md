# image-flow Agent 评测项目

评测任务：以 [agent-eval-spec.md](agent-eval-spec.md) 为唯一需求输入，让 Agent 从空目录实现一个 VS Code AI 绘图扩展（M1~M8 八个里程碑）。评分标准见 `agent-eval-rubric.md`（评测者自留，不发给被测 Agent）。**评测结果与发现见 [eval-report.md](eval-report.md)。**

> 框架机制、skill 变体、配置继承、DeepSeek 旧版安装等通用说明见[上层 README](../README.md)。

## 启动评测

```bash
./run-eval.sh superpowers   # 指定变体启动（empty / superpowers / gstack / openspec）
./run-eval.sh               # 不带参数弹出变体选择菜单（IDE 里点击运行也可以）
```

从其他目录启动：

```bash
cd ~/2026-1/harness-human-research/image-flow && ./run-eval.sh empty
```

## 验收插件（评测完成后）

一键拉起 VS Code 扩展开发宿主（自动定位 run 目录、装依赖、构建，无需手动 cd / F5；已适配 WSL）：

```bash
./eval-test.sh              # 测最新一次 run
./eval-test.sh superpowers  # 测该变体最新一次 run
./eval-test.sh runs/eval-empty-260610191650   # 测指定 run
```

窗口弹出后：活动栏点「AI 绘图」图标看侧栏；打开 run 目录里的 `demo.md` 测预览/生成（生成需在设置页填 Grsai API Key，预览不耗额度）。

> **验收要点**：compile/lint/单测全绿不代表可用（已有白屏前科，见报告），必须实际打开侧栏看一眼。

## 查看对话记录

在 `runs/eval-<变体>-<时间戳>/` 内（脚本结束时自动生成）：

```bash
xdg-open transcript.html   # 渲染好的完整对话网页
code transcript.md         # 同内容 Markdown 版
```

## 本项目配置（eval-config.yml）

继承 `../eval-common.yml`，本项目特有：

- `files`：复制 `agent-eval-spec.md` 与 `grsai-api.md`（→ 测试目录 `docs/grsai-api.md`）给 Agent；
- `prompt`：要求按 spec §13 里程碑 M1~M8 推进、四个 npm 检查全过、含统一的 skills 使用提示。

## 每轮 F5 验收后清理 VS Code 状态

被测扩展会把状态写进你日常的 VS Code（WSL 下在 `~/.vscode-server/data/User/` 内）：apiKey → SecretStorage、配置 → globalState、素材库列表 → workspaceState，键为扩展 ID `undefined_publisher.image-flow`。**所有变体产物共用同一扩展 ID**，残留会让下一轮「首次激活种子」行为失真。每轮验收后清理：

```bash
# 删除扩展的 globalStorage 目录（如存在）
rm -rf ~/.vscode-server/data/User/globalStorage/undefined_publisher.image-flow
# 清掉 state.vscdb 里的 Memento 与 secrets 条目
python3 - <<'EOF'
import sqlite3, glob
for db in glob.glob('/home/particle/.vscode-server/data/User/*Storage/**/state.vscdb', recursive=True):
    try:
        con = sqlite3.connect(db)
        n = con.execute("DELETE FROM ItemTable WHERE key LIKE '%image-flow%'").rowcount
        con.commit()
        if n: print(f'{db}: 清除 {n} 条')
    except sqlite3.OperationalError: pass
EOF
```

> `npm test`（@vscode/test-cli）自带临时 user-data-dir，无此问题；仅 F5 手动验收需要。
