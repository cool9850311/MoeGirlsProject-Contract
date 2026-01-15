const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployContractsFixture } = require("./fixtures");

describe("MoeGirlsNFT", function () {
    let deployer, user1, user2;
    let moeToken, nft;
    let chainId;

    beforeEach(async function () {
        const fixture = await loadFixture(deployContractsFixture);
        deployer = fixture.deployer;
        user1 = fixture.user1;
        user2 = fixture.user2;
        moeToken = fixture.moeToken;
        nft = fixture.nft;

        chainId = (await ethers.provider.getNetwork()).chainId;
    });

    describe("Deployment", function () {
        it("Should set the correct MOE token address", async function () {
            expect(await nft.moeToken()).to.equal(moeToken.address);
        });

        it("Should set the correct owner", async function () {
            expect(await nft.owner()).to.equal(deployer.address);
        });

        it("Should start with tokenId counter at 1", async function () {
            // First mint should get tokenId = 1
            const price = ethers.utils.parseEther("1000");
            await moeToken.connect(user1).approve(nft.address, price);

            await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                "card_first",
                "ipfs://first",
                price
            );

            const balance = await nft.balanceOf(user1.address, 1);
            expect(balance).to.equal(1);
        });
    });

    describe("mintWithApproval", function () {
        const price = ethers.utils.parseEther("1000");
        const cardId = "card_test_001";
        const metadataUri = "ipfs://QmTest123";

        it("Should allow owner to mint NFT with prior approval", async function () {
            // User approves MOE to NFT contract
            await moeToken.connect(user1).approve(nft.address, price);

            // Owner mints NFT for user
            const tx = await nft.connect(deployer).mintWithApproval(
                user1.address, // payer
                user1.address, // recipient
                1,             // amount
                cardId,
                metadataUri,
                price
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            const tokenId = event.args.tokenId;

            // Verify NFT minted
            expect(await nft.balanceOf(user1.address, tokenId)).to.equal(1);

            // Verify metadata stored correctly
            expect(await nft.uri(tokenId)).to.equal(metadataUri);
            expect(await nft.getCardId(tokenId)).to.equal(cardId);
        });

        it("Should transfer MOE payment from payer to owner", async function () {
            await moeToken.connect(user1).approve(nft.address, price);

            const balanceBefore = await moeToken.balanceOf(deployer.address);

            await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                cardId,
                metadataUri,
                price
            );

            const balanceAfter = await moeToken.balanceOf(deployer.address);
            expect(balanceAfter.sub(balanceBefore)).to.equal(price);
        });

        it("Should emit NFTMinted event with correct parameters", async function () {
            await moeToken.connect(user1).approve(nft.address, price);

            await expect(nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                cardId,
                metadataUri,
                price
            ))
                .to.emit(nft, "NFTMinted")
                .withArgs(user1.address, 1, cardId, metadataUri);
        });

        it("Should revert if non-owner tries to mint", async function () {
            await moeToken.connect(user1).approve(nft.address, price);

            await expect(
                nft.connect(user1).mintWithApproval(
                    user1.address,
                    user1.address,
                    1,
                    cardId,
                    metadataUri,
                    price
                )
            ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
        });

        it("Should revert if recipient is zero address", async function () {
            await moeToken.connect(user1).approve(nft.address, price);

            await expect(
                nft.connect(deployer).mintWithApproval(
                    user1.address,
                    ethers.constants.AddressZero, // to = 0x0
                    1,
                    cardId,
                    metadataUri,
                    price
                )
            ).to.be.revertedWith("Invalid recipient");
        });

        it("Should revert if payer has insufficient MOE balance", async function () {
            // user1 only has 10000 MOE
            const excessivePrice = ethers.utils.parseEther("20000");
            await moeToken.connect(user1).approve(nft.address, excessivePrice);

            await expect(
                nft.connect(deployer).mintWithApproval(
                    user1.address,
                    user1.address,
                    1,
                    cardId,
                    metadataUri,
                    excessivePrice
                )
            ).to.be.revertedWithCustomError(moeToken, "ERC20InsufficientBalance");
        });

        it("Should revert if payer has insufficient allowance", async function () {
            // Approve less than required
            const insufficientApproval = ethers.utils.parseEther("500");
            await moeToken.connect(user1).approve(nft.address, insufficientApproval);

            await expect(
                nft.connect(deployer).mintWithApproval(
                    user1.address,
                    user1.address,
                    1,
                    cardId,
                    metadataUri,
                    price // 1000 MOE required
                )
            ).to.be.revertedWithCustomError(moeToken, "ERC20InsufficientAllowance");
        });

        it("Should allow minting with zero price (free mint)", async function () {
            const tx = await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                cardId,
                metadataUri,
                0 // Free
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            expect(event.args.tokenId).to.equal(1);
        });

        it("Should mint multiple NFTs to the same user", async function () {
            await moeToken.connect(user1).approve(nft.address, price.mul(3));

            // Mint 3 different NFTs
            await nft.connect(deployer).mintWithApproval(
                user1.address, user1.address, 1, "card_1", "ipfs://1", price
            );
            await nft.connect(deployer).mintWithApproval(
                user1.address, user1.address, 1, "card_2", "ipfs://2", price
            );
            await nft.connect(deployer).mintWithApproval(
                user1.address, user1.address, 1, "card_3", "ipfs://3", price
            );

            // User should have 3 different tokenIds (1, 2, 3)
            expect(await nft.balanceOf(user1.address, 1)).to.equal(1);
            expect(await nft.balanceOf(user1.address, 2)).to.equal(1);
            expect(await nft.balanceOf(user1.address, 3)).to.equal(1);
        });

        it("Should support minting multiple copies of same NFT (ERC1155 amount)", async function () {
            await moeToken.connect(user1).approve(nft.address, price.mul(5));

            // Mint 5 copies of the same card
            await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                5, // amount = 5
                cardId,
                metadataUri,
                price.mul(5)
            );

            // User should have 5 copies of tokenId 1
            expect(await nft.balanceOf(user1.address, 1)).to.equal(5);
        });
    });

    describe("mintWithPermit", function () {
        const price = ethers.utils.parseEther("1000");
        const cardId = "card_permit_test";
        const metadataUri = "ipfs://QmPermitTest";

        it("Should allow owner to mint NFT using EIP-2612 Permit", async function () {
            // Get current nonce from MOEToken (might have been incremented by previous tests)
            const currentNonce = await moeToken.nonces(user1.address);

            const deadline = Math.floor(Date.now() / 1000) + 3600;

            const domain = {
                name: await moeToken.name(),
                version: "1",
                chainId: chainId,
                verifyingContract: moeToken.address
            };

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const value = {
                owner: user1.address,
                spender: nft.address,
                value: price,
                nonce: currentNonce,
                deadline: deadline
            };

            const signature = await user1._signTypedData(domain, types, value);
            const sig = ethers.utils.splitSignature(signature);

            const tx = await nft.connect(deployer).mintWithPermit(
                user1.address,
                user1.address,
                1,
                cardId,
                metadataUri,
                price,
                deadline,
                sig.v,
                sig.r,
                sig.s
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            expect(event.args.tokenId).to.equal(1);
            expect(await nft.balanceOf(user1.address, 1)).to.equal(1);
        });

        it("Should revert if permit signature is expired", async function () {
            const expiredDeadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
            const nonce = await moeToken.nonces(user1.address);

            const domain = {
                name: await moeToken.name(),
                version: "1",
                chainId: chainId,
                verifyingContract: moeToken.address
            };

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const value = {
                owner: user1.address,
                spender: nft.address,
                value: price,
                nonce: nonce,
                deadline: expiredDeadline
            };

            const signature = await user1._signTypedData(domain, types, value);
            const sig = ethers.utils.splitSignature(signature);

            await expect(
                nft.connect(deployer).mintWithPermit(
                    user1.address,
                    user1.address,
                    1,
                    cardId,
                    metadataUri,
                    price,
                    expiredDeadline,
                    sig.v,
                    sig.r,
                    sig.s
                )
            ).to.be.revertedWithCustomError(moeToken, "ERC2612ExpiredSignature");
        });

        it("Should revert if non-owner calls mintWithPermit", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const nonce = await moeToken.nonces(user1.address);

            const domain = {
                name: await moeToken.name(),
                version: "1",
                chainId: chainId,
                verifyingContract: moeToken.address
            };

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const value = {
                owner: user1.address,
                spender: nft.address,
                value: price,
                nonce: nonce,
                deadline: deadline
            };

            const signature = await user1._signTypedData(domain, types, value);
            const sig = ethers.utils.splitSignature(signature);

            await expect(
                nft.connect(user2).mintWithPermit( // user2 is not owner
                    user1.address,
                    user1.address,
                    1,
                    cardId,
                    metadataUri,
                    price,
                    deadline,
                    sig.v,
                    sig.r,
                    sig.s
                )
            ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
        });
    });

    describe("Metadata and URI Management", function () {
        const price = ethers.utils.parseEther("1000");

        it("Should return correct URI for minted token", async function () {
            const metadataUri = "ipfs://QmSpecificMetadata123";
            await moeToken.connect(user1).approve(nft.address, price);

            const tx = await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                "card_uri_test",
                metadataUri,
                price
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            const tokenId = event.args.tokenId;

            expect(await nft.uri(tokenId)).to.equal(metadataUri);
        });

        it("Should return correct cardId for minted token", async function () {
            const cardId = "rare_card_dragon_001";
            await moeToken.connect(user1).approve(nft.address, price);

            const tx = await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                cardId,
                "ipfs://dragon",
                price
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            const tokenId = event.args.tokenId;

            expect(await nft.getCardId(tokenId)).to.equal(cardId);
        });

        it("Should differentiate URIs for different tokenIds", async function () {
            await moeToken.connect(user1).approve(nft.address, price.mul(3));

            const uris = [
                "ipfs://QmCard1",
                "ipfs://QmCard2",
                "ipfs://QmCard3"
            ];

            for (let i = 0; i < 3; i++) {
                await nft.connect(deployer).mintWithApproval(
                    user1.address,
                    user1.address,
                    1,
                    `card_${i + 1}`,
                    uris[i],
                    price
                );
            }

            // Verify each tokenId has its own unique URI
            expect(await nft.uri(1)).to.equal(uris[0]);
            expect(await nft.uri(2)).to.equal(uris[1]);
            expect(await nft.uri(3)).to.equal(uris[2]);
        });

        it("Should differentiate cardIds for different tokenIds", async function () {
            await moeToken.connect(user1).approve(nft.address, price.mul(3));

            const cardIds = ["warrior", "mage", "archer"];

            for (let i = 0; i < 3; i++) {
                await nft.connect(deployer).mintWithApproval(
                    user1.address,
                    user1.address,
                    1,
                    cardIds[i],
                    `ipfs://${cardIds[i]}`,
                    price
                );
            }

            // Verify each tokenId has its own unique cardId
            expect(await nft.getCardId(1)).to.equal(cardIds[0]);
            expect(await nft.getCardId(2)).to.equal(cardIds[1]);
            expect(await nft.getCardId(3)).to.equal(cardIds[2]);
        });
    });

    describe("TokenId Counter", function () {
        const price = ethers.utils.parseEther("1000");

        it("Should increment tokenId for each mint", async function () {
            await moeToken.connect(user1).approve(nft.address, price.mul(5));

            for (let i = 1; i <= 5; i++) {
                const tx = await nft.connect(deployer).mintWithApproval(
                    user1.address,
                    user1.address,
                    1,
                    `card_${i}`,
                    `ipfs://${i}`,
                    price
                );

                const receipt = await tx.wait();
                const event = receipt.events.find(e => e.event === 'NFTMinted');
                expect(event.args.tokenId).to.equal(i);
            }
        });

        it("Should ensure tokenId uniqueness across multiple users", async function () {
            await moeToken.connect(user1).approve(nft.address, price.mul(2));
            await moeToken.connect(user2).approve(nft.address, price.mul(2));

            // User1 mints tokenId 1
            let tx = await nft.connect(deployer).mintWithApproval(
                user1.address, user1.address, 1, "card_1", "ipfs://1", price
            );
            let receipt = await tx.wait();
            let event = receipt.events.find(e => e.event === 'NFTMinted');
            expect(event.args.tokenId).to.equal(1);

            // User2 mints tokenId 2 (not 1)
            tx = await nft.connect(deployer).mintWithApproval(
                user2.address, user2.address, 1, "card_2", "ipfs://2", price
            );
            receipt = await tx.wait();
            event = receipt.events.find(e => e.event === 'NFTMinted');
            expect(event.args.tokenId).to.equal(2);

            // User1 mints again, gets tokenId 3
            tx = await nft.connect(deployer).mintWithApproval(
                user1.address, user1.address, 1, "card_3", "ipfs://3", price
            );
            receipt = await tx.wait();
            event = receipt.events.find(e => e.event === 'NFTMinted');
            expect(event.args.tokenId).to.equal(3);
        });
    });

    describe("ERC1155 Standard Compliance", function () {
        const price = ethers.utils.parseEther("1000");

        it("Should support ERC1155 interface", async function () {
            // ERC1155 interface ID: 0xd9b67a26
            expect(await nft.supportsInterface("0xd9b67a26")).to.be.true;
        });

        it("Should allow safe transfers", async function () {
            await moeToken.connect(user1).approve(nft.address, price);

            await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                "card_transfer_test",
                "ipfs://transfer",
                price
            );

            // Transfer from user1 to user2
            await nft.connect(user1).safeTransferFrom(
                user1.address,
                user2.address,
                1, // tokenId
                1, // amount
                "0x"
            );

            expect(await nft.balanceOf(user1.address, 1)).to.equal(0);
            expect(await nft.balanceOf(user2.address, 1)).to.equal(1);
        });

        it("Should support setApprovalForAll", async function () {
            await moeToken.connect(user1).approve(nft.address, price);

            await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                "card_approval_test",
                "ipfs://approval",
                price
            );

            // User1 approves user2 for all tokens
            await nft.connect(user1).setApprovalForAll(user2.address, true);
            expect(await nft.isApprovedForAll(user1.address, user2.address)).to.be.true;

            // User2 can transfer user1's NFT
            await nft.connect(user2).safeTransferFrom(
                user1.address,
                user2.address,
                1,
                1,
                "0x"
            );

            expect(await nft.balanceOf(user2.address, 1)).to.equal(1);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle very large price values", async function () {
            const largePrice = ethers.utils.parseEther("1000000"); // 1M MOE

            // Mint enough MOE for user1
            await moeToken.mint(user1.address, largePrice);
            await moeToken.connect(user1).approve(nft.address, largePrice);

            await expect(
                nft.connect(deployer).mintWithApproval(
                    user1.address,
                    user1.address,
                    1,
                    "expensive_card",
                    "ipfs://expensive",
                    largePrice
                )
            ).to.not.be.reverted;
        });

        it("Should handle empty metadata URI", async function () {
            const price = ethers.utils.parseEther("1000");
            await moeToken.connect(user1).approve(nft.address, price);

            const tx = await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                "card_no_uri",
                "", // Empty URI
                price
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            expect(await nft.uri(event.args.tokenId)).to.equal("");
        });

        it("Should handle very long metadata URIs", async function () {
            const price = ethers.utils.parseEther("1000");
            const longUri = "ipfs://Qm" + "a".repeat(500); // Very long URI

            await moeToken.connect(user1).approve(nft.address, price);

            const tx = await nft.connect(deployer).mintWithApproval(
                user1.address,
                user1.address,
                1,
                "card_long_uri",
                longUri,
                price
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'NFTMinted');
            expect(await nft.uri(event.args.tokenId)).to.equal(longUri);
        });
    });
});
