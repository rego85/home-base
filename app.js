// Home Base — household dashboard
const CFG = window.DASH_CONFIG || {};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmtDay = (d, opts = { weekday: "short", month: "short", day: "numeric" }) => d.toLocaleDateString(undefined, opts);
const fmtTime = (iso) => { const d = new Date(iso); return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return fmtDay(new Date(ms), { month: "short", day: "numeric" });
};

/* ---------- state ---------- */
const S = { store: null, weather: null, alerts: [], loc: null, status: {}, prefs: {}, groceries: [], notes: [], chores: [], bills: [], loaded: {} };

/* ---------- panels people can turn on or off ---------- */
const PANELS = [
  ["weather", "Weather", ".weather"], ["moon", "Moon", ".moon"], ["traffic", "Commute", ".traffic"],
  ["news", "Top story", ".news"], ["bins", "Garbage bins (Sundays)", "#binsCard"], ["yard", "Yard work", "#yardCard"],
  ["bills", "Upcoming bills", ".bills"], ["groceries", "Groceries", ".groceries"], ["chores", "Household chores", ".chores"],
  ["notes", "Notes & reminders", ".notes"], ["calendar", "Calendar", ".calendar"],
];
// A device can keep its own list (e.g. the wall screen); otherwise the signed-in person's list applies.
function deviceHidden() { try { const v = localStorage.getItem("hb:devicePanels"); return v ? JSON.parse(v) : null; } catch { return null; } }
const hiddenPanels = () => deviceHidden() || S.prefs.hiddenPanels || [];
const isOn = (key) => !hiddenPanels().includes(key);

/* ---------- storage: this device only ---------- */
function localStore() {
  const subs = {};
  const empty = (c) => (c === "status" ? {} : []);
  const read = (c) => { try { return JSON.parse(localStorage.getItem("hb:" + c)) || empty(c); } catch { return empty(c); } };
  const write = (c, v) => { try { localStorage.setItem("hb:" + c, JSON.stringify(v)); } catch {} (subs[c] || []).forEach((f) => f(v)); };
  return {
    mode: "local",
    who: "",
    watch(c, cb) { (subs[c] ||= []).push(cb); cb(read(c)); },
    add(c, d) { write(c, [...read(c), { id: uid(), ...d }]); },
    update(c, id, p) { write(c, read(c).map((x) => (x.id === id ? { ...x, ...p } : x))); },
    remove(c, id) { write(c, read(c).filter((x) => x.id !== id)); },
    removeMany(c, ids) { const set = new Set(ids); write(c, read(c).filter((x) => !set.has(x.id))); },
    watchStatus(cb) { this.watch("status", cb); },
    setStatus(p) { write("status", { ...read("status"), ...p }); },
    watchPrefs(cb) { (subs.prefs ||= []).push(cb); cb(read("prefs")); },
    setPrefs(p) { write("prefs", { ...read("prefs"), ...p }); },
  };
}

/* ---------- storage: Firebase (shared between devices) ---------- */
async function firebaseStore(fbCfg) {
  const B = "https://www.gstatic.com/firebasejs/10.12.2";
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${B}/firebase-app.js`), import(`${B}/firebase-auth.js`), import(`${B}/firebase-firestore.js`),
  ]);
  const app = initializeApp(fbCfg);
  const auth = A.getAuth(app);
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch { db = F.getFirestore(app); }

  A.getRedirectResult(auth).catch((e) => showSignInError(e));
  const user = await new Promise((resolve) => {
    A.onAuthStateChanged(auth, (u) => {
      if (u) { $("signin").hidden = true; resolve(u); }
      else $("signin").hidden = false;
    });
    $("signInBtn").onclick = async () => {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" }); // lets each person pick their own account
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        if (/popup/.test(e.code || "")) A.signInWithRedirect(auth, provider);
        else showSignInError(e);
      }
    };
  });
  $("signOutBtn").hidden = false;
  $("signOutBtn").onclick = () => A.signOut(auth).then(() => location.reload());

  const base = "households/home";
  const onErr = (e) => {
    console.error(e);
    if (e.code === "permission-denied") {
      $("syncPill").textContent = "Not on household list";
      $("syncPill").className = "sync-pill";
      alertBanner(`The account ${user.email} can't open this household's lists. Ask whoever set up Home Base to add it to the Firestore rules.`);
    }
  };
  return {
    mode: "firebase",
    who: (user.displayName || user.email || "").split(/[ @]/)[0],
    token: () => user.getIdToken(),
    watch(c, cb) {
      F.onSnapshot(F.collection(db, `${base}/${c}`), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr);
    },
    add(c, d) { return F.addDoc(F.collection(db, `${base}/${c}`), d).catch(onErr); },
    update(c, id, p) { return F.updateDoc(F.doc(db, `${base}/${c}/${id}`), p).catch(onErr); },
    remove(c, id) { return F.deleteDoc(F.doc(db, `${base}/${c}/${id}`)).catch(onErr); },
    removeMany(c, ids) { const b = F.writeBatch(db); ids.forEach((id) => b.delete(F.doc(db, `${base}/${c}/${id}`))); return b.commit().catch(onErr); },
    watchStatus(cb) {
      F.onSnapshot(F.doc(db, `${base}/meta/status`), (snap) => {
        if (!snap.exists() && snap.metadata.fromCache) return; // wait for the server before treating it as empty
        cb(snap.data() || {});
      }, onErr);
    },
    setStatus(p) { return F.setDoc(F.doc(db, `${base}/meta/status`), p, { merge: true }).catch(onErr); },
    // Each person's own settings (which panels they see), synced across their devices.
    watchPrefs(cb) { F.onSnapshot(F.doc(db, `${base}/prefs/${user.uid}`), (snap) => cb(snap.data() || {}), onErr); },
    setPrefs(p) { return F.setDoc(F.doc(db, `${base}/prefs/${user.uid}`), p, { merge: true }).catch(onErr); },
  };
}
function showSignInError(e) {
  if (!e) return;
  const el = $("signInError");
  el.hidden = false;
  el.textContent = `Sign-in didn't finish (${e.code || e.message}). Try again.`;
}
function alertBanner(text) {
  const el = document.createElement("div");
  el.className = "alert bad";
  el.textContent = text;
  $("todayStrip").before(el);
}

/* ---------- moon ---------- */
const SYNODIC = 29.530588853;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14) / 86400000; // a known new moon, in days
function moonInfo(date = new Date()) {
  const days = date.getTime() / 86400000;
  const age = (((days - NEW_MOON_REF) % SYNODIC) + SYNODIC) % SYNODIC;
  const p = age / SYNODIC;
  const illum = (1 - Math.cos(2 * Math.PI * p)) / 2;
  const names = [
    [1.0, "New Moon"], [6.38, "Waxing Crescent"], [8.38, "First Quarter"], [13.77, "Waxing Gibbous"],
    [15.77, "Full Moon"], [21.15, "Waning Gibbous"], [23.15, "Last Quarter"], [28.53, "Waning Crescent"], [99, "New Moon"],
  ];
  const name = names.find(([lim]) => age < lim)[1];
  const toFull = ((SYNODIC / 2 - age) + SYNODIC) % SYNODIC;
  const toNew = SYNODIC - age;
  return { age, p, illum, name, nextFull: new Date(date.getTime() + toFull * 86400000), nextNew: new Date(date.getTime() + toNew * 86400000) };
}
function moonPath(p) {
  const r = 50, rx = Math.abs(Math.cos(2 * Math.PI * p)) * r;
  if (p < 0.5) {
    const sweep = p < 0.25 ? 0 : 1;
    return `M50 0 A50 50 0 0 1 50 100 A${rx} 50 0 0 ${sweep} 50 0Z`;
  }
  const sweep = p < 0.75 ? 0 : 1;
  return `M50 0 A50 50 0 0 0 50 100 A${rx} 50 0 0 ${sweep} 50 0Z`;
}
function renderMoon() {
  const m = moonInfo();
  $("moonSvg").innerHTML = `
    <circle cx="50" cy="50" r="52" class="moon-halo"/>
    <circle cx="50" cy="50" r="50" class="moon-dark"/>
    <path d="${moonPath(m.p)}" class="moon-lit"/>
    <circle cx="36" cy="38" r="6" class="moon-crater"/><circle cx="62" cy="62" r="8" class="moon-crater"/><circle cx="60" cy="30" r="4" class="moon-crater"/>`;
  $("moonName").textContent = m.name;
  $("moonIllum").textContent = `${Math.round(m.illum * 100)}% illuminated`;
  $("moonAge").textContent = `Day ${Math.floor(m.age) + 1} of 29.5`;
  const full = m.name === "Full Moon" ? "Tonight" : fmtDay(m.nextFull);
  const nw = m.name === "New Moon" ? "Tonight" : fmtDay(m.nextNew);
  $("moonNext").innerHTML = `<li>Next full moon: <b>${esc(full)}</b></li><li>Next new moon: <b>${esc(nw)}</b></li>`;
  return m;
}

