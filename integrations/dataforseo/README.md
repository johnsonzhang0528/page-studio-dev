# DataForSEO Integration

這是整合於 page-studio-dev、預設停用且具有獨立部署邊界的 DataForSEO 工作包。

目前只包含：

- 唯讀 Keyword Overview request contract
- 付費參數與批次硬限制
- DataForSEO HTTP/task status 分類
- Canonical evidence normalization
- request fingerprint
- 可跨行程協調的持久化 spend ledger 原型
- 原子檔案替換、互斥鎖與內容校驗碼
- 四層預算政策與Billing Gateway介面
- 付費請求重試／不重送規則
- 遞迴日誌遮罩
- 60筆台灣繁中Query校準驗收器
- 預設停用的Oracle systemd部署範本與操作手冊
- 可驗證帳本備份與唯讀鎖診斷工具
- 無法注入transport的離線Sandbox Adapter
- 與現行Billing Gateway安全邊界相容的Data Source receipt
- 固定DataForSEO主機與Standard API路由的egress policy／handler
- Shadow／Canary／Rollback控制與帳本遷移manifest
- Oracle唯讀preflight與校準報告產生器
- systemd-only Credential loader、固定TLS transport、固定tunnel與Unix IPC
- 部署檔案雜湊manifest與60 Query候選產生器
- 可由systemd socket activation啟動的egress與固定tunnel daemon
- 離線fixture與死亡測試

目前明確不包含：

- 真實Credential讀取
- 對外網路傳輸
- 正式 controller/router 付費派發接線
- systemd 啟用
- DataForSEO正式API呼叫
- 專案start/resume

執行離線測試：

```text
npm test
```

## 未來整合邊界

重構完成後，由最終Billing Gateway先核發spend lease，再呼叫DataForSEO專用egress。只有egress服務可透過systemd `LoadCredential`讀取：

```text
/etc/page-autodev/credentials/dataforseo-login
/etc/page-autodev/credentials/dataforseo-password
```

本工作包永不直接讀取上述檔案。

官方文件確認 DataForSEO Labs Keyword Overview 僅提供 `/live`；此處的 Live 是 Labs 即時方法，與被禁止的 SERP Live Advanced 不同。60 詞依 2026-09-10 官方價目估算為 12,000 + 60×120 = 19,200 microusd。價格快照最多有效七天，過期即停止。Keyword Ideas 在回傳項目成本上限完成驗證前不列入 egress allowlist。

## 持久化帳本的整合限制

`DurableSpendLedger` 是供最終 Billing Gateway 採用的隔離核心。帳本路徑必須由部署層提供絕對路徑；模組不預設正式環境位置。鎖逾時、帳本格式錯誤或校驗碼不符時一律停止，不會清除帳本、自動偷鎖或重送付費請求。

停用安裝器會建立專用部署身分、Linux 權限、可回復備份與 systemd 單元，但不會啟用或啟動服務。跨主機共享帳本與付費 canary 尚未驗收，因此不得直接啟用於正式執行流程。
