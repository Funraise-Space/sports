import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sports } from "../target/types/sports";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { assert } from "chai";
import * as bs58 from "bs58";

describe("simple_initialize", () => {
  // Configure the client to use devnet
  const connection = new Connection("https://api.devnet.solana.com", {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60000,
  });
  
  // Load owner wallet from environment variable (base58 format)
  const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;
  if (!ownerPrivateKey) {
    throw new Error("OWNER_PRIVATE_KEY environment variable is required (base58 format)");
  }
  
  const owner = Keypair.fromSecretKey(
    bs58.decode(ownerPrivateKey)
  );
  
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Sports as Program<Sports>;

  before(async () => {
    // Compilar y desplegar el programa en devnet antes de correr los tests, usando el owner como payer
    console.log("Compilando y desplegando el programa en devnet con el owner como payer...");
    const { execSync } = require("child_process");
    const fs = require("fs");
    // Guardar temporalmente la clave privada del owner en un archivo
    const ownerKeypairPath = "/tmp/owner-keypair.json";
    fs.writeFileSync(ownerKeypairPath, JSON.stringify(Array.from(owner.secretKey)));
    try {
      execSync("anchor build", { stdio: "inherit" });
      execSync(`anchor deploy --provider.cluster devnet --provider.wallet ${ownerKeypairPath}`, { stdio: "inherit" });
      console.log("✅ Programa desplegado en devnet con el owner como payer");
    } catch (e) {
      console.error("❌ Error al compilar/desplegar el programa:", e);
      throw e;
    } finally {
      // Eliminar el archivo temporal
      fs.unlinkSync(ownerKeypairPath);
    }
  });

  it("should initialize game state", async () => {
    console.log("Starting simple initialize test on devnet...");
    console.log("Owner wallet:", owner.publicKey.toString());
    
    // Check owner balance
    const ownerBalance = await provider.connection.getBalance(owner.publicKey);
    console.log("Owner balance:", ownerBalance / anchor.web3.LAMPORTS_PER_SOL, "SOL");
    
    if (ownerBalance < 0.1 * anchor.web3.LAMPORTS_PER_SOL) {
      throw new Error(`Owner balance too low: ${ownerBalance / anchor.web3.LAMPORTS_PER_SOL} SOL. Please fund the wallet.`);
    }

    // Usar owner como autoridad de mint y update, sin pedir airdrop
    const mintAuthority = owner;
    const updateAuthority = owner;

    // Crear el mint usando el owner como autoridad
    const mintUsdc = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );
    console.log("USDC mint created:", mintUsdc.toString());

    // Game state PDA con semilla única para evitar conflictos en Devnet
    const uniqueSeed = Buffer.from((Date.now() + Math.random()).toString());
    const [gameState] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_state"), uniqueSeed, program.programId.toBuffer()],
      program.programId
    );
    console.log("Game state PDA:", gameState.toString());

    // Parámetros de initialize
    const teamPriceA = new anchor.BN(10_000_000); // $10
    const teamPriceB = new anchor.BN(15_000_000); // $15
    const teamPriceC = new anchor.BN(20_000_000); // $20
    const nftImageUrl = "https://example.com/team-image.jpg";

    console.log("Calling initialize...");
    console.log("Parameters:");
    console.log("  - owner:", owner.publicKey.toString());
    console.log("  - gameState:", gameState.toString());
    console.log("  - mintUsdc:", mintUsdc.toString());
    console.log("  - updateAuthority:", updateAuthority.publicKey.toString());

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
          user: owner.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      
      console.log("✅ Initialize successful! TX:", tx);
      
      // Verificar que el game state se creó
      const gameStateData = await program.account.gameState.fetch(gameState);
      console.log("Game state data:", {
        owner: gameStateData.owner.toString(),
        mintUsdc: gameStateData.mintUsdc.toString(),
        nftUpdateAuthority: gameStateData.nftUpdateAuthority.toString(),
      });
      
      assert.equal(gameStateData.owner.toString(), owner.publicKey.toString());
      assert.equal(gameStateData.mintUsdc.toString(), mintUsdc.toString());
      assert.equal(gameStateData.nftUpdateAuthority.toString(), updateAuthority.publicKey.toString());
      
    } catch (e: any) {
      console.error('❌ Initialize failed:', e);
      if (e.logs) {
        console.error('Transaction logs:', e.logs);
      }
      throw e;
    }
  });
});