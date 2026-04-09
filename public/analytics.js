// ==========================================
// ANALYTICS.JS
// Fetches live data from /api/analytics endpoints
// ==========================================

const sessionId  = localStorage.getItem('sessionId');
const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

if (!sessionId) { window.location.href = '/index.html'; }

document.getElementById('userName').textContent    = currentUser.name || 'User';
document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    localStorage.clear();
    window.location.href = '/index.html';
});

// ==========================================
// STATE
// ==========================================
let allStudents      = [];
let filteredStudents = [];
let allClasses       = [];     // Store all unique class names
let reg = { slope: 0, intercept: 0, r: 0 };
let scatterInstance  = null;
let predInstance     = null;
let activeTab        = 'overview';
let currentBaseClass = 'All';  // Selected base class (e.g., "10")
let currentSection   = 'All';  // Selected section (e.g., "A")

// ==========================================
// CLASS NAME PARSING HELPERS
// Handles both "11-B" and "11B" formats
// ==========================================
function parseClassName(className) {
    if (!className) return { base: '', section: '' };

    // Check if it has a hyphen
    if (className.includes('-')) {
        const parts = className.split('-');
        return { base: parts[0], section: parts[1] || '' };
    }

    // No hyphen - extract digits for base, letters for section
    // Examples: "11B" -> base: "11", section: "B"
    const match = className.match(/^(\d+)([a-zA-Z]*)$/);
    if (match) {
        return { base: match[1], section: match[2] || '' };
    }

    return { base: className, section: '' };
}

function getBaseClass(className) {
    return parseClassName(className).base;
}

function getSection(className) {
    return parseClassName(className).section;
}

// ==========================================
// API HELPER
// ==========================================
async function apiFetch(url, opts = {}) {
    try {
        const res = await fetch(url, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': sessionId,
                ...(opts.headers || {})
            }
        });
        if (res.status === 401) { localStorage.clear(); window.location.href = '/index.html'; return null; }
        return await res.json();
    } catch (err) {
        console.error('apiFetch error:', err);
        return null;
    }
}

// ==========================================
// MATH HELPERS
// ==========================================
function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = Math.sqrt(
        xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
        ys.reduce((s, y) => s + (y - my) ** 2, 0)
    );
    return den === 0 ? 0 : num / den;
}

function linReg(xs, ys) {
    const n = xs.length;
    if (n < 2) return { slope: 0, intercept: 50, predict: () => 50 };
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const slope     = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) /
                      xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const intercept = my - slope * mx;
    return { slope, intercept, predict: x => slope * x + intercept };
}

function clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

function gradeFromScore(sc) {
    if (sc >= 90) return { grade: 'A', label: 'Excellent',  color: '#0F6E56' };
    if (sc >= 75) return { grade: 'B', label: 'Good',       color: '#185FA5' };
    if (sc >= 60) return { grade: 'C', label: 'Average',    color: '#BA7517' };
    if (sc >= 45) return { grade: 'D', label: 'Below avg',  color: '#993C1D' };
    return             { grade: 'F', label: 'At risk',     color: '#A32D2D' };
}

function attClass(a) { return a >= 75 ? 'att-high' : a >= 60 ? 'att-mid' : 'att-low'; }

