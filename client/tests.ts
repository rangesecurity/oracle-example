// client/tests/initializeBlackNote.spec.ts
// Run the tests: npm test   

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
import { buildGetRiskScoreIx, getOracleJobSignature, PROGRAM_ID } from "./sdk";


function loadKeypairFromFile(p: string): Keypair {
  const raw = fs.readFileSync(p, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";

describe("Initialize Oracle Example", function () {
  this.timeout(60_000);

  const connection = new Connection(RPC_URL, "confirmed");

  const DEV_WALLET = loadKeypairFromFile(
    path.resolve(process.env.DEV_WALLET_KEYPAIR_PATH || "./../keypair.json")
  );


  it("initializes the Oracle and call the Oracle Program", async () => {
    // Discriminator 0 => InitializeBlackNote
    let { feed_hash, queue_account } = await getOracleJobSignature(DEV_WALLET);

    // Get Quote and other accounts pubkeys
    const query_account = new PublicKey("5PAhQiYdLBd6SVdjzBQDxUAEFyDdF5ExNPQfcscnPRj5");

    // Build and send tx
    const ix = buildGetRiskScoreIx(queue_account, query_account, feed_hash);
    const tx = new Transaction().add(ix);

    // Fetch the latest blockhash
    const latest = await connection.getLatestBlockhash({ commitment: "confirmed" });

    // Set fee payer + recent blockhash (caller should set feePayer; we still guard)
    if (!tx.feePayer) throw new Error("tx.feePayer not set");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = DEV_WALLET.publicKey;

    const transactionSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [DEV_WALLET] // signer
    );


    console.log("Fetched RiskScore Via Oracle. Tx:", transactionSignature);
  });
});



