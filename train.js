const $ = (selector) => document.querySelector(selector);
const form = $("#search-form");
const resultList = $("#results");
const toast = $("#toast");
const dialog = $("#details-dialog");

let lastOptions = [];
let toastTimer;
let mapInstance = null;
let mapLayers = [];

const scenarios = [
  ["all", "Standard demo: all route types"],
  ["delayed_departed", "Delayed train already departed"],
  ["upcoming_only", "Upcoming direct trains only"],
  ["nearby_only", "Nearby station alternative"],
  ["tight_transfer", "Reject an unsafe transfer"],
  ["local_connector", "Local connector route"],
  ["no_route", "No feasible route"],
];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function localDateTimeDefaults() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  if (!$("#date").value) $("#date").value = `${year}-${month}-${day}`;
  if (!$("#time").value) $("#time").value = `${hours}:${minutes}`;

  if (!$("#from").value) $("#from").value = "Pune (PUNE)";
  if (!$("#to").value) $("#to").value = "Mumbai CSMT (CSMT)";
}

function formatTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
}

function formatDuration(minutes) {
  if (!minutes) return "0m";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function stationName(code) {
  return ({
    PUNE: "Pune", CSMT: "Mumbai CSMT", MMCT: "Mumbai Central",
    LNL: "Lonavala", KYN: "Kalyan", TNA: "Thane", DR: "Dadar",
    NDLS: "New Delhi", DLI: "Old Delhi", NZM: "Hazrat Nizamuddin",
    ANVT: "Anand Vihar", ADI: "Ahmedabad", BRC: "Vadodara", ST: "Surat",
    PNBE: "Patna", DNR: "Danapur", PPTA: "Patliputra", DBG: "Darbhanga",
    HWH: "Howrah", SDAH: "Sealdah", MAS: "Chennai Central", SBC: "KSR Bengaluru",
    YPR: "Yesvantpur", HYB: "Hyderabad", SC: "Secunderabad", JP: "Jaipur",
    BPL: "Bhopal", RKMP: "Rani Kamalapati", CNB: "Kanpur Central", LKO: "Lucknow",
    BSB: "Varanasi", GAYA: "Gaya", MFP: "Muzaffarpur", SPJ: "Samastipur",
    BJU: "Barauni", HJP: "Hajipur", BZA: "Vijayawada", NGP: "Nagpur",
    JAT: "Jammu Tawi", CDG: "Chandigarh", UMB: "Ambala Cantt", KOTA: "Kota",
    SUR: "Solapur", DD: "Daund", BVI: "Borivali", BDTS: "Bandra Terminus",
  })[code] || code;
}

function getStationParam(input) {
  if (!input) return "";
  const val = input.value ? input.value.trim() : "";
  const match = val.match(/[\(\[]\s*([A-Za-z0-9]{2,6})\s*[\)\]]/);
  if (match) return match[1].toUpperCase();
  if (input.dataset && input.dataset.code) return input.dataset.code;
  return val;
}

/* -------------------------------------------------------------------------- */
/* Station Autocomplete Implementation                                       */
/* -------------------------------------------------------------------------- */
function setupAutocomplete(inputId, dropdownId) {
  const input = $(inputId);
  const dropdown = $(dropdownId);
  if (!input || !dropdown) return;

  let debounceTimer;

  input.addEventListener("input", () => {
    // Clear existing saved dataset code if user types manually
    delete input.dataset.code;
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 1) {
      dropdown.hidden = true;
      dropdown.replaceChildren();
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stations/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!res.ok || !data.stations || !data.stations.length) {
          dropdown.innerHTML = '<div class="autocomplete-item muted">No matching station found</div>';
          dropdown.hidden = false;
          return;
        }

        dropdown.innerHTML = data.stations.map((stn) => `
          <div class="autocomplete-item" data-code="${escapeHtml(stn.code)}" data-name="${escapeHtml(stn.name)}">
            <span><strong>${escapeHtml(stn.name)}</strong> <small style="color:#64748b;">(${escapeHtml(stn.city)})</small></span>
            <span class="code-tag">${escapeHtml(stn.code)}</span>
          </div>
        `).join("");

        dropdown.hidden = false;

        dropdown.querySelectorAll(".autocomplete-item[data-code]").forEach((item) => {
          item.addEventListener("click", () => {
            input.value = `${item.dataset.name} (${item.dataset.code})`;
            input.dataset.code = item.dataset.code;
            dropdown.hidden = true;
          });
        });
      } catch (err) {
        dropdown.hidden = true;
      }
    }, 200);
  });

  document.addEventListener("click", (evt) => {
    if (!input.contains(evt.target) && !dropdown.contains(evt.target)) {
      dropdown.hidden = true;
    }
  });
}

