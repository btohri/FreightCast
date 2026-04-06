import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ENV_PATH = os.path.join(ROOT_DIR, ".env")
VERSION = "3.0"


def load_env_file(path):
    values = {}
    if not os.path.exists(path):
        return values

    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


ENV_VALUES = load_env_file(ENV_PATH)


def get_setting(name, default):
    return os.environ.get(name, ENV_VALUES.get(name, default))


HOST = get_setting("FREIGHTCAST_HOST", "127.0.0.1")
PORT = int(get_setting("FREIGHTCAST_PORT", "8000"))
REQUEST_TIMEOUT_SECONDS = int(get_setting("FREIGHTCAST_REQUEST_TIMEOUT", "15"))
WEATHER_CACHE_TTL_SECONDS = int(get_setting("FREIGHTCAST_WEATHER_CACHE_TTL", "900"))
HOLIDAY_CACHE_TTL_SECONDS = int(get_setting("FREIGHTCAST_HOLIDAY_CACHE_TTL", "43200"))
MAX_HISTORY_ITEMS = int(get_setting("FREIGHTCAST_MAX_HISTORY_ITEMS", "100"))
DATA_DIR = os.path.join(ROOT_DIR, "backend", "data")
HISTORY_PATH = os.path.join(DATA_DIR, "query_history.jsonl")


os.makedirs(DATA_DIR, exist_ok=True)


CACHE = {}
CACHE_LOCK = threading.Lock()
HISTORY_LOCK = threading.Lock()


def now_utc_iso():
    return datetime.now(timezone.utc).isoformat()


def build_cache_key(scope, params):
    ordered = "&".join(f"{key}={params[key]}" for key in sorted(params))
    return f"{scope}?{ordered}"


def get_cached_payload(cache_key):
    with CACHE_LOCK:
        cached = CACHE.get(cache_key)
        if not cached:
            return None
        if datetime.now().timestamp() >= cached["expires_at"]:
            CACHE.pop(cache_key, None)
            return None
        return cached["payload"]


def set_cached_payload(cache_key, payload, ttl_seconds):
    with CACHE_LOCK:
        CACHE[cache_key] = {
            "payload": payload,
            "expires_at": datetime.now().timestamp() + ttl_seconds,
        }


def append_history(entry):
    with HISTORY_LOCK:
        with open(HISTORY_PATH, "a", encoding="utf-8") as history_file:
            history_file.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read_history(limit):
    if not os.path.exists(HISTORY_PATH):
        return []

    with HISTORY_LOCK:
        with open(HISTORY_PATH, "r", encoding="utf-8") as history_file:
            lines = [line.strip() for line in history_file if line.strip()]

    items = []
    for line in reversed(lines[-limit:]):
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return items


def fetch_json(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": f"FreightCast/{VERSION}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset))


class FreightCastHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.response_extra_headers = {}
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-FreightCast-Version", VERSION)
        for key, value in self.response_extra_headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def log_api_call(self, endpoint, params, status, cache_hit, detail=None):
        append_history(
            {
                "timestamp": now_utc_iso(),
                "endpoint": endpoint,
                "params": params,
                "status": status,
                "cache_hit": cache_hit,
                "detail": detail,
            }
        )

    def fetch_with_cache(self, endpoint, params, upstream_url, ttl_seconds):
        cache_key = build_cache_key(endpoint, params)
        cached = get_cached_payload(cache_key)
        if cached is not None:
            self.response_extra_headers["X-FreightCast-Cache"] = "HIT"
            self.log_api_call(endpoint, params, 200, True)
            return 200, cached

        self.response_extra_headers["X-FreightCast-Cache"] = "MISS"
        payload = fetch_json(upstream_url)
        set_cached_payload(cache_key, payload, ttl_seconds)
        self.log_api_call(endpoint, params, 200, False)
        return 200, payload

    def handle_weather(self, query):
        lat = query.get("lat", [None])[0]
        lon = query.get("lon", [None])[0]
        timezone_name = query.get("timezone", ["auto"])[0] or "auto"

        if lat is None or lon is None:
            self.log_api_call("/api/weather", {"lat": lat, "lon": lon}, 400, False, "missing lat or lon")
            self.end_json(400, {"error": "Missing lat or lon"})
            return

        params = {"lat": str(lat), "lon": str(lon), "timezone": timezone_name}
        upstream_url = (
            "https://api.open-meteo.com/v1/forecast?"
            + urllib.parse.urlencode(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "current": "precipitation,wind_speed_10m,weather_code",
                    "daily": "precipitation_sum,wind_speed_10m_max,weather_code",
                    "forecast_days": 4,
                    "timezone": timezone_name,
                }
            )
        )

        try:
            status_code, payload = self.fetch_with_cache(
                "/api/weather",
                params,
                upstream_url,
                WEATHER_CACHE_TTL_SECONDS,
            )
            self.end_json(status_code, payload)
        except urllib.error.HTTPError as exc:
            self.log_api_call("/api/weather", params, 502, False, f"upstream status {exc.code}")
            self.end_json(502, {"error": "Weather upstream error", "status": exc.code})
        except Exception as exc:
            self.log_api_call("/api/weather", params, 502, False, str(exc))
            self.end_json(502, {"error": "Weather fetch failed", "detail": str(exc)})

    def handle_holidays(self, query):
        country = query.get("country", [None])[0]
        year = query.get("year", [str(datetime.now().year)])[0]

        if country is None:
            self.log_api_call("/api/holidays", {"country": country, "year": year}, 400, False, "missing country")
            self.end_json(400, {"error": "Missing country"})
            return

        if not year or not str(year).isdigit():
            year = str(datetime.now().year)

        params = {"country": str(country), "year": str(year)}
        upstream_url = f"https://date.nager.at/api/v3/PublicHolidays/{year}/{country}"

        try:
            status_code, payload = self.fetch_with_cache(
                "/api/holidays",
                params,
                upstream_url,
                HOLIDAY_CACHE_TTL_SECONDS,
            )
            self.end_json(status_code, payload)
        except urllib.error.HTTPError as exc:
            self.log_api_call("/api/holidays", params, 502, False, f"upstream status {exc.code}")
            self.end_json(502, {"error": "Holiday upstream error", "status": exc.code})
        except Exception as exc:
            self.log_api_call("/api/holidays", params, 502, False, str(exc))
            self.end_json(502, {"error": "Holiday fetch failed", "detail": str(exc)})

    def handle_history(self, query):
        raw_limit = query.get("limit", ["20"])[0]
        limit = 20
        if raw_limit.isdigit():
            limit = min(int(raw_limit), MAX_HISTORY_ITEMS)
        payload = {
            "items": read_history(limit),
            "limit": limit,
            "max_limit": MAX_HISTORY_ITEMS,
        }
        self.end_json(200, payload)

    def handle_backend_info(self):
        payload = {
            "service": "FreightCast backend",
            "version": VERSION,
            "host": HOST,
            "port": PORT,
            "cache": {
                "weather_ttl_seconds": WEATHER_CACHE_TTL_SECONDS,
                "holiday_ttl_seconds": HOLIDAY_CACHE_TTL_SECONDS,
            },
            "history": {
                "path": HISTORY_PATH,
                "max_items": MAX_HISTORY_ITEMS,
            },
        }
        self.end_json(200, payload)

    def do_GET(self):
        self.response_extra_headers = {}
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/api/health":
            self.end_json(
                200,
                {
                    "ok": True,
                    "service": "FreightCast backend",
                    "version": VERSION,
                    "timestamp": now_utc_iso(),
                },
            )
            return

        if parsed.path == "/api/weather":
            self.handle_weather(query)
            return

        if parsed.path == "/api/holidays":
            self.handle_holidays(query)
            return

        if parsed.path == "/api/history":
            self.handle_history(query)
            return

        if parsed.path == "/api/backend-info":
            self.handle_backend_info()
            return

        if parsed.path == "/":
            self.path = "/index.html"

        super().do_GET()


def main():
    server = ThreadingHTTPServer((HOST, PORT), FreightCastHandler)
    print(f"FreightCast backend v{VERSION} running at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
