import {
  PublicKey, Keypair, TransactionInstruction, SYSVAR_CLOCK_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { OracleJob, CrossbarClient, IOracleFeed, FeedHash, bs58 } from "@switchboard-xyz/common";
import * as sb from "@switchboard-xyz/on-demand";
import { getDefaultQueue } from "@switchboard-xyz/on-demand";

// The deployed Pinocchio program ID.
export const PROGRAM_ID = new PublicKey("CR8mpiY9eEbNkU8w4VJkGB4gzEnozp739jwvTiXRmACc");


// Example Oracle Job to fetch Range Risk Score for a given address
// The oracle job uses a HTTP task to fetch the risk score from Range API
// and then parses the JSON response to extract the riskScore field.
// The riskScore is then multiplied by 10 to convert it to a scale of 0-100
// and bounded between 0 and 100.
// The API key is passed as a variable override to the oracle job.
//
// Note that this job is designed to be used with the Pinocchio program
// which neeeds to match the feed hash on-chain to ensure the integrity of the data.
export function getRangeRiskScoreJob(): OracleJob {
  const job = OracleJob.fromObject({
    tasks: [
      {
        httpTask: {
          url: "https://api.range.org/v1/risk/address?address=5PAhQiYdLBd6SVdjzBQDxUAEFyDdF5ExNPQfcscnPRj5&network=solana",
          headers: [
            { key: "accept", value: "application/json" },
            // Resolved on-oracle by Variable Override
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

// Fetch a signed oracle quote **and** build the Ed25519 signature verification
// Flow:
// 1) Choose the queue (devnet in this example)
// 2) Construct a canonical feed (IOracleFeed) with your OracleJob
// 3) Store feed on Crossbar to get canonical `feedId` (deterministic hash of feed proto)
// 4) Build the Ed25519 verify ix using `queue.fetchQuoteIx`, pointing at `feedId`
//    and passing `variableOverrides` so oracles can resolve `${RANGE_API_KEY}`
//
// The returned `sigVerifyIx` is the Ed25519 signature verification
export async function getOracleJobSignature(payer: Keypair): Promise<{ queue_account: PublicKey; sigVerifyIx: TransactionInstruction }> {
  const { gateway, rpcUrl } = await sb.AnchorUtils.loadEnv();

  // Get the queue for the network you're deploying on
  //
  // Devnet queue (use `getDefaultQueue(rpcUrl)` for mainnet)
  let queue = await sb.getDefaultDevnetQueue(rpcUrl);
  let queue_account = queue.pubkey;


  // Crossbar is the metadata & distribution layer (IPFS pinning + REST operations)
  // It provides essential functionalities for simulating and resolving feeds.
  //
  let crossbar_client = CrossbarClient.default();

  console.log("Using Payer:", payer.publicKey.toBase58(), "\n");

  // Build  IOracleFeed (feed proto) from your job(s)
  // Keep values minimal and consistent; defaults vs explicit values can change the hash.
  const feed: IOracleFeed = {
    name: "Risk Score",
    jobs: [getRangeRiskScoreJob()],
    minJobResponses: 1,
    minOracleSamples: 1,
    maxJobRangePct: 100,
  };

  // Build the Ed25519 signature verification instruction for the selected feed.
  // This instruction verifies signatures from guardians and embeds receipts for your
  //  
  //
  // Notes:
  // - `variableOverrides` are passed to oracles so `${RANGE_API_KEY}` can be injected
  //   into your HTTP task at runtime (without exposing secrets on-chain).
  // - `numSignatures` controls consensus level; keep >1 for production critical paths.
  // - `instructionIdx` tells the Ed25519 program where to put the sig verify in the tx
  const sigVerifyIx = await queue.fetchQuoteIx(
    crossbar_client,
    [feed],
    {
      variableOverrides: { RANGE_API_KEY: process.env.RANGE_API_KEY! },
      numSignatures: 1,
      instructionIdx: 0, // we’ll put this ix at index 0 in the tx
    }
  );
  return { queue_account, sigVerifyIx };
}

//  
// This instruction passes the accounts your program needs:
//   - queue (to verify the quote)
//   - sysvars (clock, slot hashes, instructions)
//   - query_account (the address you want to fetch the risk score for)
//
// Note: no data is sent to the program in this example; all info is in accounts
export function buildGetRiskScoreIx(queue: PublicKey, query_account: PublicKey): TransactionInstruction {

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      // payer_info
      { pubkey: queue, isSigner: false, isWritable: false }, // queue
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false }, // clock_sysvar_info
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false }, // slothashes_sysvar_info
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }, // instructions_sysvar_info
      { pubkey: query_account, isSigner: false, isWritable: false }, // query_account_info

    ],
    data: Buffer.alloc(0), // no data to send
  });
}
