# Architecture Note: Commit-Reveal and Ritual-Native Hidden Submissions

## 1. Required track — generic EVM commit-reveal

```text
Participant browser
  answer + random salt
          │
          ├─ keccak256(answer, salt, participant, bountyId)
          │
          ▼
EVM contract stores commitment only
          │
          │  after submission deadline
          ▼
Participant reveals answer + salt
          │
          ▼
Contract verifies commitment and marks answer eligible
          │
          │  after reveal deadline
          ▼
Ritual batch judge evaluates all valid revealed answers once
          │
          ▼
Owner records result hash → reviews recommendation → finalizes one winner
```

### Privacy and trade-off

This works on any EVM chain and prevents copying **during the submission phase**. Its limitation is that answers become public during the reveal phase, before AI judging has completed. It is therefore the baseline fairness mechanism, not full end-to-end answer confidentiality.

## 2. Advanced track — Ritual-native encrypted submissions

### Goal

Keep answer plaintext unavailable to the public chain and to other participants until the private judging step is finished.

```text
1. Browser encrypts answer with the active Ritual TEE executor public key (ECIES)
   └─ ciphertext includes bountyId, participant, answer, random submission nonce

2. Storage layer stores ciphertext bundle
   └─ e.g. content-addressed storage / encrypted object store

3. EVM contract stores only
   └─ participant, ciphertextHash, storageRef, and optional commitment

4. After submission closure, Ritual delegated execution runs inside a TEE
   └─ fetch ciphertexts → verify hashes → decrypt in enclave → construct ONE batch prompt

5. The TEE sends all submissions to the selected model as one comparison job
   └─ one request, ordered by submission index, with rubric and anti-injection instructions

6. TEE emits an attested result bundle
   └─ winnerIndex, ranking, scores, reasons, revealedAnswersRef, revealedAnswersHash

7. Contract receives/verifies callback or stores the attested result reference
   └─ owner reviews → finalizes winner

8. After finalization, publish all answers together (or publish the encrypted-to-public bundle)
   └─ on-chain state commits to the final bundle hash
```

## 3. Where plaintext exists

Before a participant encrypts, plaintext exists in that participant’s browser. During judging, plaintext exists only in the TEE’s protected memory and in the selected model’s request boundary. The public EVM state, mempool, event logs, storage reference, and other participants see ciphertext, hashes, and metadata only. A production system should use a model endpoint with a no-retention/data-processing agreement, or run the model inside the protected execution boundary, because a TEE does not automatically make an external model provider private.

## 4. On-chain versus off-chain data

| Location | Data |
|---|---|
| On-chain | bounty metadata, participant address, ciphertext hash, encrypted-storage reference, status, AI result hash/reference, final winner index |
| Off-chain encrypted storage | ciphertext bundle and optionally encrypted answer attachments |
| TEE memory | decrypted answers, one ordered batch prompt, model response, canonical result payload |
| Public after finalization | winner index and an optional complete answer bundle reference plus its hash |

Large plaintext answers are not stored directly in Solidity storage because that is unnecessarily expensive and exposes data too early.

## 5. Batch judging and result integrity

The TEE makes one batch request that includes every valid submission in deterministic index order. The response is serialized as canonical JSON (stable field order, UTF-8, no whitespace ambiguity), hashed, and stored as `judgeResultHash`. A stronger implementation accepts a Ritual async callback and verifies the TEE-attested result before setting the judged state. The revealed answers bundle is similarly published off-chain and committed on-chain through `revealedAnswersHash`, allowing anyone to verify later that the published bundle was not silently edited.

## 6. Comparison

| Property | Commit-reveal | Ritual-native encrypted flow |
|---|---|---|
| Works on generic EVM chains | Yes | Requires Ritual execution path |
| Prevents copying before submission deadline | Yes | Yes |
| Keeps answers hidden until AI judging completes | No | Yes |
| On-chain storage cost | Low | Low; references and hashes only |
| Trust boundary | Owner / off-chain AI workflow | TEE execution plus selected model policy |
| AI invocation pattern | One batch after reveals | One private batch inside / from TEE |

## 7. Why human finalization remains useful

AI scoring is a recommendation, not an irreversible governance action. A human bounty owner can check that the model followed the stated rubric, reject an obviously malformed result, and select a valid revealed winner. The contract constrains this decision to an eligible revealed index and guarantees that only one payout can occur.
