// ── DEEPLINK: restore tab if navigated from analytics page ───────────────────
// Paste this block at the very TOP of admin-dashboard.js (before everything else)
(function restoreTabFromDeeplink() {
    const target = sessionStorage.getItem('adminTab');
    if (!target) return;
    sessionStorage.removeItem('adminTab');

    // Wait for DOM to be ready then click the right nav item
    window.addEventListener('DOMContentLoaded', () => {
        const navItem = document.querySelector(`.nav-item[data-tab="${target}"]`);
        if (navItem) navItem.click();
    });
})();
// ─────────────────────────────────────────────────────────────────────────────


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

if (!sessionId || currentUser.role !== 'admin') {
    window.location.href = '/index.html';
}

// ==========================================
// DOM ELEMENTS
// ==========================================
const logoutBtn = document.getElementById('logoutBtn');
const userName = document.getElementById('userName');
const currentDate = document.getElementById('currentDate');
const pageTitle = document.getElementById('pageTitle');

const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

const addTeacherModal = document.getElementById('addTeacherModal');
const editTeacherModal = document.getElementById('editTeacherModal');
const assignClassModal = document.getElementById('assignClassModal');
const addStudentModal = document.getElementById('addStudentModal');
const editStudentModal = document.getElementById('editStudentModal');
const bulkImportModal = document.getElementById('bulkImportModal');

const addTeacherBtn = document.getElementById('addTeacherBtn');
const assignClassBtn = document.getElementById('assignClassBtn');
const addStudentBtn = document.getElementById('addStudentBtn');
const refreshAttendanceBtn = document.getElementById('refreshAttendanceBtn');
const clearAttendanceBtn = document.getElementById('clearAttendanceBtn');

const closeModalBtns = document.querySelectorAll('.close-modal, .cancel-btn');

// Set user name and date
userName.textContent = currentUser.name || 'Admin';
currentDate.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
});

// ==========================================
// TAB NAVIGATION
// ==========================================
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        const tabName = item.dataset.tab;

        // Skip tab switching for external page links (no data-tab attribute)
        if (!tabName) {
            return; // Let the default href navigation happen
        }

        e.preventDefault();

        navItems.forEach(nav => nav.classList.remove('active'));
        tabContents.forEach(tab => tab.classList.remove('active'));

        item.classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');

        const titles = {
            'teachers': 'Manage Teachers',
            'assignments': 'Class Assignments',
            'students': 'Manage Students',
            'attendance': 'Attendance Records'
        };
        pageTitle.textContent = titles[tabName] || 'Dashboard';

        loadTabData(tabName);
    });
});

// ==========================================
// API HELPER FUNCTIONS
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
            localStorage.removeItem('sessionId');
            localStorage.removeItem('user');
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
// LOAD TAB DATA
// ==========================================
function loadTabData(tabName) {
    switch(tabName) {
        case 'teachers':
            loadTeachers();
            break;
        case 'assignments':
            loadAssignments();
            break;
        case 'students':
            loadStudents();
            break;
        case 'attendance':
            loadAttendance();
            break;
    }
}

