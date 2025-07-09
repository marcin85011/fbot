import winston from 'winston';
import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Advanced Logging System for Flash Loan Arbitrage Bot
 * Provides structured logging with performance monitoring and error tracking
 */
class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.enableFileLogging = process.env.ENABLE_FILE_LOGGING !== 'false';
    this.enableConsoleLogging = process.env.ENABLE_CONSOLE_LOGGING !== 'false';
    
    this.logger = this.createLogger();
    this.performanceMetrics = new Map();
    this.errorCounts = new Map();
    this.startTime = Date.now();
  }

  /**
   * Create Winston logger instance with custom configuration
   */
  createLogger() {
    const formats = [
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ];

    const transports = [];

    // Console transport
    if (this.enableConsoleLogging) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
              return `${timestamp} [${level}]: ${message} ${metaStr}`;
            })
          )
        })
      );
    }

    // File transports
    if (this.enableFileLogging) {
      // General log file
      transports.push(
        new winston.transports.File({
          filename: 'logs/app.log',
          format: winston.format.combine(...formats),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5
        })
      );

      // Error log file
      transports.push(
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: winston.format.combine(...formats),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5
        })
      );

      // Arbitrage-specific log file
      transports.push(
        new winston.transports.File({
          filename: 'logs/arbitrage.log',
          format: winston.format.combine(...formats),
          maxsize: 50 * 1024 * 1024, // 50MB
          maxFiles: 10
        })
      );
    }

    return winston.createLogger({
      level: this.logLevel,
      format: winston.format.combine(...formats),
      transports,
      exitOnError: false
    });
  }

  /**
   * Log general information
   * @param {string} message - Log message
   * @param {object} meta - Additional metadata
   */
  info(message, meta = {}) {
    this.logger.info(message, { 
      ...meta, 
      timestamp: new Date().toISOString(),
      category: 'general'
    });
  }

  /**
   * Log debug information
   * @param {string} message - Log message
   * @param {object} meta - Additional metadata
   */
  debug(message, meta = {}) {
    this.logger.debug(message, { 
      ...meta, 
      timestamp: new Date().toISOString(),
      category: 'debug'
    });
  }

  /**
   * Log warnings
   * @param {string} message - Log message
   * @param {object} meta - Additional metadata
   */
  warn(message, meta = {}) {
    this.logger.warn(message, { 
      ...meta, 
      timestamp: new Date().toISOString(),
      category: 'warning'
    });
  }

  /**
   * Log errors with automatic error tracking
   * @param {string} message - Log message
   * @param {Error|object} error - Error object or metadata
   * @param {object} meta - Additional metadata
   */
  error(message, error = {}, meta = {}) {
    const errorKey = message.substring(0, 50);
    const currentCount = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, currentCount + 1);

    const errorMeta = {
      ...meta,
      timestamp: new Date().toISOString(),
      category: 'error',
      errorCount: currentCount + 1
    };

    if (error instanceof Error) {
      errorMeta.stack = error.stack;
      errorMeta.name = error.name;
      errorMeta.message = error.message;
    } else if (typeof error === 'object') {
      Object.assign(errorMeta, error);
    }

    this.logger.error(message, errorMeta);
  }

  /**
   * Log flash loan specific events
   * @param {string} event - Event type
   * @param {object} data - Event data
   */
  flashLoan(event, data = {}) {
    this.logger.info(`Flash Loan: ${event}`, {
      ...data,
      timestamp: new Date().toISOString(),
      category: 'flash-loan',
      event
    });
  }

  /**
   * Log arbitrage specific events
   * @param {string} event - Event type
   * @param {object} data - Event data
   */
  arbitrage(event, data = {}) {
    this.logger.info(`Arbitrage: ${event}`, {
      ...data,
      timestamp: new Date().toISOString(),
      category: 'arbitrage',
      event
    });
  }

  /**
   * Log MCP server events
   * @param {string} server - MCP server name
   * @param {string} event - Event type
   * @param {object} data - Event data
   */
  mcp(server, event, data = {}) {
    this.logger.info(`MCP [${server}]: ${event}`, {
      ...data,
      timestamp: new Date().toISOString(),
      category: 'mcp',
      server,
      event
    });
  }

  /**
   * Log performance metrics
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   * @param {object} meta - Additional metadata
   */
  performance(operation, duration, meta = {}) {
    const key = operation;
    const metrics = this.performanceMetrics.get(key) || {
      count: 0,
      totalDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      avgDuration: 0
    };

    metrics.count++;
    metrics.totalDuration += duration;
    metrics.minDuration = Math.min(metrics.minDuration, duration);
    metrics.maxDuration = Math.max(metrics.maxDuration, duration);
    metrics.avgDuration = metrics.totalDuration / metrics.count;

    this.performanceMetrics.set(key, metrics);

    this.logger.info(`Performance: ${operation}`, {
      ...meta,
      timestamp: new Date().toISOString(),
      category: 'performance',
      operation,
      duration,
      metrics: {
        count: metrics.count,
        avgDuration: Math.round(metrics.avgDuration),
        minDuration: metrics.minDuration,
        maxDuration: metrics.maxDuration
      }
    });
  }

  /**
   * Log transaction events
   * @param {string} chain - Blockchain name
   * @param {string} txHash - Transaction hash
   * @param {string} status - Transaction status
   * @param {object} data - Transaction data
   */
  transaction(chain, txHash, status, data = {}) {
    this.logger.info(`Transaction [${chain}]: ${status}`, {
      ...data,
      timestamp: new Date().toISOString(),
      category: 'transaction',
      chain,
      txHash,
      status
    });
  }

  /**
   * Log profit/loss events
   * @param {string} type - P&L type (profit, loss, fee)
   * @param {number} amount - Amount
   * @param {string} token - Token symbol
   * @param {object} data - Additional data
   */
  pnl(type, amount, token, data = {}) {
    this.logger.info(`P&L: ${type}`, {
      ...data,
      timestamp: new Date().toISOString(),
      category: 'pnl',
      type,
      amount,
      token,
      amountFormatted: `${amount} ${token}`
    });
  }

  /**
   * Start performance timing
   * @param {string} operation - Operation name
   * @returns {function} Stop function
   */
  startTimer(operation) {
    const startTime = Date.now();
    return (meta = {}) => {
      const duration = Date.now() - startTime;
      this.performance(operation, duration, meta);
      return duration;
    };
  }

  /**
   * Get performance metrics
   * @returns {object} Performance metrics
   */
  getPerformanceMetrics() {
    const metrics = {};
    for (const [operation, data] of this.performanceMetrics) {
      metrics[operation] = { ...data };
    }
    return metrics;
  }

  /**
   * Get error counts
   * @returns {object} Error counts
   */
  getErrorCounts() {
    const errors = {};
    for (const [error, count] of this.errorCounts) {
      errors[error] = count;
    }
    return errors;
  }

  /**
   * Get system uptime
   * @returns {number} Uptime in milliseconds
   */
  getUptime() {
    return Date.now() - this.startTime;
  }

  /**
   * Get system health summary
   * @returns {object} Health summary
   */
  getHealthSummary() {
    const uptime = this.getUptime();
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    const performanceMetrics = this.getPerformanceMetrics();
    
    return {
      uptime: uptime,
      uptimeFormatted: this.formatDuration(uptime),
      totalErrors,
      errorRate: totalErrors / (uptime / 1000), // errors per second
      performanceMetrics,
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format duration for human readability
   * @param {number} duration - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(duration) {
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Clear performance metrics
   */
  clearMetrics() {
    this.performanceMetrics.clear();
    this.errorCounts.clear();
  }

  /**
   * Set log level
   * @param {string} level - Log level
   */
  setLogLevel(level) {
    this.logLevel = level;
    this.logger.level = level;
  }

  /**
   * Create child logger with context
   * @param {object} context - Context object
   * @returns {object} Child logger
   */
  child(context) {
    const childLogger = this.logger.child(context);
    return {
      info: (message, meta = {}) => childLogger.info(message, meta),
      debug: (message, meta = {}) => childLogger.debug(message, meta),
      warn: (message, meta = {}) => childLogger.warn(message, meta),
      error: (message, error = {}, meta = {}) => childLogger.error(message, { ...error, ...meta })
    };
  }
}

// Create logs directory if it doesn't exist
import { mkdirSync } from 'fs';
try {
  mkdirSync('logs', { recursive: true });
} catch (error) {
  // Directory already exists or cannot be created
}

// Export singleton instance
export const logger = new Logger();
export default logger;