/* Render Route Option Cards */
function optionCard(option, index) {
  const first = option.trains[0];
  const final = option.trains[option.trains.length - 1];

  let priorityBadgeClass = "green";
  let prioritySub = "Priority 1";
  let feasibilityClass = "green";
  let feasibilityTitle = "✓ Feasible";

  if (option.priority === 1) {
    priorityBadgeClass = "green";
    prioritySub = "Priority 1 · Direct Delayed";
    feasibilityTitle = "You can still catch this train!";
  } else if (option.priority === 2) {
    priorityBadgeClass = "blue";
    prioritySub = "Priority 2 · Upcoming Direct";
    feasibilityClass = "blue";
    feasibilityTitle = `Leaves in ${option.waiting_minutes} mins`;
  } else if (option.priority === 3) {
    priorityBadgeClass = "amber";
    prioritySub = "Priority 3 · Nearby Station";
    feasibilityClass = "green";
    feasibilityTitle = "Transfer time sufficient";
  } else if (option.priority === 4) {
    priorityBadgeClass = "purple";
    prioritySub = "Priority 4 · Local Connector";
    feasibilityClass = "green";
    feasibilityTitle = "Using local train";
  }

  const delayText = option.delay_minutes ? `+${option.delay_minutes} min` : option.status;

  let pointsHtml = "";
  if (option.trains.length === 1) {
    pointsHtml = `<b>${escapeHtml(stationName(first.source))}</b> <small>${formatTime(option.departure)}${first.delay_minutes ? ` (+${first.delay_minutes}m)` : ""}</small>
      <span class="journey-arrow">→</span>
      <b>${escapeHtml(stationName(final.destination))}</b> <small>${formatTime(option.arrival)} (Expected)</small>`;
  } else {
    const mid = option.trains[0].destination;
    pointsHtml = `<b>${escapeHtml(stationName(first.source))}</b> <span class="journey-arrow">→</span> 
      <b>${escapeHtml(stationName(mid))}</b> <small>(${option.transfer_minutes}m transfer)</small> <span class="journey-arrow">→</span> 
      <b>${escapeHtml(stationName(final.destination))}</b>`;
  }

  return `
  <article class="route-card priority-${option.priority}">
    <div class="card-badges">
      ${option.priority === 1 ? `<span class="badge-solid green">BEST OPTION</span>` : ""}
      <span class="badge-soft ${priorityBadgeClass}">${escapeHtml(prioritySub)}</span>
    </div>

    <div class="card-main-grid">
      <div class="card-title-group">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="16" rx="2"></rect><path d="M4 11h16"></path></svg>
          ${escapeHtml(option.label)}
        </h3>
        <div class="train-code">${escapeHtml(first.number)} ${escapeHtml(first.name)}</div>
        <div class="journey-row">${pointsHtml}</div>
      </div>

      <div class="card-metric">
        <label>Delay / Status</label>
        <strong class="${first.delay_minutes ? "delay-highlight" : ""}">${escapeHtml(delayText)}</strong>
      </div>

      <div class="card-metric">
        <label>Platform</label>
        <strong>${first.platform ? `Platform ${escapeHtml(first.platform)}` : "Not provided"}</strong>
      </div>

      <div class="card-metric">
        <label>Duration</label>
        <strong>${formatDuration(option.duration_minutes)}</strong>
      </div>

      <div class="feasibility-box ${feasibilityClass}">
        <strong>${escapeHtml(feasibilityTitle)}</strong>
        ${escapeHtml(option.reason)}
      </div>

      <button class="btn-details" type="button" data-option="${index}">View Details &gt;</button>
    </div>
  </article>`;
}

function renderResults(data) {
  const options = [data.best_option, ...data.alternatives].filter(Boolean);
  lastOptions = options;
  $("#empty-results").hidden = true;

  $("#result-subtitle").textContent = `Top recommended routes for ${data.search.from_name} → ${data.search.to_name} (${data.search.date} at ${data.search.time})`;
  $("#updated-label").textContent = `Last updated: ${new Date(data.last_updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  const sourceLabel = $("#source-label");
  if (data.data_mode === "rapidapi" || data.data_mode === "live") {
    sourceLabel.innerHTML = '<i class="dot"></i> Real API Connected (RapidAPI)';
    sourceLabel.className = "status-pill live";
  } else if (data.data_mode === "cached") {
    sourceLabel.innerHTML = '<i class="dot"></i> Cached provider data';
    sourceLabel.className = "status-pill cached";
  } else if (data.data_mode === "fallback") {
    sourceLabel.innerHTML = '<i class="dot"></i> RapidAPI Connected · Fallback Active';
    sourceLabel.className = "status-pill cached";
  } else {
    sourceLabel.innerHTML = '<i class="dot"></i> Demo schedules · not live';
    sourceLabel.className = "status-pill demo";
  }

  if (!options.length) {
    resultList.innerHTML = `<div class="empty-state">
      <div class="empty-icon">ⓘ</div>
      <h3>No feasible route found</h3>
      <p>${data.warnings.map(escapeHtml).join("<br>") || "Try adjusting departure time or selecting another route."}</p>
    </div>`;
    return;
  }

  const warningsHtml = data.warnings.length ? `<div class="notice warning">${data.warnings.map(escapeHtml).join("<br>")}</div>` : "";
  resultList.innerHTML = warningsHtml + options.map(optionCard).join("");

  resultList.querySelectorAll("[data-option]").forEach((button) => {
    button.addEventListener("click", () => showOptionDetails(Number(button.dataset.option)));
  });

  updateMapForRoute(data.search.from, data.search.to);
}

async function runSearch(event) {
  if (event) event.preventDefault();
  $("#error").hidden = true;
  $("#loading").hidden = false;
  resultList.replaceChildren();

  const fromVal = getStationParam($("#from"));
  const toVal = getStationParam($("#to"));

  const params = new URLSearchParams({
    from: fromVal,
    to: toVal,
    date: $("#date").value,
    time: $("#time").value,
    scenario: $("#scenario")?.value || "all",
  });

  try {
    const response = await fetch(`/api/search?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Search could not be completed.");
    renderResults(data);
    addHistory(data.search.from, data.search.to, data.search.date, data.search.time);
  } catch (error) {
    $("#error").textContent = `${error.message}`;
    $("#error").hidden = false;
    $("#empty-results").hidden = true;
  } finally {
    $("#loading").hidden = true;
  }
}