// ==========================================
// TEACHERS MANAGEMENT
// ==========================================
async function loadTeachers() {
    const teachersList = document.getElementById('teachersList');
    teachersList.innerHTML = '<p class="loading">Loading teachers...</p>';

    const result = await apiCall('/admin/teachers');

    if (!result || !result.success) {
        teachersList.innerHTML = '<p class="empty-state">Failed to load teachers</p>';
        return;
    }

    if (result.data.length === 0) {
        teachersList.innerHTML = '<p class="empty-state">No teachers found</p>';
        return;
    }

    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Email</th>
                    <th>CT of</th>
                    <th>ST of</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    result.data.forEach(teacher => {
        if (teacher.role === 'admin') return;

        // Format class display with section (new model)
        const formatClass = (c) => c.section ? `${c.class_name}-${c.section}` : c.class_name;

        const ctClasses = teacher.classes.filter(c => c.is_class_teacher).map(formatClass);
        const stClasses = teacher.classes.filter(c => !c.is_class_teacher).map(formatClass);

        const ctDisplay = ctClasses.length > 0 ?
            `<strong style="color: #4caf50;">${ctClasses.join(', ')}</strong>` :
            '<span style="color: #999;">Not assigned</span>';

        const stDisplay = stClasses.length > 0 ?
            `<span style="color: #2196f3;">${stClasses.join(', ')}</span>` :
            '<span style="color: #999;">Not assigned</span>';

        html += `
            <tr>
                <td><strong>${teacher.name}</strong></td>
                <td>${teacher.username}</td>
                <td>${teacher.email}</td>
                <td>${ctDisplay}</td>
                <td>${stDisplay}</td>
                <td>
                    <button class="btn-secondary btn-sm" onclick="editTeacher(${teacher.id})">✏️ Edit</button>
                    <button class="btn-danger btn-sm" onclick="deleteTeacher(${teacher.id})">🗑️ Delete</button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    teachersList.innerHTML = html;
}

async function editTeacher(teacherId) {
    const result = await apiCall(`/admin/teachers`);

    if (!result || !result.success) {
        alert('Failed to load teachers');
        return;
    }

    const teacher = result.data.find(t => t.id === teacherId);
    if (!teacher) {
        alert('Teacher not found');
        return;
    }

    document.getElementById('editTeacherId').value = teacher.id;
    document.getElementById('editTeacherName').value = teacher.name;
    document.getElementById('editTeacherEmail').value = teacher.email;
    document.getElementById('editTeacherPassword').value = '';

    editTeacherModal.classList.add('active');
}

async function deleteTeacher(teacherId) {
    if (!confirm('Are you sure you want to delete this teacher? All their class assignments will be removed.')) {
        return;
    }

    const result = await apiCall(`/admin/teachers/${teacherId}`, {
        method: 'DELETE'
    });

    if (result && result.success) {
        alert('Teacher deleted successfully');
        loadTeachers();
    } else {
        alert('Failed to delete teacher');
    }
}

// ==========================================
// CLASS ASSIGNMENTS
// ==========================================
async function loadAssignments() {
    const assignmentsList = document.getElementById('assignmentsList');
    assignmentsList.innerHTML = '<p class="loading">Loading assignments...</p>';

    const result = await apiCall('/admin/class-assignments');

    if (!result || !result.success) {
        assignmentsList.innerHTML = '<p class="empty-state">Failed to load assignments</p>';
        return;
    }

    if (result.data.length === 0) {
        assignmentsList.innerHTML = '<p class="empty-state">No class assignments yet</p>';
        return;
    }

    const groupedByClass = {};
    result.data.forEach(assignment => {
        const key = assignment.section ? `${assignment.class_name}-${assignment.section}` : assignment.class_name;
        if (!groupedByClass[key]) {
            groupedByClass[key] = { class_name: assignment.class_name, section: assignment.section, ct: null, sts: [] };
        }

        if (assignment.is_class_teacher) {
            groupedByClass[key].ct = assignment;
        } else {
            groupedByClass[key].sts.push(assignment);
        }
    });

    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Class</th>
                    <th>Class Teacher (CT)</th>
                    <th>Subject Teachers (ST)</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    Object.keys(groupedByClass).sort().forEach(key => {
        const data = groupedByClass[key];
        const ctName = data.ct ? data.ct.teacher_name : '<span style="color: #f44336;">⚠️ No CT assigned</span>';
        const stNames = data.sts.length > 0 ?
            data.sts.map(st => st.teacher_name).join(', ') :
            '<span style="color: #999;">None</span>';

        html += `
            <tr>
                <td><strong>${key}</strong></td>
                <td>${ctName}${data.ct ? ` <button class="btn-sm btn-danger" onclick="removeAssignment(${data.ct.teacher_id}, '${data.class_name}', '${data.section || ''}')">✕</button>` : ''}</td>
                <td>
                    ${data.sts.map(st => `
                        ${st.teacher_name} <button class="btn-sm btn-danger" onclick="removeAssignment(${st.teacher_id}, '${data.class_name}', '${data.section || ''}')">✕</button>
                    `).join('<br>')}
                    ${data.sts.length === 0 ? stNames : ''}
                </td>
                <td>
                    <button class="btn-secondary btn-sm" onclick="quickAssignST('${data.class_name}', '${data.section || ''}')">+ Add ST</button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    assignmentsList.innerHTML = html;
}

async function removeAssignment(teacherId, className, section) {
    const displayName = section ? `${className}-${section}` : className;
    if (!confirm(`Remove teacher from ${displayName}?`)) {
        return;
    }

    const result = await apiCall('/admin/assign-class', {
        method: 'DELETE',
        body: JSON.stringify({ teacherId, className, section })
    });

    if (result && result.success) {
        alert('Assignment removed successfully');
        loadAssignments();
    } else {
        alert(result?.message || 'Failed to remove assignment');
    }
}

async function quickAssignST(className, section) {
    const displayName = section ? `${className}-${section}` : className;
    const result = await apiCall('/admin/teachers');

    if (!result || !result.success) {
        alert('Failed to load teachers');
        return;
    }

    const teachers = result.data;
    const teacherNames = teachers.map(t => `${t.id}. ${t.name}`).join('\n');

    const teacherId = prompt(`Assign Subject Teacher to ${displayName}\n\nEnter Teacher ID:\n\n${teacherNames}`);

    if (!teacherId) return;

    const assignResult = await apiCall('/admin/assign-class', {
        method: 'POST',
        body: JSON.stringify({
            teacherId: parseInt(teacherId),
            className: className,
            section: section,
            isClassTeacher: false
        })
    });

    if (assignResult && assignResult.success) {
        alert('Subject Teacher assigned successfully');
        loadAssignments();
    } else {
        alert(assignResult?.message || 'Failed to assign teacher');
    }
}

// ==========================================
// STUDENTS MANAGEMENT
// ==========================================
async function loadStudents() {
    const studentsList = document.getElementById('studentsList');
    studentsList.innerHTML = '<p class="loading">Loading students...</p>';

    const result = await apiCall('/admin/students');

    if (!result || !result.success) {
        studentsList.innerHTML = '<p class="empty-state">Failed to load students</p>';
        return;
    }

    if (result.data.length === 0) {
        studentsList.innerHTML = '<p class="empty-state">No students registered yet</p>';
        return;
    }

    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Card ID</th>
                    <th>Class</th>
                    <th>Roll</th>
                    <th>Pass</th>
                    <th>Attend</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    result.data.forEach(student => {
        const lastSeen = student.stats.lastSeen ?
            new Date(student.stats.lastSeen).toLocaleString() :
            'Never';

        const hasPassword = student.password_hash ?
            '<span style="color: green;">✓</span>' :
            '<span style="color: red;">✗</span>';

        const classDisplay = student.section ? `${student.class}-${student.section}` : (student.class || 'N/A');

        html += `
            <tr>
                <td><strong>${student.name}</strong></td>
                <td><code>${student.card_id}</code></td>
                <td>${classDisplay}</td>
                <td>${student.roll_number || 'N/A'}</td>
                <td>${hasPassword}</td>
                <td><span style="color: #2196f3; font-weight: bold;">${student.stats.totalAttendance}</span></td>
                <td>
                    <button class="btn-secondary btn-sm" onclick="editStudent(${student.id})">✏️</button>
                    <button class="btn-warning btn-sm" onclick="resetStudentPassword(${student.id}, '${student.name}')">🔑</button>
                    <button class="btn-danger btn-sm" onclick="deleteStudent(${student.id})">🗑️</button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    studentsList.innerHTML = html;
}

async function editStudent(studentId) {
    const result = await apiCall(`/admin/students/${studentId}`);
    
    if (!result || !result.success) {
        alert('Failed to load student details');
        return;
    }

    const student = result.data;

    document.getElementById('editStudentId').value = student.id;
    document.getElementById('editCardId').value = student.card_id;
    document.getElementById('editName').value = student.name;
    document.getElementById('editClass').value = student.class || '';
    document.getElementById('editSection').value = student.section || '';
    document.getElementById('editRollNumber').value = student.roll_number || '';

    document.getElementById('editStudentStats').innerHTML = `
        <div style="background: #f0f0f0; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
            <strong>📊 Student Statistics:</strong><br>
            <span style="color: #2196f3;">Total Attendance: ${student.stats.totalAttendance}</span><br>
            <span style="color: #666;">Registered: ${new Date(student.registered_at).toLocaleDateString()}</span>
        </div>
    `;

    editStudentModal.classList.add('active');
}

async function deleteStudent(studentId) {
    const result = await apiCall(`/admin/students/${studentId}`);
    
    if (!result || !result.success) {
        alert('Failed to load student details');
        return;
    }

    const student = result.data;

    const classDisplay = student.section ? `${student.class}-${student.section}` : student.class;
    if (!confirm(`⚠️ Delete student "${student.name}"?\n\nCard ID: ${student.card_id}\nClass: ${classDisplay || 'N/A'}\n\nThis action cannot be undone!`)) {
        return;
    }

    const deleteResult = await apiCall(`/admin/students/${studentId}`, {
        method: 'DELETE'
    });

    if (deleteResult && deleteResult.success) {
        alert('✓ Student deleted successfully');
        loadStudents();
    } else {
        alert('✗ Failed to delete student: ' + (deleteResult?.message || 'Unknown error'));
    }
}

async function resetStudentPassword(studentId, studentName) {
    const newPassword = prompt(`🔑 Reset Password for ${studentName}\n\nEnter new password (minimum 4 characters):`);

    if (!newPassword) return;

    if (newPassword.length < 4) {
        alert('❌ Password must be at least 4 characters');
        return;
    }

    const confirmPassword = prompt('Confirm new password:');

    if (newPassword !== confirmPassword) {
        alert('❌ Passwords do not match');
        return;
    }

    const result = await apiCall('/api/student/reset-password', {
        method: 'POST',
        body: JSON.stringify({
            studentId: studentId,
            newPassword: newPassword
        })
    });

    if (result && result.success) {
        alert(`✅ Password reset successfully for ${studentName}\n\nNew password: ${newPassword}\n\n⚠️ Please give this password to the student.`);
    } else {
        alert('❌ Failed to reset password: ' + (result?.message || 'Unknown error'));
    }
}

// ==========================================
// ATTENDANCE RECORDS
// ==========================================
async function loadAttendance() {
    const attendanceList = document.getElementById('attendanceList');
    attendanceList.innerHTML = '<p class="loading">Loading attendance...</p>';

    const statsResult = await apiCall('/attendance/stats');
    const recordsResult = await apiCall('/attendance/latest');

    if (statsResult && statsResult.success) {
        document.getElementById('totalRecords').textContent = statsResult.data.total_records || 0;
        document.getElementById('todayCount').textContent = statsResult.data.today_count || 0;
        document.getElementById('uniqueStudents').textContent = statsResult.data.unique_students || 0;
    }

    if (!recordsResult || !recordsResult.success) {
        attendanceList.innerHTML = '<p class="empty-state">Failed to load attendance records</p>';
        return;
    }

    if (recordsResult.data.length === 0) {
        attendanceList.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #999;">
                <div style="font-size: 64px; margin-bottom: 20px;">📋</div>
                <h3 style="color: #666;">No attendance records yet</h3>
                <p>Records will appear here when students scan their cards</p>
            </div>
        `;
        return;
    }

    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Student Name</th>
                    <th>Class</th>
                    <th>Card ID</th>
                    <th>Timestamp</th>
                </tr>
            </thead>
            <tbody>
    `;

    recordsResult.data.forEach(record => {
        const timestamp = new Date(record.timestamp).toLocaleString();
        
        html += `
            <tr>
                <td><strong>${record.student_name}</strong></td>
                <td>${record.class}</td>
                <td><code>${record.card_id}</code></td>
                <td>${timestamp}</td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    attendanceList.innerHTML = html;
}

async function clearAllAttendance() {
    const firstConfirm = confirm(
        '⚠️ WARNING: Clear ALL Attendance Records?\n\n' +
        'This will DELETE all attendance data permanently!\n\n' +
        'This action CANNOT be undone!\n\n' +
        'Are you sure you want to continue?'
    );

    if (!firstConfirm) return;

    const secondConfirm = prompt(
        '🔴 FINAL WARNING!\n\n' +
        'Type "DELETE ALL" to confirm deletion of all attendance records:\n\n' +
        '(Type exactly: DELETE ALL)'
    );

    if (secondConfirm !== 'DELETE ALL') {
        alert('❌ Cancelled - Incorrect confirmation text');
        return;
    }

    const attendanceList = document.getElementById('attendanceList');
    const originalContent = attendanceList.innerHTML;
    attendanceList.innerHTML = '<p class="loading">⏳ Deleting all records...</p>';

    try {
        const result = await apiCall('/attendance/clear', {
            method: 'DELETE'
        });

        if (result && result.success) {
            alert(`✅ Success!\n\nDeleted ${result.message || 'all attendance records'}`);
            loadAttendance();
            document.getElementById('totalRecords').textContent = '0';
            document.getElementById('todayCount').textContent = '0';
            document.getElementById('uniqueStudents').textContent = '0';
        } else {
            alert('❌ Failed to clear attendance: ' + (result?.message || 'Unknown error'));
            attendanceList.innerHTML = originalContent;
        }
    } catch (error) {
        alert('❌ Error: ' + error.message);
        attendanceList.innerHTML = originalContent;
    }
}

// ==========================================
// MODAL HANDLERS
// ==========================================
if (clearAttendanceBtn) {
    clearAttendanceBtn.addEventListener('click', clearAllAttendance);
}

addTeacherBtn.addEventListener('click', () => {
    addTeacherModal.classList.add('active');
});

assignClassBtn.addEventListener('click', async () => {
    const result = await apiCall('/admin/teachers');
    const teacherSelect = document.getElementById('teacherSelect');

    teacherSelect.innerHTML = '<option value="">-- Select Teacher --</option>';

    if (result && result.success) {
        result.data.forEach(teacher => {
            if (teacher.role === 'admin') return;

            // Format class display with section (new model)
            const formatClass = (c) => c.section ? `${c.class_name}-${c.section}` : c.class_name;

            const ctClass = teacher.classes.find(c => c.is_class_teacher);
            const ctDisplay = ctClass ? formatClass(ctClass) : '';
            const ctInfo = ctClass ? ` [CT of ${ctDisplay}]` : '';
            const stCount = teacher.classes.filter(c => !c.is_class_teacher).length;
            const stInfo = stCount > 0 ? ` [ST of ${stCount} classes]` : '';

            teacherSelect.innerHTML += `<option value="${teacher.id}">${teacher.name}${ctInfo}${stInfo}</option>`;
        });
    }

    assignClassModal.classList.add('active');
});

addStudentBtn.addEventListener('click', () => {
    addStudentModal.classList.add('active');
});

closeModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        addTeacherModal.classList.remove('active');
        editTeacherModal.classList.remove('active');
        assignClassModal.classList.remove('active');
        addStudentModal.classList.remove('active');
        editStudentModal.classList.remove('active');
        bulkImportModal.classList.remove('active');
    });
});

