import { config } from 'dotenv';
import { logger } from '../utils/logger.js';
import { mcpConfig } from '../config/mcp-servers.js';

// Load environment variables
config();

/**
 * Context7 MCP Client
 * Handles code quality assurance, best practices enforcement, and development optimization
 */
class Context7MCPClient {
  constructor() {
    this.serverName = 'context7';
    this.isConnected = false;
    this.qualityMetrics = new Map();
    this.codeReviews = new Map();
    this.bestPractices = new Map();
    this.performanceInsights = new Map();
    
    // Quality scoring weights
    this.qualityWeights = {
      security: 0.30,
      performance: 0.25,
      maintainability: 0.20,
      readability: 0.15,
      testability: 0.10
    };
    
    // Best practices checklist
    this.bestPracticesChecklist = {
      security: [
        'Private key handling',
        'Input validation',
        'Error handling',
        'Rate limiting',
        'Access control'
      ],
      performance: [
        'Memory management',
        'Async operations',
        'Caching strategies',
        'Database queries',
        'Resource cleanup'
      ],
      maintainability: [
        'Code modularity',
        'Documentation',
        'Naming conventions',
        'Function complexity',
        'Code reusability'
      ],
      testing: [
        'Unit test coverage',
        'Integration tests',
        'Error case testing',
        'Mock implementations',
        'Test data management'
      ]
    };
    
    this.initialize();
  }

  /**
   * Initialize Context7 MCP connection
   */
  async initialize() {
    try {
      if (!mcpConfig.isServerAvailable(this.serverName)) {
        throw new Error('Context7 MCP server is not available');
      }
      
      this.isConnected = true;
      logger.mcp(this.serverName, 'connected', { 
        capabilities: mcpConfig.getServerCapabilities(this.serverName),
        qualityFramework: 'enabled'
      });
      
      // Initialize quality monitoring
      this.startQualityMonitoring();
      
      mcpConfig.updateHealthStatus(this.serverName, true, 0);
      
    } catch (error) {
      logger.error('Failed to initialize Context7 MCP client', error);
      mcpConfig.updateHealthStatus(this.serverName, false, 0);
      throw error;
    }
  }

  /**
   * Perform comprehensive code review
   * @param {string} filePath - Path to the file being reviewed
   * @param {string} codeContent - Content of the code to review
   * @param {string} fileType - Type of file (js, ts, json, etc.)
   * @returns {Promise<object>} Code review results
   */
  async performCodeReview(filePath, codeContent, fileType = 'js') {
    const timer = logger.startTimer('context7-code-review');
    
    try {
      const reviewId = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Analyze code structure and quality
      const analysis = await this.analyzeCodeStructure(codeContent, fileType);
      
      // Check best practices
      const bestPracticesCheck = await this.checkBestPractices(codeContent, fileType);
      
      // Security analysis
      const securityAnalysis = await this.performSecurityAnalysis(codeContent, fileType);
      
      // Performance analysis
      const performanceAnalysis = await this.analyzePerformance(codeContent, fileType);
      
      // Calculate overall quality score
      const qualityScore = this.calculateQualityScore({
        structure: analysis,
        bestPractices: bestPracticesCheck,
        security: securityAnalysis,
        performance: performanceAnalysis
      });
      
      const reviewResult = {
        reviewId,
        filePath,
        fileType,
        timestamp: new Date().toISOString(),
        qualityScore,
        analysis,
        bestPracticesCheck,
        securityAnalysis,
        performanceAnalysis,
        recommendations: this.generateRecommendations(qualityScore, analysis, bestPracticesCheck),
        priority: this.determinePriority(qualityScore),
        estimatedFixTime: this.estimateFixTime(bestPracticesCheck, securityAnalysis)
      };
      
      // Store review result
      this.codeReviews.set(reviewId, reviewResult);
      
      logger.mcp(this.serverName, 'code-review-completed', {
        filePath,
        reviewId,
        qualityScore: qualityScore.overall,
        issuesFound: bestPracticesCheck.violations.length + securityAnalysis.vulnerabilities.length,
        priority: reviewResult.priority
      });
      
      timer({ success: true, filePath, qualityScore: qualityScore.overall });
      return reviewResult;
      
    } catch (error) {
      logger.error('Failed to perform code review', error, { filePath });
      timer({ error: true, filePath });
      throw error;
    }
  }

