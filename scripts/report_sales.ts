import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { Sports } from "../target/types/sports";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as bs58 from "bs58";

dotenv.config();

type TeamAccount = any;
type PlayerAccount = any;

type TeamPkg = "A" | "B" | "C";

type TeamStateStr = "Free" | "WarmingUp" | "OnField" | "ToWithdraw" | string;

function mapPackage(cat: any): TeamPkg {
  // Anchor enum puede venir como { a: {} } o como número; intentar varias formas
  if (typeof cat === "object" && cat !== null) {
    if ("a" in cat) return "A";
    if ("b" in cat) return "B";
    if ("c" in cat) return "C";
  }
  if (typeof cat === "number") {
    return (['A', 'B', 'C'][cat] as TeamPkg) || 'A';
  }
  if (typeof cat === "string") {
    const s = cat.toLowerCase();
    if (s.includes("a")) return "A";
    if (s.includes("b")) return "B";
    if (s.includes("c")) return "C";
  }
  return "A";
}

function mapState(s: any): TeamStateStr {
  if (typeof s === "object" && s !== null) {
    if ("free" in s) return "Free";
    if ("warmingUp" in s) return "WarmingUp";
    if ("onField" in s) return "OnField";
    if ("toWithdraw" in s) return "ToWithdraw";
  }
  if (typeof s === "number") {
    return (["Free", "WarmingUp", "OnField", "ToWithdraw"][s] as TeamStateStr) || `${s}`;
  }
  if (typeof s === "string") return s;
  return "Unknown";
}

