# Claim Process Documentation

## General Description
The claim process allows users to claim rewards for having active stake during a specific epoch. Each claim is associated with a specific report and can only be claimed once per user.

## Account Structure

### ClaimAccount
```rust
pub struct ClaimAccount {
    pub report_id: u64,    // ID of the claimed report
    pub user: Pubkey,      // User who made the claim
    pub claimed_at: i64,   // Claim timestamp
    pub amount: u64,       // Claimed amount
}
```

## Seeds and PDAs

### 1. Claim Account
```rust
seeds = [
    b"claim",              // Account type identifier
    report.key().as_ref(), // Report key
    user.key().as_ref(),   // User key
    crate::ID.as_ref()     // Program ID
]
```
This seed is used to create a unique PDA for each report-user combination, ensuring a user can only claim once per report.

### 2. Stake Account
```rust
seeds = [
    b"stake",                          // Account type identifier
    report.epoch.to_le_bytes().as_ref(), // Report epoch
    user.key().to_bytes().as_ref(),    // User key
    staking_program.key().to_bytes().as_ref(), // Staking program key
    crate::ID.as_ref()                 // Program ID
]
```
This seed is used to verify that the user has active stake for the report's epoch. The staking program must use the same seed to create stake accounts.

### 3. Game State Account
```rust
seeds = [
    b"game_state",        // Account type identifier
    crate::ID.as_ref()    // Program ID
]
```
This seed is used to create and access the program's main account that contains the global state.

### 4. Report Account
```rust
seeds = [
    b"report",                        // Account type identifier
    report_id.to_le_bytes().as_ref(), // Report ID
    crate::ID.as_ref()               // Program ID
]
```
This seed is used to create and access report accounts.

## Validation Process

1. **Game State Verification**
   - Verify that the game_state is a valid PDA of the program using the correct seeds
   - This prevents the use of a fake game_state

2. **Report Verification**
   - Verify that the report exists and matches the provided ID
   - Verify that there are stakers and rewards available
   - Verify that the report has not expired (30 days)

3. **Staking Program Verification**
   - Verify that the provided staking_program matches the one stored in game_state
   - This prevents malicious validations from the client

4. **Stake Verification**
   - Verify that a stake account exists for the user in the report's epoch
   - Verification is done by deriving the PDA using the seeds mentioned above

5. **Claim Creation**
   - Create a new claim account using the seeds mentioned above
   - This account records that the user has claimed their reward

## Example Usage in Staking Program

To implement staking, the program must:

1. Create stake accounts using the same seeds:
```rust
let stake_seeds = &[
    b"stake",
    epoch.to_le_bytes().as_ref(),
    user.key().to_bytes().as_ref(),
    staking_program.key().to_bytes().as_ref(),
    crate::ID.as_ref()
];
let (stake_pda, _) = Pubkey::find_program_address(stake_seeds, &program_id);
```

2. Maintain active stake during the corresponding epoch

3. Allow users to withdraw their stake after the epoch

## Important Notes

1. Seeds must be exactly the same in both programs (sports and staking)
2. The order of components in the seeds is crucial
3. Bytes must be converted correctly (using `to_le_bytes()` and `as_ref()`)
4. The staking program must be initialized in the game_state during program initialization
5. All PDAs must include the program ID to avoid collisions

## Client Implementation Example

```typescript
// Derive stake account
const [stakePda] = await PublicKey.findProgramAddress(
    [
        Buffer.from("stake"),
        new BN(epoch).toArray("le", 8),
        user.publicKey.toBytes(),
        stakingProgram.toBytes(),
        programId.toBytes()
    ],
    programId
);

// Derive claim account
const [claimPda] = await PublicKey.findProgramAddress(
    [
        Buffer.from("claim"),
        reportPda.toBytes(),
        user.publicKey.toBytes(),
        programId.toBytes()
    ],
    programId
);

// Derive game state account
const [gameStatePda] = await PublicKey.findProgramAddress(
    [
        Buffer.from("game_state"),
        programId.toBytes()
    ],
    programId
);
``` 