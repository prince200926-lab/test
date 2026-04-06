// ==========================================
// ANALYTICS.JS — ML Analytics Frontend
// Fetches live data from /api/analytics endpoints
// ==========================================

const sessionId = localStorage.getItem('sessionId');
const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

if (!sessionId) window.location.href = '/login.html';

document.getElementById('userName').textContent = currentUser.name || 'User';
document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    localStorage.clear();
    window.location.href = '/login.html';
});

// ==========================================
// STATE
// ==========================================
let allStudents = [];
let filteredStudents = [];
let reg = { slope: 0, intercept: 0, r: 0 };
let scatterInstance = null;
let predInstance = null;
let activeTab = 'overview';

// ==========================================
// API HELPER
// ==========================================
async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
        ...opts,
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId, ...(opts.headers || {}) }
    });
    if (res.status === 401) { localStorage.clear(); window.location.href = '/login.html'; return null; }
    return res.json();
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
    const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
    return den === 0 ? 0 : num / den;
}

function linReg(xs, ys) {
    const n = xs.length;
    if (n < 2) return { slope: 0, intercept: 50, predict: () => 50 };
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const intercept = my - slope * mx;
    return { slope, intercept, predict: x => slope * x + intercept };
}

function clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

function gradeFromScore(sc) {
    if (sc >= 90) return { grade: 'A', label: 'Excellent', color: '#0F6E56' };
    if (sc >= 75) return { grade: 'B', label: 'Good', color: '#185FA5' };
    if (sc >= 60) return { grade: 'C', label: 'Average', color: '#BA7517' };
    if (sc >= 45) return { grade: 'D', label: 'Below avg', color: '#993C1D' };
    return { grade: 'F', label: 'At risk', color: '#A32D2D' };
}

function attClass(a) { return a >= 75 ? 'att-high' : a >= 60 ? 'att-mid' : 'att-low'; }

// ==========================================
// LOAD DATA
// ==========================================
async function loadAnalytics() {
    const data = await apiFetch('/api/analytics/students');
    if (!data || !data.success) { alert('Failed to load analytics data'); return; }

    allStudents = data.data;

    // Populate class filter
    const classes = ['All', ...new Set(allStudents.map(s => s.class).filter(Boolean).sort())];
    const sel = document.getElementById('classFilter');
    const prev = sel.value;
    sel.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
    if (classes.includes(prev)) sel.value = prev;

    applyFilter();
}

function applyFilter() {
    const cls = document.getElementById('classFilter').value;
    filteredStudents = cls === 'All' ? allStudents : allStudents.filter(s => s.class === cls);

    const atArr = filteredStudents.map(s => s.attendance);
    const scArr = filteredStudents.map(s => s.avg_score);
    const r = pearson(atArr, scArr);
    reg = { ...linReg(atArr, scArr), r };

    renderActiveTab();
}

