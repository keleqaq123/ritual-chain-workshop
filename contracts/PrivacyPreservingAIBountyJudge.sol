// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PrivacyPreservingAIBountyJudge
/// @notice Escrows a bounty reward and enforces a fair commit-reveal submission lifecycle.
/// @dev The contract deliberately does not perform one LLM request per answer. After the reveal
///      deadline, the bounty owner performs one batch request through a Ritual workflow and commits
///      the canonical result payload hash with judgeAll(). A human owner then finalizes an eligible
///      winner, which keeps payout authority explicit and auditable.
contract PrivacyPreservingAIBountyJudge is ReentrancyGuard {
    struct Bounty {
        address owner;
        uint256 reward;
        uint64 submissionDeadline;
        uint64 revealDeadline;
        uint256 revealedCount;
        bool judged;
        bool finalized;
        bytes32 judgeResultHash;
        uint256 winnerIndex;
    }

    struct Submission {
        address participant;
        bytes32 commitment;
        string answer;
        bool revealed;
    }

    uint256 public nextBountyId = 1;

    mapping(uint256 bountyId => Bounty bounty) private _bounties;
    mapping(uint256 bountyId => Submission[] submissions) private _submissions;
    mapping(uint256 bountyId => mapping(address participant => bool submitted)) private _hasCommitted;

    error BountyNotFound();
    error NotBountyOwner();
    error InvalidReward();
    error InvalidDeadlines();
    error SubmissionPhaseClosed();
    error RevealPhaseNotOpen();
    error RevealPhaseClosed();
    error CommitmentAlreadySubmitted();
    error CommitmentMissing();
    error EmptyCommitment();
    error EmptyAnswer();
    error InvalidReveal();
    error JudgeAlreadyRecorded();
    error JudgeNotReady();
    error NoEligibleSubmissions();
    error EmptyJudgeResult();
    error AlreadyFinalized();
    error InvalidWinnerIndex();
    error WinnerNotEligible();
    error TransferFailed();
    error RefundNotAvailable();

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        uint256 reward,
        uint64 submissionDeadline,
        uint64 revealDeadline
    );
    event CommitmentSubmitted(uint256 indexed bountyId, uint256 indexed submissionIndex, address indexed participant, bytes32 commitment);
    event AnswerRevealed(uint256 indexed bountyId, uint256 indexed submissionIndex, address indexed participant, bytes32 answerHash);
    event BatchJudgingRecorded(uint256 indexed bountyId, bytes32 indexed judgeResultHash, uint256 eligibleSubmissionCount);
    event WinnerFinalized(uint256 indexed bountyId, uint256 indexed winnerIndex, address indexed winner, uint256 reward);
    event EmptyBountyRefunded(uint256 indexed bountyId, address indexed owner, uint256 reward);

    modifier bountyExists(uint256 bountyId) {
        if (_bounties[bountyId].owner == address(0)) revert BountyNotFound();
        _;
    }

    modifier onlyOwner(uint256 bountyId) {
        if (msg.sender != _bounties[bountyId].owner) revert NotBountyOwner();
        _;
    }

    /// @notice Create a bounty and escrow its ETH reward in this contract.
    /// @param submissionDeadline Timestamp before which only commitments may be submitted.
    /// @param revealDeadline Timestamp before which committed answers must be revealed.
    function createBounty(uint64 submissionDeadline, uint64 revealDeadline) external payable returns (uint256 bountyId) {
        if (msg.value == 0) revert InvalidReward();
        if (submissionDeadline <= block.timestamp || revealDeadline <= submissionDeadline) revert InvalidDeadlines();

        bountyId = nextBountyId++;
        _bounties[bountyId] = Bounty({
            owner: msg.sender,
            reward: msg.value,
            submissionDeadline: submissionDeadline,
            revealDeadline: revealDeadline,
            revealedCount: 0,
            judged: false,
            finalized: false,
            judgeResultHash: bytes32(0),
            winnerIndex: type(uint256).max
        });

        emit BountyCreated(bountyId, msg.sender, msg.value, submissionDeadline, revealDeadline);
    }

    /// @notice Submit a single opaque commitment during the submission phase.
    /// @dev Commitment must be keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId)).
    function submitCommitment(uint256 bountyId, bytes32 commitment) external bountyExists(bountyId) {
        Bounty storage bounty = _bounties[bountyId];
        if (block.timestamp >= bounty.submissionDeadline) revert SubmissionPhaseClosed();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (_hasCommitted[bountyId][msg.sender]) revert CommitmentAlreadySubmitted();

        _hasCommitted[bountyId][msg.sender] = true;
        _submissions[bountyId].push(
            Submission({participant: msg.sender, commitment: commitment, answer: "", revealed: false})
        );

        uint256 submissionIndex = _submissions[bountyId].length - 1;
        emit CommitmentSubmitted(bountyId, submissionIndex, msg.sender, commitment);
    }

    /// @notice Reveal the answer and salt after submissions close.
    /// @dev A valid reveal proves that the answer was fixed when the commitment was submitted.
    function revealAnswer(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) {
        Bounty storage bounty = _bounties[bountyId];
        if (block.timestamp < bounty.submissionDeadline) revert RevealPhaseNotOpen();
        if (block.timestamp >= bounty.revealDeadline) revert RevealPhaseClosed();
        if (bytes(answer).length == 0) revert EmptyAnswer();
        if (!_hasCommitted[bountyId][msg.sender]) revert CommitmentMissing();

        uint256 submissionIndex = _findSubmissionIndex(bountyId, msg.sender);
        Submission storage submission = _submissions[bountyId][submissionIndex];
        if (submission.revealed) revert InvalidReveal();

        bytes32 expectedCommitment = keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId));
        if (expectedCommitment != submission.commitment) revert InvalidReveal();

        submission.answer = answer;
        submission.revealed = true;
        bounty.revealedCount += 1;

        emit AnswerRevealed(bountyId, submissionIndex, msg.sender, keccak256(bytes(answer)));
    }

    /// @notice Record the hash of the one canonical Ritual batch-judging result after reveals close.
    /// @param llmInput Canonical batch result bytes or a canonical result envelope. Only its hash is stored.
    /// @dev Execute the AI workflow off-chain / in Ritual delegated TEE execution first. The event binds
    ///      the selected result payload to the bounty without storing a large payload on-chain.
    function judgeAll(uint256 bountyId, bytes calldata llmInput)
        external
        bountyExists(bountyId)
        onlyOwner(bountyId)
    {
        Bounty storage bounty = _bounties[bountyId];
        if (block.timestamp < bounty.revealDeadline) revert JudgeNotReady();
        if (bounty.judged) revert JudgeAlreadyRecorded();
        if (bounty.revealedCount == 0) revert NoEligibleSubmissions();
        if (llmInput.length == 0) revert EmptyJudgeResult();

        bounty.judged = true;
        bounty.judgeResultHash = keccak256(llmInput);

        emit BatchJudgingRecorded(bountyId, bounty.judgeResultHash, bounty.revealedCount);
    }

    /// @notice Human-in-the-loop final payout. The selected index must be a valid revealed answer.
    /// @dev The owner reviews the recorded AI result before selecting the winner. This contract does not
    ///      auto-pay from unparsed LLM text.
    function finalizeWinner(uint256 bountyId, uint256 winnerIndex)
        external
        nonReentrant
        bountyExists(bountyId)
        onlyOwner(bountyId)
    {
        Bounty storage bounty = _bounties[bountyId];
        if (!bounty.judged) revert JudgeNotReady();
        if (bounty.finalized) revert AlreadyFinalized();
        if (winnerIndex >= _submissions[bountyId].length) revert InvalidWinnerIndex();

        Submission storage winner = _submissions[bountyId][winnerIndex];
        if (!winner.revealed) revert WinnerNotEligible();

        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        (bool sent, ) = winner.participant.call{value: bounty.reward}("");
        if (!sent) revert TransferFailed();

        emit WinnerFinalized(bountyId, winnerIndex, winner.participant, bounty.reward);
    }

    /// @notice Lets the owner recover funds if the reveal phase ends with no eligible answers.
    function refundIfNoReveals(uint256 bountyId)
        external
        nonReentrant
        bountyExists(bountyId)
        onlyOwner(bountyId)
    {
        Bounty storage bounty = _bounties[bountyId];
        if (block.timestamp < bounty.revealDeadline || bounty.revealedCount != 0 || bounty.judged || bounty.finalized) {
            revert RefundNotAvailable();
        }

        bounty.finalized = true;
        (bool sent, ) = bounty.owner.call{value: bounty.reward}("");
        if (!sent) revert TransferFailed();

        emit EmptyBountyRefunded(bountyId, bounty.owner, bounty.reward);
    }

    function getBounty(uint256 bountyId)
        external
        view
        bountyExists(bountyId)
        returns (
            address owner,
            uint256 reward,
            uint64 submissionDeadline,
            uint64 revealDeadline,
            uint256 revealedCount,
            bool judged,
            bool finalized,
            bytes32 judgeResultHash,
            uint256 winnerIndex
        )
    {
        Bounty storage bounty = _bounties[bountyId];
        return (
            bounty.owner,
            bounty.reward,
            bounty.submissionDeadline,
            bounty.revealDeadline,
            bounty.revealedCount,
            bounty.judged,
            bounty.finalized,
            bounty.judgeResultHash,
            bounty.winnerIndex
        );
    }

    function getSubmissionCount(uint256 bountyId) external view bountyExists(bountyId) returns (uint256) {
        return _submissions[bountyId].length;
    }

    function getSubmission(uint256 bountyId, uint256 submissionIndex)
        external
        view
        bountyExists(bountyId)
        returns (address participant, bytes32 commitment, bool revealed, string memory answer)
    {
        if (submissionIndex >= _submissions[bountyId].length) revert InvalidWinnerIndex();
        Submission storage submission = _submissions[bountyId][submissionIndex];
        return (submission.participant, submission.commitment, submission.revealed, submission.answer);
    }

    function computeCommitment(
        string calldata answer,
        bytes32 salt,
        address participant,
        uint256 bountyId
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(answer, salt, participant, bountyId));
    }

    function _findSubmissionIndex(uint256 bountyId, address participant) private view returns (uint256) {
        Submission[] storage submissions = _submissions[bountyId];
        for (uint256 i = 0; i < submissions.length; ++i) {
            if (submissions[i].participant == participant) return i;
        }
        revert CommitmentMissing();
    }
}
