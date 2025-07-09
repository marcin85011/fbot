// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FlashLoanExecutorBSC
 * @dev Flash loan executor for BSC arbitrage opportunities
 * @notice This contract executes flash loans from Venus Protocol and performs token swaps
 */
contract FlashLoanExecutorBSC is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    // Events
    event FlashLoanExecuted(
        address indexed asset,
        uint256 amount,
        uint256 premium,
        bool success,
        uint256 profit
    );
    
    event ArbitrageExecuted(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit
    );
    
    // Venus Protocol interfaces
    interface IVToken {
        function underlying() external view returns (address);
        function mint(uint256 mintAmount) external returns (uint256);
        function redeem(uint256 redeemTokens) external returns (uint256);
        function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
        function borrow(uint256 borrowAmount) external returns (uint256);
        function repayBorrow(uint256 repayAmount) external returns (uint256);
        function balanceOf(address owner) external view returns (uint256);
        function exchangeRateStored() external view returns (uint256);
    }
    
    interface IComptroller {
        function enterMarkets(address[] calldata vTokens) external returns (uint256[] memory);
        function exitMarket(address vToken) external returns (uint256);
        function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);
    }
    
    // PancakeSwap interfaces
    interface IPancakeRouter {
        function swapExactTokensForTokens(
            uint256 amountIn,
            uint256 amountOutMin,
            address[] calldata path,
            address to,
            uint256 deadline
        ) external returns (uint256[] memory amounts);
        
        function getAmountsOut(uint256 amountIn, address[] calldata path)
            external view returns (uint256[] memory amounts);
    }
    
    // Contract addresses on BSC
    address public constant VENUS_COMPTROLLER = 0xfD36E2c2a6789Db23113685031d7F16329158384;
    address public constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    
    // Token addresses
    address public constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address public constant USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    address public constant VUSDT = 0xfD5840Cd4F6a3d8a4E4bCE5a3e1F8a1dBB5E7f8a; // Venus USDT
    address public constant VUSDC = 0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8; // Venus USDC
    
    // State variables
    mapping(address => bool) public authorizedCallers;
    uint256 public constant MAX_SLIPPAGE = 300; // 3%
    uint256 public constant SLIPPAGE_DENOMINATOR = 10000;
    
    // Interfaces
    IComptroller public comptroller;
    IPancakeRouter public pancakeRouter;
    
    constructor() {
        comptroller = IComptroller(VENUS_COMPTROLLER);
        pancakeRouter = IPancakeRouter(PANCAKE_ROUTER);
        
        // Authorize owner as caller
        authorizedCallers[msg.sender] = true;
        
        // Enter Venus markets
        address[] memory vTokens = new address[](2);
        vTokens[0] = VUSDT;
        vTokens[1] = VUSDC;
        comptroller.enterMarkets(vTokens);
    }
    
    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "Not authorized");
        _;
    }
    
    /**
     * @dev Execute flash loan arbitrage
     * @param asset Token to borrow
     * @param amount Amount to borrow
     * @param params Encoded parameters for arbitrage
     */
    function executeFlashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyAuthorized nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        // Get vToken address
        address vToken = getVToken(asset);
        require(vToken != address(0), "Unsupported asset");
        
        // Store initial balance
        uint256 initialBalance = IERC20(asset).balanceOf(address(this));
        
        // Execute flash loan (simplified - just borrow and immediately repay for testing)
        _executeFlashLoan(vToken, asset, amount, params);
        
        // Check final balance
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        
        emit FlashLoanExecuted(
            asset,
            amount,
            0, // Premium calculation would go here
            finalBalance >= initialBalance,
            finalBalance > initialBalance ? finalBalance - initialBalance : 0
        );
    }
    
    /**
     * @dev Internal flash loan execution
     */
    function _executeFlashLoan(
        address vToken,
        address asset,
        uint256 amount,
        bytes memory params
    ) internal {
        // Step 1: Borrow from Venus
        uint256 borrowResult = IVToken(vToken).borrow(amount);
        require(borrowResult == 0, "Borrow failed");
        
        // Step 2: Execute arbitrage logic
        _executeArbitrage(asset, amount, params);
        
        // Step 3: Repay loan
        IERC20(asset).safeApprove(vToken, amount);
        uint256 repayResult = IVToken(vToken).repayBorrow(amount);
        require(repayResult == 0, "Repay failed");
    }
    
    /**
     * @dev Execute arbitrage between DEXs
     */
    function _executeArbitrage(
        address asset,
        uint256 amount,
        bytes memory params
    ) internal {
        // Decode parameters
        (address tokenA, address tokenB, uint256 minAmountOut) = abi.decode(
            params,
            (address, address, uint256)
        );
        
        // For demo: Simple swap A -> B -> A
        if (tokenA == asset) {
            // Swap A to B
            uint256 amountB = _swapTokens(tokenA, tokenB, amount / 2); // Use half for demo
            
            // Swap B back to A
            uint256 amountA = _swapTokens(tokenB, tokenA, amountB);
            
            emit ArbitrageExecuted(tokenA, tokenB, amount / 2, amountA, 0);
        }
    }
    
    /**
     * @dev Swap tokens using PancakeSwap
     */
    function _swapTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256) {
        if (amountIn == 0) return 0;
        
        // Approve router
        IERC20(tokenIn).safeApprove(address(pancakeRouter), amountIn);
        
        // Set up path
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        // Get expected output
        uint256[] memory amounts = pancakeRouter.getAmountsOut(amountIn, path);
        uint256 amountOutMin = (amounts[1] * (SLIPPAGE_DENOMINATOR - MAX_SLIPPAGE)) / SLIPPAGE_DENOMINATOR;
        
        // Execute swap
        uint256[] memory swapAmounts = pancakeRouter.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            address(this),
            block.timestamp + 300
        );
        
        return swapAmounts[1];
    }
    
    /**
     * @dev Get vToken address for underlying asset
     */
    function getVToken(address asset) public pure returns (address) {
        if (asset == USDT) return VUSDT;
        if (asset == USDC) return VUSDC;
        return address(0);
    }
    
    /**
     * @dev Add authorized caller
     */
    function addAuthorizedCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = true;
    }
    
    /**
     * @dev Remove authorized caller
     */
    function removeAuthorizedCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
    }
    
    /**
     * @dev Emergency withdrawal
     */
    function emergencyWithdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(owner(), balance);
        }
    }
    
    /**
     * @dev Get contract balance
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
    
    /**
     * @dev Calculate potential profit
     */
    function calculateProfit(
        address tokenA,
        address tokenB,
        uint256 amount
    ) external view returns (uint256) {
        // Get amounts for A -> B -> A
        address[] memory pathAB = new address[](2);
        pathAB[0] = tokenA;
        pathAB[1] = tokenB;
        
        address[] memory pathBA = new address[](2);
        pathBA[0] = tokenB;
        pathBA[1] = tokenA;
        
        uint256[] memory amountsAB = pancakeRouter.getAmountsOut(amount, pathAB);
        uint256[] memory amountsBA = pancakeRouter.getAmountsOut(amountsAB[1], pathBA);
        
        return amountsBA[1] > amount ? amountsBA[1] - amount : 0;
    }
    
    /**
     * @dev Receive function for ETH
     */
    receive() external payable {}
}