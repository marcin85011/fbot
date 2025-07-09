import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

/**
 * Profit Estimator - Core mathematical model for arbitrage profitability
 * Implements the formula: (Δprice - gas - loan_fee) / volume > 0.25%
 * 
 * This is the heart of Phase 1 - determines if an arbitrage opportunity is profitable
 */
export class ProfitEstimator {
  constructor(config = {}) {
    this.config = {
      minProfitThreshold: 0.0025, // 0.25% minimum profit threshold
      maxGasPriceGwei: 50, // Maximum gas price in Gwei
      maxSlippage: 0.001, // 0.1% maximum slippage
      reserveBuffer: 0.1, // 10% reserve buffer for safety
      ...config
    };
    
    // Gas estimates for different operations (in gas units)
    this.gasEstimates = {
      flashLoanRequest: 150000,
      dexSwap: 200000,
      flashLoanRepay: 100000,
      totalBuffer: 50000 // Extra buffer for safety
    };
    
    // Flash loan fees (in basis points)
    this.flashLoanFees = {
      venus: 9, // 0.09% fee
      aave: 9,  // 0.09% fee
      compound: 0 // No fee for flash loans
    };
    
    // DEX fees (in basis points)
    this.dexFees = {
      pancakeswap: 25, // 0.25% fee
      biswap: 10,      // 0.10% fee
      quickswap: 30,   // 0.30% fee
      sushiswap: 30,   // 0.30% fee
      uniswap: 30,     // 0.30% fee
      'uniswap-v3': 5, // 0.05% fee (0.05% tier)
      curve: 4         // 0.04% fee
    };
    
    this.logger = logger.child({ component: 'ProfitEstimator' });
  }

