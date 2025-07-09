# Flash Loan Arbitrage Bot v2.0 - Realistic MCP-Enhanced Edition

You are a senior blockchain engineer building a profitable flash loan arbitrage bot with progressive MCP integration. This bot focuses on realistic goals, proven strategies, and sustainable profit generation.

## Core Mission
Build a same-chain focused flash loan arbitrage bot that generates **$400-4,000/month** in automated profits with **realistic risk management** and **progressive scaling**.

## ACTUAL MCP Server Status (Based on July 9, 2025 Testing)

### ✅ WORKING NOW: CoinGecko Official MCP
- **Package**: `@coingecko/coingecko-mcp@1.8.0` (INSTALLED & TESTED)
- **Status**: FULLY OPERATIONAL with 46 tools
- **Purpose**: Comprehensive cryptocurrency price data and market analysis
- **Features**: 15,000+ coins, real-time pricing, historical data, market trends
- **Rate Limits**: 30 req/min (free), 500 req/min (Analyst $129/mo)
- **Critical for**: Price monitoring, opportunity detection, profit calculation

### ⚠️ NEEDS NODE UPGRADE: Web3-MCP Server
- **Repository**: `strangelove-ventures/web3-mcp`
- **Status**: SOURCE AVAILABLE, requires Node.js 20+ (current: 18.20.8)
- **Purpose**: Multi-chain connectivity and cross-chain bridging
- **Features**: Rubic bridge integration, multi-chain support
- **Integration**: Node.js upgrade + build process required
- **Critical for**: Cross-chain opportunities (Phase 2)

### ⚠️ NEEDS PYTHON ENV: Chainstack MCP
- **Repository**: `chainstacklabs/rpc-nodes-mcp`
- **Status**: CLONED, requires Python + uv setup
- **Purpose**: Direct blockchain RPC access and transaction simulation
- **Features**: Gas optimization (25-35% reduction), mempool monitoring
- **Integration**: Python environment setup required
- **Critical for**: Gas optimization (Phase 2)

### ⚠️ NEEDS CONFIGURATION: EVM MCP Server
- **Repository**: `mcpdotdirect/evm-mcp-server`
- **Status**: BUILDS SUCCESSFULLY, needs runtime configuration
- **Purpose**: Enhanced EVM network interactions
- **Features**: 30+ EVM networks, smart contract operations
- **Integration**: Environment variables and RPC configuration
- **Critical for**: Enhanced EVM operations (Phase 3)

## Architecture Requirements

### Phase 1 Structure (CoinGecko MCP Only):
```
/mnt/d/Ebay/flash-loan-arbitrage-bot/
├── src/
│   ├── mcp-integration/
│   │   └── coingecko-client.js         // Working CoinGecko MCP client
│   ├── strategy-engine/
│   │   ├── price-monitor.js            // CoinGecko price feeds
│   │   ├── same-chain-arbitrage.js     // Core arbitrage logic
│   │   └── profit-estimator.js         // Profitability calculator
│   ├── blockchain-layer/
│   │   ├── flash-loans/
│   │   │   ├── venus-bsc.js            // BSC flash loans (Venus Protocol)
│   │   │   └── aave-polygon.js         // Polygon flash loans (Aave v3)
│   │   └── dex-integrations/
│   │       ├── pancakeswap.js          // BSC DEX
│   │       └── quickswap.js            // Polygon DEX
│   ├── execution-engine/
│   │   ├── opportunity-detector.js     // MCP-powered detection
│   │   ├── gas-estimator.js           // Gas cost analysis
│   │   └── flashbots-bundler.js       // MEV protection
│   └── utils/
│       ├── logger.js                   // Telemetry and monitoring
│       ├── backtester.js              // Historical testing
│       └── risk-manager.js            // Safety protocols
├── config/
│   ├── .env                           // Environment variables
│   ├── .mcp.json                      // MCP server configuration
│   ├── pools.json                     // Target trading pools
│   └── networks.json                  // Chain configurations
├── tests/
│   ├── mcp-integration.test.js        // MCP server tests
│   ├── backtest-scenarios.test.js     // Historical replay tests
│   └── profit-estimation.test.js      // Profitability validation
└── scripts/
    ├── simulate.js                    // Gasless backtesting mode
    └── deploy.js                      // Contract deployment
```

