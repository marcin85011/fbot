import { ethers } from 'ethers';
import { logger } from './logger.js';

/**
 * DEX Price Checker - Validates CoinGecko prices against on-chain DEX prices
 */
export class DexPriceChecker {
  constructor() {
    this.logger = logger.child({ component: 'DexPriceChecker' });
    
    // BSC Configuration
    this.bscConfig = {
      rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      chainId: 56,
      pancakeswapRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      tokens: {
        USDT: '0x55d398326f99059fF775485246999027B3197955',
        USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        WETH: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        WBTC: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'
      }
    };
    
    // PancakeSwap Router ABI (minimal)
    this.routerABI = [
      'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
    ];
    
    this.provider = null;
    this.router = null;
  }

  /**
   * Initialize the price checker
   */
  async initialize() {
    try {
      this.logger.info('🔧 Initializing DEX price checker...');
      
      // Initialize BSC provider
      this.provider = new ethers.JsonRpcProvider(this.bscConfig.rpcUrl);
      
      // Initialize PancakeSwap router contract
      this.router = new ethers.Contract(
        this.bscConfig.pancakeswapRouter,
        this.routerABI,
        this.provider
      );
      
      // Test connection
      const blockNumber = await this.provider.getBlockNumber();
      this.logger.info('✅ DEX price checker initialized', {
        chain: 'BSC',
        blockNumber,
        router: this.bscConfig.pancakeswapRouter
      });
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize DEX price checker:', error);
      throw error;
    }
  }

  /**
   * Get DEX price for a token pair
   */
  async getDexPrice(tokenA, tokenB, amountIn = '1000000000000000000') {
    try {
      if (!this.router) {
        throw new Error('DEX price checker not initialized');
      }
      
      const tokenAAddress = this.bscConfig.tokens[tokenA];
      const tokenBAddress = this.bscConfig.tokens[tokenB];
      
      if (!tokenAAddress || !tokenBAddress) {
        throw new Error(`Token addresses not found for ${tokenA}/${tokenB}`);
      }
      
      // Get amounts out from PancakeSwap
      const path = [tokenAAddress, tokenBAddress];
      const amounts = await this.router.getAmountsOut(amountIn, path);
      
      // Calculate price (tokenB per tokenA)
      const amountOut = amounts[1];
      const price = parseFloat(ethers.formatEther(amountOut)) / parseFloat(ethers.formatEther(amountIn));
      
      this.logger.debug('📊 DEX price retrieved', {
        pair: `${tokenA}/${tokenB}`,
        price,
        amountIn: ethers.formatEther(amountIn),
        amountOut: ethers.formatEther(amountOut),
        dex: 'PancakeSwap'
      });
      
      return {
        price,
        amountIn,
        amountOut,
        dex: 'PancakeSwap',
        chain: 'BSC',
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('❌ Failed to get DEX price:', error, {
        pair: `${tokenA}/${tokenB}`
      });
      throw error;
    }
  }

  /**
   * Compare CoinGecko price with DEX price
   */
  async comparePrices(tokenA, tokenB, coingeckoPrice) {
    try {
      // Get DEX price
      const dexData = await this.getDexPrice(tokenA, tokenB);
      
      // Calculate price difference
      const priceDiff = Math.abs(coingeckoPrice - dexData.price);
      const avgPrice = (coingeckoPrice + dexData.price) / 2;
      const diffPercent = (priceDiff / avgPrice) * 100;
      
      const comparison = {
        pair: `${tokenA}/${tokenB}`,
        coingeckoPrice,
        dexPrice: dexData.price,
        priceDiff,
        diffPercent,
        avgPrice,
        dex: dexData.dex,
        chain: dexData.chain,
        timestamp: dexData.timestamp
      };
      
      // Log significant differences
      if (diffPercent > 0.25) {
        this.logger.warn('⚠️ Significant price difference detected', {
          ...comparison,
          threshold: '0.25%'
        });
      } else {
        this.logger.info('✅ Price difference within acceptable range', {
          ...comparison,
          threshold: '0.25%'
        });
      }
      
      return comparison;
      
    } catch (error) {
      this.logger.error('❌ Failed to compare prices:', error, {
        pair: `${tokenA}/${tokenB}`,
        coingeckoPrice
      });
      throw error;
    }
  }

  /**
   * Get multiple DEX prices for arbitrage analysis
   */
  async getMultipleDexPrices(pairs) {
    const results = [];
    
    for (const pair of pairs) {
      try {
        const dexData = await this.getDexPrice(pair.tokenA, pair.tokenB);
        results.push({
          pair: pair.symbol,
          ...dexData
        });
      } catch (error) {
        this.logger.error('❌ Failed to get DEX price for pair:', error, {
          pair: pair.symbol
        });
      }
    }
    
    return results;
  }

  /**
   * Health check - verify DEX connection and data
   */
  async healthCheck() {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      const ethPrice = await this.getDexPrice('WETH', 'USDT');
      
      return {
        healthy: true,
        blockNumber,
        ethPrice: ethPrice.price,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('❌ DEX health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export default DexPriceChecker;