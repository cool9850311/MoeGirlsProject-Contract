// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./StageBasedVestingWalletLegacy.sol";
import "./MOEToken.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title VestingWalletFactoryLegacy
 * @dev 旧实现：使用 new 部署完整合约（用于 gas 对比测试）
 *
 * 这是 EIP-1167 优化前的实现方式
 * 每次调用 createVesting 都会部署完整的合约字节码（~150k gas）
 */
contract VestingWalletFactoryLegacy is Ownable {
    MOEToken public immutable moeToken;

    mapping(address => address[]) public playerVestingWallets;
    address[] public allVestingWallets;

    event VestingCreated(
        address indexed beneficiary,
        address indexed vestingWallet,
        uint256 amount,
        uint64 startTime
    );

    constructor(address _moeToken, address initialOwner) Ownable(initialOwner) {
        require(_moeToken != address(0), "Factory: MOEToken is zero address");
        moeToken = MOEToken(_moeToken);
    }

    /**
     * @dev 旧方式：使用 new 创建完整合约
     */
    function createVesting(address beneficiary, uint256 amount)
        external
        onlyOwner
        returns (address vestingWallet)
    {
        require(beneficiary != address(0), "Factory: beneficiary is zero address");
        require(amount > 0, "Factory: amount must be positive");
        require(amount % 4 == 0, "Factory: amount must be divisible by 4");
        require(
            moeToken.balanceOf(address(this)) >= amount,
            "Factory: insufficient MOE balance"
        );

        // 旧方式：部署完整合约
        StageBasedVestingWalletLegacy wallet = new StageBasedVestingWalletLegacy(
            beneficiary,
            uint64(block.timestamp)
        );
        vestingWallet = address(wallet);

        playerVestingWallets[beneficiary].push(vestingWallet);
        allVestingWallets.push(vestingWallet);

        require(
            moeToken.transfer(vestingWallet, amount),
            "Factory: transfer failed"
        );

        emit VestingCreated(beneficiary, vestingWallet, amount, uint64(block.timestamp));

        return vestingWallet;
    }

    function getPlayerVestingWallets(address player)
        external
        view
        returns (address[] memory)
    {
        return playerVestingWallets[player];
    }

    function getTotalVestingWallets() external view returns (uint256) {
        return allVestingWallets.length;
    }

    function getBalance() external view returns (uint256) {
        return moeToken.balanceOf(address(this));
    }
}
