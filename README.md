# Page Studio Shared AI Development Environment

This directory is isolated from all pre-existing projects on the host.

## Layout

- `projects/`: new Page Studio projects only
- `project-template/`: reusable, content-free project seed
- `bin/new-project.sh`: creates a new isolated Git repository without overwriting an existing path
- `bin/validate-environment.sh`: checks the shared environment
- `bin/page-autodev`: durable state-machine controller
- `systemd/`: background retry service and timer

Global Claude assets live in `~/.claude/`:

- `skills/page-autodev/SKILL.md` provides `/page-autodev`
- `workflows/page-autodev.md` is the workflow source of truth
- `agents/` contains requirement, architect, reviewer, developer, and QA specialists
- `skills/archify/` contains Archify

## Create a project

```bash
~/page-studio-dev/bin/new-project.sh my-project
cd ~/page-studio-dev/projects/my-project
claude
```

Inside Claude Code, run:

```text
/page-autodev start requirements discovery
```

For continuous unattended execution, leave Claude Code and run from the project directory:

```bash
page-autodev start
```

The user timer retries paused work every 15 minutes. Quota limits are recorded as `quota_paused`; the controller waits until `resume_after` before trying again. Material business decisions become `blocked` and require explicit input.

Useful commands:

```bash
page-autodev status
page-autodev routing
page-autodev resume
page-autodev stop
systemctl --user status page-autodev@PROJECT.service
```

將所有原始資料直接放入專案的 `docs/input/` 即可，不需要人工分類。完整流程為：原始資料分析與分類 → 需求 → 需求 Gate → 架構 → 架構 Gate → 規格 → 規格 Gate → 相依排程 → 排程 Gate → 逐任務開發 → 實作 Gate → QA → 完成。

Git 與品質規則：新專案使用 `main` 並建立初始 commit；每個階段前後建立本機 checkpoint，但絕不自動 push。AI Gate 前會先執行 JSON、任務相依、Git whitespace，以及專案已定義的 lint、typecheck、test、build 機器檢查。

## Resume

## 整體專案進度

所有終端與 Telegram 狀態訊息都會顯示「整體專案進度 X%」。百分比依已驗證完成的工作單元計算，不由 AI 主觀猜測：原始資料 5%、需求與關卡 15%、架構與關卡 20%、規格與關卡 15%、排程與關卡 10%、實作與關卡 25%、最終 QA 10%。尚未完成或尚未通過的工作單元不會提前計入。

Open the project directory, start `claude`, and run `/page-autodev`. The workflow resumes from `.ai/PROJECT_STATE.json`.

## Safety

- The creator refuses to overwrite an existing project path.
- Each project is its own Git repository.
- The workflow may not edit sibling projects.
- Push, deployment, infrastructure changes, and destructive operations require explicit approval.
- Existing host projects are not imported, modified, or moved.

## Validate

```bash
~/page-studio-dev/bin/validate-environment.sh
node ~/.claude/skills/archify/bin/archify.mjs doctor
```

Authentication is intentionally interactive. Run `claude` once and choose the Claude Pro/Max login option. Do not place API keys in project files.

## Telegram 安全控制

Telegram Bot 僅接受已設定 `TELEGRAM_CHAT_ID` 的固定指令，且只能操作 `~/page-studio-dev/projects/` 內具備完整專案骨架的專案。

```text
/projects
/status <專案名稱>
/progress <專案名稱>
/watch <專案名稱>
/unwatch <專案名稱>
/resume <專案名稱>
/stop <專案名稱>
/routing <專案名稱>
/log <專案名稱>
/help
```

`/resume` 會建立獨立背景服務並立即回覆，不會讓 Bot 等待 Claude 執行完成。系統不接受任意 Shell、任意路徑、Git push、部署、刪除或重設指令。所有收到、拒絕、成功與失敗的控制動作都會記錄於：

```text
~/.local/state/page-autodev/telegram-control-audit.jsonl
```

服務管理：

```bash
systemctl --user status page-autodev-telegram.service
systemctl --user restart page-autodev-telegram.service
journalctl --user -u page-autodev-telegram.service -n 100 --no-pager
```

從 VS Code Terminal 即時查看背景流程（按 `Ctrl+C` 只會離開觀看，不會停止開發）：

```bash
page-autodev watch <專案名稱>
```

