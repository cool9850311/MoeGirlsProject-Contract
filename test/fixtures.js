const { ethers } = require("hardhat");
const safeSingletonArtifact = require("@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json");
const safeFactoryArtifact = require("@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json");
const { packUserOp, getUserOpHash } = require("./utils/AaHelpers");

async function deployAaFixture() {
    const [deployer, relayer, user1, user2] = await ethers.getSigners();

    // 1. Deploy EntryPoint
    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const entryPoint = await EntryPoint.deploy();
    await entryPoint.deployed();

    // 2. Deploy Safe Contracts using Artifacts
    const SafeSingleton = await ethers.getContractFactory(safeSingletonArtifact.abi, safeSingletonArtifact.bytecode);
    const safeSingleton = await SafeSingleton.deploy();
    await safeSingleton.deployed();

    const SafeFactory = await ethers.getContractFactory(safeFactoryArtifact.abi, safeFactoryArtifact.bytecode);
    const safeFactory = await SafeFactory.deploy();
    await safeFactory.deployed();

    // 4. Deploy MOE Token
    const MOEToken = await ethers.getContractFactory("MOEToken");
    // MOE Token constructor: (address initialOwner)
    const moeToken = await MOEToken.deploy(deployer.address);
    await moeToken.deployed();

    // Deploy Vesting Factory
    const VestingFactory = await ethers.getContractFactory("VestingWalletFactory");
    const vestingFactory = await VestingFactory.deploy(moeToken.address, deployer.address);
    await vestingFactory.deployed();

    // Deploy Deposit Contract
    const DepositContract = await ethers.getContractFactory("DepositContract");
    const depositContract = await DepositContract.deploy(
        moeToken.address,
        deployer.address, // Recipient
        deployer.address  // Owner
    );
    await depositContract.deployed();

    // Deploy Safe Factory & 4337 Module
    const Safe4337Module = await ethers.getContractFactory("Safe4337Module");
    const safe4337Module = await Safe4337Module.deploy(entryPoint.address);
    await safe4337Module.deployed();

    

    // 5. Deploy Paymaster
    const MOEPaymaster = await ethers.getContractFactory("MOEPaymaster");
    const paymaster = await MOEPaymaster.deploy(entryPoint.address, moeToken.address);
    await paymaster.deployed();

    // Deposit Paymaster's stake/deposit into EntryPoint
    await paymaster.deposit({ value: ethers.utils.parseEther("100.0") });

    // 6. Deploy NFT & Market
    const MoeGirlsNFT = await ethers.getContractFactory("MoeGirlsNFT");
    const nft = await MoeGirlsNFT.deploy(moeToken.address);
    await nft.deployed();

    const MoeGirlsMarketplace = await ethers.getContractFactory("MoeGirlsMarketplace");
    const marketplace = await MoeGirlsMarketplace.deploy(nft.address, moeToken.address);
    await marketplace.deployed();

    // Helper to deploy and configure a Safe
    async function deploySafe(ownerSigner) {
        const owner = ownerSigner.address;

        // Debug: Try empty initializer
        const setupData = "0x";

        // const setupData = safeSingleton.interface.encodeFunctionData("setup", [ ... ]);

        // Monitor Addresses
        console.log("Safe Singleton:", safeSingleton.address);
        console.log("Safe Factory:", safeFactory.address);

        // Debug: Deploy Proxy Manually
        const safeProxyArtifact = require("@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json");
        const SafeProxy = await ethers.getContractFactory(safeProxyArtifact.abi, safeProxyArtifact.bytecode);

        // constructor(singleton)
        const safeProxy = await SafeProxy.deploy(safeSingleton.address);
        await safeProxy.deployed();

        const proxyAddress = safeProxy.address;

        // If manual deployment works, then Factory is issue.
        // But for our test, we can use manually deployed proxy!

        /*
        const setupData = "0x";
        const saltNonce = Date.now();
        await safeFactory.createProxyWithNonce(safeSingleton.address, setupData, saltNonce);
        const proxyAddress = await safeFactory.callStatic.createProxyWithNonce(safeSingleton.address, setupData, saltNonce);
        */

        /*
        // Calculate Address
        // We can find it from event or predict. For test simplicity, let's just get likely address
        // But createProxyWithNonce returns the proxy. 
        // We can just capture the event.
        // Actually, Hardhat doesn't return return value of transaction comfortably without static call.
        // const proxyAddress = await safeFactory.callStatic.createProxyWithNonce(safeSingleton.address, setupData, saltNonce);
        */

        const safe = await ethers.getContractAt(safeSingletonArtifact.abi, proxyAddress);

        // Setup Manual Proxy:
        // Manual deployment does NOT call setup (unless we do it manually).
        // So we must call setup(owners...) on the Proxy now.
        // We defined setupData before. But we commented it out for debugging. 
        // Let's bring it back.

        const setupDataReal = safeSingleton.interface.encodeFunctionData("setup", [
            [owner], // owners
            1,       // threshold
            ethers.constants.AddressZero, // to
            "0x",    // data
            ethers.constants.AddressZero, // fallbackHandler (Debug: AddressZero for now to verify basic flow, then switch to safe4337Module)
            ethers.constants.AddressZero, // paymentToken
            0,       // payment
            ethers.constants.AddressZero  // paymentReceiver
        ]);

        await safe.setup(
            [owner],
            1,
            ethers.constants.AddressZero,
            ethers.utils.arrayify("0x"),
            safe4337Module.address, // Safe4337Module is BOTH module AND fallback (includes ERC1155 reception)
            ethers.constants.AddressZero,
            0,
            ethers.constants.AddressZero
        );

        const owners = await safe.getOwners();
        console.log("Safe Owners:", owners);
        console.log("Is Owner:", await safe.isOwner(ownerSigner.address));

        // Enable Module Transaction
        // Need to execute a transaction signed by owner to enable module
        // userOp needs module enabled.
        const enableData = safe.interface.encodeFunctionData("enableModule", [safe4337Module.address]);

        // Sign Transaction (Safe v1.4.1 Signatures)
        // Safe Transact: to, value, data, operation, ... signatures
        // Nonce is 0.
        const nonce = await safe.nonce();
        const txHashHash = await safe.getTransactionHash(
            safe.address, // to (self)
            0, // value
            enableData, // data
            0, // operation (Call)
            0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero, // gas/refund
            nonce
        );

        // EOA Sign
        // Hardhat/Ethers signMessage prefixes the message. Safe ecrecover with v+4 expects that.
        // But since it failed, let's try signing the raw digest directly (no prefix).
        // User1 is index 2. Deployer is index 0. user1 is passed as arg.
        // We need PK.
        // Hardhat default PKs:
        // 0: 0xac09...
        // 1: 0x59c6...
        // 2: 0x5de4...
        // We'll check address to be sure or just use the wallet from PK.

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
        const signature = ethers.utils.joinSignature(wallet._signingKey().signDigest(txHashHash));

        // No V adjustment needed for raw signature (v=27/28)
        const adjustedSignature = signature;

        console.log("Raw Signature V:", ethers.utils.splitSignature(signature).v);

        // Debug: Check Signatures
        const txDataBytes = await safe.encodeTransactionData(
            safe.address, 0, enableData, 0,
            0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero,
            nonce
        );
        try {
            await safe.checkSignatures(txHashHash, txDataBytes, adjustedSignature);
            console.log("Signature Verification: SUCCESS");
        } catch (e) {
            console.log("Signature Verification: FAILED", e);
        }

        // Execute
        await safe.execTransaction(
            safe.address, 0, enableData, 0,
            0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero,
            adjustedSignature
        );

        // Check module enabled
        // const modules = await safe.getModulesOnPage(ethers.constants.AddressZero, 10);
        // console.log("Modules:", modules);

        // Fund with MOE
        await moeToken.transfer(safe.address, ethers.utils.parseEther("1000"));

        // Approve Paymaster to spend MOE (for fees)
        const approvePaymasterData = moeToken.interface.encodeFunctionData("approve", [paymaster.address, ethers.constants.MaxUint256]);
        const nonce2 = await safe.nonce();
        const txHashHash2 = await safe.getTransactionHash(
            moeToken.address, 0, approvePaymasterData, 0, 0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero, nonce2
        );
        const signature2 = ethers.utils.joinSignature(wallet._signingKey().signDigest(txHashHash2));
        await safe.execTransaction(
            moeToken.address, 0, approvePaymasterData, 0, 0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero, signature2
        );

        // Debug: Find Owner Storage Slot
        console.log("Finding Owner Slot for:", ownerSigner.address);
        for (let i = 0; i < 5; i++) {
            const encoded = ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [ownerSigner.address, i]);
            console.log("JS Encoded:", encoded);
            const slot = ethers.utils.keccak256(encoded);
            // console.log("JS Slot Key:", slot);
            const value = await ethers.provider.getStorageAt(safe.address, slot);
            if (value !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
                console.log(`FOUND OWNER AT BASE SLOT ${i}! Value: ${value}`);
            }
        }

        return safe;
    }

    const user1Safe = await deploySafe(user1);
    const user2Safe = await deploySafe(user2);

    return {
        entryPoint,
        safeSingleton,
        safeFactory,
        safe4337Module,
        paymaster,
        moeToken,
        nft,
        marketplace,
        vestingFactory,
        depositContract,
        user1Safe,
        user2Safe,
        user1,
        user2,
        relayer,
        deployer
    };
}

module.exports = { deployAaFixture };
