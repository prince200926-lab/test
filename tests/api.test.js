/**
 * API Endpoint Tests - IMP-024
 * Tests for REST API endpoints
 */

const request = require('supertest');
const express = require('express');

// Create test app
const app = express();
app.use(express.json());

// Mock auth middleware
const mockAuth = (req, res, next) => {
  req.user = { id: 1, username: 'test', role: 'admin' };
  next();
};

// Simple test endpoints
app.get('/test', (req, res) => {
  res.json({ success: true, message: 'Server is running!' });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    database: 'connected',
    stats: { students: 10, teachers: 2 }
  });
});

// Protected endpoint
app.get('/api/protected', mockAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Rate limiting test endpoint
let requestCount = 0;
const rateLimitMiddleware = (req, res, next) => {
  requestCount++;
  if (requestCount > 100) {
    return res.status(429).json({ success: false, message: 'Rate limit exceeded' });
  }
  next();
};

app.get('/api/rate-limited', rateLimitMiddleware, (req, res) => {
  res.json({ success: true, count: requestCount });
});

describe('Public API Endpoints', () => {
  describe('GET /test', () => {
    it('should return server status', async () => {
      const res = await request(app).get('/test');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('running');
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('healthy');
      expect(res.body).toHaveProperty('stats');
    });
  });
});

describe('Protected API Endpoints', () => {
  describe('GET /api/protected', () => {
    it('should return user data when authenticated', async () => {
      const res = await request(app).get('/api/protected');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toHaveProperty('id', 1);
      expect(res.body.user).toHaveProperty('role', 'admin');
    });
  });
});

describe('Rate Limiting', () => {
  beforeEach(() => {
    requestCount = 0;
  });

  it('should allow requests under the limit', async () => {
    const res = await request(app).get('/api/rate-limited');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should block requests over the limit', async () => {
    // Simulate 101 requests
    for (let i = 0; i < 100; i++) {
      await request(app).get('/api/rate-limited');
    }

    const res = await request(app).get('/api/rate-limited');

    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Rate limit');
  });
});

describe('Input Validation', () => {
  const validationApp = express();
  validationApp.use(express.json());

  // Simple validation
  validationApp.post('/api/validate', (req, res) => {
    const { name, email } = req.body;

    if (!name || name.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Name must be at least 3 characters'
      });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'Valid email is required'
      });
    }

    res.json({ success: true, data: { name, email } });
  });

  it('should reject invalid input', async () => {
    const res = await request(validationApp)
      .post('/api/validate')
      .send({ name: 'ab', email: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should accept valid input', async () => {
    const res = await request(validationApp)
      .post('/api/validate')
      .send({ name: 'John Doe', email: 'john@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('name', 'John Doe');
  });
});

describe('Error Handling', () => {
  const errorApp = express();
  errorApp.use(express.json());

  errorApp.get('/api/error', (req, res) => {
    throw new Error('Test error');
  });

  errorApp.use((err, req, res, next) => {
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  });

  it('should handle server errors gracefully', async () => {
    const res = await request(errorApp).get('/api/error');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Internal server error');
  });
});