function tsToIso(ts: number | anchor.BN | undefined): string {
  let n: number | undefined = undefined;
  if (typeof ts === "number") n = ts;
  else if (ts && typeof (ts as any).toNumber === "function") n = (ts as any).toNumber();
  if (!n) return "-";
  try { return new Date(n * 1000).toISOString(); } catch { return `${n}`; }
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });

  // Wallet para provider (solo lectura). Si no hay llave, usar un Keypair efímero
  const ownerPriv = process.env.OWNER_PRIVATE_KEY;
  const wallet = ownerPriv ? Keypair.fromSecretKey(bs58.decode(ownerPriv)) : Keypair.generate();

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Sports as Program<Sports>;
  console.log("Program:", program.programId.toString());

  // Derivar GameState PDA
  const [gameStatePda] = PublicKey.findProgramAddressSync([
    Buffer.from("game_state"),
    program.programId.toBuffer(),
  ], program.programId);

  // Intentar fetch de GameState
  let gameState: any | null = null;
  try {
    gameState = await program.account.gameState.fetch(gameStatePda);
  } catch {}

  if (gameState) {
    console.log("GameState:", gameStatePda.toString());
    console.log("  Owner:", gameState.owner?.toString?.() || "-");
    console.log("  USDC Mint:", gameState.mintUsdc?.toString?.() || "-");
    console.log("  Current report:", gameState.currentReportId?.toString?.() || "-");
    console.log("  Current revenue (microUSDC):", gameState.currentReportRevenue?.toString?.() || "-");
    console.log("  Current teams sold:", gameState.currentReportTeams?.toString?.() || "-");
    console.log("  Current tokens sold:", gameState.currentReportTokens?.toString?.() || "-");
  } else {
    console.log("GameState not found at:", gameStatePda.toString());
  }

  console.log("\n============================================================");
  console.log("================== Fetching Teams (sales) =================");
  console.log("============================================================\n");
  const teamAccounts = await program.account.team.all();
  console.log(`Total team accounts: ${teamAccounts.length}`);
  const salesCsvRows: string[] = [];
  const salesCsvHeader = [
    "team_id",
    "buyer",
    "package",
    "state",
    "created_at",
    "transition_at",
    "nft_mint",
    "terms_accepted",
    "players",
  ];
  salesCsvRows.push(salesCsvHeader.join(","));

  // Fetch all players to map names by id
  console.log("\n============================================================");
  console.log("==================== Fetching Players =====================");
  console.log("============================================================\n");
  const playerAccounts = await program.account.player.all();
  console.log(`Total player accounts: ${playerAccounts.length}`);
  const playerById = new Map<number, { 
    id: number;
    name: string; 
    total: number; 
    sold: number; 
    available: number; 
    category: string;
    providerId?: number;
    discipline?: string;
    country?: string;
    metadataUri?: string | null;
  }>();
  const stockCsvRows: string[] = [];
  const stockCsvHeader = [
    "player_id",
    "name",
    "category",
    "provider_id",
    "discipline",
    "country",
    "total_tokens",
    "tokens_sold",
    "tokens_available",
    "metadata_uri",
  ];
  stockCsvRows.push(stockCsvHeader.join(","));
  for (const pa of playerAccounts) {
    const acc = pa.account as PlayerAccount;
    const idNum = (acc.id as number) ?? (acc.id?.toNumber?.() ?? 0);
    const total = (acc.totalTokens as number) ?? (acc.totalTokens?.toNumber?.() ?? 0);
    const sold = (acc.tokensSold as number) ?? (acc.tokensSold?.toNumber?.() ?? 0);
    const available = Math.max(0, total - sold);
    const cat = typeof acc.category === 'number' ? ["Bronze","Silver","Gold"][acc.category] : (Object.keys(acc.category||{})[0] || "?");
    playerById.set(idNum, { 
      id: idNum,
      name: acc.name || `Player ${idNum}`, 
      total, 
      sold, 
      available, 
      category: cat,
      providerId: (acc.providerId as number) ?? (acc.providerId?.toNumber?.() ?? undefined),
      discipline: acc.discipline ?? undefined,
      country: acc.country ?? undefined,
      metadataUri: acc.metadataUri ?? null,
    });
  }

  // Aggregate team sales
  const sales: any[] = [];
  const countsByPkg: Record<TeamPkg, number> = { A: 0, B: 0, C: 0 };
  const countsByState: Record<string, number> = {};

  for (const t of teamAccounts) {
    const acc = t.account as TeamAccount;
    const buyer = acc.firstBuyer?.toString?.() || "-";
    const teamId = (acc.teamId as number) ?? (acc.teamId?.toNumber?.() ?? 0);
    const cat = mapPackage(acc.category);
    const state = mapState(acc.state);
    const createdAt = tsToIso(acc.createdAt);
    const transitionAt = tsToIso(acc.transitionTimestamp);
    const nftMint = acc.nftMint?.toString?.() || "-";
    const playerIds: number[] = (acc.playerIds || []).map((x: any) => typeof x === 'number' ? x : x?.toNumber?.() ?? 0);

    countsByPkg[cat] = (countsByPkg[cat] || 0) + 1;
    countsByState[state] = (countsByState[state] || 0) + 1;

    const playersDetailed = playerIds.map((pid) => ({
      id: pid,
      name: playerById.get(pid)?.name || `Player ${pid}`,
      category: playerById.get(pid)?.category || "-",
    }));

    sales.push({
      teamId,
      buyer,
      package: cat,
      state,
      createdAt,
      transitionAt,
      nftMint,
      playerIds,
      players: playersDetailed,
      termsAccepted: !!acc.termsAccepted,
    });

    // CSV row per team: players list comma-separated (quoted)
    const esc = (v: any) => {
      const s = v === undefined || v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const playersJoined = playerIds.join(",");
    salesCsvRows.push([
      teamId,
      esc(buyer),
      cat,
      esc(state),
      esc(createdAt),
      esc(transitionAt),
      esc(nftMint),
      acc.termsAccepted ? "1" : "0",
      esc(playersJoined),
    ].join(","));
  }

  // Print detailed sales (sorted by teamId)
  sales.sort((a, b) => (a.teamId || 0) - (b.teamId || 0));
  for (const s of sales) {
    console.log("------------------------------------------------------------");
    console.log(`Team #${s.teamId}   Package: ${s.package}   State: ${s.state}`);
    console.log("------------------------------------------------------------");
    console.log(`Buyer:        ${s.buyer}`);
    console.log(`Created At:   ${s.createdAt}`);
    console.log(`Transition At:${s.transitionAt}`);
    console.log(`NFT Mint:     ${s.nftMint}`);
    console.log(`Terms:        ${s.termsAccepted ? 'accepted' : 'not accepted'}`);
    console.log("Players:");
    const ids = s.playerIds as number[];
    ids.forEach((pid: number, idx: number) => {
      const pd = playerById.get(pid);
      if (!pd) {
        console.log(`  ${idx+1}. [${pid}] (no data)`);
        return;
      }
      console.log(`  ${idx+1}. [${pd.id}] ${pd.name}  (${pd.category})`);
      console.log(`     Provider: ${pd.providerId ?? '-'}   Discipline: ${pd.discipline ?? '-'}   Country: ${pd.country ?? '-'}`);
      console.log(`     Tokens: total=${pd.total}  sold=${pd.sold}  available=${pd.available}`);
      if (pd.metadataUri) console.log(`     Metadata: ${pd.metadataUri}`);
    });
    console.log("");
  }

  // Summary
  const totalTeams = teamAccounts.length;
  const summaryLines = [
    `\n============================================================`,
    `======================= Summary (Teams) ===================`,
    `============================================================`,
    `Total sold teams: ${totalTeams}`,
    `By package: A=${countsByPkg.A}, B=${countsByPkg.B}, C=${countsByPkg.C}`,
    `By state: ${Object.entries(countsByState).map(([k,v])=>`${k}=${v}`).join(", ")}`,
  ];
  console.log(summaryLines.join("\n"));

  // Player tokens availability report
  console.log("\n============================================================");
  console.log("==================== Players Availability =================");
  console.log("============================================================\n");
  const playersReport = Array.from(playerById.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => a.id - b.id);

  for (const p of playersReport) {
    console.log(`Player #${p.id} | ${p.name} | ${p.category}`);
    console.log(`  Provider: ${p.providerId ?? '-'}  Discipline: ${p.discipline ?? '-'}  Country: ${p.country ?? '-'}`);
    console.log(`  Tokens: total=${p.total}  sold=${p.sold}  available=${p.available}`);
    if (p.metadataUri) console.log(`  Metadata: ${p.metadataUri}`);
  }

  // Cross-check with GameState PlayerSummary if present
  if (gameState?.players) {
    console.log("\n============================================================");
    console.log("=============== Cross-check (GameState summaries) ==========");
    console.log("============================================================\n");
    try {
      const summaries: any[] = gameState.players;
      for (const s of summaries) {
        const id = (s.id as number) ?? (s.id?.toNumber?.() ?? 0);
        const avail = (s.availableTokens as number) ?? (s.availableTokens?.toNumber?.() ?? 0);
        const cat = typeof s.category === 'number' ? ["Bronze","Silver","Gold"][s.category] : (Object.keys(s.category||{})[0] || "?");
        const p = playerById.get(id);
        if (p) {
          // Override authoritative availability and adjust sold accordingly
          p.available = avail;
          p.sold = Math.max(0, (p.total ?? 0) - p.available);
          // Prefer category from GameState
          p.category = cat;
        }
        const mismatch = p && p.available !== avail ? ` (mismatch: calc=${p.available} vs gs=${avail})` : '';
        console.log(`Player #${id} | ${(p?.name) || '-'} | ${cat} | available(gs)=${avail}${mismatch}`);
      }
    } catch (e) {
      console.log("(Could not decode GameState players summaries)");
    }
  }

  // Build stock CSV now (after overrides from GameState)
  {
    const esc = (v: any) => {
      const s = v === undefined || v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    Array.from(playerById.values())
      .sort((a, b) => a.id - b.id)
      .forEach((p) => {
        stockCsvRows.push([
          p.id,
          esc(p.name),
          esc(p.category),
          p.providerId ?? "",
          esc(p.discipline ?? ""),
          esc(p.country ?? ""),
          p.total,
          p.sold,
          p.available,
          esc(p.metadataUri ?? ""),
        ].join(","));
      });
  }

  // Write CSV files
  const outDir = path.join(__dirname);
  const salesPath = path.join(outDir, "sales_report.csv");
  const stockPath = path.join(outDir, "stock_report.csv");
  try { fs.writeFileSync(salesPath, salesCsvRows.join("\n"), "utf8"); } catch {}
  try { fs.writeFileSync(stockPath, stockCsvRows.join("\n"), "utf8"); } catch {}

  console.log("\nCSV files:");
  console.log("  Sales:", salesPath);
  console.log("  Stock:", stockPath);
  console.log("\nDone.\n");
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Error in report:", e);
    if ((e as any)?.logs) console.error("Logs:", (e as any).logs);
    process.exit(1);
  });
}
