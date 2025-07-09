import { config } from 'dotenv';
import { chainConfig } from './chains.js';

// Load environment variables
config();

/**
 * Flash Loan Provider Configuration Manager
 * Manages configurations for different flash loan protocols across chains
 */
class FlashLoanProviderConfig {
  constructor() {
    this.providers = {
      venus: {
        name: 'Venus Protocol',
        chain: 'bsc',
        version: '1.0',
        contracts: {
          comptroller: process.env.VENUS_COMPTROLLER_BSC || '0xfD36E2c2a6789Db23113685031d7F16329158384',
          unitroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
          priceOracle: '0xd8B6dA2bfEC71D684D3E2a2FC9492dDad5C3787F'
        },
        fee: 0.0005, // 0.05%
        maxLoanAmount: '10000000', // 10M tokens
        supportedTokens: ['USDT', 'USDC', 'BUSD', 'DAI'],
        abi: {
          comptroller: 'venus-comptroller-abi.json',
          vToken: 'venus-vtoken-abi.json'
        },
        gasLimits: {
          flashLoan: 800000,
          repay: 300000
        }
      },
      aave: {
        name: 'Aave V3',
        chain: 'polygon',
        version: '3.0',
        contracts: {
          pool: process.env.AAVE_POOL_POLYGON || '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
          poolAddressProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
          priceOracle: '0xb023e699F5a33916Ea823A16485e259257cA8Bd1'
        },
        fee: 0.0005, // 0.05%
        maxLoanAmount: '50000000', // 50M tokens
        supportedTokens: ['USDT', 'USDC', 'DAI', 'WETH'],
        abi: {
          pool: 'aave-pool-abi.json',
          flashLoanReceiver: 'aave-flashloan-receiver-abi.json'
        },
        gasLimits: {
          flashLoan: 1000000,
          repay: 400000
        }
      },
      compound: {
        name: 'Compound V3',
        chain: 'ethereum',
        version: '3.0',
        contracts: {
          comptroller: process.env.COMPOUND_COMPTROLLER_ETHEREUM || '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B',
          cUSDC: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
          cDAI: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643'
        },
        fee: 0.001, // 0.1%
        maxLoanAmount: '100000000', // 100M tokens
        supportedTokens: ['USDT', 'USDC', 'DAI', 'WETH'],
        abi: {
          comptroller: 'compound-comptroller-abi.json',
          cToken: 'compound-ctoken-abi.json'
        },
        gasLimits: {
          flashLoan: 1200000,
          repay: 500000
        }
      }
    };

    this.defaultProvider = 'venus'; // Default to Venus for BSC
    this.validateProviders();
  }

  /**
   * Validate all provider configurations
   */
  validateProviders() {
    Object.entries(this.providers).forEach(([name, config]) => {
      // Validate chain exists
      try {
        chainConfig.getNetwork(config.chain);
      } catch (error) {
        throw new Error(`Invalid chain '${config.chain}' for provider '${name}': ${error.message}`);
      }

      // Validate required contracts
      if (!config.contracts || Object.keys(config.contracts).length === 0) {
        throw new Error(`No contracts configured for provider '${name}'`);
      }

      // Validate supported tokens
      if (!config.supportedTokens || config.supportedTokens.length === 0) {
        throw new Error(`No supported tokens configured for provider '${name}'`);
      }

      // Validate fee is reasonable
      if (config.fee < 0 || config.fee > 0.01) {
        throw new Error(`Invalid fee ${config.fee} for provider '${name}' (should be between 0 and 1%)`);
      }
    });
  }

  /**
   * Get provider configuration by name
   * @param {string} providerName - Name of the flash loan provider
   * @returns {object} Provider configuration
   */
  getProvider(providerName) {
    const provider = this.providers[providerName.toLowerCase()];
    if (!provider) {
      throw new Error(`Unknown flash loan provider: ${providerName}`);
    }
    return provider;
  }

  /**
   * Get provider by chain
   * @param {string} chainName - Name of the blockchain
   * @returns {object} Provider configuration
   */
  getProviderByChain(chainName) {
    const provider = Object.values(this.providers).find(p => p.chain === chainName.toLowerCase());
    if (!provider) {
      throw new Error(`No flash loan provider available for chain: ${chainName}`);
    }
    return provider;
  }

  /**
   * Get all providers
   * @returns {object} All provider configurations
   */
  getAllProviders() {
    return this.providers;
  }

  /**
   * Get supported tokens for a provider
   * @param {string} providerName - Name of the flash loan provider
   * @returns {string[]} Array of supported token symbols
   */
  getSupportedTokens(providerName) {
    const provider = this.getProvider(providerName);
    return provider.supportedTokens;
  }