function showOptionDetails(index) {
  const option = lastOptions[index];
  if (!option) return;

  const legs = option.trains.map((train, legIndex) => `
    <section class="detail-leg" style="padding:10px 0; border-top:1px solid #e2e8f0;">
      <h4 style="margin:0 0 4px; color:#0f172a; font-size:13px;">${legIndex + 1}. ${escapeHtml(train.name)} (${escapeHtml(train.number)})</h4>
      <p style="margin:2px 0; font-size:12px; color:#475569;">${escapeHtml(stationName(train.source))} → ${escapeHtml(stationName(train.destination))}</p>
      <p style="margin:2px 0; font-size:12px; color:#475569;">Departure: ${formatTime(train.departure)} · Arrival: ${formatTime(train.arrival)} · Duration: ${formatDuration(train.duration_minutes)}</p>
      <p style="margin:2px 0; font-size:12px; color:#475569;">Status: ${escapeHtml(train.status)}${train.delay_minutes ? ` · Delay: +${train.delay_minutes} min` : ""}${train.platform ? ` · Platform ${escapeHtml(train.platform)}` : ""}</p>
      ${legIndex < option.trains.length - 1 ? `<p style="margin:6px 0 2px; font-size:11px; font-weight:600; color:#0878ef;">Transfer at ${escapeHtml(stationName(train.destination))}: ${option.transfer_minutes} min (Minimum required: 20 min)</p>` : ""}
    </section>
  `).join("");

  $("#details-content").innerHTML = `
    <h2 style="margin:0 0 6px; font-size:18px; color:#0f172a;">${escapeHtml(option.label)}</h2>
    <p class="detail-summary" style="margin:0 0 12px; color:#64748b; font-size:12px;">${escapeHtml(option.reason)}</p>
    ${legs}
    <div class="dialog-actions" style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn-primary" id="save-option" type="button">♡ Save Route</button>
      <button class="btn-primary" id="track-option" type="button" style="background:#475569;">Track Train</button>
    </div>
  `;

  $("#save-option").addEventListener("click", () => saveRoute(option));
  $("#track-option").addEventListener("click", () => {
    $("#train-number").value = option.trains[0].number;
    dialog.close();
    trackTrain();
    $("#tracking").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  dialog.showModal();
}

/* LocalStorage Storage Helpers */
function getStored(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}

function setStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { showToast("Could not save data in this browser."); }
}

function addHistory(from, to, date, time) {
  const entries = getStored("trr-history");
  entries.unshift({ from, to, date, time });
  setStored("trr-history", entries.slice(0, 5));
  renderHistory();
}

function renderHistory() {
  const items = getStored("trr-history");
  $("#history-list").innerHTML = items.length
    ? items.map((item, index) => `<div class="history-entry" data-history="${index}"><span>${escapeHtml(stationName(item.from))} → ${escapeHtml(stationName(item.to))}</span><small>${escapeHtml(item.time)}</small></div>`).join("")
    : '<p class="muted">Your recent searches will appear here.</p>';

  $("#history-list").querySelectorAll("[data-history]").forEach((entry) => {
    entry.addEventListener("click", () => {
      const item = items[Number(entry.dataset.history)];
      $("#from").value = item.from;
      $("#to").value = item.to;
      $("#date").value = item.date;
      $("#time").value = item.time;
      runSearch();
    });
  });
}

function saveRoute(option) {
  const saved = getStored("trr-saved");
  if (saved.some((entry) => entry.trains[0].number === option.trains[0].number && entry.departure === option.departure)) {
    showToast("This route is already saved.");
    return;
  }
  saved.unshift(option);
  setStored("trr-saved", saved.slice(0, 8));
  renderSaved();
  showToast("Route saved to browser.");
}

function renderSaved() {
  const items = getStored("trr-saved");
  $("#saved-list").innerHTML = items.length
    ? items.map((item) => `<div class="history-entry"><span>${escapeHtml(item.label)} · ${escapeHtml(stationName(item.source))} → ${escapeHtml(stationName(item.destination))}</span><small>${formatTime(item.departure)}</small></div>`).join("")
    : '<p class="muted">Save a route from its details to keep it here.</p>';
}

let currentTrackingDateOffset = 0;
let currentTrackingCustomDate = null;
let autoRefreshCountdownTimer = null;
let autoRefreshRemaining = 30;

function getRecentTrains() {
  try {
    return JSON.parse(localStorage.getItem("trr-recent-tracked") || "[]");
  } catch (e) {
    return [];
  }
}

function saveRecentTrain(data) {
  const number = data.returned_train_number || data.requested_train_number;
  if (!number) return;
  const name = data.train_name || `Train ${number}`;
  let list = getRecentTrains();
  list = list.filter((item) => item.number !== number);
  list.unshift({ number, name });
  if (list.length > 5) list = list.slice(0, 5);
  localStorage.setItem("trr-recent-tracked", JSON.stringify(list));
  renderRecentTrains();
}

function renderRecentTrains() {
  const bar = $("#recent-trains-bar");
  const listContainer = $("#recent-train-chips");
  if (!bar || !listContainer) return;

  const list = getRecentTrains();
  if (!list.length) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  listContainer.innerHTML = list
    .map(
      (item) => `
    <button type="button" class="recent-train-chip" data-track-num="${escapeHtml(item.number)}" title="${escapeHtml(item.name)}">
      ${escapeHtml(item.number)} ${escapeHtml(item.name.split(" ")[0])}
    </button>
  `
    )
    .join("");

  listContainer.querySelectorAll("[data-track-num]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#train-number").value = btn.dataset.trackNum;
      trackTrain();
    });
  });
}

