// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/finance/VestingWallet.sol";

/**
 * @title StageBasedVestingWallet
 * @dev 阶段式解锁的 VestingWallet（支持 EIP-1167 Minimal Proxy）
 *
 * 继承自 OpenZeppelin 的 VestingWallet，重写 vesting schedule 为阶段式解锁
 *
 * 解锁时间表：
 * - 0-29秒:   0% 解锁 (0 MOE 可领取)
 * - 30-59秒:  25% 解锁
 * - 60-89秒:  50% 解锁
 * - 90-119秒: 75% 解锁
 * - 120秒+:   100% 解锁
 *
 * 示例（100 MOE）：
 * - T=0s:   0 MOE 可领取
 * - T=30s:  25 MOE 可领取
 * - T=60s:  50 MOE 可领取（累计）
 * - T=90s:  75 MOE 可领取（累计）
 * - T=120s: 100 MOE 可领取（累计）
 *
 * EIP-1167 支持：
 * 1. VestingWalletFactory 部署一次实现合约
 * 2. 使用 Clones.clone() 创建 minimal proxy
 * 3. 调用 initialize() 初始化每个 proxy
 * 4. Gas 成本从 ~150k 降低到 ~50k
 */
contract StageBasedVestingWallet is VestingWallet {
    // 防止重复初始化
    bool private _initialized;

    // 阶段时间点（累计秒数）
    uint64[4] private stageTimes;

    // 阶段解锁百分比（basis points: 10000 = 100%）
    uint256[4] private stagePercents;

    /**
     * @dev 构造函数（仅用于实现合约）
     *
     * 部署实现合约时使用一个虚拟地址（避免零地址错误）
     * Proxy 实例会通过 initialize() 进行初始化
     *
     * 注意：实现合约的 beneficiary 设为 address(1) 作为标记
     *       这个地址永远不会被使用，因为实现合约已被标记为初始化完成
     */
    constructor() VestingWallet(address(1), 0, 0) {
        // 标记实现合约为已初始化，防止被直接使用
        _initialized = true;
    }

    /**
     * @dev 初始化函数（替代构造函数，用于 proxy）
     * @param beneficiary 受益人地址（玩家）
     * @param startTimestamp Vesting 开始时间（Unix timestamp）
     *
     * 要求：
     * - 只能调用一次
     * - beneficiary 不能为零地址
     *
     * 注意：这个函数没有访问控制，因为每个 proxy 只能初始化一次
     *       VestingWalletFactory 在创建后立即调用
     */
    function initialize(address beneficiary, uint64 startTimestamp) external {
        require(!_initialized, "Already initialized");
        require(beneficiary != address(0), "Beneficiary is zero address");

        _initialized = true;

        // 初始化阶段配置
        stageTimes = [30, 60, 90, 120];
        stagePercents = [2500, 5000, 7500, 10000];

        // 转移所有权给受益人
        // 注意：VestingWallet 继承自 Ownable，owner 初始是部署者
        // 我们需要在这里设置正确的 owner 和 vesting 参数

        // 由于 VestingWallet 的 start/duration 是 immutable，
        // 我们需要用不同的方法来存储这些值
        // 实际上，我们需要修改继承方式

        // 将所有权转移给受益人
        _transferOwnership(beneficiary);

        // 存储 vesting 参数（需要添加状态变量）
        _setVestingParams(startTimestamp, 120);
    }

    // 存储 vesting 开始时间和持续时间
    uint64 private _startTimestamp;
    uint64 private _durationSeconds;

    /**
     * @dev 内部函数：设置 vesting 参数
     */
    function _setVestingParams(uint64 startTimestamp, uint64 durationSeconds) private {
        _startTimestamp = startTimestamp;
        _durationSeconds = durationSeconds;
    }

    /**
     * @dev 重写 start() 返回存储的开始时间
     */
    function start() public view virtual override returns (uint256) {
        return _startTimestamp;
    }

    /**
     * @dev 重写 duration() 返回存储的持续时间
     */
    function duration() public view virtual override returns (uint256) {
        return _durationSeconds;
    }

    /**
     * @dev 重写 vesting schedule 为阶段式解锁
     * @param totalAllocation 总分配金额
     * @param timestamp 查询时间点
     * @return 截至该时间点应该解锁的总金额
     *
     * 算法：
     * - 如果 timestamp < start，返回 0
     * - 计算 elapsed = timestamp - start
     * - 根据 elapsed 返回对应阶段的解锁百分比
     * - 阶段之间不做插值，直接返回前一阶段的解锁量
     *
     * 示例（totalAllocation = 100 MOE）：
     * - elapsed < 30s:  返回 0
     * - 30s <= elapsed < 60s:  返回 25 MOE (25%)
     * - 60s <= elapsed < 90s:  返回 50 MOE (50%)
     * - 90s <= elapsed < 120s: 返回 75 MOE (75%)
     * - elapsed >= 120s: 返回 100 MOE (100%)
     */
    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp)
        internal
        view
        virtual
        override
        returns (uint256)
    {
        if (timestamp < start()) {
            return 0;
        }

        uint64 elapsed = timestamp - uint64(start());
        uint256 stageCount = stageTimes.length; // Gas 优化: 缓存数组长度

        // 遍历阶段，找到当前应该解锁的比例
        for (uint i = 0; i < stageCount; i++) {
            if (elapsed < stageTimes[i]) {
                // 在第 i 阶段之前，返回上一阶段的解锁量
                if (i == 0) {
                    return 0; // 第一阶段之前，未解锁
                }
                return (totalAllocation * stagePercents[i - 1]) / 10000;
            }
        }

        // 超过最后阶段，全部解锁
        return totalAllocation;
    }

    /**
     * @dev 获取阶段信息（用于前端展示）
     * @return times 阶段时间点数组 [30, 60, 90, 120]
     * @return percents 阶段解锁百分比数组（basis points）[2500, 5000, 7500, 10000]
     */
    function getStageInfo() external view returns (
        uint64[4] memory times,
        uint256[4] memory percents
    ) {
        return (stageTimes, stagePercents);
    }

    /**
     * @dev 检查是否已初始化
     */
    function initialized() external view returns (bool) {
        return _initialized;
    }
}
