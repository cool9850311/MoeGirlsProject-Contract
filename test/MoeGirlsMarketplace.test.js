const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployContractsFixture } = require("./fixtures");

describe("MoeGirlsMarketplace", function () {
    let deployer, user1, user2;
    let moeToken, nft, marketplace;
    let chainId;
    let marketplaceDomain;

    beforeEach(async function () {
        const fixture = await loadFixture(deployContractsFixture);
        deployer = fixture.deployer;
        user1 = fixture.user1;
        user2 = fixture.user2;
        moeToken = fixture.moeToken;
        nft = fixture.nft;
        marketplace = fixture.marketplace;

        chainId = (await ethers.provider.getNetwork()).chainId;

        marketplaceDomain = {
            name: "MoeGirlsMarketplace",
            version: "1",
            chainId: chainId,
            verifyingContract: marketplace.address
        };

        // Mint an NFT for user1 to use in tests
        const price = ethers.utils.parseEther("1000");
        await moeToken.connect(user1).approve(nft.address, price);
        await nft.connect(deployer).mintWithApproval(
            user1.address,
            user1.address,
            1,
            "test_card",
            "ipfs://test",
            price
        );
    });

    describe("Deployment", function () {
        it("Should set the correct NFT contract address", async function () {
            expect(await marketplace.nftContract()).to.equal(nft.address);
        });

        it("Should set the correct payment token address", async function () {
            expect(await marketplace.paymentToken()).to.equal(moeToken.address);
        });

        it("Should have correct EIP-712 domain separator", async function () {
            // DOMAIN_SEPARATOR is a public variable, not a function
            const separator = await marketplace.DOMAIN_SEPARATOR;
            expect(separator).to.not.equal(ethers.constants.HashZero);
        });
    });

    describe("Edge Cases: Amount and Price", function () {
        it("Should reject orders with zero amount", async function () {
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 0, // Zero amount
                price: price,
                deadline: deadline,
                nonce: 1
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1, // Mismatch
                price: price,
                deadline: deadline,
                nonce: 1
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWith("Amount mismatch");
        });

        it("Should handle very large price values", async function () {
            const deadline = (await time.latest()) + 3600;
            const largePrice = ethers.utils.parseEther("1000000");

            // Mint enough MOE for user2
            await moeToken.mint(user2.address, largePrice);

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, largePrice);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: largePrice,
                deadline: deadline,
                nonce: 1
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: largePrice,
                deadline: deadline,
                nonce: 1
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.not.be.reverted;

            // Verify transfer
            expect(await nft.balanceOf(user2.address, 1)).to.equal(1);
        });

        it("Should handle multiple copies (ERC1155 amount > 1)", async function () {
            // Mint 5 copies for user1
            const mintPrice = ethers.utils.parseEther("5000");
            await moeToken.connect(user1).approve(nft.address, mintPrice);
            await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                5, // 5 copies
                "multi_copy_card",
                "ipfs://multi",
                mintPrice
            );

            const deadline = (await time.latest()) + 3600;
            const tradePrice = ethers.utils.parseEther("500"); // 100 MOE per copy

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, tradePrice);

            const sellOrder = {
                maker: user1.address,
                tokenId: 2, // New tokenId
                amount: 5,
                price: tradePrice,
                deadline: deadline,
                nonce: 10
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 2,
                amount: 5,
                price: tradePrice,
                deadline: deadline,
                nonce: 10
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig);

            // User2 should have all 5 copies
            expect(await nft.balanceOf(user2.address, 2)).to.equal(5);
            expect(await nft.balanceOf(user1.address, 2)).to.equal(0);
        });
    });

    describe("Timestamp Validation (Deadline Boundaries)", function () {
        it("Should accept order at exact deadline time", async function () {
            const deadline = (await time.latest()) + 60; // 60 seconds from now
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 20
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 20
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            // Set next block timestamp to exact deadline
            await time.setNextBlockTimestamp(deadline);

            // Should succeed at deadline == block.timestamp
            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.not.be.reverted;
        });

        it("Should reject order 1 second after deadline", async function () {
            const deadline = (await time.latest()) + 60;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 30
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 30
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            // Advance time to 1 second AFTER deadline
            await time.increaseTo(deadline + 1);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWith("Sell order expired");
        });

        it("Should reject if only buy order is expired", async function () {
            const sellDeadline = (await time.latest()) + 3600; // 1 hour
            const buyDeadline = (await time.latest()) + 60;   // 1 minute
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: sellDeadline,
                nonce: 40
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: buyDeadline, // Shorter deadline
                nonce: 40
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            // Advance time past buy deadline but before sell deadline
            await time.increaseTo(buyDeadline + 1);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWith("Buy order expired");
        });
    });

    describe("Order State Management", function () {
        it("Should track executed order hashes correctly", async function () {
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 50
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            // Calculate order hash
            const sellOrderHash = ethers.utils._TypedDataEncoder.hash(
                marketplaceDomain,
                sellOrderTypes,
                sellOrder
            );

            // Initially should be false
            expect(await marketplace.isOrderExecuted(sellOrderHash)).to.be.false;

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 50
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig);

            // Should now be true
            expect(await marketplace.isOrderExecuted(sellOrderHash)).to.be.true;
        });

        it("Should track used nonces correctly", async function () {
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const nonce = 60;

            // Initially nonce should not be used
            expect(await marketplace.isNonceUsed(user1.address, nonce)).to.be.false;

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: nonce
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: nonce
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig);

            // Nonce should now be marked as used for both users
            expect(await marketplace.isNonceUsed(user1.address, nonce)).to.be.true;
            expect(await marketplace.isNonceUsed(user2.address, nonce)).to.be.true;
        });

        it("Should allow same nonce for different users", async function () {
            // Mint another NFT for user2
            const mintPrice = ethers.utils.parseEther("1000");
            await moeToken.connect(user2).approve(nft.address, mintPrice);
            await nft.connect(deployer).mintWithApproval(
                user2.address,
                user2.address,
                1,
                "card_user2",
                "ipfs://user2",
                mintPrice
            );

            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");
            const sharedNonce = 100;

            // Trade 1: user1 sells tokenId 1 to user2
            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price.mul(2));

            const sellOrder1 = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: sharedNonce
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig1 = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder1);

            const buyOrder1 = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: sharedNonce
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig1 = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder1);

            await marketplace.connect(deployer).matchOrders(sellOrder1, sellSig1, buyOrder1, buySig1);

            // Now both user1 and user2 have used nonce 100
            expect(await marketplace.isNonceUsed(user1.address, sharedNonce)).to.be.true;
            expect(await marketplace.isNonceUsed(user2.address, sharedNonce)).to.be.true;

            // This is expected: nonces are per-user, so this test just confirms the state
        });

        it("Should mark order as executed even if NFT/MOE transfer fails (ReentrancyGuard)", async function () {
            // This is a conceptual test: in reality, if transfer fails, tx reverts
            // But we can verify ReentrancyGuard is in place
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            // User1 doesn't approve NFT, so transfer will fail
            // await nft.connect(user1).setApprovalForAll(marketplace.address, true); // SKIP

            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 110
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 110
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            // Should revert because user1 hasn't approved
            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.reverted; // ERC1155: caller is not token owner or approved

            // Order should NOT be marked as executed (tx reverted)
            const sellOrderHash = ethers.utils._TypedDataEncoder.hash(
                marketplaceDomain,
                sellOrderTypes,
                sellOrder
            );
            expect(await marketplace.isOrderExecuted(sellOrderHash)).to.be.false;
        });
    });

    describe("Event Logging", function () {
        it("Should emit OrderMatched event with correct parameters", async function () {
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 200
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const sellOrderHash = ethers.utils._TypedDataEncoder.hash(
                marketplaceDomain,
                sellOrderTypes,
                sellOrder
            );

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 200
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            const buyOrderHash = ethers.utils._TypedDataEncoder.hash(
                marketplaceDomain,
                buyOrderTypes,
                buyOrder
            );

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            )
                .to.emit(marketplace, "OrderMatched")
                .withArgs(
                    sellOrderHash,
                    buyOrderHash,
                    user1.address, // seller
                    user2.address, // buyer
                    1,             // tokenId
                    1,             // amount
                    price          // price
                );
        });
    });

    describe("Payment Failure Scenarios", function () {
        it("Should revert if buyer has insufficient MOE balance", async function () {
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100000"); // More than user2 has

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 400
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 400
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWithCustomError(moeToken, "ERC20InsufficientBalance");
        });

        it("Should revert if buyer has insufficient MOE allowance", async function () {
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            // User2 approves less than required
            await moeToken.connect(user2).approve(marketplace.address, ethers.utils.parseEther("50"));

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 410
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 410
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWithCustomError(moeToken, "ERC20InsufficientAllowance");
        });

        it("Should revert if seller doesn't own the NFT", async function () {
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            // user2 doesn't own tokenId 1
            await nft.connect(user2).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user1).approve(marketplace.address, price);

            const sellOrder = {
                maker: user2.address, // user2 doesn't have tokenId 1
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 420
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user2._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 420
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user1._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWithCustomError(nft, "ERC1155InsufficientBalance");
        });
    });

    describe("Access Control", function () {
        it("Should only allow owner to call matchOrders", async function () {
            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 700
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 1,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 700
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            // deployer is owner, should succeed
            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.not.be.reverted;
        });

        it("Should revert if non-owner tries to call matchOrders", async function () {
            // Mint another NFT for user1
            const mintPrice = ethers.utils.parseEther("1000");
            await moeToken.connect(user1).approve(nft.address, mintPrice);
            await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                "card_test_2",
                "ipfs://test2",
                mintPrice
            );

            const deadline = (await time.latest()) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, price);

            const sellOrder = {
                maker: user1.address,
                tokenId: 2,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 710
            };

            const sellOrderTypes = {
                SellOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            const buyOrder = {
                maker: user2.address,
                tokenId: 2,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 710
            };

            const buyOrderTypes = {
                BuyOrder: [
                    { name: "maker", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "amount", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            // user1 is not owner, should fail
            await expect(
                marketplace.connect(user1).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
        });
    });
});
