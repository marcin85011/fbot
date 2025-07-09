import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';
import { getChainConfig } from '../config/chains.js';

/**
 * Venus Flash Loan Manager for BSC
 * Handles flash loan operations on Venus Protocol
 */
export class VenusFlashLoan {
    constructor(signer) {
        this.signer = signer;
        this.chainConfig = getChainConfig('bsc');
        this.flashLoanProvider = this.chainConfig.flashLoanProviders.venus;
        this.provider = signer.provider;
        this.contract = null;
        this.initialized = false;
    }

    /**
     * Initialize Venus flash loan contract
     */
    async initialize() {
        try {
            // Venus Flash Loan Contract ABI (simplified)
            const abi = [
                "function flashLoan(address receiver, address asset, uint256 amount, bytes calldata params) external",
                "function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool)",
                "function getFlashLoanPremium() external view returns (uint256)"
            ];

            this.contract = new ethers.Contract(
                this.flashLoanProvider.contract,
                abi,
                this.signer
            );

            // Verify contract is accessible
            const premium = await this.contract.getFlashLoanPremium();
            logger.info(`Venus Flash Loan initialized - Premium: ${premium}%`, { 
                category: 'flash-loan' 
            });

            this.initialized = true;
            return true;

        } catch (error) {
            logger.error('Failed to initialize Venus Flash Loan', { 
                category: 'flash-loan',
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Execute flash loan on Venus Protocol
     */
    async executeFlashLoan(tokenAddress, amount, calldata) {
        if (!this.initialized) {
            throw new Error('Venus Flash Loan not initialized');
        }

        try {
            logger.info('Executing Venus flash loan', { 
                category: 'flash-loan',
                token: tokenAddress,
                amount: amount.toString(),
                chain: 'bsc'
            });

            // Estimate gas for flash loan
            const gasEstimate = await this.contract.estimateGas.flashLoan(
                this.signer.address, // receiver (this contract)
                tokenAddress,
                amount,
                calldata
            );

            const gasPrice = await this.provider.getGasPrice();
            const gasLimit = gasEstimate.mul(120).div(100); // 20% buffer

            // Execute flash loan transaction
            const tx = await this.contract.flashLoan(
                this.signer.address,
                tokenAddress,
                amount,
                calldata,
                {
                    gasLimit,
                    gasPrice: gasPrice.mul(110).div(100) // 10% gas price buffer
                }
            );

            logger.info('Venus flash loan transaction sent', { 
                category: 'flash-loan',
                txHash: tx.hash,
                gasUsed: gasLimit.toString(),
                gasPrice: gasPrice.toString()
            });

            // Wait for transaction confirmation
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                logger.info('Venus flash loan executed successfully', { 
                    category: 'flash-loan',
                    txHash: receipt.transactionHash,
                    gasUsed: receipt.gasUsed.toString(),
                    blockNumber: receipt.blockNumber
                });
                return { success: true, receipt };
            } else {
                throw new Error('Transaction failed');
            }

        } catch (error) {
            logger.error('Venus flash loan execution failed', { 
                category: 'flash-loan',
                error: error.message,
                token: tokenAddress,
                amount: amount.toString()
            });
            throw error;
        }
    }

    /**
     * Calculate flash loan fee
     */
    calculateFlashLoanFee(amount) {
        const feePercentage = this.flashLoanProvider.fee; // 0.05% for Venus
        return amount.mul(feePercentage * 100).div(10000);
    }

    /**
     * Get maximum flash loan amount for token
     */
    async getMaxFlashLoanAmount(tokenAddress) {
        try {
            // Get token balance of Venus pool
            const tokenContract = new ethers.Contract(
                tokenAddress,
                [
                    "function balanceOf(address) view returns (uint256)",
                    "function decimals() view returns (uint8)"
                ],
                this.provider
            );

            const balance = await tokenContract.balanceOf(this.flashLoanProvider.contract);
            const maxAmount = balance.mul(80).div(100); // 80% of pool balance

            logger.info('Venus max flash loan amount calculated', { 
                category: 'flash-loan',
                token: tokenAddress,
                maxAmount: maxAmount.toString()
            });

            return maxAmount;

        } catch (error) {
            logger.error('Failed to get max flash loan amount', { 
                category: 'flash-loan',
                error: error.message,
                token: tokenAddress
            });
            throw error;
        }
    }

    /**
     * Check if token is supported for flash loans
     */
    async isTokenSupported(tokenAddress) {
        try {
            const maxAmount = await this.getMaxFlashLoanAmount(tokenAddress);
            return maxAmount.gt(0);
        } catch (error) {
            logger.warn('Token support check failed', { 
                category: 'flash-loan',
                token: tokenAddress,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Get current flash loan premium/fee
     */
    async getCurrentPremium() {
        try {
            if (!this.contract) {
                throw new Error('Contract not initialized');
            }

            const premium = await this.contract.getFlashLoanPremium();
            return premium;
        } catch (error) {
            logger.error('Failed to get current premium', { 
                category: 'flash-loan',
                error: error.message
            });
            return this.flashLoanProvider.fee * 10000; // Fallback to config
        }
    }

    /**
     * Simulate flash loan to estimate gas and success
     */
    async simulateFlashLoan(tokenAddress, amount, calldata) {
        try {
            const gasEstimate = await this.contract.estimateGas.flashLoan(
                this.signer.address,
                tokenAddress,
                amount,
                calldata
            );

            const gasPrice = await this.provider.getGasPrice();
            const estimatedCost = gasEstimate.mul(gasPrice);

            return {
                success: true,
                gasEstimate: gasEstimate.toString(),
                gasPrice: gasPrice.toString(),
                estimatedCost: estimatedCost.toString()
            };

        } catch (error) {
            logger.error('Flash loan simulation failed', { 
                category: 'flash-loan',
                error: error.message,
                token: tokenAddress,
                amount: amount.toString()
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get flash loan provider info
     */
    getProviderInfo() {
        return {
            name: 'Venus Protocol',
            chain: 'bsc',
            contract: this.flashLoanProvider.contract,
            fee: this.flashLoanProvider.fee,
            maxAmount: this.flashLoanProvider.maxAmount,
            supportedTokens: this.flashLoanProvider.supportedTokens
        };
    }

    /**
     * Health check for Venus flash loan provider
     */
    async healthCheck() {
        try {
            if (!this.initialized) {
                return false;
            }

            // Check if contract is responsive
            await this.contract.getFlashLoanPremium();
            
            // Check signer balance for gas
            const balance = await this.signer.getBalance();
            const minBalance = ethers.utils.parseEther('0.01'); // 0.01 BNB minimum
            
            if (balance.lt(minBalance)) {
                logger.warn('Low BNB balance for gas fees', { 
                    category: 'flash-loan',
                    balance: balance.toString(),
                    required: minBalance.toString()
                });
                return false;
            }

            return true;

        } catch (error) {
            logger.error('Venus health check failed', { 
                category: 'flash-loan',
                error: error.message
            });
            return false;
        }
    }
}

export default VenusFlashLoan;