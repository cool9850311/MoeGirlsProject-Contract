const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MOEToken", function () {
  let MOEToken;
  let moeToken;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    MOEToken = await ethers.getContractFactory("MOEToken");
    moeToken = await MOEToken.deploy(owner.address);
    await moeToken.deployed();
  });

  describe("ERC-2612 Permit", function () {
    it("Should have correct domain separator", async function () {
      const domain = await moeToken.DOMAIN_SEPARATOR();
      expect(domain).to.not.equal(ethers.constants.HashZero);
    });

    it("Should allow permit approval", async function () {
      const amount = ethers.utils.parseEther("100");
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // Get nonce
      const nonce = await moeToken.nonces(addr1.address);

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
        owner: addr1.address,
        spender: addr2.address,
        value: amount,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await addr1._signTypedData(domain, types, value);
      const sig = ethers.utils.splitSignature(signature);

      // Execute permit
      await moeToken.permit(
        addr1.address,
        addr2.address,
        amount,
        deadline,
        sig.v,
        sig.r,
        sig.s
      );

      // Check allowance
      expect(await moeToken.allowance(addr1.address, addr2.address)).to.equal(amount);
    });

    it("Should reject expired permit", async function () {
      const amount = ethers.utils.parseEther("100");
      const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago (expired)

      const nonce = await moeToken.nonces(addr1.address);

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
        owner: addr1.address,
        spender: addr2.address,
        value: amount,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await addr1._signTypedData(domain, types, value);
      const sig = ethers.utils.splitSignature(signature);

      await expect(
        moeToken.permit(addr1.address, addr2.address, amount, deadline, sig.v, sig.r, sig.s)
      ).to.be.reverted;
    });
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await moeToken.name()).to.equal("MoeGirls Token");
      expect(await moeToken.symbol()).to.equal("MOE");
    });

    it("Should set the correct decimals", async function () {
      expect(await moeToken.decimals()).to.equal(18);
    });

    it("Should set the correct owner", async function () {
      expect(await moeToken.owner()).to.equal(owner.address);
    });

    it("Should have initial supply of 10,000,000 MOE", async function () {
      const expectedSupply = ethers.utils.parseEther("10000000");
      expect(await moeToken.totalSupply()).to.equal(expectedSupply);
    });

    it("Should mint initial supply to owner", async function () {
      const expectedSupply = ethers.utils.parseEther("10000000");
      expect(await moeToken.balanceOf(owner.address)).to.equal(expectedSupply);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint additional tokens", async function () {
      const initialSupply = await moeToken.totalSupply();
      const mintAmount = ethers.utils.parseEther("1000");

      await expect(moeToken.mint(addr1.address, mintAmount))
        .to.emit(moeToken, "MOEMinted")
        .withArgs(addr1.address, mintAmount);

      expect(await moeToken.balanceOf(addr1.address)).to.equal(mintAmount);
      expect(await moeToken.totalSupply()).to.equal(initialSupply.add(mintAmount));
    });

    it("Should allow multiple mints", async function () {
      const initialSupply = await moeToken.totalSupply();
      const mintAmount1 = ethers.utils.parseEther("1000");
      const mintAmount2 = ethers.utils.parseEther("500");

      await moeToken.mint(addr1.address, mintAmount1);
      await moeToken.mint(addr2.address, mintAmount2);

      expect(await moeToken.balanceOf(addr1.address)).to.equal(mintAmount1);
      expect(await moeToken.balanceOf(addr2.address)).to.equal(mintAmount2);
      expect(await moeToken.totalSupply()).to.equal(initialSupply.add(mintAmount1).add(mintAmount2));
    });

    it("Should revert if non-owner tries to mint", async function () {
      const mintAmount = ethers.utils.parseEther("1000");

      await expect(
        moeToken.connect(addr1).mint(addr2.address, mintAmount)
      ).to.be.revertedWithCustomError(moeToken, "OwnableUnauthorizedAccount");
    });

    it("Should revert if minting to zero address", async function () {
      const mintAmount = ethers.utils.parseEther("1000");

      await expect(
        moeToken.mint(ethers.constants.AddressZero, mintAmount)
      ).to.be.revertedWith("MOEToken: mint to zero address");
    });

    it("Should revert if minting zero amount", async function () {
      await expect(
        moeToken.mint(addr1.address, 0)
      ).to.be.revertedWith("MOEToken: mint amount must be positive");
    });
  });

  describe("ERC20 Functionality", function () {
    beforeEach(async function () {
      // Mint some tokens for testing transfers
      const mintAmount = ethers.utils.parseEther("1000");
      await moeToken.mint(addr1.address, mintAmount);
    });

    it("Should allow token transfers", async function () {
      const transferAmount = ethers.utils.parseEther("100");

      await moeToken.connect(addr1).transfer(addr2.address, transferAmount);

      expect(await moeToken.balanceOf(addr1.address)).to.equal(
        ethers.utils.parseEther("900")
      );
      expect(await moeToken.balanceOf(addr2.address)).to.equal(transferAmount);
    });

    it("Should allow approve and transferFrom", async function () {
      const approveAmount = ethers.utils.parseEther("200");
      const transferAmount = ethers.utils.parseEther("100");

      await moeToken.connect(addr1).approve(addr2.address, approveAmount);

      expect(await moeToken.allowance(addr1.address, addr2.address)).to.equal(
        approveAmount
      );

      await moeToken.connect(addr2).transferFrom(addr1.address, addr2.address, transferAmount);

      expect(await moeToken.balanceOf(addr1.address)).to.equal(
        ethers.utils.parseEther("900")
      );
      expect(await moeToken.balanceOf(addr2.address)).to.equal(transferAmount);
      expect(await moeToken.allowance(addr1.address, addr2.address)).to.equal(
        ethers.utils.parseEther("100")
      );
    });

    it("Should revert transfer if insufficient balance", async function () {
      const transferAmount = ethers.utils.parseEther("2000");

      await expect(
        moeToken.connect(addr1).transfer(addr2.address, transferAmount)
      ).to.be.revertedWithCustomError(moeToken, "ERC20InsufficientBalance");
    });

    it("Should revert transferFrom if insufficient allowance", async function () {
      const transferAmount = ethers.utils.parseEther("100");

      await expect(
        moeToken.connect(addr2).transferFrom(addr1.address, addr2.address, transferAmount)
      ).to.be.revertedWithCustomError(moeToken, "ERC20InsufficientAllowance");
    });
  });

  describe("Ownership", function () {
    it("Should allow owner to transfer ownership", async function () {
      await moeToken.transferOwnership(addr1.address);
      expect(await moeToken.owner()).to.equal(addr1.address);
    });

    it("Should allow new owner to mint after ownership transfer", async function () {
      await moeToken.transferOwnership(addr1.address);

      const initialSupply = await moeToken.totalSupply();
      const mintAmount = ethers.utils.parseEther("500");
      await moeToken.connect(addr1).mint(addr2.address, mintAmount);

      expect(await moeToken.balanceOf(addr2.address)).to.equal(mintAmount);
      expect(await moeToken.totalSupply()).to.equal(initialSupply.add(mintAmount));
    });

    it("Should prevent old owner from minting after ownership transfer", async function () {
      await moeToken.transferOwnership(addr1.address);

      const mintAmount = ethers.utils.parseEther("500");
      await expect(
        moeToken.mint(addr2.address, mintAmount)
      ).to.be.revertedWithCustomError(moeToken, "OwnableUnauthorizedAccount");
    });
  });
});
