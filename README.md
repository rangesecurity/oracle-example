# Questions

## 1) Building Oracle Job on Chain

Do we need to pass the Feed hash in the instruction data? We can get it from
QuoteVerifier::new() right? Then since we are building the oracle job we can
confirm we got the right feed? ( I am having issues to rebuild the job because
it exceeds the stack size )

## 2) Verifying and Fetching Data on chain for pinocchio

Is QuoteVerifier::new() the best way to verify the hash provided is correct and
to fetch the data? Please refer to program code.

## 3) Client - TESTS - getOracleJobSignature

Is the fetchSignaturesConsensus the correct way of getting a job hash and make
this job available to Oracles? Shouldn't we create a feed account and get the
pubkey first?

Using fetchSignaturesConsensus to get the feedHash and pass it to the
