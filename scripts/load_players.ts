import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sports } from "../target/types/sports";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import * as bs58 from "bs58";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Cargar variables de entorno
dotenv.config();

// Enum para categorías de jugadores - debe coincidir con el contrato Rust
const PlayerCategory = {
  Bronze: { bronze: {} },
  Silver: { silver: {} }, 
  Gold: { gold: {} }
};

// Interface para los datos del CSV
interface PlayerCSVData {
  token_id_Slice: string;
  Name: string;
  Sport: string;
  Country: string;
  Stock: string;
  Rarity: string;
  Rank: string;
  "IPFS CARD": string;
  "IPFS  NFT Portada": string;
  Token_provider_id: string;
}

// Función para parsear CSV
function parseCSV(csvContent: string): PlayerCSVData[] {
  const lines = csvContent.trim().split('\n');
  const headers = lines[0].split(',');
  
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const player: any = {};
    
    headers.forEach((header, index) => {
      player[header.trim()] = values[index]?.trim() || '';
    });
    
    return player as PlayerCSVData;
  });
}

// Función para mapear rareza del CSV a PlayerCategory
function mapRarityToCategory(rarity: string): any {
  switch (rarity.toLowerCase()) {
    case 'bronze':
      return PlayerCategory.Bronze;
    case 'silver':
      return PlayerCategory.Silver;
    case 'gold':
      return PlayerCategory.Gold;
    default:
      console.warn(`Rareza desconocida: ${rarity}, usando Bronze por defecto`);
      return PlayerCategory.Bronze;
  }
}

async function loadPlayersFromCSV() {
  console.log("🚀 Cargando jugadores desde CSV...");

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
    throw new Error("❌ OWNER_PRIVATE_KEY requerida en formato base58");
  }

  const owner = Keypair.fromSecretKey(bs58.decode(ownerPrivateKey));
  console.log("👤 Owner wallet:", owner.publicKey.toString());

  // Verificar balance del owner
  const ownerBalance = await connection.getBalance(owner.publicKey);
  console.log("💰 Balance del owner:", ownerBalance / anchor.web3.LAMPORTS_PER_SOL, "SOL");

  if (ownerBalance < 0.5 * anchor.web3.LAMPORTS_PER_SOL) {
    throw new Error(`❌ Balance insuficiente: ${ownerBalance / anchor.web3.LAMPORTS_PER_SOL} SOL. Necesitas al menos 0.5 SOL para crear múltiples jugadores.`);
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
  console.log("📋 Program ID:", program.programId.toString());

  // Generar PDA del game state
  const [gameState] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_state"), program.programId.toBuffer()],
    program.programId
  );
  console.log("🎮 Game State PDA:", gameState.toString());

  try {
  // Verificar que el game state existe
  const gameStateAccountInfo = await connection.getAccountInfo(gameState);
  if (!gameStateAccountInfo) {
    throw new Error("Game state no encontrado. Ejecuta initialize primero.");
  }
    console.log("✅ Game State encontrado");

    // Leer archivo CSV
    const csvPath = path.join(__dirname, "../data/players.csv");
    if (!fs.existsSync(csvPath)) {
      throw new Error(`❌ Archivo CSV no encontrado: ${csvPath}`);
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const playersData = parseCSV(csvContent);
    console.log(`📊 ${playersData.length} jugadores encontrados en CSV`);

    let successCount = 0;
    let errorCount = 0;

    // Procesar jugadores uno por uno
    for (let i = 0; i < playersData.length; i++) {
      const playerData = playersData[i];
      
      try {
        console.log(`\n🔄 Procesando jugador ${i + 1}/${playersData.length}: ${playerData.Name}`);

        // Mapear datos del CSV a parámetros del contrato
        const providerId = parseInt(playerData.Token_provider_id);
        const category = mapRarityToCategory(playerData.Rarity);
        const totalTokens = parseInt(playerData.Stock.replace(/[.,]/g, ''));
        const metadataUri = playerData["IPFS CARD"] || null;
        const name = playerData.Name;
        const discipline = playerData.Sport;
        const country = playerData.Country;

        console.log(`   - Categoría: ${JSON.stringify(category)}`);
        console.log(`   - Tokens: ${totalTokens}`);
        console.log(`   - Disciplina: ${discipline}`);
        console.log(`   - País: ${country}`);
        console.log(`   - Provider ID: ${providerId}`);

        // Obtener el next_player_id actual
        // Usar índice del loop como player ID (simplificado)
        const playerId = i + 1;

        // Generar PDA para el jugador usando las seeds correctas del contrato
        // Seeds: [b"player", player_id.to_le_bytes().as_ref(), game_state.key().as_ref(), crate::ID.as_ref()]
        const playerIdBuffer = Buffer.alloc(2);
        playerIdBuffer.writeUInt16LE(playerId, 0);
        
        const [playerAccount] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("player"),
            playerIdBuffer,
            gameState.toBuffer(),
            program.programId.toBuffer()
          ],
          program.programId
        );

        // Crear jugador
        const tx = await program.methods
          .createPlayer(
            providerId,
            category,
            totalTokens,
            metadataUri,
            name,
            discipline,
            country
          )
          .accounts({
            gameState,
            playerAccount,
            user: owner.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();

        console.log(`✅ Jugador ${name} creado exitosamente (ID: ${playerId})`);
        console.log(`   Transaction: ${tx}`);
        successCount++;

        // Pequeña pausa para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error: any) {
        console.error(`❌ Error creando jugador ${playerData.Name}:`, error.message);
        if (error.logs) {
          console.error("📋 Transaction logs:", error.logs);
        }
        errorCount++;
        
        // Si hay muchos errores consecutivos, parar
        if (errorCount > 5 && successCount === 0) {
          throw new Error("Demasiados errores consecutivos, deteniendo carga");
        }
      }
    }

    console.log("\n🎉 ¡Carga de jugadores completada!");
    console.log(`✅ Jugadores creados exitosamente: ${successCount}`);
    console.log(`❌ Errores: ${errorCount}`);
    console.log(`📊 Total procesados: ${playersData.length}`);

    // Verificar estado final
    const finalGameStateInfo = await connection.getAccountInfo(gameState);
    console.log(`✅ Game state verificado al final`);

    return {
      totalProcessed: playersData.length,
      successCount,
      errorCount,
      finalPlayerId: playersData.length,
    };

  } catch (error: any) {
    console.error("❌ Error durante carga de jugadores:", error);
    if (error.logs) {
      console.error("📋 Transaction logs:", error.logs);
    }
    throw error;
  }
}

// Ejecutar script si se llama directamente
if (require.main === module) {
  loadPlayersFromCSV()
    .then((result) => {
      console.log("\n🎉 ¡Carga completada exitosamente!");
      console.log(`📊 Resumen: ${result.successCount}/${result.totalProcessed} jugadores creados`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Error en carga de jugadores:", error);
      process.exit(1);
    });
}

export { loadPlayersFromCSV };
