const { ethers } = require("hardhat");

/**
 * Deploy all contracts for EOA + Permit testing
 *
 * Architecture: EOA + EIP-2612/ERC-7604 Permit + Backend Relayer
 * - Users use MetaMask EOA addresses
 * - Gasless approvals via Permit signatures
 * - Backend pays all gas fees
 */
async function deployContractsFixture() {
    const [deployer, user1, user2, relayer] = await ethers.getSigners();

    // 1. Deploy MOE Token (with EIP-2612 Permit)
    const MOEToken = await ethers.getContractFactory("MOEToken");
    const moeToken = await MOEToken.deploy(deployer.address);
    await moeToken.deployed();

    // 2. Deploy DepositContract
    const DepositContract = await ethers.getContractFactory("DepositContract");
    const depositContract = await DepositContract.deploy(
        moeToken.address,
        deployer.address,
        deployer.address
    );
    await depositContract.deployed();

    // 3. Deploy VestingWalletFactory
    const VestingFactory = await ethers.getContractFactory("VestingWalletFactory");
    const vestingFactory = await VestingFactory.deploy(
        moeToken.address,
        deployer.address
    );
    await vestingFactory.deployed();

    // 4. Deploy MoeGirlsNFT (with ERC1155Permit)
    const MoeGirlsNFT = await ethers.getContractFactory("MoeGirlsNFT");
    const nft = await MoeGirlsNFT.deploy(moeToken.address);
    await nft.deployed();

    // 5. Deploy MoeGirlsMarketplace
    const MoeGirlsMarketplace = await ethers.getContractFactory("MoeGirlsMarketplace");
    const marketplace = await MoeGirlsMarketplace.deploy(nft.address, moeToken.address);
    await marketplace.deployed();

    // 6. Initial Setup: Fund users with MOE
    await moeToken.mint(user1.address, ethers.utils.parseEther("10000"));
    await moeToken.mint(user2.address, ethers.utils.parseEther("10000"));

    // 7. Fund VestingFactory for withdrawals
    await moeToken.mint(vestingFactory.address, ethers.utils.parseEther("100000"));

    return {
        deployer,
        user1,
        user2,
        relayer,
        moeToken,
        depositContract,
        vestingFactory,
        nft,
        marketplace
    };
}

module.exports = { deployContractsFixture };
