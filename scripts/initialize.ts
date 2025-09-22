import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sports } from "../target/types/sports";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import * as bs58 from "bs58";
import * as dotenv from "dotenv";
import fs from "fs";

// Cargar variables de entorno
dotenv.config();

async function initializeSportsContract() {
  console.log(" Inicializando contrato de Sports...");

  // Configurar conexión
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60000,
  });

  // Cargar wallet del owner desde variable de entorno
  const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;
  if (!ownerPrivateKey) {
    throw new Error("OWNER_PRIVATE_KEY requerida en formato base58");
  }

  const owner = Keypair.fromSecretKey(bs58.decode(ownerPrivateKey));
  console.log("Owner wallet:", owner.publicKey.toString());

  // Verificar balance del owner
  const ownerBalance = await connection.getBalance(owner.publicKey);
  console.log("Balance del owner:", ownerBalance / anchor.web3.LAMPORTS_PER_SOL, "SOL");

  if (ownerBalance < 0.1 * anchor.web3.LAMPORTS_PER_SOL) {
    throw new Error(`Balance insuficiente: ${ownerBalance / anchor.web3.LAMPORTS_PER_SOL} SOL. Necesitas al menos 0.1 SOL.`);
  }

  // Configurar provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(owner),
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }
  );
  anchor.setProvider(provider);

  // Definir Program ID desde variable de entorno
  const programIdStr = process.env.SPORTS_PROGRAM_ID;
  if (!programIdStr) throw new Error("SPORTS_PROGRAM_ID no está definida.");
  const programId = new PublicKey(programIdStr);

  // Cargar IDL simplificado
  const idlPath = "scripts/sports_idl.json";
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  // Crear programa
  const program = new (anchor.Program as any)(idl, programId, provider);
  console.log("Program ID:", program.programId.toString());

  try {
    let tx: string | null = null;

    // Crear USDC mint si no existe
    let mintUsdc: PublicKey;
    const existingUsdcMint = process.env.USDC_MINT;
    
    if (existingUsdcMint) {
      mintUsdc = new PublicKey(existingUsdcMint);
      console.log("Usando USDC mint existente:", mintUsdc.toString());
    } else {
      console.log("Creando nuevo USDC mint...");
      mintUsdc = await createMint(
        connection,
        owner,
        owner.publicKey,
        null,
        6 // USDC decimales
      );
      console.log("USDC mint creado:", mintUsdc.toString());
    }

    // Generar PDA correcto para game state
    const [gameState] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_state"), program.programId.toBuffer()],
      program.programId
    );
    console.log("Game State PDA:", gameState.toString());

    // Verificar si el game state ya existe
    const gameStateAccountInfo = await connection.getAccountInfo(gameState);

    if (!gameStateAccountInfo) {
      console.log("⚠️ Game State no existe, ejecutando initialize...");
      // Configurar parámetros de inicialización
      const teamPriceA = new anchor.BN(
        parseInt(process.env.TEAM_PRICE_A || "10000000") // $10 USD
      );
      const teamPriceB = new anchor.BN(
        parseInt(process.env.TEAM_PRICE_B || "15000000") // $15 USD
      );
      const teamPriceC = new anchor.BN(
        parseInt(process.env.TEAM_PRICE_C || "20000000") // $20 USD
      );
      const nftImageUrl = process.env.NFT_IMAGE_URL || "https://nft.funraise.space";
      const updateAuthority = owner.publicKey;
      const timeLock = new anchor.BN(parseInt(process.env.DEFAULT_TIME_LOCK || "2"));

      console.log(" Parámetros de inicialización:");
      console.log("   - Precio Pack A:", teamPriceA.toString(), "micro USDC ($10)");
      console.log("   - Precio Pack B:", teamPriceB.toString(), "micro USDC ($15)");
      console.log("   - Precio Pack C:", teamPriceC.toString(), "micro USDC ($20)");
      console.log("   - NFT Image URL:", nftImageUrl);
      console.log("   - Update Authority:", updateAuthority.toString());
      console.log("   - Time Lock:", timeLock.toString(), "segundos");

      // Ejecutar initialize
      console.log("Ejecutando initialize...");
      tx = await program.methods
        .initialize(
          teamPriceA,
          teamPriceB,
          teamPriceC,
          mintUsdc,
          updateAuthority,
          nftImageUrl,
          timeLock
        )
        .accounts({ 
          gameState,
          user: owner.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      console.log("✅ Initialize exitoso!");
      console.log("Transaction:", tx);
    } else {
      console.log("✅ Game State ya existe, saltando initialize.");
    }

    // Verificar estado del juego
    const gameStateData = await connection.getAccountInfo(gameState);
    if (!gameStateData) {
      throw new Error("Game state no se pudo crear");
    }
    console.log("Game state size:", gameStateData.data.length);
    console.log("\nEstado del juego verificado exitosamente.");

    // Crear program_usdc_account si no existe
    console.log("\n Verificando program_usdc_account...");
    
    // Generar program_usdc_authority PDA
    const [programUsdcAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc_authority"), gameState.toBuffer()],
      program.programId
    );
    console.log("Program USDC Authority:", programUsdcAuthority.toString());

    // Calcular program_usdc_account (Associated Token Account)
    const programUsdcAccount = PublicKey.findProgramAddressSync(
      [
        programUsdcAuthority.toBuffer(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
        mintUsdc.toBuffer(),
      ],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    )[0];
    console.log("Program USDC Account:", programUsdcAccount.toString());

    // Verificar si ya existe
    const accountInfo = await connection.getAccountInfo(programUsdcAccount);
    if (!accountInfo) {
      console.log(" Program USDC Account no existe, creando...");
      
      // Crear instrucción para Associated Token Account
      const createATAIx = new anchor.web3.TransactionInstruction({
        keys: [
          { pubkey: owner.publicKey, isSigner: true, isWritable: true }, // payer
          { pubkey: programUsdcAccount, isSigner: false, isWritable: true }, // associated token account
          { pubkey: programUsdcAuthority, isSigner: false, isWritable: false }, // owner
          { pubkey: mintUsdc, isSigner: false, isWritable: false }, // mint
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
          { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        programId: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        data: Buffer.alloc(0),
      });
      
      const createATATx = new anchor.web3.Transaction().add(createATAIx);
      const createATASignature = await provider.sendAndConfirm(createATATx);
      console.log(" Program USDC Account creado:", createATASignature);
    } else {
      console.log(" Program USDC Account ya existe");
    }

    // Mostrar información para el frontend
    console.log("\nVariables para el frontend (.env.local):");
    console.log(`NEXT_PUBLIC_SPORTS_PROGRAM_ID=${program.programId.toString()}`);
    console.log(`NEXT_PUBLIC_USDC_MINT=${mintUsdc.toString()}`);
    console.log(`NEXT_PUBLIC_GAME_STATE=${gameState.toString()}`);

    return {
      programId: program.programId,
      gameState,
      mintUsdc,
      owner: owner.publicKey,
      transaction: tx,
    };

  } catch (error: any) {
    console.error("Error durante initialize:", error);
    if (error.logs) {
      console.error("Transaction logs:", error.logs);
    }
    throw error;
  }
}

// Ejecutar script si se llama directamente
if (require.main === module) {
  initializeSportsContract()
    .then((result) => {
      console.log("\n¡Inicialización completada exitosamente!");
      console.log("Program ID:", result.programId.toString());
      console.log("Game State:", result.gameState.toString());
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nError en inicialización:", error);
      process.exit(1);
    });
}

export { initializeSportsContract };
