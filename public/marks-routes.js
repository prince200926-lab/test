// ============================================================
// MARKS ENTRY ROUTES  —  paste entire file into app.js
//                         just before app.listen()
// ============================================================

// ── Create marks table (runs once, safe to re-run) ────────────────────────────
(function createMarksTable() {
  database.db.exec(`
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

  database.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);
    CREATE INDEX IF NOT EXISTS idx_marks_class   ON marks(class);
    CREATE INDEX IF NOT EXISTS idx_marks_subject ON marks(subject, exam_type);
  `);

  console.log('✓ Marks table ready');
})();

// ── Prepared statements (must be outside loops — better-sqlite3 requirement) ──
const _upsertMark = database.db.prepare(`
  INSERT INTO marks (student_id, class, subject, exam_type, marks_obtained, max_mark, grade, entered_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(student_id, subject, exam_type)
  DO UPDATE SET
    marks_obtained = excluded.marks_obtained,
    max_mark       = excluded.max_mark,
    grade          = excluded.grade,
    entered_by     = excluded.entered_by,
    updated_at     = CURRENT_TIMESTAMP
`);

const _getMarksByClass = database.db.prepare(`
  SELECT m.*, s.name AS student_name, s.roll_number
  FROM marks m
  JOIN students s ON m.student_id = s.id
  WHERE m.class = ?
  ORDER BY s.roll_number, m.subject, m.exam_type
`);

const _getMarksByStudent = database.db.prepare(`
  SELECT m.*, s.name AS student_name, s.roll_number
  FROM marks m
  JOIN students s ON m.student_id = s.id
  WHERE m.student_id = ? AND m.class = ?
  ORDER BY m.subject, m.exam_type
`);

const _deleteMark = database.db.prepare(`
  DELETE FROM marks WHERE student_id = ? AND subject = ? AND exam_type = ?
`);

// BUG FIX #4: these two are for /api/analytics/students/v2
// Prepared ONCE here, used inside the route handler — not inside .map()
const _getAttDays = database.db.prepare(
  `SELECT COUNT(DISTINCT DATE(timestamp)) AS present_days
   FROM attendance WHERE student_id = ?`
);

const _getStudentMarks = database.db.prepare(`
  SELECT
    ROUND(AVG(CASE WHEN exam_type = 'midterm' THEN marks_obtained * 100.0 / max_mark END)) AS midterm_pct,
    ROUND(AVG(CASE WHEN exam_type = 'final'   THEN marks_obtained * 100.0 / max_mark END)) AS final_pct,
    ROUND(AVG(marks_obtained * 100.0 / max_mark))                                           AS avg_score
  FROM marks WHERE student_id = ?
`);

// ── Helper: access check for teacher ─────────────────────────────────────────
function teacherHasClass(userId, className) {
  const assignments = database.teacherClasses.getByTeacher(userId);
  return assignments.some(a => a.class_name === className);
}

// ── GET /api/marks/classes ────────────────────────────────────────────────────
app.get('/api/marks/classes', auth.isAuthenticated, (req, res) => {
  try {
    let classes = [];

    if (req.user.role === 'admin') {
      const rows = database.db
        .prepare(`SELECT DISTINCT class FROM students WHERE class IS NOT NULL ORDER BY class`)
        .all();
      classes = rows.map(r => r.class);
    } else {
      classes = database.teacherClasses
        .getByTeacher(req.user.id)
        .map(a => a.class_name)
        .sort();
    }

    res.json({ success: true, classes });
  } catch (err) {
    console.error('marks/classes error:', err);
    res.status(500).json({ success: false, message: 'Failed to get classes' });
  }
});

// ── GET /api/marks/students/:className ───────────────────────────────────────
app.get('/api/marks/students/:className', auth.isAuthenticated, (req, res) => {
  try {
    const { className } = req.params;

    if (req.user.role !== 'admin' && !teacherHasClass(req.user.id, className)) {
      return res.status(403).json({ success: false, message: 'No access to this class' });
    }

    const students = database.students.getByClass(className);
    res.json({ success: true, students });
  } catch (err) {
    console.error('marks/students error:', err);
    res.status(500).json({ success: false, message: 'Failed to get students' });
  }
});

// ── GET /api/marks/records/:className ────────────────────────────────────────
app.get('/api/marks/records/:className', auth.isAuthenticated, (req, res) => {
  try {
    const { className } = req.params;

    if (req.user.role !== 'admin' && !teacherHasClass(req.user.id, className)) {
      return res.status(403).json({ success: false, message: 'No access to this class' });
    }

    const records = _getMarksByClass.all(className);
    res.json({ success: true, records });
  } catch (err) {
    console.error('marks/records error:', err);
    res.status(500).json({ success: false, message: 'Failed to get records' });
  }
});

// ── GET /api/marks/report/:studentId?class=CLASSNAME ─────────────────────────
app.get('/api/marks/report/:studentId', auth.isAuthenticated, (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    const className = req.query.class;

    if (!className) {
      return res.status(400).json({ success: false, message: '?class= query param required' });
    }

    if (req.user.role !== 'admin' && !teacherHasClass(req.user.id, className)) {
      return res.status(403).json({ success: false, message: 'No access to this class' });
    }

    const records = _getMarksByStudent.all(studentId, className);
    res.json({ success: true, records });
  } catch (err) {
    console.error('marks/report error:', err);
    res.status(500).json({ success: false, message: 'Failed to get report' });
  }
});

