# Claude Code Skills 对比评测框架

用同一需求文档驱动 AI Agent 从零开发，对比不同 skill 包（empty 基线 / superpowers / gstack / OpenSpec）对开发质量的影响。本 README 是**通用部分**（框架机制与环境配置）；各评测项目的具体用法见项目内 README（如 [image-flow/README.md](image-flow/README.md)）。

## 目录结构

```
harness-human-research/
├── README.md            # 本文档（通用）
├── eval-common.yml      # 公共评测配置（多项目共用）
├── skill-variants/      # skill 变体（多项目共用）
│   ├── empty/  superpowers/  gstack/  openspec/
└── image-flow/          # 评测项目（每个项目一个目录）
    ├── README.md        # 项目用法
    ├── eval-config.yml  # 项目配置（extends 公共配置）
    ├── run-eval.sh      # 评测启动脚本
    └── runs/            # 评测产物（eval-<变体>-<时间戳>/）
```

## 评测框架机制

各项目的 `run-eval.sh <skill变体> [配置文件]` 依次做四件事：

1. **创建测试目录**：项目 `runs/` 下新建 `eval-<变体>-<yyMMddHHmmSS>`（时间戳精确到秒，每次运行独立目录，互不覆盖）；
2. **复制评测材料**：按配置 `files` 列表复制（评分 rubric 为评测者自留，不给被测 Agent）；
3. **安装 skill 变体并隔离配置**：变体的 `project/` 复制进测试目录根、`home/` 复制进测试目录内的 `.claude-home/`，并以其为 `CLAUDE_CONFIG_DIR` 启动——彻底屏蔽 `~/.claude/` 的用户级 skills 与全局 CLAUDE.md，保证各变体（尤其空基线）互不污染；同时预置 onboarding/目录信任标记，新配置目录不会卡在首次引导界面；
4. **前台启动 claude-deepseek**：在测试目录内启动旧版 2.1.152 + DeepSeek settings，注入初始提示词驱动 Agent 完成开发；结束后自动导出对话记录 `transcript.html` + `transcript.md`。

> 多变体对比时建议串行（一个跑完再跑下一个）：并发会共享 DeepSeek 限流与本机 CPU，影响对比严谨性。

## skill 变体（skill-variants/）

每个子目录是一个变体，按作用域分两部分，均可省略：

- `home/` —— 用户级，复制进隔离的 `CLAUDE_CONFIG_DIR`（skills、hooks、settings.json 等）；
- `project/` —— 项目级，复制进测试目录根（如 `.claude/`、`openspec/`）。

| 变体 | 内容 | 来源 |
|---|---|---|
| `empty` | 无任何 skill，基线 | — |
| `superpowers` | `home/skills/` 完整 14 个 skills + 官方 SessionStart hook（`home/hooks/` + `home/settings.json`，会话开始/compact 后注入 using-superpowers，与插件形态行为一致） | `git clone github.com/obra/superpowers` |
| `gstack` | `home/skills/gstack/`（53 个 SKILL.md，纯 description 触发，官方默认无注入 hook） | `git clone github.com/garrytan/gstack`（未跑其 `./setup`） |
| `openspec` | `project/` 下 `.claude/skills/openspec-*`、`.claude/commands/opsx/`、`openspec/`（无 hook，命令驱动） | `npx @fission-ai/openspec init --tools claude` 生成 |

新增变体：在 `skill-variants/` 下建目录放入 `home/` 或 `project/` 即可，无需改脚本。

**注入机制差异**：superpowers 官方自带 SessionStart 注入，gstack/openspec 默认没有——这是各包的产品形态，评测按官方默认配置，不人为拉平。为防「装而不用」，公共 prompt 中含一句对所有变体统一的中性提示（「如有可用的 skills 请在合适环节使用」）。

## 配置（两层结构）

项目配置通过 `extends` 继承公共配置，同名字段项目覆盖公共（`claude` 等字典按字段合并）。

**`eval-common.yml`（公共）**

| 字段 | 说明 |
|---|---|
| `test_root` / `dir_prefix` | 测试目录位置与命名前缀（相对各项目目录解析） |
| `skill_variants_dir` | skill 变体目录，默认 `../skill-variants` |
| `claude.bin` / `claude.settings` | 旧版二进制与 DeepSeek settings 路径 |
| `claude.permission_mode` | 默认 `bypassPermissions` 完全无人值守；要逐步确认可改 `acceptEdits` |

**各项目 `eval-config.yml`**

| 字段 | 说明 |
|---|---|
| `extends` | 指向 `../eval-common.yml` |
| `files` | 复制进测试目录的文件（src → dest） |
| `prompt` | 启动时注入的初始提示词 |

## 新评测项目接入

1. 建项目目录，放入需求文档等评测材料；
2. 复制任一项目的 `run-eval.sh`；
3. 写 `eval-config.yml`（`extends: ../eval-common.yml` + `files` + `prompt`）；
4. `./run-eval.sh <变体>` 即可，产物落在本项目 `runs/` 下。

## DeepSeek 旧版本 Claude Code 配置

目标：全局 `claude` 保持新版本，同时用固定旧版 2.1.152 启动 DeepSeek 配置，共存互不影响。

```bash
# 1. 安装旧版到独立目录（不覆盖全局新版）
npm install --prefix ~/.claude-2.1.152 @anthropic-ai/claude-code@2.1.152

# 2. 验证
~/.claude-2.1.152/node_modules/.bin/claude --version   # 2.1.152 (Claude Code)
claude --version                                        # 全局新版不受影响
```

`~/.bashrc` 中的手动启动别名（评测脚本不依赖它，直接调二进制）：

```bash
alias claude-deepseek='DISABLE_AUTOUPDATER=1 ~/.claude-2.1.152/node_modules/.bin/claude --settings ~/.claude/settings-deepseek.json'
```

- `DISABLE_AUTOUPDATER=1` 防止被自动升回新版；
- DeepSeek 的 API 地址/密钥/模型映射都在 `~/.claude/settings-deepseek.json` 的 `env` 里；
- 两个版本默认共享 `~/.claude/`；评测运行不受此影响（用独立 `CLAUDE_CONFIG_DIR`）。

## 对话记录导出（claude-code-log）

评测脚本结束时自动导出；手动操作时注意两个坑：

```bash
pip3 install --user --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple claude-code-log
```

- 输出 Markdown 必须显式 `--format md`，仅凭 `-o xxx.md` 后缀**不生效**（v1.4.0 实测）；
- 目标文件已存在旧 HTML 时可能被缓存干扰，建议加 `--no-cache` 或先删除旧文件；
- 输入路径要指到 `projects/` 下的具体项目子目录（或单个 `.jsonl`），指 `projects/` 根目录匹配不到文件。

事后交互式回放某次运行：

```bash
cd <run目录> && CLAUDE_CONFIG_DIR=$PWD/.claude-home ~/.claude-2.1.152/node_modules/.bin/claude --resume
```
