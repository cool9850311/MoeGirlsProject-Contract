const { ethers } = require("hardhat");

/**
 * Account Abstraction Test Helpers (AA v0.7 Compatible)
 */

const packAccountGasLimits = (verificationGasLimit, callGasLimit) => {
    return ethers.utils.hexConcat([
        ethers.utils.hexZeroPad(ethers.utils.hexlify(verificationGasLimit), 16),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(callGasLimit), 16)
    ]);
};

const packPaymasterData = (paymaster, paymasterVerificationGasLimit, postOpGasLimit, paymasterData) => {
    return ethers.utils.hexConcat([
        paymaster,
        ethers.utils.hexZeroPad(ethers.utils.hexlify(paymasterVerificationGasLimit), 16),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(postOpGasLimit), 16),
        paymasterData
    ]);
};

// Simple PaymasterAndData (just bytes if no limits packed, but v0.7 requires packing?)
// In v0.7 paymasterAndData is just bytes. BUT Paymaster usually expects packed data.
// For SimpleAccount/Test we often assume it's just bytes.

// v0.7 Packed fields:
// bytes32 accountGasLimits; // verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
// bytes32 gasFees; // maxPriorityFeePerGas (16 bytes) | maxFeePerGas (16 bytes)

const packUserOp = (op, forSignature = true) => {
    // Generate Packed fields
    if (op.verificationGasLimit == undefined) console.log("UNDEFINED VERIF GAS");
    if (op.callGasLimit == undefined) console.log("UNDEFINED CALL GAS");
    if (op.maxPriorityFeePerGas == undefined) console.log("UNDEFINED PRIO GAS");
    if (op.maxFeePerGas == undefined) console.log("UNDEFINED MAX GAS");

    const accountGasLimits = ethers.utils.hexConcat([
        ethers.utils.hexZeroPad(ethers.utils.hexlify(op.verificationGasLimit), 16),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(op.callGasLimit), 16)
    ]);

    const gasFees = ethers.utils.hexConcat([
        ethers.utils.hexZeroPad(ethers.utils.hexlify(op.maxPriorityFeePerGas), 16),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(op.maxFeePerGas), 16)
    ]);

    if (forSignature) {
        console.log("Encode Args:", {
            sender: op.sender,
            nonce: op.nonce,
            initCode: op.initCode,
            callData: op.callData,
            accountGasLimits: accountGasLimits,
            preVerificationGas: op.preVerificationGas,
            gasFees: gasFees,
            paymasterAndData: op.paymasterAndData
        });

        // Keccak over packed fields
        return ethers.utils.defaultAbiCoder.encode(
            [
                "address",
                "uint256",
                "bytes",
                "bytes",
                "bytes32", // accountGasLimits
                "uint256", // preVerificationGas
                "bytes32", // gasFees
                "bytes",   // paymasterAndData
            ],
            [
                op.sender,
                op.nonce,
                op.initCode,
                op.callData,
                accountGasLimits,
                op.preVerificationGas,
                gasFees,
                op.paymasterAndData
            ]
        );
    } else {
        // Return Array for EntryPoint call (Tuple)
        return [
            op.sender,
            op.nonce,
            op.initCode,
            op.callData,
            accountGasLimits,
            op.preVerificationGas,
            gasFees,
            op.paymasterAndData,
            op.signature
        ];
    }
};

const getUserOpHash = (op, entryPointAddress, chainId) => {
    const userOpHash = ethers.utils.keccak256(packUserOp(op, true));
    const enc = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address", "uint256"],
        [userOpHash, entryPointAddress, chainId]
    );
    return ethers.utils.keccak256(enc);
};

// Helper to convert Legacy op object (from test) to v0.7 packed fields inside
const toPackedUserOp = (op) => {
    return packUserOp(op, false);
};

const signUserOp = async (signer, op, entryPointAddress, chainId) => {
    const hash = getUserOpHash(op, entryPointAddress, chainId);
    return await signer.signMessage(ethers.utils.arrayify(hash));
};

module.exports = {
    packUserOp,
    getUserOpHash,
    signUserOp,
    toPackedUserOp
};
