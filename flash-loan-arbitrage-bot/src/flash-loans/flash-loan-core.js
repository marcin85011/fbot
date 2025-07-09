/**
 * Flash Loan Core Infrastructure
 * Handles flash loan execution across multiple protocols
 * Venus Protocol (BSC), Aave V3 (Polygon), Compound (Ethereum)
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';
import { getChainConfig } from '../config/chains.js';
import { getFlashLoanProvider } from '../config/flash-loan-providers.js';
import { EventEmitter } from 'events';

class FlashLoanCore extends EventEmitter {
    constructor(mcpCoordinator) {
        super();
        this.mcpCoordinator = mcpCoordinator;
        this.providers = new Map();
        this.executionStats = {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            totalProfit: 0,
            totalFees: 0
        };
    }

    /**
     * Initialize flash loan providers for all supported chains
     */
    async initialize() {
        logger.info('🚀 Initializing Flash Loan Core Infrastructure');
        
        const chains = ['bsc', 'polygon', 'ethereum'];
        
        for (const chain of chains) {
            try {
                const provider = await this.initializeProvider(chain);
                this.providers.set(chain, provider);
                logger.info(`✅ ${chain} flash loan provider initialized`);
            } catch (error) {
                logger.error(`❌ Failed to initialize ${chain} flash loan provider:`, error);
            }
        }
        
        logger.info(`🎯 Flash Loan Core initialized with ${this.providers.size} providers`);
    }

    /**
     * Initialize provider for specific chain
     */
    async initializeProvider(chain) {
        const chainConfig = getChainConfig(chain);
        const providerConfig = getFlashLoanProvider(chain);
        
        if (!chainConfig || !providerConfig) {
            throw new Error(`Configuration not found for chain: ${chain}`);
        }

        // Initialize Web3 provider
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
        
        // Initialize contract interfaces
        const flashLoanContract = new ethers.Contract(
            providerConfig.contractAddress,
            providerConfig.abi,
            provider
        );

        return {
            chain,
            provider,
            contract: flashLoanContract,
            config: providerConfig,
            chainConfig
        };
    }

    /**
     * Execute flash loan arbitrage
     */
    async executeFlashLoan(opportunity) {
        const executionId = `FL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        logger.info(`🔄 Executing flash loan arbitrage [${executionId}]`, {
            token: opportunity.token,
            chain: opportunity.chain,
            profitability: opportunity.profitability,
            amount: opportunity.amount
        });

        try {
            // Pre-execution validation
            await this.validateOpportunity(opportunity);
            
            // Get optimal provider
            const provider = await this.getOptimalProvider(opportunity);
            
            // Execute atomic transaction
            const result = await this.executeAtomicTransaction(
                provider,
                opportunity,
                executionId
            );
            
            this.updateStats(result);
            this.emit('flashLoanExecuted', result);
            
            return result;
            
        } catch (error) {
            logger.error(`💥 Flash loan execution failed [${executionId}]:`, error);
            this.executionStats.failedExecutions++;
            this.emit('flashLoanFailed', { executionId, error, opportunity });
            throw error;
        }
    }

    /**
     * Validate arbitrage opportunity before execution
     */
    async validateOpportunity(opportunity) {
        // Check minimum profitability threshold
        if (opportunity.profitability < 0.5) {
            throw new Error('Opportunity below minimum profitability threshold');
        }

        // Check liquidity availability
        if (opportunity.liquidity < opportunity.amount * 1.5) {
            throw new Error('Insufficient liquidity for arbitrage amount');
        }

        // Check gas costs
        const gasCost = await this.estimateGasCost(opportunity.chain, opportunity.amount);
        if (gasCost > opportunity.expectedProfit * 0.3) {
            throw new Error('Gas costs too high relative to expected profit');
        }

        // Validate with MCP coordinator
        if (this.mcpCoordinator) {
            const bridgeCosts = await this.mcpCoordinator.getBridgeCosts(
                opportunity.chain,
                opportunity.targetChain || opportunity.chain,
                opportunity.token,
                opportunity.amount
            );
            
            if (bridgeCosts.totalCost > opportunity.expectedProfit * 0.5) {
                throw new Error('Bridge costs too high for cross-chain arbitrage');
            }
        }

        logger.info('✅ Opportunity validation passed');
    }

    /**
     * Get optimal flash loan provider
     */
    async getOptimalProvider(opportunity) {
        const chain = opportunity.chain;
        const provider = this.providers.get(chain);
        
        if (!provider) {
            throw new Error(`No flash loan provider available for chain: ${chain}`);
        }

        // Check provider health and capacity
        const healthCheck = await this.checkProviderHealth(provider);
        if (!healthCheck.healthy) {
            throw new Error(`Provider unhealthy: ${healthCheck.reason}`);
        }

        return provider;
    }

    /**
     * Execute atomic flash loan transaction
     */
    async executeAtomicTransaction(provider, opportunity, executionId) {
        const startTime = Date.now();
        
        try {
            // Prepare transaction parameters
            const txParams = await this.prepareTxParams(provider, opportunity);
            
            // Execute flash loan
            const tx = await this.submitTransaction(provider, txParams);
            
            // Wait for confirmation
            const receipt = await tx.wait();
            
            // Analyze results
            const result = await this.analyzeTransactionResult(
                receipt,
                opportunity,
                executionId,
                startTime
            );
            
            logger.info(`✅ Flash loan executed successfully [${executionId}]`, {
                profit: result.profit,
                gasUsed: result.gasUsed,
                executionTime: result.executionTime
            });
            
            return result;
            
        } catch (error) {
            logger.error(`💥 Atomic transaction failed [${executionId}]:`, error);
            throw error;
        }
    }

    /**
     * Prepare transaction parameters
     */
    async prepareTxParams(provider, opportunity) {
        const { config, chainConfig } = provider;
        
        // Calculate flash loan amount (including fees)
        const flashLoanAmount = ethers.parseUnits(
            opportunity.amount.toString(),
            opportunity.decimals || 18
        );
        
        const flashLoanFee = flashLoanAmount * BigInt(config.feeRate) / BigInt(10000);
        
        // Prepare callback data for arbitrage execution
        const callbackData = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'uint256', 'uint256', 'bytes'],
            [
                opportunity.sourcePool,
                opportunity.targetPool,
                flashLoanAmount,
                opportunity.minProfit,
                '0x' // Additional data if needed
            ]
        );

        return {
            asset: opportunity.tokenAddress,
            amount: flashLoanAmount,
            fee: flashLoanFee,
            callbackData,
            gasLimit: config.gasLimit,
            gasPrice: await this.getOptimalGasPrice(chainConfig)
        };
    }

    /**
     * Submit transaction to blockchain
     */
    async submitTransaction(provider, txParams) {
        const { contract, config } = provider;
        
        // Get wallet (in production, use secure key management)
        const wallet = new ethers.Wallet(
            process.env.PRIVATE_KEY || '0x' + '0'.repeat(64), // Placeholder
            provider.provider
        );
        
        const contractWithSigner = contract.connect(wallet);
        
        // Execute flash loan based on provider type
        if (config.protocol === 'venus') {
            return await contractWithSigner.flashLoan(
                txParams.asset,
                txParams.amount,
                txParams.callbackData,
                {
                    gasLimit: txParams.gasLimit,
                    gasPrice: txParams.gasPrice
                }
            );
        } else if (config.protocol === 'aave') {
            return await contractWithSigner.flashLoan(
                [txParams.asset],
                [txParams.amount],
                [0], // Interest rate mode (0 for no open debt)
                wallet.address,
                txParams.callbackData,
                0, // Referral code
                {
                    gasLimit: txParams.gasLimit,
                    gasPrice: txParams.gasPrice
                }
            );
        } else {
            throw new Error(`Unsupported protocol: ${config.protocol}`);
        }
    }

    /**
     * Analyze transaction result
     */
    async analyzeTransactionResult(receipt, opportunity, executionId, startTime) {
        const executionTime = Date.now() - startTime;
        
        // Parse logs for profit/loss information
        const logs = receipt.logs;
        let profit = 0;
        let actualFees = 0;
        
        // Extract profit from logs (implementation depends on contract events)
        for (const log of logs) {
            try {
                // This would need to be implemented based on actual contract events
                // For now, we'll calculate based on opportunity data
                profit = opportunity.expectedProfit;
                actualFees = opportunity.amount * opportunity.feeRate;
                break;
            } catch (error) {
                // Continue to next log
            }
        }
        
        const netProfit = profit - actualFees;
        
        return {
            executionId,
            success: receipt.status === 1,
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            gasPrice: receipt.gasPrice?.toString(),
            profit: netProfit,
            fees: actualFees,
            executionTime,
            opportunity
        };
    }

    /**
     * Get optimal gas price
     */
    async getOptimalGasPrice(chainConfig) {
        try {
            const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
            const feeData = await provider.getFeeData();
            
            // Use fast gas price for arbitrage
            return feeData.gasPrice * BigInt(110) / BigInt(100); // 10% premium
        } catch (error) {
            logger.error('Failed to get gas price:', error);
            return ethers.parseUnits('20', 'gwei'); // Fallback
        }
    }

    /**
     * Estimate gas cost for transaction
     */
    async estimateGasCost(chain, amount) {
        const provider = this.providers.get(chain);
        if (!provider) return 0;
        
        try {
            const gasPrice = await this.getOptimalGasPrice(provider.chainConfig);
            const gasLimit = provider.config.gasLimit;
            
            return Number(gasPrice * BigInt(gasLimit)) / 1e18; // Convert to native token
        } catch (error) {
            logger.error('Gas cost estimation failed:', error);
            return 0.01; // Conservative estimate
        }
    }

    /**
     * Check provider health
     */
    async checkProviderHealth(provider) {
        try {
            const blockNumber = await provider.provider.getBlockNumber();
            const balance = await provider.provider.getBalance(provider.config.contractAddress);
            
            return {
                healthy: true,
                blockNumber,
                balance: balance.toString(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                reason: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Update execution statistics
     */
    updateStats(result) {
        this.executionStats.totalExecutions++;
        
        if (result.success) {
            this.executionStats.successfulExecutions++;
            this.executionStats.totalProfit += result.profit;
        } else {
            this.executionStats.failedExecutions++;
        }
        
        this.executionStats.totalFees += result.fees;
    }

    /**
     * Get execution statistics
     */
    getStats() {
        return {
            ...this.executionStats,
            successRate: this.executionStats.totalExecutions > 0 
                ? (this.executionStats.successfulExecutions / this.executionStats.totalExecutions * 100).toFixed(2)
                : 0,
            averageProfit: this.executionStats.successfulExecutions > 0
                ? (this.executionStats.totalProfit / this.executionStats.successfulExecutions).toFixed(4)
                : 0,
            netProfit: this.executionStats.totalProfit - this.executionStats.totalFees
        };
    }

    /**
     * Get available providers
     */
    getAvailableProviders() {
        return Array.from(this.providers.keys());
    }

    /**
     * Shutdown flash loan core
     */
    async shutdown() {
        logger.info('🛑 Shutting down Flash Loan Core');
        
        this.providers.clear();
        this.removeAllListeners();
        
        logger.info('✅ Flash Loan Core shutdown complete');
    }
}

export { FlashLoanCore };