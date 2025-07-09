import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
config();

/**
 * MCP Server Configuration Manager
 * Manages connections and configurations for all MCP servers
 */
class MCPServerConfig {
  constructor() {
    this.servers = {
      context7: {
        name: 'Context7',
        enabled: process.env.CONTEXT7_MCP_ENABLED === 'true',
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
        description: 'Code quality assurance and modern development practices',
        capabilities: ['code-review', 'best-practices', 'optimization'],
        timeout: 30000
      },
      coingecko: {
        name: 'CoinGecko Official',
        enabled: process.env.COINGECKO_MCP_ENABLED === 'true',
        command: 'npx',
        args: ['-y', '@coingecko/coingecko-mcp'],
        description: 'Comprehensive cryptocurrency market data',
        capabilities: ['price-data', 'market-analysis', 'historical-data'],
        timeout: 15000,
        rateLimits: {
          free: { requests: 100, period: 'hour' },
          pro: { requests: 'unlimited', period: 'unlimited' }
        }
      },
      web3mcp: {
        name: 'Web3-MCP',
        enabled: process.env.WEB3_MCP_ENABLED === 'true',
        command: 'node',
        args: ['/mnt/d/Ebay/web3-mcp/build/index.js'],
        description: 'Multi-chain blockchain interactions and bridging',
        capabilities: ['multi-chain', 'bridge-analysis', 'cross-chain'],
        timeout: 20000,
        env: {
          SOLANA_ENABLED: 'true',
          ETHEREUM_ENABLED: 'true',
          BSC_ENABLED: 'true',
          POLYGON_ENABLED: 'true',
          COINGECKO_ENABLED: 'true'
        }
      },
      chainstack: {
        name: 'Chainstack',
        enabled: process.env.CHAINSTACK_MCP_ENABLED === 'true',
        command: 'uv',
        args: ['run', 'main_evm.py'],
        description: 'Direct blockchain RPC access and interaction',
        capabilities: ['rpc-access', 'transaction-simulation', 'mempool-monitoring'],
        timeout: 25000,
        workingDirectory: '/tmp/chainstack-mcp'
      }
    };
    
    this.connectionPool = new Map();
    this.healthStatus = new Map();
    this.rateLimiters = new Map();
    
    this.initializeHealthChecks();
  }

  /**
   * Initialize health check monitoring for all servers
   */
  initializeHealthChecks() {
    Object.keys(this.servers).forEach(serverName => {
      this.healthStatus.set(serverName, {
        isHealthy: false,
        lastCheck: null,
        consecutiveFailures: 0,
        averageResponseTime: 0
      });
    });
  }