function initRecentTrains() {
  renderRecentTrains();
  $("#clear-recent-trains")?.addEventListener("click", () => {
    localStorage.removeItem("trr-recent-tracked");
    renderRecentTrains();
    showToast("Recent searches cleared.");
  });
}

function updateCountdownBar(pct) {
  const bar = $("#wimt-countdown-bar");
  if (bar) {
    bar.style.width = `${pct}%`;
  }
}

function stopAutoRefresh() {
  if (autoRefreshCountdownTimer) {
    clearInterval(autoRefreshCountdownTimer);
    autoRefreshCountdownTimer = null;
  }
  updateCountdownBar(0);
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshRemaining = 30;
  updateCountdownBar(0);

  autoRefreshCountdownTimer = setInterval(() => {
    autoRefreshRemaining--;
    const pct = ((30 - autoRefreshRemaining) / 30) * 100;
    updateCountdownBar(pct);

    if (autoRefreshRemaining <= 0) {
      autoRefreshRemaining = 30;
      updateCountdownBar(0);
      const number = $("#train-number")?.value.trim();
      if (number) {
        trackTrain(null, { silent: true });
        const fab = $("#wimt-refresh-btn");
        if (fab) {
          fab.style.transform = "rotate(360deg)";
          setTimeout(() => {
            fab.style.transform = "";
          }, 500);
        }
      }
    }
  }, 1000);
}

function setupAutoRefresh() {
  const toggle = $("#auto-refresh-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      startAutoRefresh();
      showToast("⚡ 30s live auto-refresh enabled!");
    } else {
      stopAutoRefresh();
      showToast("Auto-refresh paused.");
    }
  });
}

function setupTrainAutocomplete() {
  const input = $("#train-number");
  const dropdown = $("#train-autocomplete");
  if (!input || !dropdown) return;

  let debounceTimer;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 1) {
      dropdown.hidden = true;
      dropdown.replaceChildren();
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/trains/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!res.ok || !data.trains || !data.trains.length) {
          dropdown.hidden = true;
          return;
        }

        dropdown.innerHTML = data.trains
          .map(
            (t) => `
          <div class="train-auto-item" data-num="${escapeHtml(t.number)}">
            <div>
              <div class="train-auto-title">${escapeHtml(t.name)}</div>
              <div class="train-auto-sub">${escapeHtml(t.source)} → ${escapeHtml(t.destination)}</div>
            </div>
            <span class="train-auto-badge">${escapeHtml(t.number)}</span>
          </div>
        `
          )
          .join("");

        dropdown.hidden = false;

        dropdown.querySelectorAll(".train-auto-item").forEach((item) => {
          item.addEventListener("click", () => {
            input.value = item.dataset.num;
            dropdown.hidden = true;
            trackTrain();
          });
        });
      } catch (err) {
        dropdown.hidden = true;
      }
    }, 150);
  });

  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.hidden = true;
    }
  });
}

