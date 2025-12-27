# MoeGirls Project - Smart Contracts

完整的智能合约开发环境，包含安全分析工具。

## 🛠️ 已安装工具

### 开发框架
- ✅ **Hardhat 2.19.x** - 智能合约开发框架
- ✅ **Hardhat Toolbox** - 包含测试、部署等常用工具
- ✅ **OpenZeppelin Contracts 5.0+** - 安全的合约库

### 安全分析工具
- ✅ **Slither 0.11.3** - 静态分析工具，检测常见漏洞
- ✅ **Mythril 0.24.8** - 符号执行工具，深度安全分析
- ✅ **Solc 0.8.28** - Solidity 编译器

## 📁 项目结构

```
MoeGirlsProject-Contract/
├── contracts/          # 智能合约源码
│   └── HelloWorld.sol # 测试合约
├── test/              # 测试文件
│   └── HelloWorld.test.js
├── scripts/           # 部署脚本
├── hardhat.config.js  # Hardhat 配置
├── .env.example       # 环境变量示例
└── README.md          # 本文件
```

## 🚀 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 编译合约
```bash
npm run compile
```

### 3. 运行测试
```bash
npm test
```

### 4. 运行安全分析

#### Slither 静态分析
```bash
npm run slither
```

#### Mythril 符号执行
```bash
myth analyze contracts/HelloWorld.sol --execution-timeout 30
```

## ✅ 环境验证结果

所有工具已成功安装并验证：

### Hardhat 编译
```
✅ Compiled 1 Solidity file successfully
```

### Hardhat 测试
```
✅ HelloWorld
    ✅ Deployment
      ✅ Should set the default message
    ✅ setMessage
      ✅ Should update the message
      ✅ Should emit MessageUpdated event

  3 passing (409ms)
```

### Slither 分析
```
✅ INFO:Slither:. analyzed (1 contracts with 100 detectors), 0 result(s) found
```

### Mythril 分析
```
✅ The analysis was completed successfully. No issues were detected.
```

## 📝 NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm test` | 运行测试 |
| `npm run compile` | 编译合约 |
| `npm run clean` | 清理编译产物 |
| `npm run slither` | 运行 Slither 分析 |

## 🔧 配置文件

### hardhat.config.js
- Solidity 版本：0.8.28
- 优化器：已启用 (runs: 200)
- 网络：Hardhat 本地网络 + Arbitrum Sepolia

### .env 示例
```bash
# 复制 .env.example 到 .env 并填入实际值
PRIVATE_KEY=your_private_key_here
ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
ARBISCAN_API_KEY=your_arbiscan_api_key_here
```

## 📦 依赖版本

```json
{
  "hardhat": "^2.19.0",
  "@nomicfoundation/hardhat-toolbox": "^2.0.0",
  "@openzeppelin/contracts": "^5.0.0",
  "slither-analyzer": "0.11.3",
  "mythril": "0.24.8"
}
```

## ⚠️ 注意事项

1. **Node.js 版本**: 当前使用 Node.js 23.6.0，建议使用 LTS 版本 (22.x) 以获得最佳兼容性
2. **Slither**: 需要 Python 3.9+
3. **Mythril**: 需要 Python 3.9+ 和 Z3 Solver
4. **Solc**: 通过 solc-select 管理版本

## 🔐 安全最佳实践

- ✅ 编译时启用优化器
- ✅ 使用 OpenZeppelin 安全合约库
- ✅ 每次提交前运行 Slither 检查
- ✅ 重要合约部署前运行 Mythril 深度分析
- ✅ 100% 测试覆盖率
- ✅ 使用 .env 文件管理敏感信息（不要提交到 Git）

## 📚 下一步

环境已完全配置好，可以开始实现以下合约：

1. **MOEToken.sol** - ERC20 代币合约
2. **CardNFT.sol** - ERC721 NFT 合约
3. **VestingContract.sol** - 锁仓合约
4. **DepositContract.sol** - 充值合约

## 🐛 常见问题

### Q: Slither 报告依赖冲突警告
A: 这是正常的，Slither 和 Mythril 需要不同版本的某些库，不影响使用。

### Q: Mythril 分析时间过长
A: 使用 `--execution-timeout` 参数限制分析时间，例如 `--execution-timeout 30`

### Q: 编译时 Node.js 版本警告
A: 考虑使用 nvm 切换到 Node.js 22 LTS 版本

---

**开发环境配置完成！** 🎉

所有工具已验证可用，可以开始智能合约开发。