  /**
   * Get server configuration by name
   * @param {string} serverName - Name of the MCP server
   * @returns {object} Server configuration
   */
  getServer(serverName) {
    const server = this.servers[serverName.toLowerCase()];
    if (!server) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }
    return server;
  }

  /**
   * Get all enabled servers
   * @returns {object} All enabled server configurations
   */
  getEnabledServers() {
    return Object.entries(this.servers)
      .filter(([name, config]) => config.enabled)
      .reduce((acc, [name, config]) => ({ ...acc, [name]: config }), {});
  }

  /**
   * Get server capabilities
   * @param {string} serverName - Name of the MCP server
   * @returns {string[]} Array of server capabilities
   */
  getServerCapabilities(serverName) {
    const server = this.getServer(serverName);
    return server.capabilities || [];
  }

  /**
   * Get servers with specific capability
   * @param {string} capability - Required capability
   * @returns {object} Servers that have the specified capability
   */
  getServersByCapability(capability) {
    return Object.entries(this.servers)
      .filter(([name, config]) => 
        config.enabled && 
        config.capabilities && 
        config.capabilities.includes(capability)
      )
      .reduce((acc, [name, config]) => ({ ...acc, [name]: config }), {});
  }

  /**
   * Get health status for a server
   * @param {string} serverName - Name of the MCP server
   * @returns {object} Health status information
   */
  getHealthStatus(serverName) {
    return this.healthStatus.get(serverName) || {
      isHealthy: false,
      lastCheck: null,
      consecutiveFailures: 0,
      averageResponseTime: 0
    };
  }

  /**
   * Update health status for a server
   * @param {string} serverName - Name of the MCP server
   * @param {boolean} isHealthy - Health status
   * @param {number} responseTime - Response time in milliseconds
   */
  updateHealthStatus(serverName, isHealthy, responseTime = 0) {
    const currentStatus = this.healthStatus.get(serverName) || {};
    
    this.healthStatus.set(serverName, {
      isHealthy,
      lastCheck: new Date(),
      consecutiveFailures: isHealthy ? 0 : currentStatus.consecutiveFailures + 1,
      averageResponseTime: currentStatus.averageResponseTime 
        ? (currentStatus.averageResponseTime + responseTime) / 2 
        : responseTime
    });
  }

  /**
   * Get rate limiter configuration for a server
   * @param {string} serverName - Name of the MCP server
   * @returns {object} Rate limiter configuration
   */
  getRateLimiter(serverName) {
    const server = this.getServer(serverName);
    return server.rateLimits || { requests: 'unlimited', period: 'unlimited' };
  }

  /**
   * Check if server is available for requests
   * @param {string} serverName - Name of the MCP server
   * @returns {boolean} True if server is available
   */
  isServerAvailable(serverName) {
    const server = this.getServer(serverName);
    const healthStatus = this.getHealthStatus(serverName);
    
    return server.enabled && healthStatus.isHealthy && healthStatus.consecutiveFailures < 3;
  }

  /**
   * Get fallback servers for a capability
   * @param {string} capability - Required capability
   * @param {string} excludeServer - Server to exclude from fallbacks
   * @returns {string[]} Array of fallback server names
   */
  getFallbackServers(capability, excludeServer = null) {
    const servers = this.getServersByCapability(capability);
    return Object.keys(servers)
      .filter(name => name !== excludeServer && this.isServerAvailable(name))
      .sort((a, b) => {
        const aHealth = this.getHealthStatus(a);
        const bHealth = this.getHealthStatus(b);
        return aHealth.averageResponseTime - bHealth.averageResponseTime;
      });
  }

  /**
   * Get MCP configuration for Claude Code
   * @returns {object} MCP configuration object
   */
  getMCPConfig() {
    const mcpServers = {};
    
    Object.entries(this.servers).forEach(([name, config]) => {
      if (config.enabled) {
        mcpServers[name] = {
          command: config.command,
          args: config.args,
          env: config.env || {}
        };
      }
    });

    return { mcpServers };
  }

  /**
   * Get connection timeout for a server
   * @param {string} serverName - Name of the MCP server
   * @returns {number} Timeout in milliseconds
   */
  getTimeout(serverName) {
    const server = this.getServer(serverName);
    return server.timeout || 30000;
  }

  /**
   * Get working directory for a server
   * @param {string} serverName - Name of the MCP server
   * @returns {string|null} Working directory path
   */
  getWorkingDirectory(serverName) {
    const server = this.getServer(serverName);
    return server.workingDirectory || null;
  }

  /**
   * Get environment variables for a server
   * @param {string} serverName - Name of the MCP server
   * @returns {object} Environment variables
   */
  getServerEnv(serverName) {
    const server = this.getServer(serverName);
    return server.env || {};
  }

  /**
   * Get all server names
   * @returns {string[]} Array of all server names
   */
  getAllServerNames() {
    return Object.keys(this.servers);
  }

  /**
   * Enable or disable a server
   * @param {string} serverName - Name of the MCP server
   * @param {boolean} enabled - Enable or disable the server
   */
  setServerEnabled(serverName, enabled) {
    const server = this.getServer(serverName);
    server.enabled = enabled;
  }

  /**
   * Get server priority for load balancing
   * @param {string} serverName - Name of the MCP server
   * @returns {number} Priority score (lower is better)
   */
  getServerPriority(serverName) {
    const healthStatus = this.getHealthStatus(serverName);
    const failurePenalty = healthStatus.consecutiveFailures * 100;
    const responsePenalty = healthStatus.averageResponseTime || 0;
    
    return failurePenalty + responsePenalty;
  }

  /**
   * Get recommended server for a capability
   * @param {string} capability - Required capability
   * @returns {string|null} Recommended server name
   */
  getRecommendedServer(capability) {
    const servers = this.getServersByCapability(capability);
    const availableServers = Object.keys(servers).filter(name => this.isServerAvailable(name));
    
    if (availableServers.length === 0) {
      return null;
    }

    // Return server with lowest priority (best performance)
    return availableServers.reduce((best, current) => {
      const currentPriority = this.getServerPriority(current);
      const bestPriority = this.getServerPriority(best);
      return currentPriority < bestPriority ? current : best;
    });
  }
}

// Export singleton instance
export const mcpConfig = new MCPServerConfig();
export default mcpConfig;