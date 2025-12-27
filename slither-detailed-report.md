**THIS CHECKLIST IS NOT COMPLETE**. Use `--show-ignored-findings` to show all the results.
Summary
 - [unchecked-transfer](#unchecked-transfer) (1 results) (High)
 - [reentrancy-benign](#reentrancy-benign) (2 results) (Low)
 - [reentrancy-events](#reentrancy-events) (1 results) (Low)
 - [timestamp](#timestamp) (6 results) (Low)
 - [dead-code](#dead-code) (1 results) (Informational)
 - [cache-array-length](#cache-array-length) (1 results) (Optimization)
## unchecked-transfer
Impact: High
Confidence: Medium
 - [ ] ID-0
[DepositContract._processDeposit(address,uint256)](.contracts/DepositContract.sol#L129-L148) ignores return value by [moeToken.transferFrom(player,recipient,amount)](.contracts/DepositContract.sol#L133)

.contracts/DepositContract.sol#L129-L148


## reentrancy-benign
Impact: Low
Confidence: Medium
 - [ ] ID-1
Reentrancy in [DepositContract._processDeposit(address,uint256)](.contracts/DepositContract.sol#L129-L148):
	External calls:
	- [moeToken.transferFrom(player,recipient,amount)](.contracts/DepositContract.sol#L133)
	State variables written after the call(s):
	- [deposits.push(Deposit({player:player,amount:amount,timestamp:block.timestamp,txHash:txHash}))](.contracts/DepositContract.sol#L137-L142)
	- [playerDepositIndices[player].push(depositIndex)](.contracts/DepositContract.sol#L145)

.contracts/DepositContract.sol#L129-L148


 - [ ] ID-2
Reentrancy in [VestingWalletFactory.createVesting(address,uint256)](.contracts/VestingWalletFactory.sol#L84-L120):
	External calls:
	- [require(bool,string)(moeToken.transfer(vestingWallet,amount),Factory: transfer failed)](.contracts/VestingWalletFactory.sol#L107-L110)
	State variables written after the call(s):
	- [allVestingWallets.push(vestingWallet)](.contracts/VestingWalletFactory.sol#L114)
	- [playerVestingWallets[beneficiary].push(vestingWallet)](.contracts/VestingWalletFactory.sol#L113)

.contracts/VestingWalletFactory.sol#L84-L120


## reentrancy-events
Impact: Low
Confidence: Medium
 - [ ] ID-3
Reentrancy in [VestingWalletFactory.createVesting(address,uint256)](.contracts/VestingWalletFactory.sol#L84-L120):
	External calls:
	- [require(bool,string)(moeToken.transfer(vestingWallet,amount),Factory: transfer failed)](.contracts/VestingWalletFactory.sol#L107-L110)
	Event emitted after the call(s):
	- [VestingCreated(beneficiary,vestingWallet,amount,uint64(block.timestamp))](.contracts/VestingWalletFactory.sol#L117)

.contracts/VestingWalletFactory.sol#L84-L120


## timestamp
Impact: Low
Confidence: Medium
 - [ ] ID-4
[VestingWalletFactory.createVesting(address,uint256)](.contracts/VestingWalletFactory.sol#L84-L120) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(moeToken.transfer(vestingWallet,amount),Factory: transfer failed)](.contracts/VestingWalletFactory.sol#L107-L110)

.contracts/VestingWalletFactory.sol#L84-L120


 - [ ] ID-5
[StageBasedVestingWallet._vestingSchedule(uint256,uint64)](.contracts/StageBasedVestingWallet.sol#L68-L94) uses timestamp for comparisons
	Dangerous comparisons:
	- [timestamp < start()](.contracts/StageBasedVestingWallet.sol#L75)
	- [elapsed < stageTimes[i]](.contracts/StageBasedVestingWallet.sol#L83)

.contracts/StageBasedVestingWallet.sol#L68-L94


 - [ ] ID-6
[VestingContract._processClaim(uint256,address)](.contracts/VestingContract.sol#L192-L209) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(vesting.totalAmount > 0,VestingContract: vesting does not exist)](.contracts/VestingContract.sol#L195)
	- [require(bool,string)(vesting.beneficiary == beneficiary,VestingContract: not beneficiary)](.contracts/VestingContract.sol#L196)

.contracts/VestingContract.sol#L192-L209


 - [ ] ID-7
[VestingContract.getUnlockedAmount(uint256)](.contracts/VestingContract.sol#L232-L255) uses timestamp for comparisons
	Dangerous comparisons:
	- [elapsed >= STAGE_4](.contracts/VestingContract.sol#L243)
	- [elapsed >= STAGE_3](.contracts/VestingContract.sol#L245)
	- [elapsed >= STAGE_2](.contracts/VestingContract.sol#L247)
	- [elapsed >= STAGE_1](.contracts/VestingContract.sol#L249)

.contracts/VestingContract.sol#L232-L255


 - [ ] ID-8
[DepositContract.getDeposit(uint256)](.contracts/DepositContract.sol#L168-L176) uses timestamp for comparisons
	Dangerous comparisons:
	- [require(bool,string)(index < deposits.length,DepositContract: invalid deposit index)](.contracts/DepositContract.sol#L173)

.contracts/DepositContract.sol#L168-L176


 - [ ] ID-9
[DepositContract.getRecentDeposits(uint256)](.contracts/DepositContract.sol#L216-L233) uses timestamp for comparisons
	Dangerous comparisons:
	- [count > deposits.length](.contracts/DepositContract.sol#L221)
	- [i < count](.contracts/DepositContract.sol#L228)

.contracts/DepositContract.sol#L216-L233


## dead-code
Impact: Informational
Confidence: Medium
 - [ ] ID-10
[VestingContract._msgData()](.contracts/VestingContract.sol#L305-L307) is never used and should be removed

.contracts/VestingContract.sol#L305-L307


## cache-array-length
Impact: Optimization
Confidence: High
 - [ ] ID-11
Loop condition [i < stageTimes.length](.contracts/StageBasedVestingWallet.sol#L82) should use cached array length instead of referencing `length` member of the storage array.
 
.contracts/StageBasedVestingWallet.sol#L82


