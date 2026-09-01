# 原始專案資料投放區

請將專案討論、會議紀錄、圖片、規劃書、PDF、Word、試算表、舊系統文件與其他參考資料直接放在這個 `docs/input/` 目錄，不需要事先分類。專案建立時、開發途中、審查期間、QA 階段或流程完成後都可以再次加入資料。

執行 `page-autodev start` 或 `page-autodev resume` 後，Intake Agent 會依實際內容整理至：

- `brief/`
- `discussions/`
- `images/`
- `plans/`
- `references/`
- `data/`
- `unknown/`

系統會建立 `INDEX.md` 與 `.ai/INPUT_INDEX.json` 保存來源、分類、摘要與追溯資訊。原始資料不會被刪除或移出 `docs/input/`。

每次新增或更新資料後執行 `page-autodev resume`。若全自動程序當時正在運行，控制器會在目前步驟完成後、下一階段開始前自動偵測。新資料會使下游 Gate 失效，並重新經過資料分析、需求、架構、規格、排程、實作審查與 QA，確保整個專案理解同步更新。
