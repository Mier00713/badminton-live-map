export const onRequestGet = async ({ request, env }) => {
  const apiKey = env.AMAP_WEB_API_KEY;
  if (!apiKey) {
    return json({
      status: "proxy_unconfigured",
      message: "服务端未配置 AMAP_WEB_API_KEY",
      pois: [],
    });
  }

  const url = new URL(request.url);
  const lat = url.searchParams.get("lat") || "";
  const lon = url.searchParams.get("lon") || "";
  const radius = url.searchParams.get("radius") || "3000";

  if (!lat || !lon) {
    return json({ status: "error", message: "缺少 lat 或 lon 参数" }, 400);
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

  try {
    const resp = await fetch(`https://restapi.amap.com/v3/place/around?${params.toString()}`);
    const data = await resp.json();

    if (data.status !== "1") {
      return json({ status: "error", message: `高德接口错误: ${data.info || "unknown"}` }, 502);
    }

    return json({
      status: "ok",
      count: data.count || "0",
      pois: Array.isArray(data.pois) ? data.pois : [],
    });
  } catch (e) {
    return json({ status: "error", message: `高德请求失败: ${e.message}` }, 502);
  }
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
