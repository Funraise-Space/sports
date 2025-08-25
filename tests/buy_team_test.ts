import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sports } from "../target/types/sports";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccount, createMint, mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { assert } from "chai";

describe("buy_team", () => {
  // Configure the client to use the local cluster
  const connection = new Connection("http://localhost:8899", {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60000,
  });
  
  // El owner se carga más abajo, así que el provider debe configurarse después de cargar el owner
  let provider: anchor.AnchorProvider;

  let program: Program<Sports>;
  // Helper function para airdrop en localnet
  async function requestAirdrop(publicKey: PublicKey, amount: number): Promise<void> {
    try {
      console.log(`Requesting airdrop for ${publicKey.toString()}`);
      const signature = await provider.connection.requestAirdrop(publicKey, amount);
      await provider.connection.confirmTransaction(signature, "confirmed");
      
      const balance = await provider.connection.getBalance(publicKey);
      console.log(`✅ Airdrop successful! Balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    } catch (e) {
      console.log(`❌ Airdrop failed:`, e);
      throw e;
    }
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

    // Crear owner y update authority únicos para test local
    owner = Keypair.generate();
    updateAuthority = owner;
    
    console.log("Generated test owner:", owner.publicKey.toString());

    // Configurar el provider global con el owner y devnet
    provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Usar anchor.workspace para obtener el programa en localnet
    try {
      program = anchor.workspace.Sports as Program<Sports>;
      console.log("Program loaded from workspace:", program.programId.toString());
    } catch (e) {
      // Fallback: cargar manualmente si workspace no está disponible
      const idl = JSON.parse(require('fs').readFileSync('./target/idl/sports.json', 'utf8'));
      const programId = new PublicKey("CDf5QvcmJzaf4i6FSioCbMCayuPsStXDTPxNijMiE9Cq");
      program = new Program(idl, provider) as Program<Sports>;
      console.log("Program loaded manually:", program.programId.toString());
    }

    // Airdrop SOL al owner para las transacciones
    await requestAirdrop(owner.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    
    // Crear mint SPL de prueba (6 decimales)
    mintUsdcAuthority = owner;
    
    mintUsdc = await createMint(
      provider.connection,
      mintUsdcAuthority,
      mintUsdcAuthority.publicKey,
      null,
      6 // Decimales como USDC
    );
    console.log("USDC mint created:", mintUsdc.toString());

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
          nftImageUrl,
          new anchor.BN(2) // time_lock de 2 segundos para tests rápidos
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
    
    const playerNames = [
      "Lionel Messi", "Cristiano Ronaldo", "Neymar Jr", "Kylian Mbappé", "Erling Haaland",
      "Kevin De Bruyne", "Luka Modrić", "Virgil van Dijk", "Mohamed Salah", "Robert Lewandowski"
    ];
    
    const disciplines = [
      "Football", "Basketball", "Tennis", "Swimming", "Athletics",
      "Volleyball", "Baseball", "Hockey", "Golf", "Boxing"
    ];
    
    for (let i = 1; i <= 10; i++) {
      const playerId = i;
      const category = i <= 3 ? { bronze: {} } : i <= 6 ? { silver: {} } : { gold: {} };
      const totalTokens = 1000;
      const name = playerNames[i - 1];
      const discipline = disciplines[i - 1];
      
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
      console.log(`  - Name: ${name}`);
      console.log(`  - Discipline: ${discipline}`);
      console.log(`  - Category:`, category);
      console.log(`  - Total tokens:`, totalTokens);
      console.log(`  - Player account:`, playerAccount.toString());
      
      try {
        const tx = await program.methods
          .createPlayer(
            playerId,
            category as any,
            totalTokens,
            `https://example.com/player${playerId}.json`,
            name,
            discipline
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
    // Obtener el estado actual del juego para usar next_team_id
    const gameStateAccount = await program.account.gameState.fetch(gameState);
    const nextTeamId = gameStateAccount.nextTeamId;
    
    const [teamAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("team"),
        new anchor.BN(nextTeamId).toArrayLike(Buffer, "le", 8),
        gameState.toBuffer(),
        program.programId.toBuffer(),
      ],
      program.programId
    );
    let nftMint, nftMintBump;
    [nftMint, nftMintBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("nft_mint"),
        new anchor.BN(nextTeamId).toArrayLike(Buffer, "le", 8),
        gameState.toBuffer(),
        program.programId.toBuffer(),
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
      // Get current next_team_id from game state
      const gameStateAccount = await program.account.gameState.fetch(gameState);
      const teamId = gameStateAccount.nextTeamId.toNumber();
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

      // Increase compute units for this transaction
      const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000,
      });
      
      const transaction = new anchor.web3.Transaction()
        .add(computeBudgetIx)
        .add(await program.methods
          .buyTeam(packageType, termsAccepted)
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
          })
          .instruction());

      await provider.sendAndConfirm(transaction, [user], {
        commitment: "confirmed",
        preflightCommitment: "confirmed"
      });

      console.log("Team purchase completed successfully!");

      // Verify team was created
      const teamData = await program.account.team.fetch(teamAccount);
      console.log("Team data:", {
        firstBuyer: teamData.firstBuyer.toString(),
        teamId: teamData.teamId.toNumber(),
        category: teamData.category,
        playerIds: teamData.playerIds,
        nftMint: teamData.nftMint.toString(),
        state: teamData.state
      });

      assert.equal(teamData.firstBuyer.toString(), user.publicKey.toString());
      assert.equal(teamData.teamId.toNumber(), teamId);
      assert.deepEqual(teamData.category, packageType);
      assert.equal(teamData.playerIds.length, 5);
      assert.equal(teamData.termsAccepted, termsAccepted);
      assert.deepEqual(teamData.state, { free: {} }); // Free state
      assert.equal(teamData.nftMint.toString(), nftMint.toString());

      // Verify NFT was minted - Check account actually exists and has correct data
      const nftAccountInfo = await provider.connection.getAccountInfo(userNftAccount);
      console.log("NFT account exists:", nftAccountInfo !== null);
      assert.isNotNull(nftAccountInfo, "NFT token account should exist");
      
      if (nftAccountInfo) {
        const nftBalance = await provider.connection.getTokenAccountBalance(userNftAccount);
        console.log("NFT balance:", nftBalance.value.amount);
        assert.equal(nftBalance.value.amount, "1", "User should own exactly 1 NFT");
        
        // Verify the NFT mint account exists and has correct supply
        const nftMintInfo = await provider.connection.getAccountInfo(nftMint);
        assert.isNotNull(nftMintInfo, "NFT mint account should exist");
        
        const mintSupply = await provider.connection.getTokenSupply(nftMint);
        console.log("NFT mint supply:", mintSupply.value.amount);
        assert.equal(mintSupply.value.amount, "1", "NFT should have supply of exactly 1");
        
        // Verify metadata account exists
        const metadataAccountInfo = await provider.connection.getAccountInfo(metadataAccount);
        console.log("Metadata account exists:", metadataAccountInfo !== null);
        assert.isNotNull(metadataAccountInfo, "NFT metadata account should exist");
        
        // Fetch and verify NFT metadata
        if (metadataAccountInfo) {
          try {
            const metadataBuffer = metadataAccountInfo.data;
            console.log("Metadata account data length:", metadataBuffer.length);
            
            // Simple approach: search for readable strings in the buffer
            const bufferString = metadataBuffer.toString('utf8');
            
            // Extract name (look for "Team #" pattern)
            const nameMatch = bufferString.match(/Team #\d+/);
            const name = nameMatch ? nameMatch[0] : 'Not found';
            
            // Extract symbol (look for "TEAM")
            const symbolMatch = bufferString.match(/TEAM/);
            const symbol = symbolMatch ? symbolMatch[0] : 'Not found';
            
            // Extract URI (look for http/https URLs)
            const uriMatch = bufferString.match(/https?:\/\/[^\s\x00]+/);
            const uri = uriMatch ? uriMatch[0] : 'Not found';
            
            console.log(" NFT METADATA FOUND:");
            console.log("  Name:", name);
            console.log("  Symbol:", symbol);
            console.log("  URI:", uri);
            console.log("  Expected Package:", Object.keys(packageType)[0].toUpperCase());
            console.log("  Expected Team ID:", teamId);
            
            // Show first 200 chars of readable content
            const readableContent = bufferString.replace(/\x00/g, '').substring(0, 200);
            console.log(" Readable content:", readableContent);
            
            // Basic validations
            assert.isTrue(name.includes("Team"), `Name should contain 'Team', got: ${name}`);
            assert.isTrue(symbol === "TEAM", `Symbol should be 'TEAM', got: ${symbol}`);
            
          } catch (e) {
            console.log(" Metadata parsing failed:", e);
            const metadataString = metadataBuffer.toString('utf8', 0, Math.min(300, metadataBuffer.length));
            console.log(" Raw metadata (first 300 chars):", metadataString.replace(/\x00/g, ' '));
          }
        }
      }

      // Verify USDC was transferred
      const finalUserBalance = await provider.connection.getTokenAccountBalance(userUsdcAccount);
      const finalProgramBalance = await provider.connection.getTokenAccountBalance(programUsdcAccount);
      
      const userBalanceDiff = parseFloat(initialUserBalance.value.amount) - parseFloat(finalUserBalance.value.amount);
      const programBalanceDiff = parseFloat(finalProgramBalance.value.amount) - parseFloat(initialProgramBalance.value.amount);
      
      console.log("USDC transfer - User diff:", userBalanceDiff, "Program diff:", programBalanceDiff);
      
      assert.approximately(userBalanceDiff, teamPriceA.toNumber(), 0.01);
      assert.approximately(programBalanceDiff, teamPriceA.toNumber(), 0.01);

      console.log(" Test completed successfully!");
    });

    it("should fail when terms are not accepted", async () => {
      const teamId = 2;
      const packageType = { a: {} }; // Package A
      const termsAccepted = false;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      console.log("Testing terms not accepted scenario...");

      try {
        await program.methods
          .buyTeam(packageType, termsAccepted)
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
          })
          .signers([user])
          .rpc();

        assert.fail("Should have thrown an error");
      } catch (error: any) {
        console.log("Expected error caught:", error.message);
        // Check for the specific error code or message from your Rust program
        assert.isTrue(
          error.message.includes("TermsNotAccepted") || 
          error.message.includes("Terms and conditions must be accepted"),
          `Expected TermsNotAccepted error, got: ${error.message}`
        );
      }

      console.log(" Terms not accepted test passed!");
    });
  });

  describe("Team Package B", () => {
    it("should successfully buy team package B", async () => {
      // Get current next_team_id from game state
      const gameStateAccount = await program.account.gameState.fetch(gameState);
      const teamId = gameStateAccount.nextTeamId.toNumber();
      const packageType = { b: {} }; // Package B
      const termsAccepted = true;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      // Get initial balances
      const initialUserBalance = await provider.connection.getTokenAccountBalance(userUsdcAccount);
      const initialProgramBalance = await provider.connection.getTokenAccountBalance(programUsdcAccount);

      console.log("Starting team package B purchase...");

      // Increase compute units for this transaction
      const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000,
      });
      
      const transaction = new anchor.web3.Transaction()
        .add(computeBudgetIx)
        .add(await program.methods
          .buyTeam(packageType, termsAccepted)
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
          })
          .instruction());

      await provider.sendAndConfirm(transaction, [user], {
        commitment: "confirmed",
        preflightCommitment: "confirmed"
      });

      console.log("Team package B purchase completed successfully!");

      // Verify team was created with correct price
      const teamData = await program.account.team.fetch(teamAccount);
      console.log("Team B data:", {
        firstBuyer: teamData.firstBuyer.toString(),
        teamId: teamData.teamId.toNumber(),
        category: teamData.category,
        playerIds: teamData.playerIds,
        nftMint: teamData.nftMint.toString(),
        state: teamData.state
      });

      assert.equal(teamData.firstBuyer.toString(), user.publicKey.toString());
      assert.equal(teamData.teamId.toNumber(), teamId);
      assert.deepEqual(teamData.category, packageType);
      assert.equal(teamData.playerIds.length, 5);
      assert.equal(teamData.termsAccepted, termsAccepted);
      assert.deepEqual(teamData.state, { free: {} });
      assert.equal(teamData.nftMint.toString(), nftMint.toString());

      // Verify NFT was minted - Check account actually exists and has correct data
      const nftAccountInfo = await provider.connection.getAccountInfo(userNftAccount);
      console.log("NFT account exists:", nftAccountInfo !== null);
      assert.isNotNull(nftAccountInfo, "NFT token account should exist");
      
      if (nftAccountInfo) {
        const nftBalance = await provider.connection.getTokenAccountBalance(userNftAccount);
        console.log("NFT balance:", nftBalance.value.amount);
        assert.equal(nftBalance.value.amount, "1", "User should own exactly 1 NFT");
        
        // Verify the NFT mint account exists and has correct supply
        const nftMintInfo = await provider.connection.getAccountInfo(nftMint);
        assert.isNotNull(nftMintInfo, "NFT mint account should exist");
        
        const mintSupply = await provider.connection.getTokenSupply(nftMint);
        console.log("NFT mint supply:", mintSupply.value.amount);
        assert.equal(mintSupply.value.amount, "1", "NFT should have supply of exactly 1");
        
        // Verify metadata account exists
        const metadataAccountInfo = await provider.connection.getAccountInfo(metadataAccount);
        console.log("Metadata account exists:", metadataAccountInfo !== null);
        assert.isNotNull(metadataAccountInfo, "NFT metadata account should exist");
        
        // Fetch and verify NFT metadata
        if (metadataAccountInfo) {
          try {
            const metadataBuffer = metadataAccountInfo.data;
            console.log("Metadata account data length:", metadataBuffer.length);
            
            // Simple approach: search for readable strings in the buffer
            const bufferString = metadataBuffer.toString('utf8');
            
            // Extract name (look for "Team #" pattern)
            const nameMatch = bufferString.match(/Team #\d+/);
            const name = nameMatch ? nameMatch[0] : 'Not found';
            
            // Extract symbol (look for "TEAM")
            const symbolMatch = bufferString.match(/TEAM/);
            const symbol = symbolMatch ? symbolMatch[0] : 'Not found';
            
            // Extract URI (look for http/https URLs)
            const uriMatch = bufferString.match(/https?:\/\/[^\s\x00]+/);
            const uri = uriMatch ? uriMatch[0] : 'Not found';
            
            console.log(" NFT METADATA FOUND:");
            console.log("  Name:", name);
            console.log("  Symbol:", symbol);
            console.log("  URI:", uri);
            console.log("  Expected Package:", Object.keys(packageType)[0].toUpperCase());
            console.log("  Expected Team ID:", teamId);
            
            // Show first 200 chars of readable content
            const readableContent = bufferString.replace(/\x00/g, '').substring(0, 200);
            console.log(" Readable content:", readableContent);
            
            // Basic validations
            assert.isTrue(name.includes("Team"), `Name should contain 'Team', got: ${name}`);
            assert.isTrue(symbol === "TEAM", `Symbol should be 'TEAM', got: ${symbol}`);
            
          } catch (e) {
            console.log(" Metadata parsing failed:", e);
            const metadataString = metadataBuffer.toString('utf8', 0, Math.min(300, metadataBuffer.length));
            console.log(" Raw metadata (first 300 chars):", metadataString.replace(/\x00/g, ' '));
          }
        }
      }

      // Verify USDC was transferred (Package B price)
      const finalUserBalance = await provider.connection.getTokenAccountBalance(userUsdcAccount);
      const finalProgramBalance = await provider.connection.getTokenAccountBalance(programUsdcAccount);
      
      const userBalanceDiff = parseFloat(initialUserBalance.value.amount) - parseFloat(finalUserBalance.value.amount);
      const programBalanceDiff = parseFloat(finalProgramBalance.value.amount) - parseFloat(initialProgramBalance.value.amount);
      
      console.log("USDC transfer - User diff:", userBalanceDiff, "Program diff:", programBalanceDiff);
      
      assert.approximately(userBalanceDiff, teamPriceB.toNumber(), 0.01);
      assert.approximately(programBalanceDiff, teamPriceB.toNumber(), 0.01);

      console.log(" Package B test completed successfully!");
    });
  });

  describe("Team Package C", () => {
    it("should successfully buy team package C", async () => {
      // Get current next_team_id from game state
      const gameStateAccount = await program.account.gameState.fetch(gameState);
      const teamId = gameStateAccount.nextTeamId.toNumber();
      const packageType = { c: {} }; // Package C
      const termsAccepted = true;

      const { teamAccount, nftMint, userNftAccount, metadataAccount } = await setupTeamPurchase(teamId, packageType);

      // Get initial balances
      const initialUserBalance = await provider.connection.getTokenAccountBalance(userUsdcAccount);
      const initialProgramBalance = await provider.connection.getTokenAccountBalance(programUsdcAccount);

      console.log("Starting team package C purchase...");

      // Increase compute units for this transaction
      const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000,
      });
      
      const transaction = new anchor.web3.Transaction()
        .add(computeBudgetIx)
        .add(await program.methods
          .buyTeam(packageType, termsAccepted)
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
          })
          .instruction());

      await provider.sendAndConfirm(transaction, [user], {
        commitment: "confirmed",
        preflightCommitment: "confirmed"
      });

      console.log("Team package C purchase completed successfully!");

      // Verify team was created
      const teamData = await program.account.team.fetch(teamAccount);
      console.log("Team C data:", {
        firstBuyer: teamData.firstBuyer.toString(),
        teamId: teamData.teamId.toNumber(),
        category: teamData.category,
        playerIds: teamData.playerIds,
        nftMint: teamData.nftMint.toString(),
        state: teamData.state
      });

      assert.equal(teamData.firstBuyer.toString(), user.publicKey.toString());
      assert.equal(teamData.teamId.toNumber(), teamId);
      assert.deepEqual(teamData.category, packageType);
      assert.equal(teamData.playerIds.length, 5);
      assert.equal(teamData.termsAccepted, termsAccepted);
      assert.deepEqual(teamData.state, { free: {} });
      assert.equal(teamData.nftMint.toString(), nftMint.toString());

      // Verify NFT was minted - Check account actually exists and has correct data
      const nftAccountInfo = await provider.connection.getAccountInfo(userNftAccount);
      console.log("NFT account exists:", nftAccountInfo !== null);
      assert.isNotNull(nftAccountInfo, "NFT token account should exist");
      
      if (nftAccountInfo) {
        const nftBalance = await provider.connection.getTokenAccountBalance(userNftAccount);
        console.log("NFT balance:", nftBalance.value.amount);
        assert.equal(nftBalance.value.amount, "1", "User should own exactly 1 NFT");
        
        // Verify the NFT mint account exists and has correct supply
        const nftMintInfo = await provider.connection.getAccountInfo(nftMint);
        assert.isNotNull(nftMintInfo, "NFT mint account should exist");
        
        const mintSupply = await provider.connection.getTokenSupply(nftMint);
        console.log("NFT mint supply:", mintSupply.value.amount);
        assert.equal(mintSupply.value.amount, "1", "NFT should have supply of exactly 1");
        
        // Verify metadata account exists
        const metadataAccountInfo = await provider.connection.getAccountInfo(metadataAccount);
        console.log("Metadata account exists:", metadataAccountInfo !== null);
        assert.isNotNull(metadataAccountInfo, "NFT metadata account should exist");
        
        // Fetch and verify NFT metadata
        if (metadataAccountInfo) {
          try {
            const metadataBuffer = metadataAccountInfo.data;
            console.log("Metadata account data length:", metadataBuffer.length);
            
            // Simple approach: search for readable strings in the buffer
            const bufferString = metadataBuffer.toString('utf8');
            
            // Extract name (look for "Team #" pattern)
            const nameMatch = bufferString.match(/Team #\d+/);
            const name = nameMatch ? nameMatch[0] : 'Not found';
            
            // Extract symbol (look for "TEAM")
            const symbolMatch = bufferString.match(/TEAM/);
            const symbol = symbolMatch ? symbolMatch[0] : 'Not found';
            
            // Extract URI (look for http/https URLs)
            const uriMatch = bufferString.match(/https?:\/\/[^\s\x00]+/);
            const uri = uriMatch ? uriMatch[0] : 'Not found';
            
            console.log(" NFT METADATA FOUND:");
            console.log("  Name:", name);
            console.log("  Symbol:", symbol);
            console.log("  URI:", uri);
            console.log("  Expected Package:", Object.keys(packageType)[0].toUpperCase());
            console.log("  Expected Team ID:", teamId);
            
            // Show first 200 chars of readable content
            const readableContent = bufferString.replace(/\x00/g, '').substring(0, 200);
            console.log(" Readable content:", readableContent);
            
            // Basic validations
            assert.isTrue(name.includes("Team"), `Name should contain 'Team', got: ${name}`);
            assert.isTrue(symbol === "TEAM", `Symbol should be 'TEAM', got: ${symbol}`);
            
          } catch (e) {
            console.log(" Metadata parsing failed:", e);
            const metadataString = metadataBuffer.toString('utf8', 0, Math.min(300, metadataBuffer.length));
            console.log(" Raw metadata (first 300 chars):", metadataString.replace(/\x00/g, ' '));
          }
        }
      }

      // Verify USDC was transferred (Package C price)
      const finalUserBalance = await provider.connection.getTokenAccountBalance(userUsdcAccount);
      const finalProgramBalance = await provider.connection.getTokenAccountBalance(programUsdcAccount);
      
      const userBalanceDiff = parseFloat(initialUserBalance.value.amount) - parseFloat(finalUserBalance.value.amount);
      const programBalanceDiff = parseFloat(finalProgramBalance.value.amount) - parseFloat(initialProgramBalance.value.amount);
      
      console.log("USDC transfer - User diff:", userBalanceDiff, "Program diff:", programBalanceDiff);
      
      assert.approximately(userBalanceDiff, teamPriceC.toNumber(), 0.01);
      assert.approximately(programBalanceDiff, teamPriceC.toNumber(), 0.01);

      console.log(" Package C test completed successfully!");
    });
  });

  describe("Read All Sold Teams", () => {
    it("should read all team PDAs created during tests", async () => {
      console.log("\n=== READING ALL SOLD TEAMS ===");
      
      // Obtener el estado actual del juego para ver cuántos equipos se han vendido
      const gameStateAccount = await program.account.gameState.fetch(gameState);
      const currentNextTeamId = gameStateAccount.nextTeamId.toNumber();
      
      console.log(`Total teams sold: ${currentNextTeamId - 1}`);
      console.log(`Next team ID will be: ${currentNextTeamId}`);
      
      // Leer todos los equipos vendidos (desde team_id 1 hasta currentNextTeamId - 1)
      for (let teamId = 1; teamId < currentNextTeamId; teamId++) {
        try {
          // Derivar la PDA del equipo usando las nuevas seeds simplificadas
          const [teamAccountPDA] = PublicKey.findProgramAddressSync(
            [
              Buffer.from("team"),
              new anchor.BN(teamId).toArrayLike(Buffer, "le", 8),
              gameState.toBuffer(),
              program.programId.toBuffer(),
            ],
            program.programId
          );
          
          // Leer los datos del equipo
          const teamData = await program.account.team.fetch(teamAccountPDA);
          
          console.log(`\n--- TEAM ${teamId} ---`);
          console.log(`PDA: ${teamAccountPDA.toString()}`);
          console.log(`First Buyer: ${teamData.firstBuyer.toString()}`);
          console.log(`Package: ${Object.keys(teamData.category)[0].toUpperCase()}`);
          console.log(`Players: [${teamData.playerIds.join(', ')}]`);
          
          // Leer datos detallados de cada player
          console.log(`Player Details:`);
          for (const playerId of teamData.playerIds) {
            try {
              // Derivar la PDA del player
              const [playerAccountPDA] = PublicKey.findProgramAddressSync(
                [
                  Buffer.from("player"),
                  new anchor.BN(playerId).toArrayLike(Buffer, "le", 2),
                  gameState.toBuffer(),
                  program.programId.toBuffer(),
                ],
                program.programId
              );
              
              // Leer los datos del player
              const playerData = await program.account.player.fetch(playerAccountPDA);
              
              const categoryName = Object.keys(playerData.category)[0];
              const availableTokens = playerData.totalTokens - playerData.tokensSold;
              
              console.log(`  Player ${playerId}: ${playerData.name} (${playerData.discipline}) | ${categoryName.toUpperCase()} | Total: ${playerData.totalTokens} | Sold: ${playerData.tokensSold} | Available: ${availableTokens}`);
              
            } catch (error) {
              console.log(`  Player ${playerId}: ❌ Error reading player data`);
            }
          }
          
          console.log(`NFT Mint: ${teamData.nftMint.toString()}`);
          console.log(`State: ${Object.keys(teamData.state)[0]}`);
          console.log(`Created At: ${new Date(teamData.createdAt.toNumber() * 1000).toISOString()}`);
          console.log(`Terms Accepted: ${teamData.termsAccepted}`);
          
          // Verificar que el equipo existe y tiene datos válidos
          assert.isTrue(teamData.teamId.toNumber() === teamId, `Team ID should match ${teamId}`);
          assert.isTrue(teamData.playerIds.length === 5, "Team should have 5 players");
          assert.isNotNull(teamData.firstBuyer, "Team should have a first buyer");
          assert.isTrue(teamData.termsAccepted, "Terms should be accepted");
          
        } catch (error) {
          console.log(`❌ Error reading team ${teamId}:`, error);
          throw error;
        }
      }
      
      console.log(`\n✅ Successfully read all ${currentNextTeamId - 1} sold teams!`);
      console.log("=== END READING TEAMS ===\n");
    });
  });
});
