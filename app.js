// Import required modules
require('dotenv').config()
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const database = require('./database');
const auth = require('./auth-middleware');

// Create Express application
const app = express();
const PORT = 8080;

// ==========================================
// MIDDLEWARE SETUP
// ==========================================

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (filepath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    } else if (filepath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
  }
}));

// Log requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ==========================================
// AUTHENTICATION ENDPOINTS
// ==========================================
/**
 * UPDATED LOGIN ENDPOINT - Unified Dashboard for All Teachers
 * Replace the existing /auth/login endpoint in app.js with this
 */

app.post('/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const teacher = database.teachers.getByUsername(username);

    if (!teacher) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const isValidPassword = database.teachers.verifyPassword(password, teacher.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    database.sessions.create(sessionId, teacher.id, expiresAt.toISOString());
    database.teachers.updateLastLogin(teacher.id);

    // Get teacher's class assignments
    const allAssignments = database.teacherClasses.getByTeacher(teacher.id);
    
    // Separate CT and ST assignments
    const ctAssignments = allAssignments.filter(a => a.is_class_teacher);
    const stAssignments = allAssignments.filter(a => !a.is_class_teacher);

    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    });

    console.log(`✓ User logged in: ${teacher.username} (${teacher.role})`);
    console.log(`  CT of: ${ctAssignments.map(a => a.class_name).join(', ') || 'None'}`);
    console.log(`  ST of: ${stAssignments.map(a => a.class_name).join(', ') || 'None'}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        sessionId,
        user: {
          id: teacher.id,
          username: teacher.username,
          name: teacher.name,
          email: teacher.email,
          role: teacher.role
        },
        assignments: {
          ct: ctAssignments,  // Classes where they are CT
          st: stAssignments   // Classes where they are ST
        },
        // Determine redirect based on role
        redirectTo: teacher.role === 'admin' ? '/admin-dashboard.html' : '/teacher-dashboard.html'
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /auth/logout
 * Logout endpoint
 */
app.post('/auth/logout', auth.isAuthenticated, (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;
    
    if (sessionId) {
      database.sessions.delete(sessionId);
    }

    res.clearCookie('sessionId');

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /auth/me
 * Get current user info
 */
app.get('/auth/me', auth.isAuthenticated, (req, res) => {
  try {
    const classes = database.teacherClasses.getByTeacher(req.user.id);

    res.json({
      success: true,
      data: {
        user: req.user,
        classes: classes
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ==========================================
// ADMIN ENDPOINTS - TEACHER MANAGEMENT
// ==========================================
/**
 * POST /admin/teachers
 * Create new teacher (Admin only)
 * FIXED: Accept 'teacher' role and validate properly
 */
app.post('/admin/teachers', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const { username, password, name, email, role } = req.body;

    if (!username || !password || !name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, name, and email are required'
      });
    }

    // FIXED: Accept both 'teacher' and specific teacher roles
    // Default to 'teacher' if role is not provided
    const teacherRole = role || 'teacher';
    
    // Validate role - accept 'teacher', 'admin', 'class_teacher', 'subject_teacher'
    const validRoles = ['admin', 'teacher', 'class_teacher', 'subject_teacher'];
    if (!validRoles.includes(teacherRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }

    const existing = database.teachers.getByUsername(username);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Username already exists'
      });
    }

    const result = database.teachers.create(username, password, name, email, teacherRole);

    console.log(`✓ Teacher created: ${username} (${teacherRole})`);

    res.status(201).json({
      success: true,
      message: 'Teacher created successfully',
      data: {
        id: result.lastInsertRowid,
        username,
        name,
        role: teacherRole
      }
    });

  } catch (error) {
    console.error('Create teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create teacher: ' + error.message
    });
  }
});

/**
 * GET /admin/teachers
 * Get all teachers (Admin only)
 */
app.get('/admin/teachers', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const teachers = database.teachers.getAll();

    // Get class assignments for each teacher
    const teachersWithClasses = teachers.map(teacher => {
      const classes = database.teacherClasses.getByTeacher(teacher.id);
      return {
        ...teacher,
        classes: classes
      };
    });

    res.json({
      success: true,
      count: teachers.length,
      data: teachersWithClasses
    });

  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teachers'
    });
  }
});

/**
 * PUT /admin/teachers/:id
 * Update teacher (Admin only)
 */
app.put('/admin/teachers/:id', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const teacherId = parseInt(req.params.id);
    const { name, email, role } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    database.teachers.update(teacherId, name, email);

    if (role) {
      database.teachers.updateRole(teacherId, role);
    }

    console.log(`✓ Teacher updated: ${teacherId}`);

    res.json({
      success: true,
      message: 'Teacher updated successfully'
    });

  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update teacher'
    });
  }
});

/**
 * DELETE /admin/teachers/:id
 * Delete teacher (Admin only)
 */
app.delete('/admin/teachers/:id', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const teacherId = parseInt(req.params.id);

    const result = database.teachers.delete(teacherId);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    console.log(`✓ Teacher deleted: ${teacherId}`);

    res.json({
      success: true,
      message: 'Teacher deleted successfully'
    });

  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete teacher'
    });
  }
});

// ==========================================
// ADMIN ENDPOINTS - CLASS ASSIGNMENTS
// ==========================================

/**
 * ENHANCED CLASS ASSIGNMENT ENDPOINT
 * Add this to replace the existing /admin/assign-class POST endpoint in app.js
 */

/**
 * POST /admin/assign-class
 * Assign teacher to class with CT/ST validation
 * Note: Teachers are created with role='teacher', CT/ST is determined by assignments
 */
app.post('/admin/assign-class', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const { teacherId, className, isClassTeacher } = req.body;

    if (!teacherId || !className) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID and class name are required'
      });
    }

    // Verify teacher exists and is not admin
    const teacher = database.teachers.getById(teacherId);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    if (teacher.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign classes to admin users'
      });
    }

    // VALIDATION 1: Check if trying to assign as Class Teacher
    if (isClassTeacher) {
      // Check if teacher already has a CT assignment
      const existingCT = database.teacherClasses.getCTAssignment(teacherId);
      
      if (existingCT && existingCT.class_name !== className) {
        return res.status(400).json({
          success: false,
          message: `This teacher is already Class Teacher of ${existingCT.class_name}. A teacher can only be CT of ONE class. Remove that assignment first or assign as Subject Teacher instead.`
        });
      }

      // Check if class already has a different CT
      const classCT = database.teacherClasses.getClassCT(className);
      
      if (classCT && classCT.teacher_id !== teacherId) {
        return res.status(400).json({
          success: false,
          message: `Class ${className} already has a Class Teacher: ${classCT.teacher_name}. Remove them first or assign as Subject Teacher instead.`
        });
      }
    }

    // VALIDATION 2: If assigning as ST, make sure they're not already CT of this class
    if (!isClassTeacher) {
      const existingAssignment = database.teacherClasses.getByTeacher(teacherId)
        .find(a => a.class_name === className && a.is_class_teacher);
      
      if (existingAssignment) {
        return res.status(400).json({
          success: false,
          message: `This teacher is already Class Teacher of ${className}. Cannot downgrade to Subject Teacher. Remove the assignment first.`
        });
      }
    }

    // All validations passed - assign the class
    database.teacherClasses.assign(teacherId, className, isClassTeacher || false);

    const assignmentType = isClassTeacher ? 'Class Teacher' : 'Subject Teacher';
    console.log(`✓ Teacher ${teacherId} assigned to ${className} as ${assignmentType}`);

    res.json({
      success: true,
      message: `Successfully assigned as ${assignmentType} of ${className}`
    });

  } catch (error) {
    console.error('Assign class error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign class'
    });
  }
});
/**
 * DELETE /admin/assign-class
 * Remove teacher from class (Admin only)
 */
app.delete('/admin/assign-class', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const { teacherId, className } = req.body;

    if (!teacherId || !className) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID and class name are required'
      });
    }

    database.teacherClasses.remove(teacherId, className);

    console.log(`✓ Teacher ${teacherId} removed from ${className}`);

    res.json({
      success: true,
      message: 'Teacher removed from class'
    });

  } catch (error) {
    console.error('Remove class error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove teacher from class'
    });
  }
});

/**
 * GET /admin/class-assignments
 * Get all class assignments (Admin only)
 */
app.get('/admin/class-assignments', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const assignments = database.teacherClasses.getAll();

    res.json({
      success: true,
      count: assignments.length,
      data: assignments
    });

  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignments'
    });
  }
});

// ==========================================
// ESP8266 RFID ENDPOINTS (No Authentication Required)
// ==========================================

/**
 * POST /api/rfid/scan
 * Record attendance from ESP8266 RFID reader
 */
app.post('/api/rfid/scan', (req, res) => {
  try {
    const { cardId, apiKey } = req.body;

    if (!cardId) {
      return res.status(400).json({
        success: false,
        message: 'cardId is required'
      });
    }

    const timestamp = new Date().toISOString();
    const trimmedCardId = cardId.trim();
    
    console.log(`📱 ESP8266 scan - Card: "${trimmedCardId}"`);

    // Look up student by card ID
    const student = database.students.getByCardId(trimmedCardId);

    if (!student) {
      console.log(`⚠️  Unknown card: ${trimmedCardId}`);
      
      // Still record attendance even if student not registered
      const result = database.attendance.record(
        trimmedCardId,
        null,
        'Unknown Student',
        'N/A',
        timestamp
      );

      return res.json({
        success: true,
        message: 'Card scanned but not registered',
        data: {
          id: result.lastInsertRowid,
          cardId: trimmedCardId,
          student: null,
          status: 'unknown_card',
          timestamp: timestamp
        }
      });
    }

    // Student found - record attendance
    const result = database.attendance.record(
      trimmedCardId,
      student.id,
      student.name,
      student.class,
      timestamp
    );

    console.log(`✓ Attendance recorded: ${student.name} (${student.class})`);

    res.json({
      success: true,
      message: 'Attendance recorded successfully',
      data: {
        id: result.lastInsertRowid,
        cardId: trimmedCardId,
        student: {
          id: student.id,
          name: student.name,
          class: student.class,
          rollNumber: student.roll_number
        },
        status: 'present',
        timestamp: timestamp
      }
    });

  } catch (error) {
    console.error('ESP8266 scan error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record attendance',
      error: error.message
    });
  }
});

/**
 * GET /api/rfid/test
 * Test endpoint for ESP8266
 */
app.get('/api/rfid/test', (req, res) => {
  res.json({
    success: true,
    message: 'RFID server is online',
    timestamp: new Date().toISOString(),
    serverTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
});


// ==========================================
// ATTENDANCE ENDPOINTS (Protected)
// ==========================================

/**
 * POST /attendance
 * Record attendance (Class teachers only)
 */
app.post('/attendance', auth.isAuthenticated, auth.canMarkAttendance, (req, res) => {
  try {
    const { cardId, time } = req.body;

    if (!cardId) {
      return res.status(400).json({
        success: false,
        message: 'cardId is required'
      });
    }

    const timestamp = time || new Date().toISOString();
    const trimmedCardId = cardId.trim();
    
    console.log(`📝 Attendance request for card: "${trimmedCardId}"`);

    const student = database.students.getByCardId(trimmedCardId);

    const result = database.attendance.record(
      trimmedCardId,
      student ? student.id : null,
      student ? student.name : 'Unknown Student',
      student ? student.class : 'N/A',
      timestamp
    );

    console.log('✓ Attendance recorded:', {
      id: result.lastInsertRowid,
      cardId: trimmedCardId,
      student: student ? student.name : 'Unknown'
    });

    res.status(201).json({
      success: true,
      message: 'Attendance recorded successfully',
      data: {
        id: result.lastInsertRowid,
        cardId: trimmedCardId,
        timestamp: timestamp,
        student: student || { name: 'Unknown Student', class: 'N/A' }
      }
    });

  } catch (error) {
    console.error('Error recording attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /attendance/class/:className
 * Get attendance by class (Teachers with class access)
 */
app.get('/attendance/class/:className', auth.isAuthenticated, auth.hasClassAccess, (req, res) => {
  try {
    const { className } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const records = database.attendance.getByClass(className, limit);

    res.json({
      success: true,
      count: records.length,
      data: records
    });

  } catch (error) {
    console.error('Error fetching class attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance'
    });
  }
});

/**
 * GET /attendance/class/:className/today
 * Get today's attendance for a class
 */
app.get('/attendance/class/:className/today', auth.isAuthenticated, auth.hasClassAccess, (req, res) => {
  try {
    const { className } = req.params;

    // For class teachers - show detailed records
    if (req.user.role === 'admin' || req.isClassTeacherForClass) {
      const records = database.attendance.getTodayByClass(className);
      const totalStudents = database.students.getByClass(className).length;
      const presentCount = database.attendance.getTodayCountByClass(className);
      const absentStudents = database.attendance.getAbsentByClass(className);

      res.json({
        success: true,
        data: {
          records: records,
          stats: {
            total: totalStudents,
            present: presentCount,
            absent: totalStudents - presentCount
          },
          absentStudents: absentStudents
        }
      });
    } else {
      // For subject teachers - show only counts
      const totalStudents = database.students.getByClass(className).length;
      const presentCount = database.attendance.getTodayCountByClass(className);

      res.json({
        success: true,
        data: {
          stats: {
            total: totalStudents,
            present: presentCount,
            absent: totalStudents - presentCount
          }
        }
      });
    }

  } catch (error) {
    console.error('Error fetching today\'s attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch today\'s attendance'
    });
  }
});

/**
 * GET /attendance/latest
 * Get latest attendance (Admin only)
 */
app.get('/attendance/latest', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const records = database.attendance.getLatest();

    res.json({
      success: true,
      count: records.length,
      data: records
    });

  } catch (error) {
    console.error('Error fetching latest attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch latest records'
    });
  }
});

/**
 * DELETE /attendance/clear
 * Clear all attendance (Admin only)
 */
app.delete('/attendance/clear', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const result = database.attendance.clearAll();

    console.log(`✓ Cleared all attendance records`);

    res.json({
      success: true,
      message: `Cleared ${result.changes} records`
    });

  } catch (error) {
    console.error('Error clearing attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear records'
    });
  }
});

// ==========================================
// STUDENT ENDPOINTS (Protected)
// ==========================================

/**
 * POST /students/register
 * Register new student (Admin and Class Teachers)
 */
app.post('/students/register', auth.isAuthenticated, auth.isClassTeacher, (req, res) => {
  try {
    const { cardId, name, studentClass, rollNumber } = req.body;

    if (!cardId || !name) {
      return res.status(400).json({
        success: false,
        message: 'cardId and name are required'
      });
    }

    if (database.students.cardExists(cardId)) {
      return res.status(409).json({
        success: false,
        message: 'Card ID already registered'
      });
    }

    const result = database.students.register(
      cardId,
      name,
      studentClass || null,
      rollNumber || null
    );

    console.log('✓ Student registered:', name);

    res.status(201).json({
      success: true,
      message: 'Student registered successfully',
      data: {
        id: result.lastInsertRowid,
        cardId,
        name
      }
    });

  } catch (error) {
    console.error('Error registering student:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register student'
    });
  }
});

/**
 * GET /students
 * Get all students (Authenticated users)
 */
app.get('/students', auth.isAuthenticated, (req, res) => {
  try {
    const students = database.students.getAll();

    res.json({
      success: true,
      count: students.length,
      data: students
    });

  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

/**
 * GET /students/class/:className
 * Get students by class
 */
app.get('/students/class/:className', auth.isAuthenticated, auth.hasClassAccess, (req, res) => {
  try {
    const { className } = req.params;
    const students = database.students.getByClass(className);

    res.json({
      success: true,
      count: students.length,
      data: students
    });

  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

// ==========================================
// STUDENT ENDPOINTS - FULL CRUD FOR ADMIN
// Add these to app.js after the existing student endpoints
// ==========================================

/**
 * GET /admin/students
 * Get all students with full details (Admin only)
 */
app.get('/admin/students', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const students = database.students.getAll();
    
    // Get attendance count for each student
    const studentsWithStats = students.map(student => {
      const attendanceCount = database.attendance.getCountByStudent(student.id);
      const lastAttendance = database.attendance.getLastByStudent(student.id);
      
      return {
        ...student,
        stats: {
          totalAttendance: attendanceCount,
          lastSeen: lastAttendance ? lastAttendance.timestamp : null
        }
      };
    });

    res.json({
      success: true,
      count: students.length,
      data: studentsWithStats
    });

  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

/**
 * GET /admin/students/:id
 * Get single student details (Admin only)
 */
app.get('/admin/students/:id', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const studentId = parseInt(req.params.id);
    const student = database.students.getById(studentId);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Get attendance history
    const attendanceRecords = database.attendance.getByStudentId(studentId, 50);
    const attendanceCount = database.attendance.getCountByStudent(studentId);

    res.json({
      success: true,
      data: {
        ...student,
        stats: {
          totalAttendance: attendanceCount,
          recentAttendance: attendanceRecords
        }
      }
    });

  } catch (error) {
    console.error('Get student error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student'
    });
  }
});

/**
 * PUT /admin/students/:id
 * Update student details (Admin only)
 */
app.put('/admin/students/:id', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const studentId = parseInt(req.params.id);
    const { cardId, name, studentClass, rollNumber } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Student name is required'
      });
    }

    // Check if student exists
    const existingStudent = database.students.getById(studentId);
    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // If changing card ID, check if new card ID is already used
    if (cardId && cardId !== existingStudent.card_id) {
      const cardExists = database.students.getByCardId(cardId);
      if (cardExists && cardExists.id !== studentId) {
        return res.status(409).json({
          success: false,
          message: 'This card ID is already registered to another student'
        });
      }
    }

    // Update student
    database.students.update(
      studentId,
      cardId || existingStudent.card_id,
      name,
      studentClass || null,
      rollNumber || null
    );

    console.log(`✓ Student updated: ${name} (ID: ${studentId})`);

    res.json({
      success: true,
      message: 'Student updated successfully',
      data: {
        id: studentId,
        cardId: cardId || existingStudent.card_id,
        name,
        class: studentClass,
        rollNumber
      }
    });

  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update student'
    });
  }
});

/**
 * DELETE /admin/students/:id
 * Delete student (Admin only)
 */
app.delete('/admin/students/:id', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const studentId = parseInt(req.params.id);

    const student = database.students.getById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Delete student (attendance records will remain for historical data)
    const result = database.students.delete(studentId);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    console.log(`✓ Student deleted: ${student.name} (ID: ${studentId})`);

    res.json({
      success: true,
      message: 'Student deleted successfully'
    });

  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete student'
    });
  }
});

/**
 * POST /admin/students/bulk-import
 * Bulk import students from CSV data (Admin only)
 */
app.post('/admin/students/bulk-import', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const { students } = req.body; // Array of {cardId, name, class, rollNumber}

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Students array is required'
      });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    students.forEach((student, index) => {
      try {
        const { cardId, name, studentClass, rollNumber } = student;

        if (!cardId || !name) {
          results.failed++;
          results.errors.push({
            row: index + 1,
            error: 'Missing cardId or name'
          });
          return;
        }

        // Check if card already exists
        if (database.students.cardExists(cardId)) {
          results.failed++;
          results.errors.push({
            row: index + 1,
            cardId,
            error: 'Card ID already registered'
          });
          return;
        }

        // Register student
        database.students.register(
          cardId,
          name,
          studentClass || null,
          rollNumber || null
        );

        results.success++;

      } catch (error) {
        results.failed++;
        results.errors.push({
          row: index + 1,
          error: error.message
        });
      }
    });

    console.log(`✓ Bulk import: ${results.success} success, ${results.failed} failed`);

    res.json({
      success: true,
      message: `Imported ${results.success} students`,
      data: results
    });

  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to import students'
    });
  }
});
// ==========================================
// UTILITY ENDPOINTS
// ==========================================

app.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running!',
    timestamp: new Date().toISOString(),
    database: 'SQLite with Authentication'
  });
});

app.get('/health', (req, res) => {
  try {
    const stats = database.attendance.getStats();
    const studentCount = database.students.getAll().length;
    const teacherCount = database.teachers.getAll().length;

    res.json({
      success: true,
      status: 'healthy',
      database: 'connected',
      stats: {
        students: studentCount,
        teachers: teacherCount,
        ...stats
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// ==========================================
// ANALYTICS ENDPOINTS
// ==========================================
 
/**
 * GET /api/analytics/students
 * Returns all students with attendance % and grades for ML dashboard.
 * Attendance % = (days present / total school days recorded) × 100
 * Uses the attendance table to compute the real count per student.
 */
app.get('/api/analytics/students', auth.isAuthenticated, (req, res) => {
  try {
    const students = database.students.getAll();
 
    // Get total distinct attendance days recorded in the system
    const totalDaysStmt = database.db.prepare(`
      SELECT COUNT(DISTINCT DATE(timestamp)) as total_days FROM attendance
    `);
    const { total_days } = totalDaysStmt.get();
    const denominator = total_days || 1;
 
    const result = students.map(student => {
      // Days this student was present
      const presentStmt = database.db.prepare(`
        SELECT COUNT(DISTINCT DATE(timestamp)) as present_days
        FROM attendance
        WHERE student_id = ?
      `);
      const { present_days } = presentStmt.get(student.id);
      const attendance = Math.round((present_days / denominator) * 100);
 
      // Compute avg_score from grades columns if they exist, else default 0
      const midterm    = student.midterm    || 0;
      const final_score = student.final_score || 0;
      const avg_score  = midterm && final_score ? Math.round((midterm + final_score) / 2) : 0;
 
      // Auto-compute grade from avg_score if not stored
      let grade = student.grade || null;
      if (!grade && avg_score) {
        if (avg_score >= 90)      grade = 'A';
        else if (avg_score >= 75) grade = 'B';
        else if (avg_score >= 60) grade = 'C';
        else if (avg_score >= 45) grade = 'D';
        else                      grade = 'F';
      }
 
      return {
        id:           student.id,
        name:         student.name,
        class:        student.class,
        roll_number:  student.roll_number,
        card_id:      student.card_id,
        attendance,
        present_days,
        total_days:   denominator,
        midterm,
        final_score,
        avg_score,
        grade,
      };
    });
 
    res.json({ success: true, count: result.length, data: result });
  } catch (error) {
    console.error('Analytics students error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics data' });
  }
});
 
/**
 * POST /api/analytics/import-grades
 * Bulk update midterm, final_score, grade from CSV import.
 * Body: { grades: [{ rollNumber, midterm, finalScore, grade }] }
 *
 * NOTE: This endpoint adds midterm / final_score / grade columns to the
 * students table if they don't exist yet (safe migration).
 */
app.post('/api/analytics/import-grades', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    // Safe-add grade columns to students table (idempotent)
    ['midterm', 'final_score', 'grade'].forEach(col => {
      try {
        database.db.exec(`ALTER TABLE students ADD COLUMN ${col} ${col === 'grade' ? 'TEXT' : 'INTEGER'}`);
      } catch (_) { /* column already exists — that's fine */ }
    });
 
    const { grades } = req.body;
    if (!Array.isArray(grades) || !grades.length) {
      return res.status(400).json({ success: false, message: 'grades array required' });
    }
 
    const updateStmt = database.db.prepare(`
      UPDATE students SET midterm = ?, final_score = ?, grade = ?
      WHERE roll_number = ?
    `);
 
    let updated = 0;
    const doAll = database.db.transaction(() => {
      grades.forEach(({ rollNumber, midterm, finalScore, grade }) => {
        const info = updateStmt.run(midterm || 0, finalScore || 0, grade || null, String(rollNumber));
        if (info.changes > 0) updated++;
      });
    });
    doAll();
 
    console.log(`✓ Grade import: updated ${updated} students`);
    res.json({ success: true, updated });
  } catch (error) {
    console.error('Grade import error:', error);
    res.status(500).json({ success: false, message: 'Import failed: ' + error.message });
  }
});
 
/**
 * POST /api/analytics/ai-insight
 * Proxies the summary data to the Anthropic API and streams the result back.
 * Body: { summary: string }
 *
 * Requires ANTHROPIC_API_KEY in environment:
 *   set it with:  export ANTHROPIC_API_KEY=sk-ant-...
 *   or add to a .env file and use: require('dotenv').config()
 */
app.post('/api/analytics/ai-insight', auth.isAuthenticated, async (req, res) => {
  try {
    const { summary } = req.body;
    if (!summary) return res.status(400).json({ success: false, message: 'summary required' });
 
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'ANTHROPIC_API_KEY not set. Add it to your environment: export ANTHROPIC_API_KEY=sk-ant-...'
      });
    }
 
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `You are an educational data analyst for an Indian school RFID attendance system. Analyse this student attendance and academic performance data. Write 3–4 focused paragraphs covering: (1) key trend findings and what the correlation coefficient means in plain English, (2) which students need immediate intervention and exactly why, (3) predicted outcomes if attendance improves — give specific numbers, (4) concrete actionable steps for teachers this week. Be direct and specific.\n\n${summary}`
        }]
      })
    });
 
    const data = await response.json();
 
    if (data.error) {
      return res.status(500).json({ success: false, message: data.error.message });
    }
 
    const insight = (data.content || []).map(b => b.text || '').join('');
    res.json({ success: true, insight });
  } catch (error) {
    console.error('AI insight error:', error);
    res.status(500).json({ success: false, message: 'AI request failed: ' + error.message });
  }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log('=================================');
  console.log('🎓 RFID Attendance System Started');
  console.log('=================================');
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Login: http://localhost:${PORT}`);
  console.log(`Database: SQLite (attendance.db)`);
  console.log(`\nDefault Admin:`);
  console.log(`  Username: admin`);
  console.log(`  Password: admin123`);
  console.log(`\nPress Ctrl+C to stop`);
  console.log('=================================\n');
});

process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  database.db.close();
  console.log('✓ Database connection closed');
  process.exit(0);
});