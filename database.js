/**
 * SQLite Database Configuration with Authentication
 * Enhanced for CT (1) + ST (multiple) assignments
 * WITH STUDENT PASSWORD SUPPORT
 */

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// Create/open database file
const dbPath = path.join(__dirname, 'attendance.db');
const db = new Database(dbPath);

console.log('✓ Database connected:', dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// ==========================================
// CREATE TABLES
// ==========================================

/**
 * Teachers Table - User Authentication
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'teacher', 'class_teacher', 'subject_teacher')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  )
`);

/**
 * Teacher Classes Assignment
 * Enhanced: is_class_teacher = 1 for CT, 0 for ST
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS teacher_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    class_name TEXT NOT NULL,
    is_class_teacher BOOLEAN DEFAULT 0,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    UNIQUE(teacher_id, class_name)
  )
`);

/**
 * Sessions Table - Login Sessions
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    teacher_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
  )
`);

/**
 * Students Table - WITH PASSWORD SUPPORT
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    class TEXT,
    roll_number TEXT,
    password_hash TEXT,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Attendance Table
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    student_id INTEGER,
    student_name TEXT,
    class TEXT,
    timestamp DATETIME NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
  )
`);

/**
 * Create indexes
 */
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_card_id ON students(card_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(timestamp);
  CREATE INDEX IF NOT EXISTS idx_attendance_card ON attendance(card_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON sessions(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_teacher_classes ON teacher_classes(teacher_id);
`);

// ==========================================
// ADD PASSWORD COLUMN TO EXISTING DATABASES
// ==========================================
const checkPasswordColumn = db.prepare(`
  SELECT COUNT(*) as count 
  FROM pragma_table_info('students') 
  WHERE name='password_hash'
`);

const passwordColumnExists = checkPasswordColumn.get();

if (passwordColumnExists.count === 0) {
  try {
    db.exec(`ALTER TABLE students ADD COLUMN password_hash TEXT`);
    console.log('✓ Added password_hash column to students table');
  } catch (error) {
    console.log('⚠️  Password column may already exist');
  }
}

console.log('✓ Database tables created/verified');

// ==========================================
// CREATE MARKS TABLE (if not exists)
// ==========================================
db.exec(`
  CREATE TABLE IF NOT EXISTS marks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id     INTEGER NOT NULL,
    class          TEXT NOT NULL,
    subject        TEXT NOT NULL,
    exam_type      TEXT NOT NULL,
    marks_obtained REAL NOT NULL,
    max_mark       REAL NOT NULL DEFAULT 100,
    grade          TEXT,
    entered_by     INTEGER,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    UNIQUE(student_id, subject, exam_type)
  )
`);

// Add marks table indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);
  CREATE INDEX IF NOT EXISTS idx_marks_class   ON marks(class);
  CREATE INDEX IF NOT EXISTS idx_marks_subject ON marks(subject, exam_type);
`);

console.log('✓ Marks table ready');

// ==========================================
// CREATE DEFAULT ADMIN (if not exists)
// ==========================================
const checkAdmin = db.prepare('SELECT COUNT(*) as count FROM teachers WHERE role = ?');
const adminExists = checkAdmin.get('admin');

if (adminExists.count === 0) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  const insertAdmin = db.prepare(`
    INSERT INTO teachers (username, password_hash, name, email, role)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  insertAdmin.run('admin', hashedPassword, 'System Administrator', 'admin@school.com', 'admin');
  console.log('✓ Default admin created - Username: admin, Password: admin123');
}

// ==========================================
// TEACHER OPERATIONS
// ==========================================

const createTeacher = db.prepare(`
  INSERT INTO teachers (username, password_hash, name, email, role)
  VALUES (?, ?, ?, ?, ?)
`);

const getTeacherByUsername = db.prepare(`
  SELECT * FROM teachers WHERE username = ?
`);

const getTeacherById = db.prepare(`
  SELECT id, username, name, email, role, created_at, last_login 
  FROM teachers WHERE id = ?
`);

const getAllTeachers = db.prepare(`
  SELECT id, username, name, email, role, created_at, last_login 
  FROM teachers ORDER BY name ASC
`);

const updateTeacher = db.prepare(`
  UPDATE teachers 
  SET name = ?, email = ?
  WHERE id = ?
`);

const updateTeacherRole = db.prepare(`
  UPDATE teachers 
  SET role = ?
  WHERE id = ?
`);

const deleteTeacher = db.prepare(`
  DELETE FROM teachers WHERE id = ?
`);

const updateLastLogin = db.prepare(`
  UPDATE teachers SET last_login = CURRENT_TIMESTAMP WHERE id = ?
`);

const updateTeacherPassword = db.prepare(`
  UPDATE teachers SET password_hash = ? WHERE id = ?
`);

// ==========================================
// SESSION OPERATIONS
// ==========================================

const createSession = db.prepare(`
  INSERT INTO sessions (session_id, teacher_id, expires_at)
  VALUES (?, ?, ?)
`);

const getSession = db.prepare(`
  SELECT s.*, t.id as teacher_id, t.username, t.name, t.email, t.role
  FROM sessions s
  JOIN teachers t ON s.teacher_id = t.id
  WHERE s.session_id = ? AND s.expires_at > CURRENT_TIMESTAMP
`);

const deleteSession = db.prepare(`
  DELETE FROM sessions WHERE session_id = ?
`);

const cleanExpiredSessions = db.prepare(`
  DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP
`);

// ==========================================
// TEACHER CLASS ASSIGNMENT
// ==========================================

const assignTeacherToClass = db.prepare(`
  INSERT OR REPLACE INTO teacher_classes (teacher_id, class_name, is_class_teacher)
  VALUES (?, ?, ?)
`);

const getTeacherClasses = db.prepare(`
  SELECT * FROM teacher_classes WHERE teacher_id = ?
`);

const getClassTeachers = db.prepare(`
  SELECT tc.*, t.name as teacher_name, t.email, t.role
  FROM teacher_classes tc
  JOIN teachers t ON tc.teacher_id = t.id
  WHERE tc.class_name = ?
`);

const removeTeacherFromClass = db.prepare(`
  DELETE FROM teacher_classes 
  WHERE teacher_id = ? AND class_name = ?
`);

const getAllClassAssignments = db.prepare(`
  SELECT tc.*, t.name as teacher_name, t.role
  FROM teacher_classes tc
  JOIN teachers t ON tc.teacher_id = t.id
  ORDER BY tc.class_name, tc.is_class_teacher DESC, t.name
`);

const getTeacherCTAssignment = db.prepare(`
  SELECT * FROM teacher_classes 
  WHERE teacher_id = ? AND is_class_teacher = 1
`);

const countCTAssignments = db.prepare(`
  SELECT COUNT(*) as count FROM teacher_classes 
  WHERE teacher_id = ? AND is_class_teacher = 1
`);

const getClassCT = db.prepare(`
  SELECT tc.*, t.name as teacher_name 
  FROM teacher_classes tc
  JOIN teachers t ON tc.teacher_id = t.id
  WHERE tc.class_name = ? AND tc.is_class_teacher = 1
`);

// ==========================================
// STUDENT OPERATIONS - WITH PASSWORD SUPPORT
// ==========================================

const registerStudent = db.prepare(`
  INSERT INTO students (card_id, name, class, roll_number, password_hash)
  VALUES (?, ?, ?, ?, ?)
`);

const getStudentByCardId = db.prepare(`
  SELECT * FROM students WHERE card_id = ?
`);

const getAllStudents = db.prepare(`
  SELECT * FROM students ORDER BY name ASC
`);

const getStudentsByClass = db.prepare(`
  SELECT * FROM students WHERE class = ? ORDER BY roll_number ASC
`);

const getStudentById = db.prepare(`
  SELECT * FROM students WHERE id = ?
`);

const updateStudent = db.prepare(`
  UPDATE students 
  SET card_id = ?, name = ?, class = ?, roll_number = ?
  WHERE id = ?
`);

const updateStudentWithPassword = db.prepare(`
  UPDATE students 
  SET card_id = ?, name = ?, class = ?, roll_number = ?, password_hash = ?
  WHERE id = ?
`);

const updateStudentPassword = db.prepare(`
  UPDATE students 
  SET password_hash = ?
  WHERE id = ?
`);

const deleteStudent = db.prepare(`
  DELETE FROM students WHERE id = ?
`);

const cardIdExists = db.prepare(`
  SELECT COUNT(*) as count FROM students WHERE card_id = ?
`);

// ==========================================
// ATTENDANCE OPERATIONS
// ==========================================

const recordAttendance = db.prepare(`
  INSERT INTO attendance (card_id, student_id, student_name, class, timestamp)
  VALUES (?, ?, ?, ?, ?)
`);

const getAllAttendance = db.prepare(`
  SELECT * FROM attendance ORDER BY recorded_at DESC LIMIT ?
`);

const getLatestAttendance = db.prepare(`
  SELECT * FROM attendance ORDER BY recorded_at DESC LIMIT 10
`);

const getTodayAttendance = db.prepare(`
  SELECT * FROM attendance 
  WHERE DATE(timestamp) = DATE('now')
  ORDER BY timestamp DESC
`);

const getTodayAttendanceByClass = db.prepare(`
  SELECT * FROM attendance 
  WHERE DATE(timestamp) = DATE('now') AND class = ?
  ORDER BY timestamp DESC
`);

const getAttendanceByClass = db.prepare(`
  SELECT * FROM attendance 
  WHERE class = ?
  ORDER BY timestamp DESC
  LIMIT ?
`);

const getAttendanceByDateRange = db.prepare(`
  SELECT * FROM attendance 
  WHERE DATE(timestamp) BETWEEN ? AND ?
  ORDER BY timestamp DESC
`);

const getStudentAttendance = db.prepare(`
  SELECT * FROM attendance 
  WHERE student_id = ?
  ORDER BY timestamp DESC
  LIMIT ?
`);

const getTodayAttendanceCount = db.prepare(`
  SELECT student_id, student_name, COUNT(*) as count
  FROM attendance
  WHERE DATE(timestamp) = DATE('now')
  GROUP BY student_id, student_name
`);

const getTodayCountByClass = db.prepare(`
  SELECT 
    COUNT(DISTINCT student_id) as present_count,
    class
  FROM attendance
  WHERE DATE(timestamp) = DATE('now') AND class = ?
  GROUP BY class
`);

const getAbsentStudentsByClass = db.prepare(`
  SELECT s.* 
  FROM students s
  WHERE s.class = ?
  AND s.id NOT IN (
    SELECT DISTINCT student_id 
    FROM attendance 
    WHERE DATE(timestamp) = DATE('now') AND student_id IS NOT NULL
  )
  ORDER BY s.roll_number
`);

const clearAllAttendance = db.prepare(`
  DELETE FROM attendance
`);

const getAttendanceStats = db.prepare(`
  SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT card_id) as unique_students,
    COUNT(CASE WHEN DATE(timestamp) = DATE('now') THEN 1 END) as today_count,
    MIN(timestamp) as first_record,
    MAX(timestamp) as last_record
  FROM attendance
`);

const getAttendanceStatsByClass = db.prepare(`
  SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT student_id) as unique_students,
    COUNT(CASE WHEN DATE(timestamp) = DATE('now') THEN 1 END) as today_count
  FROM attendance
  WHERE class = ?
`);

// ==========================================
// EXPORT DATABASE FUNCTIONS
// ==========================================

module.exports = {
  db,
  
  // Teacher operations
  teachers: {
    create: (username, password, name, email, role) => {
      const hashedPassword = bcrypt.hashSync(password, 10);
      return createTeacher.run(username, hashedPassword, name, email, role);
    },
    
    getByUsername: (username) => {
      return getTeacherByUsername.get(username);
    },
    
    getById: (id) => {
      return getTeacherById.get(id);
    },
    
    getAll: () => {
      return getAllTeachers.all();
    },
    
    update: (id, name, email) => {
      return updateTeacher.run(name, email, id);
    },
    
    updateRole: (id, role) => {
      return updateTeacherRole.run(role, id);
    },
    
    delete: (id) => {
      return deleteTeacher.run(id);
    },
    
    updateLastLogin: (id) => {
      return updateLastLogin.run(id);
    },

    updatePassword: (id, newPassword) => {
      const hashedPassword = bcrypt.hashSync(newPassword, 10);
      return updateTeacherPassword.run(hashedPassword, id);
    },

    verifyPassword: (plainPassword, hashedPassword) => {
      return bcrypt.compareSync(plainPassword, hashedPassword);
    }
  },
  
  // Session operations
  sessions: {
    create: (sessionId, teacherId, expiresAt) => {
      return createSession.run(sessionId, teacherId, expiresAt);
    },
    
    get: (sessionId) => {
      return getSession.get(sessionId);
    },
    
    delete: (sessionId) => {
      return deleteSession.run(sessionId);
    },
    
    cleanExpired: () => {
      return cleanExpiredSessions.run();
    }
  },
  
  // Teacher class assignments
  teacherClasses: {
    assign: (teacherId, className, isClassTeacher) => {
      return assignTeacherToClass.run(teacherId, className, isClassTeacher ? 1 : 0);
    },
    
    getByTeacher: (teacherId) => {
      return getTeacherClasses.all(teacherId);
    },
    
    getByClass: (className) => {
      return getClassTeachers.all(className);
    },
    
    remove: (teacherId, className) => {
      return removeTeacherFromClass.run(teacherId, className);
    },
    
    getAll: () => {
      return getAllClassAssignments.all();
    },
    
    getCTAssignment: (teacherId) => {
      return getTeacherCTAssignment.get(teacherId);
    },
    
    hasCTAssignment: (teacherId) => {
      const result = countCTAssignments.get(teacherId);
      return result.count > 0;
    },
    
    getClassCT: (className) => {
      return getClassCT.get(className);
    }
  },
  
  // Student operations - WITH PASSWORD SUPPORT
  students: {
    register: (cardId, name, studentClass, rollNumber, password) => {
      const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;
      return registerStudent.run(cardId, name, studentClass, rollNumber, hashedPassword);
    },
    
    getByCardId: (cardId) => {
      return getStudentByCardId.get(cardId);
    },
    
    getById: (id) => {
      return getStudentById.get(id);
    },
    
    getAll: () => {
      return getAllStudents.all();
    },
    
    getByClass: (className) => {
      return getStudentsByClass.all(className);
    },
    
    update: (id, cardId, name, studentClass, rollNumber, password) => {
      if (password) {
        // Update with new password
        const hashedPassword = bcrypt.hashSync(password, 10);
        return updateStudentWithPassword.run(cardId, name, studentClass, rollNumber, hashedPassword, id);
      } else {
        // Update without changing password
        return updateStudent.run(cardId, name, studentClass, rollNumber, id);
      }
    },
    
    updatePassword: (id, newPassword) => {
      const hashedPassword = bcrypt.hashSync(newPassword, 10);
      return updateStudentPassword.run(hashedPassword, id);
    },
    
    verifyPassword: (plainPassword, hashedPassword) => {
      if (!hashedPassword) return false;
      return bcrypt.compareSync(plainPassword, hashedPassword);
    },
    
    delete: (id) => {
      return deleteStudent.run(id);
    },
    
    cardExists: (cardId) => {
      const result = cardIdExists.get(cardId);
      return result.count > 0;
    }
  },
  
  // Attendance operations
  attendance: {
    record: (cardId, studentId, studentName, studentClass, timestamp) => {
      return recordAttendance.run(cardId, studentId, studentName, studentClass, timestamp);
    },
    
    getAll: (limit = 100) => {
      return getAllAttendance.all(limit);
    },
    
    getLatest: () => {
      return getLatestAttendance.all();
    },
    
    getToday: () => {
      return getTodayAttendance.all();
    },
    
    getTodayByClass: (className) => {
      return getTodayAttendanceByClass.all(className);
    },
    
    getByClass: (className, limit = 100) => {
      return getAttendanceByClass.all(className, limit);
    },
    
    getByDateRange: (startDate, endDate) => {
      return getAttendanceByDateRange.all(startDate, endDate);
    },
    
    getByStudent: (studentId, limit = 50) => {
      return getStudentAttendance.all(studentId, limit);
    },
    
    getTodayCount: () => {
      return getTodayAttendanceCount.all();
    },
    
    getTodayCountByClass: (className) => {
      const result = getTodayCountByClass.get(className);
      return result ? result.present_count : 0;
    },
    
    getAbsentByClass: (className) => {
      return getAbsentStudentsByClass.all(className);
    },
    
    clearAll: () => {
      return clearAllAttendance.run();
    },
    
    getStats: () => {
      return getAttendanceStats.get();
    },
    
    getStatsByClass: (className) => {
      return getAttendanceStatsByClass.get(className);
    },
    
    getCountByStudent: (studentId) => {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM attendance 
        WHERE student_id = ?
      `);
      const result = stmt.get(studentId);
      return result.count;
    },
    
    getLastByStudent: (studentId) => {
      const stmt = db.prepare(`
        SELECT * FROM attendance 
        WHERE student_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 1
      `);
      return stmt.get(studentId);
    },
    
    getByStudentId: (studentId, limit = 50) => {
      const stmt = db.prepare(`
        SELECT * FROM attendance 
        WHERE student_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `);
      return stmt.all(studentId, limit);
    }
  }

  
};

