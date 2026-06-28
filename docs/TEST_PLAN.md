# Test Plan

## Automated tests

Run with:

```bash
npm test
```

| Scenario | Expected result |
|---|---|
| Valid commitment before deadline | Commitment is stored; answer remains empty and unrevealed |
| Second commitment from same wallet | Reverts with `CommitmentAlreadySubmitted` |
| Reveal before submission deadline | Reverts with `RevealPhaseNotOpen` |
| Reveal with a changed answer or salt | Reverts with `InvalidReveal` |
| Valid reveal in the allowed window | Stores answer and marks it eligible |
| Reveal after reveal deadline | Reverts with `RevealPhaseClosed` |
| `judgeAll` before reveal deadline | Reverts with `JudgeNotReady` |
| Second `judgeAll` | Reverts with `JudgeAlreadyRecorded` |
| Finalize unrevealed submission | Reverts with `WinnerNotEligible` |
| Finalize valid winner after judging | Pays exactly one escrowed reward |
| Finalize twice | Reverts with `AlreadyFinalized` |
| No participant reveals | Owner can recover escrow only after reveal closure |

## Manual Ritual-native validation

1. Create two encrypted ciphertext bundles for the same bounty.
2. Verify the public chain and storage reference expose no plaintext answer.
3. Confirm that the TEE fetches only ciphertexts whose hashes match the on-chain commitments.
4. Verify the TEE creates one ordered batch prompt containing all eligible answers.
5. Confirm the canonical result payload includes an answer-bundle reference and hash.
6. Compare `keccak256(canonicalResultBytes)` to the on-chain `judgeResultHash`.
7. After finalization, download the public answer bundle and confirm that its hash matches `revealedAnswersHash`.
