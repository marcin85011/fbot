import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';
import { ProfitEstimator } from './profit-estimator.js';
import { EnhancedCoinGeckoClient } from '../mcp-integration/enhanced-coingecko-client.js';

/**
 * Same-Chain Arbitrage Engine - Phase 1 Implementation
 * Focuses on high-volume stable pairs with proven profit opportunities
 * Target pairs: USDT/USDC, ETH/wstETH, BTC/WBTC
 */
export class SameChainArbitrage {
  constructor(config = {}) {
    this.config = {
      minVolumeUsd: 1000000, // $1M minimum daily volume
      maxGasPriceGwei: 50, // Maximum acceptable gas price
      minProfitThreshold: 0.0025, // 0.25% minimum profit
      maxTradeSize: 50000, // Maximum trade size in USD
      updateInterval: 30000, // 30 seconds update interval
      chains: ['bsc', 'polygon'], // Supported chains
      simulationMode: process.env.ARBITRAGE_SIMULATION === 'true',
      ...config
    };
    
    // Target trading pairs for Phase 1
    this.targetPairs = [
      {
        id: 'usdt-usdc',
        tokenA: 'tether', // USDT
        tokenB: 'usd-coin', // USDC
        symbol: 'USDT/USDC',
        priority: 'high',
        chains: ['bsc', 'polygon'],
        minVolume: 10000000, // $10M min volume
        flashLoanProvider: 'venus',
        dexes: {
          bsc: ['pancakeswap', 'biswap'],
          polygon: ['quickswap', 'sushiswap']
        }
      },
      {
        id: 'eth-wsteth',
        tokenA: 'ethereum', // ETH
        tokenB: 'wrapped-steth', // wstETH
        symbol: 'ETH/wstETH',
        priority: 'medium',
        chains: ['polygon'],
        minVolume: 5000000, // $5M min volume
        flashLoanProvider: 'aave',
        dexes: {
          polygon: ['quickswap', 'uniswap-v3']
        }
      },
      {
        id: 'btc-wbtc',
        tokenA: 'bitcoin', // BTC (wrapped)
        tokenB: 'wrapped-bitcoin', // WBTC
        symbol: 'BTC/WBTC',
        priority: 'low',
        chains: ['polygon'],
        minVolume: 2000000, // $2M min volume
        flashLoanProvider: 'aave',
        dexes: {
          polygon: ['quickswap', 'curve']
        }
      }
    ];
    
    // Initialize components
    this.profitEstimator = new ProfitEstimator({
      minProfitThreshold: this.config.minProfitThreshold
    });
    
    this.coingeckoClient = new EnhancedCoinGeckoClient();
    
    // State management
    this.isRunning = false;
    this.lastUpdate = null;
    this.opportunities = [];
    this.executionHistory = [];
    
    // Metrics
    this.metrics = {
      opportunitiesDetected: 0,
      opportunitiesExecuted: 0,
      totalProfit: 0,
      totalGasCost: 0,
      successRate: 0,
      lastReset: Date.now()
    };
    
    this.logger = logger.child({ component: 'SameChainArbitrage' });
  }

  /**
   * Initialize the arbitrage engine
   */
  async initialize() {
    try {
      this.logger.info('🚀 Initializing Same-Chain Arbitrage Engine...');
      
      // Initialize CoinGecko MCP client
      await this.coingeckoClient.initialize();
      
      // Validate configuration
      this.validateConfiguration();
      
      // Test profit estimator
      await this.testProfitEstimator();
      
      this.logger.info('✅ Same-Chain Arbitrage Engine initialized successfully', {
        pairs: this.targetPairs.length,
        chains: this.config.chains,
        simulationMode: this.config.simulationMode
      });
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize Same-Chain Arbitrage Engine:', error);
      throw error;
    }
  }

