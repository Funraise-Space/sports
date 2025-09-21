import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { Sports } from "../target/types/sports";
import * as bs58 from "bs58";

async function main() {
  // Configurar conexión
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60000,
  });

  // Cargar wallet (opcional): usar SOLANA_PRIVATE_KEY o fallback a AnchorProvider.env
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  let provider: anchor.AnchorProvider;
  if (privateKey) {
    const wallet = new anchor.Wallet(anchor.web3.Keypair.fromSecretKey(bs58.decode(privateKey)));
    provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  } else {
    provider = anchor.AnchorProvider.env();
  }
  anchor.setProvider(provider);

  // Obtener Program (workspace por defecto; opcionalmente validar SPORTS_PROGRAM_ID)
  const program = anchor.workspace.sports as Program<Sports>;
  const sportsProgramId = process.env.SPORTS_PROGRAM_ID;
  if (sportsProgramId) {
    const expected = new PublicKey(sportsProgramId);
    if (!program.programId.equals(expected)) {
      throw new Error(`SPORTS_PROGRAM_ID (${expected.toBase58()}) no coincide con workspace (${program.programId.toBase58()})`);
    }
  }

  // player_id (u16)
  const playerIdStr = 8;
  if (!playerIdStr) throw new Error("Falta PLAYER_ID (u16)");
  const playerId = Number(playerIdStr);
  if (!Number.isInteger(playerId) || playerId < 0 || playerId > 65535) throw new Error("PLAYER_ID inválido (u16)");

  // Derivar GameState PDA (mismo método que en scripts/initialize.ts)
  const [gameState] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_state"), program.programId.toBuffer()],
    program.programId
  );

  // Leer game_state para time_lock
  const gameStateAcc = await program.account.gameState.fetch(gameState) as any;
  const timeLock: number = Number(gameStateAcc.timeLock); // i64

  // Timestamp actual (aprox on-chain)
  const slot = await connection.getSlot("confirmed");
  const nowTs = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);

  // Leer todas las cuentas Team y TeamStakeState
  const allTeams = await program.account.team.all();
  const allStakeStates = await program.account.teamStakeState.all();

  // Índice team_id -> stakeState (si existe)
  const teamIdToStake = new Map<string, any>();
  for (const { account } of allStakeStates) {
    const tid = (account as any).teamId as anchor.BN;
    teamIdToStake.set(tid.toString(), account);
  }

  // Filtrar equipos que incluyen al playerId
  type TeamReport = {
    teamId: string;
    state: string;
    readyToOnField: boolean;
    transitionTimestamp: number;
    timeElapsed: number;
    owner: string;
  };

  const onField: TeamReport[] = [];
  const warmingUpReady: TeamReport[] = [];

  for (const { publicKey, account } of allTeams) {
    const playerIds: number[] = (account as any).playerIds.map((bn: anchor.BN) => Number(bn));
    if (!playerIds.includes(playerId)) continue;

    const state = (account as any).state as { [k: string]: {} };
    const stateName = Object.keys(state)[0];
    const teamId = (account as any).teamId as anchor.BN;
    const transitionTs = Number((account as any).transitionTimestamp);

    // Dueño actual
    let ownerPk: PublicKey;
    if (stateName === "Free") {
      ownerPk = (account as any).firstBuyer as PublicKey;
    } else {
      const stake = teamIdToStake.get(teamId.toString());
      if (stake) ownerPk = (stake as any).user as PublicKey;
      else ownerPk = (account as any).firstBuyer as PublicKey; // fallback
    }

    const elapsed = nowTs - transitionTs;

    if (stateName === "OnField") {
      onField.push({
        teamId: teamId.toString(),
        state: stateName,
        readyToOnField: true,
        transitionTimestamp: transitionTs,
        timeElapsed: elapsed,
        owner: ownerPk.toBase58(),
      });
    }

    if (stateName === "WarmingUp") {
      const ready = elapsed >= timeLock;
      if (ready) {
        warmingUpReady.push({
          teamId: teamId.toString(),
          state: stateName,
          readyToOnField: true,
          transitionTimestamp: transitionTs,
          timeElapsed: elapsed,
          owner: ownerPk.toBase58(),
        });
      }
    }
  }

  // Salida
  console.log("Reporte por PLAYER_ID=", playerId);
  console.log("time_lock(s):", timeLock);
  console.log("\nEquipos en OnField (propietario actual):");
  if (onField.length === 0) console.log("- Ninguno");
  for (const t of onField) {
    console.log(`- Team ${t.teamId} | owner=${t.owner} | since_ts=${t.transitionTimestamp} | elapsed=${t.timeElapsed}s`);
  }

  console.log("\nWarmingUp listos para pasar a OnField:");
  if (warmingUpReady.length === 0) console.log("- Ninguno");
  for (const t of warmingUpReady) {
    console.log(`- Team ${t.teamId} | owner=${t.owner} | since_ts=${t.transitionTimestamp} | elapsed=${t.timeElapsed}s (>= ${timeLock}s)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
