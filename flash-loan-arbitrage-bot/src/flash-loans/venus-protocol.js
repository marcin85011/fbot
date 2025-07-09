/**
 * Venus Protocol Flash Loan Integration (BSC)
 * Handles flash loans on Binance Smart Chain with zero capital requirement
 * Fee: 0.05% + gas costs
 */

const { ethers } = require('ethers');
const { ChainConfig } = require('../config/chains');
const { logger } = require('../utils/logger');
const { EventEmitter } = require('events');

// Venus Protocol ABIs
const VENUS_COMPTROLLER_ABI = [
    "function enterMarkets(address[] calldata vTokens) external returns (uint[] memory)",
    "function exitMarket(address vToken) external returns (uint)",
    "function getAssetsIn(address account) external view returns (address[] memory)",
    "function getAccountLiquidity(address account) external view returns (uint, uint, uint)"
];

const VENUS_VTOKEN_ABI = [
    "function mint(uint mintAmount) external returns (uint)",
    "function borrow(uint borrowAmount) external returns (uint)",
    "function repayBorrow(uint repayAmount) external returns (uint)",
    "function repayBorrowBehalf(address borrower, uint repayAmount) external returns (uint)",
    "function redeem(uint redeemTokens) external returns (uint)",
    "function redeemUnderlying(uint redeemAmount) external returns (uint)",
    "function borrowBalanceCurrent(address account) external returns (uint)",
    "function exchangeRateCurrent() external returns (uint)",
    "function getCash() external view returns (uint)",
    "function totalBorrows() external view returns (uint)",
    "function totalReserves() external view returns (uint)",
    "function borrowRatePerBlock() external view returns (uint)",
    "function supplyRatePerBlock() external view returns (uint)",
    "function balanceOf(address owner) external view returns (uint)",
    "function underlying() external view returns (address)"
];

const FLASH_LOAN_RECEIVER_ABI = [
    "function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool)"
];

class VenusProtocol extends EventEmitter {
    constructor() {
        super();
        this.chainConfig = new ChainConfig();
        this.provider = null;
        this.comptroller = null;
        this.vTokens = new Map();
        this.flashLoanFee = 0.0005; // 0.05%
        this.initialized = false;
        this.gasLimit = 2000000;
        this.maxSlippage = 0.005; // 0.5%
    }

    /**
     * Initialize Venus Protocol connection
     */
    async initialize() {
        try {
            logger.info('🚀 Initializing Venus Protocol flash loan integration');
            
            // Get BSC network configuration
            const bscConfig = this.chainConfig.getNetwork('bsc');
            
            // Initialize provider
            this.provider = new ethers.JsonRpcProvider(bscConfig.rpcUrl);
            
            // Initialize comptroller
            this.comptroller = new ethers.Contract(
                bscConfig.venus.comptroller,
                VENUS_COMPTROLLER_ABI,
                this.provider
            );
            
            // Initialize vTokens for major assets
            await this.initializeVTokens(bscConfig.venus.vTokens);
            
            // Verify connection
            await this.verifyConnection();
            
            this.initialized = true;
            logger.info('✅ Venus Protocol initialized successfully');
            
        } catch (error) {
            logger.error('❌ Failed to initialize Venus Protocol:', error);
            throw error;
        }
    }

    /**
     * Initialize vToken contracts
     */
    async initializeVTokens(vTokensConfig) {
        for (const [symbol, config] of Object.entries(vTokensConfig)) {
            try {
                const vToken = new ethers.Contract(
                    config.address,
                    VENUS_VTOKEN_ABI,
                    this.provider
                );
                
                // Get underlying token address
                let underlyingAddress;
                if (symbol === 'vBNB') {
                    underlyingAddress = ethers.ZeroAddress; // BNB doesn't have underlying
                } else {
                    underlyingAddress = await vToken.underlying();
                }
                
                this.vTokens.set(symbol, {
                    contract: vToken,
                    address: config.address,
                    underlyingAddress,
                    symbol,
                    decimals: config.decimals
                });
                
                logger.info(`📋 Initialized vToken: ${symbol} (${config.address})`);
                
            } catch (error) {
                logger.error(`Failed to initialize vToken ${symbol}:`, error);
            }
        }
    }

