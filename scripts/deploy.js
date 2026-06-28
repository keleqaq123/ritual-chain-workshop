const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const Factory = await hre.ethers.getContractFactory("PrivacyPreservingAIBountyJudge");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  const network = await hre.ethers.provider.getNetwork();

  const result = {
    contract: "PrivacyPreservingAIBountyJudge",
    address,
    transactionHash: tx.hash,
    deployer: deployer.address,
    chainId: network.chainId.toString(),
    network: hre.network.name,
    deployedAt: new Date().toISOString()
  };

  const outputDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `${hre.network.name}.json`), JSON.stringify(result, null, 2));

  console.log("\nDeployment complete");
  console.table(result);
  console.log(`\nSaved: deployments/${hre.network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
