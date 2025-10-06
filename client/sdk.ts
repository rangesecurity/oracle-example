import {
  PublicKey, Keypair, TransactionInstruction, SYSVAR_CLOCK_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { OracleJob, CrossbarClient } from "@switchboard-xyz/common";
import * as sb from "@switchboard-xyz/on-demand";
import { getDefaultQueue } from "@switchboard-xyz/on-demand";


export const PROGRAM_ID = new PublicKey("3WH4hKSiTqfapYBfy4VfVmZHgErrwUNR3zdGSG2gQXrV");


// Example Oracle Job to fetch Range Risk Score for a given address
export function getRangeRiskScoreJob(): OracleJob {
  const job = OracleJob.fromObject({
    tasks: [
      {
        httpTask: {
          url: "https://api.range.org/v1/risk/address?address=5PAhQiYdLBd6SVdjzBQDxUAEFyDdF5ExNPQfcscnPRj5&network=solana",
          headers: [
            { key: "accept", value: "application/json" },
            // placeholder resolved on-oracle by Secrets
            { key: "X-API-KEY", value: "${RANGE_API_KEY}" },
          ],
        },
      },
      // Only accept numeric riskScore >= 0; null => no match => failure so no Risk
      { jsonParseTask: { path: "$.riskScore" } },
      { multiplyTask: { scalar: 10 } }, // 0–10 => 0–100
      {
        boundTask: {
          lowerBoundValue: "0",
          onExceedsLowerBoundValue: "0",
          upperBoundValue: "100",
          onExceedsUpperBoundValue: "100",
        },
      },
    ],
  });
  return job;
}

// Function to fetch the oracle job signature and result
export async function getOracleJobSignature(payer: Keypair): Promise<{ feed_hash: string; queue_account: PublicKey }> {
  const { gateway, rpcUrl } = await sb.AnchorUtils.loadEnv();

  // Get the queue for the network you're deploying on
  //
  // Mainnet Queue:
  //let queue = await getDefaultQueue(rpcUrl);

  // Devnet Queue:
  let queue = await sb.getDefaultDevnetQueue(rpcUrl);
  let queue_account = queue.pubkey;

  console.log("Using Payer:", payer.publicKey.toBase58(), "\n");

  // ----------------- As per Example given in the chat -----------------
  // Fetch Job Hash and Median Response
  // Return the job hash and log the median response
  // --------------------------------------------------------------------

  const res = await queue.fetchSignaturesConsensus({
    gateway,
    useEd25519: true,
    feedConfigs: [
      {
        feed: {
          jobs: [getRangeRiskScoreJob()],
        },
      },
    ],
    variableOverrides: {
      RANGE_API_KEY: process.env.RANGE_API_KEY!,
    },
  });
  console.log(res.median_responses);

  const summary = res.median_responses[0];
  if (!summary) throw new Error("No median responses returned");

  return { feed_hash: summary.feed_hash, queue_account };
}

export function buildGetRiskScoreIx(quote: PublicKey, query_account: PublicKey, feed_hash: string): TransactionInstruction {
  // String to byte array
  const data = Buffer.from(feed_hash);

  // Accounts we need to pass to the program
  //  [quote, queue, clock_sysvar, slothashes_sysvar, instructions_sysvar, query_account]
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      // payer_info
      { pubkey: quote, isSigner: true, isWritable: false },
      { pubkey: quote, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false }, // clock_sysvar_info
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false }, // slothashes_sysvar_info
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }, // instructions_sysvar_info
      { pubkey: query_account, isSigner: false, isWritable: false }, // query_account_info

    ],
    data,
  });
}
