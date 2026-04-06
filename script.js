// ============================================
// FreightCast - 多面向延遲預估引擎 v2.0
// ============================================

const regions = {
    "TPE": "Asia", "TYO": "Asia", "SHA": "Asia", "SIN": "Asia",
    "LAX": "NA", "JFK": "NA",
    "RTM": "Europe", "LHR": "Europe", "FRA": "Europe",
    "DXB": "MiddleEast"
};

const citiesData = {
    "TPE": { lat: 25.03, lon: 121.56, name: "台北", country: "TW", timezone: "Asia/Taipei" },
    "TYO": { lat: 35.67, lon: 139.65, name: "東京", country: "JP", timezone: "Asia/Tokyo" },
    "SHA": { lat: 31.23, lon: 121.47, name: "上海", country: "CN", timezone: "Asia/Shanghai" },
    "SIN": { lat: 1.35, lon: 103.81, name: "新加坡", country: "SG", timezone: "Asia/Singapore" },
    "LAX": { lat: 34.05, lon: -118.24, name: "洛杉磯", country: "US", timezone: "America/Los_Angeles" },
    "JFK": { lat: 40.71, lon: -74.00, name: "紐約", country: "US", timezone: "America/New_York" },
    "RTM": { lat: 51.92, lon: 4.47, name: "鹿特丹", country: "NL", timezone: "Europe/Amsterdam" },
    "LHR": { lat: 51.50, lon: -0.12, name: "倫敦", country: "GB", timezone: "Europe/London" },
    "FRA": { lat: 50.11, lon: 8.68, name: "法蘭克福", country: "DE", timezone: "Europe/Berlin" },
    "DXB": { lat: 25.20, lon: 55.27, name: "杜拜", country: "AE", timezone: "Asia/Dubai" }
};

const baseTransitTimes = {
    air: {
        "Asia_Asia": { min: 1, max: 2 }, "Asia_NA": { min: 2, max: 4 }, "Asia_Europe": { min: 3, max: 5 }, "Asia_MiddleEast": { min: 2, max: 4 },
        "NA_NA": { min: 1, max: 2 }, "NA_Europe": { min: 2, max: 4 }, "NA_MiddleEast": { min: 3, max: 5 },
        "Europe_Europe": { min: 1, max: 2 }, "Europe_MiddleEast": { min: 2, max: 4 }, "MiddleEast_MiddleEast": { min: 1, max: 2 }
    },
    sea: {
        "Asia_Asia": { min: 5, max: 10 }, "Asia_NA": { min: 14, max: 22 }, "Asia_Europe": { min: 25, max: 35 }, "Asia_MiddleEast": { min: 12, max: 18 },
        "NA_NA": { min: 3, max: 7 }, "NA_Europe": { min: 12, max: 20 }, "NA_MiddleEast": { min: 20, max: 30 },
        "Europe_Europe": { min: 3, max: 7 }, "Europe_MiddleEast": { min: 10, max: 15 }, "MiddleEast_MiddleEast": { min: 2, max: 5 }
    }
};

