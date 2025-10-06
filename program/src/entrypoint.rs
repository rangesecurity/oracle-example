#![allow(unexpected_cfgs)]

/// Import necessary components from the Pinocchio framework.
/// - `program_entrypoint` registers the main entrypoint to the Solana runtime.
/// - `default_panic_handler` ensures panics are handled in a predictable way.
use pinocchio::{
    account_info::AccountInfo, msg, program_entrypoint, program_error::ProgramError,
    pubkey::Pubkey, ProgramResult,
};
extern crate alloc;

use alloc::{format, string::ToString, vec};

use pinocchio_log::log;
use switchboard_on_demand::{get_slot, QuoteVerifier};
use switchboard_protos::{
    oracle_job::{
        self as oracle,
        oracle_job::{
            self, http_task::Header, multiply_task, task, BoundTask, HttpTask, JsonParseTask,
            MultiplyTask, Task,
        },
    },
    OracleFeed,
};

// Declare the Solana program entrypoint using the Pinocchio macro.
program_entrypoint!(process_instruction);

/// Switchboard Oracle program logger:
/// - Re-builds the Oracle job and calculate the hash.
/// - Verifies the hahs matches the one passed in instruction data.
/// - Invokes the Switchboard Oracle program's `process_verify_address` instruction via CPI. (?)
/// - Gets the return data from the Oracle program.
/// - Logs whether the address is blacklisted or not and the risk score.
///
#[inline(never)]
fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // process_verify_address(accounts)

    // Destructure accounts
    let [quote, queue, clock_sysvar, slothashes_sysvar, instructions_sysvar, query_account]: &[AccountInfo; 6] =
        accounts
            .try_into()
            .map_err(|_| ProgramError::NotEnoughAccountKeys)?;

    // The first 32 bytes of instruction data is the expected feed hash
    let expected_feed_hash: [u8; 32] = instruction_data[0..32]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let query_account_key = bs58::encode(query_account.key()).into_string();

    let url = format!(
        "https://api.range.org/v1/risk/address?address={}&network=solana",
        query_account_key
    );

    // Make the HTTP task
    let http_schema = HttpTask {
        url: Some(url),
        headers: [
            Header {
                key: Some("accept".to_string()),
                value: Some("application/json".to_string()),
            },
            Header {
                key: Some("X-API-KEY".to_string()),
                value: Some("${RANGE_API_KEY}".to_string()),
            },
        ]
        .into(),
        ..Default::default()
    };

    let json_parsep_schema = JsonParseTask {
        path: Some("$.riskScore".to_string()),
        aggregation_method: Some(1), // Grab the max value returned
    };

    let multiplyp_schema = MultiplyTask {
        multiple: Some(multiply_task::Multiple::Scalar(10.0)), // 0–10 => 0–100
    };

    let http_task = Task {
        task: Some(task::Task::HttpTask(http_schema)),
    };

    let json_parse_task = Task {
        task: Some(task::Task::JsonParseTask(json_parsep_schema)),
    };

    let multiply_task = Task {
        task: Some(task::Task::MultiplyTask(multiplyp_schema)),
    };

    // Bound Task to ensure the risk score is between 0 and 100
    //
    let boundp_schema = BoundTask {
        lower_bound: oracle_job, // Didn't get what to put here as the Job is only done afterwards
        lower_bound_value: Some("0".to_string()),
        on_exceeds_lower_bound: oracle_job,
        on_exceeds_lower_bound_value: Some("0".to_string()),
        upper_bound: oracle_job,
        upper_bound_value: Some("100".to_string()),
        on_exceeds_upper_bound: oracle_job,
        on_exceeds_upper_bound_value: Some("100".to_string()),
    };
    let bound_task = Task {
        task: Some(task::Task::BoundTask(boundp_schema)),
    };

    // Create an OracleJob with the task
    let oracle_job = oracle::OracleJob {
        tasks: vec![http_task, json_parse_task, multiply_task, bound_task],
        weight: Some(1),
    };

    let feed = OracleFeed {
        name: Some("Risk Score".to_string()),
        jobs: vec![oracle_job],
        min_oracle_samples: Some(1),
        min_job_responses: Some(1),
        max_job_range_pct: Some(100),
    };

    // Derive the feed hash from the OracleJob
    // let derived_feed_hash = ?????

    let slot = get_slot(clock_sysvar);

    // For pinocchio QuoteVerifier verifies and deserializes the quote data
    let quote_data = QuoteVerifier::new()
        .slothash_sysvar(slothashes_sysvar) // Sets the slot hash sysvar account for verification.
        .ix_sysvar(instructions_sysvar) // Sets the instructions sysvar account for verification.
        .clock_slot(slot) // Sets the current slot for freshness verification.
        .queue(queue) // Sets the oracle queue account.
        .max_age(30) // Sets the maximum age of the quote in seconds.
        .verify_account(quote) //verify the quote account
        .unwrap();

    // Parse and display each feed
    for (index, feed_info) in quote_data.feeds().iter().enumerate() {
        // Compare the derived feed hash with the one passed in instruction data
        log!("Feed #{}: {}", index + 1, feed_info.hex_id().as_str());
        if feed_info.feed_id() != &expected_feed_hash {
            msg!("Feed ID does not match expected feed hash");
            return Err(ProgramError::InvalidInstructionData);
        }

        log!("Value: {}", feed_info.value().to_string().as_str());
    }

    Ok(())
}