/* Live Train Tracking Component */
function renderTrackCard(data, number, target) {
  saveRecentTrain(data);

  const reqNum = escapeHtml(data.requested_train_number || number);
  const retNum = escapeHtml(data.returned_train_number || number);
  const trainName = data.train_name ? escapeHtml(data.train_name) : "Express";
  const sourceStn = data.source_station ? escapeHtml(stationName(data.source_station)) : "SRC";
  const destStn = data.destination_station ? escapeHtml(stationName(data.destination_station)) : "DST";
  const journeyDate = data.journey_date ? escapeHtml(data.journey_date) : "";
  const currStnText = data.current_station ? escapeHtml(stationName(data.current_station)) : "Running";

  let formattedDateHeader = "Day 1 - Today";
  try {
    const d = journeyDate ? new Date(journeyDate + "T12:00:00") : new Date();
    formattedDateHeader = `Day 1 - ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" })}`;
  } catch (e) {}

  let modeBadgeHtml = "";
  if (data.data_mode === "railkit" || data.data_source === "railkit_irctc") {
    modeBadgeHtml = '<span class="status-pill live" style="font-size:10px;"><i class="dot"></i> IRCTC Real Live</span>';
  } else if (data.data_mode === "demo") {
    modeBadgeHtml = '<span class="status-pill demo" style="font-size:10px;"><i class="dot"></i> Demo Mode</span>';
  } else if (data.data_mode === "cached" || data.cached) {
    modeBadgeHtml = '<span class="status-pill cached" style="font-size:10px;"><i class="dot"></i> Cached Live</span>';
  } else if (data.data_mode === "fallback") {
    modeBadgeHtml = '<span class="status-pill cached" style="font-size:10px;"><i class="dot"></i> Quota Fallback</span>';
  } else {
    modeBadgeHtml = '<span class="status-pill live" style="font-size:10px;"><i class="dot"></i> Real Live</span>';
  }

  const fallbackNotice = data.data_mode === "fallback" ? `
    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:6px 10px; font-size:10px; color:#92400e; margin:6px 10px 0;">
      <strong>⚡ Backup Preview</strong>: ${escapeHtml(data.message || "Showing smart backup preview.")}
    </div>
  ` : "";

  const stations = (data.stations && data.stations.length) ? data.stations : [
    { station_code: data.source_station, station_name: sourceStn, distance: "0 km", scheduled_arrival: "--", actual_arrival: "--", scheduled_departure: "10:00 AM", actual_departure: "10:00 AM", platform: "1", is_current: false, is_passed: true },
    { station_code: "CURR", station_name: currStnText, distance: "45 km", scheduled_arrival: "10:45 AM", actual_arrival: "10:50 AM", scheduled_departure: "10:47 AM", actual_departure: "10:52 AM", platform: data.platform || "2", is_current: true, is_passed: false },
    { station_code: data.destination_station, station_name: destStn, distance: "120 km", scheduled_arrival: "12:15 PM", actual_arrival: "12:20 PM", scheduled_departure: "--", actual_departure: "--", platform: "3", is_current: false, is_passed: false },
  ];

  // Next Station ETA calculation
  const curIdx = stations.findIndex((s) => s.is_current);
  const nextStn = (curIdx !== -1 && curIdx < stations.length - 1) ? stations[curIdx + 1] : null;
  let nextStopBannerHtml = "";
  if (nextStn) {
    const isDel = Boolean(data.delay_minutes && data.delay_minutes > 0);
    nextStopBannerHtml = `
      <div class="wimt-next-stop-banner">
        <div class="wimt-next-stop-left">
          <div class="wimt-next-pulse"></div>
          <div>
            <div class="wimt-next-label">NEXT STOPPING STATION</div>
            <div class="wimt-next-title">${escapeHtml(nextStn.station_name)}</div>
            <div class="wimt-next-meta">
              <span>Platform <strong>${escapeHtml(nextStn.platform || "2")}</strong></span>
              <span>•</span>
              <span>Sched Arr: <strong>${escapeHtml(nextStn.scheduled_arrival)}</strong></span>
              ${nextStn.distance ? `<span>•</span><span>${escapeHtml(nextStn.distance)}</span>` : ""}
            </div>
          </div>
        </div>
        <div>
          <span class="wimt-eta-pill ${isDel ? "delayed" : ""}">
            ${isDel ? `+${data.delay_minutes}m Late` : "On Time"}
          </span>
        </div>
      </div>
    `;
  }

  // Quick Date Switch Tabs
  const dNow = new Date();
  const dYesterday = new Date(dNow.getTime() - 86400000);
  const dTomorrow = new Date(dNow.getTime() + 86400000);
  const formatDateTab = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const dateTabsHtml = `
    <div class="wimt-date-tabs">
      <button type="button" class="wimt-date-tab ${currentTrackingDateOffset === -1 ? "active" : ""}" data-date-offset="-1">
        Yesterday (${formatDateTab(dYesterday)})
      </button>
      <button type="button" class="wimt-date-tab ${currentTrackingDateOffset === 0 ? "active" : ""}" data-date-offset="0">
        Today (${formatDateTab(dNow)})
      </button>
      <button type="button" class="wimt-date-tab ${currentTrackingDateOffset === 1 ? "active" : ""}" data-date-offset="1">
        Tomorrow (${formatDateTab(dTomorrow)})
      </button>
    </div>
  `;

  const countdownBarHtml = `
    <div class="wimt-countdown-bar-wrap">
      <div class="wimt-countdown-bar" id="wimt-countdown-bar"></div>
    </div>
  `;

  const stationRowsHtml = stations.map((stn) => {
    const isCurrent = Boolean(stn.is_current);
    const isPassed = Boolean(stn.is_passed);
    const arrLate = stn.actual_arrival && stn.actual_arrival !== "---" && stn.actual_arrival !== stn.scheduled_arrival;
    const depLate = stn.actual_departure && stn.actual_departure !== "---" && stn.actual_departure !== stn.scheduled_departure;

    return `
      <div class="wimt-row ${isCurrent ? "current-station-row" : ""} ${isPassed ? "passed" : ""}">
        <div class="wimt-arrival-col">
          <div class="wimt-time-sched">${escapeHtml(stn.scheduled_arrival || "--")}</div>
          ${arrLate ? `<div class="wimt-time-actual red">${escapeHtml(stn.actual_arrival)}</div>` : ""}
        </div>

        <div class="wimt-track-col">
          <div class="wimt-track-segment"></div>
          ${isCurrent ? `
            <div class="wimt-live-train-badge" title="Current Location: ${escapeHtml(stn.station_name)}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 15.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h12v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V5c0-3.5-3.58-4-8-4s-8 .5-8 4v10.5zm8 1.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm6-7H6V5h12v5z"/>
              </svg>
              <span class="wimt-train-pointer"></span>
            </div>
          ` : `
            <div class="wimt-station-dot"></div>
          `}
        </div>

        <div class="wimt-info-col">
          <div class="wimt-stn-name">${escapeHtml(stn.station_name)}</div>
          <div class="wimt-stn-meta">
            <span>${escapeHtml(stn.distance || "")}</span>
            ${stn.platform ? `<span class="wimt-platform-tag">Platform [ ${escapeHtml(stn.platform)} ✏️ ]</span>` : ""}
          </div>
        </div>

        <div class="wimt-departure-col">
          <div class="wimt-time-sched">${escapeHtml(stn.scheduled_departure || "--")}</div>
          ${depLate ? `<div class="wimt-time-actual red">${escapeHtml(stn.actual_departure)}</div>` : (stn.actual_departure === "---" ? '<div class="wimt-time-sched">---</div>' : "")}
        </div>
      </div>
    `;
  }).join("");

  target.innerHTML = `
    <div class="wimt-shell">
      <div class="wimt-topbar">
        <div class="wimt-topbar-left">
          <button type="button" class="wimt-back-btn" id="wimt-back-btn" title="Back / Clear">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div class="wimt-train-title" title="${retNum} - ${trainName}">${retNum} - ${trainName}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${modeBadgeHtml}
          <button type="button" class="wimt-menu-btn" title="Menu">⋮</button>
        </div>
      </div>

      ${countdownBarHtml}
      ${dateTabsHtml}

      <div class="wimt-actions-bar">
        <button type="button" class="wimt-action-btn" id="wimt-date-btn">
          <span>📅 Date Details</span>
        </button>
        <button type="button" class="wimt-action-btn" id="wimt-alarm-btn">
          <span>⏰ Alarm</span>
        </button>
        <button type="button" class="wimt-action-btn" id="wimt-coach-btn">
          <span>🚆 Coach</span>
        </button>
        <button type="button" class="wimt-action-btn" id="wimt-share-btn" style="background:#075e54; border-color:#128c7e;" title="Share on WhatsApp">
          <span>📲 WhatsApp Share</span>
        </button>
      </div>

      ${nextStopBannerHtml}
      ${fallbackNotice}

      <div class="wimt-col-headers">
        <div>Arrival</div>
        <div class="center">${escapeHtml(formattedDateHeader)}</div>
        <div class="right">Departure</div>
      </div>

      <div class="wimt-timeline" id="wimt-scroll-container">
        ${stationRowsHtml}
      </div>

      <div class="wimt-bottombar">
        <div class="wimt-bottom-status">
          <div class="wimt-current-text">
            <span>At ${currStnText}</span>
          </div>
          <div class="wimt-updated-text">
            ${data.delay_minutes ? `<span style="color:#ef4444;">+${data.delay_minutes}m late</span> · ` : ""}Updated ${formatTime(data.last_updated) || "few seconds ago"}
          </div>
        </div>
        <button type="button" class="wimt-refresh-fab" id="wimt-refresh-btn" title="Refresh Live Status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        </button>
      </div>
    </div>
  `;

  // Auto-scroll timeline to current station
  const currentStnEl = target.querySelector(".current-station-row");
  const scrollContainer = target.querySelector("#wimt-scroll-container");
  if (currentStnEl && scrollContainer) {
    setTimeout(() => {
      const offsetTop = currentStnEl.offsetTop - (scrollContainer.clientHeight / 2) + 30;
      scrollContainer.scrollTo({ top: Math.max(0, offsetTop), behavior: "smooth" });
    }, 120);
  }

  // Quick Date Switch Tab clicks
  target.querySelectorAll(".wimt-date-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const offset = parseInt(tab.dataset.dateOffset, 10);
      currentTrackingDateOffset = offset;
      const targetDateObj = new Date(Date.now() + offset * 86400000);
      const yyyy = targetDateObj.getFullYear();
      const mm = String(targetDateObj.getMonth() + 1).padStart(2, "0");
      const dd = String(targetDateObj.getDate()).padStart(2, "0");
      currentTrackingCustomDate = `${yyyy}-${mm}-${dd}`;
      trackTrain(null, { customDate: currentTrackingCustomDate });
    });
  });

  // Interactive buttons
  $("#wimt-alarm-btn")?.addEventListener("click", () => {
    showToast(`⏰ Alarm set for arrival at ${currStnText}!`);
  });

  $("#wimt-coach-btn")?.addEventListener("click", () => {
    showToast(`🚆 Coach Layout: [Engine] [GEN] [S1-S6] [B1-B4] [A1] [GEN] [SLR]`);
  });

  $("#wimt-share-btn")?.addEventListener("click", () => {
    const statusDesc = data.delay_minutes ? `Running ${data.delay_minutes}m late` : "Running On Time";
    const shareMsg = `🚆 *IRCTC Live Train Tracking*\n` +
      `Train: *${retNum} - ${trainName}*\n` +
      `📍 Current Station: *At ${currStnText}*\n` +
      `⏱️ Status: *${statusDesc}*\n` +
      `🏁 Route: ${sourceStn} ➔ ${destStn}\n` +
      `📅 Journey Date: ${journeyDate || "Today"}\n\n` +
      `Track live on TrainRoute Rescue: ${window.location.origin}/#tracking`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareMsg);
    }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareMsg)}`, "_blank");
    showToast("✓ Opening WhatsApp to share live status!");
  });

  $("#wimt-date-btn")?.addEventListener("click", () => {
    showToast(`Journey Date: ${journeyDate || "Today"}`);
  });

  $("#wimt-back-btn")?.addEventListener("click", () => {
    target.innerHTML = '<p class="muted">Enter a train number or name to view status, current station, and delay details.</p>';
  });

  $("#wimt-refresh-btn")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    btn.style.transform = "rotate(360deg)";
    setTimeout(() => { btn.style.transform = ""; }, 500);
    showToast("Refreshing live status...");
    trackTrain(null, { customDate: currentTrackingCustomDate });
  });
}

async function fetchDemoTrack(number) {
  const target = $("#track-result");
  target.innerHTML = '<p class="muted">Loading demonstration status…</p>';
  try {
    const departureDate = $("#date").value;
    const query = departureDate
      ? `?${new URLSearchParams({ departure_date: departureDate, demo: "true" })}`
      : "?demo=true";
    const res = await fetch(`/api/train/${encodeURIComponent(number)}/live${query}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Demonstration tracking unavailable.");
    renderTrackCard(data, number, target);
  } catch (err) {
    target.innerHTML = `<div class="notice error" role="alert" style="margin-top:8px; font-size:12px;">${escapeHtml(err.message)}</div>`;
  }
}

