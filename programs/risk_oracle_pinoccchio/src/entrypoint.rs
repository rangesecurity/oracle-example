#![allow(unexpected_cfgs)]

/// Import necessary components from the Pinocchio framework.
/// - `program_entrypoint` registers the main entrypoint to the Solana runtime.
/// - `default_panic_handler` ensures panics are handled in a predictable way.
use pinocchio::{
    account_info::AccountInfo, default_allocator, default_panic_handler, program_entrypoint,
    program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};
extern crate alloc;

use alloc::{format, string::ToString, vec};

use pinocchio_log::log;
use sb_on_demand_schemas::{encode_feed_to_base64, FeedRequestV2};
use switchboard_on_demand::{get_slot, QuoteVerifier};
use switchboard_protos::{
    oracle_job::{
        self as oracle,
        oracle_job::{
            http_task::Header, multiply_task, task, BoundTask, HttpTask, JsonParseTask,
            MultiplyTask, Task,
        },
    },
    OracleFeed,
};

// Declare the Solana program entrypoint using the Pinocchio macro.
program_entrypoint!(process_instruction);
default_allocator!();
default_panic_handler!();

/// Switchboard Oracle program logger:
/// - Re-builds the Oracle job and calculate the hash.
/// - Verifies the hahs matches the one passed in instruction data.
/// - Invokes the Switchboard Oracle program's `process_verify_address` instruction via CPI. (?)
/// - Gets the return data from the Oracle program.
/// - Logs whether the address is blacklisted or not and the risk score.
///
#[inline(always)]
fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // process_verify_address(accounts)

    // Destructure accounts
    let [queue, clock_sysvar, slothashes_sysvar, instructions_sysvar, query_account]: &[AccountInfo;
         5] = accounts
        .try_into()
        .map_err(|_| ProgramError::NotEnoughAccountKeys)?;

    // The first 32 bytes of instruction data is the expected feed hash
    let expected_feed_hash: [u8; 32] = instruction_data[0..32]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // -------- MAKE ORACLE JOB TO GET RISK SCORE FROM RANGE API --------
    // Note: Making the job on-chain just to get the feed hash makes us over the Stack Offset limit.

    // let query_account_key = bs58::encode(query_account.key()).into_string();

    // let url = format!(
    //     "https://api.range.org/v1/risk/address?address={}&network=solana",
    //     query_account_key
    // );

    // // According to our Call  (as far as I understood we should make the job onchain and get a hash from it):

    //
    // // Make the HTTP task
    // let http_schema = HttpTask {
    //     url: Some(url),
    //     headers: [
    //         Header {
    //             key: Some("accept".to_string()),
    //             value: Some("application/json".to_string()),
    //         },
    //         Header {
    //             key: Some("X-API-KEY".to_string()),
    //             value: Some("${RANGE_API_KEY}".to_string()),
    //         },
    //     ]
    //     .into(),
    //     ..Default::default()
    // };

    // let json_parsep_schema = JsonParseTask {
    //     path: Some("$.riskScore".to_string()),
    //     aggregation_method: Some(1), // Grab the max value returned
    // };

    // let multiplyp_schema = MultiplyTask {
    //     multiple: Some(multiply_task::Multiple::Scalar(10.0)), // 0–10 => 0–100
    // };

    // let http_task = Task {
    //     task: Some(task::Task::HttpTask(http_schema)),
    // };

    // let json_parse_task = Task {
    //     task: Some(task::Task::JsonParseTask(json_parsep_schema)),
    // };

    // let multiply_task = Task {
    //     task: Some(task::Task::MultiplyTask(multiplyp_schema)),
    // };

    // // Bound Task to ensure the risk score is between 0 and 100
    // //
    // let boundp_schema = BoundTask {
    //     lower_bound_value: Some("0".into()),
    //     upper_bound_value: Some("100".into()),
    //     ..Default::default()
    // };

    // let bound_task = Task {
    //     task: Some(task::Task::BoundTask(boundp_schema)),
    // };

    // // Create an OracleJob with the task
    // let oracle_job = oracle::OracleJob {
    //     tasks: vec![http_task, json_parse_task, multiply_task, bound_task],
    //     weight: Some(1),
    // };

    // let feed = OracleFeed {
    //     name: Some("Risk Score".to_string()),
    //     jobs: vec![oracle_job],
    //     min_oracle_samples: Some(1),
    //     min_job_responses: Some(1),
    //     max_job_range_pct: Some(100),
    // };

    // // Derive the feed hash from the OracleJob
    // // let derived_feed_hash = ?????
    // let b64 = encode_feed_to_base64(&feed);
    // let derived_feed_hash: [u8; 32] = FeedRequestV2::new(b64)
    //     .feed_id()
    //     .map_err(|_| ProgramError::InvalidInstructionData)?;

    // let derive_hash_str = bs58::encode(derived_feed_hash).into_string();
    // pinocchio_log::log!("Derived Feed Hash: {}", derive_hash_str.as_str());

    // -------- END MAKING ORACLE JOB TO GET FEED HASH --------

    let slot = get_slot(clock_sysvar);

    let mut quote_verifier = QuoteVerifier::new();
    // For pinocchio QuoteVerifier verifies and deserializes the quote data
    let quote_data = quote_verifier
        .slothash_sysvar(slothashes_sysvar) // Sets the slot hash sysvar account for verification.
        .ix_sysvar(instructions_sysvar) // Sets the instructions sysvar account for verification.
        .clock_slot(slot) // Sets the current slot for freshness verification.
        .queue(queue) // Sets the oracle queue account.
        .max_age(30) // Sets the maximum age of the quote in seconds.
        .verify_instruction_at(0)
        .unwrap(); // Verifies the quote is at instruction index 0.

    // Compare feed ids and read value
    let mut matched = false;
    for feed_info in quote_data.feeds().iter() {
        if feed_info.feed_id() == &expected_feed_hash
        /*  && feed_info.feed_id() == &derived_feed_hash */
        {
            matched = true;
            log!("Risk Score {}", feed_info.value().to_string().as_str());
        }
    }
    if !matched {
        return Err(ProgramError::InvalidInstructionData);
    }

    Ok(())
}
