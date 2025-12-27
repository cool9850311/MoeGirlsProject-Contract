// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/finance/VestingWallet.sol";

/**
 * @title StageBasedVestingWalletLegacy
 * @dev 旧实现：每次使用 new 部署完整合约（用于 gas 对比测试）
 *
 * 这是 EIP-1167 优化前的实现方式
 * 每次调用 createVesting 都会部署完整的合约字节码
 */
contract StageBasedVestingWalletLegacy is VestingWallet {
    // 阶段时间点（累计秒数）
    uint64[4] private stageTimes = [30, 60, 90, 120];

    // 阶段解锁百分比（basis points: 10000 = 100%）
    uint256[4] private stagePercents = [2500, 5000, 7500, 10000];

    /**
     * @dev 构造函数（旧方式）
     * @param beneficiary 受益人地址（玩家）
     * @param startTimestamp Vesting 开始时间（Unix timestamp）
     *
     * duration 固定为 120 秒
     */
    constructor(address beneficiary, uint64 startTimestamp)
        VestingWallet(beneficiary, startTimestamp, 120)
    {}

    /**
     * @dev 重写 vesting schedule 为阶段式解锁
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
        uint256 stageCount = stageTimes.length;

        for (uint i = 0; i < stageCount; i++) {
            if (elapsed < stageTimes[i]) {
                if (i == 0) {
                    return 0;
                }
                return (totalAllocation * stagePercents[i - 1]) / 10000;
            }
        }

        return totalAllocation;
    }

    function getStageInfo() external view returns (
        uint64[4] memory times,
        uint256[4] memory percents
    ) {
        return (stageTimes, stagePercents);
    }
}