async function trackTrain(event, options = {}) {
  if (event) event.preventDefault();
  const number = $("#train-number").value.trim();
  const target = $("#track-result");

  if (!number) {
    target.innerHTML = '<p class="muted">Please enter a train number or name to track.</p>';
    return;
  }

  const isSilent = Boolean(options && options.silent);
  if (!isSilent) {
    target.innerHTML = '<p class="muted">Loading live IRCTC train status…</p>';
  }

  try {
    const customDate = options && options.customDate;
    const departureDate = customDate || $("#date").value;
    const queryParams = new URLSearchParams({ fallback: "true" });
    if (departureDate) queryParams.set("departure_date", departureDate);
    const response = await fetch(`/api/train/${encodeURIComponent(number)}/live?${queryParams}`);
    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.detail || "Live train information is currently unavailable.";
      throw new Error(errorMsg);
    }

    renderTrackCard(data, number, target);
  } catch (error) {
    const errorMsg = escapeHtml(error.message);
    target.innerHTML = `
      <div class="notice error" role="alert" style="margin-top:8px; font-size:12px;">
        ${errorMsg}
        <div style="margin-top:10px;">
          <button id="view-demo-track-btn" class="btn-primary" type="button" style="background:#475569; padding:5px 12px; font-size:11px; cursor:pointer;">
            View Demo Status for Train ${escapeHtml(number)}
          </button>
        </div>
      </div>
    `;
    $("#view-demo-track-btn")?.addEventListener("click", () => {
      fetchDemoTrack(number);
    });
  }
}

