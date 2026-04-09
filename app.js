// Import required modules
require('dotenv').config()
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fetch = require('node-fetch');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const csrf = require('csurf');
const database = require('./database');
const auth = require('./auth-middleware');

// Async handler wrapper for Express to catch async errors
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Create Express application
const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// SECURITY MIDDLEWARE (IMP-005, IMP-008, IMP-009)
// ==========================================

// IMP-009: Secure Header Configuration with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "generativelanguage.googleapis.com"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'same-origin' }
}));

// OPT-010: Compression middleware for response optimization
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// IMP-008: Rate Limiting by Endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    message: 'Too many login attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    success: false,
    message: 'Rate limit exceeded. Please try again later.'
  }
});

const rfidLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 RFID scans per minute
  message: {
    success: false,
    message: 'RFID scan rate limit exceeded'
  }
});

// IMP-006: CSRF Protection
const csrfProtection = csrf({ cookie: true });

// IMP-007: Input Sanitization Middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Validation rules for common endpoints
const studentValidation = [
  body('cardId').trim().isLength({ min: 3, max: 100 }).escape(),
  body('name').trim().isLength({ min: 1, max: 200 }).escape(),
  body('studentClass').optional().trim().escape(),
  body('section').optional().trim().escape(),
  body('rollNumber').optional().trim().escape(),
  handleValidationErrors
];

const teacherValidation = [
  body('username').trim().isLength({ min: 3, max: 50 }).escape(),
  body('password').trim().isLength({ min: 4, max: 100 }),
  body('name').trim().isLength({ min: 1, max: 200 }).escape(),
  body('email').trim().isEmail().normalizeEmail(),
  handleValidationErrors
];

// ==========================================
// MIDDLEWARE SETUP
// ==========================================

// ==========================================
// CORS CONFIGURATION
// ==========================================
// OPT-011: Fixed CORS origin validation to properly handle empty ALLOWED_ORIGINS
// For production, set ALLOWED_ORIGINS env var to comma-separated domains:
//   ALLOWED_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').filter(Boolean)
  : [];

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (allowedOrigins.length > 0 ? allowedOrigins : false)
    : true,
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

