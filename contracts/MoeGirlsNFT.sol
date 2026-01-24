// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./extensions/ERC1155Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title MoeGirlsNFT
 * @dev ERC-1155 Token for MoeGirls Project Cards
 *
 * Architecture: EOA + EIP-2612 Permit (MOE) + ERC-7604 Permit (NFT)
 * - Users sign off-chain permit messages for gasless approval
 * - Backend relayer executes transactions and pays gas
 *
 * Features:
 * - ERC-1155 Multi-token standard
 * - ERC-7604 Permit for gasless NFT approvals
 * - Minting with MOE payment using EIP-2612 Permit
 */
contract MoeGirlsNFT is ERC1155Permit, Ownable {
    using Strings for uint256;

    // Token ID -> IPFS Metadata URI mapping
    mapping(uint256 => string) private _tokenURIs;

    // MOE Token contract address
    IERC20Permit public immutable moeToken;

    // Events
    event NFTMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 cardId,
        string metadataUri
    );
    event BatchNFTMinted(
        address indexed to,
        uint256[] tokenIds,
        uint256[] cardIds
    );

    constructor(address _moeToken)
        ERC1155("")
        EIP712("MoeGirlsNFT", "1")
        Ownable(msg.sender)
    {
        require(_moeToken != address(0), "Invalid MOE Token address");
        moeToken = IERC20Permit(_moeToken);
    }

    /**
     * @dev Mint NFT with MOE payment (called by Relayer/Owner)
     * @param payer Address to pull MOE tokens from (user's EOA)
     * @param to Address to receive the NFT (user's EOA)
     * @param amount Number of copies to mint
     * @param cardId Game Card ID (cards.id from database)
     * @param metadataUri IPFS URI for metadata
     * @param price Total price to pay in MOE
     */
    function mintWithApproval(
        address payer,
        address to,
        uint256 amount,
        uint256 cardId,
        string memory metadataUri,
        uint256 price
    ) external onlyOwner {
        require(payer != address(0), "Invalid payer");
        require(to != address(0), "Invalid recipient");
        require(cardId > 0, "Invalid card ID");

        // 1. Pull Payment (Interactions)
        // requires payer to have approved this contract
        if (price > 0) {
            bool success = IERC20(address(moeToken)).transferFrom(payer, owner(), price);
            require(success, "Payment failed");
        }

        // 2. Mint NFT (tokenId = cardId)
        uint256 tokenId = cardId;
        _mint(to, tokenId, amount, hex"");

        // Store metadata URI (only set if not already set)
        if (bytes(_tokenURIs[tokenId]).length == 0) {
            _tokenURIs[tokenId] = metadataUri;
        }

        emit NFTMinted(to, tokenId, cardId, metadataUri);
    }

    /**
     * @dev Mint NFT with MOE payment using EIP-2612 Permit (gasless for user)
     *
     * Architecture: EOA + EIP-2612 Permit + Backend Relayer
     * - User signs EIP-2612 permit off-chain (0 gas)
     * - Backend calls this function, executing permit + mint (backend pays gas)
     *
     * @param payer Address that signed MOE permit (user's EOA)
     * @param to Address to receive NFT (user's EOA)
     * @param amount Number of NFT copies
     * @param cardId Game Card ID (cards.id from database)
     * @param metadataUri IPFS URI
     * @param price Total MOE price
     * @param deadline Permit deadline
     * @param v ECDSA signature v component
     * @param r ECDSA signature r component
     * @param s ECDSA signature s component
     *
     * Requirements:
     * - Only owner (backend) can call
     * - Payer must have signed valid EIP-2612 permit for MOE
     * - Deadline must not be expired
     *
     * Emits: NFTMinted event
     */
    function mintWithPermit(
        address payer,
        address to,
        uint256 amount,
        uint256 cardId,
        string memory metadataUri,
        uint256 price,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyOwner returns (uint256 tokenId) {
        require(payer != address(0), "Invalid payer");
        require(to != address(0), "Invalid recipient");
        require(cardId > 0, "Invalid card ID");

        // 1. Execute MOE Permit (gasless approval for user)
        if (price > 0) {
            // Execute permit: user grants allowance to this contract
            moeToken.permit(payer, address(this), price, deadline, v, r, s);

            // Transfer MOE from payer to owner (platform)
            bool success = IERC20(address(moeToken)).transferFrom(payer, owner(), price);
            require(success, "Payment failed");
        }

        // 2. Mint NFT (tokenId = cardId)
        tokenId = cardId;
        _mint(to, tokenId, amount, hex"");

        // Store metadata URI (only set if not already set)
        if (bytes(_tokenURIs[tokenId]).length == 0) {
            _tokenURIs[tokenId] = metadataUri;
        }

        emit NFTMinted(to, tokenId, cardId, metadataUri);

        return tokenId;
    }

    /**
     * @dev Returns the custom URI for a token ID
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        return _tokenURIs[tokenId];
    }
}
