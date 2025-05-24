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
      // Execute initialize
      const tx = await program.methods
        .initialize()
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

      console.log("Game State initialized with:");
      console.log("- Owner:", gameState.owner.toString());
      console.log("- Staff count:", gameState.staff.length);
      console.log("- Players count:", gameState.players.length);
      console.log("- Next player ID:", gameState.nextPlayerId);
    });

    it("Should fail when trying to initialize twice", async () => {
      try {
        // Try to initialize again
        await program.methods
          .initialize()
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
        const [playerPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("player"),
            new anchor.BN(2).toArrayLike(Buffer, "le", 2),
            gameStatePda.toBuffer(),
          ],
          program.programId
        );

        await program.methods
          .createPlayer(
            2001, // provider_id
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
