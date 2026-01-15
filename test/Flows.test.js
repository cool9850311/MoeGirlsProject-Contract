const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployContractsFixture } = require("./fixtures");

describe("MoeGirls Flows (EOA + Permit)", function () {
    this.timeout(120000); // 120s timeout for Fork tests

    let deployer, user1, user2, relayer;
    let moeToken, depositContract, vestingFactory, nft, marketplace;
    let chainId, moeDomain, nftDomain;

    beforeEach(async function () {
        const fixture = await deployContractsFixture();
        deployer = fixture.deployer;
        user1 = fixture.user1;
        user2 = fixture.user2;
        relayer = fixture.relayer;
        moeToken = fixture.moeToken;
        depositContract = fixture.depositContract;
        vestingFactory = fixture.vestingFactory;
        nft = fixture.nft;
        marketplace = fixture.marketplace;

        // Get chainId for EIP-712
        const network = await ethers.provider.getNetwork();
        chainId = network.chainId;

        // MOE Token EIP-712 Domain
        moeDomain = {
            name: await moeToken.name(),
            version: "1",
            chainId: chainId,
            verifyingContract: moeToken.address
        };

        // NFT EIP-712 Domain (for ERC-7604 Permit)
        nftDomain = {
            name: "MoeGirlsNFT",
            version: "1",
            chainId: chainId,
            verifyingContract: nft.address
        };
    });

    describe("Flow 3: Withdraw (Vesting)", function () {
        it("should create VestingWallet with EOA beneficiary and release MOE", async function () {
            const amount = ethers.utils.parseEther("100");

            // Step 1: Backend creates Vesting (beneficiary = user1 EOA, NOT Safe)
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,  // ✅ EOA address (符合新架构)
                amount
            );
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            expect(event).to.not.be.undefined;

            const vestingAddr = event.args.vestingWallet;
            const vesting = await ethers.getContractAt("StageBasedVestingWallet", vestingAddr);

            // Verify Initial State
            expect(await moeToken.balanceOf(vestingAddr)).to.equal(amount);
            expect(await vesting.owner()).to.equal(user1.address); // ✅ Beneficiary is EOA
            expect(await vesting["releasable(address)"](moeToken.address)).to.equal(0);

            // Step 2: Time travel 30s (25% of 120s)
            await ethers.provider.send("evm_increaseTime", [30]);
            await ethers.provider.send("evm_mine");

            const releasable = await vesting["releasable(address)"](moeToken.address);
            expect(releasable).to.be.gt(0);

            // Step 3: Backend triggers release (backend pays gas)
            const balBefore = await moeToken.balanceOf(user1.address);
            await vesting.connect(deployer)["release(address)"](moeToken.address);
            const balAfter = await moeToken.balanceOf(user1.address);

            // Verify MOE released to EOA
            expect(balAfter.sub(balBefore)).to.equal(releasable);
        });

        it("should release MOE in 4 stages correctly", async function () {
            const amount = ethers.utils.parseEther("100");

            const tx = await vestingFactory.connect(deployer).createVesting(user1.address, amount);
            const receipt = await tx.wait();
            const vestingAddr = receipt.events.find(e => e.event === 'VestingCreated').args.vestingWallet;
            const vesting = await ethers.getContractAt("StageBasedVestingWallet", vestingAddr);

            const stages = [
                { time: 30, percent: 25 },
                { time: 60, percent: 50 },
                { time: 90, percent: 75 },
                { time: 120, percent: 100 }
            ];

            for (const stage of stages) {
                await ethers.provider.send("evm_increaseTime", [30]);
                await ethers.provider.send("evm_mine");

                const releasable = await vesting["releasable(address)"](moeToken.address);
                const balBefore = await moeToken.balanceOf(user1.address);
                await vesting.connect(deployer)["release(address)"](moeToken.address);
                const balAfter = await moeToken.balanceOf(user1.address);

                expect(balAfter.sub(balBefore)).to.equal(releasable);
            }

            // Final check: all MOE released
            expect(await moeToken.balanceOf(vestingAddr)).to.equal(0);
        });
    });

    describe("Flow 4: Deposit (EOA + EIP-2612 Permit)", function () {
        it("should deposit MOE using EIP-2612 Permit (gasless)", async function () {
            const amount = ethers.utils.parseEther("400");
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

            // Step 1: Build Permit message
            const nonce = await moeToken.nonces(user1.address);
            const permitMessage = {
                owner: user1.address,
                spender: depositContract.address,
                value: amount,
                nonce: nonce,
                deadline: deadline
            };

            // EIP-712 Permit types
            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            // Step 2: User signs Permit (frontend, gasless)
            const signature = await user1._signTypedData(moeDomain, types, permitMessage);
            const sig = ethers.utils.splitSignature(signature);

            // Step 3: Backend calls depositWithPermit (backend pays gas)
            const ownerBalBefore = await moeToken.balanceOf(deployer.address);

            await depositContract.connect(deployer).depositWithPermit(
                user1.address,  // ✅ Player EOA
                amount,
                deadline,
                sig.v, sig.r, sig.s
            );

            const ownerBalAfter = await moeToken.balanceOf(deployer.address);

            // Verify deposit recorded
            expect(ownerBalAfter.sub(ownerBalBefore)).to.equal(amount);

            // Verify deposit event
            const deposits = await depositContract.getPlayerDeposits(user1.address);
            expect(deposits.length).to.be.gt(0);
            expect(deposits[deposits.length - 1].amount).to.equal(amount);
        });

        it("should reject expired permit", async function () {
            const amount = ethers.utils.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) - 3600; // Expired

            const nonce = await moeToken.nonces(user1.address);
            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const signature = await user1._signTypedData(moeDomain, types, {
                owner: user1.address,
                spender: depositContract.address,
                value: amount,
                nonce: nonce,
                deadline: deadline
            });
            const sig = ethers.utils.splitSignature(signature);

            await expect(
                depositContract.connect(deployer).depositWithPermit(
                    user1.address, amount, deadline, sig.v, sig.r, sig.s
                )
            ).to.be.revertedWithCustomError(moeToken, "ERC2612ExpiredSignature");
        });
    });

    describe("Flow 5: NFT Mint (EOA + EIP-2612 Permit)", function () {
        it("should mint NFT using EIP-2612 Permit (gasless)", async function () {
            const price = ethers.utils.parseEther("1000");
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            // Build and sign MOE Permit
            const nonce = await moeToken.nonces(user1.address);
            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const signature = await user1._signTypedData(moeDomain, types, {
                owner: user1.address,
                spender: nft.address,
                value: price,
                nonce: nonce,
                deadline: deadline
            });
            const sig = ethers.utils.splitSignature(signature);

            // Backend calls mintWithPermit
            const ownerBalBefore = await moeToken.balanceOf(deployer.address);

            const tx = await nft.connect(deployer).mintWithPermit(
                user1.address,  // payer (EOA)
                user1.address,  // recipient (EOA)
                1,              // amount
                "card_12345",   // cardId
                "ipfs://Qm...", // metadataUri
                price,
                deadline,
                sig.v, sig.r, sig.s
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');

            // Verify NFT minted to EOA
            expect(event).to.not.be.undefined;
            expect(event.args.to).to.equal(user1.address);
            expect(await nft.balanceOf(user1.address, event.args.tokenId)).to.equal(1);

            // Verify payment
            const ownerBalAfter = await moeToken.balanceOf(deployer.address);
            expect(ownerBalAfter.sub(ownerBalBefore)).to.equal(price);
        });

        it("should mint multiple NFTs for different users", async function () {
            const price = ethers.utils.parseEther("500");
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            for (const user of [user1, user2]) {
                const nonce = await moeToken.nonces(user.address);
                const types = {
                    Permit: [
                        { name: "owner", type: "address" },
                        { name: "spender", type: "address" },
                        { name: "value", type: "uint256" },
                        { name: "nonce", type: "uint256" },
                        { name: "deadline", type: "uint256" }
                    ]
                };

                const signature = await user._signTypedData(moeDomain, types, {
                    owner: user.address,
                    spender: nft.address,
                    value: price,
                    nonce: nonce,
                    deadline: deadline
                });
                const sig = ethers.utils.splitSignature(signature);

                const tx = await nft.connect(deployer).mintWithPermit(
                    user.address,
                    user.address,
                    1,
                    `card_${user.address.slice(0, 8)}`,
                    `ipfs://user_${user.address.slice(0, 8)}`,
                    price,
                    deadline,
                    sig.v, sig.r, sig.s
                );

                const receipt = await tx.wait();
                const event = receipt.events.find(e => e.event === 'NFTMinted');
                expect(await nft.balanceOf(user.address, event.args.tokenId)).to.equal(1);
            }
        });
    });

    describe("ERC-7604 NFT Permit", function () {
        it("should grant approval using NFT permit signature", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            // Get nonce for user1
            const nonce = await nft.nonces(user1.address);

            // Build ERC-7604 Permit message
            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "operator", type: "address" },
                    { name: "approved", type: "bool" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const permitMessage = {
                owner: user1.address,
                operator: marketplace.address,
                approved: true,
                nonce: nonce,
                deadline: deadline
            };

            // User signs permit
            const signature = await user1._signTypedData(nftDomain, types, permitMessage);
            const sig = ethers.utils.splitSignature(signature);

            // Anyone can submit the permit
            await nft.permit(
                user1.address,
                marketplace.address,
                true,
                deadline,
                sig.v, sig.r, sig.s
            );

            // Verify approval granted
            expect(await nft.isApprovedForAll(user1.address, marketplace.address)).to.be.true;
        });

        it("should reject invalid signature", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const nonce = await nft.nonces(user1.address);

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "operator", type: "address" },
                    { name: "approved", type: "bool" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            // user2 signs but claims to be user1
            const signature = await user2._signTypedData(nftDomain, types, {
                owner: user1.address,
                operator: marketplace.address,
                approved: true,
                nonce: nonce,
                deadline: deadline
            });
            const sig = ethers.utils.splitSignature(signature);

            await expect(
                nft.permit(
                    user1.address,
                    marketplace.address,
                    true,
                    deadline,
                    sig.v, sig.r, sig.s
                )
            ).to.be.revertedWithCustomError(nft, "ERC1155PermitInvalidSignature");
        });

        it("should reject expired permit", async function () {
            const deadline = Math.floor(Date.now() / 1000) - 3600; // Expired
            const nonce = await nft.nonces(user1.address);

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "operator", type: "address" },
                    { name: "approved", type: "bool" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const signature = await user1._signTypedData(nftDomain, types, {
                owner: user1.address,
                operator: marketplace.address,
                approved: true,
                nonce: nonce,
                deadline: deadline
            });
            const sig = ethers.utils.splitSignature(signature);

            await expect(
                nft.permit(
                    user1.address,
                    marketplace.address,
                    true,
                    deadline,
                    sig.v, sig.r, sig.s
                )
            ).to.be.revertedWithCustomError(nft, "ERC1155PermitExpired");
        });
    });

    describe("Flow 6: NFT Marketplace (Off-chain Order + Permit)", function () {
        let marketplaceDomain;
        let tokenId;

        beforeEach(async function () {
            // Marketplace EIP-712 Domain
            marketplaceDomain = {
                name: "MoeGirlsMarketplace",
                version: "1",
                chainId: chainId,
                verifyingContract: marketplace.address
            };

            // Mint NFT for user1 (seller)
            const price = ethers.utils.parseEther("1000");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const nonce = await moeToken.nonces(user1.address);

            const permitTypes = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const signature = await user1._signTypedData(moeDomain, permitTypes, {
                owner: user1.address,
                spender: nft.address,
                value: price,
                nonce: nonce,
                deadline: deadline
            });
            const sig = ethers.utils.splitSignature(signature);

            const tx = await nft.connect(deployer).mintWithPermit(
                user1.address, user1.address, 1, "card_market_test",
                "ipfs://market", price, deadline, sig.v, sig.r, sig.s
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            tokenId = event.args.tokenId;
        });

        it("should complete full marketplace flow with permits and atomic swap", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sellPrice = ethers.utils.parseEther("100");
            const buyPrice = ethers.utils.parseEther("120");

            // Step 1: Seller approves NFT to marketplace using ERC-7604 Permit
            const nftNonce = await nft.nonces(user1.address);
            const nftPermitTypes = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "operator", type: "address" },
                    { name: "approved", type: "bool" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const nftSig = ethers.utils.splitSignature(
                await user1._signTypedData(nftDomain, nftPermitTypes, {
                    owner: user1.address,
                    operator: marketplace.address,
                    approved: true,
                    nonce: nftNonce,
                    deadline: deadline
                })
            );

            await nft.permit(user1.address, marketplace.address, true, deadline, nftSig.v, nftSig.r, nftSig.s);
            expect(await nft.isApprovedForAll(user1.address, marketplace.address)).to.be.true;

            // Step 2: Buyer approves MOE to marketplace using EIP-2612 Permit
            const moeNonce = await moeToken.nonces(user2.address);
            const moePermitTypes = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const moeSig = ethers.utils.splitSignature(
                await user2._signTypedData(moeDomain, moePermitTypes, {
                    owner: user2.address,
                    spender: marketplace.address,
                    value: ethers.constants.MaxUint256,
                    nonce: moeNonce,
                    deadline: deadline
                })
            );

            await moeToken.permit(user2.address, marketplace.address, ethers.constants.MaxUint256, deadline, moeSig.v, moeSig.r, moeSig.s);
            expect(await moeToken.allowance(user2.address, marketplace.address)).to.equal(ethers.constants.MaxUint256);

            // Step 3: Create and sign SellOrder (EIP-712)
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

            const sellOrder = {
                maker: user1.address,
                tokenId: tokenId,
                amount: 1,
                price: sellPrice,
                deadline: deadline,
                nonce: 1
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

            // Step 4: Create and sign BuyOrder (EIP-712)
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

            const buyOrder = {
                maker: user2.address,
                tokenId: tokenId,
                amount: 1,
                price: buyPrice,
                deadline: deadline,
                nonce: 1
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            // Step 5: Backend executes matchOrders (atomic swap)
            const sellerMOEBefore = await moeToken.balanceOf(user1.address);
            const buyerMOEBefore = await moeToken.balanceOf(user2.address);
            const sellerNFTBefore = await nft.balanceOf(user1.address, tokenId);
            const buyerNFTBefore = await nft.balanceOf(user2.address, tokenId);

            await marketplace.connect(deployer).matchOrders(
                sellOrder, sellSig,
                buyOrder, buySig
            );

            // Step 6: Verify atomic swap
            const sellerMOEAfter = await moeToken.balanceOf(user1.address);
            const buyerMOEAfter = await moeToken.balanceOf(user2.address);
            const sellerNFTAfter = await nft.balanceOf(user1.address, tokenId);
            const buyerNFTAfter = await nft.balanceOf(user2.address, tokenId);

            // Seller receives MOE (at sell price)
            expect(sellerMOEAfter.sub(sellerMOEBefore)).to.equal(sellPrice);
            // Buyer pays MOE (at sell price, saves 20 MOE)
            expect(buyerMOEBefore.sub(buyerMOEAfter)).to.equal(sellPrice);
            // NFT transferred from seller to buyer
            expect(sellerNFTBefore.sub(sellerNFTAfter)).to.equal(1);
            expect(buyerNFTAfter.sub(buyerNFTBefore)).to.equal(1);
        });

        it("should reject order with expired deadline", async function () {
            const deadline = Math.floor(Date.now() / 1000) - 3600; // Expired
            const price = ethers.utils.parseEther("100");

            // Approve marketplace
            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, ethers.constants.MaxUint256);

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

            const sellOrder = {
                maker: user1.address,
                tokenId: tokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 2
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

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

            const buyOrder = {
                maker: user2.address,
                tokenId: tokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 2
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWith("Sell order expired");
        });

        it("should reject orders with price mismatch", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sellPrice = ethers.utils.parseEther("120"); // Seller wants 120
            const buyPrice = ethers.utils.parseEther("100");  // Buyer offers 100

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, ethers.constants.MaxUint256);

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

            const sellOrder = {
                maker: user1.address,
                tokenId: tokenId,
                amount: 1,
                price: sellPrice,
                deadline: deadline,
                nonce: 3
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

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

            const buyOrder = {
                maker: user2.address,
                tokenId: tokenId,
                amount: 1,
                price: buyPrice,
                deadline: deadline,
                nonce: 3
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWith("Price mismatch");
        });

        it("should reject order with invalid signature", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, ethers.constants.MaxUint256);

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

            const sellOrder = {
                maker: user1.address,
                tokenId: tokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 4
            };

            // user2 signs but order claims user1 is maker
            const fakeSellSig = await user2._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

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

            const buyOrder = {
                maker: user2.address,
                tokenId: tokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 4
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, fakeSellSig, buyOrder, buySig)
            ).to.be.revertedWith("Invalid signature");
        });

        it("should prevent nonce replay attacks", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, ethers.constants.MaxUint256);

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

            const sellOrder = {
                maker: user1.address,
                tokenId: tokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 5
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

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

            const buyOrder = {
                maker: user2.address,
                tokenId: tokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 5
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            // First execution should succeed
            await marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig);

            // Mint another NFT for user1 with a different tokenId
            const mintPrice = ethers.utils.parseEther("1000");
            const mintDeadline = Math.floor(Date.now() / 1000) + 3600;
            const mintNonce = await moeToken.nonces(user1.address);

            const permitTypes = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const mintSig = ethers.utils.splitSignature(
                await user1._signTypedData(moeDomain, permitTypes, {
                    owner: user1.address,
                    spender: nft.address,
                    value: mintPrice,
                    nonce: mintNonce,
                    deadline: mintDeadline
                })
            );

            const tx = await nft.connect(deployer).mintWithPermit(
                user1.address, user1.address, 1, "card_replay",
                "ipfs://replay", mintPrice, mintDeadline, mintSig.v, mintSig.r, mintSig.s
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            const newTokenId = event.args.tokenId;

            // Verify tokenIds are actually different
            expect(newTokenId).to.not.equal(tokenId);

            // Create a new sell order with different tokenId but SAME nonce (replay attack)
            const replaySellOrder = {
                maker: user1.address,
                tokenId: newTokenId, // Different tokenId
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 5  // Same nonce as before - REPLAY ATTACK
            };

            const replaySellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, replaySellOrder);

            const replayBuyOrder = {
                maker: user2.address,
                tokenId: newTokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 10  // Different nonce for buyer (not reusing)
            };

            const replayBuySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, replayBuyOrder);

            // Try to execute order with reused seller nonce - should fail
            await expect(
                marketplace.connect(deployer).matchOrders(replaySellOrder, replaySellSig, replayBuyOrder, replayBuySig)
            ).to.be.revertedWith("Sell nonce used");
        });

        it("should reject orders with tokenId mismatch", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, ethers.constants.MaxUint256);

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

            const sellOrder = {
                maker: user1.address,
                tokenId: tokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 8
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

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

            const buyOrder = {
                maker: user2.address,
                tokenId: tokenId.add(999), // Different tokenId
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 8
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWith("Token ID mismatch");
        });

        it("should reject orders with amount mismatch", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const price = ethers.utils.parseEther("100");

            await nft.connect(user1).setApprovalForAll(marketplace.address, true);
            await moeToken.connect(user2).approve(marketplace.address, ethers.constants.MaxUint256);

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

            const sellOrder = {
                maker: user1.address,
                tokenId: tokenId,
                amount: 1,
                price: price,
                deadline: deadline,
                nonce: 9
            };

            const sellSig = await user1._signTypedData(marketplaceDomain, sellOrderTypes, sellOrder);

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

            const buyOrder = {
                maker: user2.address,
                tokenId: tokenId,
                amount: 2, // Different amount
                price: price,
                deadline: deadline,
                nonce: 9
            };

            const buySig = await user2._signTypedData(marketplaceDomain, buyOrderTypes, buyOrder);

            await expect(
                marketplace.connect(deployer).matchOrders(sellOrder, sellSig, buyOrder, buySig)
            ).to.be.revertedWith("Amount mismatch");
        });
    });
});
