# Sandbox Runner Placeholder

本目錄刻意不包含網路 transport 或 Credential reader。待重構完成後，Sandbox runner 必須由部署層注入專用 egress，並同時滿足人工啟用、極低預算、固定 allowlist、完整稽核與立即停止能力。任何缺少其中一項的執行都必須 fail closed。
