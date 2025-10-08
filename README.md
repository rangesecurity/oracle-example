# Oracle — Risk Score Example on Solana (via Switchboard On-Demand)

This repository demonstrates how to **fetch off-chain data from Range’s Risk
API** using a **Switchboard On-Demand Oracle**, and **verify the result fully
on-chain** inside a Solana program.

The example uses:

- 2 implementations for the on-chain program ( **Pinocchio** and **Anchor**)
- **Switchboard On-Demand** for fetching + signing off-chain data
- **Range API** for providing trusted risk scores
- **TypeScript client** for building and submitting the transaction

Note: The Anchor and Pinocchio programs are intentionally equivalent, showcasing
how Switchboard On-Demand can be used in either framework.

---

## Overview

1. **Client side**:

   - Builds a **Range Risk Score** feed (HTTP + JSON parse + multiply + bound
     tasks)
   - Requests Switchboard to fetch, sign, and return a **quote** for that feed
   - Builds two instructions:
     1. `sigVerifyIx` — verifies Switchboard’s Ed25519 signatures
     2. `getRiskScoreIx` — calls your on-chain program

2. **On-chain program**:
   - Reconstructs the exact same feed definition
   - Hashes it (`SHA-256(length-delimited-protobuf)`) -> `feed_id`
   - Uses QuoteVerifier from switchboard-on-demand to verify:
   - The quote signatures
   - The quote’s feed_id matches the derived one
   - The quote is fresh and valid

- Logs the verified risk score (0–100)

If the feed hash doesn’t match or the quote is stale, the transaction fails —
ensuring **tamper-proof, auditable oracle data**.

---

## How It Works

1. The Feed (client/sdk.ts)

The feed describes what the oracle should fetch and how to process it:

```ts
export function getRangeRiskScoreJob(): OracleJob {
  return OracleJob.fromObject({
    tasks: [
      {
        httpTask: {
          url: 'https://api.range.org/v1/risk/address?address=<ADDRESS>&network=solana',
          headers: [
            { key: 'accept', value: 'application/json' },
            { key: 'X-API-KEY', value: '${RANGE_API_KEY}' }, // resolved off-chain
          ],
        },
      },
      { jsonParseTask: { path: '$.riskScore' } },
      { multiplyTask: { scalar: 10 } }, // Scale 0–10 → 0–100
      { boundTask: { lowerBoundValue: '0', upperBoundValue: '100' } },
    ],
  });
}
```

Switchboard hashes the serialized feed proto → feed_id.

2. Request a Quote

`getOracleJobSignature()`:

- Uploads the feed to Crossbar (Switchboard backend)
- Requests an oracle quote for that feed

Returns:

- sigVerifyIx: Ed25519 verification instruction (index 0)
- queue_account: the Switchboard queue to use

3. Order Ixs and send the transaction

4. Verify on chain `entrypoint.rs` reconstructs the feed, hashes it, and
   verifies:

- The quote signatures (using QuoteVerifier)
- The quote’s feed_id matches the on-chain derived hash
- If matched, logs the risk score

## Run the Example

Install dependencies

```bash
cd anchor/client # or pinocchio/client
npm install
```

2. Run the test

```
npm test
```

Expected output:

```bash
Using Payer: <YOUR_PAYER_PUBKEY>

[
  { value: '100000000000000000000', feed_hash: '...', num_oracles: 1 }
]
FeedId: 0xee6ffd4f...
Fetched RiskScore Via Oracle. Tx: 2ZQs9febdjypEd5C43FkmyvTQiJe41Xcb44dBzx9DsQ1X9sSvniS76c6Tft8QiM2kf5jEbN6sgyCcN5ZZqEhuqC8
✔ initializes the Oracle and call the Oracle Program
```

On the explorer logs you should see:

```bash
Program log: Risk Score 100
```

## Security Guarantees

- Deterministic feed hash: Any feed change (URL, headers, or tasks) changes the
  hash → rejects stale or spoofed quotes.

- On-chain signature verification: The first transaction instruction must be the
  Ed25519 verification ix. The program checks it using Switchboard’s
  QuoteVerifier.

- Freshness enforcement: Uses Clock and SlotHashes sysvars to reject old quotes.

- Secret safety: ${RANGE_API_KEY} is injected only off-chain via
  variableOverrides; never stored or sent on-chain.

## Integration Pattern

To integrate Range + Switchboard in your own Solana program:

1. Define your feed in TypeScript (HTTP → Parse → Transform → Bound)
2. Request a quote using fetchQuoteIx
3. In your program, reconstruct the same feed and hash it
4. Use QuoteVerifier to check signatures + freshness
5. Compare the feed IDs and trust only matching results
