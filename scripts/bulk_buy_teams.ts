import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Connection, TransactionInstruction, Transaction, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as dotenv from "dotenv";
import * as bs58 from "bs58";
import fs from "fs";

dotenv.config();

// Util: crear ix buy_team manual (coincide con useSportsProgram.ts)
function createBuyTeamInstruction(packId: number): Buffer {
  // Discriminator sha256("global:buy_team")[0:8] => [214,130,38,71,24,33,31,15]
  const discriminator = Buffer.from([214, 130, 38, 71, 24, 33, 31, 15]);
  const packageBuffer = Buffer.alloc(1);
  packageBuffer.writeUInt8(packId, 0); // 0=A,1=B,2=C
  const acceptTermsBuffer = Buffer.alloc(1);
  acceptTermsBuffer.writeUInt8(1, 0); // true
  return Buffer.concat([discriminator, packageBuffer, acceptTermsBuffer]);
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });

  const ownerPk = process.env.OWNER_PRIVATE_KEY;
  if (!ownerPk) throw new Error("OWNER_PRIVATE_KEY requerido (base58)");
  const owner = anchor.web3.Keypair.fromSecretKey(bs58.decode(ownerPk));

  const programIdStr = process.env.SPORTS_PROGRAM_ID;
  if (!programIdStr) throw new Error("SPORTS_PROGRAM_ID requerido");
  const programId = new PublicKey(programIdStr);

  const count = Number(process.env.BULK_COUNT || 1000);
  const pack = String(process.env.BULK_PACK || "A").toUpperCase(); // A|B|C
  const packId = pack === "A" ? 0 : pack === "B" ? 1 : 2;

  // PDAs
  const [gameState] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_state"), programId.toBuffer()],
    programId
  );

  console.log(`Buying ${count} teams (pack ${pack})`);
  console.log("Program:", programId.toBase58());
  console.log("GameState:", gameState.toBase58());

  // Direcciones de programas
  const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(process.env.MPL_METADATA_PROGRAM_ID || "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const CHAINLINK_SOL_USD_FEED = new PublicKey(process.env.CHAINLINK_SOL_USD_FEED || "99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR");
  const CHAINLINK_PROGRAM_ID = new PublicKey(process.env.CHAINLINK_PROGRAM_ID || "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");

  // Leer next_team_id y campos necesarios del GameState
  const gsInfo = await connection.getAccountInfo(gameState);
  if (!gsInfo) throw new Error("GameState no encontrado");
  const data = gsInfo.data;
  let off = 8 + 32; // disc + owner
  const staffLen = data.readUInt32LE(off); off += 4 + staffLen * 32;
  const playersLen = data.readUInt32LE(off); off += 4 + playersLen * 7; // PlayerSummary SIZE=7
  off += 2; // next_player_id
  const mintUsdc = new PublicKey(data.slice(off, off + 32)); off += 32;
  off += 24; // prices
  let nextTeamId = Number(data.readBigUInt64LE(off)); off += 8;
  off += 8; // next_reward_id
  const updateAuthority = new PublicKey(data.slice(off, off + 32)); off += 32;

  // PDAs helpers
  const getTeamPDA = (teamId: number) => {
    const tid = new anchor.BN(teamId).toArrayLike(Buffer, 'le', 8);
    return PublicKey.findProgramAddressSync([
      Buffer.from('team'), tid, gameState.toBuffer(), programId.toBuffer()
    ], programId)[0];
  };
  const getNftMintPDA = (teamId: number) => {
    const tid = new anchor.BN(teamId).toArrayLike(Buffer, 'le', 8);
    return PublicKey.findProgramAddressSync([
      Buffer.from('nft_mint'), tid, gameState.toBuffer(), programId.toBuffer()
    ], programId)[0];
  };
  const getUsdcAuthorityPDA = () => PublicKey.findProgramAddressSync([
    Buffer.from('usdc_authority'), gameState.toBuffer()
  ], programId)[0];

  const programUsdcAuthority = getUsdcAuthorityPDA();

  const batchSize = Number(process.env.BULK_BATCH || 1);
  const totalBatches = Math.ceil(count / batchSize);

  for (let b = 0; b < totalBatches; b++) {
    const start = b * batchSize;
    const end = Math.min(count, start + batchSize);
    const tx = new Transaction();

    // compute budget
    const cu = Buffer.alloc(4);
    cu.writeUInt32LE(400000, 0);
    tx.add(new TransactionInstruction({
      keys: [],
      programId: new PublicKey("ComputeBudget111111111111111111111111111111"),
      data: Buffer.concat([Buffer.from([2]), cu])
    }));

    for (let i = start; i < end; i++) {
      const teamId = nextTeamId; // usar y luego incrementar
      const teamAccount = getTeamPDA(teamId);
      const nftMint = getNftMintPDA(teamId);
      const metadataPda = PublicKey.findProgramAddressSync([
        Buffer.from('metadata'), MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(), nftMint.toBuffer()
      ], MPL_TOKEN_METADATA_PROGRAM_ID)[0];

      // Asegurar ATAs existentes (crea con el programa correcto de forma segura)
      const userUsdc = await getOrCreateAssociatedTokenAccount(
        connection,
        owner,
        mintUsdc,
        owner.publicKey,
        false
      );
      const programUsdc = await getOrCreateAssociatedTokenAccount(
        connection,
        owner,
        mintUsdc,
        programUsdcAuthority,
        true
      );
      // Para el NFT, NO crear ATA antes porque el mint aún no existe.
      // Solo derivar la dirección y dejar que el programa la inicialice si corresponde.
      const userNftAddr = await getAssociatedTokenAddress(nftMint, owner.publicKey);

      const buyIx = new TransactionInstruction({
        keys: [
          { pubkey: gameState, isSigner: false, isWritable: true },
          { pubkey: teamAccount, isSigner: false, isWritable: true },
          { pubkey: owner.publicKey, isSigner: true, isWritable: true },
          { pubkey: userUsdc.address, isSigner: false, isWritable: true },
          { pubkey: programUsdc.address, isSigner: false, isWritable: true },
          { pubkey: programUsdcAuthority, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: nftMint, isSigner: false, isWritable: true },
          { pubkey: metadataPda, isSigner: false, isWritable: true },
          { pubkey: userNftAddr, isSigner: false, isWritable: true },
          { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: updateAuthority, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: CHAINLINK_SOL_USD_FEED, isSigner: false, isWritable: false },
          { pubkey: CHAINLINK_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId,
        data: createBuyTeamInstruction(packId),
      });
      tx.add(buyIx);

      nextTeamId += 1; // anticipar siguiente
    }

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = owner.publicKey;
    const sig = await anchor.web3.sendAndConfirmTransaction(connection, tx, [owner], { commitment: 'confirmed' });
    console.log(`Batch ${b + 1}/${totalBatches} tx:`, sig);
  }

  console.log("✅ Bulk buy complete");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export {};


