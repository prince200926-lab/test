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
let db;

try {
  db = new Database(dbPath);
  console.log('✓ Database connected:', dbPath);
} catch (error) {
  console.error('✗ Database connection failed:', error.message);
  console.error('Please check:');
  console.error('  1. The disk has enough space');
  console.error('  2. You have write permissions for:', dbPath);
  console.error('  3. The database file is not corrupted');
  process.exit(1);
}

// Enable foreign keys
db.pragma('foreign_keys = ON');

// OPT-006: Enable WAL mode for better concurrent read/write performance
// WAL = Write-Ahead Logging allows readers to not block writers
// synchronous = NORMAL balances durability with performance
try {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = memory');
  db.pragma('mmap_size = 30000000000');  // ~30GB memory mapped I/O
  console.log('✓ Database optimized: WAL mode enabled');
} catch (error) {
  console.warn('⚠ Could not enable WAL mode:', error.message);
}

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
    section TEXT,
    is_class_teacher BOOLEAN DEFAULT 0,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    UNIQUE(teacher_id, class_name, section)
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
 * Students Table - WITH PASSWORD SUPPORT and SEPARATE SECTION FIELD
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    class TEXT,
    section TEXT,
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
    section TEXT,
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
console.log('✓ Class/Section migration complete - using separate columns model');

// ==========================================
// MIGRATE CLASS DATA - Split combined values into class and section
// ==========================================

// Helper function to parse combined class names
function parseClassName(className) {
  if (!className) return { base: '', section: '' };

  // Check if it has a hyphen (e.g., "10-A", "11-Science")
  if (className.includes('-')) {
    const parts = className.split('-');
    return { base: parts[0], section: parts[1] || '' };
  }

  // No hyphen - extract digits for base, letters for section
  // Examples: "11B" -> base: "11", section: "B"
  // "10A" -> base: "10", section: "A"
  // "12Science" -> base: "12", section: "Science"
  const match = className.match(/^(\d+)([a-zA-Z]+)$/);
  if (match) {
    return { base: match[1], section: match[2] };
  }

  // Just numbers - no section
  const numMatch = className.match(/^(\d+)$/);
  if (numMatch) {
    return { base: numMatch[1], section: '' };
  }

  return { base: className, section: '' };
}

// Check if section column exists in students table
const checkStudentsSectionColumn = db.prepare(`
  SELECT COUNT(*) as count
  FROM pragma_table_info('students')
  WHERE name='section'
`);

const studentsSectionExists = checkStudentsSectionColumn.get();

if (studentsSectionExists.count === 0) {
  try {
    db.exec(`ALTER TABLE students ADD COLUMN section TEXT`);
    console.log('✓ Added section column to students table');
  } catch (error) {
    console.log('⚠️  Section column may already exist in students table');
  }
}

// Check if section column exists in attendance table
const checkAttendanceSectionColumn = db.prepare(`
  SELECT COUNT(*) as count
  FROM pragma_table_info('attendance')
  WHERE name='section'
`);

const attendanceSectionExists = checkAttendanceSectionColumn.get();

if (attendanceSectionExists.count === 0) {
  try {
    db.exec(`ALTER TABLE attendance ADD COLUMN section TEXT`);
    console.log('✓ Added section column to attendance table');
  } catch (error) {
    console.log('⚠️  Section column may already exist in attendance table');
  }
}

// Check if section column exists in marks table
const checkMarksSectionColumn = db.prepare(`
  SELECT COUNT(*) as count
  FROM pragma_table_info('marks')
  WHERE name='section'
`);

const marksSectionExists = checkMarksSectionColumn.get();

if (marksSectionExists.count === 0) {
  try {
    db.exec(`ALTER TABLE marks ADD COLUMN section TEXT`);
    console.log('✓ Added section column to marks table');
  } catch (error) {
    console.log('⚠️  Section column may already exist in marks table');
  }
}

// Check if section column exists in teacher_classes table
const checkTeacherClassesSectionColumn = db.prepare(`
  SELECT COUNT(*) as count
  FROM pragma_table_info('teacher_classes')
  WHERE name='section'
`);

const teacherClassesSectionExists = checkTeacherClassesSectionColumn.get();

if (teacherClassesSectionExists.count === 0) {
  try {
    db.exec(`ALTER TABLE teacher_classes ADD COLUMN section TEXT`);
    console.log('✓ Added section column to teacher_classes table');
  } catch (error) {
    console.log('⚠️  Section column may already exist in teacher_classes table');
  }
}

