export const onRequestGet = async ({ env }) => {
  const mapKey = String(env.AMAP_JS_API_KEY || "").trim();
  const securityJsCode = String(env.AMAP_SECURITY_JS_CODE || "").trim();

  if (!mapKey) {
    return json(
      {
        status: "unconfigured",
        message: "服务端未配置 AMAP_JS_API_KEY。",
      },
      200
    );
  }

  return json({
    status: "ok",
    mapKey,
    securityJsCode,
  });
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
