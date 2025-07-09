import { config } from 'dotenv';
import { logger } from '../utils/logger.js';
import { mcpConfig } from '../config/mcp-servers.js';

// Load environment variables
config();

/**
 * CoinGecko MCP Client
 * Handles real-time cryptocurrency price data fetching and market analysis
 */
class CoinGeckoMCPClient {
  constructor() {
    this.serverName = 'coingecko';
    this.isConnected = false;
    this.lastPriceUpdate = null;
    this.priceCache = new Map();
    this.cacheTimeout = 30000; // 30 seconds cache
    this.rateLimiter = {
      requests: 0,
      lastReset: Date.now(),
      maxRequests: 100, // Free tier limit
      resetPeriod: 3600000 // 1 hour
    };
    
    this.marketData = {
      prices: new Map(),
      volumes: new Map(),
      priceChanges: new Map(),
      lastUpdate: null
    };
    
    this.initialize();
  }

  /**
   * Initialize CoinGecko MCP connection
   */
  async initialize() {
    try {
      if (!mcpConfig.isServerAvailable(this.serverName)) {
        throw new Error('CoinGecko MCP server is not available');
      }
      
      this.isConnected = true;
      logger.mcp(this.serverName, 'connected', { 
        capabilities: mcpConfig.getServerCapabilities(this.serverName) 
      });
      
      // Update health status
      mcpConfig.updateHealthStatus(this.serverName, true, 0);
      
      // Start periodic price updates
      this.startPriceUpdates();
      
    } catch (error) {
      logger.error('Failed to initialize CoinGecko MCP client', error);
      mcpConfig.updateHealthStatus(this.serverName, false, 0);
      throw error;
    }
  }

  /**
   * Check rate limit before making requests
   */
  checkRateLimit() {
    const now = Date.now();
    
    // Reset counter every hour
    if (now - this.rateLimiter.lastReset >= this.rateLimiter.resetPeriod) {
      this.rateLimiter.requests = 0;
      this.rateLimiter.lastReset = now;
    }
    
    if (this.rateLimiter.requests >= this.rateLimiter.maxRequests) {
      throw new Error('CoinGecko API rate limit exceeded');
    }
    
    this.rateLimiter.requests++;
  }

  /**
   * Get current price for a cryptocurrency
   * @param {string} symbol - Cryptocurrency symbol (e.g., 'bitcoin', 'ethereum')
   * @param {string} vsCurrency - Target currency (default: 'usd')
   * @returns {Promise<number>} Current price
   */
  async getCurrentPrice(symbol, vsCurrency = 'usd') {
    const timer = logger.startTimer('coingecko-price-fetch');
    
    try {
      // Check cache first
      const cacheKey = `${symbol}-${vsCurrency}`;
      const cachedPrice = this.getCachedPrice(cacheKey);
      
      if (cachedPrice !== null) {
        timer({ cached: true, symbol, vsCurrency });
        return cachedPrice;
      }
      
      // Check rate limit
      this.checkRateLimit();
      
      // Simulate MCP call to CoinGecko
      const priceData = await this.makeCoingeckoCall('simple/price', {
        ids: symbol,
        vs_currencies: vsCurrency,
        include_24hr_change: true,
        include_24hr_vol: true
      });
      
      const price = priceData[symbol][vsCurrency];
      const priceChange = priceData[symbol][`${vsCurrency}_24h_change`];
      const volume = priceData[symbol][`${vsCurrency}_24h_vol`];
      
      // Update cache and market data
      this.updatePriceCache(cacheKey, price);
      this.updateMarketData(symbol, price, priceChange, volume);
      
      logger.mcp(this.serverName, 'price-fetched', {
        symbol,
        price,
        priceChange,
        volume,
        vsCurrency
      });
      
      timer({ success: true, symbol, vsCurrency });
      return price;
      
    } catch (error) {
      logger.error('Failed to fetch current price from CoinGecko', error, {
        symbol,
        vsCurrency
      });
      
      timer({ error: true, symbol, vsCurrency });
      throw error;
    }
  }

