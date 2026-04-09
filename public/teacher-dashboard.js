// ==========================================
// MOBILE MENU INITIALIZATION
// ==========================================
(function initMobileMenu() {
    const menuBtn = document.createElement('button');
    menuBtn.className = 'mobile-menu-btn';
    menuBtn.innerHTML = '☰';
    menuBtn.setAttribute('aria-label', 'Toggle menu');
    document.body.appendChild(menuBtn);

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    const sidebar = document.querySelector('.sidebar');

    function toggleMenu() {
        sidebar.classList.toggle('mobile-open');
        overlay.classList.toggle('active');
        menuBtn.innerHTML = sidebar.classList.contains('mobile-open') ? '✕' : '☰';
    }

    function closeMenu() {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('active');
        menuBtn.innerHTML = '☰';
    }

    menuBtn.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', closeMenu);

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                closeMenu();
            }
        });
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeMenu();
        }
    });
})();

// ==========================================
// SESSION AND AUTH
// ==========================================
let sessionId = localStorage.getItem('sessionId');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let assignments = JSON.parse(localStorage.getItem('assignments') || '{"ct":[],"st":[]}');

if (!sessionId || !currentUser.id) {
    window.location.href = '/index.html';
}

if (currentUser.role === 'admin') {
    window.location.href = '/admin-dashboard.html';
}

// ==========================================
// DOM ELEMENTS
// ==========================================
const logoutBtn = document.getElementById('logoutBtn');
const userName = document.getElementById('userName');
const currentDate = document.getElementById('currentDate');
const assignmentsSidebar = document.getElementById('assignmentsSidebar');
const ctSection = document.getElementById('ctSection');
const stSection = document.getElementById('stSection');
const ctContent = document.getElementById('ctContent');
const stContent = document.getElementById('stContent');

userName.textContent = currentUser.name || 'Teacher';
currentDate.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
});

let selectedCTClass = null;
let selectedSTClass = null;

// ==========================================
// API HELPER
// ==========================================
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(endpoint, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': sessionId,
                ...options.headers
            }
        });

        if (response.status === 401) {
            localStorage.clear();
            window.location.href = '/index.html';
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('API call error:', error);
        return null;
    }
}

// ==========================================
// INITIALIZE DASHBOARD - Adapted for new class/section model
// ==========================================
async function initDashboard() {
    console.log('Initializing dashboard...');
    console.log('CT assignments:', assignments.ct);
    console.log('ST assignments:', assignments.st);

    updateSidebar();

    if (assignments.ct && assignments.ct.length > 0) {
        selectedCTAssignment = assignments.ct[0];
        selectedCTClass = selectedCTAssignment.class_name;
        await initCTSection();
    } else {
        ctContent.innerHTML = `
            <div class="no-assignment-notice">
                <h3>📋 No CT Assignment</h3>
                <p>You are not assigned as Class Teacher of any class yet.</p>
                <p style="color: #999; font-size: 14px;">Contact your administrator to get assigned.</p>
            </div>
        `;
    }

    if (assignments.st && assignments.st.length > 0) {
        selectedSTAssignment = assignments.st[0];
        selectedSTClass = selectedSTAssignment.class_name;
        await initSTSection();
    } else {
        stContent.innerHTML = `
            <div class="no-assignment-notice">
                <h3>📋 No ST Assignment</h3>
                <p>You are not assigned as Subject Teacher of any class yet.</p>
                <p style="color: #999; font-size: 14px;">You can be ST of multiple classes.</p>
            </div>
        `;
    }
}

// ==========================================
// UPDATE SIDEBAR - Adapted for new class/section model
// ==========================================
function updateSidebar() {
    let html = '';

    // Helper to format class display with section
    const formatClass = (a) => a.section ? `${a.class_name}-${a.section}` : a.class_name;

    if (assignments.ct && assignments.ct.length > 0) {
        html += '<div style="margin-bottom: 15px;">';
        html += '<strong style="color: #4CAF50; font-size: 12px;">CT of:</strong><br>';
        assignments.ct.forEach(a => {
            html += `<span style="color: #333; font-size: 14px;">• ${formatClass(a)}</span><br>`;
        });
        html += '</div>';
    }

    if (assignments.st && assignments.st.length > 0) {
        html += '<div>';
        html += '<strong style="color: #2196F3; font-size: 12px;">ST of:</strong><br>';
        assignments.st.forEach(a => {
            html += `<span style="color: #333; font-size: 14px;">• ${formatClass(a)}</span><br>`;
        });
        html += '</div>';
    }

    if (!html) {
        html = '<p style="color: #999; font-size: 13px;">No assignments yet</p>';
    }

    assignmentsSidebar.innerHTML = html;
}

// ==========================================
// CLASS TEACHER SECTION - Adapted for new class/section model
// ==========================================
// Store full assignment object for current selection
let selectedCTAssignment = null;

