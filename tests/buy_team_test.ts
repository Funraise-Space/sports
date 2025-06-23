import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sports } from "../target/types/sports";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccount, createMint, mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { assert } from "chai";

describe("buy_team", () => {
  // Configure the client to use the local cluster
  const connection = new Connection("https://devnet.helius-rpc.com/", {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60000,
});
  
  // El owner se carga más abajo, así que el provider debe configurarse después de cargar el owner
  let provider: anchor.AnchorProvider;

  const program = anchor.workspace.Sports as Program<Sports>;
  
  // Helper function para airdrop con retry
  async function requestAirdropWithRetry(publicKey: PublicKey, amount: number, maxRetries = 5): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`Requesting airdrop (attempt ${i + 1}/${maxRetries}) for ${publicKey.toString()}`);
        const signature = await provider.connection.requestAirdrop(publicKey, amount);
        await provider.connection.confirmTransaction(signature, "confirmed");
        
        // Verificar que el balance se actualizó
        const balance = await provider.connection.getBalance(publicKey);
        if (balance > 0) {
          console.log(`✅ Airdrop successful! Balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
          return;
        } else {
          console.log(`⚠️ Airdrop confirmed but balance is still 0, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (e) {
        console.log(`❌ Airdrop attempt ${i + 1} failed:`, e);
        if (i === maxRetries - 1) throw e;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error(`Failed to airdrop after ${maxRetries} attempts`);
  }
  
  // Test data
  const teamPriceA = new anchor.BN(10_000_000); // $10
  const teamPriceB = new anchor.BN(15_000_000); // $15
  const teamPriceC = new anchor.BN(20_000_000); // $20
  const nftImageUrl = "https://example.com/team-image.jpg";
  let mintUsdc: PublicKey;
  let mintUsdcAuthority: Keypair;

  // Variables globales - un solo game state para todos los tests
  let gameState: PublicKey;
  let programUsdcAuthority: PublicKey;
  let programUsdcAccount: PublicKey;
  let owner: Keypair;
  let updateAuthority: Keypair;

  before(async () => {
    // Limpiar artefactos previos
    const { execSync } = require('child_process');
    const fs = require('fs');
   //execSync('anchor clean', { stdio: 'inherit' });

    // Usar el sports-keypair.json ya existente (NO regenerar programId)
    // const programKeypairPath = 'target/deploy/sports-keypair.json';
    // execSync(`solana-keygen new --outfile ${programKeypairPath} --force`, { stdio: 'inherit' });

    // Crear owner y update authority únicos
    // Cargar owner desde variable de entorno (base58), igual que en simple_initialize_test.ts
    const bs58 = require('bs58');
    const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;
    if (!ownerPrivateKey) {
      throw new Error("OWNER_PRIVATE_KEY environment variable is required (base58 format)");
    }
    owner = Keypair.fromSecretKey(bs58.decode(ownerPrivateKey));
    updateAuthority = owner;

    // Configurar el provider global con el owner y devnet
    provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Compilar el programa antes de deploy para asegurar que el archivo sports.so exista
    execSync('anchor build', { stdio: 'inherit' });

    // Guardar temporalmente la clave privada del owner
    const ownerKeypairPath = '/tmp/owner-keypair.json';
    fs.writeFileSync(ownerKeypairPath, JSON.stringify(Array.from(owner.secretKey)));

    // Desplegar el programa usando el owner como payer
    execSync(`anchor deploy --provider.cluster devnet --provider.wallet ${ownerKeypairPath}`, { stdio: 'inherit' });
    fs.unlinkSync(ownerKeypairPath);

    // Crear mint SPL de prueba (6 decimales)
    mintUsdcAuthority = owner;
    //await requestAirdropWithRetry(mintUsdcAuthority.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    
    mintUsdc = await createMint(
      provider.connection,
      mintUsdcAuthority,
      mintUsdcAuthority.publicKey,
      null,
      6 // Decimales como USDC
    );
    console.log("USDC mint created:", mintUsdc.toString());

    // Airdrop SOL a ambos usando la función helper
    //await requestAirdropWithRetry(owner.publicKey, 20 * anchor.web3.LAMPORTS_PER_SOL);
    //await requestAirdropWithRetry(updateAuthority.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);

    // Game state PDA único - usar la derivación correcta del programa Rust
    [gameState] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_state"), program.programId.toBuffer()],
      program.programId
    );
    
    console.log("Game state PDA:", gameState.toString());
    console.log("Program ID:", program.programId.toString());
    
    // Program USDC authority PDA
    [programUsdcAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc_authority"), gameState.toBuffer()],
      program.programId
    );

    console.log("Program USDC authority PDA:", programUsdcAuthority.toString());

    // Program USDC account
    console.log("Creating program USDC account...");
    programUsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      mintUsdcAuthority, // Usar mintUsdcAuthority como payer para crear la cuenta
      mintUsdc,
      programUsdcAuthority,
      true
    )).address;

    console.log("Program USDC account:", programUsdcAccount.toString());

    // Verificar balance después de crear cuentas asociadas
    const ownerBalanceAfterAccounts = await provider.connection.getBalance(owner.publicKey);
    console.log("Owner balance after creating accounts:", ownerBalanceAfterAccounts / anchor.web3.LAMPORTS_PER_SOL, "SOL");

    // Mintear tokens a la cuenta del programa
    console.log("Minting tokens to program account...");
    await mintTo(
      provider.connection,
      mintUsdcAuthority,
      mintUsdc,
      programUsdcAccount,
      mintUsdcAuthority,
      1_000_000_000
    );

    console.log("Tokens minted to program account");

    // Verificar balance final antes de inicializar
    const ownerBalanceBeforeInit = await provider.connection.getBalance(owner.publicKey);
    console.log("Owner balance before initializing game state:", ownerBalanceBeforeInit / anchor.web3.LAMPORTS_PER_SOL, "SOL");
    
    if (ownerBalanceBeforeInit < 0.1 * anchor.web3.LAMPORTS_PER_SOL) {
      throw new Error(`Owner balance too low for initialization: ${ownerBalanceBeforeInit / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    }

    // Inicializar game state una sola vez
    console.log("Initializing game state...");
    console.log("Initialize parameters:");
    console.log("  - teamPriceA:", teamPriceA.toString());
    console.log("  - teamPriceB:", teamPriceB.toString());
    console.log("  - teamPriceC:", teamPriceC.toString());
    console.log("  - mintUsdc:", mintUsdc.toString());
    console.log("  - updateAuthority:", updateAuthority.publicKey.toString());
    console.log("  - nftImageUrl:", nftImageUrl);
    console.log("  - gameState:", gameState.toString());
    console.log("  - owner:", owner.publicKey.toString());
    
    // Esperar un poco más para asegurar que el airdrop esté completamente confirmado
    console.log("Waiting for airdrop to be fully confirmed...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verificar balance una vez más antes de initialize
    const finalOwnerBalance = await provider.connection.getBalance(owner.publicKey);
    console.log("Final owner balance before initialize:", finalOwnerBalance / anchor.web3.LAMPORTS_PER_SOL, "SOL");
    
    try {
      const tx = await program.methods
        .initialize(
          teamPriceA,
          teamPriceB,
          teamPriceC,
          mintUsdc,
          updateAuthority.publicKey,
          nftImageUrl
        )
        .accounts({
          gameState,
          user: owner.publicKey, // El owner debe ser quien ejecute initialize
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([owner]) // Firmar con owner
        .rpc();
      console.log("Game state initialized successfully! TX:", tx);
    } catch (e: any) {
      console.error('Error initializing game state:', e);
      if (e.logs) {
        console.error('Transaction logs:', e.logs);
      }
      // Intentar obtener más información del error
      if (e.message) {
        console.error('Error message:', e.message);
      }
      if (e.error) {
        console.error('Error details:', e.error);
      }
      throw e;
    }

    // Crear jugadores una sola vez
    console.log("Creating test players...");
    await createTestPlayers();
    console.log("Test players created successfully!");
  });

  async function createTestPlayers() {
    console.log("Starting to create test players...");
    for (let i = 1; i <= 10; i++) {
      const playerId = i;
      const category = i <= 3 ? { bronze: {} } : i <= 6 ? { silver: {} } : { gold: {} };
      const totalTokens = 1000;
      const [playerAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          new anchor.BN(playerId).toArrayLike(Buffer, "le", 2),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );
      
      console.log(`Creating player ${playerId}:`);
      console.log(`  - Category:`, category);
      console.log(`  - Total tokens:`, totalTokens);
      console.log(`  - Player account:`, playerAccount.toString());
      
      try {
        const tx = await program.methods
          .createPlayer(
            playerId,
            category as any,
            totalTokens,
            `https://example.com/player${playerId}.json`
          )
          .accounts({
            gameState,
            playerAccount,
            user: owner.publicKey, // Usar owner como payer
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([owner]) // Firmar con owner
          .rpc();
        console.log(`  ✅ Player ${playerId} created successfully! TX:`, tx);
      } catch (e: any) {
        console.error(`  ❌ Error creating player ${playerId}:`, e);
        if (e.logs) {
          console.error(`  Transaction logs for player ${playerId}:`, e.logs);
        }
        throw e;
      }
    }
    console.log("All test players created successfully!");
  }

  // Variables locales por test
  let user: Keypair;
  let userUsdcAccount: PublicKey;

  beforeEach(async () => {
    // Usar siempre el owner como usuario de test
    user = owner;

    // Cuenta USDC del owner (crear si no existe)
    userUsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      owner, // payer
      mintUsdc,
      owner.publicKey
    )).address;

    // Mintear tokens al owner (opcional: puedes comentar si ya tiene suficiente USDC)
    await mintTo(
      provider.connection,
      mintUsdcAuthority,
      mintUsdc,
      userUsdcAccount,
      mintUsdcAuthority,
      1_000_000_000
    );
  });

  async function setupTeamPurchase(teamId: number, packageType: any) {
    const [teamAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("team"),
        new anchor.BN(teamId).toArrayLike(Buffer, "le", 8),
        user.publicKey.toBuffer(),
        gameState.toBuffer(),
        program.programId.toBuffer(),
      ],
      program.programId
    );
    let nftMint, nftMintBump;
    [nftMint, nftMintBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("nft_mint"),
        new anchor.BN(teamId).toArrayLike(Buffer, "le", 8),
        user.publicKey.toBuffer(),
        gameState.toBuffer(),
      ],
      program.programId
    );
    const userNftAccount = getAssociatedTokenAddressSync(nftMint, user.publicKey);
    const METADATA_PROGRAM_ID = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);
    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        nftMint.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );
    return {
      teamAccount,
      nftMint,
      userNftAccount,
      metadataAccount,
    };
  }

  describe("Team Package A", () => {
    it("should successfully buy team package A", async () => {
      const teamId = 1;
      const packageType = { a: {} }; // Package A
      const termsAccepted = true;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      // Get initial balances
      const initialUserBalance = await provider.connection.getTokenAccountBalance(userUsdcAccount);
      const initialProgramBalance = await provider.connection.getTokenAccountBalance(programUsdcAccount);

      console.log("Starting team purchase...");
      console.log("User USDC account:", userUsdcAccount.toString());
      console.log("Program USDC account:", programUsdcAccount.toString());
      console.log("NFT mint:", nftMint.toString());
      console.log("User NFT account:", userNftAccount.toString());
      console.log("Metadata account:", metadataAccount.toString());

      // Buy team
      await program.methods
        .buyTeam(packageType as any, termsAccepted)
        .accounts({
          gameState,
          teamAccount,
          user: user.publicKey,
          userUsdcAccount,
          programUsdcAccount,
          programUsdcAuthority,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          nftMint,
          metadataAccount,
          userNftAccount,
          metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          updateAuthority: updateAuthority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();

      console.log("Team purchase completed successfully!");

      // Verify team was created
      const teamData = await program.account.team.fetch(teamAccount);
      console.log("Team data:", {
        owner: teamData.owner.toString(),
        teamId: teamData.teamId.toNumber(),
        category: teamData.category,
        playerIds: teamData.playerIds,
        nftMint: teamData.nftMint.toString(),
        state: teamData.state
      });

      assert.equal(teamData.owner.toString(), user.publicKey.toString());
      assert.equal(teamData.teamId.toNumber(), teamId);
      assert.deepEqual(teamData.category, packageType);
      assert.equal(teamData.playerIds.length, 5);
      assert.equal(teamData.termsAccepted, termsAccepted);
      assert.deepEqual(teamData.state, { free: {} }); // Free state
      assert.equal(teamData.nftMint.toString(), nftMint.toString());

      // Verify NFT was minted
      const nftBalance = await provider.connection.getTokenAccountBalance(userNftAccount);
      console.log("NFT balance:", nftBalance.value.amount);
      assert.equal(nftBalance.value.amount, "1");

      // Verify USDC was transferred
      const finalUserBalance = await provider.connection.getTokenAccountBalance(userUsdcAccount);
      const finalProgramBalance = await provider.connection.getTokenAccountBalance(programUsdcAccount);
      
      const userBalanceDiff = parseFloat(initialUserBalance.value.amount) - parseFloat(finalUserBalance.value.amount);
      const programBalanceDiff = parseFloat(finalProgramBalance.value.amount) - parseFloat(initialProgramBalance.value.amount);
      
      console.log("USDC transfer - User diff:", userBalanceDiff, "Program diff:", programBalanceDiff);
      
      assert.approximately(userBalanceDiff, teamPriceA.toNumber() / 1e6, 0.01);
      assert.approximately(programBalanceDiff, teamPriceA.toNumber() / 1e6, 0.01);

      console.log("✅ Test completed successfully!");
    });

    /*
    it("should fail when terms are not accepted", async () => {
      const teamId = 2;
      const packageType = { a: {} }; // Package A
      const termsAccepted = false;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      try {
        await program.methods
          .buyTeam(packageType as any, termsAccepted)
          .accounts({
            gameState,
            teamAccount,
            user: user.publicKey,
            userUsdcAccount,
            programUsdcAccount,
            programUsdcAuthority,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            nftMint,
            metadataAccount,
            userNftAccount,
            metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
            updateAuthority: updateAuthority.publicKey,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          } as any)
          .signers([user])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Terms and conditions must be accepted");
      }
    });
    */
  });

  /*
  describe("Team Package B", () => {
    it("should successfully buy team package B", async () => {
      const teamId = 3;
      const packageType = { b: {} }; // Package B
      const termsAccepted = true;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      await program.methods
        .buyTeam(packageType as any, termsAccepted)
        .accounts({
          gameState,
          teamAccount,
          user: user.publicKey,
          userUsdcAccount,
          programUsdcAccount,
          programUsdcAuthority,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          nftMint,
          metadataAccount,
          userNftAccount,
          metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          updateAuthority: updateAuthority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();

      // Verify team was created with correct price
      const teamData = await program.account.team.fetch(teamAccount);
      assert.deepEqual(teamData.category, packageType);
      assert.equal(teamData.playerIds.length, 5);

      // Verify NFT was minted
      const nftBalance = await provider.connection.getTokenAccountBalance(userNftAccount);
      assert.equal(nftBalance.value.amount, "1");
    });
  });

  describe("Team Package C", () => {
    it("should successfully buy team package C", async () => {
      const teamId = 4;
      const packageType = { c: {} }; // Package C
      const termsAccepted = true;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      await program.methods
        .buyTeam(packageType as any, termsAccepted)
        .accounts({
          gameState,
          teamAccount,
          user: user.publicKey,
          userUsdcAccount,
          programUsdcAccount,
          programUsdcAuthority,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          nftMint,
          metadataAccount,
          userNftAccount,
          metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          updateAuthority: updateAuthority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();

      // Verify team was created
      const teamData = await program.account.team.fetch(teamAccount);
      assert.deepEqual(teamData.category, packageType);
      assert.equal(teamData.playerIds.length, 5);

      // Verify NFT was minted
      const nftBalance = await provider.connection.getTokenAccountBalance(userNftAccount);
      assert.equal(nftBalance.value.amount, "1");
    });
  });

  describe("Error cases", () => {
    it("should fail when contract is paused", async () => {
      // Pause the contract first
      await program.methods
        .pause()
        .accounts({
          gameState,
          user: owner.publicKey,
        } as any)
        .signers([owner])
        .rpc();

      const teamId = 5;
      const packageType = { a: {} };
      const termsAccepted = true;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      try {
        await program.methods
          .buyTeam(packageType as any, termsAccepted)
          .accounts({
            gameState,
            teamAccount,
            user: user.publicKey,
            userUsdcAccount,
            programUsdcAccount,
            programUsdcAuthority,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            nftMint,
            metadataAccount,
            userNftAccount,
            metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
            updateAuthority: updateAuthority.publicKey,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          } as any)
          .signers([user])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Contract is paused");
      }

      // Unpause the contract for other tests
      await program.methods
        .unpause()
        .accounts({
          gameState,
          user: owner.publicKey,
        } as any)
        .signers([owner])
        .rpc();
    });

    it("should fail when no report is open", async () => {
      // Close the current report to simulate no open report
      await program.methods
        .closeCurrentReport(
          new anchor.BN(0),
          0,
          0,
          new anchor.BN(0),
          0
        )
        .accounts({
          gameState,
          report: PublicKey.findProgramAddressSync(
            [Buffer.from("report"), new anchor.BN(1).toArrayLike(Buffer, "le", 8), program.programId.toBuffer()],
            program.programId
          )[0],
          user: owner.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([owner])
        .rpc();

      const teamId = 6;
      const packageType = { a: {} };
      const termsAccepted = true;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      try {
        await program.methods
          .buyTeam(packageType as any, termsAccepted)
          .accounts({
            gameState,
            teamAccount,
            user: user.publicKey,
            userUsdcAccount,
            programUsdcAccount,
            programUsdcAuthority,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            nftMint,
            metadataAccount,
            userNftAccount,
            metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
            updateAuthority: updateAuthority.publicKey,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          } as any)
          .signers([user])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "No hay un reporte abierto para acumular ventas");
      }
    });
  });

  describe("NFT Metadata", () => {
    it("should create NFT with correct metadata", async () => {
      const teamId = 7;
      const packageType = { a: {} };
      const termsAccepted = true;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      await program.methods
        .buyTeam(packageType as any, termsAccepted)
        .accounts({
          gameState,
          teamAccount,
          user: user.publicKey,
          userUsdcAccount,
          programUsdcAccount,
          programUsdcAuthority,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          nftMint,
          metadataAccount,
          userNftAccount,
          metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          updateAuthority: updateAuthority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();

      // Verify NFT was minted
      const nftBalance = await provider.connection.getTokenAccountBalance(userNftAccount);
      assert.equal(nftBalance.value.amount, "1");

      // Verify metadata account exists
      const metadataAccountInfo = await provider.connection.getAccountInfo(metadataAccount);
      assert.isNotNull(metadataAccountInfo);
      assert.isTrue(metadataAccountInfo.data.length > 0);
    });
  });

  describe("Team ID Increment", () => {
    it("should increment team ID correctly", async () => {
      const teamId1 = 8;
      const teamId2 = 9;
      const packageType = { a: {} };
      const termsAccepted = true;

      // Buy first team
      const { teamAccount: teamAccount1, nftMint: nftMint1, userNftAccount: userNftAccount1, metadataAccount: metadataAccount1 } = 
        await setupTeamPurchase(teamId1, packageType);

      await program.methods
        .buyTeam(packageType as any, termsAccepted)
        .accounts({
          gameState,
          teamAccount: teamAccount1,
          user: user.publicKey,
          userUsdcAccount,
          programUsdcAccount,
          programUsdcAuthority,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          nftMint: nftMint1,
          metadataAccount: metadataAccount1,
          userNftAccount: userNftAccount1,
          metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          updateAuthority: updateAuthority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();

      // Buy second team
      const { teamAccount: teamAccount2, nftMint: nftMint2, userNftAccount: userNftAccount2, metadataAccount: metadataAccount2 } = 
        await setupTeamPurchase(teamId2, packageType);

      await program.methods
        .buyTeam(packageType as any, termsAccepted)
        .accounts({
          gameState,
          teamAccount: teamAccount2,
          user: user.publicKey,
          userUsdcAccount,
          programUsdcAccount,
          programUsdcAuthority,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          nftMint: nftMint2,
          metadataAccount: metadataAccount2,
          userNftAccount: userNftAccount2,
          metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          updateAuthority: updateAuthority.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .signers([user])
        .rpc();

      // Verify both teams were created with correct IDs
      const teamData1 = await program.account.team.fetch(teamAccount1);
      const teamData2 = await program.account.team.fetch(teamAccount2);
      
      assert.equal(teamData1.teamId.toNumber(), teamId1);
      assert.equal(teamData2.teamId.toNumber(), teamId2);
      assert.notEqual(teamData1.teamId.toNumber(), teamData2.teamId.toNumber());
    });
  });*/
});
