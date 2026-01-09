// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/core/EntryPoint.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MOEPaymaster
 * @dev Paymaster that accepts MOE tokens for gas sponsorship.
 *      Configurable fee per operation.
 */
contract MOEPaymaster is IPaymaster, Ownable {
    using SafeERC20 for IERC20;

    IEntryPoint public immutable entryPoint;
    IERC20 public immutable moeToken;

    uint256 public constant COST_OF_POST = 15000;

    constructor(
        IEntryPoint _entryPoint,
        address _moeToken
    ) Ownable(msg.sender) {
        entryPoint = _entryPoint;
        moeToken = IERC20(_moeToken);
    }

    /**
     * @dev Validates the paymaster userOp.
     *      Decodes fee from paymasterAndData.
     */
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external override returns (bytes memory context, uint256 validationData) {
        require(
            msg.sender == address(entryPoint),
            "Paymaster: caller not EntryPoint"
        );

        // Parse paymasterAndData
        // Format v0.7: [paymaster (20)] [valGasLim (16)] [postOpGasLim (16)] [paymasterData]
        // We put 'fee' in paymasterData.

        bytes calldata accData = userOp.paymasterAndData;
        // 20 + 32 (limits) + 32 (fee) = 84
        require(accData.length >= 84, "Paymaster: data too short");

        // Extract fee (skip 52 bytes)
        uint256 fee = uint256(bytes32(accData[52:84]));

        // Check if Safe has enough MOE
        if (fee > 0) {
            require(
                moeToken.balanceOf(userOp.sender) >= fee,
                "Paymaster: insufficient MOE balance"
            );
        }

        // Verify we have enough ETH deposit in EntryPoint
        require(
            entryPoint.balanceOf(address(this)) >= maxCost,
            "Paymaster: insufficient ETH deposit"
        );

        return (abi.encode(userOp.sender, fee), 0);
    }

    /**
     * @dev Post-operation handler. Collects MOE fee.
     */
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external override {
        require(
            msg.sender == address(entryPoint),
            "Paymaster: caller not EntryPoint"
        );

        if (mode == PostOpMode.opSucceeded) {
            (address sender, uint256 fee) = abi.decode(
                context,
                (address, uint256)
            );
            if (fee > 0) {
                // Feature: Use SafeERC20 to ensure transfer reverts properly on any failure
                // Also handles non-standard ERC20s if we ever switch token
                moeToken.safeTransferFrom(sender, address(this), fee);
            }
        }
    }

    // Deposit to EntryPoint
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    // Withdraw MOE
    function withdrawMOE(address to, uint256 amount) external onlyOwner {
        moeToken.safeTransfer(to, amount);
    }
}
