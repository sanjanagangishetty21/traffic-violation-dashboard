/* ==========================================================================
   APIC-TV Frontend Logic (Single Page Routing, API Integration, Canvas Drawing)
   ========================================================================== */

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:8000/api' : '/api';
let currentTab = "dashboard";
let historyPage = 1;
let historyLimit = 10;
let activeTool = "stop_line"; // stop_line, no_parking

// Active settings loaded from server
let activeSettings = {
    stop_line: { start: [100, 420], end: [700, 420] },
    no_parking_zone: [[100, 450], [350, 450], [300, 580], [50, 580]],
    traffic_light_state: "Red",
    traffic_light_zone: { x: 695, y: 100, width: 40, height: 120 },
    lane_directions: { lane1: "North", lane2: "South" }
};

// Canvas drawing state
let canvas, ctx;
let isDrawingLine = false;
let stopLineTemp = { start: null, end: null };
let noParkingPoints = [];

// Global charts
let charts = {};

document.addEventListener("DOMContentLoaded", () => {
    // 1. Tab Navigation
    setupNavigation();
    
    // 2. Real-time Clock
    setInterval(updateClock, 1000);
    updateClock();
    
    // 3. Theme Toggle
    setupThemeToggle();
    
    // 4. Initial Load
    loadDashboardData();
    loadSettings();
    
    // 5. File Upload handlers
    setupFileUpload();
    
    // 6. Canvas Settings handlers
    setupCanvasControls();
    
    // 7. Modals and Actions
    setupModalHandlers();
    
    // 8. Filters in history
    setupHistoryFilters();
});

// --- ROUTING / VIEW NAVIGATION ---
function setupNavigation() {
    const menuItems = document.querySelectorAll(".menu-item");
    menuItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const tabName = item.getAttribute("data-tab");
            
            // Toggle active menu class
            menuItems.forEach(i => i.classList.remove("active"));
            item.classList.add("active");
            
            // Toggle active panel
            document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
            document.getElementById(`panel-${tabName}`).classList.add("active");
            
            currentTab = tabName;
            
            // Load specific panel data
            if (tabName === "dashboard") {
                loadDashboardData();
            } else if (tabName === "history") {
                loadHistoryData();
            } else if (tabName === "analytics") {
                loadAnalyticsData();
            } else if (tabName === "settings") {
                initSettingsCanvas();
            }
        });
    });
    
    // Global search input keypress
    document.getElementById("global-search").addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            const query = e.target.value;
            // Switch to history tab and search
            document.querySelector('[data-tab="history"]').click();
            document.getElementById("filter-search-input").value = query;
            loadHistoryData(query);
        }
    });
}

