const os = require('os');

/**
 * COLYSEUS CLOUD WARNING:
 * ----------------------
 * PLEASE DO NOT UPDATE THIS FILE MANUALLY AS IT MAY CAUSE DEPLOYMENT ISSUES
 */

module.exports = {
  apps : [{
    name: "colyseus-app",
    script: 'build/index.js',
    time: true,
    watch: false,
    // instances: os.cpus().length,
    instances: 1,
    exec_mode: 'fork',
    wait_ready: true,
    max_memory_restart: "1G"
    env_production: {
      NODE_ENV: 'production'
    }
  }],
};

