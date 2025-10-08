// client/tests.ts
// Run with: `npm test` (see package.json script)

import { strict as assert } from "assert";
import * as fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,

} from "@solana/web3.js";
import "mocha";
import * as path from "path";
import { buildGetRiskScoreIx, getOracleJobSignature, PROGRAM_ID } from "./sdk.ts";
import "dotenv/config";

// Load a Keypair from a JSON file
function loadKeypairFromFile(p: string): Keypair {
  const raw = fs.readFileSync(p, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const DEV_WALLET_KEYPAIR_PATH = process.env.DEV_WALLET_KEYPAIR_PATH ?? "./../keypair.json";

describe("Initialize Oracle Example", function () {
  this.timeout(10_000);

  const connection = new Connection(RPC_URL, "confirmed");

  const DEV_WALLET = loadKeypairFromFile(
    path.resolve(DEV_WALLET_KEYPAIR_PATH)
  );


  it("initializes the Oracle and call the Oracle Program", async () => {

    /**
 *    Build the **quote signature verification** instruction (sigVerifyIx)
 *    This:
 *      - Stores your feed on Crossbar (to get a canonical feedId)
 *      - Builds an Ed25519 verification ix for the guardians’ signatures
 *    IMPORTANT: This instruction*must be placed at index 0 in the tx
 *    because in our program the `QuoteVerifier` expects it at index 0 (`verify_instruction_at(0)`).
 *    Note that the ix can be placed in any index in the tx, but it must match the index
 *   passed to `verify_instruction_at(idx)` in the `QuoteVerifier`.
 */
    let { queue_account, sigVerifyIx } = await getOracleJobSignature(DEV_WALLET);

    // Choose the account you want to check (becomes the address query param
    // in the on-chain HTTP task definition). Your program will reconstruct
    // the same feed proto using this pubkey to ensure the hash matches.
    const query_account = new PublicKey("5PAhQiYdLBd6SVdjzBQDxUAEFyDdF5ExNPQfcscnPRj5");

    // Build the target program instruction
    const ix = buildGetRiskScoreIx(queue_account, query_account);

    // Create the transaction and add both instructions
    const tx = new Transaction().add(sigVerifyIx, ix);

    // Fetch the latest blockhash
    const latest = await connection.getLatestBlockhash({ commitment: "confirmed" });

    // Set fee payer + recent blockhash 
    tx.feePayer = DEV_WALLET.publicKey;
    tx.recentBlockhash = latest.blockhash;

    // Send the transaction
    const transactionSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [DEV_WALLET] // signer
    );


    console.log("Fetched RiskScore Via Oracle. Tx:", transactionSignature);

    // Some basic assertion to ensure it went through can be added here
  });
});