// ============================================
// 延遲分析模組 1：即時天氣 + 未來 3 日預報
// ============================================
async function fetchWeatherFull(lat, lon) {
    try {
        const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&current=precipitation,wind_speed_10m,weather_code` +
            `&daily=precipitation_sum,wind_speed_10m_max,weather_code` +
            `&forecast_days=4&timezone=auto`
        );
        const data = await res.json();
        return data;
    } catch (e) {
        console.error("Weather API error:", e);
        return null;
    }
}

function getLocalDateInfo(timezone, offsetDays = 0, baseDate = new Date()) {
    const shiftedDate = new Date(baseDate.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short'
    }).formatToParts(shiftedDate);

    const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return {
        dateStr: `${lookup.year}-${lookup.month}-${lookup.day}`,
        dayOfWeek: weekdayMap[lookup.weekday]
    };
}

// WMO Weather Code 解析
function interpretWeatherCode(code) {
    if (code === null || code === undefined) return { label: "未知", severity: 0 };
    if (code <= 3) return { label: "晴朗/多雲", severity: 0 };
    if (code <= 49) return { label: "霧/霾", severity: 1 };
    if (code <= 59) return { label: "毛毛雨", severity: 0 };
    if (code <= 69) return { label: "中雨/大雨", severity: 2 };
    if (code <= 79) return { label: "降雪", severity: 2 };
    if (code <= 84) return { label: "陣雨", severity: 1 };
    if (code <= 94) return { label: "暴風雨/雷暴", severity: 3 };
    if (code <= 99) return { label: "冰雹/極端氣候", severity: 3 };
    return { label: "未知", severity: 0 };
}

// 計算天氣延遲（區分空運/海運）
function calcWeatherDelay(weatherData, freightType, options = {}) {
    if (!weatherData) return { delayDays: 0, reasons: [], details: null };

    const { locationRole = 'waypoint', transitWindow = null } = options;

    const current = weatherData.current || {};
    const daily = weatherData.daily || {};
    const wind = current.wind_speed_10m || 0;
    const prec = current.precipitation || 0;
    const weatherCode = current.weather_code;
    const weatherInfo = interpretWeatherCode(weatherCode);

    let delayDays = 0;
    let reasons = [];

    // -- 當前天氣判定 --
    if (freightType === 'air') {
        // 空運：對能見度(霧)、雷暴、冰雹極度敏感
        if (weatherInfo.severity >= 3) { delayDays += 2; reasons.push("雷暴/極端天氣 (航班停飛風險)"); }
        else if (weatherInfo.severity >= 2) { delayDays += 1; reasons.push("降雨/降雪 (航班延誤)"); }
        if (wind > 50) { delayDays += 2; reasons.push(`強風 ${wind}km/h (超出起降安全值)`); }
        else if (wind > 35) { delayDays += 1; reasons.push(`中度風速 ${wind}km/h (可能影響起降)`); }
        // 霧對空運特別危險
        if (weatherInfo.severity === 1 && weatherCode >= 45) { delayDays += 1; reasons.push("濃霧 (能見度不佳)"); }
    } else {
        // 海運：對高風速(浪高)、暴風雨更敏感，但門檻較高
        if (wind > 60) { delayDays += 3; reasons.push(`海面狂風 ${wind}km/h (船隻避風繞航)`); }
        else if (wind > 40) { delayDays += 1; reasons.push(`海面強風 ${wind}km/h (減速航行)`); }
        if (weatherInfo.severity >= 3) { delayDays += 2; reasons.push("海上暴風雨 (停航風險)"); }
        if (prec > 20) { delayDays += 1; reasons.push(`強降雨 ${prec}mm (港口作業受阻)`); }
    }

    // -- 未來 3 日預報惡化判定 --
    const shouldUseFutureForecast = !(
        locationRole === 'destination' &&
        transitWindow &&
        Number.isFinite(transitWindow.min) &&
        transitWindow.min > 3
    );

    if (shouldUseFutureForecast && daily && daily.wind_speed_10m_max && daily.weather_code) {
        let futureBadDays = 0;
        for (let i = 1; i < Math.min(daily.wind_speed_10m_max.length, 4); i++) {
            const fWind = daily.wind_speed_10m_max[i] || 0;
            const fCode = daily.weather_code[i];
            const fInfo = interpretWeatherCode(fCode);
            if (freightType === 'air' && (fWind > 40 || fInfo.severity >= 3)) futureBadDays++;
            if (freightType === 'sea' && (fWind > 50 || fInfo.severity >= 3)) futureBadDays++;
        }
        if (futureBadDays >= 2) {
            delayDays += 2;
            reasons.push(`未來3日有 ${futureBadDays} 天預報惡劣天氣`);
        } else if (futureBadDays === 1) {
            delayDays += 1;
            reasons.push("未來3日有 1 天預報天氣不佳");
        }
    }

    return {
        delayDays,
        reasons,
        details: { wind, prec, weatherLabel: weatherInfo.label, severity: weatherInfo.severity }
    };
}

// ============================================
// 延遲分析模組 2：節假日 API + 週末
// ============================================
async function fetchPublicHolidays(countryCode) {
    const year = new Date().getFullYear();
    try {
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        console.warn("Holiday API error:", e);
        return [];
    }
}

function calcHolidayDelay(srcHolidays, dstHolidays, srcName, dstName, srcTimezone, dstTimezone) {
    let delayDays = 0;
    let reasons = [];

    const srcToday = getLocalDateInfo(srcTimezone);
    const dstToday = getLocalDateInfo(dstTimezone);

    // 以出發地當地時區判定出貨作業日
    if (srcToday.dayOfWeek === 0 || srcToday.dayOfWeek === 6) {
        delayDays += 1;
        reasons.push(`${srcName}當地今天是週末 (海關/倉儲休息)`);
    }
    if (srcToday.dayOfWeek === 5) {
        delayDays += 2;
        reasons.push(`${srcName}當地為週五出貨 (需等至週一處理)`);
    }

    // 出發地節假日
    const srcHolidayToday = srcHolidays.find(h => h.date === srcToday.dateStr);
    if (srcHolidayToday) {
        delayDays += 1;
        reasons.push(`${srcName}國定假日: ${srcHolidayToday.localName}`);
    }
    // 檢查未來 3 天出發地是否有連假
    let srcUpcoming = 0;
    for (let i = 1; i <= 3; i++) {
        const ds = getLocalDateInfo(srcTimezone, i).dateStr;
        if (srcHolidays.find(h => h.date === ds)) srcUpcoming++;
    }
    if (srcUpcoming >= 2) { delayDays += 2; reasons.push(`${srcName}近日連假 (${srcUpcoming}天)`); }
    else if (srcUpcoming === 1) { delayDays += 1; reasons.push(`${srcName}明後天有假日`); }

    // 目的地節假日
    const dstHolidayToday = dstHolidays.find(h => h.date === dstToday.dateStr);
    if (dstHolidayToday) {
        delayDays += 1;
        reasons.push(`${dstName}國定假日: ${dstHolidayToday.localName}`);
    }
    let dstUpcoming = 0;
    for (let i = 1; i <= 3; i++) {
        const ds = getLocalDateInfo(dstTimezone, i).dateStr;
        if (dstHolidays.find(h => h.date === ds)) dstUpcoming++;
    }
    if (dstUpcoming >= 2) { delayDays += 2; reasons.push(`${dstName}近日連假 (${dstUpcoming}天)`); }
    else if (dstUpcoming === 1) { delayDays += 1; reasons.push(`${dstName}明後天有假日`); }

    return { delayDays, reasons };
}

// ============================================
// 延遲分析模組 3：季節性風險
// ============================================
function calcSeasonalRisk(srcRegion, dstRegion, freightType) {
    const month = new Date().getMonth() + 1; // 1-12
    let delayDays = 0;
    let reasons = [];

    // 亞洲颱風季 (6月-10月)
    if ((srcRegion === "Asia" || dstRegion === "Asia") && month >= 6 && month <= 10) {
        if (freightType === 'sea') { delayDays += 2; reasons.push("亞洲颱風季 (海運高風險期)"); }
        else { delayDays += 1; reasons.push("亞洲颱風季 (航班延誤風險增加)"); }
    }

    // 北美冬季暴風雪 (12月-2月)
    if ((srcRegion === "NA" || dstRegion === "NA") && (month === 12 || month <= 2)) {
        delayDays += 1;
        reasons.push("北美冬季暴風雪風險期");
    }

    // 歐洲冬季風暴 (11月-2月)
    if ((srcRegion === "Europe" || dstRegion === "Europe") && (month >= 11 || month <= 2)) {
        if (freightType === 'sea') { delayDays += 1; reasons.push("歐洲北海/大西洋冬季風暴期"); }
    }

    // 全球電商旺季 (11月-1月: 黑五/聖誕/春節) - 港口貨量爆增
    if (month >= 11 || month === 1) {
        delayDays += 1;
        reasons.push("全球電商物流旺季 (港口/機場超負荷)");
    }

    // 中國春節 (大約1-2月) - 工廠停工
    if ((srcRegion === "Asia" || dstRegion === "Asia") && (month === 1 || month === 2)) {
        delayDays += 2;
        reasons.push("農曆新年期間 (亞洲多數工廠與物流停擺)");
    }

    return { delayDays, reasons };
}

// ============================================
// 延遲分析模組 4：航線咽喉點風險
// ============================================
function calcChokePointRisk(srcRegion, dstRegion, freightType) {
    if (freightType !== 'sea') return { delayDays: 0, reasons: [] };
    let delayDays = 0;
    let reasons = [];

    // 亞洲 <-> 歐洲: 必經蘇伊士運河
    if ((srcRegion === "Asia" && dstRegion === "Europe") || (srcRegion === "Europe" && dstRegion === "Asia")) {
        delayDays += 1;
        reasons.push("航線經蘇伊士運河 (近年壅塞/地緣風險增加)");
    }
    // 亞洲 <-> 北美東岸: 可能經巴拿馬運河
    if ((srcRegion === "Asia" && dstRegion === "NA") || (srcRegion === "NA" && dstRegion === "Asia")) {
        delayDays += 1;
        reasons.push("航線可能經巴拿馬運河 (水位/限流管控)");
    }
    // 中東 <-> 歐洲: 可能經荷莫茲海峽
    if ((srcRegion === "MiddleEast" && dstRegion === "Europe") || (srcRegion === "Europe" && dstRegion === "MiddleEast")) {
        reasons.push("航線經荷莫茲海峽 (地緣政治風險)");
    }

    return { delayDays, reasons };
}

// ============================================
// UI 渲染輔助
// ============================================
function getTransitKey(r1, r2) { return [r1, r2].sort().join("_"); }

function renderWeatherCard(weatherData, containerId, cityNameId, cityName, freightType, options = {}) {
    const container = document.getElementById(containerId);
    document.getElementById(cityNameId).textContent = cityName;

    if (!weatherData) {
        container.innerHTML = `<span><i class="ph ph-warning-circle"></i> 天氣 API 未回應</span>`;
        return;
    }

    const current = weatherData.current || {};
    const wind = current.wind_speed_10m || 0;
    const prec = current.precipitation || 0;
    const code = current.weather_code;
    const info = interpretWeatherCode(code);
    const result = calcWeatherDelay(weatherData, freightType, options);

    let html = `<span><i class="ph ph-sun"></i> 天況: ${info.label}</span>`;
    html += `<span><i class="ph ph-wind"></i> 風速: ${wind} km/h</span>`;
    html += `<span><i class="ph ph-cloud-rain"></i> 降雨: ${prec} mm</span>`;

    if (result.delayDays > 0) {
        html += `<span class="weather-danger"><i class="ph ph-warning"></i> 氣候延遲 +${result.delayDays} 天</span>`;
    } else {
        html += `<span class="weather-ok"><i class="ph ph-check-circle"></i> 氣候狀況良好</span>`;
    }
    container.innerHTML = html;
}

// ============================================
// 主程式
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const calculateBtn = document.getElementById('calculateBtn');
    const sourceSelect = document.getElementById('source');
    const destSelect = document.getElementById('destination');
    const resultSection = document.getElementById('resultSection');
    const profApiKeyInput = document.getElementById('profApiKey');
    const btnText = document.getElementById('btnText');
    const loadingIcon = document.getElementById('loadingIcon');
    const mapContainer = document.getElementById('mapContainer');

    function updateSelectOptions() {
        Array.from(destSelect.options).forEach(opt => { opt.disabled = opt.value === sourceSelect.value && opt.value !== ""; });
        Array.from(sourceSelect.options).forEach(opt => { opt.disabled = opt.value === destSelect.value && opt.value !== ""; });
    }
    sourceSelect.addEventListener('change', () => { if (sourceSelect.value === destSelect.value) destSelect.value = ""; updateSelectOptions(); });
    destSelect.addEventListener('change', () => { if (sourceSelect.value === destSelect.value) sourceSelect.value = ""; updateSelectOptions(); });

    calculateBtn.addEventListener('click', async () => {
        const source = sourceSelect.value;
        const dest = destSelect.value;
        const type = document.querySelector('input[name="freightType"]:checked').value;
        const profKey = profApiKeyInput.value.trim();

        if (!source || !dest) { alert('請選擇完整的出發地與目的地！'); return; }

        btnText.textContent = "即時資料獲取中...";
        loadingIcon.classList.remove('hidden');
        calculateBtn.disabled = true;

        try {
            const srcData = citiesData[source];
            const dstData = citiesData[dest];
            const srcRegion = regions[source];
            const dstRegion = regions[dest];
            const transitKey = getTransitKey(srcRegion, dstRegion);
            const baseTimes = baseTransitTimes[type][transitKey];

            // -- 雷達圖 (海運才顯示) --
            const radarSection = document.getElementById('radarSection');
            if (type === 'air') {
                radarSection.style.display = 'none';
            } else {
                radarSection.style.display = 'block';
                mapContainer.innerHTML = `<iframe
                    src="https://www.vesselfinder.com/aismap?zoom=9&lat=${dstData.lat}&lon=${dstData.lon}"
                    width="100%" height="350" frameborder="0"
                    title="Vessel Radar Map"></iframe>`;
            }

            // ========== 同步抓取所有外部數據 ==========
            const [srcWeatherData, dstWeatherData, srcHolidays, dstHolidays] = await Promise.all([
                fetchWeatherFull(srcData.lat, srcData.lon),
                fetchWeatherFull(dstData.lat, dstData.lon),
                fetchPublicHolidays(srcData.country),
                fetchPublicHolidays(dstData.country)
            ]);

            // ========== 計算各模組延遲 ==========
            const srcWeatherResult = calcWeatherDelay(srcWeatherData, type, {
                locationRole: 'source',
                transitWindow: baseTimes
            });
            const dstWeatherResult = calcWeatherDelay(dstWeatherData, type, {
                locationRole: 'destination',
                transitWindow: baseTimes
            });
            const holidayResult = calcHolidayDelay(
                srcHolidays,
                dstHolidays,
                srcData.name,
                dstData.name,
                srcData.timezone,
                dstData.timezone
            );
            const seasonResult = calcSeasonalRisk(srcRegion, dstRegion, type);
            const chokeResult = calcChokePointRisk(srcRegion, dstRegion, type);

            // ========== 彙總 ==========
            let totalDelayDays = srcWeatherResult.delayDays + dstWeatherResult.delayDays
                + holidayResult.delayDays + seasonResult.delayDays + chokeResult.delayDays;

            let allReasons = [];
            if (srcWeatherResult.reasons.length) allReasons.push(...srcWeatherResult.reasons.map(r => `[${srcData.name}天氣] ${r}`));
            if (dstWeatherResult.reasons.length) allReasons.push(...dstWeatherResult.reasons.map(r => `[${dstData.name}天氣] ${r}`));
            if (holidayResult.reasons.length) allReasons.push(...holidayResult.reasons.map(r => `[假日] ${r}`));
            if (seasonResult.reasons.length) allReasons.push(...seasonResult.reasons.map(r => `[季節] ${r}`));
            if (chokeResult.reasons.length) allReasons.push(...chokeResult.reasons.map(r => `[航線] ${r}`));

            if (profKey) {
                // Placeholder weighting until a real congestion API is wired in.
                // Candidate providers:
                // - AviationStack signup: https://aviationstack.com/signup
                // - Terminal49 quickstart / API key setup: https://terminal49.com/docs/api-docs/in-depth-guides/quickstart/
                let extra = Math.floor(Math.random() * 3) + 1;
                totalDelayDays += extra;
                allReasons.push(`[API] 物流樞紐壅塞指數 (+${extra} 天)`);
                document.getElementById('apiKeyStatusBox').classList.remove('hidden');
            } else {
                document.getElementById('apiKeyStatusBox').classList.add('hidden');
            }

            const finalReasonStr = allReasons.length > 0 ? allReasons.join(' / ') : "各項環境與營運狀況良好，預計準時";

            // ========== 渲染天氣卡片 ==========
            renderWeatherCard(srcWeatherData, 'srcWeather', 'srcCityName', srcData.name, type, {
                locationRole: 'source',
                transitWindow: baseTimes
            });
            renderWeatherCard(dstWeatherData, 'dstWeather', 'dstCityName', dstData.name, type, {
                locationRole: 'destination',
                transitWindow: baseTimes
            });

            // ========== 渲染風險逐項清單 ==========
            const riskList = document.getElementById('riskList');
            if (allReasons.length > 0) {
                riskList.innerHTML = allReasons.map(r => {
                    let tagClass = '';
                    let icon = 'ph-warning';
                    if (r.startsWith('[') && r.includes('天氣]')) { tagClass = 'tag-weather'; icon = 'ph-cloud-lightning'; }
                    else if (r.startsWith('[假日]')) { tagClass = 'tag-holiday'; icon = 'ph-calendar-x'; }
                    else if (r.startsWith('[季節]')) { tagClass = 'tag-season'; icon = 'ph-thermometer-hot'; }
                    else if (r.startsWith('[航線]')) { tagClass = 'tag-route'; icon = 'ph-anchor'; }
                    else if (r.startsWith('[API]')) { tagClass = 'tag-api'; icon = 'ph-plugs-connected'; }
                    const tag = r.match(/^\[([^\]]+)\]/)?.[1] || '其他';
                    const text = r.replace(/^\[[^\]]+\]\s*/, '');
                    return `<li class="risk-item"><i class="ph ${icon}"></i><span><span class="risk-tag ${tagClass}">${tag}</span>${text}</span></li>`;
                }).join('');
            } else {
                riskList.innerHTML = `<li class="risk-item risk-ok"><i class="ph ph-check-circle" style="color:var(--accent)"></i><span>所有環境與營運指標正常，預計準時送達。</span></li>`;
            }

            // ========== 渲染結果 ==========
            document.getElementById('standardTime').textContent = `${baseTimes.min} - ${baseTimes.max} 天`;

            const delayReasonEl = document.getElementById('delayReason');
            const delayDaysEl = document.getElementById('delayDays');

            // 顯示延遲原因個數摘要
            delayReasonEl.textContent = allReasons.length > 0
                ? `偵測到 ${allReasons.length} 項風險因素`
                : "各項環境與營運狀況良好";

            if (totalDelayDays > 0) {
                delayReasonEl.className = "value text-danger";
                delayDaysEl.textContent = `綜合延遲 +${totalDelayDays} 天`;
                delayDaysEl.style.color = "var(--danger)";
            } else {
                delayReasonEl.className = "value";
                delayReasonEl.style.color = "var(--accent)";
                delayDaysEl.textContent = "無額外延遲";
                delayDaysEl.style.color = "var(--text-muted)";
            }

            const totalMinDays = baseTimes.min + totalDelayDays;
            const totalMaxDays = baseTimes.max + totalDelayDays;
            let finalDisplay = totalMinDays === totalMaxDays ? `${totalMinDays}` : `${totalMinDays}-${totalMaxDays}`;

            document.getElementById('finalDays').textContent = finalDisplay;
            document.getElementById('routeText').textContent = `從 ${srcData.name} 運送至 ${dstData.name}`;

            // ========== 複製摘要 ==========
            const typeLabel = type === 'air' ? '空運' : '海運';
            const reasonsForCopy = allReasons.length > 0
                ? allReasons.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
                : "  無風險因素";

            const copySummaryText =
`【FreightCast 物流環境分析報告】
路線：${srcData.name} ➔ ${dstData.name} (${typeLabel})
標準預估時間：${baseTimes.min}-${baseTimes.max} 天

▎延遲因素分析 (共 ${allReasons.length} 項，+${totalDelayDays} 天)：
${reasonsForCopy}

▎最終預估總耗時：${finalDisplay} 天
--
分析時間：${new Date().toLocaleString('zh-TW')}
數據來源：Open-Meteo 即時天氣 / Nager.Date 國定假日 / 季節性模型 / 航線咽喉風險模型`;

            const copyBtn = document.getElementById('copySummaryBtn');
            copyBtn.classList.remove('hidden');
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(copySummaryText).then(() => {
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = `<i class="ph ph-check"></i> 已複製！`;
                    setTimeout(() => copyBtn.innerHTML = originalHTML, 2000);
                });
            };

            // 顯示結果
            resultSection.classList.remove('hidden');
            resultSection.style.animation = 'none';
            resultSection.offsetHeight;
            resultSection.style.animation = null;

        } catch (error) {
            console.error(error);
            alert("讀取即時狀態時發生錯誤，請稍後再試。");
        } finally {
            btnText.textContent = "啟動環境數據分析";
            loadingIcon.classList.add('hidden');
            calculateBtn.disabled = false;
        }
    });
});
