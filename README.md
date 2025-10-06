# Questions

## 1 Bound Task

The bound task using the proto crate is a bit different for TS as we need to
deterime the targeted Task:

```rust
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
```

What oracle job is to be defined here?

## 2 Verifying and Fetching Data

Is QuoteVerifier::new() the best way to verify the hash provided is correct and
to fetch the data? Please refer to program code.

## 3 getOracleJobSignature

Is the code use getOracleJobSignature the correct way of getting a job hash and
make this job available to Oracles?
