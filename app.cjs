// cPanel Phusion Passenger ("Setup Node.js App") startup entry point
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

import('./dist-server/server.mjs').catch((err) => {
  console.error('Failed to start PrintFlow AutoPrint server:', err);
  process.exit(1);
});
