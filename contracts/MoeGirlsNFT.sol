// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title MoeGirlsNFT
 * @dev ERC-1155 Token for MoeGirls Project Cards
 * Implements minting with payment logic (Relayer pattern)
 */
contract MoeGirlsNFT is ERC1155, Ownable {
    using Strings for uint256;

    // Token ID -> Card ID mapping
    mapping(uint256 => string) private _cardIds;

    // Token ID -> IPFS Metadata URI mapping
    mapping(uint256 => string) private _tokenURIs;

    // MOE Token contract address
    IERC20 public immutable moeToken;

    // Events
    event NFTMinted(
        address indexed to,
        uint256 indexed tokenId,
        string cardId,
        string metadataUri
    );
    event BatchNFTMinted(
        address indexed to,
        uint256[] tokenIds,
        string[] cardIds
    );

    // Counter for generic token IDs (optional, if we want auto-increment)
    uint256 private _nextTokenId = 1;

    constructor(address _moeToken) ERC1155("") Ownable(msg.sender) {
        require(_moeToken != address(0), "Invalid MOE Token address");
        moeToken = IERC20(_moeToken);
    }

    /**
     * @dev Mint NFT with MOE payment (called by Relayer/Owner)
     * @param payer Address to pull MOE tokens from (usually the User's Safe)
     * @param to Address to receive the NFT (usually the User's Safe)
     * @param amount Number of copies to mint
     * @param cardId Game Card ID string
     * @param metadataUri IPFS URI for metadata
     * @param price Total price to pay in MOE
     */
    function mintWithApproval(
        address payer,
        address to,
        uint256 amount,
        string memory cardId,
        string memory metadataUri,
        uint256 price
    ) external onlyOwner {
        require(payer != address(0), "Invalid payer");
        require(to != address(0), "Invalid recipient");

        // 1. Pull Payment (requires payer to have approved this contract or MOE token to this contract??)
        // Wait, standard `approve` is spender=MoeGirlsNFT.
        // So we transfer from payer to owner() (the platform/backend wallet)
        // 0. State Update (Checks-Effects)
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        // 1. Pull Payment (Interactions)
        // requires payer to have approved this contract
        if (price > 0) {
            bool success = moeToken.transferFrom(payer, owner(), price);
            require(success, "Payment failed");
        }

        // 2. Mint NFT (Interactions - but internal safe mint)
        _mint(to, tokenId, amount, hex"");
        _cardIds[tokenId] = cardId;
        _tokenURIs[tokenId] = metadataUri;

        emit NFTMinted(to, tokenId, cardId, metadataUri);
    }

    /**
     * @dev Returns the custom URI for a token ID
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        return _tokenURIs[tokenId];
    }

    /**
     * @dev Returns the Game Card ID for a token ID
     */
    function getCardId(uint256 tokenId) external view returns (string memory) {
        return _cardIds[tokenId];
    }
}
