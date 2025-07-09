import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
config();

// Load network configuration
const networksConfig = JSON.parse(
  readFileSync(join(process.cwd(), 'config', 'networks.json'), 'utf8')
);

/**
 * Blockchain Configuration Manager
 * Provides centralized access to chain configurations, RPC URLs, and contract addresses
 */
class ChainConfig {
  constructor() {
    this.networks = networksConfig.networks;
    this.arbitrageSettings = networksConfig.arbitrageSettings;
    this.flashLoanSettings = networksConfig.flashLoanSettings;
    this.validateConfig();
  }

  /**
   * Validate configuration completeness
   */
  validateConfig() {
    const requiredEnvVars = [
      'PRIVATE_KEY',
      'BSC_RPC_URL',
      'POLYGON_RPC_URL',
      'ETHEREUM_RPC_URL'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // Update RPC URLs from environment variables
    this.networks.bsc.rpcUrl = process.env.BSC_RPC_URL;
    this.networks.polygon.rpcUrl = process.env.POLYGON_RPC_URL;
    this.networks.ethereum.rpcUrl = process.env.ETHEREUM_RPC_URL;
  }

  /**
   * Get network configuration by chain name
   * @param {string} chainName - Name of the blockchain network
   * @returns {object} Network configuration
   */
  getNetwork(chainName) {
    const network = this.networks[chainName.toLowerCase()];
    if (!network) {
      throw new Error(`Unsupported network: ${chainName}`);
    }
    return network;
  }

  /**
   * Get all supported networks
   * @returns {object} All network configurations
   */
  getAllNetworks() {
    return this.networks;
  }

  /**
   * Get flash loan provider configuration for a network
   * @param {string} chainName - Name of the blockchain network
   * @returns {object} Flash loan provider configuration
   */
  getFlashLoanProvider(chainName) {
    const network = this.getNetwork(chainName);
    return network.flashLoanProvider;
  }

  /**
   * Get DEX configuration for a network
   * @param {string} chainName - Name of the blockchain network
   * @param {string} dexName - Name of the DEX
   * @returns {object} DEX configuration
   */
  getDEX(chainName, dexName) {
    const network = this.getNetwork(chainName);
    const dex = network.dexes[dexName.toLowerCase()];
    if (!dex) {
      throw new Error(`Unsupported DEX ${dexName} on ${chainName}`);
    }
    return dex;
  }

  /**
   * Get token address for a network
   * @param {string} chainName - Name of the blockchain network
   * @param {string} tokenSymbol - Token symbol (e.g., 'USDT')
   * @returns {string} Token contract address
   */
  getTokenAddress(chainName, tokenSymbol) {
    const network = this.getNetwork(chainName);
    const tokenAddress = network.tokens[tokenSymbol.toUpperCase()];
    if (!tokenAddress) {
      throw new Error(`Token ${tokenSymbol} not found on ${chainName}`);
    }
    return tokenAddress;
  }

  /**
   * Get arbitrage settings
   * @returns {object} Arbitrage configuration
   */
  getArbitrageSettings() {
    return {
      ...this.arbitrageSettings,
      minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD_PERCENT) / 100 || this.arbitrageSettings.minProfitThreshold,
      maxSlippage: parseFloat(process.env.MAX_SLIPPAGE_PERCENT) / 100 || this.arbitrageSettings.maxSlippage
    };
  }

  /**
   * Get flash loan settings
   * @returns {object} Flash loan configuration
   */
  getFlashLoanSettings() {
    return this.flashLoanSettings;
  }

  /**
   * Get private key and wallet address
   * @returns {object} Wallet configuration
   */
  getWalletConfig() {
    return {
      privateKey: process.env.PRIVATE_KEY,
      address: process.env.WALLET_ADDRESS
    };
  }

  /**
   * Get gas configuration
   * @returns {object} Gas configuration
   */
  getGasConfig() {
    return {
      gasLimit: parseInt(process.env.GAS_LIMIT) || 2000000,
      gasPriceMultiplier: parseFloat(process.env.GAS_PRICE_MULTIPLIER) || 1.2
    };
  }

  /**
   * Check if testnet mode is enabled
   * @returns {boolean} True if testnet mode is enabled
   */
  isTestnet() {
    return process.env.USE_TESTNET === 'true';
  }

  /**
   * Get supported chain names
   * @returns {string[]} Array of supported chain names
   */
  getSupportedChains() {
    return Object.keys(this.networks);
  }

  /**
   * Get all DEXes for a network
   * @param {string} chainName - Name of the blockchain network
   * @returns {object} All DEX configurations for the network
   */
  getAllDEXes(chainName) {
    const network = this.getNetwork(chainName);
    return network.dexes;
  }

  /**
   * Get all tokens for a network
   * @param {string} chainName - Name of the blockchain network
   * @returns {object} All token addresses for the network
   */
  getAllTokens(chainName) {
    const network = this.getNetwork(chainName);
    return network.tokens;
  }
}

// Export singleton instance
export const chainConfig = new ChainConfig();
export default chainConfig;