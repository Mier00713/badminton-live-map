module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ status: "error", message: "Method Not Allowed" });
    return;
  }

  const apiKey = process.env.AMAP_WEB_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      status: "proxy_unconfigured",
      message: "服务端未配置 AMAP_WEB_API_KEY，已跳过高德代理。",
      pois: [],
    });
    return;
  }

  const lat = String(req.query.lat || "");
  const lon = String(req.query.lon || "");
  const radius = String(req.query.radius || "3000");
  if (!lat || !lon) {
    res.status(400).json({ status: "error", message: "缺少 lat 或 lon 参数" });
    return;
  }

  const params = new URLSearchParams({
    key: apiKey,
    location: `${lon},${lat}`,
    keywords: "羽毛球",
    types: "体育休闲服务",
    radius,
    sortrule: "distance",
    offset: "25",
    page: "1",
    extensions: "base",
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://restapi.amap.com/v3/place/around?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });
    const payload = await response.json();
    if (payload.status !== "1") {
      res.status(502).json({
        status: "error",
        message: `高德接口错误: ${payload.info || "unknown"}`,
      });
      return;
    }
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({
      status: "ok",
      count: payload.count || "0",
      pois: Array.isArray(payload.pois) ? payload.pois : [],
    });
  } catch (error) {
    const message = error.name === "AbortError" ? "高德请求超时" : `高德请求失败: ${error.message}`;
    res.status(502).json({ status: "error", message });
  } finally {
    clearTimeout(timeoutId);
  }
};
