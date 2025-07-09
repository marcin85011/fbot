import { ethers } from 'ethers';
import { config } from 'dotenv';
import { logger } from '../src/utils/logger.js';

// Load environment variables
config();

/**
 * Script to test flash loan execution on BSC testnet
 */
async function runTestnetLoan() {
  const log = logger.child({ component: 'TestnetLoan' });
  
  try {
    log.info('🚀 Starting BSC testnet flash loan test...');
    
    // Configuration
    const config = {
      // BSC Testnet configuration
      rpcUrl: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545',
      chainId: 97,
      privateKey: process.env.PRIVATE_KEY,
      contractAddress: process.env.FLASH_LOAN_CONTRACT_ADDRESS,
      
      // Test parameters
      testAsset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd', // USDT on BSC testnet
      testAmount: ethers.parseUnits('100', 18), // 100 USDT
      gasLimit: 500000,
      gasPrice: ethers.parseUnits('5', 'gwei')
    };
    
    // Validate configuration
    if (!config.privateKey) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }
    
    if (!config.contractAddress) {
      throw new Error('FLASH_LOAN_CONTRACT_ADDRESS environment variable is required');
    }
    
    // Initialize provider and wallet
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(config.privateKey, provider);
    
    // Get network info
    const network = await provider.getNetwork();
    const balance = await provider.getBalance(wallet.address);
    
    log.info('📊 Network configuration', {
      chainId: network.chainId.toString(),
      walletAddress: wallet.address,
      balance: ethers.formatEther(balance),
      contractAddress: config.contractAddress
    });
    
    // Contract ABI (minimal for testing)
    const contractABI = [
      'function executeFlashLoan(address asset, uint256 amount, bytes calldata params) external',
      'function getBalance(address token) external view returns (uint256)',
      'function calculateProfit(address tokenA, address tokenB, uint256 amount) external view returns (uint256)',
      'event FlashLoanExecuted(address indexed asset, uint256 amount, uint256 premium, bool success, uint256 profit)'
    ];
    
    // Connect to contract
    const contract = new ethers.Contract(config.contractAddress, contractABI, wallet);
    
    // Test 1: Check contract balance
    log.info('🔍 Test 1: Checking contract balance...');
    try {
      const contractBalance = await contract.getBalance(config.testAsset);
      log.info('✅ Contract balance checked', {
        asset: config.testAsset,
        balance: ethers.formatUnits(contractBalance, 18)
      });
    } catch (error) {
      log.warn('⚠️ Contract balance check failed (expected on first run)', {
        error: error.message
      });
    }
    
    // Test 2: Calculate potential profit
    log.info('🔍 Test 2: Calculating potential profit...');
    try {
      const profit = await contract.calculateProfit(
        config.testAsset,
        '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // USDC on BSC testnet
        config.testAmount
      );
      log.info('✅ Profit calculation completed', {
        potentialProfit: ethers.formatUnits(profit, 18)
      });
    } catch (error) {
      log.warn('⚠️ Profit calculation failed', {
        error: error.message
      });
    }
    
    // Test 3: Execute flash loan (in simulation mode)
    log.info('🔍 Test 3: Executing flash loan...');
    
    // Encode parameters for arbitrage
    const arbitrageParams = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256'],
      [
        config.testAsset, // tokenA (USDT)
        '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // tokenB (USDC)
        0 // minAmountOut (will be calculated in contract)
      ]
    );
    
    // Estimate gas
    let gasEstimate;
    try {
      gasEstimate = await contract.executeFlashLoan.estimateGas(
        config.testAsset,
        config.testAmount,
        arbitrageParams
      );
      log.info('⛽ Gas estimated', {
        gasEstimate: gasEstimate.toString(),
        gasPrice: ethers.formatUnits(config.gasPrice, 'gwei') + ' gwei'
      });
    } catch (error) {
      log.warn('⚠️ Gas estimation failed', {
        error: error.message
      });
      gasEstimate = config.gasLimit;
    }
    
    // Execute transaction (only if in live mode)
    if (process.env.SIMULATION_MODE !== 'true') {
      log.info('🚀 Executing flash loan transaction...');
      
      const tx = await contract.executeFlashLoan(
        config.testAsset,
        config.testAmount,
        arbitrageParams,
        {
          gasLimit: gasEstimate,
          gasPrice: config.gasPrice
        }
      );
      
      log.info('📝 Transaction submitted', {
        txHash: tx.hash,
        gasLimit: gasEstimate.toString(),
        gasPrice: ethers.formatUnits(config.gasPrice, 'gwei') + ' gwei'
      });
      
      // Wait for confirmation
      const receipt = await tx.wait();
      
      log.info('✅ Flash loan executed successfully', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: ethers.formatUnits(receipt.effectiveGasPrice, 'gwei') + ' gwei',
        status: receipt.status === 1 ? 'Success' : 'Failed'
      });
      
      // Parse events
      const events = receipt.logs.map(log => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      }).filter(Boolean);
      
      if (events.length > 0) {
        log.info('📊 Contract events', { events });
      }
      
      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber
      };
      
    } else {
      log.info('🎭 Simulation mode - transaction not submitted');
      return {
        success: true,
        simulation: true,
        gasEstimate: gasEstimate.toString(),
        txHash: null
      };
    }
    
  } catch (error) {
    log.error('❌ Flash loan test failed:', error);
    throw error;
  }
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runTestnetLoan()
    .then(result => {
      console.log('🎉 Test completed successfully:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

export default runTestnetLoan;