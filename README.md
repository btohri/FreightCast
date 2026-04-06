# FreightCast

FreightCast 是一個國際貨運延遲估算工具，現階段採用前端介面加上輕量 Python 後端，結合即時天氣、國定假日、季節性風險與航線咽喉點規則，快速推估空運或海運可能增加的延遲天數。

## Overview

- 第三版已加入一鍵啟動器，可直接開啟應用程式頁面
- 支援空運與海運兩種模式
- 以基線運輸時間加上多模組風險分數，輸出最終耗時區間
- 使用公開資料源取得天氣與節假日資訊
- 已修正跨時區假日判斷與長程目的地短期天氣高估問題

## Features

- 路線選擇：支援多個亞洲、北美、歐洲與中東城市
- 天氣分析：讀取即時天氣與未來短期預報
- 假日判斷：依出發地與目的地各自時區判斷週末與國定假日
- 季節加權：內建颱風季、冬季風暴、物流旺季等規則
- 航線風險：海運會納入蘇伊士、巴拿馬等咽喉點風險
- 分析摘要：可一鍵複製結果，方便分享或備查

## Quick Start

1. 下載或 clone 專案
2. 確認電腦可使用 `python`
3. 最簡單的方式是直接執行：

```bat
start_app.bat
```

這會自動：
- 檢查後端是否已啟動
- 若尚未啟動則啟動 backend
- 等待 `/api/health` 就緒
- 自動開啟瀏覽器進入首頁

4. 若你需要手動啟動後端，也可以在專案根目錄執行：

```bat
python backend\server.py
```

或直接雙擊：

```bat
start_backend.bat
```

5. 選擇出發地、目的地與運輸方式
6. 點擊「啟動環境數據分析」
7. 查看基線時間、延遲原因與總耗時估算

## How It Works

核心邏輯位於 [script.js](/abs/path/c:/Users/btohr/Desktop/AI_text/script.js)，第一版後端位於 [backend/server.py](/abs/path/c:/Users/btohr/Desktop/AI_text/backend/server.py)。

### Backend v3

目前後端提供：
- `/api/health`：健康檢查
- `/api/weather`：代理天氣資料查詢
- `/api/holidays`：代理國定假日資料查詢
- `/api/history`：查看最近 API 查詢紀錄
- `/api/backend-info`：查看目前後端設定摘要

第三版新增：
- 一鍵啟動器 `start_app.bat`
- 啟動流程腳本 `start_app.ps1`
- 後端健康檢查後自動開頁

第二版保留能力：
- `.env` 設定讀取
- 天氣與假日 API 記憶體快取
- JSON Lines 查詢歷史紀錄
- 回應標頭中的快取命中資訊

後端的目的：
- 把外部 API 呼叫集中管理
- 為未來商業 API 整合預留位置
- 降低前端直接暴露資料來源的耦合
- 作為之後加入資料庫、排程與驗證層的起點

### 1. 基線運輸時間

系統會先根據：
- 運輸方式：`air` 或 `sea`
- 區域組合：例如 `Asia_Europe`、`NA_NA`

取得一組基線時間區間，例如：
- 亞洲到歐洲空運：`3-5` 天
- 亞洲到歐洲海運：`25-35` 天

### 2. 天氣延遲模型

天氣模組綜合以下資料：
- 即時風速
- 即時降水
- WMO weather code
- 未來 3 天預報

規則方向：
- 空運對雷暴、冰雹、濃霧、強風更敏感
- 海運對高風速、暴風雨與港口作業受阻更敏感
- 長程路線的目的地不直接套用短期預報，避免結果高估

### 3. 假日與週末模型

假日模組會分析：
- 出發地當地是否為週末
- 出發地當地是否為週五出貨
- 出發地與目的地是否為國定假日
- 未來 3 天是否接近連假

目前判斷基於各城市自己的時區，而不是直接使用使用者本地時間。

### 4. 季節性風險

依照月份與區域加入固定風險，例如：
- 亞洲颱風季
- 北美冬季暴風雪
- 歐洲冬季風暴
- 全球物流旺季
- 農曆新年期間

### 5. 航線咽喉風險

海運模式下會額外考量：
- 蘇伊士運河
- 巴拿馬運河
- 荷莫茲海峽

## Data Sources

目前整合的公開資料來源：

- Open-Meteo
  - 用於即時天氣與天氣預報
  - https://open-meteo.com/
- Nager.Date
  - 用於國定假日資料
  - https://date.nager.at/

## API Docs

### `GET /api/health`

用途：
- 檢查後端是否正常啟動

範例：

```text
GET /api/health
```

回傳範例：

```json
{
  "ok": true,
  "service": "FreightCast backend",
  "version": "2.0",
  "timestamp": "2026-04-06T00:00:00+00:00"
}
```

### `GET /api/weather`

用途：
- 代理 Open-Meteo 天氣查詢

Query 參數：
- `lat`：緯度，必填
- `lon`：經度，必填
- `timezone`：時區，選填，預設為 `auto`

範例：

```text
GET /api/weather?lat=25.03&lon=121.56&timezone=auto
```

備註：
- 回傳內容沿用 Open-Meteo JSON 結構
- 回應標頭 `X-FreightCast-Cache` 會顯示 `HIT` 或 `MISS`

