# 附近羽毛球场动态地图

一个纯前端网页示例，支持：

- 自动定位并收集附近羽毛球场（高德代理优先，Overpass 兜底）
- 使用高德 JS SDK 渲染底图（替代 Leaflet 瓦片方案）
- 地图标记点击查看场馆信息
- 一键导航到场馆（高德导航链接）
- 收藏场馆并保存在浏览器本地
- 按分钟动态刷新营业状态与预约热度

## 手机独立访问（推荐）

推荐部署到 `Vercel`，这样后端代理也在云端，手机可直接访问网页，不需要通过你的电脑中转。

### 部署步骤（免费可用）

1. 把 `ab/badminton-live-map` 上传到 GitHub 仓库（可新建仓库）。
2. 打开 [Vercel](https://vercel.com/) 并导入该仓库。
3. 在项目设置 `Environment Variables` 新增：
   - `AMAP_WEB_API_KEY` = 你的高德 Web 服务 Key
   - `AMAP_JS_API_KEY` = 你的高德 JS 地图 Key（前端底图）
   - `AMAP_SECURITY_JS_CODE` = 你的高德 SecurityJsCode（可选但推荐）
4. 点击 Deploy。
5. 部署成功后会获得一个公网域名，例如 `https://xxx.vercel.app`，手机浏览器直接打开即可。

## 自动配置说明（任何设备免输入）

页面会在加载时请求 `/api/config/map`，由服务端下发地图配置：

- `AMAP_JS_API_KEY`
- `AMAP_SECURITY_JS_CODE`（可选）

因此同一个线上地址在任何设备打开都不需要手动输入 Key。  
请在高德控制台把 JS Key 的白名单配置为你的站点域名（如 `*.pages.dev`）。

## 本地调试（可选）

如果你只想本地测试，也可以运行：

1. 进入目录：

```bash
cd "/Users/dell1/Applications/cursor项目/ab/badminton-live-map"
```

2. 设置环境变量：

```bash
export AMAP_WEB_API_KEY="你的高德Web服务Key"
export AMAP_JS_API_KEY="你的高德JS地图Key"
export AMAP_SECURITY_JS_CODE="你的高德SecurityJsCode"
```

3. 启动本地代理服务：

```bash
python3 server.py
```

4. 浏览器打开 `http://127.0.0.1:8080`

## 说明

- 场馆位置数据优先来自高德（通过后端代理接口 `/api/amap/around`），失败时自动回退 OpenStreetMap/Overpass，再失败使用离线示例数据。
- 由于多数场馆没有公开预约 API，页面中的“营业/预约”状态为动态估算值（按分钟刷新），可替换为你的真实业务接口。
- 收藏数据存储在 `localStorage`，不会上传服务器。
- 场馆查询 Key 与地图 Key 都在服务端环境变量管理，避免每台设备单独录入。
