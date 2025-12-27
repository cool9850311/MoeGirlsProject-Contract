const { ethers } = require("hardhat");

/**
 * MoeGirls Project 部署脚本 v2.0
 *
 * 部署顺序：
 * 1. 部署 MOEToken（自动 mint 1000万到 owner）
 * 2. 部署 VestingWalletFactory
 * 3. 转账 500万 MOE 到 Factory
 * 4. 部署 DepositContract（recipient 设为 owner）
 *
 * 经济模型：
 * - 初始供应：10,000,000 MOE（部署时自动 mint）
 * - Owner 保留：5,000,000 MOE（50%）
 * - Factory 池子：5,000,000 MOE（50%）
 * - 玩家充值 → Owner（闭环）
 * - Owner 可随时补充 Factory
 */

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("部署 MoeGirls Project 合约 v2.0");
  console.log("=".repeat(60));
  console.log("部署账户（Owner）:", deployer.address);
  console.log("账户余额:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");
  console.log("");

  // 配置
  const FACTORY_ALLOCATION = ethers.utils.parseEther("5000000"); // 500万给 Factory

  console.log("📋 配置:");
  console.log("  初始总供应: 10,000,000 MOE (自动 mint)");
  console.log("  Factory 分配:", ethers.utils.formatEther(FACTORY_ALLOCATION), "MOE");
  console.log("  Owner 保留: 5,000,000 MOE");
  console.log("");

  // 1. 部署 MOEToken（自动 mint 1000万到 deployer）
  console.log("1️⃣  部署 MOEToken...");
  const MOEToken = await ethers.getContractFactory("MOEToken");
  const moeToken = await MOEToken.deploy(deployer.address);
  await moeToken.deployed();
  console.log("   ✅ MOEToken 部署到:", moeToken.address);
  console.log("   💰 初始供应:", ethers.utils.formatEther(await moeToken.totalSupply()), "MOE");
  console.log("   💰 Owner 余额:", ethers.utils.formatEther(await moeToken.balanceOf(deployer.address)), "MOE");
  console.log("");

  // 2. 部署 VestingWalletFactory
  console.log("2️⃣  部署 VestingWalletFactory...");
  const Factory = await ethers.getContractFactory("VestingWalletFactory");
  const factory = await Factory.deploy(moeToken.address, deployer.address);
  await factory.deployed();
  console.log("   ✅ VestingWalletFactory 部署到:", factory.address);
  console.log("");

  // 3. 转账 MOE 到 Factory
  console.log("3️⃣  转账 MOE 到 Factory...");
  let tx = await moeToken.transfer(factory.address, FACTORY_ALLOCATION);
  await tx.wait();
  console.log("   ✅ 已转账", ethers.utils.formatEther(FACTORY_ALLOCATION), "MOE 到 Factory");
  console.log("   💰 Factory 余额:", ethers.utils.formatEther(await factory.getBalance()), "MOE");
  console.log("");

  // 4. 部署 DepositContract（recipient 设为 deployer 即 owner）
  console.log("4️⃣  部署 DepositContract...");
  const DepositContract = await ethers.getContractFactory("DepositContract");
  const depositContract = await DepositContract.deploy(
    moeToken.address,
    deployer.address  // recipient 设为 owner
  );
  await depositContract.deployed();
  console.log("   ✅ DepositContract 部署到:", depositContract.address);
  console.log("   🏦 收款地址（recipient）:", deployer.address);
  console.log("");

  // 验证余额
  console.log("5️⃣  验证余额...");
  const ownerBalance = await moeToken.balanceOf(deployer.address);
  const factoryBalance = await moeToken.balanceOf(factory.address);
  const totalSupply = await moeToken.totalSupply();

  console.log("   💰 Owner 余额:", ethers.utils.formatEther(ownerBalance), "MOE");
  console.log("   💰 Factory 余额:", ethers.utils.formatEther(factoryBalance), "MOE");
  console.log("   📊 总供应量:", ethers.utils.formatEther(totalSupply), "MOE");
  console.log("");

  // 总结
  console.log("=".repeat(60));
  console.log("✅ 部署完成！");
  console.log("=".repeat(60));
  console.log("");
  console.log("📋 合约地址:");
  console.log("   MOEToken:              ", moeToken.address);
  console.log("   VestingWalletFactory:  ", factory.address);
  console.log("   DepositContract:       ", depositContract.address);
  console.log("   Owner (Recipient):     ", deployer.address);
  console.log("");
  console.log("🔑 网络信息:");
  const network = await ethers.provider.getNetwork();
  console.log("   网络名称:", network.name);
  console.log("   Chain ID:", network.chainId);
  console.log("");
  console.log("💡 后续步骤:");
  console.log("   1. 保存合约地址到 .env 文件");
  console.log("   2. 在区块浏览器上验证合约:");
  console.log("      npx hardhat verify --network <network> <address>");
  console.log("   3. 配置 Backend:");
  console.log("      - MOE_TOKEN_ADDRESS=" + moeToken.address);
  console.log("      - FACTORY_ADDRESS=" + factory.address);
  console.log("      - DEPOSIT_CONTRACT_ADDRESS=" + depositContract.address);
  console.log("");
  console.log("📊 经济模型（闭环）:");
  console.log("   1. 玩家充值:");
  console.log("      玩家签名 permit → Backend 调用 depositWithPermit");
  console.log("      → MOE 转账到 Owner");
  console.log("   2. 玩家提现:");
  console.log("      Backend 调用 factory.createVesting(player, amount)");
  console.log("      → 创建 StageBasedVestingWallet");
  console.log("      → MOE 从 Factory 转到 VestingWallet");
  console.log("   3. 玩家领取:");
  console.log("      玩家调用 vestingWallet.release(moeToken)");
  console.log("      → 阶段解锁（30/60/90/120秒，各25%）");
  console.log("   4. Factory 补充:");
  console.log("      Owner 可随时 transfer 或 mint MOE 到 Factory");
  console.log("");
  console.log("🔄 闭环:");
  console.log("   Deposit → Owner → Factory → VestingWallet → Player");
  console.log("");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
