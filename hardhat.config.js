require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { RITUAL_RPC_URL, PRIVATE_KEY } = process.env;

if (!RITUAL_RPC_URL || !PRIVATE_KEY) {
  throw new Error(
    "Missing RITUAL_RPC_URL or PRIVATE_KEY in .env"
  );
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    ritual: {
      url: RITUAL_RPC_URL,
      chainId: 1979,
      accounts: [PRIVATE_KEY]
    }
  }
};