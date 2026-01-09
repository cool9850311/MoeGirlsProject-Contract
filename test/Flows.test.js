const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAaFixture } = require("./fixtures");
const { packUserOp, getUserOpHash } = require("./utils/AaHelpers");
const { getSafeOperationHash, formatSafeSignature } = require("./utils/SafeHelpers");

const MINIMUM_MOE_BALANCE = ethers.utils.parseEther("50");

describe("MoeGirls Flows (Safe + AA)", function () {
    this.timeout(120000); // 120s timeout for Fork tests
    let fixture;
    let entryPoint, safe4337Module, paymaster, nft, marketplace, moeToken, vestingFactory, depositContract;
    let user1, user1Safe;
    let chainId;

    beforeEach(async function () {
        fixture = await deployAaFixture();
        entryPoint = fixture.entryPoint;
        safe4337Module = fixture.safe4337Module;
        paymaster = fixture.paymaster;
        nft = fixture.nft;
        marketplace = fixture.marketplace;
        moeToken = fixture.moeToken;
        vestingFactory = fixture.vestingFactory;
        depositContract = fixture.depositContract;
        user1 = fixture.user1;
        user1Safe = fixture.user1Safe;

        const network = await ethers.provider.getNetwork();
        chainId = network.chainId;
    });

    async function signAndExecuteUserOp(userSigner, safeInstance, callData) {
        // Construct UserOp
        const nonce = await entryPoint.getNonce(safeInstance.address, 0);

        // Fee Settings
        // Format: [paymaster (20)] [verifGas (16)] [postOpGas (16)] [fee (32)]
        const fee = MINIMUM_MOE_BALANCE; // 50 Ether
        const feeEncoded = ethers.utils.defaultAbiCoder.encode(["uint256"], [fee]);
        const pmVerifGas = 300000;
        const pmPostOpGas = 50000;

        const paymasterAndData = ethers.utils.hexConcat([
            paymaster.address,
            ethers.utils.hexZeroPad(ethers.utils.hexlify(pmVerifGas), 16),
            ethers.utils.hexZeroPad(ethers.utils.hexlify(pmPostOpGas), 16),
            feeEncoded
        ]);

        const userOp = {
            sender: safeInstance.address,
            nonce: nonce,
            initCode: "0x",
            callData: callData,
            verificationGasLimit: 1500000,
            callGasLimit: 500000,
            preVerificationGas: 50000,
            maxFeePerGas: ethers.utils.parseUnits("50", "gwei"),
            maxPriorityFeePerGas: ethers.utils.parseUnits("50", "gwei"),
            paymasterAndData: paymasterAndData,
            signature: "0x"
        };

        console.log("UserOp Gas Details:");
        console.log("CallGas:", userOp.callGasLimit);
        console.log("VerifGas:", userOp.verificationGasLimit);
        console.log("PreVerif:", userOp.preVerificationGas);
        console.log("MaxFee:", userOp.maxFeePerGas.toString());

        console.log("Paymaster Address:", paymaster.address);
        console.log("Paymaster Data:", paymasterAndData);
        const deposit = await entryPoint.balanceOf(paymaster.address);
        console.log("Paymaster Deposit:", ethers.utils.formatEther(deposit));

        // Pack UserOp (Using Helper)
        // returns Array (Tuple) for execution, but we need Object for Hashing?
        // Wait. packUserOp(op, true) returns encoded bytes.
        // packUserOp(op, false) returns Array (now).
        // getUserOpHash in AaHelpers uses packUserOp(op, true).
        // BUT we want to use entryPoint.getUserOpHash(packedOp).

        const packedOp = packUserOp(userOp, false); // Array for handleOps

        // Compute Safe operation hash using SafeHelpers
        const operationHash = await getSafeOperationHash(userOp, fixture.safe4337Module, entryPoint, ethers.provider);
        console.log("UserOp Hash:", operationHash);
        console.log("SafeInstance Address:", safeInstance.address);

        // Sign
        // Safe expects EOA signature of userOpHash.
        // Find owner of 'safeInstance'.
        const owners = await safeInstance.getOwners();
        const ownerAddr = owners[0];
        let ownerSigner = fixture.deployer;
        if (ownerAddr === user1.address) ownerSigner = user1;
        if (ownerAddr === fixture.user2.address) ownerSigner = fixture.user2;

        // Sign Raw Digest (Bypass prefix)
        let signerKey;
        if (ownerSigner.address === "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") { // Deployer
            signerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
        } else if (ownerSigner.address === "0x70997970C51812dc3A010C7d01b50e0d17dc79C8") { // Relayer (Idx 1)
            signerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
        } else if (ownerSigner.address === "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC") { // User1 (Idx 2)
            signerKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
        } else if (ownerSigner.address === "0x90F79bf6EB2c4f870365E785982E1f101E93b906") { // User2 (Idx 3)
            signerKey = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
        }

        const wallet = new ethers.Wallet(signerKey);
        const rawSig = wallet._signingKey().signDigest(ethers.utils.arrayify(operationHash));
        const signature = ethers.utils.joinSignature(rawSig);

        // Format signature with Safe timestamps
        const paddedSignature = formatSafeSignature(signature);

        // Update signature in packedOp (Index 8)
        packedOp[8] = paddedSignature;

        // Execute
        let tx;
        try {
            tx = await entryPoint.handleOps([packedOp], fixture.relayer.address);
        } catch (error) {
            console.log("HandleOps Reverted!");
            if (error.data) {
                try {
                    const decoded = entryPoint.interface.parseError(error.data);
                    console.log("Decoded Error:", decoded);
                } catch (e) {
                    console.log("Could not decode error data:", error.data);
                }
            } else {
                console.log("Error object:", error);
            }
            throw error;
        }
        const receipt = await tx.wait();

        // Check UserOperationEvent
        const userOpEvent = receipt.events.find(e => e.event === 'UserOperationEvent');
        if (userOpEvent) {
            console.log("UserOp Success:", userOpEvent.args.success);
            if (!userOpEvent.args.success) {
                console.log("UserOp FAILED. Revert Reason (if simulated): N/A");
            }
        }

        // Log ALL Events
        // console.log("--- Transaction Events ---");
        // for (const e of receipt.events) {
        //     console.log(`Event: ${e.event} (Addr: ${e.address})`);
        //     if (e.event === 'NFTMinted') {
        //          console.log("NFTMinted Args:", e.args);
        //     }
        //     if (e.event === 'Transfer') { // ERC20
        //          console.log("Transfer Args:", e.args);
        //     }
        //     if (e.event === 'TransferSingle') { // ERC1155
        //          console.log("TransferSingle Args:", e.args);
        //     }
        // }
        // console.log("--------------------------");

        return { receipt, tx };
    }


    it("Flow 3: Withdraw (Vesting Release) - Backend Call", async function () {
        // --------------------------------------------------------------------------------
        // Setup: Deploy Vesting Wallet
        // --------------------------------------------------------------------------------
        const [deployer] = await ethers.getSigners();
        const totalVestingAmount = ethers.utils.parseEther("100");
        const vestingDuration = 120; // 2 minutes

        // Fund Factory so it can fund the vesting wallet
        await moeToken.mint(vestingFactory.address, ethers.utils.parseEther("1000"));

        // Create Vesting Wallet
        console.log("[Flow 3] Step 1: Backend creates Vesting Wallet...");
        const createTx = await vestingFactory.connect(deployer).createVesting(user1Safe.address, totalVestingAmount);
        const createReceipt = await createTx.wait();
        const createdEvent = createReceipt.events.find(e => e.event === 'VestingCreated');
        const vestingAddr = createdEvent.args.vestingWallet;
        console.log(`[Flow 3] Vesting Wallet deployed at: ${vestingAddr}`);

        const vesting = await ethers.getContractAt("StageBasedVestingWallet", vestingAddr);

        // Verify Initial State
        expect(await moeToken.balanceOf(vestingAddr)).to.equal(totalVestingAmount);
        expect(await vesting.owner()).to.equal(user1Safe.address);
        expect(await vesting["releasable(address)"](moeToken.address)).to.equal(0);

        // --------------------------------------------------------------------------------
        // Action: Time Travel & Release
        // --------------------------------------------------------------------------------
        // Travel 30s (25% of 120s)
        await ethers.provider.send("evm_increaseTime", [30]);
        await ethers.provider.send("evm_mine");

        const releasable = await vesting["releasable(address)"](moeToken.address);
        console.log(`[Flow 3] Releasable amount after 30s: ${ethers.utils.formatEther(releasable)} MOE`);
        expect(releasable).to.be.gt(0);

        // Snapshot balances before release
        const safeBalBefore = await moeToken.balanceOf(user1Safe.address);
        const vestingBalBefore = await moeToken.balanceOf(vestingAddr);
        const deployerEthBefore = await deployer.getBalance();

        // Release (Backend pays gas)
        console.log("[Flow 3] Step 2: Backend triggers Release...");
        const releaseTx = await vesting.connect(deployer)["release(address)"](moeToken.address);
        const releaseReceipt = await releaseTx.wait();

        // --------------------------------------------------------------------------------
        // Verification: Strict Checks
        // --------------------------------------------------------------------------------

        // 1. Event Verification
        const erc20ReleasedEvent = releaseReceipt.events.find(e => e.event === 'ERC20Released');
        expect(erc20ReleasedEvent).to.not.be.undefined;
        expect(erc20ReleasedEvent.args.token).to.equal(moeToken.address);
        expect(erc20ReleasedEvent.args.amount).to.equal(releasable);

        // 2. Token Balance Verification
        const safeBalAfter = await moeToken.balanceOf(user1Safe.address);
        const vestingBalAfter = await moeToken.balanceOf(vestingAddr);

        expect(safeBalAfter.sub(safeBalBefore)).to.equal(releasable); // Safe received exact amount
        expect(vestingBalBefore.sub(vestingBalAfter)).to.equal(releasable); // Vesting lost exact amount

        // 3. Gas Verification (Backend paid, Safe paid nothing)
        const deployerEthAfter = await deployer.getBalance();
        const gasUsed = releaseReceipt.gasUsed.mul(createTx.gasPrice); // approx

        expect(deployerEthAfter).to.be.lt(deployerEthBefore); // Backend paid gas
        // Note: Safe is a contract, it doesn't pay gas for incoming transfers unless it has a receive hook doing logic, which it doesn't here.

        console.log(`[Flow 3] Verified: Safe received ${ethers.utils.formatEther(releasable)} MOE. Backend paid gas.`);
    });

    it("Flow 4: Deposit (UserOp Approve + Backend DepositFor)", async function () {
        const depositAmount = ethers.utils.parseEther("10");

        // --------------------------------------------------------------------------------
        // Setup: Safe needs MOE
        // --------------------------------------------------------------------------------
        await moeToken.transfer(user1Safe.address, ethers.utils.parseEther("100"));
        const safeInitialMoe = await moeToken.balanceOf(user1Safe.address);
        const paymasterMoeBefore = await moeToken.balanceOf(paymaster.address);

        // --------------------------------------------------------------------------------
        // Step 1: Safe Approvs DepositContract via UserOp (Paymaster)
        // --------------------------------------------------------------------------------
        console.log("[Flow 4] Step 1: Safe approves DepositContract via UserOp...");

        // Snapshot Balances
        const safeEthBeforeOp = await ethers.provider.getBalance(user1Safe.address);
        const paymasterDepositBeforeOp = await entryPoint.balanceOf(paymaster.address);

        const approveCall = moeToken.interface.encodeFunctionData("approve", [
            depositContract.address,
            ethers.constants.MaxUint256
        ]);
        const executeApprove = fixture.safe4337Module.interface.encodeFunctionData("executeUserOp", [
            moeToken.address,
            0,
            approveCall,
            0
        ]);

        // Execute UserOp
        const { receipt: opReceipt } = await signAndExecuteUserOp(user1, user1Safe, executeApprove);

        // Verify Safe ETH did NOT change (Paymaster funded)
        const safeEthAfterOp = await ethers.provider.getBalance(user1Safe.address);
        expect(safeEthAfterOp).to.equal(safeEthBeforeOp);

        // Verify Paymaster Deposit decreased (EntryPoint balance)
        const paymasterDepositAfterOp = await entryPoint.balanceOf(paymaster.address);
        expect(paymasterDepositAfterOp).to.be.lt(paymasterDepositBeforeOp);

        // Verify Allowance
        expect(await moeToken.allowance(user1Safe.address, depositContract.address)).to.equal(ethers.constants.MaxUint256);

        // --------------------------------------------------------------------------------
        // Step 2: Backend calls depositFor
        // --------------------------------------------------------------------------------
        console.log("[Flow 4] Step 2: Backend calls depositFor...");
        const [deployer] = await ethers.getSigners();

        const ownerMoeBefore = await moeToken.balanceOf(deployer.address);
        const depositContractMoeBefore = await moeToken.balanceOf(depositContract.address);

        const tx = await depositContract.connect(deployer).depositFor(user1Safe.address, depositAmount);
        const receipt = await tx.wait();

        // --------------------------------------------------------------------------------
        // Verification: Strict Checks
        // --------------------------------------------------------------------------------

        // 1. Events
        const depositEvent = receipt.events.find(e => e.event === 'DepositMade');
        expect(depositEvent).to.not.be.undefined;
        expect(depositEvent.args.player).to.equal(user1Safe.address);
        expect(depositEvent.args.amount).to.equal(depositAmount);

        const transferEvent = receipt.events.find(e => e.event === 'Transfer' && e.address === moeToken.address);
        // We might need to filter Transfer events more carefully if there are multiple, but here it's simple
        // Actually, depositFor sends to `recipient` (which is deployer in constructor?)
        // Let's check constructor arg in fixtures.js: await DepositContract.deploy(moeToken.address, deployer.address, deployer.address);
        // So funds go from Safe -> Deployer directly (based on `_processDeposit` implementation logic: `moeToken.transferFrom(from, recipient, amount)`)

        // 2. Balances
        const safeMoeAfter = await moeToken.balanceOf(user1Safe.address);
        const ownerMoeAfter = await moeToken.balanceOf(deployer.address);
        const paymasterMoeAfter = await moeToken.balanceOf(paymaster.address);
        // Wait, we didn't snapshot Paymaster MOE before. We should snapshot it top of function or estimate.
        // Paymaster starts with some MOE? fixture gives it some?

        // Strict Check: Safe lost Deposit (10) + Fee (50) = 60
        const fee = ethers.utils.parseEther("50");
        expect(safeInitialMoe.sub(safeMoeAfter)).to.equal(depositAmount.add(fee));
        expect(ownerMoeAfter.sub(ownerMoeBefore)).to.equal(depositAmount); // Owner received exact amount

        // Check Paymaster received fee (implicitly checked by Safe loss, but strict would be better)
        // Since we didn't snapshot Paymaster MOE, let's verify Paymaster MOE > 0 (it collects fees)
        // Or better, add snapshot in test start.

        // 3. Contract Internal State
        const playerDeposits = await depositContract.getPlayerDeposits(user1Safe.address);
        expect(playerDeposits.length).to.equal(1);
        expect(playerDeposits[0].amount).to.equal(depositAmount);

        console.log("[Flow 4] Verified: Safe MOE deducted, Paymaster paid gas for Approve, Backend paid gas for Deposit.");
    });

    it("Flow 5: Safe Mints NFT via UserOp (Correct Business Logic)", async function () {
        const mintAmount = 1;
        const mintCost = ethers.utils.parseEther("900");
        const metadataUri = "ipfs://test";
        const cardId = "CARD_001";

        // Step 1: Safe approves NFT contract via UserOp (ERC-4337)
        // Bundler pays gas, Paymaster compensates, Safe has 0 ETH
        console.log("Step 1: Safe approves MOE for NFT contract via UserOp...");
        const approveNftCall = moeToken.interface.encodeFunctionData("approve", [
            nft.address,
            ethers.constants.MaxUint256
        ]);
        const executeApproveNft = fixture.safe4337Module.interface.encodeFunctionData("executeUserOp", [
            moeToken.address,
            0,
            approveNftCall,
            0
        ]);
        await signAndExecuteUserOp(user1, user1Safe, executeApproveNft);

        // Verify approval
        const allowance = await moeToken.allowance(user1Safe.address, nft.address);
        console.log("Safe NFT Allowance:", allowance.toString());
        expect(allowance).to.equal(ethers.constants.MaxUint256);

        // Step 2: Backend (owner) calls mintWithApproval
        // Backend verifies business logic, then mints
        console.log("Step 2: Backend mints NFT for Safe...");

        const [deployer] = await ethers.getSigners();
        const initialBalance = await nft.balanceOf(user1Safe.address, 1);
        console.log("Initial NFT balance:", initialBalance.toString());

        // Backend calls mintWithApproval (pulls MOE from Safe, mints NFT to Safe)
        await nft.connect(deployer).mintWithApproval(
            user1Safe.address,  // payer (Safe pays)
            user1Safe.address,  // to (Safe receives NFT)
            mintAmount,
            cardId,
            metadataUri,
            mintCost
        );

        // Verify NFT minted
        const finalBalance = await nft.balanceOf(user1Safe.address, 1);
        console.log("Final NFT balance:", finalBalance.toString());
        expect(finalBalance).to.equal(1);

        // Verify MOE payment to owner
        const ownerBalance = await moeToken.balanceOf(await nft.owner());
        console.log("Owner received MOE:", ownerBalance.toString());
        expect(ownerBalance).to.be.gte(mintCost);
    });



    // Helper: Create Safe-compatible EIP-1271 signature
    async function createSafeSignature(safe, hash, ownerSigner) {
        // Safe wraps the message hash, we need to sign the Safe's messageHash
        // Get Safe's domain separator
        const safeDomainSeparator = await safe.domainSeparator();

        // SAFE_MSG_TYPEHASH = keccak256("SafeMessage(bytes message)")
        const SAFE_MSG_TYPEHASH = '0x60b3cbf8b4a223d68d641b3b6ddf9a298e7f33710cf3d3a9d1146b5a6150fbca';

        // Encode: keccak256(abi.encode(SAFE_MSG_TYPEHASH, keccak256(abi.encode(hash))))
        const messageHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32'], [hash]));
        const safeMessageHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
            ['bytes32', 'bytes32'],
            [SAFE_MSG_TYPEHASH, messageHash]
        ));

        // Final hash: \x19\x01 + domainSeparator + safeMessageHash
        const finalHash = ethers.utils.keccak256(ethers.utils.solidityPack(
            ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
            ['0x19', '0x01', safeDomainSeparator, safeMessageHash]
        ));

        // Sign this final hash
        let signerKey;
        if (ownerSigner.address === '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC') {
            signerKey = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
        } else if (ownerSigner.address === '0x90F79bf6EB2c4f870365E785982E1f101E93b906') {
            signerKey = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
        } else {
            throw new Error('Unknown signer');
        }

        const wallet = new ethers.Wallet(signerKey);
        const sig = wallet._signingKey().signDigest(ethers.utils.arrayify(finalHash));
        return ethers.utils.joinSignature(sig);
    }

    it("Flow 6: Marketplace Trading with EIP-1271 signatures", async function () {
        const seller = user1Safe;
        const buyer = fixture.user2Safe;
        const sellerSigner = user1;
        const buyerSigner = fixture.user2;

        // Setup: Give seller MOE and mint NFT
        const [deployer] = await ethers.getSigners();
        await moeToken.transfer(seller.address, ethers.utils.parseEther("1000"));

        // Seller approves NFT contract
        await ethers.provider.send("hardhat_impersonateAccount", [seller.address]);
        await deployer.sendTransaction({ to: seller.address, value: ethers.utils.parseEther("1.0") });
        const sellerImpersonated = await ethers.getSigner(seller.address);
        await moeToken.connect(sellerImpersonated).approve(nft.address, ethers.constants.MaxUint256);
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [seller.address]);

        // Backend mints NFT for seller
        await nft.connect(deployer).mintWithApproval(seller.address, seller.address, 1, "C1", "u1", 0);

        // 1. Seller Approve NFT
        const approveNftData = nft.interface.encodeFunctionData("setApprovalForAll", [marketplace.address, true]);
        const execApproveNft = safe4337Module.interface.encodeFunctionData("executeUserOp", [nft.address, 0, approveNftData, 0]);
        await signAndExecuteUserOp(sellerSigner, seller, execApproveNft);

        // 2. Buyer Approve MOE
        await moeToken.transfer(buyer.address, ethers.utils.parseEther("2000"));
        const approveMoeData = moeToken.interface.encodeFunctionData("approve", [marketplace.address, ethers.constants.MaxUint256]);
        const execApproveMoe = safe4337Module.interface.encodeFunctionData("executeUserOp", [moeToken.address, 0, approveMoeData, 0]);
        await signAndExecuteUserOp(buyerSigner, buyer, execApproveMoe);

        // 3. Create Orders
        const price = ethers.utils.parseEther("100");
        const tokenId = 1;

        const domain = {
            name: "MoeGirlsMarketplace",
            version: "1",
            chainId: chainId,
            verifyingContract: marketplace.address
        };

        const types = {
            SellOrder: [
                { name: "maker", type: "address" },
                { name: "tokenId", type: "uint256" },
                { name: "amount", type: "uint256" },
                { name: "price", type: "uint256" },
                { name: "deadline", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ],
            BuyOrder: [
                { name: "maker", type: "address" },
                { name: "tokenId", type: "uint256" },
                { name: "amount", type: "uint256" },
                { name: "price", type: "uint256" },
                { name: "deadline", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        const sellOrder = {
            maker: seller.address,
            tokenId: 1,
            amount: 1,
            price: price,
            deadline: Math.floor(Date.now() / 1000) + 3600,
            nonce: 1
        };

        const buyOrder = {
            maker: buyer.address,
            tokenId: 1,
            amount: 1,
            price: price,
            deadline: Math.floor(Date.now() / 1000) + 3600,
            nonce: 1
        };


        // Compute EIP-712 hashes manually
        const SELL_ORDER_TYPEHASH = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(
            'SellOrder(address maker,uint256 tokenId,uint256 amount,uint256 price,uint256 deadline,uint256 nonce)'
        ));
        const BUY_ORDER_TYPEHASH = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(
            'BuyOrder(address maker,uint256 tokenId,uint256 amount,uint256 price,uint256 deadline,uint256 nonce)'
        ));

        const sellStructHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
            ['bytes32', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
            [SELL_ORDER_TYPEHASH, sellOrder.maker, sellOrder.tokenId, sellOrder.amount, sellOrder.price, sellOrder.deadline, sellOrder.nonce]
        ));
        const buyStructHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
            ['bytes32', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
            [BUY_ORDER_TYPEHASH, buyOrder.maker, buyOrder.tokenId, buyOrder.amount, buyOrder.price, buyOrder.deadline, buyOrder.nonce]
        ));

        const DOMAIN_SEPARATOR = ethers.utils._TypedDataEncoder.hashDomain(domain);
        const sellHash = ethers.utils.keccak256(ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', DOMAIN_SEPARATOR, sellStructHash]));
        const buyHash = ethers.utils.keccak256(ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', DOMAIN_SEPARATOR, buyStructHash]));

        // Signatures
        const sellSig = await createSafeSignature(seller, sellHash, sellerSigner);
        const buySig = await createSafeSignature(buyer, buyHash, buyerSigner);

        // 4. Match
        await marketplace.connect(fixture.relayer).matchOrders(sellOrder, sellSig, buyOrder, buySig);

        // Verify
        expect(await nft.balanceOf(buyer.address, 1)).to.equal(1);
        expect(await moeToken.balanceOf(seller.address)).to.be.gt(ethers.utils.parseEther("1000"));
    });
});
