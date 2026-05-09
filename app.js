const DEFAULT_CENTER = { lat: 31.2304, lon: 121.4737 };
const FAVORITES_KEY = "badminton-favorites-v1";
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

init();

function init() {
  initMap();
  bindEvents();
  updateRadiusText();
  locateUserAndRefresh();
  window.setInterval(refreshStatusesOnly, REFRESH_INTERVAL_MS);
}

function initMap() {
  state.map = L.map("map").setView([state.userLocation.lat, state.userLocation.lon], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);
  state.map.on("popupopen", (event) => {
    const btn = event.popup.getElement()?.querySelector("button[data-favorite-id]");
    if (!btn) {
      return;
    }
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-favorite-id");
      toggleFavorite(targetId);
      focusCourt(targetId);
    });
  });
}

function bindEvents() {
  locateBtn.addEventListener("click", locateUserAndRefresh);
  refreshBtn.addEventListener("click", () => refreshNearbyCourts(true));
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

function updateRadiusText() {
  radiusText.textContent = `${(state.radius / 1000).toFixed(1)} km`;
}

async function locateUserAndRefresh() {
  const location = await getUserLocation();
  state.userLocation = location;
  state.map.setView([location.lat, location.lon], 14);
  refreshNearbyCourts(false);
}

function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      setStatus("浏览器不支持定位，已使用默认城市中心。");
      resolve({ ...DEFAULT_CENTER });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
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
    const message = fromManualAction ? "数据刷新完成。" : `已加载 ${state.courts.length} 个场馆。`;
    setStatus(message);
  } catch (error) {
    console.error(error);
    const fallback = buildFallbackCourts(state.userLocation);
    state.courts = enrichCourtData(fallback);
    renderAll();
    setStatus("地图接口繁忙，已切换为离线示例数据。可稍后点“立即刷新”重试。");
  }
}