async function initCTSection() {
    let html = '';

    // Helper to format class display with section
    const formatClass = (a) => a.section ? `${a.class_name}-${a.section}` : a.class_name;

    if (assignments.ct.length > 1) {
        html += `
            <div class="class-selector">
                <label>Select Class:</label>
                <select id="ctClassSelect" onchange="handleCTClassChange(this.value)">
                    ${assignments.ct.map(a => {
                        const classDisplay = formatClass(a);
                        const value = JSON.stringify({ class_name: a.class_name, section: a.section });
                        const isSelected = selectedCTAssignment &&
                            selectedCTAssignment.class_name === a.class_name &&
                            selectedCTAssignment.section === a.section;
                        return `<option value='${value}' ${isSelected ? 'selected' : ''}>
                            ${classDisplay}
                        </option>`;
                    }).join('')}
                </select>
            </div>
        `;
    } else {
        const assignment = assignments.ct[0];
        selectedCTAssignment = assignment;
        selectedCTClass = assignment.class_name;
        html += `<h3 style="margin: 0 0 15px 0; color: #4CAF50;">Class: ${formatClass(assignment)}</h3>`;
    }

    html += '<div id="ctStats"><p class="loading">Loading stats...</p></div>';

    html += `
        <div class="attendance-controls">
            <h4 style="margin: 0 0 10px 0;">Mark Attendance</h4>
            <div class="card-input-group">
                <input type="text" id="ctCardInput" placeholder="Scan or enter RFID card ID" autocomplete="off">
                <button onclick="markCTAttendance()">✓ Mark Present</button>
            </div>
        </div>
    `;

    html += `
        <div class="student-lists">
            <div class="student-list-box">
                <h3>✓ Present Today (<span id="ctPresentCount">0</span>)</h3>
                <div id="ctPresentList"><p class="empty-list">No students marked present yet</p></div>
            </div>
            <div class="student-list-box">
                <h3>✗ Absent (<span id="ctAbsentCount">0</span>)</h3>
                <div id="ctAbsentList"><p class="empty-list">Loading...</p></div>
            </div>
        </div>
    `;

    html += `
        <div class="quick-actions">
            <button class="btn-add-student" onclick="showAddStudentModal()">+ Add Student</button>
            <button class="btn-view-history" onclick="viewCTHistory()">📊 View History</button>
        </div>
    `;

    ctContent.innerHTML = html;
    await loadCTData();

    document.getElementById('ctCardInput')?.focus();

    document.getElementById('ctCardInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            markCTAttendance();
        }
    });
}

async function loadCTData() {
    // Build API URL with section parameter if available
    let apiUrl = `/attendance/class/${selectedCTClass}/today`;
    if (selectedCTAssignment?.section) {
        apiUrl += `?section=${encodeURIComponent(selectedCTAssignment.section)}`;
    }

    const result = await apiCall(apiUrl);

    if (result && result.success) {
        const stats = result.data.stats;
        document.getElementById('ctStats').innerHTML = `
            <div class="stats-mini-grid">
                <div class="stat-mini-card">
                    <h4>Total</h4>
                    <p>${stats.total}</p>
                </div>
                <div class="stat-mini-card" style="background: #e8f5e9;">
                    <h4>Present</h4>
                    <p style="color: #4CAF50;">${stats.present}</p>
                </div>
                <div class="stat-mini-card" style="background: #ffebee;">
                    <h4>Absent</h4>
                    <p style="color: #f44336;">${stats.absent}</p>
                </div>
            </div>
        `;

        document.getElementById('ctPresentCount').textContent = stats.present;
        document.getElementById('ctAbsentCount').textContent = stats.absent;

        const presentList = document.getElementById('ctPresentList');
        if (result.data.records && result.data.records.length > 0) {
            presentList.innerHTML = result.data.records.map(r => `
                <div class="student-item present">
                    <div>
                        <div class="student-name">${r.student_name}</div>
                        <div class="student-roll">Roll: ${r.student_id || 'N/A'}</div>
                    </div>
                    <div style="font-size: 12px; color: #666;">
                        ${new Date(r.timestamp).toLocaleTimeString()}
                    </div>
                </div>
            `).join('');
        } else {
            presentList.innerHTML = '<p class="empty-list">No students marked present yet</p>';
        }

        const absentList = document.getElementById('ctAbsentList');
        if (result.data.absentStudents && result.data.absentStudents.length > 0) {
            absentList.innerHTML = result.data.absentStudents.map(s => `
                <div class="student-item absent">
                    <div>
                        <div class="student-name">${s.name}</div>
                        <div class="student-roll">Roll: ${s.roll_number || 'N/A'}</div>
                    </div>
                </div>
            `).join('');
        } else {
            absentList.innerHTML = '<p class="empty-list">All students present! 🎉</p>';
        }
    }
}