// ==========================================
// FORM SUBMISSIONS
// ==========================================
document.getElementById('addTeacherForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const data = {
        username: formData.get('username'),
        password: formData.get('password'),
        name: formData.get('name'),
        email: formData.get('email'),
        role: 'class_teacher'
    };

    const result = await apiCall('/admin/teachers', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (result && result.success) {
        alert('Teacher created successfully! Now assign them to classes in the "Class Assignments" tab.');
        addTeacherModal.classList.remove('active');
        e.target.reset();
        loadTeachers();
    } else {
        alert(result?.message || 'Failed to create teacher');
    }
});

document.getElementById('editTeacherForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const teacherId = formData.get('teacherId');
    const newPassword = formData.get('newPassword');

    const data = {
        name: formData.get('name'),
        email: formData.get('email')
    };

    // First update name and email
    const updateResult = await apiCall(`/admin/teachers/${teacherId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    });

    if (!updateResult || !updateResult.success) {
        alert('Failed to update teacher details');
        return;
    }

    // Then reset password if provided
    if (newPassword && newPassword.trim() !== '') {
        if (newPassword.length < 4) {
            alert('Password must be at least 4 characters');
            return;
        }

        const passwordResult = await apiCall(`/admin/teachers/${teacherId}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ newPassword })
        });

        if (!passwordResult || !passwordResult.success) {
            alert('Teacher details updated but password reset failed');
            return;
        }
    }

    alert('✓ Teacher updated successfully');
    editTeacherModal.classList.remove('active');
    e.target.reset();
    loadTeachers();
});