function updateClock() {
    const timeDisplay = document.getElementById("current-time");
    const now = new Date();
    timeDisplay.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setupThemeToggle() {
    const themeBtn = document.getElementById("theme-btn");
    themeBtn.addEventListener("click", () => {
        document.body.classList.toggle("light-theme");
        const icon = themeBtn.querySelector("i");
        if (document.body.classList.contains("light-theme")) {
            icon.className = "fa-solid fa-sun";
        } else {
            icon.className = "fa-solid fa-moon";
        }
        // Redraw charts to update text/border colors
        Object.keys(charts).forEach(key => {
            charts[key].update();
        });
    });
}

// --- API LOADERS ---

async function loadDashboardData() {
    try {
        const res = await fetch(`${API_BASE}/analytics`);
        const stats = await res.json();
        
        document.getElementById("card-total-violations").textContent = stats.total_violations || 0;
        document.getElementById("card-pending-violations").textContent = stats.by_status?.pending || 0;
        
        // Fetch recent violations list
        const histRes = await fetch(`${API_BASE}/violations?limit=5`);
        const histData = await histRes.json();
        renderRecentFeed(histData.data);
        
        // Render simple trend chart
        renderDashboardTrendChart(stats.by_hour || {});
        
    } catch (err) {
        console.error("Error loading dashboard data:", err);
    }
}

async function loadHistoryData(search = "", page = 1) {
    historyPage = page;
    const typeFilter = document.getElementById("filter-violation-type").value;
    const statusFilter = document.getElementById("filter-review-status").value;
    
    let url = `${API_BASE}/violations?page=${page}&limit=${historyLimit}`;
    if (search) url += `&q=${encodeURIComponent(search)}`;
    if (typeFilter) url += `&type=${encodeURIComponent(typeFilter)}`;
    if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
    
    try {
        const res = await fetch(url);
        const result = await res.json();
        
        const tbody = document.getElementById("violations-table-body");
        tbody.innerHTML = "";
        
        if (!result.data || result.data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No violation records found</td></tr>`;
            document.getElementById("pagination-summary").textContent = "Showing 0 to 0 of 0 records";
            document.getElementById("btn-prev-page").disabled = true;
            document.getElementById("btn-next-page").disabled = true;
            return;
        }
        
        result.data.forEach(item => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>#${item.id}</td>
                <td>${formatTimestamp(item.timestamp)}</td>
                <td><span class="badge ${getViolationBadgeClass(item.violation_type)}">${item.violation_type}</span></td>
                <td>${item.vehicle_type.toUpperCase()}</td>
                <td><span class="plate-text-badge">${item.license_plate || 'UNKNOWN'}</span></td>
                <td>${Math.round(item.confidence * 100)}%</td>
                <td><span class="badge ${getStatusBadgeClass(item.status)}">${item.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline btn-view-evidence" data-id="${item.id}">
                        <i class="fa-solid fa-eye"></i> View
                    </button>
                </td>
            `;
            
            // View click action on row or button
            tr.addEventListener("click", (e) => {
                if (!e.target.closest("button")) {
                    openEvidenceModal(item);
                }
            });
            
            tr.querySelector(".btn-view-evidence").addEventListener("click", () => {
                openEvidenceModal(item);
            });
            
            tbody.appendChild(tr);
        });
        
        // Setup pagination buttons
        const pag = result.pagination;
        document.getElementById("pagination-summary").textContent = `Showing ${(page-1)*historyLimit + 1} to ${Math.min(page*historyLimit, pag.total_records)} of ${pag.total_records} records`;
        document.getElementById("current-page-display").textContent = `Page ${page} of ${pag.total_pages}`;
        
        document.getElementById("btn-prev-page").disabled = page <= 1;
        document.getElementById("btn-next-page").disabled = page >= pag.total_pages;
        
    } catch (err) {
        console.error("Error loading history logs:", err);
    }
}

async function loadAnalyticsData() {
    try {
        const res = await fetch(`${API_BASE}/analytics`);
        const stats = await res.json();
        
        // 1. Violation categories pie chart
        renderViolationTypesChart(stats.by_type || {});
        // 2. Peak hourly bar chart
        renderHourlyDensityChart(stats.by_hour || {});
        // 3. Vehicle distribution polar chart
        renderVehicleTypesChart(stats.by_vehicle || {});
        // 4. Resolution doughnut
        renderResolutionChart(stats.by_status || {});
        
    } catch (err) {
        console.error("Error loading analytics data:", err);
    }
}

async function loadSettings() {
    try {
        const res = await fetch(`${API_BASE}/settings`);
        activeSettings = await res.json();
        document.getElementById("settings-light-state").value = activeSettings.traffic_light_state;
        document.getElementById("monitor-light-badge").textContent = activeSettings.traffic_light_state;
        document.getElementById("monitor-light-badge").className = `badge ${activeSettings.traffic_light_state === 'Red' ? 'red' : 'green'}`;
    } catch (err) {
        console.error("Error loading settings:", err);
    }
}

// --- FILE UPLOADS & MONITOR ANALYSIS ---
function setupFileUpload() {
    const fileInput = document.getElementById("file-upload-input");
    const dropZone = document.getElementById("drop-zone");
    const btnSimulate = document.getElementById("btn-run-simulation");
    
    // Clicking dropzone triggers file selector
    dropZone.addEventListener("click", (e) => {
        // Prevent trigger if clicking display images
        if (e.target.closest(".image-display-wrapper")) return;
        fileInput.click();
    });
    
    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            uploadFile(e.target.files[0]);
        }
    });
    
    // Drag & Drop
    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });
    
    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });
    
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            uploadFile(e.dataTransfer.files[0]);
        }
    });
    
    // Simulate scene
    btnSimulate.addEventListener("click", async () => {
        // We load sample_traffic_1 from server, fetch its blob, and run process on it
        document.getElementById("monitor-loading").style.display = "flex";
        try {
            const imgRes = await fetch("/static/sample_traffic_1.jpg");
            const blob = await imgRes.blob();
            const file = new File([blob], "sample_traffic_1.jpg", { type: "image/jpeg" });
            uploadFile(file);
        } catch (err) {
            console.error("Error fetching simulation image:", err);
            document.getElementById("monitor-loading").style.display = "none";
        }
    });
}