### `GET /api/holidays`

用途：
- 代理 Nager.Date 國定假日查詢

Query 參數：
- `country`：國家代碼，必填，例如 `TW`
- `year`：年份，選填，預設為當前年份

範例：

```text
GET /api/holidays?country=TW&year=2026
```

備註：
- 回傳內容沿用 Nager.Date JSON 結構
- 回應標頭 `X-FreightCast-Cache` 會顯示 `HIT` 或 `MISS`

### `GET /api/history`

用途：
- 查看最近 API 呼叫紀錄，方便開發與除錯

Query 參數：
- `limit`：選填，預設 `20`，最大值由 `.env` 的 `FREIGHTCAST_MAX_HISTORY_ITEMS` 控制

範例：

```text
GET /api/history?limit=10
```

回傳範例：

```json
{
  "items": [
    {
      "timestamp": "2026-04-06T00:00:00+00:00",
      "endpoint": "/api/weather",
      "params": {
        "lat": "25.03",
        "lon": "121.56",
        "timezone": "auto"
      },
      "status": 200,
      "cache_hit": false,
      "detail": null
    }
  ],
  "limit": 10,
  "max_limit": 100
}
```

### `GET /api/backend-info`

用途：
- 查看目前後端版本、快取 TTL 與歷史紀錄設定

範例：

```text
GET /api/backend-info
```

## Configuration

可透過專案根目錄的 `.env` 設定後端行為，範例檔為 [.env.example](/abs/path/c:/Users/btohr/Desktop/AI_text/.env.example)。

目前支援：
- `FREIGHTCAST_HOST`
- `FREIGHTCAST_PORT`
- `FREIGHTCAST_REQUEST_TIMEOUT`
- `FREIGHTCAST_WEATHER_CACHE_TTL`
- `FREIGHTCAST_HOLIDAY_CACHE_TTL`
- `FREIGHTCAST_MAX_HISTORY_ITEMS`

## API Key Placeholder

介面中有「專業物流 API 金鑰」欄位，這是預留給未來擴充使用的整合入口。

目前狀態：
- 未輸入金鑰時，系統只使用公開資料與內建規則
- 輸入金鑰後，系統仍是示意性加權
- 目前尚未真正串接商業物流服務

可作為未來整合參考的服務：
- AviationStack
  - 註冊頁面：https://aviationstack.com/signup/free
- Terminal49
  - Quickstart：https://terminal49.com/docs/api-docs/in-depth-guides/quickstart/

若未來正式接入，建議改為：
- 使用真實航班、港口、貨櫃或追蹤資料做加權
- 將加權來源顯示為可解釋的理由
- 移除隨機值作為延遲加分依據

## Supported Cities

目前內建城市：

- 台北 `TPE`
- 東京 `TYO`
- 上海 `SHA`
- 新加坡 `SIN`
- 洛杉磯 `LAX`
- 紐約 `JFK`
- 鹿特丹 `RTM`
- 倫敦 `LHR`
- 法蘭克福 `FRA`
- 杜拜 `DXB`

## Project Structure

```text
AI_text/
├─ backend/
│  └─ server.py
├─ .env.example
├─ index.html
├─ script.js
├─ style.css
├─ start_app.bat
├─ start_app.ps1
├─ start_backend.bat
└─ README.md
```

主要檔案：
- [index.html](/abs/path/c:/Users/btohr/Desktop/AI_text/index.html)：畫面結構與使用者輸入區
- [script.js](/abs/path/c:/Users/btohr/Desktop/AI_text/script.js)：資料抓取、規則計算與畫面更新
- [backend/server.py](/abs/path/c:/Users/btohr/Desktop/AI_text/backend/server.py)：本地 API 代理與靜態頁面服務
- [.env.example](/abs/path/c:/Users/btohr/Desktop/AI_text/.env.example)：後端設定檔範例
- [start_app.bat](/abs/path/c:/Users/btohr/Desktop/AI_text/start_app.bat)：一鍵啟動應用程式入口
- [start_app.ps1](/abs/path/c:/Users/btohr/Desktop/AI_text/start_app.ps1)：啟動後端、檢查健康狀態並開啟瀏覽器
- [style.css](/abs/path/c:/Users/btohr/Desktop/AI_text/style.css)：視覺樣式與版面設計

## Limitations

- 目前是規則式估算器，不是即時物流追蹤平台
- 季節性與航線風險仍是固定加權，尚未連動全球事件
- API 金鑰欄位還沒有真正接上商業資料源
- 目前已有第三版後端，但仍未加入資料庫、排程與驗證層
- 若外部公開 API 短暫失效，結果會回到較簡化的判斷

## Roadmap

- 串接真實的航班、港口或貨櫃追蹤 API
- 為假日模組加入加權上限，降低規則疊加過度的風險
- 依基線時間推估 ETA，改用更接近到港日的目的地條件
- 擴充更多城市、港口與機場
- 增加測試案例與規則驗證流程

## Use Cases

這個專案目前適合：
- 展示型作品集
- 規則式風險估算原型
- 前端資料整合練習
- 邏輯規則設計示範

若要投入正式商業場景，建議補上：
- 真實物流資料來源
- 後端服務與金鑰保護
- 更完整的測試、監控與資料驗證
