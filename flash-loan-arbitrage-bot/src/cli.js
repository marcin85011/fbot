#!/usr/bin/env node

import { config } from 'dotenv';
import { logger } from './utils/logger.js';
import { SameChainArbitrage } from './strategy-engine/same-chain-arbitrage.js';

// Load environment variables
config();

/**
 * Flash Loan Arbitrage Bot v2.0 - Phase 1 CLI
 * Command line interface for testing and running the arbitrage bot
 */
class ArbitrageBotCLI {
  constructor() {
    this.arbitrageEngine = null;
    this.logger = logger.child({ component: 'CLI' });
  }

  /**
   * Parse command line arguments
   */
  parseArguments() {
    const args = process.argv.slice(2);
    const config = {
      command: 'start', // default command
      simulationMode: false,
      chains: ['bsc', 'polygon'],
      verbose: false
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      switch (arg) {
        case '--simulate':
        case '-s':
          config.simulationMode = true;
          break;
        case '--chains':
        case '-c':
          if (i + 1 < args.length) {
            config.chains = args[++i].split(',');
          }
          break;
        case '--verbose':
        case '-v':
          config.verbose = true;
          break;
        case '--help':
        case '-h':
          this.showHelp();
          process.exit(0);
          break;
        case 'start':
        case 'test':
        case 'status':
        case 'stop':
          config.command = arg;
          break;
        default:
          if (!arg.startsWith('-')) {
            config.command = arg;
          }
          break;
      }
    }

    return config;
  }

  /**
   * Show help information
   */
  showHelp() {
    console.log(`
🚀 Flash Loan Arbitrage Bot v2.0 - Phase 1

USAGE:
  npm start [command] [options]

COMMANDS:
  start     Start the arbitrage engine (default)
  test      Run connection and functionality tests
  status    Show current status and metrics
  stop      Stop the running engine

OPTIONS:
  --simulate, -s     Run in simulation mode (recommended for testing)
  --chains, -c       Specify chains (comma-separated): bsc,polygon
  --verbose, -v      Enable verbose logging
  --help, -h         Show this help message

EXAMPLES:
  npm start -- --simulate                    # Start in simulation mode
  npm start -- test --verbose                # Run tests with verbose output
  npm start -- start --chains bsc --simulate # Start on BSC only in simulation

ENVIRONMENT VARIABLES:
  COINGECKO_MCP_ENABLED=true         # Enable CoinGecko MCP integration
  COINGECKO_MCP_SIMULATION=true      # Use simulated MCP responses
  ARBITRAGE_SIMULATION=true          # Enable arbitrage simulation mode
  LOG_LEVEL=debug                    # Set logging level (debug, info, warn, error)

PHASE 1 FEATURES:
  ✅ CoinGecko MCP integration for real-time price data
  ✅ Same-chain arbitrage detection (USDT/USDC, ETH/wstETH, BTC/WBTC)
  ✅ Profit estimation with 0.25% threshold
  ✅ Risk management and circuit breakers
  ✅ Simulation mode for gasless testing

For more information, visit: https://github.com/marcin85011/fbot
`);
  }

  /**
   * Run the CLI application
   */
  async run() {
    try {
      const config = this.parseArguments();
      
      this.logger.info('🚀 Flash Loan Arbitrage Bot v2.0 - Phase 1 Starting', {
        command: config.command,
        simulationMode: config.simulationMode,
        chains: config.chains,
        timestamp: new Date().toISOString()
      });

      // Set environment variables based on CLI args
      if (config.simulationMode) {
        process.env.ARBITRAGE_SIMULATION = 'true';
        // Only set CoinGecko simulation if not explicitly disabled
        if (!process.env.COINGECKO_MCP_SIMULATION || process.env.COINGECKO_MCP_SIMULATION !== 'false') {
          // Keep existing value if explicitly set to false for live prices
        }
      }

      if (config.verbose) {
        process.env.LOG_LEVEL = 'debug';
      }

      // Ensure MCP is enabled
      if (!process.env.COINGECKO_MCP_ENABLED && !process.env.COINGECKO_MCP_SIMULATION) {
        process.env.COINGECKO_MCP_SIMULATION = 'true';
        this.logger.warn('⚠️ No MCP configuration found, enabling simulation mode');
      }

      // Execute command
      switch (config.command) {
        case 'start':
          await this.startEngine(config);
          break;
        case 'test':
          await this.runTests(config);
          break;
        case 'status':
          await this.showStatus();
          break;
        case 'stop':
          await this.stopEngine();
          break;
        default:
          this.logger.error(`❌ Unknown command: ${config.command}`);
          this.showHelp();
          process.exit(1);
      }

    } catch (error) {
      this.logger.error('❌ CLI execution failed:', error);
      process.exit(1);
    }
  }

