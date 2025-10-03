// client/tests/initializeBlackNote.spec.ts
// Run the tests: npm test   

import { strict as assert } from "assert";
import * as fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,

} from "@solana/web3.js";
import type { Finality } from "@solana/web3.js";
import "mocha";
import * as path from "path";
import { buildHelloBlacknoteIx, buildInitializeIx, buildInitializeStoreIx, buildInsertAddressesIx, buildRemoveAddressesIx, GLOBAL_CONFIG_SEED, PROGRAM_ID, STORE_SEED } from "./sdk";


function loadKeypairFromFile(p: string): Keypair {
  const raw = fs.readFileSync(p, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";

const UPDATE_AUTHORITY = loadKeypairFromFile(
  path.resolve(process.env.UPDATE_AUTHORITY_KEYPAIR_PATH || "./../keypair.json")
);

describe("InitializeBlackNote", function () {
  this.timeout(60_000);

  const connection = new Connection(RPC_URL, "confirmed");

  async function sendAndConfirmWithLatestBlockhash(
    connection: Connection,
    tx: Transaction,
    signers: Keypair[],
    commitment: Finality = "confirmed"
  ): Promise<string> {
    // 1) fetch latest blockhash (and lastValidBlockHeight)
    const latest = await connection.getLatestBlockhash({ commitment });

    // 2) set fee payer + recent blockhash (caller should set feePayer; we still guard)
    if (!tx.feePayer) throw new Error("tx.feePayer not set");
    tx.recentBlockhash = latest.blockhash;

    // 3) send
    const sig = await connection.sendTransaction(tx, signers, {
      skipPreflight: false,
      preflightCommitment: commitment,
      maxRetries: 3,
    });

    // 4) confirm using the *same* blockhash tuple
    const conf = await connection.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      commitment
    );

    if (conf.value.err) {
      throw new Error(`Transaction ${sig} failed: ${JSON.stringify(conf.value.err)}`);
    }
    return sig;
  }



  it("initializes the GlobalConfig PDA (happy path)", async () => {
    // Derive PDA: find_program_address([GlobalConfig::SEED], program_id)
    const [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_CONFIG_SEED)],
      PROGRAM_ID
    );

    // Precondition: PDA should not exist yet (no data, 0 lamports)
    const pre = await connection.getAccountInfo(globalConfigPda);
    assert.equal(pre, null, "GlobalConfig PDA already exists — run test on a fresh validator.");

    // Build and send tx
    const ix = buildInitializeIx(UPDATE_AUTHORITY.publicKey, globalConfigPda);
    const tx = new Transaction().add(ix);
    tx.feePayer = UPDATE_AUTHORITY.publicKey;

    const sig = await sendAndConfirmWithLatestBlockhash(connection, tx, [UPDATE_AUTHORITY], "confirmed");

    // Postconditions
    const post = await connection.getAccountInfo(globalConfigPda, "confirmed");
    assert(post, "GlobalConfig PDA missing after tx");
    assert.equal(post!.owner.toBase58(), PROGRAM_ID.toBase58(), "Owner must be the program");
    assert(post!.lamports > 0, "Account should have rent-exempt lamports");
    assert(post!.data.length > 0, "Account data should be initialized");

    console.log("InitializeBlackNote success. Tx:", sig);
  });

  it("initializes the GlobalConfig PDA (unhappy path)", async () => {
    // Derive PDA: find_program_address([GlobalConfig::SEED], program_id)
    const [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_CONFIG_SEED)],
      PROGRAM_ID
    );

    // Build and send tx
    const ix = buildInitializeIx(UPDATE_AUTHORITY.publicKey, globalConfigPda);


    // Calling again should fail with AccountAlreadyInitialized
    const tx = new Transaction().add(ix);
    tx.feePayer = UPDATE_AUTHORITY.publicKey;


    let threw = false;
    try {
      await sendAndConfirmWithLatestBlockhash(connection, tx, [UPDATE_AUTHORITY], "confirmed");
    } catch {
      threw = true; // expected
    }
    assert(threw, "Second initialize should fail (already initialized).");

  });


  it("fails if payer != UPDATE_AUTHORITY", async () => {
    const notAuthority = Keypair.generate();

    const [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_CONFIG_SEED)],
      PROGRAM_ID
    );

    const ix = buildInitializeIx(notAuthority.publicKey, globalConfigPda);
    const tx = new Transaction().add(ix);
    tx.feePayer = notAuthority.publicKey;

    let threw = false;
    try {
      await sendAndConfirmWithLatestBlockhash(connection, tx, [notAuthority], "confirmed");
    } catch {
      threw = true; // expected
    }
    assert(threw, "Tx should fail when payer is not the update authority");
  });

  it("Intializes the Store PDA ", async () => {
    const notAuthority = Keypair.generate();

    const [storePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(STORE_SEED)],
      PROGRAM_ID
    );

    const ix = buildInitializeStoreIx(UPDATE_AUTHORITY.publicKey, storePda);
    const tx = new Transaction().add(ix);
    tx.feePayer = UPDATE_AUTHORITY.publicKey;

    let threw = false;

    let sig = await sendAndConfirmWithLatestBlockhash(connection, tx, [UPDATE_AUTHORITY], "confirmed");

    // Postconditions
    const post = await connection.getAccountInfo(storePda, "confirmed");
    assert(post, "Store PDA missing after tx");
    assert.equal(post!.owner.toBase58(), PROGRAM_ID.toBase58(), "Owner must be the program");
    assert(post!.lamports > 0, "Account should have rent-exempt lamports");
    assert(post!.data.length > 0, "Account data should be initialized");

    console.log("InitializeBlackNote success. Tx:", sig);
  });

  it("Fail to re-initializes the Store PDA (unhappy path)", async () => {
    // Derive PDA: find_program_address([AddressStoreHeader::SEED], program_id)
    const [storePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(STORE_SEED)],
      PROGRAM_ID
    );

    // Build and send tx
    const ix = buildInitializeStoreIx(UPDATE_AUTHORITY.publicKey, storePda);


    // Calling again should fail with AccountAlreadyInitialized
    const tx = new Transaction().add(ix);
    tx.feePayer = UPDATE_AUTHORITY.publicKey;


    let threw = false;
    try {
      await sendAndConfirmWithLatestBlockhash(connection, tx, [UPDATE_AUTHORITY], "confirmed");
    } catch {
      threw = true; // expected
    }
    assert(threw, "Second initialize should fail (already initialized).");

  });

  it("Add addresses to the Store PDA ", async () => {
    const notAuthority = Keypair.generate();

    const [storePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(STORE_SEED)],
      PROGRAM_ID
    );

    const pre = await connection.getAccountInfo(storePda);
    let preDataLen = pre.data.length;
    console.log("Store PDA pre data length:", preDataLen);

    const [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_CONFIG_SEED)],
      PROGRAM_ID
    );

    const ADDRESSES_TO_INSERT = [
      "13X42NiMGh9hRRFUZEnM8dwauZbHNXqu11TAq9LYYki2",
      "13mBbgnma3bWgnkFnAerWqNP6sMpeousaKaEAp9Yh1ZU",
      "13qESscnJbEZjsUi4fv47nvxMcHjp4VNRapSuog1wYus",
      "13qW4ktrXhjt1T3GMrYMdGDeUQ5mLBi6jCEeagtehS3R",
      "14iCWrYoqbtcEeUfZ2tsBCNYN6FK5A8sNaRJ2Je4BffK",
      "14jd15iAkTq7PTe1tBrjUfLncN8uhoRr1eHQ5Vj89JQU",
      "16f25BpDXmUoaKjGeCWwhJDrsZ5QTkBwYnnCGqL7C9w",
    ];

    let addresses = ADDRESSES_TO_INSERT.map(a => new PublicKey(a));

    const ix = buildInsertAddressesIx(UPDATE_AUTHORITY.publicKey, storePda, globalConfigPda, addresses);
    const tx = new Transaction().add(ix);
    tx.feePayer = UPDATE_AUTHORITY.publicKey;

    let threw = false;

    let sig = await sendAndConfirmWithLatestBlockhash(connection, tx, [UPDATE_AUTHORITY], "confirmed");

    // Postconditions
    const post = await connection.getAccountInfo(storePda, "confirmed");
    console.log("Store PDA post data length:", post.data.length);
    assert(post.data.length > preDataLen, "Store PDA data length should increase after tx");

    console.log("InitializeBlackNote success. Tx:", sig);
  });



  it("Remove addresses from the Store PDA ", async () => {
    const notAuthority = Keypair.generate();

    const [storePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(STORE_SEED)],
      PROGRAM_ID
    );

    const pre = await connection.getAccountInfo(storePda);
    let preDataLen = pre.data.length;
    console.log("Store PDA pre data length:", preDataLen);

    const [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_CONFIG_SEED)],
      PROGRAM_ID
    );

    const ADDRESSES_TO_REMOVE = [
      "13qESscnJbEZjsUi4fv47nvxMcHjp4VNRapSuog1wYus",
      "14jd15iAkTq7PTe1tBrjUfLncN8uhoRr1eHQ5Vj89JQU",
    ];

    let addresses = ADDRESSES_TO_REMOVE.map(a => new PublicKey(a));

    const ix = buildRemoveAddressesIx(UPDATE_AUTHORITY.publicKey, storePda, globalConfigPda, addresses);
    const tx = new Transaction().add(ix);
    tx.feePayer = UPDATE_AUTHORITY.publicKey;

    let threw = false;

    let sig = await sendAndConfirmWithLatestBlockhash(connection, tx, [UPDATE_AUTHORITY], "confirmed");

    // Postconditions
    const post = await connection.getAccountInfo(storePda, "confirmed");
    console.log("Store PDA post data length:", post.data.length);
    assert(post.data.length < preDataLen, "Store PDA data length should decrease after tx");

    console.log("InitializeBlackNote success. Tx:", sig);
  });

  it("Tests Hello Blacknote Program CPI call to Blacknote to verify an address.", async () => {

    const [storePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(STORE_SEED)],
      PROGRAM_ID
    );

    const subject = new PublicKey("13qESscnJbEZjsUi4fv47nvxMcHjp4VNRapSuog1wYus");

    const ix = buildHelloBlacknoteIx(UPDATE_AUTHORITY.publicKey, subject, storePda);
    const tx = new Transaction().add(ix);
    tx.feePayer = UPDATE_AUTHORITY.publicKey;

    let threw = false;

    let sig = await sendAndConfirmWithLatestBlockhash(connection, tx, [UPDATE_AUTHORITY], "confirmed");

    console.log("CPI in to Blacknote successfully. Tx:", sig);
  });
});