async function uploadFile(file) {
    const loading = document.getElementById("monitor-loading");
    loading.style.display = "flex";
    
    const lowLight = document.getElementById("filter-lowlight").checked;
    const dehaze = document.getElementById("filter-dehaze").checked;
    const shadow = document.getElementById("filter-shadow").checked;
    const sharpen = document.getElementById("filter-sharpen").checked;
    
    const formData = new FormData();
    formData.append("file", file);
    
    const queryParams = `?low_light=${lowLight}&dehaze=${dehaze}&shadow=${shadow}&sharpen=${sharpen}`;
    
    try {
        const res = await fetch(`${API_BASE}/process${queryParams}`, {
            method: "POST",
            body: formData
        });
        
        const result = await res.json();
        loading.style.display = "none";
        
        if (result.status === "success") {
            // Render processed image
            document.getElementById("upload-placeholder-view").style.display = "none";
            const wrapper = document.getElementById("image-display-view");
            wrapper.style.display = "flex";
            
            // Prevent cache reload by adding a timestamp
            const preview = document.getElementById("monitor-preview-img");
            preview.src = `${result.annotated_file}?t=${new Date().getTime()}`;
            
            // Render results sidebar
            renderMonitorResults(result);
            
        } else {
            alert(`Error processing frame: ${result.message}`);
        }
    } catch (err) {
        loading.style.display = "none";
        console.error("File upload failed:", err);
        alert("Server connection failed. Make sure FastAPI server is running.");
    }
}

function renderMonitorResults(data) {
    const panel = document.getElementById("monitor-results-panel");
    panel.innerHTML = "";
    
    // 1. Violations Section
    const violDiv = document.createElement("div");
    violDiv.className = "result-section";
    violDiv.innerHTML = `<h4 class="result-section-title"><i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i> Violations Detected</h4>`;
    
    const list = document.createElement("div");
    list.className = "result-card-list";
    
    if (data.violations_detected.length === 0) {
        list.innerHTML = `<div class="result-card" style="color: var(--success); font-weight: 500;">No violations detected in frame</div>`;
    } else {
        data.violations_detected.forEach(v => {
            list.innerHTML += `
                <div class="result-card" style="border-left: 4px solid var(--danger);">
                    <div class="result-card-left">
                        <span class="result-lbl">${v.type}</span>
                        <span class="result-val">Plate: ${v.plate}</span>
                    </div>
                    <div class="result-card-right text-red" style="color: var(--danger); font-family: monospace;">
                        ${Math.round(v.confidence * 100)}%
                    </div>
                </div>
            `;
        });
    }
    violDiv.appendChild(list);
    panel.appendChild(violDiv);
    
    // 2. License Plates OCR section
    const plateDiv = document.createElement("div");
    plateDiv.className = "result-section";
    plateDiv.innerHTML = `<h4 class="result-section-title"><i class="fa-solid fa-rectangle-ad" style="color: var(--success);"></i> OCR Plates Extracted</h4>`;
    
    const pList = document.createElement("div");
    pList.className = "result-card-list";
    
    if (data.license_plates.length === 0) {
        pList.innerHTML = `<div class="result-card">No license plates identified</div>`;
    } else {
        data.license_plates.forEach(p => {
            pList.innerHTML += `
                <div class="result-card">
                    <div class="result-card-left">
                        <span class="plate-text-badge">${p}</span>
                    </div>
                    <span class="badge green">OCR Confirmed</span>
                </div>
            `;
        });
    }
    plateDiv.appendChild(pList);
    panel.appendChild(plateDiv);
}

// --- EVALUATION CONTROLLER ---
document.getElementById("eval-samples-slider").addEventListener("input", (e) => {
    document.getElementById("eval-samples-val").textContent = e.target.value;
});

