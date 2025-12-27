// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MOEToken
 * @dev MoeGirls 游戏代币
 *
 * 特性：
 * - ERC20 标准代币
 * - ERC20Permit: 支持 gasless approval (EIP-2612)
 * - 初始供应量: 10,000,000 MOE
 * - 可增发: Owner 可以 mint 新的代币
 *
 * 经济模型：
 * - 部署时 mint 10,000,000 MOE 到 owner
 * - Owner 分配 50% 到 VestingWalletFactory
 * - 玩家充值 → Owner (闭环)
 * - Owner 可随时 mint 补充 Factory
 */
contract MOEToken is ERC20, ERC20Permit, Ownable {

    /**
     * @dev 当新的 MOE 代币被铸造时触发
     * @param to 接收地址
     * @param amount 铸造数量
     */
    event MOEMinted(address indexed to, uint256 amount);

    /**
     * @dev 构造函数
     * @param initialOwner 合约所有者地址
     *
     * 初始化代币并 mint 10,000,000 MOE 到 owner
     */
    constructor(address initialOwner)
        ERC20("MoeGirls Token", "MOE")
        ERC20Permit("MoeGirls Token")
        Ownable(initialOwner)
    {
        // 初始 mint 10,000,000 MOE 到 owner
        uint256 initialSupply = 10_000_000 * 10**decimals();
        _mint(initialOwner, initialSupply);
        emit MOEMinted(initialOwner, initialSupply);
    }

    /**
     * @dev 铸造新的 MOE 代币
     * @param to 接收地址
     * @param amount 铸造数量
     *
     * 要求：
     * - 只有 owner 可以调用
     * - to 地址不能为零地址
     * - amount 必须大于 0
     *
     * 用途：
     * - 补充 VestingWalletFactory 余额
     * - 游戏活动奖励
     * - 其他经济需求
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "MOEToken: mint to zero address");
        require(amount > 0, "MOEToken: mint amount must be positive");

        _mint(to, amount);
        emit MOEMinted(to, amount);
    }
}