  /**
   * Core profit estimation function
   * @param {Object} opportunity - Arbitrage opportunity data
   * @param {number} opportunity.priceDelta - Price difference between exchanges
   * @param {number} opportunity.volume - Trade volume
   * @param {number} opportunity.gasPrice - Current gas price in Gwei
   * @param {string} opportunity.flashLoanProvider - Flash loan provider
   * @param {string} opportunity.dexA - Source DEX
   * @param {string} opportunity.dexB - Target DEX
   * @param {number} opportunity.liquidityA - Liquidity on source DEX
   * @param {number} opportunity.liquidityB - Liquidity on target DEX
   * @returns {Object} Profit estimation result
   */
  estimateProfit(opportunity) {
    try {
      // Input validation
      if (!this.validateOpportunity(opportunity)) {
        return { profitable: false, reason: 'Invalid opportunity data' };
      }

      // Calculate base profit from price difference
      const baseProfit = this.calculateBaseProfit(opportunity);
      
      // Calculate all costs
      const costs = this.calculateCosts(opportunity);
      
      // Calculate net profit
      const netProfit = baseProfit - costs.total;
      const netProfitPercent = netProfit / opportunity.volume;
      
      // Check profitability threshold
      const profitable = netProfitPercent >= this.config.minProfitThreshold;
      
      // Calculate slippage impact
      const slippageImpact = this.calculateSlippageImpact(opportunity);
      
      // Adjust for slippage
      const adjustedNetProfit = netProfit - slippageImpact;
      const adjustedProfitPercent = adjustedNetProfit / opportunity.volume;
      
      // Final profitability check
      const finalProfitable = adjustedProfitPercent >= this.config.minProfitThreshold;
      
      const result = {
        profitable: finalProfitable,
        baseProfit,
        costs: costs.breakdown,
        totalCosts: costs.total,
        netProfit: adjustedNetProfit,
        profitPercent: adjustedProfitPercent,
        slippageImpact,
        threshold: this.config.minProfitThreshold,
        confidence: this.calculateConfidence(opportunity),
        recommendation: this.getRecommendation(adjustedProfitPercent),
        metadata: {
          timestamp: Date.now(),
          opportunity: opportunity.id || 'unknown',
          chain: opportunity.chain || 'unknown'
        }
      };
      
      this.logger.debug('Profit estimation completed', {
        profitable: finalProfitable,
        netProfit: adjustedNetProfit,
        profitPercent: adjustedProfitPercent,
        volume: opportunity.volume
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Error in profit estimation', { error: error.message });
      return { 
        profitable: false, 
        reason: 'Calculation error',
        error: error.message 
      };
    }
  }

  /**
   * Validate opportunity data
   */
  validateOpportunity(opportunity) {
    const required = ['priceDelta', 'volume', 'gasPrice', 'flashLoanProvider', 'dexA', 'dexB'];
    
    for (const field of required) {
      if (opportunity[field] === undefined || opportunity[field] === null) {
        this.logger.warn(`Missing required field: ${field}`);
        return false;
      }
    }
    
    // Validate numeric fields
    if (opportunity.priceDelta <= 0 || opportunity.volume <= 0 || opportunity.gasPrice <= 0) {
      this.logger.warn('Invalid numeric values in opportunity');
      return false;
    }
    
    // Validate providers
    if (!this.flashLoanFees[opportunity.flashLoanProvider]) {
      this.logger.warn(`Unknown flash loan provider: ${opportunity.flashLoanProvider}`);
      return false;
    }
    
    if (!this.dexFees[opportunity.dexA] || !this.dexFees[opportunity.dexB]) {
      this.logger.warn(`Unknown DEX in opportunity: ${opportunity.dexA} or ${opportunity.dexB}`);
      return false;
    }
    
    return true;
  }

  /**
   * Calculate base profit from price difference
   */
  calculateBaseProfit(opportunity) {
    // Base profit = price difference * volume
    return opportunity.priceDelta * opportunity.volume;
  }

  /**
   * Calculate all costs involved in the arbitrage
   */
  calculateCosts(opportunity) {
    // Gas costs
    const totalGasUnits = this.gasEstimates.flashLoanRequest + 
                         this.gasEstimates.dexSwap + 
                         this.gasEstimates.flashLoanRepay + 
                         this.gasEstimates.totalBuffer;
    
    const gasPrice = ethers.parseUnits(opportunity.gasPrice.toString(), 'gwei');
    const gasCostWei = BigInt(totalGasUnits) * gasPrice;
    const gasCostEth = Number(ethers.formatEther(gasCostWei));
    
    // Convert gas cost to USD (assuming ETH price, should be passed in opportunity)
    const ethPriceUsd = opportunity.ethPriceUsd || 2000; // Default fallback
    const gasCostUsd = gasCostEth * ethPriceUsd;
    
    // Flash loan fees
    const flashLoanFee = (opportunity.volume * this.flashLoanFees[opportunity.flashLoanProvider]) / 10000;
    
    // DEX fees (for both swaps)
    const dexFeeA = (opportunity.volume * this.dexFees[opportunity.dexA]) / 10000;
    const dexFeeB = (opportunity.volume * this.dexFees[opportunity.dexB]) / 10000;
    
    // Reserve buffer
    const reserveBuffer = opportunity.volume * this.config.reserveBuffer;
    
    const breakdown = {
      gasCost: gasCostUsd,
      flashLoanFee,
      dexFeeA,
      dexFeeB,
      reserveBuffer
    };
    
    const total = gasCostUsd + flashLoanFee + dexFeeA + dexFeeB + reserveBuffer;
    
    return { breakdown, total };
  }

  /**
   * Calculate slippage impact based on liquidity
   */
  calculateSlippageImpact(opportunity) {
    // Simple slippage model: impact = (volume / liquidity) * slippage_factor
    const liquidityA = opportunity.liquidityA || 1000000; // Default 1M liquidity
    const liquidityB = opportunity.liquidityB || 1000000;
    
    const slippageA = (opportunity.volume / liquidityA) * 0.5; // 50% slippage factor
    const slippageB = (opportunity.volume / liquidityB) * 0.5;
    
    const totalSlippage = Math.min(slippageA + slippageB, this.config.maxSlippage);
    
    return totalSlippage * opportunity.volume;
  }

  /**
   * Calculate confidence score based on opportunity characteristics
   */
  calculateConfidence(opportunity) {
    let confidence = 1.0;
    
    // Reduce confidence for high gas prices
    if (opportunity.gasPrice > this.config.maxGasPriceGwei) {
      confidence *= 0.8;
    }
    
    // Reduce confidence for low liquidity
    const minLiquidity = Math.min(opportunity.liquidityA || 1000000, opportunity.liquidityB || 1000000);
    if (minLiquidity < opportunity.volume * 10) {
      confidence *= 0.6;
    }
    
    // Reduce confidence for very small profit margins
    const margin = opportunity.priceDelta / opportunity.volume;
    if (margin < 0.005) { // Less than 0.5%
      confidence *= 0.7;
    }
    
    return Math.max(confidence, 0.1); // Minimum 10% confidence
  }

  /**
   * Get recommendation based on profit percentage
   */
  getRecommendation(profitPercent) {
    if (profitPercent >= 0.01) { // 1%+ profit
      return 'STRONG_BUY';
    } else if (profitPercent >= 0.005) { // 0.5%+ profit
      return 'BUY';
    } else if (profitPercent >= this.config.minProfitThreshold) { // Above threshold
      return 'WEAK_BUY';
    } else {
      return 'PASS';
    }
  }

  /**
   * Batch estimate profits for multiple opportunities
   */
  batchEstimate(opportunities) {
    const results = [];
    
    for (const opportunity of opportunities) {
      const result = this.estimateProfit(opportunity);
      results.push({
        id: opportunity.id,
        ...result
      });
    }
    
    // Sort by profit percentage (descending)
    results.sort((a, b) => (b.profitPercent || 0) - (a.profitPercent || 0));
    
    return results;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Profit estimator configuration updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      minProfitThreshold: this.config.minProfitThreshold,
      gasEstimates: this.gasEstimates,
      flashLoanFees: this.flashLoanFees,
      dexFees: this.dexFees,
      timestamp: Date.now()
    };
  }
}

export default ProfitEstimator;