document.getElementById('assignClassForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const isClassTeacherValue = formData.get('isClassTeacher');
    const isClassTeacher = isClassTeacherValue === '1' || isClassTeacherValue === 'true';
    
    const data = {
        teacherId: parseInt(formData.get('teacherId')),
        className: formData.get('className'),
        section: formData.get('section') || null,
        isClassTeacher: isClassTeacher
    };

    const result = await apiCall('/admin/assign-class', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (result && result.success) {
        alert(result.message || 'Class assigned successfully');
        assignClassModal.classList.remove('active');
        e.target.reset();
        loadAssignments();
        loadTeachers();
    } else {
        alert(result?.message || 'Failed to assign class');
    }
});

document.getElementById('addStudentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const data = {
        cardId: formData.get('cardId'),
        name: formData.get('name'),
        studentClass: formData.get('studentClass'),
        section: formData.get('section') || null,
        rollNumber: formData.get('rollNumber'),
        password: formData.get('password')
    };

    if (!data.password || data.password.length < 4) {
        alert('❌ Password must be at least 4 characters');
        return;
    }

    const result = await apiCall('/students/register', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (result && result.success) {
        alert('✓ Student registered successfully with password');
        addStudentModal.classList.remove('active');
        e.target.reset();
        loadStudents();
    } else {
        alert('✗ Failed to register student: ' + (result?.message || 'Unknown error'));
    }
});

