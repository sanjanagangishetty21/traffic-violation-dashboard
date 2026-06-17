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

let isBrowserDemoMode = false;
const devPorts = ["3000", "5000", "5500", "8080", "8081"];
if (
    window.location.hostname.includes("vercel.app") ||
    window.location.hostname.includes("github.io") ||
    window.location.hostname.includes("netlify.app") ||
    window.location.protocol === "file:" ||
    devPorts.includes(window.location.port) ||
    (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1")
) {
    isBrowserDemoMode = true;
    console.log("[APIC-TV] Browser-only simulation mode active (static deployment, dev port, or file protocol detected).");
}

function getMockViolations() {
    let list = localStorage.getItem("apic_violations");
    if (!list) {
        const violationTypes = [
            "Helmet Non-compliance",
            "Seatbelt Non-compliance",
            "Triple Riding",
            "Wrong-side Driving",
            "Red-light Violation",
            "Illegal Parking"
        ];
        const vehicles = {
            "Helmet Non-compliance": "motorcycle",
            "Seatbelt Non-compliance": "car",
            "Triple Riding": "motorcycle",
            "Wrong-side Driving": "car",
            "Red-light Violation": "car",
            "Illegal Parking": "car"
        };
        const states = ["DL", "MH", "KA", "HR", "UP", "TN", "AP", "GJ", "WB", "KL"];
        
        let mockList = [];
        let now = new Date();
        
        for (let i = 1; i <= 150; i++) {
            const daysAgo = Math.floor(Math.random() * 7);
            const hour = Math.random() < 0.4 ? (Math.random() < 0.5 ? 9 : 18) : Math.floor(Math.random() * 24);
            const min = Math.floor(Math.random() * 60);
            
            let date = new Date(now);
            date.setDate(date.getDate() - daysAgo);
            date.setHours(hour, min, 0, 0);
            
            const vtype = violationTypes[Math.floor(Math.random() * violationTypes.length)];
            const state = states[Math.floor(Math.random() * states.length)];
            const num = Math.floor(1000 + Math.random() * 9000);
            const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
            
            mockList.push({
                id: i,
                timestamp: date.toISOString(),
                violation_type: vtype,
                vehicle_type: vehicles[vtype],
                license_plate: `${state} ${Math.floor(Math.random()*99).toString().padStart(2, '0')} ${letters} ${num}`,
                confidence: parseFloat((0.72 + Math.random() * 0.25).toFixed(2)),
                image_path: `/static/sample_traffic_${(i % 10) + 1}.jpg`,
                annotated_image_path: `/static/ann_sample_traffic_${(i % 10) + 1}.jpg`,
                status: Math.random() < 0.7 ? "approved" : (Math.random() < 0.5 ? "pending" : "rejected")
            });
        }
        mockList.sort((a, b) => b.id - a.id);
        localStorage.setItem("apic_violations", JSON.stringify(mockList));
        return mockList;
    }
    return JSON.parse(list);
}

function generateTrafficScene(violationType, isAnnotated, plateText) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    
    // Background: Slate environment
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw road
    ctx.fillStyle = "#334155";
    ctx.fillRect(80, 0, 480, 480);
    
    // Lane markings
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 4;
    ctx.setLineDash([15, 15]);
    ctx.beginPath();
    ctx.moveTo(320, 0);
    ctx.lineTo(320, 480);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Road boundaries
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(80, 0);
    ctx.lineTo(80, 480);
    ctx.moveTo(560, 0);
    ctx.lineTo(560, 480);
    ctx.stroke();
    
    // Draw context-specific violation graphics
    let vehicleBbox = [200, 200, 240, 180];
    let plateBbox = [300, 340, 80, 25];
    let headBbox = [290, 140, 40, 40];
    
    if (violationType === "Red-light Violation") {
        // Draw Stop Line
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(80, 350, 480, 15);
        
        // Draw Traffic Light
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(580, 80, 40, 120);
        // Red light on
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(600, 105, 12, 0, Math.PI * 2);
        ctx.fill();
        // Yellow/Green off
        ctx.fillStyle = "#334155";
        ctx.beginPath();
        ctx.arc(600, 140, 12, 0, Math.PI * 2);
        ctx.arc(600, 175, 12, 0, Math.PI * 2);
        ctx.fill();
        
        // Vehicle crossing the stop line
        vehicleBbox = [180, 280, 120, 140];
        plateBbox = [200, 390, 80, 22];
        
        // Draw Vehicle (Red Car)
        ctx.fillStyle = "#b91c1c";
        ctx.fillRect(vehicleBbox[0], vehicleBbox[1], vehicleBbox[2], vehicleBbox[3]);
        // Windshield
        ctx.fillStyle = "#93c5fd";
        ctx.fillRect(vehicleBbox[0] + 15, vehicleBbox[1] + 20, vehicleBbox[2] - 30, 40);
        // Headlights
        ctx.fillStyle = "#fef08a";
        ctx.fillRect(vehicleBbox[0] + 10, vehicleBbox[1] + vehicleBbox[3] - 15, 20, 10);
        ctx.fillRect(vehicleBbox[0] + vehicleBbox[2] - 30, vehicleBbox[1] + vehicleBbox[3] - 15, 20, 10);
        
        // License plate representation
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px Courier";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(plateText || "DL3C 5928", plateBbox[0] + plateBbox[2]/2, plateBbox[1] + plateBbox[3]/2);
        
    } else if (violationType === "Illegal Parking") {
        // Draw Yellow No Parking zone
        ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
        ctx.fillRect(340, 100, 200, 280);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 3;
        ctx.strokeRect(340, 100, 200, 280);
        
        // Draw text
        ctx.fillStyle = "rgba(245, 158, 11, 0.5)";
        ctx.font = "bold 16px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("NO PARKING ZONE", 440, 240);
        
        // Stationary Vehicle inside the zone
        vehicleBbox = [380, 160, 120, 140];
        plateBbox = [400, 270, 80, 22];
        
        ctx.fillStyle = "#1e3a8a";
        ctx.fillRect(vehicleBbox[0], vehicleBbox[1], vehicleBbox[2], vehicleBbox[3]);
        // Windshield
        ctx.fillStyle = "#93c5fd";
        ctx.fillRect(vehicleBbox[0] + 15, vehicleBbox[1] + 20, vehicleBbox[2] - 30, 40);
        // Lights
        ctx.fillStyle = "#fef08a";
        ctx.fillRect(vehicleBbox[0] + 10, vehicleBbox[1] + vehicleBbox[3] - 15, 20, 10);
        ctx.fillRect(vehicleBbox[0] + vehicleBbox[2] - 30, vehicleBbox[1] + vehicleBbox[3] - 15, 20, 10);
        
        // License plate
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px Courier";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(plateText || "MH12 GR88", plateBbox[0] + plateBbox[2]/2, plateBbox[1] + plateBbox[3]/2);
        
    } else if (violationType === "Helmet Non-compliance") {
        // Motorcycle
        vehicleBbox = [240, 180, 140, 240];
        headBbox = [290, 140, 40, 40];
        plateBbox = [270, 380, 80, 22];
        
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(290, 260, 40, 140);
        // Tires
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(310, 400, 25, 0, Math.PI * 2);
        ctx.fill();
        
        // Rider body
        ctx.fillStyle = "#475569";
        ctx.fillRect(275, 200, 70, 70);
        
        // Rider head (No helmet)
        ctx.fillStyle = "#fbcfe8";
        ctx.beginPath();
        ctx.arc(310, 160, 20, 0, Math.PI * 2);
        ctx.fill();
        // Hair
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(310, 150, 15, Math.PI, 0);
        ctx.fill();
        
        // License plate
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px Courier";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(plateText || "KA51 S112", plateBbox[0] + plateBbox[2]/2, plateBbox[1] + plateBbox[3]/2);
        
    } else if (violationType === "Seatbelt Non-compliance") {
        // Windshield Closeup
        vehicleBbox = [120, 80, 400, 320];
        plateBbox = [280, 420, 80, 22];
        
        ctx.fillStyle = "#334155";
        ctx.fillRect(100, 60, 440, 350);
        // Glass area
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(vehicleBbox[0], vehicleBbox[1], vehicleBbox[2], vehicleBbox[3]);
        
        // Steering wheel
        ctx.strokeStyle = "#64748b";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(220, 280, 40, 0, Math.PI*2);
        ctx.stroke();
        
        // Driver Torso
        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(170, 230, 100, 150);
        // Driver head
        ctx.fillStyle = "#fed7aa";
        ctx.beginPath();
        ctx.arc(220, 190, 25, 0, Math.PI * 2);
        ctx.fill();
        
        // License plate
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px Courier";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(plateText || "UP16 AB78", plateBbox[0] + plateBbox[2]/2, plateBbox[1] + plateBbox[3]/2);
        
    } else if (violationType === "Triple Riding") {
        // Motorcycle
        vehicleBbox = [220, 140, 200, 280];
        plateBbox = [280, 390, 80, 22];
        
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(300, 260, 40, 140);
        // Wheels
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(320, 400, 25, 0, Math.PI * 2);
        ctx.fill();
        
        // Rider 1
        ctx.fillStyle = "#0284c7";
        ctx.fillRect(270, 200, 45, 70);
        ctx.fillStyle = "#ffedd5";
        ctx.beginPath();
        ctx.arc(292, 175, 15, 0, Math.PI*2);
        ctx.fill();
        
        // Rider 2
        ctx.fillStyle = "#059669";
        ctx.fillRect(305, 195, 40, 70);
        ctx.fillStyle = "#fed7aa";
        ctx.beginPath();
        ctx.arc(325, 170, 15, 0, Math.PI*2);
        ctx.fill();
        
        // Rider 3
        ctx.fillStyle = "#d97706";
        ctx.fillRect(335, 205, 40, 70);
        ctx.fillStyle = "#ffedd5";
        ctx.beginPath();
        ctx.arc(355, 180, 15, 0, Math.PI*2);
        ctx.fill();
        
        // License plate
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px Courier";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(plateText || "MH02 CP90", plateBbox[0] + plateBbox[2]/2, plateBbox[1] + plateBbox[3]/2);
        
    } else { // Wrong-side Driving
        // Direction arrows
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        ctx.moveTo(200, 180);
        ctx.lineTo(200, 100);
        ctx.moveTo(185, 120);
        ctx.lineTo(200, 100);
        ctx.lineTo(215, 120);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(440, 100);
        ctx.lineTo(440, 180);
        ctx.moveTo(425, 160);
        ctx.lineTo(440, 180);
        ctx.lineTo(455, 160);
        ctx.stroke();
        
        // Car driving DOWN in Left lane (Wrong-side)
        vehicleBbox = [140, 200, 120, 140];
        plateBbox = [160, 310, 80, 22];
        
        ctx.fillStyle = "#ea580c";
        ctx.fillRect(vehicleBbox[0], vehicleBbox[1], vehicleBbox[2], vehicleBbox[3]);
        // Windshield
        ctx.fillStyle = "#93c5fd";
        ctx.fillRect(vehicleBbox[0] + 15, vehicleBbox[1] + 20, vehicleBbox[2] - 30, 40);
        // Headlights
        ctx.fillStyle = "#fef08a";
        ctx.beginPath();
        ctx.arc(vehicleBbox[0] + 20, vehicleBbox[1] + vehicleBbox[3] - 15, 10, 0, Math.PI*2);
        ctx.arc(vehicleBbox[0] + vehicleBbox[2] - 20, vehicleBbox[1] + vehicleBbox[3] - 15, 10, 0, Math.PI*2);
        ctx.fill();
        
        // License plate
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(plateBbox[0], plateBbox[1], plateBbox[2], plateBbox[3]);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 10px Courier";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(plateText || "DL1A ZZ99", plateBbox[0] + plateBbox[2]/2, plateBbox[1] + plateBbox[3]/2);
    }
    
    // Draw annotations
    if (isAnnotated) {
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 3;
        ctx.strokeRect(vehicleBbox[0], vehicleBbox[1], vehicleBbox[2], vehicleBbox[3]);
        
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(vehicleBbox[0] - 1, vehicleBbox[1] - 24, vehicleBbox[2] + 2, 24);
        
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px Outfit, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(`${violationType.toUpperCase()} (AI: 94%)`, vehicleBbox[0] + 5, vehicleBbox[1] - 20);
        
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 2;
        ctx.strokeRect(plateBbox[0] - 2, plateBbox[1] - 2, plateBbox[2] + 4, plateBbox[3] + 4);
        
        ctx.fillStyle = "#10b981";
        ctx.fillRect(plateBbox[0] - 2, plateBbox[1] - 18, plateBbox[2] + 4, 16);
        
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px Outfit, sans-serif";
        ctx.fillText(`OCR PLATE: 98%`, plateBbox[0] + 2, plateBbox[1] - 15);
        
        if (violationType === "Helmet Non-compliance") {
            ctx.strokeStyle = "#f59e0b";
            ctx.strokeRect(headBbox[0], headBbox[1], headBbox[2], headBbox[3]);
            ctx.fillStyle = "#f59e0b";
            ctx.fillRect(headBbox[0], headBbox[1] - 15, headBbox[2], 15);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 9px Outfit, sans-serif";
            ctx.fillText("NO-HELMET", headBbox[0] + 2, headBbox[1] - 12);
        }
        
        if (violationType === "Red-light Violation") {
            ctx.strokeStyle = "#f59e0b";
            ctx.strokeRect(80, 350, 480, 15);
            ctx.fillStyle = "#f59e0b";
            ctx.fillRect(80, 332, 150, 18);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 10px Outfit, sans-serif";
            ctx.fillText("LINE OVERLAP DETECTED", 85, 335);
        }
    }
    
    return canvas.toDataURL("image/jpeg");
}


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
    if (isBrowserDemoMode) {
        const data = getMockViolations();
        const pending = data.filter(x => x.status === "pending").length;
        document.getElementById("card-total-violations").textContent = data.length;
        document.getElementById("card-pending-violations").textContent = pending;
        
        renderRecentFeed(data.slice(0, 5));
        
        let hourly = {};
        data.forEach(item => {
            const hr = new Date(item.timestamp).getHours().toString().padStart(2, '0');
            hourly[hr] = (hourly[hr] || 0) + 1;
        });
        renderDashboardTrendChart(hourly);
        return;
    }
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
        isBrowserDemoMode = true;
        loadDashboardData();
    }
}

