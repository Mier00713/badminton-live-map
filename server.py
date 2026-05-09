#!/usr/bin/env python3
import json
import os
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8080
AMAP_API = "https://restapi.amap.com/v3/place/around"


class AppHandler(SimpleHTTPRequestHandler):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(Path(__file__).parent), **kwargs)

  def do_GET(self):
    if self.path.startswith("/api/config/map"):
      self.handle_map_config()
      return
    if self.path.startswith("/api/amap/around"):
      self.handle_amap_proxy()
      return
    super().do_GET()

  def handle_map_config(self):
    map_key = os.environ.get("AMAP_JS_API_KEY", "").strip()
    security_code = os.environ.get("AMAP_SECURITY_JS_CODE", "").strip()
    if not map_key:
      self.respond_json(
        200,
        {
          "status": "unconfigured",
          "message": "未配置 AMAP_JS_API_KEY。",
        },
      )
      return
    self.respond_json(
      200,
      {
        "status": "ok",
        "mapKey": map_key,
        "securityJsCode": security_code,
      },
    )

  def handle_amap_proxy(self):
    api_key = os.environ.get("AMAP_WEB_API_KEY", "").strip()
    if not api_key:
      self.respond_json(
        200,
        {
          "status": "proxy_unconfigured",
          "message": "未配置 AMAP_WEB_API_KEY，已自动跳过高德代理。",
          "pois": [],
        },
      )
      return

    parsed = urllib.parse.urlparse(self.path)
    query = urllib.parse.parse_qs(parsed.query)
    lat = query.get("lat", [""])[0]
    lon = query.get("lon", [""])[0]
    radius = query.get("radius", ["3000"])[0]

    if not lat or not lon:
      self.respond_json(400, {"status": "error", "message": "缺少 lat 或 lon 参数"})
      return

    amap_params = {
      "key": api_key,
      "location": f"{lon},{lat}",
      "keywords": "羽毛球",
      "types": "体育休闲服务",
      "radius": radius,
      "sortrule": "distance",
      "offset": "25",
      "page": "1",
      "extensions": "base",
    }
    url = f"{AMAP_API}?{urllib.parse.urlencode(amap_params)}"
    request = urllib.request.Request(url, method="GET")
    try:
      with urllib.request.urlopen(request, timeout=10) as response:
        payload = response.read().decode("utf-8")
    except Exception as error:
      self.respond_json(502, {"status": "error", "message": f"高德代理请求失败: {error}"})
      return

    try:
      amap_json = json.loads(payload)
    except json.JSONDecodeError:
      self.respond_json(502, {"status": "error", "message": "高德返回非 JSON 数据"})
      return

    if amap_json.get("status") != "1":
      self.respond_json(
        502,
        {
          "status": "error",
          "message": f"高德接口错误: {amap_json.get('info', 'unknown')}",
          "raw": amap_json,
        },
      )
      return

    self.respond_json(
      200,
      {
        "status": "ok",
        "count": amap_json.get("count", "0"),
        "pois": amap_json.get("pois", []),
      },
    )

  def respond_json(self, status_code, data):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    self.send_response(status_code)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    self.wfile.write(body)


if __name__ == "__main__":
  server = ThreadingHTTPServer((HOST, PORT), AppHandler)
  print(f"Serving at http://{HOST}:{PORT}")
  print("请先设置环境变量 AMAP_WEB_API_KEY 和 AMAP_JS_API_KEY。")
  server.serve_forever()
