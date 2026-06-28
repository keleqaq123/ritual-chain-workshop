# Privacy-Preserving AI Bounty Judge

A Solidity implementation of a **commit-reveal bounty workflow** plus a concrete **Ritual-native encrypted-submission architecture** for the advanced track.

## Problem

The original workshop bounty made every answer public at submission time. A later participant could copy or improve an earlier response. This project separates the process into a hidden commitment phase and a later reveal phase, preventing answer copying while still enabling an auditable AI judging workflow.

## What is included

- `contracts/PrivacyPreservingAIBountyJudge.sol` — required commit-reveal contract.
- `test/PrivacyPreservingAIBountyJudge.js` — tests for valid and invalid reveal cases, deadlines, and payout safety.
- `docs/ARCHITECTURE.md` — commit-reveal versus Ritual-native private judging.
- `docs/TEST_PLAN.md` — manual test plan and coverage map.
- `docs/REFLECTION.md` — required 5–8 sentence reflection.
- `scripts/deploy.js` — deployment script that writes the contract address and deployment transaction hash to `deployments/<network>.json`.
- `scripts/generate-commitment.js` — helper that creates a random salt and the exact commitment hash.

## Contract lifecycle

1. **Create:** the bounty owner calls `createBounty(submissionDeadline, revealDeadline)` and escrows the ETH reward.
2. **Commit:** before `submissionDeadline`, each participant calls `submitCommitment(bountyId, commitment)`. The contract stores only a `bytes32` hash, never the answer.
3. **Reveal:** from `submissionDeadline` until `revealDeadline`, a participant calls `revealAnswer(bountyId, answer, salt)`.
4. **Verify:** the contract recalculates `keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))`. A mismatch reverts.
5. **Batch judge:** after `revealDeadline`, the bounty owner obtains **one batch result** from the Ritual workflow and calls `judgeAll(bountyId, canonicalResultBytes)`. The contract stores only the canonical result hash.
6. **Human finalization:** the owner reviews the AI recommendation and calls `finalizeWinner(bountyId, winnerIndex)`. The winner must correspond to a valid revealed answer.
7. **Payout:** the escrowed reward transfers once. If no answer was revealed, the owner can use `refundIfNoReveals` after the reveal deadline.

## Required functions

```solidity
submitCommitment(uint256 bountyId, bytes32 commitment)
revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt)
judgeAll(uint256 bountyId, bytes calldata llmInput)
finalizeWinner(uint256 bountyId, uint256 winnerIndex)
```

The contract also adds `createBounty`, read helpers, and a narrowly scoped `refundIfNoReveals` safety path.

## Local run

```bash
npm install
npm run compile
npm test
```

## Deployment

1. Fork the workshop repository into your GitHub account, then copy this project’s files into the fork (or use this project as the replacement homework directory).
2. Copy `.env.example` to `.env`.
3. Add the current Ritual testnet RPC URL, chain ID, and a funded test-wallet private key. Do **not** commit `.env`.
4. Deploy:

```bash
npm run deploy:ritual
```

5. The script prints and writes both required form values:

```text
Deployment address: deployments/ritual.json -> address
Deployment transaction hash: deployments/ritual.json -> transactionHash
```

## Generating a commitment

```bash
npm run commitment -- "My private bounty answer" 1 0xYourWalletAddress
```

The output includes a random `salt` and the exact commitment. Keep the salt private until the reveal phase. Losing the salt makes the reveal impossible.

## AI judging model

`judgeAll` does not loop through submissions and does not call an LLM once per answer. Instead, the revealed submissions are assembled into **one canonical batch** by the Ritual workflow. A recommended result payload can look like this:

```json
{
  "bountyId": 1,
  "winnerIndex": 2,
  "ranking": [
    {"index": 2, "score": 94, "reason": "Best satisfies the rubric."},
    {"index": 0, "score": 87, "reason": "Good, but less complete."}
  ],
  "summary": "Submission 2 is the strongest answer.",
  "revealedAnswersRef": "ipfs://...",
  "revealedAnswersHash": "0x..."
}
```

The contract hashes this canonical payload for an immutable audit trail. It intentionally does not auto-pay from free-form LLM text. The bounty owner remains the explicit human finalizer.

## Security decisions

- Commitment binds `answer`, `salt`, `msg.sender`, and `bountyId`, preventing commitment replay across users or bounties.
- One commitment per wallet per bounty.
- No answer is stored on-chain before a valid reveal.
- Unrevealed entries cannot win.
- Judging is blocked until reveal closure.
- Finalization is blocked until a batch result is recorded.
- Payout uses checks-effects-interactions and `nonReentrant` protection.

See `docs/ARCHITECTURE.md` for the advanced Ritual-native design.

## Frontend dashboard

The `frontend/` directory provides a white-and-blue Ritual Bounty Judge dashboard built with React, TypeScript, Vite, `ethers`, and Lucide icons. It supports:

- Wallet connection through an injected EVM wallet.
- Creating a bounty with independent commit and reveal windows.
- Generating the exact `keccak256(answer, salt, wallet, bountyId)` commitment client-side.
- Saving the answer and salt locally until reveal, so no plaintext is posted during the commit phase.
- Revealing the saved answer during the reveal phase.
- Owner controls for recording one canonical batch-judging payload and finalizing a winner.
- A clearly labelled **Demo Mode** when `VITE_CONTRACT_ADDRESS` is not set; it never represents demo actions as deployed transactions.

Run it locally:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

After you deploy the Solidity contract, set `VITE_CONTRACT_ADDRESS` in `frontend/.env`, restart the Vite server, and connect an EVM wallet. 

<img width="1849" height="979" alt="8aee9e252e88652975e9940a9ef88405" src="https://github.com/user-attachments/assets/b981458e-2edb-4b0f-b997-072086a4fd0d" />

The frontend uses the ABI for `createBounty`, `submitCommitment`, `revealAnswer`, `judgeAll`, and `finalizeWinner`.
