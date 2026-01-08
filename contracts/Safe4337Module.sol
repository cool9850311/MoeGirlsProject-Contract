// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.20;

import {HandlerContext} from "@safe-global/safe-contracts/contracts/handler/HandlerContext.sol";
import {CompatibilityFallbackHandler} from "@safe-global/safe-contracts/contracts/handler/CompatibilityFallbackHandler.sol";
import {IAccount} from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";

interface ISafe {
    function execTransactionFromModule(address to, uint256 value, bytes memory data, uint8 operation) external returns (bool success);
    function execTransactionFromModuleReturnData(address to, uint256 value, bytes memory data, uint8 operation) external returns (bool success, bytes memory returnData);
    function checkSignatures(bytes32 dataHash, bytes memory data, bytes memory signatures) external view;
    function getThreshold() external view returns (uint256);
}

/**
 * @title Safe4337Module - An extension to the Safe contract that implements the ERC4337 interface.
 * @dev The contract is both a module and fallback handler.
 *      Safe forwards the `validateUserOp` call to this contract, it validates the user operation and returns the result.
 * @custom:security-contact bounty@safe.global
 */
contract Safe4337Module is IAccount, HandlerContext, CompatibilityFallbackHandler {
    using UserOperationLib for PackedUserOperation;

    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH = 0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;
    bytes32 private constant SAFE_OP_TYPEHASH = 0xc03dfc11d8b10bf9cf703d558958c8c42777f785d998c62060d85a4f0ef6ea7f;

    struct EncodedSafeOpStruct {
        bytes32 typeHash;
        address safe;
        uint256 nonce;
        bytes32 initCodeHash;
        bytes32 callDataHash;
        uint128 verificationGasLimit;
        uint128 callGasLimit;
        uint256 preVerificationGas;
        uint128 maxPriorityFeePerGas;
        uint128 maxFeePerGas;
        bytes32 paymasterAndDataHash;
        uint48 validAfter;
        uint48 validUntil;
        address entryPoint;
    }

    error InvalidEntryPoint();
    error InvalidCaller();
    error UnsupportedEntryPoint();
    error UnsupportedExecutionFunction(bytes4 selector);
    error ExecutionFailed();

    address public immutable SUPPORTED_ENTRYPOINT;

    constructor(address entryPoint) {
        if (entryPoint == address(0)) {
            revert InvalidEntryPoint();
        }
        SUPPORTED_ENTRYPOINT = entryPoint;
    }

    modifier onlySupportedEntryPoint() {
        if (_msgSender() != SUPPORTED_ENTRYPOINT) {
            revert UnsupportedEntryPoint();
        }
        _;
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256 missingAccountFunds
    ) external onlySupportedEntryPoint returns (uint256 validationData) {
        address payable safeAddress = payable(userOp.sender);
        if (safeAddress != msg.sender) {
            revert InvalidCaller();
        }

        bytes4 selector = bytes4(userOp.callData);
        if (selector != this.executeUserOp.selector && selector != this.executeUserOpWithErrorString.selector) {
            revert UnsupportedExecutionFunction(selector);
        }

        validationData = _validateSignatures(userOp);

        if (missingAccountFunds != 0) {
            ISafe(safeAddress).execTransactionFromModule(SUPPORTED_ENTRYPOINT, missingAccountFunds, "", 0);
        }
    }

    function executeUserOp(address to, uint256 value, bytes memory data, uint8 operation) external onlySupportedEntryPoint {
        if (!ISafe(msg.sender).execTransactionFromModule(to, value, data, operation)) {
            revert ExecutionFailed();
        }
    }

    function executeUserOpWithErrorString(address to, uint256 value, bytes memory data, uint8 operation) external onlySupportedEntryPoint {
        (bool success, bytes memory returnData) = ISafe(msg.sender).execTransactionFromModuleReturnData(to, value, data, operation);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
    }

    function domainSeparator() public view returns (bytes32 domainSeparatorHash) {
        domainSeparatorHash = keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, this));
    }

    function getOperationHash(PackedUserOperation calldata userOp) external view returns (bytes32 operationHash) {
        (bytes memory operationData, , , ) = _getSafeOp(userOp);
        operationHash = keccak256(operationData);
    }

    function _checkSignaturesLength(bytes calldata signatures, uint256 threshold) internal pure returns (bool isValid) {
        uint256 maxLength = threshold * 0x41;
        if (signatures.length < maxLength) {
            return false;
        }

        for (uint256 i = 0; i < threshold; i++) {
            uint256 signaturePos = i * 0x41;
            uint8 signatureType = uint8(signatures[signaturePos + 0x40]);

            if (signatureType == 0) {
                uint256 signatureOffset = uint256(bytes32(signatures[signaturePos + 0x20:]));
                uint256 signatureLength = uint256(bytes32(signatures[signatureOffset:]));
                maxLength += 0x20 + signatureLength;
            }
        }

        isValid = signatures.length <= maxLength;
    }

    function _validateSignatures(PackedUserOperation calldata userOp) internal view returns (uint256 validationData) {
        (bytes memory operationData, uint48 validAfter, uint48 validUntil, bytes calldata signatures) = _getSafeOp(userOp);

        bool validSignature = _checkSignaturesLength(signatures, ISafe(payable(userOp.sender)).getThreshold());

        try ISafe(payable(userOp.sender)).checkSignatures(keccak256(operationData), operationData, signatures) {} catch {
            validSignature = false;
        }

        validationData = _packValidationData(!validSignature, validUntil, validAfter);
    }

    function _getSafeOp(
        PackedUserOperation calldata userOp
    ) internal view returns (bytes memory operationData, uint48 validAfter, uint48 validUntil, bytes calldata signatures) {
        {
            bytes calldata sig = userOp.signature;
            validAfter = uint48(bytes6(sig[0:6]));
            validUntil = uint48(bytes6(sig[6:12]));
            signatures = sig[12:];
        }

        {
            EncodedSafeOpStruct memory encodedSafeOp = EncodedSafeOpStruct({
                typeHash: SAFE_OP_TYPEHASH,
                safe: userOp.sender,
                nonce: userOp.nonce,
                initCodeHash: keccak256(userOp.initCode),
                callDataHash: keccak256(userOp.callData),
                verificationGasLimit: uint128(userOp.unpackVerificationGasLimit()),
                callGasLimit: uint128(userOp.unpackCallGasLimit()),
                preVerificationGas: userOp.preVerificationGas,
                maxPriorityFeePerGas: uint128(userOp.unpackMaxPriorityFeePerGas()),
                maxFeePerGas: uint128(userOp.unpackMaxFeePerGas()),
                paymasterAndDataHash: keccak256(userOp.paymasterAndData),
                validAfter: validAfter,
                validUntil: validUntil,
                entryPoint: SUPPORTED_ENTRYPOINT
            });

            bytes32 safeOpStructHash;
            assembly ("memory-safe") {
                safeOpStructHash := keccak256(encodedSafeOp, 448)
            }

            operationData = abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeOpStructHash);
        }
    }
}
