module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ status: "error", message: "Method Not Allowed" });
    return;
  }

  const mapKey = String(process.env.AMAP_JS_API_KEY || "").trim();
  const securityJsCode = String(process.env.AMAP_SECURITY_JS_CODE || "").trim();

  if (!mapKey) {
    res.status(200).json({
      status: "unconfigured",
      message: "服务端未配置 AMAP_JS_API_KEY。",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    status: "ok",
    mapKey,
    securityJsCode,
  });
};
