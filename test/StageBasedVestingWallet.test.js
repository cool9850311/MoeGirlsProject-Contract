const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployContractsFixture } = require("./fixtures");

describe("StageBasedVestingWallet", function () {
    let deployer, user1, user2;
    let moeToken, vestingFactory;
    let vestingAmount;

    beforeEach(async function () {
        const fixture = await loadFixture(deployContractsFixture);
        deployer = fixture.deployer;
        user1 = fixture.user1;
        user2 = fixture.user2;
        moeToken = fixture.moeToken;
        vestingFactory = fixture.vestingFactory;

        // Standard vesting amount (must be divisible by 4)
        vestingAmount = ethers.utils.parseEther("400");
    });

    describe("Deployment and Initialization", function () {
        it("Should deploy VestingWallet via factory", async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            expect(vestingWalletAddress).to.not.equal(ethers.constants.AddressZero);
        });

        it("Should initialize with correct beneficiary", async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            expect(await vestingWallet.owner()).to.equal(user1.address);
        });

        it("Should have correct MOE balance after creation", async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const balance = await moeToken.balanceOf(vestingWalletAddress);
            expect(balance).to.equal(vestingAmount);
        });

        it("Should be marked as initialized", async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            expect(await vestingWallet.initialized()).to.be.true;
        });

        it("Should revert if trying to initialize again", async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            const currentTime = await time.latest();

            await expect(
                vestingWallet.initialize(user2.address, currentTime)
            ).to.be.revertedWith("Already initialized");
        });

        it("Should revert if beneficiary is zero address", async function () {
            await expect(
                vestingFactory.connect(deployer).createVesting(
                    ethers.constants.AddressZero, // Invalid
                    vestingAmount
                )
            ).to.be.revertedWith("Factory: beneficiary is zero address");
        });
    });

    describe("Stage Timing Boundaries (Precise)", function () {
        let vestingWallet;
        let startTime;

        beforeEach(async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            startTime = await vestingWallet.start();
        });

        it("Should have 0% releasable before first stage (29 seconds)", async function () {
            // Move to 29 seconds after start (1 second before first stage)
            await time.increaseTo(startTime.add(29));

            const releasable = await vestingWallet["releasable(address)"](moeToken.address);
            expect(releasable).to.equal(0);
        });

        it("Should have 25% releasable at exact first stage (30 seconds)", async function () {
            // Move to exactly 30 seconds
            await time.increaseTo(startTime.add(30));

            const releasable = await vestingWallet["releasable(address)"](moeToken.address);
            const expected = vestingAmount.mul(25).div(100); // 25% = 100 MOE
            expect(releasable).to.equal(expected);
        });

        it("Should still have only 25% releasable after first stage (31-59 seconds)", async function () {
            // Move to 45 seconds (between stage 1 and 2)
            await time.increaseTo(startTime.add(45));

            const releasable = await vestingWallet["releasable(address)"](moeToken.address);
            const expected = vestingAmount.mul(25).div(100);
            expect(releasable).to.equal(expected);
        });

        it("Should have 50% releasable at exact second stage (60 seconds)", async function () {
            await time.increaseTo(startTime.add(60));

            const releasable = await vestingWallet["releasable(address)"](moeToken.address);
            const expected = vestingAmount.mul(50).div(100); // 50% = 200 MOE
            expect(releasable).to.equal(expected);
        });

        it("Should have 75% releasable at exact third stage (90 seconds)", async function () {
            await time.increaseTo(startTime.add(90));

            const releasable = await vestingWallet["releasable(address)"](moeToken.address);
            const expected = vestingAmount.mul(75).div(100); // 75% = 300 MOE
            expect(releasable).to.equal(expected);
        });

        it("Should have 100% releasable at exact fourth stage (120 seconds)", async function () {
            await time.increaseTo(startTime.add(120));

            const releasable = await vestingWallet["releasable(address)"](moeToken.address);
            expect(releasable).to.equal(vestingAmount); // 100% = 400 MOE
        });

        it("Should still have only 100% releasable after all stages (121+ seconds)", async function () {
            await time.increaseTo(startTime.add(200)); // Way past all stages

            const releasable = await vestingWallet["releasable(address)"](moeToken.address);
            expect(releasable).to.equal(vestingAmount);
        });
    });

    describe("Release Mechanics", function () {
        let vestingWallet;
        let startTime;

        beforeEach(async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            startTime = await vestingWallet.start();
        });

        it("Should allow beneficiary to release stage 1 (25%)", async function () {
            await time.increaseTo(startTime.add(30));

            const balanceBefore = await moeToken.balanceOf(user1.address);
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);
            const balanceAfter = await moeToken.balanceOf(user1.address);

            const released = balanceAfter.sub(balanceBefore);
            expect(released).to.equal(vestingAmount.mul(25).div(100));
        });

        it("Should track released amount correctly", async function () {
            await time.increaseTo(startTime.add(30));

            // Initially 0 released
            expect(await vestingWallet["released(address)"](moeToken.address)).to.equal(0);

            // Release stage 1
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);

            const expectedStage1 = vestingAmount.mul(25).div(100);
            expect(await vestingWallet["released(address)"](moeToken.address)).to.equal(expectedStage1);
        });

        it("Should allow releasing multiple stages cumulatively", async function () {
            // Release stage 1 (25%)
            await time.increaseTo(startTime.add(30));
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);

            const releasedStage1 = await vestingWallet["released(address)"](moeToken.address);
            expect(releasedStage1).to.equal(vestingAmount.mul(25).div(100));

            // Release stage 2 (cumulative 50%)
            await time.increaseTo(startTime.add(60));
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);

            const releasedStage2 = await vestingWallet["released(address)"](moeToken.address);
            expect(releasedStage2).to.equal(vestingAmount.mul(50).div(100));

            // Release stage 3 (cumulative 75%)
            await time.increaseTo(startTime.add(90));
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);

            const releasedStage3 = await vestingWallet["released(address)"](moeToken.address);
            expect(releasedStage3).to.equal(vestingAmount.mul(75).div(100));

            // Release stage 4 (cumulative 100%)
            await time.increaseTo(startTime.add(120));
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);

            const releasedStage4 = await vestingWallet["released(address)"](moeToken.address);
            expect(releasedStage4).to.equal(vestingAmount);
        });

        it("Should emit ERC20Released event on release", async function () {
            await time.increaseTo(startTime.add(30));

            const expectedAmount = vestingAmount.mul(25).div(100);

            await expect(
                vestingWallet.connect(user1)["release(address)"](moeToken.address)
            )
                .to.emit(vestingWallet, "ERC20Released")
                .withArgs(moeToken.address, expectedAmount);
        });

        it("Should allow anyone to call release (but tokens go to beneficiary)", async function () {
            await time.increaseTo(startTime.add(30));

            const balanceBefore = await moeToken.balanceOf(user1.address);

            // user2 calls release, but tokens go to user1
            await vestingWallet.connect(user2)["release(address)"](moeToken.address);

            const balanceAfter = await moeToken.balanceOf(user1.address);
            const released = balanceAfter.sub(balanceBefore);

            expect(released).to.equal(vestingAmount.mul(25).div(100));
        });

        it("Should not release anything if called before first stage", async function () {
            // Still at 0 seconds
            await time.increaseTo(startTime.add(10));

            const balanceBefore = await moeToken.balanceOf(user1.address);
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);
            const balanceAfter = await moeToken.balanceOf(user1.address);

            expect(balanceAfter).to.equal(balanceBefore); // No change
        });

        it("Should not release more if called multiple times in same stage", async function () {
            await time.increaseTo(startTime.add(30));

            // First release
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);
            const releasedFirst = await vestingWallet["released(address)"](moeToken.address);

            // Second release (still in stage 1)
            await vestingWallet.connect(user1)["release(address)"](moeToken.address);
            const releasedSecond = await vestingWallet["released(address)"](moeToken.address);

            // Should be the same
            expect(releasedSecond).to.equal(releasedFirst);
        });
    });

    describe("getStageInfo Query", function () {
        let vestingWallet;
        let startTime;

        beforeEach(async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            startTime = await vestingWallet.start();
        });

        it("Should return correct stage timestamps", async function () {
            const [stageTimestamps, stagePercentages] = await vestingWallet.getStageInfo();

            // stageTimes are relative seconds, not absolute timestamps
            expect(stageTimestamps[0]).to.equal(30);  // Stage 1: 30s
            expect(stageTimestamps[1]).to.equal(60);  // Stage 2: 60s
            expect(stageTimestamps[2]).to.equal(90);  // Stage 3: 90s
            expect(stageTimestamps[3]).to.equal(120); // Stage 4: 120s
        });

        it("Should return correct stage percentages", async function () {
            const [stageTimestamps, stagePercentages] = await vestingWallet.getStageInfo();

            // stagePercents are in basis points (10000 = 100%)
            expect(stagePercentages[0]).to.equal(2500);  // 25% = 2500 bps
            expect(stagePercentages[1]).to.equal(5000);  // 50% = 5000 bps
            expect(stagePercentages[2]).to.equal(7500);  // 75% = 7500 bps
            expect(stagePercentages[3]).to.equal(10000); // 100% = 10000 bps
        });
    });

    describe("Proxy Pattern Isolation", function () {
        it("Should create independent vesting wallets for different users", async function () {
            // Create vesting for user1
            const tx1 = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.events.find(e => e.event === 'VestingCreated');
            const vesting1Address = event1.args.vestingWallet;

            // Create vesting for user2
            const tx2 = await vestingFactory.connect(deployer).createVesting(
                user2.address,
                vestingAmount
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.events.find(e => e.event === 'VestingCreated');
            const vesting2Address = event2.args.vestingWallet;

            // Should be different addresses
            expect(vesting1Address).to.not.equal(vesting2Address);

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vesting1 = StageBasedVestingWallet.attach(vesting1Address);
            const vesting2 = StageBasedVestingWallet.attach(vesting2Address);

            // Should have different beneficiaries
            expect(await vesting1.owner()).to.equal(user1.address);
            expect(await vesting2.owner()).to.equal(user2.address);

            // Should have independent balances
            expect(await moeToken.balanceOf(vesting1Address)).to.equal(vestingAmount);
            expect(await moeToken.balanceOf(vesting2Address)).to.equal(vestingAmount);
        });

        it("Should allow independent release for each vesting wallet", async function () {
            // Create vestings
            const tx1 = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.events.find(e => e.event === 'VestingCreated');
            const vesting1Address = event1.args.vestingWallet;

            const tx2 = await vestingFactory.connect(deployer).createVesting(
                user2.address,
                vestingAmount
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.events.find(e => e.event === 'VestingCreated');
            const vesting2Address = event2.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vesting1 = StageBasedVestingWallet.attach(vesting1Address);
            const vesting2 = StageBasedVestingWallet.attach(vesting2Address);

            const start1 = await vesting1.start();
            const start2 = await vesting2.start();

            // Advance to stage 1
            const maxStart = start1.gt(start2) ? start1 : start2;
            await time.increaseTo(maxStart.add(30));

            // User1 releases
            await vesting1.connect(user1)["release(address)"](moeToken.address);

            // User2 doesn't release yet

            // Check independent state
            expect(await vesting1["released(address)"](moeToken.address)).to.equal(vestingAmount.mul(25).div(100));
            expect(await vesting2["released(address)"](moeToken.address)).to.equal(0);

            // User2 releases later
            await time.increaseTo(maxStart.add(60));
            await vesting2.connect(user2)["release(address)"](moeToken.address);

            // User2 gets 50% (didn't release stage 1)
            expect(await vesting2["released(address)"](moeToken.address)).to.equal(vestingAmount.mul(50).div(100));
        });

        it("Should not allow cross-contamination between proxies", async function () {
            const tx1 = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.events.find(e => e.event === 'VestingCreated');
            const vesting1Address = event1.args.vestingWallet;

            const tx2 = await vestingFactory.connect(deployer).createVesting(
                user2.address,
                vestingAmount.mul(2) // Different amount
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.events.find(e => e.event === 'VestingCreated');
            const vesting2Address = event2.args.vestingWallet;

            // Each should have its own allocation
            expect(await moeToken.balanceOf(vesting1Address)).to.equal(vestingAmount);
            expect(await moeToken.balanceOf(vesting2Address)).to.equal(vestingAmount.mul(2));
        });
    });

    describe("Edge Cases", function () {
        it("Should handle very large vesting amounts", async function () {
            const largeAmount = ethers.utils.parseEther("10000000"); // 10M MOE (divisible by 4)

            // Mint more to factory
            await moeToken.mint(vestingFactory.address, largeAmount);

            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                largeAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            expect(await moeToken.balanceOf(vestingWalletAddress)).to.equal(largeAmount);
        });

        it("Should handle minimum vesting amount (4 wei)", async function () {
            const minAmount = ethers.BigNumber.from("4"); // Smallest divisible by 4

            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                minAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            const startTime = await vestingWallet.start();
            await time.increaseTo(startTime.add(30));

            const releasable = await vestingWallet["releasable(address)"](moeToken.address);
            // 25% of 4 = 1
            expect(releasable).to.equal(1);
        });

        it("Should correctly calculate duration as 120 seconds", async function () {
            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            expect(await vestingWallet.duration()).to.equal(120);
        });
    });

    describe("Start Time Verification", function () {
        it("Should set start time to creation timestamp", async function () {
            const txTimeBefore = await time.latest();

            const tx = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );

            const receipt = await tx.wait();
            const txTimeAfter = await time.latest();

            const event = receipt.events.find(e => e.event === 'VestingCreated');
            const vestingWalletAddress = event.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vestingWallet = StageBasedVestingWallet.attach(vestingWalletAddress);

            const startTime = await vestingWallet.start();

            // Start time should be within transaction time range
            expect(startTime).to.be.gte(txTimeBefore);
            expect(startTime).to.be.lte(txTimeAfter);
        });

        it("Should have different start times for sequentially created vestings", async function () {
            const tx1 = await vestingFactory.connect(deployer).createVesting(
                user1.address,
                vestingAmount
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.events.find(e => e.event === 'VestingCreated');
            const vesting1Address = event1.args.vestingWallet;

            // Wait 10 seconds
            await time.increase(10);

            const tx2 = await vestingFactory.connect(deployer).createVesting(
                user2.address,
                vestingAmount
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.events.find(e => e.event === 'VestingCreated');
            const vesting2Address = event2.args.vestingWallet;

            const StageBasedVestingWallet = await ethers.getContractFactory("StageBasedVestingWallet");
            const vesting1 = StageBasedVestingWallet.attach(vesting1Address);
            const vesting2 = StageBasedVestingWallet.attach(vesting2Address);

            const start1 = await vesting1.start();
            const start2 = await vesting2.start();

            // start2 should be > start1
            expect(start2).to.be.gt(start1);
        });
    });
});