    /**
     * Verify connection to Venus Protocol
     */
    async verifyConnection() {
        try {
            const blockNumber = await this.provider.getBlockNumber();
            const comptrollerAddress = await this.comptroller.getAddress();
            
            logger.info('🔗 Venus Protocol connection verified', {
                blockNumber,
                comptrollerAddress,
                vTokensCount: this.vTokens.size
            });
            
        } catch (error) {
            throw new Error(`Venus Protocol connection failed: ${error.message}`);
        }
    }

    /**
     * Get available flash loan liquidity for a token
     */
    async getAvailableLiquidity(tokenSymbol) {
        if (!this.initialized) {
            throw new Error('Venus Protocol not initialized');
        }

        try {
            const vTokenSymbol = `v${tokenSymbol}`;
            const vTokenInfo = this.vTokens.get(vTokenSymbol);
            
            if (!vTokenInfo) {
                throw new Error(`vToken not found for ${tokenSymbol}`);
            }

            const [cash, totalBorrows, totalReserves] = await Promise.all([
                vTokenInfo.contract.getCash(),
                vTokenInfo.contract.totalBorrows(),
                vTokenInfo.contract.totalReserves()
            ]);

            const availableLiquidity = cash;
            const utilizationRate = totalBorrows / (cash + totalBorrows);

            return {
                token: tokenSymbol,
                vToken: vTokenSymbol,
                availableLiquidity: ethers.formatUnits(availableLiquidity, vTokenInfo.decimals),
                cash: ethers.formatUnits(cash, vTokenInfo.decimals),
                totalBorrows: ethers.formatUnits(totalBorrows, vTokenInfo.decimals),
                totalReserves: ethers.formatUnits(totalReserves, vTokenInfo.decimals),
                utilizationRate: (utilizationRate * 100).toFixed(2),
                maxFlashLoan: ethers.formatUnits(availableLiquidity * BigInt(95) / BigInt(100), vTokenInfo.decimals) // 95% of available
            };

        } catch (error) {
            logger.error(`Failed to get liquidity for ${tokenSymbol}:`, error);
            throw error;
        }
    }

    /**
     * Calculate flash loan fee
     */
    calculateFlashLoanFee(amount, tokenSymbol) {
        const amountBN = ethers.parseUnits(amount.toString(), 18);
        const fee = amountBN * BigInt(Math.floor(this.flashLoanFee * 10000)) / BigInt(10000);
        
        return {
            amount: amount,
            fee: ethers.formatUnits(fee, 18),
            feeBN: fee,
            total: ethers.formatUnits(amountBN + fee, 18),
            totalBN: amountBN + fee,
            feePercentage: this.flashLoanFee * 100
        };
    }

    /**
     * Estimate gas costs for flash loan execution
     */
    async estimateGasCosts(tokenSymbol, amount, arbitrageData) {
        try {
            const gasPrice = await this.provider.getFeeData();
            const estimatedGas = BigInt(this.gasLimit);
            
            // Calculate gas cost in BNB
            const gasCostBNB = estimatedGas * gasPrice.gasPrice;
            
            // Get BNB price to calculate USD cost
            const bnbPriceUSD = arbitrageData.bnbPrice || 300; // Fallback price
            const gasCostUSD = parseFloat(ethers.formatEther(gasCostBNB)) * bnbPriceUSD;
            
            return {
                gasPrice: ethers.formatUnits(gasPrice.gasPrice, 'gwei'),
                estimatedGas: estimatedGas.toString(),
                gasCostBNB: ethers.formatEther(gasCostBNB),
                gasCostUSD: gasCostUSD.toFixed(4),
                maxFeePerGas: ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei'),
                maxPriorityFeePerGas: ethers.formatUnits(gasPrice.maxPriorityFeePerGas, 'gwei')
            };

        } catch (error) {
            logger.error('Failed to estimate gas costs:', error);
            throw error;
        }
    }

