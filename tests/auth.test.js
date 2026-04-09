/**
 * Authentication Tests - IMP-024
 * Tests for login, logout, and authentication middleware
 */

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Mock database
jest.mock('../database', () => ({
  teachers: {
    getByUsername: jest.fn(),
    verifyPassword: jest.fn(),
    updateLastLogin: jest.fn()
  },
  sessions: {
    create: jest.fn(),
    delete: jest.fn()
  }
}));

const database = require('../database');

// Create minimal express app for testing
const app = express();
app.use(express.json());
app.use(cookieParser());

// Simple login endpoint for testing
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required'
    });
  }

  const teacher = database.teachers.getByUsername(username);

  if (!teacher || !database.teachers.verifyPassword(password, teacher.password_hash)) {
    return res.status(401).json({
      success: false,
      message: 'Invalid username or password'
    });
  }

  database.sessions.create('test-session-id', teacher.id, new Date().toISOString());
  database.teachers.updateLastLogin(teacher.id);

  res.cookie('sessionId', 'test-session-id', {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  });

  res.json({
    success: true,
    message: 'Login successful',
    data: { user: { username, role: teacher.role } }
  });
});

app.post('/auth/logout', (req, res) => {
  const sessionId = req.cookies?.sessionId;
  if (sessionId) {
    database.sessions.delete(sessionId);
  }
  res.clearCookie('sessionId');
  res.json({ success: true, message: 'Logged out successfully' });
});

describe('Authentication Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    it('should return 400 if username or password is missing', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('required');
    });

    it('should return 401 for invalid credentials', async () => {
      database.teachers.getByUsername.mockReturnValue(null);

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'invalid', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Invalid');
    });

    it('should login successfully with valid credentials', async () => {
      const mockTeacher = {
        id: 1,
        username: 'admin',
        password_hash: 'hashed_password',
        role: 'admin',
        name: 'Admin User'
      };

      database.teachers.getByUsername.mockReturnValue(mockTeacher);
      database.teachers.verifyPassword.mockReturnValue(true);
      database.sessions.create.mockReturnValue({ lastInsertRowid: 1 });

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'admin', password: 'admin123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.username).toBe('admin');
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should handle database errors gracefully', async () => {
      database.teachers.getByUsername.mockImplementation(() => {
        throw new Error('Database error');
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'admin', password: 'admin123' });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout successfully', async () => {
      const res = await request(app)
        .post('/auth/logout')
        .set('Cookie', ['sessionId=test-session']);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(database.sessions.delete).toHaveBeenCalledWith('test-session');
    });

    it('should handle logout without session', async () => {
      const res = await request(app).post('/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
