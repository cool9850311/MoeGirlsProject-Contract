const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VestingWalletFactory", function () {
  let MOEToken;
  let VestingWalletFactory;
  let StageBasedVestingWallet;
  let moeToken;
  let factory;
  let owner;
  let player1;
  let player2;

  beforeEach(async function () {
    [owner, player1, player2] = await ethers.getSigners();

    // Deploy MOEToken (auto mints 10M to owner)
    MOEToken = await ethers.getContractFactory("MOEToken");
    moeToken = await MOEToken.deploy(owner.address);
    await moeToken.deployed();

    // Deploy VestingWalletFactory
    VestingWalletFactory = await ethers.getContractFactory("VestingWalletFactory");
    factory = await VestingWalletFactory.deploy(moeToken.address, owner.address);
    await factory.deployed();

    // Transfer MOE to Factory (5M)
    const factoryAllocation = ethers.utils.parseEther("5000000");
    await moeToken.transfer(factory.address, factoryAllocation);
  });

  describe("Deployment", function () {
    it("Should set the correct MOEToken address", async function () {
      expect(await factory.moeToken()).to.equal(moeToken.address);
    });

    it("Should set the correct owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("Should have correct balance after transfer", async function () {
      const expectedBalance = ethers.utils.parseEther("5000000");
      expect(await factory.getBalance()).to.equal(expectedBalance);
    });

    it("Should revert if MOEToken address is zero", async function () {
      await expect(
        VestingWalletFactory.deploy(ethers.constants.AddressZero, owner.address)
      ).to.be.revertedWith("Factory: MOEToken is zero address");
    });
  });

  describe("Creating Vesting", function () {
    it("Should allow owner to create vesting", async function () {
      const amount = ethers.utils.parseEther("100");

      await expect(factory.createVesting(player1.address, amount))
        .to.emit(factory, "VestingCreated");

      expect(await factory.getTotalVestingWallets()).to.equal(1);
    });

    it("Should transfer MOE to VestingWallet", async function () {
      const amount = ethers.utils.parseEther("100");
      const initialFactoryBalance = await factory.getBalance();

      const tx = await factory.createVesting(player1.address, amount);
      const receipt = await tx.wait();

      // Get VestingWallet address from event
      const event = receipt.events?.find(e => e.event === "VestingCreated");
      const vestingWallet = event.args.vestingWallet;

      // Check balances
      expect(await moeToken.balanceOf(vestingWallet)).to.equal(amount);
      expect(await factory.getBalance()).to.equal(initialFactoryBalance.sub(amount));
    });

    it("Should create multiple vestings with incrementing records", async function () {
      const amount1 = ethers.utils.parseEther("100");
      const amount2 = ethers.utils.parseEther("200");

      await factory.createVesting(player1.address, amount1);
      await factory.createVesting(player2.address, amount2);

      expect(await factory.getTotalVestingWallets()).to.equal(2);
    });

    it("Should track player vesting wallets", async function () {
      const amount1 = ethers.utils.parseEther("100");
      const amount2 = ethers.utils.parseEther("200");

      await factory.createVesting(player1.address, amount1);
      await factory.createVesting(player1.address, amount2);

      const player1Wallets = await factory.getPlayerVestingWallets(player1.address);
      expect(player1Wallets.length).to.equal(2);
    });

    it("Should revert if non-owner tries to create vesting", async function () {
      const amount = ethers.utils.parseEther("100");

      await expect(
        factory.connect(player1).createVesting(player2.address, amount)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should revert if beneficiary is zero address", async function () {
      const amount = ethers.utils.parseEther("100");

      await expect(
        factory.createVesting(ethers.constants.AddressZero, amount)
      ).to.be.revertedWith("Factory: beneficiary is zero address");
    });

    it("Should revert if amount is zero", async function () {
      await expect(
        factory.createVesting(player1.address, 0)
      ).to.be.revertedWith("Factory: amount must be positive");
    });

    it("Should revert if amount is not divisible by 4", async function () {
      const amount = ethers.BigNumber.from("101"); // not divisible by 4

      await expect(
        factory.createVesting(player1.address, amount)
      ).to.be.revertedWith("Factory: amount must be divisible by 4");
    });

    it("Should revert if factory has insufficient balance", async function () {
      const amount = ethers.utils.parseEther("10000000"); // More than factory has

      await expect(
        factory.createVesting(player1.address, amount)
      ).to.be.revertedWith("Factory: insufficient MOE balance");
    });
  });

  describe("VestingWallet Integration", function () {
    it("Should create functional VestingWallet", async function () {
      const amount = ethers.utils.parseEther("100");

      const tx = await factory.createVesting(player1.address, amount);
      const receipt = await tx.wait();

      const event = receipt.events?.find(e => e.event === "VestingCreated");
      const vestingWalletAddress = event.args.vestingWallet;

      // Get VestingWallet contract instance
      const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
      const vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

      // Verify VestingWallet properties
      expect(await vestingWallet.owner()).to.equal(player1.address);
      expect(await vestingWallet.duration()).to.equal(120);
      expect(await moeToken.balanceOf(vestingWalletAddress)).to.equal(amount);
    });

    it("Should allow player to claim after stage unlock", async function () {
      const amount = ethers.utils.parseEther("100");

      const tx = await factory.createVesting(player1.address, amount);
      const receipt = await tx.wait();

      const event = receipt.events?.find(e => e.event === "VestingCreated");
      const vestingWalletAddress = event.args.vestingWallet;

      // Use ethers.Contract with custom ABI to access inherited VestingWallet functions
      const vestingWalletABI = [
        "function release(address token) public",
        "function released(address token) public view returns (uint256)",
        "function owner() public view returns (address)"
      ];
      const vestingWallet = new ethers.Contract(
        vestingWalletAddress,
        vestingWalletABI,
        ethers.provider
      );

      // Wait 30 seconds
      await ethers.provider.send("evm_increaseTime", [30]);
      await ethers.provider.send("evm_mine");

      // Player should have 0 balance before claim
      expect(await moeToken.balanceOf(player1.address)).to.equal(0);

      // Claim 25%
      await vestingWallet.connect(player1).release(moeToken.address);

      // Player should now have 25% (25 MOE)
      expect(await moeToken.balanceOf(player1.address)).to.equal(ethers.utils.parseEther("25"));
    });
  });

  describe("Query Functions", function () {
    beforeEach(async function () {
      // Create some vestings
      await factory.createVesting(player1.address, ethers.utils.parseEther("100"));
      await factory.createVesting(player1.address, ethers.utils.parseEther("200"));
      await factory.createVesting(player2.address, ethers.utils.parseEther("150"));
    });

    it("Should return correct total vesting wallets", async function () {
      expect(await factory.getTotalVestingWallets()).to.equal(3);
    });

    it("Should return correct player vesting wallets", async function () {
      const player1Wallets = await factory.getPlayerVestingWallets(player1.address);
      const player2Wallets = await factory.getPlayerVestingWallets(player2.address);

      expect(player1Wallets.length).to.equal(2);
      expect(player2Wallets.length).to.equal(1);
    });

    it("Should return empty array for player with no vestings", async function () {
      const [, , , noVestingsPlayer] = await ethers.getSigners();
      const wallets = await factory.getPlayerVestingWallets(noVestingsPlayer.address);

      expect(wallets.length).to.equal(0);
    });

    it("Should return correct factory balance", async function () {
      const expectedBalance = ethers.utils.parseEther("5000000")
        .sub(ethers.utils.parseEther("100"))
        .sub(ethers.utils.parseEther("200"))
        .sub(ethers.utils.parseEther("150"));

      expect(await factory.getBalance()).to.equal(expectedBalance);
    });
  });

  describe("Factory Refill", function () {
    it("Should allow owner to refill factory balance via transfer", async function () {
      const initialBalance = await factory.getBalance();
      const refillAmount = ethers.utils.parseEther("1000000");

      await moeToken.transfer(factory.address, refillAmount);

      expect(await factory.getBalance()).to.equal(initialBalance.add(refillAmount));
    });

    it("Should allow owner to refill factory balance via mint", async function () {
      const initialBalance = await factory.getBalance();
      const mintAmount = ethers.utils.parseEther("1000000");

      await moeToken.mint(factory.address, mintAmount);

      expect(await factory.getBalance()).to.equal(initialBalance.add(mintAmount));
    });
  });
});