  /**
   * Analyze code structure and patterns
   * @param {string} codeContent - Code content to analyze
   * @param {string} fileType - File type
   * @returns {Promise<object>} Structure analysis results
   */
  async analyzeCodeStructure(codeContent, fileType) {
    const analysis = {
      lineCount: codeContent.split('\n').length,
      complexity: this.calculateComplexity(codeContent),
      dependencies: this.extractDependencies(codeContent),
      functions: this.analyzeFunctions(codeContent),
      classes: this.analyzeClasses(codeContent),
      modules: this.analyzeModules(codeContent),
      documentation: this.analyzeDocumentation(codeContent)
    };
    
    return analysis;
  }

  /**
   * Check code against best practices
   * @param {string} codeContent - Code content to check
   * @param {string} fileType - File type
   * @returns {Promise<object>} Best practices check results
   */
  async checkBestPractices(codeContent, fileType) {
    const violations = [];
    const suggestions = [];
    const score = { security: 100, performance: 100, maintainability: 100, readability: 100 };
    
    // Check security best practices
    if (codeContent.includes('eval(')) {
      violations.push({
        type: 'security',
        severity: 'high',
        message: 'Use of eval() function detected - potential security risk',
        line: this.findLineNumber(codeContent, 'eval('),
        suggestion: 'Use safer alternatives like JSON.parse() or proper parsing functions'
      });
      score.security -= 20;
    }
    
    if (codeContent.includes('process.env') && !codeContent.includes('dotenv')) {
      suggestions.push({
        type: 'security',
        severity: 'medium',
        message: 'Direct environment variable access without dotenv',
        suggestion: 'Consider using dotenv for environment variable management'
      });
      score.security -= 5;
    }
    
    // Check performance best practices
    if (codeContent.includes('setTimeout') || codeContent.includes('setInterval')) {
      const hasCleanup = codeContent.includes('clearTimeout') || codeContent.includes('clearInterval');
      if (!hasCleanup) {
        violations.push({
          type: 'performance',
          severity: 'medium',
          message: 'Timer without cleanup detected',
          suggestion: 'Always clear timers to prevent memory leaks'
        });
        score.performance -= 10;
      }
    }
    
    // Check maintainability
    const functionCount = (codeContent.match(/function\s+\w+|=>\s*{|async\s+function/g) || []).length;
    if (functionCount > 20) {
      suggestions.push({
        type: 'maintainability',
        severity: 'low',
        message: 'High function count detected',
        suggestion: 'Consider breaking this file into smaller modules'
      });
      score.maintainability -= 5;
    }
    
    // Check readability
    const avgLineLength = codeContent.split('\n').reduce((sum, line) => sum + line.length, 0) / codeContent.split('\n').length;
    if (avgLineLength > 100) {
      suggestions.push({
        type: 'readability',
        severity: 'low',
        message: 'Long lines detected',
        suggestion: 'Consider breaking long lines for better readability'
      });
      score.readability -= 5;
    }
    
    // Check for proper error handling
    const hasErrorHandling = codeContent.includes('try') && codeContent.includes('catch');
    const hasFunctionCalls = codeContent.includes('await') || codeContent.includes('.then(');
    
    if (hasFunctionCalls && !hasErrorHandling) {
      violations.push({
        type: 'security',
        severity: 'medium',
        message: 'Async operations without proper error handling',
        suggestion: 'Wrap async operations in try-catch blocks'
      });
      score.security -= 10;
    }
    
    return {
      violations,
      suggestions,
      score,
      passedChecks: this.bestPracticesChecklist.security.length - violations.filter(v => v.type === 'security').length,
      totalChecks: this.bestPracticesChecklist.security.length
    };
  }

  /**
   * Perform security analysis
   * @param {string} codeContent - Code content to analyze
   * @param {string} fileType - File type
   * @returns {Promise<object>} Security analysis results
   */
  async performSecurityAnalysis(codeContent, fileType) {
    const vulnerabilities = [];
    const warnings = [];
    let securityScore = 100;
    
    // Check for hardcoded secrets
    const secretPatterns = [
      /sk_live_[a-zA-Z0-9]+/g, // Stripe keys
      /pk_live_[a-zA-Z0-9]+/g,
      /AIza[0-9A-Za-z\\-_]{35}/g, // Google API keys
      /[0-9a-f]{32}/g, // Generic 32-char hex (potential API keys)
      /"password"\s*:\s*"[^"]+"/g, // Hardcoded passwords
      /"secret"\s*:\s*"[^"]+"/g // Hardcoded secrets
    ];
    
