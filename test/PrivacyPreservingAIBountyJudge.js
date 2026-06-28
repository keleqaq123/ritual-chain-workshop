const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

function commitmentFor(answer, salt, signer, bountyId) {
  return ethers.solidityPackedKeccak256(
    ["string", "bytes32", "address", "uint256"],
    [answer, salt, signer.address, bountyId]
  );
}

async function deployFixture() {
  const [owner, alice, bob, outsider] = await ethers.getSigners();
  const Judge = await ethers.getContractFactory("PrivacyPreservingAIBountyJudge");
  const judge = await Judge.deploy();
  await judge.waitForDeployment();

  const now = await time.latest();
  const submissionDeadline = now + 3_600;
  const revealDeadline = now + 7_200;
  const reward = ethers.parseEther("0.25");

  await judge.connect(owner).createBounty(submissionDeadline, revealDeadline, { value: reward });

  return { judge, owner, alice, bob, outsider, submissionDeadline, revealDeadline, reward, bountyId: 1 };
}

describe("PrivacyPreservingAIBountyJudge", function () {
  it("stores only a commitment during the submission phase", async function () {
    const { judge, alice, bountyId } = await loadFixture(deployFixture);
    const answer = "Use a private batch evaluation workflow.";
    const salt = ethers.id("alice-secret-salt");
    const commitment = commitmentFor(answer, salt, alice, bountyId);

    await expect(judge.connect(alice).submitCommitment(bountyId, commitment))
      .to.emit(judge, "CommitmentSubmitted")
      .withArgs(bountyId, 0, alice.address, commitment);

    const submission = await judge.getSubmission(bountyId, 0);
    expect(submission[1]).to.equal(commitment);
    expect(submission[2]).to.equal(false);
    expect(submission[3]).to.equal("");
  });

  it("rejects a second commitment from the same participant", async function () {
    const { judge, alice, bountyId } = await loadFixture(deployFixture);
    const salt = ethers.id("alice-secret-salt");
    const commitment = commitmentFor("answer", salt, alice, bountyId);

    await judge.connect(alice).submitCommitment(bountyId, commitment);
    await expect(judge.connect(alice).submitCommitment(bountyId, commitment))
      .to.be.revertedWithCustomError(judge, "CommitmentAlreadySubmitted");
  });

  it("rejects a reveal before the submission deadline", async function () {
    const { judge, alice, bountyId } = await loadFixture(deployFixture);
    const answer = "A hidden answer";
    const salt = ethers.id("alice-secret-salt");
    await judge.connect(alice).submitCommitment(bountyId, commitmentFor(answer, salt, alice, bountyId));

    await expect(judge.connect(alice).revealAnswer(bountyId, answer, salt))
      .to.be.revertedWithCustomError(judge, "RevealPhaseNotOpen");
  });

  it("accepts only the exact committed answer and salt", async function () {
    const { judge, alice, bountyId, submissionDeadline } = await loadFixture(deployFixture);
    const answer = "Batch all answers into one private AI request.";
    const salt = ethers.id("alice-secret-salt");
    await judge.connect(alice).submitCommitment(bountyId, commitmentFor(answer, salt, alice, bountyId));

    await time.increaseTo(submissionDeadline);
    await expect(judge.connect(alice).revealAnswer(bountyId, "Changed answer", salt))
      .to.be.revertedWithCustomError(judge, "InvalidReveal");

    await expect(judge.connect(alice).revealAnswer(bountyId, answer, salt))
      .to.emit(judge, "AnswerRevealed");

    const submission = await judge.getSubmission(bountyId, 0);
    expect(submission[2]).to.equal(true);
    expect(submission[3]).to.equal(answer);
  });

  it("rejects reveals after the reveal deadline", async function () {
    const { judge, alice, bountyId, revealDeadline } = await loadFixture(deployFixture);
    const answer = "A valid but late answer";
    const salt = ethers.id("late-salt");
    await judge.connect(alice).submitCommitment(bountyId, commitmentFor(answer, salt, alice, bountyId));

    await time.increaseTo(revealDeadline);
    await expect(judge.connect(alice).revealAnswer(bountyId, answer, salt))
      .to.be.revertedWithCustomError(judge, "RevealPhaseClosed");
  });

  it("records one batch judging result only after reveal close", async function () {
    const { judge, owner, alice, bountyId, submissionDeadline, revealDeadline } = await loadFixture(deployFixture);
    const answer = "Encrypt submissions for the TEE.";
    const salt = ethers.id("salt");
    await judge.connect(alice).submitCommitment(bountyId, commitmentFor(answer, salt, alice, bountyId));

    await expect(judge.connect(owner).judgeAll(bountyId, ethers.toUtf8Bytes('{"winnerIndex":0}')))
      .to.be.revertedWithCustomError(judge, "JudgeNotReady");

    await time.increaseTo(submissionDeadline);
    await judge.connect(alice).revealAnswer(bountyId, answer, salt);
    await time.increaseTo(revealDeadline);

    const result = ethers.toUtf8Bytes('{"winnerIndex":0,"summary":"Submission 0 meets the rubric."}');
    await expect(judge.connect(owner).judgeAll(bountyId, result))
      .to.emit(judge, "BatchJudgingRecorded");

    await expect(judge.connect(owner).judgeAll(bountyId, result))
      .to.be.revertedWithCustomError(judge, "JudgeAlreadyRecorded");
  });

  it("pays one revealed winner only after judging", async function () {
    const { judge, owner, alice, bob, bountyId, submissionDeadline, revealDeadline, reward } = await loadFixture(deployFixture);
    const aliceAnswer = "Use commitment binding to sender and bounty ID.";
    const bobAnswer = "Use ECIES encryption to the TEE executor public key.";
    const aliceSalt = ethers.id("alice-final-salt");
    const bobSalt = ethers.id("bob-final-salt");

    await judge.connect(alice).submitCommitment(bountyId, commitmentFor(aliceAnswer, aliceSalt, alice, bountyId));
    await judge.connect(bob).submitCommitment(bountyId, commitmentFor(bobAnswer, bobSalt, bob, bountyId));
    await time.increaseTo(submissionDeadline);
    await judge.connect(alice).revealAnswer(bountyId, aliceAnswer, aliceSalt);
    // Bob never reveals, so index 1 is ineligible.
    await time.increaseTo(revealDeadline);
    await judge.connect(owner).judgeAll(bountyId, ethers.toUtf8Bytes('{"winnerIndex":0}'));

    await expect(judge.connect(owner).finalizeWinner(bountyId, 1))
      .to.be.revertedWithCustomError(judge, "WinnerNotEligible");

    await expect(() => judge.connect(owner).finalizeWinner(bountyId, 0))
      .to.changeEtherBalance(alice, reward);

    await expect(judge.connect(owner).finalizeWinner(bountyId, 0))
      .to.be.revertedWithCustomError(judge, "AlreadyFinalized");
  });

  it("refunds the owner only when nobody reveals", async function () {
    const { judge, owner, alice, bountyId, revealDeadline, reward } = await loadFixture(deployFixture);
    const answer = "I will not reveal.";
    const salt = ethers.id("no-reveal-salt");
    await judge.connect(alice).submitCommitment(bountyId, commitmentFor(answer, salt, alice, bountyId));
    await time.increaseTo(revealDeadline);

    await expect(() => judge.connect(owner).refundIfNoReveals(bountyId))
      .to.changeEtherBalance(owner, reward);
  });
});
