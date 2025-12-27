// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./MOEToken.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DepositContract
 * @dev 处理玩家充值，支持 gasless deposit
 *
 * 功能：
 * - 玩家充值 MOE 到游戏
 * - 支持 gasless 充值（ERC-2612 Permit）
 * - MOE 转账到 owner（形成闭环经济）
 * - 记录充值历史
 * - 提供查询接口
 *
 * Gasless 充值流程：
 * 1. 玩家签名 permit（off-chain，0 gas）
 * 2. Backend 调用 depositWithPermit（backend 付 gas）
 * 3. MOE 从玩家转到 owner
 * 4. Backend 更新游戏内余额
 *
 * 普通充值流程（仍然支持）：
 * 1. 玩家 approve MOE 给本合约
 * 2. 玩家调用 deposit(amount)
 * 3. MOE 从玩家转到 owner
 *
 * 经济闭环：
 * 玩家充值 → Owner → Factory 补充 → VestingWallet → 玩家提现
 */
contract DepositContract is ReentrancyGuard {

    MOEToken public immutable moeToken;
    address public immutable recipient; // 收款地址（Owner）

    struct Deposit {
        address player;
        uint256 amount;
        uint256 timestamp;
        bytes32 txHash;
    }

    // 所有充值记录
    Deposit[] public deposits;

    // 玩家地址 => 充值索引数组
    mapping(address => uint256[]) public playerDepositIndices;

    /**
     * @dev 当玩家充值时触发
     * @param player 玩家地址
     * @param amount 充值金额
     * @param timestamp 充值时间
     * @param txHash 交易哈希（用于追踪）
     */
    event DepositMade(
        address indexed player,
        uint256 amount,
        uint256 timestamp,
        bytes32 txHash
    );

    /**
     * @dev 构造函数
     * @param _moeToken MOEToken 合约地址
     * @param _recipient 收款地址（Owner）
     */
    constructor(address _moeToken, address _recipient) {
        require(_moeToken != address(0), "DepositContract: MOEToken is zero address");
        require(_recipient != address(0), "DepositContract: Recipient is zero address");

        moeToken = MOEToken(_moeToken);
        recipient = _recipient;
    }

    /**
     * @dev 普通充值（玩家自己付 gas）
     * @param amount 充值金额
     *
     * 要求：
     * - 玩家必须先 approve 足够的 MOE 给本合约
     * - amount 必须大于 0
     */
    function deposit(uint256 amount) external nonReentrant {
        _processDeposit(msg.sender, amount);
    }

    /**
     * @dev Gasless 充值（使用 ERC-2612 Permit）
     * @param player 玩家地址
     * @param amount 充值金额
     * @param deadline Permit 截止时间
     * @param v, r, s Permit 签名
     *
     * 流程：
     * 1. 玩家 off-chain 签名 permit
     * 2. Backend 调用此函数（backend 付 gas）
     * 3. 使用 permit 批准
     * 4. 转账到 recipient（Owner）
     *
     * 要求：
     * - permit 签名必须有效
     * - amount 必须大于 0
     * - 玩家必须有足够的 MOE 余额
     *
     * Gas 消耗：约 80,000 gas（由 Backend 支付）
     */
    function depositWithPermit(
        address player,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        // 使用 ERC-2612 permit 批准
        moeToken.permit(player, address(this), amount, deadline, v, r, s);

        // 处理充值
        _processDeposit(player, amount);
    }

    /**
     * @dev 内部充值处理函数
     * @param player 玩家地址
     * @param amount 充值金额
     */
    function _processDeposit(address player, uint256 amount) internal {
        require(amount > 0, "DepositContract: amount must be positive");

        // 转账到 recipient（Owner）
        moeToken.transferFrom(player, recipient, amount);

        // 记录充值信息
        bytes32 txHash = blockhash(block.number - 1);
        deposits.push(Deposit({
            player: player,
            amount: amount,
            timestamp: block.timestamp,
            txHash: txHash
        }));

        uint256 depositIndex = deposits.length - 1;
        playerDepositIndices[player].push(depositIndex);

        emit DepositMade(player, amount, block.timestamp, txHash);
    }

    // ========== 查询函数 ==========

    /**
     * @dev 获取总充值数
     * @return uint256 总充值记录数
     */
    function getTotalDeposits() external view returns (uint256) {
        return deposits.length;
    }

    /**
     * @dev 获取指定索引的充值记录
     * @param index 充值索引
     * @return player 玩家地址
     * @return amount 充值金额
     * @return timestamp 充值时间
     * @return txHash 交易哈希
     */
    function getDeposit(uint256 index)
        external
        view
        returns (address player, uint256 amount, uint256 timestamp, bytes32 txHash)
    {
        require(index < deposits.length, "DepositContract: invalid deposit index");
        Deposit memory d = deposits[index];
        return (d.player, d.amount, d.timestamp, d.txHash);
    }

    /**
     * @dev 获取玩家的所有充值索引
     * @param player 玩家地址
     * @return uint256[] 充值索引数组
     */
    function getPlayerDepositIndices(address player)
        external
        view
        returns (uint256[] memory)
    {
        return playerDepositIndices[player];
    }

    /**
     * @dev 获取玩家的所有充值记录
     * @param player 玩家地址
     * @return Deposit[] 充值记录数组
     */
    function getPlayerDeposits(address player)
        external
        view
        returns (Deposit[] memory)
    {
        uint256[] memory indices = playerDepositIndices[player];
        Deposit[] memory playerDeposits = new Deposit[](indices.length);

        for (uint256 i = 0; i < indices.length; i++) {
            playerDeposits[i] = deposits[indices[i]];
        }

        return playerDeposits;
    }

    /**
     * @dev 获取最近的 N 条充值记录
     * @param count 数量
     * @return Deposit[] 充值记录数组（倒序，最新的在前）
     */
    function getRecentDeposits(uint256 count)
        external
        view
        returns (Deposit[] memory)
    {
        if (count > deposits.length) {
            count = deposits.length;
        }

        Deposit[] memory recentDeposits = new Deposit[](count);
        uint256 startIndex = deposits.length - count;

        for (uint256 i = 0; i < count; i++) {
            recentDeposits[i] = deposits[startIndex + i];
        }

        return recentDeposits;
    }
}
