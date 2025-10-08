import {
  PublicKey, Keypair, TransactionInstruction, SYSVAR_CLOCK_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { OracleJob, CrossbarClient, IOracleFeed } from "@switchboard-xyz/common";
import * as sb from "@switchboard-xyz/on-demand";
import { getDefaultQueue } from "@switchboard-xyz/on-demand";
import { createHash } from "crypto";

// The deployed Pinocchio program ID.
export const PROGRAM_ID = new PublicKey("Hiy3MrT746mmcEGDRyomPFCG1quUgLRYvUTxijWPshJH");

// 8-byte Anchor discriminator for the instruction "verify_risk_score_feed"
function ixDiscriminator(name: string): Buffer {
  const hash = createHash("sha256")
    .update(`global:${name}`)
    .digest();
  return hash.subarray(0, 8);
}
const VERIFY_RISK_SCORE_FEED_IX = ixDiscriminator("verify_risk_score_feed");

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


  // Crossbar is the metadata & distribution layer (IPFS pinning + REST)
  // We use it to:
  //  - store the OracleFeed (to get canonical feedId)
  //  - fetch/simulate feeds when debuggin
  let crossbar_client = CrossbarClient.default();

  console.log("Using Payer:", payer.publicKey.toBase58(), "\n");

  // Build canonical OracleFeed (feed proto) from your job(s)
  // Keep values minimal and consistent; defaults vs explicit values can change the hash.
  const feed: IOracleFeed = {
    name: "Risk Score",
    jobs: [getRangeRiskScoreJob()],
    minJobResponses: 1,
    minOracleSamples: 1,
    maxJobRangePct: 100,
  };


  // Persist the feed proto via Crossbar to obtain the deterministic feedId (hash)
  // returns canonical hash of the feed proto
  // This is the same hash your program will reconstruct on-chain to ensure integrity
  // Note: you only need to store the feed once; oracles will cache it after seeing it on-chain
  const { feedId } = await crossbar_client.storeOracleFeed(feed);
  console.log("FeedId:", feedId);


  // Build the Ed25519 signature verification instruction for the selected `feedId`.
  // This instruction verifies signatures from guardians and embeds receipts for your
  // on-chain `QuoteVerifier` to parse.
  //
  // Notes:
  // - `variableOverrides` are passed to oracles so `${RANGE_API_KEY}` can be injected
  //   into your HTTP task at runtime (without exposing secrets on-chain).
  // - `numSignatures` controls consensus level; keep >1 for production critical paths.
  // - `instructionIdx` tells the Ed25519 program where to put the sig verify in the tx
  const sigVerifyIx = await queue.fetchQuoteIx(
    crossbar_client,
    [feedId],
    {
      variableOverrides: { RANGE_API_KEY: process.env.RANGE_API_KEY! },
      numSignatures: 1,
      instructionIdx: 0, // we’ll put this ix at index 0 in the tx
    }
  );

  return { queue_account, sigVerifyIx };
}

// Build the instruction to call your on-chain program
// This instruction passes the accounts your program needs:
//   - queue (to verify the quote)
//   - sysvars (clock, slot hashes, instructions)
//   - query_account (the address you want to fetch the risk score for)
//
// Note: no data is sent to the program in this example; all info is in accounts
export function buildGetRiskScoreIx(queue: PublicKey, query_account: PublicKey): TransactionInstruction {
  const data = VERIFY_RISK_SCORE_FEED_IX;

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
    data, // no data to send just descriminator
  });
}
