const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DepositContract", function () {
  let MOEToken;
  let DepositContract;
  let moeToken;
  let depositContract;
  let owner;
  let player1;
  let player2;

  beforeEach(async function () {
    [owner, player1, player2] = await ethers.getSigners();

    // Deploy MOEToken (auto mints 10M to owner)
    MOEToken = await ethers.getContractFactory("MOEToken");
    moeToken = await MOEToken.deploy(owner.address);
    await moeToken.deployed();

    // Deploy DepositContract (recipient = owner)
    DepositContract = await ethers.getContractFactory("DepositContract");
    depositContract = await DepositContract.deploy(
      moeToken.address,
      owner.address  // recipient = owner
    );
    await depositContract.deployed();

    // Transfer MOE to players for testing
    await moeToken.transfer(player1.address, ethers.utils.parseEther("1000"));
    await moeToken.transfer(player2.address, ethers.utils.parseEther("500"));
  });

  describe("Deployment", function () {
    it("Should set the correct MOEToken address", async function () {
      expect(await depositContract.moeToken()).to.equal(moeToken.address);
    });

    it("Should set the correct recipient address", async function () {
      expect(await depositContract.recipient()).to.equal(owner.address);
    });

    it("Should initialize with zero deposits", async function () {
      expect(await depositContract.getTotalDeposits()).to.equal(0);
    });

    it("Should revert if MOEToken address is zero", async function () {
      await expect(
        DepositContract.deploy(ethers.constants.AddressZero, owner.address)
      ).to.be.revertedWith("DepositContract: MOEToken is zero address");
    });

    it("Should revert if Recipient address is zero", async function () {
      await expect(
        DepositContract.deploy(moeToken.address, ethers.constants.AddressZero)
      ).to.be.revertedWith("DepositContract: Recipient is zero address");
    });
  });

  describe("Depositing", function () {
    it("Should allow player to deposit MOE tokens", async function () {
      const depositAmount = ethers.utils.parseEther("100");

      // Player must approve first
      await moeToken.connect(player1).approve(depositContract.address, depositAmount);

      await expect(depositContract.connect(player1).deposit(depositAmount))
        .to.emit(depositContract, "DepositMade");

      // Check balances - tokens should go to owner (recipient)
      // Owner starts with 10M, transfers 1000 to player1 and 500 to player2 = 9,998,500
      // After deposit: 9,998,500 + 100 = 9,998,600
      expect(await moeToken.balanceOf(owner.address)).to.equal(
        ethers.utils.parseEther("9998600")
      );
      expect(await moeToken.balanceOf(player1.address)).to.equal(
        ethers.utils.parseEther("900")
      );
      expect(await depositContract.getTotalDeposits()).to.equal(1);
    });

    it("Should allow multiple deposits from same player", async function () {
      const deposit1 = ethers.utils.parseEther("100");
      const deposit2 = ethers.utils.parseEther("200");

      await moeToken.connect(player1).approve(depositContract.address, deposit1.add(deposit2));

      await depositContract.connect(player1).deposit(deposit1);
      await depositContract.connect(player1).deposit(deposit2);

      expect(await depositContract.getTotalDeposits()).to.equal(2);
    });

    it("Should allow deposits from multiple players", async function () {
      const deposit1 = ethers.utils.parseEther("100");
      const deposit2 = ethers.utils.parseEther("150");

      await moeToken.connect(player1).approve(depositContract.address, deposit1);
      await moeToken.connect(player2).approve(depositContract.address, deposit2);

      await depositContract.connect(player1).deposit(deposit1);
      await depositContract.connect(player2).deposit(deposit2);

      expect(await depositContract.getTotalDeposits()).to.equal(2);
    });

    it("Should revert if deposit amount is zero", async function () {
      await expect(
        depositContract.connect(player1).deposit(0)
      ).to.be.revertedWith("DepositContract: amount must be positive");
    });

    it("Should revert if player has insufficient balance", async function () {
      const depositAmount = ethers.utils.parseEther("2000");

      await moeToken.connect(player1).approve(depositContract.address, depositAmount);

      await expect(
        depositContract.connect(player1).deposit(depositAmount)
      ).to.be.reverted;
    });

    it("Should revert if player has insufficient allowance", async function () {
      const depositAmount = ethers.utils.parseEther("100");

      // Don't approve, or approve less
      await moeToken.connect(player1).approve(depositContract.address, ethers.utils.parseEther("50"));

      await expect(
        depositContract.connect(player1).deposit(depositAmount)
      ).to.be.reverted;
    });
  });

  describe("Querying Deposits", function () {
    beforeEach(async function () {
      // Create some test deposits
      const deposit1 = ethers.utils.parseEther("100");
      const deposit2 = ethers.utils.parseEther("200");
      const deposit3 = ethers.utils.parseEther("150");

      await moeToken.connect(player1).approve(depositContract.address, deposit1.add(deposit2));
      await moeToken.connect(player2).approve(depositContract.address, deposit3);

      await depositContract.connect(player1).deposit(deposit1);
      await depositContract.connect(player1).deposit(deposit2);
      await depositContract.connect(player2).deposit(deposit3);
    });

    it("Should return correct total deposits", async function () {
      expect(await depositContract.getTotalDeposits()).to.equal(3);
    });

    it("Should return correct deposit info by index", async function () {
      const [player, amount, timestamp, txHash] = await depositContract.getDeposit(0);

      expect(player).to.equal(player1.address);
      expect(amount).to.equal(ethers.utils.parseEther("100"));
      expect(timestamp).to.be.gt(0);
      expect(txHash).to.not.equal(ethers.constants.HashZero);
    });

    it("Should revert when querying invalid deposit index", async function () {
      await expect(
        depositContract.getDeposit(999)
      ).to.be.revertedWith("DepositContract: invalid deposit index");
    });

    it("Should return correct player deposit indices", async function () {
      const player1Indices = await depositContract.getPlayerDepositIndices(player1.address);
      const player2Indices = await depositContract.getPlayerDepositIndices(player2.address);

      expect(player1Indices.length).to.equal(2);
      expect(player1Indices[0]).to.equal(0);
      expect(player1Indices[1]).to.equal(1);

      expect(player2Indices.length).to.equal(1);
      expect(player2Indices[0]).to.equal(2);
    });

    it("Should return empty array for player with no deposits", async function () {
      const [, , , noDepositsPlayer] = await ethers.getSigners();
      const indices = await depositContract.getPlayerDepositIndices(noDepositsPlayer.address);

      expect(indices.length).to.equal(0);
    });

    it("Should return correct player deposits", async function () {
      const player1Deposits = await depositContract.getPlayerDeposits(player1.address);

      expect(player1Deposits.length).to.equal(2);
      expect(player1Deposits[0].player).to.equal(player1.address);
      expect(player1Deposits[0].amount).to.equal(ethers.utils.parseEther("100"));
      expect(player1Deposits[1].player).to.equal(player1.address);
      expect(player1Deposits[1].amount).to.equal(ethers.utils.parseEther("200"));
    });

    it("Should return correct recent deposits", async function () {
      const recentDeposits = await depositContract.getRecentDeposits(2);

      expect(recentDeposits.length).to.equal(2);
      expect(recentDeposits[0].player).to.equal(player1.address);
      expect(recentDeposits[0].amount).to.equal(ethers.utils.parseEther("200"));
      expect(recentDeposits[1].player).to.equal(player2.address);
      expect(recentDeposits[1].amount).to.equal(ethers.utils.parseEther("150"));
    });

    it("Should return all deposits if count exceeds total", async function () {
      const recentDeposits = await depositContract.getRecentDeposits(100);

      expect(recentDeposits.length).to.equal(3);
    });

    it("Should return empty array if no deposits exist", async function () {
      // Deploy new contract with no deposits
      const newDepositContract = await DepositContract.deploy(
        moeToken.address,
        owner.address
      );
      await newDepositContract.deployed();

      const recentDeposits = await newDepositContract.getRecentDeposits(10);
      expect(recentDeposits.length).to.equal(0);
    });
  });

  describe("Integration Test", function () {
    it("Should handle complete deposit flow", async function () {
      const depositAmount = ethers.utils.parseEther("250");

      // 1. Check initial balances
      const initialPlayerBalance = await moeToken.balanceOf(player1.address);
      const initialOwnerBalance = await moeToken.balanceOf(owner.address);

      // 2. Player approves
      await moeToken.connect(player1).approve(depositContract.address, depositAmount);

      // 3. Player deposits
      const tx = await depositContract.connect(player1).deposit(depositAmount);
      const receipt = await tx.wait();

      // 4. Verify event
      const event = receipt.events?.find(e => e.event === "DepositMade");
      expect(event).to.not.be.undefined;
      expect(event.args.player).to.equal(player1.address);
      expect(event.args.amount).to.equal(depositAmount);

      // 5. Verify balances - tokens go to owner (recipient)
      expect(await moeToken.balanceOf(player1.address)).to.equal(
        initialPlayerBalance.sub(depositAmount)
      );
      expect(await moeToken.balanceOf(owner.address)).to.equal(
        initialOwnerBalance.add(depositAmount)
      );

      // 6. Verify deposit record
      const [player, amount, timestamp, txHash] = await depositContract.getDeposit(0);
      expect(player).to.equal(player1.address);
      expect(amount).to.equal(depositAmount);
      expect(timestamp).to.be.gt(0);

      // 7. Verify player deposits query
      const playerDeposits = await depositContract.getPlayerDeposits(player1.address);
      expect(playerDeposits.length).to.equal(1);
      expect(playerDeposits[0].amount).to.equal(depositAmount);
    });
  });

  describe("Gasless Deposit (depositWithPermit)", function () {
    it("Should allow gasless deposit via permit", async function () {
      const depositAmount = ethers.utils.parseEther("200");
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // Get nonce
      const nonce = await moeToken.nonces(player1.address);

      // Create permit signature
      const domain = {
        name: "MoeGirls Token",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: moeToken.address,
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        owner: player1.address,
        spender: depositContract.address,
        value: depositAmount,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await player1._signTypedData(domain, types, value);
      const sig = ethers.utils.splitSignature(signature);

      const initialOwnerBalance = await moeToken.balanceOf(owner.address);

      // Backend calls depositWithPermit (can be any account)
      await expect(
        depositContract.connect(owner).depositWithPermit(
          player1.address,
          depositAmount,
          deadline,
          sig.v,
          sig.r,
          sig.s
        )
      ).to.emit(depositContract, "DepositMade");

      // Verify tokens went to owner (recipient)
      expect(await moeToken.balanceOf(owner.address)).to.equal(
        initialOwnerBalance.add(depositAmount)
      );

      // Verify player's balance decreased
      expect(await moeToken.balanceOf(player1.address)).to.equal(
        ethers.utils.parseEther("800")
      );

      // Verify deposit record
      const deposits = await depositContract.getPlayerDeposits(player1.address);
      expect(deposits.length).to.equal(1);
      expect(deposits[0].amount).to.equal(depositAmount);
    });

    it("Should revert with expired permit", async function () {
      const depositAmount = ethers.utils.parseEther("200");
      const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago (expired)

      const nonce = await moeToken.nonces(player1.address);

      const domain = {
        name: "MoeGirls Token",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: moeToken.address,
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        owner: player1.address,
        spender: depositContract.address,
        value: depositAmount,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await player1._signTypedData(domain, types, value);
      const sig = ethers.utils.splitSignature(signature);

      await expect(
        depositContract.depositWithPermit(player1.address, depositAmount, deadline, sig.v, sig.r, sig.s)
      ).to.be.reverted;
    });
  });

  describe("Closed-Loop Economy", function () {
    it("Should form closed loop: Deposit → Owner → Factory", async function () {
      const depositAmount = ethers.utils.parseEther("100");

      const initialOwnerBalance = await moeToken.balanceOf(owner.address);

      // Player deposits MOE
      await moeToken.connect(player1).approve(depositContract.address, depositAmount);
      await depositContract.connect(player1).deposit(depositAmount);

      // Owner should have increased balance
      expect(await moeToken.balanceOf(owner.address)).to.equal(
        initialOwnerBalance.add(depositAmount)
      );

      // Owner can now transfer to Factory or mint to Factory for vesting
      // This completes the closed loop
    });
  });
});
