/**
 * Abstract Flash Loan Provider Interface
 * Defines the standard interface for all flash loan providers
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

export class FlashLoanProvider extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.network = config.network;
        this.provider = null;
        this.isInitialized = false;
        this.metrics = {
            totalLoans: 0,
            successfulLoans: 0,
            failedLoans: 0,
            totalVolumeUSD: 0,
            averageGasCost: 0,
            lastExecutionTime: null
        };
    }

    /**
     * Initialize the flash loan provider
     * Must be implemented by subclasses
     */
    async initialize() {
        throw new Error('initialize() must be implemented by subclass');
    }

    /**
     * Execute a flash loan
     * @param {Object} params - Flash loan parameters
     * @param {string} params.token - Token address to borrow
     * @param {string} params.amount - Amount to borrow (in wei)
     * @param {Buffer} params.data - Encoded callback data
     * @returns {Promise<Object>} Transaction result
     */
    async executeFlashLoan(params) {
        throw new Error('executeFlashLoan() must be implemented by subclass');
    }

    /**
     * Calculate flash loan fee
     * @param {string} token - Token address
     * @param {string} amount - Amount to borrow
     * @returns {Promise<Object>} Fee information
     */
    async calculateFee(token, amount) {
        throw new Error('calculateFee() must be implemented by subclass');
    }

    /**
     * Check if flash loan is available for token
     * @param {string} token - Token address
     * @param {string} amount - Amount to borrow
     * @returns {Promise<boolean>} Availability status
     */
    async isAvailable(token, amount) {
        throw new Error('isAvailable() must be implemented by subclass');
    }

    /**
     * Get maximum borrowable amount for token
     * @param {string} token - Token address
     * @returns {Promise<string>} Maximum amount in wei
     */
    async getMaxBorrowAmount(token) {
        throw new Error('getMaxBorrowAmount() must be implemented by subclass');
    }

    /**
     * Get provider-specific information
     * @returns {Object} Provider info
     */
    getProviderInfo() {
        return {
            name: this.constructor.name,
            network: this.network,
            feeRate: this.config.feeRate,
            supportedTokens: this.config.supportedTokens || [],
            maxBorrowLimit: this.config.maxBorrowLimit || 'unlimited',
            features: this.getFeatures()
        };
    }

    /**
     * Get provider features
     * @returns {Array} List of features
     */
    getFeatures() {
        return [
            'flash_loans',
            'multiple_tokens',
            'atomic_execution'
        ];
    }

    /**
     * Update metrics after flash loan execution
     * @param {Object} result - Execution result
     * @param {boolean} success - Success status
     * @param {string} volumeUSD - Volume in USD
     * @param {string} gasCost - Gas cost in ETH
     */
    updateMetrics(result, success, volumeUSD, gasCost) {
        this.metrics.totalLoans++;
        
        if (success) {
            this.metrics.successfulLoans++;
        } else {
            this.metrics.failedLoans++;
        }
        
        this.metrics.totalVolumeUSD += parseFloat(volumeUSD || 0);
        
        // Update average gas cost with rolling average
        const alpha = 0.1;
        const newGasCost = parseFloat(gasCost || 0);
        this.metrics.averageGasCost = 
            (alpha * newGasCost) + ((1 - alpha) * this.metrics.averageGasCost);
        
        this.metrics.lastExecutionTime = Date.now();
        
        // Emit metrics update event
        this.emit('metricsUpdated', this.metrics);
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            successRate: this.metrics.totalLoans > 0 ? 
                (this.metrics.successfulLoans / this.metrics.totalLoans * 100).toFixed(2) : 0,
            avgVolumePerLoan: this.metrics.successfulLoans > 0 ? 
                (this.metrics.totalVolumeUSD / this.metrics.successfulLoans).toFixed(2) : 0
        };
    }

    /**
     * Validate flash loan parameters
     * @param {Object} params - Parameters to validate
     * @returns {boolean} Validation result
     */
    validateParams(params) {
        if (!params.token || !params.amount) {
            throw new Error('Token and amount are required');
        }
        
        if (!params.data || !Buffer.isBuffer(params.data)) {
            throw new Error('Valid callback data buffer is required');
        }
        
        return true;
    }

    /**
     * Health check for the provider
     * @returns {Promise<boolean>} Health status
     */
    async healthCheck() {
        try {
            if (!this.isInitialized) {
                return false;
            }
            
            // Check if provider is connected
            if (!this.provider) {
                return false;
            }
            
            // Provider-specific health checks should be implemented in subclasses
            return await this.performHealthCheck();
            
        } catch (error) {
            logger.error(`Health check failed for ${this.constructor.name}:`, error);
            return false;
        }
    }

    /**
     * Provider-specific health check
     * Override in subclasses
     * @returns {Promise<boolean>} Health status
     */
    async performHealthCheck() {
        return true;
    }

    /**
     * Get supported tokens for flash loans
     * @returns {Promise<Array>} List of supported token addresses
     */
    async getSupportedTokens() {
        return this.config.supportedTokens || [];
    }

    /**
     * Format amount for display
     * @param {string} amount - Amount in wei
     * @param {number} decimals - Token decimals
     * @returns {string} Formatted amount
     */
    formatAmount(amount, decimals = 18) {
        return (BigInt(amount) / BigInt(10 ** decimals)).toString();
    }

    /**
     * Convert amount to wei
     * @param {string} amount - Amount in human readable format
     * @param {number} decimals - Token decimals
     * @returns {string} Amount in wei
     */
    toWei(amount, decimals = 18) {
        return (BigInt(Math.floor(parseFloat(amount) * (10 ** decimals)))).toString();
    }

    /**
     * Shutdown the provider
     */
    async shutdown() {
        logger.info(`Shutting down ${this.constructor.name} provider`);
        
        this.isInitialized = false;
        this.provider = null;
        this.removeAllListeners();
        
        // Provider-specific cleanup
        await this.performShutdown();
    }

    /**
     * Provider-specific shutdown
     * Override in subclasses
     */
    async performShutdown() {
        // Default implementation does nothing
    }
}

export default FlashLoanProvider;