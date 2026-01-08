// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/core/EntryPoint.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MOEPaymaster
 * @dev Paymaster that accepts MOE tokens for gas sponsorship.
 *      Configurable fee per operation.
 */
contract MOEPaymaster is IPaymaster, Ownable {
    IEntryPoint public immutable entryPoint;
    IERC20 public immutable moeToken;

    uint256 public constant COST_OF_POST = 15000;

    constructor(IEntryPoint _entryPoint, address _moeToken) Ownable(msg.sender) {
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
        require(msg.sender == address(entryPoint), "Paymaster: caller not EntryPoint");

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
            require(moeToken.balanceOf(userOp.sender) >= fee, "Paymaster: insufficient MOE balance");
            // Also requires approval? No, UserOp execution allows transferFrom IF approved?
            // Actually, we transfer in postOp. The Safe MUST approve Paymaster?
            // "Paymaster needs approval" -> usually handled by `execute` batch approving Paymaster?
            // OR Paymaster logic often trusts the account?
            // AA pattern: UserOp calls 'approve' in executeBatch, THEN Paymaster pulls in postOp.
            // So we just check balance here.
        }
        
        // Verify we have enough ETH deposit in EntryPoint
        require(entryPoint.balanceOf(address(this)) >= maxCost, "Paymaster: insufficient ETH deposit");

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
        require(msg.sender == address(entryPoint), "Paymaster: caller not EntryPoint");
        
        // Only charge on success? Or always?
        // Prototype said "charge 50 MOE".
        // Usually we charge regardless? 
        // Let's charge only on success for now to be friendly.
        if (mode == PostOpMode.opSucceeded) {
            (address sender, uint256 fee) = abi.decode(context, (address, uint256));
            if (fee > 0) {
                // Pull Tokens
                // Requires spender allowance!
                // If Safe failed to approve, this reverts -> transaction fails?
                // If postOp reverts, the UserOp reverts? 
                // In v0.7, postOp revert causes inner revert.
                bool success = moeToken.transferFrom(sender, address(this), fee);
                require(success, "Paymaster: fee transfer blocked");
            }
        }
    }
    
    // Deposit to EntryPoint
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }
    
    // Withdraw MOE
    function withdrawMOE(address to, uint256 amount) external onlyOwner {
        moeToken.transfer(to, amount);
    }
}
