# FreightCast Product Skills Specification

## Document Purpose

本文件用於整理 FreightCast 的產品能力定義，適合作為簡報附件、提案內容、作品集說明，或後續產品規格擴充的基礎文件。

## Product Positioning

FreightCast 是一套結合即時環境資料與規則引擎的國際貨運延遲估算工具，提供使用者在空運與海運情境下，快速評估路線可能受到的延遲風險與最終運輸時間。

## Core Skills

### 1. Real-Time Data Integration

- 串接即時天氣與國定假日公開 API
- 以統一格式整理外部資料，提供前端分析流程使用
- 透過後端代理機制降低前端直接依賴外部服務的風險

### 2. Cross-Timezone Logistics Judgment

- 依出發地與目的地各自時區判斷實際作業日
- 分析週末、週五出貨與當地假日對物流節奏的影響
- 降低使用者本地時區與物流所在地時區不一致造成的誤判

### 3. Multi-Factor Delay Scoring

- 同步考量天氣、節假日、季節性條件與航線風險
- 將多來源風險轉為可量化的延遲天數
- 產出可讀性高的延遲原因摘要與最終耗時估算

### 4. Air and Sea Freight Mode Modeling

- 支援空運與海運兩種運輸模式
- 依不同模式套用不同風險門檻與判定邏輯
- 反映航班與航運在天候、港口與作業條件上的差異

### 5. Route Risk Interpretation

- 依區域組合建立基線運輸時間
- 對海運路線加入蘇伊士、巴拿馬與荷莫茲等咽喉點風險
- 可隨後續需求擴充更多航線規則與區域模型

### 6. Lightweight Backend Service Packaging

- 以 Python 提供健康檢查、天氣代理、假日代理與查詢紀錄介面
- 內建快取與歷史紀錄機制，提升開發與除錯效率
- 保留未來接入商業物流 API 與資料庫的擴充空間

### 7. Startup Automation

- 提供批次檔與 PowerShell 啟動流程
- 自動檢查後端健康狀態並開啟應用頁面
- 降低展示、測試與本機啟動成本

## Target Use Cases

- 展示國際物流風險評估概念
- 製作資料驅動型前後端整合作品
- 作為商業物流 API 串接前的原型系統
- 作為供應鏈、貨運或營運分析工具的雛形

## Expansion Directions

- 納入更多城市、港口與機場節點
- 接入真實航空或船舶追蹤服務
- 加入歷史準點率、壅塞資料與機器學習模型
- 建立企業版權限、報表與儀表板能力
