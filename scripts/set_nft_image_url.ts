import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, SystemProgram, Keypair } from "@solana/web3.js";
import * as dotenv from "dotenv";
import * as bs58 from "bs58";
import fs from "fs";

dotenv.config();

async function main() {
	const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
	const connection = new Connection(rpcUrl, { commitment: "confirmed" });

	const ownerPk = process.env.OWNER_PRIVATE_KEY;
	if (!ownerPk) throw new Error("OWNER_PRIVATE_KEY requerido (base58)");
	const owner = Keypair.fromSecretKey(bs58.decode(ownerPk));

	const programIdStr = process.env.SPORTS_PROGRAM_ID;
	if (!programIdStr) throw new Error("SPORTS_PROGRAM_ID requerido");
	const programId = new PublicKey(programIdStr);

	const newUrl = "https://nft.funraise.space";
	if (!newUrl) throw new Error("NEW_NFT_IMAGE_URL requerido");

	const provider = new anchor.AnchorProvider(
		connection,
		new anchor.Wallet(owner),
		{ commitment: "confirmed", preflightCommitment: "confirmed" }
	);
	anchor.setProvider(provider);

	// Cargar IDL mínimo para esta instrucción
	const idlPath = "scripts/set_url_nft_idl.json";
	if (!fs.existsSync(idlPath)) throw new Error(`IDL no encontrado en ${idlPath}.`);
	const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
	const program = new (anchor.Program as any)(idl, programId, provider);

	const [gameState] = PublicKey.findProgramAddressSync(
		[Buffer.from("game_state"), program.programId.toBuffer()],
		program.programId
	);

	console.log("Program:", program.programId.toString());
	console.log("GameState:", gameState.toString());
	console.log("New URL:", newUrl);

	const tx = await (program.methods as any)
		.setNftImageUrl(newUrl)
		.accounts({
			gameState: gameState,
			user: owner.publicKey,
		})
		.rpc();

	console.log("✅ set_nft_image_url ok");
	console.log("tx:", tx);
}

if (require.main === module) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}

export {};