  /**
   * Start the arbitrage engine
   */
  async startEngine(config) {
    try {
      this.logger.info('▶️ Starting arbitrage engine...', {
        simulation: config.simulationMode,
        chains: config.chains
      });

      // Initialize arbitrage engine
      this.arbitrageEngine = new SameChainArbitrage({
        chains: config.chains,
        simulationMode: config.simulationMode
      });

      // Initialize and start
      await this.arbitrageEngine.initialize();
      await this.arbitrageEngine.start();

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      this.logger.info('✅ Arbitrage engine started successfully');
      
      if (config.simulationMode) {
        this.logger.info('🎭 Running in SIMULATION mode - no real trades will be executed');
      }

      // Keep process alive and show periodic status
      this.startStatusReporting();

    } catch (error) {
      this.logger.error('❌ Failed to start arbitrage engine:', error);
      throw error;
    }
  }

  /**
   * Run functionality tests
   */
  async runTests(config) {
    try {
      this.logger.info('🧪 Running Phase 1 functionality tests...');

      // Test 1: CoinGecko MCP connection
      this.logger.info('📡 Testing CoinGecko MCP connection...');
      const { EnhancedCoinGeckoClient } = await import('./mcp-integration/enhanced-coingecko-client.js');
      const coingeckoClient = new EnhancedCoinGeckoClient();
      await coingeckoClient.initialize();
      this.logger.info('✅ CoinGecko MCP connection test passed');

      // Test 2: Profit estimator
      this.logger.info('🧮 Testing profit estimator...');
      const { ProfitEstimator } = await import('./strategy-engine/profit-estimator.js');
      const profitEstimator = new ProfitEstimator();
      
      const testOpportunity = {
        priceDelta: 50,
        volume: 5000,
        gasPrice: 20,
        flashLoanProvider: 'venus',
        dexA: 'pancakeswap',
        dexB: 'biswap',
        liquidityA: 1000000,
        liquidityB: 1000000,
        ethPriceUsd: 2000
      };
      
      const estimation = profitEstimator.estimateProfit(testOpportunity);
      this.logger.info('✅ Profit estimator test passed', {
        profitable: estimation.profitable,
        netProfit: estimation.netProfit || 'N/A'
      });

      // Test 3: Arbitrage engine initialization
      this.logger.info('⚙️ Testing arbitrage engine initialization...');
      const arbitrageEngine = new SameChainArbitrage({
        simulationMode: true,
        chains: config.chains
      });
      await arbitrageEngine.initialize();
      this.logger.info('✅ Arbitrage engine initialization test passed');

      // Test 4: Market data retrieval
      this.logger.info('📊 Testing market data retrieval...');
      const marketData = await coingeckoClient.getArbitrageMarketData();
      this.logger.info('✅ Market data retrieval test passed', {
        tokens: Object.keys(marketData).length
      });

      this.logger.info('🎉 All Phase 1 tests passed successfully!');
      
      if (config.verbose) {
        this.logger.info('📋 Test Results Summary', {
          coingeckoConnection: '✅ PASS',
          profitEstimator: '✅ PASS',
          arbitrageEngine: '✅ PASS',
          marketDataRetrieval: '✅ PASS',
          totalTests: 4,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      this.logger.error('❌ Tests failed:', error);
      throw error;
    }
  }

  /**
   * Show current status
   */
  async showStatus() {
    if (!this.arbitrageEngine) {
      this.logger.info('📊 Status: Engine not running');
      return;
    }

    const state = this.arbitrageEngine.getState();
    
    this.logger.info('📊 Arbitrage Engine Status', {
      running: state.isRunning,
      lastUpdate: state.lastUpdate,
      currentOpportunities: state.opportunities.length,
      simulationMode: state.config.simulationMode,
      chains: state.config.chains,
      metrics: state.metrics
    });

    if (state.opportunities.length > 0) {
      this.logger.info('💰 Current Opportunities', {
        opportunities: state.opportunities.map(op => ({
          pair: op.pair,
          chain: op.chain,
          profit: op.estimatedProfit,
          confidence: op.confidence
        }))
      });
    }
  }

  /**
   * Stop the engine
   */
  async stopEngine() {
    if (this.arbitrageEngine) {
      await this.arbitrageEngine.stop();
      this.arbitrageEngine = null;
    }
    this.logger.info('🛑 Engine stopped');
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      this.logger.info(`🔄 Received ${signal}, shutting down gracefully...`);
      await this.stopEngine();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * Start periodic status reporting
   */
  startStatusReporting() {
    setInterval(() => {
      if (this.arbitrageEngine) {
        this.showStatus();
      }
    }, 60000); // Every minute
  }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new ArbitrageBotCLI();
  cli.run();
}

export default ArbitrageBotCLI;