// Migrate existing data in students table
const migrateStudents = db.prepare(`
  UPDATE students SET class = ?, section = ? WHERE id = ?
`);

const studentsToMigrate = db.prepare(`SELECT id, class FROM students WHERE class IS NOT NULL AND (section IS NULL OR section = '')`).all();

let migratedStudents = 0;
for (const student of studentsToMigrate) {
  const parsed = parseClassName(student.class);
  if (parsed.section) {
    migrateStudents.run(parsed.base, parsed.section, student.id);
    migratedStudents++;
  }
}
if (migratedStudents > 0) {
  console.log(`✓ Migrated ${migratedStudents} students to separate class/section`);
}

// Migrate existing data in attendance table
const migrateAttendance = db.prepare(`
  UPDATE attendance SET class = ?, section = ? WHERE id = ?
`);

const attendanceToMigrate = db.prepare(`SELECT id, class FROM attendance WHERE class IS NOT NULL AND (section IS NULL OR section = '')`).all();

let migratedAttendance = 0;
for (const record of attendanceToMigrate) {
  const parsed = parseClassName(record.class);
  if (parsed.section) {
    migrateAttendance.run(parsed.base, parsed.section, record.id);
    migratedAttendance++;
  }
}
if (migratedAttendance > 0) {
  console.log(`✓ Migrated ${migratedAttendance} attendance records to separate class/section`);
}

// Migrate existing data in marks table
const migrateMarks = db.prepare(`
  UPDATE marks SET class = ?, section = ? WHERE id = ?
`);

const marksToMigrate = db.prepare(`SELECT id, class FROM marks WHERE class IS NOT NULL AND (section IS NULL OR section = '')`).all();

let migratedMarks = 0;
for (const mark of marksToMigrate) {
  const parsed = parseClassName(mark.class);
  if (parsed.section) {
    migrateMarks.run(parsed.base, parsed.section, mark.id);
    migratedMarks++;
  }
}
if (migratedMarks > 0) {
  console.log(`✓ Migrated ${migratedMarks} marks records to separate class/section`);
}

