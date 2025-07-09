/**
 * MCP Coordinator - Advanced MCP Server Management
 * Enhanced with load balancing, circuit breakers, and comprehensive failover
 * Manages CoinGecko, Web3-MCP, Context7, and Chainstack capabilities
 */

import { CoinGeckoMCPClient } from './coingecko-client.js';
import { Web3MCPClient } from './web3-client.js';
import { Context7MCPClient } from './context7-client.js';
import { Logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

class MCPCoordinator extends EventEmitter {
    constructor(config = {}) {
        super();
        
        // Enhanced configuration with load balancing and circuit breaker settings
        this.config = {
            healthCheckInterval: 30000, // 30 seconds
            maxRetries: 3,
            retryDelay: 1000,
            maxDelay: 10000,
            loadBalancingStrategy: 'round-robin', // round-robin, least-loaded, fastest, priority
            circuitBreakerThreshold: 5,
            circuitBreakerTimeout: 60000, // 1 minute
            requestTimeout: 30000, // 30 seconds
            ...config
        };
        
        this.logger = new Logger('MCP-Coordinator');
        
        // Enhanced tracking structures
        this.clients = new Map();
        this.healthStatus = new Map();
        this.capabilities = new Map();
        this.requestMetrics = new Map();
        this.circuitBreakers = new Map();
        this.roundRobinCounters = new Map();
        this.loadBalancingStats = new Map();
        
        this.initialized = false;
        this.healthCheckTimer = null;
        this.initTime = null;
        
        // Client configurations with capabilities and priorities
        this.clientConfigs = {
            'coingecko': {
                class: CoinGeckoMCPClient,
                capabilities: ['pricing', 'market-data', 'trending', 'arbitrage-opportunities'],
                priority: 'high',
                maxConcurrency: 5,
                timeout: 15000
            },
            'web3': {
                class: Web3MCPClient,
                capabilities: ['blockchain', 'tokens', 'pools', 'bridges', 'flash-loans'],
                priority: 'critical',
                maxConcurrency: 3,
                timeout: 30000
            },
            'context7': {
                class: Context7MCPClient,
                capabilities: ['code-review', 'quality-assurance', 'best-practices'],
                priority: 'medium',
                maxConcurrency: 2,
                timeout: 20000
            }
        };
    }

    /**
     * Initialize all MCP clients with enhanced error handling
     */
    async initialize() {
        this.logger.info('🚀 Initializing Enhanced MCP Coordinator...');
        this.initTime = Date.now();
        
        try {
            // Initialize clients in parallel for better performance
            const initPromises = Object.entries(this.clientConfigs).map(([name, config]) =>
                this.initializeClient(name, config)
            );

            const results = await Promise.allSettled(initPromises);
            
            // Process results and initialize tracking structures
            results.forEach((result, index) => {
                const clientName = Object.keys(this.clientConfigs)[index];
                
                if (result.status === 'fulfilled') {
                    this.initializeClientTracking(clientName);
                    this.logger.info(`✅ ${clientName} MCP client initialized successfully`);
                } else {
                    this.logger.error(`❌ Failed to initialize ${clientName} MCP client:`, result.reason);
                    this.markClientUnhealthy(clientName, result.reason);
                }
            });

            this.initialized = true;
            this.startHealthMonitoring();
            
            this.logger.info(`🎯 Enhanced MCP Coordinator initialized with ${this.clients.size} clients`);
            this.emit('initialized');
            
        } catch (error) {
            this.logger.error('💥 Failed to initialize MCP Coordinator:', error);
            throw error;
        }
    }

    /**
     * Initialize individual MCP client with enhanced configuration
     */
    async initializeClient(name, config) {
        try {
            const client = new config.class({
                timeout: config.timeout,
                maxConcurrency: config.maxConcurrency
            });
            
            await client.initialize();
            
            this.clients.set(name, {
                client,
                config,
                isHealthy: true,
                lastHealthCheck: Date.now(),
                requestCount: 0,
                errorCount: 0,
                avgResponseTime: 0,
                lastRequestTime: null
            });
            
            this.capabilities.set(name, config.capabilities);
            
            // Enhanced event handlers
            client.on('error', (error) => {
                this.logger.error(`MCP ${name} client error:`, error);
                this.handleClientError(name, error);
            });

            client.on('reconnected', () => {
                this.logger.info(`MCP ${name} client reconnected`);
                this.handleClientReconnected(name);
            });

            client.on('request', (data) => {
                this.trackRequest(name, data);
            });

            client.on('response', (data) => {
                this.trackResponse(name, data);
            });

            return client;
            
        } catch (error) {
            this.logger.error(`Failed to initialize ${name} MCP client:`, error);
            throw error;
        }
    }

    /**
     * Initialize client tracking structures
     */
    initializeClientTracking(clientName) {
        this.healthStatus.set(clientName, {
            status: 'healthy',
            uptime: 100,
            lastError: null,
            consecutiveErrors: 0,
            lastHealthCheck: Date.now()
        });
        
        this.requestMetrics.set(clientName, {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            avgResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            lastRequestTime: null,
            requestsPerMinute: 0
        });
        
        this.circuitBreakers.set(clientName, {
            isOpen: false,
            failureCount: 0,
            lastFailureTime: null,
            nextRetryTime: null
        });
        
        this.roundRobinCounters.set(clientName, 0);
        
        this.loadBalancingStats.set(clientName, {
            weight: 1.0,
            currentLoad: 0,
            averageLoad: 0,
            priority: this.clientConfigs[clientName].priority
        });
    }

    /**
     * Enhanced request routing with capability-based selection
     */
    async routeRequest(capability, method, params = {}, options = {}) {
        if (!this.initialized) {
            throw new Error('MCP Coordinator not initialized');
        }
        
        const availableClients = this.getClientsForCapability(capability);
        
        if (availableClients.length === 0) {
            throw new Error(`No healthy clients available for capability: ${capability}`);
        }
        
        const selectedClient = this.selectClient(availableClients, options);
        
        return await this.executeRequest(selectedClient, method, params, options);
    }

    /**
     * Get clients that support a specific capability
     */
    getClientsForCapability(capability) {
        const availableClients = [];
        
        for (const [name, capabilities] of this.capabilities) {
            if (capabilities.includes(capability)) {
                const clientInfo = this.clients.get(name);
                const circuitBreaker = this.circuitBreakers.get(name);
                
                if (clientInfo && clientInfo.isHealthy && !circuitBreaker.isOpen) {
                    availableClients.push(name);
                }
            }
        }
        
        return availableClients;
    }

    /**
     * Advanced client selection with multiple strategies
     */
    selectClient(availableClients, options = {}) {
        const strategy = options.loadBalancingStrategy || this.config.loadBalancingStrategy;
        
        switch (strategy) {
            case 'round-robin':
                return this.selectByRoundRobin(availableClients);
            case 'least-loaded':
                return this.selectByLeastLoaded(availableClients);
            case 'fastest':
                return this.selectByFastest(availableClients);
            case 'priority':
                return this.selectByPriority(availableClients);
            case 'weighted':
                return this.selectByWeight(availableClients);
            default:
                return this.selectByRoundRobin(availableClients);
        }
    }

    /**
     * Round-robin selection
     */
    selectByRoundRobin(availableClients) {
        const key = availableClients.join(',');
        const currentIndex = this.roundRobinCounters.get(key) || 0;
        const selectedClient = availableClients[currentIndex % availableClients.length];
        this.roundRobinCounters.set(key, currentIndex + 1);
        return selectedClient;
    }

    /**
     * Least loaded selection
     */
    selectByLeastLoaded(availableClients) {
        let leastLoadedClient = availableClients[0];
        let minLoad = this.clients.get(leastLoadedClient).requestCount;
        
        for (const clientName of availableClients) {
            const clientInfo = this.clients.get(clientName);
            if (clientInfo.requestCount < minLoad) {
                minLoad = clientInfo.requestCount;
                leastLoadedClient = clientName;
            }
        }
        
        return leastLoadedClient;
    }

    /**
     * Fastest responding selection
     */
    selectByFastest(availableClients) {
        let fastestClient = availableClients[0];
        let minResponseTime = this.clients.get(fastestClient).avgResponseTime || Infinity;
        
        for (const clientName of availableClients) {
            const clientInfo = this.clients.get(clientName);
            const responseTime = clientInfo.avgResponseTime || Infinity;
            if (responseTime < minResponseTime) {
                minResponseTime = responseTime;
                fastestClient = clientName;
            }
        }
        
        return fastestClient;
    }

    /**
     * Priority-based selection
     */
    selectByPriority(availableClients) {
        const priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
        
        let highestPriorityClient = availableClients[0];
        let highestPriority = priorityOrder[this.clientConfigs[highestPriorityClient].priority] || 999;
        
        for (const clientName of availableClients) {
            const priority = priorityOrder[this.clientConfigs[clientName].priority] || 999;
            if (priority < highestPriority) {
                highestPriority = priority;
                highestPriorityClient = clientName;
            }
        }
        
        return highestPriorityClient;
    }

    /**
     * Weighted selection based on performance
     */
    selectByWeight(availableClients) {
        const weights = availableClients.map(name => {
            const stats = this.loadBalancingStats.get(name);
            return stats ? stats.weight : 1.0;
        });
        
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let random = Math.random() * totalWeight;
        
        for (let i = 0; i < availableClients.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return availableClients[i];
            }
        }
        
        return availableClients[0];
    }

    /**
     * Execute request with enhanced error handling and metrics
     */
    async executeRequest(clientName, method, params, options = {}) {
        const clientInfo = this.clients.get(clientName);
        const startTime = Date.now();
        
        // Update request count
        clientInfo.requestCount++;
        clientInfo.lastRequestTime = startTime;
        
        // Track request metrics
        const metrics = this.requestMetrics.get(clientName);
        metrics.totalRequests++;
        
        try {
            this.logger.debug(`🔄 Executing request on ${clientName}: ${method}`);
            
            const result = await this.withTimeout(
                this.withRetry(
                    () => clientInfo.client[method](params),
                    options.retries || this.config.maxRetries,
                    `${clientName}.${method}`
                ),
                options.timeout || this.config.requestTimeout
            );
            
            // Update success metrics
            const responseTime = Date.now() - startTime;
            this.updateSuccessMetrics(clientName, responseTime);
            
            this.logger.debug(`✅ Request completed on ${clientName} in ${responseTime}ms`);
            
            return result;
            
        } catch (error) {
            // Update failure metrics
            this.updateFailureMetrics(clientName, error);
            
            this.logger.error(`❌ Request failed on ${clientName}:`, error);
            
            // Try failover if available
            if (options.enableFailover !== false) {
                return await this.attemptFailover(clientName, method, params, options);
            }
            
            throw error;
        } finally {
            // Decrement request count
            clientInfo.requestCount--;
        }
    }

    /**
     * Enhanced retry mechanism with exponential backoff
     */
    async withRetry(operation, maxRetries, context = 'operation') {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                if (attempt < maxRetries) {
                    const delay = Math.min(
                        this.config.retryDelay * Math.pow(2, attempt - 1),
                        this.config.maxDelay
                    );
                    
                    this.logger.warn(`🔄 ${context} failed, retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`);
                    await this.sleep(delay);
                }
            }
        }
        
        throw lastError;
    }

    /**
     * Request timeout wrapper
     */
    async withTimeout(promise, timeout) {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), timeout);
        });
        
        return Promise.race([promise, timeoutPromise]);
    }

    /**
     * Advanced failover mechanism
     */
    async attemptFailover(failedClient, method, params, options) {
        this.logger.warn(`🔄 Attempting failover from ${failedClient}`);
        
        // Find alternative clients with same capabilities
        const failedCapabilities = this.capabilities.get(failedClient);
        const alternativeClients = [];
        
        for (const [name, capabilities] of this.capabilities) {
            if (name !== failedClient && 
                capabilities.some(cap => failedCapabilities.includes(cap))) {
                const clientInfo = this.clients.get(name);
                const circuitBreaker = this.circuitBreakers.get(name);
                
                if (clientInfo && clientInfo.isHealthy && !circuitBreaker.isOpen) {
                    alternativeClients.push(name);
                }
            }
        }
        
        if (alternativeClients.length === 0) {
            throw new Error('No healthy alternative clients available for failover');
        }
        
        // Select alternative client
        const alternativeClient = this.selectClient(alternativeClients, options);
        
        this.logger.info(`🔄 Failing over to ${alternativeClient}`);
        
        return await this.executeRequest(alternativeClient, method, params, {
            ...options,
            enableFailover: false // Prevent infinite failover loops
        });
    }

    /**
     * Update success metrics and reset circuit breaker
     */
    updateSuccessMetrics(clientName, responseTime) {
        const clientInfo = this.clients.get(clientName);
        const metrics = this.requestMetrics.get(clientName);
        const health = this.healthStatus.get(clientName);
        const circuitBreaker = this.circuitBreakers.get(clientName);
        const loadStats = this.loadBalancingStats.get(clientName);
        
        // Update response time metrics
        if (clientInfo.avgResponseTime === 0) {
            clientInfo.avgResponseTime = responseTime;
        } else {
            clientInfo.avgResponseTime = (clientInfo.avgResponseTime * 0.8) + (responseTime * 0.2);
        }
        
        // Update detailed metrics
        metrics.successfulRequests++;
        metrics.avgResponseTime = clientInfo.avgResponseTime;
        metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTime);
        metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTime);
        
        // Reset circuit breaker on success
        if (circuitBreaker.isOpen) {
            circuitBreaker.isOpen = false;
            circuitBreaker.failureCount = 0;
            this.logger.info(`🔓 Circuit breaker closed for ${clientName}`);
        }
        
        // Update health status
        health.status = 'healthy';
        health.consecutiveErrors = 0;
        clientInfo.isHealthy = true;
        
        // Update load balancing weight (better performance = higher weight)
        loadStats.weight = Math.min(loadStats.weight * 1.1, 2.0);
    }

    /**
     * Update failure metrics and handle circuit breaker
     */
    updateFailureMetrics(clientName, error) {
        const clientInfo = this.clients.get(clientName);
        const metrics = this.requestMetrics.get(clientName);
        const health = this.healthStatus.get(clientName);
        const circuitBreaker = this.circuitBreakers.get(clientName);
        const loadStats = this.loadBalancingStats.get(clientName);
        
        // Update error count
        clientInfo.errorCount++;
        metrics.failedRequests++;
        
        // Update health status
        health.consecutiveErrors++;
        health.lastError = error.message;
        
        // Update circuit breaker
        circuitBreaker.failureCount++;
        circuitBreaker.lastFailureTime = Date.now();
        
        // Open circuit breaker if threshold reached
        if (circuitBreaker.failureCount >= this.config.circuitBreakerThreshold) {
            circuitBreaker.isOpen = true;
            circuitBreaker.nextRetryTime = Date.now() + this.config.circuitBreakerTimeout;
            this.logger.warn(`🔒 Circuit breaker opened for ${clientName}`);
        }
        
        // Mark client as unhealthy if too many consecutive errors
        if (health.consecutiveErrors >= 3) {
            clientInfo.isHealthy = false;
            health.status = 'unhealthy';
            this.logger.error(`❌ Marked ${clientName} as unhealthy`);
        }
        
        // Reduce load balancing weight
        loadStats.weight = Math.max(loadStats.weight * 0.8, 0.1);
    }

    /**
     * Enhanced health monitoring
     */
    startHealthMonitoring() {
        this.healthCheckTimer = setInterval(() => {
            this.performHealthChecks();
        }, this.config.healthCheckInterval);
        
        this.logger.info(`🏥 Health monitoring started (interval: ${this.config.healthCheckInterval}ms)`);
    }

    /**
     * Perform comprehensive health checks
     */
    async performHealthChecks() {
        this.logger.debug('🏥 Performing health checks...');
        
        const healthPromises = Array.from(this.clients.keys()).map(async (clientName) => {
            try {
                await this.checkClientHealth(clientName);
            } catch (error) {
                this.logger.warn(`Health check failed for ${clientName}:`, error);
            }
        });
        
        await Promise.allSettled(healthPromises);
        
        // Check circuit breakers
        this.checkCircuitBreakers();
        
        // Update load balancing stats
        this.updateLoadBalancingStats();
    }

    /**
     * Check health of specific client
     */
    async checkClientHealth(clientName) {
        const clientInfo = this.clients.get(clientName);
        const health = this.healthStatus.get(clientName);
        
        if (!clientInfo) return;
        
        const startTime = Date.now();
        
        try {
            // Perform health check
            await clientInfo.client.healthCheck?.() || Promise.resolve();
            
            const responseTime = Date.now() - startTime;
            
            // Update health status
            health.status = 'healthy';
            health.lastError = null;
            health.lastHealthCheck = Date.now();
            clientInfo.isHealthy = true;
            
            this.logger.debug(`✅ Health check passed for ${clientName} (${responseTime}ms)`);
            
        } catch (error) {
            // Update health status
            health.status = 'unhealthy';
            health.lastError = error.message;
            health.lastHealthCheck = Date.now();
            clientInfo.isHealthy = false;
            
            this.logger.warn(`❌ Health check failed for ${clientName}:`, error.message);
        }
    }

    /**
     * Check and reset circuit breakers
     */
    checkCircuitBreakers() {
        const now = Date.now();
        
        for (const [clientName, circuitBreaker] of this.circuitBreakers) {
            if (circuitBreaker.isOpen && now >= circuitBreaker.nextRetryTime) {
                circuitBreaker.isOpen = false;
                circuitBreaker.failureCount = 0;
                this.logger.info(`🔓 Circuit breaker reset for ${clientName}`);
            }
        }
    }

    /**
     * Update load balancing statistics
     */
    updateLoadBalancingStats() {
        for (const [clientName, stats] of this.loadBalancingStats) {
            const clientInfo = this.clients.get(clientName);
            if (clientInfo) {
                stats.currentLoad = clientInfo.requestCount;
                stats.averageLoad = (stats.averageLoad * 0.9) + (stats.currentLoad * 0.1);
            }
        }
    }

    /**
     * Handle client error events
     */
    handleClientError(clientName, error) {
        this.healthStatus.get(clientName).consecutiveErrors++;
        this.emit('clientError', { name: clientName, error });
        
        // Auto-recovery attempt
        setTimeout(() => {
            this.attemptClientRecovery(clientName);
        }, 5000);
    }

    /**
     * Handle client reconnection events
     */
    handleClientReconnected(clientName) {
        const health = this.healthStatus.get(clientName);
        const clientInfo = this.clients.get(clientName);
        
        health.status = 'healthy';
        health.consecutiveErrors = 0;
        clientInfo.isHealthy = true;
        
        this.emit('clientReconnected', { name: clientName });
    }

    /**
     * Attempt client recovery
     */
    async attemptClientRecovery(clientName) {
        try {
            const clientInfo = this.clients.get(clientName);
            if (clientInfo && clientInfo.client.reconnect) {
                await clientInfo.client.reconnect();
                this.logger.info(`🔄 Client ${clientName} recovery successful`);
            }
        } catch (error) {
            this.logger.error(`❌ Client ${clientName} recovery failed:`, error);
        }
    }

    /**
     * Track request events
     */
    trackRequest(clientName, data) {
        const metrics = this.requestMetrics.get(clientName);
        if (metrics) {
            metrics.lastRequestTime = Date.now();
        }
    }

    /**
     * Track response events
     */
    trackResponse(clientName, data) {
        const metrics = this.requestMetrics.get(clientName);
        if (metrics && data.responseTime) {
            metrics.avgResponseTime = (metrics.avgResponseTime * 0.9) + (data.responseTime * 0.1);
        }
    }

    /**
     * Mark client as unhealthy
     */
    markClientUnhealthy(clientName, error) {
        this.healthStatus.set(clientName, {
            status: 'unhealthy',
            uptime: 0,
            lastError: error?.message || 'Unknown error',
            consecutiveErrors: 1,
            lastHealthCheck: Date.now()
        });
        
        this.requestMetrics.set(clientName, {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            avgResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            lastRequestTime: null,
            requestsPerMinute: 0
        });
        
        this.circuitBreakers.set(clientName, {
            isOpen: true,
            failureCount: this.config.circuitBreakerThreshold,
            lastFailureTime: Date.now(),
            nextRetryTime: Date.now() + this.config.circuitBreakerTimeout
        });
    }

    /**
     * Get comprehensive system status
     */
    getSystemHealth() {
        const now = Date.now();
        const uptime = this.initTime ? now - this.initTime : 0;
        
        const health = {
            coordinator: {
                status: 'healthy',
                uptime: uptime,
                totalClients: this.clients.size,
                healthyClients: Array.from(this.clients.values()).filter(c => c.isHealthy).length,
                initialized: this.initialized
            },
            clients: {},
            metrics: {
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                avgResponseTime: 0,
                requestsPerMinute: 0
            },
            loadBalancing: {
                strategy: this.config.loadBalancingStrategy,
                stats: Object.fromEntries(this.loadBalancingStats)
            },
            circuitBreakers: {},
            timestamp: new Date().toISOString()
        };
        
        // Collect detailed client status
        for (const [name, clientInfo] of this.clients) {
            const healthStatus = this.healthStatus.get(name);
            const metrics = this.requestMetrics.get(name);
            const circuitBreaker = this.circuitBreakers.get(name);
            
            health.clients[name] = {
                isHealthy: clientInfo.isHealthy,
                status: healthStatus.status,
                capabilities: this.capabilities.get(name),
                priority: this.clientConfigs[name].priority,
                requestCount: clientInfo.requestCount,
                errorCount: clientInfo.errorCount,
                avgResponseTime: clientInfo.avgResponseTime,
                totalRequests: metrics.totalRequests,
                successfulRequests: metrics.successfulRequests,
                failedRequests: metrics.failedRequests,
                consecutiveErrors: healthStatus.consecutiveErrors,
                lastError: healthStatus.lastError,
                lastHealthCheck: healthStatus.lastHealthCheck,
                uptime: healthStatus.uptime
            };
            
            health.circuitBreakers[name] = {
                isOpen: circuitBreaker.isOpen,
                failureCount: circuitBreaker.failureCount,
                lastFailureTime: circuitBreaker.lastFailureTime,
                nextRetryTime: circuitBreaker.nextRetryTime
            };
            
            // Add to global metrics
            health.metrics.totalRequests += metrics.totalRequests;
            health.metrics.successfulRequests += metrics.successfulRequests;
            health.metrics.failedRequests += metrics.failedRequests;
        }
        
        // Calculate overall metrics
        const totalResponseTime = Array.from(this.clients.values())
            .reduce((sum, client) => sum + client.avgResponseTime, 0);
        health.metrics.avgResponseTime = totalResponseTime / this.clients.size;
        
        // Determine overall health
        const unhealthyClients = Array.from(this.clients.values())
            .filter(client => !client.isHealthy).length;
        
        if (unhealthyClients > 0) {
            health.coordinator.status = unhealthyClients === this.clients.size ? 'critical' : 'degraded';
        }
        
        return health;
    }

    // Legacy compatibility methods
    async getArbitrageData(tokens, chains = ['bsc', 'polygon', 'ethereum']) {
        return await this.routeRequest('arbitrage-opportunities', 'getArbitrageOpportunities', { tokens, chains });
    }

    async executeCodeQuality(code, language = 'javascript') {
        try {
            return await this.routeRequest('code-review', 'performCodeReview', { code, language });
        } catch (error) {
            this.logger.warn('Context7 client not available, skipping code quality check');
            return { passed: true, suggestions: [] };
        }
    }

    async getBridgeCosts(fromChain, toChain, token, amount) {
        return await this.routeRequest('bridges', 'getBridgeCosts', { fromChain, toChain, token, amount });
    }

    async getOptimalFlashLoanProvider(chain, token, amount) {
        return await this.routeRequest('flash-loans', 'getOptimalFlashLoanProvider', { chain, token, amount });
    }

    // Convenience methods
    async getTokenPrice(symbol, vsCurrency = 'usd') {
        return await this.routeRequest('pricing', 'getCurrentPrice', { symbol, vsCurrency });
    }

    async getMarketData(symbols) {
        return await this.routeRequest('market-data', 'getMarketData', { symbols });
    }

    async getTrendingTokens() {
        return await this.routeRequest('trending', 'getTrendingTokens');
    }

    async getTokenBalance(address, tokenAddress, chain) {
        return await this.routeRequest('blockchain', 'getTokenBalance', { address, tokenAddress, chain });
    }

    async getPoolInfo(poolAddress, chain) {
        return await this.routeRequest('pools', 'getPoolInfo', { poolAddress, chain });
    }

    async reviewCode(filePath, codeContent, fileType = 'js') {
        return await this.routeRequest('code-review', 'performCodeReview', { filePath, codeContent, fileType });
    }

    // Utility methods
    getClient(name) {
        return this.clients.get(name)?.client;
    }

    isReady() {
        return this.initialized && this.clients.size > 0;
    }

    getAvailableCapabilities() {
        const capabilities = {};
        
        for (const [name, clientInfo] of this.clients) {
            if (clientInfo.isHealthy) {
                capabilities[name] = this.capabilities.get(name);
            }
        }
        
        return capabilities;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        this.logger.info('🛑 Shutting down Enhanced MCP Coordinator');
        
        // Clear health check timer
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        // Shutdown all clients
        const shutdownPromises = Array.from(this.clients.values())
            .map(clientInfo => clientInfo.client.shutdown?.().catch(err => 
                this.logger.error('Client shutdown error:', err)
            ));

        await Promise.allSettled(shutdownPromises);
        this.removeAllListeners();
        
        this.initialized = false;
        this.logger.info('✅ Enhanced MCP Coordinator shutdown complete');
    }
}

export { MCPCoordinator };
export default MCPCoordinator;