// ==========================================
// LOAD DATA
// BUG FIX #5: now calls /api/analytics/students/v2 (reads from marks table)
// ==========================================
async function loadAnalytics() {
    console.log('Analytics: Loading data from /api/analytics/students/v2...');
    const data = await apiFetch('/api/analytics/students/v2');
    console.log('Analytics: Response:', data);

    if (!data) {
        document.getElementById('overviewMetrics').innerHTML = '<div class="loading-msg" style="color:#c62828;">❌ Network error. Check that the server is running on port 8080.</div>';
        return;
    }

    if (!data.success) {
        const msg = data.message || 'Failed to load analytics data';
        document.getElementById('overviewMetrics').innerHTML = `<div class="loading-msg" style="color:#c62828;">❌ ${msg}</div>`;
        if (msg.toLowerCase().includes('session') || msg.toLowerCase().includes('unauthorized')) {
            localStorage.clear();
            window.location.href = '/index.html';
        }
        return;
    }

    allStudents = data.data || [];

    if (allStudents.length === 0) {
        document.getElementById('overviewMetrics').innerHTML = `<div class="loading-msg" style="color:#666;">📊 No student data found. <br><br>To see analytics:<ol style="text-align:left;margin:10px 0;"><li>Register students in Admin Dashboard</li><li>Record attendance via RFID scans</li><li>Enter marks via Marks Entry page</li></ol></div>`;
        return;
    }

    // Store all unique classes for section extraction
    allClasses = [...new Set(allStudents.map(s => s.class).filter(Boolean))].sort();

    // Populate base class filter (handles both "11-B" and "11B" formats)
    const baseClasses = ['All', ...new Set(allClasses.map(c => getBaseClass(c)).filter(Boolean).sort())];
    const sel = document.getElementById('classFilter');
    const prev = sel.value;
    sel.innerHTML = baseClasses.map(c => `<option value="${c}">${c === 'All' ? 'All classes' : 'Class ' + c}</option>`).join('');
    if (baseClasses.includes(prev)) sel.value = prev;

    // Update section dropdown based on selected class
    updateSectionOptions();

    applyFilter();
}

function updateSectionOptions() {
    const baseClass = document.getElementById('classFilter').value;
    const sectionSel = document.getElementById('sectionFilter');

    if (baseClass === 'All') {
        sectionSel.innerHTML = '<option value="All">All sections</option>';
        sectionSel.disabled = true;
        currentSection = 'All';
        return;
    }

    // Extract sections for this base class (handles both "11-B" and "11B" formats)
    const sections = allClasses
        .filter(c => getBaseClass(c) === baseClass)
        .map(c => getSection(c))
        .filter(v => v) // remove empty
        .filter((v, i, a) => a.indexOf(v) === i) // unique
        .sort();

    const currentVal = sectionSel.value;
    sectionSel.innerHTML = '<option value="All">All sections</option>' +
        sections.map(s => `<option value="${s}">Section ${s}</option>`).join('');
    sectionSel.disabled = false;

    // Restore selection if possible
    if (sections.includes(currentVal)) {
        sectionSel.value = currentVal;
    } else {
        currentSection = 'All';
    }
}

function applyFilter() {
    const baseClass = document.getElementById('classFilter').value;
    const section = document.getElementById('sectionFilter').value;
    currentBaseClass = baseClass;
    currentSection = section;

    if (baseClass === 'All') {
        // All classes, all sections
        filteredStudents = allStudents;
    } else if (section === 'All') {
        // Specific base class, all sections (e.g., all 10th grade sections)
        filteredStudents = allStudents.filter(s => s.class && getBaseClass(s.class) === baseClass);
    } else {
        // Specific section - match by base class AND section
        filteredStudents = allStudents.filter(s => {
            if (!s.class) return false;
            return getBaseClass(s.class) === baseClass && getSection(s.class) === section;
        });
    }

    const atArr = filteredStudents.map(s => s.attendance);
    const scArr = filteredStudents.map(s => s.avg_score);
    const r     = pearson(atArr, scArr);
    reg = { ...linReg(atArr, scArr), r };

    renderActiveTab();
}

document.getElementById('classFilter').addEventListener('change', () => {
    updateSectionOptions();
    applyFilter();
});
document.getElementById('sectionFilter').addEventListener('change', applyFilter);
document.getElementById('viewModeFilter').addEventListener('change', applyFilter);

// ==========================================
// TAB SWITCHING
// ==========================================
function switchTab(name, btn) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    btn.classList.add('active');
    activeTab = name;
    renderActiveTab();
}

function renderActiveTab() {
    switch (activeTab) {
        case 'overview': renderOverview(); break;
        case 'scatter':  renderScatter();  break;
        case 'risk':     renderRisk();     break;
        case 'predict':  renderPredict();  break;
        case 'ai':       renderAISummary(); break;
    }
}

