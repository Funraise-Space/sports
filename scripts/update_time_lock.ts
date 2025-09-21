import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sports } from "../target/types/sports";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import * as bs58 from "bs58";
import * as dotenv from "dotenv";

// Cargar variables de entorno
dotenv.config();

async function updateTimeLock() {
  console.log("🔧 Actualizando time_lock del contrato...");

  // Configurar conexión
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000,
    }
  );

  // Cargar wallet del owner desde variable de entorno
  const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;
  if (!ownerPrivateKey) {
    throw new Error("OWNER_PRIVATE_KEY requerida en formato base58");
  }

  const owner = Keypair.fromSecretKey(bs58.decode(ownerPrivateKey));
  console.log("Owner wallet:", owner.publicKey.toString());

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

  // Cargar programa
  const programId = new PublicKey(process.env.SPORTS_PROGRAM_ID!);
  const program = anchor.workspace.Sports as Program<Sports>;

  // Derivar GameState PDA
  const [gameState] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_state"), programId.toBuffer()],
    programId
  );

  console.log("GameState PDA:", gameState.toString());

  try {
    // Verificar estado actual
    const currentGameState = await program.account.gameState.fetch(gameState);
    console.log("Time lock actual:", currentGameState.timeLock.toString(), "segundos");

    // Nuevo valor de time_lock
    const newTimeLock = new anchor.BN(parseInt(process.env.DEFAULT_TIME_LOCK || "180"));
    console.log("Nuevo time lock:", newTimeLock.toString(), "segundos");

    if (currentGameState.timeLock.eq(newTimeLock)) {
      console.log("✅ El time_lock ya tiene el valor correcto");
      return;
    }

    // Actualizar time_lock usando la nueva función del contrato
    console.log("Actualizando time_lock...");
    const tx = await program.methods
      .updateTimeLock(newTimeLock)
      .accountsPartial({
        gameState,
        user: owner.publicKey,
      })
      .rpc();

    console.log("✅ Time lock actualizado exitosamente!");
    console.log("Transaction:", tx);

    // Verificar cambio
    const updatedGameState = await program.account.gameState.fetch(gameState);
    console.log("Time lock actualizado:", updatedGameState.timeLock.toString(), "segundos");

  } catch (error) {
    console.error("❌ Error actualizando time_lock:", error);
    throw error;
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  updateTimeLock()
    .then(() => {
      console.log("✅ Script completado exitosamente");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error en el script:", error);
      process.exit(1);
    });
}

export { updateTimeLock };
