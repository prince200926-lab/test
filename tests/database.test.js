/**
 * Database Tests - IMP-024
 * Tests for database operations
 */

// Mock bcrypt first before requiring
const mockHashSync = jest.fn().mockReturnValue('hashed_password');
const mockCompare = jest.fn().mockResolvedValue(true);

jest.mock('bcryptjs', () => ({
  hashSync: (...args) => mockHashSync(...args),
  compare: (...args) => mockCompare(...args),
  compareSync: jest.fn()
}));

// Mock better-sqlite3
jest.mock('better-sqlite3', () => {
  return jest.fn().mockImplementation(() => ({
    pragma: jest.fn(),
    exec: jest.fn(),
    prepare: jest.fn().mockReturnValue({
      run: jest.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
      get: jest.fn().mockReturnValue({ count: 0, present_count: 5 }),
      all: jest.fn().mockReturnValue([])
    }),
    close: jest.fn()
  }));
});

describe('Database Operations', () => {
  let database;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset module cache to get fresh instance
    jest.resetModules();
  });

  describe('Teacher Operations', () => {
    beforeEach(() => {
      database = require('../database');
    });

    it('should create a teacher with hashed password', async () => {
      const result = await database.teachers.create('testuser', 'password123', 'Test User', 'test@example.com', 'teacher');

      expect(mockHashSync).toHaveBeenCalledWith('password123', 10);
      expect(result).toBeDefined();
    });

    it('should verify password correctly', async () => {
      mockCompare.mockResolvedValue(true);

      const result = await database.teachers.verifyPassword('password123', 'hashed_password');

      expect(result).toBe(true);
      expect(mockCompare).toHaveBeenCalledWith('password123', 'hashed_password');
    });

    it('should return false for invalid password', async () => {
      mockCompare.mockResolvedValue(false);

      const result = await database.teachers.verifyPassword('wrongpassword', 'hashed_password');

      expect(result).toBe(false);
    });

    it('should check if username exists', () => {
      const result = database.teachers.getByUsername('testuser');
      expect(result).toBeDefined();
    });
  });

  describe('Student Operations', () => {
    beforeEach(() => {
      database = require('../database');
    });

    it('should register a student', async () => {
      const result = await database.students.register('CARD123', 'John Doe', '10', 'A', 'R001', 'studentpass');

      expect(result).toBeDefined();
      expect(mockHashSync).toHaveBeenCalledWith('studentpass', 10);
    });

    it('should verify student password', async () => {
      mockCompare.mockResolvedValue(true);

      const result = await database.students.verifyPassword('studentpass', 'hashed_password');

      expect(result).toBe(true);
    });

    it('should check if card exists', () => {
      const result = database.students.cardExists('CARD123');
      expect(typeof result).toBe('boolean');
    });

    it('should update student password', async () => {
      const result = await database.students.updatePassword(1, 'newpassword');

      expect(mockHashSync).toHaveBeenCalledWith('newpassword', 10);
      expect(result).toBeDefined();
    });
  });

  describe('Attendance Operations', () => {
    beforeEach(() => {
      database = require('../database');
    });

    it('should record attendance', () => {
      const result = database.attendance.record('CARD123', 1, 'John Doe', '10', 'A', new Date().toISOString());

      expect(result).toBeDefined();
    });

    it('should get today attendance count', () => {
      const result = database.attendance.getTodayCountByClass('10', 'A');
      expect(typeof result).toBe('number');
    });

    it('should clear all attendance', () => {
      const result = database.attendance.clearAll();
      expect(result).toBeDefined();
    });
  });

  describe('Session Operations', () => {
    beforeEach(() => {
      database = require('../database');
    });

    it('should create a session', () => {
      const result = database.sessions.create('session-id', 1, new Date().toISOString());
      expect(result).toBeDefined();
    });

    it('should delete a session', () => {
      const result = database.sessions.delete('session-id');
      expect(result).toBeDefined();
    });

    it('should clean expired sessions', () => {
      const result = database.sessions.cleanExpired();
      expect(result).toBeDefined();
    });
  });

  describe('Pagination Operations', () => {
    beforeEach(() => {
      database = require('../database');
    });

    it('should return paginated teachers', () => {
      const result = database.teachers.getPaginated(1, 50);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination).toHaveProperty('page', 1);
      expect(result.pagination).toHaveProperty('limit', 50);
    });

    it('should return paginated students', () => {
      const result = database.students.getPaginated(1, 50);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
    });

    it('should return paginated attendance', () => {
      const result = database.attendance.getPaginated(1, 50);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
    });
  });
});
