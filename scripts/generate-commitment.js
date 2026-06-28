const { ethers } = require("ethers");

const [, , answer, bountyId, participant] = process.argv;

if (!answer || !bountyId || !participant) {
  console.error('Usage: npm run commitment -- "your answer" <bountyId> <participantAddress>');
  process.exit(1);
}

if (!ethers.isAddress(participant)) {
  console.error("participantAddress is not a valid EVM address.");
  process.exit(1);
}

const salt = ethers.hexlify(ethers.randomBytes(32));
const commitment = ethers.solidityPackedKeccak256(
  ["string", "bytes32", "address", "uint256"],
  [answer, salt, participant, BigInt(bountyId)]
);

console.log("Commitment generated. Store the salt securely; it is required for the reveal transaction.");
console.log(JSON.stringify({ bountyId, participant, answer, salt, commitment }, null, 2));