## Context 與 Token 優化

- 每個流程階段使用新的 Claude 工作階段，並停用會話持久化，避免累積先前對話。
- Claude Context 使用率約達 80% 時提早自動壓縮。
- 控制器依階段提供文件路由；Agent 先讀 `docs/context/*.md`，再定點回查原始證據。
- `docs/input/` 的原始檔、CSV、JSON、圖片、PDF、試算表與驗證收據不會被 Markdown 取代或刪除。
- Gate 與 QA 保留完整需求追溯；Token 優化只改變閱讀順序，不降低證據要求。
- 完整 Archify HTML、圖片位元內容、依賴目錄、建置輸出與 `.ai/logs` 不直接載入 Context。

精簡閱讀層：

```text
docs/context/INPUT_DIGEST.md
docs/context/PROJECT_CONTEXT.md
docs/context/TRACEABILITY.md
```

## 原子工作單元與自動續跑

Archify 圖表不再以單一大任務同時完成所有工作。每張圖預先拆成「結構化規格 → validate／deliver → showcase／visual-check／證據」三個可續跑單元，通常分別使用 10、10、12 turns。控制器會偵測舊版大單元並自動遷移；已存在的 JSON 與 HTML 會直接保留，只執行尚未完成的驗證或證據收尾，避免反覆生成圖表與浪費 Token。

其中結構化規格存在後，`validate`、`deliver`、`visual-check`、HTML SHA-256 與收據一致性全部由控制器直接執行，不消耗 Claude turns；Claude 只負責第一次建立／修復規格，以及後續 Architecture Gate 的需求語意審查。任何 AI 工作單元達 turns 上限時，控制器會保存 `session_id` 並以 `--resume` 延續同一個 Claude session，不再開新 session 重讀全部 Context。工作單元完成後即停止沿用該 session，保持跨任務 Context 隔離。

### 受控併行（第一階段）

系統預設最多同時執行 2 個彼此獨立的唯讀 Gate／QA 審查單元。這些 Agent 不具備 Write 或 Edit 權限，完成後由控制器統一解析結果；任一審查失敗仍會退回原生產階段修復。會寫入檔案的需求、架構、規格、排程與程式開發目前維持單線，避免相同工作樹的檔案衝突。未來只有在獨立 Git worktree、檔案範圍與相依檢查全部成立後，才可啟用寫入型併行。

設定位於 `.ai/AUTODEV_CONFIG.json`：`parallel_execution.max_concurrency` 預設為 2，安全上限為 3；設為 `enabled: false` 可完全關閉。Claude 額度不足時，整批未完成單元會保存並等待續跑，不會把半完成結果視為通過。

### 寫入型併行（第二階段）

實作階段會從 `.ai/TASK_GRAPH.json` 選出至少 2 個相依已完成、範圍不重疊、非高風險的任務。每個任務必須提供：

```json
{
  "id": "TASK-101",
  "status": "pending",
  "depends_on": [],
  "risk": "medium",
  "parallel_policy": "isolated",
  "write_scope": ["src/customer/**", "tests/customer/**"],
  "verification": [["npm", "run", "test", "--", "customer"]]
}
```

每個 Worker 位於 `~/page-studio-dev/system/worktrees/<專案>/<批次>/<任務>`，只能提交自己宣告範圍內的檔案。控制器會拒絕 `.ai/`、套件與 lockfile、Migration、CI/CD、環境設定、認證／權限等共用或高風險範圍。全部 Worker 先產生候選 commit，再由 integration worktree 依序 cherry-pick、逐任務執行白名單驗證；全部通過才以 fast-forward 合併回主專案。任何範圍違規、Git 衝突或測試失敗都不會更新主專案。

使用 `page-autodev parallel <專案>`，或 Telegram `/parallel 專案`、`/workers 專案` 查看批次、Worker、候選 commit 與整合收據。舊任務若沒有上述安全欄位會自動維持單線，不受影響。

大型階段會在執行前主動拆分並保存至：

```text
.ai/PHASE_TASK_GRAPH.json
```

每個工作單元都有獨立 turns 預算、狀態、證據、Git checkpoint、續跑次數與無進度計數。遇到 `max_turns` 時不直接判定整個流程失敗；控制器會先執行中斷後確定性驗收。Archify 規格、產物或 visual-check 收據通過時直接完成，不再消耗 Claude turns；未通過才保存成果並只接續未完成項目。Architecture Gate 仍會獨立審查需求語意。連續沒有進度或超過安全續跑上限時才通知操作者。

