# 附近羽毛球场动态地图

一个纯前端网页示例，支持：

- 自动定位并收集附近羽毛球场（高德代理优先，Overpass 兜底）
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
4. 点击 Deploy。
5. 部署成功后会获得一个公网域名，例如 `https://xxx.vercel.app`，手机浏览器直接打开即可。

## 本地调试（可选）

如果你只想本地测试，也可以运行：

1. 进入目录：

```bash
cd "/Users/dell1/Applications/cursor项目/ab/badminton-live-map"
```

2. 设置环境变量：

```bash
export AMAP_WEB_API_KEY="你的高德Web服务Key"
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
- Key 仅保存在服务端环境变量，不会下发到前端页面。