document.getElementById("btn-run-evaluation").addEventListener("click", async () => {
    const samples = document.getElementById("eval-samples-slider").value;
    const runBtn = document.getElementById("btn-run-evaluation");
    runBtn.disabled = true;
    runBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Running Suite...`;
    
    try {
        const res = await fetch(`${API_BASE}/evaluation?samples=${samples}`);
        const metrics = await res.json();
        
        runBtn.disabled = false;
        runBtn.innerHTML = `<i class="fa-solid fa-circle-play"></i> Run Validation Suite`;
        
        if (metrics.status === "success") {
            // Update metric values
            document.getElementById("eval-precision").textContent = `${(metrics.precision * 100).toFixed(1)}%`;
            document.getElementById("eval-recall").textContent = `${(metrics.recall * 100).toFixed(1)}%`;
            document.getElementById("eval-f1").textContent = `${(metrics.f1_score * 100).toFixed(1)}%`;
            document.getElementById("eval-map").textContent = `${(metrics.mAP_50 * 100).toFixed(1)}%`;
            
            // Update matrix cells
            document.getElementById("matrix-tp").textContent = metrics.true_positives;
            document.getElementById("matrix-fp").textContent = metrics.false_positives;
            document.getElementById("matrix-fn").textContent = metrics.false_negatives;
            
        } else {
            alert(`Evaluation error: ${metrics.message}`);
        }
        
    } catch (err) {
        runBtn.disabled = false;
        runBtn.innerHTML = `<i class="fa-solid fa-circle-play"></i> Run Validation Suite`;
        console.error("Evaluation failed:", err);
        alert("Could not load validation. Verify the test set dataset path exists in data/test folder.");
    }
});

// --- SETTINGS CANVAS & INTERACTIVE DRAWING ---
function setupCanvasControls() {
    const tools = document.querySelectorAll("[data-tool]");
    tools.forEach(t => {
        t.addEventListener("click", () => {
            tools.forEach(i => i.classList.remove("active"));
            t.classList.add("active");
            activeTool = t.getAttribute("data-tool");
            
            const instr = document.getElementById("tool-instruction-text");
            if (activeTool === "stop_line") {
                instr.innerHTML = "Draw Stop Line: Click to place start point, drag, and release to set the enforcement boundary line.";
            } else {
                instr.innerHTML = "Draw No Parking Zone: Click multiple coordinates on the image to lay down a polygon. Click close to your first point to complete the shape.";
            }
        });
    });
    
    // Light toggle simulation
    document.getElementById("settings-light-state").addEventListener("change", (e) => {
        activeSettings.traffic_light_state = e.target.value;
        drawSettingsCanvas();
    });
    
    // Save Settings
    document.getElementById("btn-save-settings").addEventListener("click", async () => {
        const payload = {
            stop_line: activeSettings.stop_line,
            traffic_light_zone: activeSettings.traffic_light_zone,
            no_parking_zone: activeSettings.no_parking_zone,
            traffic_light_state: activeSettings.traffic_light_state,
            lane_directions: activeSettings.lane_directions
        };
        
        try {
            const res = await fetch(`${API_BASE}/settings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            if (result.status === "success") {
                alert("Junction configuration settings saved successfully!");
                loadSettings(); // Reload
            }
        } catch (err) {
            console.error("Save settings failed:", err);
            alert("Error saving settings.");
        }
    });
}

function initSettingsCanvas() {
    canvas = document.getElementById("settings-canvas");
    ctx = canvas.getContext("2d");
    
    // Setup drawing mouse handlers
    canvas.removeEventListener("mousedown", handleCanvasMouseDown);
    canvas.removeEventListener("mousemove", handleCanvasMouseMove);
    canvas.removeEventListener("mouseup", handleCanvasMouseUp);
    
    canvas.addEventListener("mousedown", handleCanvasMouseDown);
    canvas.addEventListener("mousemove", handleCanvasMouseMove);
    canvas.addEventListener("mouseup", handleCanvasMouseUp);
    
    drawSettingsCanvas();
}

