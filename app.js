const DEFAULT_CENTER = { lat: 31.2304, lon: 121.4737 };
const FAVORITES_KEY = "badminton-favorites-v1";
const MAP_KEY_STORAGE = "badminton-map-js-key";
const REFRESH_INTERVAL_MS = 60 * 1000;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

const state = {
  map: null,
  userLocation: { ...DEFAULT_CENTER },
  radius: 3000,
  courts: [],
  markerMap: new Map(),
  infoWindow: null,
  favorites: new Set(loadFavorites()),
  showFavoritesOnly: false,
};

const locateBtn = document.querySelector("#locateBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const radiusInput = document.querySelector("#radiusInput");
const radiusText = document.querySelector("#radiusText");
const favoritesOnlyInput = document.querySelector("#favoritesOnly");
const loadingText = document.querySelector("#loadingText");
const courtList = document.querySelector("#courtList");
const itemTemplate = document.querySelector("#courtItemTemplate");
const mapKeyInput = document.querySelector("#mapKeyInput");
const saveMapKeyBtn = document.querySelector("#saveMapKeyBtn");

init();

async function init() {
  bindEvents();
  updateRadiusText();
  initMapKeyInput();
  const ready = await initMapEngine();
  if (!ready) {
    return;
  }
  await locateUserAndRefresh();
  window.setInterval(refreshStatusesOnly, REFRESH_INTERVAL_MS);
}

function bindEvents() {
  locateBtn.addEventListener("click", locateUserAndRefresh);
  refreshBtn.addEventListener("click", () => refreshNearbyCourts(true));
  saveMapKeyBtn.addEventListener("click", () => {
    const value = mapKeyInput.value.trim();
    if (!value) {
      localStorage.removeItem(MAP_KEY_STORAGE);
      setStatus("已清空高德 JS Key。");
      return;
    }
    localStorage.setItem(MAP_KEY_STORAGE, value);
    setStatus("高德 JS Key 已保存，正在重载地图...");
    window.location.reload();
  });
  radiusInput.addEventListener("input", (event) => {
    state.radius = Number(event.target.value);
    updateRadiusText();
  });
  radiusInput.addEventListener("change", () => refreshNearbyCourts(true));
  favoritesOnlyInput.addEventListener("change", (event) => {
    state.showFavoritesOnly = event.target.checked;
    renderCourtList();
    syncMarkerVisibility();
  });
}

function initMapKeyInput() {
  mapKeyInput.value = getMapJsKey();
}

async function initMapEngine() {
  const mapKey = getMapJsKey();
  if (!mapKey) {
    setStatus("请先填写“高德 JS 地图 Key”并保存。");
    return false;
  }
  try {
    const AMap = await loadAmapSdk(mapKey);
    state.map = new AMap.Map("map", {
      center: [state.userLocation.lon, state.userLocation.lat],
      zoom: 14,
      viewMode: "2D",
      resizeEnable: true,
    });
    state.infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -30) });
    state.map.addControl(
      new AMap.ToolBar({
        position: { top: "10px", right: "10px" },
      })
    );
    setStatus("高德地图引擎加载完成。");
    return true;
  } catch (error) {
    console.error(error);
    setStatus("高德地图引擎加载失败，请检查 JS Key 与域名白名单。");
    return false;
  }
}

