#![allow(unexpected_cfgs)]
/// Import necessary components from the Pinocchio framework.
/// - `program_entrypoint` registers the main entrypoint to the Solana runtime.
/// - `no_allocator` disables heap allocations, enforcing deterministic memory usage.
/// - `default_panic_handler` ensures panics are handled in a predictable way.
use pinocchio::{
    account_info::AccountInfo,
    cpi::{get_return_data, invoke},
    instruction::{AccountMeta, Instruction},
    msg, no_allocator, nostd_panic_handler, program_entrypoint,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    ProgramResult,
};

use crate::consts::BLACKNOTE_PROGRAM_ID;

// Declare the Solana program entrypoint using the Pinocchio macro.
program_entrypoint!(process_instruction);
nostd_panic_handler!();
no_allocator!();

/// Minimal forwarder:
/// - Forwards `instruction_data` to the BlackNote program as-is.
/// - Accounts (in order): [payer, subject_wallet, store, blacknote_program]
/// - After CPI, reads return data:
///     - 1 => "Address Blacklisted"
///     - 0 => "Address Not Blacklisted"
///
#[inline(never)]
fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // process_verify_address(accounts)

    // Require exactly 4 accounts for simplicity.
    let [payer, subject, store, _blacknote_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    //  PDA verification needed for production use.
    let (derived_pda, _bump) =
        find_program_address(&["range_blacknote_store".as_bytes()], &BLACKNOTE_PROGRAM_ID);

    if derived_pda != *store.key() {
        msg!("Invalid store account");
        return Err(ProgramError::InvalidAccountData);
    }

    // Build the metas the callee (BlackNote) expects for `process_verify_address`.
    // All three are read-only, no signers.
    let metas = [
        AccountMeta::readonly(payer.key()),
        AccountMeta::readonly(subject.key()),
        AccountMeta::readonly(store.key()),
    ];
    let ix = Instruction {
        program_id: &BLACKNOTE_PROGRAM_ID,
        accounts: &metas,
        data: &[4u8],
    };

    let infos: [&AccountInfo; 3] = [payer, subject, store];
    invoke(&ix, &infos)?;

    // Read return data immediately after the CPI
    let Some(returned_data) = get_return_data() else {
        return Err(ProgramError::InvalidAccountData);
    };

    if returned_data.program_id() != &BLACKNOTE_PROGRAM_ID {
        return Err(ProgramError::InvalidAccountData);
    }

    let flag = returned_data.as_slice().get(0).copied().unwrap_or(0);

    if flag > 0 {
        msg!("Address Blacklisted");
    } else {
        msg!("Address Not Blacklisted");
    }
    Ok(())
}