  /**
   * Get price history for arbitrage analysis
   * @param {string} symbol - Cryptocurrency symbol
   * @param {number} days - Number of days of history
   * @returns {Promise<Array>} Price history data
   */
  async getPriceHistory(symbol, days = 1) {
    const timer = logger.startTimer('coingecko-history-fetch');
    
    try {
      this.checkRateLimit();
      
      const historyData = await this.makeCoingeckoCall(`coins/${symbol}/market_chart`, {
        vs_currency: 'usd',
        days: days,
        interval: days <= 1 ? 'hourly' : 'daily'
      });
      
      const priceHistory = historyData.prices.map(([timestamp, price]) => ({
        timestamp,
        price,
        date: new Date(timestamp)
      }));
      
      logger.mcp(this.serverName, 'history-fetched', {
        symbol,
        days,
        dataPoints: priceHistory.length
      });
      
      timer({ success: true, symbol, days, dataPoints: priceHistory.length });
      return priceHistory;
      
    } catch (error) {
      logger.error('Failed to fetch price history from CoinGecko', error, {
        symbol,
        days
      });
      
      timer({ error: true, symbol, days });
      throw error;
    }
  }

  /**
   * Get market data for multiple cryptocurrencies
   * @param {string[]} symbols - Array of cryptocurrency symbols
   * @returns {Promise<object>} Market data for all symbols
   */
  async getMarketData(symbols) {
    const timer = logger.startTimer('coingecko-market-data');
    
    try {
      this.checkRateLimit();
      
      const marketData = await this.makeCoingeckoCall('coins/markets', {
        vs_currency: 'usd',
        ids: symbols.join(','),
        order: 'market_cap_desc',
        per_page: 100,
        page: 1,
        sparkline: false,
        price_change_percentage: '1h,24h,7d'
      });
      
      const processedData = marketData.reduce((acc, coin) => {
        acc[coin.id] = {
          symbol: coin.symbol,
          name: coin.name,
          current_price: coin.current_price,
          market_cap: coin.market_cap,
          volume_24h: coin.total_volume,
          price_change_1h: coin.price_change_percentage_1h_in_currency,
          price_change_24h: coin.price_change_percentage_24h_in_currency,
          price_change_7d: coin.price_change_percentage_7d_in_currency,
          last_updated: coin.last_updated
        };
        return acc;
      }, {});
      
      logger.mcp(this.serverName, 'market-data-fetched', {
        symbols: symbols.length,
        timestamp: new Date().toISOString()
      });
      
      timer({ success: true, symbols: symbols.length });
      return processedData;
      
    } catch (error) {
      logger.error('Failed to fetch market data from CoinGecko', error, {
        symbols: symbols.length
      });
      
      timer({ error: true, symbols: symbols.length });
      throw error;
    }
  }