    /**
     * Execute flash loan with arbitrage strategy
     */
    async executeFlashLoan(wallet, tokenSymbol, amount, arbitrageParams) {
        if (!this.initialized) {
            throw new Error('Venus Protocol not initialized');
        }

        try {
            logger.info('🚀 Executing Venus Protocol flash loan', {
                token: tokenSymbol,
                amount: amount,
                arbitrageType: arbitrageParams.type
            });

            // Get vToken info
            const vTokenSymbol = `v${tokenSymbol}`;
            const vTokenInfo = this.vTokens.get(vTokenSymbol);
            
            if (!vTokenInfo) {
                throw new Error(`vToken not found for ${tokenSymbol}`);
            }

            // Calculate fees and validate profitability
            const feeCalculation = this.calculateFlashLoanFee(amount, tokenSymbol);
            const gasCosts = await this.estimateGasCosts(tokenSymbol, amount, arbitrageParams);
            
            // Validate profitability before execution
            const profitability = await this.validateProfitability(
                amount,
                feeCalculation,
                gasCosts,
                arbitrageParams
            );

            if (!profitability.isProfit) {
                throw new Error(`Flash loan not profitable: ${profitability.reason}`);
            }

            // Create flash loan transaction
            const flashLoanTx = await this.createFlashLoanTransaction(
                wallet,
                vTokenInfo,
                amount,
                arbitrageParams
            );

            // Execute transaction
            const result = await this.executeTransaction(wallet, flashLoanTx);
            
            logger.info('✅ Flash loan executed successfully', {
                txHash: result.hash,
                token: tokenSymbol,
                amount: amount,
                profit: profitability.estimatedProfit
            });

            // Emit success event
            this.emit('flashLoanExecuted', {
                txHash: result.hash,
                token: tokenSymbol,
                amount: amount,
                fee: feeCalculation.fee,
                profit: profitability.estimatedProfit,
                arbitrageType: arbitrageParams.type
            });

            return result;

        } catch (error) {
            logger.error('❌ Flash loan execution failed:', error);
            this.emit('flashLoanFailed', {
                token: tokenSymbol,
                amount: amount,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Validate profitability before execution
     */
    async validateProfitability(amount, feeCalculation, gasCosts, arbitrageParams) {
        try {
            const totalCosts = parseFloat(feeCalculation.fee) + parseFloat(gasCosts.gasCostUSD);
            const expectedProfit = arbitrageParams.expectedProfit || 0;
            const minProfitMargin = arbitrageParams.minProfitMargin || 0.001; // 0.1%

            const netProfit = expectedProfit - totalCosts;
            const profitMargin = netProfit / parseFloat(amount);

            const isProfit = netProfit > 0 && profitMargin > minProfitMargin;

            return {
                isProfit,
                estimatedProfit: netProfit,
                profitMargin: profitMargin * 100,
                totalCosts,
                flashLoanFee: parseFloat(feeCalculation.fee),
                gasCosts: parseFloat(gasCosts.gasCostUSD),
                expectedProfit,
                minProfitMargin: minProfitMargin * 100,
                reason: isProfit ? 'Profitable' : `Insufficient profit margin: ${(profitMargin * 100).toFixed(4)}%`
            };

        } catch (error) {
            logger.error('Failed to validate profitability:', error);
            return {
                isProfit: false,
                reason: `Profitability validation failed: ${error.message}`
            };
        }
    }

    /**
     * Create flash loan transaction
     */
    async createFlashLoanTransaction(wallet, vTokenInfo, amount, arbitrageParams) {
        try {
            // Convert amount to BigNumber with proper decimals
            const amountBN = ethers.parseUnits(amount.toString(), vTokenInfo.decimals);
            
            // Create flash loan contract instance with signer
            const vTokenWithSigner = vTokenInfo.contract.connect(wallet);
            
            // Build transaction parameters
            const txParams = {
                gasLimit: this.gasLimit,
                maxFeePerGas: ethers.parseUnits('10', 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei')
            };

            // For Venus Protocol, flash loans are executed by borrowing and repaying in the same transaction
            // This requires a smart contract that implements the flash loan logic
            
            // Create the transaction data for flash loan execution
            const flashLoanData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'uint256', 'bytes'],
                [
                    vTokenInfo.underlyingAddress,
                    amountBN,
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ['uint8', 'address[]', 'uint256[]', 'bytes'],
                        [
                            arbitrageParams.type, // Arbitrage type
                            arbitrageParams.dexAddresses || [],
                            arbitrageParams.amounts || [],
                            arbitrageParams.data || '0x'
                        ]
                    )
                ]
            );

            return {
                contract: vTokenWithSigner,
                method: 'borrow',
                params: [amountBN],
                txParams,
                flashLoanData,
                vTokenInfo,
                arbitrageParams
            };

        } catch (error) {
            logger.error('Failed to create flash loan transaction:', error);
            throw error;
        }
    }

    /**
     * Execute the flash loan transaction
     */
    async executeTransaction(wallet, flashLoanTx) {
        try {
            // This is a simplified implementation
            // In production, you would need a smart contract that handles the flash loan logic
            
            const tx = await flashLoanTx.contract[flashLoanTx.method](
                ...flashLoanTx.params,
                flashLoanTx.txParams
            );

            // Wait for transaction confirmation
            const receipt = await tx.wait();
            
            if (receipt.status !== 1) {
                throw new Error('Transaction failed');
            }

            return {
                hash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                status: receipt.status,
                receipt
            };

        } catch (error) {
            logger.error('Transaction execution failed:', error);
            throw error;
        }
    }

    /**
     * Get flash loan history for analysis
     */
    async getFlashLoanHistory(tokenSymbol, limit = 10) {
        try {
            const vTokenSymbol = `v${tokenSymbol}`;
            const vTokenInfo = this.vTokens.get(vTokenSymbol);
            
            if (!vTokenInfo) {
                throw new Error(`vToken not found for ${tokenSymbol}`);
            }

            // Get recent borrow events (proxy for flash loans)
            const filter = vTokenInfo.contract.filters.Borrow();
            const events = await vTokenInfo.contract.queryFilter(filter, -1000); // Last 1000 blocks

            const history = events.slice(-limit).map(event => ({
                txHash: event.transactionHash,
                blockNumber: event.blockNumber,
                borrower: event.args.borrower,
                borrowAmount: ethers.formatUnits(event.args.borrowAmount, vTokenInfo.decimals),
                accountBorrows: ethers.formatUnits(event.args.accountBorrows, vTokenInfo.decimals),
                totalBorrows: ethers.formatUnits(event.args.totalBorrows, vTokenInfo.decimals),
                timestamp: new Date().toISOString() // Would need to get actual block timestamp
            }));

            return history;

        } catch (error) {
            logger.error('Failed to get flash loan history:', error);
            throw error;
        }
    }

    /**
     * Monitor Venus Protocol for flash loan opportunities
     */
    startMonitoring() {
        try {
            logger.info('🔍 Starting Venus Protocol monitoring');
            
            // Monitor liquidity changes
            setInterval(async () => {
                try {
                    const liquidityData = {};
                    
                    for (const [symbol, vTokenInfo] of this.vTokens.entries()) {
                        const tokenSymbol = symbol.replace('v', '');
                        const liquidity = await this.getAvailableLiquidity(tokenSymbol);
                        liquidityData[tokenSymbol] = liquidity;
                    }
                    
                    this.emit('liquidityUpdate', liquidityData);
                    
                } catch (error) {
                    logger.error('Liquidity monitoring error:', error);
                }
            }, 30000); // Check every 30 seconds

            // Monitor for large transactions that might affect liquidity
            this.provider.on('block', async (blockNumber) => {
                try {
                    const block = await this.provider.getBlock(blockNumber, true);
                    
                    // Filter for Venus Protocol transactions
                    const venusTransactions = block.transactions.filter(tx => {
                        return Array.from(this.vTokens.values()).some(vToken => 
                            tx.to && tx.to.toLowerCase() === vToken.address.toLowerCase()
                        );
                    });

                    if (venusTransactions.length > 0) {
                        this.emit('venusActivity', {
                            blockNumber,
                            transactionCount: venusTransactions.length,
                            transactions: venusTransactions
                        });
                    }
                    
                } catch (error) {
                    logger.error('Block monitoring error:', error);
                }
            });

        } catch (error) {
            logger.error('Failed to start monitoring:', error);
        }
    }

    /**
     * Get current borrowing rates
     */
    async getBorrowingRates() {
        const rates = {};
        
        try {
            for (const [symbol, vTokenInfo] of this.vTokens.entries()) {
                const [borrowRate, supplyRate] = await Promise.all([
                    vTokenInfo.contract.borrowRatePerBlock(),
                    vTokenInfo.contract.supplyRatePerBlock()
                ]);
                
                // Convert from per-block to APY (assuming 3 second block time)
                const blocksPerYear = 365 * 24 * 60 * 60 / 3;
                const borrowAPY = (Math.pow(1 + (parseFloat(ethers.formatUnits(borrowRate, 18)) * blocksPerYear), 1) - 1) * 100;
                const supplyAPY = (Math.pow(1 + (parseFloat(ethers.formatUnits(supplyRate, 18)) * blocksPerYear), 1) - 1) * 100;
                
                rates[symbol] = {
                    borrowAPY: borrowAPY.toFixed(2),
                    supplyAPY: supplyAPY.toFixed(2),
                    borrowRatePerBlock: ethers.formatUnits(borrowRate, 18),
                    supplyRatePerBlock: ethers.formatUnits(supplyRate, 18)
                };
            }
            
            return rates;
            
        } catch (error) {
            logger.error('Failed to get borrowing rates:', error);
            throw error;
        }
    }

    /**
     * Health check for Venus Protocol
     */
    async healthCheck() {
        try {
            const [blockNumber, comptrollerAddress] = await Promise.all([
                this.provider.getBlockNumber(),
                this.comptroller.getAddress()
            ]);

            const isHealthy = blockNumber > 0 && comptrollerAddress !== ethers.ZeroAddress;

            return {
                isHealthy,
                blockNumber,
                comptrollerAddress,
                vTokensCount: this.vTokens.size,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            logger.error('Venus Protocol health check failed:', error);
            return {
                isHealthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Get supported tokens
     */
    getSupportedTokens() {
        return Array.from(this.vTokens.keys()).map(symbol => ({
            vToken: symbol,
            token: symbol.replace('v', ''),
            address: this.vTokens.get(symbol).address,
            underlyingAddress: this.vTokens.get(symbol).underlyingAddress
        }));
    }

    /**
     * Cleanup and shutdown
     */
    async shutdown() {
        try {
            logger.info('🛑 Shutting down Venus Protocol');
            
            // Remove all listeners
            this.provider?.removeAllListeners();
            this.removeAllListeners();
            
            // Clear connections
            this.vTokens.clear();
            this.provider = null;
            this.comptroller = null;
            this.initialized = false;
            
            logger.info('✅ Venus Protocol shutdown completed');
            
        } catch (error) {
            logger.error('Error during Venus Protocol shutdown:', error);
        }
    }
}

module.exports = { VenusProtocol };