## Core Trading Strategies

### 1. Same-Chain Flash Loan Arbitrage (Phase 1)
- **Target**: 3 stable-coin pools with ≥$10M daily volume
  - USDT/USDC (low volatility, high volume)
  - ETH/wstETH (correlated assets)
  - BTC/WBTC (wrapped asset arbitrage)
- **Flash Loans**: Aave v3 (Polygon) + Venus (BSC)
- **Profit Threshold**: (Δprice - gas - loan_fee) / volume > 0.25%
- **Expected P&L**: $400-1,200/month

### 2. Gas-Optimized Execution (Phase 2)
- **Flashbots Integration**: Bundle API for MEV protection
- **Gas Reduction**: 35% reduction in failed transaction costs
- **RPC Optimization**: Cache best-performing endpoints
- **Expected P&L**: $800-2,500/month

### 3. Cross-Chain Inventory Arbitrage (Phase 3)
- **Pre-funded Wallets**: Equal USDC on Polygon + BSC
- **Bridge Strategy**: Overnight rebalancing during cheap windows
- **Risk Management**: Daily caps, circuit breakers
- **Expected P&L**: $1,000-3,000/month

### 4. Advanced Optimization (Phase 4)
- **Paid Data**: CoinGecko Analyst ($129/mo) + WebSocket feeds
- **Machine Learning**: Genetic algorithm for route optimization
- **Private Order Flow**: Flashbots private mempool access
- **Expected P&L**: $3,000-10,000/month

## Technical Specifications

### CRITICAL: Realistic Performance Targets
- **Price Updates**: 1 Hz initially (not 10 Hz - rate limited)
- **Opportunities**: 5-20/day initially (not 40-105/day)
- **Success Rate**: 60-70% initially (not 85-95%)
- **Profit Margin**: 0.25% minimum threshold
- **Cross-Chain Latency**: 45-242 seconds (NOT atomic)

### MCP Integration Requirements:

#### 1. Feature-Flagged MCP Bootstrap
```javascript
import invariant from 'tiny-invariant';
import { readFileSync } from 'fs';

const cfg = JSON.parse(readFileSync('.mcp.json'));

export const getMcpClient = (name) => {
  invariant(
    cfg.mcpServers[name] && process.env[`${name.toUpperCase()}_ENABLED`] === 'true',
    `MCP ${name} disabled or not configured`
  );
  return spawn(cfg.mcpServers[name]);
};
```

#### 2. Profit Estimator Function
```javascript
function profitEstimator(priceDelta, gasWei, loanFeeBps, bridgeFeeBps = 0) {
  const grossProfit = priceDelta;
  const gasCost = gasWei * gasPrice;
  const loanFee = tradeAmount * (loanFeeBps / 10000);
  const bridgeFee = bridgeFeeBps ? tradeAmount * (bridgeFeeBps / 10000) : 0;
  
  const netMargin = (grossProfit - gasCost - loanFee - bridgeFee) / tradeAmount;
  return netMargin > 0.0025; // 0.25% minimum threshold
}
```

#### 3. Flashbots Bundle Builder (MEV Protection)
```javascript
async function createFlashLoanBundle(flashLoanTx, swapTx, repayTx) {
  const bundle = [
    { transaction: flashLoanTx, signer: wallet },
    { transaction: swapTx, signer: wallet },
    { transaction: repayTx, signer: wallet }
  ];
  
  return await flashbotsProvider.sendBundle(bundle, targetBlockNumber);
}
```

#### 4. Backtesting Harness
```javascript
async function backtestStrategy(historicalData) {
  let totalProfit = 0;
  let successfulTrades = 0;
  
  for (const opportunity of historicalData) {
    const estimatedProfit = profitEstimator(
      opportunity.priceDelta,
      opportunity.gasEstimate,
      opportunity.loanFee
    );
    
    if (estimatedProfit > 0) {
      totalProfit += estimatedProfit;
      successfulTrades++;
    }
  }
  
  return { totalProfit, successRate: successfulTrades / historicalData.length };
}
```