/* ---------- weather ---------- */
const WX = {
  sun: `<g class="wx-sun"><circle cx="24" cy="24" r="8.5"/><g stroke-width="3" stroke-linecap="round"><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/></g></g>`,
  moon: `<path class="wx-moon" d="M30 8a16 16 0 1 0 10 25A13 13 0 0 1 30 8z"/>`,
  cloud: (y = 0) => `<path class="wx-cloud" transform="translate(0 ${y})" d="M14.5 38h20a8.5 8.5 0 0 0 1.2-16.9A11.5 11.5 0 0 0 13.6 23 7.5 7.5 0 0 0 14.5 38z"/>`,
  smallSun: `<g class="wx-sun" transform="translate(-6 -6) scale(.75)"><circle cx="24" cy="24" r="8.5"/><g stroke-width="3" stroke-linecap="round"><path d="M24 6v5M6 24h5M11.3 11.3l3.5 3.5M36.7 11.3l-3.5 3.5"/></g></g>`,
  rain: `<g class="wx-rain" stroke-width="2.6" stroke-linecap="round"><path d="M17 37l-2 6M25 37l-2 6M33 37l-2 6"/></g>`,
  snow: `<g class="wx-snow"><circle cx="16" cy="40" r="2.2"/><circle cx="24" cy="44" r="2.2"/><circle cx="32" cy="40" r="2.2"/></g>`,
  bolt: `<path class="wx-bolt" d="M26 31l-6 9h5l-2 7 8-10h-5l3-6z"/>`,
  fog: `<g class="wx-fog" stroke-width="3" stroke-linecap="round"><path d="M9 20h30M6 27h36M11 34h26"/></g>`,
};
function wxInfo(code, isDay = 1) {
  const c = Number(code);
  if (c === 0) return { t: isDay ? "Clear" : "Clear night", i: isDay ? WX.sun : WX.moon };
  if (c <= 2) return { t: c === 1 ? "Mostly clear" : "Partly cloudy", i: (isDay ? WX.smallSun : "") + WX.cloud() };
  if (c === 3) return { t: "Cloudy", i: WX.cloud() };
  if (c === 45 || c === 48) return { t: "Fog", i: WX.fog };
  if (c >= 51 && c <= 57) return { t: "Drizzle", i: WX.cloud(-5) + WX.rain };
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { t: c >= 80 ? "Showers" : "Rain", i: WX.cloud(-5) + WX.rain };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { t: "Snow", i: WX.cloud(-5) + WX.snow };
  if (c >= 95) return { t: "Thunderstorms", i: WX.cloud(-5) + WX.bolt };
  return { t: "—", i: WX.cloud() };
}
const icon = (code, isDay, cls = "") => `<svg class="wx ${cls}" viewBox="0 0 48 48" aria-hidden="true">${wxInfo(code, isDay).i}</svg>`;

function getLocation() {
  const home = { ...CFG.homeLocation, isHome: true };
  if (!CFG.useDeviceLocation || !navigator.geolocation) return Promise.resolve(home);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const nearHome = Math.hypot(lat - home.lat, (lon - home.lon) * Math.cos((lat * Math.PI) / 180)) < 0.12; // ~13 km
        resolve(nearHome ? { ...home, lat, lon } : { name: "Current location", lat, lon });
      },
      () => resolve(home),
      { timeout: 8000, maximumAge: 30 * 60000 },
    );
  });
}

async function loadWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem("hb:weather") || "null");
    if (cached && !S.weather) { S.weather = cached.w; S.alerts = cached.a || []; S.loc = cached.loc; renderAll(); }
  } catch {}
  const loc = await getLocation();
  S.loc = loc;
  $("weatherPlace").textContent = loc.name;
  const q = new URLSearchParams({
    latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,is_day",
    hourly: "wind_gusts_10m,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_gusts_10m_max,sunrise,sunset,uv_index_max",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
    timezone: "auto", forecast_days: "7",
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    S.weather = await res.json();
    S.weather.fetchedAt = Date.now();
  } catch (e) {
    console.warn("Weather failed", e);
    if (!S.weather) $("weatherBody").innerHTML = `<p class="muted">Couldn't load the forecast. Check your connection; it retries every 30 minutes.</p>`;
  }
  S.alerts = await loadNwsAlerts(loc);
  try { localStorage.setItem("hb:weather", JSON.stringify({ w: S.weather, a: S.alerts, loc })); } catch {}
  renderAll();
}

async function loadNwsAlerts(loc) {
  try {
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`, { headers: { Accept: "application/geo+json" } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.features || []).map((f) => ({
      title: f.properties.event,
      detail: f.properties.ends || f.properties.expires ? `Until ${fmtDay(new Date(f.properties.ends || f.properties.expires), { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "",
      severe: ["Extreme", "Severe"].includes(f.properties.severity),
      source: "nws",
    }));
  } catch { return []; }
}

function derivedAlerts() {
  const w = S.weather;
  if (!w?.daily) return [];
  const d = w.daily, out = [];
  const official = S.alerts.map((a) => a.title.toLowerCase()).join(" ");
  const gust = d.wind_gusts_10m_max[0];
  if (gust >= 45 && !official.includes("wind")) out.push({ title: "High wind", detail: `Gusts up to ${Math.round(gust)} mph today. Secure trash lids and patio furniture.`, severe: gust >= 60 });
  [0, 1].forEach((i) => {
    const sn = d.snowfall_sum[i];
    if (sn >= 3 && !official.includes("winter") && !official.includes("snow")) out.push({ title: "Snow", detail: `${sn.toFixed(1)} in expected ${i ? "tomorrow" : "today"}.`, severe: sn >= 8 });
  });
  const tonightLow = d.temperature_2m_min[1];
  const month = new Date().getMonth();
  if (month >= 4 && month <= 9 && tonightLow <= 32 && !official.includes("frost") && !official.includes("freeze")) out.push({ title: "Frost tonight", detail: `Low near ${Math.round(tonightLow)}°. Cover or bring in plants.` });
  if (tonightLow <= 0 && !official.includes("cold")) out.push({ title: "Bitter cold tonight", detail: `Low near ${Math.round(tonightLow)}°. Keep pets in and let faucets drip.`, severe: tonightLow <= -15 });
  if (d.weather_code[0] >= 95 && !official.includes("thunder")) out.push({ title: "Thunderstorms possible", detail: "Lightning risk today, so plan outdoor work around it." });
  return out;
}
const allAlerts = () => [...S.alerts, ...derivedAlerts()];

function renderWeather() {
  const w = S.weather;
  if (S.loc) $("weatherPlace").textContent = S.loc.name;
  if (!w?.current) return;
  const c = w.current, d = w.daily;
  const info = wxInfo(c.weather_code, c.is_day);
  const todayKey = ymd(new Date());
  const alerts = allAlerts();
  const rise = d.sunrise[0], set = d.sunset[0];
  const daylightMin = (new Date(set) - new Date(rise)) / 60000;
  $("weatherBody").innerHTML = `
    <div class="now">
      ${icon(c.weather_code, c.is_day, "now-icon")}
      <div>
        <div class="now-temp">${Math.round(c.temperature_2m)}°</div>
        <div class="now-desc">${esc(info.t)} · H ${Math.round(d.temperature_2m_max[0])}° L ${Math.round(d.temperature_2m_min[0])}°</div>
      </div>
      <div class="now-meta">
        <span>Feels like</span><b>${Math.round(c.apparent_temperature)}°</b>
        <span>Wind</span><b>${Math.round(c.wind_speed_10m)} mph, gusts ${Math.round(c.wind_gusts_10m)}</b>
        <span>Humidity</span><b>${Math.round(c.relative_humidity_2m)}%</b>
        <span>UV index</span><b>${Math.round(d.uv_index_max[0] ?? 0)}</b>
      </div>
    </div>
    ${alerts.length ? `<div class="alerts">${alerts.map((a) => `<div class="alert ${a.severe ? "bad" : ""}"><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div>`).join("")}</div>` : ""}
    <div class="sunline">
      <span>Sunrise <b>${fmtTime(rise)}</b></span>
      <span>Sunset <b>${fmtTime(set)}</b></span>
      <span>Daylight <b>${Math.floor(daylightMin / 60)}h ${Math.round(daylightMin % 60)}m</b></span>
    </div>
    <div class="days">
      ${d.time.map((t, i) => {
        const dt = parseYmd(t);
        const snow = d.snowfall_sum[i] >= 0.1;
        const pp = snow ? `${d.snowfall_sum[i].toFixed(1)}″ snow` : d.precipitation_probability_max[i] >= 15 ? `${d.precipitation_probability_max[i]}%` : "";
        return `<div class="day ${t === todayKey ? "today-col" : ""}">
          <span class="d">${t === todayKey ? "Today" : fmtDay(dt, { weekday: "short" })}</span>
          ${icon(d.weather_code[i], 1)}
          <span class="hi">${Math.round(d.temperature_2m_max[i])}°</span>
          <span class="lo">${Math.round(d.temperature_2m_min[i])}°</span>
          <span class="pp">${esc(pp)}</span>
        </div>`;
      }).join("")}
    </div>`;
  $("updatedAt").textContent = w.fetchedAt ? `Updated ${ago(w.fetchedAt)}.` : "";
}