    secretPatterns.forEach(pattern => {
      const matches = codeContent.match(pattern);
      if (matches) {
        vulnerabilities.push({
          type: 'secrets',
          severity: 'critical',
          message: 'Potential hardcoded secret detected',
          matches: matches.length,
          pattern: pattern.toString(),
          recommendation: 'Move secrets to environment variables'
        });
        securityScore -= 30;
      }
    });
    
    // Check for SQL injection vulnerabilities
    if (codeContent.includes('SELECT') && codeContent.includes('${')) {
      vulnerabilities.push({
        type: 'sql-injection',
        severity: 'high',
        message: 'Potential SQL injection vulnerability',
        recommendation: 'Use parameterized queries or ORM methods'
      });
      securityScore -= 25;
    }
    
    // Check for XSS vulnerabilities
    if (codeContent.includes('innerHTML') || codeContent.includes('dangerouslySetInnerHTML')) {
      warnings.push({
        type: 'xss',
        severity: 'medium',
        message: 'Potential XSS vulnerability with innerHTML usage',
        recommendation: 'Sanitize user input or use safer DOM manipulation methods'
      });
      securityScore -= 10;
    }
    
    // Check for insecure HTTP usage
    if (codeContent.includes('http://') && !codeContent.includes('localhost')) {
      warnings.push({
        type: 'insecure-http',
        severity: 'medium',
        message: 'Insecure HTTP protocol detected',
        recommendation: 'Use HTTPS for all external communications'
      });
      securityScore -= 10;
    }
    