function drawSettingsCanvas() {
    // Draw synthetic traffic background inside settings editor
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw simplified grid representing streets
    ctx.fillStyle = "#64748b";
    ctx.fillRect(100, 0, 600, 600); // Main road
    
    // Lanes
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.setLineDash([15, 15]);
    ctx.moveTo(400, 0);
    ctx.lineTo(400, 600);
    ctx.stroke();
    ctx.setLineDash([]); // Reset
    
    // Draw calibrated stop line
    if (activeSettings.stop_line) {
        ctx.strokeStyle = activeSettings.traffic_light_state === "Red" ? "#ef4444" : "#10b981";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(activeSettings.stop_line.start[0], activeSettings.stop_line.start[1]);
        ctx.lineTo(activeSettings.stop_line.end[0], activeSettings.stop_line.end[1]);
        ctx.stroke();
        ctx.fillStyle = activeSettings.traffic_light_state === "Red" ? "#ef4444" : "#10b981";
        ctx.font = "bold 14px Outfit";
        ctx.fillText("STOP LINE ENFORCEMENT", activeSettings.stop_line.start[0] + 10, activeSettings.stop_line.start[1] - 10);
    }
    
    // Draw temporary stop line if dragging
    if (isDrawingLine && stopLineTemp.start && stopLineTemp.end) {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(stopLineTemp.start[0], stopLineTemp.start[1]);
        ctx.lineTo(stopLineTemp.end[0], stopLineTemp.end[1]);
        ctx.stroke();
    }
    
    // Draw calibrated parking zone
    if (activeSettings.no_parking_zone && activeSettings.no_parking_zone.length > 0) {
        ctx.fillStyle = "rgba(245, 158, 11, 0.25)";
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(activeSettings.no_parking_zone[0][0], activeSettings.no_parking_zone[0][1]);
        for (let i = 1; i < activeSettings.no_parking_zone.length; i++) {
            ctx.lineTo(activeSettings.no_parking_zone[i][0], activeSettings.no_parking_zone[i][1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 14px Outfit";
        ctx.fillText("NO PARKING ZONE", activeSettings.no_parking_zone[0][0] + 10, activeSettings.no_parking_zone[0][1] + 25);
    }
    
    // Draw temporary no parking points
    if (activeTool === "no_parking" && noParkingPoints.length > 0) {
        ctx.fillStyle = "#f59e0b";
        noParkingPoints.forEach(p => {
            ctx.beginPath();
            ctx.circle = ctx.arc(p[0], p[1], 5, 0, 2*Math.PI);
            ctx.fill();
        });
        
        if (noParkingPoints.length > 1) {
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(noParkingPoints[0][0], noParkingPoints[0][1]);
            for (let i = 1; i < noParkingPoints.length; i++) {
                ctx.lineTo(noParkingPoints[i][0], noParkingPoints[i][1]);
            }
            ctx.stroke();
        }
    }
}

function handleCanvasMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    
    if (activeTool === "stop_line") {
        isDrawingLine = true;
        stopLineTemp.start = [x, y];
        stopLineTemp.end = [x, y];
    } else if (activeTool === "no_parking") {
        // If clicking close to the first point, close polygon
        if (noParkingPoints.length > 2) {
            const dx = x - noParkingPoints[0][0];
            const dy = y - noParkingPoints[0][1];
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 15) {
                activeSettings.no_parking_zone = [...noParkingPoints];
                noParkingPoints = [];
                drawSettingsCanvas();
                return;
            }
        }
        noParkingPoints.push([x, y]);
        drawSettingsCanvas();
    }
}

function handleCanvasMouseMove(e) {
    if (!isDrawingLine) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    
    if (activeTool === "stop_line") {
        stopLineTemp.end = [x, y];
        drawSettingsCanvas();
    }
}

function handleCanvasMouseUp() {
    if (activeTool === "stop_line" && isDrawingLine) {
        isDrawingLine = false;
        activeSettings.stop_line = {
            start: stopLineTemp.start,
            end: stopLineTemp.end
        };
        drawSettingsCanvas();
    }
}

// --- HISTORY LOGS FILTERING & CSV EXPORT ---
function setupHistoryFilters() {
    const search = document.getElementById("filter-search-input");
    const vtype = document.getElementById("filter-violation-type");
    const status = document.getElementById("filter-review-status");
    
    const triggerSearch = () => {
        loadHistoryData(search.value, 1);
    };
    
    search.addEventListener("input", debounce(triggerSearch, 300));
    vtype.addEventListener("change", triggerSearch);
    status.addEventListener("change", triggerSearch);
    
    // Pagination Next/Prev
    document.getElementById("btn-prev-page").addEventListener("click", () => {
        if (historyPage > 1) {
            loadHistoryData(search.value, historyPage - 1);
        }
    });
    
    document.getElementById("btn-next-page").addEventListener("click", () => {
        loadHistoryData(search.value, historyPage + 1);
    });
    
    // Export CSV
    document.getElementById("btn-export-csv").addEventListener("click", async () => {
        // Fetch ALL violations (up to 200) for export
        try {
            const res = await fetch(`${API_BASE}/violations?limit=200`);
            const result = await res.json();
            
            let csv = "ID,Timestamp,Violation Type,Vehicle Type,License Plate,Confidence,Status\n";
            result.data.forEach(row => {
                csv += `${row.id},"${row.timestamp}","${row.violation_type}","${row.vehicle_type}","${row.license_plate}",${row.confidence},"${row.status}"\n`;
            });
            
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.setAttribute("download", `apic_traffic_violations_export.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
        } catch (err) {
            console.error("Export CSV failed:", err);
        }
    });
}

// --- EVIDENCE MODAL ACTION ---
let currentActiveModalId = null;

function setupModalHandlers() {
    document.getElementById("btn-close-modal").addEventListener("click", () => {
        document.getElementById("violation-modal").style.display = "none";
    });
    
    document.getElementById("btn-modal-approve").addEventListener("click", () => {
        updateViolationReviewStatus(currentActiveModalId, "approved");
    });
    
    document.getElementById("btn-modal-reject").addEventListener("click", () => {
        updateViolationReviewStatus(currentActiveModalId, "rejected");
    });
}

function openEvidenceModal(item) {
    currentActiveModalId = item.id;
    
    document.getElementById("modal-violation-id").textContent = item.id;
    document.getElementById("modal-timestamp").textContent = formatTimestamp(item.timestamp);
    document.getElementById("modal-type").textContent = item.violation_type;
    document.getElementById("modal-vehicle").textContent = item.vehicle_type.toUpperCase();
    document.getElementById("modal-plate").textContent = item.license_plate || 'UNKNOWN';
    document.getElementById("modal-confidence").textContent = `${Math.round(item.confidence * 100)}%`;
    
    // Set image paths
    const origUrl = item.image_path;
    const annUrl = item.annotated_image_path;
    
    document.getElementById("modal-original-img").src = origUrl;
    document.getElementById("modal-annotated-img").src = annUrl;
    
    // Open overlay
    document.getElementById("violation-modal").style.display = "flex";
}

async function updateViolationReviewStatus(id, status) {
    try {
        const res = await fetch(`${API_BASE}/violations/${id}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: status })
        });
        
        const result = await res.json();
        if (result.status === "success") {
            document.getElementById("violation-modal").style.display = "none";
            // Refresh whichever view we are on
            if (currentTab === "dashboard") loadDashboardData();
            else if (currentTab === "history") loadHistoryData(document.getElementById("filter-search-input").value, historyPage);
        }
    } catch (err) {
        console.error("Update status failed:", err);
    }
}