/* ---------- bins ---------- */
// Is recycling picked up on this pickup morning? Counts whole weeks from the known recycling date.
function isRecyclingPickup(pickupDay) {
  const r = CFG.recycling;
  if (!r?.pickupDate) return false;
  const weeks = Math.round(daysBetween(parseYmd(r.pickupDate), pickupDay) / 7);
  const every = Number(r.everyWeeks) || 1;
  return ((weeks % every) + every) % every === 0;
}
function binsState(now = new Date()) {
  const night = CFG.binsNight ?? 0;
  const dow = now.getDay();
  const key = ymd(now);
  const st = S.status;
  if (dow === night) {
    const done = st.binsOut === key;
    const pickup = addDays(startOfDay(now), 1);
    const recycle = isRecyclingPickup(pickup);
    let nextRecycle = null;
    for (let k = 1; !recycle && k <= 8 && !nextRecycle; k++) if (isRecyclingPickup(addDays(pickup, 7 * k))) nextRecycle = addDays(startOfDay(now), 7 * k);
    const which = recycle ? "trash and recycling" : "trash only";
    const recycleNote = recycle ? "Recycling is picked up too this week."
      : `Not recycling. That goes out ${nextRecycle ? `${DAY_NAMES[night]} ${fmtDay(nextRecycle, { month: "short", day: "numeric" })}` : "another week"}.`;
    let wind = "";
    const h = S.weather?.hourly;
    if (h) {
      const from = `${key}T18:00`, to = `${ymd(addDays(now, 1))}T08:00`;
      const g = h.time.map((t, i) => (t >= from && t <= to ? h.wind_gusts_10m[i] : 0));
      const max = Math.max(0, ...g);
      if (max >= 30) wind = ` Gusts up to ${Math.round(max)} mph tonight. Weigh down the lids.`;
    }
    const bins = { trash: true, recycle };
    return done
      ? { title: recycle ? "Trash and recycling are out" : "Trash is out", detail: "Pickup is tomorrow morning.", tag: ["Done", "good"], btn: "Undo", act: () => S.store.setStatus({ binsOut: "" }), chip: null, bins }
      : { title: recycle ? "Trash + recycling out tonight" : "Trash out tonight", detail: recycleNote + wind, tag: [recycle ? "Both bins" : "Trash only", "warn"], btn: recycle ? "Both bins are out" : "Trash is out", act: () => S.store.setStatus({ binsOut: key }), chip: [`Bins tonight: ${which}`, "warn"], urgent: true, bins };
  }
  return null; // The bins panel only appears on garbage night.
}
function renderBins() {
  const b = isOn("bins") ? binsState() : null;
  $("binsCard").hidden = !b;
  document.querySelector(".grid").classList.toggle("show-bins", !!b);
  if (!b) return { chip: null };
  $("binsCard").classList.toggle("urgent", !!b.urgent);
  $("binsTitle").textContent = b.title;
  $("binsDetail").textContent = b.detail;
  $("binPills").innerHTML = `
    <span class="bin trash on">Trash</span>
    <span class="bin recycle ${b.bins.recycle ? "on" : "off"}">Recycling${b.bins.recycle ? "" : ": not this week"}</span>`;
  setTag("binsTag", b.tag);
  setBtn("binsBtn", b);
  return b;
}

/* ---------- yard ---------- */
function dayOutlook(key) {
  const d = S.weather?.daily;
  const i = d ? d.time.indexOf(key) : -1;
  if (i < 0) return null;
  const pp = d.precipitation_probability_max[i] ?? 0, sn = d.snowfall_sum[i] ?? 0, hi = d.temperature_2m_max[i], gust = d.wind_gusts_10m_max[i];
  const score = pp + sn * 30 + (hi < 40 ? 30 : 0) + (gust > 35 ? 20 : 0);
  const desc = sn >= 0.1 ? `${sn.toFixed(1)}″ snow` : `${pp}% rain`;
  return { key, score, hi, sn, text: `${Math.round(hi)}° · ${desc}`, code: d.weather_code[i] };
}
function yardState(now = new Date()) {
  const dow = now.getDay();
  const sat = dow === 6 ? startOfDay(now) : dow === 0 ? addDays(startOfDay(now), -1) : addDays(startOfDay(now), 6 - dow);
  const sun = addDays(sat, 1);
  const wkKey = ymd(sat);
  const done = S.status.yard === wkKey;
  const satO = dow === 0 ? null : dayOutlook(ymd(sat));
  const sunO = dayOutlook(ymd(sun));
  let pick = null;
  if (satO && sunO) pick = satO.score <= sunO.score ? "sat" : "sun";
  else if (sunO) pick = "sun";
  const compare = [satO && ["Saturday", satO, pick === "sat"], sunO && ["Sunday", sunO, pick === "sun"]].filter(Boolean);
  const snowy = (satO?.sn || 0) + (sunO?.sn || 0) >= 0.5;
  const rough = compare.length && compare.every(([, o]) => o.score >= 60);

  if (done) return { title: "Done for this weekend", detail: "Nice work.", tag: ["Done", "good"], btn: "Undo", act: () => S.store.setStatus({ yard: "" }), compare: [], chip: ["Yard work done", "good"] };
  const markDone = () => S.store.setStatus({ yard: wkKey });
  const note = snowy ? "Snow in the forecast. Shoveling may replace mowing this week." : rough ? "The weather looks rough both days. Consider skipping this week." : "";
  if (dow === 6) {
    const title = pick === "sun" ? "Better tomorrow (Sunday)" : "Today's a good day for it";
    return { title, detail: note || "Yard work is due this weekend.", tag: ["This weekend", "warn"], btn: "Mark done", act: markDone, compare, chip: [pick === "sun" ? "Yard work: Sunday looks better" : "Yard work today", "warn"] };
  }
  if (dow === 0) return { title: "Last chance this weekend", detail: note || "Yard work hasn't been checked off yet.", tag: ["Today", "warn"], btn: "Mark done", act: markDone, compare, chip: ["Yard work today", "warn"] };
  const which = pick === "sat" ? "Saturday looks better" : pick === "sun" ? "Sunday looks better" : "Forecast coming soon";
  return { title: `This weekend: ${which}`, detail: note || `Weekend of ${fmtDay(sat, { month: "short", day: "numeric" })}.`, tag: [dow === 5 ? "Tomorrow" : "Upcoming", ""], btn: "Already done", act: markDone, compare, chip: null };
}
function renderYard() {
  const y = yardState();
  $("yardTitle").textContent = y.title;
  $("yardDetail").textContent = y.detail;
  setTag("yardTag", y.tag);
  setBtn("yardBtn", y);
  $("yardCompare").innerHTML = y.compare.map(([name, o, best]) =>
    `<div class="wk ${best ? "pick" : ""}"><div class="d">${name}${best ? '<span class="best">Better</span>' : ""}</div><span class="muted">${esc(o.text)}</span></div>`).join("");
  return y;
}

function setTag(id, [text, cls]) { const el = $(id); el.textContent = text || ""; el.className = `tag ${cls || ""}`; }
function setBtn(id, s) {
  const el = $(id);
  el.hidden = !s.btn;
  if (!s.btn) return;
  el.textContent = s.btn;
  el.className = s.btn === "Undo" ? "ghost small" : "primary";
  el.onclick = s.act;
}

/* ---------- groceries ---------- */
function renderGroceries() {
  const items = [...S.groceries].sort((a, b) => (a.done - b.done) || (a.at || 0) - (b.at || 0));
  const open = items.filter((x) => !x.done).length;
  $("groceryCount").textContent = items.length ? `${open} to get` : "";
  $("clearGroceries").hidden = !items.some((x) => x.done);
  $("groceryList").innerHTML = items.length ? items.map((x) => `
    <li class="${x.done ? "done" : ""}" data-id="${esc(x.id)}">
      <label><input type="checkbox" ${x.done ? "checked" : ""} data-act="toggle"><span class="txt">${esc(x.text)}</span></label>
      ${x.by ? `<span class="who">${esc(x.by)}</span>` : ""}
      <button class="x" data-act="del" aria-label="Remove ${esc(x.text)}">×</button>
    </li>`).join("") : `<li class="empty">The list is empty. Add the first item above.</li>`;
}
$("groceryForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("groceryInput");
  const parts = input.value.split(",").map((s) => s.trim()).filter(Boolean);
  applyGroceryChanges({ add: parts, remove: [] });
  input.value = "";
  input.focus();
});

/* ---------- voice: groceries ---------- */
function applyGroceryChanges({ add = [], remove = [] }) {
  const added = [], removed = [];
  const have = new Set(S.groceries.filter((g) => !g.done).map((g) => g.text.toLowerCase()));
  add.forEach((raw) => {
    const text = raw.trim().replace(/^./, (c) => c.toUpperCase());
    if (!text || have.has(text.toLowerCase())) return;
    have.add(text.toLowerCase());
    S.store.add("groceries", { text, done: false, at: Date.now(), by: S.store.who });
    added.push(text);
  });
  remove.forEach((raw) => {
    const q = raw.trim().toLowerCase();
    const hit = S.groceries.find((g) => g.text.toLowerCase() === q) || S.groceries.find((g) => g.text.toLowerCase().includes(q));
    if (hit) { S.store.remove("groceries", hit.id); removed.push(hit.text); }
  });
  return { added, removed };
}

