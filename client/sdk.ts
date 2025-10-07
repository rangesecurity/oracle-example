import {
  PublicKey, Keypair, TransactionInstruction, SYSVAR_CLOCK_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { OracleJob, CrossbarClient, IOracleFeed } from "@switchboard-xyz/common";
import * as sb from "@switchboard-xyz/on-demand";
import { getDefaultQueue } from "@switchboard-xyz/on-demand";


export const PROGRAM_ID = new PublicKey("CR8mpiY9eEbNkU8w4VJkGB4gzEnozp739jwvTiXRmACc");


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
export async function getOracleJobSignature(payer: Keypair): Promise<{ feed_hash: string; queue_account: PublicKey; sigVerifyIx: TransactionInstruction }> {
  const { gateway, rpcUrl } = await sb.AnchorUtils.loadEnv();

  // Get the queue for the network you're deploying on
  //
  // Mainnet Queue:
  //let queue = await getDefaultQueue(rpcUrl);

  // Devnet Queue:
  let queue = await sb.getDefaultDevnetQueue(rpcUrl);
  let queue_account = queue.pubkey;
  let crossbar_client = CrossbarClient.default();

  console.log("Using Payer:", payer.publicKey.toBase58(), "\n");

  const feed: IOracleFeed = {
    name: "Risk Score",
    jobs: [getRangeRiskScoreJob()],
    minJobResponses: 1,
    minOracleSamples: 1,
    maxJobRangePct: 100,
  };

  // returns canonical hash of the feed
  const { feedId } = await crossbar_client.storeOracleFeed(feed);


  // // Is this necessary if signatures are verified on-chain?
  // // ------------------- // ------------------- 
  // // Ask the network to compute consensus + give us a feed hash
  // const res = await queue.fetchSignaturesConsensus({
  //   gateway,
  //   useEd25519: true,
  //   feedConfigs: [
  //     {
  //       feed: {
  //         jobs: [getRangeRiskScoreJob()],
  //       },
  //     },
  //   ],
  //   variableOverrides: {
  //     RANGE_API_KEY: process.env.RANGE_API_KEY!,
  //   },
  // });
  // console.log(res.median_responses);

  // const summary = res.median_responses[0];
  // if (!summary) throw new Error("No median responses returned");
  // // console.log("FeedHash:", summary.feed_hash);
  // // ------------------- // -------------------


  console.log("FeedId:", feedId);


  const feed_hash = feedId.startsWith("0x") ? feedId : `0x${feedId}`;

  const sigVerifyIx = await queue.fetchQuoteIx(
    crossbar_client,
    [feed_hash],
    {
      variableOverrides: { RANGE_API_KEY: process.env.RANGE_API_KEY! },
      numSignatures: 1,
      instructionIdx: 0, // we’ll put this ix at index 0 in the tx
    }
  );

  return { feed_hash, queue_account, sigVerifyIx };
}

export function buildGetRiskScoreIx(queue: PublicKey, query_account: PublicKey, feed_hash: string): TransactionInstruction {
  // String to byte array
  const data = Buffer.from(feed_hash.replace(/^0x/, ""), "hex");

  // Accounts we need to pass to the program
  //  [quote, queue, clock_sysvar, slothashes_sysvar, instructions_sysvar, query_account]
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
    data,
  });
}