// --- CHART RENDERING (CHART.JS) ---

function renderDashboardTrendChart(hourlyData) {
    const canvas = document.getElementById("dashboard-trend-chart");
    if (!canvas) return;
    
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    const data = labels.map((_, idx) => hourlyData[String(idx).padStart(2, '0')] || 0);
    
    if (charts["dashboard-trend"]) {
        charts["dashboard-trend"].data.datasets[0].data = data;
        charts["dashboard-trend"].update();
        return;
    }
    
    const isDark = !document.body.classList.contains("light-theme");
    
    charts["dashboard-trend"] = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Violations Frequency',
                data: data,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
                    ticks: { color: isDark ? '#9ca3af' : '#64748b', font: { family: 'Outfit' } }
                },
                y: {
                    grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
                    ticks: { color: isDark ? '#9ca3af' : '#64748b', font: { family: 'Outfit' } }
                }
            }
        }
    });
}

function renderViolationTypesChart(typeData) {
    const canvas = document.getElementById("chart-violation-types");
    if (!canvas) return;
    
    const labels = Object.keys(typeData);
    const data = Object.values(typeData);
    
    if (charts["types"]) {
        charts["types"].data.labels = labels;
        charts["types"].data.datasets[0].data = data;
        charts["types"].update();
        return;
    }
    
    charts["types"] = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: document.body.classList.contains("light-theme") ? '#1e293b' : '#f3f4f6', font: { family: 'Outfit' } }
                }
            }
        }
    });
}