  /**
   * Check if a token is supported by a provider
   * @param {string} providerName - Name of the flash loan provider
   * @param {string} tokenSymbol - Token symbol to check
   * @returns {boolean} True if token is supported
   */
  isTokenSupported(providerName, tokenSymbol) {
    const supportedTokens = this.getSupportedTokens(providerName);
    return supportedTokens.includes(tokenSymbol.toUpperCase());
  }

  /**
   * Get flash loan fee for a provider
   * @param {string} providerName - Name of the flash loan provider
   * @returns {number} Fee as a decimal (e.g., 0.0005 for 0.05%)
   */
  getFlashLoanFee(providerName) {
    const provider = this.getProvider(providerName);
    return provider.fee;
  }

  /**
   * Get maximum loan amount for a provider
   * @param {string} providerName - Name of the flash loan provider
   * @returns {string} Maximum loan amount
   */
  getMaxLoanAmount(providerName) {
    const provider = this.getProvider(providerName);
    return provider.maxLoanAmount;
  }

  /**
   * Get contract addresses for a provider
   * @param {string} providerName - Name of the flash loan provider
   * @returns {object} Contract addresses
   */
  getContracts(providerName) {
    const provider = this.getProvider(providerName);
    return provider.contracts;
  }

  /**
   * Get specific contract address
   * @param {string} providerName - Name of the flash loan provider
   * @param {string} contractName - Name of the contract
   * @returns {string} Contract address
   */
  getContract(providerName, contractName) {
    const contracts = this.getContracts(providerName);
    const address = contracts[contractName];
    if (!address) {
      throw new Error(`Contract '${contractName}' not found for provider '${providerName}'`);
    }
    return address;
  }

  /**
   * Get gas limits for a provider
   * @param {string} providerName - Name of the flash loan provider
   * @returns {object} Gas limit configuration
   */
  getGasLimits(providerName) {
    const provider = this.getProvider(providerName);
    return provider.gasLimits;
  }

  /**
   * Get gas limit for a specific operation
   * @param {string} providerName - Name of the flash loan provider
   * @param {string} operation - Operation name (flashLoan, repay)
   * @returns {number} Gas limit
   */
  getGasLimit(providerName, operation) {
    const gasLimits = this.getGasLimits(providerName);
    return gasLimits[operation] || 1000000; // Default gas limit
  }

  /**
   * Get ABI configuration for a provider
   * @param {string} providerName - Name of the flash loan provider
   * @returns {object} ABI configuration
   */
  getABIConfig(providerName) {
    const provider = this.getProvider(providerName);
    return provider.abi;
  }

  /**
   * Calculate flash loan fee amount
   * @param {string} providerName - Name of the flash loan provider
   * @param {string} amount - Loan amount
   * @returns {string} Fee amount
   */
  calculateFee(providerName, amount) {
    const fee = this.getFlashLoanFee(providerName);
    const loanAmount = parseFloat(amount);
    return (loanAmount * fee).toFixed(18);
  }

  /**
   * Get provider for optimal chain selection
   * @param {string} tokenSymbol - Token symbol
   * @param {string} targetAmount - Target loan amount
   * @returns {object} Optimal provider configuration
   */
  getOptimalProvider(tokenSymbol, targetAmount) {
    const amount = parseFloat(targetAmount);
    
    // Find providers that support the token
    const compatibleProviders = Object.entries(this.providers)
      .filter(([name, config]) => 
        config.supportedTokens.includes(tokenSymbol.toUpperCase()) &&
        parseFloat(config.maxLoanAmount) >= amount
      )
      .map(([name, config]) => ({ name, ...config }));

    if (compatibleProviders.length === 0) {
      throw new Error(`No compatible flash loan provider found for ${tokenSymbol} with amount ${targetAmount}`);
    }

    // Sort by fee (ascending) and max loan amount (descending)
    compatibleProviders.sort((a, b) => {
      if (a.fee !== b.fee) {
        return a.fee - b.fee;
      }
      return parseFloat(b.maxLoanAmount) - parseFloat(a.maxLoanAmount);
    });

    return compatibleProviders[0];
  }

  /**
   * Get chain name for a provider
   * @param {string} providerName - Name of the flash loan provider
   * @returns {string} Chain name
   */
  getChainName(providerName) {
    const provider = this.getProvider(providerName);
    return provider.chain;
  }

  /**
   * Get all supported chains
   * @returns {string[]} Array of supported chain names
   */
  getSupportedChains() {
    return [...new Set(Object.values(this.providers).map(p => p.chain))];
  }

  /**
   * Get providers by supported token
   * @param {string} tokenSymbol - Token symbol
   * @returns {object[]} Array of provider configurations
   */
  getProvidersByToken(tokenSymbol) {
    return Object.entries(this.providers)
      .filter(([name, config]) => config.supportedTokens.includes(tokenSymbol.toUpperCase()))
      .map(([name, config]) => ({ name, ...config }));
  }
}

// Export singleton instance
export const flashLoanConfig = new FlashLoanProviderConfig();
export default flashLoanConfig;