document.getElementById('editStudentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const studentId = formData.get('studentId');
    const newPassword = formData.get('newPassword');
    
    const data = {
        cardId: formData.get('cardId'),
        name: formData.get('name'),
        studentClass: formData.get('studentClass'),
        section: formData.get('section') || null,
        rollNumber: formData.get('rollNumber')
    };

    if (newPassword && newPassword.trim() !== '') {
        if (newPassword.length < 4) {
            alert('❌ Password must be at least 4 characters');
            return;
        }
        data.password = newPassword;
    }

    const result = await apiCall(`/admin/students/${studentId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    });

    if (result && result.success) {
        alert('✓ Student updated successfully');
        editStudentModal.classList.remove('active');
        e.target.reset();
        loadStudents();
    } else {
        alert('✗ Failed to update student: ' + (result?.message || 'Unknown error'));
    }
});

document.getElementById('bulkImportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const csvText = formData.get('csvData');

    if (!csvText.trim()) {
        alert('Please enter CSV data');
        return;
    }

    const lines = csvText.trim().split('\n');
    const students = [];

    lines.forEach((line, index) => {
        if (index === 0 && line.toLowerCase().includes('card')) {
            return;
        }

        const parts = line.split(',').map(p => p.trim());
        
        if (parts.length >= 2) {
            students.push({
                cardId: parts[0],
                name: parts[1],
                studentClass: parts[2] || null,
                section: parts[3] || null,
                rollNumber: parts[4] || null
            });
        }
    });

    if (students.length === 0) {
        alert('No valid student data found');
        return;
    }

    const result = await apiCall('/admin/students/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ students })
    });

    if (result && result.success) {
        const { success, failed, errors } = result.data;
        let message = `✓ Import complete!\n\nSuccess: ${success}\nFailed: ${failed}`;
        
        if (errors.length > 0 && errors.length <= 5) {
            message += '\n\nErrors:\n' + errors.map(e => `Row ${e.row}: ${e.error}`).join('\n');
        }
        
        alert(message);
        bulkImportModal.classList.remove('active');
        e.target.reset();
        loadStudents();
    } else {
        alert('✗ Failed to import students');
    }
});

refreshAttendanceBtn.addEventListener('click', loadAttendance);

// ==========================================
// LOGOUT
// ==========================================
logoutBtn.addEventListener('click', async () => {
    await apiCall('/auth/logout', { method: 'POST' });
    localStorage.removeItem('sessionId');
    localStorage.removeItem('user');
    window.location.href = '/index.html';
});

// ==========================================
// LOAD INITIAL DATA
// ==========================================
loadTeachers();