function renderHourlyDensityChart(hourlyData) {
    const canvas = document.getElementById("chart-hourly-density");
    if (!canvas) return;
    
    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const data = labels.map((_, idx) => hourlyData[String(idx).padStart(2, '0')] || 0);
    
    if (charts["hourly"]) {
        charts["hourly"].data.datasets[0].data = data;
        charts["hourly"].update();
        return;
    }
    
    charts["hourly"] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Violations Logged',
                data: data,
                backgroundColor: '#8b5cf6',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#9ca3af', font: { family: 'Outfit' } } },
                y: { ticks: { color: '#9ca3af', font: { family: 'Outfit' } } }
            }
        }
    });
}

function renderVehicleTypesChart(vehicleData) {
    const canvas = document.getElementById("chart-vehicle-types");
    if (!canvas) return;
    
    const labels = Object.keys(vehicleData).map(x => x.toUpperCase());
    const data = Object.values(vehicleData);
    
    if (charts["vehicles"]) {
        charts["vehicles"].data.labels = labels;
        charts["vehicles"].data.datasets[0].data = data;
        charts["vehicles"].update();
        return;
    }
    
    charts["vehicles"] = new Chart(canvas, {
        type: 'polarArea',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['rgba(59, 130, 246, 0.5)', 'rgba(139, 92, 246, 0.5)', 'rgba(16, 185, 129, 0.5)', 'rgba(239, 68, 68, 0.5)'],
                borderColor: '#1e293b',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#9ca3af', font: { family: 'Outfit' } } }
            }
        }
    });
}

function renderResolutionChart(statusData) {
    const canvas = document.getElementById("chart-resolution-rates");
    if (!canvas) return;
    
    const labels = ["Approved", "Pending", "Rejected"];
    const data = [statusData.approved || 0, statusData.pending || 0, statusData.rejected || 0];
    
    if (charts["resolution"]) {
        charts["resolution"].data.datasets[0].data = data;
        charts["resolution"].update();
        return;
    }
    
    charts["resolution"] = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#9ca3af', font: { family: 'Outfit' } } }
            }
        }
    });
}

function renderRecentFeed(items) {
    const feed = document.getElementById("dashboard-recent-feed");
    feed.innerHTML = "";
    
    if (items.length === 0) {
        feed.innerHTML = `
            <div class="feed-placeholder">
                <i class="fa-solid fa-satellite-dish"></i>
                <p>No recent alerts available</p>
            </div>
        `;
        return;
    }
    
    items.forEach(item => {
        const div = document.createElement("div");
        div.className = "feed-item";
        
        let color = "red";
        let icon = "fa-circle-exclamation";
        if (item.violation_type.includes("Parking") || item.violation_type.includes("Seatbelt")) {
            color = "orange";
            icon = "fa-triangle-exclamation";
        }
        
        div.innerHTML = `
            <div class="feed-icon ${color}">
                <i class="fa-solid ${icon}"></i>
            </div>
            <div class="feed-details">
                <p class="feed-title">${item.violation_type}</p>
                <p class="feed-time">${formatTimestamp(item.timestamp)}</p>
            </div>
            <span class="feed-plate">${item.license_plate || 'UNKNOWN'}</span>
        `;
        
        div.addEventListener("click", () => {
            openEvidenceModal(item);
        });
        
        feed.appendChild(div);
    });
}

// --- UTILITY METHODS ---

function formatTimestamp(isoStr) {
    if (!isoStr) return "-";
    const d = new Date(isoStr);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function getViolationBadgeClass(vtype) {
    if (vtype.includes("Red-light") || vtype.includes("Wrong-side")) return "red";
    if (vtype.includes("Triple") || vtype.includes("Helmet")) return "orange";
    return "orange";
}

function getStatusBadgeClass(status) {
    if (status === "approved") return "green";
    if (status === "rejected") return "red";
    return "orange";
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