// Simple offline parser: "add milk, eggs and bread to the list" / "remove eggs"
function parseGroceryCommand(said) {
  let t = said.toLowerCase().replace(/[.!?]+$/g, "").trim();
  let mode = "add";
  if (/^(remove|delete|take off|cross off|scratch)\b/.test(t)) mode = "remove";
  t = t
    .replace(/^(please\s+)?(can you\s+)?(add|put|get|buy|remove|delete|take off|cross off|scratch|we need|we're out of|we are out of|i need|need)\s+/, "")
    .replace(/\s+(to|on|from|off)\s+(the|my|our)\s+(grocery|groceries|shopping)?\s*list$/, "")
    .replace(/\s+(to|on|from|off)\s+(the|my|our)\s+list$/, "")
    .replace(/^(some|a|an)\s+/, "");
  const items = t.split(/\s*,\s*|\s+and\s+|\s+also\s+/).map((s) => s.replace(/^(some|a|an|and)\s+/, "").trim()).filter(Boolean);
  return mode === "add" ? { add: items, remove: [] } : { add: [], remove: items };
}

async function askClaude(said) {
  const token = await S.store.token();
  const res = await fetch(CFG.workerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: said, current: S.groceries.filter((g) => !g.done).map((g) => g.text) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data; // { add: [], remove: [], reply: "" }
}

// Shows a short status line under a form; success messages fade after 8 seconds.
function statusLine(id) {
  let timer;
  return (text, cls = "") => {
    const el = $(id);
    el.hidden = !text;
    el.textContent = text;
    el.className = `voice-status small ${cls}`;
    clearTimeout(timer);
    if (cls === "ok") timer = setTimeout(() => (el.hidden = true), 8000);
  };
}
const voiceStatus = statusLine("voiceStatus");
const noteStatus = statusLine("noteVoiceStatus");

async function handleSpoken(said) {
  voiceStatus(`Heard: "${said}"`);
  let changes, reply = "";
  if (CFG.workerUrl && S.store?.token) {
    try {
      voiceStatus(`Heard: "${said}". Asking Claude…`);
      changes = await askClaude(said);
      reply = changes.reply || "";
    } catch (e) {
      console.warn("Claude failed, using the built-in parser", e);
      changes = parseGroceryCommand(said);
    }
  } else changes = parseGroceryCommand(said);
  const { added, removed } = applyGroceryChanges(changes);
  const parts = [];
  if (added.length) parts.push(`Added ${added.join(", ")}`);
  if (removed.length) parts.push(`Removed ${removed.join(", ")}`);
  if (parts.length) voiceStatus(reply || parts.join(". ") + ".", "ok");
  else voiceStatus(reply || `Didn't catch a grocery item in "${said}". Try "add milk and eggs".`, reply ? "ok" : "err");
}

// Connects a mic button to an input box using the browser's speech recognition (Chrome, Edge).
// `long` keeps listening through pauses until the mic is tapped again or there's a long silence.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
function attachMic({ btn, input, status, prompt, long = false, onDone }) {
  if (!SpeechRec) return;
  btn.hidden = false;
  let rec = null;
  btn.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SpeechRec();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = long;
    const before = input.value ? input.value.trim() + " " : "";
    let finalText = "";
    rec.onresult = (ev) => {
      let fin = "", interim = "";
      for (const r of ev.results) (r.isFinal ? (fin += r[0].transcript) : (interim += r[0].transcript));
      finalText = fin.trim();
      input.value = before + (fin + interim).trim();
    };
    rec.onerror = (ev) => {
      status(ev.error === "not-allowed" ? "Microphone access is blocked. Allow it in your browser's site settings."
        : ev.error === "no-speech" ? "Didn't hear anything. Tap the mic and try again." : `Voice input stopped (${ev.error}).`, "err");
    };
    rec.onend = () => {
      btn.classList.remove("listening");
      rec = null;
      if (finalText) onDone((before + finalText).trim());
    };
    btn.classList.add("listening");
    btn.classList.remove("nudge");
    status(prompt);
    try { rec.start(); } catch { btn.classList.remove("listening"); rec = null; }
  });
}

// Groceries: what you say is turned into list changes.
attachMic({
  btn: $("micBtn"), input: $("groceryInput"), status: voiceStatus,
  prompt: "Listening… say something like \"add milk, eggs and bread\".",
  onDone: (said) => { $("groceryInput").value = ""; handleSpoken(said); },
});
// Notes: what you say is posted as a note. Tap the mic again when you're done talking.
attachMic({
  btn: $("noteMicBtn"), input: $("noteInput"), status: noteStatus, long: true,
  prompt: "Listening… say your note, then tap the mic again to post it.",
  onDone: (said) => {
    const text = said.replace(/^./, (c) => c.toUpperCase()).slice(0, 200);
    S.store.add("notes", { text, at: Date.now(), by: S.store.who });
    $("noteInput").value = "";
    noteStatus(`Posted: "${text}"`, "ok");
  },
});
// Home-screen shortcut opens ./?voice=1
if (SpeechRec && new URLSearchParams(location.search).get("voice")) {
  document.querySelector(".groceries").scrollIntoView({ block: "center" });
  $("micBtn").classList.add("nudge");
  voiceStatus("Tap the mic and say what you need.");
}
$("groceryList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const act = e.target.dataset.act;
  if (act === "toggle") S.store.update("groceries", li.dataset.id, { done: e.target.checked });
  if (act === "del") S.store.remove("groceries", li.dataset.id);
});
$("clearGroceries").addEventListener("click", () => S.store.removeMany("groceries", S.groceries.filter((x) => x.done).map((x) => x.id)));

/* ---------- chores ---------- */
function nextDue(ch) {
  if (!ch.lastDone) return startOfDay(new Date());
  const d = parseYmd(ch.lastDone);
  const n = Number(ch.every) || 1;
  if (ch.unit === "month") { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
  return addDays(d, ch.unit === "week" ? n * 7 : n);
}
const everyText = (ch) => {
  const n = Number(ch.every) || 1;
  const u = { day: "day", week: "week", month: "month" }[ch.unit] || "day";
  return n === 1 ? `Every ${u}` : `Every ${n} ${u}s`;
};
function choreStatus(ch) {
  const diff = daysBetween(new Date(), nextDue(ch));
  if (diff < 0) return { cls: "bad", text: `Overdue by ${-diff} day${diff === -1 ? "" : "s"}`, due: true };
  if (diff === 0) return { cls: "warn", text: "Due today", due: true };
  if (diff <= 3) return { cls: "warn", text: `Due in ${diff} day${diff === 1 ? "" : "s"}`, due: false };
  return { cls: "", text: `Next: ${fmtDay(nextDue(ch))}`, due: false };
}
function renderChores() {
  const list = [...S.chores].sort((a, b) => nextDue(a) - nextDue(b));
  const dueCount = list.filter((c) => choreStatus(c).due).length;
  $("choreCount").textContent = dueCount ? `${dueCount} due` : list.length ? "All caught up" : "";
  $("choreList").innerHTML = list.length ? list.map((c) => {
    const s = choreStatus(c);
    return `<li data-id="${esc(c.id)}">
      <div class="chore-main">
        <div class="name">${esc(c.name)}</div>
        <div class="when ${s.cls}">${esc(s.text)} · ${esc(everyText(c))}${c.lastDone ? ` · last done ${esc(fmtDay(parseYmd(c.lastDone), { month: "short", day: "numeric" }))}${c.doneBy ? ` by ${esc(c.doneBy)}` : ""}` : ""}</div>
      </div>
      <button class="${s.due ? "primary" : "ghost"} small" data-act="done">Done</button>
      <button class="x" data-act="del" aria-label="Delete ${esc(c.name)}">×</button>
    </li>`;
  }).join("") : `<li class="empty">No chores yet. Add one below.</li>`;
  return dueCount;
}
$("choreList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const act = e.target.dataset.act;
  if (act === "done") S.store.update("chores", li.dataset.id, { lastDone: ymd(new Date()), doneBy: S.store.who });
  if (act === "del") {
    const ch = S.chores.find((c) => c.id === li.dataset.id);
    if (confirm(`Delete the chore "${ch?.name}"?`)) S.store.remove("chores", li.dataset.id);
  }
});
$("choreForm").addEventListener("submit", (e) => {
  e.preventDefault();
  S.store.add("chores", { name: $("choreName").value.trim(), every: Number($("choreEvery").value) || 1, unit: $("choreUnit").value, lastDone: "", at: Date.now() });
  e.target.reset();
  e.target.closest("details").open = false;
});

/* ---------- notes ---------- */
function renderNotes() {
  const list = [...S.notes].sort((a, b) => (b.at || 0) - (a.at || 0));
  $("noteList").innerHTML = list.length ? list.map((n) => `
    <li data-id="${esc(n.id)}">
      <div class="body">${esc(n.text)}<div class="meta">${n.by ? esc(n.by) + " · " : ""}${esc(ago(n.at))}</div></div>
      <button class="x" data-act="del" aria-label="Delete note">×</button>
    </li>`).join("") : `<li class="empty">No notes. Post one for the household.</li>`;
}
$("noteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("noteInput").value.trim();
  if (text) S.store.add("notes", { text, at: Date.now(), by: S.store.who });
  $("noteInput").value = "";
});
$("noteList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li && e.target.dataset.act === "del") S.store.remove("notes", li.dataset.id);
});