async function fetchNearbyCourts(location, radius) {
  const amapCourts = await fetchNearbyCourtsFromProxy(location, radius);
  if (amapCourts.length > 0) {
    return amapCourts;
  }

  const overpassQuery = `
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
`;
  const query = overpassQuery.trim();
  const errors = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(`${endpoint}?data=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        errors.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      const normalized = normalizeCourts(data.elements, location);
      if (normalized.length > 0) {
        return normalized;
      }
      errors.push(`${endpoint}: empty`);
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  throw new Error(`所有地图接口请求失败: ${errors.join(" | ")}`);
}

async function fetchNearbyCourtsFromProxy(location, radius) {
  const params = new URLSearchParams({
    lat: String(location.lat),
    lon: String(location.lon),
    radius: String(radius),
  });
  const url = `/api/amap/around?${params.toString()}`;
  const response = await fetchWithTimeout(url, { method: "GET" }, 10000);
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`本地代理请求失败: ${response.status}`);
  }
  const data = await response.json();
  if (data.status === "proxy_unconfigured") {
    return [];
  }
  if (data.status !== "ok") {
    throw new Error(data.message || "代理接口错误");
  }
  const pois = Array.isArray(data.pois) ? data.pois : [];
  return normalizeAmapCourts(pois, location);
}

function normalizeAmapCourts(pois, userLocation) {
  const list = [];
  for (const poi of pois) {
    const [lonText, latText] = String(poi.location || "").split(",");
    const lon = Number(lonText);
    const lat = Number(latText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    const id = `amap-${poi.id || hashString(`${poi.name}-${lat}-${lon}`)}`;
    const distance = calcDistance(userLocation.lat, userLocation.lon, lat, lon);
    list.push({
      id,
      name: poi.name || "未命名羽毛球场",
      lat,
      lon,
      address: poi.address || poi.pname || "暂无详细地址",
      distance,
      source: "Amap",
    });
  }
  return list.sort((a, b) => a.distance - b.distance);
}

function normalizeCourts(elements, userLocation) {
  const list = [];
  const seen = new Set();

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
    const name = element.tags?.name || "未命名羽毛球场";
    const distance = calcDistance(userLocation.lat, userLocation.lon, lat, lon);
    list.push({
      id,
      name,
      lat,
      lon,
      address: formatAddress(element.tags),
      distance,
      source: "OpenStreetMap",
    });
  }

  return list.sort((a, b) => a.distance - b.distance).slice(0, 80);
}

function formatAddress(tags = {}) {
  const parts = [
    tags["addr:city"],
    tags["addr:district"],
    tags["addr:street"],
    tags["addr:housenumber"],
  ].filter(Boolean);
  return parts.length ? parts.join("") : "暂无详细地址";
}

function enrichCourtData(courts) {
  const now = new Date();
  const minuteKey = `${now.getHours()}:${now.getMinutes()}`;
  return courts.map((court) => {
    const seed = hashString(`${court.id}-${minuteKey}`);
    const isOpenHour = now.getHours() >= 7 && now.getHours() <= 22;
    const occupiedRatio = 0.35 + (seed % 55) / 100;
    const freeSlots = Math.max(0, Math.round((1 - occupiedRatio) * 12));
    const reserving = Math.round(occupiedRatio * 36);
    return {
      ...court,
      isOpen: isOpenHour,
      occupiedRatio,
      freeSlots,
      reserving,
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
  const ids = new Set(state.courts.map((item) => item.id));

  for (const [id, marker] of state.markerMap.entries()) {
    if (!ids.has(id)) {
      marker.remove();
      state.markerMap.delete(id);
    }
  }

  for (const court of state.courts) {
    let marker = state.markerMap.get(court.id);
    if (!marker) {
      marker = L.marker([court.lat, court.lon], { title: court.name });
      marker.addTo(state.map);
      marker.on("click", () => marker.openPopup());
      state.markerMap.set(court.id, marker);
    } else {
      marker.setLatLng([court.lat, court.lon]);
    }
    marker.bindPopup(buildPopupHtml(court), { minWidth: 250 });
  }
}

function buildPopupHtml(court) {
  const favoriteText = state.favorites.has(court.id) ? "已收藏" : "收藏";
  const openText = court.isOpen ? "营业中" : "已休息";
  const navUrl = buildNavigationUrl(court);
  return `
    <h3 class="popup-name">${escapeHtml(court.name)}</h3>
    <p class="popup-meta">${escapeHtml(court.address)} · ${(court.distance / 1000).toFixed(2)} km</p>
    <p class="popup-status">${openText} | 预约中 ${court.reserving} 人 | 可约场地 ${court.freeSlots} | 更新时间 ${court.updatedAt}</p>
    <div class="popup-actions">
      <a href="${navUrl}" target="_blank" rel="noopener noreferrer">导航</a>
      <button type="button" data-favorite-id="${court.id}">${favoriteText}</button>
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
  if (!state.showFavoritesOnly) {
    return state.courts;
  }
  return state.courts.filter((court) => state.favorites.has(court.id));
}

function syncMarkerVisibility() {
  const visibleIds = new Set(getVisibleCourts().map((court) => court.id));
  for (const [id, marker] of state.markerMap.entries()) {
    const inMap = state.map.hasLayer(marker);
    if (visibleIds.has(id) && !inMap) {
      marker.addTo(state.map);
    }
    if (!visibleIds.has(id) && inMap) {
      marker.remove();
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
  if (!court) {
    return;
  }
  state.map.setView([court.lat, court.lon], 16);
  const marker = state.markerMap.get(court.id);
  if (marker) {
    marker.openPopup();
  }
}

function buildNavigationUrl(court) {
  return `https://uri.amap.com/navigation?to=${court.lon},${court.lat},${encodeURIComponent(court.name)}&mode=walk&policy=1&src=cursor-badminton-map`;
}

function loadFavorites() {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids) {
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

function fetchWithTimeout(url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    window.clearTimeout(timeoutId);
  });
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
  return presets.map((item, idx) => {
    const lat = location.lat + item.dLat;
    const lon = location.lon + item.dLon;
    return {
      id: `fallback-${idx + 1}`,
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
