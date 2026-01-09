const { ethers } = require("hardhat");
const safeSingletonArtifact = require("@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json");
const safeFactoryArtifact = require("@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json");
const { packUserOp, getUserOpHash } = require("./utils/AaHelpers");

const SAFE_SINGLETON_ADDRESS = "0x41675C099F32341bf84BFc5382aF534df5C7461a"; // v1.4.1
const SAFE_FACTORY_ADDRESS = "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67"; // v1.4.1
const ENTRYPOINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"; // v0.7
const SAFE_4337_MODULE_ADDRESS = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226"; // Candide v0.3.0
const FALLBACK_HANDLER_ADDRESS = "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4"; // CompatibilityFallbackHandler v1.3.0 (Compatible with 1.4.1 mostly, but check if we need 1.4.1 specific one)

// Note: For Safe v1.4.1, the CompatibilityFallbackHandler address may differ or be the same.
// 1.4.1 CompatibilityFallbackHandler: 0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4 (Same as 1.3.0 usually)
// Let's verify if there is a specific one for 1.4.1. For now, we use the one known to work or the one found.
// Actually, standard Safe 1.4.1 deployment usually uses: 0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4

async function deployAaFixture() {
    const [deployer, relayer, user1, user2] = await ethers.getSigners();

    // 1. Connect to Canonical Contracts
    const entryPoint = await ethers.getContractAt("EntryPoint", ENTRYPOINT_ADDRESS);
    const safeSingleton = await ethers.getContractAt(safeSingletonArtifact.abi, SAFE_SINGLETON_ADDRESS);
    const safeFactory = await ethers.getContractAt(safeFactoryArtifact.abi, SAFE_FACTORY_ADDRESS);

    // 2. Connect to Official Safe4337Module (No deployment needed)
    // We create a minimal interface for testing purposes (encoding calls)
    const Safe4337ModuleABI = [
        "function executeUserOp(address to, uint256 value, bytes data, uint8 operation)",
        "function validateUserOp(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp, bytes32 userOpHash, uint256 missingAccountFunds) returns (uint256 validationData)"
    ];
    const safe4337Module = {
        address: SAFE_4337_MODULE_ADDRESS,
        interface: new ethers.utils.Interface(Safe4337ModuleABI)
    };

    // 3. Deploy MOE Token
    const MOEToken = await ethers.getContractFactory("MOEToken");
    const moeToken = await MOEToken.deploy(deployer.address);
    await moeToken.deployed();

    // 4. Deploy Vesting & Deposit
    const VestingFactory = await ethers.getContractFactory("VestingWalletFactory");
    const vestingFactory = await VestingFactory.deploy(moeToken.address, deployer.address);
    await vestingFactory.deployed();

    const DepositContract = await ethers.getContractFactory("DepositContract");
    const depositContract = await DepositContract.deploy(moeToken.address, deployer.address, deployer.address);
    await depositContract.deployed();

    // 5. Deploy Paymaster
    const MOEPaymaster = await ethers.getContractFactory("MOEPaymaster");
    const paymaster = await MOEPaymaster.deploy(entryPoint.address, moeToken.address);
    await paymaster.deployed();
    await paymaster.deposit({ value: ethers.utils.parseEther("10.0") }); // Fund Paymaster on EntryPoint (needs ETH)

    // 6. Deploy NFT & Market
    const MoeGirlsNFT = await ethers.getContractFactory("MoeGirlsNFT");
    const nft = await MoeGirlsNFT.deploy(moeToken.address);
    await nft.deployed();

    const MoeGirlsMarketplace = await ethers.getContractFactory("MoeGirlsMarketplace");
    const marketplace = await MoeGirlsMarketplace.deploy(nft.address, moeToken.address);
    await marketplace.deployed();

    // Helper: Deploy Safe via Factory
    async function deploySafe(ownerSigner) {
        const owner = ownerSigner.address;
        const saltNonce = Date.now() + Math.floor(Math.random() * 1000); // Random nonce for uniqueness

        // Setup Data: standard setup + enable module via fallback logic later or init
        // For Safe 1.3.0, setup includes: owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver
        const setupData = safeSingleton.interface.encodeFunctionData("setup", [
            // Safe is already initialized via createProxyWithNonce(..., setupData, ...)
            // DO NOT call safe.setup() again.
            [owner], // owners
            1,       // threshold
            ethers.constants.AddressZero, // to
            "0x",    // data
            safe4337Module.address, // fallbackHandler (Safe4337Module)
            ethers.constants.AddressZero, // paymentToken
            0,       // payment
            ethers.constants.AddressZero  // paymentReceiver
        ]);

        // Create Proxy using Factory
        // createProxyWithNonce returns SafeProxy address
        const tx = await safeFactory.createProxyWithNonce(safeSingleton.address, setupData, saltNonce);
        const receipt = await tx.wait();

        // Find ProxyCreation event
        let proxyAddress;

        // 1. Try Standard Parsing
        const proxyCreationEvent = receipt.events ? receipt.events.find(e => e.event === 'ProxyCreation') : null;
        if (proxyCreationEvent) {
            proxyAddress = proxyCreationEvent.args.proxy;
        } else {
            // 2. Fallback: Parse log manually
            // Look for topic 0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235
            const PROXY_CREATION_TOPIC = "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235";
            const log = receipt.logs.find(l => l.topics[0] === PROXY_CREATION_TOPIC);

            if (log) {
                // Decode data: address proxy, address singleton
                // Both are non-indexed in Safe 1.3.0 (so in data)
                const decoded = ethers.utils.defaultAbiCoder.decode(["address", "address"], log.data);
                proxyAddress = decoded[0];
            } else {
                console.log("Debug: All logs topics:", receipt.logs.map(l => l.topics[0]));
                throw new Error("ProxyCreation event not found (Manual Parse Failed)");
            }
        }

        const safe = await ethers.getContractAt(safeSingletonArtifact.abi, proxyAddress);

        // Enable Module
        // We need to enable the Safe4337Module as a module too (not just fallback)
        // Sign enableModule transaction
        const enableData = safe.interface.encodeFunctionData("enableModule", [safe4337Module.address]);
        const nonce = await safe.nonce();
        const txHash = await safe.getTransactionHash(
            safe.address, 0, enableData, 0, 0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero, nonce
        );

        // Use approveHash pattern to avoid signature format issues
        // 1. Approve Hash
        await safe.connect(ownerSigner).approveHash(txHash);

        // 2. Execute with v=1 signature
        // r = owner address, s = 0, v = 1
        const signature = ethers.utils.solidityPack(
            ["uint256", "uint256", "uint8"],
            [owner, 0, 1]
        ); // Packed: 32 bytes owner, 32 bytes 0, 1 byte 1

        await safe.connect(ownerSigner).execTransaction(
            safe.address, 0, enableData, 0, 0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero, signature
        );

        // Fund with MOE
        await moeToken.transfer(safe.address, ethers.utils.parseEther("1000"));

        // Approve Paymaster (for MOE fees)
        const approveData = moeToken.interface.encodeFunctionData("approve", [paymaster.address, ethers.constants.MaxUint256]);
        const nonce2 = await safe.nonce();
        const txHash2 = await safe.getTransactionHash(
            moeToken.address, 0, approveData, 0, 0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero, nonce2
        );

        await safe.connect(ownerSigner).approveHash(txHash2);

        const sig2 = ethers.utils.solidityPack(
            ["uint256", "uint256", "uint8"],
            [owner, 0, 1]
        );

        await safe.connect(ownerSigner).execTransaction(
            moeToken.address, 0, approveData, 0, 0, 0, 0, ethers.constants.AddressZero, ethers.constants.AddressZero, sig2
        );

        return safe;
    }

    const user1Safe = await deploySafe(user1);
    // const user2Safe = await deploySafe(user2); // Skip user2 if not strictly needed to save time, or keep it. User2 used in Flow 6.
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
