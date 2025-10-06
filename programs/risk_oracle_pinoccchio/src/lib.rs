#![no_std]

// #[cfg(test)]
// extern crate std;

pub mod consts;
#[cfg(feature = "bpf-entrypoint")]
pub mod entrypoint;

pinocchio_pubkey::declare_id!("CR8mpiY9eEbNkU8w4VJkGB4gzEnozp739jwvTiXRmACc");