async function markCTAttendance() {
    const cardInput = document.getElementById('ctCardInput');
    const cardId = cardInput.value.trim();

    if (!cardId) {
        alert('Please enter a card ID');
        return;
    }

    const result = await apiCall('/attendance', {
        method: 'POST',
        body: JSON.stringify({
            cardId: cardId,
            time: new Date().toISOString()
        })
    });

    if (result && result.success) {
        cardInput.value = '';
        cardInput.focus();
        alert(`✓ Attendance marked for ${result.data.student.name}`);
        await loadCTData();
    } else {
        alert(result?.message || 'Failed to mark attendance');
    }
}

function handleCTClassChange(value) {
    try {
        selectedCTAssignment = JSON.parse(value);
        selectedCTClass = selectedCTAssignment.class_name;
    } catch (e) {
        // Fallback for old format
        selectedCTClass = value;
        selectedCTAssignment = assignments.ct.find(a => a.class_name === value) || null;
    }
    initCTSection();
}

function viewCTHistory() {
    const display = selectedCTAssignment?.section
        ? `${selectedCTClass}-${selectedCTAssignment.section}`
        : selectedCTClass;
    alert('History view coming soon! Will show attendance records for ' + display);
}

function showAddStudentModal() {
    const name = prompt('Enter student name:');
    if (!name) return;

    const cardId = prompt('Enter student card ID:');
    if (!cardId) return;

    const rollNumber = prompt('Enter roll number (optional):');

    // Include section if CT assignment has one (new model)
    const section = selectedCTAssignment?.section || null;

    apiCall('/students/register', {
        method: 'POST',
        body: JSON.stringify({
            name: name,
            cardId: cardId,
            studentClass: selectedCTClass,
            section: section,
            rollNumber: rollNumber || null
        })
    }).then(result => {
        if (result && result.success) {
            alert('Student added successfully!');
            loadCTData();
        } else {
            alert(result?.message || 'Failed to add student');
        }
    });
}

// ==========================================
// SUBJECT TEACHER SECTION - Adapted for new class/section model
// ==========================================
// Store full assignment object for ST selection
let selectedSTAssignment = null;

async function initSTSection() {
    let html = '';

    // Helper to format class display with section
    const formatClass = (a) => a.section ? `${a.class_name}-${a.section}` : a.class_name;

    html += `
        <div class="class-selector">
            <label>Select Class:</label>
            <select id="stClassSelect" onchange="handleSTClassChange(this.value)">
                ${assignments.st.map(a => {
                    const classDisplay = formatClass(a);
                    const value = JSON.stringify({ class_name: a.class_name, section: a.section });
                    const isSelected = selectedSTAssignment &&
                        selectedSTAssignment.class_name === a.class_name &&
                        selectedSTAssignment.section === a.section;
                    return `<option value='${value}' ${isSelected ? 'selected' : ''}>
                        ${classDisplay}
                    </option>`;
                }).join('')}
            </select>
        </div>
    `;

    html += '<div id="stStats"><p class="loading">Loading stats...</p></div>';

    html += `
        <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-top: 20px;">
            <strong>ℹ️ Subject Teacher Access:</strong>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">
                As a Subject Teacher, you can view attendance statistics but cannot see individual student names or mark attendance.
            </p>
        </div>
    `;

    stContent.innerHTML = html;
    await loadSTData();
}

async function loadSTData() {
    // Build API URL with section parameter if available
    let apiUrl = `/attendance/class/${selectedSTClass}/today`;
    if (selectedSTAssignment?.section) {
        apiUrl += `?section=${encodeURIComponent(selectedSTAssignment.section)}`;
    }

    const result = await apiCall(apiUrl);

    if (result && result.success) {
        const stats = result.data.stats;
        
        document.getElementById('stStats').innerHTML = `
            <div class="stats-mini-grid">
                <div class="stat-mini-card">
                    <h4>Total Students</h4>
                    <p>${stats.total}</p>
                </div>
                <div class="stat-mini-card" style="background: #e8f5e9;">
                    <h4>Present Today</h4>
                    <p style="color: #4CAF50;">${stats.present}</p>
                </div>
                <div class="stat-mini-card" style="background: #ffebee;">
                    <h4>Absent Today</h4>
                    <p style="color: #f44336;">${stats.absent}</p>
                </div>
            </div>
            <div style="margin-top: 20px; text-align: center;">
                <div style="font-size: 48px; font-weight: bold; color: #2196F3;">
                    ${((stats.present / stats.total) * 100).toFixed(1)}%
                </div>
                <div style="color: #666; margin-top: 5px;">Attendance Rate</div>
            </div>
        `;
    }
}

function handleSTClassChange(value) {
    try {
        selectedSTAssignment = JSON.parse(value);
        selectedSTClass = selectedSTAssignment.class_name;
    } catch (e) {
        // Fallback for old format
        selectedSTClass = value;
        selectedSTAssignment = assignments.st.find(a => a.class_name === value) || null;
    }
    loadSTData();
}

// ==========================================
// LOGOUT
// ==========================================
logoutBtn.addEventListener('click', async () => {
    await apiCall('/auth/logout', { method: 'POST' });
    localStorage.clear();
    window.location.href = '/index.html';
});

// ==========================================
// INITIALIZE
// ==========================================
initDashboard();