function loadAmapSdk(key) {
  if (window.AMap && window.AMap.Map) {
    return Promise.resolve(window.AMap);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-sdk="amap-js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.AMap));
      existing.addEventListener("error", () => reject(new Error("高德 JS SDK 加载失败")));
      return;
    }
    const script = document.createElement("script");
    script.dataset.sdk = "amap-js";
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.ToolBar`;
    script.async = true;
    script.onload = () => {
      if (window.AMap?.Map) {
        resolve(window.AMap);
      } else {
        reject(new Error("高德 JS SDK 未就绪"));
      }
    };
    script.onerror = () => reject(new Error("高德 JS SDK 网络加载失败"));
    document.head.append(script);
  });
}

function updateRadiusText() {
  radiusText.textContent = `${(state.radius / 1000).toFixed(1)} km`;
}

async function locateUserAndRefresh() {
  const location = await getUserLocation();
  state.userLocation = location;
  if (state.map) {
    state.map.setZoomAndCenter(14, [location.lon, location.lat]);
  }
  await refreshNearbyCourts(false);
}

function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      setStatus("浏览器不支持定位，已使用默认城市中心。");
      resolve({ ...DEFAULT_CENTER });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => {
        setStatus("定位失败，已使用默认城市中心。");
        resolve({ ...DEFAULT_CENTER });
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  });
}

async function refreshNearbyCourts(fromManualAction) {
  setStatus("正在收集附近羽毛球场...");
  try {
    const rawCourts = await fetchNearbyCourts(state.userLocation, state.radius);
    state.courts = enrichCourtData(rawCourts);
    renderAll();
    setStatus(fromManualAction ? "数据刷新完成。" : `已加载 ${state.courts.length} 个场馆。`);
  } catch (error) {
    console.error(error);
    state.courts = enrichCourtData(buildFallbackCourts(state.userLocation));
    renderAll();
    setStatus("地图接口繁忙，已切换离线示例数据。");
  }
}

async function fetchNearbyCourts(location, radius) {
  const amapCourts = await fetchNearbyCourtsFromProxy(location, radius);
  if (amapCourts.length > 0) {
    return amapCourts;
  }
  return fetchNearbyCourtsFromOverpass(location, radius);
}

async function fetchNearbyCourtsFromProxy(location, radius) {
  const params = new URLSearchParams({
    lat: String(location.lat),
    lon: String(location.lon),
    radius: String(radius),
  });
  const response = await fetchWithTimeout(`/api/amap/around?${params.toString()}`, { method: "GET" }, 10000);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  if (data.status !== "ok") {
    return [];
  }
  const pois = Array.isArray(data.pois) ? data.pois : [];
  return normalizeAmapCourts(pois, location);
}

async function fetchNearbyCourtsFromOverpass(location, radius) {
  const query = `
[out:json][timeout:20];
(
  node(around:${radius},${location.lat},${location.lon})["sport"="badminton"];
  way(around:${radius},${location.lat},${location.lon})["sport"="badminton"];
  relation(around:${radius},${location.lat},${location.lon})["sport"="badminton"];
  node(around:${radius},${location.lat},${location.lon})["leisure"="sports_centre"]["name"~"羽毛球|badminton",i];
  way(around:${radius},${location.lat},${location.lon})["leisure"="sports_centre"]["name"~"羽毛球|badminton",i];
  relation(around:${radius},${location.lat},${location.lon})["leisure"="sports_centre"]["name"~"羽毛球|badminton",i];
);
out center tags;
`.trim();
  const errors = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(`${endpoint}?data=${encodeURIComponent(query)}`, { method: "GET" }, 10000);
      if (!response.ok) {
        errors.push(`${endpoint}: ${response.status}`);
        continue;
      }
      const data = await response.json();
      const list = normalizeCourts(data.elements, location);
      if (list.length > 0) {
        return list;
      }
      errors.push(`${endpoint}: empty`);
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  throw new Error(`Overpass全部失败: ${errors.join(" | ")}`);
}

function normalizeAmapCourts(pois, userLocation) {
  return pois
    .map((poi) => {
      const [lonText, latText] = String(poi.location || "").split(",");
      const lon = Number(lonText);
      const lat = Number(latText);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }
      return {
        id: `amap-${poi.id || hashString(`${poi.name}-${lat}-${lon}`)}`,
        name: poi.name || "未命名羽毛球场",
        lat,
        lon,
        address: poi.address || poi.pname || "暂无详细地址",
        distance: calcDistance(userLocation.lat, userLocation.lon, lat, lon),
        source: "Amap",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
}

function normalizeCourts(elements, userLocation) {
  const seen = new Set();
  const list = [];
  for (const element of elements || []) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") {
      continue;
    }
    const id = `${element.type}-${element.id}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    list.push({
      id,
      name: element.tags?.name || "未命名羽毛球场",
      lat,
      lon,
      address: formatAddress(element.tags),
      distance: calcDistance(userLocation.lat, userLocation.lon, lat, lon),
      source: "OpenStreetMap",
    });
  }
  return list.sort((a, b) => a.distance - b.distance).slice(0, 80);
}

