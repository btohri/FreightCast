---
name: freightcast-delay-analysis
description: Use when working on the FreightCast project to explain, extend, or maintain the cargo delay estimation workflow, including weather analysis, holiday logic, timezone-aware routing, and air-versus-sea risk rules.
---

# FreightCast Delay Analysis

Use this skill when the task involves the FreightCast estimation engine, its frontend inputs and outputs, or the lightweight backend APIs that support weather and holiday data retrieval.

## Scope

This skill covers:

- Delay estimation logic in `script.js`
- Frontend display flow in `index.html` and `style.css`
- Backend proxy endpoints in `backend/server.py`
- Product-facing capability summaries in `README.md` and `SKILLS.md`

## Working Rules

1. Preserve the existing product shape: a browser UI plus a lightweight Python backend.
2. Keep logic explainable. When changing scoring or delay rules, ensure the reason text shown to users stays understandable.
3. Respect timezone-aware behavior for holiday and date decisions.
4. Distinguish clearly between `air` and `sea` mode thresholds.
5. Prefer small, localized edits over broad rewrites unless the task explicitly calls for refactoring.

## Key Concepts

### Data Sources

- Weather data is fetched through `/api/weather`
- Holiday data is fetched through `/api/holidays`
- The backend proxies public APIs and may cache responses

### Risk Dimensions

- Current weather severity
- Short-term forecast risk
- Weekend and holiday disruption
- Seasonal logistics pressure
- Sea-lane chokepoint exposure

### Output Expectations

When implementing or editing features, keep these outputs coherent:

- Baseline transit time
- Delay reasons
- Delay day count
- Final corrected transit estimate

## File Guide

- `script.js`: main scoring engine and UI orchestration
- `index.html`: input form and result presentation
- `style.css`: visual layout and result styling
- `backend/server.py`: API proxy, caching, and health endpoints
- `README.md`: project overview and technical usage notes
- `SKILLS.md`: product-level capability summary

## Change Guidance

- For product copy or portfolio presentation work, update `SKILLS.md` first.
- For logic changes, inspect `script.js` before editing docs so the documentation reflects the real behavior.
- For backend-related work, verify endpoint names and query parameters stay aligned with the frontend.