// ==========================================
// OVERVIEW TAB
// ==========================================
function renderOverview() {
    const s = filteredStudents;
    if (!s.length) {
        document.getElementById('overviewMetrics').innerHTML = '<div class="loading-msg">No students found in selected class</div>';
        return;
    }

    // Check if any students have marks data
    const hasMarks = s.some(st => st.avg_score > 0 || st.midterm > 0 || st.final_score > 0);
    if (!hasMarks) {
        document.getElementById('overviewMetrics').innerHTML = `<div class="loading-msg">
            📚 Students exist but no marks found.<br><br>
            Go to <a href="/marks-entry.html" style="color:#185FA5;">Marks Entry</a> to add exam scores.<br><br>
            Attendance data will show once students scan their RFID cards.
        </div>`;
        document.getElementById('overviewCharts').innerHTML = '';
        document.getElementById('studentTableWrap').innerHTML = '';
        return;
    }

    const avgAtt = Math.round(s.reduce((a, b) => a + b.attendance, 0) / s.length);
    const avgSc  = Math.round(s.reduce((a, b) => a + b.avg_score,  0) / s.length);
    const atRisk = s.filter(st => st.attendance < 60 || st.avg_score < 50).length;

    // Build filter label for display
    let filterLabel = document.getElementById('classFilter').value;
    if (filterLabel !== 'All') {
        const section = document.getElementById('sectionFilter').value;
        if (section !== 'All') {
            filterLabel = `Class ${filterLabel}-${section}`;
        } else {
            filterLabel = `Class ${filterLabel} (all sections)`;
        }
    } else {
        filterLabel = 'All classes';
    }

    document.getElementById('overviewMetrics').innerHTML = `
        ${mc('Students',      s.length, filterLabel)}
        ${mc('Avg attendance', avgAtt + '%', 'this semester')}
        ${mc('Avg score',      avgSc  + '%', 'from marks table')}
        ${mc('At-risk',        atRisk, 'need intervention', atRisk > 0 ? '#A32D2D' : '#0F6E56')}
    `;

    const gradeDist = ['A','B','C','D','F'].map(g => ({ g, n: s.filter(st => st.grade === g).length }));

    document.getElementById('overviewCharts').innerHTML = `
        <div class="chart-card" style="margin-bottom:0;">
            <h3>Grade distribution</h3>
            <div class="bar-wrap"><canvas id="gradeChart"></canvas></div>
        </div>
        <div class="chart-card" style="margin-bottom:0;">
            <h3>Regression: predicted score vs attendance</h3>
            <div class="bar-wrap"><canvas id="trendChart"></canvas></div>
        </div>
    `;

    setTimeout(() => {
        const gc = document.getElementById('gradeChart');
        const tc = document.getElementById('trendChart');
        if (!gc || !tc) return;

        new Chart(gc, {
            type: 'bar',
            data: {
                labels: gradeDist.map(d => d.g),
                datasets: [{
                    data: gradeDist.map(d => d.n),
                    backgroundColor: ['#C0DD97','#85B7EB','#FAC775','#F0997B','#F09595'],
                    borderRadius: 4,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } } },
                    x: { ticks: { font: { size: 11 } } }
                }
            }
        });

        const trendPts = [60,65,70,75,80,85,90,95,100];
        new Chart(tc, {
            type: 'line',
            data: {
                labels: trendPts.map(v => v + '%'),
                datasets: [{
                    data: trendPts.map(v => clamp(reg.predict(v))),
                    borderColor: '#0F6E56', borderWidth: 2, pointRadius: 3, fill: false
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { min: 0, max: 100, ticks: { font: { size: 11 } } },
                    x: { ticks: { font: { size: 10 } } }
                }
            }
        });
    }, 50);

    // Show section column when viewing all sections of a base class
    const showSectionCol = currentBaseClass !== 'All' && currentSection === 'All';

    document.getElementById('studentTableWrap').innerHTML = `
        <div style="font-size:13px;font-weight:500;margin-bottom:10px;">Student records${showSectionCol ? ' (grouped by section)' : ''}</div>
        <div style="overflow-x:auto;">
        <table class="data-table">
            <thead><tr>
                <th>Name</th>
                ${showSectionCol ? '<th>Section</th>' : '<th>Class</th>'}
                <th>Roll</th><th>Att %</th>
                <th>Midterm</th><th>Final</th><th>Avg score</th><th>Grade</th>
            </tr></thead>
            <tbody>
            ${s.map(st => {
                const section = st.class ? st.class.split('-')[1] || '' : '';
                return `
                <tr>
                    <td><strong>${st.name}</strong></td>
                    ${showSectionCol
                        ? `<td><span style="background:#e3f2fd;padding:2px 8px;border-radius:4px;font-size:12px;">${section}</span></td>`
                        : `<td style="color:#888;">${st.class || '—'}</td>`}
                    <td style="color:#888;">${st.roll_number || '—'}</td>
                    <td class="${attClass(st.attendance)}">${st.attendance}%</td>
                    <td>${st.midterm ? Math.round(st.midterm) + '%' : '—'}</td>
                    <td>${st.final_score ? Math.round(st.final_score) + '%' : '—'}</td>
                    <td><strong>${st.avg_score || 0}%</strong></td>
                    <td><span class="grade-pill grade-${st.grade || 'F'}">${st.grade || '—'}</span></td>
                </tr>`;
            }).join('')}
            </tbody>
        </table>
        </div>
    `;

    // Grade import section
    document.getElementById('studentTableWrap').innerHTML += `
        <div style="margin-top:16px;">
            <div class="import-box">
                Quick-import legacy grades (roll,midterm%,final%,grade per line).
                For full marks entry use the <a href="/marks-entry.html" style="color:#0F6E56;">Marks Entry page</a>.
            </div>
            <div class="import-row">
                <textarea id="importCsv" placeholder="101,88,91,A&#10;102,51,48,D"></textarea>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    <button onclick="doImport()" style="white-space:nowrap;padding:8px 14px;border:1px solid #e0e0e0;border-radius:6px;cursor:pointer;background:white;font-size:13px;">Import</button>
                    <div id="importMsg" style="font-size:11px;color:#0F6E56;"></div>
                </div>
            </div>
        </div>
    `;
}

