# AI 精簡閱讀層

本目錄存放由 `page-autodev` 維護、供 AI 優先讀取的 Markdown 索引與摘要，用來降低重複讀取大型原始資料所消耗的 Context。

## 文件

- `INPUT_DIGEST.md`：原始輸入資料的內容摘要、來源路徑、雜湊與轉換限制。
- `PROJECT_CONTEXT.md`：目前已知需求、範圍、限制、架構摘要與未決事項。
- `TRACEABILITY.md`：需求、規格、任務、測試與驗收證據的追溯關係。

## 完整性規則

- `docs/input/`、正式需求、PRD、架構、規格、程式碼、Git 與結構化驗證收據仍是 Source of Truth。
- 本目錄不得取代或刪除原始資料。
- 圖片、PDF、試算表、CSV、JSON 與 Archify 產物只建立文字摘要及來源連結；需要版面、公式或結構驗證時必須回查原檔。
- 每次 `docs/input/` 新增或更新資料，都必須重新分析、更新摘要並讓既有 Gate 失效。
- 摘要應覆寫目前理解，不得無限制累加歷史內容。