  /**
   * Start the arbitrage monitoring and execution
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('⚠️ Arbitrage engine is already running');
      return;
    }
    
    try {
      this.logger.info('▶️ Starting Same-Chain Arbitrage Engine');
      this.isRunning = true;
      
      // Start opportunity detection loop
      this.startOpportunityDetection();
      
      // Start metrics reporting
      this.startMetricsReporting();
      
      this.logger.info('🔄 Same-Chain Arbitrage Engine started successfully');
      
    } catch (error) {
      this.logger.error('❌ Failed to start arbitrage engine:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the arbitrage engine
   */
  async stop() {
    this.logger.info('⏹️ Stopping Same-Chain Arbitrage Engine');
    this.isRunning = false;
    
    // Clear intervals
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    this.logger.info('🛑 Same-Chain Arbitrage Engine stopped');
  }

  /**
   * Start opportunity detection loop
   */
  startOpportunityDetection() {
    this.detectionInterval = setInterval(async () => {
      try {
        await this.detectOpportunities();
      } catch (error) {
        this.logger.error('❌ Error in opportunity detection:', error);
      }
    }, this.config.updateInterval);
    
    // Run initial detection
    this.detectOpportunities();
  }

  /**
   * Detect arbitrage opportunities
   */
  async detectOpportunities() {
    if (!this.isRunning) return;
    
    const startTime = Date.now();
    
    try {
      // Get current gas prices for all chains
      const gasPrices = await this.getCurrentGasPrices();
      
      // Filter chains by acceptable gas prices
      const viableChains = this.config.chains.filter(chain => 
        gasPrices[chain] && gasPrices[chain] <= this.config.maxGasPriceGwei
      );
      
      if (viableChains.length === 0) {
        this.logger.warn('⚠️ No viable chains due to high gas prices', { gasPrices });
        return;
      }
      
      // Get market data for all target tokens
      const marketData = await this.coingeckoClient.getArbitrageMarketData();
      
      // Detect opportunities for each viable pair
      const detectedOpportunities = [];
      
      for (const pair of this.targetPairs) {
        for (const chain of viableChains) {
          if (!pair.chains.includes(chain)) continue;
          
          const opportunity = await this.analyzePair(pair, chain, marketData, gasPrices[chain]);
          if (opportunity) {
            detectedOpportunities.push(opportunity);
          }
        }
      }
      
      // Sort opportunities by profit potential
      detectedOpportunities.sort((a, b) => b.estimatedProfit - a.estimatedProfit);
      
      // Update opportunities state
      this.opportunities = detectedOpportunities;
      this.lastUpdate = new Date();
      this.metrics.opportunitiesDetected += detectedOpportunities.length;
      
      // Execute best opportunities if profitable
      await this.executeOpportunities(detectedOpportunities.slice(0, 3)); // Top 3 opportunities
      
      const duration = Date.now() - startTime;
      this.logger.debug('🔍 Opportunity detection completed', { 
        opportunities: detectedOpportunities.length,
        viableChains: viableChains.length,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('❌ Failed to detect opportunities:', error, { duration: `${duration}ms` });
    }
  }

  /**
   * Analyze a specific pair for arbitrage opportunities
   */
  async analyzePair(pair, chain, marketData, gasPrice) {
    try {
      const tokenAData = marketData[pair.tokenA];
      const tokenBData = marketData[pair.tokenB];
      
      if (!tokenAData || !tokenBData) {
        this.logger.debug(`📊 Missing market data for pair ${pair.symbol}`, {
          tokenA: !!tokenAData,
          tokenB: !!tokenBData
        });
        return null;
      }
      
      // Check minimum volume requirement
      const minVolume = Math.min(tokenAData.volume_24h, tokenBData.volume_24h);
      if (minVolume < pair.minVolume) {
        return null;
      }
      
      // Calculate price difference
      const priceA = tokenAData.current_price;
      const priceB = tokenBData.current_price;
      const priceDelta = Math.abs(priceA - priceB);
      const avgPrice = (priceA + priceB) / 2;
      const priceDiffPercent = (priceDelta / avgPrice) * 100;
      
      // Skip if price difference is too small
      if (priceDiffPercent < 0.1) {
        return null;
      }
      
      // Determine trade direction
      const buyToken = priceA < priceB ? pair.tokenA : pair.tokenB;
      const sellToken = priceA < priceB ? pair.tokenB : pair.tokenA;
      const buyPrice = Math.min(priceA, priceB);
      const sellPrice = Math.max(priceA, priceB);
      
      // Calculate optimal trade size
      const tradeSize = this.calculateOptimalTradeSize(pair, minVolume);
      
      // Create opportunity object for profit estimation
      const opportunity = {
        id: `${pair.id}-${chain}-${Date.now()}`,
        pair: pair.symbol,
        chain,
        priceDelta,
        volume: tradeSize,
        gasPrice,
        flashLoanProvider: pair.flashLoanProvider,
        dexA: pair.dexes[chain][0], // Primary DEX
        dexB: pair.dexes[chain][1] || pair.dexes[chain][0], // Secondary DEX or same
        liquidityA: tokenAData.volume_24h,
        liquidityB: tokenBData.volume_24h,
        ethPriceUsd: marketData['ethereum']?.current_price || 2000,
        buyToken,
        sellToken,
        buyPrice,
        sellPrice,
        priceDiffPercent,
        timestamp: new Date().toISOString()
      };
      
      // Estimate profit
      const profitEstimation = this.profitEstimator.estimateProfit(opportunity);
      
      if (profitEstimation.profitable) {
        this.logger.info('💰 Profitable opportunity detected', {
          pair: pair.symbol,
          chain,
          profit: profitEstimation.netProfit,
          profitPercent: profitEstimation.profitPercent,
          confidence: profitEstimation.confidence
        });
        
        return {
          ...opportunity,
          estimatedProfit: profitEstimation.netProfit,
          profitPercent: profitEstimation.profitPercent,
          confidence: profitEstimation.confidence,
          recommendation: profitEstimation.recommendation,
          costs: profitEstimation.costs
        };
      }
      
      return null;
      
    } catch (error) {
      this.logger.error(`❌ Failed to analyze pair ${pair.symbol}:`, error);
      return null;
    }
  }

  /**
   * Execute profitable opportunities
   */
  async executeOpportunities(opportunities) {
    if (opportunities.length === 0) return;
    
    for (const opportunity of opportunities) {
      try {
        // Skip if confidence is too low
        if (opportunity.confidence < 0.5) {
          this.logger.debug('⚠️ Skipping low confidence opportunity', {
            id: opportunity.id,
            confidence: opportunity.confidence
          });
          continue;
        }
        
        // Execute the arbitrage
        await this.executeArbitrage(opportunity);
        
      } catch (error) {
        this.logger.error('❌ Failed to execute opportunity:', error, {
          opportunityId: opportunity.id
        });
      }
    }
  }

  /**
   * Execute a single arbitrage opportunity
   */
  async executeArbitrage(opportunity) {
    const executionId = `exec-${Date.now()}`;
    
    try {
      this.logger.info('⚡ Executing arbitrage opportunity', {
        executionId,
        opportunity: opportunity.id,
        pair: opportunity.pair,
        chain: opportunity.chain,
        estimatedProfit: opportunity.estimatedProfit
      });
      
      if (this.config.simulationMode) {
        // Simulation mode - just log the execution
        const simulatedProfit = opportunity.estimatedProfit * (0.8 + Math.random() * 0.4); // 80-120% of estimated
        
        this.logger.info('🎭 SIMULATION: Arbitrage executed', {
          executionId,
          simulatedProfit,
          gasUsed: 450000, // Typical gas usage
          success: simulatedProfit > 0
        });
        
        // Update metrics
        this.metrics.opportunitiesExecuted++;
        this.metrics.totalProfit += simulatedProfit;
        this.metrics.totalGasCost += (opportunity.gasPrice * 450000 * opportunity.ethPriceUsd) / 1e9;
        
        // Record execution
        this.executionHistory.push({
          id: executionId,
          opportunity: opportunity.id,
          profit: simulatedProfit,
          gasUsed: 450000,
          timestamp: new Date(),
          simulation: true
        });
        
        return;
      }
      
      // Real execution would happen here
      // For Phase 1, we're focusing on simulation and testing
      this.logger.warn('🚧 Real execution not implemented in Phase 1 - use simulation mode');
      
    } catch (error) {
      this.logger.error('❌ Arbitrage execution failed:', error, {
        executionId,
        opportunityId: opportunity.id
      });
      throw error;
    }
  }

  /**
   * Calculate optimal trade size based on liquidity and limits
   */
  calculateOptimalTradeSize(pair, minVolume) {
    // Use 1% of daily volume as base, capped by max trade size
    const volumeBasedSize = minVolume * 0.01;
    const maxSize = this.config.maxTradeSize;
    
    return Math.min(volumeBasedSize, maxSize);
  }

  /**
   * Get current gas prices for all chains
   */
  async getCurrentGasPrices() {
    // For now, return simulated gas prices
    // In a real implementation, this would query actual gas price APIs
    return {
      bsc: 5 + Math.random() * 15, // 5-20 Gwei
      polygon: 30 + Math.random() * 50 // 30-80 Gwei
    };
  }

  /**
   * Start metrics reporting
   */
  startMetricsReporting() {
    this.metricsInterval = setInterval(() => {
      this.reportMetrics();
    }, 300000); // Every 5 minutes
  }

  /**
   * Report current metrics
   */
  reportMetrics() {
    const runtime = Date.now() - this.metrics.lastReset;
    const hours = runtime / (1000 * 60 * 60);
    
    this.metrics.successRate = this.metrics.opportunitiesExecuted > 0 
      ? (this.metrics.opportunitiesExecuted / this.metrics.opportunitiesDetected) * 100 
      : 0;
    
    this.logger.info('📊 Arbitrage Engine Metrics', {
      runtime: `${hours.toFixed(2)} hours`,
      opportunitiesDetected: this.metrics.opportunitiesDetected,
      opportunitiesExecuted: this.metrics.opportunitiesExecuted,
      totalProfit: this.metrics.totalProfit,
      totalGasCost: this.metrics.totalGasCost,
      netProfit: this.metrics.totalProfit - this.metrics.totalGasCost,
      successRate: `${this.metrics.successRate.toFixed(2)}%`,
      currentOpportunities: this.opportunities.length,
      lastUpdate: this.lastUpdate?.toISOString()
    });
  }

  /**
   * Validate configuration
   */
  validateConfiguration() {
    if (this.config.chains.length === 0) {
      throw new Error('At least one chain must be configured');
    }
    
    if (this.targetPairs.length === 0) {
      throw new Error('At least one target pair must be configured');
    }
    
    this.logger.info('✅ Configuration validated', {
      chains: this.config.chains.length,
      pairs: this.targetPairs.length,
      simulationMode: this.config.simulationMode
    });
  }

  /**
   * Test profit estimator
   */
  async testProfitEstimator() {
    const testOpportunity = {
      priceDelta: 100, // $100 price difference
      volume: 10000, // $10,000 trade
      gasPrice: 20, // 20 Gwei
      flashLoanProvider: 'venus',
      dexA: 'pancakeswap',
      dexB: 'biswap',
      liquidityA: 1000000,
      liquidityB: 1000000,
      ethPriceUsd: 2000
    };
    
    const estimation = this.profitEstimator.estimateProfit(testOpportunity);
    
    this.logger.info('🧪 Profit estimator test completed', {
      profitable: estimation.profitable,
      netProfit: estimation.netProfit || 'N/A',
      reason: estimation.reason || 'Success'
    });
    
    if (estimation.error) {
      throw new Error(`Profit estimator test failed: ${estimation.error}`);
    }
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isRunning: this.isRunning,
      lastUpdate: this.lastUpdate,
      opportunities: this.opportunities,
      metrics: this.metrics,
      executionHistory: this.executionHistory.slice(-10), // Last 10 executions
      config: {
        simulationMode: this.config.simulationMode,
        chains: this.config.chains,
        pairs: this.targetPairs.length
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      opportunitiesDetected: 0,
      opportunitiesExecuted: 0,
      totalProfit: 0,
      totalGasCost: 0,
      successRate: 0,
      lastReset: Date.now()
    };
    
    this.executionHistory = [];
    this.logger.info('📊 Metrics reset');
  }
}

export default SameChainArbitrage;