/* ---------- bills from Gmail ---------- */
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
// Several Gmail accounts can be connected. The list lives on this device only; tokens live in memory for an hour.
const gmailTokens = {}; // email -> { token, exp }
let gmailAccounts = [];
try { gmailAccounts = JSON.parse(localStorage.getItem("hb:gmailAccounts") || "[]"); } catch {}
const saveGmailAccounts = () => { try { localStorage.setItem("hb:gmailAccounts", JSON.stringify(gmailAccounts)); } catch {} };
const tokenValid = (email) => gmailTokens[email] && Date.now() < gmailTokens[email].exp;

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Google sign-in."));
    document.head.appendChild(s);
  });
}
// Opens Google's popup for one account (hint) or the account chooser (choose), and returns that account's email.
async function connectGmail(hint = "", choose = false) {
  await loadGis();
  const tok = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.gmail.clientId,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      hint,
      callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
      error_callback: (e) => reject(new Error(
        e.type === "popup_closed" ? "Gmail sign-in was closed."
          : e.type === "popup_failed_to_open" ? "Your browser blocked the Gmail sign-in window. Tap the button again."
            : e.message || "Gmail sign-in failed.")),
    });
    client.requestAccessToken({ prompt: choose ? "select_account" : "", hint });
  });
  const res = await fetch(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!res.ok) throw new Error(`Gmail error ${res.status}`);
  const email = String((await res.json()).emailAddress || "").toLowerCase();
  gmailTokens[email] = { token: tok.access_token, exp: Date.now() + (Number(tok.expires_in) - 60) * 1000 };
  if (!gmailAccounts.includes(email)) { gmailAccounts.push(email); saveGmailAccounts(); }
  return email;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function gmailGet(email, path) {
  for (let attempt = 0; ; attempt++) {
    if (!tokenValid(email)) throw new Error(`Gmail access for ${email} expired. Tap Check Gmail again.`);
    const res = await fetch(`${GMAIL}/${path}`, { headers: { Authorization: `Bearer ${gmailTokens[email].token}` } });
    if (res.status === 401) { delete gmailTokens[email]; throw new Error(`Gmail access for ${email} expired. Tap Check Gmail again.`); }
    // 429 and 5xx mean "slow down" or a hiccup: wait a little longer each time, then try again.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await wait(1000 * 2 ** attempt + Math.random() * 500); continue; }
    if (res.status === 429) throw new Error("Gmail is busy right now. Wait a minute, then tap Check Gmail again.");
    if (!res.ok) throw new Error(`Gmail error ${res.status}`);
    return res.json();
  }
}
// Runs fn over items with at most `limit` running at once (Gmail rejects too many parallel requests).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const b64url = (s) => {
  try { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))); }
  catch { return ""; }
};
function emailText(payload) {
  let plain = "", html = "";
  const walk = (p) => {
    if (p.mimeType === "text/plain" && p.body?.data) plain += b64url(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data) html += b64url(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  if (!plain && html) {
    const doc = new DOMParser().parseFromString(html, "text/html"); // parsed only, never run
    doc.querySelectorAll("style,script,head").forEach((n) => n.remove());
    plain = doc.body?.textContent || "";
  }
  return plain.replace(/\s+/g, " ").trim().slice(0, 2500);
}
async function fetchEmail(account, id) {
  const m = await gmailGet(account, `messages/${id}?format=full`);
  const h = Object.fromEntries((m.payload.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
  const fromName = (h.from || "").replace(/<.*>/, "").replace(/"/g, "").trim() || (h.from || "").replace(/.*@|>.*/g, "");
  return { id, from: fromName, subject: h.subject || "", date: ymd(new Date(Number(m.internalDate))), body: emailText(m.payload) };
}

// Turns "Dec 5", "December 5, 2026" or "12/05/2026" into YYYY-MM-DD, guessing the year when it's missing.
function parseLooseDate(str, emailDate) {
  if (!str) return "";
  const ref = parseYmd(emailDate);
  let d;
  const num = str.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (num) d = new Date(num[3] ? Number(num[3].length === 2 ? "20" + num[3] : num[3]) : ref.getFullYear(), Number(num[1]) - 1, Number(num[2]));
  else {
    const hasYear = /\d{4}/.test(str);
    d = new Date(hasYear ? str.replace(/\./g, "") : `${str.replace(/\./g, "")}, ${ref.getFullYear()}`);
  }
  if (isNaN(d)) return "";
  if (daysBetween(ref, d) < -60) d.setFullYear(d.getFullYear() + 1);
  return ymd(d);
}
// Built-in extraction, used when the Claude worker isn't set up.
function guessBill(m) {
  const t = `${m.subject}. ${m.body}`;
  const receipt = /payment (received|confirmation|posted|processed|successful)|thank you for your payment|we('ve| have) received your payment/i.test(t);
  const amt = t.match(/(?:amount due|total due|balance due|new balance|payment amount|minimum payment due|statement balance|amount|total)[^$]{0,40}\$\s?([\d,]+\.\d{2})/i) || t.match(/\$\s?([\d,]+\.\d{2})/);
  const due = t.match(/(?:due(?: date)?|payment date|will be (?:paid|charged|withdrawn|debited) on|scheduled for|pay by)\s*(?:on|is|:)?\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:,? \d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
  const looksBill = /bill|statement|amount due|payment due|autopay|auto-pay|invoice|scheduled payment|balance/i.test(t);
  return {
    id: m.id,
    kind: receipt ? "payment_confirmation" : looksBill && amt ? "bill" : "other",
    payee: m.from,
    amount: amt ? amt[1].replace(/,/g, "") : "",
    dueDate: due ? parseLooseDate(due[1], m.date) : "",
    autopay: /auto ?-?pay|automatic payment|scheduled payment|will be (?:charged|withdrawn|debited)/i.test(t)
      && !/(?:not|n't) (?:enrolled|set up|signed up)|(?:enroll|sign up|set up) (?:in|for)? ?auto ?-?pay|turn on auto ?-?pay/i.test(t),
  };
}
async function extractBills(emails) {
  if (CFG.workerUrl && S.store?.token) {
    try {
      const res = await fetch(CFG.workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await S.store.token()}` },
        body: JSON.stringify({ kind: "bills", today: ymd(new Date()), emails }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      return { bills: data.bills, by: "Claude" };
    } catch (e) {
      console.warn("Claude bill extraction failed, using the built-in reader", e);
      return { bills: emails.map(guessBill), by: "", claudeError: String(e.message || e) };
    }
  }
  return { bills: emails.map(guessBill), by: "" };
}

// Reads one connected account's new bill emails into the shared bills list.
async function scanAccount(account) {
  billsMeta(`Checking ${account}…`);
  const list = await gmailGet(account, `messages?maxResults=${CFG.gmail.maxEmails || 25}&q=${encodeURIComponent(CFG.gmail.query)}`);
  const seen = new Set(S.bills.map((b) => b.msgId));
  const ids = (list.messages || []).map((m) => m.id).filter((id) => !seen.has(id));
  if (!ids.length) return { account, checked: 0, found: 0, by: "" };
  billsMeta(`Reading ${ids.length} new email${ids.length > 1 ? "s" : ""} from ${account}…`);
  const emails = await mapLimit(ids, 3, (id) => fetchEmail(account, id));
  const { bills, by, claudeError } = await extractBills(emails);
  const byId = Object.fromEntries(emails.map((e) => [e.id, e]));
  let found = 0;
  for (const b of bills) {
    const e = byId[b.id];
    if (!e) continue;
    const rec = {
      msgId: e.id, account, kind: b.kind, payee: (b.payee || e.from).slice(0, 60), amount: String(b.amount || ""),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate || "") ? b.dueDate : "", autopay: !!b.autopay,
      subject: e.subject.slice(0, 120), emailDate: e.date, paid: false, hidden: b.kind !== "bill", at: Date.now(),
    };
    if (b.kind === "payment_confirmation") {
      // Mark an unpaid bill from the same sender as paid.
      const key = rec.payee.toLowerCase().split(/\s+/)[0];
      S.bills.filter((x) => x.kind === "bill" && !x.paid && x.payee.toLowerCase().includes(key))
        .forEach((x) => S.store.update("bills", x.id, { paid: true }));
    }
    if (b.kind === "bill") found++;
    S.store.add("bills", rec);
  }
  return { account, checked: emails.length, found, by, claudeError };
}

let scanning = false;
// Checks every connected account (or just `only`). Google allows one sign-in window per tap, so an
// account whose hourly access ran out after the first window is left for the next tap.
async function scanBills(only = "", addNew = false) {
  if (scanning) return;
  if (!CFG.gmail?.clientId) { billsMeta("Add a Gmail client ID in config.js to turn this on. SETUP.md, step 7, shows how.", "err"); return; }
  scanning = true;
  document.querySelectorAll(".bills button").forEach((b) => (b.disabled = true));
  const results = [], waiting = [];
  try {
    let accounts = only ? [only] : [...gmailAccounts];
    let popupUsed = false;
    if (addNew || !accounts.length) {
      billsMeta("Choose a Gmail account…");
      accounts = [await connectGmail("", true)];
      popupUsed = true;
    }
    for (let account of accounts) {
      if (!tokenValid(account)) {
        if (popupUsed) { waiting.push(account); continue; }
        billsMeta(`Connecting to ${account}…`);
        account = await connectGmail(account);
        popupUsed = true;
      }
      results.push(await scanAccount(account));
    }
    S.store.setStatus({ billsScannedAt: Date.now() });
    const found = results.reduce((s, r) => s + r.found, 0);
    const checked = results.reduce((s, r) => s + r.checked, 0);
    const by = results.find((r) => r.by)?.by;
    let msg = checked
      ? `Checked ${checked} new email${checked > 1 ? "s" : ""}${by ? ` with ${by}` : ""} in ${results.length} account${results.length > 1 ? "s" : ""}. Found ${found} new bill${found === 1 ? "" : "s"}.`
      : `No new bill emails in ${results.map((r) => r.account).join(" or ")}.`;
    const cErr = results.find((r) => r.claudeError)?.claudeError;
    if (cErr) msg += ` Claude couldn't read them (${cErr}), so the built-in reader was used.`;
    if (waiting.length) msg += ` Tap Check Gmail again to check ${waiting.join(" and ")}.`;
    billsMeta(msg);
  } catch (e) {
    console.error(e);
    billsMeta(e.message || "Couldn't check Gmail.", "err");
  } finally {
    scanning = false;
    document.querySelectorAll(".bills button").forEach((b) => (b.disabled = false));
    renderBills();
  }
}
function billsMeta(text, cls = "") { const el = $("billsMeta"); el.textContent = text; el.className = `small ${cls === "err" ? "error" : "muted"}`; billsMeta.sticky = Date.now(); }
$("scanBillsBtn").addEventListener("click", () => scanBills());
$("addGmailBtn").addEventListener("click", () => scanBills("", true));
// Clears every bill found so far and reads the emails again, e.g. after turning on the Claude worker.
$("rereadBillsBtn").addEventListener("click", async () => {
  if (!S.bills.length) return scanBills();
  if (!confirm(`Clear all ${S.bills.length} saved bill entries and read the emails again${CFG.workerUrl ? " with Claude" : ""}? Bills you marked paid or hid will come back if they're still in Gmail.`)) return;
  await S.store.removeMany("bills", S.bills.map((b) => b.id));
  S.bills = [];
  scanBills();
});
$("gmailAccts").addEventListener("click", (e) => {
  const email = e.target.closest("[data-email]")?.dataset.email;
  if (!email) return;
  if (e.target.dataset.act === "forget") {
    gmailAccounts = gmailAccounts.filter((a) => a !== email);
    delete gmailTokens[email];
    saveGmailAccounts();
    renderBills();
    billsMeta(`Stopped checking ${email} on this device. Bills already found stay on the list.`);
  } else scanBills(email);
});
function renderGmailAccounts() {
  $("gmailAccts").innerHTML = gmailAccounts.map((a) => `
    <span class="acct" data-email="${esc(a)}">
      <button class="acct-check" data-act="check" title="Check ${esc(a)} now">${esc(a)}</button>
      <button class="x" data-act="forget" aria-label="Stop checking ${esc(a)}" title="Stop checking this account">×</button>
    </span>`).join("");
}

const money = (a) => { const n = Number(a); return a !== "" && !isNaN(n) ? n.toLocaleString(undefined, { style: "currency", currency: "USD" }) : ""; };
function billDue(b) {
  if (!b.dueDate) return { cls: "", text: `Email from ${fmtDay(parseYmd(b.emailDate), { month: "short", day: "numeric" })}`, days: 999 };
  const d = daysBetween(new Date(), parseYmd(b.dueDate));
  if (d < 0) return { cls: "bad", text: `Was due ${fmtDay(parseYmd(b.dueDate), { month: "short", day: "numeric" })}`, days: d };
  if (d === 0) return { cls: "bad", text: "Due today", days: d };
  if (d === 1) return { cls: "warn", text: "Due tomorrow", days: d };
  if (d <= 7) return { cls: "warn", text: `Due ${fmtDay(parseYmd(b.dueDate), { weekday: "long" })}`, days: d };
  return { cls: "", text: `Due ${fmtDay(parseYmd(b.dueDate), { month: "short", day: "numeric" })}`, days: d };
}
function visibleBills() {
  const open = S.bills
    .filter((b) => b.kind === "bill" && !b.hidden && !b.paid)
    .filter((b) => {
      const d = billDue(b).days;
      return b.dueDate ? d >= -14 && d <= 45 : daysBetween(parseYmd(b.emailDate), new Date()) <= 30;
    });
  // A newer statement from the same company replaces the older one.
  const latest = {};
  for (const b of open) {
    const key = b.payee.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!latest[key] || b.emailDate > latest[key].emailDate) latest[key] = b;
  }
  return Object.values(latest).sort((a, b) => billDue(a).days - billDue(b).days);
}
function renderBills() {
  renderGmailAccounts();
  const list = visibleBills();
  const soon = list.filter((b) => billDue(b).days <= 14 && b.amount);
  const total = soon.reduce((s, b) => s + Number(b.amount || 0), 0);
  $("billsTotal").hidden = !soon.length;
  $("billsTotal").innerHTML = `<b>${esc(money(total))}</b> due in the next 2 weeks`;
  $("billList").innerHTML = list.length ? list.map((b) => {
    const due = billDue(b);
    return `<li data-id="${esc(b.id)}">
      <div class="bill-main">
        <div class="bill-top"><span class="name">${esc(b.payee)}</span><span class="amt">${esc(money(b.amount))}</span></div>
        <div class="when ${due.cls}">${esc(due.text)}${b.autopay ? ' <span class="pill">Autopay</span>' : ""}</div>
        <div class="when src"><a href="https://mail.google.com/mail/?authuser=${encodeURIComponent(b.account || "")}#all/${esc(b.msgId)}" target="_blank" rel="noopener">Open email</a>${b.account && gmailAccounts.length > 1 ? ` · ${esc(b.account)}` : ""}</div>
      </div>
      <div class="bill-actions">
        <button class="ghost small" data-act="paid">Paid</button>
        <button class="x" data-act="hide" aria-label="Not a bill: hide ${esc(b.payee)}" title="Not a bill">×</button>
      </div>
    </li>`;
  }).join("") : `<li class="empty">${CFG.gmail?.clientId ? "No upcoming bills found. Tap Check Gmail to look for new ones." : "Connect Gmail to see bills that are coming up. SETUP.md, step 7, shows how."}</li>`;
  if (!billsMeta.sticky || Date.now() - billsMeta.sticky > 15000) {
    const at = S.status.billsScannedAt;
    $("billsMeta").className = "small muted";
    $("billsMeta").textContent = at ? `Last checked ${ago(at)}.` : "";
  }
  return list;
}
$("billList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  if (e.target.dataset.act === "paid") S.store.update("bills", li.dataset.id, { paid: true });
  if (e.target.dataset.act === "hide") S.store.update("bills", li.dataset.id, { hidden: true });
});

/* ---------- calendar ---------- */
function renderCalendar() {
  const url = (CFG.calendarEmbedUrl || "").trim();
  if (url) {
    const u = new URL(url);
    if (!u.searchParams.has("mode")) u.searchParams.set("mode", "AGENDA");
    u.searchParams.set("showTitle", "0");
    u.searchParams.set("showPrint", "0");
    $("calendarBody").innerHTML = `<iframe class="cal-frame" title="Google Calendar" src="${esc(u.toString())}" loading="lazy"></iframe>`;
  } else {
    $("calendarBody").innerHTML = `<div class="cal-empty">Your agenda will show here. Paste your Google Calendar embed link into <code>calendarEmbedUrl</code> in <code>config.js</code>. SETUP.md, step 5, shows how.</div>`;
  }
}

/* ---------- traffic ---------- */
const WORKER = (CFG.workerUrl || "").replace(/\/+$/, "");
const TR = CFG.traffic || {};
TR.road ||= "US-24";
TR.from ||= { name: "Woodland Park", lat: 38.9939, lon: -105.0569 };
// Older config files had a single `to`; newer ones list several destinations.
const BUILTIN_DEST = TR.destinations || [TR.to ? { title: TR.name, ...TR.to } : { name: "Colorado Springs", title: "Ute Pass", lat: 38.8339, lon: -104.8214 }];
const ll = (p) => `${p.lat},${p.lon}`;
S.places = [];
S.trafficBy = {};
const destinations = () => [...BUILTIN_DEST, ...[...S.places].sort((a, b) => (a.at || 0) - (b.at || 0))];
let commuteKey = "";
try { commuteKey = localStorage.getItem("hb:commute") || ""; } catch {}
function currentDest() {
  const list = destinations();
  return list.find((d) => ll(d) === commuteKey) || list[0];
}
const destTitle = (d) => d.title || d.name;
function stepCommute(dir) {
  const list = destinations();
  const i = Math.max(0, list.findIndex((d) => ll(d) === ll(currentDest())));
  const next = list[(i + dir + list.length) % list.length];
  commuteKey = ll(next);
  try { localStorage.setItem("hb:commute", commuteKey); } catch {}
  if (tmap) tmap.fitted = false;
  const cached = S.trafficBy[commuteKey];
  renderTraffic();
  if (!cached || Date.now() - cached.at > 5 * 60000) loadTraffic(next);
}
$("commutePrev").addEventListener("click", () => stepCommute(-1));
$("commuteNext").addEventListener("click", () => stepCommute(1));

function trafficLevel(r, closed) {
  if (closed) return ["Closed", "bad"];
  if (!r) return ["", ""];
  if (r.delay >= 10) return [`+${r.delay} min`, "bad"];
  if (r.delay >= 3) return [`+${r.delay} min`, "warn"];
  return ["Clear", "good"];
}
// Loads drive times for one destination (the one on screen by default).
const trafficTried = {}; // key -> time of the last attempt, so a failing place isn't retried in a loop
async function loadTraffic(dest = currentDest()) {
  if (!WORKER || !dest) return renderTraffic();
  const key = ll(dest);
  trafficTried[key] = Date.now();
  try {
    const q = new URLSearchParams({ from: ll(TR.from), to: key, road: TR.road });
    const res = await fetch(`${WORKER}/traffic?${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    S.trafficBy[key] = data;
    S.trafficError = "";
  } catch (e) {
    console.warn("Traffic failed", e);
    S.trafficError = e.message || "Couldn't load traffic.";
  }
  S.traffic = S.trafficBy[ll(BUILTIN_DEST[0])] || null; // the Today strip watches the main commute
  renderTraffic();
  renderAll();
}
// Refreshes what's on screen, plus the main commute for the Today strip.
function refreshTraffic() {
  loadTraffic();
  if (ll(currentDest()) !== ll(BUILTIN_DEST[0])) loadTraffic(BUILTIN_DEST[0]);
}
// Street map (CARTO / OpenStreetMap) with TomTom's live traffic colors on top and the route drawn faintly.
let tmap = null, tFlow = null, tLine = null, tMarkers = null;
function drawTrafficMap(t, dest) {
  const el = $("trafficMap");
  if (!window.L || !t?.down?.path?.length) { el.hidden = true; return; }
  el.hidden = false;
  const flowUrl = `${WORKER}/tile/{z}/{x}/{y}.png?t=${t.at}`;
  if (!tmap) {
    tmap = L.map(el, { zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false })
      .setView([TR.from.lat, TR.from.lon], 10); // a starting view, so markers can be placed before the route is fitted
    // OpenStreetMap's free map; in dark mode CSS inverts it (see .base-tiles in styles.css).
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, className: "base-tiles",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Traffic © TomTom',
    }).addTo(tmap);
    tFlow = L.tileLayer(flowUrl, { maxZoom: 18, opacity: 0.95 }).addTo(tmap);
    L.control.zoom({ position: "topright" }).addTo(tmap);
    tMarkers = L.layerGroup().addTo(tmap);
  } else tFlow.setUrl(flowUrl);
  tMarkers.clearLayers();
  for (const p of [TR.from, dest]) {
    L.circleMarker([p.lat, p.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#2f5d50", fillOpacity: 1 })
      .bindTooltip(p.name, { direction: "top", offset: [0, -6] }).addTo(tMarkers);
  }
  if (tLine) tLine.remove();
  tLine = L.polyline(t.down.path, { color: "#4a7a9c", weight: 10, opacity: 0.22, interactive: false }).addTo(tmap);
  if (!tmap.fitted) { tmap.invalidateSize(); tmap.fitBounds(tLine.getBounds(), { padding: [14, 14] }); tmap.fitted = true; }
}

function renderTraffic() {
  const body = $("trafficBody");
  const snowy = (S.weather?.daily?.snowfall_sum?.[0] || 0) >= 0.3 || [71, 73, 75, 77, 85, 86].includes(S.weather?.current?.weather_code);
  const snowNote = snowy ? `<p class="alert"><b>Snow today</b><span>Roads may be slick. Check COtrip before you go.</span></p>` : "";
  if (!WORKER) {
    setTag("trafficTag", ["", ""]);
    body.innerHTML = `${snowNote}<p class="cal-empty">Live drive times will show here once the Home Base worker is set up. SETUP.md, step 8, shows how. Until then, the links below open live traffic.</p>`;
    return;
  }
  const dest = currentDest();
  const list = destinations();
  $("trafficTitle").textContent = destTitle(dest);
  $("commuteCount").textContent = list.length > 1 ? `${list.findIndex((d) => ll(d) === ll(dest)) + 1} of ${list.length}` : "";
  $("commutePrev").hidden = $("commuteNext").hidden = list.length < 2;
  $("trafficMapLink").href = `https://www.google.com/maps/dir/?api=1&origin=${ll(TR.from)}&destination=${ll(dest)}&travelmode=driving`;
  const t = S.trafficBy[ll(dest)];
  if (!t) {
    // e.g. a saved place that loaded after start-up: fetch it, at most once a minute
    if (Date.now() - (trafficTried[ll(dest)] || 0) > 60000) setTimeout(() => loadTraffic(dest), 0);
    setTag("trafficTag", ["", ""]);
    $("trafficMap").hidden = true;
    body.innerHTML = S.trafficError ? `<p class="error small">${esc(S.trafficError)}</p>` : `<p class="muted">Checking the drive to ${esc(dest.name)}…</p>`;
    return;
  }
  const closed = t.incidents.some((i) => i.closed);
  const worst = [t.down, t.up].filter(Boolean).sort((a, b) => b.delay - a.delay)[0];
  setTag("trafficTag", trafficLevel(worst, closed));
  try { drawTrafficMap(t, dest); } catch (e) { console.warn("Map failed", e); $("trafficMap").hidden = true; }
  const row = (label, r) => {
    if (!r) return "";
    const [lvl, cls] = trafficLevel(r, false);
    return `<div class="drive">
      <div><div class="drive-to">${esc(label)}</div><div class="muted small">Usually ${r.usual} min · ${r.miles} mi</div></div>
      <div class="drive-time"><b>${r.minutes}</b> min <span class="tag ${cls}">${esc(lvl)}</span></div>
    </div>`;
  };
  const incidents = t.incidents.map((i) => `<li class="${i.closed || i.severity >= 3 ? "bad" : ""}">
      <b>${esc(i.type)}</b>${i.delay ? ` · +${i.delay} min` : ""}<br>
      <span class="muted small">${esc(i.where || i.text)}${i.where && i.text ? ` (${esc(i.text)})` : ""}</span>
    </li>`).join("");
  body.innerHTML = `${snowNote}
    ${row(`To ${dest.name}`, t.down)}
    ${row(`Back to ${TR.from.name}`, t.up)}
    ${incidents ? `<ul class="incidents">${incidents}</ul>` : `<p class="muted small">No crashes, closures or roadwork reported on ${esc(t.road)}.</p>`}
    <p class="muted small">Updated ${esc(ago(t.at))}${S.trafficError ? ". Last refresh failed" : ""}.</p>`;
}
function trafficChip() {
  const t = S.traffic;
  if (!t) return null;
  const name = destTitle(BUILTIN_DEST[0]);
  if (t.incidents.some((i) => i.closed)) return [`${name} closure reported`, "bad"];
  const worst = Math.max(t.down?.delay || 0, t.up?.delay || 0);
  return worst >= 10 ? [`${name}: +${worst} min delays`, "warn"] : null;
}

/* ---------- news ---------- */
let newsRegion = "us";
try { newsRegion = localStorage.getItem("hb:newsRegion") || "us"; } catch {}
S.news = {};
async function loadNews(force = false) {
  const cached = S.news[newsRegion];
  if (!WORKER) return renderNews();
  if (!force && cached && Date.now() - cached.at < 15 * 60000) return renderNews();
  renderNews(true);
  try {
    const res = await fetch(`${WORKER}/news?region=${newsRegion}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    S.news[newsRegion] = { items: data.items || [], at: Date.now() };
  } catch (e) {
    console.warn("News failed", e);
    S.news[newsRegion] = { items: cached?.items || [], at: cached?.at || 0, error: "Couldn't load the news. It'll try again soon." };
  }
  renderNews();
}
function renderNews(loading = false) {
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.region === newsRegion)));
  const body = $("newsBody");
  if (!WORKER) {
    body.innerHTML = `<p class="cal-empty">The day's top headline will show here once the Home Base worker is set up. SETUP.md, step 8, shows how.</p>`;
    return;
  }
  const n = S.news[newsRegion];
  if (!n?.items?.length) {
    body.innerHTML = loading ? `<p class="muted">Loading headlines…</p>` : `<p class="muted">${esc(n?.error || "No headlines right now.")}</p>`;
    return;
  }
  const when = (i) => { const d = new Date(i.published); return isNaN(d) ? "" : ago(d.getTime()); };
  const safe = (u) => (/^https:\/\//.test(u) ? u : "#");
  const [top, ...rest] = n.items;
  body.innerHTML = `
    <a class="headline" href="${esc(safe(top.link))}" target="_blank" rel="noopener">${esc(top.title)}</a>
    <p class="muted small">${esc(top.source)}${when(top) ? ` · ${esc(when(top))}` : ""}</p>
    ${rest.length ? `<ul class="headlines">${rest.slice(0, 4).map((i) => `
      <li><a href="${esc(safe(i.link))}" target="_blank" rel="noopener">${esc(i.title)}</a><span class="muted small"> · ${esc(i.source)}</span></li>`).join("")}</ul>` : ""}
    ${n.error ? `<p class="error small">${esc(n.error)}</p>` : ""}`;
}
document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
  newsRegion = b.dataset.region;
  try { localStorage.setItem("hb:newsRegion", newsRegion); } catch {}
  loadNews();
}));

/* ---------- header + summary ---------- */
function renderHeader() {
  const now = new Date();
  const h = now.getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const name = S.store?.who ? `, ${S.store.who}` : "";
  $("greeting").textContent = `${part}${name}`;
  $("dateLine").textContent = `${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ${CFG.householdName || "Home Base"}`;
}
function renderToday(bins, yard, moon, dueChores, bills = []) {
  const chips = [];
  if (isOn("weather")) allAlerts().forEach((a) => chips.push([a.title, a.severe ? "bad" : "warn"]));
  if (isOn("bills")) bills.filter((b) => b.dueDate && billDue(b).days <= 2).forEach((b) => {
    const d = billDue(b);
    chips.push([`${b.payee} ${money(b.amount)} ${d.text.replace(/^(Due|Was)/, (w) => w.toLowerCase())}${b.autopay ? " (autopay)" : ""}`.replace(/\s+/g, " "), d.days <= 0 ? "bad" : "warn"]);
  });
  if (bins.chip && isOn("bins")) chips.push(bins.chip);
  const tc = isOn("traffic") && trafficChip();
  if (tc) chips.push(tc);
  if (yard.chip && isOn("yard")) chips.push(yard.chip);
  if (dueChores && isOn("chores")) chips.push([`${dueChores} chore${dueChores > 1 ? "s" : ""} due`, "warn"]);
  const open = S.groceries.filter((g) => !g.done).length;
  if (open && isOn("groceries")) chips.push([`${open} item${open > 1 ? "s" : ""} on the grocery list`, "info"]);
  const dFull = daysBetween(new Date(), moon.nextFull);
  if (isOn("moon") && moon.name === "Full Moon") chips.push(["Full moon tonight", "info"]);
  else if (isOn("moon") && dFull === 1) chips.push(["Full moon tomorrow", "info"]);
  if (!chips.length) chips.push(["Nothing needs doing today", "good"]);
  $("todayStrip").innerHTML = chips.map(([t, c]) => `<span class="chip ${c}"><span class="dot"></span>${esc(t)}</span>`).join("");
}

function renderAll() {
  renderHeader();
  renderWeather();
  const moon = renderMoon();
  const bins = renderBins();
  const yard = renderYard();
  renderGroceries();
  const due = renderChores();
  const bills = renderBills();
  renderNotes();
  renderTraffic(); // keeps the commute card and snow note current
  renderToday(bins, yard, moon, due, bills);
  applyPanels();
  if ($("settings").open) renderSettings();
}

/* ---------- hiding panels ---------- */
// Hides turned-off panels, then lets neighbouring panels grow into the space they leave.
function applyPanels() {
  for (const [key, , sel] of PANELS) document.querySelector(sel)?.classList.toggle("panel-off", !isOn(key));
  layoutGrid();
}
// Reads the current grid layout (whichever screen size or view applies) and gives each hidden panel's
// cells to a neighbour that lines up with it exactly: above, below, left or right. Otherwise they stay empty.
function layoutGrid() {
  const grid = document.querySelector(".grid");
  grid.style.gridTemplateAreas = "";
  const hidden = new Set(PANELS.map(([k]) => k).filter((k) => !isOn(k)));
  if (!hidden.size) return;
  const rows = (getComputedStyle(grid).gridTemplateAreas.match(/"[^"]*"/g) || []).map((r) => r.slice(1, -1).trim().split(/\s+/));
  if (!rows.length) return;
  const cellsOf = (name) => rows.flatMap((r, y) => r.map((n, x) => (n === name ? [y, x] : null)).filter(Boolean));
  const span = (cells, i) => [...new Set(cells.map((c) => c[i]))].sort((a, b) => a - b).join(",");
  for (const name of hidden) {
    const cells = cellsOf(name);
    if (!cells.length) continue;
    const ys = cells.map((c) => c[0]), xs = cells.map((c) => c[1]);
    const [y0, y1, x0, x1] = [Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs)];
    const candidates = [
      [y0 - 1, x0, 1], [y1 + 1, x0, 1], // above / below: must cover the same columns
      [y0, x0 - 1, 0], [y0, x1 + 1, 0], // left / right: must cover the same rows
    ];
    let taker = ".";
    for (const [y, x, sameAxis] of candidates) {
      const n = rows[y]?.[x];
      if (!n || n === "." || hidden.has(n)) continue;
      if (span(cellsOf(n), sameAxis) === span(cells, sameAxis)) { taker = n; break; }
    }
    for (const [y, x] of cells) rows[y][x] = taker;
  }
  grid.style.gridTemplateAreas = rows.map((r) => `"${r.join(" ")}"`).join(" ");
}
window.addEventListener("resize", () => layoutGrid());

/* ---------- settings window ---------- */
function renderSettings() {
  const devOnly = !!deviceHidden();
  $("deviceOnly").checked = devOnly;
  $("panelToggles").innerHTML = PANELS.map(([key, label]) => `
    <label class="check"><input type="checkbox" data-panel="${key}" ${isOn(key) ? "checked" : ""}> ${esc(label)}</label>`).join("");
  $("panelScope").textContent = devOnly
    ? "These choices apply to this device only."
    : S.store?.mode === "firebase" ? `Saved to ${S.store.who || "your"}'s account, so they apply on all of your devices.` : "Saved on this device.";
  const builtIn = BUILTIN_DEST.map((d) => `<li><span>${esc(destTitle(d))}${d.title ? ` <span class="muted small">(${esc(d.name)})</span>` : ""}</span><span class="muted small">Built in</span></li>`);
  const saved = [...S.places].sort((a, b) => (a.at || 0) - (b.at || 0)).map((p) => `
    <li><span>${esc(p.name)} <span class="muted small">${esc(p.address || "")}</span></span>
    <button type="button" class="x" data-place="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button></li>`);
  $("placeList").innerHTML = [...builtIn, ...saved].join("");
}
function savePanels(hidden) {
  if ($("deviceOnly").checked) { try { localStorage.setItem("hb:devicePanels", JSON.stringify(hidden)); } catch {} }
  else S.store?.setPrefs({ hiddenPanels: hidden });
  if (!$("deviceOnly").checked) S.prefs = { ...S.prefs, hiddenPanels: hidden };
  renderAll();
}
$("settingsBtn").addEventListener("click", () => { renderSettings(); $("settings").showModal(); });
$("panelToggles").addEventListener("change", () => {
  const hidden = [...$("panelToggles").querySelectorAll("input[data-panel]")].filter((i) => !i.checked).map((i) => i.dataset.panel);
  savePanels(hidden);
  renderSettings();
});
$("deviceOnly").addEventListener("change", (e) => {
  if (e.target.checked) { try { localStorage.setItem("hb:devicePanels", JSON.stringify(hiddenPanels())); } catch {} }
  else { try { localStorage.removeItem("hb:devicePanels"); } catch {} }
  renderAll();
  renderSettings();
});
// Commute places: looked up with OpenStreetMap's free address search, then saved to the private database.
$("placeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("placeName").value.trim(), address = $("placeAddr").value.trim();
  const status = (t, err) => { $("placeStatus").textContent = t; $("placeStatus").className = `small ${err ? "error" : "muted"}`; };
  if (!name || !address) return status("Enter a name and an address.", true);
  status("Looking up the address…");
  try {
    const q = new URLSearchParams({ q: address, format: "json", limit: "1", countrycodes: "us" });
    const hit = (await (await fetch(`https://nominatim.openstreetmap.org/search?${q}`)).json())[0];
    if (!hit) return status("Couldn't find that address. Try adding the city and state.", true);
    await S.store.add("places", { name, address, lat: Math.round(Number(hit.lat) * 1e4) / 1e4, lon: Math.round(Number(hit.lon) * 1e4) / 1e4, at: Date.now(), by: S.store.who });
    $("placeName").value = ""; $("placeAddr").value = "";
    status(`Added ${name}. Use the arrows on the commute card to see it.`);
  } catch { status("The address lookup didn't respond. Try again in a minute.", true); }
});
$("placeList").addEventListener("click", (e) => {
  const id = e.target.dataset.place;
  if (id) S.store.remove("places", id);
});

/* ---------- the Skylight frame ---------- */
// The frame's launcher app adds "HomeBaseFrame/" to its browser name. It has no working microphone,
// already runs full screen, and links would leave the dashboard, so those are hidden there.
if (navigator.userAgent.includes("HomeBaseFrame/")) document.documentElement.classList.add("frame");
// When a new version installs in the background, reload once so always-on screens pick it up.
if (navigator.serviceWorker?.controller) {
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
}

/* ---------- wall view (one screen, no scrolling) ---------- */
// Chosen per device and remembered; a link ending in #wall always opens it.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
function setView(wall, remember = true) {
  document.documentElement.classList.toggle("wall", wall);
  $("viewBtn").textContent = wall ? "Scroll view" : "Wall view";
  $("fullscreenBtn").hidden = !wall || !document.fullscreenEnabled;
  if (remember) { try { localStorage.setItem("hb:view", wall ? "wall" : "scroll"); } catch {} }
  keepAwake(wall);
  layoutGrid();
  if (tmap) setTimeout(() => { tmap.invalidateSize(); if (tLine) tmap.fitBounds(tLine.getBounds(), { padding: [14, 14] }); }, 50);
  if (!wall && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function tickClock() {
  $("clock").textContent = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
$("viewBtn").addEventListener("click", () => setView(!document.documentElement.classList.contains("wall")));
$("fullscreenBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener("fullscreenchange", () => { $("fullscreenBtn").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && document.documentElement.classList.contains("wall")) keepAwake(true);
});
window.addEventListener("resize", () => tmap?.invalidateSize());
{
  let saved = "";
  try { saved = localStorage.getItem("hb:view") || ""; } catch {}
  const fromLink = location.hash === "#wall";
  setView(fromLink || saved === "wall", !fromLink);
  tickClock();
  setInterval(tickClock, 15000);
}

/* ---------- boot ---------- */
function maybeSeed() {
  if (!S.loaded.status || !S.loaded.chores || S.status.seeded) return;
  if (!S.chores.length) S.store.add("chores", { name: "Pay bills", every: 1, unit: "month", lastDone: "", at: Date.now() });
  S.store.setStatus({ seeded: true });
}

async function boot() {
  renderCalendar();
  renderAll();
  let store;
  if (CFG.firebase) {
    try {
      store = await firebaseStore(CFG.firebase);
      $("syncPill").textContent = "Synced";
      $("syncPill").classList.add("live");
    } catch (e) {
      console.error("Firebase failed, using this device only", e);
      store = localStore();
      $("syncPill").textContent = "Sync failed. Saving on this device";
    }
  } else store = localStore();
  S.store = store;
  if (CFG.gmail?.clientId) loadGis().catch(() => {}); // preload so the sign-in popup opens straight from the tap
  ["groceries", "notes", "chores", "bills", "places"].forEach((c) => store.watch(c, (v) => { S[c] = v; S.loaded[c] = true; maybeSeed(); renderAll(); }));
  store.watchStatus((v) => { S.status = v; S.loaded.status = true; maybeSeed(); renderAll(); });
  store.watchPrefs((v) => { S.prefs = v || {}; renderAll(); });

  loadWeather();
  refreshTraffic();
  loadNews();
  setInterval(loadWeather, 30 * 60000);
  setInterval(() => document.visibilityState === "visible" && refreshTraffic(), 5 * 60000);
  setInterval(() => loadNews(true), 30 * 60000);
  setInterval(renderAll, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - (S.weather?.fetchedAt || 0) > 15 * 60000) loadWeather();
    if (Date.now() - (S.trafficBy[ll(currentDest())]?.at || 0) > 5 * 60000) refreshTraffic();
    loadNews();
  });
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