// FIX: Recreate teacher_classes table if it has the old unique constraint (without section)
// This is needed because SQLite doesn't support dropping constraints
function recreateTeacherClassesTable() {
  try {
    // First ensure section column exists
    const sectionCol = db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('teacher_classes') WHERE name='section'
    `).get();

    if (sectionCol.count === 0) {
      try {
        db.exec(`ALTER TABLE teacher_classes ADD COLUMN section TEXT`);
        console.log('✓ Added section column to teacher_classes table');
      } catch (error) {
        console.log('⚠️  Section column may already exist in teacher_classes table');
      }
    }

    // Check if we need to recreate with proper unique constraint
    // Create temp table with new schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS teacher_classes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        class_name TEXT NOT NULL,
        section TEXT,
        is_class_teacher BOOLEAN DEFAULT 0,
        assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
        UNIQUE(teacher_id, class_name, section)
      )
    `);

    // Copy existing data with proper section handling
    const existingData = db.prepare(`
      SELECT id, teacher_id, class_name, section, is_class_teacher, assigned_at
      FROM teacher_classes
    `).all();

    const insertNew = db.prepare(`
      INSERT OR IGNORE INTO teacher_classes_new
      (id, teacher_id, class_name, section, is_class_teacher, assigned_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const row of existingData) {
      const parsed = parseClassName(row.class_name);
      const baseClass = parsed.section ? parsed.base : row.class_name;
      const section = parsed.section || row.section || '';
      insertNew.run(row.id, row.teacher_id, baseClass, section || null, row.is_class_teacher, row.assigned_at);
    }

    // Drop old table and rename new one
    db.exec(`
      DROP TABLE IF EXISTS teacher_classes;
      ALTER TABLE teacher_classes_new RENAME TO teacher_classes;
    `);

    console.log('✓ Recreated teacher_classes table with proper unique constraint');
  } catch (error) {
    console.log('⚠️  Could not recreate teacher_classes table:', error.message);
  }
}

// Run the table recreation before migration
recreateTeacherClassesTable();

// Migrate existing data in teacher_classes table (this is now mostly for data sanity)
const teacherClassesToMigrate = db.prepare(`SELECT id, teacher_id, class_name, is_class_teacher FROM teacher_classes WHERE class_name IS NOT NULL AND (section IS NULL OR section = '')`).all();

let migratedTeacherClasses = 0;
let skippedTeacherClasses = 0;

for (const tc of teacherClassesToMigrate) {
  const parsed = parseClassName(tc.class_name);
  if (parsed.section) {
    // Check if a record already exists for this teacher with the target base class
    const existingBaseClass = db.prepare(`
      SELECT id, class_name, section FROM teacher_classes WHERE teacher_id = ? AND class_name = ? AND id != ?
    `).get(tc.teacher_id, parsed.base, tc.id);

    if (existingBaseClass) {
      // A record with the base class already exists.
      // If the existing one has no section, merge the data by updating it with the section
      const existingSection = existingBaseClass.section || getSection(existingBaseClass.class_name);
      if (!existingSection) {
        // Update the existing record to add the section, delete the current one
        db.prepare(`UPDATE teacher_classes SET section = ? WHERE id = ?`).run(parsed.section, existingBaseClass.id);
        db.prepare(`DELETE FROM teacher_classes WHERE id = ?`).run(tc.id);
        migratedTeacherClasses++;
      } else if (existingSection === parsed.section) {
        // Same section already exists, just delete this duplicate
        db.prepare(`DELETE FROM teacher_classes WHERE id = ?`).run(tc.id);
        skippedTeacherClasses++;
      } else {
        // Different section - update this record (should work if unique constraint is updated)
        try {
          db.prepare(`UPDATE teacher_classes SET class_name = ?, section = ? WHERE id = ?`).run(parsed.base, parsed.section, tc.id);
          migratedTeacherClasses++;
        } catch (e) {
          console.log(`⚠️  Could not migrate teacher_classes row ${tc.id}: ${e.message}`);
          skippedTeacherClasses++;
        }
      }
    } else {
      // No conflict - safe to update
      try {
        db.prepare(`UPDATE teacher_classes SET class_name = ?, section = ? WHERE id = ?`).run(parsed.base, parsed.section, tc.id);
        migratedTeacherClasses++;
      } catch (e) {
        console.log(`⚠️  Could not migrate teacher_classes row ${tc.id}: ${e.message}`);
        skippedTeacherClasses++;
      }
    }
  }
}
if (migratedTeacherClasses > 0) {
  console.log(`✓ Migrated ${migratedTeacherClasses} teacher class assignments to separate class/section`);
}
if (skippedTeacherClasses > 0) {
  console.log(`⚠️  Skipped ${skippedTeacherClasses} teacher class assignments (duplicates or conflicts)`);
}

// Helper to extract section from class_name
function getSection(className) {
  if (!className) return '';
  if (className.includes('-')) {
    const parts = className.split('-');
    return parts[1] || '';
  }
  const match = className.match(/^\d+([a-zA-Z]+)$/);
  return match ? match[1] : '';
}

// ==========================================
// CREATE MARKS TABLE (if not exists)
// ==========================================
db.exec(`
  CREATE TABLE IF NOT EXISTS marks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id     INTEGER NOT NULL,
    class          TEXT NOT NULL,
    section        TEXT,
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
  CREATE INDEX IF NOT EXISTS idx_marks_section ON marks(section);
  CREATE INDEX IF NOT EXISTS idx_marks_subject ON marks(subject, exam_type);
  CREATE INDEX IF NOT EXISTS idx_marks_student_class ON marks(student_id, class);
  CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance(class, timestamp);
  CREATE INDEX IF NOT EXISTS idx_students_class_section ON students(class, section);
  CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll_number);
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

// IMP-003: Paginated teachers query
const getTeachersPaginated = db.prepare(`
  SELECT id, username, name, email, role, created_at, last_login
  FROM teachers ORDER BY name ASC
  LIMIT ? OFFSET ?
`);

const getTeachersCount = db.prepare(`
  SELECT COUNT(*) as total FROM teachers
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
  INSERT OR REPLACE INTO teacher_classes (teacher_id, class_name, section, is_class_teacher)
  VALUES (?, ?, ?, ?)
`);

const getTeacherClasses = db.prepare(`
  SELECT * FROM teacher_classes WHERE teacher_id = ?
`);

const getClassTeachers = db.prepare(`
  SELECT tc.*, t.name as teacher_name, t.email, t.role
  FROM teacher_classes tc
  JOIN teachers t ON tc.teacher_id = t.id
  WHERE tc.class_name = ? AND (tc.section = ? OR tc.section IS NULL OR tc.section = '')
`);

const getClassTeachersBySection = db.prepare(`
  SELECT tc.*, t.name as teacher_name, t.email, t.role
  FROM teacher_classes tc
  JOIN teachers t ON tc.teacher_id = t.id
  WHERE tc.class_name = ? AND tc.section = ?
`);

const removeTeacherFromClass = db.prepare(`
  DELETE FROM teacher_classes
  WHERE teacher_id = ? AND class_name = ? AND (section = ? OR section IS NULL OR section = '')
`);

const removeTeacherFromClassBySection = db.prepare(`
  DELETE FROM teacher_classes
  WHERE teacher_id = ? AND class_name = ? AND section = ?
`);

const getAllClassAssignments = db.prepare(`
  SELECT tc.*, t.name as teacher_name, t.role
  FROM teacher_classes tc
  JOIN teachers t ON tc.teacher_id = t.id
  ORDER BY tc.class_name, tc.section, tc.is_class_teacher DESC, t.name
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
  WHERE tc.class_name = ? AND (tc.section = ? OR tc.section IS NULL OR tc.section = '') AND tc.is_class_teacher = 1
`);

const getClassCTBySection = db.prepare(`
  SELECT tc.*, t.name as teacher_name
  FROM teacher_classes tc
  JOIN teachers t ON tc.teacher_id = t.id
  WHERE tc.class_name = ? AND tc.section = ? AND tc.is_class_teacher = 1
`);

// ==========================================
// STUDENT OPERATIONS - WITH PASSWORD SUPPORT
// ==========================================

const registerStudent = db.prepare(`
  INSERT INTO students (card_id, name, class, section, roll_number, password_hash)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getStudentByCardId = db.prepare(`
  SELECT * FROM students WHERE card_id = ?
`);

const getAllStudents = db.prepare(`
  SELECT * FROM students ORDER BY name ASC
`);

// IMP-003: Paginated students query
const getStudentsPaginated = db.prepare(`
  SELECT * FROM students ORDER BY name ASC
  LIMIT ? OFFSET ?
`);

const getStudentsCount = db.prepare(`
  SELECT COUNT(*) as total FROM students
`);

const getStudentsByClass = db.prepare(`
  SELECT * FROM students WHERE class = ? AND (section = ? OR section IS NULL OR section = '') ORDER BY section, roll_number ASC
`);

const getStudentsByClassAndSection = db.prepare(`
  SELECT * FROM students WHERE class = ? AND section = ? ORDER BY roll_number ASC
`);

const getStudentById = db.prepare(`
  SELECT * FROM students WHERE id = ?
`);

const updateStudent = db.prepare(`
  UPDATE students
  SET card_id = ?, name = ?, class = ?, section = ?, roll_number = ?
  WHERE id = ?
`);

const updateStudentWithPassword = db.prepare(`
  UPDATE students
  SET card_id = ?, name = ?, class = ?, section = ?, roll_number = ?, password_hash = ?
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
  INSERT INTO attendance (card_id, student_id, student_name, class, section, timestamp)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getAllAttendance = db.prepare(`
  SELECT * FROM attendance ORDER BY recorded_at DESC LIMIT ?
`);

// IMP-003: Paginated attendance query
const getAttendancePaginated = db.prepare(`
  SELECT * FROM attendance ORDER BY recorded_at DESC
  LIMIT ? OFFSET ?
`);

const getAttendanceCount = db.prepare(`
  SELECT COUNT(*) as total FROM attendance
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
  WHERE DATE(timestamp) = DATE('now') AND class = ? AND (section = ? OR section IS NULL OR section = '')
  ORDER BY timestamp DESC
`);

const getTodayAttendanceByClassAndSection = db.prepare(`
  SELECT * FROM attendance
  WHERE DATE(timestamp) = DATE('now') AND class = ? AND section = ?
  ORDER BY timestamp DESC
`);

const getAttendanceByClass = db.prepare(`
  SELECT * FROM attendance
  WHERE class = ? AND (section = ? OR section IS NULL OR section = '')
  ORDER BY timestamp DESC
  LIMIT ?
`);

const getAttendanceByClassAndSection = db.prepare(`
  SELECT * FROM attendance
  WHERE class = ? AND section = ?
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
  WHERE DATE(timestamp) = DATE('now') AND class = ? AND (section = ? OR section IS NULL OR section = '')
  GROUP BY class
`);

const getTodayCountByClassAndSection = db.prepare(`
  SELECT
    COUNT(DISTINCT student_id) as present_count,
    class
  FROM attendance
  WHERE DATE(timestamp) = DATE('now') AND class = ? AND section = ?
  GROUP BY class
`);

const getAbsentStudentsByClass = db.prepare(`
  SELECT s.*
  FROM students s
  WHERE s.class = ? AND (s.section = ? OR s.section IS NULL OR s.section = '')
  AND s.id NOT IN (
    SELECT DISTINCT student_id
    FROM attendance
    WHERE DATE(timestamp) = DATE('now') AND student_id IS NOT NULL
  )
  ORDER BY s.roll_number
`);

const getAbsentStudentsByClassAndSection = db.prepare(`
  SELECT s.*
  FROM students s
  WHERE s.class = ? AND s.section = ?
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
  WHERE class = ? AND (section = ? OR section IS NULL OR section = '')
`);

const getAttendanceStatsByClassAndSection = db.prepare(`
  SELECT
    COUNT(*) as total_records,
    COUNT(DISTINCT student_id) as unique_students,
    COUNT(CASE WHEN DATE(timestamp) = DATE('now') THEN 1 END) as today_count
  FROM attendance
  WHERE class = ? AND section = ?
`);

// ==========================================
// EXPORT DATABASE FUNCTIONS
// ==========================================

module.exports = {
  db,
  
  // Teacher operations - OPT-002: Converted to async bcrypt
  teachers: {
    create: async (username, password, name, email, role) => {
      // CODE QUALITY FIX: bcryptjs uses hashSync, not async hash
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

    getPaginated: (page = 1, limit = 50) => {
      const offset = (page - 1) * limit;
      return {
        data: getTeachersPaginated.all(limit, offset),
        pagination: {
          page,
          limit,
          total: getTeachersCount.get().total
        }
      };
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

    updatePassword: async (id, newPassword) => {
      // CODE QUALITY FIX: bcryptjs uses hashSync
      const hashedPassword = bcrypt.hashSync(newPassword, 10);
      return updateTeacherPassword.run(hashedPassword, id);
    },

    verifyPassword: async (plainPassword, hashedPassword) => {
      // bcryptjs compare supports await/promise
      return await bcrypt.compare(plainPassword, hashedPassword);
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
    assign: (teacherId, className, section, isClassTeacher) => {
      return assignTeacherToClass.run(teacherId, className, section, isClassTeacher ? 1 : 0);
    },

    getByTeacher: (teacherId) => {
      return getTeacherClasses.all(teacherId);
    },

    getByClass: (className, section) => {
      if (section) {
        return getClassTeachersBySection.all(className, section);
      }
      return getClassTeachers.all(className, '');
    },

    remove: (teacherId, className, section) => {
      if (section) {
        return removeTeacherFromClassBySection.run(teacherId, className, section);
      }
      return removeTeacherFromClass.run(teacherId, className, '');
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

    getClassCT: (className, section) => {
      if (section) {
        return getClassCTBySection.get(className, section);
      }
      return getClassCT.get(className, '');
    }
  },
  
  // Student operations - WITH PASSWORD SUPPORT - OPT-002: Converted to async bcrypt
  students: {
    register: async (cardId, name, studentClass, section, rollNumber, password) => {
      // CODE QUALITY FIX: bcryptjs uses hashSync
      const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;
      return registerStudent.run(cardId, name, studentClass, section, rollNumber, hashedPassword);
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

    getPaginated: (page = 1, limit = 50) => {
      const offset = (page - 1) * limit;
      return {
        data: getStudentsPaginated.all(limit, offset),
        pagination: {
          page,
          limit,
          total: getStudentsCount.get().total
        }
      };
    },

    getByClass: (className, section) => {
      if (section) {
        return getStudentsByClassAndSection.all(className, section);
      }
      return getStudentsByClass.all(className, '');
    },

    update: async (id, cardId, name, studentClass, section, rollNumber, password) => {
      if (password) {
        // Update with new password
        // CODE QUALITY FIX: bcryptjs uses hashSync
        const hashedPassword = bcrypt.hashSync(password, 10);
        return updateStudentWithPassword.run(cardId, name, studentClass, section, rollNumber, hashedPassword, id);
      } else {
        // Update without changing password
        return updateStudent.run(cardId, name, studentClass, section, rollNumber, id);
      }
    },

    updatePassword: async (id, newPassword) => {
      // CODE QUALITY FIX: bcryptjs uses hashSync
      const hashedPassword = bcrypt.hashSync(newPassword, 10);
      return updateStudentPassword.run(hashedPassword, id);
    },

    verifyPassword: async (plainPassword, hashedPassword) => {
      if (!hashedPassword) return false;
      return await bcrypt.compare(plainPassword, hashedPassword);
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
    record: (cardId, studentId, studentName, studentClass, section, timestamp) => {
      return recordAttendance.run(cardId, studentId, studentName, studentClass, section, timestamp);
    },

    getAll: (limit = 100) => {
      return getAllAttendance.all(limit);
    },

    getPaginated: (page = 1, limit = 50) => {
      const offset = (page - 1) * limit;
      return {
        data: getAttendancePaginated.all(limit, offset),
        pagination: {
          page,
          limit,
          total: getAttendanceCount.get().total
        }
      };
    },

    getLatest: () => {
      return getLatestAttendance.all();
    },

    getToday: () => {
      return getTodayAttendance.all();
    },

    getTodayByClass: (className, section) => {
      if (section) {
        return getTodayAttendanceByClassAndSection.all(className, section);
      }
      return getTodayAttendanceByClass.all(className, '');
    },

    getByClass: (className, section, limit = 100) => {
      if (section) {
        return getAttendanceByClassAndSection.all(className, section, limit);
      }
      return getAttendanceByClass.all(className, '', limit);
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

    getTodayCountByClass: (className, section) => {
      let result;
      if (section) {
        result = getTodayCountByClassAndSection.get(className, section);
      } else {
        result = getTodayCountByClass.get(className, '');
      }
      return result ? result.present_count : 0;
    },

    getAbsentByClass: (className, section) => {
      if (section) {
        return getAbsentStudentsByClassAndSection.all(className, section);
      }
      return getAbsentStudentsByClass.all(className, '');
    },

    clearAll: () => {
      return clearAllAttendance.run();
    },

    getStats: () => {
      return getAttendanceStats.get();
    },

    getStatsByClass: (className, section) => {
      if (section) {
        return getAttendanceStatsByClassAndSection.get(className, section);
      }
      return getAttendanceStatsByClass.get(className, '');
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
    },

    // OPT-003: Batch get attendance stats for all students in one query
    getStatsForAllStudents: () => {
      const stmt = db.prepare(`
        SELECT
          student_id,
          COUNT(*) as total_attendance,
          MAX(timestamp) as last_seen
        FROM attendance
        WHERE student_id IS NOT NULL
        GROUP BY student_id
      `);
      const results = stmt.all();
      // Convert to map for O(1) lookup
      const statsMap = new Map();
      for (const row of results) {
        statsMap.set(row.student_id, {
          totalAttendance: row.total_attendance,
          lastSeen: row.last_seen
        });
      }
      return statsMap;
    },

    // OPT-004: Batch get present days for all students in one query
    getPresentDaysForAllStudents: () => {
      const stmt = db.prepare(`
        SELECT
          student_id,
          COUNT(DISTINCT DATE(timestamp)) as present_days
        FROM attendance
        WHERE student_id IS NOT NULL
        GROUP BY student_id
      `);
      const results = stmt.all();
      const map = new Map();
      for (const row of results) {
        map.set(row.student_id, row.present_days);
      }
      return map;
    }
  },

  // OPT-004: Batch marks operations
  marks: {
    getAllStats: () => {
      const stmt = db.prepare(`
        SELECT
          student_id,
          ROUND(AVG(CASE WHEN exam_type='midterm' THEN marks_obtained*100.0/max_mark END)) as midterm_pct,
          ROUND(AVG(CASE WHEN exam_type='final' THEN marks_obtained*100.0/max_mark END)) as final_pct,
          ROUND(AVG(marks_obtained*100.0/max_mark)) as avg_score
        FROM marks
        GROUP BY student_id
      `);
      const results = stmt.all();
      const map = new Map();
      for (const row of results) {
        map.set(row.student_id, {
          midterm_pct: row.midterm_pct || 0,
          final_pct: row.final_pct || 0,
          avg_score: row.avg_score || 0
        });
      }
      return map;
    }
  }
};

