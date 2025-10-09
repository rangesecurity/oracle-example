#![allow(unexpected_cfgs)]

use alloc::{format, string::ToString, vec};
/// Import necessary components from the Pinocchio framework.
/// - `program_entrypoint` registers the main entrypoint to the Solana runtime.
/// - `default_panic_handler` ensures panics are handled in a predictable way.
use pinocchio::{
    account_info::AccountInfo, default_allocator, default_panic_handler, program_entrypoint,
    program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};
use pinocchio_log::log;
use prost::Message;
use sha2::{Digest, Sha256};
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
extern crate alloc;

program_entrypoint!(process_instruction);
default_allocator!();
default_panic_handler!();

/// Recreate the Switchboard feed on-chain as a protobuf structure
/// that matches the client feed byte-for-byte (same tasks, same fields,
/// same order). We then encode it and SHA-256 hash the bytes to
/// derive the canonical **feed id**.
///
/// Verify the oracle quote signatures by requiring an Ed25519
/// verification instruction at index 0 (supplied by the client), and
/// validate freshness (SlotHashes) & queue.
/// This yields a `quote` with one or more `feeds()`.
///
/// Compare our derived feed id with the `feed_id()` inside the verified
/// quote. If they match, we trust the `value()` and log it.
///
/// Note: Any change to the client's feed definition (URL, headers, task
/// ordering, bounds, etc.) changes the hash → mismatch → instruction fails.
///
#[inline(never)]
fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // process_verify_address(accounts)

    // Destructure accounts
    let [queue, clock_sysvar, slothashes_sysvar, instructions_sysvar, query_account]: &[AccountInfo;
         5] = accounts
        .try_into()
        .map_err(|_| ProgramError::NotEnoughAccountKeys)?;

    // ===== Recreate the feed proto on-chain (same as client) =====

    // We use the `query_account` pubkey (base58) to parameterize the Range API URL
    // so the on-chain proto matches the client’s proto when they compute/pin the feed.
    let addr_b58 = bs58::encode(query_account.key()).into_string();
    let url = format!(
        "https://api.range.org/v1/risk/address?address={}&network=solana",
        addr_b58
    );

    // Build the HTTP task: GET the Range endpoint with headers.
    // The header order and values must match the client.
    // Note: `${RANGE_API_KEY}` is a placeholder resolved by the oracle via variable overide.
    let http_task = Task {
        task: Some(task::Task::HttpTask(HttpTask {
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
        })),
    };

    // Parse the JSON response at the path `$.riskScore`.
    let json_parse_task = Task {
        task: Some(task::Task::JsonParseTask(JsonParseTask {
            path: Some("$.riskScore".to_string()),
            // aggregation_method: Some(1), // optional; not needed for single value
            ..Default::default()
        })),
    };

    // Multiply the risk score (0–10) by 10 to get a 0–100 range.
    // Note: The MultiplyTask is optional; we could just change the bounds below to 0–10.
    // but it has to match the client exactly.
    let multiply_task = Task {
        task: Some(task::Task::MultiplyTask(MultiplyTask {
            multiple: Some(multiply_task::Multiple::Scalar(10.0)), // 0–10 => 0–100
        })),
    };

    // Bound the result to [0,100]. If out of bounds, set to nearest bound.
    let bound_task = Task {
        task: Some(task::Task::BoundTask(BoundTask {
            lower_bound_value: Some("0".into()),
            upper_bound_value: Some("100".into()),
            on_exceeds_lower_bound_value: Some("0".into()),
            on_exceeds_upper_bound_value: Some("100".into()),
            ..Default::default()
        })),
    };

    // Create the OracleJob with tasks in order.
    // Note: The `weight` field is optional and should be None to match
    // the client canonicalization. Setting it to Some(1) changes the hash.
    let oracle_job = oracle::OracleJob {
        tasks: vec![http_task, json_parse_task, multiply_task, bound_task],
        weight: None, // keep None to match client canonicalization; using Some(1) changes hash
    };

    // Create the OracleFeed with one job.
    // Note: The `name` field is optional but we set it to match the client.
    let feed = OracleFeed {
        name: Some("Risk Score".to_string()),
        jobs: vec![oracle_job],
        min_job_responses: Some(1),
        min_oracle_samples: Some(1),
        max_job_range_pct: Some(100),
    };

    // Encode to length-delimited protobuf bytes
    let bytes = OracleFeed::encode_length_delimited_to_vec(&feed);

    // Hash to 32-byte feed id (Switchboard uses SHA-256 of the length-delimited bytes)
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let derived_feed_hash: [u8; 32] = hasher.finalize().into();

    // --------  Verify the quote signatures / freshness / queue --------

    // The client must prepend an Ed25519-program instruction at **index 0** that
    // verifies the guardian signatures over the quote. QuoteVerifier checks:
    //   - Ed25519 ix at idx 0 matches the signatures in the quote
    //   - SlotHashes sysvar → the quote is fresh enough (max_age)
    //   - Queue account is the expected Switchboard queue
    // Returns a decoded quote with one or more `feeds()`.

    // - `get_slot` reads current slot from Clock sysvar (Pinocchio-friendly).
    let slot = get_slot(clock_sysvar);

    // - `QuoteVerifier` verifies the Ed25519 signature ix and decodes the quote.
    let mut quote_verifier = QuoteVerifier::new();
    let quote_data = quote_verifier
        .slothash_sysvar(slothashes_sysvar) // Sets the slot hash sysvar account for verification.
        .ix_sysvar(instructions_sysvar) // Sets the instructions sysvar account for verification.
        .clock_slot(slot) // Sets the current slot for freshness verification.
        .queue(queue) // Sets the oracle queue account.
        .max_age(30) // Sets the maximum age of the quote in seconds.
        .verify_instruction_at(0) // Verifies the quote is at instruction index 0.
        .map_err(|_| OracleError::InstructionQuoteMissing)?;

    let quote_slot = quote_data.slot();

    // Ensure the quote is recent enough (within 50 slots).
    //
    if slot.saturating_sub(quote_slot) > 50 {
        // Extra check: ensure the quote is fresh enough (within 30 slots).
        log!(
            "Quote too old. Current slot: {}, quote slot: {}",
            slot,
            quote_slot
        );
        return Err(OracleError::StaleQuote.into());
    }

    // Check that at least one verified feed matches our derived feed id.
    //    If matched, we trust its `value()` and can act on it.
    let mut matched = false;
    for feed_info in quote_data.feeds().iter() {
        if feed_info.feed_id() == &derived_feed_hash {
            matched = true;
            log!("Risk Score {}", feed_info.value().to_string().as_str());
        }
    }

    // If no feed matched, fail. This usually means the client feed proto is not
    // identical (different headers/order/fields) or quote wasn’t fetched for
    // this exact feed.
    if !matched {
        return Err(OracleError::FeedIdMismatch.into());
    }

    Ok(())
}

#[derive(Clone, PartialEq)]
pub enum OracleError {
    // feed id mismatch
    FeedIdMismatch,
    // invalid quote
    InvalidQuote,
    // stale quote
    StaleQuote,
    // instruction quote missing
    InstructionQuoteMissing,
}

impl From<OracleError> for ProgramError {
    fn from(e: OracleError) -> Self {
        Self::Custom(e as u32)
    }
}