/* Dynamic Leaflet Interactive Map */
function initMap() {
  const mapElement = $("#map");
  if (!mapElement || typeof L === "undefined") return;

  if (!mapInstance) {
    mapInstance = L.map("map", {
      zoomControl: false,
      attributionControl: false
    }).setView([20.5937, 78.9629], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
    }).addTo(mapInstance);
  }
  updateMapForRoute("PUNE", "MMCT");
}

async function updateMapForRoute(fromQuery, toQuery) {
  if (!mapInstance || typeof L === "undefined") return;

  const cleanFrom = (String(fromQuery).match(/[\(\[]\s*([A-Za-z0-9]{2,6})\s*[\)\]]/) || [])[1] || fromQuery;
  const cleanTo = (String(toQuery).match(/[\(\[]\s*([A-Za-z0-9]{2,6})\s*[\)\]]/) || [])[1] || toQuery;

  try {
    const resFrom = await fetch(`/api/stations/search?q=${encodeURIComponent(cleanFrom)}`);
    const resTo = await fetch(`/api/stations/search?q=${encodeURIComponent(cleanTo)}`);
    const dataFrom = await resFrom.json();
    const dataTo = await resTo.json();

    const stn1 = dataFrom.stations && dataFrom.stations[0];
    const stn2 = dataTo.stations && dataTo.stations[0];

    // Clear previous layers
    mapLayers.forEach((l) => mapInstance.removeLayer(l));
    mapLayers = [];

    if (stn1 && stn2 && stn1.lat && stn1.lng && stn2.lat && stn2.lng) {
      const p1 = [stn1.lat, stn1.lng];
      const p2 = [stn2.lat, stn2.lng];

      const polyline = L.polyline([p1, p2], {
        color: "#0070f3",
        weight: 4,
        dashArray: "6, 8"
      }).addTo(mapInstance);
      mapLayers.push(polyline);

      const createPin = (color) => L.divIcon({
        className: "custom-map-pin",
        html: `<div style="background:${color}; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
        iconSize: [12, 12]
      });

      const m1 = L.marker(p1, { icon: createPin("#08ad78") }).addTo(mapInstance).bindPopup(`<b>${stn1.name} (${stn1.code})</b>`);
      const m2 = L.marker(p2, { icon: createPin("#ef4444") }).addTo(mapInstance).bindPopup(`<b>${stn2.name} (${stn2.code})</b>`);
      mapLayers.push(m1, m2);

      mapInstance.fitBounds([p1, p2], { padding: [30, 30] });
    }
  } catch (err) {
    // Silent map error handling
  }
}

function addScenarioPicker() {
  const controls = document.createElement("div");
  controls.className = "scenario-control";
  controls.innerHTML = `<label for="scenario">Demo scenario</label><select id="scenario">${scenarios.map(([val, label]) => `<option value="${val}">${label}</option>`).join("")}</select>`;
  $(".search-sub-bar").append(controls);
}

/* Event Listeners & Boot */
form.addEventListener("submit", runSearch);

$("#swap-stations").addEventListener("click", () => {
  const from = $("#from");
  const to = $("#to");
  const temp = from.value;
  from.value = to.value;
  to.value = temp;
});

$("#track-form").addEventListener("submit", trackTrain);

document.querySelectorAll("[data-focus-search]").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("#from").focus();
    $("#search").scrollIntoView({ behavior: "smooth" });
  });
});

document.querySelectorAll("[data-focus-tracking]").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("#train-number").focus();
    $("#tracking").scrollIntoView({ behavior: "smooth" });
  });
});

$("[data-nearby]").addEventListener("click", async () => {
  try {
    const station = $("#from").value || "PUNE";
    const res = await fetch(`/api/stations/nearby?station=${encodeURIComponent(station)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Nearby station lookup failed.");

    const target = $("#nearby-info");
    target.textContent = `Nearby station data for ${data.station.name}: ${data.nearby_stations.map((s) => s.name).join(", ")}.`;
    target.hidden = false;
  } catch (err) {
    showToast(err.message);
  }
});

$("[data-clear-history]").addEventListener("click", () => {
  setStored("trr-history", []);
  renderHistory();
});

$("#map-full-view").addEventListener("click", () => {
  if (mapInstance) {
    mapInstance.setView([20.5937, 78.9629], 5);
    showToast("Map view centered on India.");
  }
});

/* -------------------------------------------------------------------------- */
/* Real Railway API Status & Diagnostics Modal                                */
/* -------------------------------------------------------------------------- */
async function initApiStatus() {
  const btn = $("#api-status-btn");
  const text = $("#api-status-text");
  if (!btn || !text) return;

  try {
    const res = await fetch("/api/provider/status");
    if (!res.ok) return;
    const data = await res.json();
    window.currentApiStatus = data;

    btn.className = "api-status-chip";
    if (data.is_railkit || data.provider === "railkit") {
      btn.classList.add("live");
      text.textContent = "RailKit Live";
      btn.title = "Real IRCTC Live API Connected (RailKit)";
    } else if (data.status === "connected") {
      btn.classList.add("live");
      text.textContent = "RapidAPI Live";
      btn.title = "Real API Connected and Active";
    } else if (data.status === "quota_exhausted") {
      btn.classList.add("quota");
      text.textContent = "RapidAPI (Quota 429)";
      btn.title = "Real API Connected · Free Quota Reached (Fallback Active)";
    } else {
      btn.classList.add("demo");
      text.textContent = "Demo Mode";
      btn.title = "Local Demonstration Mode";
    }
  } catch (e) {
    text.textContent = "API Status";
  }
}

function showApiDiagnostics() {
  const apiDialog = $("#api-dialog");
  const content = $("#api-dialog-content");
  if (!apiDialog || !content) return;

  const data = window.currentApiStatus || {
    status: "unknown",
    provider: "checking...",
    api_key_masked: "N/A",
  };

  const statusBadge = (data.status === "connected" || data.is_railkit)
    ? '<span class="badge-soft green" style="padding:4px 8px; border-radius:4px; font-weight:700;">🟢 Live Connected (Real Data)</span>'
    : (data.status === "quota_exhausted"
      ? '<span class="badge-soft amber" style="padding:4px 8px; border-radius:4px; font-weight:700;">⚠️ Quota Limit (429) · Fallback Active</span>'
      : '<span class="badge-soft blue" style="padding:4px 8px; border-radius:4px; font-weight:700;">ℹ️ Demo Simulation</span>');

  const providerLabel = data.is_railkit ? "RailKit Indian Railways API" : "RapidAPI Indian Railways";
  const endpointLabel = data.is_railkit ? "api.railkit.in (HMAC Auth)" : "indian-railway-irctc.p.rapidapi.com";

  content.innerHTML = `
    <h2 style="margin:0 0 8px; font-size:18px; color:#0f172a;">API Connection Diagnostics</h2>
    <p style="margin:0 0 16px; color:#64748b; font-size:12px;">Real-time integration status of external railway provider.</p>

    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; font-size:12px; display:grid; gap:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#64748b;">Configured Provider:</span>
        <strong style="text-transform:uppercase;">${escapeHtml(providerLabel)}</strong>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#64748b;">Connection State:</span>
        ${statusBadge}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#64748b;">Server API Key:</span>
        <code>${escapeHtml(data.api_key_masked || "None")}</code>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#64748b;">API Host:</span>
        <span><code>${escapeHtml(endpointLabel)}</code></span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#64748b;">Status:</span>
        <strong>${escapeHtml(data.message || "Active")}</strong>
      </div>
    </div>

    ${data.status === "quota_exhausted" ? `
      <div style="margin-top:12px; padding:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; font-size:11px; color:#92400e;">
        <strong>How to renew free live quota:</strong>
        <p style="margin:4px 0 0; line-height:1.4;">
          RapidAPI's Basic Plan provides 50 free requests per month. If you need 50 fresh live requests, subscribe to the free API on rapidapi.com, copy the key, update <code>RAILWAY_API_KEY</code> in <code>.env</code>, and click Reload below!
        </p>
      </div>
    ` : ""}

    <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
      <button class="btn-primary" type="button" id="reload-api-btn" style="background:#0878ef;">⟳ Test / Reload API</button>
    </div>
  `;

  $("#reload-api-btn")?.addEventListener("click", async () => {
    showToast("Re-testing API connection...");
    try {
      const res = await fetch("/api/provider/reload", { method: "POST" });
      const updated = await res.json();
      window.currentApiStatus = updated;
      initApiStatus();
      showApiDiagnostics();
      showToast("API status updated!");
    } catch {
      showToast("Could not reload API status.");
    }
  });

  apiDialog.showModal();
}

$("#api-status-btn")?.addEventListener("click", showApiDiagnostics);

document.querySelectorAll("[data-track-num]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const num = btn.dataset.trackNum;
    if (num) {
      $("#train-number").value = num;
      trackTrain();
    }
  });
});

// Initial bootup
localDateTimeDefaults();
setupAutocomplete("#from", "#from-suggestions");
setupAutocomplete("#to", "#to-suggestions");
setupTrainAutocomplete();
initRecentTrains();
setupAutoRefresh();
addScenarioPicker();
renderHistory();
renderSaved();
initMap();
initApiStatus();
runSearch();