## 實際開發歷程導入的效率規則

- Git checkpoint 只有在專案內容、設定或驗證證據有實質變更時才建立；僅 `.ai/PROJECT_STATE.json`、`.ai/PHASE_TASK_GRAPH.json` 等執行狀態變化時原子保存但不建立 commit。
- 架構圖先完成全部 JSON 規格，再由 Opus 執行一次 `ARCH-SPEC-FREEZE` 語意凍結；通過後才由控制器集中 deliver 並對最終版本執行完整 visual-check。
- 架構生產工作預設使用 Sonnet；需求、架構、規格、實作與 QA 的高風險獨立 Gate 使用 Opus。
- 新技術 ADR 在架構開發期間使用 `draft`。只有同時標記 `Gate-Eligible: true`、`Approval-Scope: technical`，且 Architecture Gate 證據明確列出檔名者，才會轉成 immutable `accepted`；商業或未決 ADR 不自動核准。
- Release risk 只接受部署目的地、容量、維運排程、憑證歸屬、監控門檻等白名單分類。安全、權限、資料完整性、遷移、不可逆損害與高風險項目，即使 Agent 標為 release，也會被控制器強制改為 development blocker。
- Source of Truth 只保留目前有效內容；Git 與 `.ai/logs` 保存歷程。精簡 Context 只在對應 Gate 通過後同步。

既有專案與文件維護：

```bash
page-autodev migrate-workflow <專案名稱>  # 保留已完成成果，只補新版工作單元
page-autodev slim-docs <專案名稱>         # 只預覽可移除的回合／修訂歷程
page-autodev slim-docs-apply <專案名稱>   # 封存原文後套用，並建立 Git 還原點
```

文件封存位於 `.ai/archive/document-slim/`；架構正文、決策表、需求、原始輸入與驗證證據不會被瘦身器刪除。

查看工作單元：

```bash
page-autodev plan <專案名稱>
```

Telegram：

```text
/plan <專案名稱>
/status <專案名稱>
```
# 自適應 Turns 預算

工作流不再對所有任務固定使用 10 turns。需求、架構正文、ADR、規格、Gate、排程與 QA 依工作複雜度配置 16～24 turns；Archify 的確定性產生與驗證優先由控制器完成。寫入型開發任務預設 24 turns。

同一工作單元若達 turns 上限，系統會保存原 Claude Session 與 Git checkpoint；每次續跑自動增加 4 turns，最高 32 turns。任務提早完成時會立即結束，不會為了用完預算而繼續消耗額度。

## Gate 定點修復與循環熔斷

Gate 未通過時，控制器會整合所有併行審查失敗結果，依 `repair_targets` 與診斷內容定位應修復的正文、ADR、Workflow、Lifecycle、Dataflow、System Diagram 或 Context 單元。只有目標單元及其必要的 BUILD／VERIFY 證據會重新開啟；其他已通過成果保持完成。

帶有 Gate 語意診斷的圖表 SPEC 不得被格式、版面或雜湊檢查提前判定完成，必須先由 Architect 完成語意修正。同一 Gate 最多自動返工 3 輪，相同修復目標最多 2 輪；超過任一上限即停止並發送 Telegram 通知，避免無限消耗 Token。

Gate 缺陷由控制器獨占維護於 `.ai/GATE_FINDINGS.json`，使用 fingerprint 去重，狀態依 `open → repairing → verifying → closed` 流轉。Agent 只能提出 findings 與 repair targets，控制器會檢查工作單元白名單、依賴展開及 40% 修復範圍上限。

修復後先執行 finding acceptance check 的定點 Gate；通過後才執行一次完整回歸 Gate。相同 finding 第二次出現時，修復 Agent 必須回傳與前次有可驗證差異的 `strategy_reflection`，否則立即停止。

`ARCH-SPEC-FREEZE` 使用獨立的進展感知熔斷：控制器會雜湊實際被退回的圖表 JSON。規格內容有變更或修復目標減少時會繼續定點修復；相同規格內容失敗 2 次、連續 2 輪無進展或總計達 6 輪時才停止，避免固定回合數造成誤判，也保留 Token 安全上限。