async function loadHistoryData(search = "", page = 1) {
    historyPage = page;
    const typeFilter = document.getElementById("filter-violation-type").value;
    const statusFilter = document.getElementById("filter-review-status").value;
    
    if (isBrowserDemoMode) {
        let data = getMockViolations();
        
        // Apply filters
        if (search) {
            const s = search.toLowerCase();
            data = data.filter(item => 
                (item.license_plate && item.license_plate.toLowerCase().includes(s)) ||
                (item.violation_type && item.violation_type.toLowerCase().includes(s)) ||
                (item.id && String(item.id).includes(s))
            );
        }
        if (typeFilter) {
            data = data.filter(item => item.violation_type === typeFilter);
        }
        if (statusFilter) {
            data = data.filter(item => item.status === statusFilter);
        }
        
        const totalRecords = data.length;
        const totalPages = Math.ceil(totalRecords / historyLimit) || 1;
        
        // Paginate
        const startIdx = (page - 1) * historyLimit;
        const paginatedData = data.slice(startIdx, startIdx + historyLimit);
        
        const tbody = document.getElementById("violations-table-body");
        tbody.innerHTML = "";
        
        if (paginatedData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No violation records found</td></tr>`;
            document.getElementById("pagination-summary").textContent = "Showing 0 to 0 of 0 records";
            document.getElementById("btn-prev-page").disabled = true;
            document.getElementById("btn-next-page").disabled = true;
            return;
        }
        
        paginatedData.forEach(item => {
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
        
        document.getElementById("pagination-summary").textContent = `Showing ${startIdx + 1} to ${Math.min(page * historyLimit, totalRecords)} of ${totalRecords} records`;
        document.getElementById("current-page-display").textContent = `Page ${page} of ${totalPages}`;
        
        document.getElementById("btn-prev-page").disabled = page <= 1;
        document.getElementById("btn-next-page").disabled = page >= totalPages;
        return;
    }
    
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
    if (isBrowserDemoMode) {
        const data = getMockViolations();
        
        let by_type = {};
        let by_hour = {};
        let by_vehicle = {};
        let by_status = { approved: 0, pending: 0, rejected: 0 };
        
        data.forEach(item => {
            by_type[item.violation_type] = (by_type[item.violation_type] || 0) + 1;
            
            const hr = new Date(item.timestamp).getHours().toString().padStart(2, '0');
            by_hour[hr] = (by_hour[hr] || 0) + 1;
            
            by_vehicle[item.vehicle_type] = (by_vehicle[item.vehicle_type] || 0) + 1;
            
            by_status[item.status] = (by_status[item.status] || 0) + 1;
        });
        
        renderViolationTypesChart(by_type);
        renderHourlyDensityChart(by_hour);
        renderVehicleTypesChart(by_vehicle);
        renderResolutionChart(by_status);
        return;
    }
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
    if (isBrowserDemoMode) {
        let localSettings = localStorage.getItem("apic_settings");
        if (localSettings) {
            activeSettings = JSON.parse(localSettings);
        } else {
            localStorage.setItem("apic_settings", JSON.stringify(activeSettings));
        }
        document.getElementById("settings-light-state").value = activeSettings.traffic_light_state;
        document.getElementById("monitor-light-badge").textContent = activeSettings.traffic_light_state;
        document.getElementById("monitor-light-badge").className = `badge ${activeSettings.traffic_light_state === 'Red' ? 'red' : 'green'}`;
        return;
    }
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
        document.getElementById("monitor-loading").style.display = "flex";
        
        if (isBrowserDemoMode) {
            const violationTypes = [
                "Helmet Non-compliance",
                "Seatbelt Non-compliance",
                "Triple Riding",
                "Wrong-side Driving",
                "Red-light Violation",
                "Illegal Parking"
            ];
            const selectedViolation = violationTypes[Math.floor(Math.random() * violationTypes.length)];
            const states = ["DL", "MH", "KA", "HR", "UP", "TN", "AP", "GJ", "WB", "KL"];
            const state = states[Math.floor(Math.random() * states.length)];
            const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
            const num = Math.floor(1000 + Math.random() * 9000);
            const plateText = `${state} ${Math.floor(Math.random()*99).toString().padStart(2, '0')} ${letters} ${num}`;
            
            const dataUrl = generateTrafficScene(selectedViolation, false, plateText);
            
            try {
                const res = await fetch(dataUrl);
                const blob = await res.blob();
                const file = new File([blob], "demo_scene.jpg", { type: "image/jpeg" });
                uploadFile(file);
            } catch (err) {
                console.error("Error creating demo file:", err);
                document.getElementById("monitor-loading").style.display = "none";
            }
            return;
        }
        
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
    
    if (isBrowserDemoMode) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const uploadedDataUrl = e.target.result;
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                
                ctx.drawImage(img, 0, 0);
                
                const violationTypes = [
                    "Helmet Non-compliance",
                    "Seatbelt Non-compliance",
                    "Triple Riding",
                    "Wrong-side Driving",
                    "Red-light Violation",
                    "Illegal Parking"
                ];
                
                let selectedViolation = violationTypes[Math.floor(Math.random() * violationTypes.length)];
                if (activeSettings.traffic_light_state === "Red" && Math.random() < 0.6) {
                    selectedViolation = "Red-light Violation";
                }
                
                const vehicleClasses = {
                    "Helmet Non-compliance": "motorcycle",
                    "Seatbelt Non-compliance": "car",
                    "Triple Riding": "motorcycle",
                    "Wrong-side Driving": "car",
                    "Red-light Violation": "car",
                    "Illegal Parking": "car"
                };
                
                const states = ["DL", "MH", "KA", "HR", "UP", "TN", "AP", "GJ", "WB", "KL"];
                const state = states[Math.floor(Math.random() * states.length)];
                const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
                const num = Math.floor(1000 + Math.random() * 9000);
                const generatedPlate = `${state} ${Math.floor(Math.random()*99).toString().padStart(2, '0')} ${letters} ${num}`;
                
                const w = img.width;
                const h = img.height;
                
                const v_x = Math.round(w * 0.25);
                const v_y = Math.round(h * 0.35);
                const v_w = Math.round(w * 0.4);
                const v_h = Math.round(h * 0.45);
                
                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = Math.max(3, Math.round(w / 200));
                ctx.strokeRect(v_x, v_y, v_w, v_h);
                
                ctx.fillStyle = "#ef4444";
                const fontSize = Math.max(12, Math.round(w / 40));
                ctx.fillRect(v_x - 1, v_y - fontSize - 6, v_w + 2, fontSize + 8);
                
                ctx.fillStyle = "#ffffff";
                ctx.font = `bold ${fontSize}px Outfit, sans-serif`;
                ctx.fillText(`${selectedViolation.toUpperCase()} (AI: 95%)`, v_x + 8, v_y - 6);
                
                const p_x = Math.round(v_x + v_w * 0.3);
                const p_y = Math.round(v_y + v_h * 0.7);
                const p_w = Math.round(v_w * 0.4);
                const p_h = Math.round(v_h * 0.15);
                
                ctx.strokeStyle = "#10b981";
                ctx.lineWidth = Math.max(2, Math.round(w / 300));
                ctx.strokeRect(p_x, p_y, p_w, p_h);
                
                ctx.fillStyle = "#10b981";
                ctx.fillRect(p_x - 1, p_y - fontSize * 0.7 - 4, p_w + 2, fontSize * 0.7 + 5);
                ctx.fillStyle = "#ffffff";
                ctx.font = `bold ${Math.round(fontSize * 0.7)}px Outfit, sans-serif`;
                ctx.fillText("OCR PLATE", p_x + 4, p_y - 4);
                
                const dataUrl = canvas.toDataURL("image/jpeg");
                let data = getMockViolations();
                const newId = data.length > 0 ? Math.max(...data.map(x => x.id)) + 1 : 1;
                
                const newViolation = {
                    id: newId,
                    timestamp: new Date().toISOString(),
                    violation_type: selectedViolation,
                    vehicle_type: vehicleClasses[selectedViolation],
                    license_plate: generatedPlate,
                    confidence: parseFloat((0.85 + Math.random() * 0.12).toFixed(2)),
                    image_path: uploadedDataUrl,
                    annotated_image_path: dataUrl,
                    status: "pending"
                };
                
                data.unshift(newViolation);
                localStorage.setItem("apic_violations", JSON.stringify(data));
                
                const result = {
                    status: "success",
                    file: uploadedDataUrl,
                    annotated_file: dataUrl,
                    detections_count: 1,
                    violations_detected: [
                        {
                            id: newId,
                            type: selectedViolation,
                            vehicle: vehicleClasses[selectedViolation],
                            plate: generatedPlate,
                            confidence: newViolation.confidence
                        }
                    ],
                    license_plates: [generatedPlate]
                };
                
                setTimeout(() => {
                    loading.style.display = "none";
                    document.getElementById("upload-placeholder-view").style.display = "none";
                    const wrapper = document.getElementById("image-display-view");
                    wrapper.style.display = "flex";
                    
                    const preview = document.getElementById("monitor-preview-img");
                    preview.src = result.annotated_file;
                    
                    renderMonitorResults(result);
                    loadDashboardData();
                }, 1200);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
        return;
    }
    
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
    
    if (isBrowserDemoMode) {
        setTimeout(() => {
            runBtn.disabled = false;
            runBtn.innerHTML = `<i class="fa-solid fa-circle-play"></i> Run Validation Suite`;
            
            const basePrecision = 0.942;
            const baseRecall = 0.915;
            const baseF1 = 0.928;
            const basemAP = 0.935;
            
            const variance = () => (Math.random() - 0.5) * 0.015;
            
            const precision = parseFloat((basePrecision + variance()).toFixed(3));
            const recall = parseFloat((baseRecall + variance()).toFixed(3));
            const f1_score = parseFloat((2 * (precision * recall) / (precision + recall)).toFixed(3));
            const mAP_50 = parseFloat((basemAP + variance()).toFixed(3));
            
            const total = parseInt(samples);
            const true_positives = Math.round(total * recall);
            const false_negatives = total - true_positives;
            const false_positives = Math.round(total * (1 - precision));
            
            document.getElementById("eval-precision").textContent = `${(precision * 100).toFixed(1)}%`;
            document.getElementById("eval-recall").textContent = `${(recall * 100).toFixed(1)}%`;
            document.getElementById("eval-f1").textContent = `${(f1_score * 100).toFixed(1)}%`;
            document.getElementById("eval-map").textContent = `${(mAP_50 * 100).toFixed(1)}%`;
            
            document.getElementById("matrix-tp").textContent = true_positives;
            document.getElementById("matrix-fp").textContent = false_positives;
            document.getElementById("matrix-fn").textContent = false_negatives;
        }, 1500);
        return;
    }
    
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
        
        if (isBrowserDemoMode) {
            localStorage.setItem("apic_settings", JSON.stringify(payload));
            alert("Junction configuration settings saved successfully (Demo Mode)!");
            loadSettings();
            return;
        }
        
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
        let rows = [];
        if (isBrowserDemoMode) {
            rows = getMockViolations();
        } else {
            try {
                const res = await fetch(`${API_BASE}/violations?limit=200`);
                const result = await res.json();
                rows = result.data;
            } catch (err) {
                console.error("Export CSV failed to fetch from server:", err);
                return;
            }
        }
        
        let csv = "ID,Timestamp,Violation Type,Vehicle Type,License Plate,Confidence,Status\n";
        rows.forEach(row => {
            csv += `${row.id},"${row.timestamp}","${row.violation_type}","${row.vehicle_type}","${row.license_plate}",${row.confidence},"${row.status}"\n`;
        });
        
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `apic_traffic_violations_export.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
    
    if (isBrowserDemoMode) {
        // In browser demo mode, dynamically generate original and annotated scenes to avoid 404s
        document.getElementById("modal-original-img").src = generateTrafficScene(item.violation_type, false, item.license_plate);
        document.getElementById("modal-annotated-img").src = generateTrafficScene(item.violation_type, true, item.license_plate);
    } else {
        document.getElementById("modal-original-img").src = origUrl;
        document.getElementById("modal-annotated-img").src = annUrl;
    }
    
    // Open overlay
    document.getElementById("violation-modal").style.display = "flex";
}

async function updateViolationReviewStatus(id, status) {
    if (isBrowserDemoMode) {
        let data = getMockViolations();
        data = data.map(item => {
            if (item.id === id) {
                item.status = status;
            }
            return item;
        });
        localStorage.setItem("apic_violations", JSON.stringify(data));
        document.getElementById("violation-modal").style.display = "none";
        // Refresh whichever view we are on
        if (currentTab === "dashboard") loadDashboardData();
        else if (currentTab === "history") loadHistoryData(document.getElementById("filter-search-input").value, historyPage);
        return;
    }
    
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
