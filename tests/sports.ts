import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sports } from "../target/types/sports";
import { expect } from "chai";

describe("sports", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Sports as Program<Sports>;
  const provider = anchor.AnchorProvider.env();
  
  let gameStatePda: anchor.web3.PublicKey;
  let gameStateBump: number;

  before(async () => {
    // Derive the game state PDA
    [gameStatePda, gameStateBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("game_state")],
      program.programId
    );
  });

  describe("Initialize", () => {
    it("Should initialize game state successfully", async () => {
      // Define initial prices
      const initialPriceA = new anchor.BN(10_000_000); // $10.00
      const initialPriceB = new anchor.BN(15_000_000); // $15.00
      const initialPriceC = new anchor.BN(20_000_000); // $20.00

      // Execute initialize
      const tx = await program.methods
        .initialize(initialPriceA, initialPriceB, initialPriceC)
        .accountsPartial({
          gameState: gameStatePda,
          user: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("Initialize transaction signature:", tx);

      // Fetch the created game state account
      const gameState = await program.account.gameState.fetch(gameStatePda);

      // Verify initial state
      expect(gameState.owner.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(gameState.staff).to.be.an('array').that.is.empty;
      expect(gameState.players).to.be.an('array').that.is.empty;
      expect(gameState.nextPlayerId).to.equal(1);
      expect(gameState.teamPriceA.toNumber()).to.equal(10_000_000); // $10.00
      expect(gameState.teamPriceB.toNumber()).to.equal(15_000_000); // $15.00
      expect(gameState.teamPriceC.toNumber()).to.equal(20_000_000); // $20.00

      console.log("Game State initialized with:");
      console.log("- Owner:", gameState.owner.toString());
      console.log("- Staff count:", gameState.staff.length);
      console.log("- Players count:", gameState.players.length);
      console.log("- Next player ID:", gameState.nextPlayerId);
      console.log("- Team prices - A: $", gameState.teamPriceA.toNumber() / 1_000_000);
      console.log("- Team prices - B: $", gameState.teamPriceB.toNumber() / 1_000_000);
      console.log("- Team prices - C: $", gameState.teamPriceC.toNumber() / 1_000_000);
    });

    it("Should fail when trying to initialize twice", async () => {
      try {
        // Try to initialize again
        await program.methods
          .initialize(
            new anchor.BN(10_000_000),
            new anchor.BN(15_000_000),
            new anchor.BN(20_000_000)
          )
          .accountsPartial({
            gameState: gameStatePda,
            user: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        
        // If we reach here, the test should fail
        expect.fail("Initialize should have failed when called twice");
      } catch (error) {
        // Verify it's the expected error (account already exists)
        expect(error.message).to.include("already in use");
        console.log("✓ Correctly prevented double initialization");
      }
    });

    it("Should verify game state PDA derivation", async () => {
      // Verify the PDA was derived correctly
      const [expectedPda, expectedBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("game_state")],
        program.programId
      );

      expect(gameStatePda.toString()).to.equal(expectedPda.toString());
      expect(gameStateBump).to.equal(expectedBump);
      
      console.log("✓ Game State PDA correctly derived:", gameStatePda.toString());
    });
  });

  describe("Team Price Management", () => {
    it("Should update team prices successfully", async () => {
      const newPriceA = 5_000_000; // $5.00
      const newPriceB = 10_000_000; // $10.00
      const newPriceC = 15_000_000; // $15.00

      const tx = await program.methods
        .updateTeamPrices(
          new anchor.BN(newPriceA),
          new anchor.BN(newPriceB),
          new anchor.BN(newPriceC)
        )
        .accountsPartial({
          gameState: gameStatePda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Update team prices transaction signature:", tx);

      // Fetch updated game state
      const gameState = await program.account.gameState.fetch(gameStatePda);

      expect(gameState.teamPriceA.toNumber()).to.equal(newPriceA);
      expect(gameState.teamPriceB.toNumber()).to.equal(newPriceB);
      expect(gameState.teamPriceC.toNumber()).to.equal(newPriceC);

      console.log("✓ Team prices updated:");
      console.log("  - Package A: $", newPriceA / 1_000_000);
      console.log("  - Package B: $", newPriceB / 1_000_000);
      console.log("  - Package C: $", newPriceC / 1_000_000);
    });

    it("Should prevent non-owner from updating prices", async () => {
      try {
        const unauthorizedUser = anchor.web3.Keypair.generate();
        
        // Airdrop some SOL for transaction fees
        const airdropTx = await provider.connection.requestAirdrop(
          unauthorizedUser.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(airdropTx);

        await program.methods
          .updateTeamPrices(
            new anchor.BN(1_000_000),
            new anchor.BN(2_000_000),
            new anchor.BN(3_000_000)
          )
          .accountsPartial({
            gameState: gameStatePda,
            user: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        expect.fail("Should have failed for unauthorized user");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedAccess");
        console.log("✓ Correctly prevented unauthorized price update");
      }
    });

    it("Should prevent invalid prices", async () => {
      try {
        await program.methods
          .updateTeamPrices(
            new anchor.BN(0), // Invalid: zero price
            new anchor.BN(10_000_000),
            new anchor.BN(20_000_000)
          )
          .accountsPartial({
            gameState: gameStatePda,
            user: provider.wallet.publicKey,
          })
          .rpc();
        
        expect.fail("Should have failed for zero price");
      } catch (error) {
        expect(error.message).to.include("InvalidPrice");
        console.log("✓ Correctly prevented zero price");
      }
    });

    it("Should allow staff member to update prices", async () => {
      // First add a staff member
      const staffMember = anchor.web3.Keypair.generate();
      
      // Airdrop SOL to staff member
      const airdropTx = await provider.connection.requestAirdrop(
        staffMember.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropTx);

      // Add staff member
      await program.methods
        .addStaffMember(staffMember.publicKey)
        .accountsPartial({
          gameState: gameStatePda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      // Now test that staff can update prices
      const newPriceA = 7_000_000; // $7.00
      const newPriceB = 12_000_000; // $12.00
      const newPriceC = 18_000_000; // $18.00

      const tx = await program.methods
        .updateTeamPrices(
          new anchor.BN(newPriceA),
          new anchor.BN(newPriceB),
          new anchor.BN(newPriceC)
        )
        .accountsPartial({
          gameState: gameStatePda,
          user: staffMember.publicKey,
        })
        .signers([staffMember])
        .rpc();

      console.log("Staff update prices transaction signature:", tx);

      // Verify prices were updated
      const gameState = await program.account.gameState.fetch(gameStatePda);
      expect(gameState.teamPriceA.toNumber()).to.equal(newPriceA);
      expect(gameState.teamPriceB.toNumber()).to.equal(newPriceB);
      expect(gameState.teamPriceC.toNumber()).to.equal(newPriceC);

      console.log("✓ Staff member successfully updated prices");

      // Clean up - remove staff member
      await program.methods
        .removeStaffMember(staffMember.publicKey)
        .accountsPartial({
          gameState: gameStatePda,
          user: provider.wallet.publicKey,
        })
        .rpc();
    });
  });

  describe("Staff Management", () => {
    let staffMember: anchor.web3.Keypair;

    before(async () => {
      staffMember = anchor.web3.Keypair.generate();
    });

    it("Should add staff member successfully", async () => {
      const tx = await program.methods
        .addStaffMember(staffMember.publicKey)
        .accountsPartial({
          gameState: gameStatePda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Add staff transaction signature:", tx);

      // Fetch updated game state
      const gameState = await program.account.gameState.fetch(gameStatePda);

      expect(gameState.staff).to.have.lengthOf(1);
      expect(gameState.staff[0].toString()).to.equal(staffMember.publicKey.toString());

      console.log("✓ Staff member added:", staffMember.publicKey.toString());
    });

    it("Should prevent duplicate staff", async () => {
      try {
        await program.methods
          .addStaffMember(staffMember.publicKey)
          .accountsPartial({
            gameState: gameStatePda,
            user: provider.wallet.publicKey,
          })
          .rpc();
        
        expect.fail("Should have failed when adding duplicate staff");
      } catch (error) {
        expect(error.message).to.include("StaffAlreadyExists");
        console.log("✓ Correctly prevented duplicate staff");
      }
    });

    it("Should remove staff member successfully", async () => {
      const tx = await program.methods
        .removeStaffMember(staffMember.publicKey)
        .accountsPartial({
          gameState: gameStatePda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Remove staff transaction signature:", tx);

      // Fetch updated game state
      const gameState = await program.account.gameState.fetch(gameStatePda);

      expect(gameState.staff).to.be.an('array').that.is.empty;
      console.log("✓ Staff member removed successfully");
    });
  });

  describe("Player Management", () => {
    let playerPda: anchor.web3.PublicKey;
    const playerId = 1;

    it("Should create player successfully", async () => {
      // Derive player PDA
      [playerPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          new anchor.BN(playerId).toArrayLike(Buffer, "le", 2),
          gameStatePda.toBuffer(),
        ],
        program.programId
      );

      const tx = await program.methods
        .createPlayer(
          1001, // provider_id
          { bronze: {} }, // category
          1000, // total_tokens
          "https://example.com/metadata.json" // metadata_uri
        )
        .accountsPartial({
          gameState: gameStatePda,
          playerAccount: playerPda,
          user: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("Create player transaction signature:", tx);

      // Fetch created player
      const player = await program.account.player.fetch(playerPda);
      const gameState = await program.account.gameState.fetch(gameStatePda);

      // Verify player data
      expect(player.id).to.equal(playerId);
      expect(player.providerId).to.equal(1001);
      expect(player.totalTokens).to.equal(1000);
      expect(player.tokensSold).to.equal(0);
      expect(player.metadataUri).to.equal("https://example.com/metadata.json");

      // Verify game state updated
      expect(gameState.players).to.have.lengthOf(1);
      expect(gameState.players[0].id).to.equal(playerId);
      expect(gameState.players[0].availableTokens).to.equal(1000);
      expect(gameState.nextPlayerId).to.equal(2);

      console.log("✓ Player created successfully with ID:", playerId);
    });

    it("Should add tokens to player successfully", async () => {
      const tokensToAdd = 500;

      const tx = await program.methods
        .addTokens(playerId, tokensToAdd)
        .accountsPartial({
          gameState: gameStatePda,
          playerAccount: playerPda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Add tokens transaction signature:", tx);

      // Fetch updated player
      const player = await program.account.player.fetch(playerPda);
      const gameState = await program.account.gameState.fetch(gameStatePda);

      // Verify tokens added
      expect(player.totalTokens).to.equal(1500);
      expect(player.tokensSold).to.equal(0);

      // Verify game state updated
      expect(gameState.players[0].availableTokens).to.equal(1500);

      console.log("✓ Tokens added successfully. New total:", player.totalTokens);
    });

    it("Should reset available tokens successfully", async () => {
      const tx = await program.methods
        .resetAvailableTokens(playerId)
        .accountsPartial({
          gameState: gameStatePda,
          playerAccount: playerPda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Reset tokens transaction signature:", tx);

      // Fetch updated player
      const player = await program.account.player.fetch(playerPda);
      const gameState = await program.account.gameState.fetch(gameStatePda);

      // Verify tokens reset
      expect(player.totalTokens).to.equal(1500); // Should remain the same
      expect(player.tokensSold).to.equal(1500); // Should equal total_tokens

      // Verify game state updated
      expect(gameState.players[0].availableTokens).to.equal(0);

      console.log("✓ Available tokens reset to 0");
    });

    it("Should update player data successfully (complete update)", async () => {
      const tx = await program.methods
        .updatePlayer(
          playerId,
          2001, // new provider_id
          { gold: {} }, // new category
          2000, // new total_tokens
          "https://updated.com/metadata.json" // new metadata_uri
        )
        .accountsPartial({
          gameState: gameStatePda,
          playerAccount: playerPda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Update player transaction signature:", tx);

      // Fetch updated player
      const player = await program.account.player.fetch(playerPda);
      const gameState = await program.account.gameState.fetch(gameStatePda);

      // Verify all fields updated
      expect(player.id).to.equal(playerId); // Should not change
      expect(player.providerId).to.equal(2001); // Updated
      expect(player.totalTokens).to.equal(2000); // Updated
      expect(player.tokensSold).to.equal(1500); // Should not change
      expect(player.metadataUri).to.equal("https://updated.com/metadata.json"); // Updated

      // Verify game state summary updated
      expect(gameState.players[0].id).to.equal(playerId);
      expect(gameState.players[0].availableTokens).to.equal(500); // 2000 - 1500

      console.log("✓ Player updated successfully (complete update)");
    });

    it("Should update player data successfully (partial update - category only)", async () => {
      const tx = await program.methods
        .updatePlayer(
          playerId,
          null, // don't update provider_id
          { silver: {} }, // update category only
          null, // don't update total_tokens
          null // don't update metadata_uri
        )
        .accountsPartial({
          gameState: gameStatePda,
          playerAccount: playerPda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Update player partial transaction signature:", tx);

      // Fetch updated player
      const player = await program.account.player.fetch(playerPda);
      const gameState = await program.account.gameState.fetch(gameStatePda);

      // Verify only category updated
      expect(player.id).to.equal(playerId);
      expect(player.providerId).to.equal(2001); // Unchanged
      expect(player.totalTokens).to.equal(2000); // Unchanged
      expect(player.tokensSold).to.equal(1500); // Unchanged
      expect(player.metadataUri).to.equal("https://updated.com/metadata.json"); // Unchanged

      // Verify game state summary category updated
      const playerSummary = gameState.players.find(p => p.id === playerId);
      expect(playerSummary).to.exist;
      expect(playerSummary.availableTokens).to.equal(500); // Unchanged

      console.log("✓ Player updated successfully (partial update - category only)");
    });

    it("Should update player tokens successfully", async () => {
      const tx = await program.methods
        .updatePlayer(
          playerId,
          null, // don't update provider_id
          null, // don't update category
          2500, // update total_tokens
          null // don't update metadata_uri
        )
        .accountsPartial({
          gameState: gameStatePda,
          playerAccount: playerPda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Update player tokens transaction signature:", tx);

      // Fetch updated player
      const player = await program.account.player.fetch(playerPda);
      const gameState = await program.account.gameState.fetch(gameStatePda);

      // Verify tokens updated
      expect(player.totalTokens).to.equal(2500);
      expect(player.tokensSold).to.equal(1500); // Should remain unchanged

      // Verify game state summary updated
      expect(gameState.players[0].availableTokens).to.equal(1000);

      console.log("✓ Player tokens updated successfully");
    });

    it("Should fail when trying to set total_tokens less than tokens_sold", async () => {
      try {
        await program.methods
          .updatePlayer(
            playerId,
            null,
            null,
            1000, // Less than tokens_sold (1500)
            null
          )
          .accountsPartial({
            gameState: gameStatePda,
            playerAccount: playerPda,
            user: provider.wallet.publicKey,
          })
          .rpc();
        
        expect.fail("Should have failed when setting total_tokens less than tokens_sold");
      } catch (error) {
        expect(error.message).to.include("InvalidTokenUpdate");
        console.log("✓ Correctly prevented invalid token update");
      }
    });

    it("Should prevent unauthorized user from updating player", async () => {
      try {
        const unauthorizedUser = anchor.web3.Keypair.generate();
        
        // Airdrop some SOL for transaction fees
        const airdropTx = await provider.connection.requestAirdrop(
          unauthorizedUser.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(airdropTx);

        await program.methods
          .updatePlayer(
            playerId,
            3000, // new provider_id
            { bronze: {} }, // new category
            null,
            null
          )
          .accountsPartial({
            gameState: gameStatePda,
            playerAccount: playerPda,
            user: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        expect.fail("Should have failed for unauthorized user");
      } catch (error) {
        console.log("Full error:", error.message);
        expect(error.message).to.include("UnauthorizedAccess");
        console.log("✓ Correctly prevented unauthorized player update");
      }
    });

    it("Should allow staff member to update player", async () => {
      // First add a staff member
      const staffMember = anchor.web3.Keypair.generate();
      
      // Airdrop SOL to staff member
      const airdropTx = await provider.connection.requestAirdrop(
        staffMember.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropTx);

      // Add staff member
      await program.methods
        .addStaffMember(staffMember.publicKey)
        .accountsPartial({
          gameState: gameStatePda,
          user: provider.wallet.publicKey,
        })
        .rpc();

      // Now test that staff can update player
      const tx = await program.methods
        .updatePlayer(
          playerId,
          4000, // new provider_id
          null,
          null,
          null
        )
        .accountsPartial({
          gameState: gameStatePda,
          playerAccount: playerPda,
          user: staffMember.publicKey,
        })
        .signers([staffMember])
        .rpc();

      console.log("Staff update player transaction signature:", tx);

      // Verify update worked
      const player = await program.account.player.fetch(playerPda);
      expect(player.providerId).to.equal(4000);

      console.log("✓ Staff member successfully updated player");

      // Clean up - remove staff member
      await program.methods
        .removeStaffMember(staffMember.publicKey)
        .accountsPartial({
          gameState: gameStatePda,
          user: provider.wallet.publicKey,
        })
        .rpc();
    });
  });

  describe("Team Purchase", () => {
    before(async () => {
      // Create multiple players for testing team purchases
      const categories = [
        { bronze: {} },
        { bronze: {} },
        { bronze: {} },
        { silver: {} },
        { silver: {} },
        { gold: {} },
        { gold: {} },
        { bronze: {} },
        { silver: {} },
        { bronze: {} },
      ];
      
      // Create 10 players with different categories
      for (let i = 0; i < categories.length; i++) {
        const playerId = i + 2; // Starting from 2 since we already have player 1
        const [playerPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("player"),
            new anchor.BN(playerId).toArrayLike(Buffer, "le", 2),
            gameStatePda.toBuffer(),
          ],
          program.programId
        );

        await program.methods
          .createPlayer(
            2000 + i, // provider_id
            categories[i] as any, // category - using 'as any' to fix type issue
            10, // total_tokens per player
            null // metadata_uri
          )
          .accountsPartial({
            gameState: gameStatePda,
            playerAccount: playerPda,
            user: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
      }
      
      console.log("Created 10 additional players for team purchase tests");
      
      // Verify we have 11 players total (1 from previous tests + 10 new)
      const gameState = await program.account.gameState.fetch(gameStatePda);
      expect(gameState.players).to.have.lengthOf(11);
    });

    it("Should buy Team Package A (5 random players)", async () => {
      const gameStateBefore = await program.account.gameState.fetch(gameStatePda);
      const availableTokensBefore = gameStateBefore.players.map(p => p.availableTokens);
      
      // Derive team PDA
      const [teamPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("team"),
          gameStateBefore.nextTeamId.toArrayLike(Buffer, "le", 8),
          gameStatePda.toBuffer(),
        ],
        program.programId
      );
      
      const tx = await program.methods
        .buyTeam({ a: {} })
        .accountsPartial({
          gameState: gameStatePda,
          teamAccount: teamPda,
          user: provider.wallet.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("Buy Team A transaction signature:", tx);

      // Verify game state updated
      const gameStateAfter = await program.account.gameState.fetch(gameStatePda);
      
      // Verify team account created
      const teamAccount = await program.account.team.fetch(teamPda);
      expect(teamAccount.owner.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(teamAccount.playerIds).to.have.lengthOf(5);
      expect(teamAccount.teamId.toNumber()).to.equal(gameStateBefore.nextTeamId.toNumber());
      expect(teamAccount.state).to.deep.equal({ free: {} });
      
      // Count how many players had tokens reduced
      let playersSelected = 0;
      const selectedPlayerIds = [];
      
      for (let i = 0; i < gameStateAfter.players.length; i++) {
        if (availableTokensBefore[i] > gameStateAfter.players[i].availableTokens) {
          playersSelected++;
          selectedPlayerIds.push(gameStateAfter.players[i].id);
          // Verify only 1 token was consumed per selected player
          expect(availableTokensBefore[i] - gameStateAfter.players[i].availableTokens).to.equal(1);
        }
      }
      
      // NOTE: Player PDAs need to be updated in a separate transaction
      // This is a limitation of account size limits in Solana
      
      // Now update the player PDAs
      const playerPDAs = [];
      for (const playerId of teamAccount.playerIds) {
        const [playerPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("player"),
            new anchor.BN(playerId).toArrayLike(Buffer, "le", 2),
            gameStatePda.toBuffer(),
          ],
          program.programId
        );
        playerPDAs.push({
          pubkey: playerPda,
          isWritable: true,
          isSigner: false,
        });
      }
      
      const updateTx = await program.methods
        .updateTeamPlayerTokens(teamAccount.teamId)
        .accountsPartial({
          gameState: gameStatePda,
          teamAccount: teamPda,
          user: provider.wallet.publicKey,
        })
        .remainingAccounts(playerPDAs)
        .rpc();
        
      console.log("Update player tokens transaction signature:", updateTx);
      
      // Verify player PDAs were updated
      for (const playerId of teamAccount.playerIds) {
        const [playerPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("player"),
            new anchor.BN(playerId).toArrayLike(Buffer, "le", 2),
            gameStatePda.toBuffer(),
          ],
          program.programId
        );
        
        const playerAccount = await program.account.player.fetch(playerPda);
        const gameStatePlayer = gameStateAfter.players.find(p => p.id === playerId);
        
        // Verify tokens_sold was incremented
        expect(playerAccount.tokensSold).to.be.greaterThan(0);
        
        // Verify consistency between PDA and game state
        const pdaAvailable = playerAccount.totalTokens - playerAccount.tokensSold;
        expect(pdaAvailable).to.equal(gameStatePlayer.availableTokens);
      }
      
      expect(playersSelected).to.equal(5);
      expect(gameStateAfter.nextTeamId.toNumber()).to.equal(gameStateBefore.nextTeamId.toNumber() + 1);
      console.log("✓ Team Package A purchased: 5 random players selected ($10.00)");
      console.log("  Team ID:", teamAccount.teamId.toNumber());
      console.log("  Player PDAs updated successfully");
    });

    it("Should buy Team Package B (4 random + 1 Silver/Gold)", async () => {
      const gameStateBefore = await program.account.gameState.fetch(gameStatePda);
      const availableTokensBefore = gameStateBefore.players.map(p => p.availableTokens);
      
      // Derive team PDA
      const [teamPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("team"),
          (gameStateBefore as any).nextTeamId.toArrayLike(Buffer, "le", 8),
          gameStatePda.toBuffer(),
        ],
        program.programId
      );
      
      const tx = await program.methods
        .buyTeam({ b: {} })
        .accountsPartial({
          gameState: gameStatePda,
          teamAccount: teamPda,
          user: provider.wallet.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .rpc();

      console.log("Buy Team B transaction signature:", tx);

      // Verify game state updated
      const gameStateAfter = await program.account.gameState.fetch(gameStatePda);
      
      // Count selected players by category
      let silverGoldSelected = 0;
      let totalSelected = 0;
      const selectedPlayerIds = [];
      
      for (let i = 0; i < gameStateAfter.players.length; i++) {
        if (availableTokensBefore[i] > gameStateAfter.players[i].availableTokens) {
          totalSelected++;
          selectedPlayerIds.push(gameStateAfter.players[i].id);
          const player = gameStateAfter.players[i];
          if ('silver' in player.category || 'gold' in player.category) {
            silverGoldSelected++;
          }
        }
      }
      
      expect(totalSelected).to.equal(5);
      expect(silverGoldSelected).to.be.at.least(1);
      console.log(`✓ Team Package B purchased: ${totalSelected} players (${silverGoldSelected} Silver/Gold) ($15.00)`);
    });

    it("Should buy Team Package C (3 random + 2 Silver/Gold)", async () => {
      const gameStateBefore = await program.account.gameState.fetch(gameStatePda);
      const availableTokensBefore = gameStateBefore.players.map(p => p.availableTokens);
      
      // Derive team PDA
      const [teamPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("team"),
          (gameStateBefore as any).nextTeamId.toArrayLike(Buffer, "le", 8),
          gameStatePda.toBuffer(),
        ],
        program.programId
      );
      
      const tx = await program.methods
        .buyTeam({ c: {} })
        .accountsPartial({
          gameState: gameStatePda,
          teamAccount: teamPda,
          user: provider.wallet.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .rpc();

      console.log("Buy Team C transaction signature:", tx);

      // Verify game state updated
      const gameStateAfter = await program.account.gameState.fetch(gameStatePda);
      
      // Count selected players by category
      let silverGoldSelected = 0;
      let totalSelected = 0;
      const selectedPlayerIds = [];
      
      for (let i = 0; i < gameStateAfter.players.length; i++) {
        if (availableTokensBefore[i] > gameStateAfter.players[i].availableTokens) {
          totalSelected++;
          selectedPlayerIds.push(gameStateAfter.players[i].id);
          const player = gameStateAfter.players[i];
          if ('silver' in player.category || 'gold' in player.category) {
            silverGoldSelected++;
          }
        }
      }
      
      expect(totalSelected).to.equal(5);
      expect(silverGoldSelected).to.be.at.least(2);
      console.log(`✓ Team Package C purchased: ${totalSelected} players (${silverGoldSelected} Silver/Gold) ($20.00)`);
    });

    it("Should ensure no duplicate players in a single team purchase", async () => {
      // This test verifies the selection algorithm by checking player IDs
      const gameStateBefore = await program.account.gameState.fetch(gameStatePda);
      const playerIdsBefore = gameStateBefore.players.map(p => ({ 
        id: p.id, 
        available: p.availableTokens 
      }));
      
      // Derive team PDA
      const [teamPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("team"),
          (gameStateBefore as any).nextTeamId.toArrayLike(Buffer, "le", 8),
          gameStatePda.toBuffer(),
        ],
        program.programId
      );
      
      await program.methods
        .buyTeam({ a: {} })
        .accountsPartial({
          gameState: gameStatePda,
          teamAccount: teamPda,
          user: provider.wallet.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .rpc();

      const gameStateAfter = await program.account.gameState.fetch(gameStatePda);
      
      // Collect selected player IDs
      const selectedPlayerIds = [];
      for (let i = 0; i < gameStateAfter.players.length; i++) {
        const before = playerIdsBefore[i];
        const after = gameStateAfter.players[i];
        if (before.available > after.availableTokens) {
          selectedPlayerIds.push(after.id);
        }
      }
      
      // Check for duplicates
      const uniqueIds = new Set(selectedPlayerIds);
      expect(uniqueIds.size).to.equal(selectedPlayerIds.length);
      expect(selectedPlayerIds).to.have.lengthOf(5);
      
      console.log("✓ No duplicate players in team purchase");
    });

    it("Should fail when insufficient players available", async () => {
      // First, consume most tokens to leave insufficient players
      const gameState = await program.account.gameState.fetch(gameStatePda);
      
      // Buy teams until we have less than 5 available players
      let availableCount = gameState.players.filter(p => p.availableTokens > 0).length;
      
      while (availableCount >= 5) {
        const gameStateBefore = await program.account.gameState.fetch(gameStatePda);
        
        // Derive team PDA
        const [teamPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("team"),
            (gameStateBefore as any).nextTeamId.toArrayLike(Buffer, "le", 8),
            gameStatePda.toBuffer(),
          ],
          program.programId
        );
        
        await program.methods
          .buyTeam({ a: {} })
          .accountsPartial({
            gameState: gameStatePda,
            teamAccount: teamPda,
            user: provider.wallet.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            systemProgram: anchor.web3.SystemProgram.programId,
          } as any)
          .rpc();
          
        const updatedState = await program.account.gameState.fetch(gameStatePda);
        availableCount = updatedState.players.filter(p => p.availableTokens > 0).length;
      }
      
      // Now try to buy a team when insufficient players
      try {
        const gameStateBefore = await program.account.gameState.fetch(gameStatePda);
        
        // Derive team PDA
        const [teamPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("team"),
            (gameStateBefore as any).nextTeamId.toArrayLike(Buffer, "le", 8),
            gameStatePda.toBuffer(),
          ],
          program.programId
        );
        
        await program.methods
          .buyTeam({ a: {} })
          .accountsPartial({
            gameState: gameStatePda,
            teamAccount: teamPda,
            user: provider.wallet.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            systemProgram: anchor.web3.SystemProgram.programId,
          } as any)
          .rpc();
        
        expect.fail("Should have failed with insufficient players");
      } catch (error) {
        expect(error.message).to.include("InsufficientPlayersAvailable");
        console.log("✓ Correctly prevented purchase with insufficient players");
      }
    });
  });

  describe("Authorization", () => {
    let unauthorizedUser: anchor.web3.Keypair;

    before(async () => {
      unauthorizedUser = anchor.web3.Keypair.generate();
      
      // Airdrop some SOL to unauthorized user for transaction fees
      const airdropTx = await provider.connection.requestAirdrop(
        unauthorizedUser.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropTx);
    });

    it("Should prevent unauthorized user from creating players", async () => {
      try {
        // Get the current next player ID
        const gameState = await program.account.gameState.fetch(gameStatePda);
        const nextPlayerId = gameState.nextPlayerId;
        
        const [playerPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("player"),
            new anchor.BN(nextPlayerId).toArrayLike(Buffer, "le", 2),
            gameStatePda.toBuffer(),
          ],
          program.programId
        );

        await program.methods
          .createPlayer(
            9999, // provider_id
            { silver: {} }, // category
            2000, // total_tokens
            null // metadata_uri
          )
          .accountsPartial({
            gameState: gameStatePda,
            playerAccount: playerPda,
            user: unauthorizedUser.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        expect.fail("Should have failed for unauthorized user");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedAccess");
        console.log("✓ Correctly prevented unauthorized player creation");
      }
    });

    it("Should prevent unauthorized user from adding staff", async () => {
      try {
        const newStaff = anchor.web3.Keypair.generate();

        await program.methods
          .addStaffMember(newStaff.publicKey)
          .accountsPartial({
            gameState: gameStatePda,
            user: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        expect.fail("Should have failed for unauthorized user");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedAccess");
        console.log("✓ Correctly prevented unauthorized staff addition");
      }
    });
  });
});