function formatAddress(tags = {}) {
  const parts = [tags["addr:city"], tags["addr:district"], tags["addr:street"], tags["addr:housenumber"]].filter(Boolean);
  return parts.length > 0 ? parts.join("") : "暂无详细地址";
}

function enrichCourtData(courts) {
  const now = new Date();
  const minuteKey = `${now.getHours()}:${now.getMinutes()}`;
  return courts.map((court) => {
    const seed = hashString(`${court.id}-${minuteKey}`);
    const occupiedRatio = 0.35 + (seed % 55) / 100;
    return {
      ...court,
      isOpen: now.getHours() >= 7 && now.getHours() <= 22,
      occupiedRatio,
      freeSlots: Math.max(0, Math.round((1 - occupiedRatio) * 12)),
      reserving: Math.round(occupiedRatio * 36),
      updatedAt: now.toLocaleTimeString("zh-CN", { hour12: false }),
    };
  });
}

function refreshStatusesOnly() {
  if (!state.courts.length) {
    return;
  }
  state.courts = enrichCourtData(state.courts);
  renderAll();
  setStatus("预约与营业状态已自动刷新。");
}

function renderAll() {
  renderMarkers();
  renderCourtList();
  syncMarkerVisibility();
}

function renderMarkers() {
  if (!state.map || !window.AMap) {
    return;
  }
  const visibleIds = new Set(state.courts.map((item) => item.id));
  for (const [id, marker] of state.markerMap.entries()) {
    if (!visibleIds.has(id)) {
      marker.setMap(null);
      state.markerMap.delete(id);
    }
  }

  for (const court of state.courts) {
    let marker = state.markerMap.get(court.id);
    if (!marker) {
      marker = new AMap.Marker({
        position: [court.lon, court.lat],
        title: court.name,
      });
      marker.on("click", () => openCourtInfo(court.id));
      marker.setMap(state.map);
      state.markerMap.set(court.id, marker);
    } else {
      marker.setPosition([court.lon, court.lat]);
      marker.setTitle(court.name);
    }
  }
}

function openCourtInfo(courtId) {
  const court = state.courts.find((item) => item.id === courtId);
  const marker = state.markerMap.get(courtId);
  if (!court || !marker || !state.infoWindow) {
    return;
  }
  state.infoWindow.setContent(buildPopupHtml(court));
  state.infoWindow.open(state.map, marker.getPosition());
  window.setTimeout(() => {
    const btn = document.querySelector("#popupFavoriteBtn");
    if (!btn) {
      return;
    }
    btn.onclick = () => {
      toggleFavorite(courtId);
      openCourtInfo(courtId);
    };
  }, 0);
}

function buildPopupHtml(court) {
  const favoriteText = state.favorites.has(court.id) ? "已收藏" : "收藏";
  return `
    <h3 class="popup-name">${escapeHtml(court.name)}</h3>
    <p class="popup-meta">${escapeHtml(court.address)} · ${(court.distance / 1000).toFixed(2)} km</p>
    <p class="popup-status">${court.isOpen ? "营业中" : "已休息"} | 预约中 ${court.reserving} 人 | 可约场地 ${court.freeSlots} | 更新时间 ${court.updatedAt}</p>
    <div class="popup-actions">
      <a href="${buildNavigationUrl(court)}" target="_blank" rel="noopener noreferrer">导航</a>
      <button id="popupFavoriteBtn" type="button">${favoriteText}</button>
    </div>
  `;
}

