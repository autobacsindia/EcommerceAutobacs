// Minimal Express server for testing Railway deployment
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Trust proxy
app.set('trust proxy', 1);

// Simple logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip}`);
  next();
});

// Test endpoint
app.get('/ping', (req, res) => {
  console.log('>>> PING received!');
  res.send('pong');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Root
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Minimal server is working!',
    timestamp: new Date().toISOString()
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MINIMAL SERVER running on port ${PORT}`);
  console.log(`Test URLs:`);
  console.log(`  - http://localhost:${PORT}/ping`);
  console.log(`  - http://localhost:${PORT}/health`);
  console.log(`  - http://localhost:${PORT}/`);
  
  // Log immediately when requests come in
  server.on('request', (req) => {
    console.log(`📩 Incoming request: ${req.method} ${req.url}`);
  });
});

server.on('error', (err) => {
  console.error('❌ Server error:', err);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
