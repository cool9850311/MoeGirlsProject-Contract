// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/**
 * @title MoeGirlsMarketplace
 * @dev Off-chain Orderbook Marketplace for MoeGirlsNFT
 * Supports atomic swaps between ERC1155 (NFT) and ERC20 (MOE) via EIP-712 signatures.
 */
contract MoeGirlsMarketplace is EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    IERC1155 public immutable nftContract;
    IERC20 public immutable paymentToken; // MOE Token

    // Domain Separator is calculated in constructor by EIP712("MoeGirlsMarketplace", "1")

    // EIP-712 TypeHashes
    bytes32 public constant SELL_ORDER_TYPEHASH = keccak256("SellOrder(address maker,uint256 tokenId,uint256 amount,uint256 price,uint256 deadline,uint256 nonce)");
    bytes32 public constant BUY_ORDER_TYPEHASH  = keccak256("BuyOrder(address maker,uint256 tokenId,uint256 amount,uint256 price,uint256 deadline,uint256 nonce)");

    // Mapping to track executed order digests to prevent replay
    mapping(bytes32 => bool) public isOrderExecuted;
    // Mapping to track invalidated nonces for cancellations
    mapping(address => mapping(uint256 => bool)) public isNonceUsed;

    event OrderMatched(
        bytes32 indexed sellOrderHash,
        bytes32 indexed buyOrderHash,
        address indexed seller,
        address buyer,
        uint256 tokenId,
        uint256 amount,
        uint256 price
    );

    event OrderCancelled(address indexed user, uint256 nonce);

    constructor(address _nftContract, address _paymentToken) EIP712("MoeGirlsMarketplace", "1") {
        require(_nftContract != address(0), "Invalid NFT address");
        require(_paymentToken != address(0), "Invalid Payment Token address");
        nftContract = IERC1155(_nftContract);
        paymentToken = IERC20(_paymentToken);
    }

    struct SellOrder {
        address maker;
        uint256 tokenId;
        uint256 amount;
        uint256 price; // Min price
        uint256 deadline;
        uint256 nonce;
    }

    struct BuyOrder {
        address maker;
        uint256 tokenId;
        uint256 amount;
        uint256 price; // Max price
        uint256 deadline;
        uint256 nonce;
    }

    /**
     * @dev Match a Sell Order and a Buy Order atomically.
     * Called by the Backend (Relayer) or anyone involved.
     */
    function matchOrders(
        SellOrder calldata sellOrder,
        bytes calldata sellSignature,
        BuyOrder calldata buyOrder,
        bytes calldata buySignature
    ) external nonReentrant {
        // 1. Validation Logic
        bytes32 sellHash = _hashSellOrder(sellOrder);
        bytes32 buyHash = _hashBuyOrder(buyOrder);

        require(!isOrderExecuted[sellHash], "Sell order already executed");
        require(!isOrderExecuted[buyHash], "Buy order already executed");
        require(!isNonceUsed[sellOrder.maker][sellOrder.nonce], "Sell nonce used");
        require(!isNonceUsed[buyOrder.maker][buyOrder.nonce], "Buy nonce used");

        require(sellOrder.deadline >= block.timestamp, "Sell order expired");
        require(buyOrder.deadline >= block.timestamp, "Buy order expired");

        require(sellOrder.tokenId == buyOrder.tokenId, "Token ID mismatch");
        require(sellOrder.amount == buyOrder.amount, "Amount mismatch");
        // Price check: Buyer must offer >= Seller's ask
        require(buyOrder.price >= sellOrder.price, "Price mismatch");

        // 2. Verify Signatures
        _verifySignature(sellOrder.maker, sellHash, sellSignature);
        _verifySignature(buyOrder.maker, buyHash, buySignature);

        // 3. Execution (Atomic Swap)
        // Mark orders as executed
        isOrderExecuted[sellHash] = true;
        isOrderExecuted[buyHash] = true;
        isNonceUsed[sellOrder.maker][sellOrder.nonce] = true;
        isNonceUsed[buyOrder.maker][buyOrder.nonce] = true;

        // Use the Sell Price for execution (or split difference? Standard is usually sell price or match price)
        // Let's use Sell Price to favor buyer, or Buy Price to favor seller? 
        // For simplicity, we execute at the SELL Price (the agreed minimum). 
        // Or if we want to be fair, usually the matching engine decides. Here let's assume strict equality or use SellPrice.
        uint256 executionPrice = sellOrder.price;

        // Transfer MOE from Buyer to Seller
        // Requires Buyer to have approved Marketplace
        bool paySuccess = paymentToken.transferFrom(buyOrder.maker, sellOrder.maker, executionPrice);
        require(paySuccess, "Payment transfer failed");

        // Transfer NFT from Seller to Buyer
        // Requires Seller to have approved Marketplace
        nftContract.safeTransferFrom(sellOrder.maker, buyOrder.maker, sellOrder.tokenId, sellOrder.amount, "");

        emit OrderMatched(sellHash, buyHash, sellOrder.maker, buyOrder.maker, sellOrder.tokenId, sellOrder.amount, executionPrice);
    }

    /**
     * @dev Cancel an order nonce
     */
    function cancelOrder(uint256 nonce) external {
        isNonceUsed[msg.sender][nonce] = true;
        emit OrderCancelled(msg.sender, nonce);
    }

    // --- Internal Helpers ---

    function _hashSellOrder(SellOrder calldata order) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            SELL_ORDER_TYPEHASH,
            order.maker,
            order.tokenId,
            order.amount,
            order.price,
            order.deadline,
            order.nonce
        )));
    }

    function _hashBuyOrder(BuyOrder calldata order) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            BUY_ORDER_TYPEHASH,
            order.maker,
            order.tokenId,
            order.amount,
            order.price,
            order.deadline,
            order.nonce
        )));
    }

    function _verifySignature(address signer, bytes32 hash, bytes memory signature) internal view {
        // Support both ECDSA and EIP-1271 signatures via SignatureChecker
        require(SignatureChecker.isValidSignatureNow(signer, hash, signature), "Invalid signature");
    }
}