function renderCourtList() {
  courtList.innerHTML = "";
  const visibleCourts = getVisibleCourts();
  if (!visibleCourts.length) {
    const empty = document.createElement("li");
    empty.className = "status";
    empty.textContent = state.showFavoritesOnly ? "暂无收藏场馆。" : "当前半径内暂无场馆数据。";
    courtList.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const court of visibleCourts) {
    const item = itemTemplate.content.firstElementChild.cloneNode(true);
    const favBtn = item.querySelector(".favorite-btn");
    const nameEl = item.querySelector(".court-name");
    const metaEl = item.querySelector(".court-meta");
    const statusEl = item.querySelector(".court-status");
    const focusBtn = item.querySelector(".focus-btn");
    const navBtn = item.querySelector(".navigate-btn");

    const isFavorite = state.favorites.has(court.id);
    item.classList.toggle("is-favorite", isFavorite);
    favBtn.classList.toggle("active", isFavorite);
    favBtn.textContent = isFavorite ? "★" : "☆";
    nameEl.textContent = court.name;
    metaEl.textContent = `${court.address} · ${(court.distance / 1000).toFixed(2)} km`;
    statusEl.textContent = `${court.isOpen ? "营业中" : "已休息"} | 预约中 ${court.reserving} 人 | 可约 ${court.freeSlots} 片`;
    favBtn.addEventListener("click", () => toggleFavorite(court.id));
    focusBtn.addEventListener("click", () => focusCourt(court.id));
    navBtn.addEventListener("click", () => window.open(buildNavigationUrl(court), "_blank", "noopener"));
    fragment.append(item);
  }
  courtList.append(fragment);
}

function getVisibleCourts() {
  return state.showFavoritesOnly ? state.courts.filter((court) => state.favorites.has(court.id)) : state.courts;
}

function syncMarkerVisibility() {
  const visibleIds = new Set(getVisibleCourts().map((court) => court.id));
  for (const [id, marker] of state.markerMap.entries()) {
    if (visibleIds.has(id)) {
      marker.show();
    } else {
      marker.hide();
    }
  }
}

function toggleFavorite(courtId) {
  if (!courtId) {
    return;
  }
  if (state.favorites.has(courtId)) {
    state.favorites.delete(courtId);
  } else {
    state.favorites.add(courtId);
  }
  saveFavorites([...state.favorites]);
  renderAll();
}

function focusCourt(courtId) {
  const court = state.courts.find((item) => item.id === courtId);
  if (!court || !state.map) {
    return;
  }
  state.map.setZoomAndCenter(16, [court.lon, court.lat]);
  openCourtInfo(court.id);
}

function buildNavigationUrl(court) {
  return `https://uri.amap.com/navigation?to=${court.lon},${court.lat},${encodeURIComponent(court.name)}&mode=walk&policy=1&src=cursor-badminton-map`;
}

function getMapJsKey() {
  const fromQuery = new URLSearchParams(window.location.search).get("mapKey");
  if (fromQuery) {
    return fromQuery.trim();
  }
  return (localStorage.getItem(MAP_KEY_STORAGE) || "").trim();
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

function fetchWithTimeout(url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

function setStatus(message) {
  loadingText.textContent = message;
}

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function calcDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earth = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildFallbackCourts(location) {
  const presets = [
    { name: "市民羽毛球馆", dLat: 0.0042, dLon: 0.0031, address: "附近主干道A口" },
    { name: "活力羽球中心", dLat: -0.0038, dLon: 0.0026, address: "附近主干道B口" },
    { name: "全民运动中心羽毛球馆", dLat: 0.0021, dLon: -0.004, address: "附近主干道C口" },
    { name: "晨光羽毛球俱乐部", dLat: -0.0027, dLon: -0.003, address: "附近主干道D口" },
    { name: "星跃羽球馆", dLat: 0.0051, dLon: -0.0012, address: "附近主干道E口" },
  ];
  return presets.map((item, index) => {
    const lat = location.lat + item.dLat;
    const lon = location.lon + item.dLon;
    return {
      id: `fallback-${index + 1}`,
      name: item.name,
      lat,
      lon,
      address: item.address,
      distance: calcDistance(location.lat, location.lon, lat, lon),
      source: "Fallback",
    };
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
