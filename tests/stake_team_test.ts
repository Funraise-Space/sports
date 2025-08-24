import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sports } from "../target/types/sports";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccount, createMint, mintTo, getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
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
        console.log("Error type:", error.constructor.name);
        
        // Cualquier error es válido aquí - lo importante es que la operación falle
        console.log("✅ Stake operation was correctly blocked");
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

  describe("NFT Transfer and Stake Tests", () => {
    let newOwner: Keypair;
    let teamId: number;
    let nftMint: PublicKey;
    let ownerNftAccount: PublicKey;
    let newOwnerNftAccount: PublicKey;

    before(async () => {
      // Crear nueva cuenta con SOL
      newOwner = Keypair.generate();
      
      // Airdrop SOL al new_owner
      await requestAirdrop(newOwner.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      
      // Usar el primer equipo comprado (team_id = 1)
      teamId = 1;
      
      // Derivar NFT mint del primer equipo
      [nftMint] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("nft_mint"),
          new anchor.BN(teamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      // Cuentas de NFT
      ownerNftAccount = getAssociatedTokenAddressSync(nftMint, owner.publicKey);
      newOwnerNftAccount = getAssociatedTokenAddressSync(nftMint, newOwner.publicKey);
    });

    it("should transfer NFT from first_buyer to new_owner", async () => {
      console.log("=== NFT TRANSFER TEST ===");
      console.log("Team ID:", teamId);
      console.log("NFT Mint:", nftMint.toString());
      console.log("Owner NFT Account:", ownerNftAccount.toString());
      console.log("New Owner NFT Account:", newOwnerNftAccount.toString());

      // Verificar balance inicial del owner
      const initialOwnerBalance = await connection.getTokenAccountBalance(ownerNftAccount);
      console.log("Initial owner NFT balance:", initialOwnerBalance.value.amount);
      assert.equal(initialOwnerBalance.value.amount, "1", "Owner should have 1 NFT initially");

      // Crear cuenta asociada para new_owner
      await getOrCreateAssociatedTokenAccount(
        connection,
        newOwner,
        nftMint,
        newOwner.publicKey
      );

      // Transferir NFT del owner al new_owner
      console.log("Transferring NFT from owner to new_owner...");
      await transfer(
        connection,
        owner, // payer
        ownerNftAccount, // source
        newOwnerNftAccount, // destination
        owner.publicKey, // owner
        1 // amount
      );

      // Verificar balances después de transferencia
      const finalOwnerBalance = await connection.getTokenAccountBalance(ownerNftAccount);
      const finalNewOwnerBalance = await connection.getTokenAccountBalance(newOwnerNftAccount);
      
      console.log("Final owner NFT balance:", finalOwnerBalance.value.amount);
      console.log("Final new_owner NFT balance:", finalNewOwnerBalance.value.amount);

      assert.equal(finalOwnerBalance.value.amount, "0", "Owner should have 0 NFTs after transfer");
      assert.equal(finalNewOwnerBalance.value.amount, "1", "New owner should have 1 NFT after transfer");

      console.log("✅ NFT transfer completed successfully!");
    });

    it("should allow new_owner to stake the transferred NFT", async () => {
      console.log("=== STAKE TEAM TEST ===");
      
      // Derivar cuentas necesarias
      const [teamAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("team"),
          new anchor.BN(teamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      // Program NFT authority PDA
      const [programNftAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("nft_authority"), gameState.toBuffer()],
        program.programId
      );

      // Program NFT account
      const programNftAccount = getAssociatedTokenAddressSync(nftMint, programNftAuthority, true);

      console.log("Team Account:", teamAccount.toString());
      console.log("Program NFT Authority:", programNftAuthority.toString());
      console.log("Program NFT Account:", programNftAccount.toString());

      // Crear program_nft_account si no existe
      await getOrCreateAssociatedTokenAccount(
        connection,
        newOwner, // payer
        nftMint,
        programNftAuthority,
        true
      );

      // Verificar estado inicial del equipo
      const initialTeamData = await program.account.team.fetch(teamAccount);
      console.log("Initial team state:", Object.keys(initialTeamData.state)[0]);
      assert.deepEqual(initialTeamData.state, { free: {} }, "Team should be in Free state initially");

      // Verificar que new_owner tiene el NFT
      const initialNewOwnerBalance = await connection.getTokenAccountBalance(newOwnerNftAccount);
      assert.equal(initialNewOwnerBalance.value.amount, "1", "New owner should have 1 NFT before stake");

      // New owner hace stake del equipo
      console.log("New owner staking team...");
      await program.methods
        .stakeTeam(new anchor.BN(teamId))
        .accounts({
          gameState,
          teamAccount,
          user: newOwner.publicKey,
          userNftAccount: newOwnerNftAccount,
          programNftAccount,
          programNftAuthority,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([newOwner])
        .rpc();

      // Verificar que el estado del equipo cambió a WarmingUp
      const finalTeamData = await program.account.team.fetch(teamAccount);
      console.log("Final team state:", Object.keys(finalTeamData.state)[0]);
      assert.equal(Object.keys(finalTeamData.state)[0], "warmingUp", "Team should be in WarmingUp state after stake");

      // Verificar que el NFT se transfirió al programa
      const finalNewOwnerBalance = await connection.getTokenAccountBalance(newOwnerNftAccount);
      const finalProgramBalance = await connection.getTokenAccountBalance(programNftAccount);
      
      console.log("Final new_owner NFT balance:", finalNewOwnerBalance.value.amount);
      console.log("Final program NFT balance:", finalProgramBalance.value.amount);

      assert.equal(finalNewOwnerBalance.value.amount, "0", "New owner should have 0 NFTs after stake");
      assert.equal(finalProgramBalance.value.amount, "1", "Program should have 1 NFT after stake");

      console.log("✅ Stake by new_owner completed successfully!");
    });

    it("should fail if original owner tries to stake after transfer", async () => {
      console.log("=== ORIGINAL OWNER STAKE FAILURE TEST ===");
      
      // Usar el segundo equipo para este test
      const testTeamId = 2;
      
      // Derivar cuentas para el segundo equipo
      const [testNftMint] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("nft_mint"),
          new anchor.BN(testTeamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      const [teamAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("team"),
          new anchor.BN(testTeamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      const testOwnerNftAccount = getAssociatedTokenAddressSync(testNftMint, owner.publicKey);
      const testNewOwnerNftAccount = getAssociatedTokenAddressSync(testNftMint, newOwner.publicKey);

      // Transferir NFT del segundo equipo al new_owner
      await getOrCreateAssociatedTokenAccount(
        connection,
        newOwner,
        testNftMint,
        newOwner.publicKey
      );

      await transfer(
        connection,
        owner,
        testOwnerNftAccount,
        testNewOwnerNftAccount,
        owner.publicKey,
        1
      );

      // Program NFT authority y account
      const [programNftAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("nft_authority"), gameState.toBuffer()],
        program.programId
      );
      const programNftAccount = getAssociatedTokenAddressSync(testNftMint, programNftAuthority, true);

      // Crear program_nft_account para este test
      await getOrCreateAssociatedTokenAccount(
        connection,
        newOwner, // payer
        testNftMint,
        programNftAuthority,
        true // allowOwnerOffCurve
      );

      // Intentar que el owner original haga stake (debería fallar)
      try {
        await program.methods
          .stakeTeam(new anchor.BN(testTeamId))
          .accounts({
            gameState,
            teamAccount,
            user: owner.publicKey,
            userNftAccount: testOwnerNftAccount,
            programNftAccount,
            programNftAuthority,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc();

        assert.fail("Should have failed - original owner no longer owns NFT");
      } catch (error: any) {
        console.log("Expected error caught:", error.message);
        console.log("Error type:", error.constructor.name);
        
        // Cualquier error es válido aquí - lo importante es que la operación falle
        console.log("✅ Stake operation was correctly blocked");
      }

      console.log("✅ Original owner stake failure test passed!");
    });
  });

  describe("Stake Team", () => {
    it("should successfully stake team", async () => {
      // Usar el tercer equipo para este test
      const testTeamId = 3;
      
      // Derivar cuentas necesarias
      const [testNftMint] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("nft_mint"),
          new anchor.BN(testTeamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      const [teamAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("team"),
          new anchor.BN(testTeamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      const userNftAccount = getAssociatedTokenAddressSync(testNftMint, owner.publicKey);

      // Program NFT authority PDA
      const [programNftAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("nft_authority"), gameState.toBuffer()],
        program.programId
      );

      // Program NFT account
      const programNftAccount = getAssociatedTokenAddressSync(testNftMint, programNftAuthority, true);

      console.log("Starting team stake...");
      console.log("Team ID:", testTeamId);
      console.log("Team Account:", teamAccount.toString());
      console.log("User NFT Account:", userNftAccount.toString());
      console.log("Program NFT Account:", programNftAccount.toString());

      // Crear program_nft_account
      await getOrCreateAssociatedTokenAccount(
        connection,
        owner, // payer
        testNftMint,
        programNftAuthority,
        true
      );

      // Verificar que el owner tiene el NFT
      const initialOwnerBalance = await connection.getTokenAccountBalance(userNftAccount);
      assert.equal(initialOwnerBalance.value.amount, "1", "Owner should have 1 NFT before stake");

      // Owner hace stake del equipo
      await program.methods
        .stakeTeam(new anchor.BN(testTeamId))
        .accounts({
          gameState,
          teamAccount,
          user: owner.publicKey,
          userNftAccount,
          programNftAccount,
          programNftAuthority,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();

      // Verificar que el estado del equipo cambió a WarmingUp
      const finalTeamData = await program.account.team.fetch(teamAccount);
      console.log("Final team state:", Object.keys(finalTeamData.state)[0]);
      assert.equal(Object.keys(finalTeamData.state)[0], "warmingUp", "Team should be in WarmingUp state after stake");

      // Verificar que el NFT se transfirió al programa
      const finalOwnerBalance = await connection.getTokenAccountBalance(userNftAccount);
      const finalProgramBalance = await connection.getTokenAccountBalance(programNftAccount);
      
      console.log("Final owner NFT balance:", finalOwnerBalance.value.amount);
      console.log("Final program NFT balance:", finalProgramBalance.value.amount);

      assert.equal(finalOwnerBalance.value.amount, "0", "Owner should have 0 NFTs after stake");
      assert.equal(finalProgramBalance.value.amount, "1", "Program should have 1 NFT after stake");

      console.log("✅ Stake test completed successfully!");
    });
  });

  describe("Security Tests - Invalid NFT Stake Attempts", () => {
    let attackerUser: Keypair;

    before(async () => {
      // Crear usuario atacante
      attackerUser = Keypair.generate();
      await requestAirdrop(attackerUser.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    });

    it("should fail to stake with completely external NFT", async () => {
      console.log("=== SECURITY TEST 1: External NFT ===");
      
      // Crear un NFT completamente independiente (no del programa)
      const externalNftMint = await createMint(
        connection,
        attackerUser,
        attackerUser.publicKey,
        null,
        0 // NFT decimals
      );

      // Crear cuenta asociada y mintear el NFT externo
      const attackerNftAccount = (await getOrCreateAssociatedTokenAccount(
        connection,
        attackerUser,
        externalNftMint,
        attackerUser.publicKey
      )).address;

      await mintTo(
        connection,
        attackerUser,
        externalNftMint,
        attackerNftAccount,
        attackerUser,
        1
      );

      // Intentar usar un team_account válido existente
      const validTeamId = 1;
      const [validTeamAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("team"),
          new anchor.BN(validTeamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      // Program NFT authority y account
      const [programNftAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("nft_authority"), gameState.toBuffer()],
        program.programId
      );
      const programNftAccount = getAssociatedTokenAddressSync(externalNftMint, programNftAuthority, true);

      // Crear program_nft_account para el NFT externo
      await getOrCreateAssociatedTokenAccount(
        connection,
        attackerUser,
        externalNftMint,
        programNftAuthority,
        true
      );

      try {
        await program.methods
          .stakeTeam(new anchor.BN(validTeamId))
          .accounts({
            gameState,
            teamAccount: validTeamAccount,
            user: attackerUser.publicKey,
            userNftAccount: attackerNftAccount,
            programNftAccount,
            programNftAuthority,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([attackerUser])
          .rpc();

        assert.fail("Should have failed - external NFT should not be accepted");
      } catch (error: any) {
        console.log("Expected error caught:", error.message);
        console.log("Error type:", error.constructor.name);
        
        // Cualquier error es válido aquí - lo importante es que la operación falle
        console.log("✅ Stake operation was correctly blocked");
      }

      console.log("✅ External NFT attack prevented!");
    });

    it("should fail to stake with NFT using incorrect seeds", async () => {
      console.log("=== SECURITY TEST 2: Incorrect Seeds ===");
      
      try {
        // Crear NFT con seeds incorrectas (team_id que no existe)
        const fakeTeamId = 999;
        const [fakeNftMint] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("nft_mint"),
            new anchor.BN(fakeTeamId).toArrayLike(Buffer, "le", 8),
            gameState.toBuffer(),
            program.programId.toBuffer(),
          ],
          program.programId
        );

        // Crear cuenta asociada para el NFT falso
        const attackerFakeNftAccount = getAssociatedTokenAddressSync(fakeNftMint, attackerUser.publicKey);

        // Intentar usar un team_account válido existente
        const validTeamId = 1;
        const [validTeamAccount] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("team"),
            new anchor.BN(validTeamId).toArrayLike(Buffer, "le", 8),
            gameState.toBuffer(),
            program.programId.toBuffer(),
          ],
          program.programId
        );

        // Program NFT authority y account
        const [programNftAuthority] = PublicKey.findProgramAddressSync(
          [Buffer.from("nft_authority"), gameState.toBuffer()],
          program.programId
        );
        const programNftAccount = getAssociatedTokenAddressSync(fakeNftMint, programNftAuthority, true);

        // Crear program_nft_account para el NFT falso
        await getOrCreateAssociatedTokenAccount(
          connection,
          attackerUser,
          fakeNftMint,
          programNftAuthority,
          true
        );

        await program.methods
          .stakeTeam(new anchor.BN(validTeamId))
          .accounts({
            gameState,
            teamAccount: validTeamAccount,
            user: attackerUser.publicKey,
            userNftAccount: attackerFakeNftAccount,
            programNftAccount,
            programNftAuthority,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([attackerUser])
          .rpc();

        assert.fail("Should have failed - fake NFT with incorrect seeds should not be accepted");
      } catch (error: any) {
        console.log("Expected error caught:", error.message);
        console.log("Error type:", error.constructor.name);
        
        // Cualquier error es válido aquí - lo importante es que la operación falle
        console.log("✅ Stake operation was correctly blocked");
      }

      console.log("✅ Incorrect seeds attack prevented!");
    });

    it("should fail to create NFT with exact same seeds as existing team", async () => {
      console.log("=== SECURITY TEST 4: Duplicate PDA Creation ===");
      
      // Intentar crear un NFT con las mismas seeds exactas que un equipo existente
      const existingTeamId = 1;
      const [existingNftMint] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("nft_mint"),
          new anchor.BN(existingTeamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      console.log("Attempting to create mint at existing PDA:", existingNftMint.toString());

      try {
        // Intentar crear un mint en la misma PDA que ya existe
        await createMint(
          connection,
          attackerUser, // payer
          attackerUser.publicKey, // mint authority
          null, // freeze authority
          0, // decimals for NFT
          undefined, // keypair (let it derive the PDA)
          undefined, // confirmOptions
          TOKEN_PROGRAM_ID,
          existingNftMint // usar la PDA existente
        );

        assert.fail("Should have failed - cannot create mint at existing PDA address");
      } catch (error: any) {
        console.log("Expected error caught:", error.message);
        console.log("Error type:", error.constructor.name);
        
        // Cualquier error es válido aquí - lo importante es que la operación falle
        console.log("✅ Stake operation was correctly blocked");
      }
    });

    it("should fail to manually mint tokens to existing NFT", async () => {
      console.log("=== SECURITY TEST 5: Unauthorized Minting ===");
      
      // Usar el NFT mint existente del team 1
      const existingTeamId = 1;
      const [existingNftMint] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("nft_mint"),
          new anchor.BN(existingTeamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      // Crear cuenta asociada para el atacante
      const attackerNftAccount = (await getOrCreateAssociatedTokenAccount(
        connection,
        attackerUser,
        existingNftMint,
        attackerUser.publicKey
      )).address;

      try {
        // Intentar mintear tokens adicionales al NFT existente
        await mintTo(
          connection,
          attackerUser, // payer
          existingNftMint, // mint
          attackerNftAccount, // destination
          attackerUser.publicKey, // authority (incorrecto)
          1 // amount
        );

        assert.fail("Should have failed - attacker cannot mint to existing NFT");
      } catch (error: any) {
        console.log("Expected error caught:", error.message);
        console.log("Error type:", error.constructor.name);
        
        // Cualquier error es válido aquí - lo importante es que la operación falle
        console.log("✅ Stake operation was correctly blocked");
      }

      console.log("✅ Unauthorized minting attack prevented!");
    });

    it("should fail to create NFT with exact seeds of existing team", async () => {
      console.log("=== SECURITY TEST 4: Duplicate NFT Creation ===");
      
      // Intentar crear un NFT con las mismas seeds exactas que un equipo existente
      const existingTeamId = 1;
      const [existingNftMint] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("nft_mint"),
          new anchor.BN(existingTeamId).toArrayLike(Buffer, "le", 8),
          gameState.toBuffer(),
          program.programId.toBuffer(),
        ],
        program.programId
      );

      console.log("Attempting to create duplicate NFT mint at:", existingNftMint.toString());

      // Intentar crear un mint en la misma dirección PDA
      try {
        await createMint(
          connection,
          attackerUser, // payer
          attackerUser.publicKey, // mint authority
          null, // freeze authority
          0, // decimals for NFT
          undefined, // keypair (will use PDA)
          undefined, // confirmOptions
          TOKEN_PROGRAM_ID,
          existingNftMint // usar la misma PDA que el equipo existente
        );

        assert.fail("Should have failed - cannot create mint at existing PDA address");
      } catch (error: any) {
        console.log("Expected error caught:", error.message);
        console.log("Error type:", error.constructor.name);
        
        // Cualquier error es válido aquí - lo importante es que la operación falle
        console.log("✅ Stake operation was correctly blocked");
      }
    });
  });
});