function mc(label, value, sub, color) {
    return `<div class="metric-card">
        <div class="label">${label}</div>
        <div class="value" style="color:${color || '#333'}">${value}</div>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>`;
}

// ==========================================
// SCATTER / CORRELATION TAB
// ==========================================
function renderScatter() {
    const s = filteredStudents;
    const r = reg.r;
    const corrColor = Math.abs(r) > 0.7 ? '#0F6E56' : Math.abs(r) > 0.4 ? '#BA7517' : '#A32D2D';
    const corrLabel = Math.abs(r) > 0.7 ? 'Strong' : Math.abs(r) > 0.4 ? 'Moderate' : 'Weak';

    document.getElementById('corrMetrics').innerHTML = `
        ${mc('Pearson r',            r.toFixed(3),              corrLabel + ' correlation', corrColor)}
        ${mc('Regression slope',     reg.slope.toFixed(2),      'score pts per 1% att')}
        ${mc('R² (variance expl.)',  (r*r*100).toFixed(1) + '%','of score variance from att')}
        ${mc('Students analysed',    s.length,                  'in current filter')}
    `;

    document.getElementById('corrFormula').innerHTML =
        `Correlation = <strong>${r.toFixed(2)}</strong> — attendance explains <strong>${(r*r*100).toFixed(0)}%</strong> of score variance.<br>
         Formula: <code>score = ${reg.slope.toFixed(3)} × attendance + ${reg.intercept.toFixed(2)}</code>`;

    if (scatterInstance) { scatterInstance.destroy(); scatterInstance = null; }

    const scatterData = s.map(st => ({ x: st.attendance, y: st.avg_score, name: st.name }));
    const regLine     = [25,35,45,55,65,75,85,95,100].map(x => ({ x, y: clamp(reg.predict(x)) }));

    setTimeout(() => {
        const ctx = document.getElementById('scatterChart');
        if (!ctx) return;
        scatterInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Students',
                        data:  scatterData,
                        backgroundColor: 'rgba(55,138,221,0.75)',
                        pointRadius: 5, pointHoverRadius: 7
                    },
                    {
                        label: 'Regression',
                        data:  regLine,
                        type:  'line',
                        borderColor: '#E24B4A', borderWidth: 2,
                        pointRadius: 0, fill: false
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const d = ctx.raw;
                                return d.name
                                    ? `${d.name}: att ${d.x}%, score ${d.y}%`
                                    : `Regression: ${d.y}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: { title: { display: true, text: 'Attendance (%)', font: { size: 11 } }, min: 15, max: 105, ticks: { font: { size: 10 } } },
                    y: { title: { display: true, text: 'Avg score (%)',   font: { size: 11 } }, min: 15, max: 105, ticks: { font: { size: 10 } } }
                }
            }
        });
    }, 50);
}

// ==========================================
// AT-RISK TAB
// ==========================================
function renderRisk() {
    const s        = filteredStudents;
    const atRisk   = s.filter(st => st.attendance < 60 || st.avg_score < 50);
    const critical = s.filter(st => st.attendance < 50);
    const warning  = s.filter(st => st.attendance >= 50 && st.attendance < 60);
    const lowScore = s.filter(st => st.avg_score < 50);
    const double_r = s.filter(st => st.attendance < 60 && st.avg_score < 50);

    document.getElementById('riskMetrics').innerHTML = `
        ${mc('Critical (att < 50%)', critical.length, 'immediate action', '#A32D2D')}
        ${mc('Warning (att 50–60%)', warning.length,  'monitor closely',  '#BA7517')}
        ${mc('Low score (< 50%)',    lowScore.length, 'academic support', '#993C1D')}
        ${mc('Double risk',         double_r.length, 'att + score both', '#E24B4A')}
    `;

    if (!atRisk.length) {
        document.getElementById('riskList').innerHTML =
            '<div class="empty-box" style="background:#EAF3DE;color:#3B6D11;">No at-risk students found.</div>';
        return;
    }

    document.getElementById('riskList').innerHTML = atRisk.map(st => {
        const isCrit  = st.attendance < 50;
        const attRisk = st.attendance < 60;
        const scRisk  = st.avg_score < 50;
        const proj    = clamp(reg.predict(75));
        const rec     = isCrit
            ? 'Immediate parent/guardian contact. Mandatory counselling session.'
            : attRisk
                ? 'Send attendance warning letter. Schedule teacher–student meeting.'
                : 'Assign peer tutor. Weekly progress check-in.';

        // Show section info in multi-section view
        const section = st.class ? st.class.split('-')[1] || '' : '';
        const classDisplay = currentBaseClass !== 'All' && currentSection === 'All' && section
            ? `Sec ${section} · Roll ${st.roll_number || '—'}`
            : `${st.class || '—'} · Roll ${st.roll_number || '—'}`;

        return `
        <div class="risk-card ${isCrit ? 'critical' : ''}">
            <div class="risk-header">
                <div>
                    <div class="risk-name">${st.name}</div>
                    <div class="risk-sub">${classDisplay}</div>
                </div>
                <div class="risk-tags">
                    ${attRisk ? `<span class="tag tag-att">Att: ${st.attendance}%</span>` : ''}
                    ${scRisk  ? `<span class="tag tag-sc">Score: ${st.avg_score}%</span>` : ''}
                    ${isCrit  ? `<span class="tag tag-crit">Critical</span>` : ''}
                </div>
            </div>
            <div class="risk-stats">
                <div><span>Midterm: </span>${st.midterm ? Math.round(st.midterm) + '%' : '—'}</div>
                <div><span>Final: </span>${st.final_score ? Math.round(st.final_score) + '%' : '—'}</div>
                <div><span>Avg: </span>${st.avg_score}%</div>
                <div><span>Grade: </span>${st.grade || '?'}</div>
                <div><span>Predicted @ 75% att: </span><strong style="color:#185FA5;">${proj}%</strong></div>
            </div>
            <div class="risk-rec">Recommendation: ${rec}</div>
        </div>`;
    }).join('');
}

// ==========================================
// PREDICTOR TAB
// ==========================================
function renderPredict() {
    updatePredictor();

    const pts = [...Array(10)].map((_, i) => 10 + i * 10);
    if (predInstance) { predInstance.destroy(); predInstance = null; }

    setTimeout(() => {
        const ctx = document.getElementById('predChart');
        if (!ctx) return;
        predInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: pts.map(v => v + '%'),
                datasets: [{
                    data: pts.map(v => clamp(reg.predict(v))),
                    borderColor: '#378ADD', borderWidth: 2, pointRadius: 3, fill: false
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { min: 0, max: 100, ticks: { font: { size: 11 } } },
                    x: { ticks: { font: { size: 10 } } }
                }
            }
        });
    }, 50);

    document.getElementById('modelDetails').innerHTML = [
        ['Algorithm',    'Ordinary Least Squares regression'],
        ['Feature',      'Attendance %'],
        ['Target',       'Average of all entered exam scores (%)'],
        ['Formula',      `score = ${reg.slope.toFixed(3)} × att + ${reg.intercept.toFixed(2)}`],
        ['Pearson r',    reg.r.toFixed(4)],
        ['R²',           (reg.r * reg.r).toFixed(4)],
        ['Samples',      filteredStudents.length],
        ['Data source',  'RFID attendance DB + Marks Entry page'],
    ].map(([k, v]) => `<div>${k}: <span>${v}</span></div>`).join('');
}

function updatePredictor() {
    const att  = parseInt(document.getElementById('predSlider')?.value || 75, 10);
    document.getElementById('predVal').textContent = att + '%';
    const sc   = clamp(reg.predict(att));
    const g    = gradeFromScore(sc);
    const gain = Math.round(reg.predict(att) - reg.predict(60));

    document.getElementById('predictBoxes').innerHTML = `
        <div class="predict-box">
            <div class="lbl">Predicted score</div>
            <div class="big" style="color:${g.color}">${sc}%</div>
            <div class="note">${g.label}</div>
        </div>
        <div class="predict-box">
            <div class="lbl">Predicted grade</div>
            <div class="big" style="color:${g.color}">${g.grade}</div>
            <div class="note">linear regression</div>
        </div>
        <div class="predict-box">
            <div class="lbl">Gain vs 60% att</div>
            <div class="big" style="color:${gain >= 0 ? '#0F6E56' : '#A32D2D'}">${gain >= 0 ? '+' : ''}${gain}%</div>
            <div class="note">score points difference</div>
        </div>
    `;
}

// ==========================================
// AI INSIGHT TAB
// ==========================================
function renderAISummary() {
    const s = filteredStudents;
    if (!s.length) return;

    const avgAtt = Math.round(s.reduce((a, b) => a + b.attendance, 0) / s.length);
    const avgSc  = Math.round(s.reduce((a, b) => a + b.avg_score,  0) / s.length);
    const atRisk = s.filter(st => st.attendance < 60 || st.avg_score < 50);

    // Build class label for AI summary
    let classLabel = document.getElementById('classFilter').value;
    if (classLabel !== 'All') {
        const section = document.getElementById('sectionFilter').value;
        if (section !== 'All') {
            classLabel = `${classLabel}-${section}`;
        } else {
            classLabel = `${classLabel} (all sections)`;
        }
    } else {
        classLabel = 'All classes';
    }

    document.getElementById('aiSummaryMetrics').innerHTML = `
        ${mc('Class',     classLabel)}
        ${mc('Pearson r', reg.r.toFixed(2), 'att ↔ score')}
        ${mc('At-risk',   atRisk.length, 'flagged')}
        ${mc('Avg score', avgSc + '%', 'class average')}
    `;
}

async function runAI() {
    const btn = document.getElementById('aiBtn');
    btn.disabled = true;
    btn.textContent = 'Analysing...';
    document.getElementById('aiOutput').innerHTML =
        '<div class="loading-msg">Sending data to Gemini — analysing correlations, trends, and generating recommendations...</div>';

    const s      = filteredStudents;
    const avgAtt = Math.round(s.reduce((a, b) => a + b.attendance, 0) / s.length);
    const avgSc  = Math.round(s.reduce((a, b) => a + b.avg_score,  0) / s.length);
    const atRisk = s.filter(st => st.attendance < 60 || st.avg_score < 50);
    const gDist  = ['A','B','C','D','F']
        .map(g => `${g}:${s.filter(st => st.grade === g).length}`)
        .join(', ');

    // Build class label for AI summary
    const baseClass = document.getElementById('classFilter').value;
    const section = document.getElementById('sectionFilter').value;
    let clsLabel = baseClass;
    if (baseClass !== 'All' && section !== 'All') {
        clsLabel = `${baseClass}-${section}`;
    } else if (baseClass !== 'All') {
        clsLabel = `${baseClass} (all sections)`;
    } else {
        clsLabel = 'All classes';
    }

    const summary =
`Class: ${clsLabel}
Students: ${s.length}
Avg Attendance: ${avgAtt}%
Avg Score: ${avgSc}%
Pearson Correlation (attendance vs score): ${reg.r.toFixed(2)}
Regression: score = ${reg.slope.toFixed(3)} × attendance + ${reg.intercept.toFixed(2)}
R²: ${(reg.r * reg.r).toFixed(3)}
Grade distribution: ${gDist}
At-risk students (${atRisk.length}): ${atRisk.map(st =>
    `${st.name} (att:${st.attendance}%, score:${st.avg_score}%, grade:${st.grade || '?'})`
).join('; ')}`;

    try {
        const result = await apiFetch('/api/analytics/ai-insight', {
            method: 'POST',
            body: JSON.stringify({ summary })
        });
        if (result && result.success) {
            // BUG FIX #6: label now says Gemini, not Claude
            document.getElementById('aiOutput').innerHTML = `
                <div class="ai-output">
                    <div class="ai-output-title">Gemini's analysis for ${clsLabel}</div>
                    ${result.insight}
                </div>`;
        } else {
            document.getElementById('aiOutput').innerHTML =
                `<div class="empty-box">${result?.message || 'Failed to get AI insight.'}</div>`;
        }
    } catch {
        document.getElementById('aiOutput').innerHTML =
            '<div class="empty-box">Network error. Check server and GEMINI_API_KEY.</div>';
    }

    btn.disabled = false;
    btn.textContent = 'Run AI analysis ↗';
}

// ==========================================
// LEGACY GRADE IMPORT (overview tab)
// ==========================================
async function doImport() {
    const csvEl = document.getElementById('importCsv');
    const msgEl = document.getElementById('importMsg');
    if (!csvEl) return;
    const csv = csvEl.value.trim();
    if (!csv) return;

    const rows = [];
    csv.split('\n').filter(Boolean).forEach(line => {
        const p = line.split(',').map(s => s.trim());
        if (p.length >= 4) {
            rows.push({ rollNumber: p[0], midterm: parseInt(p[1], 10), finalScore: parseInt(p[2], 10), grade: p[3] });
        }
    });

    if (!rows.length) { if (msgEl) msgEl.textContent = 'No valid rows found.'; return; }

    const result = await apiFetch('/api/analytics/import-grades', {
        method: 'POST',
        body: JSON.stringify({ grades: rows })
    });

    if (result && result.success) {
        if (msgEl) msgEl.textContent = `Updated ${result.updated} records.`;
        csvEl.value = '';
        await loadAnalytics();
    } else {
        if (msgEl) msgEl.textContent = result?.message || 'Import failed.';
    }
}

// ==========================================
// INIT
// ==========================================
loadAnalytics();