// ── POST /api/marks/save ──────────────────────────────────────────────────────
// Body: { records: [{studentId, subject, examType, maxMark, marksObtained, grade, className}] }
app.post('/api/marks/save', auth.isAuthenticated, (req, res) => {
  try {
    const { records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'records array is required' });
    }

    // Validate all records belong to the same class and teacher has access
    const className = records[0].className;
    if (!className) {
      return res.status(400).json({ success: false, message: 'className is required on each record' });
    }

    if (req.user.role !== 'admin' && !teacherHasClass(req.user.id, className)) {
      return res.status(403).json({ success: false, message: 'No access to this class' });
    }

    let saved = 0;
    const saveAll = database.db.transaction(() => {
      records.forEach(r => {
        if (!r.studentId || !r.subject || !r.examType) return;
        _upsertMark.run(
          r.studentId,
          r.className,
          r.subject,
          r.examType,
          Number(r.marksObtained),
          Number(r.maxMark) || 100,
          r.grade || null,
          req.user.id
        );
        saved++;
      });
    });
    saveAll();

    console.log(`✓ Marks saved: ${saved} records by ${req.user.username} for ${className}`);
    res.json({ success: true, saved });
  } catch (err) {
    console.error('marks/save error:', err);
    res.status(500).json({ success: false, message: 'Failed to save: ' + err.message });
  }
});

// ── DELETE /api/marks/record ──────────────────────────────────────────────────
// Body: { studentId, subject, examType }
app.delete('/api/marks/record', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const { studentId, subject, examType } = req.body;
    if (!studentId || !subject || !examType) {
      return res.status(400).json({ success: false, message: 'studentId, subject, examType required' });
    }
    const result = _deleteMark.run(studentId, subject, examType);
    res.json({ success: true, deleted: result.changes });
  } catch (err) {
    console.error('marks/delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete' });
  }
});

// ── GET /api/marks/summary/:className ────────────────────────────────────────
app.get('/api/marks/summary/:className', auth.isAuthenticated, (req, res) => {
  try {
    const { className } = req.params;

    const stmt = database.db.prepare(`
      SELECT
        s.id, s.name, s.roll_number,
        ROUND(AVG(CASE WHEN m.exam_type = 'midterm' THEN m.marks_obtained * 100.0 / m.max_mark END), 1) AS midterm_pct,
        ROUND(AVG(CASE WHEN m.exam_type = 'final'   THEN m.marks_obtained * 100.0 / m.max_mark END), 1) AS final_pct,
        ROUND(AVG(m.marks_obtained * 100.0 / m.max_mark), 1) AS overall_pct,
        COUNT(m.id) AS subjects_entered
      FROM students s
      LEFT JOIN marks m ON m.student_id = s.id AND m.class = ?
      WHERE s.class = ?
      GROUP BY s.id
      ORDER BY s.roll_number
    `);

    const summary = stmt.all(className, className);
    res.json({ success: true, summary });
  } catch (err) {
    console.error('marks/summary error:', err);
    res.status(500).json({ success: false, message: 'Failed to get summary' });
  }
});

// ── GET /api/marks/leaderboard/:className ────────────────────────────────────
app.get('/api/marks/leaderboard/:className', auth.isAuthenticated, (req, res) => {
  try {
    const { className } = req.params;
    const stmt = database.db.prepare(`
      SELECT s.name, s.roll_number,
        ROUND(AVG(m.marks_obtained * 100.0 / m.max_mark), 1) AS avg_pct,
        COUNT(m.id) AS subjects
      FROM students s
      JOIN marks m ON m.student_id = s.id AND m.class = ?
      WHERE s.class = ?
      GROUP BY s.id
      HAVING subjects > 0
      ORDER BY avg_pct DESC
      LIMIT 10
    `);
    const leaderboard = stmt.all(className, className);
    res.json({ success: true, leaderboard });
  } catch (err) {
    console.error('marks/leaderboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to get leaderboard' });
  }
});

// ── GET /api/analytics/students/v2 ───────────────────────────────────────────
// Replaces the old endpoint — reads marks from the marks table.
// analytics.js now calls /api/analytics/students/v2 instead of /api/analytics/students
// BUG FIX #4: prepared statements are defined at module level (above), not inside .map()
app.get('/api/analytics/students/v2', auth.isAuthenticated, (req, res) => {
  try {
    const allStudents = database.students.getAll();

    const { total_days } = database.db
      .prepare(`SELECT COUNT(DISTINCT DATE(timestamp)) AS total_days FROM attendance`)
      .get();
    const denominator = total_days || 1;

    const data = allStudents.map(student => {
      // BUG FIX: using module-level prepared statements, not inline .prepare() inside map
      const { present_days } = _getAttDays.get(student.id);
      const attendance = Math.round((present_days / denominator) * 100);

      const marksRow  = _getStudentMarks.get(student.id);
      const avg_score = marksRow?.avg_score || 0;

      let grade = null;
      if (avg_score >= 90)      grade = 'A';
      else if (avg_score >= 75) grade = 'B';
      else if (avg_score >= 60) grade = 'C';
      else if (avg_score >= 45) grade = 'D';
      else if (avg_score > 0)   grade = 'F';

      return {
        id:           student.id,
        name:         student.name,
        class:        student.class,
        roll_number:  student.roll_number,
        attendance,
        present_days,
        total_days:   denominator,
        midterm:      marksRow?.midterm_pct || 0,
        final_score:  marksRow?.final_pct   || 0,
        avg_score,
        grade
      };
    });

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('analytics/students/v2 error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics: ' + err.message });
  }
});