  /**
   * Get price comparison between different exchanges
   * @param {string} symbol - Cryptocurrency symbol
   * @returns {Promise<object>} Price comparison data
   */
  async getPriceComparison(symbol) {
    const timer = logger.startTimer('coingecko-price-comparison');
    
    try {
      this.checkRateLimit();
      
      const tickerData = await this.makeCoingeckoCall(`coins/${symbol}/tickers`, {
        page: 1,
        per_page: 20,
        order: 'volume_desc'
      });
      
      const priceComparison = tickerData.tickers.map(ticker => ({
        exchange: ticker.market.name,
        base: ticker.base,
        target: ticker.target,
        price: ticker.last,
        volume: ticker.volume,
        bid_ask_spread: ticker.bid_ask_spread_percentage,
        trust_score: ticker.trust_score,
        timestamp: ticker.timestamp
      }));
      
      // Calculate arbitrage opportunities
      const arbitrageOpportunities = this.calculateArbitrageOpportunities(priceComparison);
      
      logger.mcp(this.serverName, 'price-comparison-fetched', {
        symbol,
        exchanges: priceComparison.length,
        arbitrageOpportunities: arbitrageOpportunities.length
      });
      
      timer({ success: true, symbol, exchanges: priceComparison.length });
      return {
        symbol,
        exchanges: priceComparison,
        arbitrageOpportunities,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error('Failed to fetch price comparison from CoinGecko', error, {
        symbol
      });
      
      timer({ error: true, symbol });
      throw error;
    }
  }

  /**
   * Calculate arbitrage opportunities from price comparison
   * @param {Array} priceData - Price data from different exchanges
   * @returns {Array} Arbitrage opportunities
   */
  calculateArbitrageOpportunities(priceData) {
    const opportunities = [];
    
    // Sort by price
    const sortedPrices = [...priceData].sort((a, b) => a.price - b.price);
    
    for (let i = 0; i < sortedPrices.length - 1; i++) {
      const buyExchange = sortedPrices[i];
      const sellExchange = sortedPrices[sortedPrices.length - 1];
      
      const priceDiff = sellExchange.price - buyExchange.price;
      const profitPercentage = (priceDiff / buyExchange.price) * 100;
      
      if (profitPercentage > 0.5) { // Only consider opportunities > 0.5%
        opportunities.push({
          buyExchange: buyExchange.exchange,
          sellExchange: sellExchange.exchange,
          buyPrice: buyExchange.price,
          sellPrice: sellExchange.price,
          priceDiff,
          profitPercentage: profitPercentage.toFixed(4),
          buyVolume: buyExchange.volume,
          sellVolume: sellExchange.volume,
          minVolume: Math.min(buyExchange.volume, sellExchange.volume)
        });
      }
    }
    
    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  /**
   * Start periodic price updates
   */
  startPriceUpdates() {
    setInterval(async () => {
      try {
        await this.updateAllPrices();
      } catch (error) {
        logger.error('Failed to update prices', error);
      }
    }, 60000); // Update every minute
  }

  /**
   * Update all tracked prices
   */
  async updateAllPrices() {
    const trackedSymbols = ['bitcoin', 'ethereum', 'binancecoin', 'matic-network'];
    
    try {
      const marketData = await this.getMarketData(trackedSymbols);
      
      for (const [symbol, data] of Object.entries(marketData)) {
        this.marketData.prices.set(symbol, data.current_price);
        this.marketData.volumes.set(symbol, data.volume_24h);
        this.marketData.priceChanges.set(symbol, data.price_change_24h);
      }
      
      this.marketData.lastUpdate = new Date();
      
      logger.mcp(this.serverName, 'prices-updated', {
        symbols: trackedSymbols.length,
        timestamp: this.marketData.lastUpdate.toISOString()
      });
      
    } catch (error) {
      logger.error('Failed to update all prices', error);
    }
  }

  /**
   * Get cached price if available and not expired
   * @param {string} cacheKey - Cache key
   * @returns {number|null} Cached price or null
   */
  getCachedPrice(cacheKey) {
    const cached = this.priceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.price;
    }
    
    return null;
  }

  /**
   * Update price cache
   * @param {string} cacheKey - Cache key
   * @param {number} price - Price value
   */
  updatePriceCache(cacheKey, price) {
    this.priceCache.set(cacheKey, {
      price,
      timestamp: Date.now()
    });
  }

  /**
   * Update market data
   * @param {string} symbol - Cryptocurrency symbol
   * @param {number} price - Current price
   * @param {number} priceChange - 24h price change
   * @param {number} volume - 24h volume
   */
  updateMarketData(symbol, price, priceChange, volume) {
    this.marketData.prices.set(symbol, price);
    this.marketData.priceChanges.set(symbol, priceChange);
    this.marketData.volumes.set(symbol, volume);
    this.marketData.lastUpdate = new Date();
  }

  /**
   * Make API call to CoinGecko (simulated MCP call)
   * @param {string} endpoint - API endpoint
   * @param {object} params - Query parameters
   * @returns {Promise<object>} API response
   */
  async makeCoingeckoCall(endpoint, params = {}) {
    const startTime = Date.now();
    
    try {
      // Simulate MCP call to CoinGecko
      // In a real implementation, this would use the actual MCP protocol
      const response = await this.simulateCoingeckoAPI(endpoint, params);
      
      const responseTime = Date.now() - startTime;
      mcpConfig.updateHealthStatus(this.serverName, true, responseTime);
      
      return response;
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      mcpConfig.updateHealthStatus(this.serverName, false, responseTime);
      throw error;
    }
  }

  /**
   * Simulate CoinGecko API response (for development)
   * @param {string} endpoint - API endpoint
   * @param {object} params - Query parameters
   * @returns {Promise<object>} Simulated API response
   */
  async simulateCoingeckoAPI(endpoint, params) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
    
    // Simulate different endpoints
    if (endpoint === 'simple/price') {
      const symbols = params.ids.split(',');
      const response = {};
      
      symbols.forEach(symbol => {
        const basePrice = this.getSimulatedPrice(symbol);
        response[symbol] = {
          [params.vs_currencies]: basePrice,
          [`${params.vs_currencies}_24h_change`]: (Math.random() - 0.5) * 10,
          [`${params.vs_currencies}_24h_vol`]: basePrice * 1000000 * (0.5 + Math.random())
        };
      });
      
      return response;
    }
    
    if (endpoint.includes('/market_chart')) {
      const symbol = endpoint.split('/')[1];
      const basePrice = this.getSimulatedPrice(symbol);
      const prices = [];
      
      for (let i = 0; i < 24; i++) {
        const timestamp = Date.now() - (24 - i) * 60 * 60 * 1000;
        const price = basePrice * (0.95 + Math.random() * 0.1);
        prices.push([timestamp, price]);
      }
      
      return { prices };
    }
    
    if (endpoint === 'coins/markets') {
      const symbols = params.ids.split(',');
      return symbols.map(symbol => ({
        id: symbol,
        symbol: symbol.substring(0, 3).toUpperCase(),
        name: symbol.charAt(0).toUpperCase() + symbol.slice(1),
        current_price: this.getSimulatedPrice(symbol),
        market_cap: this.getSimulatedPrice(symbol) * 1000000,
        total_volume: this.getSimulatedPrice(symbol) * 100000,
        price_change_percentage_1h_in_currency: (Math.random() - 0.5) * 2,
        price_change_percentage_24h_in_currency: (Math.random() - 0.5) * 10,
        price_change_percentage_7d_in_currency: (Math.random() - 0.5) * 20,
        last_updated: new Date().toISOString()
      }));
    }
    
    throw new Error(`Unsupported endpoint: ${endpoint}`);
  }

