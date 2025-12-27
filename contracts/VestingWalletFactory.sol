// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./StageBasedVestingWallet.sol";
import "./MOEToken.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title VestingWalletFactory
 * @dev 创建和管理 StageBasedVestingWallet 实例（使用 EIP-1167 Minimal Proxy）
 *
 * 职责：
 * - 为玩家创建独立的 VestingWallet（使用 minimal proxy 节省 gas）
 * - 从自身余额转账 MOE 到 VestingWallet
 * - 记录所有创建的 VestingWallet 地址
 *
 * 经济模型：
 * 1. 部署后，Owner 转账 MOE 到 Factory（例如 500万）
 * 2. 玩家提现时，Backend 调用 createVesting()
 * 3. Factory 从自身余额 transfer MOE 到新创建的 VestingWallet
 * 4. 当 Factory 余额不足时，Owner 可以 mint 或 transfer 补充
 *
 * Gas 优化（EIP-1167）：
 * - 旧方式：每次部署新合约（~150k gas）
 * - 新方式：克隆实现合约（~50k gas）
 * - 节省：~100k gas per wallet (67% 降低)
 */
contract VestingWalletFactory is Ownable {
    using Clones for address;

    MOEToken public immutable moeToken;

    // 实现合约地址（只部署一次）
    address public immutable vestingWalletImplementation;

    // 记录每个玩家的所有 VestingWallet 地址
    mapping(address => address[]) public playerVestingWallets;

    // 记录所有创建的 VestingWallet 地址
    address[] public allVestingWallets;

    /**
     * @dev 当新的 Vesting 被创建时触发
     * @param beneficiary 受益人地址（玩家）
     * @param vestingWallet 新创建的 VestingWallet 地址
     * @param amount 锁定金额
     * @param startTime Vesting 开始时间
     */
    event VestingCreated(
        address indexed beneficiary,
        address indexed vestingWallet,
        uint256 amount,
        uint64 startTime
    );

    /**
     * @dev 构造函数
     * @param _moeToken MOEToken 合约地址
     * @param initialOwner 合约所有者（Backend）
     *
     * 部署时会创建一个实现合约实例，后续所有 vesting wallet 都是它的 proxy
     */
    constructor(address _moeToken, address initialOwner) Ownable(initialOwner) {
        require(_moeToken != address(0), "Factory: MOEToken is zero address");
        moeToken = MOEToken(_moeToken);

        // 部署实现合约（只部署一次）
        vestingWalletImplementation = address(new StageBasedVestingWallet());
    }

    /**
     * @dev 为玩家创建新的 vesting wallet (使用 EIP-1167 minimal proxy)
     * @param beneficiary 受益人地址（玩家）
     * @param amount 锁定金额
     * @return vestingWallet 新创建的 VestingWallet 地址
     *
     * 流程：
     * 1. 验证参数
     * 2. 检查 Factory 余额是否充足
     * 3. 克隆实现合约（minimal proxy）
     * 4. 初始化 proxy
     * 5. 从 Factory 转账 MOE 到 VestingWallet
     * 6. 记录 VestingWallet 地址
     * 7. 发出 VestingCreated 事件
     *
     * 要求：
     * - 只有 owner 可以调用
     * - beneficiary 不能为零地址
     * - amount 必须大于 0
     * - amount 必须能被 4 整除（因为 4 个阶段各 25%）
     * - Factory 余额必须 >= amount
     *
     * Gas 消耗：约 50,000 gas（相比旧方式的 150k gas 节省 67%）
     */
    function createVesting(address beneficiary, uint256 amount)
        external
        onlyOwner
        returns (address vestingWallet)
    {
        // 1. Checks - 输入验证
        require(beneficiary != address(0), "Factory: beneficiary is zero address");
        require(amount > 0, "Factory: amount must be positive");
        require(amount % 4 == 0, "Factory: amount must be divisible by 4");
        require(
            moeToken.balanceOf(address(this)) >= amount,
            "Factory: insufficient MOE balance"
        );

        // 2. Effects - 克隆实现合约并初始化
        // 使用 EIP-1167 克隆（只需 ~50k gas）
        vestingWallet = vestingWalletImplementation.clone();

        // 初始化 proxy（设置 beneficiary 和 startTime）
        StageBasedVestingWallet(payable(vestingWallet)).initialize(
            beneficiary,
            uint64(block.timestamp)
        );

        // 记录 VestingWallet（在外部调用前更新状态）
        playerVestingWallets[beneficiary].push(vestingWallet);
        allVestingWallets.push(vestingWallet);

        // 3. Interactions - 外部调用（转账）
        require(
            moeToken.transfer(vestingWallet, amount),
            "Factory: transfer failed"
        );

        // 4. 发出事件
        emit VestingCreated(beneficiary, vestingWallet, amount, uint64(block.timestamp));

        return vestingWallet;
    }

    /**
     * @dev 查询玩家的所有 VestingWallet 地址
     * @param player 玩家地址
     * @return address[] VestingWallet 地址数组
     */
    function getPlayerVestingWallets(address player)
        external
        view
        returns (address[] memory)
    {
        return playerVestingWallets[player];
    }

    /**
     * @dev 查询总共创建的 VestingWallet 数量
     * @return uint256 总数量
     */
    function getTotalVestingWallets() external view returns (uint256) {
        return allVestingWallets.length;
    }

    /**
     * @dev 查询 Factory 当前的 MOE 余额
     * @return uint256 MOE 余额
     *
     * 用途：
     * - Backend 监控 Factory 余额
     * - 当余额不足时，Owner 可以 mint 或 transfer 补充
     */
    function getBalance() external view returns (uint256) {
        return moeToken.balanceOf(address(this));
    }

    /**
     * @dev 查询实现合约地址（用于调试）
     * @return address 实现合约地址
     */
    function getImplementation() external view returns (address) {
        return vestingWalletImplementation;
    }
}
