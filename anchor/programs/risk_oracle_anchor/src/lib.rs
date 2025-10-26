#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use prost::Message;
use switchboard_on_demand::{default_queue, QueueAccountData};
use switchboard_on_demand::{Instructions, QuoteVerifier, SlotHashes};
use switchboard_protos::oracle_job::oracle_job::http_task::Header;
use switchboard_protos::oracle_job::oracle_job::multiply_task;
use switchboard_protos::oracle_job::oracle_job::task;
use switchboard_protos::oracle_job::oracle_job::BoundTask;
use switchboard_protos::oracle_job::oracle_job::HttpTask;
use switchboard_protos::oracle_job::oracle_job::MultiplyTask;
use switchboard_protos::oracle_job::oracle_job::{JsonParseTask, Task};
use switchboard_protos::OracleFeed;
use switchboard_protos::OracleJob;

declare_id!("Hiy3MrT746mmcEGDRyomPFCG1quUgLRYvUTxijWPshJH");
#[program]
pub mod anchor_oracle_example {
    use super::*;

    pub fn verify_risk_score_feed<'a>(ctx: Context<VerifyRiskScoreFeed>) -> Result<()> {
        let mut verifier = QuoteVerifier::new();
        let slot = Clock::get()?.slot;

        verifier
            .queue(ctx.accounts.queue.as_ref())
            .slothash_sysvar(ctx.accounts.slothashes.as_ref())
            .ix_sysvar(ctx.accounts.instructions.as_ref())
            .clock_slot(slot);

        // Verify the Ed25519 instruction at index 0
        let quote = verifier.verify_instruction_at(0).unwrap();
        let quote_slot = quote.slot();

        // Ensure the quote is recent enough (within 50 slots).
        //
        if slot.saturating_sub(quote_slot) > 50 {
            // Extra check: ensure the quote is fresh enough (within 30 slots).
            msg!(
                "Quote too old. Current slot: {}, quote slot: {}",
                slot,
                quote_slot
            );
            return Err(ErrorCode::StaleQuote.into());
        }

        let feeds = quote.feeds();
        require!(!feeds.is_empty(), ErrorCode::NoOracleFeeds);

        let feed = &feeds[0];
        let actual_feed_id = feed.feed_id();

        let derived_feed_id = create_risk_score_feed_id(&ctx.accounts.query_account.key())?;

        require!(*actual_feed_id == derived_feed_id, ErrorCode::FeedMismatch);

        msg!(
            "Verified risk score feed! Value: {}",
            feed.value().to_string().as_str()
        );
        Ok(())
    }
}

fn create_risk_score_feed_id(query_pubkey: &Pubkey) -> Result<[u8; 32]> {
    let addr_b58 = bs58::encode(query_pubkey).into_string();
    let url = format!(
        "https://api.range.org/v1/risk/address?address={}&network=solana",
        addr_b58
    );

    let feed = OracleFeed {
        name: Some("Risk Score".to_string()),
        jobs: vec![OracleJob {
            tasks: vec![
                Task {
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
                },
                Task {
                    task: Some(task::Task::JsonParseTask(JsonParseTask {
                        path: Some("$.riskScore".to_string()),
                        // aggregation_method: Some(1), // optional; not needed for single value
                        ..Default::default()
                    })),
                },
                Task {
                    task: Some(task::Task::MultiplyTask(MultiplyTask {
                        multiple: Some(multiply_task::Multiple::Scalar(10.0)), // 0–10 => 0–100
                    })),
                },
                Task {
                    task: Some(task::Task::BoundTask(BoundTask {
                        lower_bound_value: Some("0".into()),
                        upper_bound_value: Some("100".into()),
                        on_exceeds_lower_bound_value: Some("0".into()),
                        on_exceeds_upper_bound_value: Some("100".into()),
                        ..Default::default()
                    })),
                },
            ],
            weight: None,
        }],
        min_job_responses: Some(1),
        min_oracle_samples: Some(1),
        max_job_range_pct: Some(100),
    };

    // Encode as protobuf length-delimited bytes using prost::Message trait
    let bytes = OracleFeed::encode_length_delimited_to_vec(&feed);

    // Hash the protobuf bytes
    Ok(hash(&bytes).to_bytes())
}

#[derive(Accounts)]
pub struct VerifyRiskScoreFeed<'info> {
    #[account(address = default_queue())]
    pub queue: AccountLoader<'info, QueueAccountData>,
    pub clock: Sysvar<'info, Clock>, // This is actually not used as anchor uses
    pub slothashes: Sysvar<'info, SlotHashes>,
    pub instructions: Sysvar<'info, Instructions>,
    /// CHECK: This doesnt need to be checked we just need the pubkey to build the feed id
    pub query_account: UncheckedAccount<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("No oracle feeds available")]
    NoOracleFeeds,

    #[msg("Feed hash mismatch - oracle feed does not match expected configuration")]
    FeedMismatch,

    #[msg("Invalid feed JSON")]
    InvalidFeedJson,

    #[msg("Failed to create quote verifier")]
    VerifierError,

    #[msg("Failed to verify Ed25519 instruction")]
    VerificationFailed,

    #[msg("Stale quote - the quote is too old")]
    StaleQuote,
}