#### 5. Telemetry and Monitoring
```javascript
const metrics = {
  opportunitiesFound: 0,
  tradesExecuted: 0,
  reverts: 0,
  totalGasUsed: 0,
  totalProfit: 0,
  successRate: 0
};

function trackOpportunity(opportunity) {
  metrics.opportunitiesFound++;
  logger.info('Opportunity detected', { 
    priceDelta: opportunity.priceDelta,
    estimatedProfit: opportunity.estimatedProfit 
  });
}
```

## Implementation Phases

### Phase 0: House-Cleaning (Day 1)
1. **Integrate CoinGecko MCP** (already working)
2. **Add feature flags** for all MCP calls
3. **Implement --simulate mode** for gasless backtesting
4. **Remove non-functional MCP references**

### Phase 1: Same-Chain MVP (Week 1-2)
1. **Target 3 stable pools** with ≥$10M volume
2. **Implement Aave + Venus flash loans**
3. **Deploy profit estimator** with 0.25% threshold
4. **Add basic telemetry**
5. **Goal**: First profitable trade executed

### Phase 2: Gas Optimization (Week 3-4)
1. **Flashbots integration** for MEV protection
2. **RPC optimization** and caching
3. **Failed transaction reduction** (35% improvement)
4. **Enhanced monitoring** and alerting
5. **Goal**: $500+ monthly profit achieved

### Phase 3: Cross-Chain Expansion (Month 2)
1. **Node.js upgrade** to enable Web3-MCP
2. **Bridge cost analysis** via Rubic integration
3. **Pre-funded inventory** on 2 chains
4. **Risk management** and circuit breakers
5. **Goal**: $1,000+ monthly profit

### Phase 4: Advanced Optimization (Month 3+)
1. **Paid data feeds** (CoinGecko Analyst)
2. **WebSocket price streams** (70ms latency reduction)
3. **Machine learning optimization**
4. **Private order flow** integration
5. **Goal**: $3,000+ monthly profit

## Risk Management Requirements

### CRITICAL: Technical Limitations We Accept
- **Cross-chain atomicity**: IMPOSSIBLE (bridge latency 45-242 seconds)
- **"Near-zero risk"**: MISLEADING (bridges lost $2.8B to hacks)
- **MEV competition**: Sophisticated bots capture most opportunities
- **Rate limiting**: Free APIs have strict limits (30 req/min)

### Risk Mitigation Strategies
- **Same-chain focus**: Avoid bridge risks initially
- **Circuit breakers**: Stop trading on consecutive failures
- **Gas budgets**: Daily limits to prevent excessive losses
- **Profit thresholds**: Only execute trades above 0.25% margin
- **Gradual scaling**: Reinvest profits incrementally

### Exit Conditions
- **3 consecutive days of losses**: Pause and analyze
- **API rate limit violations**: Upgrade to paid tiers
- **Smart contract failures**: Emergency shutdown
- **Regulatory concerns**: Compliance review

## Code Generation Requirements

### Must Include:
- **Feature flags** for all MCP integrations
- **Profit validation** before every trade execution
- **Comprehensive error handling** with circuit breakers
- **Telemetry tracking** for all key metrics
- **Backtesting framework** for strategy validation
- **Gas estimation** with safety margins
- **Rate limiting** for API calls
- **Graceful degradation** when MCP servers fail

### Code Style:
- **ES6+ modern JavaScript** with async/await
- **Modular architecture** with clear separation
- **Configuration-driven** approach with .env files
- **Test-driven development** with Jest
- **Production-ready** error handling and logging

### Security Requirements:
- **Private key management** via environment variables
- **API key protection** and rotation
- **Input validation** for all parameters
- **Safe math operations** to prevent overflow
- **Network security** for RPC calls

## Expected Outcomes

### Financial Performance (Realistic):
- **Month 1**: $400-1,200 (same-chain arbitrage)
- **Month 2**: $800-2,500 (gas optimization)
- **Month 3**: $1,000-3,000 (cross-chain inventory)
- **Month 6**: $3,000-10,000 (advanced optimization)

### Technical Achievement:
- **Working arbitrage bot** with actual profit generation
- **Progressive MCP integration** based on proven ROI
- **Risk-managed scaling** with realistic expectations
- **Sustainable codebase** for long-term operation

Generate complete, production-ready code that starts simple with CoinGecko MCP integration and scales progressively based on actual profit generation and infrastructure improvements.