document.getElementById('classFilter').addEventListener('change', applyFilter);

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
    if (!s.length) { document.getElementById('overviewMetrics').innerHTML = '<div class="loading-msg">No data</div>'; return; }
    const avgAtt = Math.round(s.reduce((a, b) => a + b.attendance, 0) / s.length);
    const avgSc = Math.round(s.reduce((a, b) => a + b.avg_score, 0) / s.length);
    const atRisk = s.filter(st => st.attendance < 60 || st.avg_score < 50).length;

    document.getElementById('overviewMetrics').innerHTML = `
        ${mc('Students', s.length, document.getElementById('classFilter').value)}
        ${mc('Avg attendance', avgAtt + '%', 'this semester')}
        ${mc('Avg score', avgSc + '%', 'midterm + final avg')}
        ${mc('At-risk', atRisk, 'need intervention', atRisk > 0 ? '#A32D2D' : '#0F6E56')}
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
        new Chart(document.getElementById('gradeChart'), {
            type: 'bar',
            data: { labels: gradeDist.map(d => d.g), datasets: [{ data: gradeDist.map(d => d.n), backgroundColor: ['#C0DD97','#85B7EB','#FAC775','#F0997B','#F09595'], borderRadius: 4, borderSkipped: false }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } } }, x: { ticks: { font: { size: 11 } } } } }
        });

        const trendPts = [60,65,70,75,80,85,90,95,100];
        new Chart(document.getElementById('trendChart'), {
            type: 'line',
            data: { labels: trendPts.map(v => v + '%'), datasets: [{ data: trendPts.map(v => clamp(reg.predict(v))), borderColor: '#0F6E56', borderWidth: 2, pointRadius: 3, fill: false }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 10 } } } } }
        });
    }, 50);

    document.getElementById('studentTableWrap').innerHTML = `
        <div style="font-size:13px;font-weight:500;margin-bottom:10px;">Student records</div>
        <div style="overflow-x:auto;">
        <table class="data-table">
            <thead><tr>
                <th>Name</th><th>Class</th><th>Roll</th><th>Att %</th>
                <th>Midterm</th><th>Final</th><th>Avg</th><th>Grade</th>
            </tr></thead>
            <tbody>
            ${s.map(st => `
                <tr class="${(st.attendance < 60 || st.avg_score < 50) ? 'risk' : ''}">
                    <td><strong>${st.name}</strong></td>
                    <td style="color:#888;">${st.class || '—'}</td>
                    <td style="color:#888;">${st.roll_number || '—'}</td>
                    <td class="${attClass(st.attendance)}">${st.attendance}%</td>
                    <td>${st.midterm ?? '—'}</td>
                    <td>${st.final_score ?? '—'}</td>
                    <td><strong>${st.avg_score}</strong></td>
                    <td><span class="grade-pill grade-${st.grade || 'F'}">${st.grade || '?'}</span></td>
                </tr>
            `).join('')}
            </tbody>
        </table>
        </div>
    `;
}

function mc(label, value, sub, color) {
    return `<div class="metric-card"><div class="label">${label}</div><div class="value" style="color:${color || '#333'}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
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
        ${mc('Pearson r', r.toFixed(3), corrLabel + ' positive correlation', corrColor)}
        ${mc('Regression slope', reg.slope.toFixed(2), 'score pts per 1% attendance')}
        ${mc('R² (variance explained)', (r * r * 100).toFixed(1) + '%', 'of score variance from attendance')}
        ${mc('Students analysed', s.length, 'in current filter')}
    `;

    document.getElementById('corrFormula').innerHTML =
        `Correlation = <strong>${r.toFixed(2)}</strong> — attendance explains <strong>${(r*r*100).toFixed(0)}%</strong> of score variance.<br>
         Formula: <code>score = ${reg.slope.toFixed(3)} × attendance + ${reg.intercept.toFixed(2)}</code>`;

    if (scatterInstance) { scatterInstance.destroy(); scatterInstance = null; }

    const scatterData = s.map(st => ({ x: st.attendance, y: st.avg_score, label: st.name }));
    const regLine = [30,40,50,60,70,80,90,100].map(x => ({ x, y: clamp(reg.predict(x)) }));

    setTimeout(() => {
        const ctx = document.getElementById('scatterChart');
        if (!ctx) return;
        scatterInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Students',
                        data: scatterData,
                        backgroundColor: 'rgba(55,138,221,0.75)',
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    {
                        label: 'Regression',
                        data: regLine,
                        type: 'line',
                        borderColor: '#E24B4A',
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const d = ctx.raw;
                                return d.label ? `${d.label}: att ${d.x}%, score ${d.y}` : `Regression: ${d.y}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { title: { display: true, text: 'Attendance (%)', font: { size: 11 } }, min: 20, max: 105, ticks: { font: { size: 10 } } },
                    y: { title: { display: true, text: 'Avg score', font: { size: 11 } }, min: 20, max: 105, ticks: { font: { size: 10 } } }
                }
            }
        });
    }, 50);
}

