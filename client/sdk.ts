import { PublicKey, Keypair } from "@solana/web3.js";
import { OracleJob, CrossbarClient } from "@switchboard-xyz/common";
import * as sb from "@switchboard-xyz/on-demand";


export const PROGRAM_ID = new PublicKey("FH4YSCbf3vBKZKMJjtSqAeRQmXDM7HCNVaUuDiivPgYA");



// todo()!: make the oracle job and the function to upload it to the oracles, get a signature and a result.

// Example Oracle Job to fetch Range Risk Score for a given address
function getRangeRiskScoreJob(payer: Keypair): OracleJob {
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
// missing the part where we get and return the signature
async function getOracleJobSignature() {
  const { crossbar, queue, gateway } = await sb.AnchorUtils.loadEnv();

  // You'll need to provide the payer keypair and ADDRESS
  const payer = Keypair.generate(); // Replace with your actual payer keypair

  // ----------------- NEEDS TO BE DONE -----------------
  // Fetch Job Hash and Median Response
  // Return the job hash and log the median response
  // ----------------------------------------------------

  const res = await queue.fetchSignaturesConsensus({
    gateway,
    useEd25519: true,
    feedConfigs: [
      {
        feed: {
          jobs: [getRangeRiskScoreJob(payer)],
        },
      },
    ],
    variableOverrides: {
      RANGE_API_KEY: process.env.RANGE_API_KEY!,
      ADDRESS: '5PAhQiYdLBd6SVdjzBQDxUAEFyDdF5ExNPQfcscnPRj5',
    },
  });
  console.log(res.median_responses);
}


// todo()!: build the instruction that will be used to call the program that will re-build the oracle job, confirm signature and log the result.

// EXAMPLE OF THE SDK BUILDER WE WILL DEVELOP

// Instruction builders Examples

// export const GLOBAL_CONFIG_SEED = "range_global_config";
// export const STORE_SEED = "range_blacknote_store";

// export function buildInitializeIx(payer: PublicKey, globalConfigPda: PublicKey): TransactionInstruction {
//   // Discriminator 0 => InitializeBlackNote
//   const data = Buffer.from([0x00]);
//   return new TransactionInstruction({
//     programId: PROGRAM_ID,
//     keys: [
//       { pubkey: payer, isSigner: true, isWritable: true },   // payer_info
//       { pubkey: globalConfigPda, isSigner: false, isWritable: true }, // global_config_info
//       { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // _system_program_info
//       { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent_sysvar_info
//     ],
//     data,
//   });
// }

// export const HELLOBLACKNOTE_PROGRAM_ID = new PublicKey("3WH4hKSiTqfapYBfy4VfVmZHgErrwUNR3zdGSG2gQXrV");

// export function buildHelloBlacknoteIx(payer: PublicKey, subject: PublicKey, storePda: PublicKey): TransactionInstruction {

//   return new TransactionInstruction({
//     programId: HELLOBLACKNOTE_PROGRAM_ID,
//     keys: [
//       { pubkey: payer, isSigner: true, isWritable: false },   // payer_info
//       { pubkey: subject, isSigner: false, isWritable: false }, // subject_info
//       { pubkey: storePda, isSigner: false, isWritable: false }, // store_info
//       { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
//     ],
//     data: Buffer.from([]),
//   });
// }