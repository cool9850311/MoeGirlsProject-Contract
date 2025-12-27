// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/finance/VestingWallet.sol";

/**
 * @title StageBasedVestingWallet
 * @dev 阶段式解锁的 VestingWallet
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
 * 用法：
 * 1. VestingWalletFactory 创建实例并转入 MOE
 * 2. 玩家调用 release(moeToken) 领取
 * 3. 任何人可以调用，但代币只发给 owner (beneficiary)
 */
contract StageBasedVestingWallet is VestingWallet {
    // 阶段时间点（累计秒数）
    uint64[4] private stageTimes = [30, 60, 90, 120];

    // 阶段解锁百分比（basis points: 10000 = 100%）
    uint256[4] private stagePercents = [2500, 5000, 7500, 10000];

    /**
     * @dev 构造函数
     * @param beneficiary 受益人地址（玩家）
     * @param startTimestamp Vesting 开始时间（Unix timestamp）
     *
     * duration 固定为 120 秒
     */
    constructor(address beneficiary, uint64 startTimestamp)
        VestingWallet(beneficiary, startTimestamp, 120) // duration = 120秒
    {}

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
}
