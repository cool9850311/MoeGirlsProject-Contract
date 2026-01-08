const ethers = require("ethers");

async function getSafeOperationHash(userOp, safe4337Module, entryPoint, provider) {
    const SAFE_OP_TYPEHASH = "0xc03dfc11d8b10bf9cf703d558958c8c42777f785d998c62060d85a4f0ef6ea7f";
    const DOMAIN_SEPARATOR_TYPEHASH = "0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218";
    
    const validAfter = 0;
    const validUntil = 0;
    
    // Handle both packed and unpacked formats
    let verificationGasLimit, callGasLimit, maxPriorityFeePerGas, maxFeePerGas;
    
    if (userOp.accountGasLimits) {
        // Packed format - extract from bytes
        const accountGasLimitsHex = userOp.accountGasLimits;
        verificationGasLimit = ethers.BigNumber.from("0x" + accountGasLimitsHex.slice(2, 34));
        callGasLimit = ethers.BigNumber.from("0x" + accountGasLimitsHex.slice(34));
        
        const gasFeesHex = userOp.gasFees;
        maxFeePerGas = ethers.BigNumber.from("0x" + gasFeesHex.slice(2, 34));
        maxPriorityFeePerGas = ethers.BigNumber.from("0x" + gasFeesHex.slice(34));
    } else {
        // Unpacked format
        verificationGasLimit = userOp.verificationGasLimit;
        callGasLimit = userOp.callGasLimit;
        maxPriorityFeePerGas = userOp.maxPriorityFeePerGas;
        maxFeePerGas = userOp.maxFeePerGas;
    }
    
    // Compute domain separator
    const chainId = (await provider.getNetwork()).chainId;
    const domainSeparator = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ["bytes32", "uint256", "address"],
            [DOMAIN_SEPARATOR_TYPEHASH, chainId, safe4337Module.address]
        )
    );
    
    // Compute SafeOp struct hash
    const safeOpStructHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ["bytes32", "address", "uint256", "bytes32", "bytes32", "uint128", "uint128", "uint256", "uint128", "uint128", "bytes32", "uint48", "uint48", "address"],
            [
                SAFE_OP_TYPEHASH,
                userOp.sender,
                userOp.nonce,
                ethers.utils.keccak256(userOp.initCode),
                ethers.utils.keccak256(userOp.callData),
                verificationGasLimit,
                callGasLimit,
                userOp.preVerificationGas,
                maxPriorityFeePerGas,
                maxFeePerGas,
                ethers.utils.keccak256(userOp.paymasterAndData),
                validAfter,
                validUntil,
                entryPoint.address
            ]
        )
    );
    
    // Final EIP-712 hash
    const operationHash = ethers.utils.keccak256(
        ethers.utils.solidityPack(
            ["string", "bytes32", "bytes32"],
            ["\x19\x01", domainSeparator, safeOpStructHash]
        )
    );
    
    return operationHash;
}

function formatSafeSignature(rawSignature) {
    const validAfter = 0;
    const validUntil = 0; // 0 = forever
    
    return ethers.utils.hexConcat([
        ethers.utils.hexZeroPad(ethers.utils.hexlify(validAfter), 6),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(validUntil), 6),
        rawSignature
    ]);
}

module.exports = {
    getSafeOperationHash,
    formatSafeSignature
};
