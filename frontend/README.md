# Ritual Bounty Judge Frontend

A responsive, white-and-blue dashboard for the Privacy-Preserving AI Bounty Judge assignment.

## Technology

- React + TypeScript + Vite
- ethers v6 for wallet and contract interactions
- Lucide React icons
- Custom component styles inspired by modern shadcn/HyperUI interaction patterns

## Configuration

Copy `.env.example` to `.env`:

```bash
VITE_CONTRACT_ADDRESS=0xYourDeployedContractAddress
VITE_NETWORK_NAME=Ritual Testnet
VITE_BLOCK_EXPLORER_URL=https://explorer.ritual.net
```

Without a valid `VITE_CONTRACT_ADDRESS`, the interface runs in clearly marked Demo Mode. It can demonstrate the UI flow and commitment generation locally but does not claim that local interactions are on-chain.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Security behaviour

When a participant commits an answer, the UI creates a random 32-byte salt and calculates:

```ts
solidityPackedKeccak256(
  ["string", "bytes32", "address", "uint256"],
  [answer, salt, wallet, bountyId],
)
```

The answer, salt, and commitment are stored only in that browser's local storage to support the later reveal. A production application should let participants export an encrypted backup of their salt, because clearing browser storage makes the reveal impossible.