  /**
   * Get simulated price for a cryptocurrency
   * @param {string} symbol - Cryptocurrency symbol
   * @returns {number} Simulated price
   */
  getSimulatedPrice(symbol) {
    const basePrices = {
      bitcoin: 45000,
      ethereum: 3000,
      binancecoin: 300,
      'matic-network': 0.8
    };
    
    const basePrice = basePrices[symbol] || 1;
    return basePrice * (0.95 + Math.random() * 0.1);
  }

  /**
   * Get current market data
   * @returns {object} Current market data
   */
  getMarketData() {
    return {
      prices: Object.fromEntries(this.marketData.prices),
      volumes: Object.fromEntries(this.marketData.volumes),
      priceChanges: Object.fromEntries(this.marketData.priceChanges),
      lastUpdate: this.marketData.lastUpdate
    };
  }

  /**
   * Get connection status
   * @returns {boolean} Connection status
   */
  isConnected() {
    return this.isConnected;
  }

  /**
   * Get rate limit status
   * @returns {object} Rate limit information
   */
  getRateLimitStatus() {
    return {
      requests: this.rateLimiter.requests,
      maxRequests: this.rateLimiter.maxRequests,
      resetTime: new Date(this.rateLimiter.lastReset + this.rateLimiter.resetPeriod),
      remaining: this.rateLimiter.maxRequests - this.rateLimiter.requests
    };
  }

  /**
   * Clear price cache
   */
  clearCache() {
    this.priceCache.clear();
    logger.mcp(this.serverName, 'cache-cleared');
  }

  /**
   * Disconnect from CoinGecko MCP
   */
  disconnect() {
    this.isConnected = false;
    this.priceCache.clear();
    
    logger.mcp(this.serverName, 'disconnected');
  }
}

// Export singleton instance
export const coingeckoClient = new CoinGeckoMCPClient();
export default coingeckoClient;