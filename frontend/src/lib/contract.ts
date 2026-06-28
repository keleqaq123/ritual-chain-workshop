import { BrowserProvider, Contract, type Eip1193Provider } from "ethers";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() ?? "";

export const BOUNTY_ABI = [
  "function createBounty(uint64 submissionDeadline, uint64 revealDeadline) payable returns (uint256)",
  "function submitCommitment(uint256 bountyId, bytes32 commitment)",
  "function revealAnswer(uint256 bountyId, string answer, bytes32 salt)",
  "function judgeAll(uint256 bountyId, bytes llmInput)",
  "function finalizeWinner(uint256 bountyId, uint256 winnerIndex)",
  "function getBounty(uint256 bountyId) view returns (address owner, uint256 reward, uint64 submissionDeadline, uint64 revealDeadline, uint256 revealedCount, bool judged, bool finalized, bytes32 judgeResultHash, uint256 winnerIndex)",
  "function getSubmissionCount(uint256 bountyId) view returns (uint256)",
  "function getSubmission(uint256 bountyId, uint256 submissionIndex) view returns (address participant, bytes32 commitment, bool revealed, string answer)",
  "event BountyCreated(uint256 indexed bountyId, address indexed owner, uint256 reward, uint64 submissionDeadline, uint64 revealDeadline)",
  "event CommitmentSubmitted(uint256 indexed bountyId, uint256 indexed submissionIndex, address indexed participant, bytes32 commitment)",
  "event AnswerRevealed(uint256 indexed bountyId, uint256 indexed submissionIndex, address indexed participant, bytes32 answerHash)",
  "event BatchJudgingRecorded(uint256 indexed bountyId, bytes32 indexed judgeResultHash, uint256 eligibleSubmissionCount)",
  "event WinnerFinalized(uint256 indexed bountyId, uint256 indexed winnerIndex, address indexed winner, uint256 reward)"
] as const;

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function hasLiveContract() {
  return /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);
}

export async function getWalletConnection() {
  if (!window.ethereum) throw new Error("No browser wallet was found. Install MetaMask or another EVM wallet.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export async function getWriteContract() {
  if (!hasLiveContract()) throw new Error("Add VITE_CONTRACT_ADDRESS to enable live contract actions.");
  const { signer } = await getWalletConnection();
  return new Contract(CONTRACT_ADDRESS, BOUNTY_ABI, signer);
}