// IMP-008: Apply login rate limiter
app.post('/auth/login', loginLimiter, async (req, res) => {
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

    // OPT-002: Using async bcrypt to prevent event loop blocking
    const isValidPassword = await database.teachers.verifyPassword(password, teacher.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // SECURITY FIX: Prevent session fixation attack
    // 1. Check for any existing session ID from the request
    const existingSessionId = req.cookies?.sessionId || req.headers['x-session-id'];
    if (existingSessionId) {
      // Delete the old session to prevent fixation
      database.sessions.delete(existingSessionId);
    }

    // 2. Generate a completely new session ID for the authenticated user
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    database.sessions.create(sessionId, teacher.id, expiresAt.toISOString());
    database.teachers.updateLastLogin(teacher.id);

    // Get teacher's class assignments
    const allAssignments = database.teacherClasses.getByTeacher(teacher.id);
    
    // Separate CT and ST assignments
    const ctAssignments = allAssignments.filter(a => a.is_class_teacher);
    const stAssignments = allAssignments.filter(a => !a.is_class_teacher);

    // SECURITY FIX: Clear any existing session cookie before setting new one
    // This prevents session fixation attacks
    res.clearCookie('sessionId');

    // SECURITY: Set secure session cookie with additional protections
    res.cookie('sessionId', sessionId, {
      httpOnly: true,      // Prevents JavaScript access
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict',  // Prevents CSRF via cross-site requests
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // SECURITY: Log minimal info (no sensitive data)
    console.log(`✓ User logged in: ID ${teacher.id} (${teacher.role})`);

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
app.post('/auth/logout', auth.isAuthenticated, csrfProtection, (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;
    
    if (sessionId) {
      database.sessions.delete(sessionId);
    }

    res.clearCookie('sessionId');

    res.json({
      success: true,
      message: 'Logged out successfully',
      redirectTo: '/index.html'
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

/**
 * GET /auth/csrf-token
 * Get CSRF token for frontend forms (IMP-006)
 */
app.get('/auth/csrf-token', csrfProtection, (req, res) => {
  res.json({
    success: true,
    csrfToken: req.csrfToken()
  });
});

// ==========================================
// ADMIN ENDPOINTS - TEACHER MANAGEMENT
// ==========================================
/**
 * POST /admin/teachers
 * Create new teacher (Admin only)
 * FIXED: Accept 'teacher' role and validate properly
 */
// IMP-007: Apply input validation and CSRF protection
app.post('/admin/teachers', auth.isAuthenticated, auth.isAdmin, csrfProtection, teacherValidation, async (req, res) => {
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

    const result = await database.teachers.create(username, password, name, email, teacherRole);

    // SECURITY: Log minimal info (no PII)
    console.log(`✓ Teacher created: ID ${result.lastInsertRowid} (${teacherRole})`);

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
 * GET /admin/teachers/paginated
 * Get paginated teachers list (Admin only) - IMP-003
 * Query params: page (default: 1), limit (default: 50)
 */
app.get('/admin/teachers/paginated', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const result = database.teachers.getPaginated(page, limit);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Get paginated teachers error:', error);
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
app.put('/admin/teachers/:id', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
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
 * POST /admin/teachers/:id/reset-password
 * Reset teacher password (Admin only)
 */
app.post('/admin/teachers/:id/reset-password', auth.isAuthenticated, auth.isAdmin, csrfProtection, async (req, res) => {
  try {
    const teacherId = parseInt(req.params.id);
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters'
      });
    }

    const teacher = database.teachers.getById(teacherId);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    await database.teachers.updatePassword(teacherId, newPassword);

    // SECURITY: Log minimal info (no PII)
    console.log(`✓ Password reset for teacher ID: ${teacherId}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
});

/**
 * DELETE /admin/teachers/:id
 * Delete teacher (Admin only)
 */
app.delete('/admin/teachers/:id', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
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
app.post('/admin/assign-class', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
  try {
    const { teacherId, className, section, isClassTeacher } = req.body;

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

      if (existingCT && (existingCT.class_name !== className || existingCT.section !== section)) {
        return res.status(400).json({
          success: false,
          message: `This teacher is already Class Teacher of ${existingCT.class_name}${existingCT.section ? '-' + existingCT.section : ''}. A teacher can only be CT of ONE class. Remove that assignment first or assign as Subject Teacher instead.`
        });
      }

      // Check if class already has a different CT
      const classCT = database.teacherClasses.getClassCT(className, section);

      if (classCT && classCT.teacher_id !== teacherId) {
        return res.status(400).json({
          success: false,
          message: `Class ${className}${section ? '-' + section : ''} already has a Class Teacher: ${classCT.teacher_name}. Remove them first or assign as Subject Teacher instead.`
        });
      }
    }

    // VALIDATION 2: If assigning as ST, make sure they're not already CT of this class
    if (!isClassTeacher) {
      const existingAssignment = database.teacherClasses.getByTeacher(teacherId)
        .find(a => a.class_name === className && a.section === section && a.is_class_teacher);

      if (existingAssignment) {
        return res.status(400).json({
          success: false,
          message: `This teacher is already Class Teacher of ${className}${section ? '-' + section : ''}. Cannot downgrade to Subject Teacher. Remove the assignment first.`
        });
      }
    }

    // All validations passed - assign the class
    database.teacherClasses.assign(teacherId, className, section || null, isClassTeacher || false);

    const assignmentType = isClassTeacher ? 'Class Teacher' : 'Subject Teacher';
    const fullClassName = section ? `${className}-${section}` : className;
    // SECURITY: Log action without sensitive details
    console.log(`✓ Teacher ${teacherId} assigned to class`);

    res.json({
      success: true,
      message: `Successfully assigned as ${assignmentType} of ${fullClassName}`
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
app.delete('/admin/assign-class', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
  try {
    const { teacherId, className, section } = req.body;

    if (!teacherId || !className) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID and class name are required'
      });
    }

    database.teacherClasses.remove(teacherId, className, section || null);

    const fullClassName = section ? `${className}-${section}` : className;
    // SECURITY: Log action without sensitive details
    console.log(`✓ Teacher ${teacherId} removed from class`);

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
 * Rate limited to prevent spam
 */
// IMP-008: Apply specific RFID rate limiter
app.post('/api/rfid/scan', rfidLimiter, (req, res) => {
  try {
    const { cardId, apiKey } = req.body;

    if (!cardId || typeof cardId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'cardId is required and must be a string'
      });
    }

    // Validate minimum length (3 characters)
    if (cardId.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'cardId must be at least 3 characters long'
      });
    }

    // Sanitize cardId: remove whitespace, limit length, uppercase
    const timestamp = new Date().toISOString();
    const trimmedCardId = cardId.trim().toUpperCase().slice(0, 50);
    
    // SECURITY: Don't log card IDs (sensitive)
    console.log(`📱 ESP8266 scan received`);

    // Look up student by card ID
    const student = database.students.getByCardId(trimmedCardId);

    if (!student) {
      // SECURITY: Don't log card IDs (sensitive)
      console.log(`⚠️  Unknown card scanned`);

      // Still record attendance even if student not registered
      const result = database.attendance.record(
        trimmedCardId,
        null,
        'Unknown Student',
        'N/A',
        null,
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
      student.section,
      timestamp
    );

    // SECURITY: Log without PII
    console.log(`✓ Attendance recorded: Student ID ${student.id}`);

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
          section: student.section,
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

    if (!cardId || typeof cardId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'cardId is required and must be a string'
      });
    }

    const timestamp = time || new Date().toISOString();
    const trimmedCardId = cardId.trim().toUpperCase().slice(0, 50);
    
    // SECURITY: Don't log card IDs
    console.log(`📝 Attendance request received`);

    const student = database.students.getByCardId(trimmedCardId);

    const result = database.attendance.record(
      trimmedCardId,
      student ? student.id : null,
      student ? student.name : 'Unknown Student',
      student ? student.class : 'N/A',
      student ? student.section : null,
      timestamp
    );

    // SECURITY: Log without PII
    console.log('✓ Attendance recorded for student ID:', student ? student.id : 'unknown');

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
 * Query params: section (optional)
 */
app.get('/attendance/class/:className', auth.isAuthenticated, auth.hasClassAccess, (req, res) => {
  try {
    const { className } = req.params;
    const { section } = req.query;
    const limit = parseInt(req.query.limit) || 100;

    const records = database.attendance.getByClass(className, section || null, limit);

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
 * Query params: section (optional)
 */
app.get('/attendance/class/:className/today', auth.isAuthenticated, auth.hasClassAccess, (req, res) => {
  try {
    const { className } = req.params;
    const { section } = req.query;

    // For class teachers - show detailed records
    if (req.user.role === 'admin' || req.isClassTeacherForClass) {
      const records = database.attendance.getTodayByClass(className, section || null);
      const totalStudents = database.students.getByClass(className, section || null).length;
      const presentCount = database.attendance.getTodayCountByClass(className, section || null);
      const absentStudents = database.attendance.getAbsentByClass(className, section || null);

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
      const totalStudents = database.students.getByClass(className, section || null).length;
      const presentCount = database.attendance.getTodayCountByClass(className, section || null);

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
 * GET /attendance/stats
 * Get attendance statistics
 */
app.get('/attendance/stats', auth.isAuthenticated, (req, res) => {
  try {
    const stats = database.attendance.getStats();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error fetching attendance stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance stats'
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
 * GET /attendance/paginated
 * Get paginated attendance records (Admin only) - IMP-003
 * Query params: page (default: 1), limit (default: 50)
 */
app.get('/attendance/paginated', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const result = database.attendance.getPaginated(page, limit);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Get paginated attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance'
    });
  }
});

/**
 * DELETE /attendance/clear
 * Clear all attendance (Admin only)
 */
app.delete('/attendance/clear', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
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
// IMP-007: Apply input validation
app.post('/students/register', auth.isAuthenticated, auth.isClassTeacher, studentValidation, (req, res) => {
  try {
    const { cardId, name, studentClass, section, rollNumber } = req.body;

    if (!cardId || !name) {
      return res.status(400).json({
        success: false,
        message: 'cardId and name are required'
      });
    }

    // Validate name length (BUG-017 fix)
    if (name.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Name must be less than 200 characters'
      });
    }

    // Validate cardId length
    if (cardId.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Card ID must be less than 100 characters'
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
      section || null,
      rollNumber || null
    );

    console.log('✓ Student registered:', name, `(Class: ${studentClass}, Section: ${section})`);

    res.status(201).json({
      success: true,
      message: 'Student registered successfully',
      data: {
        id: result.lastInsertRowid,
        cardId,
        name,
        class: studentClass,
        section: section
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
 * GET /students/paginated
 * Get paginated students list (Authenticated users) - IMP-003
 * Query params: page (default: 1), limit (default: 50)
 */
app.get('/students/paginated', auth.isAuthenticated, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const result = database.students.getPaginated(page, limit);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Get paginated students error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

/**
 * GET /students/class/:className
 * Get students by class
 * Query params: section (optional)
 */
app.get('/students/class/:className', auth.isAuthenticated, auth.hasClassAccess, (req, res) => {
  try {
    const { className } = req.params;
    const { section } = req.query;
    const students = database.students.getByClass(className, section || null);

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
 * OPT-003: Fixed N+1 query - now uses single batch query for all stats
 */
app.get('/admin/students', auth.isAuthenticated, auth.isAdmin, (req, res) => {
  try {
    const students = database.students.getAll();

    // OPT-003: Get all attendance stats in a single query (was N+1)
    const attendanceStats = database.attendance.getStatsForAllStudents();

    // Map stats to students in-memory (O(n) instead of O(n) queries)
    const studentsWithStats = students.map(student => {
      const stats = attendanceStats.get(student.id);
      return {
        ...student,
        stats: {
          totalAttendance: stats ? stats.totalAttendance : 0,
          lastSeen: stats ? stats.lastSeen : null
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
app.put('/admin/students/:id', auth.isAuthenticated, auth.isAdmin, csrfProtection, async (req, res) => {
  try {
    const studentId = parseInt(req.params.id);
    const { cardId, name, studentClass, section, rollNumber } = req.body;

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
    await database.students.update(
      studentId,
      cardId || existingStudent.card_id,
      name,
      studentClass || null,
      section || null,
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
        section: section,
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
app.delete('/admin/students/:id', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
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

    // SECURITY: Log without PII
    console.log(`✓ Student deleted: ID ${studentId}`);

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
 * POST /api/student/reset-password
 * Reset student password (Admin only)
 */
app.post('/api/student/reset-password', auth.isAuthenticated, auth.isAdmin, csrfProtection, async (req, res) => {
  try {
    const { studentId, newPassword } = req.body;

    if (!studentId || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Student ID and new password are required'
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters'
      });
    }

    const student = database.students.getById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    await database.students.updatePassword(studentId, newPassword);

    // SECURITY: Log without PII
    console.log(`✓ Password reset for student ID: ${studentId}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset student password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
});

/**
 * POST /admin/students/bulk-import
 * Bulk import students from CSV data (Admin only)
 */
app.post('/admin/students/bulk-import', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
  try {
    const { students } = req.body; // Array of {cardId, name, class, section, rollNumber}

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

    // SECURITY: Sanitize string inputs to prevent CSV/formula injection
    const sanitizeString = (str, maxLength = 200) => {
      if (str == null) return null;
      let sanitized = String(str).slice(0, maxLength);
      // Remove formula injection characters at start
      sanitized = sanitized.replace(/^[=+\-@\t\r\n]+/, '');
      // Remove null bytes and control characters
      sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      return sanitized.trim();
    };

    // SECURITY: Validate card ID format
    const isValidCardId = (id) => {
      return typeof id === 'string' &&
             id.length >= 3 &&
             id.length <= 100 &&
             /^[\w\-\s]+$/.test(id); // Allow alphanumeric, hyphen, underscore, space
    };

    students.forEach((student, index) => {
      try {
        // Validate student is an object
        if (!student || typeof student !== 'object') {
          results.failed++;
          results.errors.push({
            row: index + 1,
            error: 'Invalid student data - must be an object'
          });
          return;
        }

        let { cardId, name, studentClass, section, rollNumber } = student;

        // SECURITY: Validate cardId format
        if (!cardId || !name || !isValidCardId(cardId)) {
          results.failed++;
          results.errors.push({
            row: index + 1,
            error: 'Missing or invalid cardId or name'
          });
          return;
        }

        // SECURITY: Sanitize all string inputs
        cardId = sanitizeString(cardId, 100);
        name = sanitizeString(name, 200);
        studentClass = sanitizeString(studentClass, 50);
        section = sanitizeString(section, 50);
        rollNumber = sanitizeString(rollNumber, 50);

        // Check if card already exists
        if (database.students.cardExists(cardId)) {
          results.failed++;
          results.errors.push({
            row: index + 1,
            cardId: cardId.slice(0, 20), // Limit cardId in error message
            error: 'Card ID already registered'
          });
          return;
        }

        // Register student
        database.students.register(
          cardId,
          name,
          studentClass,
          section,
          rollNumber
        );

        results.success++;

      } catch (error) {
        results.failed++;
        // SECURITY: Don't expose internal error details
        results.errors.push({
          row: index + 1,
          error: 'Failed to import student'
        });
        console.error('Import error for row', index + 1, error);
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
 * OPT-004: Fixed N+1 queries - now uses batch queries
 */
app.get('/api/analytics/students/v2', auth.isAuthenticated, (req, res) => {
  try {
    const students = database.students.getAll();

    // OPT-004: Get total days in one query
    const totalDaysStmt = database.db.prepare(
      `SELECT COUNT(DISTINCT DATE(timestamp)) as total_days FROM attendance`
    );
    const { total_days } = totalDaysStmt.get();

    // OPT-004: Batch get present days for ALL students in one query (was N+1)
    const presentDaysMap = database.attendance.getPresentDaysForAllStudents();

    // OPT-004: Batch get marks for ALL students in one query (was N+1)
    const marksMap = database.marks.getAllStats();

    // Map results in-memory (O(n) instead of O(n) database queries)
    const result = students.map(student => {
      const present_days = presentDaysMap.get(student.id) || 0;

      // Calculate attendance only if there are school days recorded
      const attendance = total_days > 0
        ? Math.round((present_days / total_days) * 100)
        : 0;

      // Get pre-computed marks stats
      const marksRow = marksMap.get(student.id) || { midterm_pct: 0, final_pct: 0, avg_score: 0 };

      const avg_score = marksRow.avg_score;
      let grade = null;
      if (avg_score >= 90) grade = 'A';
      else if (avg_score >= 75) grade = 'B';
      else if (avg_score >= 60) grade = 'C';
      else if (avg_score >= 45) grade = 'D';
      else if (avg_score > 0)   grade = 'F';

      return {
        id: student.id, name: student.name,
        class: student.class, roll_number: student.roll_number,
        attendance, present_days, total_days,
        midterm: marksRow.midterm_pct,
        final_score: marksRow.final_pct,
        avg_score, grade
      };
    });

    res.json({ success: true, count: result.length, data: result });
  } catch (error) {
    console.error('Analytics v2 error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
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
app.post('/api/analytics/import-grades', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
  try {
    // SECURITY: Whitelist of allowed column names to prevent SQL injection
    const ALLOWED_COLUMNS = {
      'midterm': 'INTEGER',
      'final_score': 'INTEGER',
      'grade': 'TEXT'
    };

    // Safe-add grade columns to students table (idempotent)
    Object.entries(ALLOWED_COLUMNS).forEach(([col, type]) => {
      try {
        // Column name is from whitelist, safe to use in SQL
        database.db.exec(`ALTER TABLE students ADD COLUMN ${col} ${type}`);
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
 
    // SECURITY: Validation helper to prevent CSV/formula injection
    const sanitizeGradeInput = (value, maxLength = 10) => {
      if (value == null) return null;
      const str = String(value).slice(0, maxLength);
      // Prevent formula injection by removing =, +, -, @, \t, \r, \n at start
      return str.replace(/^[=+\-@\t\r\n]+/, '');
    };

    // SECURITY: Validate roll numbers
    const isValidRollNumber = (rn) => {
      return typeof rn === 'string' && rn.length >= 1 && rn.length <= 50;
    };

    let updated = 0;
    const doAll = database.db.transaction(() => {
      grades.forEach(({ rollNumber, midterm, finalScore, grade }) => {
        // SECURITY: Validate roll number
        if (!isValidRollNumber(String(rollNumber))) {
          console.warn('Invalid roll number skipped:', rollNumber);
          return;
        }

        // SECURITY: Sanitize grade values
        const sanitizedGrade = sanitizeGradeInput(grade);
        const sanitizedMidterm = Math.min(100, Math.max(0, parseInt(midterm) || 0));
        const sanitizedFinal = Math.min(100, Math.max(0, parseInt(finalScore) || 0));

        const info = updateStmt.run(sanitizedMidterm, sanitizedFinal, sanitizedGrade, String(rollNumber));
        if (info.changes > 0) updated++;
      });
    });
    doAll();
 
    console.log(`✓ Grade import: updated ${updated} students`);
    res.json({ success: true, updated });
  } catch (error) {
    console.error('Grade import error:', error);
    // SECURITY: Don't expose internal error details to client
    console.error('Import error:', error);
    res.status(500).json({ success: false, message: 'Import failed' });
  }
});
 
/**
 * POST /api/analytics/ai-insight
 * Proxies the summary data to Google Gemini API (free tier).
 * Body: { summary: string }
 *
 * Requires GEMINI_API_KEY in environment:
 *   Get yours free at: https://aistudio.google.com/app/apikey
 *   Set it with: export GEMINI_API_KEY=your-key-here
 */
app.post('/api/analytics/ai-insight', auth.isAuthenticated, asyncHandler(async (req, res) => {
  const { summary } = req.body;
  if (!summary) return res.status(400).json({ success: false, message: 'summary required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/app/apikey'
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an educational data analyst for an Indian school RFID attendance system. Analyse this student attendance and academic performance data. Write 3–4 focused paragraphs covering: (1) key trend findings and what the correlation coefficient means in plain English, (2) which students need immediate intervention and exactly why, (3) predicted outcomes if attendance improves — give specific numbers, (4) concrete actionable steps for teachers this week. Be direct and specific.\n\n${summary}`
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024
          }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      // SECURITY: Log error internally, don't expose to client
      console.error('Gemini API error:', data.error);
      return res.status(500).json({ success: false, message: 'AI analysis failed' });
    }

    // Extract text from Gemini response
  const insight = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI';
  res.json({ success: true, insight });
}));


// ============================================================
// MARKS ENTRY ROUTES
// ============================================================

// ── Prepared statements ───────────────────────────────────────────────────────
const upsertMark = database.db.prepare(`
  INSERT INTO marks (student_id, class, section, subject, exam_type, marks_obtained, max_mark, grade, entered_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(student_id, subject, exam_type)
  DO UPDATE SET
    marks_obtained = excluded.marks_obtained,
    max_mark       = excluded.max_mark,
    grade          = excluded.grade,
    entered_by     = excluded.entered_by,
    updated_at     = CURRENT_TIMESTAMP
`);

const getMarksByClass = database.db.prepare(`
  SELECT m.*, s.name as student_name, s.roll_number
  FROM marks m
  JOIN students s ON m.student_id = s.id
  WHERE m.class = ? AND (m.section = ? OR m.section IS NULL OR m.section = '')
  ORDER BY s.roll_number, m.subject, m.exam_type
`);

const getMarksByClassAndSection = database.db.prepare(`
  SELECT m.*, s.name as student_name, s.roll_number
  FROM marks m
  JOIN students s ON m.student_id = s.id
  WHERE m.class = ? AND m.section = ?
  ORDER BY s.roll_number, m.subject, m.exam_type
`);

const getMarksByStudent = database.db.prepare(`
  SELECT m.*, s.name as student_name, s.roll_number
  FROM marks m
  JOIN students s ON m.student_id = s.id
  WHERE m.student_id = ? AND m.class = ?
  ORDER BY m.subject, m.exam_type
`);

const deleteMarkRecord = database.db.prepare(`
  DELETE FROM marks WHERE student_id = ? AND subject = ? AND exam_type = ?
`);

// OPT-007: Cached prepared statements for analytics routes
const getDistinctClasses = database.db.prepare(`
  SELECT DISTINCT class FROM students WHERE class IS NOT NULL ORDER BY class
`);

const getMarksSummaryWithSection = database.db.prepare(`
  SELECT
    s.id, s.name, s.roll_number,
    AVG(CASE WHEN m.exam_type = 'midterm' THEN (m.marks_obtained * 100.0 / m.max_mark) END) as midterm_pct,
    AVG(CASE WHEN m.exam_type = 'final'   THEN (m.marks_obtained * 100.0 / m.max_mark) END) as final_pct,
    AVG(m.marks_obtained * 100.0 / m.max_mark) as overall_pct,
    COUNT(m.id) as subjects_entered
  FROM students s
  LEFT JOIN marks m ON m.student_id = s.id AND m.class = ? AND m.section = ?
  WHERE s.class = ? AND s.section = ?
  GROUP BY s.id
  ORDER BY s.roll_number
`);

const getMarksSummaryWithoutSection = database.db.prepare(`
  SELECT
    s.id, s.name, s.roll_number,
    AVG(CASE WHEN m.exam_type = 'midterm' THEN (m.marks_obtained * 100.0 / m.max_mark) END) as midterm_pct,
    AVG(CASE WHEN m.exam_type = 'final'   THEN (m.marks_obtained * 100.0 / m.max_mark) END) as final_pct,
    AVG(m.marks_obtained * 100.0 / m.max_mark) as overall_pct,
    COUNT(m.id) as subjects_entered
  FROM students s
  LEFT JOIN marks m ON m.student_id = s.id AND m.class = ? AND (m.section IS NULL OR m.section = '')
  WHERE s.class = ? AND (s.section IS NULL OR s.section = '')
  GROUP BY s.id
  ORDER BY s.roll_number
`);

const getLeaderboardWithSection = database.db.prepare(`
  SELECT s.name, s.roll_number,
    ROUND(AVG(m.marks_obtained * 100.0 / m.max_mark), 1) as avg_pct,
    COUNT(m.id) as subjects
  FROM students s
  JOIN marks m ON m.student_id = s.id AND m.class = ? AND m.section = ?
  WHERE s.class = ? AND s.section = ?
  GROUP BY s.id
  HAVING subjects > 0
  ORDER BY avg_pct DESC
  LIMIT 10
`);

const getLeaderboardWithoutSection = database.db.prepare(`
  SELECT s.name, s.roll_number,
    ROUND(AVG(m.marks_obtained * 100.0 / m.max_mark), 1) as avg_pct,
    COUNT(m.id) as subjects
  FROM students s
  JOIN marks m ON m.student_id = s.id AND m.class = ? AND (m.section IS NULL OR m.section = '')
  WHERE s.class = ? AND (s.section IS NULL OR s.section = '')
  GROUP BY s.id
  HAVING subjects > 0
  ORDER BY avg_pct DESC
  LIMIT 10
`);

// ── GET /api/marks/classes ────────────────────────────────────────────────────
// Returns list of distinct classes the current user can access
app.get('/api/marks/classes', auth.isAuthenticated, (req, res) => {
  try {
    let classes = [];

    if (req.user.role === 'admin') {
      // Admin sees all classes
      const rows = getDistinctClasses.all();
      classes = rows.map(r => r.class);
    } else {
      // Teacher sees only their assigned classes
      const assignments = database.teacherClasses.getByTeacher(req.user.id);
      classes = assignments.map(a => a.class_name).sort();
    }

    res.json({ success: true, classes });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ success: false, message: 'Failed to get classes' });
  }
});

// ── GET /api/marks/students/:class ───────────────────────────────────────────
// Returns students in a class (teacher must have access)
// Query params: section (optional)
// OPTIMIZED: Uses new separate class/section model
app.get('/api/marks/students/:className', auth.isAuthenticated, (req, res) => {
  try {
    const { className } = req.params;
    const { section } = req.query;

    // Access check
    if (req.user.role !== 'admin') {
      const assignments = database.teacherClasses.getByTeacher(req.user.id);
      const hasAccess   = assignments.some(a => {
        // Match base class
        if (a.class_name !== className) return false;
        // If teacher has no section, they have access to all sections
        if (!a.section) return true;
        // If section requested, must match
        if (section) return a.section === section;
        // No section requested, teacher has section-specific access
        return true;
      });
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'No access to this class' });
      }
    }

    const students = database.students.getByClass(className, section || null);
    res.json({ success: true, students });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ success: false, message: 'Failed to get students' });
  }
});

// ── GET /api/marks/records/:class ────────────────────────────────────────────
// Returns all mark records for a class
// Query params: section (optional)
// OPTIMIZED: Uses new separate class/section model
app.get('/api/marks/records/:className', auth.isAuthenticated, (req, res) => {
  try {
    const { className } = req.params;
    const { section } = req.query;

    if (req.user.role !== 'admin') {
      const assignments = database.teacherClasses.getByTeacher(req.user.id);
      const hasAccess = assignments.some(a => {
        if (a.class_name !== className) return false;
        // Teacher with no section assignment has access to all sections
        if (!a.section) return true;
        // Otherwise section must match
        return a.section === section || (!section);
      });
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'No access to this class' });
      }
    }

    let records;
    if (section) {
      records = getMarksByClassAndSection.all(className, section);
    } else {
      records = getMarksByClass.all(className, '');
    }
    res.json({ success: true, records });
  } catch (error) {
    console.error('Get records error:', error);
    res.status(500).json({ success: false, message: 'Failed to get records' });
  }
});

// ── GET /api/marks/report/:studentId ─────────────────────────────────────────
// Returns all marks for a single student (for report card)
app.get('/api/marks/report/:studentId', auth.isAuthenticated, (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId);
    const className = req.query.class;

    if (!className) {
      return res.status(400).json({ success: false, message: 'class query param required' });
    }

    if (req.user.role !== 'admin') {
      const assignments = database.teacherClasses.getByTeacher(req.user.id);
      if (!assignments.some(a => a.class_name === className)) {
        return res.status(403).json({ success: false, message: 'No access to this class' });
      }
    }

    const records = getMarksByStudent.all(studentId, className);
    res.json({ success: true, records });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ success: false, message: 'Failed to get report' });
  }
});

// ── POST /api/marks/save ─────────────────────────────────────────────────────
// Bulk upsert marks. Body: { records: [{studentId, subject, examType, maxMark, marksObtained, grade, className, section}] }
// OPTIMIZED: Uses new separate class/section model
app.post('/api/marks/save', auth.isAuthenticated, csrfProtection, (req, res) => {
  try {
    const { records } = req.body;

    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ success: false, message: 'records array required' });
    }

    // Validate all records before processing
    const validExamTypes = ['midterm', 'final', 'quiz', 'assignment', 'test'];
    for (const r of records) {
      // Validate exam_type
      if (r.examType && !validExamTypes.includes(r.examType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid exam_type: ${r.examType}. Must be one of: ${validExamTypes.join(', ')}`
        });
      }

      // Validate marks_obtained is not negative and not exceeding maxMark
      if (typeof r.marksObtained !== 'number' || r.marksObtained < 0) {
        return res.status(400).json({
          success: false,
          message: 'marksObtained must be a non-negative number'
        });
      }

      if (r.marksObtained > (r.maxMark || 100)) {
        return res.status(400).json({
          success: false,
          message: `marksObtained (${r.marksObtained}) cannot exceed maxMark (${r.maxMark || 100})`
        });
      }

      // Validate studentId is a positive integer
      if (!Number.isInteger(r.studentId) || r.studentId <= 0) {
        return res.status(400).json({
          success: false,
          message: 'studentId must be a positive integer'
        });
      }

      // Validate subject has reasonable length
      if (!r.subject || r.subject.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'subject is required and must be less than 100 characters'
        });
      }
    }

    // Access check on first record's class
    const className = records[0].className;
    const section = records[0].section;
    if (req.user.role !== 'admin') {
      const assignments = database.teacherClasses.getByTeacher(req.user.id);
      const hasAccess = assignments.some(a => {
        if (a.class_name !== className) return false;
        // Teacher with no section assignment can edit all sections
        if (!a.section) return true;
        // Otherwise section must match
        return a.section === section || (!section);
      });
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'No access to this class' });
      }
    }

    let saved = 0;
    const doAll = database.db.transaction(() => {
      records.forEach(r => {
        // Ensure className is base class only (strip section if included)
        const baseClass = r.className ? r.className.split('-')[0] : r.className;
        upsertMark.run(
          r.studentId,
          baseClass,
          r.section || null,
          r.subject,
          r.examType,
          r.marksObtained,
          r.maxMark || 100,
          r.grade || null,
          req.user.id
        );
        saved++;
      });
    });
    doAll();

    // SECURITY: Log without PII
    console.log(`✓ Marks saved: ${saved} records by user ID ${req.user.id}`);
    res.json({ success: true, saved });
  } catch (error) {
    console.error('Save marks error:', error);
    // SECURITY: Don't expose internal error details
    console.error('Save marks error:', error);
    res.status(500).json({ success: false, message: 'Failed to save marks' });
  }
});

// ── DELETE /api/marks/record ──────────────────────────────────────────────────
// Delete a single mark record
// Body: { studentId, subject, examType }
app.delete('/api/marks/record', auth.isAuthenticated, auth.isAdmin, csrfProtection, (req, res) => {
  try {
    const { studentId, subject, examType } = req.body;
    if (!studentId || !subject || !examType) {
      return res.status(400).json({ success: false, message: 'studentId, subject, examType required' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const result = deleteMarkRecord.run(studentId, subject, examType);
    res.json({ success: true, deleted: result.changes });
  } catch (error) {
    console.error('Delete mark error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete mark' });
  }
});

// ── GET /api/marks/summary ────────────────────────────────────────────────────
// Class-level summary for analytics (used by /analytics.html)
// Query params: section (optional)
app.get('/api/marks/summary/:className', auth.isAuthenticated, (req, res) => {
  try {
    const { className } = req.params;
    const { section } = req.query;

    let stmt;
    let summary;

    if (section) {
      summary = getMarksSummaryWithSection.all(className, section, className, section);
    } else {
      summary = getMarksSummaryWithoutSection.all(className, className);
    }

    res.json({ success: true, summary });
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ success: false, message: 'Failed to get summary' });
  }
});

// ── GET /api/marks/leaderboard/:class ────────────────────────────────────────
// Top performers in a class
// Query params: section (optional)
app.get('/api/marks/leaderboard/:className', auth.isAuthenticated, (req, res) => {
  try {
    const { className } = req.params;
    const { section } = req.query;

    let stmt;
    let leaderboard;

    if (section) {
      leaderboard = getLeaderboardWithSection.all(className, section, className, section);
    } else {
      leaderboard = getLeaderboardWithoutSection.all(className, className);
    }

    res.json({ success: true, leaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to get leaderboard' });
  }
});
// ────────────────────────────────────────────────────────────────────


// ==========================================
// START SERVER
// ==========================================

// Global error handler - catches errors from async routes
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

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

// Handle SIGTERM for graceful shutdown (BUG-011)
process.on('SIGTERM', () => {
  console.log('\n\nSIGTERM received, shutting down gracefully...');
  database.db.close();
  console.log('✓ Database connection closed');
  process.exit(0);
});

// Handle uncaught exceptions (BUG-011)
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  database.db.close();
  process.exit(1);
});

// Handle unhandled promise rejections (BUG-011)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// OPT-012: Graceful shutdown for nodemon SIGUSR2
process.on('SIGUSR2', () => {
  console.log('\nSIGUSR2 received (nodemon restart), shutting down gracefully...');
  database.db.close();
  console.log('✓ Database connection closed');
  process.exit(0);
});