const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Gas Comparison: Legacy vs EIP-1167", function () {
    let moeToken;
    let legacyFactory;
    let eip1167Factory;
    let owner;
    let players;

    const INITIAL_SUPPLY = ethers.utils.parseEther("10000000");
    const FACTORY_BALANCE = ethers.utils.parseEther("10000");
    const VESTING_AMOUNT = ethers.utils.parseEther("400");
    const NUM_VESTINGS = 10;

    before(async function () {
        [owner, ...players] = await ethers.getSigners();

        // Ensure we have enough test accounts
        if (players.length < NUM_VESTINGS) {
            throw new Error(`Need at least ${NUM_VESTINGS} player accounts, got ${players.length}`);
        }

        console.log("\n========================================");
        console.log("  GAS COMPARISON TEST SETUP");
        console.log("========================================");
        console.log(`Owner: ${owner.address}`);
        console.log(`Players: ${NUM_VESTINGS} accounts`);
        console.log(`Vesting Amount: ${ethers.utils.formatEther(VESTING_AMOUNT)} MOE each`);
        console.log("========================================\n");
    });

    describe("Legacy Implementation (using 'new')", function () {
        let deployGas;
        let createGasCosts = [];
        let totalCreateGas = ethers.BigNumber.from(0);

        it("Should deploy MOEToken", async function () {
            const MOEToken = await ethers.getContractFactory("MOEToken");
            moeToken = await MOEToken.deploy(owner.address);
            const receipt = await moeToken.deployTransaction.wait();
            deployGas = receipt.gasUsed;

            console.log(`\n📦 MOEToken deployed`);
            console.log(`   Gas used: ${deployGas.toLocaleString()}`);
        });

        it("Should deploy Legacy Factory", async function () {
            const Factory = await ethers.getContractFactory("VestingWalletFactoryLegacy");
            legacyFactory = await Factory.deploy(moeToken.address, owner.address);
            const receipt = await legacyFactory.deployTransaction.wait();
            deployGas = receipt.gasUsed;

            console.log(`\n📦 Legacy Factory deployed`);
            console.log(`   Gas used: ${deployGas.toLocaleString()}`);
        });

        it("Should fund Legacy Factory with MOE", async function () {
            await moeToken.transfer(legacyFactory.address, FACTORY_BALANCE);
            const balance = await legacyFactory.getBalance();
            expect(balance).to.equal(FACTORY_BALANCE);

            console.log(`\n💰 Factory funded with ${ethers.utils.formatEther(FACTORY_BALANCE)} MOE`);
        });

        it(`Should create ${NUM_VESTINGS} vesting wallets (Legacy)`, async function () {
            console.log(`\n🔄 Creating ${NUM_VESTINGS} vesting wallets using 'new' keyword...`);
            console.log("   Beneficiary                                     Gas Used");
            console.log("   ──────────────────────────────────────────────  ────────");

            for (let i = 0; i < NUM_VESTINGS; i++) {
                const player = players[i];
                const tx = await legacyFactory.createVesting(player.address, VESTING_AMOUNT);
                const receipt = await tx.wait();
                const gasUsed = receipt.gasUsed;

                createGasCosts.push(gasUsed);
                totalCreateGas = totalCreateGas.add(gasUsed);

                console.log(`   ${player.address}  ${gasUsed.toLocaleString().padStart(8)}`);
            }

            const avgGas = totalCreateGas.div(NUM_VESTINGS);
            const minGas = createGasCosts.reduce((min, gas) => gas.lt(min) ? gas : min);
            const maxGas = createGasCosts.reduce((max, gas) => gas.gt(max) ? gas : max);

            console.log("   ──────────────────────────────────────────────  ────────");
            console.log(`   Total Gas:                                      ${totalCreateGas.toLocaleString()}`);
            console.log(`   Average Gas per wallet:                         ${avgGas.toLocaleString()}`);
            console.log(`   Min Gas:                                        ${minGas.toLocaleString()}`);
            console.log(`   Max Gas:                                        ${maxGas.toLocaleString()}`);

            // Store for comparison
            this.legacyResults = {
                totalGas: totalCreateGas,
                avgGas: avgGas,
                minGas: minGas,
                maxGas: maxGas,
                costs: createGasCosts
            };
        });

        it("Should verify all vestings created", async function () {
            const total = await legacyFactory.getTotalVestingWallets();
            expect(total).to.equal(NUM_VESTINGS);

            console.log(`\n✅ ${total} vesting wallets verified`);
        });
    });

    describe("EIP-1167 Implementation (using Clones)", function () {
        let deployGas;
        let createGasCosts = [];
        let totalCreateGas = ethers.BigNumber.from(0);

        it("Should deploy EIP-1167 Factory", async function () {
            const Factory = await ethers.getContractFactory("VestingWalletFactory");
            eip1167Factory = await Factory.deploy(moeToken.address, owner.address);
            const receipt = await eip1167Factory.deployTransaction.wait();
            deployGas = receipt.gasUsed;

            const implAddress = await eip1167Factory.vestingWalletImplementation();

            console.log(`\n📦 EIP-1167 Factory deployed`);
            console.log(`   Gas used: ${deployGas.toLocaleString()}`);
            console.log(`   Implementation: ${implAddress}`);
        });

        it("Should fund EIP-1167 Factory with MOE", async function () {
            await moeToken.transfer(eip1167Factory.address, FACTORY_BALANCE);
            const balance = await eip1167Factory.getBalance();
            expect(balance).to.equal(FACTORY_BALANCE);

            console.log(`\n💰 Factory funded with ${ethers.utils.formatEther(FACTORY_BALANCE)} MOE`);
        });

        it(`Should create ${NUM_VESTINGS} vesting wallets (EIP-1167)`, async function () {
            console.log(`\n🔄 Creating ${NUM_VESTINGS} vesting wallets using Clones.clone()...`);
            console.log("   Beneficiary                                     Gas Used");
            console.log("   ──────────────────────────────────────────────  ────────");

            for (let i = 0; i < NUM_VESTINGS; i++) {
                const player = players[i];
                const tx = await eip1167Factory.createVesting(player.address, VESTING_AMOUNT);
                const receipt = await tx.wait();
                const gasUsed = receipt.gasUsed;

                createGasCosts.push(gasUsed);
                totalCreateGas = totalCreateGas.add(gasUsed);

                console.log(`   ${player.address}  ${gasUsed.toLocaleString().padStart(8)}`);
            }

            const avgGas = totalCreateGas.div(NUM_VESTINGS);
            const minGas = createGasCosts.reduce((min, gas) => gas.lt(min) ? gas : min);
            const maxGas = createGasCosts.reduce((max, gas) => gas.gt(max) ? gas : max);

            console.log("   ──────────────────────────────────────────────  ────────");
            console.log(`   Total Gas:                                      ${totalCreateGas.toLocaleString()}`);
            console.log(`   Average Gas per wallet:                         ${avgGas.toLocaleString()}`);
            console.log(`   Min Gas:                                        ${minGas.toLocaleString()}`);
            console.log(`   Max Gas:                                        ${maxGas.toLocaleString()}`);

            // Store for comparison
            this.eip1167Results = {
                totalGas: totalCreateGas,
                avgGas: avgGas,
                minGas: minGas,
                maxGas: maxGas,
                costs: createGasCosts
            };
        });

        it("Should verify all vestings created", async function () {
            const total = await eip1167Factory.getTotalVestingWallets();
            expect(total).to.equal(NUM_VESTINGS);

            console.log(`\n✅ ${total} vesting wallets verified`);
        });
    });

    describe("Gas Comparison Summary", function () {
        it("Should compare and display results", async function () {
            // Get results from previous test suites
            const legacyResults = this.test.parent.parent.suites[0].ctx.legacyResults;
            const eip1167Results = this.test.parent.parent.suites[1].ctx.eip1167Results;

            console.log("\n");
            console.log("╔════════════════════════════════════════════════════════════════╗");
            console.log("║                   GAS COMPARISON RESULTS                       ║");
            console.log("╠════════════════════════════════════════════════════════════════╣");
            console.log("║  Metric                    Legacy          EIP-1167    Savings ║");
            console.log("╠════════════════════════════════════════════════════════════════╣");

            // Total Gas
            const totalSavings = legacyResults.totalGas.sub(eip1167Results.totalGas);
            const totalSavingsPct = totalSavings.mul(10000).div(legacyResults.totalGas).toNumber() / 100;
            console.log(`║  Total Gas (${NUM_VESTINGS} wallets)  ${legacyResults.totalGas.toLocaleString().padStart(10)}    ${eip1167Results.totalGas.toLocaleString().padStart(10)}    ${totalSavingsPct.toFixed(2).padStart(5)}% ║`);

            // Average Gas
            const avgSavings = legacyResults.avgGas.sub(eip1167Results.avgGas);
            const avgSavingsPct = avgSavings.mul(10000).div(legacyResults.avgGas).toNumber() / 100;
            console.log(`║  Avg Gas per wallet        ${legacyResults.avgGas.toLocaleString().padStart(10)}    ${eip1167Results.avgGas.toLocaleString().padStart(10)}    ${avgSavingsPct.toFixed(2).padStart(5)}% ║`);

            // Min Gas
            const minSavings = legacyResults.minGas.sub(eip1167Results.minGas);
            const minSavingsPct = minSavings.mul(10000).div(legacyResults.minGas).toNumber() / 100;
            console.log(`║  Min Gas                   ${legacyResults.minGas.toLocaleString().padStart(10)}    ${eip1167Results.minGas.toLocaleString().padStart(10)}    ${minSavingsPct.toFixed(2).padStart(5)}% ║`);

            // Max Gas
            const maxSavings = legacyResults.maxGas.sub(eip1167Results.maxGas);
            const maxSavingsPct = maxSavings.mul(10000).div(legacyResults.maxGas).toNumber() / 100;
            console.log(`║  Max Gas                   ${legacyResults.maxGas.toLocaleString().padStart(10)}    ${eip1167Results.maxGas.toLocaleString().padStart(10)}    ${maxSavingsPct.toFixed(2).padStart(5)}% ║`);

            console.log("╚════════════════════════════════════════════════════════════════╝");

            // Gas cost at current ETH prices (example)
            const ethPrice = 3000; // USD per ETH (example)
            const gasPrice = 30; // Gwei (example)
            const legacyCostUSD = legacyResults.totalGas.mul(gasPrice).toNumber() / 1e9 * ethPrice;
            const eip1167CostUSD = eip1167Results.totalGas.mul(gasPrice).toNumber() / 1e9 * ethPrice;
            const savingsUSD = legacyCostUSD - eip1167CostUSD;

            console.log("\n💵 Cost Analysis (at gas price = 30 Gwei, ETH = $3000):");
            console.log(`   Legacy:   $${legacyCostUSD.toFixed(2)}`);
            console.log(`   EIP-1167: $${eip1167CostUSD.toFixed(2)}`);
            console.log(`   Savings:  $${savingsUSD.toFixed(2)} (${totalSavingsPct.toFixed(2)}%)`);

            console.log("\n📊 Detailed Gas Breakdown:");
            console.log("   Wallet #   Legacy      EIP-1167    Savings     %");
            console.log("   ────────   ──────────  ──────────  ──────────  ─────");
            for (let i = 0; i < NUM_VESTINGS; i++) {
                const legacyGas = legacyResults.costs[i];
                const eip1167Gas = eip1167Results.costs[i];
                const savings = legacyGas.sub(eip1167Gas);
                const savingsPct = savings.mul(10000).div(legacyGas).toNumber() / 100;

                console.log(
                    `   ${(i + 1).toString().padStart(2)}         ` +
                    `${legacyGas.toLocaleString().padStart(10)}  ` +
                    `${eip1167Gas.toLocaleString().padStart(10)}  ` +
                    `${savings.toLocaleString().padStart(10)}  ` +
                    `${savingsPct.toFixed(2).padStart(5)}%`
                );
            }

            console.log("\n📝 Summary:");
            console.log(`   • Legacy uses 'new' to deploy full contract each time`);
            console.log(`   • EIP-1167 deploys implementation once, then clones (45 bytes each)`);
            console.log(`   • Total savings: ${totalSavings.toLocaleString()} gas (${totalSavingsPct.toFixed(2)}%)`);
            console.log(`   • For ${NUM_VESTINGS} wallets: saved $${savingsUSD.toFixed(2)} at current gas prices`);

            // Assertions
            expect(eip1167Results.totalGas).to.be.lt(legacyResults.totalGas,
                "EIP-1167 should use less total gas");
            expect(eip1167Results.avgGas).to.be.lt(legacyResults.avgGas,
                "EIP-1167 should use less average gas per wallet");

            console.log("\n✅ Gas comparison test completed successfully!");
        });
    });
});
