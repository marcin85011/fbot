/**
 * Arbitrage Detection and Execution Engine
 * Core engine for detecting and executing profitable arbitrage opportunities
 * Integrates with MCP coordinator and flash loan infrastructure
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { getChainConfig } from '../config/chains.js';
import { FlashLoanCore } from '../flash-loans/flash-loan-core.js';

class ArbitrageEngine extends EventEmitter {
    constructor(mcpCoordinator) {
        super();
        this.mcpCoordinator = mcpCoordinator;
        this.flashLoanCore = new FlashLoanCore(mcpCoordinator);
        this.isRunning = false;
        this.scanInterval = 5000; // 5 seconds
        this.scanTimer = null;
        this.minProfitability = 0.5; // 0.5% minimum profit
        this.maxRisk = 0.1; // 10% max risk
        this.executionQueue = [];
        this.processingQueue = false;
        this.stats = {
            totalScans: 0,
            opportunitiesFound: 0,
            opportunitiesExecuted: 0,
            successfulExecutions: 0,
            totalProfit: 0,
            uptime: 0
        };
        this.startTime = null;
    }

    /**
     * Initialize the arbitrage engine
     */
    async initialize() {
        logger.info('🚀 Initializing Arbitrage Engine');
        
        try {
            // Initialize flash loan core
            await this.flashLoanCore.initialize();
            
            // Set up event listeners
            this.setupEventListeners();
            
            this.startTime = Date.now();
            logger.info('✅ Arbitrage Engine initialized successfully');
            
        } catch (error) {
            logger.error('💥 Failed to initialize Arbitrage Engine:', error);
            throw error;
        }
    }

    /**
     * Start the arbitrage engine
     */
    async start() {
        if (this.isRunning) {
            logger.warn('Arbitrage Engine is already running');
            return;
        }

        logger.info('🔄 Starting Arbitrage Engine');
        this.isRunning = true;
        
        // Start opportunity scanning
        this.scanTimer = setInterval(async () => {
            await this.scanForOpportunities();
        }, this.scanInterval);

        // Start queue processing
        this.processExecutionQueue();
        
        this.emit('started');
        logger.info('✅ Arbitrage Engine started successfully');
    }

    /**
     * Stop the arbitrage engine
     */
    async stop() {
        if (!this.isRunning) {
            logger.warn('Arbitrage Engine is not running');
            return;
        }

        logger.info('🛑 Stopping Arbitrage Engine');
        this.isRunning = false;
        
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }

        // Wait for queue to finish processing
        while (this.processingQueue) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.emit('stopped');
        logger.info('✅ Arbitrage Engine stopped successfully');
    }

    /**
     * Scan for arbitrage opportunities
     */
    async scanForOpportunities() {
        if (!this.isRunning) return;

        this.stats.totalScans++;
        const scanId = `SCAN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            logger.info(`🔍 Scanning for arbitrage opportunities [${scanId}]`);
            
            // Get market data from MCP coordinator
            const tokens = await this.getTargetTokens();
            const chains = ['bsc', 'polygon', 'ethereum'];
            
            const opportunities = await this.mcpCoordinator.getArbitrageData(tokens, chains);
            
            if (opportunities.length === 0) {
                logger.info(`📊 No opportunities found [${scanId}]`);
                return;
            }

            // Filter and rank opportunities
            const validOpportunities = await this.filterOpportunities(opportunities);
            const rankedOpportunities = this.rankOpportunities(validOpportunities);
            
            this.stats.opportunitiesFound += rankedOpportunities.length;
            
            logger.info(`📈 Found ${rankedOpportunities.length} valid opportunities [${scanId}]`);
            
            // Add to execution queue
            rankedOpportunities.forEach(opp => {
                this.executionQueue.push({
                    ...opp,
                    scanId,
                    timestamp: Date.now()
                });
            });
            
            this.emit('opportunitiesFound', rankedOpportunities);
            
        } catch (error) {
            logger.error(`💥 Opportunity scan failed [${scanId}]:`, error);
            this.emit('scanError', { scanId, error });
        }
    }

    /**
     * Get target tokens for arbitrage
     */
    async getTargetTokens() {
        // High liquidity, popular tokens for arbitrage
        return [
            'bitcoin', 'ethereum', 'binancecoin', 'matic-network',
            'usd-coin', 'tether', 'dai', 'chainlink',
            'uniswap', 'pancakeswap-token', 'sushi'
        ];
    }

    /**
     * Filter opportunities based on criteria
     */
    async filterOpportunities(opportunities) {
        const validOpportunities = [];
        
        for (const opportunity of opportunities) {
            try {
                // Check profitability threshold
                if (opportunity.profitability < this.minProfitability) {
                    continue;
                }

                // Check liquidity requirements
                if (opportunity.liquidity < 50000) { // $50k minimum liquidity
                    continue;
                }

                // Check confidence score
                if (opportunity.confidence < 70) { // 70% minimum confidence
                    continue;
                }

                // Enhanced validation
                const validation = await this.validateOpportunity(opportunity);
                if (!validation.valid) {
                    logger.info(`❌ Opportunity validation failed: ${validation.reason}`);
                    continue;
                }

                // Calculate optimal trade size
                const tradeSize = this.calculateOptimalTradeSize(opportunity);
                
                validOpportunities.push({
                    ...opportunity,
                    amount: tradeSize,
                    validation,
                    expectedProfit: tradeSize * opportunity.profitability / 100
                });
                
            } catch (error) {
                logger.error('Opportunity validation error:', error);
            }
        }
        
        return validOpportunities;
    }

    /**
     * Validate individual opportunity
     */
    async validateOpportunity(opportunity) {
        try {
            // Check if flash loan is available
            const flashLoanProvider = await this.mcpCoordinator.getOptimalFlashLoanProvider(
                opportunity.chain,
                opportunity.token,
                opportunity.amount || 1000
            );

            if (!flashLoanProvider) {
                return { valid: false, reason: 'No flash loan provider available' };
            }

            // Check gas costs
            const gasCost = await this.estimateGasCost(opportunity);
            if (gasCost > opportunity.expectedProfit * 0.3) {
                return { valid: false, reason: 'Gas costs too high' };
            }

            // Check if DEX has sufficient liquidity
            const liquidityCheck = await this.checkDEXLiquidity(opportunity);
            if (!liquidityCheck.sufficient) {
                return { valid: false, reason: 'Insufficient DEX liquidity' };
            }

            return { 
                valid: true, 
                flashLoanProvider,
                gasCost,
                liquidityCheck 
            };
            
        } catch (error) {
            return { valid: false, reason: error.message };
        }
    }

    /**
     * Calculate optimal trade size
     */
    calculateOptimalTradeSize(opportunity) {
        // Kelly criterion for optimal position sizing
        const winRate = opportunity.confidence / 100;
        const avgWin = opportunity.profitability / 100;
        const avgLoss = 0.02; // 2% max loss
        
        const kellyFraction = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
        const conservativeFraction = Math.min(kellyFraction, 0.1); // Max 10% of liquidity
        
        return Math.max(
            1000, // Minimum $1000
            Math.min(
                opportunity.liquidity * conservativeFraction,
                100000 // Maximum $100k
            )
        );
    }

    /**
     * Rank opportunities by profitability and risk
     */
    rankOpportunities(opportunities) {
        return opportunities.sort((a, b) => {
            // Score based on profitability, confidence, and liquidity
            const scoreA = (a.profitability * a.confidence * Math.log(a.liquidity)) / 1000;
            const scoreB = (b.profitability * b.confidence * Math.log(b.liquidity)) / 1000;
            
            return scoreB - scoreA;
        });
    }

    /**
     * Process execution queue
     */
    async processExecutionQueue() {
        if (this.processingQueue || !this.isRunning) return;
        
        this.processingQueue = true;
        
        while (this.executionQueue.length > 0 && this.isRunning) {
            const opportunity = this.executionQueue.shift();
            
            try {
                await this.executeOpportunity(opportunity);
            } catch (error) {
                logger.error('Execution queue processing error:', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        this.processingQueue = false;
        
        // Schedule next processing
        if (this.isRunning) {
            setTimeout(() => this.processExecutionQueue(), 1000);
        }
    }

    /**
     * Execute arbitrage opportunity
     */
    async executeOpportunity(opportunity) {
        const executionId = `EXE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        logger.info(`🔄 Executing arbitrage opportunity [${executionId}]`, {
            token: opportunity.token,
            chain: opportunity.chain,
            profitability: opportunity.profitability,
            amount: opportunity.amount,
            expectedProfit: opportunity.expectedProfit
        });

        try {
            this.stats.opportunitiesExecuted++;
            
            // Execute via flash loan
            const result = await this.flashLoanCore.executeFlashLoan({
                ...opportunity,
                executionId
            });

            if (result.success) {
                this.stats.successfulExecutions++;
                this.stats.totalProfit += result.profit;
                
                logger.info(`✅ Arbitrage executed successfully [${executionId}]`, {
                    profit: result.profit,
                    gasUsed: result.gasUsed,
                    transactionHash: result.transactionHash
                });
                
                this.emit('executionSuccess', { executionId, result, opportunity });
            } else {
                logger.error(`❌ Arbitrage execution failed [${executionId}]`);
                this.emit('executionFailed', { executionId, result, opportunity });
            }
            
        } catch (error) {
            logger.error(`💥 Arbitrage execution error [${executionId}]:`, error);
            this.emit('executionError', { executionId, error, opportunity });
        }
    }

    /**
     * Estimate gas cost for opportunity
     */
    async estimateGasCost(opportunity) {
        try {
            const chainConfig = getChainConfig(opportunity.chain);
            const baseGasPrice = chainConfig.gasPrice || '20000000000'; // 20 gwei
            const estimatedGas = 500000; // Flash loan + 2 DEX trades
            
            return (Number(baseGasPrice) * estimatedGas) / 1e18;
        } catch (error) {
            logger.error('Gas cost estimation failed:', error);
            return 0.01; // Conservative estimate
        }
    }

    /**
     * Check DEX liquidity
     */
    async checkDEXLiquidity(opportunity) {
        try {
            // This would integrate with DEX contracts to check actual liquidity
            // For now, we'll use the liquidity data from the opportunity
            const requiredLiquidity = opportunity.amount * 2; // 2x safety margin
            
            return {
                sufficient: opportunity.liquidity >= requiredLiquidity,
                available: opportunity.liquidity,
                required: requiredLiquidity
            };
        } catch (error) {
            logger.error('Liquidity check failed:', error);
            return { sufficient: false, error: error.message };
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Flash loan core events
        this.flashLoanCore.on('flashLoanExecuted', (result) => {
            this.emit('flashLoanExecuted', result);
        });

        this.flashLoanCore.on('flashLoanFailed', (result) => {
            this.emit('flashLoanFailed', result);
        });

        // MCP coordinator events
        this.mcpCoordinator.on('clientError', (error) => {
            logger.warn('MCP client error in arbitrage engine:', error);
        });
    }

    /**
     * Get engine statistics
     */
    getStats() {
        const uptime = this.startTime ? Date.now() - this.startTime : 0;
        const successRate = this.stats.opportunitiesExecuted > 0 
            ? (this.stats.successfulExecutions / this.stats.opportunitiesExecuted * 100).toFixed(2)
            : 0;
        
        return {
            ...this.stats,
            uptime: Math.floor(uptime / 1000), // seconds
            successRate: `${successRate}%`,
            profitPerHour: uptime > 0 ? (this.stats.totalProfit / (uptime / 3600000)).toFixed(4) : 0,
            isRunning: this.isRunning,
            queueSize: this.executionQueue.length,
            processingQueue: this.processingQueue
        };
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return {
            scanInterval: this.scanInterval,
            minProfitability: this.minProfitability,
            maxRisk: this.maxRisk,
            isRunning: this.isRunning
        };
    }

    /**
     * Update configuration
     */
    updateConfig(config) {
        if (config.scanInterval !== undefined) {
            this.scanInterval = config.scanInterval;
            
            // Restart scanning with new interval
            if (this.scanTimer) {
                clearInterval(this.scanTimer);
                this.scanTimer = setInterval(async () => {
                    await this.scanForOpportunities();
                }, this.scanInterval);
            }
        }
        
        if (config.minProfitability !== undefined) {
            this.minProfitability = config.minProfitability;
        }
        
        if (config.maxRisk !== undefined) {
            this.maxRisk = config.maxRisk;
        }
        
        logger.info('✅ Arbitrage Engine configuration updated', config);
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        logger.info('🛑 Shutting down Arbitrage Engine');
        
        await this.stop();
        await this.flashLoanCore.shutdown();
        this.removeAllListeners();
        
        logger.info('✅ Arbitrage Engine shutdown complete');
    }
}

export { ArbitrageEngine };