    return {
      vulnerabilities,
      warnings,
      securityScore,
      riskLevel: this.calculateRiskLevel(vulnerabilities),
      recommendations: this.generateSecurityRecommendations(vulnerabilities, warnings)
    };
  }

  /**
   * Analyze performance characteristics
   * @param {string} codeContent - Code content to analyze
   * @param {string} fileType - File type
   * @returns {Promise<object>} Performance analysis results
   */
  async analyzePerformance(codeContent, fileType) {
    const issues = [];
    const optimizations = [];
    let performanceScore = 100;
    
    // Check for memory leaks
    const hasEventListeners = codeContent.includes('addEventListener');
    const hasRemoveListeners = codeContent.includes('removeEventListener');
    
    if (hasEventListeners && !hasRemoveListeners) {
      issues.push({
        type: 'memory-leak',
        severity: 'medium',
        message: 'Event listeners without cleanup detected',
        recommendation: 'Remove event listeners in cleanup functions'
      });
      performanceScore -= 15;
    }
    
    // Check for inefficient loops
    const nestedLoops = codeContent.match(/for\s*\([^)]*\)\s*{[^}]*for\s*\([^)]*\)/g);
    if (nestedLoops && nestedLoops.length > 0) {
      issues.push({
        type: 'inefficient-loops',
        severity: 'medium',
        message: 'Nested loops detected - potential O(n²) complexity',
        count: nestedLoops.length,
        recommendation: 'Consider using more efficient algorithms or data structures'
      });
      performanceScore -= 10;
    }
    
    // Check for unnecessary async/await
    const unnecessaryAsync = codeContent.match(/async\s+function[^}]*{[^}]*(?!await)[^}]*}/g);
    if (unnecessaryAsync && unnecessaryAsync.length > 0) {
      optimizations.push({
        type: 'unnecessary-async',
        severity: 'low',
        message: 'Async functions without await usage',
        recommendation: 'Remove async keyword if no await is used'
      });
      performanceScore -= 5;
    }
    
    // Check for console.log in production code
    const consoleLogs = (codeContent.match(/console\.log/g) || []).length;
    if (consoleLogs > 0) {
      optimizations.push({
        type: 'console-logs',
        severity: 'low',
        message: `${consoleLogs} console.log statements found`,
        recommendation: 'Remove or replace with proper logging in production'
      });
      performanceScore -= consoleLogs * 2;
    }
    
    return {
      issues,
      optimizations,
      performanceScore,
      complexity: this.calculateComplexity(codeContent),
      recommendations: this.generatePerformanceRecommendations(issues, optimizations)
    };
  }

  /**
   * Calculate overall quality score
   * @param {object} analyses - All analysis results
   * @returns {object} Quality score breakdown
   */
  calculateQualityScore(analyses) {
    const scores = {
      security: analyses.security.securityScore,
      performance: analyses.performance.performanceScore,
      maintainability: analyses.bestPractices.score.maintainability,
      readability: analyses.bestPractices.score.readability,
      testability: 85 // Default score - would be calculated from test coverage
    };
    
    const overall = Object.entries(scores).reduce((total, [category, score]) => {
      return total + (score * this.qualityWeights[category]);
    }, 0);
    
    return {
      overall: Math.round(overall),
      breakdown: scores,
      grade: this.getQualityGrade(overall)
    };
  }

  /**
   * Generate recommendations based on analysis
   * @param {object} qualityScore - Quality score results
   * @param {object} analysis - Structure analysis
   * @param {object} bestPractices - Best practices check
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(qualityScore, analysis, bestPractices) {
    const recommendations = [];
    
    if (qualityScore.overall < 80) {
      recommendations.push({
        priority: 'high',
        category: 'quality',
        message: 'Overall code quality needs improvement',
        actions: [
          'Address security vulnerabilities',
          'Improve error handling',
          'Optimize performance bottlenecks',
          'Add comprehensive documentation'
        ]
      });
    }
    
    if (analysis.complexity > 10) {
      recommendations.push({
        priority: 'medium',
        category: 'maintainability',
        message: 'High code complexity detected',
        actions: [
          'Break down complex functions',
          'Extract reusable utilities',
          'Improve code organization'
        ]
      });
    }
    
    if (bestPractices.violations.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'best-practices',
        message: 'Best practice violations found',
        actions: bestPractices.violations.map(v => v.suggestion)
      });
    }
    
    return recommendations;
  }

  /**
   * Start quality monitoring
   */
  startQualityMonitoring() {
    setInterval(() => {
      this.updateQualityMetrics();
    }, 300000); // Update every 5 minutes
  }

  /**
   * Update quality metrics
   */
  updateQualityMetrics() {
    const metrics = {
      totalReviews: this.codeReviews.size,
      averageQuality: this.calculateAverageQuality(),
      criticalIssues: this.countCriticalIssues(),
      lastUpdate: new Date().toISOString()
    };
    
    this.qualityMetrics.set('current', metrics);
    
    logger.mcp(this.serverName, 'quality-metrics-updated', metrics);
  }

  /**
   * Calculate average quality across all reviews
   * @returns {number} Average quality score
   */
  calculateAverageQuality() {
    if (this.codeReviews.size === 0) return 100;
    
    const totalScore = Array.from(this.codeReviews.values())
      .reduce((sum, review) => sum + review.qualityScore.overall, 0);
    
    return Math.round(totalScore / this.codeReviews.size);
  }

  /**
   * Count critical issues across all reviews
   * @returns {number} Number of critical issues
   */
  countCriticalIssues() {
    return Array.from(this.codeReviews.values())
      .reduce((count, review) => {
        const critical = review.securityAnalysis.vulnerabilities
          .filter(v => v.severity === 'critical').length;
        return count + critical;
      }, 0);
  }

  // Utility methods
  calculateComplexity(code) {
    const complexityIndicators = [
      /if\s*\(/g,
      /else\s*{/g,
      /for\s*\(/g,
      /while\s*\(/g,
      /switch\s*\(/g,
      /catch\s*\(/g,
      /&&|\|\|/g
    ];
    
    return complexityIndicators.reduce((complexity, pattern) => {
      const matches = code.match(pattern);
      return complexity + (matches ? matches.length : 0);
    }, 1);
  }

  extractDependencies(code) {
    const imports = code.match(/import\s+.*\s+from\s+['"][^'"]+['"]/g) || [];
    const requires = code.match(/require\s*\(\s*['"][^'"]+['"]\s*\)/g) || [];
    
    return {
      imports: imports.length,
      requires: requires.length,
      total: imports.length + requires.length
    };
  }

  analyzeFunctions(code) {
    const functions = code.match(/function\s+\w+|=>\s*{|async\s+function/g) || [];
    const avgLength = this.calculateAverageFunctionLength(code);
    
    return {
      count: functions.length,
      averageLength: avgLength,
      complexity: this.calculateComplexity(code) / (functions.length || 1)
    };
  }

  analyzeClasses(code) {
    const classes = code.match(/class\s+\w+/g) || [];
    return {
      count: classes.length,
      hasConstructor: code.includes('constructor('),
      hasInheritance: code.includes('extends')
    };
  }

  analyzeModules(code) {
    return {
      hasExports: code.includes('export'),
      hasDefaultExport: code.includes('export default'),
      isModule: code.includes('import') || code.includes('export')
    };
  }

  analyzeDocumentation(code) {
    const comments = code.match(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm) || [];
    const docBlocks = code.match(/\/\*\*[\s\S]*?\*\//g) || [];
    
    return {
      commentLines: comments.length,
      docBlocks: docBlocks.length,
      commentRatio: comments.length / code.split('\n').length
    };
  }

  calculateAverageFunctionLength(code) {
    const functions = code.split(/function\s+\w+|=>\s*{|async\s+function/);
    if (functions.length <= 1) return 0;
    
    const totalLines = functions.slice(1).reduce((sum, func) => {
      return sum + func.split('\n').length;
    }, 0);
    
    return Math.round(totalLines / (functions.length - 1));
  }

  findLineNumber(code, searchString) {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(searchString)) {
        return i + 1;
      }
    }
    return -1;
  }

  calculateRiskLevel(vulnerabilities) {
    const critical = vulnerabilities.filter(v => v.severity === 'critical').length;
    const high = vulnerabilities.filter(v => v.severity === 'high').length;
    
    if (critical > 0) return 'critical';
    if (high > 0) return 'high';
    if (vulnerabilities.length > 0) return 'medium';
    return 'low';
  }

  generateSecurityRecommendations(vulnerabilities, warnings) {
    const recommendations = [];
    
    if (vulnerabilities.length > 0) {
      recommendations.push('Immediately address critical security vulnerabilities');
      recommendations.push('Implement input validation and sanitization');
      recommendations.push('Use environment variables for sensitive data');
    }
    
    if (warnings.length > 0) {
      recommendations.push('Review and address security warnings');
      recommendations.push('Implement proper authentication and authorization');
    }
    
    return recommendations;
  }

  generatePerformanceRecommendations(issues, optimizations) {
    const recommendations = [];
    
    if (issues.length > 0) {
      recommendations.push('Address performance bottlenecks');
      recommendations.push('Implement proper memory management');
      recommendations.push('Optimize algorithms and data structures');
    }
    
    if (optimizations.length > 0) {
      recommendations.push('Remove unnecessary code and imports');
      recommendations.push('Implement caching strategies');
      recommendations.push('Use production builds for deployment');
    }
    
    return recommendations;
  }

  getQualityGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  determinePriority(qualityScore) {
    if (qualityScore.overall < 60) return 'critical';
    if (qualityScore.overall < 75) return 'high';
    if (qualityScore.overall < 85) return 'medium';
    return 'low';
  }

  estimateFixTime(bestPractices, security) {
    const violations = bestPractices.violations.length + security.vulnerabilities.length;
    
    if (violations > 10) return '4-6 hours';
    if (violations > 5) return '2-4 hours';
    if (violations > 0) return '1-2 hours';
    return '< 1 hour';
  }

  /**
   * Get quality metrics
   * @returns {object} Current quality metrics
   */
  getQualityMetrics() {
    return this.qualityMetrics.get('current') || {};
  }

  /**
   * Get all code reviews
   * @returns {object} All code review results
   */
  getAllReviews() {
    return Object.fromEntries(this.codeReviews);
  }

  /**
   * Get connection status
   * @returns {boolean} Connection status
   */
  isConnected() {
    return this.isConnected;
  }

  /**
   * Disconnect from Context7 MCP
   */
  disconnect() {
    this.isConnected = false;
    this.qualityMetrics.clear();
    this.codeReviews.clear();
    this.bestPractices.clear();
    this.performanceInsights.clear();
    
    logger.mcp(this.serverName, 'disconnected');
  }
}

// Export singleton instance
export const context7Client = new Context7MCPClient();
export default context7Client;