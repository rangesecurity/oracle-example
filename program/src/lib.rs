//! Harkness Decentralized Research
#![no_std]

// #[cfg(test)]
// extern crate std;

pub mod consts;
#[cfg(feature = "bpf-entrypoint")]
pub mod entrypoint;

pinocchio_pubkey::declare_id!("3WH4hKSiTqfapYBfy4VfVmZHgErrwUNR3zdGSG2gQXrV");
