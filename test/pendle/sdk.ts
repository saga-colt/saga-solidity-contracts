import { expect } from "chai";
import { network } from "hardhat";
import { isPT, getPTMarketInfo } from "../../typescript/pendle/sdk";
import { SAGA_MAINNET_PT_TOKENS, SAGA_CHAIN_ID, SAGA_PY_FACTORY } from "./fixture";

describe("Pendle SDK Functions", function () {
    // Skip if not on Saga mainnet
    before(function () {
        if (network.name !== "saga_mainnet") {
            console.log(`Skipping Pendle SDK tests - not on Saga mainnet`);
            this.skip();
        }
    });

    describe("isPT function", function () {
        it("Should return true for valid PT tokens", async function () {
            console.log(`\n=== Testing isPT with valid PT tokens ===`);
            
            for (const [tokenName, tokenInfo] of Object.entries(SAGA_MAINNET_PT_TOKENS)) {
                console.log(`Testing ${tokenName} (${tokenInfo.address})`);
                
                const result = await isPT(tokenInfo.address, SAGA_PY_FACTORY);
                
                console.log(`  Result: ${result}`);
                expect(result).to.be.true;
            }
        });

        it("Should return false for non-PT tokens", async function () {
            console.log(`\n=== Testing isPT with non-PT tokens ===`);
            
            // Test with underlying assets (these should not be PT tokens)
            const nonPTTokens = [
                {
                    name: "USDCe (underlying of PT-aUSDC)",
                    address: SAGA_MAINNET_PT_TOKENS.PTaUSDC.asset
                },
                {
                    name: "scUSD (underlying of PT-wstkscUSD)", 
                    address: SAGA_MAINNET_PT_TOKENS.PTwstkscUSD.underlyingToken
                }
            ];

            for (const token of nonPTTokens) {
                console.log(`Testing ${token.name} (${token.address})`);
                
                const result = await isPT(token.address, SAGA_PY_FACTORY);
                
                console.log(`  Result: ${result}`);
                expect(result).to.be.false;
            }
        });

        it("Should return false for invalid addresses", async function () {
            console.log(`\n=== Testing isPT with invalid addresses ===`);
            
            const invalidAddresses = [
                "0x0000000000000000000000000000000000000000", // Zero address
                "0x1111111111111111111111111111111111111111", // Random address
            ];

            for (const address of invalidAddresses) {
                console.log(`Testing invalid address: ${address}`);
                
                const result = await isPT(address, SAGA_PY_FACTORY);
                
                console.log(`  Result: ${result}`);
                expect(result).to.be.false;
            }
        });
    });

    describe("getPTMarketInfo function", function () {
        it("Should return correct market info for PT-aUSDC", async function () {
            console.log(`\n=== Testing getPTMarketInfo for PT-aUSDC ===`);
            
            const ptToken = SAGA_MAINNET_PT_TOKENS.PTaUSDC;
            console.log(`PT Token: ${ptToken.name} (${ptToken.address})`);
            
            const marketInfo = await getPTMarketInfo(ptToken.address, SAGA_CHAIN_ID);
            
            console.log(`Market Info:`, marketInfo);
            console.log(`  Market Address: ${marketInfo.marketAddress}`);
            console.log(`  Underlying Asset: ${marketInfo.underlyingAsset}`);
            
            // Verify the structure
            expect(marketInfo).to.have.property('marketAddress');
            expect(marketInfo).to.have.property('underlyingAsset');
            
            // Verify the values match our fixture data
            expect(marketInfo.marketAddress.toLowerCase()).to.equal(ptToken.market.toLowerCase());
            expect(marketInfo.underlyingAsset.toLowerCase()).to.equal(ptToken.underlyingToken.toLowerCase());            
        });

        it("Should return correct market info for PT-wstkscUSD", async function () {
            console.log(`\n=== Testing getPTMarketInfo for PT-wstkscUSD ===`);
            
            const ptToken = SAGA_MAINNET_PT_TOKENS.PTwstkscUSD;
            console.log(`PT Token: ${ptToken.name} (${ptToken.address})`);
            
            const marketInfo = await getPTMarketInfo(ptToken.address, SAGA_CHAIN_ID);
            
            console.log(`Market Info:`, marketInfo);
            console.log(`  Market Address: ${marketInfo.marketAddress}`);
            console.log(`  Underlying Asset: ${marketInfo.underlyingAsset}`);
            
            // Verify the structure
            expect(marketInfo).to.have.property('marketAddress');
            expect(marketInfo).to.have.property('underlyingAsset');
            
            // Verify the values match our fixture data
            expect(marketInfo.marketAddress.toLowerCase()).to.equal(ptToken.market.toLowerCase());
            expect(marketInfo.underlyingAsset.toLowerCase()).to.equal(ptToken.underlyingToken.toLowerCase());            
        });

        it("Should validate all fixture PT tokens have market info", async function () {
            console.log(`\n=== Validating all fixture PT tokens ===`);
            
            for (const [tokenName, tokenInfo] of Object.entries(SAGA_MAINNET_PT_TOKENS)) {
                console.log(`\nValidating ${tokenName}:`);
                console.log(`  Address: ${tokenInfo.address}`);
                console.log(`  Expected Market: ${tokenInfo.market}`);
                console.log(`  Expected Underlying: ${tokenInfo.underlyingToken}`);
                
                const marketInfo = await getPTMarketInfo(tokenInfo.address, SAGA_CHAIN_ID);
                
                // Verify the API data matches our fixture data
                expect(marketInfo.marketAddress.toLowerCase()).to.equal(
                    tokenInfo.market.toLowerCase(),
                    `Market address mismatch for ${tokenName}`
                );
                
                expect(marketInfo.underlyingAsset.toLowerCase()).to.equal(
                    tokenInfo.underlyingToken.toLowerCase(),
                    `Underlying asset mismatch for ${tokenName}`
                );
                
                console.log(`  ✅ ${tokenName} validated successfully`);
            }
        });
    });
});
