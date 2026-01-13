// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ERC1155Permit
 * @dev Implementation of ERC-7604: ERC-1155 Permit Approvals
 *
 * This extension allows gasless approval of ERC-1155 tokens using EIP-712 signatures.
 *
 * Architecture: EOA + EIP-7604 Permit
 * - Users sign off-chain permit messages (0 gas)
 * - Backend relayer submits permit + executes transaction (pays gas)
 *
 * Standards:
 * - EIP-712: Typed structured data hashing and signing
 * - ERC-7604: ERC-1155 Permit Approvals (DRAFT)
 * - ERC-165: Interface detection
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-7604
 */
abstract contract ERC1155Permit is ERC1155, EIP712, Nonces {
    using ECDSA for bytes32;

    // EIP-7604 Permit TypeHash
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address operator,bool approved,uint256 nonce,uint256 deadline)");

    // ERC-165 interface ID for ERC-7604
    // bytes4(keccak256("permit(address,address,bool,uint256,uint8,bytes32,bytes32)"))
    bytes4 private constant INTERFACE_ID_ERC1155PERMIT = 0x7409106d;

    /**
     * @dev Permit error when deadline has passed
     */
    error ERC1155PermitExpired(uint256 deadline);

    /**
     * @dev Permit error when signature is invalid
     */
    error ERC1155PermitInvalidSignature();

    /**
     * @dev Grant or revoke approval via EIP-712 signature
     *
     * @param owner The token owner granting approval
     * @param operator The address being granted approval
     * @param approved Whether to grant or revoke approval
     * @param deadline Expiration timestamp for the permit
     * @param v ECDSA signature v component
     * @param r ECDSA signature r component
     * @param s ECDSA signature s component
     *
     * Requirements:
     * - `deadline` must be a timestamp in the future
     * - `owner` must be the signer of the permit
     * - The permit must not be expired
     *
     * Emits an {ApprovalForAll} event
     */
    function permit(
        address owner,
        address operator,
        bool approved,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        // Check deadline
        if (block.timestamp > deadline) {
            revert ERC1155PermitExpired(deadline);
        }

        // Build EIP-712 struct hash
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                owner,
                operator,
                approved,
                _useNonce(owner),
                deadline
            )
        );

        // Compute EIP-712 hash
        bytes32 hash = _hashTypedDataV4(structHash);

        // Recover signer from signature
        address signer = ECDSA.recover(hash, v, r, s);

        // Verify signer is owner
        if (signer != owner) {
            revert ERC1155PermitInvalidSignature();
        }

        // Execute approval
        _setApprovalForAll(owner, operator, approved);
    }

    /**
     * @dev Returns the current nonce for an owner
     * @param owner The address to query
     * @return The current nonce
     */
    function nonces(address owner) public view virtual override returns (uint256) {
        return super.nonces(owner);
    }

    /**
     * @dev Returns the domain separator for EIP-712 signatures
     * @return The domain separator bytes32
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @dev See {IERC165-supportsInterface}
     * Adds support for ERC-7604 interface
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override
        returns (bool)
    {
        return interfaceId == INTERFACE_ID_ERC1155PERMIT || super.supportsInterface(interfaceId);
    }
}
