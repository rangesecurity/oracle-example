# Questions

## 1) Building Oracle Job on Chain

a) After building the oracle job how do we verify the hash is exactly the same
as expected? b) How do we get feed hash? c) Or this part is not needed and we
pass the hash just to make sure the accounts we are calling are getting the
correct hash?

## 2) Verifying and Fetching Data on chain for pinocchio

Is QuoteVerifier::new() the best way to verify the hash provided is correct and
to fetch the data? Please refer to program code.

## 3) Client - TESTS - getOracleJobSignature

Is the fetchSignaturesConsensus the correct way of getting a job hash and make
this job available to Oracles? Shouldn't we create a feed account and get the
pubkey first?