// ==========================================
// AT-RISK TAB
// ==========================================
function renderRisk() {
    const s = filteredStudents;
    const critical = s.filter(st => st.attendance < 50);
    const warning  = s.filter(st => st.attendance >= 50 && st.attendance < 60);
    const lowScore = s.filter(st => st.avg_score < 50);
    const double   = s.filter(st => st.attendance < 60 && st.avg_score < 50);
    const atRisk   = s.filter(st => st.attendance < 60 || st.avg_score < 50);

    document.getElementById('riskMetrics').innerHTML = `
        ${mc('Critical (att < 50%)', critical.length, 'immediate action', '#A32D2D')}
        ${mc('Warning (att 50–60%)', warning.length, 'monitor closely', '#BA7517')}
        ${mc('Low score (< 50)', lowScore.length, 'academic support', '#993C1D')}
        ${mc('Double risk', double.length, 'att + score both low', '#E24B4A')}
    `;

    if (!atRisk.length) {
        document.getElementById('riskList').innerHTML = '<div class="empty-box" style="background:#EAF3DE;color:#3B6D11;">No at-risk students found in this filter.</div>';
        return;
    }

    document.getElementById('riskList').innerHTML = atRisk.map(st => {
        const isCrit = st.attendance < 50;
        const attRisk = st.attendance < 60;
        const scRisk = st.avg_score < 50;
        const projScore = clamp(reg.predict(75));
        const rec = isCrit
            ? 'Immediate parent/guardian contact. Mandatory counselling session.'
            : attRisk
                ? 'Send attendance warning letter. Schedule teacher–student meeting.'
                : 'Assign peer tutor. Weekly progress check-in.';
        return `
        <div class="risk-card ${isCrit ? 'critical' : ''}">
            <div class="risk-header">
                <div>
                    <div class="risk-name">${st.name}</div>
                    <div class="risk-sub">${st.class || '—'} · Roll ${st.roll_number || '—'}</div>
                </div>
                <div class="risk-tags">
                    ${attRisk ? `<span class="tag tag-att">Att: ${st.attendance}%</span>` : ''}
                    ${scRisk  ? `<span class="tag tag-sc">Score: ${st.avg_score}</span>` : ''}
                    ${isCrit  ? `<span class="tag tag-crit">Critical</span>` : ''}
                </div>
            </div>
            <div class="risk-stats">
                <div><span>Midterm: </span>${st.midterm ?? '—'}</div>
                <div><span>Final: </span>${st.final_score ?? '—'}</div>
                <div><span>Avg: </span>${st.avg_score}</div>
                <div><span>Grade: </span>${st.grade || '?'}</div>
                <div><span>Predicted @ 75% att: </span><strong style="color:#185FA5;">${projScore}</strong></div>
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
                datasets: [{ data: pts.map(v => clamp(reg.predict(v))), borderColor: '#378ADD', borderWidth: 2, pointRadius: 3, fill: false }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { min: 0, max: 100, ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 10 } } } }
            }
        });
    }, 50);

    document.getElementById('modelDetails').innerHTML = [
        ['Algorithm', 'Ordinary Least Squares (linear regression)'],
        ['Feature', 'Attendance %'],
        ['Target', '(midterm + final) / 2'],
        ['Formula', `score = ${reg.slope.toFixed(3)} × att + ${reg.intercept.toFixed(2)}`],
        ['Pearson r', reg.r.toFixed(4)],
        ['R²', (reg.r * reg.r).toFixed(4)],
        ['Samples', filteredStudents.length],
        ['Data source', 'RFID attendance DB + grade portal import'],
    ].map(([k, v]) => `<div>${k}: <span>${v}</span></div>`).join('');
}

function updatePredictor() {
    const att = parseInt(document.getElementById('predSlider')?.value || 75);
    document.getElementById('predVal').textContent = att + '%';
    const sc = clamp(reg.predict(att));
    const g = gradeFromScore(sc);
    const gain = Math.round(reg.predict(att) - reg.predict(60));

    document.getElementById('predictBoxes').innerHTML = `
        <div class="predict-box">
            <div class="lbl">Predicted score</div>
            <div class="big" style="color:${g.color}">${sc}</div>
            <div class="note">${g.label}</div>
        </div>
        <div class="predict-box">
            <div class="lbl">Predicted grade</div>
            <div class="big" style="color:${g.color}">${g.grade}</div>
            <div class="note">linear regression model</div>
        </div>
        <div class="predict-box">
            <div class="lbl">Gain vs 60% att</div>
            <div class="big" style="color:${gain >= 0 ? '#0F6E56' : '#A32D2D'}">${gain >= 0 ? '+' : ''}${gain}</div>
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
    const avgSc  = Math.round(s.reduce((a, b) => a + b.avg_score, 0) / s.length);
    const atRisk = s.filter(st => st.attendance < 60 || st.avg_score < 50);

    document.getElementById('aiSummaryMetrics').innerHTML = `
        ${mc('Class', document.getElementById('classFilter').value)}
        ${mc('Pearson r', reg.r.toFixed(2), 'att ↔ score')}
        ${mc('At-risk', atRisk.length, 'flagged students')}
        ${mc('Avg score', avgSc + '%', 'class average')}
    `;
}

async function runAI() {
    const btn = document.getElementById('aiBtn');
    btn.disabled = true; btn.textContent = 'Analysing...';
    document.getElementById('aiOutput').innerHTML = '<div class="loading-msg">Sending data to Claude — analysing correlations, trends, and generating recommendations...</div>';

    const s = filteredStudents;
    const avgAtt = Math.round(s.reduce((a, b) => a + b.attendance, 0) / s.length);
    const avgSc  = Math.round(s.reduce((a, b) => a + b.avg_score, 0) / s.length);
    const atRisk = s.filter(st => st.attendance < 60 || st.avg_score < 50);
    const gradeDist = ['A','B','C','D','F'].map(g => `${g}:${s.filter(st => st.grade === g).length}`).join(', ');
    const cls = document.getElementById('classFilter').value;

    const summary = `Class: ${cls}
Students: ${s.length}
Avg Attendance: ${avgAtt}%
Avg Score: ${avgSc}%
Pearson Correlation (attendance vs score): ${reg.r.toFixed(2)}
Regression: score = ${reg.slope.toFixed(3)} × attendance + ${reg.intercept.toFixed(2)}
R²: ${(reg.r * reg.r).toFixed(3)}
Grade distribution: ${gradeDist}
At-risk students (${atRisk.length}): ${atRisk.map(st => `${st.name} (att:${st.attendance}%, score:${st.avg_score}, grade:${st.grade || '?'})`).join('; ')}`;

    try {
        const result = await apiFetch('/api/analytics/ai-insight', {
            method: 'POST',
            body: JSON.stringify({ summary })
        });
        if (result && result.success) {
            document.getElementById('aiOutput').innerHTML = `
                <div class="ai-output">
                    <div class="ai-output-title">Claude's analysis</div>
                    ${result.insight}
                </div>`;
        } else {
            document.getElementById('aiOutput').innerHTML = `<div class="empty-box">${result?.message || 'Failed to get AI insight.'}</div>`;
        }
    } catch {
        document.getElementById('aiOutput').innerHTML = '<div class="empty-box">Network error. Check API configuration.</div>';
    }

    btn.disabled = false; btn.textContent = 'Run AI analysis ↗';
}

// ==========================================
// GRADE IMPORT
// ==========================================
async function doImport() {
    const csv = document.getElementById('importCsv').value.trim();
    if (!csv) return;

    const lines = csv.split('\n').filter(Boolean);
    const rows = [];
    lines.forEach(line => {
        const p = line.split(',').map(s => s.trim());
        if (p.length >= 4) rows.push({ rollNumber: p[0], midterm: parseInt(p[1]), finalScore: parseInt(p[2]), grade: p[3] });
    });

    if (!rows.length) { document.getElementById('importMsg').textContent = 'No valid rows found.'; return; }

    const result = await apiFetch('/api/analytics/import-grades', {
        method: 'POST',
        body: JSON.stringify({ grades: rows })
    });

    if (result && result.success) {
        document.getElementById('importMsg').textContent = `Updated ${result.updated} records.`;
        document.getElementById('importCsv').value = '';
        await loadAnalytics();
    } else {
        document.getElementById('importMsg').textContent = result?.message || 'Import failed.';
    }
}

// ==========================================
// INIT
// ==========================================
loadAnalytics();